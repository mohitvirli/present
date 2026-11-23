<script lang="ts">
	// Phase 0 spike: two tabs edit one Y.Doc over a BroadcastChannel. Open
	// /dev/shared-spike?name=Asha in one tab and ?name=Ravi in another.
	import { onDestroy } from 'svelte';
	import { page } from '$app/state';
	import * as Y from 'yjs';
	import type { Editor as TipTap, JSONContent } from '@tiptap/core';
	import Editor from '$lib/components/Editor.svelte';
	import { BroadcastProvider } from '$lib/shared/broadcast-provider';
	import SharedMembers from '$lib/components/SharedMembers.svelte';

	const name = page.url.searchParams.get('name') ?? 'Tab';
	const room = page.url.searchParams.get('room') ?? 'spike';
	const COLORS = ['#e4572e', '#29335c', '#f3a712', '#669bbc', '#8e7dbe', '#2a9d8f'];
	const color = COLORS[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % COLORS.length];

	const doc = new Y.Doc();
	const provider = new BroadcastProvider(doc, room);
	const collab = { doc, awareness: provider.awareness, user: { name, color } };

	let editor = $state<TipTap>();
	let json = $state<JSONContent | null>(null);
	let peers = $state<string[]>([]);
	let showSheet = $state(false); // members sheet preview (fetch is mocked from the console)

	provider.awareness.on('change', () => {
		peers = [...provider.awareness.getStates().values()]
			.map((s) => (s.user as { name?: string } | undefined)?.name ?? '?')
			.sort();
	});

	// every custom node a shared entry can hold (recap stats excluded: recaps are private)
	const FIXTURE: JSONContent = {
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'Met at ' },
					{ type: 'tagRef', attrs: { tag: 'lisbon' } },
					{ type: 'text', text: ' on ' },
					{ type: 'dateRef', attrs: { day: '2026-10-02' } },
					{ type: 'text', text: ', ' },
					{ type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
					{ type: 'text', text: ' and ' },
					{ type: 'text', marks: [{ type: 'italic' }], text: 'italic' },
					{ type: 'text', text: '.' }
				]
			},
			{
				type: 'taskList',
				content: [
					{
						type: 'taskItem',
						attrs: { checked: true },
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Book tram' }] }]
					},
					{
						type: 'taskItem',
						attrs: { checked: false },
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pastéis' }] }]
					}
				]
			},
			{
				type: 'bulletList',
				content: [
					{
						type: 'listItem',
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }]
					},
					{
						type: 'listItem',
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }]
					}
				]
			},
			{
				type: 'table',
				content: [
					{
						type: 'tableRow',
						content: [
							{
								type: 'tableHeader',
								content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Day' }] }]
							},
							{
								type: 'tableHeader',
								content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Place' }] }]
							}
						]
					},
					{
						type: 'tableRow',
						content: [
							{
								type: 'tableCell',
								content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fri' }] }]
							},
							{
								type: 'tableCell',
								content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alfama' }] }]
							}
						]
					}
				]
			},
			{
				type: 'blockquote',
				content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quote' }] }]
			}
		]
	};

	function seed() {
		editor?.commands.setContent(FIXTURE);
	}

	function snapshot() {
		json = editor?.getJSON() ?? null;
	}

	if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__ydoc = doc;

	onDestroy(() => provider.destroy());
</script>

<main class="spike">
	<header>
		<strong>Shared spike</strong> · you are <span style="color: {color}">{name}</span> · room
		<code>{room}</code> · here: {peers.join(', ')}
		<button type="button" onclick={seed}>Seed fixture</button>
		<button type="button" onclick={snapshot}>Show JSON</button>
		<button type="button" onclick={() => (showSheet = true)}>Members sheet</button>
	</header>
	<section class="composer writing">
		<Editor bind:editor {collab} placeholder="Write together…" />
	</section>
	{#if showSheet}
		<SharedMembers
			entryId="spike-entry"
			{doc}
			title="Lisbon trip"
			onClose={() => (showSheet = false)}
		/>
	{/if}
	{#if json}<pre>{JSON.stringify(json, null, 1)}</pre>{/if}
</main>

<style>
	.spike {
		max-width: 760px;
		margin: 0 auto;
		padding: 24px 16px;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
		margin-bottom: 16px;
		font-size: 0.85rem;
	}
	pre {
		font-size: 0.7rem;
		max-height: 300px;
		overflow: auto;
	}
	/* caret labels from CollaborationCaret */
	:global(.collaboration-carets__caret) {
		position: relative;
		margin: 0 -1px;
		border-left: 1px solid;
		border-right: 1px solid;
		word-break: normal;
		pointer-events: none;
	}
	:global(.collaboration-carets__label) {
		position: absolute;
		top: -1.4em;
		left: -1px;
		padding: 0 4px;
		border-radius: 3px 3px 3px 0;
		font-size: 0.7rem;
		font-weight: 600;
		line-height: 1.4;
		color: #fff;
		white-space: nowrap;
		user-select: none;
	}
</style>
