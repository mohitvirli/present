<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import gsap from 'gsap';
	import type { Editor as TiptapEditor, JSONContent } from '@tiptap/core';
	import { page } from '$app/state';
	import { gIn, gOut, gFade } from '$lib/transitions';
	import { replaceState, goto } from '$app/navigation';
	import {
		addEntry,
		updateEntry,
		deleteEntry,
		getEntry,
		clearTutorialEntries,
		getAllTags,
		type EntryMetadata
	} from '$lib/db';
	import { composer } from '$lib/composer.svelte';
	import { aiSettings, micSettings, spellcheckSettings } from '$lib/settings.svelte';
	import { extractText, extractTags } from '$lib/tiptap';
	import { createDictation } from '$lib/dictation.svelte';
	import { dictationKey, type DictationState } from '$lib/tiptap-dictation';
	import { suggestionKey } from '$lib/tiptap-suggestion';
	import { queueSync } from '$lib/sync.svelte';
	import { shareEntryImage, downloadLastShareImage } from '$lib/share';
	import { hasWrittenEntry, markEntryWritten } from '$lib/onboarding';
	import { pickPlaceholder, FIRST_RUN_PLACEHOLDER } from '$lib/placeholders';
	import Editor from '$lib/components/Editor.svelte';
	import RollingNumber from '$lib/components/RollingNumber.svelte';
	import TagInput from '$lib/components/TagInput.svelte';

	// Picked once per entry (the page remounts on each new entry). A brand-new
	// user writing their first entry gets a dedicated welcoming placeholder.
	const isNewEntry = !page.url.searchParams.get('id');
	const placeholder = isNewEntry && !hasWrittenEntry() ? FIRST_RUN_PLACEHOLDER : pickPlaceholder();

	let content = $state<JSONContent | string | null>(null);
	let text = $state(''); // plain text mirror for counts/gating
	let meta = $state<EntryMetadata>({});
	let tags = $state<string[]>([]); // chip list, mirrored into meta.tags
	let allTags = $state<{ tag: string; count: number }[]>([]); // autocomplete vocabulary
	let entryId = $state<string | null>(null);
	let saving = $state(false);
	let savedAt = $state<number | null>(null);
	let createdAt = $state<number | null>(null);
	let showMeta = $state(false);
	let readonly = $state(false); // viewing an existing entry
	let loadedContentStr = ''; // JSON of the loaded doc, to detect real edits in view mode
	let ready = $state(false); // gate editor creation + autosave until load done
	let dockDelay = $state(0.45);
	let ctxBtnDelay = $state(0.45);
	let editor = $state<TiptapEditor>();
	let writingEl: HTMLElement;
	let lastFocusWasTitleOrTags = false;

	function focusEditor() {
		editor?.commands.focus('end');
	}

	// Voice dictation → streams words live into the editor. Interim results
	// occupy a tracked region that gets replaced on each update; on a final
	// result the region is committed (kept) and a fresh one starts after it.
	let interimFrom: number | null = null;
	let interimLen = 0;
	// When the user is focused in the title or tags input, we track any
	// interim text inserted there so subsequent interim updates replace the
	// previous tentative fragment instead of appending repeatedly.
	let inputInterimEl: HTMLInputElement | null = null;
	let inputInterimRange: { start: number; len: number } | null = null;

	function applyTranscript(text: string, isFinal: boolean) {
		// If the user is focused in the title or tags input, write direct to
		// that input instead of the editor so dictation follows the user's focus.
		const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
		const focusedIsInput = !!(
			activeEl &&
			(activeEl.classList.contains('title-input') || activeEl.classList.contains('tags-input'))
		);

		if (focusedIsInput) {
			const input = activeEl as HTMLInputElement;
			// Remove previous interim fragment if it was inserted into this same input
			let base = input.value;
			let insertPos = input.selectionStart ?? base.length;
			if (inputInterimEl === input && inputInterimRange) {
				base = base.slice(0, inputInterimRange.start) + base.slice(inputInterimRange.start + inputInterimRange.len);
				insertPos = inputInterimRange.start;
			}

			const newVal = base.slice(0, insertPos) + text + base.slice(insertPos);
			input.value = newVal;
			const caret = insertPos + text.length;
			input.setSelectionRange(caret, caret);

			// update bound state so Svelte sees the change
			if (input.classList.contains('title-input')) meta.title = input.value;
			// the tags field is its own component bound via an `input` event — fire
			// one so its draft state picks up the dictated text
			else if (input.classList.contains('tags-input'))
				input.dispatchEvent(new Event('input', { bubbles: true }));

			if (isFinal) {
				inputInterimEl = null;
				inputInterimRange = null;
			} else {
				inputInterimEl = input;
				inputInterimRange = { start: insertPos, len: text.length };
			}
			return;
		}

		if (!editor) return;
		const docSize = editor.state.doc.content.size;

		// stale region (e.g. manual edit shifted things) → start fresh
		if (interimFrom != null && interimFrom + interimLen > docSize) {
			interimFrom = null;
			interimLen = 0;
		}

		// establish the insertion point, adding a separating space if needed
		if (interimFrom == null) {
			let pos = editor.state.selection.to;
			const prev = pos > 0 ? editor.state.doc.textBetween(pos - 1, pos, '\n', '\n') : '';
			const needsSpace = pos > 0 && prev !== '' && !/\s/.test(prev);
			if (needsSpace) {
				editor.chain().focus().insertContentAt(pos, ' ').run();
				pos += 1;
			} else {
				editor.commands.focus();
			}
			interimFrom = pos;
			interimLen = 0;
		}

		const from = interimFrom;
		const to = from + interimLen;
		const chain = editor.chain();
		if (interimLen > 0) chain.deleteRange({ from, to });
		chain.insertContentAt(from, text).setTextSelection(from + text.length).run();
		interimLen = text.length;
		const end = from + text.length;

		if (isFinal) {
			// committed: drop tentative styling, run a one-shot settle over the
			// finalized words, keep the live caret trailing at the end
			setDeco({ interim: null, settling: { from, to: end } });
			if (settleTimer) clearTimeout(settleTimer);
			settleTimer = setTimeout(() => setDeco({ settling: null }), 400);
			interimFrom = null;
			interimLen = 0;
		} else {
			setDeco({ interim: { from, to: end }, settling: null });
		}
	}

	let settleTimer: ReturnType<typeof setTimeout> | null = null;

	function setDeco(meta: Partial<DictationState>) {
		if (!editor) return;
		editor.view.dispatch(editor.state.tr.setMeta(dictationKey, meta));
	}

	const dictation = createDictation(applyTranscript);

	// Open the Deepgram socket as soon as the entry is editable so the mic is
	// instant. Idempotent — safe to re-run when 'edit' flips a view to editable.
	$effect(() => {
		if (ready && !readonly && dictation.supported && micSettings.enabled) {
			dictation.mount();
		} else {
			dictation.unmount();
		}
	});

	// Show the live caret the moment recording starts; clear all dictation
	// decorations when it stops.
	$effect(() => {
		if (!editor) return;
		if (dictation.status === 'recording') {
			// Ensure the editor has focus when recording starts so incoming
			// dictation text is inserted even if the user tapped elsewhere.
			try {
				const active = document.activeElement as HTMLElement | null;
				const editorDom = (editor.view && (editor.view.dom as HTMLElement)) || null;
				if (editorDom && active && !editorDom.contains(active)) {
					// If the user was editing title or tags just before recording
					// started, avoid stealing focus. We track the last focused element
					// via `lastFocusWasTitleOrTags` because clicking the mic blurs the
					// input before status flips to 'recording'.
					if (!lastFocusWasTitleOrTags) editor.commands.focus();
				}
			} catch (e) {
				// noop
			}
			// initial caret widget removed; no-op here.
		} else {
			setDeco({ interim: null, settling: null });
			interimFrom = null;
			interimLen = 0;
		}
	});

	function fmtElapsed(s: number) {
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}

	function onFocusIn(e: FocusEvent) {
		try {
			const t = e.target as HTMLElement | null;
			lastFocusWasTitleOrTags = !!(t && (t.closest('.title-input') || t.closest('.tags-input')));
		} catch (e) {
			lastFocusWasTitleOrTags = false;
		}
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
				loadedContentStr = JSON.stringify(e.content);
				text = extractText(content);
				meta = { ...e.metadata };
				tags = [...(e.metadata.tags ?? [])];
				entryId = e.id;
				savedAt = e.updatedAt;
				createdAt = e.createdAt;
				// pinned notes are living documents — open them straight into edit mode
				readonly = !e.metadata.pinned;
				// Tags written in the body as `#` chips are visible where they were
				// written, so they don't earn an open panel — only a title or a tag
				// typed into the Context header itself does.
				const inBody = new Set(extractTags(content).map((t) => t.toLowerCase()));
				const headerTags = (e.metadata.tags ?? []).filter((t) => !inBody.has(t.toLowerCase()));
				openContext = !!(e.metadata.title?.trim() || headerTags.length);
				composer.pinned = !!meta.pinned;
				composer.pin = togglePin;
				// count this open as a view — metadata-only write, so the entry's
				// visible "updated" time stays put (only content edits move it)
				meta.views = (meta.views ?? 0) + 1;
				void updateEntry(e.id, { metadata: meta });
			}
		}
		ready = true;
		void getAllTags().then((t) => (allTags = t));
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

		document.addEventListener('focusin', onFocusIn);
	});

	onDestroy(() => {
		document.removeEventListener('focusin', onFocusIn);
	});

	function onEditorChange(doc: JSONContent, txt: string) {
		content = doc;
		text = txt;
		// reflection mode: re-arm the ghost-question fetch on each pause in typing
		if (!readonly) scheduleReflect();
		// toggling a todo while viewing (read-only) bypasses the editable autosave,
		// so persist the change here too — but ONLY when the doc actually changed.
		// TipTap fires onUpdate while loading content, which would otherwise bump
		// updatedAt on every open (inflating the timeline's writing-duration).
		if (readonly && entryId) {
			const docStr = JSON.stringify(doc);
			if (docStr === loadedContentStr) return; // no real edit, e.g. initial load
			if (saveTimer) clearTimeout(saveTimer);
			saveTimer = setTimeout(async () => {
				if (!entryId) return;
				await updateEntry(entryId, { content: doc, metadata: meta });
				loadedContentStr = docStr;
				savedAt = Date.now();
				queueSync();
			}, 400);
		}
	}

	// mirror the chip list into the saved metadata
	$effect(() => {
		meta.tags = [...tags];
	});

	// A tag picked from the editor's `#` menu joins the chip list — quietly. The
	// chip is already visible in the prose where it was written, so the Context
	// panel stays however the writer left it.
	function addTagFromBody(tag: string) {
		const t = tag.trim();
		if (!t || tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
		tags = [...tags, t];
	}

	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	async function doSave() {
		// emptied an existing entry → remove it instead of persisting a blank doc
		// (or leaving the last non-empty content stranded in the DB)
		if (!text.trim()) {
			if (entryId) {
				const id = entryId;
				entryId = null;
				savedAt = null;
				replaceState('/entry', {}); // drop ?id so a later save creates fresh
				await deleteEntry(id);
				queueSync();
			}
			return;
		}
		if (content == null) return;
		saving = true;
		try {
			if (!entryId) {
				const e = await addEntry(content, meta);
				entryId = e.id;
				replaceState(`/entry?id=${e.id}`, {});
				markEntryWritten(); // first-run placeholder won't show again
				// first real entry → clear the seeded tutorial examples
				void clearTutorialEntries();
			} else {
				await updateEntry(entryId, { content, metadata: meta });
			}
			savedAt = Date.now();
			queueSync();
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
		// offer the reflection toggle only while writing a new/editable entry with AI on
		composer.canReflect = ready && !readonly && aiSettings.enabled;
	});

	// ----- Reflection mode: ghost follow-up question at the caret -----
	let reflectTimer: ReturnType<typeof setTimeout> | null = null;
	let reflectBusy = false;

	function clearGhost() {
		if (editor) editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, null));
	}

	function scheduleReflect() {
		if (reflectTimer) clearTimeout(reflectTimer);
		if (!composer.reflection || readonly || !editor) return;
		reflectTimer = setTimeout(runReflect, 2500);
	}

	async function runReflect() {
		if (!editor || !composer.reflection || readonly || reflectBusy) return;
		if (text.trim().split(/\s+/).filter(Boolean).length < 15) return;
		const sel = editor.state.selection;
		if (!sel.empty) return; // only when idle at a caret
		// only when the caret sits at the end of its block (a natural pause point)
		if (sel.$to.parentOffset !== sel.$to.parent.content.size) return;
		reflectBusy = true;
		try {
			const res = await fetch('/api/reflect', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text })
			});
			if (!res.ok) return;
			const { question } = (await res.json()) as { question: string };
			if (!question || !composer.reflection || !editor) return;
			const pos = editor.state.selection.to;
			editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { pos, text: '  ' + question }));
		} catch {
			/* network/AI hiccup — silently skip */
		} finally {
			reflectBusy = false;
		}
	}

	// re-arm on toggle: schedule when turned on, clear the ghost when turned off
	$effect(() => {
		if (composer.reflection) scheduleReflect();
		else {
			if (reflectTimer) clearTimeout(reflectTimer);
			clearGhost();
		}
	});

	function startEditing(pos?: number) {
		readonly = false;
		tick().then(() => {
			if (pos != null && editor) editor.commands.focus(pos);
			else focusEditor();
		});
	}

	// While viewing: press E to edit (caret at end), or double-click the text
	// to edit with the caret where you clicked.
	function onReadonlyKeydown(e: KeyboardEvent) {
		if (!readonly || !ready) return;
		if (e.key !== 'e' && e.key !== 'E') return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const t = e.target as HTMLElement | null;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
		e.preventDefault();
		startEditing();
	}

	function onWritingDblClick(e: MouseEvent) {
		if (!readonly || !editor) return;
		const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
		startEditing(hit?.pos);
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
		queueSync();
		await goto('/');
	}

	composer.delete = removeEntry;
	composer.edit = startEditing;

	let shareStateTimer: ReturnType<typeof setTimeout> | undefined;
	function setShareState(state: typeof composer.shareState, ttl?: number) {
		if (shareStateTimer) clearTimeout(shareStateTimer);
		composer.shareState = state;
		if (ttl) shareStateTimer = setTimeout(() => setShareState('idle'), ttl);
	}

	async function doShare() {
		if (composer.sharing || content == null || !text.trim()) return;
		// while the button shows the download affordance, clicking it downloads
		// the already-rendered image instead of re-sharing
		if (composer.shareState === 'download' && downloadLastShareImage()) {
			setShareState('idle');
			return;
		}
		composer.sharing = true;
		try {
			const result = await shareEntryImage({
				content,
				wordCount,
				at: createdAt ?? Date.now(),
				title: meta.title,
				tags
			});
			if (result === 'copied') {
				// flash the check, then offer a download for a while
				setShareState('copied');
				shareStateTimer = setTimeout(() => setShareState('download', 4000), 1500);
			}
		} finally {
			composer.sharing = false;
		}
	}

	// offer the header share button only once there's something to capture
	$effect(() => {
		composer.share = hasContent ? doShare : null;
	});

	onDestroy(() => {
		dictation.unmount();
		if (saveTimer) clearTimeout(saveTimer);
		if (reflectTimer) clearTimeout(reflectTimer);
		if (!readonly && entryId) {
			// leaving with content → flush a final save; leaving emptied → delete the
			// entry so a cleared-out doc never lingers if we navigate before autosave
			if (text.trim() && content != null) {
				updateEntry(entryId, { content, metadata: meta });
			} else if (!text.trim()) {
				deleteEntry(entryId).then(queueSync);
			}
		}
		composer.entryId = null;
		composer.readonly = false;
		composer.createdAt = null;
		composer.delete = null;
		composer.edit = null;
		composer.share = null;
		composer.sharing = false;
		composer.pin = null;
		composer.pinned = false;
		if (shareStateTimer) clearTimeout(shareStateTimer);
		composer.shareState = 'idle';
		composer.reflection = false;
		composer.canReflect = false;
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
			tags = [...s.tags];
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

	function togglePin() {
		if (!entryId) return;
		// undefined (not false) to unpin — plain() strips it, the repo's "key removed" convention
		meta.pinned = meta.pinned ? undefined : true;
		composer.pinned = !!meta.pinned;
		void updateEntry(entryId, { metadata: meta });
	}

	function toggleSummary() {
		meta.aiSummaryHidden = !meta.aiSummaryHidden;
		// autosave only runs in edit mode; persist directly when viewing
		if (readonly && entryId) void updateEntry(entryId, { metadata: meta });
	}
</script>

<svelte:window onkeydown={onReadonlyKeydown} />

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
			{#if readonly}
				<!-- viewing: only surface fields that were actually filled in -->
				{#if meta.title?.trim()}
					<div class="title-row">
						<h1 class="title-input title-static">{meta.title.trim()}</h1>
					</div>
				{/if}
				{#if tags.length}
					<TagInput bind:tags suggestions={allTags} readonly placeholder="Add tags" />
				{/if}
			{:else}
				<div class="title-row">
					<input
						class="title-input"
						bind:value={meta.title}
						placeholder="Untitled"
						spellcheck={spellcheckSettings.enabled}
					/>
				</div>
				<TagInput bind:tags suggestions={allTags} placeholder="Add tags" />
			{/if}

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

	<!-- double-click to edit has a keyboard equivalent: the E shortcut -->
	<section class="writing" bind:this={writingEl} ondblclick={onWritingDblClick}>
		{#if ready}
			<Editor
				bind:editor
				{content}
				editable={!readonly}
				{placeholder}
				onChange={onEditorChange}
				tagVocabulary={allTags}
				entryTags={tags}
				onTag={addTagFromBody}
			/>
		{/if}
	</section>

	{#if ready && !readonly && dictation.supported && micSettings.enabled}
		<div class="dictation" class:active={dictation.status === 'recording'} in:gFade={{ duration: 1.1, delay: 0.7 }}>
			<button
				type="button"
				class="mic"
				class:recording={dictation.status === 'recording'}
				disabled={dictation.status === 'connecting'}
				onpointerdown={() => dictation.prewarm()}
				onclick={() => dictation.toggle()}
				aria-label={dictation.status === 'recording' ? 'Stop dictation' : 'Start live dictation'}
				title={dictation.status === 'recording' ? 'Stop dictation' : 'Live dictation'}
			>
				{#if dictation.status === 'connecting'}
					<svg class="spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
						<path d="M21 12a9 9 0 1 1-6.2-8.6" />
					</svg>
				{:else}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<rect x="9" y="2" width="6" height="12" rx="3" />
						<path d="M5 10a7 7 0 0 0 14 0" />
						<line x1="12" y1="19" x2="12" y2="22" />
					</svg>
				{/if}
			</button>
			{#if dictation.status === 'recording'}
				<span class="dictation-meta" aria-live="polite" in:gIn={{ x: -18, duration: 0.28 }}>{fmtElapsed(dictation.elapsed)}</span>
			{:else if dictation.status === 'connecting'}
				<span class="dictation-meta">Connecting…</span>
			{:else if dictation.status === 'error'}
				<span class="dictation-meta error">{dictation.error}</span>
			{/if}
		</div>
	{/if}
</div>

{#if hasContent}
	<div
		class="status-dock"
		aria-live="polite"
		in:gIn={{ y: 8, duration: 0.6, delay: dockDelay }}
		out:gFade={{ duration: 0.16 }}
	>
		<span class="word-count">
			<span class="sr-only">{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
			<span aria-hidden="true"><RollingNumber value={wordCount} /> {wordCount === 1 ? 'word' : 'words'}</span>
		</span>
		{#if saving || savedAt}
			<span class="save-line">{saving ? 'Saving…' : `Saved ${fmtTime(savedAt!)}`}</span>
		{/if}
	</div>
{/if}
