<script lang="ts">
	import type { Entry } from '$lib/db';
	import { gFade, gScaleY } from '$lib/transitions';
	import gsap from 'gsap';
	import { tick } from 'svelte';
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
		return {
			duration,
			easing: cubicOut,
			css: (t: number) =>
				`overflow:hidden;opacity:${t};height:${t * h}px;padding-top:${t * pt}px;padding-bottom:${t * pb}px;`
		};
	}

	let { entries, loaded }: { entries: Entry[]; loaded: boolean } = $props();

	// days the user has collapsed (keyed by dayKey)
	let collapsed = $state(new SvelteSet<string>());
	function toggle(day: string) {
		if (collapsed.has(day)) collapsed.delete(day);
		else collapsed.add(day);
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

		// clicking anything actionable (Be Present, settings, an entry) bursts the
		// cursor — except the day collapse toggle (keeps us on the timeline) and
		// clicks inside a dialog (open/close/cancel/backdrop must never burst)
		const endBurst = () => {
			el.classList.remove('burst', 'visible', 'magnet');
			bursting = false;
			active = false; // reappears on the next pointer move
		};
		const onClick = (e: MouseEvent) => {
			const hit = (e.target as HTMLElement | null)?.closest('a, button');
			if (!hit || hit.closest('.day-toggle') || hit.closest('dialog') || bursting) return;
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
			bursting = true;
			el.classList.add('visible', 'burst');
			// animationend normally clears it, but if a dialog opens the rail gets
			// display:none'd mid-burst (animationend never fires) — so a timeout
			// fallback guarantees cleanup and stops it replaying when the rail returns
			el.addEventListener('animationend', endBurst, { once: true });
			setTimeout(endBurst, 600);
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
	<div class="timeline-empty" in:gFade={{ duration: 0.5, delay: 0.1 }}>
		<p>Nothing here yet.</p>
		<a class="empty-cta" href="/entry">Write your first entry</a>
	</div>
{:else}
	<div class="cursor-rail" bind:this={cursorEl} aria-hidden="true"></div>
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
