-- Private Sync schema. Run once in the Supabase SQL editor.
-- RLS is enabled with NO policies, so only the service role (server) can touch
-- these tables — the SvelteKit /api/sync routes scope every query by user_id.

create table if not exists public.credentials (
	id           text primary key,        -- base64url credential ID
	user_id      uuid not null,
	public_key   text not null,           -- base64-encoded credential public key
	counter      bigint not null default 0,
	transports   text[],
	created_at   timestamptz not null default now()
);
create index if not exists credentials_user_id_idx on public.credentials (user_id);

create table if not exists public.entries (
	user_id     uuid not null,
	id          text not null,            -- client entry id (Entry.id)
	content     jsonb not null,           -- E2E envelope when the passkey has PRF
	metadata    jsonb not null default '{}',
	created_at  timestamptz not null,
	updated_at  timestamptz not null,     -- last content edit (client clock)
	touched_at  timestamptz,              -- last write of any kind — the LWW clock
	deleted     boolean not null default false,
	synced_at   timestamptz not null default now(), -- server write time — pull cursor
	primary key (user_id, id)
);
create index if not exists entries_user_synced_idx on public.entries (user_id, synced_at, id);

alter table public.credentials enable row level security; -- no policy → service-role only
alter table public.entries     enable row level security; -- no policy → service-role only

-- Functions: run supabase/migrations/20261026_sync_cursor.sql after this file.
-- sync_push_entries is the guarded bulk upsert (last-write-wins on touched_at,
-- server-side, so a stale device can't resurrect a row another device
-- tombstoned); sync_pull_entries pages rows by the (synced_at, id) cursor.
