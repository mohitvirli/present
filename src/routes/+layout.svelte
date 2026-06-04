<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { gIn, gFade } from '$lib/transitions';
	import gsap from 'gsap';
	import Lenis from 'lenis';
	import favicon from '$lib/assets/favicon.svg';
	import Settings from '$lib/components/Settings.svelte';
	import Clock from '$lib/components/Clock.svelte';
	import Scrollbar from '$lib/components/Scrollbar.svelte';
	import { composer } from '$lib/composer.svelte';
	import { scroll } from '$lib/scroll.svelte';
	let { children } = $props();

	let isNew = $derived(page.url.pathname === '/entry');

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
	<link rel="icon" href={favicon} />
</svelte:head>

<Scrollbar />

<div class="shell">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<header
		class="topbar"
		class:reveal-actions={headerHovered}
		onpointerenter={() => (headerHovered = true)}
		onpointerleave={() => (headerHovered = false)}
	>
		<div class="topbar-inner" bind:this={topbarInner}>
			{#if isNew}
				<a class="brand" href="/" aria-label="present — home" in:gFade={{ duration: 1.1, delay: 0.7 }}>
					<Clock at={composer.createdAt} />
				</a>
			{:else}
				<a class="cta" href="/entry" in:gFade={{ duration: 0.3 }}>
					Be Present <span class="cta-plus" aria-hidden="true">+</span>
				</a>
			{/if}
			{#if !isNew}
				<nav in:gIn={{ x: 12, duration: 0.35, delay: 0.1 }}>
					<Settings />
				</nav>
			{:else}
				<div class="header-actions">
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
	<main>{@render children()}</main>
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
