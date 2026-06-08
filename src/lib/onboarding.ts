// First-run flag. Persisted separately from entries so that deleting every
// entry never re-triggers the tutorial seed.

const KEY = 'present:onboarded';

export function hasOnboarded(): boolean {
	if (typeof localStorage === 'undefined') return true; // SSR: assume returning
	try {
		return localStorage.getItem(KEY) === '1';
	} catch {
		return true; // storage blocked → don't seed repeatedly
	}
}

export function markOnboarded(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(KEY, '1');
	} catch {
		/* ignore */
	}
}

// Tracks whether the user has written their own first entry. `onboarded` is set
// the moment the seeded timeline is shown, so it can't gate the composer's
// first-run placeholder — this flag flips only on a real save.
const FIRST_ENTRY_KEY = 'present:first-entry';

export function hasWrittenEntry(): boolean {
	if (typeof localStorage === 'undefined') return true; // SSR: assume returning
	try {
		return localStorage.getItem(FIRST_ENTRY_KEY) === '1';
	} catch {
		return true;
	}
}

export function markEntryWritten(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(FIRST_ENTRY_KEY, '1');
	} catch {
		/* ignore */
	}
}
