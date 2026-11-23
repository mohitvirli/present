import { error, json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase';
import { requireMember, requireUser } from '$lib/server/shared';
import type { PublicJwk } from '$lib/crypto';

export const prerender = false;

export interface MembersResponse {
	me: string;
	epoch: number;
	members: {
		userId: string;
		role: 'owner' | 'editor';
		joinedAt: string;
		publicKey: PublicJwk | null; // to seal a rotated key to them
	}[];
}

// Who is in this entry. Names aren't here: they live encrypted in the doc,
// keyed by these user ids.
export const GET: RequestHandler = async ({ params, cookies }) => {
	const userId = await requireUser(cookies);
	const entryId = params.id!;
	const { epoch } = await requireMember(entryId, userId);
	const { data, error: dbErr } = await supabaseAdmin()
		.from('shared_members')
		.select('user_id, role, joined_at')
		.eq('entry_id', entryId)
		.order('joined_at');
	if (dbErr) {
		console.error('members read failed', dbErr);
		throw error(502, 'Could not read members.');
	}
	const rows = data ?? [];
	const { data: keys } = rows.length
		? await supabaseAdmin()
				.from('user_keys')
				.select('user_id, public_key')
				.in(
					'user_id',
					rows.map((m) => m.user_id)
				)
		: { data: [] };
	const pub = new Map((keys ?? []).map((k) => [k.user_id as string, k.public_key as PublicJwk]));
	const res: MembersResponse = {
		me: userId,
		epoch,
		members: rows.map((m) => ({
			userId: m.user_id,
			role: m.role,
			joinedAt: m.joined_at,
			publicKey: pub.get(m.user_id) ?? null
		}))
	};
	return json(res);
};
