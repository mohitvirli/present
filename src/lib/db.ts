import type { JSONContent } from '@tiptap/core';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { relativeDayKey } from './day';
import { extractDates, wordCount } from './tiptap';

export type Mood = 'great' | 'good' | 'neutral' | 'low' | 'bad';

// TipTap ProseMirror JSON doc (string = legacy markdown/plain entries)
export type EntryContent = JSONContent | string;

export interface EntryMetadata {
	title?: string;
	mood?: Mood;
	tags?: string[]; // free-form labels
	location?: string; // optional, user-typed for now
	wordCount?: number; // derived on save
	dates?: string[]; // derived on save — day keys referenced by @date chips
	// reserved for future AI integration (Phase 7)
	aiSummary?: string;
	aiTags?: string[];
	aiEmotion?: string; // dominant emotion, evocative single word, e.g. "calm"
	aiTone?: 'positive' | 'neutral' | 'negative'; // valence of dominant, drives chip color
	aiEmotion2?: string; // optional secondary emotion for mixed feelings
	aiSummaryHidden?: boolean; // user collapsed the summary (kept, not deleted)
	tutorial?: boolean; // seeded example entry shown to first-time users
	pinned?: boolean; // surfaced in the timeline's Pinned section
	views?: number; // times the entry was opened from the timeline
}

export interface Entry {
	id: string; // crypto.randomUUID()
	content: EntryContent; // TipTap JSON doc
	metadata: EntryMetadata;
	createdAt: number; // Date.now()
	updatedAt: number; // last *content* edit — drives the UI's "updated" time
	touchedAt?: number; // last write of any kind (pin, views…) — sync's LWW clock
	deleted?: boolean; // tombstone — kept so deletes propagate via sync
}

interface PresentDB extends DBSchema {
	entries: {
		key: string;
		value: Entry;
		indexes: { 'by-created': number };
	};
}

let dbPromise: Promise<IDBPDatabase<PresentDB>> | null = null;

function getDB() {
	if (!dbPromise) {
		dbPromise = openDB<PresentDB>('present', 1, {
			upgrade(db) {
				const store = db.createObjectStore('entries', { keyPath: 'id' });
				store.createIndex('by-created', 'createdAt');
			}
		});
	}
	return dbPromise;
}

// Svelte 5 $state deep-proxies objects/arrays; IndexedDB structured-clone
// cannot clone a Proxy (DataCloneError). Strip proxies to plain JSON-safe
// values before persisting. Also keeps this layer framework-agnostic for the
// future Supabase swap.
function plain<T>(value: T): T {
	return JSON.parse(JSON.stringify(value));
}

// wordCount and dates are read *out of* the content on every content write —
// callers never supply them, and metadata-only writes must leave them alone.
function applyDerived(meta: EntryMetadata, content: EntryContent): EntryMetadata {
	meta.wordCount = wordCount(content);
	const dates = extractDates(content);
	// absent rather than empty: the repo's convention is that a missing key means
	// "none", and it keeps the common case out of every stored record
	if (dates.length) meta.dates = dates;
	else delete meta.dates;
	return meta;
}

export async function addEntry(
	content: EntryContent,
	metadata: EntryMetadata = {}
): Promise<Entry> {
	const db = await getDB();
	const now = Date.now();
	const entry: Entry = {
		id: crypto.randomUUID(),
		content: plain(content),
		metadata: applyDerived({ ...plain(metadata) }, content),
		createdAt: now,
		updatedAt: now,
		touchedAt: now
	};
	await db.put('entries', entry);
	return entry;
}

export async function updateEntry(
	id: string,
	patch: Partial<Pick<Entry, 'content' | 'metadata'>>
): Promise<Entry> {
	const db = await getDB();
	const existing = await db.get('entries', id);
	if (!existing) throw new Error(`Entry ${id} not found`);
	const now = Date.now();
	const merged: Entry = {
		...existing,
		...patch,
		content: patch.content !== undefined ? plain(patch.content) : existing.content,
		// Replace metadata wholesale (callers pass the full object). Merging would
		// resurrect keys the user explicitly cleared, since plain() drops the
		// undefined values that mark a removal.
		metadata: patch.metadata !== undefined ? plain(patch.metadata) : existing.metadata,
		// metadata-only writes (pin, view count) shouldn't move the visible
		// "updated" time — only real content edits do. touchedAt is the sync clock.
		updatedAt: patch.content !== undefined ? now : existing.updatedAt,
		touchedAt: now
	};
	if (patch.content !== undefined) {
		applyDerived(merged.metadata, patch.content);
	}
	await db.put('entries', merged);
	return merged;
}

export async function getEntry(id: string): Promise<Entry | undefined> {
	const db = await getDB();
	return db.get('entries', id);
}

export async function listEntries(): Promise<Entry[]> {
	const db = await getDB();
	const all = await db.getAllFromIndex('entries', 'by-created');
	return all.filter((e) => !e.deleted).reverse(); // newest first, hide tombstones
}

// All distinct tags across live entries, most-used first. Powers tag
// autocomplete in the composer so the vocabulary converges instead of
// sprawling into near-duplicates (gym / Gym / workout).
export async function getAllTags(): Promise<{ tag: string; count: number }[]> {
	const entries = await listEntries();
	const counts = new Map<string, { tag: string; count: number }>();
	for (const e of entries) {
		for (const raw of e.metadata.tags ?? []) {
			const tag = raw.trim();
			if (!tag) continue;
			const key = tag.toLowerCase();
			const hit = counts.get(key);
			if (hit) hit.count++;
			else counts.set(key, { tag, count: 1 });
		}
	}
	return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export async function deleteEntry(id: string): Promise<void> {
	const db = await getDB();
	const existing = await db.get('entries', id);
	if (!existing) return;
	// soft-delete (tombstone) so the deletion can sync to other devices
	const now = Date.now();
	await db.put('entries', { ...existing, deleted: true, updatedAt: now, touchedAt: now });
}

// --- sync helpers ---

// Every entry incl. tombstones — the sync engine pushes these up.
export async function listForSync(): Promise<Entry[]> {
	const db = await getDB();
	return db.getAll('entries');
}

// Apply a remote entry verbatim into the local store (pull/merge owns the
// decision of whether the remote copy wins).
export async function putRemote(entry: Entry): Promise<void> {
	const db = await getDB();
	await db.put('entries', plain(entry));
}

// --- first-run tutorial -------------------------------------------------------

// A TipTap doc from one or more paragraph strings.
function doc(...paragraphs: string[]): JSONContent {
	return {
		type: 'doc',
		content: paragraphs.map((text) => ({
			type: 'paragraph',
			content: text ? [{ type: 'text', text }] : []
		}))
	};
}

// A single bullet-list item wrapping one paragraph of text.
function bullet(text: string): JSONContent {
	return {
		type: 'listItem',
		content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
	};
}

// at = absolute timestamp; offsetMs = how far before "now". One of the two sets
// the entry's date, which drives timeline order (newest first) and day grouping.
// content may be a thunk: the date-chip seed resolves "tomorrow" when seeding
// actually runs. Evaluated at module load it would go stale in a tab left open
// across midnight.
type Seed = {
	content: JSONContent | (() => JSONContent);
	metadata: EntryMetadata;
	offsetMs?: number;
	at?: number;
};

const DAY = 86_400_000;
// The day Present was first committed — the origin-story entry is dated here.
const CREATED_AT = new Date('2026-06-04T17:35:40+05:30').getTime();

const TUTORIAL_SEEDS: Seed[] = [
	{
		offsetMs: 0,
		content: doc('This is your space to think out loud.'),
		metadata: { title: 'Hey 👋 Welcome to Present', tutorial: true }
	},
	{
		offsetMs: 60_000,
		content: {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'Tap the ' },
						{ type: 'text', marks: [{ type: 'bold' }], text: 'Be Present' },
						{ type: 'text', text: ' button to add a new entry ↑' }
					]
				},
				{
					type: 'paragraph',
					content: [
						{ type: 'text', marks: [{ type: 'italic' }], text: 'Everything autosaves, locally.' }
					]
				}
			]
		},
		metadata: { tutorial: true }
	},
	{
		offsetMs: 90_000,
		content: () => ({
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'Type ' },
						{ type: 'text', marks: [{ type: 'bold' }], text: '@' },
						{ type: 'text', text: ' for a date — or ' },
						{ type: 'text', marks: [{ type: 'code' }], text: '@tomorrow' },
						{ type: 'text', text: ' straight out, like ' },
						{ type: 'dateRef', attrs: { day: relativeDayKey(1) } },
						{ type: 'text', text: '.' }
					]
				},
				{
					type: 'paragraph',
					content: [
						{
							type: 'text',
							marks: [{ type: 'italic' }],
							text: 'Any day you mention shows up on the timeline, waiting for you.'
						}
					]
				}
			]
		}),
		metadata: { title: 'Mention a day', tutorial: true }
	},
	{
		offsetMs: DAY,
		content: {
			type: 'doc',
			content: [
				{
					type: 'bulletList',
					content: [
						bullet('Title & tag suggestions, mood analysis + a short summary.'),
						bullet('Reflection mode - tap the ☯ icon to get gentle nudges to think more.')
					]
				}
			]
		},
		metadata: { title: 'Interesting AI features...', tags: ['ai'], tutorial: true }
	},
	{
		offsetMs: DAY + 30_000,
		content: doc(
			'A feature I am proud of. Sync across all your devices using just FaceID / fingerprint — no account, no password, fully encrypted.',
		),
		metadata: { title: 'Sync', tags: ['sync'], tutorial: true }
	},
	{
		offsetMs: DAY + 60_000,
		content: doc('Markdown is supported + Voice dictation is also there. Crazy no?'),
		metadata: { tutorial: true }
	},
	{
		// the author's real first entry — not an example, dated to day one
		at: CREATED_AT,
		content: {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'It all began when I stumbled upon this font - ' },
						{
							type: 'text',
							marks: [{ type: 'link', attrs: { href: 'https://www.fontshare.com/fonts/satoshi', target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null } }],
							text: 'Satoshi'
						},
						{ type: 'text', text: '. I just wanted a minimal space to write my thoughts using it, nothing overcomplex, just something sleek.' }
					]
				},
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'I tried couple of apps and I wasn’t fully content with them. Like adding a title first? How can I know what the title of the journal should be before even starting it? So I tucked it away in the context button. hehe' }
					]
				},
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'Anyhow, here’s my attempt at the way how I’d like to journal. So many features still to add. Checkout the repo → ' },
						{
							type: 'text',
							marks: [{ type: 'link', attrs: { href: 'https://github.com/mohitvirli/present', target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null } }],
							text: 'Github'
						}
					]
				},
				{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Godspeed.' }] },
				{ type: 'paragraph' }
			]
		},
		metadata: {
			title: 'This app’s story',
			tags: ['origin', 'design'],
			aiSummary: 'The story behind Present — a craving for a simple, font-first space to journal, free of forced titles.',
			aiEmotion: 'excited',
			aiTone: 'positive',
			aiEmotion2: 'nostalgic',
			tutorial: true
		}
	}
];

// Seed the starter entries. Most are flagged tutorial examples; the origin story
// is a genuine first entry.
export async function seedTutorialEntries(): Promise<void> {
	const db = await getDB();
	const base = Date.now();
	await Promise.all(
		TUTORIAL_SEEDS.map((seed) => {
			const ts = seed.at ?? base - (seed.offsetMs ?? 0);
			const content = typeof seed.content === 'function' ? seed.content() : seed.content;
			const entry: Entry = {
				id: crypto.randomUUID(),
				content: plain(content),
				metadata: applyDerived({ ...plain(seed.metadata) }, content),
				createdAt: ts,
				updatedAt: ts
			};
			return db.put('entries', entry);
		})
	);
}

export async function clearTutorialEntries(): Promise<void> {
	const db = await getDB();
	const all = await db.getAll('entries');
	await Promise.all(all.filter((e) => e.metadata.tutorial).map((e) => db.delete('entries', e.id)));
}
