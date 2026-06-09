<script lang="ts">
	import type { Entry } from '$lib/db';
	import { firstHeading } from '$lib/tiptap';
	import { renderEntryHTML } from '$lib/tiptap-render';
	import { tagStyle } from '$lib/tag-color';

	let { entry }: { entry: Entry } = $props();

	function time(ts: number): string {
		return new Date(ts).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// time spent writing: updatedAt − createdAt, shown only when meaningful
	const duration = $derived.by(() => {
		const ms = entry.updatedAt - entry.createdAt;
		if (ms < 60_000) return ''; // under a minute → skip
		const mins = Math.round(ms / 60_000);
		if (mins < 60) return `${mins} min`;
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return m ? `${h}h ${m}m` : `${h}h`;
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
		{#if duration}<span class="duration">{duration}</span>{/if}
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
				<li class="tag" style={tagStyle(t)}>{t}</li>
			{/each}
		</ul>
	{/if}
</a>
