<script lang="ts">
	import { filterByTag } from '$lib/search.svelte';
	import { tagStyle } from '$lib/tag-color';

	let {
		tags = $bindable([]),
		suggestions = [],
		readonly = false,
		placeholder = 'Add tags'
	}: {
		tags: string[];
		suggestions?: { tag: string; count: number }[];
		readonly?: boolean;
		placeholder?: string;
	} = $props();

	let draft = $state('');
	let active = $state(-1); // highlighted suggestion index, -1 = none
	let focused = $state(false); // only show the dropdown while typing
	let inputEl: HTMLInputElement | undefined = $state();

	// Suggestions matching the current draft: substring match, exclude tags
	// already added, cap the list so the dropdown stays glanceable.
	const matches = $derived.by(() => {
		const q = draft.trim().toLowerCase();
		if (!q || !focused) return [];
		const have = new Set(tags.map((t) => t.toLowerCase()));
		return suggestions
			.filter((s) => !have.has(s.tag.toLowerCase()) && s.tag.toLowerCase().includes(q))
			.slice(0, 6);
	});

	function add(raw: string) {
		const tag = raw.trim().replace(/^#+/, '').trim();
		if (!tag) return;
		if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
			draft = '';
			active = -1;
			return;
		}
		tags = [...tags, tag];
		draft = '';
		active = -1;
	}

	function removeAt(i: number) {
		tags = tags.filter((_, idx) => idx !== i);
	}

	function commitDraft() {
		if (draft.trim()) add(draft);
	}

	function onKeydown(e: KeyboardEvent) {
		if (readonly) return;
		// Arrow navigation through the suggestion list
		if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			e.preventDefault();
			const dir = e.key === 'ArrowDown' ? 1 : -1;
			active = (active + dir + matches.length) % matches.length;
			return;
		}
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			if (active >= 0 && matches[active]) add(matches[active].tag);
			else commitDraft();
			return;
		}
		if (e.key === 'Escape' && active >= 0) {
			active = -1;
			return;
		}
		// Backspace on an empty draft pulls the last chip back for editing
		if (e.key === 'Backspace' && draft === '' && tags.length) {
			e.preventDefault();
			draft = tags[tags.length - 1];
			tags = tags.slice(0, -1);
		}
	}

	// Paste with commas → multiple chips at once
	function onPaste(e: ClipboardEvent) {
		const text = e.clipboardData?.getData('text') ?? '';
		if (!text.includes(',')) return;
		e.preventDefault();
		for (const part of text.split(',')) add(part);
	}
</script>

<div class="tag-field" class:readonly>
	<ul class="tag-chips" class:empty={!tags.length}>
		{#each tags as t, i (t)}
			<li class="tag" style={tagStyle(t)}>
				{#if readonly}
					<!-- viewing: the chip jumps to the timeline filtered by this tag -->
					<button
						type="button"
						class="tag-label tag-link"
						aria-label="Show entries tagged {t}"
						onclick={() => filterByTag(t)}>{t}</button
					>
				{:else}
					<span class="tag-label">{t}</span>
					<button
						type="button"
						class="tag-remove"
						aria-label="Remove {t}"
						onclick={() => removeAt(i)}>×</button
					>
				{/if}
			</li>
		{/each}

		{#if !readonly}
			<li class="tag-draft">
				<input
					bind:this={inputEl}
					class="tags-input"
					bind:value={draft}
					{placeholder}
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					onkeydown={onKeydown}
					onpaste={onPaste}
					onfocus={() => (focused = true)}
					onblur={() => {
						focused = false;
						commitDraft();
					}}
				/>
				{#if matches.length}
					<ul class="tag-suggestions" role="listbox">
						{#each matches as m, i (m.tag)}
							<li>
								<button
									type="button"
									role="option"
									aria-selected={i === active}
									class="tag-suggestion"
									class:active={i === active}
									style={tagStyle(m.tag)}
									onmousedown={(e) => {
										e.preventDefault();
										add(m.tag);
										inputEl?.focus();
									}}
								>
									<span class="dot" aria-hidden="true"></span>
									<span class="name">{m.tag}</span>
									<span class="count">{m.count}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/if}
	</ul>
</div>

<style>
	.tag-field {
		position: relative;
	}

	.tag-chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8rem;
		font-weight: 550;
		line-height: 1;
		padding: 0.3rem 0.5rem 0.3rem 0.6rem;
		border-radius: 999px;
		color: var(--tag-fg);
		background: var(--tag-bg);
		box-shadow: inset 0 0 0 1px var(--tag-ring);
		/* --tag-c is a theme palette color (see --th-* in app.css); tint it in */
		--tag-bg: color-mix(in oklab, var(--tag-c) 16%, var(--color-surface));
		--tag-fg: color-mix(in oklab, var(--tag-c) 78%, var(--color-text));
		--tag-ring: color-mix(in oklab, var(--tag-c) 28%, transparent);
	}

	.tag-link {
		padding: 0;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		line-height: inherit;
		cursor: pointer;
	}

	.tag-link:hover {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.tag-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.05rem;
		height: 1.05rem;
		margin-right: -0.15rem;
		padding: 0;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: inherit;
		font-size: 0.95rem;
		line-height: 1;
		opacity: 0.55;
		cursor: pointer;
		transition: opacity 0.12s ease, background 0.12s ease;
	}

	.tag-remove:hover {
		opacity: 1;
		background: var(--tag-ring);
	}

	.tag-draft {
		position: relative;
		flex: 1 1 7rem;
		min-width: 7rem;
	}

	.tags-input {
		width: 100%;
		background: transparent;
		border: none;
		outline: none;
		color: var(--color-text);
		font-family: var(--font-sans);
		font-size: 0.95rem;
		font-weight: 500;
		letter-spacing: -0.003em;
		padding: 0.2rem 0;
	}

	.tags-input::placeholder {
		color: var(--color-text-muted);
		opacity: 0.6;
	}

	.readonly .tags-input {
		cursor: default;
	}

	/* ---------- autocomplete dropdown ---------- */
	.tag-suggestions {
		position: absolute;
		z-index: 20;
		top: calc(100% + 0.35rem);
		left: 0;
		min-width: 12rem;
		max-width: 18rem;
		list-style: none;
		margin: 0;
		padding: 0.3rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.7rem;
		box-shadow: var(--shadow-md);
	}

	.tag-suggestion {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--color-text);
		font-family: var(--font-sans);
		font-size: 0.85rem;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
	}

	.tag-suggestion .dot {
		width: 0.55rem;
		height: 0.55rem;
		flex: none;
		border-radius: 999px;
		background: var(--tag-c);
	}

	.tag-suggestion .name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tag-suggestion .count {
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	.tag-suggestion:hover,
	.tag-suggestion.active {
		background: var(--color-surface-2);
	}

	@media (prefers-reduced-motion: reduce) {
		.tag-remove {
			transition: none;
		}
	}
</style>
