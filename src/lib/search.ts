import Fuse from 'fuse.js';
import type { Entry } from './db';
import { extractText, firstHeading } from './tiptap';
import type { Tone } from './search.svelte';

// Flattened, fuse-indexable view of an entry. Body text comes from the same
// extractText used for previews/word counts, so search sees what the user sees.
interface SearchRecord {
	id: string;
	title: string;
	text: string;
	tags: string; // joined so tag tokens fuzzy-match too
}

function toRecord(e: Entry): SearchRecord {
	return {
		id: e.id,
		title: e.metadata.title || firstHeading(e.content),
		text: extractText(e.content),
		tags: (e.metadata.tags ?? []).join(' ')
	};
}

// Title weighted highest, then tags, body last. ignoreLocation so matches deep
// in a long entry still count; threshold tuned for typo tolerance without
// matching everything.
const FUSE_OPTS: ConstructorParameters<typeof Fuse<SearchRecord>>[1] = {
	ignoreLocation: true,
	threshold: 0.35,
	minMatchCharLength: 2,
	keys: [
		{ name: 'title', weight: 0.5 },
		{ name: 'tags', weight: 0.3 },
		{ name: 'text', weight: 0.2 }
	]
};

// Build once per entries change (not per keystroke) — extractText walks every
// doc, so the page derives this and reuses it across searches.
export function buildIndex(entries: Entry[]): Fuse<SearchRecord> {
	return new Fuse(entries.map(toRecord), FUSE_OPTS);
}

// Exact filters (tags AND, tone) + fuzzy text query. Fuse decides the *match
// set*; display order stays the caller's chronological order — rank order
// would jumble the timeline's day grouping.
export function runSearch(
	entries: Entry[],
	index: Fuse<SearchRecord>,
	query: string,
	tags: ReadonlySet<string>, // lowercased keys
	tone: Tone | null
): Entry[] {
	const passesFilters = (e: Entry) => {
		if (tone && e.metadata.aiTone !== tone) return false;
		if (tags.size) {
			const own = new Set((e.metadata.tags ?? []).map((t) => t.trim().toLowerCase()));
			for (const t of tags) if (!own.has(t)) return false; // AND across selected tags
		}
		return true;
	};

	const pool = entries.filter(passesFilters);
	const q = query.trim();
	if (!q) return pool;

	const ids = new Set(index.search(q).map((r) => r.item.id));
	return pool.filter((e) => ids.has(e.id));
}
