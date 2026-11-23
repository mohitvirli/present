import {
	decryptBytes,
	decryptJSON,
	encryptBytes,
	encryptJSON,
	sealTo,
	type PublicJwk
} from '$lib/crypto';
import { entryKeyBytes } from './store';
import type { InviteView } from '../../routes/api/shared/invites/[inviteId]/+server';

// Invite links: /join/<inviteId>#<secret>. The secret (32 random bytes) never
// reaches the server. HKDF turns it into an AES key, which encrypts the entry
// key and a small preview, and into a token the server stores only as a hash
// — proof the caller holds the link, checked on read and on accept.

const INVITE_SALT = new TextEncoder().encode('present:shared:invite-salt:v1');
const NAME_KEY = 'present:shared-name';

export interface InvitePreview {
	title?: string;
	inviter: string;
}

function b64url(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function deriveFromSecret(secret: Uint8Array) {
	const base = await crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, [
		'deriveKey',
		'deriveBits'
	]);
	const hkdf = (info: string) => ({
		name: 'HKDF',
		hash: 'SHA-256',
		salt: INVITE_SALT,
		info: new TextEncoder().encode(info)
	});
	const key = await crypto.subtle.deriveKey(
		hkdf('present:shared:invite-key:v1'),
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
	const tokenBits = await crypto.subtle.deriveBits(
		hkdf('present:shared:invite-token:v1'),
		base,
		256
	);
	const token = b64url(new Uint8Array(tokenBits));
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return { key, token, tokenHash: btoa(String.fromCharCode(...new Uint8Array(hash))) };
}

// Owner: make a single-use link for this entry.
export async function createInvite(entryId: string, preview: InvitePreview): Promise<string> {
	const secret = crypto.getRandomValues(new Uint8Array(32));
	const { key, tokenHash } = await deriveFromSecret(secret);
	const { raw } = await entryKeyBytes(entryId);
	const sealedKey = await encryptBytes(key, raw);
	raw.fill(0);
	const id = crypto.randomUUID();
	const res = await fetch(`/api/shared/${entryId}/invites`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			id,
			sealedKey,
			preview: await encryptJSON(key, preview),
			tokenHash
		})
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { message?: string };
		throw new Error(body.message || `Could not create invite (${res.status}).`);
	}
	return `${location.origin}/join/${id}#${b64url(secret)}`;
}

export interface OpenedInvite {
	entryId: string;
	status: InviteView['status'];
	expiresAt: string;
	preview: InvitePreview;
	accept: (publicJwk: PublicJwk) => Promise<string>; // → entry id
}

// Invitee: read the invite behind a link (needs a sync session).
export async function openInvite(inviteId: string, secretB64: string): Promise<OpenedInvite> {
	let secret: Uint8Array;
	try {
		secret = fromB64url(secretB64);
	} catch {
		throw new Error('This invite link is incomplete.');
	}
	if (secret.length !== 32) throw new Error('This invite link is incomplete.');
	const { key, token } = await deriveFromSecret(secret);
	const res = await fetch(`/api/shared/invites/${inviteId}`, {
		headers: { 'x-invite-token': token }
	});
	if (res.status === 404) throw new Error('This invite doesn’t exist or the link is incomplete.');
	if (res.status === 401) throw new Error('Sign in to sync to join.');
	if (!res.ok) throw new Error(`Could not open invite (${res.status}).`);
	const view = (await res.json()) as InviteView;
	const preview = await decryptJSON<InvitePreview>(key, view.preview);

	return {
		entryId: view.entryId,
		status: view.status,
		expiresAt: view.expiresAt,
		preview,
		accept: async (publicJwk) => {
			const raw = await decryptBytes(key, view.sealedKey);
			const wrappedKey = await sealTo(publicJwk, raw);
			raw.fill(0);
			const r = await fetch(`/api/shared/invites/${inviteId}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ token, wrappedKey })
			});
			if (!r.ok) {
				const body = (await r.json().catch(() => ({}))) as { message?: string };
				throw new Error(body.message || `Could not join (${r.status}).`);
			}
			return ((await r.json()) as { entryId: string }).entryId;
		}
	};
}

// The name last used in any shared entry, to prefill the next one.
export function lastName(): string {
	try {
		return localStorage.getItem(NAME_KEY) ?? '';
	} catch {
		return '';
	}
}

export function rememberName(name: string): void {
	try {
		localStorage.setItem(NAME_KEY, name);
	} catch {
		/* private mode — just no prefill next time */
	}
}
