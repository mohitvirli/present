import { env } from '$env/dynamic/private';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server';
import { mintSession, takeChallenge } from '$lib/server/session';
import { supabaseAdmin, syncConfigured } from '$lib/server/supabase';

export const prerender = false;

export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!syncConfigured()) throw error(503, 'Sync is not configured.');

	const body = (await request.json().catch(() => null)) as RegistrationResponseJSON | null;
	const expectedChallenge = await takeChallenge(cookies);
	if (!body || !expectedChallenge) throw error(400, 'Challenge missing or expired.');

	let verification;
	try {
		verification = await verifyRegistrationResponse({
			response: body,
			expectedChallenge,
			expectedOrigin: env.WEBAUTHN_ORIGIN,
			expectedRPID: env.WEBAUTHN_RP_ID
		});
	} catch (e) {
		console.error('register verify failed', e);
		throw error(400, 'Could not verify passkey.');
	}

	if (!verification.verified || !verification.registrationInfo) {
		throw error(400, 'Passkey not verified.');
	}

	const { credential } = verification.registrationInfo;
	const userId = crypto.randomUUID();

	const { error: dbErr } = await supabaseAdmin()
		.from('credentials')
		.insert({
			id: credential.id,
			user_id: userId,
			public_key: Buffer.from(credential.publicKey).toString('base64'),
			counter: credential.counter,
			transports: credential.transports ?? null
		});
	if (dbErr) {
		console.error('credential insert failed', dbErr);
		throw error(502, 'Could not save passkey.');
	}

	await mintSession(cookies, userId);
	return json({ ok: true });
};
