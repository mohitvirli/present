import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

// Phase 0 spike for shared entries — never shipped.
export const prerender = false;

export function load() {
	if (!dev) throw error(404, 'Not found');
}
