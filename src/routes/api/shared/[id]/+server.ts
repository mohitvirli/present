import { error, json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase';
import { requireMember, requireUser } from '$lib/server/shared';

export const prerender = false;

// Owner deletes the entry for everyone. Content goes (snapshot, updates,
// invites); the entry row and memberships stay, flagged deleted, so every
// member's next sync sees it and removes its copy.
export const DELETE: RequestHandler = async ({ params, cookies }) => {
	const userId = await requireUser(cookies);
	const id = params.id!;
	const { role } = await requireMember(id, userId);
	if (role !== 'owner') throw error(403, 'Only the owner can delete this for everyone.');

	const admin = supabaseAdmin();
	const { error: dbErr } = await admin
		.from('shared_entries')
		.update({
			deleted: true,
			snapshot: null,
			needs_rotation: false,
			updated_at: new Date().toISOString()
		})
		.eq('id', id);
	if (dbErr) {
		console.error('shared delete failed', dbErr);
		throw error(502, 'Could not delete.');
	}
	await admin.from('shared_updates').delete().eq('entry_id', id);
	await admin.from('shared_invites').delete().eq('entry_id', id);
	return json({ ok: true });
};
