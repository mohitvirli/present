<script module lang="ts">
	// months whose envelope already arrived this session — the arrival is an
	// event, so it plays once, not on every return to the timeline
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
	const arrived = new Set<string>();
</script>

<script lang="ts">
	import { goto } from '$app/navigation';
	import gsap from 'gsap';
	import type { Entry } from '$lib/db';
	import { letterOpening, monthName, statsOf } from '$lib/recap';

	let { entry }: { entry: Entry } = $props();

	const month = $derived(entry.metadata.recap ?? '');
	const stats = $derived(statsOf(entry.content));
	const opening = $derived(letterOpening(entry.content));
	const sealed = $derived(!entry.metadata.recapSeen);
	const href = $derived(`/entry?id=${entry.id}`);

	let cardEl = $state<HTMLElement | null>(null);
	let typed = $state<string | null>(null); // the title mid-typing, null when at rest
	let sealEl = $state<HTMLElement | null>(null);
	let flapEl = $state<SVGElement | null>(null);
	let breaking = false;

	// An unopened letter arrives when it first scrolls into view: the envelope
	// settles, the title types itself out, the month's ticks rise and the seal
	// presses down last. Opened letters sit still.
	$effect(() => {
		const card = cardEl;
		if (!card || !sealed || arrived.has(month)) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const full = entry.metadata.title ?? '';
		const ticks = card.querySelectorAll('.recap-card-spine .spine-day');
		const rest = card.querySelectorAll(
			'.recap-kicker, .recap-excerpt, .recap-byline, .recap-postmark'
		);
		gsap.set(card, { opacity: 0, y: 14 });
		gsap.set(rest, { opacity: 0 });
		gsap.set(ticks, { scaleY: 0, transformOrigin: '50% 100%' });
		if (sealEl) gsap.set(sealEl, { opacity: 0, scale: 1.8 });
		typed = '';

		let tl: gsap.core.Timeline | undefined;
		const io = new IntersectionObserver(
			([hit]) => {
				if (!hit.isIntersecting) return;
				io.disconnect();
				arrived.add(month);
				const t = { n: 0 };
				tl = gsap.timeline({ delay: 0.1 });
				tl.to(card, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' });
				tl.to(rest, { opacity: 1, duration: 0.4, stagger: 0.05 }, 0.25);
				tl.to(
					t,
					{
						n: full.length,
						duration: Math.min(1.4, full.length * 0.045),
						ease: 'none',
						onUpdate: () => (typed = full.slice(0, Math.round(t.n))),
						onComplete: () => (typed = null)
					},
					0.35
				);
				tl.to(ticks, { scaleY: 1, duration: 0.3, stagger: 0.01, ease: 'back.out(2)' }, '-=0.4');
				if (sealEl)
					tl.to(sealEl, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2.4)' }, '-=0.15');
			},
			{ threshold: 0.4 }
		);
		io.observe(card);
		return () => {
			io.disconnect();
			tl?.progress(1).kill();
			typed = null;
		};
	});

	// first open breaks the seal: it lifts, splits and drops away with the
	// flap before the page leaves. Opened letters just navigate.
	function open(e: MouseEvent) {
		if (!sealed || !sealEl || breaking) return;
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		e.preventDefault();
		breaking = true;
		const halves = sealEl.querySelectorAll('.seal-half');
		const tl = gsap.timeline({ onComplete: () => void goto(href) });
		tl.to(sealEl, { scale: 1.12, duration: 0.12, ease: 'power2.out' });
		tl.to(halves, {
			x: (i: number) => (i ? 7 : -7),
			rotation: (i: number) => (i ? 14 : -14),
			duration: 0.22,
			ease: 'power2.in'
		});
		tl.to(sealEl, { y: 10, autoAlpha: 0, duration: 0.2, ease: 'power2.in' }, '<0.08');
		if (flapEl)
			tl.to(flapEl, { scaleY: -1, autoAlpha: 0, transformOrigin: '50% 0%', duration: 0.26 }, '<');
	}
</script>

<a
	class="recap-card"
	class:sealed
	{href}
	bind:this={cardEl}
	onclick={open}
	aria-label="{sealed ? 'Unopened letter' : 'Letter'}: {entry.metadata.title ??
		`${monthName(month)} recap`}"
>
	{#if sealed}
		<svg
			class="recap-flap"
			bind:this={flapEl}
			viewBox="0 0 100 20"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<path d="M0 0 L50 20 L100 0" fill="none" vector-effect="non-scaling-stroke" />
		</svg>
		<span class="recap-seal" bind:this={sealEl} aria-hidden="true">
			<span class="seal-half"></span><span class="seal-half"></span>
		</span>
	{/if}

	<span class="recap-postmark" aria-hidden="true">
		<span>{monthName(month, 'short')}</span>
		<span>{month.slice(0, 4)}</span>
	</span>

	<span class="recap-kicker">A letter about {monthName(month)}</span>
	{#if entry.metadata.title}<h3 class="recap-title">
			{#if typed !== null}{typed}<span class="type-caret"></span><span class="type-rest"
					>{entry.metadata.title.slice(typed.length)}</span
				>{:else}{entry.metadata.title}{/if}
		</h3>{/if}
	{#if opening}<p class="recap-excerpt">{opening}</p>{/if}

	{#if stats}
		<span class="recap-card-spine" aria-hidden="true">
			{#each stats.spine as t, i (i)}
				<span
					class="spine-day"
					class:t-positive={t === 'positive'}
					class:t-neutral={t === 'neutral'}
					class:t-negative={t === 'negative'}
					class:t-written={t === 'written'}
				></span>
			{/each}
		</span>
		<span class="recap-byline"
			>Read back from {stats.entries} {stats.entries === 1 ? 'entry' : 'entries'}</span
		>
	{/if}
</a>
