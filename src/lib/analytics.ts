import { browser, dev } from '$app/environment';

// Google Analytics 4 measurement id. Public by design — it identifies the
// property, it isn't a secret.
const GA_ID = 'G-DN2JFVEKY5';

// Umami website id + script. Both public; set at build time. Without an id,
// Umami is skipped. The script defaults to Umami Cloud — point it at a
// self-hosted instance's /script.js to use that instead.
const UMAMI_ID: string | undefined = import.meta.env.VITE_UMAMI_WEBSITE_ID;
const UMAMI_SRC: string = import.meta.env.VITE_UMAMI_SRC || 'https://cloud.umami.is/script.js';

type UmamiPayload = Record<string, unknown>;
type Umami = { track: (fn: (props: UmamiPayload) => UmamiPayload) => void };

declare global {
	interface Window {
		dataLayer: unknown[];
		gtag: (...args: unknown[]) => void;
		umami?: Umami;
	}
}

/** Event names we report. Keep payloads free of journal content. */
export type AnalyticsEvent =
	| 'entry_created'
	| 'entry_deleted'
	| 'entry_shared'
	| 'export'
	| 'import';

let started = false;
// Umami calls made before its script finishes loading; flushed on load.
let umamiQueue: ((u: Umami) => void)[] = [];

/**
 * Load gtag.js and Umami once, on the client, in production only.
 *
 * Automatic page views are off for both: the app is a client-rendered SPA, so
 * views are sent from trackPageView() after every navigation instead.
 */
export function initAnalytics(): void {
	if (!browser || dev || started) return;
	started = true;

	window.dataLayer = window.dataLayer || [];
	// gtag.js reads this back as an array-like, so push `arguments` verbatim
	window.gtag = function gtag() {
		// eslint-disable-next-line prefer-rest-params
		window.dataLayer.push(arguments);
	};

	window.gtag('js', new Date());
	window.gtag('config', GA_ID, { send_page_view: false });

	const s = document.createElement('script');
	s.async = true;
	s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
	document.head.appendChild(s);

	if (UMAMI_ID) {
		const u = document.createElement('script');
		u.defer = true;
		u.src = UMAMI_SRC;
		u.dataset.websiteId = UMAMI_ID;
		u.dataset.autoTrack = 'false';
		// entry URLs carry ?id= for a private entry — never send it
		u.dataset.excludeSearch = 'true';
		u.dataset.excludeHash = 'true';
		u.onload = () => {
			const umami = window.umami;
			if (umami) umamiQueue.forEach((fn) => fn(umami));
			umamiQueue = [];
		};
		document.head.appendChild(u);
	}
}

// Every Umami payload goes through here: url and title are forced to the bare
// path, since the tab title carries an entry's date and time.
function umami(extra: UmamiPayload = {}): void {
	if (!UMAMI_ID) return;
	const path = location.pathname;
	const send = (u: Umami) => u.track((props) => ({ ...props, url: path, title: path, ...extra }));
	if (window.umami) send(window.umami);
	else umamiQueue.push(send);
}

/**
 * Report one page view.
 *
 * Only the pathname is sent. Entry URLs carry an ?id= for a private journal
 * entry, and the tab title carries an entry's date and time — neither belongs
 * in an analytics payload, so both are dropped in favour of the route.
 */
export function trackPageView(url: URL): void {
	if (!browser || dev || !started) return;
	const path = url.pathname;
	if (typeof window.gtag === 'function') {
		window.gtag('event', 'page_view', {
			page_path: path,
			page_location: url.origin + path,
			page_title: path
		});
	}
	umami();
}

/**
 * Report one product event. `data` must never hold entry text, titles, tags or
 * places — counts and enum-like values only.
 */
export function track(
	name: AnalyticsEvent,
	data?: Record<string, string | number | boolean>
): void {
	if (!browser || dev || !started) return;
	if (typeof window.gtag === 'function') window.gtag('event', name, data ?? {});
	umami(data ? { name, data } : { name });
}
