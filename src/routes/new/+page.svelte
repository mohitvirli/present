<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { slide, fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { replaceState } from '$app/navigation';
	import { addEntry, updateEntry, type EntryMetadata } from '$lib/db';

	let content = $state('');
	let meta = $state<EntryMetadata>({});
	let tagsInput = $state('');
	let entryId = $state<string | null>(null);
	let saving = $state(false);
	let savedAt = $state<number | null>(null);
	let showMeta = $state(false);
	let textarea: HTMLTextAreaElement;

	onMount(() => textarea?.focus());

	$effect(() => {
		meta.tags = tagsInput
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
	});

	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let firstRun = true;

	async function doSave() {
		if (!content.trim()) return;
		saving = true;
		try {
			if (!entryId) {
				const e = await addEntry(content, meta);
				entryId = e.id;
				replaceState(`/new?id=${e.id}`, {});
			} else {
				await updateEntry(entryId, { content, metadata: meta });
			}
			savedAt = Date.now();
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		void content;
		void JSON.stringify(meta);
		if (firstRun) {
			firstRun = false;
			return;
		}
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(doSave, 600);
	});

	onDestroy(() => {
		if (saveTimer) clearTimeout(saveTimer);
		if (content.trim() && entryId) {
			updateEntry(entryId, { content, metadata: meta });
		}
	});

	let hasContent = $derived(content.trim().length > 0);
	let wordCount = $derived(content.trim().split(/\s+/).filter(Boolean).length);

	$effect(() => {
		if (!hasContent) showMeta = false;
	});

	function fmtTime(ts: number) {
		const d = new Date(ts);
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}
</script>

<div class="composer">
	<div class="details-row">
		{#if hasContent}
			<button
				type="button"
				class="meta-toggle"
				aria-expanded={showMeta}
				aria-controls="details-panel"
				onclick={() => (showMeta = !showMeta)}
				in:fly={{ y: -4, duration: 600, delay: 450, easing: cubicOut }}
				out:fly={{ y: -4, duration: 160, easing: cubicOut }}
			>
				<svg
					class="chevron"
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.4"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<polyline points="9 6 15 12 9 18" />
				</svg>
				<span>Context</span>
			</button>
		{/if}
	</div>

	{#if showMeta}
		<div
			id="details-panel"
			class="details-panel"
			transition:slide={{ duration: 240, easing: cubicOut }}
		>
			<div class="title-row">
				<input
					class="title-input"
					bind:value={meta.title}
					placeholder="Untitled"
				/>
			</div>
			<input
				class="tags-input"
				bind:value={tagsInput}
				placeholder="Add tags, comma separated"
			/>
		</div>
	{/if}

	<section class="writing">
		<textarea
			bind:this={textarea}
			bind:value={content}
			placeholder="Be present. Write what's here now."
		></textarea>
	</section>
</div>

{#if hasContent}
	<div
		class="status-dock"
		aria-live="polite"
		in:fly={{ y: 8, duration: 600, delay: 450, easing: cubicOut }}
		out:fade={{ duration: 160 }}
	>
		<span class="word-count">{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
		{#if saving || savedAt}
			<span class="save-line">{saving ? 'Saving…' : `Saved ${fmtTime(savedAt!)}`}</span>
		{/if}
	</div>
{/if}
