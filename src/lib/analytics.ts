import { browser, dev } from '$app/environment';

// Google Analytics 4 measurement id. Public by design — it identifies the
// property, it isn't a secret.
const GA_ID = 'G-DN2JFVEKY5';

declare global {
	interface Window {
		dataLayer: unknown[];
		gtag: (...args: unknown[]) => void;
	}
}

let started = false;

/**
 * Load gtag.js once, on the client, in production only.
 *
 * Automatic page_view is turned off: the app is a client-rendered SPA, so
 * gtag's own view tracking would only ever fire on the initial load. Views are
 * sent from trackPageView() after every navigation instead.
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
}

/**
 * Report one page view.
 *
 * Only the pathname is sent. Entry URLs carry an ?id= for a private journal
 * entry, and the tab title carries an entry's date and time — neither belongs
 * in an analytics payload, so both are dropped in favour of the route.
 */
export function trackPageView(url: URL): void {
	if (!browser || dev || !started || typeof window.gtag !== 'function') return;
	const path = url.pathname;
	window.gtag('event', 'page_view', {
		page_path: path,
		page_location: url.origin + path,
		page_title: path
	});
}
