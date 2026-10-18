// Getting a Blob out of the app and onto the user's storage. Shared by the
// entry-image share flow and the data export, so the awkward parts (iOS
// standalone ignoring a programmatic download, the share sheet reporting a
// dismissal as a throw) are solved once.

export type SaveResult = 'shared' | 'dismissed' | 'downloaded';

// Click a synthetic anchor. Reliable on desktop; unreliable inside an installed
// iOS PWA, which is why saveFile() tries the native sheet there first.
export function downloadBlob(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}

// Hands the file to the OS. On touch devices the native sheet is the natural
// target (Files, AirDrop, messaging apps); everywhere else — and whenever the
// sheet is unavailable or fails for real — fall back to a download.
export async function saveFile(blob: Blob, name: string): Promise<SaveResult> {
	const isTouch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
	if (isTouch && typeof navigator.canShare === 'function') {
		const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
		if (navigator.canShare({ files: [file] })) {
			try {
				await navigator.share({ files: [file] });
				return 'shared';
			} catch (e) {
				// user dismissed the sheet — not an error, don't force a fallback
				if (e instanceof DOMException && e.name === 'AbortError') return 'dismissed';
				// real share failure → fall through to the download
			}
		}
	}
	downloadBlob(blob, name);
	return 'downloaded';
}
