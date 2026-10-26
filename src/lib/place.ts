// Where an entry was written. Dependency-free on purpose: db.ts, the export,
// the timeline card and the geocode route all need it, and none of them should
// pull in the browser-only geolocation code in location.ts to get it.

export interface Place {
	name: string; // the writer can rename it ("Home")
	city?: string; // "Bengaluru" — never the neighbourhood; absent when it'd repeat the name
	lat?: number; // absent = a name typed by hand, pinned nowhere
	lon?: number;
	placeId?: string; // Google place id, when the name came from Google
	source: 'auto' | 'manual'; // auto = added silently on the first save
}

// A search / reverse-geocode hit, before it becomes an entry's Place.
export interface PlaceHit {
	name: string;
	area?: string; // dropdown-only context, e.g. "Indiranagar, Bengaluru, Karnataka"
	city?: string;
	lat?: number;
	lon?: number;
	placeId?: string;
}

// Stored coordinates are rounded to 4 dp (~11m): close enough to recognise the
// same café next time, no finer than a journal needs.
export function roundCoord(n: number, dp = 4): number {
	const f = 10 ** dp;
	return Math.round(n * f) / f;
}

function isCoord(n: unknown, limit: number): n is number {
	return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit;
}

// metadata.location was a bare string before places existed (never written by
// the UI, but an import can carry one), and synced/imported metadata is
// untrusted shape-wise — so every read goes through here.
export function placeOf(raw: unknown): Place | undefined {
	if (typeof raw === 'string') {
		const name = raw.trim();
		return name ? { name, source: 'manual' } : undefined;
	}
	if (!raw || typeof raw !== 'object') return undefined;
	const r = raw as Record<string, unknown>;
	const name = typeof r.name === 'string' ? r.name.trim() : '';
	if (!name) return undefined;
	const place: Place = { name, source: r.source === 'auto' ? 'auto' : 'manual' };
	if (typeof r.city === 'string' && r.city.trim()) place.city = r.city.trim();
	// early builds stored "Neighbourhood, City" as area — the city is its tail
	else if (typeof r.area === 'string' && r.area.trim())
		place.city = r.area.split(',').pop()!.trim();
	if (place.city?.toLowerCase() === name.toLowerCase()) delete place.city;
	if (isCoord(r.lat, 90) && isCoord(r.lon, 180)) {
		place.lat = r.lat;
		place.lon = r.lon;
	}
	if (typeof r.placeId === 'string' && r.placeId) place.placeId = r.placeId;
	return place;
}

export function hasCoords(p: { lat?: number; lon?: number }): p is { lat: number; lon: number } {
	return typeof p.lat === 'number' && typeof p.lon === 'number';
}

// 12.942° N, 77.703° E — shown at 3 dp (~110m) though stored at 4: a
// browser's fix is usually only good to tens of metres, so a fourth digit on
// screen would claim a precision the reading doesn't have.
export function formatCoords(lat: number, lon: number): string {
	const ns = lat >= 0 ? 'N' : 'S';
	const ew = lon >= 0 ? 'E' : 'W';
	return `${Math.abs(lat).toFixed(3)}° ${ns}, ${Math.abs(lon).toFixed(3)}° ${ew}`;
}

// A hit becomes an entry's place: the dropdown-only area is dropped, and a
// city that just repeats the name ("Bengaluru, Bengaluru") goes too.
export function toPlace(h: PlaceHit, source: Place['source']): Place {
	const p: Place = { name: h.name, source };
	if (h.city && h.city.toLowerCase() !== h.name.toLowerCase()) p.city = h.city;
	if (hasCoords(h)) {
		p.lat = h.lat;
		p.lon = h.lon;
	}
	if (h.placeId) p.placeId = h.placeId;
	return p;
}

export function mapsUrl(p: Place): string | null {
	if (!hasCoords(p)) return null;
	const q = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
	return p.placeId ? `${q}&query_place_id=${encodeURIComponent(p.placeId)}` : q;
}

// Great-circle distance in metres (haversine).
export function distanceM(
	a: { lat: number; lon: number },
	b: { lat: number; lon: number }
): number {
	const R = 6_371_000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLon = toRad(b.lon - a.lon);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(h));
}

// --- generated names ----------------------------------------------------------

// When nothing has a name for a spot (open sea, a trail, offline) it still gets
// one — built from the coordinates, so the same spot always earns the same
// name and it works as a nickname rather than noise. ~110m grid (3 dp).
const ADJECTIVES = [
	'Amber',
	'Ash',
	'Azure',
	'Birch',
	'Bright',
	'Cedar',
	'Cinder',
	'Clear',
	'Cloud',
	'Copper',
	'Coral',
	'Crimson',
	'Dawn',
	'Drift',
	'Dusk',
	'Ember',
	'Fern',
	'Frost',
	'Gilded',
	'Glass',
	'Golden',
	'Hazel',
	'Hidden',
	'Hollow',
	'Indigo',
	'Iron',
	'Ivory',
	'Jade',
	'Juniper',
	'Lantern',
	'Linen',
	'Lunar',
	'Maple',
	'Meadow',
	'Mist',
	'Moss',
	'Night',
	'Oak',
	'Ochre',
	'Opal',
	'Pale',
	'Pine',
	'Quiet',
	'Rain',
	'Rose',
	'Rust',
	'Saffron',
	'Sage',
	'Salt',
	'Shadow',
	'Silver',
	'Slate',
	'Soft',
	'Solar',
	'Still',
	'Stone',
	'Summer',
	'Tide',
	'Velvet',
	'Violet',
	'Willow',
	'Winter',
	'Wild',
	'Wren'
];
const NOUNS = [
	'Arbor',
	'Bay',
	'Bend',
	'Bluff',
	'Bridge',
	'Brook',
	'Canyon',
	'Cove',
	'Crest',
	'Crossing',
	'Dale',
	'Dunes',
	'Field',
	'Fjord',
	'Ford',
	'Gate',
	'Glade',
	'Glen',
	'Grove',
	'Harbour',
	'Haven',
	'Heath',
	'Hill',
	'Hollow',
	'Isle',
	'Knoll',
	'Lagoon',
	'Landing',
	'Lane',
	'Ledge',
	'Loft',
	'Marsh',
	'Mesa',
	'Mill',
	'Moor',
	'Nook',
	'Orchard',
	'Pass',
	'Peak',
	'Pier',
	'Point',
	'Pond',
	'Quay',
	'Reach',
	'Reef',
	'Ridge',
	'Rise',
	'Row',
	'Shore',
	'Spring',
	'Square',
	'Steps',
	'Strand',
	'Terrace',
	'Thicket',
	'Tower',
	'Trail',
	'Vale',
	'View',
	'Walk',
	'Well',
	'Wharf',
	'Woods',
	'Yard'
];

// FNV-1a — tiny, stable across platforms, good enough spread for word picks.
function hash(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

export function generatedName(lat: number, lon: number): string {
	const h = hash(`${lat.toFixed(3)},${lon.toFixed(3)}`);
	const adj = ADJECTIVES[h % ADJECTIVES.length];
	let noun = NOUNS[(h >>> 8) % NOUNS.length];
	if (noun === adj) noun = NOUNS[((h >>> 8) + 1) % NOUNS.length]; // no "Hollow Hollow"
	return `${adj} ${noun}`;
}
