<script lang="ts">
	import type { Entry } from '$lib/db';
	import { filterByTag } from '$lib/search.svelte';
	import { firstHeading } from '$lib/tiptap';
	import { renderEntryHTML } from '$lib/tiptap-render';
	import { tagStyle } from '$lib/tag-color';
	import { placeOf } from '$lib/place';

	let { entry }: { entry: Entry } = $props();

	// tag chip → filter the timeline by that tag instead of opening the entry.
	// The chip lives inside the card's <a> (a nested button would be invalid
	// HTML), so the click must not bubble into navigation.
	function onTag(e: Event, tag: string) {
		e.preventDefault();
		e.stopPropagation();
		filterByTag(tag);
	}

	function time(ts: number): string {
		return new Date(ts).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	const place = $derived(placeOf(entry.metadata.location));

	// co-written entry: who it's with ("with Morvi, Asha +1"), or that you left
	const shared = $derived(entry.metadata.shared);
	const sharedLabel = $derived.by(() => {
		if (!shared) return '';
		if (shared.removed) return 'No longer shared with you';
		const names = shared.with ?? [];
		if (!names.length) return 'Shared';
		const shown = names.slice(0, 2).join(', ');
		return names.length > 2 ? `with ${shown} +${names.length - 2}` : `with ${shown}`;
	});
	const heading = $derived(firstHeading(entry.content));
	const displayTitle = $derived(entry.metadata.title || heading);

	// rich preview — render the entry exactly as written (clipped via CSS). Drop a
	// leading heading when it was promoted to the card title to avoid repetition.
	const previewHTML = $derived(
		renderEntryHTML(entry.content, { dropLeadingHeading: !entry.metadata.title && !!heading })
	);

	// the bottom fade should only show when the preview is actually clipped —
	// measure overflow against the max-height and toggle the mask via a class
	let previewEl = $state<HTMLElement | null>(null);
	let clipped = $state(false);
	$effect(() => {
		void previewHTML; // re-measure when content changes
		const el = previewEl;
		if (!el) return;
		const measure = () => (clipped = el.scrollHeight > el.clientHeight + 1);
		const raf = requestAnimationFrame(measure);
		const ro = new ResizeObserver(measure); // re-check on width changes
		ro.observe(el);
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
		};
	});
</script>

<a class="entry-card" href="/entry?id={entry.id}">
	<span class="entry-meta">
		<time>{time(entry.createdAt)}</time>
		{#if place}<span class="place" title={place.city ?? place.name}>{place.name}</span>{/if}
		{#if shared}
			<span
				class="shared-mark"
				class:removed={shared.removed}
				title={shared.removed ? sharedLabel : `Shared entry — ${shared.with?.join(', ') || 'just you so far'}`}
				><svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><circle cx="9" cy="8" r="3.5" /><path
						d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5"
					/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" /><path d="M18 14.8c2 .7 3.2 2.5 3.5 5.2" /></svg
				><span class="shared-names">{sharedLabel}</span></span
			>
		{/if}
		{#if entry.metadata.views}
			{@const v = entry.metadata.views}
			<span class="views" aria-label="{v} {v === 1 ? 'view' : 'views'}"
				>{v}<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle
						cx="12"
						cy="12"
						r="3"
					/></svg
				></span
			>
		{/if}
	</span>

	{#if displayTitle}
		<h3 class="card-title">{displayTitle}</h3>
	{/if}

	{#if previewHTML}
		<!-- user's own local content; rendered read-only, pointer-events disabled -->
		<div class="preview preview-rich" class:clipped bind:this={previewEl} aria-hidden="true">{@html previewHTML}</div>
	{/if}

	{#if entry.metadata.tags?.length}
		<ul class="tags">
			{#each entry.metadata.tags as t (t)}
				<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
				<li
					class="tag"
					style={tagStyle(t)}
					role="button"
					tabindex="0"
					aria-label="Show entries tagged {t}"
					onclick={(e) => onTag(e, t)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') onTag(e, t);
					}}
				>
					{t}
				</li>
			{/each}
		</ul>
	{/if}
</a>
