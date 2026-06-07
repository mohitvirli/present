import { error, json, type RequestHandler } from '@sveltejs/kit';
import { clearSession, readSession } from '$lib/server/session';
import { supabaseAdmin, syncConfigured } from '$lib/server/supabase';

export const prerender = false;

// Permanently delete this sync account: all entries, all registered passkeys,
// and the active session. Idempotent — a 401 means the caller is already
// signed out, which is also a fine end state.
export const DELETE: RequestHandler = async ({ cookies }) => {
	if (!syncConfigured()) throw error(503, 'Sync is not configured.');

	const userId = await readSession(cookies);
	if (!userId) throw error(401, 'Not signed in.');

	const admin = supabaseAdmin();

	const { error: entriesErr } = await admin.from('entries').delete().eq('user_id', userId);
	if (entriesErr) {
		console.error('entries delete failed', entriesErr);
		throw error(502, 'Could not delete sync data.');
	}

	const { error: credsErr } = await admin.from('credentials').delete().eq('user_id', userId);
	if (credsErr) {
		console.error('credentials delete failed', credsErr);
		throw error(502, 'Could not delete passkeys.');
	}

	clearSession(cookies);
	return json({ ok: true });
};
