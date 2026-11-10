<script lang="ts">
	import gsap from 'gsap';
	import { THEMES, THEME_BY_ID, PALETTES, theme, setTheme, setAutoTheme } from '$lib/theme.svelte';
	import {
		aiSettings,
		micSettings,
		calendarSettings,
		spellcheckSettings,
		locationSettings,
		setAiEnabled,
		setMicEnabled,
		setCalendarEnabled,
		setSpellcheckEnabled,
		setLocationEnabled
	} from '$lib/settings.svelte';
	import { currentPosition, geolocationSupported, permissionState } from '$lib/location';
	import {
		syncState,
		syncSupported,
		enableSync,
		signInSync,
		disableSync,
		deleteSyncAccount,
		fullSync
	} from '$lib/sync.svelte';
	import { exportAll, type ExportFormat } from '$lib/export';
	import { applyImport, planImport, type ImportPlan } from '$lib/import';

	let deleteDialog = $state<HTMLDialogElement | null>(null);

	// Turning location on is the moment to ask — a click with clear intent — so
	// the composer's first silent capture finds permission already granted.
	let locationNote = $state('');
	async function handleLocationToggle(on: boolean) {
		locationNote = '';
		setLocationEnabled(on);
		if (!on) return;
		await currentPosition({ prompt: true });
		if ((await permissionState()) === 'denied') {
			setLocationEnabled(false);
			locationNote = 'Location is blocked for this site in your browser settings.';
		}
	}

	async function handleDelete() {
		const ok = await deleteSyncAccount();
		if (ok) closeDeleteDialog();
	}
	let dialog = $state<HTMLDialogElement | null>(null);
	let importDialog = $state<HTMLDialogElement | null>(null);

	function show(d: HTMLDialogElement | null) {
		if (!d) return;
		d.showModal();
		gsap.fromTo(
			d,
			{ autoAlpha: 0, y: 10, scale: 0.97 },
			{ autoAlpha: 1, y: 0, scale: 1, duration: 0.24, ease: 'power3.out' }
		);
	}

	function hide(d: HTMLDialogElement | null, done?: () => void) {
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
				done?.();
			}
		});
	}

	// --- sections ---

	const TABS = [
		{ id: 'writing', label: 'Writing' },
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'sync', label: 'Sync' },
		{ id: 'data', label: 'Data' }
	] as const;
	type TabId = (typeof TABS)[number]['id'];

	let tab = $state<TabId>('writing');
	let panel = $state<HTMLDivElement | null>(null);
	let tabEls = $state<(HTMLButtonElement | null)[]>([]);

	function selectTab(id: TabId) {
		if (id === tab) return;
		tab = id;
		if (panel) {
			panel.scrollTop = 0;
			gsap.fromTo(
				panel,
				{ autoAlpha: 0, y: 4 },
				{ autoAlpha: 1, y: 0, duration: 0.2, ease: 'power2.out' }
			);
		}
	}

	// roving focus: arrows move between tabs, the way a tablist should
	function tabKey(e: KeyboardEvent, i: number) {
		const step =
			e.key === 'ArrowDown' || e.key === 'ArrowRight'
				? 1
				: e.key === 'ArrowUp' || e.key === 'ArrowLeft'
					? -1
					: 0;
		if (!step) return;
		e.preventDefault();
		const next = (i + step + TABS.length) % TABS.length;
		selectTab(TABS[next].id);
		tabEls[next]?.focus();
	}

	const open = () => show(dialog);
	const close = () => hide(dialog);

	// a tap on the dimmed backdrop lands on the <dialog> itself
	function backdropClick(e: MouseEvent) {
		if (e.target === dialog) close();
	}
	const openDeleteDialog = () => show(deleteDialog);
	const closeDeleteDialog = () => hide(deleteDialog);

	async function handleEnableSync() {
		await enableSync();
		if (syncState.status !== 'error') {
			close();
		}
	}

	// The state beside the card title. The synced time is absolute, so it needs
	// no ticking while the panel stays open.
	function syncStateLabel(): string {
		if (!syncSupported) return 'Requires HTTPS';
		if (syncState.status === 'error') return 'Error';
		if (!syncState.enabled) return 'Off';
		if (syncState.status === 'syncing') return 'Syncing…';
		if (!syncState.syncedAt) return 'On';
		return `Synced ${syncedTime(syncState.syncedAt)}`;
	}

	function syncedTime(ms: number): string {
		const at = new Date(ms);
		const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
		if (at.toDateString() === new Date().toDateString()) return time;
		const day = at.toLocaleDateString([], { month: 'short', day: 'numeric' });
		return `${day}, ${time}`;
	}

	async function handleSignInSync() {
		await signInSync();
		if (syncState.status !== 'error') {
			close();
		}
	}

	// --- data: export / import ---

	// The card's description line doubles as the status line, the way the sync
	// card's does — there is no toast primitive in the app.
	let dataState = $state<'idle' | 'working' | 'error'>('idle');
	let dataNote = $state('');
	let noteTimer: ReturnType<typeof setTimeout> | null = null;
	let fileInput = $state<HTMLInputElement | null>(null);
	let pending = $state<ImportPlan | null>(null);
	let seededCount = $state(0);
	let clearSeeded = $state(false);

	function note(state: 'idle' | 'error', text: string) {
		dataState = state;
		dataNote = text;
		if (noteTimer) clearTimeout(noteTimer);
		noteTimer = setTimeout(() => {
			dataState = 'idle';
			dataNote = '';
		}, 6000);
	}

	function message(e: unknown, fallback: string): string {
		return e instanceof Error && e.message ? e.message : fallback;
	}

	const entryCount = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;

	async function handleExport(format: ExportFormat) {
		if (dataState === 'working') return;
		dataState = 'working';
		dataNote = '';
		try {
			const res = await exportAll(format);
			// a dismissed share sheet is a choice, not a failure
			if (res.saved === 'dismissed') note('idle', '');
			else
				note(
					'idle',
					`${entryCount(res.entryCount)} saved${res.synced === false ? ' — this device only, sync failed' : ''}.`
				);
		} catch (e) {
			note('error', message(e, 'Could not export your entries.'));
		}
	}

	async function handleImportFile(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		const file = input.files?.[0];
		// reset first, or picking the same file twice does nothing the second time
		input.value = '';
		if (!file) return;
		dataState = 'working';
		dataNote = '';
		try {
			const plan = await planImport(file);
			seededCount = plan.removableSeeded.length;
			clearSeeded = seededCount > 0;
			pending = plan;
			dataState = 'idle';
			show(importDialog);
		} catch (e) {
			note('error', message(e, 'Could not read that file.'));
		}
	}

	function cancelImport() {
		// the dialog reads from `pending`, so clear it only once it's gone
		hide(importDialog, () => (pending = null));
	}

	async function confirmImport() {
		const plan = pending;
		if (!plan) return;
		hide(importDialog, () => (pending = null));
		dataState = 'working';
		dataNote = '';
		const planned = plan.create.length + plan.update.length;
		try {
			const { applied, failed, purged } = await applyImport(plan, { clearSeeded });
			const removed = purged
				? `${purged} welcome ${purged === 1 ? 'entry' : 'entries'} removed`
				: '';
			if (failed)
				note('error', `${applied} of ${planned} restored — ${failed} could not be written.`);
			else if (!planned)
				note('idle', removed ? `${removed}.` : 'Everything in that file was already here.');
			else
				note(
					'idle',
					[`${plan.create.length} added`, `${plan.update.length} updated`, removed]
						.filter(Boolean)
						.join(', ') + '.'
				);
		} catch (e) {
			note('error', message(e, 'Could not restore that file.'));
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
	onclick={backdropClick}
>
	<div class="settings-shell">
		<aside class="settings-side">
			<div class="settings-head">
				<h2 id="settings-title">Settings</h2>
				<button class="settings-close" onclick={close} aria-label="Close">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.2"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<path d="M18 6 6 18M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="settings-tabs" role="tablist" aria-label="Settings sections">
				{#each TABS as t, i (t.id)}
					<button
						bind:this={tabEls[i]}
						id="settings-tab-{t.id}"
						class="settings-tab"
						class:active={tab === t.id}
						role="tab"
						type="button"
						aria-selected={tab === t.id}
						aria-controls="settings-section-{t.id}"
						tabindex={tab === t.id ? 0 : -1}
						onclick={() => selectTab(t.id)}
						onkeydown={(e) => tabKey(e, i)}
					>
						<svg
							class="settings-tab-icon"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							{#if t.id === 'writing'}
								<path d="M12 20h9" />
								<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
							{:else if t.id === 'appearance'}
								<circle cx="12" cy="12" r="9" />
								<path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" />
							{:else if t.id === 'sync'}
								<rect x="3" y="11" width="18" height="11" rx="2" />
								<path d="M7 11V7a5 5 0 0 1 10 0v4" />
							{:else}
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
								<path d="M7 10l5 5 5-5" />
								<path d="M12 15V3" />
							{/if}
						</svg>
						<span class="settings-tab-label">{t.label}</span>
						{#if t.id === 'sync' && syncState.enabled}
							<span
								class="settings-tab-dot"
								class:is-error={syncState.status === 'error'}
								aria-hidden="true"
							></span>
						{/if}
					</button>
				{/each}
			</div>

			<footer class="settings-foot">
				<a
					class="settings-repo"
					href="https://github.com/mohitvirli/present"
					target="_blank"
					rel="noopener noreferrer"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path
							d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.75.41-1.27.74-1.56-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.25 5.69.42.37.8 1.1.8 2.22v3.29c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z"
						/>
					</svg>
					<span>GitHub</span>
				</a>
				<span class="settings-version">v{__APP_VERSION__}</span>
			</footer>
		</aside>

		<!-- every section stays rendered, only the active one shown, so a phone
		     can size the dialog to the tallest of them (see app.css) -->
		<div bind:this={panel} class="settings-panel" data-lenis-prevent>
			<div
				id="settings-section-writing"
				class="settings-section"
				class:active={tab === 'writing'}
				role="tabpanel"
				aria-labelledby="settings-tab-writing"
				inert={tab !== 'writing'}
			>
				<h3 class="settings-section-title">Writing</h3>
				<p class="settings-section-sub">What the editor does while you write.</p>
				<div class="settings-group">
					<label class="settings-row">
						<span class="settings-row-text">
							<span class="settings-row-title">AI suggestions</span>
							<span class="settings-row-sub"
								>Title, tags, mood &amp; a short summary per entry.</span
							>
						</span>
						<input
							type="checkbox"
							role="switch"
							class="switch"
							checked={aiSettings.enabled}
							onchange={(e) => setAiEnabled(e.currentTarget.checked)}
						/>
					</label>
					<label class="settings-row">
						<span class="settings-row-text">
							<span class="settings-row-title">Dictation</span>
							<span class="settings-row-sub">Show the live mic button while editing.</span>
						</span>
						<input
							type="checkbox"
							role="switch"
							class="switch"
							checked={micSettings.enabled}
							onchange={(e) => setMicEnabled(e.currentTarget.checked)}
						/>
					</label>
					<label class="settings-row">
						<span class="settings-row-text">
							<span class="settings-row-title">Spell check</span>
							<span class="settings-row-sub">Squiggle misspelled words as you write.</span>
						</span>
						<input
							type="checkbox"
							role="switch"
							class="switch"
							checked={spellcheckSettings.enabled}
							onchange={(e) => setSpellcheckEnabled(e.currentTarget.checked)}
						/>
					</label>
					{#if geolocationSupported()}
						<label class="settings-row">
							<span class="settings-row-text">
								<span class="settings-row-title">Location</span>
								<span class="settings-row-sub" class:is-error={!!locationNote}
									>{locationNote || 'Quietly note where each new entry was written.'}</span
								>
							</span>
							<input
								type="checkbox"
								role="switch"
								class="switch"
								checked={locationSettings.enabled}
								onchange={(e) => handleLocationToggle(e.currentTarget.checked)}
							/>
						</label>
					{/if}
				</div>
			</div>
			<div
				id="settings-section-appearance"
				class="settings-section"
				class:active={tab === 'appearance'}
				role="tabpanel"
				aria-labelledby="settings-tab-appearance"
				inert={tab !== 'appearance'}
			>
				<h3 class="settings-section-title">Appearance</h3>
				<p class="settings-section-sub">Colours and what sits around the timeline.</p>

				<div class="settings-group">
					<label class="settings-row">
						<span class="settings-row-text">
							<span class="settings-row-title">Auto day &amp; night</span>
							<span class="settings-row-sub">Light from 6am, dark from 6pm — same palette.</span>
						</span>
						<input
							type="checkbox"
							role="switch"
							class="switch"
							checked={theme.auto}
							onchange={(e) => setAutoTheme(e.currentTarget.checked)}
						/>
					</label>
					<div class="settings-row settings-row-block">
						<span class="settings-row-title">{theme.auto ? 'Palette' : 'Theme'}</span>
						{#if theme.auto}
							<!-- auto picks the mode, so the grid picks the palette -->
							<div class="theme-grid">
								{#each PALETTES as p (p.id)}
									{@const light = THEME_BY_ID.get(p.light)!}
									{@const dark = THEME_BY_ID.get(p.dark)!}
									{@const on = theme.value === p.light || theme.value === p.dark}
									<button
										class="theme-card"
										class:selected={on}
										onclick={() => setTheme(p.light)}
										aria-pressed={on}
										aria-label={p.name}
										title={p.name}
									>
										<span class="theme-preview" aria-hidden="true">
											<span class="theme-preview-half" data-theme={light.id}></span>
											<span class="theme-preview-half" data-theme={dark.id}></span>
										</span>
										<span class="theme-name">
											{p.name}
											{#if on}
												<span class="theme-slot" aria-hidden="true">
													{theme.value === p.dark ? '☾' : '☀'}
												</span>
											{/if}
										</span>
									</button>
								{/each}
							</div>
						{:else}
							<div class="theme-grid">
								{#each THEMES as t (t.id)}
									<button
										class="theme-card"
										class:selected={theme.value === t.id}
										onclick={() => setTheme(t.id)}
										aria-pressed={theme.value === t.id}
										aria-label={t.name}
										title={t.name}
									>
										<span class="theme-preview" aria-hidden="true">
											<span class="theme-preview-half" data-theme={t.id}></span>
										</span>
										<span class="theme-name">{t.name}</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- the gutter calendar only exists on wide screens, so hide its switch below -->
				<div class="settings-group calendar-toggle">
					<label class="settings-row">
						<span class="settings-row-text">
							<span class="settings-row-title">Calendar</span>
							<span class="settings-row-sub">Month heatmap beside the timeline.</span>
						</span>
						<input
							type="checkbox"
							role="switch"
							class="switch"
							checked={calendarSettings.enabled}
							onchange={(e) => setCalendarEnabled(e.currentTarget.checked)}
						/>
					</label>
				</div>
			</div>
			<div
				id="settings-section-sync"
				class="settings-section"
				class:active={tab === 'sync'}
				role="tabpanel"
				aria-labelledby="settings-tab-sync"
				inert={tab !== 'sync'}
			>
				<h3 class="settings-section-title">Private Sync</h3>
				<p class="settings-section-sub">
					Your journal on every device, unlocked by FaceID or fingerprint.
				</p>

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
						<span class="sync-card-heading">
							<span class="sync-card-title">
								{syncState.enabled ? 'Sync is on' : 'Sync is off'}
							</span>
							<span
								class="sync-card-state"
								class:is-error={syncState.status === 'error'}
								title={syncStateLabel()}
							>
								{#if syncState.enabled && syncState.status === 'synced' && syncState.syncedAt}<span
										class="sync-card-state-verb">Synced</span
									>
									{syncedTime(
										syncState.syncedAt
									)}{:else if syncState.enabled || !syncSupported || syncState.status === 'error'}{syncStateLabel()}{/if}
							</span>
						</span>
						{#if syncSupported && syncState.enabled}
							<button
								class="sync-now"
								class:is-spinning={syncState.status === 'syncing'}
								type="button"
								aria-label="Sync now"
								onclick={() => fullSync()}
								disabled={syncState.status === 'syncing'}
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d="M21 12a9 9 0 1 1-2.64-6.36" />
									<path d="M21 3v6h-6" />
								</svg>
								<span class="sync-now-label">Sync now</span>
							</button>
						{/if}
					</header>

					<p class="sync-card-desc" class:is-error={syncState.status === 'error'}>
						{#if syncState.status === 'error'}
							{syncState.error}
						{:else if syncState.enabled}
							Entries stay in step across your devices{#if syncState.encrypted}, end-to-end
								encrypted{/if}.
						{:else}
							No account or password — a passkey on this device is the key. The server only ever
							sees ciphertext.
						{/if}
					</p>

					{#if syncSupported && !syncState.enabled}
						<div class="sync-card-actions">
							<button
								class="sync-btn primary"
								onclick={handleEnableSync}
								disabled={syncState.status === 'connecting'}
							>
								{syncState.status === 'connecting' ? 'Connecting…' : 'Turn on sync'}
							</button>
							<button
								class="sync-btn ghost"
								onclick={handleSignInSync}
								disabled={syncState.status === 'connecting'}
							>
								I already have one
							</button>
						</div>
					{/if}
				</section>

				{#if syncSupported && syncState.enabled}
					<div class="settings-group">
						<div class="settings-row">
							<span class="settings-row-text">
								<span class="settings-row-title">Sign out</span>
								<span class="settings-row-sub">Stop syncing here. Entries stay on this device.</span
								>
							</span>
							<button class="sync-btn" type="button" onclick={() => disableSync()}>
								Sign out
							</button>
						</div>
						<div class="settings-row">
							<span class="settings-row-text">
								<span class="settings-row-title is-danger">Delete sync account</span>
								<span class="settings-row-sub"
									>Erase synced entries and passkeys from the server.</span
								>
							</span>
							<button class="sync-btn danger-ghost" type="button" onclick={openDeleteDialog}>
								Delete
							</button>
						</div>
					</div>
				{/if}
			</div>
			<div
				id="settings-section-data"
				class="settings-section"
				class:active={tab === 'data'}
				role="tabpanel"
				aria-labelledby="settings-tab-data"
				inert={tab !== 'data'}
			>
				<h3 class="settings-section-title">Data</h3>
				<p class="settings-section-sub">
					Every entry in one file. {#if syncState.enabled}Syncs first, so it holds the whole
						account.{/if}
				</p>

				{#if dataNote || dataState === 'working'}
					<p class="data-status" class:is-error={dataState === 'error'} aria-live="polite">
						{dataState === 'working' && !dataNote ? 'Working…' : dataNote}
					</p>
				{/if}

				<h4 class="settings-group-label">Export</h4>
				<div class="settings-group">
					<div class="settings-row">
						<span class="settings-row-text">
							<span class="settings-row-title">JSON</span>
							<span class="settings-row-sub">A backup you can restore from.</span>
						</span>
						<button
							class="sync-btn"
							type="button"
							onclick={() => handleExport('json')}
							disabled={dataState === 'working'}
						>
							Export
						</button>
					</div>
					<div class="settings-row">
						<span class="settings-row-text">
							<span class="settings-row-title">Markdown</span>
							<span class="settings-row-sub">Plain text, for reading anywhere.</span>
						</span>
						<button
							class="sync-btn"
							type="button"
							onclick={() => handleExport('markdown')}
							disabled={dataState === 'working'}
						>
							Export
						</button>
					</div>
				</div>
				<p class="data-card-warn">Exports are not encrypted — keep the file somewhere safe.</p>

				<h4 class="settings-group-label">Restore</h4>
				<div class="settings-group">
					<div class="settings-row">
						<span class="settings-row-text">
							<span class="settings-row-title">Import JSON</span>
							<span class="settings-row-sub">Adds or updates entries — never deletes.</span>
						</span>
						<button
							class="sync-btn"
							type="button"
							onclick={() => fileInput?.click()}
							disabled={dataState === 'working'}
						>
							Choose file
						</button>
					</div>
				</div>

				<!-- the button above is the control; this only carries the file -->
				<input
					bind:this={fileInput}
					class="data-file"
					type="file"
					accept="application/json,.json"
					tabindex="-1"
					aria-hidden="true"
					onchange={handleImportFile}
				/>
			</div>
		</div>

		<!-- settings apply as they change, so closing is all that's left to do -->
		<div class="settings-actions">
			<button class="sync-btn primary" type="button" onclick={close}>Done</button>
		</div>
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
		This deletes all synced entries and passkeys from the server. Entries already on this device
		stay.
	</p>
	<div class="sync-confirm-actions">
		<button class="sync-btn ghost" type="button" onclick={closeDeleteDialog}>Cancel</button>
		<button class="sync-btn danger" type="button" onclick={handleDelete}>Yes, delete</button>
	</div>
</dialog>

<dialog
	bind:this={importDialog}
	class="confirm-dialog"
	aria-labelledby="import-title"
	oncancel={(e) => {
		e.preventDefault();
		cancelImport();
	}}
>
	<h2 id="import-title">Restore from this file?</h2>
	{#if pending}
		<p class="sync-confirm-text">
			<strong>{pending.create.length} new</strong>,
			<strong>{pending.update.length} updated</strong>,
			{pending.skip} already up to date{#if pending.rejected}, {pending.rejected} unreadable{/if}.
			Entries are added or updated — nothing of yours is deleted.
		</p>
		{#if seededCount > 0}
			<label class="ai-toggle data-seeded">
				<span class="ai-toggle-text">
					<span class="ai-toggle-title">Remove the welcome entries</span>
					<span class="ai-toggle-sub">
						Clears the {seededCount} example {seededCount === 1 ? 'entry' : 'entries'} this app seeded.
					</span>
				</span>
				<input type="checkbox" role="switch" class="switch" bind:checked={clearSeeded} />
			</label>
		{/if}
	{/if}
	<div class="sync-confirm-actions">
		<button class="sync-btn ghost" type="button" onclick={cancelImport}>Cancel</button>
		<button class="sync-btn primary" type="button" onclick={confirmImport}>Restore</button>
	</div>
</dialog>
