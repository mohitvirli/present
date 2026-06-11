<script lang="ts">
	import type { Entry } from '$lib/db';
	import { clearSearch } from '$lib/search.svelte';
	import { gFade, gScaleY } from '$lib/transitions';
	import gsap from 'gsap';
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import { SvelteSet } from 'svelte/reactivity';
	import EntryCard from './EntryCard.svelte';

	// height + opacity collapse: fading as it shrinks keeps the rail dots from
	// looking clipped when the list height animates to zero
	function collapse(node: HTMLElement, { duration = 280 } = {}) {
		const s = getComputedStyle(node);
		const h = node.scrollHeight;
		const pt = parseFloat(s.paddingTop);
		const pb = parseFloat(s.paddingBottom);
		// margins too — .day-group carries margin-bottom, and leaving it static
		// makes the layout snap by that amount the moment the node is removed
		const mt = parseFloat(s.marginTop);
		const mb = parseFloat(s.marginBottom);
		return {
			duration,
			easing: cubicOut,
			css: (t: number) =>
				`overflow:hidden;opacity:${t};height:${t * h}px;padding-top:${t * pt}px;padding-bottom:${t * pb}px;margin-top:${t * mt}px;margin-bottom:${t * mb}px;`
		};
	}

	let {
		entries,
		loaded,
		searching = false,
		onTogglePin
	}: {
		entries: Entry[];
		loaded: boolean;
		searching?: boolean; // a search/filter is active — changes the empty state
		onTogglePin: (entry: Entry) => void;
	} = $props();

	// pinned entries surface in a dedicated group above the day groups (the
	// entry also stays in its day group). listEntries order — no special sort.
	const pinned = $derived(entries.filter((e) => e.metadata.pinned));
	// reserved collapse key for the Pinned group — safe, real keys are ISO dates
	const PINNED_KEY = '__pinned__';

	// days the user has collapsed (keyed by dayKey) — kept in sessionStorage so
	// the choice survives reloads and route round-trips, but resets next session
	const COLLAPSED_KEY = 'present:collapsed-days';
	function readCollapsed(): string[] {
		try {
			return JSON.parse(sessionStorage.getItem(COLLAPSED_KEY) ?? '[]');
		} catch {
			return [];
		}
	}
	let collapsed = $state(new SvelteSet<string>(readCollapsed()));
	function toggle(day: string) {
		if (collapsed.has(day)) collapsed.delete(day);
		else collapsed.add(day);
		sessionStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
	}

	let timelineEl = $state<HTMLElement | null>(null);
	let cursorEl = $state<HTMLElement | null>(null);
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
			// opacity (not autoAlpha): autoAlpha sets visibility:hidden during the
			// delay + stagger, which makes the rows non-clickable for up to a
			// second after landing on the timeline. opacity:0 elements still
			// receive pointer events, so the list stays interactive while it fades.
			gsap.from(root.querySelectorAll('.day-label'), {
				x: -8,
				opacity: 0,
				duration: 0.5,
				ease: 'power3.out',
				delay: 0.15
			});
			gsap.from(root.querySelectorAll('.entry-row'), {
				y: 14,
				opacity: 0,
				duration: 0.55,
				ease: 'power3.out',
				delay: 0.2
			});
		});
	});

	// Magnetic rail cursor: a dot pinned to the timeline spine that trails the
	// pointer's Y and snaps onto the nearest entry node when close — so it reads
	// as part of the rail, not a free-floating dot. Driven by rAF and written
	// straight to the DOM (no per-move reactive churn), lerped for a smooth trail.
	$effect(() => {
		const el = cursorEl;
		if (!el || !timelineEl) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		// touch devices: no trailing pointer, so skip the rAF loop + listeners
		if (window.matchMedia('(pointer: coarse)').matches) return;

		const SNAP = 40; // px: within this of a node, magnetize onto it
		let targetY = 0;
		let curY = 0;
		let active = false;
		let primed = false;
		let bursting = false;
		let raf = 0;

		// the node dot is a ::before at top:0.27rem, height 9px — measure its
		// real centre offset once (don't hardcode px: it scales with root font-size)
		let nodeOffset = 9;
		const probe = timelineEl.querySelector('.entry-card');
		if (probe) {
			const b = getComputedStyle(probe, '::before');
			const t = parseFloat(b.top);
			const h = parseFloat(b.height);
			if (!Number.isNaN(t) && !Number.isNaN(h)) nodeOffset = t + h / 2;
		}

		const nodeYs = () =>
			[...timelineEl!.querySelectorAll<HTMLElement>('.entry-card')].map(
				(c) => c.getBoundingClientRect().top + nodeOffset
			);

		const onMove = (e: PointerEvent) => {
			targetY = e.clientY;
			if (!primed) {
				curY = targetY;
				primed = true;
			}
			if (!active) {
				active = true;
				el.classList.add('visible');
			}
		};
		const onLeave = () => {
			active = false;
			el.classList.remove('visible', 'magnet');
		};

		// clicking Be Present morphs the cursor into the composer caret; opening
		// an entry pops the dot softly (scale + fade, no ring) as the page leaves
		const endPop = () => {
			el.classList.remove('pop', 'visible', 'magnet');
			bursting = false;
			active = false; // reappears on the next pointer move
		};
		const onClick = (e: MouseEvent) => {
			const hit = (e.target as HTMLElement | null)?.closest('a, button');
			if (!hit || bursting) return;
			// tag chips filter the timeline in place — no navigation, no pop
			if ((e.target as HTMLElement).closest('.tag')) return;
			// Be Present → drop the original dot down to the composer input line
			// before the page navigates away. Freeze the rAF loop so it doesn't
			// fight the tween, then slide curY down and fade.
			if (hit.closest('.cta') && el.classList.contains('visible')) {
				bursting = true; // stop frame() from overwriting the transform
				// morph into the actual editor caret: ~2px wide, one line-box tall
				gsap.to(el, {
					width: 1,
					height: 27,
					borderRadius: 1,
					duration: 0.3,
					ease: 'power3.inOut'
				});
				const proxy = { y: curY };
				gsap.to(proxy, {
					// land on the composer's first editor line. The rail column and the
					// composer share the same centred axis, so X already matches; this is
					// the caret's Y (paragraph top ~159 + half a line), a layout constant
					// that doesn't move with viewport width.
					y: 180,
					duration: 0.4,
					ease: 'power3.inOut',
					onUpdate: () => {
						el.style.transform = `translate(-50%, calc(${proxy.y}px - 50%))`;
					},
					// fade only once it has finished sliding down
					onComplete: () => gsap.to(el, { autoAlpha: 0, duration: 0.25, ease: 'power1.in' })
				});
				return;
			}
			// entry card → quick soft pop where the dot sits
			if (hit.closest('.entry-card') && el.classList.contains('visible')) {
				bursting = true; // freeze frame() so the dot pops in place
				el.classList.add('pop');
				// animationend normally clears it, but the rail can be hidden
				// mid-pop (route change) — timeout fallback guarantees cleanup
				el.addEventListener('animationend', endPop, { once: true });
				setTimeout(endPop, 500);
			}
		};

		const frame = () => {
			raf = requestAnimationFrame(frame);
			if (!active || bursting) return;
			let goal = targetY;
			let nearest = Infinity;
			for (const y of nodeYs()) {
				const d = Math.abs(y - targetY);
				if (d < nearest) {
					nearest = d;
					if (d < SNAP) goal = y;
				}
			}
			curY += (goal - curY) * 0.25;
			// -50% on both axes keeps the element centred on (rail x, curY)
			// regardless of whether it's the tall bar or the snapped dot
			el.style.transform = `translate(-50%, calc(${curY}px - 50%))`;
			el.classList.toggle('magnet', nearest < SNAP);
		};

		window.addEventListener('pointermove', onMove);
		document.addEventListener('pointerleave', onLeave);
		document.addEventListener('click', onClick, true);
		raf = requestAnimationFrame(frame);

		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerleave', onLeave);
			document.removeEventListener('click', onClick, true);
		};
	});
</script>

{#if !loaded}
	<p class="muted">Loading…</p>
{:else if entries.length === 0}
	{#if searching}
		<div class="timeline-empty" in:gFade={{ duration: 0.3 }}>
			<p>No entries match.</p>
			<button type="button" class="empty-cta" onclick={clearSearch}>Clear search</button>
		</div>
	{:else}
		<div class="timeline-empty" in:gFade={{ duration: 0.5, delay: 0.1 }}>
			<p>Nothing here yet.</p>
			<a class="empty-cta" href="/entry">Write your first entry</a>
		</div>
	{/if}
{:else}
	{#snippet pinToggle(entry: Entry)}
		<!-- sibling of the card's <a>, overlaid on its top-right — a button
		     inside the anchor would be invalid HTML and hijack navigation -->
		<button
			class="pin-toggle"
			aria-pressed={!!entry.metadata.pinned}
			aria-label={entry.metadata.pinned ? 'Unpin entry' : 'Pin entry'}
			title={entry.metadata.pinned ? 'Unpin entry' : 'Pin entry'}
			onclick={(e) => {
				e.stopPropagation();
				onTogglePin(entry);
			}}
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M12 17v5" />
				<path d="M9 3h6v5l2 3v2H7v-2l2-3Z" />
			</svg>
		</button>
	{/snippet}

	<div class="cursor-rail" bind:this={cursorEl} aria-hidden="true"></div>
	<ol class="timeline" bind:this={timelineEl}>
		<li class="rail" aria-hidden="true" in:gScaleY={{ duration: 0.8 }}></li>
		{#if pinned.length > 0}
			<li class="day-group" class:collapsed={collapsed.has(PINNED_KEY)} transition:collapse>
				<h2
					class="day-label"
					onclick={() => toggle(PINNED_KEY)}
					role="button"
					tabindex="0"
					aria-expanded={!collapsed.has(PINNED_KEY)}
					aria-label={collapsed.has(PINNED_KEY) ? 'Expand pinned' : 'Collapse pinned'}
				>
					<span class="day-toggle" aria-hidden="true">
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
					</span>
					<span class="day-date pinned-label"> Pinned </span>
					<span class="day-count-inline"
						>{pinned.length} {pinned.length === 1 ? 'entry' : 'entries'}</span
					>
				</h2>
				<span class="day-count-rail"
					>{pinned.length} {pinned.length === 1 ? 'entry' : 'entries'}</span
				>
				{#if !collapsed.has(PINNED_KEY)}
					<ul transition:collapse>
						{#each pinned as entry (entry.id)}
							<!-- rows grow/shrink as entries are pinned/unpinned; flip slides
							     the neighbours into place instead of snapping -->
							<li
								class="entry-row"
								transition:collapse={{ duration: 240 }}
								animate:flip={{ duration: 240, easing: cubicOut }}
							>
								<EntryCard {entry} />
								{@render pinToggle(entry)}
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/if}
		{#each groups as [day, items] (day)}
			<li class="day-group" class:collapsed={collapsed.has(day)}>
				<h2
					class="day-label"
					onclick={() => toggle(day)}
					role="button"
					tabindex="0"
					aria-expanded={!collapsed.has(day)}
					aria-label={collapsed.has(day) ? `Expand ${dayLabel(day)}` : `Collapse ${dayLabel(day)}`}
				>
					<span class="day-toggle" aria-hidden="true">
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
					</span>
					<span class="day-date">{dayLabel(day)}</span>
					<span class="day-count-inline"
						>{items.length} {items.length === 1 ? 'entry' : 'entries'}</span
					>
				</h2>
				<span class="day-count-rail">{items.length} {items.length === 1 ? 'entry' : 'entries'}</span
				>
				{#if !collapsed.has(day)}
					<ul transition:collapse>
						{#each items as entry (entry.id)}
							<li class="entry-row">
								<EntryCard {entry} />
								{@render pinToggle(entry)}
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ol>
{/if}
