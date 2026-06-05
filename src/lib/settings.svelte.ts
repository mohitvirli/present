import { browser } from '$app/environment';

const KEY = 'present:ai-enabled';

// AI features are opt-in: off unless the user explicitly enabled them before.
function initial(): boolean {
	if (!browser) return false;
	return localStorage.getItem(KEY) === '1';
}

export const aiSettings = $state<{ enabled: boolean }>({ enabled: initial() });

export function setAiEnabled(on: boolean): void {
	aiSettings.enabled = on;
	if (browser) localStorage.setItem(KEY, on ? '1' : '0');
}
