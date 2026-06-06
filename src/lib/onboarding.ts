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
