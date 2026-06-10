<script lang="ts">
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import Clock from '$lib/components/Clock.svelte';
	import Scrollbar from '$lib/components/Scrollbar.svelte';
	import Settings from '$lib/components/Settings.svelte';
	import { composer } from '$lib/composer.svelte';
	import { scroll } from '$lib/scroll.svelte';
	import { gFade, gIn } from '$lib/transitions';
	import gsap from 'gsap';
	import Lenis from 'lenis';
	import { onMount } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { initSync, fullSync, syncState } from '$lib/sync.svelte';
	import '../app.css';
	let { children } = $props();

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
	afterNavigate(({ to }) => {
		// the timeline restores its own saved position once entries render; only
		// reset to top for other destinations (e.g. opening an entry).
		if (to?.url.pathname === '/') return;
		if (scroll.lenis) scroll.lenis.scrollTo(0, { immediate: true });
		else window.scrollTo(0, 0);
	});

	let isNew = $derived(page.url.pathname === '/entry');

	// single source of truth for the tab title: a saved entry shows its
	// date + time, everything else shows the app name
	let docTitle = $derived.by(() => {
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
				<a class="brand" href="/" aria-label="present — home" in:gFade={{ duration: 1.1, delay: 0.7 }}>
					<Clock at={composer.createdAt} />
				</a>
			{:else}
				<a class="cta" href="/entry" in:gFade={{ duration: 0.3 }}>
					Be Present <span class="cta-plus" aria-hidden="true">→</span>
				</a>
			{/if}
			{#if !isNew}
				<nav in:gIn={{ x: 12, duration: 0.35, delay: 0.1 }}>
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
						<button
							class="header-action"
							onclick={() => composer.share?.()}
							disabled={composer.sharing}
							aria-label="Share entry as image"
							title="Share entry as image"
						>
							{#if composer.sharing}
								<svg class="spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
									<path d="M21 12a9 9 0 1 1-6.2-8.6" />
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
								<circle cx="12" cy="12" r="11" fill="var(--color-bg)" stroke="currentColor" stroke-width="1.5" />
								<path
									fill="currentColor"
									d="M12 1a11 11 0 0 1 0 22 5.5 5.5 0 0 1 0-11 5.5 5.5 0 0 0 0-11z"
								/>
								<circle cx="12" cy="6.5" r="2" fill="currentColor" />
								<circle cx="12" cy="17.5" r="2" fill="var(--color-bg)" />
							</svg>
						</button>
					{/if}
					{#if composer.readonly}
						<button
							class="header-action"
							onclick={() => composer.edit?.()}
							aria-label="Edit entry"
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
