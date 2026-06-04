<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import favicon from '$lib/assets/favicon.svg';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import Clock from '$lib/components/Clock.svelte';
	let { children } = $props();

	let isNew = $derived(page.url.pathname === '/new');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="shell">
	<header class="topbar">
		<div class="topbar-inner">
			{#if isNew}
				<a class="brand" href="/" aria-label="present — home" in:fade={{ duration: 400, delay: 150 }}>
					<Clock />
				</a>
			{:else}
				<a class="cta" href="/new" in:fade={{ duration: 300 }}>
					Be Present <span class="cta-plus" aria-hidden="true">+</span>
				</a>
			{/if}
			{#if !isNew}
				<nav
					in:fly={{ x: 12, duration: 350, delay: 100, easing: cubicOut }}
					out:fly={{ x: 12, duration: 200, easing: cubicOut }}
				>
					<ThemeToggle />
				</nav>
			{/if}
		</div>
	</header>
	<main>{@render children()}</main>
</div>
