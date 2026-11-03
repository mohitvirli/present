<script lang="ts">
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import Clock from '$lib/components/Clock.svelte';
	import Scrollbar from '$lib/components/Scrollbar.svelte';
	import Settings from '$lib/components/Settings.svelte';
	import { composer } from '$lib/composer.svelte';
	import { monthName } from '$lib/recap';
	import { scroll } from '$lib/scroll.svelte';
	import {
		search,
		searchActive,
		clearSearch,
		recents,
		rememberSearch,
		applySearch,
		type RecentSearch,
		type Tone
	} from '$lib/search.svelte';
	import { getAllTags } from '$lib/db';
	import { tagStyle } from '$lib/tag-color';
	import { gFade, gIn, gOut } from '$lib/transitions';
	import gsap from 'gsap';
	import Lenis from 'lenis';
	import { onMount, tick } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { initSync, fullSync, syncState } from '$lib/sync.svelte';
	import { initAnalytics, trackPageView } from '$lib/analytics';
	import { initTheme } from '$lib/theme.svelte';
	import '../app.css';
	let { children } = $props();

	// flip the theme at the day/night boundary while the tab stays open
	onMount(initTheme);

	// Google Analytics: load gtag once, then report the first view by hand —
	// afterNavigate only fires for later client-side navigations.
	onMount(() => {
		initAnalytics();
		trackPageView(page.url);
	});

	// kick off sync on load (if enabled) and whenever the tab regains focus
	onMount(() => {
		void initSync();
		const onVisible = () => {
			if (document.visibilityState === 'visible' && syncState.enabled) void fullSync();
		};
		document.addEventListener('visibilitychange', onVisible);

		const onKeydown = (e: KeyboardEvent) => {
			const mod = e.metaKey || e.ctrlKey;
			if (!mod || e.altKey) return;

			// ⌘J / Ctrl+J always opens a fresh journal entry — from anywhere,
			// including while already writing or viewing an older entry. The nonce
			// forces a remount even when the URL is already /entry.
			if (!e.shiftKey && e.code === 'KeyJ') {
				e.preventDefault();
				composer.newEntryNonce++;
				void goto('/entry');
				return;
			}

			// ⌘/ / Ctrl+/ toggles reflection mode while writing
			if (!e.shiftKey && e.code === 'Slash' && composer.canReflect) {
				e.preventDefault();
				composer.reflection = !composer.reflection;
				return;
			}

			// ⌘K / Ctrl+K toggles entry search on the timeline
			if (!e.shiftKey && e.code === 'KeyK' && page.url.pathname === '/') {
				e.preventDefault();
				search.open = !search.open;
			}
		};
		window.addEventListener('keydown', onKeydown);

		return () => {
			document.removeEventListener('visibilitychange', onVisible);
			window.removeEventListener('keydown', onKeydown);
		};
	});

	// Lenis keeps its own scroll position across client navigations, so opening
	// an entry can land mid-page. Reset to the top after every navigation.
	afterNavigate(({ to, type }) => {
		// `enter` is the initial load, already reported in onMount
		if (to && type !== 'enter') trackPageView(to.url);

		// the timeline restores its own saved position once entries render; only
		// reset to top for other destinations (e.g. opening an entry).
		if (to?.url.pathname === '/') return;
		if (scroll.lenis) scroll.lenis.scrollTo(0, { immediate: true });
		else window.scrollTo(0, 0);
	});

	let isNew = $derived(page.url.pathname === '/entry');

	// --- entry search (timeline route) ---------------------------------------
	const TONES: { value: Tone; label: string }[] = [
		{ value: 'positive', label: 'Positive' },
		{ value: 'neutral', label: 'Neutral' },
		{ value: 'negative', label: 'Negative' }
	];

	let searchInput = $state<HTMLInputElement | null>(null);
	let allTags = $state<{ tag: string; count: number }[]>([]);

	// Load the tag vocabulary BEFORE the panel can open: chips arriving while
	// the accordion row is mid-transition change its content height and the
	// reveal visibly jumps.
	$effect(() => {
		if (isNew) return;
		getAllTags().then((t) => (allTags = t));
	});

	// each open: focus the input. preventScroll matters — the panel sits in an
	// overflow:hidden clip while the row opens, and a default focus() scrolls
	// that clip internally to reveal the input, snapping the animation.
	$effect(() => {
		if (!search.open) return;
		tick().then(() => searchInput?.focus({ preventScroll: true }));
	});

	const TOP_TAGS = 8;
	const MAX_SUGGESTIONS = 6;
	let showAllTags = $state(false);
	let activeSuggestion = $state(-1);

	// a leading # switches the input into tag-only lookup
	const tagMode = $derived(search.query.trimStart().startsWith('#'));
	const tagNeedle = $derived(search.query.trim().replace(/^#/, '').toLowerCase());

	// unselected tags, already most-used first (getAllTags sorts by count)
	const freeTags = $derived(
		allTags.filter(({ tag }) => !search.tags.has(tag.trim().toLowerCase()))
	);
	const visibleTags = $derived(showAllTags ? freeTags : freeTags.slice(0, TOP_TAGS));

	// typing narrows the tag vocabulary: prefix matches first, then substrings
	const suggestions = $derived.by(() => {
		if (!tagNeedle) return tagMode ? freeTags.slice(0, MAX_SUGGESTIONS) : [];
		const lower = (t: string) => t.toLowerCase();
		const prefix = freeTags.filter(({ tag }) => lower(tag).startsWith(tagNeedle));
		const inner = freeTags.filter(
			({ tag }) => !lower(tag).startsWith(tagNeedle) && lower(tag).includes(tagNeedle)
		);
		return [...prefix, ...inner].slice(0, MAX_SUGGESTIONS);
	});

	// # mode pre-highlights the first match so ↵ adds it; a plain query keeps
	// ↵ for text search until the user arrows into the list
	$effect(() => {
		void suggestions;
		activeSuggestion = tagMode && suggestions.length ? 0 : -1;
	});

	const hasQuery = $derived(search.query.trim().length > 0);

	function onSearchKeydown(e: KeyboardEvent) {
		const n = suggestions.length;
		if (e.key === 'ArrowDown' && n) {
			e.preventDefault();
			activeSuggestion = (activeSuggestion + 1) % n;
		} else if (e.key === 'ArrowUp' && n) {
			e.preventDefault();
			activeSuggestion = activeSuggestion <= 0 ? n - 1 : activeSuggestion - 1;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const pick = suggestions[activeSuggestion];
			if (pick) addTagFromQuery(pick.tag);
			else rememberSearch();
		} else if (e.key === 'Backspace' && !search.query && searchInput?.selectionStart === 0) {
			// empty input: peel the last filter token off
			const last = [...search.tags].at(-1);
			if (last) search.tags.delete(last);
			else if (search.tone) search.tone = null;
		} else if (e.key === 'Escape') {
			e.preventDefault();
			// first Esc clears an active search, second closes the bar
			if (searchActive()) clearAndRemember();
			else search.open = false;
		}
	}

	function addTagFromQuery(tag: string) {
		search.tags.add(tag.trim().toLowerCase());
		search.query = '';
		searchInput?.focus({ preventScroll: true });
	}

	function toggleTag(tag: string) {
		const key = tag.trim().toLowerCase();
		if (search.tags.has(key)) search.tags.delete(key);
		else search.tags.add(key);
		searchInput?.focus({ preventScroll: true });
	}

	function setTone(tone: Tone | null) {
		search.tone = tone;
		searchInput?.focus({ preventScroll: true });
	}

	function clearAndRemember() {
		rememberSearch();
		clearSearch();
		searchInput?.focus({ preventScroll: true });
	}

	function recentLabel(r: RecentSearch): string {
		return [r.query, ...r.tags.map((t) => `#${t}`), r.tone ?? ''].filter(Boolean).join(' · ');
	}

	// split a tag label around the typed needle so the match can be emphasized
	function splitMatch(tag: string): [string, string, string] {
		const i = tagNeedle ? tag.toLowerCase().indexOf(tagNeedle) : -1;
		if (i < 0) return [tag, '', ''];
		return [tag.slice(0, i), tag.slice(i, i + tagNeedle.length), tag.slice(i + tagNeedle.length)];
	}

	// single source of truth for the tab title: a saved entry shows its
	// date + time (a recap, the month it covers), everything else the app name
	let docTitle = $derived.by(() => {
		if (page.url.pathname === '/entry' && composer.recapMonth) {
			const m = composer.recapMonth;
			return `${monthName(m)} ${m.slice(0, 4)} · Recap`;
		}
		if (page.url.pathname === '/entry' && composer.readonly && composer.createdAt != null) {
			const d = new Date(composer.createdAt);
			const date = d.toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			});
			const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
			return `${date} · ${time}`;
		}
		return 'be present.';
	});

	// reveal header icons only on a deliberate hover, not when the cursor
	// merely happens to sit over the header right after a route change
	let headerHovered = $state(false);
	$effect(() => {
		void page.url.pathname;
		headerHovered = false;
	});

	let confirmDialog = $state<HTMLDialogElement | null>(null);

	function openDeleteDialog() {
		const d = confirmDialog;
		if (!d) return;
		d.showModal();
		gsap.fromTo(
			d,
			{ autoAlpha: 0, y: 8, scale: 0.97 },
			{ autoAlpha: 1, y: 0, scale: 1, duration: 0.24, ease: 'power3.out' }
		);
	}

	function closeDialog(after?: () => void) {
		const d = confirmDialog;
		if (!d) return;
		gsap.to(d, {
			autoAlpha: 0,
			y: 8,
			scale: 0.97,
			duration: 0.16,
			ease: 'power2.in',
			onComplete: () => {
				d.close();
				gsap.set(d, { clearProps: 'all' });
				after?.();
			}
		});
	}

	function confirmDelete() {
		closeDialog(() => composer.delete?.());
	}

	let topbarInner = $state<HTMLElement | null>(null);

	// On long entries the text scrolls under the sticky header clock. Expose
	// scroll progress (0→1 over the first 140px) as --clock-p so desktop CSS
	// can slide the clock into the left gutter in lockstep with the scroll.
	let topbarEl = $state<HTMLElement | null>(null);
	onMount(() => {
		const onScroll = () => {
			const p = Math.min(1, Math.max(0, (window.scrollY - 20) / 120));
			topbarEl?.style.setProperty('--clock-p', String(p));
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		onScroll();
		return () => window.removeEventListener('scroll', onScroll);
	});

	onMount(() => {
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		// header entry on first load (layout is hydrated, so Svelte intros don't
		// fire here — drive it imperatively)
		if (!reduce && topbarInner) {
			gsap.from(topbarInner.children, {
				y: -8,
				autoAlpha: 0,
				duration: 0.6,
				ease: 'power3.out',
				delay: 0.1,
				stagger: 0.08
			});
		}

		if (reduce) return; // skip inertia smoothing

		const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
		scroll.lenis = lenis;
		let raf: number;
		const loop = (t: number) => {
			lenis.raf(t);
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);

		return () => {
			cancelAnimationFrame(raf);
			lenis.destroy();
			scroll.lenis = null;
		};
	});
</script>

<svelte:head>
	<title>{docTitle}</title>
	<link rel="icon" href={favicon} />
</svelte:head>

<Scrollbar />

<div class="shell">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<header
		class="topbar"
		class:reveal-actions={headerHovered}
		class:on-entry={isNew}
		bind:this={topbarEl}
		onpointerenter={(e) => {
			// Mouse only: mutating a class on the topbar during a touch tap's
			// hover phase makes iOS WebKit cancel the click (first tap reveals
			// "hover", second tap activates). Touch already shows the actions via
			// the (hover: none) CSS, so it needs no JS reveal.
			if (e.pointerType === 'mouse') headerHovered = true;
		}}
		onpointerleave={(e) => {
			if (e.pointerType === 'mouse') headerHovered = false;
		}}
	>
		<div class="topbar-inner" bind:this={topbarInner}>
			{#if isNew}
				<a
					class="brand"
					href="/"
					aria-label="present — home"
					in:gFade={{ duration: 1.1, delay: 0.7 }}
				>
					<Clock
						at={composer.readonly ? composer.createdAt : null}
						month={composer.recapMonth}
					/>
				</a>
			{:else}
				<a class="cta" href="/entry" in:gFade={{ duration: 0.3 }}>
					Be Present <span class="cta-plus" aria-hidden="true">→</span>
				</a>
			{/if}
			{#if !isNew}
				<nav in:gIn={{ x: 12, duration: 0.35, delay: 0.1 }}>
					<button
						class="settings-btn search-toggle"
						class:active={search.open || searchActive()}
						onclick={() => (search.open = !search.open)}
						aria-expanded={search.open}
						aria-label="Search entries"
						title="Search entries (⌘K)"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							aria-hidden="true"
						>
							<circle cx="11" cy="11" r="7" />
							<path d="m20 20-3.5-3.5" />
						</svg>
					</button>
					<Settings />
				</nav>
			{:else}
				<div class="header-actions" in:gIn={{ x: 12, duration: 0.35, delay: 0.7 }}>
					<a class="header-action home" href="/" aria-label="Back to timeline">
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M3 10.5 12 3l9 7.5" />
							<path d="M5 9.5V21h14V9.5" />
						</svg>
					</a>
					{#if composer.share}
						<span class="share-wrap">
							<button
								class="header-action"
								class:pinned={composer.shareState !== 'idle'}
								onclick={() => composer.share?.()}
								disabled={composer.sharing || composer.shareState === 'copied'}
								aria-label={composer.shareState === 'download'
									? 'Download entry image'
									: 'Share entry as image'}
								title={composer.shareState === 'copied'
									? 'Copied to clipboard'
									: composer.shareState === 'download'
										? 'Download entry image'
										: 'Share entry as image'}
							>
								{#if composer.sharing}
									<svg
										class="spin"
										width="18"
										height="18"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2.2"
										stroke-linecap="round"
										aria-hidden="true"
									>
										<path d="M21 12a9 9 0 1 1-6.2-8.6" />
									</svg>
								{:else if composer.shareState === 'copied'}
									<svg
										width="18"
										height="18"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="m4 12.5 5 5L20 6.5" />
									</svg>
								{:else if composer.shareState === 'download'}
									<svg
										width="18"
										height="18"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M12 15V3" />
										<path d="m8 11 4 4 4-4" />
										<path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
									</svg>
								{:else}
									<svg
										width="18"
										height="18"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M12 3v12" />
										<path d="m8 7 4-4 4 4" />
										<path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
									</svg>
								{/if}
							</button>
							{#if composer.shareState !== 'idle'}
								{#key composer.shareState}
									<span
										class="share-toast"
										role="status"
										in:gIn={{ y: -6, duration: 0.3 }}
										out:gOut={{ y: -4, duration: 0.2 }}
									>
										{composer.shareState === 'copied' ? 'Copied to clipboard' : 'Click to download'}
									</span>
								{/key}
							{/if}
						</span>
					{/if}
					{#if composer.pin}
						<button
							class="header-action pin-btn"
							class:active={composer.pinned}
							onclick={() => composer.pin?.()}
							aria-pressed={composer.pinned}
							aria-label={composer.pinned ? 'Unpin entry' : 'Pin entry'}
							title={composer.pinned ? 'Unpin entry' : 'Pin entry'}
						>
							<svg
								width="18"
								height="18"
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
					{/if}
					{#if composer.canReflect}
						<button
							class="header-action"
							class:active={composer.reflection}
							onclick={() => (composer.reflection = !composer.reflection)}
							aria-pressed={composer.reflection}
							aria-label="Reflection mode"
							title="Reflection mode — gentle AI follow-up questions as you write (⌘/)"
						>
							<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
								<!-- light half = page bg, dark half = currentColor, dots inverted -->
								<circle
									cx="12"
									cy="12"
									r="11"
									fill="var(--color-bg)"
									stroke="currentColor"
									stroke-width="1.5"
								/>
								<path
									fill="currentColor"
									d="M12 1a11 11 0 0 1 0 22 5.5 5.5 0 0 1 0-11 5.5 5.5 0 0 0 0-11z"
								/>
								<circle cx="12" cy="6.5" r="2" fill="currentColor" />
								<circle cx="12" cy="17.5" r="2" fill="var(--color-bg)" />
							</svg>
						</button>
					{/if}
					{#if composer.readonly && composer.edit}
						<button
							class="header-action"
							onclick={() => composer.edit?.()}
							aria-label="Edit entry"
							title="Edit entry — press E or double-click the text"
						>
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M12 20h9" />
								<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
							</svg>
						</button>
					{/if}
					{#if composer.entryId}
						<button
							class="header-action danger"
							onclick={openDeleteDialog}
							aria-label="Delete entry"
						>
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M3 6h18" />
								<path d="M8 6V4h8v2" />
								<path d="M6 6v14h12V6" />
								<path d="M10 11v5M14 11v5" />
							</svg>
						</button>
					{/if}
				</div>
			{/if}
		</div>
		{#if !isNew}
			<!-- always in the DOM; open/close animates grid-template-rows (0fr↔1fr)
			     like an accordion — mounting via {#if search.open} would re-insert
			     the subtree and the first frames of the slide visibly snap -->
			<div class="search-wrap" class:open={search.open} inert={!search.open}>
				<div class="search-clip">
					<div class="search-panel" role="search">
						<div class="search-row">
							<svg
								class="search-row-icon"
								width="15"
								height="15"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								aria-hidden="true"
							>
								<circle cx="11" cy="11" r="7" />
								<path d="m20 20-3.5-3.5" />
							</svg>
							{#if search.tone}
								{@const tone = search.tone}
								<button
									class="search-token tone-token"
									data-tone={tone}
									onclick={() => setTone(null)}
									aria-label="Remove {tone} mood filter"
								>
									<span class="tone-dot" aria-hidden="true"></span>
									{TONES.find((t) => t.value === tone)?.label}
									<span class="token-x" aria-hidden="true">×</span>
								</button>
							{/if}
							{#each [...search.tags] as tag (tag)}
								<button
									class="search-token tag-token"
									style={tagStyle(tag)}
									onclick={() => toggleTag(tag)}
									aria-label="Remove tag {tag}"
								>
									#{tag}<span class="token-x" aria-hidden="true">×</span>
								</button>
							{/each}
							<input
								bind:this={searchInput}
								bind:value={search.query}
								onkeydown={onSearchKeydown}
								class="search-input"
								type="search"
								placeholder={searchActive() ? 'Add words or #tags…' : 'Search words or #tags…'}
								aria-label="Search entries"
								aria-controls="search-suggestions"
								aria-activedescendant={activeSuggestion >= 0
									? `search-suggestion-${activeSuggestion}`
									: undefined}
								autocomplete="off"
								spellcheck="false"
							/>
							{#if searchActive()}
								<button class="search-clear" onclick={clearAndRemember}>Clear</button>
							{:else}
								<kbd class="search-kbd" aria-hidden="true">esc</kbd>
							{/if}
						</div>

						{#if suggestions.length}
							<div class="search-section">
								<p class="search-label">
									{tagNeedle ? `Tags matching “${tagNeedle}”` : 'Tags'}
								</p>
								<ul class="search-suggestions" id="search-suggestions" role="listbox">
									{#each suggestions as { tag, count }, i (tag.toLowerCase())}
										{@const [pre, hit, post] = splitMatch(tag)}
										<li
											id="search-suggestion-{i}"
											role="option"
											aria-selected={i === activeSuggestion}
										>
											<button
												class="suggestion"
												class:active={i === activeSuggestion}
												style={tagStyle(tag)}
												onclick={() => addTagFromQuery(tag)}
												onpointerenter={() => (activeSuggestion = i)}
												tabindex="-1"
											>
												<span class="suggestion-dot" aria-hidden="true"></span>
												<span class="suggestion-name">#{pre}<mark>{hit}</mark>{post}</span>
												<span class="suggestion-meta">
													{#if i === activeSuggestion}↵ filter{:else}{count}{/if}
												</span>
											</button>
										</li>
									{/each}
								</ul>
							</div>
						{:else if !hasQuery}
							<div class="search-section">
								<p class="search-label">Mood</p>
								<div class="mood-seg" role="radiogroup" aria-label="Mood">
									{#each [{ value: null, label: 'Any' }, ...TONES] as t (t.value ?? 'any')}
										<button
											class="mood-opt"
											class:on={search.tone === t.value}
											data-tone={t.value}
											role="radio"
											aria-checked={search.tone === t.value}
											onclick={() => setTone(t.value)}
										>
											{#if t.value}<span class="tone-dot" aria-hidden="true"></span>{/if}{t.label}
										</button>
									{/each}
								</div>
							</div>
							{#if freeTags.length}
								<div class="search-section">
									<p class="search-label">{showAllTags ? 'All tags' : 'Frequent tags'}</p>
									<div class="search-filters">
										{#each visibleTags as { tag, count } (tag.toLowerCase())}
											<button
												class="filter-chip tag-chip"
												style={tagStyle(tag)}
												onclick={() => toggleTag(tag)}
											>
												{tag}<span class="chip-count">{count}</span>
											</button>
										{/each}
										{#if freeTags.length > TOP_TAGS}
											<button
												class="filter-chip more-chip"
												onclick={() => (showAllTags = !showAllTags)}
												aria-expanded={showAllTags}
											>
												{showAllTags ? 'Show less' : `+ ${freeTags.length - TOP_TAGS} more`}
											</button>
										{/if}
									</div>
								</div>
							{/if}
							{#if !searchActive() && recents.list.length}
								<div class="search-section">
									<p class="search-label">Recent</p>
									<div class="search-recents">
										{#each recents.list as r (recentLabel(r))}
											<button class="recent" onclick={() => applySearch(r)}>
												<svg
													width="13"
													height="13"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
												>
													<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
													<path d="M3 3v5h5" />
													<path d="M12 7v5l3 2" />
												</svg>
												{recentLabel(r)}
											</button>
										{/each}
									</div>
								</div>
							{/if}
						{/if}

						{#if searchActive()}
							<div class="search-foot" role="status">
								<span>
									{#if search.matches === 0}
										No entries match
									{:else}
										{search.matches} of {search.total}
										{search.total === 1 ? 'entry' : 'entries'}
									{/if}
								</span>
								<span class="search-hints" aria-hidden="true">
									{#if suggestions.length}<kbd>↑↓</kbd> pick <kbd>↵</kbd> add{:else}<kbd>⌫</kbd> remove
										filter{/if}
									<kbd>esc</kbd> clear
								</span>
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</header>
	<main>
		{#key page.url.href + '|' + composer.newEntryNonce}
			{@render children()}
		{/key}
	</main>
</div>

<dialog
	bind:this={confirmDialog}
	class="confirm-dialog"
	aria-labelledby="confirm-title"
	oncancel={(e) => {
		e.preventDefault();
		closeDialog();
	}}
>
	<h2 id="confirm-title">Delete this entry?</h2>
	<p>This can't be undone.</p>
	<div class="confirm-actions">
		<button type="button" class="ghost" onclick={() => closeDialog()}>Cancel</button>
		<button type="button" class="danger" onclick={confirmDelete}>Delete</button>
	</div>
</dialog>
