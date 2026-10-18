// "Export all data, decrypted" — writes the journal out as a plaintext file the
// user keeps.
//
// There is nothing to decrypt here, and that's the point: encryption only
// happens on the wire (sync's push wraps entries in an Envelope, pull unwraps
// them again), so the local store is always plaintext. This module must never
// touch the AES key — it couldn't export it anyway, the key is non-extractable.
//
// The file is UNENCRYPTED. It leaves the app's security model the moment it
// lands on disk, which is why `encrypted: false` is stated in it and the UI
// says so out loud.

import { dayKeyOf } from './day';
import { listEntries, type Entry } from './db';
import { entryFrontmatter, renderEntryMarkdown } from './tiptap-markdown';
import { saveFile, type SaveResult } from './download';
import { fullSync, syncState } from './sync.svelte';

// Bump only on a breaking change to the shape below — the importer gates on it
// and must keep reading every version that ever shipped.
export const EXPORT_FORMAT_VERSION = 1;

export type ExportFormat = 'json' | 'markdown';

export interface ExportBundle {
	app: 'present';
	formatVersion: number;
	exportedAt: string;
	appVersion: string;
	encrypted: false;
	entryCount: number;
	entries: Entry[];
}

export interface ExportFile {
	blob: Blob;
	name: string;
	entryCount: number;
}

export interface ExportResult extends ExportFile {
	saved: SaveResult;
	// true = synced before building, false = sync was on but failed (the file is
	// this device's data only), null = sync is off
	synced: boolean | null;
}

// Every live entry, newest first — listEntries() already drops tombstones, which
// listForSync() deliberately keeps. Exporting deleted rows would resurrect them.
export async function buildJSONExport(): Promise<ExportFile> {
	const entries = await listEntries();
	const bundle: ExportBundle = {
		app: 'present',
		formatVersion: EXPORT_FORMAT_VERSION,
		exportedAt: new Date().toISOString(),
		appVersion: __APP_VERSION__,
		encrypted: false,
		entryCount: entries.length,
		entries
	};
	// indented: the file is meant to be readable, and it compresses away anyway
	const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
	return { blob, name: `present-export-${dayKeyOf()}.json`, entryCount: entries.length };
}

// Sync first when it's on, so the file is the whole account rather than whatever
// this one device happens to hold. A sync failure is non-fatal — export the
// local data and report it, since a backup refused because the network blinked
// is worse than a slightly stale one.
async function syncFirst(): Promise<boolean | null> {
	if (!syncState.enabled) return null;
	try {
		// no-ops when a pass is already in flight (e.g. the one initSync starts),
		// so wait that pass out rather than reporting a sync we didn't do
		await fullSync();
		for (let i = 0; i < 300 && syncState.status === 'syncing'; i++) {
			await new Promise((r) => setTimeout(r, 100));
		}
	} catch {
		return false;
	}
	// fullSync swallows its own errors into syncState rather than throwing
	return syncState.status !== 'error';
}

// One file, every entry, newest first. Markdown carries no ids and cannot be
// imported back — it's the readable copy, not the restore format.
export async function buildMarkdownExport(): Promise<ExportFile> {
	const entries = await listEntries();
	const docs = entries.map((entry) => {
		const front = entryFrontmatter({
			...entry.metadata,
			day: dayKeyOf(entry.createdAt),
			created: entry.createdAt,
			updated: entry.updatedAt
		});
		const body = renderEntryMarkdown(entry.content);
		return `---\n${front}\n---\n\n${body}`;
	});
	const blob = new Blob([`${docs.join('\n\n')}\n`], { type: 'text/markdown' });
	return { blob, name: `present-export-${dayKeyOf()}.md`, entryCount: entries.length };
}

const BUILDERS: Record<ExportFormat, () => Promise<ExportFile>> = {
	json: buildJSONExport,
	markdown: buildMarkdownExport
};

export async function exportAll(format: ExportFormat = 'json'): Promise<ExportResult> {
	const synced = await syncFirst();
	const file = await BUILDERS[format]();
	const saved = await saveFile(file.blob, file.name);
	return { ...file, saved, synced };
}
