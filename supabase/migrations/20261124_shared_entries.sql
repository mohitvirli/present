-- Shared entries, Phase 2: storage. Run once in the Supabase SQL editor after
-- 20261123_user_keys.sql. Idempotent. Service-role only, like every table.
--
-- The server holds only ciphertext: a shared entry is a Yjs document whose
-- updates and snapshots are AES-GCM Envelopes under the entry's own key, and
-- that key reaches each member sealed to their identity public key.

create table if not exists public.shared_entries (
	id            text primary key,           -- client id (also the local Entry.id)
	owner_id      uuid not null,
	epoch         integer not null default 1, -- bumps when the key rotates (Phase 5)
	snapshot      jsonb,                      -- Envelope: full Y state as of snapshot_seq
	snapshot_seq  bigint not null default 0,  -- updates with seq <= this are folded in
	deleted       boolean not null default false,
	created_at    timestamptz not null default now(),
	updated_at    timestamptz not null default now()
);

create table if not exists public.shared_members (
	entry_id     text not null references public.shared_entries (id) on delete cascade,
	user_id      uuid not null,
	role         text not null check (role in ('owner', 'editor')),
	wrapped_key  jsonb not null,               -- Sealed entry key for this member
	epoch        integer not null default 1,
	joined_at    timestamptz not null default now(),
	primary key (entry_id, user_id)
);
create index if not exists shared_members_user_idx on public.shared_members (user_id);

-- Append-only log of encrypted Yjs updates. seq is global, so it orders one
-- entry's updates and works as a per-entry cursor.
create table if not exists public.shared_updates (
	seq         bigserial primary key,
	entry_id    text not null references public.shared_entries (id) on delete cascade,
	epoch       integer not null,
	envelope    jsonb not null,
	created_at  timestamptz not null default now()
);
create index if not exists shared_updates_entry_seq_idx on public.shared_updates (entry_id, seq);

alter table public.shared_entries enable row level security; -- no policy → service-role only
alter table public.shared_members enable row level security;
alter table public.shared_updates enable row level security;
