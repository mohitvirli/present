import { env } from '$env/dynamic/private';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { setChallenge } from '$lib/server/session';
import { syncConfigured } from '$lib/server/supabase';

export const prerender = false;

// Usernameless authentication: allowCredentials:[] lets the OS offer any
// discoverable passkey for this RP; the verified response tells us the user.
export const POST: RequestHandler = async ({ cookies }) => {
	if (!syncConfigured()) throw error(503, 'Sync is not configured.');

	const options = await generateAuthenticationOptions({
		rpID: env.WEBAUTHN_RP_ID,
		allowCredentials: [],
		userVerification: 'preferred'
	});

	await setChallenge(cookies, options.challenge);
	return json(options);
};
