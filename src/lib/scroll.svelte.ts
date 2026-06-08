import type Lenis from 'lenis';

// shared Lenis instance so the custom Scrollbar can drive scrolling on drag
// (window.scrollTo is reverted by Lenis, so it must go through lenis.scrollTo)
// timelineY: last scroll offset of the timeline (`/`), saved on navigate-away
// so returning from an entry restores the user's place instead of jumping top.
export const scroll = $state<{ lenis: Lenis | null; timelineY: number }>({
	lenis: null,
	timelineY: 0
});
