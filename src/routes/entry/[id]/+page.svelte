<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getEntry, updateEntry, deleteEntry, type Entry, type EntryMetadata } from '$lib/db';
	import { renderMarkdown } from '$lib/markdown';
	import MetadataPanel from '$lib/components/MetadataPanel.svelte';

	let entry = $state<Entry | undefined | null>(undefined); // undefined=loading, null=not found
	let editing = $state(false);
	let draft = $state('');
	let draftMeta = $state<EntryMetadata>({});

	onMount(async () => {
		const id = page.params.id;
		const e = id ? await getEntry(id) : undefined;
		entry = e ?? null;
		if (e) {
			draft = e.content;
			draftMeta = { ...e.metadata };
		}
	});

	async function save() {
		if (!entry) return;
		entry = await updateEntry(entry.id, { content: draft, metadata: draftMeta });
		editing = false;
	}

	async function remove() {
		if (!entry) return;
		if (!confirm('Delete this entry?')) return;
		await deleteEntry(entry.id);
		await goto('/');
	}

	function fmt(ts: number) {
		return new Date(ts).toLocaleString(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		});
	}
</script>

{#if entry === undefined}
	<p class="muted">Loading…</p>
{:else if entry === null}
	<p>Entry not found. <a href="/">Back to timeline</a></p>
{:else}
	<article class="entry-detail">
		<header>
			<time>{fmt(entry.createdAt)}</time>
			{#if entry.updatedAt !== entry.createdAt}
				<span class="muted">edited {fmt(entry.updatedAt)}</span>
			{/if}
			<div class="actions">
				{#if !editing}
					<button onclick={() => (editing = true)}>Edit</button>
				{:else}
					<button onclick={save}>Save</button>
					<button onclick={() => (editing = false)}>Cancel</button>
				{/if}
				<button class="danger" onclick={remove}>Delete</button>
			</div>
		</header>

		{#if editing}
			<textarea bind:value={draft} rows="20"></textarea>
			<MetadataPanel bind:meta={draftMeta} />
		{:else}
			{#if entry.metadata.title}<h1>{entry.metadata.title}</h1>{/if}
			<div class="meta-strip">
				{#if entry.metadata.mood}<span>mood: {entry.metadata.mood}</span>{/if}
				{#if entry.metadata.location}<span>📍 {entry.metadata.location}</span>{/if}
				{#if entry.metadata.wordCount}<span>{entry.metadata.wordCount} words</span>{/if}
			</div>
			{#if entry.metadata.tags?.length}
				<ul class="tags">
					{#each entry.metadata.tags as t (t)}<li>#{t}</li>{/each}
				</ul>
			{/if}
			<div class="content">{@html renderMarkdown(entry.content)}</div>
		{/if}
	</article>
{/if}
