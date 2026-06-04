import gsap from 'gsap';
import type { TransitionConfig } from 'svelte/transition';

// Svelte transitions powered by the GSAP engine. We hand Svelte a `tick`
// callback and drive a paused GSAP tween's progress from it, so GSAP computes
// the eased property values (transforms, opacity, height) each frame.

type FlyParams = {
	x?: number;
	y?: number;
	duration?: number; // seconds
	delay?: number; // seconds
	ease?: string;
};

export function gIn(node: Element, params: FlyParams = {}): TransitionConfig {
	const { x = 0, y = 0, duration = 0.4, delay = 0, ease = 'power3.out' } = params;
	const tween = gsap.from(node, { x, y, autoAlpha: 0, duration, ease, paused: true });
	return {
		delay: delay * 1000,
		duration: duration * 1000,
		tick: (t) => tween.progress(t)
	};
}

export function gOut(node: Element, params: FlyParams = {}): TransitionConfig {
	const { x = 0, y = 0, duration = 0.2, delay = 0, ease = 'power2.in' } = params;
	const tween = gsap.to(node, { x, y, autoAlpha: 0, duration, ease, paused: true });
	return {
		delay: delay * 1000,
		duration: duration * 1000,
		// outro: Svelte runs t 1 → 0; map to tween progress 0 → 1
		tick: (t) => tween.progress(1 - t)
	};
}

export function gFade(node: Element, params: { duration?: number; delay?: number } = {}): TransitionConfig {
	const { duration = 0.3, delay = 0 } = params;
	const tween = gsap.from(node, { autoAlpha: 0, duration, ease: 'power2.out', paused: true });
	return { delay: delay * 1000, duration: duration * 1000, tick: (t) => tween.progress(t) };
}

// Vertical scale (rail grow/collapse from the top).
export function gScaleY(
	node: Element,
	params: { duration?: number; delay?: number; ease?: string; origin?: string } = {}
): TransitionConfig {
	const { duration = 0.7, delay = 0, ease = 'power3.out', origin = 'top center' } = params;
	const tween = gsap.from(node, {
		scaleY: 0,
		autoAlpha: 0,
		transformOrigin: origin,
		duration,
		ease,
		paused: true
	});
	return { delay: delay * 1000, duration: duration * 1000, tick: (t) => tween.progress(t) };
}

// Accordion-style height+fade reveal (replaces svelte/transition `slide`).
// Uses Svelte's `css` mode (browser-generated keyframes) with a GSAP easing
// curve — smoother than per-frame JS, no RAF contention with Lenis, and no
// from-state flash on close that a paused tween can cause.
export function gSlide(
	node: HTMLElement,
	params: { duration?: number; delay?: number; ease?: string } = {}
): TransitionConfig {
	const { duration = 0.26, delay = 0, ease = 'power2.inOut' } = params;
	const h = node.scrollHeight;
	const easing = gsap.parseEase(ease) as (t: number) => number;
	return {
		delay: delay * 1000,
		duration: duration * 1000,
		easing,
		css: (t) => `height:${h * t}px; opacity:${t}; overflow:hidden;`
	};
}
