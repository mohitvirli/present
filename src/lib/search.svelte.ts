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
}>({
	open: false,
	query: '',
	tags: new SvelteSet<string>(),
	tone: null
});

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
