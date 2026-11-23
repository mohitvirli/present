import { error, json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase';
import { envelopeOrThrow, isEntryId, requireMember, requireUser } from '$lib/server/shared';

export const prerender = false;

const TTL_DAYS = 7;
const MAX_OPEN_INVITES = 20; // per entry, so a loop can't fill the table

// Owner creates a single-use invite. The client generated the id, the secret
// (kept in the link's fragment), and everything here is derived from it.
export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const userId = await requireUser(cookies);
	const entryId = params.id!;
	const { role, epoch } = await requireMember(entryId, userId);
	if (role !== 'owner') throw error(403, 'Only the owner can invite.');

	const body = (await request.json().catch(() => null)) as {
		id?: unknown;
		sealedKey?: unknown;
		preview?: unknown;
		tokenHash?: unknown;
	} | null;
	if (!isEntryId(body?.id) || typeof body.tokenHash !== 'string' || body.tokenHash.length > 100) {
		throw error(400, 'Bad invite.');
	}
	const sealedKey = envelopeOrThrow(body.sealedKey, 1_000, 'key');
	const preview = envelopeOrThrow(body.preview, 4_000, 'preview');

	const admin = supabaseAdmin();
	const { count } = await admin
		.from('shared_invites')
		.select('id', { count: 'exact', head: true })
		.eq('entry_id', entryId)
		.is('used_at', null)
		.gt('expires_at', new Date().toISOString());
	if ((count ?? 0) >= MAX_OPEN_INVITES) throw error(429, 'Too many open invites.');

	const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000).toISOString();
	const { error: dbErr } = await admin.from('shared_invites').insert({
		id: body.id,
		entry_id: entryId,
		epoch,
		sealed_key: sealedKey,
		preview,
		token_hash: body.tokenHash,
		created_by: userId,
		expires_at: expiresAt
	});
	if (dbErr) {
		console.error('invite create failed', dbErr);
		throw error(502, 'Could not create invite.');
	}
	return json({ id: body.id, expiresAt }, { status: 201 });
};
