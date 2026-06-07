<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor, type JSONContent } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import Placeholder from '@tiptap/extension-placeholder';
	import Typography from '@tiptap/extension-typography';
	import { BubbleMenu } from '@tiptap/extension-bubble-menu';
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
	let bubbleEl: HTMLDivElement;

	let active = $state({ bold: false, italic: false, code: false, link: false });

	function refreshActive() {
		if (!editor) return;
		active = {
			bold: editor.isActive('bold'),
			italic: editor.isActive('italic'),
			code: editor.isActive('code'),
			link: editor.isActive('link')
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
				DictationDecoration,
				SuggestionDecoration,
				BubbleMenu.configure({
					element: bubbleEl,
					appendTo: () => document.body,
					options: {
						placement: 'top',
						offset: 8,
						strategy: 'fixed',
						onShow: () => bubbleEl.classList.add('is-open'),
						onHide: () => bubbleEl.classList.remove('is-open')
					},
					shouldShow: ({ editor, from, to }) => editor.isEditable && from !== to
				})
			],
			content: content ?? '',
			editable,
			autofocus: false,
			onUpdate: ({ editor }) => onChange?.(editor.getJSON(), editor.getText()),
			onSelectionUpdate: refreshActive,
			onTransaction: refreshActive
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

	function toggleLink() {
		if (!editor) return;
		if (editor.isActive('link')) {
			editor.chain().focus().unsetLink().run();
			return;
		}
		const prev = editor.getAttributes('link').href ?? '';
		const url = window.prompt('Link URL', prev);
		if (url === null) return;
		if (url === '') editor.chain().focus().unsetLink().run();
		else editor.chain().focus().setLink({ href: url }).run();
	}
</script>

<div class="tiptap-host" bind:this={element}></div>

<!-- bubble menu (positioned by the extension via floating-ui) -->
<div class="bubble-menu" bind:this={bubbleEl} role="toolbar" aria-label="Text formatting">
	<button
		type="button"
		class:active={active.bold}
		aria-label="Bold"
		onmousedown={(e) => e.preventDefault()}
		onclick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button
	>
	<button
		type="button"
		class:active={active.italic}
		aria-label="Italic"
		onmousedown={(e) => e.preventDefault()}
		onclick={() => editor?.chain().focus().toggleItalic().run()}><i>i</i></button
	>
	<button
		type="button"
		class:active={active.code}
		aria-label="Code"
		onmousedown={(e) => e.preventDefault()}
		onclick={() => editor?.chain().focus().toggleCode().run()}>{'</>'}</button
	>
	<button
		type="button"
		class:active={active.link}
		aria-label="Link"
		onmousedown={(e) => e.preventDefault()}
		onclick={toggleLink}
	>
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
			<path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
		</svg>
	</button>
</div>
