<script lang="ts">
	import { tick } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { SvelteSet } from 'svelte/reactivity';

	// height + opacity collapse: fading as it shrinks keeps the rail dots from
	// looking clipped when the list height animates to zero
	function collapse(node: HTMLElement, { duration = 280 } = {}) {
		const s = getComputedStyle(node);
		const h = node.scrollHeight;
		const pt = parseFloat(s.paddingTop);
		const pb = parseFloat(s.paddingBottom);
		return {
			duration,
			easing: cubicOut,
			css: (t: number) =>
				`overflow:hidden;opacity:${t};height:${t * h}px;padding-top:${t * pt}px;padding-bottom:${t * pb}px;`
		};
	}
	import gsap from 'gsap';
	import EntryCard from './EntryCard.svelte';
	import { gFade, gScaleY } from '$lib/transitions';
	import type { Entry } from '$lib/db';

	let { entries, loaded }: { entries: Entry[]; loaded: boolean } = $props();

	// days the user has collapsed (keyed by dayKey)
	let collapsed = $state(new SvelteSet<string>());
	function toggle(day: string) {
		if (collapsed.has(day)) collapsed.delete(day);
		else collapsed.add(day);
	}

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
			<li class="day-group" class:collapsed={collapsed.has(day)}>
				<h2 class="day-label">
					<button
						class="day-toggle"
						onclick={() => toggle(day)}
						aria-expanded={!collapsed.has(day)}
						aria-label={collapsed.has(day) ? `Expand ${dayLabel(day)}` : `Collapse ${dayLabel(day)}`}
					>
						<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
							<path
								d="M6 4l4 4-4 4"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>
					<span class="day-date">{dayLabel(day)}</span>
					<span class="day-count-inline"
						>{items.length} {items.length === 1 ? 'entry' : 'entries'}</span
					>
				</h2>
				<span class="day-count-rail"
					>{items.length} {items.length === 1 ? 'entry' : 'entries'}</span
				>
				{#if !collapsed.has(day)}
					<ul transition:collapse>
						{#each items as entry (entry.id)}
							<li class="entry-row">
								<EntryCard {entry} />
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ol>
{/if}
