<script lang="ts">
	import gsap from 'gsap';
	import { THEMES, theme, setTheme } from '$lib/theme.svelte';

	let dialog = $state<HTMLDialogElement | null>(null);

	function open() {
		const d = dialog;
		if (!d) return;
		d.showModal();
		gsap.fromTo(
			d,
			{ autoAlpha: 0, y: 10, scale: 0.97 },
			{ autoAlpha: 1, y: 0, scale: 1, duration: 0.24, ease: 'power3.out' }
		);
	}

	function close() {
		const d = dialog;
		if (!d) return;
		gsap.to(d, {
			autoAlpha: 0,
			y: 10,
			scale: 0.97,
			duration: 0.16,
			ease: 'power2.in',
			onComplete: () => {
				d.close();
				gsap.set(d, { clearProps: 'all' });
			}
		});
	}
</script>

<button class="settings-btn" onclick={open} aria-label="Settings">
	<svg
		width="18"
		height="18"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<circle cx="12" cy="12" r="3" />
		<path
			d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
		/>
	</svg>
</button>

<dialog
	bind:this={dialog}
	class="settings-dialog"
	aria-labelledby="settings-title"
	oncancel={(e) => {
		e.preventDefault();
		close();
	}}
>
	<div class="settings-head">
		<h2 id="settings-title">Theme</h2>
		<button class="settings-close" onclick={close} aria-label="Close">✕</button>
	</div>

	<div class="theme-grid">
		{#each THEMES as t (t.id)}
			<button
				class="theme-card"
				class:selected={theme.value === t.id}
				onclick={() => setTheme(t.id)}
			>
				<span class="theme-swatches">
					{#each t.swatches as c (c)}
						<span class="swatch" style="background:{c}"></span>
					{/each}
				</span>
				<span class="theme-name">{t.name}</span>
			</button>
		{/each}
	</div>
</dialog>
