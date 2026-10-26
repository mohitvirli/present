-- Sync fixes for an existing install. Run once in the Supabase SQL editor
-- BEFORE deploying the matching app code. Idempotent.
--
-- 1. touched_at: the sync clock. Any write (pin, title, tags) bumps it, while
--    updated_at only tracks content edits. The server's last-write-wins guard
--    used updated_at, so metadata-only changes never reached other devices.
-- 2. synced_at: when the SERVER stored the row. Pull pages by it instead of the
--    device-supplied updated_at, so a push that lands after another device's
--    pull (debounce, clock skew) is still picked up.

alter table public.entries add column if not exists touched_at timestamptz;
alter table public.entries add column if not exists synced_at timestamptz not null default now();

drop index if exists public.entries_user_updated_idx;
create index if not exists entries_user_synced_idx on public.entries (user_id, synced_at, id);

create or replace function public.sync_push_entries(p_user_id uuid, p_entries jsonb)
returns integer
language plpgsql
as $$
declare
	affected integer;
begin
	insert into public.entries
		(user_id, id, content, metadata, created_at, updated_at, touched_at, deleted, synced_at)
	select
		p_user_id,
		e->>'id',
		e->'content',
		coalesce(e->'metadata', '{}'::jsonb),
		(e->>'created_at')::timestamptz,
		(e->>'updated_at')::timestamptz,
		coalesce((e->>'touched_at')::timestamptz, (e->>'updated_at')::timestamptz),
		coalesce((e->>'deleted')::boolean, false),
		now()
	from jsonb_array_elements(p_entries) as e
	on conflict (user_id, id) do update
		set content    = excluded.content,
		    metadata   = excluded.metadata,
		    updated_at = excluded.updated_at,
		    touched_at = excluded.touched_at,
		    deleted    = excluded.deleted,
		    synced_at  = now()
		where excluded.touched_at > coalesce(public.entries.touched_at, public.entries.updated_at);
	get diagnostics affected = row_count;
	return affected;
end;
$$;

-- One page of rows stored after the (synced_at, id) cursor. The id tiebreak
-- matters: a single push stamps every row with the same now().
create or replace function public.sync_pull_entries(
	p_user_id  uuid,
	p_after_ts timestamptz,
	p_after_id text,
	p_limit    integer
)
returns table (
	id         text,
	content    jsonb,
	metadata   jsonb,
	created_at timestamptz,
	updated_at timestamptz,
	touched_at timestamptz,
	deleted    boolean,
	synced_at  timestamptz
)
language sql
stable
as $$
	select e.id, e.content, e.metadata, e.created_at, e.updated_at,
	       coalesce(e.touched_at, e.updated_at), e.deleted, e.synced_at
	from public.entries e
	where e.user_id = p_user_id
	  and (e.synced_at, e.id) > (p_after_ts, p_after_id)
	order by e.synced_at, e.id
	limit p_limit;
$$;

-- service role only, like the tables
revoke execute on function public.sync_push_entries(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.sync_pull_entries(uuid, timestamptz, text, integer) from public, anon, authenticated;
