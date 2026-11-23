-- Shared entries, Phase 3: invites. Run once in the Supabase SQL editor after
-- 20261124_shared_entries.sql. Idempotent. Service-role only.
--
-- An invite link is /join/<id>#<secret>. The fragment never reaches the
-- server. From the secret the client derives (1) an AES key that decrypts
-- sealed_key (the entry key) and preview (title + inviter's name), and (2) a
-- token whose SHA-256 is token_hash — the server checks it on read and accept,
-- so knowing an invite id alone gets you nothing.

create table if not exists public.shared_invites (
	id           text primary key,
	entry_id     text not null references public.shared_entries (id) on delete cascade,
	epoch        integer not null,
	sealed_key   jsonb not null,   -- Envelope: the entry key under the secret-derived key
	preview      jsonb not null,   -- Envelope: { title, inviter } under the same key
	token_hash   text not null,    -- base64 SHA-256 of the secret-derived token
	created_by   uuid not null,
	created_at   timestamptz not null default now(),
	expires_at   timestamptz not null,
	used_by      uuid,
	used_at      timestamptz
);
create index if not exists shared_invites_entry_idx on public.shared_invites (entry_id);

alter table public.shared_invites enable row level security; -- no policy → service-role only

-- Accept atomically: the invite is unused and unexpired, the entry has room
-- (8 members), and the caller isn't already in it. Returns the entry id, or
-- null with no change when any check fails.
create or replace function public.shared_accept_invite(
	p_invite_id  text,
	p_token_hash text,
	p_user_id    uuid,
	p_wrapped    jsonb
)
returns text
language plpgsql
as $$
declare
	inv public.shared_invites%rowtype;
	members integer;
begin
	select * into inv from public.shared_invites
	where id = p_invite_id
	for update;
	if not found or inv.token_hash <> p_token_hash or inv.used_at is not null
		or inv.expires_at < now() then
		return null;
	end if;
	if exists (select 1 from public.shared_entries where id = inv.entry_id and deleted) then
		return null;
	end if;
	perform 1 from public.shared_entries where id = inv.entry_id for update;
	select count(*) into members from public.shared_members where entry_id = inv.entry_id;
	if members >= 8 then
		return null;
	end if;
	insert into public.shared_members (entry_id, user_id, role, wrapped_key, epoch)
	values (inv.entry_id, p_user_id, 'editor', p_wrapped, inv.epoch)
	on conflict (entry_id, user_id) do nothing;
	if not found then
		return null;
	end if;
	update public.shared_invites set used_by = p_user_id, used_at = now() where id = p_invite_id;
	update public.shared_entries set updated_at = now() where id = inv.entry_id;
	return inv.entry_id;
end;
$$;

revoke execute on function public.shared_accept_invite(text, text, uuid, jsonb)
	from public, anon, authenticated;
