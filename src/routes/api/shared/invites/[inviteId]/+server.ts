import { error, json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase';
import { isEntryId, requireUser } from '$lib/server/shared';
import { isSealed, type Envelope, type Sealed } from '$lib/crypto';

export const prerender = false;

export interface InviteView {
	entryId: string;
	sealedKey: Envelope;
	preview: Envelope;
	expiresAt: string;
	status: 'open' | 'used' | 'expired' | 'member';
}

async function sha256b64(s: string): Promise<string> {
	const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
	return btoa(String.fromCharCode(...new Uint8Array(d)));
}

// The token comes in a header, derived from the link's secret. A wrong token
// looks exactly like a missing invite.
async function loadInvite(inviteId: string | undefined, token: string | null) {
	if (!isEntryId(inviteId) || !token || token.length > 100) throw error(404, 'Invite not found.');
	const { data, error: dbErr } = await supabaseAdmin()
		.from('shared_invites')
		.select('entry_id, sealed_key, preview, token_hash, expires_at, used_at')
		.eq('id', inviteId)
		.maybeSingle();
	if (dbErr) {
		console.error('invite read failed', dbErr);
		throw error(502, 'Could not read invite.');
	}
	const tokenHash = await sha256b64(token);
	if (!data || data.token_hash !== tokenHash) throw error(404, 'Invite not found.');
	return { ...data, tokenHash };
}

// Read an invite (sign-in required) to show its preview before joining.
export const GET: RequestHandler = async ({ params, request, cookies }) => {
	const userId = await requireUser(cookies);
	const inv = await loadInvite(params.inviteId, request.headers.get('x-invite-token'));
	const { data: member } = await supabaseAdmin()
		.from('shared_members')
		.select('user_id')
		.eq('entry_id', inv.entry_id)
		.eq('user_id', userId)
		.maybeSingle();
	const view: InviteView = {
		entryId: inv.entry_id,
		sealedKey: inv.sealed_key,
		preview: inv.preview,
		expiresAt: inv.expires_at,
		status: member
			? 'member'
			: inv.used_at
				? 'used'
				: Date.parse(inv.expires_at) < Date.now()
					? 'expired'
					: 'open'
	};
	return json(view);
};

// Accept: join as an editor with the entry key sealed to your own identity.
export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const userId = await requireUser(cookies);
	const body = (await request.json().catch(() => null)) as {
		token?: unknown;
		wrappedKey?: unknown;
	} | null;
	const inv = await loadInvite(
		params.inviteId,
		typeof body?.token === 'string' ? body.token : null
	);
	if (!isSealed(body?.wrappedKey)) throw error(400, 'Bad key.');
	const { epk, iv, ct } = body.wrappedKey;
	const wrapped: Sealed = { seal: 1, epk: { kty: 'EC', crv: 'P-256', x: epk.x, y: epk.y }, iv, ct };

	const { data, error: dbErr } = await supabaseAdmin().rpc('shared_accept_invite', {
		p_invite_id: params.inviteId,
		p_token_hash: inv.tokenHash,
		p_user_id: userId,
		p_wrapped: wrapped
	});
	if (dbErr) {
		console.error('invite accept failed', dbErr);
		throw error(502, 'Could not join.');
	}
	if (!data) throw error(409, 'This invite is used, expired, or the entry is full.');
	return json({ entryId: data as string });
};
