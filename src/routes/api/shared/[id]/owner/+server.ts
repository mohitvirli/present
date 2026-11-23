import { error, json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase';
import { requireMember, requireUser } from '$lib/server/shared';

export const prerender = false;

// Owner hands ownership to another member and becomes an editor.
export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const userId = await requireUser(cookies);
	const id = params.id!;
	const { role } = await requireMember(id, userId);
	if (role !== 'owner') throw error(403, 'Only the owner can do this.');
	const body = (await request.json().catch(() => null)) as { userId?: unknown } | null;
	const next = body?.userId;
	if (typeof next !== 'string' || next === userId) throw error(400, 'Pick another member.');

	const admin = supabaseAdmin();
	const { data, error: promoteErr } = await admin
		.from('shared_members')
		.update({ role: 'owner' })
		.eq('entry_id', id)
		.eq('user_id', next)
		.select('user_id');
	if (promoteErr) {
		console.error('owner transfer failed', promoteErr);
		throw error(502, 'Could not change the owner.');
	}
	if (!data?.length) throw error(404, 'Not a member.');
	await admin
		.from('shared_members')
		.update({ role: 'editor' })
		.eq('entry_id', id)
		.eq('user_id', userId);
	await admin
		.from('shared_entries')
		.update({ owner_id: next, updated_at: new Date().toISOString() })
		.eq('id', id);
	return json({ ok: true });
};
