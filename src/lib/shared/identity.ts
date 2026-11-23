import {
	decryptJSON,
	encryptJSON,
	generateIdentity,
	importIdentityPrivate,
	type Envelope,
	type PublicJwk
} from '$lib/crypto';
import { loadIdentity, saveIdentity, type StoredIdentity } from '$lib/keystore';

// This user's identity key pair for shared entries. Restored silently from
// this device, else from the server copy (decrypted with the journal key),
// else generated and uploaded. The server never overwrites a stored pair, so
// two devices racing to create one both end up with the same keys.

type ServerKeys = { publicKey: PublicJwk; wrappedPrivateKey: Envelope };

let pending: Promise<StoredIdentity> | null = null;

export function ensureIdentity(journalKey: CryptoKey): Promise<StoredIdentity> {
	pending ??= resolveIdentity(journalKey).finally(() => (pending = null));
	return pending;
}

async function resolveIdentity(journalKey: CryptoKey): Promise<StoredIdentity> {
	const local = await loadIdentity();
	if (local) return local;

	const res = await fetch('/api/shared/keys');
	if (res.ok) return adopt(journalKey, (await res.json()) as ServerKeys);
	if (res.status !== 404) throw new Error(`Could not load identity keys (${res.status}).`);

	const { publicJwk, privateJwk } = await generateIdentity();
	const wrappedPrivateKey = await encryptJSON(journalKey, privateJwk);
	const put = await fetch('/api/shared/keys', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ publicKey: publicJwk, wrappedPrivateKey } satisfies ServerKeys)
	});
	if (put.status === 409) return adopt(journalKey, (await put.json()) as ServerKeys);
	if (!put.ok) throw new Error(`Could not store identity keys (${put.status}).`);

	const id: StoredIdentity = { privateKey: await importIdentityPrivate(privateJwk), publicJwk };
	await saveIdentity(id);
	return id;
}

async function adopt(journalKey: CryptoKey, keys: ServerKeys): Promise<StoredIdentity> {
	const privateJwk = await decryptJSON<JsonWebKey>(journalKey, keys.wrappedPrivateKey);
	const id: StoredIdentity = {
		privateKey: await importIdentityPrivate(privateJwk),
		publicJwk: keys.publicKey
	};
	await saveIdentity(id);
	return id;
}
