import { error, json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase';
import { requireMember, requireUser } from '$lib/server/shared';

export const prerender = false;

// Leave (yourself, as an editor) or remove someone (as the owner). Either way
// the entry is flagged for a new key, which the owner's client rotates in.
// The owner can't leave: they hand ownership to someone first.
export const DELETE: RequestHandler = async ({ params, cookies }) => {
	const userId = await requireUser(cookies);
	const id = params.id!;
	const target = params.userId!;
	const { role } = await requireMember(id, userId);
	const self = target === userId;
	if (self && role === 'owner') throw error(409, 'Make someone else the owner before leaving.');
	if (!self && role !== 'owner') throw error(403, 'Only the owner can remove people.');

	const admin = supabaseAdmin();
	const { data, error: dbErr } = await admin
		.from('shared_members')
		.delete()
		.eq('entry_id', id)
		.eq('user_id', target)
		.eq('role', 'editor')
		.select('user_id');
	if (dbErr) {
		console.error('member remove failed', dbErr);
		throw error(502, 'Could not remove.');
	}
	if (!data?.length) throw error(404, 'Not a member.');
	await admin
		.from('shared_entries')
		.update({ needs_rotation: true, updated_at: new Date().toISOString() })
		.eq('id', id);
	return json({ ok: true });
};
