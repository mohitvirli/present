import { env } from '$env/dynamic/private';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/shared';

export const prerender = false;

export interface RealtimeConfig {
	url: string; // wss://<ref>.supabase.co/realtime/v1
	key: string; // the project's anon / publishable key — public by design
}

// Where to open live channels. Channels are public broadcast topics; access
// is cryptographic: a topic is derived from the entry key, and every message
// is AES-GCM sealed with it, so only members can find, read or write one.
export const GET: RequestHandler = async ({ cookies }) => {
	await requireUser(cookies);
	if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
		throw error(503, 'Live editing is not configured (SUPABASE_ANON_KEY).');
	}
	const url = env.SUPABASE_URL.replace(/^http/, 'ws').replace(/\/$/, '') + '/realtime/v1';
	return json({ url, key: env.SUPABASE_ANON_KEY } satisfies RealtimeConfig);
};
