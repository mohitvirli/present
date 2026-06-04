<script lang="ts">
	import { theme, toggleTheme } from '$lib/theme.svelte';
</script>

<button
	class="theme-toggle"
	onclick={toggleTheme}
	aria-label="Toggle light/dark theme"
	title={theme.value === 'dark' ? 'Switch to light' : 'Switch to dark'}
>
	{theme.value === 'dark' ? '☀' : '☾'}
</button>

<style>
	.theme-toggle {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
		width: 34px;
		height: 34px;
		border-radius: 999px;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
	}
	.theme-toggle:hover {
		background: var(--color-surface-2);
	}
</style>
