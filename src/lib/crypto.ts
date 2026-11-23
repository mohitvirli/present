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

// ----- Identity keys (shared entries) -----
// Each user has one ECDH P-256 key pair. The public half is on the server so
// others can seal keys to you; the private half is stored on the server only
// as an Envelope under your journal key, and on-device as a non-extractable
// CryptoKey. sealTo/openSealed are ECIES: an ephemeral ECDH exchange, HKDF,
// then AES-GCM. Shared entries' keys travel this way (wrapped per member).

const SEAL_SALT = new TextEncoder().encode('present:shared:seal-salt:v1');
const SEAL_INFO = new TextEncoder().encode('present:shared:seal:v1');
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

export type PublicJwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string };
export type Sealed = { seal: 1; epk: PublicJwk; iv: string; ct: string };

export function isPublicJwk(v: unknown): v is PublicJwk {
	const j = v as Partial<PublicJwk> & { d?: unknown };
	return (
		!!j &&
		typeof j === 'object' &&
		j.kty === 'EC' &&
		j.crv === 'P-256' &&
		typeof j.x === 'string' &&
		typeof j.y === 'string' &&
		j.d === undefined // never a private key
	);
}

export function isSealed(v: unknown): v is Sealed {
	const s = v as Partial<Sealed>;
	return !!s && typeof s === 'object' && s.seal === 1 && isPublicJwk(s.epk);
}

function publicOnly(jwk: JsonWebKey): PublicJwk {
	return { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! };
}

// A fresh key pair. Returns the private key as a JWK so it can be encrypted
// for the server copy; the caller re-imports it non-extractable for local use.
export async function generateIdentity(): Promise<{
	publicJwk: PublicJwk;
	privateJwk: JsonWebKey;
}> {
	const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
	const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
	const publicJwk = publicOnly(await crypto.subtle.exportKey('jwk', pair.publicKey));
	return { publicJwk, privateJwk };
}

export function importIdentityPrivate(jwk: JsonWebKey): Promise<CryptoKey> {
	return crypto.subtle.importKey('jwk', jwk, ECDH, false, ['deriveBits']);
}

export function importIdentityPublic(jwk: PublicJwk): Promise<CryptoKey> {
	return crypto.subtle.importKey('jwk', jwk, ECDH, true, []);
}

async function sealKey(priv: CryptoKey, pub: CryptoKey, usage: KeyUsage): Promise<CryptoKey> {
	const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
	const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: SEAL_SALT, info: SEAL_INFO },
		hkdf,
		{ name: 'AES-GCM', length: 256 },
		false,
		[usage]
	);
}

// Encrypt bytes so only the holder of `recipient`'s private key can read them.
export async function sealTo(recipient: PublicJwk, data: Uint8Array): Promise<Sealed> {
	const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
	const key = await sealKey(eph.privateKey, await importIdentityPublic(recipient), 'encrypt');
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as BufferSource);
	const epk = publicOnly(await crypto.subtle.exportKey('jwk', eph.publicKey));
	return { seal: 1, epk, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function openSealed(privateKey: CryptoKey, sealed: Sealed): Promise<Uint8Array> {
	const key = await sealKey(privateKey, await importIdentityPublic(sealed.epk), 'decrypt');
	const buf = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: fromB64(sealed.iv) as BufferSource },
		key,
		fromB64(sealed.ct) as BufferSource
	);
	return new Uint8Array(buf);
}

// ----- Entry keys (shared entries) -----
// One random AES-GCM key per shared entry. Members hold it sealed to their
// identity key; on-device it's a non-extractable CryptoKey. Yjs updates are
// binary, so these encrypt bytes into the same Envelope shape as journal data.

export function newEntryKeyBytes(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(32));
}

export function importEntryKey(raw: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
		'encrypt',
		'decrypt'
	]);
}

export async function encryptBytes(key: CryptoKey, data: Uint8Array): Promise<Envelope> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as BufferSource);
	return { enc: 1, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function decryptBytes(key: CryptoKey, env: Envelope): Promise<Uint8Array> {
	const buf = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: fromB64(env.iv) as BufferSource },
		key,
		fromB64(env.ct) as BufferSource
	);
	return new Uint8Array(buf);
}

// A shared entry's live channel name, derived from its key (and epoch, so a
// rotated key moves everyone to a new channel). Only key holders can compute it.
const TOPIC_SALT = new TextEncoder().encode('present:shared:topic-salt:v1');

export async function entryTopic(raw: Uint8Array, epoch: number): Promise<string> {
	const base = await crypto.subtle.importKey('raw', raw as BufferSource, 'HKDF', false, [
		'deriveBits'
	]);
	const bits = await crypto.subtle.deriveBits(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: TOPIC_SALT,
			info: new TextEncoder().encode(`present:shared:topic:v1:${epoch}`)
		},
		base,
		128
	);
	return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
