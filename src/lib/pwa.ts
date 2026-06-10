import { browser } from '$app/environment';

// Detect whether the app is running as an installed PWA (standalone window)
// rather than inside a normal browser tab.
export function isStandalone(): boolean {
	if (!browser) return false;
	return (
		window.matchMedia?.('(display-mode: standalone)').matches ||
		// iOS Safari home-screen apps
		(navigator as unknown as { standalone?: boolean }).standalone === true
	);
}

// One-shot launch token. The module is cached across in-app (SPA) navigations
// but re-evaluated on a real cold start, so this is true exactly once per app
// launch. Used so the PWA's start_url ("/") redirects to the composer on launch
// without trapping the user when they navigate back to the timeline later.
let launchPending = true;

export function consumeLaunch(): boolean {
	const v = launchPending;
	launchPending = false;
	return v;
}
