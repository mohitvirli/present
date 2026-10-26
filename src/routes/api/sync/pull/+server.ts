import { error, json, type RequestHandler } from '@sveltejs/kit';
import { readSession } from '$lib/server/session';
import { supabaseAdmin, syncConfigured } from '$lib/server/supabase';
import type { Entry } from '$lib/db';

export const prerender = false;

// Rows per query. Stays under PostgREST's 1000-row response cap.
const PAGE_ROWS = 500;
// Trim a page past this many JSON bytes so the response stays well under
// Vercel's 4.5 MB function body limit, however long the entries are.
const PAGE_BYTES = 2_500_000;
const EPOCH = '1970-01-01T00:00:00Z';

export interface SyncCursor {
	ts: string; // synced_at, verbatim — keeps Postgres' microseconds
	id: string;
}

export interface PullPage {
	entries: Entry[];
	cursor: SyncCursor | null; // last row returned; null when the page is empty
	more: boolean;
}

type Row = {
	id: string;
	content: Entry['content'];
	metadata: Entry['metadata'] | null;
	created_at: string;
	updated_at: string;
	touched_at: string;
	deleted: boolean;
	synced_at: string;
};

// One page of this user's rows stored after the `?ts=&id=` cursor, in the order
// the server stored them. The cursor is server time, so it can't skip a row
// whose client clock is older than another device's last pull.
export const GET: RequestHandler = async ({ url, cookies }) => {
	if (!syncConfigured()) throw error(503, 'Sync is not configured.');
	const userId = await readSession(cookies);
	if (!userId) throw error(401, 'Not signed in to sync.');

	const afterTs = url.searchParams.get('ts') || EPOCH;
	const afterId = url.searchParams.get('id') ?? '';
	if (Number.isNaN(Date.parse(afterTs))) throw error(400, 'Bad cursor.');

	const { data, error: dbErr } = await supabaseAdmin().rpc('sync_pull_entries', {
		p_user_id: userId,
		p_after_ts: afterTs,
		p_after_id: afterId,
		p_limit: PAGE_ROWS
	});
	if (dbErr) {
		console.error('sync pull failed', dbErr);
		throw error(502, 'Could not pull entries.');
	}

	const rows = (data ?? []) as Row[];
	const entries: Entry[] = [];
	let cursor: SyncCursor | null = null;
	let bytes = 0;
	let trimmed = false;
	for (const r of rows) {
		const entry: Entry = {
			id: r.id,
			content: r.content,
			metadata: r.metadata ?? {},
			createdAt: Date.parse(r.created_at),
			updatedAt: Date.parse(r.updated_at),
			touchedAt: Date.parse(r.touched_at),
			deleted: !!r.deleted
		};
		bytes += JSON.stringify(entry).length;
		// always return at least one row, or one huge entry would stall the cursor
		if (entries.length && bytes > PAGE_BYTES) {
			trimmed = true;
			break;
		}
		entries.push(entry);
		cursor = { ts: r.synced_at, id: r.id };
	}

	const page: PullPage = { entries, cursor, more: trimmed || rows.length === PAGE_ROWS };
	return json(page);
};
