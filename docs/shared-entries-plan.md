# Shared entries — plan

Co-written entries: a small group (up to 8) edits one entry live, Google Docs style,
end-to-end encrypted. The entry shows in every member's timeline on its date. It is
excluded from AI analysis and monthly recaps.

## Constraints from today's code

- Entries are E2E encrypted with a key derived from the passkey PRF (`src/lib/crypto.ts`).
  The server must never see a shared entry's plaintext either.
- Accounts are passkey-only: no username, email or user directory. People join by invite link.
- `entries` is keyed `(user_id, id)` and pull only returns your own rows.
- Sync merges whole entries by last-write-wins on `touchedAt` — unusable for concurrent edits.
- API runs on Vercel functions (no websockets). Live transport = Supabase Realtime.
- The browser has no Supabase auth today; every query goes through service-role API routes.

## Design

### Keys

| Key                    | What                                            | Where it lives                                                                      |
| ---------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Journal key (exists)   | AES-GCM from passkey PRF                        | IndexedDB, non-extractable                                                          |
| Identity keypair (new) | ECDH P-256 per user                             | public key on server; private key encrypted with journal key, on server + IndexedDB |
| Entry key (new)        | random AES-GCM per shared entry, has an `epoch` | wrapped for each member's public key, stored on server                              |

- Invite link: `/join/<inviteId>#<secret>`. The fragment never reaches the server.
  The secret decrypts the entry key from the invite row. On accept, the joiner re-wraps
  the entry key to their own public key and the invite is consumed.
- Removing a member: owner rotates to a new entry key (`epoch + 1`), wraps it for each
  remaining member's public key, and writes a fresh snapshot under the new epoch.
  The removed member keeps what they already saw (unavoidable) but nothing new.
- Shared entries require a PRF passkey. Without PRF there is no journal key, so no
  safe place for the identity private key. Non-PRF users see "your passkey can't hold shared
  entries" instead of the share button.

### Document model

- Content is a Yjs doc, bound to TipTap with `@tiptap/extension-collaboration`
  (+ `collaboration-caret` for live cursors). StarterKit's undo/redo must be turned off
  for shared entries (Yjs brings its own).
- Title, tags, date live in a `Y.Map` inside the same doc, so they merge too.
- Member display names (chosen on join) live in the doc's `members` map — encrypted, so
  the server never learns names.
- Every Yjs update is encrypted with the entry key before it leaves the device.

### Server (new tables, service-role only like today)

```
user_keys       (user_id pk, public_key, wrapped_private_key, created_at)
shared_entries  (id pk, owner_id, epoch, snapshot_envelope, snapshot_seq, deleted, created_at, updated_at)
shared_members  (entry_id, user_id, role 'owner'|'editor', wrapped_key, epoch, joined_at, pk(entry_id,user_id))
shared_updates  (entry_id, seq bigserial, epoch, envelope, created_at)   -- append-only log
shared_invites  (id pk, entry_id, encrypted_entry_key, epoch, created_by, expires_at, used_by, used_at)
```

Routes under `src/routes/api/shared/`:

- `POST keys` / `GET keys` — upload/fetch your identity keypair.
- `POST /` — create shared entry (owner row + first snapshot).
- `GET list` — shared entries you're a member of, with your wrapped key.
- `POST [id]/updates`, `GET [id]/updates?after=seq` — persist and catch up on the update log.
- `POST [id]/snapshot` — compact: any member uploads a merged snapshot, server drops older updates.
- `POST [id]/invites`, `POST invites/[id]/accept` — invite flow (max 8 members enforced here).
- `DELETE [id]/members/[userId]` — leave, or owner removes (triggers rotation client-side).
- `POST realtime-token` — mints a short-lived Supabase JWT whose claims list the entries you belong to.

### Live transport

- Supabase Realtime **private broadcast channels**, one per entry: `shared:<entryId>`.
- RLS on `realtime.messages` lets a JWT join a channel only if `entryId` is in its claims.
  The JWT is signed server-side with the project's JWT secret (new env var), 15 min TTL, refreshed.
- Broadcast = encrypted Yjs updates + awareness (cursor, name color). Presence shows who's in.
- Broadcast is best-effort; the `shared_updates` log is the source of truth. Each client
  also POSTs its updates (debounced ~1s) and catches up from the log on open/reconnect.

### Local + timeline

- Local IndexedDB gets a `shared` store: `{ id, ydocState, epoch, lastSeq }`.
- A mirror `Entry` with `metadata.shared = { id, members }` sits in the normal `entries` store,
  re-rendered from the Y doc on change. Timeline, search, calendar and the editor read path
  keep working unchanged. The mirror is never pushed through the private sync.
- `isShared(e)` filter, used by `/api/analyze`, `/api/reflect` and `recap.ts` to exclude them.
- Export: include shared entries, marked with co-authors.

## Join, members, names

Kept minimal: names live on each entry, nothing is added to Settings.

- **Name.** One text field, asked when the owner first shares and when an invitee joins.
  Prefilled from the last name used (localStorage, this device only). Stored in the entry's
  encrypted `members` map with the role. Rename by tapping your own name in the members sheet;
  it only changes that entry.
- **Invite.** Owner: Share → Invite makes a single-use link that expires in 7 days.
- **Join.** `/join/<id>#…` → sign in to sync if needed (non-PRF passkey: "can't join on this
  device") → name field → preview ("Mohit invited you to _Lisbon trip_", decrypted on device
  with the link secret) → Join / Decline. Server checks the 8-member cap and consumes the
  invite. The entry lands on the joiner's timeline at its original date.
- **Others see it.** "Asha joined" toast if the entry is open; avatar appears in the header;
  "New member" dot on the timeline card otherwise.
- **Showing names.** Header avatar stack (initials, color from the member's account ID),
  members sheet ("Mohit · Owner", "Asha · Joined Nov 23", yourself as "You"), live cursor
  label, timeline card "with Asha, Ravi" (everyone but you).
- **Members sheet** (tap the avatar stack): owner gets Invite, Remove per member, Delete for
  everyone; editors get Leave. Removal rotates the key; the removed member keeps a read-only
  "You were removed" copy they can delete. Their text stays in the entry.
- **Owner leaving.** Must hand ownership to another member first.

## Phases

Each phase ships behind a `sharedEntries` flag in settings, on its own branch.

0. **Spike (1–2 days).** Yjs + TipTap Collaboration on the existing Editor with every custom
   extension (tags, dates, tasks, tables, list drag, dictation, recap stats). Two tabs over a
   local BroadcastChannel. Go/no-go: all custom nodes survive round-trips, no editor quirks.
1. **Identity keys (1 day).** Generate keypair on first sync sign-in with PRF, store wrapped.
   Migration for `user_keys`.
2. **Shared entry storage (2–3 days).** Tables, create/list/updates/snapshot routes, local
   `shared` store, mirror Entry, async catch-up only (no realtime yet). Two accounts editing
   in turn merge correctly.
3. **Invites (1–2 days).** Invite create/accept, join page, display-name prompt, member cap.
4. **Live (3–4 days).** Realtime token route, RLS on `realtime.messages`, broadcast provider,
   live cursors, presence avatars in the entry header.
5. **Members & rotation (1–2 days).** Leave, remove, key rotation, owner deletes for all.
6. **Polish (2 days).** Shared badge on EntryCard, AI/recap exclusion, export, offline edits
   merge on reconnect, empty/error states, CHANGELOG.

Rough total: ~2.5–3 weeks.

## Risks

- **Custom TipTap nodes under Yjs.** Node views and the read-only content-wipe guard in
  `entry/+page.svelte` assume JSON `setContent`. Phase 0 exists to find this early.
- **Realtime auth.** Minting Supabase JWTs is new attack surface; claims must come only from
  `shared_members`, never from the request.
- **Metadata leak.** Server sees who shares with whom and when, not content or names. Acceptable,
  but say so in the privacy copy.
- **Update log growth.** Snapshot compaction every N updates or on close.
- **Lost passkey.** Losing your passkey already loses your journal; same for shared entries,
  though other members keep theirs.

## Phase 0 result (Nov 23) — go

Spike: `/dev/shared-spike?name=<you>` (dev only), Yjs over a BroadcastChannel between tabs.

- Passed: text, bold/italic, `tagRef` and `dateRef` chips, `#` and `@` menus, task checkboxes,
  bullet lists, tables (cell edits), blockquote; a late-joining tab gets the full doc; presence
  list; live caret labels; undo only reverts your own edits; regular entries unaffected
  (no Collaboration extension, StarterKit undo kept).
- Not yet checked: list drag handle, dictation decorations, table column resize, phone.
- Learned: content inserted with `setContent` counts as your edit, so undo can wipe a freshly
  created shared entry. Phase 2 must apply the initial snapshot with a non-tracked origin.
- Learned: a caret only shows while that person's editor has focus (background tabs publish none).

## Phase 1 result (Nov 23) — done

Identity key pairs (`b60e126`). Verified on https://localhost:5173 with a real passkey:
key pair created and stored (`user_keys` row, GET 200); after deleting the device copy, a
reload restored the same public key from the server. Seal/open round trip, non-extractable
private key and JWK guards checked in the browser. Needs a PRF passkey (journal key on device).

## Phase 2a result (Nov 23) — done

Storage and async sync (no UI yet). `scripts/shared-phase2-check.js` on https://localhost:5173
with a real account: create, edit (title via Y map, pushed as one encrypted update), server
returned snapshot + 1 update with no plaintext, local copy wiped, restored from the server with
identical content, edited title and tags; the mirror never entered private push. Invites table
moved to Phase 3's migration. Next, 2b: open shared entries in the editor and a Share action.

## Phase 3 result (Nov 23) — done

Invites (`shared_invites` + `shared_accept_invite`, migration 20261125). Verified with two accounts
on https://localhost:5173: owner set a name and created a link from the members sheet; a second
account (Incognito, new passkey) opened it, saw the preview, joined, and both sides' edits merged
on sync. Members sheet shows names from the doc.

Follow-ups for Phase 6 polish:

- **Mobile layout** for the members sheet (currently a fixed popover under the header) and the
  `/join` page — check on phone widths and make the sheet a bottom sheet there.
- Replace the `confirm()` / `alert()` in "Write together" with in-app UI.
- Supabase CLI: link the project (`npx supabase@latest link`), rename migrations to 14-digit
  versions, mark the applied ones with `migration repair`, then use `db push`.

## Phase 4 result (Nov 23) — done

Live editing over Supabase Realtime broadcast, without the custom-JWT design above: each entry's
channel topic is derived from its key (HKDF, per epoch) and every message is AES-GCM sealed with
it, so only members can find, read or write a channel. The client gets the project URL and anon
key from `/api/shared/realtime` (`SUPABASE_ANON_KEY` in `.env`); no realtime RLS needed.
Awareness is created before the editor mounts, so carets never depend on the connection; it
connects in the background with backoff. Caret names fade 2.5s after the owner's last move and
show on hover. Verified with two accounts: live text, carets with names, header presence.

## Phase 5 result (Nov 23) — done

Leave, remove, make owner, delete for everyone, and key rotation (migration 20261126:
`needs_rotation` + `shared_rotate`). Leaving or removal flags the entry; the owner's client
rotates (new key sealed to each remaining member, snapshot under it, old-key updates and open
invites dropped, live channel moves with the epoch). Writes with a stale epoch get 409 and are
resent after re-keying. Removed members keep a read-only copy they can delete; leaving and
delete-for-everyone remove it. Verified with two accounts: transfer both ways, remove, rejoin,
leave, delete for everyone.

## Phase 6 progress (Nov 23)

Done: members sheet rebuilt as a native modal dialog (Escape, focus trap, backdrop) with GSAP
open/close, anchored under the header on desktop and a bottom sheet on phones; members cached
and prefetched on open, skeleton on first load, staggered rows; in-app confirm/alert dialogs
(`DialogHost`, `confirmDialog`/`alertDialog`) replace every browser `confirm()`/`alert()`;
Write together reopens in edit mode with the members sheet open; timeline cards show a
"with Morvi, Asha" pill (grey "No longer shared with you" for removed copies).

Still to do: `/join` page at phone widths, leave shared entries out of AI analysis, reflections
and recaps, export with co-authors, and deciding when to drop the flag.

## Release gating (Nov 23)

Two gates: the build flag `VITE_SHARED_ENTRIES=1` makes the feature exist at all, and a
"Shared entries (Beta)" switch in Settings → Sync (per device, off by default, needs an encrypting
passkey) turns it on. Off: no Write together, shared entries open read-only from their last copy
and don't sync. The join page offers to turn it on. To ship: run the four migrations, then set
`VITE_SHARED_ENTRIES=1` and `SUPABASE_ANON_KEY` in Vercel.
