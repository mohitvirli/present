import { env } from '$env/dynamic/private';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role client — bypasses RLS, so EVERY query must filter by user_id.
// Never import this from client code (it lives under $lib/server).
let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
	if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
		throw new Error('Sync is not configured (missing SUPABASE_URL / SERVICE_ROLE_KEY).');
	}
	client ??= createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	return client;
}

export function syncConfigured(): boolean {
	return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SESSION_SECRET);
}
