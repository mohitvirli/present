import { env } from '$env/dynamic/private';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { setChallenge } from '$lib/server/session';
import { syncConfigured } from '$lib/server/supabase';

export const prerender = false;

// Usernameless passkey registration options. residentKey:'required' makes it a
// discoverable credential so other devices can sign in without an identifier.
export const POST: RequestHandler = async ({ cookies }) => {
	if (!syncConfigured()) throw error(503, 'Sync is not configured.');

	const options = await generateRegistrationOptions({
		rpName: env.WEBAUTHN_RP_NAME || 'Present',
		rpID: env.WEBAUTHN_RP_ID,
		userName: 'present',
		attestationType: 'none',
		authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }
	});

	await setChallenge(cookies, options.challenge);
	return json(options);
};
