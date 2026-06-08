# Present

A calm, minimal journaling app. Write what's here now — a font-first, distraction-free space that saves as you go, syncs across your devices with just a fingerprint, and (optionally) reflects back with AI.

Built with SvelteKit + Svelte 5 (runes), TipTap, and IndexedDB. Local-first by default; sync and AI are opt-in.

## Features

- **Local-first writing** — entries live in IndexedDB and autosave as you type. Works fully offline.
- **Timeline** — entries grouped by day on a vertical rail, with rich in-place previews, collapsible day groups, and a rolling clock in the header.
- **Private sync** — end-to-end encrypted sync across devices using a **passkey** (FaceID / fingerprint). No account, no password. The encryption key is derived from the passkey's PRF and never leaves your device, so the server only ever stores ciphertext.
- **AI assist** (opt-in) — title & tag suggestions, mood analysis, and a short summary, plus **Reflection mode**: a gentle ghost follow-up question at your caret as you write.
- **Voice dictation** — live speech-to-text via Deepgram, streamed into the editor.
- **Markdown + rich text** — headings, lists, todo checkboxes, links, blockquotes, code.
- **Themes** — light/dark plus Sage, Sky, and Deep Blue.
- **Time-aware placeholders** — the composer greets you differently by time of day, weekend, and first run.

## Tech stack

- **Framework**: SvelteKit 2, Svelte 5 (runes), TypeScript
- **Editor**: TipTap 3 (ProseMirror)
- **Local storage**: IndexedDB via `idb`
- **Sync backend**: Supabase (Postgres, service-role only) behind SvelteKit API routes
- **Auth / crypto**: WebAuthn passkeys (`@simplewebauthn`), PRF-derived AES-GCM, `jose` for signed session cookies
- **AI**: Vercel AI SDK + Anthropic; Deepgram for dictation
- **Motion**: GSAP, Lenis smooth scroll
- **Deploy**: `@sveltejs/adapter-vercel`

## Getting started

```sh
npm install
npm run dev          # http://localhost:5173
npm run dev:https    # HTTPS on your LAN — required to test passkeys on a device
```

Other scripts:

```sh
npm run build        # production build
npm run preview      # preview the build
npm run check        # svelte-check
npm run lint         # prettier + eslint
npm run format       # prettier --write
```

## Configuration

All features beyond local writing are optional. Set only what you need in `.env` (see `.env.example`).

| Variable | Needed for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | AI suggestions, Reflection | Anthropic API key |
| `DEEPGRAM_API_KEY` | Voice dictation | Deepgram API key |
| `SUPABASE_URL` | Sync | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Sync | Service-role key (server only — never exposed to the client) |
| `SESSION_SECRET` | Sync | Random string used to sign session/challenge cookies |
| `WEBAUTHN_RP_ID` | Sync | Relying-party ID (e.g. `localhost` or your domain) |
| `WEBAUTHN_RP_NAME` | Sync | Display name shown in the passkey prompt |
| `WEBAUTHN_ORIGIN` | Sync | Full origin, e.g. `https://localhost:5173` |

### Sync database

Run [`supabase/schema.sql`](supabase/schema.sql) once in the Supabase SQL editor. It creates the `credentials` and `entries` tables (RLS on, no policies — service-role only) and the guarded `sync_push_entries` upsert function that enforces last-write-wins.

## How sync works

1. Enabling sync creates a passkey; signing in on another device uses it.
2. The passkey's PRF output derives an AES-GCM key, persisted as a non-extractable `CryptoKey` in IndexedDB (so reopening the app doesn't re-prompt).
3. Entry content + metadata are encrypted client-side; the server stores ciphertext and blanked metadata.
4. Push/pull reconcile by `updatedAt` (last-write-wins). Deletes propagate as tombstones. The server-side `sync_push_entries` guard prevents a stale device from resurrecting a deleted or older entry.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

Personal project — see the repository for details.
