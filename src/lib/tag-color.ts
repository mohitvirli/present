// Deterministic per-tag color. Same tag → same swatch everywhere, across
// sessions and devices, with no stored state. The hash only picks an *index*
// into the active theme's palette: `--th-0..--th-N` (defined once in app.css)
// each point at a real theme token (accent + mood hues), so a tag's color is
// always drawn from the current theme and recolors automatically on theme
// switch — no JS re-run.

/** Number of swatches the palette defines (`--th-0` … `--th-5`). */
export const TAG_SWATCHES = 6;

/** Stable 0–(N-1) swatch index for a tag label. Case/space-insensitive. */
export function tagSwatch(tag: string): number {
	const key = tag.trim().toLowerCase();
	let h = 0;
	for (let i = 0; i < key.length; i++) {
		h = (h * 31 + key.charCodeAt(i)) >>> 0;
	}
	return h % TAG_SWATCHES;
}

/** Inline style binding the chip's base color to the theme swatch at this index. */
export function tagStyle(tag: string): string {
	return `--tag-c: var(--th-${tagSwatch(tag)})`;
}
