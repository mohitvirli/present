<script lang="ts">
	import type { Entry } from '$lib/db';
	import { clearSearch } from '$lib/search.svelte';
	import { calendarSettings } from '$lib/settings.svelte';
	import { scroll } from '$lib/scroll.svelte';
	import { gFade, gScaleY } from '$lib/transitions';
	import gsap from 'gsap';
	import { tick } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { SvelteSet } from 'svelte/reactivity';
	import EntryCard from './EntryCard.svelte';
	import MonthCalendar from './MonthCalendar.svelte';
	import PinnedPanel from './PinnedPanel.svelte';

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

	// pinned entries surface in the gutter panel below the calendar (the
	// entry also stays in its day group). listEntries order — no special sort.
	const pinned = $derived(entries.filter((e) => e.metadata.pinned));

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
	let calRef = $state<MonthCalendar | null>(null);
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

	// month demarcation: day groups bucket into months, and every month except
	// the current one gets a big collapsible header. The current month's days
	// render bare — "June 2026" only appears once you scroll past July.
	const currentMonth = new Date().toISOString().slice(0, 7);
	const months = $derived.by(() => {
		const out: {
			key: string;
			current: boolean;
			count: number;
			words: number;
			days: [string, Entry[]][];
		}[] = [];
		for (const [day, items] of groups) {
			const mk = day.slice(0, 7);
			let m = out.at(-1);
			if (!m || m.key !== mk) {
				m = { key: mk, current: mk === currentMonth, count: 0, words: 0, days: [] };
				out.push(m);
			}
			m.days.push([day, items]);
			m.count += items.length;
			for (const e of items) m.words += e.metadata.wordCount ?? 0;
		}
		return out;
	});

	function monthLabel(key: string): { name: string; year: string } {
		// construct from parts — new Date('2026-06-01') parses as UTC midnight and
		// toLocaleDateString could render "May" in negative-offset timezones
		const d = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1);
		return { name: d.toLocaleDateString(undefined, { month: 'long' }), year: key.slice(0, 4) };
	}

	// Month toggle with dot choreography: collapsing flies every visible entry
	// dot up the rail into the month's socket segment; expanding pours them back
	// out to their rows. Real dots hide behind the `dots-flying` class while
	// fixed-position clones do the travel.
	const flyCleanup = new Map<string, () => void>();

	function toggleMonth(key: string) {
		const root = timelineEl;
		const group = root?.querySelector<HTMLElement>(`[data-month="${key}"]`);
		const label = group?.querySelector<HTMLElement>('.month-label');
		const rail = root?.querySelector('.rail');
		if (
			!root ||
			!group ||
			!label ||
			!rail ||
			window.matchMedia('(prefers-reduced-motion: reduce)').matches
		) {
			toggle(key);
			return;
		}
		flyCleanup.get(key)?.(); // a previous flight may still be mid-air

		const railRect = rail.getBoundingClientRect();
		const x = railRect.left + railRect.width / 2;
		const socketY = () => {
			const b = getComputedStyle(label, '::before');
			return label.getBoundingClientRect().top + parseFloat(b.top) + parseFloat(b.height) / 2;
		};
		// dot centres for this month's entries, viewport-clipped (offscreen dots
		// travel invisibly — no point animating them) and capped for huge months
		const dotYs = () =>
			[...group.querySelectorAll<HTMLElement>('.entry-card')]
				.map((c) => {
					const b = getComputedStyle(c, '::before');
					return c.getBoundingClientRect().top + parseFloat(b.top) + parseFloat(b.height) / 2;
				})
				.filter((y) => y > -150 && y < window.innerHeight + 150)
				.slice(0, 60);
		const spawn = (ys: number[]) =>
			ys.map((y) => {
				const d = document.createElement('div');
				d.className = 'dot-fly';
				d.style.left = `${x}px`;
				d.style.top = `${y}px`;
				// px radius (not the stylesheet's 50%) so the circle↔square morph
				// tweens cleanly — GSAP can't interpolate % → px
				gsap.set(d, { xPercent: -50, yPercent: -50, borderRadius: '7px' });
				document.body.appendChild(d);
				return d;
			});
		const finish = (dots: HTMLElement[], tl?: gsap.core.Timeline) => {
			tl?.kill();
			gsap.killTweensOf(dots);
			dots.forEach((d) => d.remove());
			label.classList.remove('socket-pulse');
			group.classList.remove('dots-flying');
			flyCleanup.delete(key);
		};

		if (!collapsed.has(key)) {
			// collapsing, in two beats. Anticipation: each circle squares off (size
			// unchanged) while the flock tightens ~12% toward the socket (the
			// "curve's peak"). Merge: they accelerate in with a back-eased wind-up
			// and the socket pulses elastically as they land.
			// The height collapse fires at the merge, not the click. Travel is a
			// transform (`y`), not `top` — top would reflow per dot per frame.
			const ys = dotYs();
			const target = socketY();
			if (!ys.length) {
				toggle(key);
				return;
			}
			const dots = spawn(ys);
			group.classList.add('dots-flying');
			const tl = gsap.timeline();
			const cleanup = () => finish(dots, tl);
			flyCleanup.set(key, cleanup);
			tl.eventCallback('onComplete', cleanup);
			tl.to(
				dots,
				{
					borderRadius: '1.5px',
					y: (i: number) => (target - ys[i]) * 0.12,
					duration: 0.18,
					ease: 'power2.out',
					stagger: 0.008
				},
				0
			);
			tl.add(() => toggle(key), 0.16);
			tl.to(
				dots,
				{
					y: (i: number) => target - ys[i],
					duration: 0.4,
					ease: 'back.in(1.7)',
					stagger: 0.008
				},
				0.16
			);
			tl.add(() => label.classList.add('socket-pulse'), 0.44);
			tl.to(dots, { opacity: 0, duration: 0.12, stagger: 0.008 }, 0.44);
		} else {
			// expanding: mount the rows first, then pour clones out of the socket.
			// Mounting a big month is one long synchronous frame — start the
			// flight two rAFs later so that layout cost lands before the tween's
			// first tick instead of freezing it mid-scale.
			toggle(key);
			// hide the real dots before the rows mount — they'd flash for the two
			// frames between mount and lift-off otherwise
			group.classList.add('dots-flying');
			tick().then(() => {
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
						const ys = dotYs();
						if (!ys.length) {
							group.classList.remove('dots-flying');
							return;
						}
						const start = socketY();
						const dots = spawn(ys.map(() => start));
						const cleanup = () => finish(dots);
						flyCleanup.set(key, cleanup);
						// mirror of the collapse morph: squares slip out of the segment
						// and round back into circles as they pour
						gsap.fromTo(
							dots,
							{ borderRadius: '1.5px', opacity: 0 },
							{ borderRadius: '7px', opacity: 1, duration: 0.22, stagger: 0.012 }
						);
						gsap.to(dots, {
							y: (i: number) => ys[i] - start,
							duration: 0.45,
							ease: 'power3.out',
							stagger: 0.012,
							onComplete: cleanup
						});
					})
				);
			});
		}
	}

	// tag pinned month headers with .stuck — the desktop subtitle sits right of
	// the rail on the same row as the topbar's CTA, so it fades out while the
	// header is pinned there. A label is stuck once it sits at (or is pushed
	// above) its sticky offset — checked on scroll, rAF-throttled.
	// (IntersectionObserver's threshold-1 trick can't detect this: the gutter
	// label clips off the viewport's left edge on narrower windows, capping its
	// ratio below 1 permanently.)
	$effect(() => {
		const root = timelineEl;
		if (!root || !loaded) return;
		void months.length; // re-run when the month list changes
		const labels = [...root.querySelectorAll<HTMLElement>('.month-label')];
		if (!labels.length) return;
		let raf = 0;
		const update = () => {
			raf = 0;
			for (const label of labels) {
				// read the sticky offset live — it changes across the 980px
				// breakpoint, and caching it would strand the class after a resize
				const top = parseFloat(getComputedStyle(label).top) || 0;
				label.classList.toggle('stuck', label.getBoundingClientRect().top <= top + 1);
			}
		};
		const onScroll = () => {
			if (!raf) raf = requestAnimationFrame(update);
		};
		update();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
		};
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
			// opacity-only (no x/transform): the desktop heading uses a CSS transform
			// to sit out in the gutter; an inline transform from GSAP would override
			// it and yank the heading back into the content column
			gsap.from(root.querySelectorAll('.day-label, .month-label'), {
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
				delay: 0.2,
				// leftover inline transform would keep each row a stacking context,
				// trapping its entry dot's z-index under the raised mobile rail
				clearProps: 'transform,opacity'
			});
		});
	});

	// Calendar → timeline: expand whatever hides the day, then smooth-scroll to
	// its group with the header clearance the pinned month label needs.
	async function jumpToDay(day: string) {
		const mk = day.slice(0, 7);
		if (collapsed.has(mk)) toggle(mk); // plain expand — skip the dot flight
		if (collapsed.has(day)) toggle(day);
		await tick();
		const el = timelineEl?.querySelector<HTMLElement>(`[data-day="${day}"]`);
		if (!el) return;
		const y = el.getBoundingClientRect().top + (scroll.lenis?.scroll ?? window.scrollY) - 110;
		if (scroll.lenis) scroll.lenis.scrollTo(Math.max(0, y));
		else window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
	}

	// Timeline → calendar: the month of the topmost group under the header
	// drives the calendar, so scrolling through June shows June's grid.
	$effect(() => {
		if (!loaded) return;
		let raf = 0;
		const onScroll = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				const groups = timelineEl?.querySelectorAll<HTMLElement>('[data-day], [data-month]');
				if (!groups?.length) return;
				for (const g of groups) {
					if (g.getBoundingClientRect().bottom > 130) {
						const key = g.dataset.day?.slice(0, 7) ?? g.dataset.month;
						if (key) calRef?.syncTo(key);
						return;
					}
				}
			});
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		onScroll();
		return () => {
			window.removeEventListener('scroll', onScroll);
			cancelAnimationFrame(raf);
		};
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

		// snap targets: entry dots (cursor collapses to a dot) and the months'
		// rail segments (cursor stretches to fill the hollow socket — `h` set)
		type SnapTarget = { y: number; h?: number };
		const snapTargets = (): SnapTarget[] => {
			const out: SnapTarget[] = [...timelineEl!.querySelectorAll<HTMLElement>('.entry-card')].map(
				(c) => ({ y: c.getBoundingClientRect().top + nodeOffset })
			);
			for (const label of timelineEl!.querySelectorAll<HTMLElement>('.month-label')) {
				const b = getComputedStyle(label, '::before');
				const t = parseFloat(b.top);
				const h = parseFloat(b.height);
				if (Number.isNaN(t) || Number.isNaN(h)) continue;
				const top = label.getBoundingClientRect().top + t;
				out.push({ y: top + h / 2, h });
			}
			return out;
		};

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
			el.classList.remove('visible', 'magnet', 'magnet-socket');
			el.style.height = '';
		};

		// clicking Be Present morphs the cursor into the composer caret; opening
		// an entry pops the dot softly (scale + fade, no ring) as the page leaves
		const endPop = () => {
			el.classList.remove('pop', 'visible', 'magnet', 'magnet-socket');
			el.style.height = '';
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
			let snapped: SnapTarget | null = null;
			for (const target of snapTargets()) {
				const d = Math.abs(target.y - targetY);
				if (d < nearest) {
					nearest = d;
					if (d < SNAP) {
						goal = target.y;
						snapped = target;
					}
				}
			}
			curY += (goal - curY) * 0.25;
			// -50% on both axes keeps the element centred on (rail x, curY)
			// regardless of whether it's the tall bar or the snapped dot
			el.style.transform = `translate(-50%, calc(${curY}px - 50%))`;
			el.classList.toggle('magnet', !!snapped && snapped.h === undefined);
			el.classList.toggle('magnet-socket', !!snapped && snapped.h !== undefined);
			// month segment: stretch to the socket's height (CSS transitions the
			// change); otherwise clear back to the stylesheet's bar height
			el.style.height = snapped?.h !== undefined ? `${snapped.h}px` : '';
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
	{#if calendarSettings.enabled || pinned.length > 0}
		<div class="timeline-gutter">
			{#if calendarSettings.enabled}
				<MonthCalendar bind:this={calRef} {entries} onJump={jumpToDay} />
			{/if}
			{#if pinned.length > 0}
				<PinnedPanel entries={pinned} {onTogglePin} />
			{/if}
		</div>
	{/if}
	<ol class="timeline" bind:this={timelineEl}>
		<li class="rail" aria-hidden="true" in:gScaleY={{ duration: 0.8 }}></li>
		{#snippet dayGroup(day: string, items: Entry[])}
			<li class="day-group" class:collapsed={collapsed.has(day)} data-day={day}>
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
		{/snippet}

		{#each months as m (m.key)}
			{#if m.current}
				{#each m.days as [day, items] (day)}
					{@render dayGroup(day, items)}
				{/each}
			{:else}
				{@const label = monthLabel(m.key)}
				<li class="month-group" class:collapsed={collapsed.has(m.key)} data-month={m.key}>
					<h2
						class="month-label"
						onclick={() => toggleMonth(m.key)}
						role="button"
						tabindex="0"
						aria-expanded={!collapsed.has(m.key)}
						aria-label={collapsed.has(m.key)
							? `Expand ${label.name} ${label.year}`
							: `Collapse ${label.name} ${label.year}`}
					>
						<span class="month-title">
							<span class="month-name"
								>{label.name} <span class="month-year">{label.year}</span></span
							>
							<span class="month-sub">
								{m.count}
								{m.count === 1 ? 'entry' : 'entries'} · {m.days.length}
								{m.days.length === 1 ? 'day' : 'days'}{#if m.words > 0}
									&nbsp;· {m.words.toLocaleString()} {m.words === 1 ? 'word' : 'words'}{/if}
							</span>
						</span>
					</h2>
					{#if !collapsed.has(m.key)}
						<!-- height animation paced to the dot flight: expand matches the
						     0.45s pour-out, collapse the 0.38s converge -->
						<ol class="month-days" in:collapse={{ duration: 450 }} out:collapse={{ duration: 380 }}>
							{#each m.days as [day, items] (day)}
								{@render dayGroup(day, items)}
							{/each}
						</ol>
					{/if}
				</li>
			{/if}
		{/each}
	</ol>
{/if}
