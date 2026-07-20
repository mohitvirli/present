<script lang="ts">
	import type { Entry } from '$lib/db';
	import { extractText, firstHeading } from '$lib/tiptap';
	import { gFade } from '$lib/transitions';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';

	// Desktop-only list of pinned entries in the right gutter, below the month
	// calendar (the gutter wrapper hides both < 1280px). Title-only rows — the
	// entry still renders in full inside its day group.
	let {
		entries,
		onTogglePin
	}: {
		entries: Entry[];
		onTogglePin: (entry: Entry) => void;
	} = $props();

	// same precedence as EntryCard's displayTitle, with a text excerpt as the
	// last resort so untitled entries still get a legible row
	function title(entry: Entry): string {
		const t = entry.metadata.title || firstHeading(entry.content);
		if (t) return t;
		const text = extractText(entry.content).trim().replace(/\s+/g, ' ');
		if (!text) return 'Untitled';
		return text.length > 48 ? `${text.slice(0, 48).trimEnd()}…` : text;
	}

	function date(ts: number): string {
		return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

<aside class="pinned-panel" aria-label="Pinned entries" in:gFade={{ duration: 0.4 }}>
	<div class="pinned-head">
		<span class="pinned-panel-title">Pinned</span>
	</div>
	<ul class="pinned-list">
		{#each entries as entry (entry.id)}
			<li class="pinned-item" animate:flip={{ duration: 240, easing: cubicOut }}>
				<a class="pinned-link" href="/entry?id={entry.id}">
					<span class="pinned-entry-title">{title(entry)}</span>
					<time class="pinned-date">{date(entry.createdAt)}</time>
				</a>
				<button
					class="pinned-unpin"
					aria-label="Unpin entry"
					title="Unpin entry"
					onclick={() => onTogglePin(entry)}
				>
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M12 17v5" />
						<path d="M9 3h6v5l2 3v2H7v-2l2-3Z" />
					</svg>
				</button>
			</li>
		{/each}
	</ul>
</aside>
