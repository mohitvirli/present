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
			<a class="brand" href="/" aria-label="present — home">
				{#if isNew}
					<span class="brand-swap" in:fade={{ duration: 400, delay: 150 }}><Clock /></span>
				{:else}
					<span class="brand-swap" in:fade={{ duration: 300 }}>present</span>
				{/if}
			</a>
			{#if !isNew}
				<nav
					in:fly={{ x: 12, duration: 350, delay: 100, easing: cubicOut }}
					out:fly={{ x: 12, duration: 200, easing: cubicOut }}
				>
					<ThemeToggle />
					<a class="new-btn" href="/new">New entry</a>
				</nav>
			{/if}
		</div>
	</header>
	<main>{@render children()}</main>
</div>
