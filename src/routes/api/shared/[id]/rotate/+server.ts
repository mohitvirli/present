import { error, json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase';
import {
	MAX_SNAPSHOT_CHARS,
	envelopeOrThrow,
	requireMember,
	requireUser
} from '$lib/server/shared';
import { isSealed, type Sealed } from '$lib/crypto';

export const prerender = false;

// Owner moves the entry to a new key: { epoch, snapshot, keys: { userId: Sealed } }.
// shared_rotate checks ownership, the epoch, and that keys covers exactly the
// current members, all in one transaction.
export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const userId = await requireUser(cookies);
	const id = params.id!;
	const { role } = await requireMember(id, userId);
	if (role !== 'owner') throw error(403, 'Only the owner can rotate keys.');

	const body = (await request.json().catch(() => null)) as {
		epoch?: unknown;
		snapshot?: unknown;
		keys?: unknown;
	} | null;
	if (typeof body?.epoch !== 'number' || !Number.isSafeInteger(body.epoch)) {
		throw error(400, 'Bad epoch.');
	}
	const snapshot = envelopeOrThrow(body.snapshot, MAX_SNAPSHOT_CHARS, 'snapshot');
	const raw = body.keys;
	if (!raw || typeof raw !== 'object' || Object.keys(raw).length > 8) throw error(400, 'Bad keys.');
	const keys: Record<string, Sealed> = {};
	for (const [member, sealed] of Object.entries(raw)) {
		if (!isSealed(sealed)) throw error(400, 'Bad keys.');
		const { epk, iv, ct } = sealed;
		keys[member] = { seal: 1, epk: { kty: 'EC', crv: 'P-256', x: epk.x, y: epk.y }, iv, ct };
	}

	const { data, error: dbErr } = await supabaseAdmin().rpc('shared_rotate', {
		p_entry_id: id,
		p_owner_id: userId,
		p_epoch: body.epoch,
		p_snapshot: snapshot,
		p_keys: keys
	});
	if (dbErr) {
		console.error('shared rotate failed', dbErr);
		throw error(502, 'Could not rotate keys.');
	}
	if (data == null) throw error(409, 'Members or epoch changed; sync and try again.');
	return json({ epoch: body.epoch, snapshotSeq: Number(data) });
};
