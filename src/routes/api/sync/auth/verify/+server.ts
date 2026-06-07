import { env } from '$env/dynamic/private';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import {
	verifyAuthenticationResponse,
	type AuthenticationResponseJSON
} from '@simplewebauthn/server';
import { mintSession, takeChallenge } from '$lib/server/session';
import { supabaseAdmin, syncConfigured } from '$lib/server/supabase';

export const prerender = false;

export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!syncConfigured()) throw error(503, 'Sync is not configured.');

	const body = (await request.json().catch(() => null)) as AuthenticationResponseJSON | null;
	const expectedChallenge = await takeChallenge(cookies);
	if (!body || !expectedChallenge) throw error(400, 'Challenge missing or expired.');

	const { data: cred, error: lookupErr } = await supabaseAdmin()
		.from('credentials')
		.select('*')
		.eq('id', body.id)
		.maybeSingle();
	if (lookupErr) {
		console.error('credential lookup failed', lookupErr);
		throw error(502, 'Sync lookup failed.');
	}
	if (!cred) throw error(404, 'This passkey is not registered for sync.');

	let verification;
	try {
		verification = await verifyAuthenticationResponse({
			response: body,
			expectedChallenge,
			expectedOrigin: env.WEBAUTHN_ORIGIN,
			expectedRPID: env.WEBAUTHN_RP_ID,
			credential: {
				id: cred.id,
				publicKey: new Uint8Array(Buffer.from(cred.public_key, 'base64')),
				counter: Number(cred.counter),
				transports: cred.transports ?? undefined
			}
		});
	} catch (e) {
		console.error('auth verify failed', e);
		throw error(400, 'Could not verify passkey.');
	}

	if (!verification.verified) throw error(400, 'Passkey not verified.');

	await supabaseAdmin()
		.from('credentials')
		.update({ counter: verification.authenticationInfo.newCounter })
		.eq('id', cred.id);

	await mintSession(cookies, cred.user_id);
	return json({ ok: true });
};
