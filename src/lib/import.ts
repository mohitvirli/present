// Restoring a JSON export. The other half of export.ts, and the half that
// carries the weight: sync is not a backup (the server holds ciphertext keyed
// to the passkey's PRF output), so this is the only path back from a dead
// device or a cleared browser profile.
//
// Two rules keep a restore from being the thing that loses the journal:
//
//   1. It never deletes. An import can add an entry or update one, nothing else.
//   2. Collisions resolve exactly the way sync's pull() resolves them —
//      last-write-wins on `touchedAt ?? updatedAt`. Any other rule and a
//      restore and a sync would disagree about which copy of an entry is
//      current, and devices would flip-flop between the two forever.
//
// planImport() is pure: it reads, validates and counts, and writes nothing, so
// the UI can show what a file would do before anything happens.

import { getEntry, listForSync, purgeEntries, putRemote, type Entry } from './db';
import { EXPORT_FORMAT_VERSION } from './export';
import { queueSync, syncState } from './sync.svelte';

export interface ImportPlan {
	fileName: string;
	exportedAt?: string;
	formatVersion: number;
	total: number; // rows in the file
	create: Entry[]; // id not present locally
	update: Entry[]; // id present, the file's copy is newer
	skip: number; // id present, local copy is same-or-newer
	rejected: number; // rows that failed validation, or tombstones
	// Seeded welcome entries the file doesn't contain, so clearing them loses
	// nothing. Seeds the file DOES carry are left alone: a skipped row isn't
	// rewritten, so deleting it here would delete it for good.
	removableSeeded: string[];
}

export interface ImportOutcome {
	applied: number;
	failed: number;
	purged: number; // seeded welcome entries removed
}

// The sync clock: any write bumps touchedAt, while updatedAt only tracks content
// edits. Older exports predate touchedAt, hence the fallback.
function clock(entry: Pick<Entry, 'touchedAt' | 'updatedAt'>): number {
	return entry.touchedAt ?? entry.updatedAt;
}

// zod is dynamically imported so it stays out of the initial client bundle —
// the same trick sync.svelte.ts uses for the WebAuthn SDK. A restore is worth
// strict validation; every other page load is not worth the bytes.
async function schemas() {
	const { z } = await import('zod');
	const entry = z.looseObject({
		id: z.string().min(1),
		// TipTap JSON doc, or a plain string for legacy entries
		content: z.union([z.record(z.string(), z.unknown()), z.string()]),
		metadata: z.record(z.string(), z.unknown()),
		createdAt: z.number().finite(),
		updatedAt: z.number().finite(),
		touchedAt: z.number().finite().optional(),
		deleted: z.boolean().optional()
	});
	const bundle = z.looseObject({
		app: z.literal('present'),
		formatVersion: z.number().int().positive(),
		exportedAt: z.string().optional(),
		entries: z.array(z.unknown())
	});
	return { entry, bundle };
}

function parseJSON(text: string, fileName: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		// the likeliest wrong file is the app's own markdown export
		if (/\.md$/i.test(fileName) || text.trimStart().startsWith('---')) {
			throw new Error("Markdown exports can't be imported — pick the JSON file instead.");
		}
		throw new Error("That file isn't valid JSON.");
	}
}

// Reads the file and works out what it would do. Writes nothing.
export async function planImport(file: File): Promise<ImportPlan> {
	const text = await file.text();
	const raw = parseJSON(text, file.name);
	const { entry: entrySchema, bundle: bundleSchema } = await schemas();

	const parsed = bundleSchema.safeParse(raw);
	if (!parsed.success) throw new Error("That doesn't look like a Present export.");
	const bundle = parsed.data;
	if (bundle.formatVersion > EXPORT_FORMAT_VERSION) {
		throw new Error('That export came from a newer version of Present — update the app first.');
	}

	const plan: ImportPlan = {
		fileName: file.name,
		exportedAt: bundle.exportedAt,
		formatVersion: bundle.formatVersion,
		total: bundle.entries.length,
		create: [],
		update: [],
		skip: 0,
		rejected: 0,
		removableSeeded: []
	};

	const fileIds = new Set<string>();

	for (const row of bundle.entries) {
		const result = entrySchema.safeParse(row);
		// one corrupt row must not cost the user the other 1999
		if (!result.success) {
			plan.rejected += 1;
			continue;
		}
		const { id, content, metadata, createdAt, updatedAt, touchedAt, deleted } = result.data;
		// a tombstone in a file would mean importing a deletion — never
		if (deleted) {
			plan.rejected += 1;
			continue;
		}
		// rebuild from known fields: a hand-edited file shouldn't get to plant
		// extra keys in the local store
		const incoming: Entry = {
			id,
			content: content as Entry['content'],
			metadata: metadata as Entry['metadata'],
			createdAt,
			updatedAt,
			...(touchedAt === undefined ? {} : { touchedAt })
		};
		fileIds.add(id);
		const local = await getEntry(id);
		if (!local) plan.create.push(incoming);
		else if (clock(incoming) > clock(local)) plan.update.push(incoming);
		else plan.skip += 1;
	}

	plan.removableSeeded = (await listForSync())
		.filter((e) => !e.deleted && e.metadata?.tutorial && !fileIds.has(e.id))
		.map((e) => e.id);

	return plan;
}

// Writes the plan. Idempotent: running the same file twice leaves the second run
// with nothing to do.
export async function applyImport(
	plan: ImportPlan,
	opts: { clearSeeded?: boolean } = {}
): Promise<ImportOutcome> {
	// before the writes: a seed sharing an id with a row in the file is already
	// excluded from removableSeeded, so nothing the file carries is lost
	const purged = opts.clearSeeded ? plan.removableSeeded.length : 0;
	if (purged) await purgeEntries(plan.removableSeeded);

	let applied = 0;
	let failed = 0;
	for (const entry of [...plan.create, ...plan.update]) {
		try {
			await putRemote(entry);
			applied += 1;
		} catch {
			// keep going: a partial restore is still a restore, and the caller
			// reports "n of m" rather than claiming success
			failed += 1;
		}
	}

	// a purge with no writes still changed the store — without the bump the
	// timeline keeps rendering entries that no longer exist
	if (applied || purged) syncState.rev += 1; // same signal pull() uses
	if (applied) queueSync(); // push the restored entries, if sync is on
	return { applied, failed, purged };
}
