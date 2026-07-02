<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { onNavigate, goto } from '$app/navigation';
	import gsap from 'gsap';
	import { listEntries, seedTutorialEntries, updateEntry, type Entry } from '$lib/db';
	import { hasOnboarded, markOnboarded, hasWrittenEntry } from '$lib/onboarding';
	import { isStandalone, consumeLaunch } from '$lib/pwa';
	import { syncState } from '$lib/sync.svelte';
	import { scroll } from '$lib/scroll.svelte';
	import { search, searchActive } from '$lib/search.svelte';
	import { buildIndex, runSearch } from '$lib/search';
	import Timeline from '$lib/components/Timeline.svelte';

	let entries = $state<Entry[]>([]);
	let loaded = $state(false);

	// fuse index rebuilds only when the entry set changes; the filtered list
	// re-derives per keystroke/filter against it
	const index = $derived(buildIndex(entries));
	const filtered = $derived(runSearch(entries, index, search.query, search.tags, search.tone));
	const searching = $derived(searchActive());

	// filtering changes document height under Lenis's cached layout — re-measure
	$effect(() => {
		void filtered;
		tick().then(() => scroll.lenis?.resize());
	});


	onMount(async () => {
		// Installed PWA: on cold launch, returning users start in the composer
		// instead of the timeline. Consume the launch token first (so navigating
		// back to the timeline mid-session never re-triggers this), then redirect
		// only when launched standalone and the user has written before.
		if (consumeLaunch() && isStandalone() && hasWrittenEntry()) {
			await goto('/entry', { replaceState: true });
			return;
		}

		let list = await listEntries();
		// first-ever visit → seed example entries so the journal teaches by
		// example instead of dropping the user into an empty composer
		if (list.length === 0 && !hasOnboarded()) {
			await seedTutorialEntries();
			markOnboarded();
			list = await listEntries();
		}
		entries = list;
		loaded = true;
		// restore the scroll position the user left from, once rows are in the DOM.
		// rows animate/measure in over a few frames and Lenis caches page height,
		// so resize + re-assert the target across several frames until it sticks.
		const y = scroll.timelineY;
		if (y) {
			await tick();
			let n = 0;
			const restore = () => {
				if (scroll.lenis) {
					scroll.lenis.resize();
					scroll.lenis.scrollTo(y, { immediate: true, force: true });
				} else {
					window.scrollTo(0, y);
				}
				if (++n < 8) requestAnimationFrame(restore);
			};
			requestAnimationFrame(restore);
		}
	});

	// pin/unpin from a timeline card: persist the full metadata object (db
	// replaces metadata wholesale; `undefined` is the "key removed" convention)
	// and swap the entry in the local array so both the Pinned section and the
	// day group re-render — no full re-listEntries needed.
	async function togglePin(entry: Entry) {
		const updated = await updateEntry(entry.id, {
			metadata: { ...entry.metadata, pinned: entry.metadata.pinned ? undefined : true }
		});
		entries = entries.map((e) => (e.id === updated.id ? updated : e));
	}

	// when a sync pull applies remote changes, re-read the timeline
	$effect(() => {
		void syncState.rev;
		if (loaded) listEntries().then((l) => (entries = l));
	});

	// exit animation when leaving the timeline (SvelteKit awaits this promise
	// before tearing the page down, so GSAP can play before unmount)
	onNavigate(() => {
		// remember where the timeline was so we can return here after viewing an entry
		scroll.timelineY = scroll.lenis?.scroll ?? window.scrollY;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		// Touch devices: don't block navigation on the exit animation. Awaiting
		// it adds ~0.3–0.5s before every tap on the timeline resolves, which
		// reads as the page being unresponsive. The animation is a desktop
		// nicety; on touch, navigate immediately.
		if (window.matchMedia('(pointer: coarse)').matches) return;
		const rows = Array.from(document.querySelectorAll('.entry-row'));
		// month headers too — a pinned one would otherwise stay put (sticky, own
		// bg) while everything else fades, then pop on unmount
		const labels = Array.from(document.querySelectorAll('.day-label, .month-label'));
		// collapsed days show only the rail count (rows are unmounted) — fade it
		// out with the labels so it doesn't linger after everything else leaves
		const counts = Array.from(document.querySelectorAll('.day-count-rail'));
		const rail = document.querySelector('.rail');
		const header = Array.from(document.querySelectorAll('.topbar-inner > *'));
		if (!rows.length && !rail) return;

		return new Promise<void>((resolve) => {
			const tl = gsap.timeline({ onComplete: resolve, defaults: { ease: 'power2.in' } });
			tl.to(header, { y: -8, autoAlpha: 0, duration: 0.26, stagger: 0.06 }, 0);
			tl.to(rows, { y: -10, autoAlpha: 0, duration: 0.28, stagger: 0.015 }, 0);
			// autoAlpha only (no x): the desktop label's gutter placement is a CSS
			// transform — an inline transform here would fight it on the way out
			tl.to(labels, { autoAlpha: 0, duration: 0.24 }, 0);
			if (counts.length) tl.to(counts, { x: -8, autoAlpha: 0, duration: 0.24 }, 0);
			if (rail)
				tl.to(rail, { scaleY: 0, autoAlpha: 0, transformOrigin: 'top center', duration: 0.32 }, 0);
			// safety: never block navigation longer than ~500ms
			gsap.delayedCall(0.5, resolve);
		});
	});
</script>

<div class="home">
	<Timeline entries={filtered} {loaded} {searching} onTogglePin={togglePin} />
</div>
