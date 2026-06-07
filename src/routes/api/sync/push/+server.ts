import { error, json, type RequestHandler } from '@sveltejs/kit';
import { readSession } from '$lib/server/session';
import { supabaseAdmin, syncConfigured } from '$lib/server/supabase';
import type { Entry } from '$lib/db';

export const prerender = false;

// Upsert local entries (incl. tombstones) for the signed-in user. user_id comes
// from the verified session cookie — never from the request body.
export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!syncConfigured()) throw error(503, 'Sync is not configured.');
	const userId = await readSession(cookies);
	if (!userId) throw error(401, 'Not signed in to sync.');

	const body = (await request.json().catch(() => null)) as { entries?: Entry[] } | null;
	const entries = body?.entries ?? [];
	if (!entries.length) return json({ ok: true, pushed: 0 });

	const rows = entries.map((e) => ({
		user_id: userId,
		id: e.id,
		content: e.content,
		metadata: e.metadata ?? {},
		created_at: new Date(e.createdAt).toISOString(),
		updated_at: new Date(e.updatedAt).toISOString(),
		deleted: !!e.deleted
	}));

	const { error: dbErr } = await supabaseAdmin()
		.from('entries')
		.upsert(rows, { onConflict: 'user_id,id' });
	if (dbErr) {
		console.error('sync push failed', dbErr);
		throw error(502, 'Could not push entries.');
	}

	return json({ ok: true, pushed: rows.length });
};
