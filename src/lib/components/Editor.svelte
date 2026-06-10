<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor, type JSONContent } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import Placeholder from '@tiptap/extension-placeholder';
	import Typography from '@tiptap/extension-typography';
	import { DictationDecoration } from '$lib/tiptap-dictation';
	import { TaskList, TaskItemBracket } from '$lib/tiptap-task';
	import { SuggestionDecoration } from '$lib/tiptap-suggestion';

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

	onMount(() => {
		editor = new Editor({
			element,
			extensions: [
				StarterKit,
				Placeholder.configure({ placeholder }),
				Typography,
				TaskList,
				TaskItemBracket.configure({ nested: true }),
				DictationDecoration,
				SuggestionDecoration
			],
			content: content ?? '',
			editable,
			autofocus: false,
			onUpdate: ({ editor }) => onChange?.(editor.getJSON(), editor.getText())
		});

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
	});
</script>

<div class="tiptap-host" bind:this={element}></div>
