// Browser side of places: the device's position, and turning it into a name.
// Order of preference, cheapest and most private first:
//   1. a place you've already used, nearby  (local — no network)
//   2. the map service via /api/geocode     (Google, or OSM without a key)
//   3. a name generated from the coordinates (offline, always works)

import type { KnownPlace } from './db';
import { distanceM, generatedName, hasCoords, roundCoord, type PlaceHit } from './place';

export interface Coords {
	lat: number;
	lon: number;
}

export type Provider = 'google' | 'osm';

const TIMEOUT = 8000;

export function geolocationSupported(): boolean {
	return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

export async function permissionState(): Promise<PermissionState | 'unsupported'> {
	if (!geolocationSupported()) return 'unsupported';
	try {
		return (await navigator.permissions.query({ name: 'geolocation' })).state;
	} catch {
		return 'prompt'; // Permissions API missing (older Safari) — asking is the only way to know
	}
}

// The device's position, or null — never throws. prompt=false only answers when
// permission was already granted, so a background caller can't pop a dialog.
export async function currentPosition({ prompt }: { prompt: boolean }): Promise<Coords | null> {
	if (!geolocationSupported()) return null;
	const state = await permissionState();
	if (state === 'denied' || (!prompt && state !== 'granted')) return null;
	return new Promise((resolve) => {
		navigator.geolocation.getCurrentPosition(
			(p) => resolve({ lat: roundCoord(p.coords.latitude), lon: roundCoord(p.coords.longitude) }),
			() => resolve(null),
			// a fix from the last few minutes is fine — a journal isn't turn-by-turn
			{ enableHighAccuracy: false, timeout: TIMEOUT, maximumAge: 5 * 60_000 }
		);
	});
}

// Hand-picked and renamed places claim a wider radius than silently found
// ones: "Home" should still be home from the far end of the flat, but an auto
// name shouldn't swallow the café next door.
const MANUAL_RADIUS_M = 150;
const AUTO_RADIUS_M = 40;

export function nearestKnown(at: Coords, known: KnownPlace[]): KnownPlace | null {
	let best: { p: KnownPlace; d: number } | null = null;
	for (const p of known) {
		if (!hasCoords(p)) continue;
		const d = distanceM(at, p);
		if (d > (p.source === 'manual' ? MANUAL_RADIUS_M : AUTO_RADIUS_M)) continue;
		// manual names win over auto ones in range; then the closest
		if (
			!best ||
			(p.source === 'manual' && best.p.source !== 'manual') ||
			(p.source === best.p.source && d < best.d)
		)
			best = { p, d };
	}
	return best?.p ?? null;
}

async function api<T>(params: Record<string, string | number | undefined>): Promise<T | null> {
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
	try {
		const res = await fetch(`/api/geocode?${qs}`, { signal: AbortSignal.timeout(TIMEOUT) });
		return res.ok ? ((await res.json()) as T) : null;
	} catch {
		return null; // offline, or the service hiccuped — callers fall back
	}
}

// A name for where you are. Always returns something: the coordinates are the
// writer's own, and a generated name stands in when nothing else knows the spot.
export async function resolvePlace(at: Coords, known: KnownPlace[]): Promise<PlaceHit> {
	const mine = nearestKnown(at, known);
	if (mine) return { name: mine.name, area: mine.area, placeId: mine.placeId, ...at };
	const res = await api<{ hit: PlaceHit | null }>({ lat: at.lat, lon: at.lon });
	if (res?.hit) return { ...res.hit, ...at };
	return { name: generatedName(at.lat, at.lon), ...at };
}

export async function searchPlaces(
	q: string,
	session: string,
	near: Coords | null
): Promise<{ provider: Provider; hits: PlaceHit[] } | null> {
	return api({ q, session, lat: near?.lat, lon: near?.lon });
}

// A Google suggestion carries no coordinates until it's picked.
export async function placeCoords(placeId: string, session: string): Promise<Coords | null> {
	const res = await api<{ hit: Coords | null }>({ place: placeId, session });
	return res?.hit ?? null;
}
