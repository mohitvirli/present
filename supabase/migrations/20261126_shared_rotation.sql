-- Shared entries, Phase 5: leaving, removal, ownership and key rotation. Run
-- once in the Supabase SQL editor after 20261125_shared_invites.sql. Idempotent.
--
-- Leaving or being removed deletes the membership and flags the entry
-- needs_rotation. The owner's client then rotates: a fresh entry key sealed to
-- each remaining member, and a snapshot of the whole doc under it. Updates
-- encrypted with the old key are folded into that snapshot and dropped, open
-- invites (which carry the old key) are revoked, and the live channel moves
-- because its topic is derived from the key and epoch.

alter table public.shared_entries
	add column if not exists needs_rotation boolean not null default false;

-- Atomic rotation by the owner. p_keys maps every remaining member's user id
-- to the new key sealed for them — exactly the current members, no more, no
-- fewer. Returns the new snapshot_seq, or null with no change on any mismatch
-- (not owner, wrong epoch, key set doesn't match the members).
create or replace function public.shared_rotate(
	p_entry_id  text,
	p_owner_id  uuid,
	p_epoch     integer,
	p_snapshot  jsonb,
	p_keys      jsonb
)
returns bigint
language plpgsql
as $$
declare
	e public.shared_entries%rowtype;
	member_ids text[];
	key_ids text[];
	new_seq bigint;
begin
	select * into e from public.shared_entries where id = p_entry_id for update;
	if not found or e.deleted or e.owner_id <> p_owner_id or p_epoch <> e.epoch + 1 then
		return null;
	end if;

	select coalesce(array_agg(user_id::text order by user_id::text), '{}')
		into member_ids from public.shared_members where entry_id = p_entry_id;
	select coalesce(array_agg(k order by k), '{}')
		into key_ids from jsonb_object_keys(p_keys) as k;
	if member_ids <> key_ids then
		return null;
	end if;

	select coalesce(max(seq), e.snapshot_seq) into new_seq
		from public.shared_updates where entry_id = p_entry_id;

	update public.shared_members m
		set wrapped_key = p_keys -> m.user_id::text, epoch = p_epoch
		where m.entry_id = p_entry_id;
	update public.shared_entries
		set epoch = p_epoch, snapshot = p_snapshot, snapshot_seq = new_seq,
		    needs_rotation = false, updated_at = now()
		where id = p_entry_id;
	delete from public.shared_updates where entry_id = p_entry_id and seq <= new_seq;
	delete from public.shared_invites where entry_id = p_entry_id and used_at is null;
	return new_seq;
end;
$$;

revoke execute on function public.shared_rotate(text, uuid, integer, jsonb, jsonb)
	from public, anon, authenticated;
