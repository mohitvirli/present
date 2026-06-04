<script lang="ts">
	import type { Entry } from '$lib/db';
	import { extractText, firstHeading } from '$lib/tiptap';

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

	const preview = $derived.by(() => {
		let body = extractText(entry.content);
		// drop a leading heading line if it was promoted to the title
		if (!entry.metadata.title && heading && body.startsWith(heading)) {
			body = body.slice(heading.length).trim();
		}
		body = body.replace(/\s+/g, ' ').trim();
		return body.length > 140 ? body.slice(0, 140).trimEnd() + '…' : body;
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

	{#if preview}
		<p class="preview">{preview}</p>
	{/if}

	{#if entry.metadata.tags?.length}
		<ul class="tags">
			{#each entry.metadata.tags as t (t)}
				<li>#{t}</li>
			{/each}
		</ul>
	{/if}
</a>
