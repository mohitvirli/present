import type { JSONContent } from '@tiptap/core';
import { toBlob } from 'html-to-image';
import { tagStyle } from './tag-color';
import { renderEntryHTML } from './tiptap-render';

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export type ShareResult = 'shared' | 'dismissed' | 'copied' | 'downloaded';

// The last rendered capture, kept so a follow-up "download" action can reuse
// it without re-rendering the card.
let lastCapture: { blob: Blob; name: string } | null = null;

function downloadBlob(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}

// Downloads the most recent capture (e.g. when the header button morphs into
// a download affordance after a copy). Returns false if nothing is cached.
export function downloadLastShareImage(): boolean {
	if (!lastCapture) return false;
	downloadBlob(lastCapture.blob, lastCapture.name);
	return true;
}

// Renders the entry into an offscreen "share card" — title + tags (when set),
// full text at the composer's width, then a footer with the word count on the
// left and the entry's time bottom-right — and rasterizes it to a PNG. On
// phones/tablets this opens the native share sheet; on desktop it copies the
// image to the clipboard, falling back to a download when that's unavailable
// or blocked.
export async function shareEntryImage(opts: {
	content: JSONContent | string;
	wordCount: number;
	at: number;
	title?: string;
	tags?: string[];
}): Promise<ShareResult> {
	const d = new Date(opts.at);
	const hh = d.getHours().toString().padStart(2, '0');
	const mm = d.getMinutes().toString().padStart(2, '0');
	const date = d.toLocaleDateString(undefined, {
		weekday: 'long',
		month: 'long',
		day: 'numeric'
	});

	const card = document.createElement('div');
	// `composer` + `writing`/`tiptap` reuse the editor's typography styles, so
	// the capture matches the page exactly.
	card.className = 'share-card composer';
	// match the column width the entry actually rendered at on this screen
	// (≤760px on desktop, narrower on mobile); padding frames it outside
	const live = document.querySelector('main .composer');
	if (live) card.style.width = `${live.getBoundingClientRect().width}px`;
	const title = opts.title?.trim();
	const tags = (opts.tags ?? []).map((t) => t.trim()).filter(Boolean);
	card.innerHTML = `
		<div class="share-clock" aria-hidden="true">
			<span class="share-time">${hh}<span class="colon">:</span>${mm}</span>
			<span class="share-date">${date}</span>
		</div>
		${title ? `<h1 class="share-title">${esc(title)}</h1>` : ''}
		${
			tags.length
				? `<ul class="share-tags">${tags
						.map((t) => `<li class="tag" style="${tagStyle(t)}">${esc(t)}</li>`)
						.join('')}</ul>`
				: ''
		}
		<section class="writing"><div class="tiptap">${renderEntryHTML(opts.content)}</div></section>
		<div class="share-foot">
			<span class="share-words">${opts.wordCount} ${opts.wordCount === 1 ? 'word' : 'words'}</span>
		</div>
	`;
	document.body.appendChild(card);

	try {
		await document.fonts.ready;
		const blob = await toBlob(card, {
			pixelRatio: 2,
			// the live card is parked offscreen; reset that on the capture clone
			// or the content draws outside the canvas
			style: { position: 'static', left: '0', top: '0' },
			backgroundColor: getComputedStyle(document.documentElement)
				.getPropertyValue('--color-bg')
				.trim()
		});
		if (!blob) throw new Error('Could not render image');

		const name = `present-${d.toISOString().slice(0, 10)}.png`;
		lastCapture = { blob, name };

		// On touch devices the native sheet is the natural target (AirDrop,
		// messaging apps); on desktop the clipboard flow below is nicer.
		const isTouch = matchMedia('(pointer: coarse)').matches;
		if (isTouch && typeof navigator.canShare === 'function') {
			const file = new File([blob], name, { type: 'image/png' });
			if (navigator.canShare({ files: [file] })) {
				try {
					await navigator.share({ files: [file] });
					return 'shared';
				} catch (e) {
					// user dismissed the sheet — not an error, don't force a fallback
					if (e instanceof DOMException && e.name === 'AbortError') return 'dismissed';
					// real share failure → fall through to clipboard/download
				}
			}
		}

		// Copy the image so it can be pasted anywhere, and let the caller offer
		// a download as a follow-up.
		if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
			try {
				await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
				return 'copied';
			} catch {
				// clipboard blocked (permissions/focus) → fall through to download
			}
		}

		downloadBlob(blob, name);
		return 'downloaded';
	} finally {
		card.remove();
	}
}
