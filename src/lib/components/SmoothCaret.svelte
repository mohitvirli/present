<script lang="ts">
	import { onMount, tick } from 'svelte';

	let { el, active = true }: { el: HTMLTextAreaElement | undefined; active?: boolean } = $props();

	let caret = $state<HTMLElement | null>(null);
	let mirror: HTMLDivElement;
	let x = $state(0);
	let y = $state(0);
	let h = $state(0);
	let visible = $state(false);

	const MIRROR_PROPS = [
		'boxSizing',
		'width',
		'paddingTop',
		'paddingRight',
		'paddingBottom',
		'paddingLeft',
		'borderTopWidth',
		'borderRightWidth',
		'borderBottomWidth',
		'borderLeftWidth',
		'fontFamily',
		'fontSize',
		'fontWeight',
		'fontStyle',
		'lineHeight',
		'letterSpacing',
		'textTransform',
		'textIndent',
		'whiteSpace',
		'wordSpacing',
		'tabSize'
	] as const;

	function syncMirrorStyle() {
		if (!el || !mirror) return;
		const cs = getComputedStyle(el);
		const ms = mirror.style as unknown as Record<string, string>;
		for (const p of MIRROR_PROPS) {
			ms[p] = cs[p];
		}
		mirror.style.width = `${el.clientWidth}px`;
		mirror.style.whiteSpace = 'pre-wrap';
		mirror.style.wordWrap = 'break-word';
		mirror.style.overflowWrap = 'break-word';
	}

	function update() {
		if (!active || !el || !mirror || document.activeElement !== el) {
			visible = false;
			return;
		}
		const s = el.selectionStart ?? 0;
		const e = el.selectionEnd ?? 0;
		if (s !== e) {
			// selection range → hide custom caret
			visible = false;
			return;
		}
		syncMirrorStyle();
		const before = el.value.slice(0, s);
		mirror.textContent = before;
		const marker = document.createElement('span');
		marker.textContent = '​';
		mirror.appendChild(marker);

		const mr = marker.getBoundingClientRect();
		const tr = el.getBoundingClientRect();
		const cs = getComputedStyle(el);
		const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
		const fs = parseFloat(cs.fontSize);
		const top = mr.top - tr.top + el.scrollTop;
		// keep the bottom where the centered 1.15× caret sat, extend the top up
		const baseH = fs * 1.15;
		const bottom = top + (line - baseH) / 2 + baseH;
		h = fs * 1.5;
		x = mr.left - tr.left + el.scrollLeft;
		y = bottom - h;
		visible = true;
		restartBlink();
	}

	// restart blink without recreating the element (so the transform transition
	// keeps gliding between caret positions)
	function restartBlink() {
		const c = caret;
		if (!c) return;
		c.style.animation = 'none';
		void c.offsetWidth; // force reflow
		c.style.animation = '';
	}

	function schedule() {
		requestAnimationFrame(update);
	}

	onMount(() => {
		const onSel = () => schedule();
		document.addEventListener('selectionchange', onSel);
		window.addEventListener('resize', schedule);
		return () => {
			document.removeEventListener('selectionchange', onSel);
			window.removeEventListener('resize', schedule);
		};
	});

	// re-bind input/focus listeners whenever the target element changes
	$effect(() => {
		if (!el) return;
		const onInput = () => schedule();
		const onFocus = () => schedule();
		const onBlur = () => (visible = false);
		el.addEventListener('input', onInput);
		el.addEventListener('focus', onFocus);
		el.addEventListener('blur', onBlur);
		el.addEventListener('click', onInput);
		el.addEventListener('keyup', onInput);
		tick().then(schedule);
		return () => {
			el.removeEventListener('input', onInput);
			el.removeEventListener('focus', onFocus);
			el.removeEventListener('blur', onBlur);
			el.removeEventListener('click', onInput);
			el.removeEventListener('keyup', onInput);
		};
	});

	$effect(() => {
		if (!active) visible = false;
		else schedule();
	});
</script>

<!-- hidden mirror replicating the textarea text to locate the caret -->
<div class="caret-mirror" bind:this={mirror} aria-hidden="true"></div>

<span
	bind:this={caret}
	class="smooth-caret"
	class:visible
	style="height:{h}px; transform:translate({x}px, {y}px)"
	aria-hidden="true"
></span>

<style>
	.caret-mirror {
		position: absolute;
		top: 0;
		left: 0;
		visibility: hidden;
		pointer-events: none;
		white-space: pre-wrap;
		word-wrap: break-word;
		z-index: -1;
	}

	.smooth-caret {
		position: absolute;
		top: 0;
		left: 0;
		width: 2px;
		border-radius: 1px;
		background: var(--color-accent);
		pointer-events: none;
		opacity: 0;
		will-change: transform;
		/* smooth glide between positions */
		transition: transform 0.19s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.smooth-caret.visible {
		/* smooth (fade) blink */
		animation: caret-blink 1.15s ease-in-out infinite;
	}

	@keyframes caret-blink {
		0%,
		40% {
			opacity: 1;
		}
		70% {
			opacity: 0;
		}
		100% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.smooth-caret {
			transition: none;
			animation: none;
		}
	}
</style>
