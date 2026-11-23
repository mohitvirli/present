import { error, json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase';
import { requireMember, requireUser } from '$lib/server/shared';

export const prerender = false;

export interface MembersResponse {
	me: string;
	members: { userId: string; role: 'owner' | 'editor'; joinedAt: string }[];
}

// Who is in this entry. Names aren't here: they live encrypted in the doc,
// keyed by these user ids.
export const GET: RequestHandler = async ({ params, cookies }) => {
	const userId = await requireUser(cookies);
	const entryId = params.id!;
	await requireMember(entryId, userId);
	const { data, error: dbErr } = await supabaseAdmin()
		.from('shared_members')
		.select('user_id, role, joined_at')
		.eq('entry_id', entryId)
		.order('joined_at');
	if (dbErr) {
		console.error('members read failed', dbErr);
		throw error(502, 'Could not read members.');
	}
	const res: MembersResponse = {
		me: userId,
		members: (data ?? []).map((m) => ({
			userId: m.user_id,
			role: m.role,
			joinedAt: m.joined_at
		}))
	};
	return json(res);
};
