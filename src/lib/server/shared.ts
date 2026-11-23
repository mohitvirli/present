import { error, type Cookies } from '@sveltejs/kit';
import { readSession } from './session';
import { supabaseAdmin, syncConfigured } from './supabase';
import { isEnvelope, type Envelope } from '$lib/crypto';

// Shared-entry route helpers. Every route resolves the user from the session
// cookie and checks membership in shared_members before touching an entry —
// the service-role client bypasses RLS, so these checks are the only guard.

export async function requireUser(cookies: Cookies): Promise<string> {
	if (!syncConfigured()) throw error(503, 'Sync is not configured.');
	const userId = await readSession(cookies);
	if (!userId) throw error(401, 'Not signed in to sync.');
	return userId;
}

export interface Membership {
	role: 'owner' | 'editor';
	epoch: number;
}

// 404, not 403, for entries you aren't in: don't confirm an id exists.
export async function requireMember(entryId: string, userId: string): Promise<Membership> {
	if (!isEntryId(entryId)) throw error(404, 'Not found.');
	const { data, error: dbErr } = await supabaseAdmin()
		.from('shared_members')
		.select('role, epoch, shared_entries!inner(deleted)')
		.eq('entry_id', entryId)
		.eq('user_id', userId)
		.maybeSingle();
	if (dbErr) {
		console.error('shared membership check failed', dbErr);
		throw error(502, 'Could not check access.');
	}
	const entry = data?.shared_entries as unknown as { deleted: boolean } | undefined;
	if (!data || entry?.deleted) throw error(404, 'Not found.');
	return { role: data.role, epoch: data.epoch };
}

export const isEntryId = (v: unknown): v is string =>
	typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v);

// An Envelope within a size budget, stripped to its known fields.
export function envelopeOrThrow(v: unknown, maxChars: number, what: string): Envelope {
	if (!isEnvelope(v) || typeof v.iv !== 'string' || typeof v.ct !== 'string') {
		throw error(400, `Bad ${what}.`);
	}
	if (v.iv.length + v.ct.length > maxChars) throw error(413, `${what} too large.`);
	return { enc: 1, iv: v.iv, ct: v.ct };
}

// Vercel caps request bodies at 4.5 MB; stay well under it.
export const MAX_SNAPSHOT_CHARS = 3_000_000;
export const MAX_UPDATE_CHARS = 500_000;
export const MAX_UPDATES_PER_PUSH = 200;
