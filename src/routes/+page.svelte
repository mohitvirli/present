<script lang="ts">
	import { onMount } from 'svelte';
	import { onNavigate } from '$app/navigation';
	import gsap from 'gsap';
	import { listEntries, type Entry } from '$lib/db';
	import Timeline from '$lib/components/Timeline.svelte';

	let entries = $state<Entry[]>([]);
	let loaded = $state(false);

	onMount(async () => {
		entries = await listEntries();
		loaded = true;
	});

	// exit animation when leaving the timeline (SvelteKit awaits this promise
	// before tearing the page down, so GSAP can play before unmount)
	onNavigate(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const rows = Array.from(document.querySelectorAll('.entry-row'));
		const labels = Array.from(document.querySelectorAll('.day-label'));
		const rail = document.querySelector('.rail');
		const header = Array.from(document.querySelectorAll('.topbar-inner > *'));
		if (!rows.length && !rail) return;

		return new Promise<void>((resolve) => {
			const tl = gsap.timeline({ onComplete: resolve, defaults: { ease: 'power2.in' } });
			tl.to(header, { y: -8, autoAlpha: 0, duration: 0.26, stagger: 0.06 }, 0);
			tl.to(rows, { y: -10, autoAlpha: 0, duration: 0.28, stagger: 0.015 }, 0);
			tl.to(labels, { x: -8, autoAlpha: 0, duration: 0.24 }, 0);
			if (rail) tl.to(rail, { scaleY: 0, autoAlpha: 0, transformOrigin: 'top center', duration: 0.32 }, 0);
			// safety: never block navigation longer than ~500ms
			gsap.delayedCall(0.5, resolve);
		});
	});
</script>

<div class="home">
	<Timeline {entries} {loaded} />
</div>
