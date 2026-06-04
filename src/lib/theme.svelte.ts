import { browser } from '$app/environment';

export type Theme = 'light' | 'dark';
const KEY = 'present:theme';

function initial(): Theme {
	if (!browser) return 'light';
	const saved = localStorage.getItem(KEY);
	if (saved === 'light' || saved === 'dark') return saved;
	return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const theme = $state<{ value: Theme }>({ value: initial() });

export function toggleTheme(): void {
	theme.value = theme.value === 'dark' ? 'light' : 'dark';
	if (browser) {
		localStorage.setItem(KEY, theme.value);
		document.documentElement.setAttribute('data-theme', theme.value);
	}
}
