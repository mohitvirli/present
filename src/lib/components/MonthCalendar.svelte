<script lang="ts">
	import type { Entry } from '$lib/db';
	import { gFade } from '$lib/transitions';
	import gsap from 'gsap';

	// Desktop-only month grid in the right gutter (CSS hides it < 1240px).
	// Days with entries carry the rail's hollow-dot mark and jump the timeline
	// to that day; the shown month follows the scroll via syncTo() unless the
	// user just paged with the arrows.
	let { entries, onJump }: { entries: Entry[]; onJump: (dayKey: string) => void } = $props();

	// UTC ISO keys throughout — must match the timeline's dayKey() grouping
	const todayKey = new Date().toISOString().slice(0, 10);
	let viewMonth = $state(todayKey.slice(0, 7)); // 'YYYY-MM'
	let manualUntil = 0; // arrow navigation pauses scroll-sync briefly

	const dayCounts = $derived.by(() => {
		const m = new Map<string, number>();
		for (const e of entries) {
			const k = new Date(e.createdAt).toISOString().slice(0, 10);
			m.set(k, (m.get(k) ?? 0) + 1);
		}
		return m;
	});

	const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

	const cells = $derived.by(() => {
		const y = Number(viewMonth.slice(0, 4));
		const mo = Number(viewMonth.slice(5, 7));
		const lead = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(); // Sunday-first
		const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
		const out: ({ key: string; n: number } | null)[] = Array(lead).fill(null);
		for (let d = 1; d <= days; d++)
			out.push({ key: `${viewMonth}-${String(d).padStart(2, '0')}`, n: d });
		return out;
	});

	const title = $derived.by(() => {
		// construct from parts — new Date('2026-06') parses as UTC midnight and
		// could render the previous month in negative-offset timezones
		const d = new Date(Number(viewMonth.slice(0, 4)), Number(viewMonth.slice(5, 7)) - 1, 1);
		return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
	});

	// direction of the last month change, for the title's slide: 1 = forward
	// in time, -1 = back — set before every viewMonth write
	let dir = 0;

	function setMonth(key: string) {
		dir = key === viewMonth ? 0 : key > viewMonth ? 1 : -1;
		viewMonth = key;
	}

	function step(delta: number) {
		const d = new Date(
			Date.UTC(Number(viewMonth.slice(0, 4)), Number(viewMonth.slice(5, 7)) - 1 + delta, 1)
		);
		setMonth(d.toISOString().slice(0, 7));
		manualUntil = performance.now() + 3000;
	}

	function goToday() {
		setMonth(todayKey.slice(0, 7));
		manualUntil = performance.now() + 3000;
		// today has entries → take the timeline along
		if (dayCounts.has(todayKey)) onJump(todayKey);
	}

	// parent calls this as day groups scroll past the header
	export function syncTo(monthKey: string) {
		if (performance.now() < manualUntil) return;
		if (monthKey !== viewMonth) setMonth(monthKey);
	}

	// Staggered cell entrance: a soft pop rippling across the grid — full ease
	// on first load (after the aside's gFade delay), and again on every month
	// change with the title sliding in from the travel direction.
	let gridEl = $state<HTMLElement | null>(null);
	let titleEl = $state<HTMLElement | null>(null);
	let firstRun = true;

	$effect(() => {
		void viewMonth;
		const grid = gridEl;
		if (!grid) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const cells = grid.querySelectorAll('.cal-day:not(.blank)');
		if (!cells.length) return;
		gsap.killTweensOf(cells);
		// fade each cell up to its own stylesheet opacity (empty days sit at
		// 0.5) — tweening to 1 made them land dark, then snap muted on clearProps
		const finalAlpha = [...cells].map((el) => parseFloat(getComputedStyle(el).opacity));
		gsap.fromTo(
			cells,
			{ autoAlpha: 0, y: 5, scale: 0.85 },
			{
				autoAlpha: (i: number) => finalAlpha[i],
				y: 0,
				scale: 1,
				duration: 0.32,
				ease: 'power2.out',
				stagger: 0.012,
				delay: firstRun ? 0.4 : 0,
				clearProps: 'all'
			}
		);
		if (!firstRun && titleEl) {
			gsap.killTweensOf(titleEl);
			gsap.fromTo(
				titleEl,
				{ autoAlpha: 0, x: 10 * dir },
				{ autoAlpha: 1, x: 0, duration: 0.28, ease: 'power2.out', clearProps: 'all' }
			);
		}
		firstRun = false;
	});
</script>

<aside class="month-cal" aria-label="Calendar" in:gFade={{ duration: 0.5, delay: 0.35 }}>
	<div class="cal-head">
		<span class="cal-title" bind:this={titleEl}>{title}</span>
		<span class="cal-nav">
			{#if viewMonth !== todayKey.slice(0, 7)}
				<button type="button" aria-label="Back to today" title="Back to today" onclick={goToday}>
					<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
						<circle
							cx="8"
							cy="8"
							r="5.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
						/>
						<circle cx="8" cy="8" r="1.6" fill="currentColor" />
					</svg>
				</button>
			{/if}
			<button type="button" aria-label="Previous month" onclick={() => step(-1)}>
				<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
					<path
						d="M10 3 5 8l5 5"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
			<button type="button" aria-label="Next month" onclick={() => step(1)}>
				<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
					<path
						d="m6 3 5 5-5 5"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
		</span>
	</div>
	<div class="cal-grid" bind:this={gridEl}>
		{#each DOW as d, i (i)}
			<span class="cal-dow" aria-hidden="true">{d}</span>
		{/each}
		{#each cells as cell, i (viewMonth + i)}
			{#if !cell}
				<span class="cal-day blank"></span>
			{:else}
				{@const count = dayCounts.get(cell.key) ?? 0}
				{#if count > 0}
					<button
						type="button"
						class="cal-day has heat-{Math.min(count, 4)}"
						class:today={cell.key === todayKey}
						title={`${count} ${count === 1 ? 'entry' : 'entries'}`}
						aria-label={`Jump to ${cell.key}`}
						onclick={() => onJump(cell.key)}
					>
						{cell.n}
					</button>
				{:else}
					<span class="cal-day" class:today={cell.key === todayKey}>{cell.n}</span>
				{/if}
			{/if}
		{/each}
	</div>
</aside>
