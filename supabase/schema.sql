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
	content     jsonb not null,           -- Phase 4: switches to text ciphertext
	metadata    jsonb not null default '{}',
	created_at  timestamptz not null,
	updated_at  timestamptz not null,
	deleted     boolean not null default false,
	primary key (user_id, id)
);
create index if not exists entries_user_updated_idx on public.entries (user_id, updated_at);

alter table public.credentials enable row level security; -- no policy → service-role only
alter table public.entries     enable row level security; -- no policy → service-role only

-- Guarded bulk upsert: apply each incoming row ONLY when it is newer than the
-- stored one (last-write-wins by updated_at). Without this guard, a device that
-- still holds a stale copy would clobber a newer row on push — e.g. resurrecting
-- an entry another device just tombstoned. push() sends the full local set every
-- sync, so the guard must live server-side.
create or replace function public.sync_push_entries(p_user_id uuid, p_entries jsonb)
returns integer
language plpgsql
as $$
declare
	affected integer;
begin
	insert into public.entries (user_id, id, content, metadata, created_at, updated_at, deleted)
	select
		p_user_id,
		e->>'id',
		e->'content',
		coalesce(e->'metadata', '{}'::jsonb),
		(e->>'created_at')::timestamptz,
		(e->>'updated_at')::timestamptz,
		coalesce((e->>'deleted')::boolean, false)
	from jsonb_array_elements(p_entries) as e
	on conflict (user_id, id) do update
		set content    = excluded.content,
		    metadata   = excluded.metadata,
		    updated_at = excluded.updated_at,
		    deleted    = excluded.deleted
		where excluded.updated_at > public.entries.updated_at;
	get diagnostics affected = row_count;
	return affected;
end;
$$;
