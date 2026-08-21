import { dev } from '$app/environment';
import { injectAnalytics } from '@vercel/analytics/sveltekit';

injectAnalytics({ mode: dev ? 'development' : 'production' });

// Client-only app (all data lives in IndexedDB) — no SSR, prerender static
// shells. Avoids server-side rendering errors and serverless functions.
export const ssr = false;
export const prerender = true;
