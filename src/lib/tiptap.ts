import type { JSONContent } from '@tiptap/core';
import { dateRefLabel, isDayKey } from './day';

// Plain-text extraction from a ProseMirror/TipTap JSON doc — used for word
// counts and timeline previews without spinning up an editor.
export function extractText(doc: JSONContent | string | null | undefined): string {
	if (doc == null) return '';
	if (typeof doc === 'string') return doc; // legacy markdown/plain entries
	const blocks = [
		'paragraph',
		'heading',
		'blockquote',
		'listItem',
		'codeBlock',
		'tableHeader',
		'tableCell'
	];
	let out = '';
	const walk = (node: JSONContent) => {
		if (node.text) out += node.text;
		// dateRef is an atom with a generated label and no text child — previews,
		// word counts and the search index would otherwise see a blank gap
		else if (node.type === 'dateRef') out += dateRefLabel(node.attrs?.day);
		node.content?.forEach(walk);
		if (node.type && blocks.includes(node.type)) out += '\n';
	};
	walk(doc);
	return out.replace(/\n{2,}/g, '\n').trim();
}

// Day keys referenced by `dateRef` chips, deduped and sorted. Derived on save
// and cached in metadata.dates (same treatment as wordCount) so the timeline can
// project ghost entries without walking every document on every render.
export function extractDates(doc: JSONContent | string | null | undefined): string[] {
	if (doc == null || typeof doc === 'string') return []; // legacy entries predate chips
	const found = new Set<string>();
	const walk = (node: JSONContent) => {
		if (node.type === 'dateRef' && isDayKey(node.attrs?.day)) found.add(node.attrs!.day);
		node.content?.forEach(walk);
	};
	walk(doc);
	return [...found].sort();
}

// The text of the block a given date chip sits in — the sentence the ghost row
// quotes back on the timeline, so a ghost says *why* that day was mentioned.
export function dateRefContext(doc: JSONContent | string | null | undefined, day: string): string {
	if (doc == null || typeof doc === 'string') return '';
	let found = '';
	const walk = (node: JSONContent): boolean => {
		if (node.content?.some((c) => c.type === 'dateRef' && c.attrs?.day === day)) {
			found = extractText(node).replace(/\s+/g, ' ').trim();
			return true;
		}
		return (node.content ?? []).some(walk);
	};
	walk(doc);
	return found;
}

// First heading's text, used as a title fallback when none is set.
export function firstHeading(doc: JSONContent | string | null | undefined): string {
	if (doc == null || typeof doc === 'string') return '';
	let found = '';
	const walk = (node: JSONContent): boolean => {
		if (node.type === 'heading') {
			found = (node.content ?? [])
				.map((n) => n.text ?? '')
				.join('')
				.trim();
			return true;
		}
		return (node.content ?? []).some(walk);
	};
	walk(doc);
	return found;
}

export function wordCount(doc: JSONContent | string | null | undefined): number {
	return extractText(doc).split(/\s+/).filter(Boolean).length;
}
