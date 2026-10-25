import { env } from '$env/dynamic/private';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { roundCoord, type PlaceHit } from '$lib/place';

// server endpoint (Vercel function) — not prerendered; pages stay static
export const prerender = false;

// Place names for the location field. Proxied rather than called from the
// browser so the provider never sees the writer's IP, the Google key stays
// server-side, and one place can enforce quotas.
//
//   ?lat&lon              → reverse: the nearest named place      { hit }
//   ?q[&lat&lon]&session  → autocomplete suggestions              { hits }
//   ?place&session        → a Google suggestion's coordinates     { hit }
//
// Google Places when GOOGLE_MAPS_API_KEY is set; otherwise Photon (OpenStreetMap
// data, free, no key) so the feature still works on a fresh deploy.

type Provider = 'google' | 'osm';

const TIMEOUT = 5000;
// Nearby Search radius for silent capture: a café across the street counts,
// the one down the block does not — that's what the neighbourhood is for.
const NEARBY_M = 60;
const UA = 'Present journal (https://github.com/mohitvirli/present)';

// --- per-instance guards -------------------------------------------------------
// Serverless instances are short-lived, so these are best-effort: the hard
// ceiling is the daily quota set on the key in Google Cloud Console.

const WINDOW_MS = 60_000;
const PER_WINDOW = 60;
const hitsByIp = new Map<string, { start: number; n: number }>();

function rateLimited(ip: string): boolean {
	const now = Date.now();
	const w = hitsByIp.get(ip);
	if (!w || now - w.start > WINDOW_MS) {
		if (hitsByIp.size > 5000) hitsByIp.clear();
		hitsByIp.set(ip, { start: now, n: 1 });
		return false;
	}
	return ++w.n > PER_WINDOW;
}

const cache = new Map<string, unknown>();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
	if (cache.has(key)) return cache.get(key) as T;
	const value = await fn();
	if (cache.size > 1000) cache.delete(cache.keys().next().value!);
	cache.set(key, value);
	return value;
}

async function getJSON(url: string, init?: RequestInit): Promise<unknown> {
	const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
	if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
	return res.json();
}

const joinArea = (...parts: (string | undefined)[]) =>
	[...new Set(parts.filter((p): p is string => !!p && !!p.trim()))].join(', ') || undefined;

// --- Google ----------------------------------------------------------------------

type GComponent = { longText?: string; long_name?: string; types?: string[] };

function gPart(components: GComponent[] | undefined, ...types: string[]): string | undefined {
	for (const t of types) {
		const c = components?.find((x) => x.types?.includes(t));
		if (c) return c.longText ?? c.long_name;
	}
}

const NEIGHBOURHOOD = ['neighborhood', 'sublocality_level_1', 'sublocality'];

async function googleReverse(key: string, lat: number, lon: number): Promise<PlaceHit | null> {
	// 1. the closest named place (a café, a park) — Nearby Search, Pro tier
	const nearby = (await getJSON('https://places.googleapis.com/v1/places:searchNearby', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'X-Goog-Api-Key': key,
			'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.addressComponents'
		},
		body: JSON.stringify({
			maxResultCount: 1,
			rankPreference: 'DISTANCE',
			locationRestriction: {
				circle: { center: { latitude: lat, longitude: lon }, radius: NEARBY_M }
			}
		})
	})) as {
		places?: {
			id: string;
			displayName?: { text?: string };
			addressComponents?: GComponent[];
		}[];
	};
	const p = nearby.places?.[0];
	if (p?.displayName?.text) {
		return {
			name: p.displayName.text,
			area: joinArea(
				gPart(p.addressComponents, ...NEIGHBOURHOOD),
				gPart(p.addressComponents, 'locality')
			),
			placeId: p.id
		};
	}

	// 2. nothing named that close → the neighbourhood (Geocoding, Essentials)
	const geo = (await getJSON(
		`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}` +
			`&result_type=${[...NEIGHBOURHOOD, 'locality'].join('|')}&key=${key}`
	)) as { results?: { address_components?: GComponent[]; place_id?: string }[] };
	const r = geo.results?.[0];
	const hood = gPart(r?.address_components, ...NEIGHBOURHOOD);
	const city = gPart(r?.address_components, 'locality', 'administrative_area_level_2');
	const name = hood ?? city;
	if (!name) return null;
	return { name, area: hood ? city : gPart(r?.address_components, 'administrative_area_level_1') };
}

async function googleSearch(
	key: string,
	q: string,
	session: string | undefined,
	near: { lat: number; lon: number } | null
): Promise<PlaceHit[]> {
	const res = (await getJSON('https://places.googleapis.com/v1/places:autocomplete', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key },
		body: JSON.stringify({
			input: q,
			sessionToken: session,
			...(near && {
				locationBias: {
					circle: { center: { latitude: near.lat, longitude: near.lon }, radius: 50_000 }
				}
			})
		})
	})) as {
		suggestions?: {
			placePrediction?: {
				placeId: string;
				structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
				text?: { text?: string };
			};
		}[];
	};
	return (res.suggestions ?? [])
		.map((s) => s.placePrediction)
		.filter((p) => !!p)
		.map((p) => ({
			name: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
			area: p.structuredFormat?.secondaryText?.text || undefined,
			placeId: p.placeId
		}))
		.filter((h) => h.name)
		.slice(0, 5);
}

// Closes the autocomplete session (which makes its keystrokes free) and asks
// only for `location`, the cheapest Place Details tier.
async function googleDetails(key: string, placeId: string, session: string | undefined) {
	const qs = session ? `?sessionToken=${encodeURIComponent(session)}` : '';
	const res = (await getJSON(
		`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${qs}`,
		{ headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'location' } }
	)) as { location?: { latitude: number; longitude: number } };
	if (!res.location) return null;
	return { lat: roundCoord(res.location.latitude), lon: roundCoord(res.location.longitude) };
}

// --- Photon (OpenStreetMap) -------------------------------------------------------

type PhotonFeature = {
	geometry?: { coordinates?: [number, number] };
	properties?: Record<string, string | undefined>;
};

function photonHit(f: PhotonFeature): PlaceHit | null {
	const p = f.properties ?? {};
	const [lon, lat] = f.geometry?.coordinates ?? [];
	const hood = p.district ?? p.locality ?? p.suburb;
	const city = p.city ?? p.town ?? p.village ?? p.county;
	const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : undefined;
	// a bare house address reads worse than its neighbourhood
	const name = p.name ?? hood ?? street ?? city ?? p.state;
	if (!name) return null;
	const hit: PlaceHit = {
		name,
		area: joinArea(name === hood ? undefined : hood, city === name ? p.state : city)
	};
	if (typeof lat === 'number' && typeof lon === 'number') {
		hit.lat = roundCoord(lat);
		hit.lon = roundCoord(lon);
	}
	return hit;
}

async function photonReverse(lat: number, lon: number): Promise<PlaceHit | null> {
	const res = (await getJSON(
		`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1&lang=en`,
		{
			headers: { 'user-agent': UA }
		}
	)) as { features?: PhotonFeature[] };
	const hit = res.features?.[0] && photonHit(res.features[0]);
	// the writer's own coordinates are the truth, not the matched feature's
	return hit ? { ...hit, lat: undefined, lon: undefined } : null;
}

async function photonSearch(
	q: string,
	near: { lat: number; lon: number } | null
): Promise<PlaceHit[]> {
	const bias = near ? `&lat=${near.lat}&lon=${near.lon}` : '';
	const res = (await getJSON(
		`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en${bias}`,
		{ headers: { 'user-agent': UA } }
	)) as { features?: PhotonFeature[] };
	return (res.features ?? []).map(photonHit).filter((h): h is PlaceHit => !!h);
}

// --- handler -----------------------------------------------------------------------

function coord(v: string | null, limit: number): number | null {
	if (v == null || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) && Math.abs(n) <= limit ? roundCoord(n) : null;
}

export const GET: RequestHandler = async ({ url, getClientAddress, setHeaders }) => {
	if (rateLimited(getClientAddress())) throw error(429, 'Slow down a little.');

	const key = env.GOOGLE_MAPS_API_KEY?.trim() || null;
	const provider: Provider = key ? 'google' : 'osm';
	const lat = coord(url.searchParams.get('lat'), 90);
	const lon = coord(url.searchParams.get('lon'), 180);
	const near = lat != null && lon != null ? { lat, lon } : null;
	const session = url.searchParams.get('session')?.slice(0, 64) || undefined;
	const q = url.searchParams.get('q')?.trim().slice(0, 120);
	const placeId = url.searchParams.get('place')?.slice(0, 256);

	setHeaders({ 'cache-control': 'private, no-store' });

	try {
		if (q) {
			if (q.length < 2) return json({ provider, hits: [] });
			const hits = key ? await googleSearch(key, q, session, near) : await photonSearch(q, near);
			return json({ provider, hits });
		}
		if (placeId) {
			if (!key) throw error(400, 'Place lookups need Google.');
			const loc = await cached(`d:${placeId}`, () => googleDetails(key, placeId, session));
			return json({ provider, hit: loc });
		}
		if (near) {
			const hit = await cached(`r:${provider}:${near.lat},${near.lon}`, () =>
				key ? googleReverse(key, near.lat, near.lon) : photonReverse(near.lat, near.lon)
			);
			return json({ provider, hit });
		}
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e; // our own error()
		console.error('geocode failed:', e);
		throw error(502, 'Could not reach the map service.');
	}
	throw error(400, 'Pass lat & lon, q, or place.');
};
