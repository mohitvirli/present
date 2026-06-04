import { browser } from '$app/environment';

export type ThemeId = 'light' | 'sage' | 'sky' | 'dark' | 'deep' | 'sage-dark';

export interface ThemeDef {
	id: ThemeId;
	name: string;
	mode: 'light' | 'dark';
	swatches: [string, string, string, string, string];
}

// order = display order in the settings grid
export const THEMES: ThemeDef[] = [
	{ id: 'light', name: 'Claude Light', mode: 'light', swatches: ['#d97757', '#f5e4dc', '#e8e5dc', '#a3a097', '#1f1e1d'] },
	{ id: 'dark', name: 'Claude Dark', mode: 'dark', swatches: ['#e0866a', '#3a2e28', '#3d3a35', '#a3a097', '#262624'] },
	{ id: 'sage', name: 'Sage Light', mode: 'light', swatches: ['#7a9b76', '#a9c0a3', '#d9dcc9', '#b9bdb0', '#3a3f38'] },
	{ id: 'sage-dark', name: 'Sage Dark', mode: 'dark', swatches: ['#92ab83', '#5f7259', '#373d36', '#272b27', '#161816'] },
	{ id: 'sky', name: 'Sky Light', mode: 'light', swatches: ['#5b8fb9', '#9cc0db', '#dbe6ef', '#aeb8c2', '#2c3744'] },
	{ id: 'deep', name: 'Deep Blue', mode: 'dark', swatches: ['#6c93c4', '#4f6a8f', '#333b47', '#262b33', '#15181c'] }
];

const IDS = THEMES.map((t) => t.id);
const KEY = 'present:theme';

function initial(): ThemeId {
	if (!browser) return 'light';
	const saved = localStorage.getItem(KEY) as ThemeId | null;
	if (saved && IDS.includes(saved)) return saved;
	return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const theme = $state<{ value: ThemeId }>({ value: initial() });

export function setTheme(id: ThemeId): void {
	theme.value = id;
	if (browser) {
		localStorage.setItem(KEY, id);
		document.documentElement.setAttribute('data-theme', id);
	}
}
