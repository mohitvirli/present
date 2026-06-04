<script lang="ts">
	import { onMount } from 'svelte';
	import { scroll } from '$lib/scroll.svelte';

	function scrollTo(top: number) {
		if (scroll.lenis) scroll.lenis.scrollTo(top, { immediate: true });
		else window.scrollTo({ top, behavior: 'auto' });
	}

	let visible = $state(false);
	let thumbH = $state(40);
	let thumbTop = $state(0);
	let active = $state(false); // dragging or hovering → fade in
	let dragging = false;

	let trackH = 0;
	let maxScroll = 0;

	function compute() {
		const docH = document.documentElement.scrollHeight;
		const vh = window.innerHeight;
		trackH = vh;
		maxScroll = docH - vh;
		if (maxScroll <= 1) {
			visible = false;
			return;
		}
		visible = true;
		thumbH = Math.max(40, (vh / docH) * trackH);
		const prog = Math.min(1, Math.max(0, window.scrollY / maxScroll));
		thumbTop = prog * (trackH - thumbH);
	}

	let hideTimer: ReturnType<typeof setTimeout> | null = null;
	function flash() {
		active = true;
		if (hideTimer) clearTimeout(hideTimer);
		if (!dragging) hideTimer = setTimeout(() => (active = false), 1000);
	}

	function onScroll() {
		compute();
		flash();
	}

	function onThumbDown(e: PointerEvent) {
		e.preventDefault();
		dragging = true;
		active = true;
		const startY = e.clientY;
		const startTop = thumbTop;
		const range = trackH - thumbH;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);

		const move = (ev: PointerEvent) => {
			const top = Math.min(range, Math.max(0, startTop + (ev.clientY - startY)));
			const prog = range > 0 ? top / range : 0;
			scrollTo(prog * maxScroll);
		};
		const up = () => {
			dragging = false;
			flash();
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	onMount(() => {
		compute();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', compute);
		const ro = new ResizeObserver(() => compute());
		ro.observe(document.body);
		return () => {
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', compute);
			ro.disconnect();
			if (hideTimer) clearTimeout(hideTimer);
		};
	});
</script>

{#if visible}
	<div
		class="scrollbar"
		class:active
		onpointerenter={() => (active = true)}
		onpointerleave={() => !dragging && (active = false)}
		role="presentation"
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="scroll-thumb"
			style="height:{thumbH}px; transform:translateY({thumbTop}px)"
			onpointerdown={onThumbDown}
		></div>
	</div>
{/if}
