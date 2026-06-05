<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import gsap from 'gsap';
	import type { Editor as TiptapEditor, JSONContent } from '@tiptap/core';
	import { page } from '$app/state';
	import { gIn, gOut, gFade } from '$lib/transitions';
	import { replaceState, goto } from '$app/navigation';
	import { addEntry, updateEntry, deleteEntry, getEntry, type EntryMetadata } from '$lib/db';
	import { composer } from '$lib/composer.svelte';
	import { aiSettings } from '$lib/settings.svelte';
	import { extractText } from '$lib/tiptap';
	import Editor from '$lib/components/Editor.svelte';

	let content = $state<JSONContent | string | null>(null);
	let text = $state(''); // plain text mirror for counts/gating
	let meta = $state<EntryMetadata>({});
	let tagsInput = $state('');
	let entryId = $state<string | null>(null);
	let saving = $state(false);
	let savedAt = $state<number | null>(null);
	let createdAt = $state<number | null>(null);
	let showMeta = $state(false);
	let readonly = $state(false); // viewing an existing entry
	let ready = $state(false); // gate editor creation + autosave until load done
	let dockDelay = $state(0.45);
	let ctxBtnDelay = $state(0.45);
	let editor = $state<TiptapEditor>();
	let writingEl: HTMLElement;

	function focusEditor() {
		editor?.commands.focus('end');
	}

	onMount(async () => {
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (writingEl && !reduce) gsap.set(writingEl, { opacity: 0, y: 8 });

		let openContext = false;
		const id = page.url.searchParams.get('id');
		if (id) {
			const e = await getEntry(id);
			if (e) {
				content = e.content as JSONContent | string;
				text = extractText(content);
				meta = { ...e.metadata };
				tagsInput = (e.metadata.tags ?? []).join(', ');
				entryId = e.id;
				savedAt = e.updatedAt;
				createdAt = e.createdAt;
				readonly = true;
				openContext = !!(e.metadata.title?.trim() || (e.metadata.tags && e.metadata.tags.length));
			}
		}
		ready = true;
		await tick();

		const contentDelay = openContext ? 0.55 : 0.1;
		ctxBtnDelay = openContext ? 0.1 : 0.45;
		dockDelay = openContext ? 0.85 : 0.45;

		if (writingEl && !reduce) {
			gsap.to(writingEl, {
				y: 0,
				opacity: 1,
				duration: 0.6,
				delay: contentDelay,
				ease: 'power3.out',
				onComplete: () => {
					if (!readonly) focusEditor();
				}
			});
		} else if (!readonly) {
			focusEditor();
		}

		if (openContext) {
			if (reduce) showMeta = true;
			else requestAnimationFrame(() => requestAnimationFrame(() => (showMeta = true)));
		}
	});

	function onEditorChange(doc: JSONContent, txt: string) {
		content = doc;
		text = txt;
	}

	$effect(() => {
		meta.tags = tagsInput
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
	});

	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	async function doSave() {
		if (!text.trim() || content == null) return;
		saving = true;
		try {
			if (!entryId) {
				const e = await addEntry(content, meta);
				entryId = e.id;
				replaceState(`/entry?id=${e.id}`, {});
			} else {
				await updateEntry(entryId, { content, metadata: meta });
			}
			savedAt = Date.now();
		} finally {
			saving = false;
		}
	}

	// autosave — only once loaded and while editable
	$effect(() => {
		void content;
		void JSON.stringify(meta);
		if (!ready || readonly) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(doSave, 600);
	});

	$effect(() => {
		composer.entryId = entryId;
		composer.readonly = readonly;
		composer.createdAt = createdAt;
	});

	function startEditing() {
		readonly = false;
		tick().then(focusEditor);
	}

	async function removeEntry() {
		if (!entryId) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = null;
		const id = entryId;
		entryId = null;
		content = null;
		text = '';
		await deleteEntry(id);
		await goto('/');
	}

	composer.delete = removeEntry;
	composer.edit = startEditing;

	onDestroy(() => {
		if (saveTimer) clearTimeout(saveTimer);
		if (!readonly && text.trim() && entryId && content != null) {
			updateEntry(entryId, { content, metadata: meta });
		}
		composer.entryId = null;
		composer.readonly = false;
		composer.createdAt = null;
		composer.delete = null;
		composer.edit = null;
	});

	let hasContent = $derived(text.trim().length > 0);
	let hasMeta = $derived(
		!!(meta.title?.trim() || (meta.tags && meta.tags.length) || meta.mood || meta.location?.trim())
	);
	let showContext = $derived(hasContent || hasMeta);
	let showContextBtn = $derived(readonly ? hasMeta : showContext);
	let wordCount = $derived(text.trim().split(/\s+/).filter(Boolean).length);

	$effect(() => {
		if (!showContextBtn) showMeta = false;
	});

	function fmtTime(ts: number) {
		const d = new Date(ts);
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}

	// ----- AI suggestions (title / tags / summary) -----
	type Tone = 'positive' | 'neutral' | 'negative';
	type Suggestion = {
		title: string;
		tags: string[];
		summary: string;
		emotion: string;
		tone: Tone;
		secondaryEmotion: string | null;
	};
	let aiBusy = $state(false);
	let aiError = $state('');

	async function suggest() {
		if (aiBusy || !text.trim()) return;
		aiBusy = true;
		aiError = '';
		try {
			const res = await fetch('/api/analyze', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Failed');
			const s = (await res.json()) as Suggestion;
			// write suggestions straight into the fields
			meta.title = s.title;
			tagsInput = s.tags.join(', ');
			// derived metadata (saved by autosave)
			meta.aiSummary = s.summary;
			meta.aiEmotion = s.emotion;
			meta.aiTone = s.tone;
			meta.aiEmotion2 = s.secondaryEmotion ?? undefined;
			meta.aiTags = s.tags;
		} catch (e) {
			aiError = e instanceof Error ? e.message : 'Failed';
		} finally {
			aiBusy = false;
		}
	}

	function removeEmotion(which: 'primary' | 'secondary') {
		if (which === 'secondary') {
			meta.aiEmotion2 = undefined;
			return;
		}
		// removing the primary promotes the secondary (if any) to primary
		if (meta.aiEmotion2) {
			meta.aiEmotion = meta.aiEmotion2;
			meta.aiEmotion2 = undefined;
		} else {
			meta.aiEmotion = undefined;
		}
		meta.aiTone = undefined;
	}

	function toggleSummary() {
		meta.aiSummaryHidden = !meta.aiSummaryHidden;
		// autosave only runs in edit mode; persist directly when viewing
		if (readonly && entryId) void updateEntry(entryId, { metadata: meta });
	}
</script>

<div class="composer" class:readonly>
	<div class="details-row">
		{#if showContextBtn}
			<button
				type="button"
				class="meta-toggle"
				aria-expanded={showMeta}
				aria-controls="details-panel"
				onclick={() => (showMeta = !showMeta)}
				in:gIn={{ y: -4, duration: 0.6, delay: ctxBtnDelay }}
				out:gOut={{ y: -4, duration: 0.16 }}
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

	<div id="details-panel" class="details-collapse" class:open={showMeta}>
		<div class="details-panel">
			<div class="title-row">
				{#if readonly}
					<h1 class="title-input title-static" class:untitled={!meta.title?.trim()}>
						{meta.title?.trim() || 'Untitled'}
					</h1>
				{:else}
					<input class="title-input" bind:value={meta.title} placeholder="Untitled" />
				{/if}
			</div>
			<input
				class="tags-input"
				bind:value={tagsInput}
				placeholder="Add tags, comma separated"
				readonly={readonly}
			/>

			{#if !readonly}
				{#if aiSettings.enabled}
					<div class="ai-row">
						<button type="button" class="ai-suggest" onclick={suggest} disabled={aiBusy || !hasContent}>
							{#if aiBusy}Thinking…{:else}✦ Suggest{/if}
						</button>
						{#if aiError}<span class="ai-error">{aiError}</span>{/if}
					</div>

					{#if meta.aiEmotion || meta.aiSummary}
						<div class="ai-suggestion">
							{#if meta.aiEmotion}
								<div class="ai-moods">
									<span class="ai-mood" data-tone={meta.aiTone ?? 'neutral'}>
										<span class="mood-dot" aria-hidden="true"></span>
										<span class="ai-label">mood</span>{meta.aiEmotion}
										<button
											type="button"
											class="mood-remove"
											onclick={() => removeEmotion('primary')}
											aria-label="Remove {meta.aiEmotion} mood"
										>✕</button>
									</span>
									{#if meta.aiEmotion2}
										<span class="ai-mood secondary">
											{meta.aiEmotion2}
											<button
												type="button"
												class="mood-remove"
												onclick={() => removeEmotion('secondary')}
												aria-label="Remove {meta.aiEmotion2} mood"
											>✕</button>
										</span>
									{/if}
								</div>
							{/if}
							{#if meta.aiSummary}
								{#if meta.aiSummaryHidden}
									<button
										type="button"
										class="ai-summary-show"
										onclick={toggleSummary}
										in:gIn={{ y: -4, duration: 0.32 }}
									>
										✦ Show summary
									</button>
								{:else}
									<button
										type="button"
										class="ai-summary"
										onclick={toggleSummary}
										title="Hide summary"
										in:gIn={{ y: -4, duration: 0.32 }}
									>
										<span>{meta.aiSummary}</span>
										<span class="summary-remove" aria-hidden="true">✕</span>
									</button>
								{/if}
							{/if}
						</div>
					{/if}
				{/if}
			{:else if meta.aiEmotion || meta.aiSummary}
				<div class="ai-suggestion">
					{#if meta.aiEmotion}
						<div class="ai-moods">
							<span class="ai-mood" data-tone={meta.aiTone ?? 'neutral'}>
								<span class="mood-dot" aria-hidden="true"></span>
								<span class="ai-label">mood</span>{meta.aiEmotion}
							</span>
							{#if meta.aiEmotion2}
								<span class="ai-mood secondary">{meta.aiEmotion2}</span>
							{/if}
						</div>
					{/if}
					{#if meta.aiSummary}
						{#if meta.aiSummaryHidden}
							<button
								type="button"
								class="ai-summary-show"
								onclick={toggleSummary}
								in:gIn={{ y: -4, duration: 0.32 }}
							>
								✦ Show summary
							</button>
						{:else}
							<button
								type="button"
								class="ai-summary readonly"
								onclick={toggleSummary}
								title="Hide summary"
								in:gIn={{ y: -4, duration: 0.32 }}
							>
								<span>{meta.aiSummary}</span>
								<span class="summary-remove" aria-hidden="true">✕</span>
							</button>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<section class="writing" bind:this={writingEl}>
		{#if ready}
			<Editor
				bind:editor
				{content}
				editable={!readonly}
				placeholder="Be present. Write what's here now."
				onChange={onEditorChange}
			/>
		{/if}
	</section>
</div>

{#if hasContent}
	<div
		class="status-dock"
		aria-live="polite"
		in:gIn={{ y: 8, duration: 0.6, delay: dockDelay }}
		out:gFade={{ duration: 0.16 }}
	>
		<span class="word-count">{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
		{#if saving || savedAt}
			<span class="save-line">{saving ? 'Saving…' : `Saved ${fmtTime(savedAt!)}`}</span>
		{/if}
	</div>
{/if}
