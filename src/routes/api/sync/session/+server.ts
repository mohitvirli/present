import { json, type RequestHandler } from '@sveltejs/kit';
import { clearSession, readSession } from '$lib/server/session';
import { syncConfigured } from '$lib/server/supabase';

export const prerender = false;

// Is there an active sync session?
export const GET: RequestHandler = async ({ cookies }) => {
	if (!syncConfigured()) return json({ signedIn: false, configured: false });
	const userId = await readSession(cookies);
	return json({ signedIn: !!userId, configured: true });
};

// Sign out / turn off sync.
export const DELETE: RequestHandler = async ({ cookies }) => {
	clearSession(cookies);
	return json({ ok: true });
};
