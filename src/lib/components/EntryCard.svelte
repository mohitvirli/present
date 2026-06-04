<script lang="ts">
	import type { Entry } from '$lib/db';

	let { entry }: { entry: Entry } = $props();

	function time(ts: number): string {
		return new Date(ts).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// Strip markdown syntax → clean plain-text snippet for the card preview.
	function stripMarkdown(md: string): string {
		return md
			.replace(/```[\s\S]*?```/g, ' ')
			.replace(/`([^`]+)`/g, '$1')
			.replace(/^#{1,6}\s+/gm, '')
			.replace(/^\s*>\s?/gm, '')
			.replace(/^\s*[-*+]\s+/gm, '')
			.replace(/^\s*\d+\.\s+/gm, '')
			.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
			.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
			.replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
			.replace(/[*_~`>#]/g, '')
			.replace(/\s+/g, ' ')
			.trim();
	}

	// First markdown heading, used as a title fallback when none set.
	const firstHeading = $derived.by(() => {
		const m = entry.content.match(/^#{1,6}\s+(.+)$/m);
		return m ? m[1].trim() : '';
	});

	const displayTitle = $derived(entry.metadata.title || firstHeading);

	const preview = $derived.by(() => {
		// drop a heading line if it was promoted to the title
		const source =
			!entry.metadata.title && firstHeading
				? entry.content.replace(/^#{1,6}\s+.+$/m, '')
				: entry.content;
		const body = stripMarkdown(source);
		return body.length > 140 ? body.slice(0, 140).trimEnd() + '…' : body;
	});
</script>

<a class="entry-card" href="/entry/{entry.id}">
	<time>{time(entry.createdAt)}</time>

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
