# Plan: Private Sync (passkey + Supabase)

Usernameless passkey sign-in that gives each user a stable `userId`, then
syncs journal entries to Supabase across devices. Phase 1–3 ship working
plaintext sync; Phase 4 adds end-to-end encryption with the passkey (PRF).

**Settings row (target UI):**

```
Private Sync                                            [ Enable ]
Keep journals available across your devices
using FaceID / fingerprints.
```

## Architecture decision (read first)

**Server-proxied sync** (not client-side Supabase). The browser never holds a
Supabase key or a Supabase JWT. Flow:

1. Passkey ceremony runs against our SvelteKit `/api/sync/*` routes.
2. On success the server mints a **session cookie** (httpOnly, signed JWT via
   `jose`) holding the `userId`.
3. `/api/sync/push` and `/api/sync/pull` read `userId` from the cookie and use
   the Supabase **service-role** client, scoping every query by `userId`.
4. RLS is still enabled (defense in depth) but the service role is the only
   caller.

Why: avoids shipping Supabase anon key + custom-JWT-as-bearer to the client,
keeps the sync surface to two endpoints, and makes Phase 4 a pure client-side
encrypt/decrypt wrapper (server only ever sees ciphertext).

WebAuthn `rpID` = the deployment host (e.g. `present.vercel.app` or the custom
domain). `expectedOrigin` = `https://<that host>`. Passkeys require HTTPS — they
work on the Vercel deployment and on `npm run dev:https`, **not** plain-http LAN.

---

## Phase 0 — Documentation Discovery (verified APIs)

> These were confirmed against current docs (Jan 2026). Do **not** invent other
> method names or params.

### @simplewebauthn — v13 (`@simplewebauthn/server`, `@simplewebauthn/browser`)
- Server: `generateRegistrationOptions`, `verifyRegistrationResponse`,
  `generateAuthenticationOptions`, `verifyAuthenticationResponse`.
- Browser (v13): `startRegistration({ optionsJSON })`,
  `startAuthentication({ optionsJSON })` — **note the `optionsJSON` wrapper**, a
  v13 breaking change. Passing the options object directly (v10-style) is an
  anti-pattern that will throw.
- **Usernameless / discoverable**: registration uses
  `authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }`.
  Authentication uses `allowCredentials: []` so the OS shows any discoverable
  passkey for this RP; the verified response's `id` (and `userHandle`) tell us
  which user.
- Docs: https://simplewebauthn.dev/docs/packages/browser ,
  https://simplewebauthn.dev/docs/packages/server/ ,
  https://simplewebauthn.dev/docs/advanced/passkeys/

### WebAuthn PRF extension (Phase 4 only)
- Authentication options: `extensions: { prf: { eval: { first: <salt bytes> } } }`.
- Read result: `cred.getClientExtensionResults().prf.results.first` (an ArrayBuffer).
- Derive key: `crypto.subtle.importKey('raw', prfFirst, 'HKDF', false, ['deriveKey'])`
  → `crypto.subtle.deriveKey({ name:'HKDF', hash:'SHA-256', salt, info }, hkdfKey,
  { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt'])`.
- `@simplewebauthn/browser` forwards `extensions` and returns
  `clientExtensionResults`. PRF is requested at **registration** time too
  (`extensions.prf: {}`) to confirm support.
- Docs: https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html ,
  https://www.corbado.com/blog/passkeys-prf-webauthn

### Supabase
- `@supabase/supabase-js` `createClient(SUPABASE_URL, SERVICE_ROLE_KEY)` on the
  server. Service role **bypasses RLS** — always filter by `userId` in code.
- RLS policy helpers: `auth.uid()`, `auth.jwt() ->> 'sub'` (only relevant if we
  later go client-direct; not used in the server-proxied path).
- Custom HS256 JWT signed with the project JWT secret is a *valid* RLS path but
  **not used in Phase 1** (we proxy). Keep it noted for a future client-direct mode.
- Docs: https://supabase.com/docs/guides/database/postgres/row-level-security ,
  https://supabase.com/docs/guides/auth/jwts

### Existing app facts (grounding)
- Settings store: `src/lib/settings.svelte.ts` — `$state` flag + localStorage,
  `setX(on)` setters. Mirror this for `syncSettings`.
- Settings UI: `src/lib/components/Settings.svelte` — `.ai-toggle` row pattern
  (`.ai-toggle-title` + `.ai-toggle-sub` + `input.switch`).
- Data: `src/lib/db.ts` — `Entry { id, content, metadata, createdAt, updatedAt }`,
  IndexedDB via `idb`, `addEntry/updateEntry/getEntry/listEntries/deleteEntry`.
  **`deleteEntry` hard-deletes** — Phase 3 must add tombstones for delete sync.
- Server route pattern: `src/routes/api/*/+server.ts`, `env` from
  `$env/dynamic/private`, `error`/`json` from `@sveltejs/kit`, `prerender = false`.
- Env precedence quirk handled in `vite.config.ts` (`restoreBlankEnvFromFiles`).

### Anti-patterns to avoid
- ❌ `startRegistration(options)` / `startAuthentication(options)` — must be
  `{ optionsJSON: options }` (v13).
- ❌ Storing the WebAuthn challenge in module memory (serverless = lost between
  invocations). Use a short-lived signed httpOnly cookie.
- ❌ Shipping the Supabase service-role key to the client.
- ❌ Hard-deleting synced entries with no tombstone (delete won't propagate).
- ❌ Trusting `userId` from the request body — always read it from the verified
  session cookie.

---

## Phase 1 — Sync backend (auth + storage, server-proxied)

**Implement**

1. **Deps**: `npm i @simplewebauthn/server @simplewebauthn/browser @supabase/supabase-js jose`
   (use `--engine-strict=false` per this repo's `.npmrc`).
2. **Env** (`.env` + Vercel): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SESSION_SECRET` (32+ random bytes for `jose` HMAC), `WEBAUTHN_RP_ID`
   (host, no scheme), `WEBAUTHN_ORIGIN` (`https://<host>`), `WEBAUTHN_RP_NAME`
   (`Present`). Add placeholders to `.env`; document required Vercel vars.
3. **Supabase schema** (SQL editor) — copy:
   ```sql
   create table public.credentials (
     id           text primary key,        -- base64url credential ID
     user_id      uuid not null,
     public_key   bytea not null,
     counter      bigint not null default 0,
     transports   text[],
     created_at   timestamptz not null default now()
   );
   create index credentials_user_id_idx on public.credentials(user_id);

   create table public.entries (
     user_id     uuid not null,
     id          text not null,            -- client entry id
     content     jsonb not null,           -- Phase 4: switches to text ciphertext
     metadata    jsonb not null default '{}',
     created_at  timestamptz not null,
     updated_at  timestamptz not null,
     deleted     boolean not null default false,
     primary key (user_id, id)
   );
   create index entries_user_updated_idx on public.entries(user_id, updated_at);

   alter table public.credentials enable row level security;  -- no policy → service-role only
   alter table public.entries     enable row level security;  -- no policy → service-role only
   ```
4. **Supabase server client** — `src/lib/server/supabase.ts`: lazy
   `createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })`.
5. **Session helpers** — `src/lib/server/session.ts` using `jose`:
   `mintSession(userId)` → `SignJWT({ sub: userId })` HS256 with `SESSION_SECRET`,
   ~30-day exp; `setSessionCookie(cookies, jwt)` (httpOnly, secure, sameSite lax,
   path `/`); `readSession(cookies)` → verify → `userId | null`;
   `clearSession(cookies)`. Also `setChallengeCookie`/`readChallengeCookie`
   (short 5-min signed cookie holding the ceremony challenge).
6. **WebAuthn routes** (`src/routes/api/sync/...`):
   - `register/options/+server.ts` (POST): `generateRegistrationOptions({
     rpName, rpID, userName: 'present-user', userID: <random bytes>,
     authenticatorSelection: { residentKey:'required', userVerification:'preferred' },
     attestationType:'none' })` → store `options.challenge` in challenge cookie →
     return options JSON.
   - `register/verify/+server.ts` (POST): read challenge cookie,
     `verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin,
     expectedRPID })`; on `verified`, generate `userId = crypto.randomUUID()`,
     insert into `credentials` (`id`, `user_id`, `public_key`, `counter`,
     `transports`), `mintSession(userId)` + set cookie, return `{ ok: true }`.
   - `auth/options/+server.ts` (POST): `generateAuthenticationOptions({ rpID,
     allowCredentials: [], userVerification:'preferred' })` → challenge cookie → return.
   - `auth/verify/+server.ts` (POST): look up credential by `response.id`; if
     none → 404 (no account on this passkey); `verifyAuthenticationResponse({
     response, expectedChallenge, expectedOrigin, expectedRPID,
     credential: { id, publicKey, counter } })`; on verified, update `counter`,
     `mintSession(credential.user_id)` + cookie, return `{ ok: true }`.
   - `session/+server.ts` (GET): return `{ signedIn: !!userId }`; (DELETE):
     `clearSession` (disable sync / sign out).

**Documentation references**
- Server option/verify shapes: https://simplewebauthn.dev/docs/packages/server/
- Existing route skeleton to copy: `src/routes/api/analyze/+server.ts`
  (`env`, `prerender=false`, `error`/`json`).

**Verification**
- `npm run check` passes.
- `curl -X POST .../api/sync/register/options` returns JSON with `challenge`,
  `rp`, `user`, `pubKeyCredParams`, and `authenticatorSelection.residentKey === 'required'`.
- `curl .../api/sync/session` returns `{ signedIn:false }` with no cookie.
- Rows exist: `credentials`, `entries` (Supabase dashboard).

**Anti-pattern guards**
- `grep -n "residentKey" src/routes/api/sync` → must be `'required'`.
- Challenge must come from the cookie in verify routes (`grep` shows
  `readChallengeCookie`, not a constant).
- Service-role key only under `src/lib/server/` (never imported in `.svelte`).

---

## Phase 2 — Client passkey flow + Settings UI

**Implement**

1. **Sync store** — `src/lib/sync.svelte.ts`:
   `syncSettings = $state<{ enabled: boolean; status: 'idle'|'connecting'|'syncing'|'error'|'synced'; error: string }>`.
   `initial enabled` from `localStorage['present:sync-enabled']` AND a live
   `/api/sync/session` check on load.
   - `enable()`: `status='connecting'`; try `authenticate()` (existing passkey on
     this device) → if 404/no-credential, fall back to `register()`. On success
     set localStorage flag, `status='synced'`, kick `fullSync()` (Phase 3).
   - `register()`: POST `register/options` → `startRegistration({ optionsJSON })`
     (from `@simplewebauthn/browser`) → POST `register/verify` with the response.
   - `authenticate()`: POST `auth/options` → `startAuthentication({ optionsJSON })`
     → POST `auth/verify`.
   - `disable()`: DELETE `/api/sync/session`, clear flag, `status='idle'`. (Local
     entries stay; remote untouched in Phase 1.)
   - Dynamic-import `@simplewebauthn/browser` inside the methods to keep it out
     of SSR (mirror the dictation SDK dynamic-import pattern).
2. **Settings row** — in `Settings.svelte`, add a "Sync" subhead + a row using
   the `.ai-toggle` markup:
   - title "Private Sync", sub "Keep journals available across your devices using
     FaceID / fingerprints."
   - Right side: an **[Enable]** button when off; when on show status text
     (Syncing…/Synced/✓) + a "Turn off" affordance. (A button rather than a bare
     switch because enabling triggers an OS passkey prompt.)
   - Disabled + hint when not a secure context
     (`!window.isSecureContext`) → "Requires HTTPS".
   - `{#if syncSettings.error}` show the error line.

**Documentation references**
- Browser API (v13 `optionsJSON`): https://simplewebauthn.dev/docs/packages/browser
- Toggle row markup to copy: `src/lib/components/Settings.svelte` `.ai-toggle`.
- Dynamic-import pattern to copy: `src/lib/dictation.svelte.ts` (`loadSdk`).

**Verification**
- On `npm run dev:https` (or Vercel preview): open Settings → "Private Sync"
  row renders with [Enable].
- Click Enable → OS passkey prompt → `/api/sync/session` then returns
  `{ signedIn:true }`; row shows "Synced".
- Reload → still signed in (session cookie); second device "Enable" →
  `startAuthentication` with `allowCredentials:[]` signs into the **same** userId.

**Anti-pattern guards**
- `grep -n "startRegistration\|startAuthentication" src/lib` → both wrapped in
  `{ optionsJSON }`.
- No `@simplewebauthn/browser` static import at module top (dynamic only).

---

## Phase 3 — Sync engine + tombstones

**Implement**

1. **db.ts soft-delete / tombstones**: change `deleteEntry` to mark a tombstone
   so deletes propagate. Minimal approach: add `deletedAt?: number` to
   `EntryMetadata` or a dedicated `deleted` field on `Entry`; `deleteEntry` sets
   `deleted=true, updatedAt=now` (keep the row) instead of `db.delete`.
   `listEntries` filters out `deleted`. Add `listAllForSync()` returning
   everything incl. tombstones, and `lastSyncedAt` in a small `meta` store
   (or localStorage).
2. **Sync API**:
   - `src/routes/api/sync/push/+server.ts` (POST): `readSession` → 401 if none;
     body = `{ entries: Entry[] }`; `supabase.from('entries').upsert(rows)` with
     `user_id` injected server-side. Map `Entry` → row (content/metadata as
     jsonb, timestamps to ISO, `deleted`).
   - `src/routes/api/sync/pull/+server.ts` (GET): `readSession` → 401; query
     `entries` where `user_id = sub` and `updated_at > since` (query param) →
     return rows.
3. **Engine** (`src/lib/sync.svelte.ts`):
   - `push()`: gather local entries changed since `lastPushedAt` → POST `push`.
   - `pull()`: GET `pull?since=lastSyncedAt` → for each remote row, **merge by
     `updatedAt` (last-write-wins)**: if remote newer than local (or local
     absent) → upsert into IndexedDB (apply tombstone as delete); else skip.
     Update `lastSyncedAt` to max server `updated_at`.
   - `fullSync()` = `push()` then `pull()`.
   - **Triggers**: on `enable()`, on `visibilitychange`→visible, debounced after
     each local save (hook into entry autosave/`updateEntry`), and a light
     interval. Guard against overlap with a `syncing` flag.
4. **Conflict resolution**: last-write-wins on `updatedAt`. Document that
   concurrent edits to the same entry on two offline devices keep the later
   `updatedAt`; acceptable for a personal journal. (Future: per-field merge.)

**Documentation references**
- supabase-js upsert/select: https://supabase.com/docs/reference/javascript/upsert
- IndexedDB layer to extend: `src/lib/db.ts` (`getDB`, `plain`, `put`).

**Verification**
- Device A writes entries → appear in Supabase `entries` (dashboard).
- Device B (same passkey/userId) → entries pulled into its timeline.
- Delete on A → tombstone syncs → entry disappears on B after sync.
- Edit same entry on both → later `updatedAt` wins, no duplication.
- Offline: app still works (IndexedDB); sync resumes on reconnect/focus.

**Anti-pattern guards**
- `grep -n "db.delete" src/lib/db.ts` → only inside a tombstone-prune path, not
  the user-facing delete.
- Push/pull routes must call `readSession` before touching Supabase
  (`grep -n "readSession" src/routes/api/sync`).
- No `user_id` taken from request body (`grep` shows it set from session only).

---

## Phase 4 — End-to-end encryption (passkey PRF)

**Implement**

1. **Capability check at register**: include `extensions: { prf: {} }` in
   registration options; after `startRegistration`, read
   `clientExtensionResults.prf?.enabled` to flag PRF support per credential
   (store on the `credentials` row). Fall back to plaintext (Phase 1 behavior)
   when unsupported, surfaced in the UI.
2. **Derive key on enable/auth**: in `authenticate()`, pass
   `extensions: { prf: { eval: { first: PRF_SALT } } }` (a fixed app-wide salt
   constant). Read `getClientExtensionResults().prf.results.first` →
   `importKey('raw', …, 'HKDF', …)` → `deriveKey(HKDF→AES-GCM 256)`. Hold the
   `CryptoKey` **in memory only** (never persisted).
3. **Encrypt/decrypt wrapper** — `src/lib/crypto.ts`:
   `encryptEntry(content)` → `{ iv, ciphertext }` (AES-GCM, random 12-byte IV)
   base64; `decryptEntry(blob)` → content. Push sends ciphertext in a `content`
   **text** column; pull decrypts before writing to IndexedDB.
4. **Schema migration**: `entries.content` jsonb → text (or add
   `ciphertext text`, `iv text`, keep `content` null). Add a `enc` version flag
   so plaintext (v0) and encrypted (v1) rows coexist during migration.
5. **Re-auth UX**: PRF requires a user-verification ceremony to recover the key
   after the in-memory key is lost (reload). Trigger a silent-ish
   `authenticate()` (FaceID) on first sync per session to re-derive the key.

**Documentation references**
- PRF derive flow: https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html
- WebCrypto HKDF/AES-GCM: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey

**Verification**
- Supabase `entries` rows show ciphertext (no readable journal text in the DB).
- Cross-device: Device B re-derives the same key from the same passkey → pulls &
  decrypts correctly.
- Wrong/absent passkey → cannot decrypt (data is opaque).
- `grep` shows the AES key is never written to localStorage/IndexedDB/cookies.

**Anti-pattern guards**
- ❌ Persisting the derived `CryptoKey` or PRF output anywhere.
- ❌ Using a per-session random salt for HKDF *info*/PRF eval that would change
  the key across logins — the PRF `eval.first` salt must be a **stable constant**.
- ❌ Reusing an IV across encryptions (always random per message).

---

## Phase 5 — Verification (whole feature)

1. `npm run check` clean; build succeeds (`npm run build`).
2. Manual cross-device on Vercel preview (HTTPS): enable on A, enable on B with
   the same passkey, confirm two-way sync + delete propagation.
3. Security pass: service-role key absent from client bundle
   (`grep -r SERVICE_ROLE build/` → nothing); session cookie is httpOnly+secure;
   (Phase 4) DB contains only ciphertext.
4. Offline pass: airplane mode → write/read works; reconnect → syncs.
5. Settings UX: enable → status → disable; error states render; "Requires HTTPS"
   shows on insecure contexts.

---

## File map (new / changed)

| File | Phase | Purpose |
|---|---|---|
| `src/lib/server/supabase.ts` | 1 | service-role client |
| `src/lib/server/session.ts` | 1 | jose session + challenge cookies |
| `src/routes/api/sync/register/options/+server.ts` | 1 | reg options |
| `src/routes/api/sync/register/verify/+server.ts` | 1 | reg verify + session |
| `src/routes/api/sync/auth/options/+server.ts` | 1 | auth options (usernameless) |
| `src/routes/api/sync/auth/verify/+server.ts` | 1 | auth verify + session |
| `src/routes/api/sync/session/+server.ts` | 1 | session check / sign out |
| `src/lib/sync.svelte.ts` | 2,3 | store + passkey flow + engine |
| `src/lib/components/Settings.svelte` | 2 | "Private Sync" row |
| `src/lib/db.ts` | 3 | tombstones + sync queries |
| `src/routes/api/sync/push/+server.ts` | 3 | upsert entries |
| `src/routes/api/sync/pull/+server.ts` | 3 | fetch entries since |
| `src/lib/crypto.ts` | 4 | PRF-derived AES-GCM encrypt/decrypt |

## Env vars (Vercel + local `.env`)
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`,
`WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_NAME`.
