import { error, json, type RequestHandler } from '@sveltejs/kit';
import { readSession } from '$lib/server/session';
import { supabaseAdmin, syncConfigured } from '$lib/server/supabase';
import type { Entry } from '$lib/db';

export const prerender = false;

// Return this user's entries changed since `?since=<ms>` (0 = full pull).
export const GET: RequestHandler = async ({ url, cookies }) => {
	if (!syncConfigured()) throw error(503, 'Sync is not configured.');
	const userId = await readSession(cookies);
	if (!userId) throw error(401, 'Not signed in to sync.');

	const since = Number(url.searchParams.get('since') ?? '0') || 0;

	const { data, error: dbErr } = await supabaseAdmin()
		.from('entries')
		.select('id, content, metadata, created_at, updated_at, deleted')
		.eq('user_id', userId)
		.gt('updated_at', new Date(since).toISOString())
		.order('updated_at', { ascending: true });
	if (dbErr) {
		console.error('sync pull failed', dbErr);
		throw error(502, 'Could not pull entries.');
	}

	const entries: Entry[] = (data ?? []).map((r) => ({
		id: r.id,
		content: r.content,
		metadata: r.metadata ?? {},
		createdAt: Date.parse(r.created_at),
		updatedAt: Date.parse(r.updated_at),
		deleted: !!r.deleted
	}));

	const serverNow = Date.now();
	return json({ entries, serverNow });
};
