// End-to-end encryption for synced entries, keyed by the passkey's PRF output.
// The AES key never leaves memory and is never persisted; it's re-derived from
// the passkey (a user-verification ceremony) when needed.

// Stable salts/info — MUST NOT change, or keys become unreproducible and old
// ciphertext can't be decrypted.
export const PRF_SALT = new TextEncoder().encode('present:sync:prf:v1');
const HKDF_SALT = new TextEncoder().encode('present:sync:hkdf-salt:v1');
const HKDF_INFO = new TextEncoder().encode('present:sync:entry-key:v1');

export type Envelope = { enc: 1; iv: string; ct: string };

export function isEnvelope(v: unknown): v is Envelope {
	return !!v && typeof v === 'object' && (v as { enc?: unknown }).enc === 1;
}

function toB64(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}
function fromB64(s: string): Uint8Array {
	const bin = atob(s);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

// PRF output (ArrayBuffer or base64url string, depending on the browser) → key.
export async function deriveKey(prfFirst: ArrayBuffer | string): Promise<CryptoKey> {
	const raw =
		typeof prfFirst === 'string'
			? fromB64(prfFirst.replace(/-/g, '+').replace(/_/g, '/'))
			: new Uint8Array(prfFirst);
	const hkdf = await crypto.subtle.importKey('raw', raw as BufferSource, 'HKDF', false, [
		'deriveKey'
	]);
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
		hkdf,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export async function encryptJSON(key: CryptoKey, value: unknown): Promise<Envelope> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = new TextEncoder().encode(JSON.stringify(value));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
	return { enc: 1, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function decryptJSON<T>(key: CryptoKey, env: Envelope): Promise<T> {
	const iv = fromB64(env.iv);
	const ct = fromB64(env.ct);
	const buf = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource },
		key,
		ct as BufferSource
	);
	return JSON.parse(new TextDecoder().decode(buf)) as T;
}
