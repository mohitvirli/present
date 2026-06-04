import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { JSONContent } from '@tiptap/core';
import { wordCount } from './tiptap';

export type Mood = 'great' | 'good' | 'neutral' | 'low' | 'bad';

// TipTap ProseMirror JSON doc (string = legacy markdown/plain entries)
export type EntryContent = JSONContent | string;

export interface EntryMetadata {
	title?: string;
	mood?: Mood;
	tags?: string[]; // free-form labels
	location?: string; // optional, user-typed for now
	wordCount?: number; // derived on save
	// reserved for future AI integration (Phase 7)
	aiSummary?: string;
	aiTags?: string[];
	aiSentiment?: number; // -1..1
}

export interface Entry {
	id: string; // crypto.randomUUID()
	content: EntryContent; // TipTap JSON doc
	metadata: EntryMetadata;
	createdAt: number; // Date.now()
	updatedAt: number;
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

export async function addEntry(
	content: EntryContent,
	metadata: EntryMetadata = {}
): Promise<Entry> {
	const db = await getDB();
	const now = Date.now();
	const entry: Entry = {
		id: crypto.randomUUID(),
		content: plain(content),
		metadata: { ...plain(metadata), wordCount: wordCount(content) },
		createdAt: now,
		updatedAt: now
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
	const merged: Entry = {
		...existing,
		...patch,
		content: patch.content !== undefined ? plain(patch.content) : existing.content,
		metadata: { ...existing.metadata, ...plain(patch.metadata ?? {}) },
		updatedAt: Date.now()
	};
	if (patch.content !== undefined) {
		merged.metadata.wordCount = wordCount(patch.content);
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
	return all.reverse(); // newest first
}

export async function deleteEntry(id: string): Promise<void> {
	const db = await getDB();
	await db.delete('entries', id);
}
