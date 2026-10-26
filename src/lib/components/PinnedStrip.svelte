<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Entry } from '$lib/db';
	import { extractText, firstHeading } from '$lib/tiptap';

	// Pinned entries for screens without the desktop gutter (< 1280px), at the
	// top of the timeline: a row of cards that scrolls sideways, so a long pin
	// list never pushes today's entries down. Pinning and unpinning happen in
	// the entry itself — these cards only open it.
	let { entries }: { entries: Entry[] } = $props();

	// same precedence as EntryCard's displayTitle
	function title(entry: Entry): string {
		return entry.metadata.title || firstHeading(entry.content) || '';
	}

	function excerpt(entry: Entry): string {
		const text = extractText(entry.content).trim().replace(/\s+/g, ' ');
		const t = title(entry);
		// don't repeat a heading that was promoted to the title
		return t && text.startsWith(t) ? text.slice(t.length).trim() : text;
	}

	function date(ts: number): string {
		return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

<div class="pinned-strip-head">
	<span class="pinned-strip-title">Pinned</span>
	<span class="pinned-strip-count">{entries.length}</span>
</div>
<ul class="pinned-strip">
	{#each entries as entry (entry.id)}
		{@const t = title(entry)}
		<li>
			<a class="pinned-card" class:untitled={!t} href="{resolve('/entry')}?id={entry.id}">
				{#if t}<span class="pc-title">{t}</span>{/if}
				<span class="pc-excerpt">{excerpt(entry) || 'Empty entry'}</span>
				<time class="pc-date">{date(entry.createdAt)}</time>
			</a>
		</li>
	{/each}
</ul>

<style>
	/* reads like a day chip: LABEL ~~~~~ count */
	.pinned-strip-head {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.3rem 0;
		margin-bottom: 0.85rem;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	/* a filled node on the rail, where an entry's hollow dot would sit */
	.pinned-strip-head::before {
		content: '';
		position: absolute;
		left: var(--node-x);
		top: 50%;
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-bg);
		transform: translate(-50%, -50%);
	}

	/* below 980px the rail is raised above the glassy topbar (z 11); sit level
	   with it, later in the DOM, the way the entry dots do */
	@media (max-width: 979px) {
		.pinned-strip-head::before {
			z-index: 11;
		}
	}

	.pinned-strip-head::after {
		content: '';
		order: 1;
		flex: 1;
		height: 8px;
		background: var(--color-border-strong);
		opacity: 0.7;
		-webkit-mask: var(--wave-mask);
		mask: var(--wave-mask);
		--wave-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='8' viewBox='0 0 20 8'%3E%3Cpath d='M0 4 Q5 0 10 4 T20 4' fill='none' stroke='black' stroke-width='1.5'/%3E%3C/svg%3E")
			repeat-x left center / 20px 8px;
	}

	.pinned-strip-count {
		order: 2;
		text-transform: none;
		font-weight: 500;
		letter-spacing: 0;
		opacity: 0.7;
	}

	/* bleeds off the right edge so a half-visible card says "swipe" */
	.pinned-strip {
		display: flex;
		gap: 0.65rem;
		list-style: none;
		margin: 0 calc(-1 * var(--bleed)) 0 0;
		padding: 0.15rem var(--bleed) 0.35rem 0;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scroll-snap-type: x mandatory;
		scroll-padding-left: 0;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
	}

	.pinned-strip::-webkit-scrollbar {
		display: none;
	}

	.pinned-strip li {
		flex: none;
		scroll-snap-align: start;
	}

	.pinned-card {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		width: min(68vw, 15rem);
		height: 100%;
		box-sizing: border-box;
		padding: 0.8rem 0.9rem 0.7rem;
		border-radius: 14px;
		background: var(--color-surface);
		box-shadow: inset 0 0 0 1px var(--color-border);
		text-decoration: none;
		color: var(--color-text);
		-webkit-tap-highlight-color: transparent;
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease;
	}

	.pinned-card:active {
		transform: scale(0.98);
	}

	.pinned-card:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 1.5px var(--color-accent);
	}

	.pc-title {
		font-size: 0.95rem;
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 1.3;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.pc-excerpt {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		font-size: 0.82rem;
		line-height: 1.4;
		color: var(--color-text-muted);
	}

	/* no title → the text itself leads, a line longer */
	.untitled .pc-excerpt {
		-webkit-line-clamp: 3;
		line-clamp: 3;
		font-size: 0.88rem;
		color: var(--color-text);
	}

	.pc-date {
		margin-top: auto;
		padding-top: 0.15rem;
		font-size: 0.68rem;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		opacity: 0.75;
	}

	@media (prefers-reduced-motion: reduce) {
		.pinned-card {
			transition: none;
		}
	}
</style>
