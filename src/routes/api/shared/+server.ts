import { error, json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase';
import { MAX_SNAPSHOT_CHARS, envelopeOrThrow, isEntryId, requireUser } from '$lib/server/shared';
import { isSealed, type Sealed } from '$lib/crypto';

export const prerender = false;

export interface SharedListItem {
	id: string;
	role: 'owner' | 'editor';
	wrappedKey: Sealed;
	epoch: number;
	ownerId: string;
	deleted: boolean;
	createdAt: string;
	updatedAt: string; // last update or snapshot — lets clients skip unchanged entries
	needsRotation: boolean; // someone left or was removed; the owner re-keys
}

type Row = {
	entry_id: string;
	role: 'owner' | 'editor';
	wrapped_key: Sealed;
	epoch: number;
	shared_entries: {
		owner_id: string;
		deleted: boolean;
		created_at: string;
		updated_at: string;
		needs_rotation: boolean;
	};
};

// Every shared entry you're a member of, with your sealed copy of its key.
// Content comes from /api/shared/[id]/updates.
export const GET: RequestHandler = async ({ cookies }) => {
	const userId = await requireUser(cookies);
	const { data, error: dbErr } = await supabaseAdmin()
		.from('shared_members')
		.select(
			'entry_id, role, wrapped_key, epoch, shared_entries!inner(owner_id, deleted, created_at, updated_at, needs_rotation)'
		)
		.eq('user_id', userId);
	if (dbErr) {
		console.error('shared list failed', dbErr);
		throw error(502, 'Could not list shared entries.');
	}
	const items: SharedListItem[] = ((data ?? []) as unknown as Row[]).map((r) => ({
		id: r.entry_id,
		role: r.role,
		wrappedKey: r.wrapped_key,
		epoch: r.epoch,
		ownerId: r.shared_entries.owner_id,
		deleted: r.shared_entries.deleted,
		createdAt: r.shared_entries.created_at,
		updatedAt: r.shared_entries.updated_at,
		needsRotation: !!r.shared_entries.needs_rotation
	}));
	return json(items);
};

// Create a shared entry: you become its owner. The client generated the id,
// the entry key (sealed to your own public key) and the first snapshot.
export const POST: RequestHandler = async ({ request, cookies }) => {
	const userId = await requireUser(cookies);
	const body = (await request.json().catch(() => null)) as {
		id?: unknown;
		wrappedKey?: unknown;
		snapshot?: unknown;
	} | null;
	if (!isEntryId(body?.id) || !isSealed(body?.wrappedKey)) throw error(400, 'Bad shared entry.');
	const snapshot = envelopeOrThrow(body.snapshot, MAX_SNAPSHOT_CHARS, 'snapshot');
	const { epk, iv, ct } = body.wrappedKey;
	const wrappedKey: Sealed = {
		seal: 1,
		epk: { kty: 'EC', crv: 'P-256', x: epk.x, y: epk.y },
		iv,
		ct
	};

	const admin = supabaseAdmin();
	const { error: entryErr } = await admin
		.from('shared_entries')
		.insert({ id: body.id, owner_id: userId, snapshot, snapshot_seq: 0 });
	if (entryErr) {
		if (entryErr.code === '23505') throw error(409, 'Already exists.');
		console.error('shared create failed', entryErr);
		throw error(502, 'Could not create shared entry.');
	}
	const { error: memberErr } = await admin
		.from('shared_members')
		.insert({ entry_id: body.id, user_id: userId, role: 'owner', wrapped_key: wrappedKey });
	if (memberErr) {
		console.error('shared owner insert failed', memberErr);
		await admin.from('shared_entries').delete().eq('id', body.id);
		throw error(502, 'Could not create shared entry.');
	}
	return json({ id: body.id }, { status: 201 });
};
