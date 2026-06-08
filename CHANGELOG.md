# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-08

First tagged release. Local-first journaling with opt-in private sync and AI.

### Added

- **Private sync** across devices via passkeys (FaceID / fingerprint) with
  end-to-end encryption — content keyed by the passkey's PRF output, server
  stores ciphertext only.
- **AI assist**: title & tag suggestions, mood analysis, short summaries, and
  **Reflection mode** (gentle ghost follow-up questions while writing).
- **Voice dictation** via Deepgram, streamed live into the editor.
- **Timeline**: day-grouped entries on a vertical rail with rich previews,
  collapsible day groups (with entry counts and a wavy date rule), and a rolling
  odometer clock in the header.
- **Scroll position** is preserved when returning from an entry to the timeline.
- **First-run welcome placeholder** in the composer until the first entry is written.
- Time-of-day / weekend-aware editor placeholders.
- Todo checkboxes editable from read-only view; rich Markdown rendering in previews.
- Multiple themes: light, dark, Sage, Sky, Deep Blue.
- First-run tutorial seed entries.

### Fixed

- Sync no longer re-prompts for the passkey on every app open — the derived AES
  key is persisted as a non-extractable `CryptoKey` in IndexedDB.
- Transient "operation-specific" WebAuthn errors on fresh devices are retried.
- Deletes no longer resurrect across devices — the server `sync_push_entries`
  upsert is guarded by `updated_at` (server-side last-write-wins).
- Opening an entry no longer bumps `updatedAt` (which was inflating the
  timeline's writing-duration and breaking pull reconciliation).
- A reload always pulls remote changes even if the local push hiccups.
- Timeline preview list markers match the editor (disc/decimal) instead of
  inheriting the nested-list square bullet.
- The preview bottom-fade gradient only shows when content is actually clipped.
- Collapsing a day group animates smoothly without clipping the rail dots.

[0.1.0]: https://github.com/mohitvirli/present/releases/tag/v0.1.0
