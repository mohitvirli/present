# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Places**: turn on *Add location* in Settings and each new entry quietly
  notes where it was written. The browser asks once, when you switch it on;
  the place lands in the Context panel without opening it, and the
  Context button drops a pin and rolls to the place's name for a moment to say
  so. The location field searches Google Maps (or OpenStreetMap when no key is
  set), offers your recent places, or pins any name you type to where you are.
  Somewhere nothing has a name gets one made from its coordinates — the same
  spot always earns the same name. Rename a place ("Home") and nearby entries
  pick that name up next time, without a network call. Places show on timeline
  cards and are searchable. Adding a place by hand works with the setting off.
- **Export your journal**: a Data section in Settings writes every entry out as
  one file — JSON to restore from, or Markdown to read. With sync on it pulls
  first, so the file holds the whole account rather than one device's copy.
  The file is plain and unencrypted, which the card says in as many words.
- **Import a JSON export**: the restore path for a dead device or a cleared
  browser profile, since sync is not a backup — the server only ever holds
  ciphertext keyed to your passkey. Picking a file shows what it would do
  (new, updated, already up to date) before anything is written, and an import
  only ever adds or updates: it never deletes. Entries that exist on both sides
  resolve the way sync resolves them, newest write wins.
- Restoring into a fresh install can clear the seeded welcome entries, but only
  the ones your backup doesn't contain.
- **Sync now**: the Private Sync card shows when this device last synced and
  has a button to sync on demand.

### Fixed

- Sync could miss an edit for good: pulls paged by each device's own clock, so a
  change pushed just after another device's pull (or from a device whose clock
  ran behind) fell before its cursor. Pulls now page by the time the server
  stored each row.
- Pins, titles and tags didn't sync. Only content edits moved the clock the
  server compared, so metadata-only changes were refused. A text edit on one
  device and a pin on another now both survive.
- A failed push still showed "Synced". Errors now surface on the sync card.
- Pulls stopped at 1000 entries; they now page through the whole account.
- Every sync re-encrypted and uploaded the entire journal, which made reloads
  slow and would eventually exceed the request size limit. Only changed
  entries go up now, in size-capped batches.

### Changed

- A fresh install now opens in **Sage**, with **Auto day & night** on — light
  from 6am, dark from 6pm. A theme you already picked is kept, and so is Auto
  if you switched it off; if you never touched Auto, it is now on.
- Timeline cards keep their details on one line — time, place, and views
  shown as a count with an eye. A long place name is shortened instead of
  pushing the rest onto new lines. The writing-time label is gone for now.

## [1.1.0] - 2026-06-09

### Added

- **Tag chips**: the composer's tags field is now a chip editor — type and press
  Enter or comma to commit a tag, `×` to remove, Backspace on an empty field to
  edit the last chip, and paste a comma-separated list to add several at once.
- **Tag autocomplete**: as you type, a dropdown suggests existing tags (with use
  counts, most-used first) so your vocabulary converges instead of sprawling into
  near-duplicates.
- **Colored tags**: each tag gets a deterministic color drawn from the active
  theme's palette (accent + mood hues), so the same tag is always the same color
  and recolors automatically when you switch themes.

### Changed

- Tags on timeline cards drop the `#` prefix in favor of the colored pill.
- Magnetic timeline rail cursor snaps from a slightly wider range (30 → 40px).

[1.1.0]: https://github.com/mohitvirli/present/releases/tag/v1.1.0

## [1.0.0] - 2026-06-08

First stable release. Local-first journaling with opt-in private sync and AI.

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

[1.0.0]: https://github.com/mohitvirli/present/releases/tag/v1.0.0
