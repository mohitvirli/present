import { error, json, type RequestHandler } from '@sveltejs/kit';
import { readSession } from '$lib/server/session';
import { supabaseAdmin, syncConfigured } from '$lib/server/supabase';
import { isEnvelope, isPublicJwk, type Envelope, type PublicJwk } from '$lib/crypto';

export const prerender = false;

export interface IdentityKeys {
	publicKey: PublicJwk;
	wrappedPrivateKey: Envelope; // under the caller's journal key — opaque here
}

// Keep a malformed client from parking megabytes in the row.
const MAX_ENVELOPE_CHARS = 4_000;

async function userOrThrow(cookies: Parameters<RequestHandler>[0]['cookies']): Promise<string> {
	if (!syncConfigured()) throw error(503, 'Sync is not configured.');
	const userId = await readSession(cookies);
	if (!userId) throw error(401, 'Not signed in to sync.');
	return userId;
}

async function readKeys(userId: string): Promise<IdentityKeys | null> {
	const { data, error: dbErr } = await supabaseAdmin()
		.from('user_keys')
		.select('public_key, wrapped_private_key')
		.eq('user_id', userId)
		.maybeSingle();
	if (dbErr) {
		console.error('user_keys read failed', dbErr);
		throw error(502, 'Could not read keys.');
	}
	return data ? { publicKey: data.public_key, wrappedPrivateKey: data.wrapped_private_key } : null;
}

// This user's own key pair (public + encrypted private), or 404 if none yet.
export const GET: RequestHandler = async ({ cookies }) => {
	const userId = await userOrThrow(cookies);
	const keys = await readKeys(userId);
	if (!keys) throw error(404, 'No identity keys yet.');
	return json(keys);
};

// Store this user's key pair once. Never overwrites: if another device got
// there first, answers 409 with the stored pair so the caller adopts it.
// Replacing a key would orphan every shared-entry key sealed to the old one.
export const POST: RequestHandler = async ({ request, cookies }) => {
	const userId = await userOrThrow(cookies);
	const body = (await request.json().catch(() => null)) as Partial<IdentityKeys> | null;
	if (
		!isPublicJwk(body?.publicKey) ||
		!isEnvelope(body?.wrappedPrivateKey) ||
		JSON.stringify(body.wrappedPrivateKey).length > MAX_ENVELOPE_CHARS
	) {
		throw error(400, 'Bad key pair.');
	}

	const publicKey: PublicJwk = {
		kty: 'EC',
		crv: 'P-256',
		x: body.publicKey.x,
		y: body.publicKey.y
	};
	const { enc, iv, ct } = body.wrappedPrivateKey;

	const { data, error: dbErr } = await supabaseAdmin()
		.from('user_keys')
		.upsert(
			{ user_id: userId, public_key: publicKey, wrapped_private_key: { enc, iv, ct } },
			{ onConflict: 'user_id', ignoreDuplicates: true }
		)
		.select('user_id');
	if (dbErr) {
		console.error('user_keys insert failed', dbErr);
		throw error(502, 'Could not store keys.');
	}
	if (!data?.length) {
		const existing = await readKeys(userId);
		return json(existing, { status: 409 });
	}
	return json({ publicKey, wrappedPrivateKey: { enc, iv, ct } } satisfies IdentityKeys, {
		status: 201
	});
};
