<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor, type JSONContent } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import Placeholder from '@tiptap/extension-placeholder';
	import Typography from '@tiptap/extension-typography';
	import { DictationDecoration } from '$lib/tiptap-dictation';
	import { TaskList, TaskItemBracket } from '$lib/tiptap-task';
	import { SuggestionDecoration } from '$lib/tiptap-suggestion';
	import { Quirks, QuirkTime, QuirkDate } from '$lib/tiptap-quirks';
	import { ListDragHandle } from '$lib/tiptap-list-drag';
	import {
		Tables,
		TablePipeRow,
		TableBackspaceDelete,
		TextAlignment,
		columnAlignment,
		cycleColumnAlignment,
		type ColumnAlign
	} from '$lib/tiptap-table';
	import { spellcheckSettings } from '$lib/settings.svelte';

	let {
		content = null,
		editable = true,
		placeholder = '',
		onChange,
		editor = $bindable()
	}: {
		content?: JSONContent | string | null;
		editable?: boolean;
		placeholder?: string;
		onChange?: (doc: JSONContent, text: string) => void;
		editor?: Editor;
	} = $props();

	let element: HTMLDivElement;

	// keep the contenteditable's spellcheck in step with the setting
	$effect(() => {
		editor?.view.dom.setAttribute('spellcheck', spellcheckSettings.enabled ? 'true' : 'false');
	});

	// Floating table controls: anchored to the top-right of the table the
	// cursor is in, hidden otherwise. Positions are relative to the host div.
	let tableMenu = $state<{ top: number; left: number; align: ColumnAlign } | null>(null);

	function updateTableMenu() {
		if (!editor || editor.isDestroyed || !editor.isEditable || !editor.isActive('table')) {
			tableMenu = null;
			return;
		}
		const { node } = editor.view.domAtPos(editor.state.selection.$from.pos);
		const el = node instanceof Element ? node : node.parentElement;
		const table = el?.closest('table');
		if (!table) {
			tableMenu = null;
			return;
		}
		const anchor = table.closest('.tableWrapper') ?? table;
		const hostRect = element.getBoundingClientRect();
		const rect = anchor.getBoundingClientRect();
		tableMenu = {
			top: rect.top - hostRect.top,
			left: rect.right - hostRect.left,
			align: columnAlignment(editor)
		};
	}

	onMount(() => {
		editor = new Editor({
			element,
			extensions: [
				StarterKit,
				Placeholder.configure({ placeholder }),
				Typography,
				TaskList,
				TaskItemBracket.configure({ nested: true }),
				ListDragHandle,
				...Tables,
				TablePipeRow,
				TableBackspaceDelete,
				TextAlignment,
				DictationDecoration,
				SuggestionDecoration,
				QuirkTime,
				QuirkDate,
				Quirks
			],
			content: content ?? '',
			editable,
			autofocus: false,
			onUpdate: ({ editor }) => onChange?.(editor.getJSON(), editor.getText()),
			// covers typing, selection moves and undo/redo in one hook
			onTransaction: () => updateTableMenu()
		});

		// dev console handle for debugging/testing gestures
		if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__editor = editor;

		// Allow toggling todo checkboxes while viewing (read-only). The editable
		// path is handled by TaskItem itself; here we intercept the change in
		// capture phase, locate the item via the DOM (not a stale node ref), and
		// dispatch the attr change — which onUpdate then persists.
		element.addEventListener('change', onCheckboxChange, true);
	});

	function onCheckboxChange(e: Event) {
		if (!editor || editor.isEditable) return;
		const target = e.target;
		if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
		const li = target.closest('li');
		if (!li) return;
		e.stopImmediatePropagation(); // keep TaskItem's own handler from reverting
		let pos: number;
		try {
			pos = editor.view.posAtDOM(li, 0);
		} catch {
			return;
		}
		const resolved = editor.state.doc.resolve(pos);
		let depth = resolved.depth;
		while (depth > 0 && resolved.node(depth).type.name !== 'taskItem') depth--;
		if (resolved.node(depth)?.type.name !== 'taskItem') return;
		const itemPos = resolved.before(depth);
		const node = editor.state.doc.nodeAt(itemPos);
		if (!node) return;
		editor.view.dispatch(
			editor.state.tr.setNodeMarkup(itemPos, undefined, { ...node.attrs, checked: target.checked })
		);
	}

	onDestroy(() => {
		element?.removeEventListener('change', onCheckboxChange, true);
		editor?.destroy();
	});

	$effect(() => {
		editor?.setEditable(editable);
		updateTableMenu();
	});

	// pointerdown (not click) + preventDefault keeps focus in the editor, so
	// the selection the command operates on is still inside the table
	function tableCmd(
		e: Event,
		cmd: 'addRowAfter' | 'addColumnAfter' | 'deleteRow' | 'deleteColumn' | 'deleteTable'
	) {
		e.preventDefault();
		editor?.chain().focus()[cmd]().run();
	}
</script>

<div class="tiptap-host" bind:this={element}>
	{#if tableMenu}
		<div
			class="table-menu"
			style="top: {tableMenu.top}px; left: {tableMenu.left}px"
			role="toolbar"
			aria-label="Table controls"
		>
			<button
				type="button"
				title="Add row below"
				aria-label="Add row below"
				onpointerdown={(e) => tableCmd(e, 'addRowAfter')}>+ row</button
			>
			<button
				type="button"
				title="Add column right"
				aria-label="Add column right"
				onpointerdown={(e) => tableCmd(e, 'addColumnAfter')}>+ col</button
			>
			<span class="table-menu-sep" aria-hidden="true"></span>
			<button
				type="button"
				title="Delete row"
				aria-label="Delete row"
				onpointerdown={(e) => tableCmd(e, 'deleteRow')}>&minus; row</button
			>
			<button
				type="button"
				title="Delete column"
				aria-label="Delete column"
				onpointerdown={(e) => tableCmd(e, 'deleteColumn')}>&minus; col</button
			>
			<span class="table-menu-sep" aria-hidden="true"></span>
			<button
				type="button"
				title="Align column ({tableMenu.align}, click to cycle)"
				aria-label="Align column: {tableMenu.align}"
				onpointerdown={(e) => {
					e.preventDefault();
					if (editor) cycleColumnAlignment(editor);
				}}
			>
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="M3 6h18" />
					{#if tableMenu.align === 'center'}
						<path d="M7 12h10" /><path d="M5 18h14" />
					{:else if tableMenu.align === 'right'}
						<path d="M11 12h10" /><path d="M7 18h14" />
					{:else}
						<path d="M3 12h10" /><path d="M3 18h14" />
					{/if}
				</svg>
			</button>
			<span class="table-menu-sep" aria-hidden="true"></span>
			<button
				type="button"
				class="danger"
				title="Delete table"
				aria-label="Delete table"
				onpointerdown={(e) => tableCmd(e, 'deleteTable')}
			>
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M3 6h18" /><path d="M8 6V4h8v2" />
					<path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
				</svg>
			</button>
		</div>
	{/if}
</div>

<style>
	.tiptap-host {
		position: relative;
	}

	.table-menu {
		position: absolute;
		transform: translate(-100%, calc(-100% - 5px));
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 3px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: var(--shadow-sm);
		z-index: 4; /* above cell-selection overlay (2) and resize handle (3) */
	}

	.table-menu button {
		display: flex;
		align-items: center;
		border: none;
		background: none;
		padding: 3px 7px;
		border-radius: 5px;
		font-family: inherit;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		cursor: pointer;
		white-space: nowrap;
	}

	.table-menu button:hover {
		background: var(--color-surface-2);
		color: var(--color-text);
	}

	.table-menu button.danger:hover {
		color: var(--color-danger);
	}

	.table-menu-sep {
		width: 1px;
		align-self: stretch;
		margin: 2px 1px;
		background: var(--color-border);
	}
</style>
