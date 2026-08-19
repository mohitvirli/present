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

export interface PaletteDef {
	id: string;
	name: string;
	light: ThemeId;
	dark: ThemeId;
}

// Auto mode swaps between the two halves of a palette, so the colour never
// changes — only the mode. The settings grid shows these instead of the six
// themes while auto is on.
export const PALETTES: PaletteDef[] = [
	{ id: 'claude', name: 'Claude', light: 'light', dark: 'dark' },
	{ id: 'sage', name: 'Sage', light: 'sage', dark: 'sage-dark' },
	{ id: 'sky', name: 'Sky', light: 'sky', dark: 'deep' }
];

const IDS = THEMES.map((t) => t.id);

// the other half of each palette — mirrored by the pre-hydration script in app.html
const PAIR: Record<ThemeId, ThemeId> = Object.fromEntries(
	PALETTES.flatMap((p) => [
		[p.light, p.dark],
		[p.dark, p.light]
	])
) as Record<ThemeId, ThemeId>;

const MODE = new Map<ThemeId, 'light' | 'dark'>(THEMES.map((t) => [t.id, t.mode]));

export const THEME_BY_ID = new Map<ThemeId, ThemeDef>(THEMES.map((t) => [t.id, t]));

const KEY = 'present:theme';
const AUTO_KEY = 'present:theme-auto';

const DEFAULT: ThemeId = 'sky';

// Day runs 06:00–17:59 local; the rest of the clock is night. Mirrored by the
// pre-hydration script in app.html — keep the two in step.
export function isNight(at: Date = new Date()): boolean {
	const h = at.getHours();
	return h < 6 || h >= 18;
}

// the half of `id`'s palette that matches `mode`
function half(id: ThemeId, mode: 'light' | 'dark'): ThemeId {
	return MODE.get(id) === mode ? id : PAIR[id];
}

function initialTheme(): ThemeId {
	if (!browser) return DEFAULT;
	const v = localStorage.getItem(KEY) as ThemeId | null;
	return v && IDS.includes(v) ? v : DEFAULT;
}

function initialAuto(): boolean {
	if (!browser) return false;
	return localStorage.getItem(AUTO_KEY) === '1';
}

const stored = initialTheme();
const auto = initialAuto();

export const theme = $state<{ value: ThemeId; auto: boolean }>({
	value: auto ? half(stored, isNight() ? 'dark' : 'light') : stored,
	auto
});

// the half of the selected palette auto mode should be showing right now
function resolved(): ThemeId {
	return half(theme.value, isNight() ? 'dark' : 'light');
}

function apply(id: ThemeId): void {
	theme.value = id;
	if (!browser) return;
	document.documentElement.setAttribute('data-theme', id);
	const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim();
	const meta = document.querySelector('meta[name="theme-color"]');
	if (bg && meta) meta.setAttribute('content', bg);
}

export function setTheme(id: ThemeId): void {
	// Picking a card picks its palette. With auto on, the clock decides which
	// half of that palette is showing.
	const next = theme.auto ? half(id, isNight() ? 'dark' : 'light') : id;
	if (browser) localStorage.setItem(KEY, next);
	apply(next);
}

export function setAutoTheme(on: boolean): void {
	theme.auto = on;
	if (browser) localStorage.setItem(AUTO_KEY, on ? '1' : '0');
	if (!on) return;
	const next = resolved();
	if (browser) localStorage.setItem(KEY, next);
	apply(next);
}

// Watch the clock so the theme flips at the day/night boundary without a
// reload. Returns a cleanup function.
export function initTheme(): () => void {
	if (!browser) return () => {};

	const check = () => {
		if (!theme.auto) return;
		const next = resolved();
		if (next === theme.value) return;
		localStorage.setItem(KEY, next);
		apply(next);
	};

	check();
	const timer = setInterval(check, 60_000);
	document.addEventListener('visibilitychange', check);

	return () => {
		clearInterval(timer);
		document.removeEventListener('visibilitychange', check);
	};
}
