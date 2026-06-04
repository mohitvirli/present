<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import gsap from 'gsap';
	import { page } from '$app/state';
	import { gIn, gOut, gFade } from '$lib/transitions';
	import { replaceState, goto } from '$app/navigation';
	import { addEntry, updateEntry, deleteEntry, getEntry, type EntryMetadata } from '$lib/db';
	import { composer } from '$lib/composer.svelte';
	import SmoothCaret from '$lib/components/SmoothCaret.svelte';

	let content = $state('');
	let meta = $state<EntryMetadata>({});
	let tagsInput = $state('');
	let entryId = $state<string | null>(null);
	let saving = $state(false);
	let savedAt = $state<number | null>(null);
	let createdAt = $state<number | null>(null);
	let showMeta = $state(false);
	let readonly = $state(false); // viewing an existing entry
	let ready = $state(false); // gate autosave until initial load done
	let dockDelay = $state(0.45); // status dock entrance delay (sequenced)
	let ctxBtnDelay = $state(0.45); // Context toggle entrance delay (sequenced)
	let textarea = $state<HTMLTextAreaElement>();
	let writingEl: HTMLElement;

	onMount(async () => {
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		// hide the writing area up-front so the async content load doesn't flash
		// an empty editor before the entrance animation
		if (writingEl && !reduce) gsap.set(writingEl, { opacity: 0, y: 8 });

		let openContext = false;
		const id = page.url.searchParams.get('id');
		if (id) {
			const e = await getEntry(id);
			if (e) {
				content = e.content;
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
		autosize();

		// when Context has metadata to show, sequence it first → then content →
		// then the status dock (time). Otherwise content leads.
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
					if (!readonly) textarea?.focus();
				}
			});
		} else if (!readonly) {
			textarea?.focus();
		}

		if (openContext) {
			if (reduce) {
				showMeta = true;
			} else {
				// flip after first paint so the grid-rows transition animates open
				requestAnimationFrame(() => requestAnimationFrame(() => (showMeta = true)));
			}
		}
	});

	function autosize() {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${textarea.scrollHeight}px`;
	}

	// grow textarea to fit content so the page (not the textarea) scrolls
	$effect(() => {
		void content;
		autosize();
	});

	$effect(() => {
		meta.tags = tagsInput
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
	});

	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	async function doSave() {
		if (!content.trim()) return;
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

	// expose entry state + actions to the layout header
	$effect(() => {
		composer.entryId = entryId;
		composer.readonly = readonly;
		composer.createdAt = createdAt;
	});

	function startEditing() {
		readonly = false;
		tick().then(() => textarea?.focus());
	}

	async function removeEntry() {
		if (!entryId) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = null;
		const id = entryId;
		entryId = null;
		content = '';
		await deleteEntry(id);
		await goto('/');
	}

	composer.delete = removeEntry;
	composer.edit = startEditing;

	onDestroy(() => {
		if (saveTimer) clearTimeout(saveTimer);
		if (!readonly && content.trim() && entryId) {
			updateEntry(entryId, { content, metadata: meta });
		}
		composer.entryId = null;
		composer.readonly = false;
		composer.createdAt = null;
		composer.delete = null;
		composer.edit = null;
	});

	let hasContent = $derived(content.trim().length > 0);
	let hasMeta = $derived(
		!!(meta.title?.trim() || (meta.tags && meta.tags.length) || meta.mood || meta.location?.trim())
	);
	let showContext = $derived(hasContent || hasMeta);
	// while viewing (readonly) only show Context if the entry actually has
	// metadata; editing/creating shows it once there's something to attach
	let showContextBtn = $derived(readonly ? hasMeta : showContext);
	let wordCount = $derived(content.trim().split(/\s+/).filter(Boolean).length);

	$effect(() => {
		if (!showContextBtn) showMeta = false;
	});

	function fmtTime(ts: number) {
		const d = new Date(ts);
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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

	<!-- always rendered (collapsed) so it doesn't mount on first keystroke and
	     shift the layout; opens only when showMeta -->
	<div id="details-panel" class="details-collapse" class:open={showMeta}>
		<div class="details-panel">
			<div class="title-row">
				<input
					class="title-input"
					bind:value={meta.title}
					placeholder="Untitled"
					readonly={readonly}
				/>
			</div>
			<input
				class="tags-input"
				bind:value={tagsInput}
				placeholder="Add tags, comma separated"
				readonly={readonly}
			/>
		</div>
	</div>

	<section class="writing" bind:this={writingEl}>
		<textarea
			bind:this={textarea}
			bind:value={content}
			placeholder="Be present. Write what's here now."
			readonly={readonly}
			class:hide-caret={!readonly}
		></textarea>
		{#if !readonly}
			<SmoothCaret el={textarea} active={!readonly} />
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
