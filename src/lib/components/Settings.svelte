<script lang="ts">
	import gsap from 'gsap';
	import { THEMES, theme, setTheme } from '$lib/theme.svelte';
	import { aiSettings, micSettings, setAiEnabled, setMicEnabled } from '$lib/settings.svelte';
	import {
		syncState,
		syncSupported,
		enableSync,
		signInSync,
		disableSync,
		deleteSyncAccount
	} from '$lib/sync.svelte';

	let deleteDialog = $state<HTMLDialogElement | null>(null);

	async function handleDelete() {
		const ok = await deleteSyncAccount();
		if (ok) closeDeleteDialog();
	}
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

	function openDeleteDialog() {
		const d = deleteDialog;
		if (!d) return;
		d.showModal();
		gsap.fromTo(
			d,
			{ autoAlpha: 0, y: 10, scale: 0.97 },
			{ autoAlpha: 1, y: 0, scale: 1, duration: 0.24, ease: 'power3.out' }
		);
	}

	function closeDeleteDialog() {
		const d = deleteDialog;
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

	async function handleEnableSync() {
		await enableSync();
		if (syncState.status !== 'error') {
			close();
		}
	}

	async function handleSignInSync() {
		await signInSync();
		if (syncState.status !== 'error') {
			close();
		}
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
		<h2 id="settings-title">Settings</h2>
		<button class="settings-close" onclick={close} aria-label="Close">✕</button>
	</div>

	<h3 class="settings-subhead">AI</h3>
	<label class="ai-toggle">
		<span class="ai-toggle-text">
			<span class="ai-toggle-title">Enable AI suggestions</span>
			<span class="ai-toggle-sub">Analyze entries for title, tags, mood &amp; summary.</span>
		</span>
		<input
			type="checkbox"
			role="switch"
			class="switch"
			checked={aiSettings.enabled}
			onchange={(e) => setAiEnabled(e.currentTarget.checked)}
		/>
	</label>

	<h3 class="settings-subhead">Microphone</h3>
	<label class="ai-toggle">
		<span class="ai-toggle-text">
			<span class="ai-toggle-title">Enable mic</span>
			<span class="ai-toggle-sub">Show the live dictation mic button while editing.</span>
		</span>
		<input
			type="checkbox"
			role="switch"
			class="switch"
			checked={micSettings.enabled}
			onchange={(e) => setMicEnabled(e.currentTarget.checked)}
		/>
	</label>

	<h3 class="settings-subhead">Sync</h3>
	<section class="sync-card" class:is-on={syncState.enabled}>
		<header class="sync-card-head">
			<span class="sync-card-icon" aria-hidden="true">
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<rect x="3" y="11" width="18" height="11" rx="2" />
					<path d="M7 11V7a5 5 0 0 1 10 0v4" />
				</svg>
			</span>
			<span class="sync-card-title">Private Sync</span>
			{#if !syncSupported}
				<span class="sync-pill sync-pill-muted">Requires HTTPS</span>
			{:else if syncState.status === 'error'}
				<span class="sync-pill sync-pill-error">! Error</span>
			{:else if syncState.enabled}
				<span class="sync-pill sync-pill-on">
					{#if syncState.status === 'syncing'}Syncing…{:else if syncState.status === 'synced'}✓ Synced{:else}On{/if}
				</span>
			{:else}
				<span class="sync-pill sync-pill-muted">Off</span>
			{/if}
		</header>

		<p class="sync-card-desc">
			{#if syncState.status === 'error'}
				{syncState.error}
			{:else if syncState.enabled}
				Your journals stay in sync across devices{#if syncState.encrypted}, end-to-end encrypted{/if}.
			{:else}
				Keep your journals across devices, secured by your device's FaceID or fingerprint.
			{/if}
		</p>

		{#if syncSupported}
			<div class="sync-card-actions">
				{#if syncState.enabled}
					<button class="sync-btn primary" onclick={() => disableSync()}>Sign out</button>
					<button class="sync-btn danger-ghost" onclick={openDeleteDialog}>
						Delete sync account
					</button>
				{:else}
					<button
						class="sync-btn primary"
						onclick={handleEnableSync}
						disabled={syncState.status === 'connecting'}
					>
						{syncState.status === 'connecting' ? 'Connecting…' : 'Enable'}
					</button>
					<button
						class="sync-btn ghost"
						onclick={handleSignInSync}
						disabled={syncState.status === 'connecting'}
					>
						Sign in with existing
					</button>
				{/if}
			</div>
		{/if}
	</section>

	<h3 class="settings-subhead">Theme</h3>
	<div class="theme-grid">
		{#each THEMES as t (t.id)}
			<button
				class="theme-card"
				class:selected={theme.value === t.id}
				onclick={() => setTheme(t.id)}
				aria-label={t.name}
				title={t.name}
			>
				<span
					class="theme-dot"
					aria-hidden="true"
					style="background: conic-gradient(from 135deg, {t.swatches[1]} 0 50%, {t.swatches[0]} 50% 100%); border-color: {t.swatches[4]};"
				></span>
				<span class="theme-name">{t.name}</span>
			</button>
		{/each}
	</div>
</dialog>
<dialog
	bind:this={deleteDialog}
	class="confirm-dialog"
	aria-labelledby="delete-sync-title"
	oncancel={(e) => {
		e.preventDefault();
		closeDeleteDialog();
	}}
>
	<h2 id="delete-sync-title">Delete private sync account?</h2>
	<p class="sync-confirm-text">
		This deletes all synced entries and passkeys from the server. Entries already on this device stay.
	</p>
	<div class="sync-confirm-actions">
		<button class="sync-btn ghost" type="button" onclick={closeDeleteDialog}>Cancel</button>
		<button class="sync-btn danger" type="button" onclick={handleDelete}>Yes, delete</button>
	</div>
</dialog>