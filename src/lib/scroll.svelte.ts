import type Lenis from 'lenis';

// shared Lenis instance so the custom Scrollbar can drive scrolling on drag
// (window.scrollTo is reverted by Lenis, so it must go through lenis.scrollTo)
export const scroll = $state<{ lenis: Lenis | null }>({ lenis: null });
