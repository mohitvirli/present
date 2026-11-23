import { error, json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase';
import {
	MAX_UPDATES_PER_PUSH,
	MAX_UPDATE_CHARS,
	envelopeOrThrow,
	requireMember,
	requireUser
} from '$lib/server/shared';
import type { Envelope } from '$lib/crypto';

export const prerender = false;

const PAGE = 500;

export interface UpdatesPage {
	// set when `after` is older than the last compaction: apply this first
	snapshot: { envelope: Envelope; seq: number } | null;
	updates: { seq: number; envelope: Envelope }[];
	cursor: number; // pass back as `after`
	more: boolean;
}

// Encrypted updates after ?after=<seq>. A client that fell behind a
// compaction (or is new) also gets the snapshot those updates build on.
export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const userId = await requireUser(cookies);
	const id = params.id!;
	await requireMember(id, userId);
	const after = Number(url.searchParams.get('after') ?? '0');
	if (!Number.isSafeInteger(after) || after < 0) throw error(400, 'Bad cursor.');

	const admin = supabaseAdmin();
	const { data: entry, error: entryErr } = await admin
		.from('shared_entries')
		.select('snapshot, snapshot_seq')
		.eq('id', id)
		.single();
	if (entryErr) {
		console.error('shared snapshot read failed', entryErr);
		throw error(502, 'Could not read shared entry.');
	}

	const snapshotSeq = Number(entry.snapshot_seq);
	const behind = after < snapshotSeq || (after === 0 && entry.snapshot);
	const from = behind ? snapshotSeq : after;

	const { data, error: dbErr } = await admin
		.from('shared_updates')
		.select('seq, envelope')
		.eq('entry_id', id)
		.gt('seq', from)
		.order('seq')
		.limit(PAGE);
	if (dbErr) {
		console.error('shared updates read failed', dbErr);
		throw error(502, 'Could not read updates.');
	}

	const updates = (data ?? []).map((r) => ({ seq: Number(r.seq), envelope: r.envelope }));
	const page: UpdatesPage = {
		snapshot: behind && entry.snapshot ? { envelope: entry.snapshot, seq: snapshotSeq } : null,
		updates,
		cursor: updates.length ? updates[updates.length - 1].seq : from,
		more: updates.length === PAGE
	};
	return json(page);
};

// Append this member's encrypted updates. Returns their seqs in order.
export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const userId = await requireUser(cookies);
	const id = params.id!;
	const { epoch } = await requireMember(id, userId);
	const body = (await request.json().catch(() => null)) as { updates?: unknown } | null;
	if (!Array.isArray(body?.updates) || !body.updates.length) throw error(400, 'No updates.');
	if (body.updates.length > MAX_UPDATES_PER_PUSH) throw error(413, 'Too many updates.');
	const rows = body.updates.map((u) => ({
		entry_id: id,
		epoch,
		envelope: envelopeOrThrow(u, MAX_UPDATE_CHARS, 'update')
	}));

	const admin = supabaseAdmin();
	const { data, error: dbErr } = await admin.from('shared_updates').insert(rows).select('seq');
	if (dbErr) {
		console.error('shared updates insert failed', dbErr);
		throw error(502, 'Could not store updates.');
	}
	await admin.from('shared_entries').update({ updated_at: new Date().toISOString() }).eq('id', id);
	return json({ seqs: (data ?? []).map((r) => Number(r.seq)).sort((a, b) => a - b) });
};
