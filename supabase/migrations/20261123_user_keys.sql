-- Shared entries, Phase 1: one identity key pair per user. Run once in the
-- Supabase SQL editor BEFORE turning on the shared-entries flag. Idempotent.
--
-- public_key: ECDH P-256 public JWK — others seal shared-entry keys to it.
-- wrapped_private_key: the private JWK as an AES-GCM Envelope under the user's
-- passkey-derived journal key. The server can read neither the private key
-- nor anything sealed to the public one.

create table if not exists public.user_keys (
	user_id              uuid primary key,
	public_key           jsonb not null,
	wrapped_private_key  jsonb not null,
	created_at           timestamptz not null default now()
);

alter table public.user_keys enable row level security; -- no policy → service-role only
