<script lang="ts">
	import { tick } from 'svelte';
	import gsap from 'gsap';
	import EntryCard from './EntryCard.svelte';
	import { gFade, gScaleY } from '$lib/transitions';
	import type { Entry } from '$lib/db';

	let { entries, loaded }: { entries: Entry[]; loaded: boolean } = $props();

	let timelineEl = $state<HTMLElement | null>(null);
	let animated = false;

	function dayKey(ts: number): string {
		return new Date(ts).toISOString().slice(0, 10);
	}

	function dayLabel(key: string): string {
		const today = new Date().toISOString().slice(0, 10);
		const yest = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
		if (key === today) return 'Today';
		if (key === yest) return 'Yesterday';
		return new Date(key).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		});
	}

	const groups = $derived.by(() => {
		const map = new Map<string, Entry[]>();
		for (const e of entries) {
			const k = dayKey(e.createdAt);
			if (!map.has(k)) map.set(k, []);
			map.get(k)!.push(e);
		}
		return [...map.entries()];
	});

	// imperative GSAP entrance once entries are rendered (Svelte's nested
	// intro transitions are unreliable here, so we drive it directly)
	$effect(() => {
		if (animated || !loaded || !entries.length) return;
		animated = true;
		tick().then(() => {
			const root = timelineEl;
			if (!root) return;
			if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
			gsap.from(root.querySelectorAll('.day-label'), {
				x: -8,
				autoAlpha: 0,
				duration: 0.5,
				ease: 'power3.out',
				delay: 0.15,
				stagger: 0.045
			});
			gsap.from(root.querySelectorAll('.entry-row'), {
				y: 14,
				autoAlpha: 0,
				duration: 0.55,
				ease: 'power3.out',
				delay: 0.2,
				stagger: 0.045
			});
		});
	});
</script>

{#if !loaded}
	<p class="muted">Loading…</p>
{:else if entries.length === 0}
	<div class="timeline-empty" in:gFade={{ duration: 0.5, delay: 0.1 }}>
		<p>Nothing here yet.</p>
		<a class="empty-cta" href="/entry">Write your first entry</a>
	</div>
{:else}
	<ol class="timeline" bind:this={timelineEl}>
		<li class="rail" aria-hidden="true" in:gScaleY={{ duration: 0.8 }}></li>
		{#each groups as [day, items] (day)}
			<li class="day-group">
				<h2 class="day-label">{dayLabel(day)}</h2>
				<ul>
					{#each items as entry (entry.id)}
						<li class="entry-row">
							<EntryCard {entry} />
						</li>
					{/each}
				</ul>
			</li>
		{/each}
	</ol>
{/if}
