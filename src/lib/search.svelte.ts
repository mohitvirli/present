import { goto } from '$app/navigation';
import { SvelteSet } from 'svelte/reactivity';

// Valence of the AI-analyzed dominant emotion. Mirrors EntryMetadata.aiTone —
// the only mood-like field entries actually carry (metadata.mood is unused).
export type Tone = 'positive' | 'neutral' | 'negative';

// Shared search state so the topbar (layout) can drive filtering of the
// timeline (home page) without prop drilling — same pattern as composer/scroll.
export const search = $state<{
	open: boolean; // search bar expanded in the topbar
	query: string; // raw text query (fuzzy-matched)
	tags: SvelteSet<string>; // active tag filters, lowercased keys, AND semantics
	tone: Tone | null; // aiTone filter, null = any
	matches: number; // entries passing the current search (timeline reports it)
	total: number; // entries in the journal
}>({
	open: false,
	query: '',
	tags: new SvelteSet<string>(),
	tone: null,
	matches: 0,
	total: 0
});

// --- recent searches -------------------------------------------------------
// Per-device convenience only, so localStorage (wrapped — it can throw in
// private windows). Newest first, deduped, capped.
export interface RecentSearch {
	query: string;
	tags: string[];
	tone: Tone | null;
}

const RECENTS_KEY = 'present.search.recents';
const RECENTS_MAX = 4;

function loadRecents(): RecentSearch[] {
	try {
		const raw = localStorage.getItem(RECENTS_KEY);
		return raw ? (JSON.parse(raw) as RecentSearch[]) : [];
	} catch {
		return [];
	}
}

export const recents = $state<{ list: RecentSearch[] }>({
	list: typeof localStorage === 'undefined' ? [] : loadRecents()
});

const recentKey = (r: RecentSearch) =>
	[r.query.trim().toLowerCase(), [...r.tags].sort().join(','), r.tone ?? ''].join('|');

// Snapshot the current search into recents (no-op when nothing is engaged).
export function rememberSearch() {
	if (!searchActive()) return;
	const entry: RecentSearch = {
		query: search.query.trim(),
		tags: [...search.tags],
		tone: search.tone
	};
	const key = recentKey(entry);
	recents.list = [entry, ...recents.list.filter((r) => recentKey(r) !== key)].slice(0, RECENTS_MAX);
	try {
		localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.list));
	} catch {
		// storage unavailable — recents just won't persist
	}
}

export function applySearch(r: RecentSearch) {
	search.query = r.query;
	search.tags.clear();
	for (const t of r.tags) search.tags.add(t);
	search.tone = r.tone;
}

// true while any query/filter is engaged — drives the no-match empty state
// (vs. the first-run "Nothing here yet") and the Clear affordance
export function searchActive(): boolean {
	return search.query.trim().length > 0 || search.tags.size > 0 || search.tone != null;
}

export function clearSearch() {
	search.query = '';
	search.tags.clear();
	search.tone = null;
}

// Tag chips anywhere (timeline cards, entry view) jump to the timeline
// filtered to that tag — replaces any in-flight search so the result is
// unambiguous: "show me everything tagged X".
export function filterByTag(tag: string) {
	clearSearch();
	search.tags.add(tag.trim().toLowerCase());
	search.open = true;
	// Already on the timeline → just filter in place. A same-URL goto() still
	// runs the navigation lifecycle, and the timeline's onNavigate exit
	// animation fades every row out — with no remount to bring them back.
	if (window.location.pathname !== '/') void goto('/');
}
