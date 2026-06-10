/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `present-cache-${version}`;

// App shell: built JS/CSS chunks + static assets (icons, fonts, manifest).
const ASSETS = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(ASSETS);
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;

	// Only handle same-origin GET. Never touch API/auth/server functions —
	// Supabase, AI, Deepgram, WebAuthn all go straight to network.
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== location.origin) return;
	if (url.pathname.startsWith('/api/')) return;

	// Cache-first for fingerprinted build assets and static files.
	if (ASSETS.includes(url.pathname)) {
		event.respondWith(
			(async () => {
				const cached = await caches.match(request);
				return cached ?? fetch(request);
			})()
		);
		return;
	}

	// Network-first for navigations; cache the served HTML so the app opens
	// offline after the first visit, falling back to the cached shell.
	if (request.mode === 'navigate') {
		event.respondWith(
			(async () => {
				try {
					const fresh = await fetch(request);
					const cache = await caches.open(CACHE);
					cache.put(request, fresh.clone());
					return fresh;
				} catch {
					const cached = (await caches.match(request)) ?? (await caches.match('/'));
					return cached ?? Response.error();
				}
			})()
		);
	}
});
