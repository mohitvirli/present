import { error, json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase';
import {
	MAX_SNAPSHOT_CHARS,
	envelopeOrThrow,
	requireMember,
	requireUser
} from '$lib/server/shared';

export const prerender = false;

// Compaction: any member uploads the full Y state as of `seq` (the last update
// they applied). The server keeps it only if it's newer than the stored one
// and seq really exists, then drops the updates it folds in.
export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const userId = await requireUser(cookies);
	const id = params.id!;
	await requireMember(id, userId);
	const body = (await request.json().catch(() => null)) as {
		snapshot?: unknown;
		seq?: unknown;
	} | null;
	const seq = body?.seq;
	if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= 0) {
		throw error(400, 'Bad seq.');
	}
	const snapshot = envelopeOrThrow(body!.snapshot, MAX_SNAPSHOT_CHARS, 'snapshot');

	const admin = supabaseAdmin();
	const { data: hit, error: seqErr } = await admin
		.from('shared_updates')
		.select('seq')
		.eq('entry_id', id)
		.eq('seq', seq)
		.maybeSingle();
	if (seqErr) {
		console.error('shared snapshot seq check failed', seqErr);
		throw error(502, 'Could not store snapshot.');
	}
	if (!hit) return json({ stored: false });

	const { data, error: updErr } = await admin
		.from('shared_entries')
		.update({ snapshot, snapshot_seq: seq, updated_at: new Date().toISOString() })
		.eq('id', id)
		.lt('snapshot_seq', seq)
		.select('id');
	if (updErr) {
		console.error('shared snapshot write failed', updErr);
		throw error(502, 'Could not store snapshot.');
	}
	if (!data?.length) return json({ stored: false });

	await admin.from('shared_updates').delete().eq('entry_id', id).lte('seq', seq);
	return json({ stored: true });
};
