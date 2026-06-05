import { dev } from '$app/environment';
import { injectAnalytics } from '@vercel/analytics/sveltekit';

// Client-only app (all data lives in IndexedDB) — no SSR, prerender static
// shells. Avoids server-side rendering errors and serverless functions.
export const ssr = false;
export const prerender = true;

// Initialize Vercel Web Analytics
injectAnalytics({ mode: dev ? 'development' : 'production' });
