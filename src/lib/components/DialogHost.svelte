<script lang="ts">
	// Draws confirmDialog() / alertDialog() requests (lib/dialogs.svelte.ts).
	import gsap from 'gsap';
	import { tick } from 'svelte';
	import { dialogs, type DialogRequest } from '$lib/dialogs.svelte';

	let el = $state<HTMLDialogElement | null>(null);
	let shown = $state<DialogRequest | null>(null);
	let confirmBtn = $state<HTMLButtonElement | null>(null);

	$effect(() => {
		const req = dialogs.current;
		if (req && req !== shown) void present(req);
	});

	async function present(req: DialogRequest) {
		shown = req;
		await tick();
		if (!el) return;
		if (!el.open) {
			el.showModal();
			gsap.fromTo(
				el,
				{ autoAlpha: 0, y: 10, scale: 0.97 },
				{ autoAlpha: 1, y: 0, scale: 1, duration: 0.24, ease: 'power3.out' }
			);
		}
		// the safe choice gets focus for destructive asks, the action otherwise
		if (!req.danger) confirmBtn?.focus();
	}

	function finish(ok: boolean) {
		const req = shown;
		if (!req || !el) return;
		if (dialogs.current === req) dialogs.current = null;
		req.resolve(ok);
		const d = el;
		gsap.to(d, {
			autoAlpha: 0,
			y: 10,
			scale: 0.97,
			duration: 0.16,
			ease: 'power2.in',
			onComplete: () => {
				// another request may have arrived during the fade
				if (dialogs.current && dialogs.current !== req) return;
				d.close();
				gsap.set(d, { clearProps: 'all' });
				shown = null;
			}
		});
	}
</script>

<dialog
	bind:this={el}
	class="confirm-dialog"
	aria-labelledby="app-dialog-title"
	oncancel={(e) => {
		e.preventDefault();
		finish(false);
	}}
>
	{#if shown}
		<h2 id="app-dialog-title">{shown.title}</h2>
		{#if shown.body}<p class="sync-confirm-text">{shown.body}</p>{/if}
		<div class="sync-confirm-actions">
			{#if shown.cancelLabel !== null}
				<button class="sync-btn ghost" type="button" onclick={() => finish(false)}>
					{shown.cancelLabel}
				</button>
			{/if}
			<button
				bind:this={confirmBtn}
				class="sync-btn {shown.danger ? 'danger' : 'primary'}"
				type="button"
				onclick={() => finish(true)}
			>
				{shown.confirmLabel}
			</button>
		</div>
	{/if}
</dialog>
