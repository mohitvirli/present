<script lang="ts">
	// Join a shared entry from an invite link: /join/<inviteId>#<secret>.
	// Needs a sync session (to be a member) with a PRF passkey (to hold keys).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { fullSync, syncState, sharedIdentity } from '$lib/sync.svelte';
	import {
		setSharedEnabled,
		sharedEntriesAvailable,
		sharedSettings
	} from '$lib/settings.svelte';
	import { openInvite, lastName, rememberName, type OpenedInvite } from '$lib/shared/invites';
	import { openShared, sharedNames, syncShared } from '$lib/shared/store';
	import type { MembersResponse } from '../../api/shared/[id]/members/+server';

	type View = 'loading' | 'off' | 'signin' | 'error' | 'ready' | 'joining';

	let view = $state<View>('loading');
	let message = $state('');
	let invite = $state<OpenedInvite | null>(null);
	let name = $state(lastName());

	const inviteId = page.params.id ?? '';
	const secret = typeof location !== 'undefined' ? location.hash.slice(1) : '';

	async function load() {
		if (!sharedEntriesAvailable) {
			message = 'Shared entries aren’t available yet.';
			return void (view = 'error');
		}
		if (!sharedSettings.enabled) return void (view = 'off');
		if (!syncState.enabled) return void (view = 'signin');
		view = 'loading';
		try {
			invite = await openInvite(inviteId, secret);
			view = 'ready';
		} catch (e) {
			message = e instanceof Error ? e.message : 'Could not open this invite.';
			view = 'error';
		}
	}

	onMount(load);

	function turnOn() {
		setSharedEnabled(true);
		void fullSync(); // creates this account's sharing keys in the background
		void load();
	}

	// signing in to sync from Settings on this page picks the invite back up
	$effect(() => {
		if (syncState.enabled && view === 'signin') void load();
	});

	async function join() {
		if (!invite || !name.trim()) return;
		view = 'joining';
		try {
			let entryId = invite.entryId;
			if (invite.status !== 'member') {
				const identity = await sharedIdentity();
				if (!identity) {
					throw new Error('Your passkey on this device can’t hold shared entries.');
				}
				entryId = await invite.accept(identity.publicJwk);
			}
			rememberName(name.trim());
			await syncShared();
			await setName(entryId, name.trim());
			await goto(`${resolve('/entry')}?id=${entryId}`);
		} catch (e) {
			message = e instanceof Error ? e.message : 'Could not join.';
			view = 'error';
		}
	}

	async function setName(entryId: string, n: string) {
		const res = await fetch(`/api/shared/${entryId}/members`);
		if (!res.ok) return;
		const { me } = (await res.json()) as MembersResponse;
		const opened = await openShared(entryId);
		if (!opened) return;
		const names = sharedNames(opened.doc);
		if (names.get(me) !== n) names.set(me, n);
		opened.dispose(); // flushes the name to the server
	}
</script>

<main class="join">
	{#if view === 'loading'}
		<p class="muted">Opening invite…</p>
	{:else if view === 'off'}
		<h1>Turn on shared entries?</h1>
		<p class="muted">
			Someone invited you to write an entry together. Shared entries are end-to-end encrypted;
			you can turn them off again in Settings → Sync.
		</p>
		<div class="actions">
			<button type="button" class="btn primary" onclick={turnOn}>Turn on</button>
			<a class="btn" href={resolve('/')}>Not now</a>
		</div>
	{:else if view === 'signin'}
		<h1>Sign in to join</h1>
		<p class="muted">
			Shared entries need sync. Open Settings → Sync on the timeline and sign in or turn it on, then
			open this link again.
		</p>
		<a class="btn" href={resolve('/')}>Go to timeline</a>
	{:else if view === 'error'}
		<h1>Can’t join</h1>
		<p class="muted">{message}</p>
		<a class="btn" href={resolve('/')}>Go to timeline</a>
	{:else if invite}
		<p class="muted">Invite</p>
		<h1>
			{invite.preview.inviter || 'Someone'} invited you to
			{#if invite.preview.title}<em>{invite.preview.title}</em>{:else}a shared entry{/if}
		</h1>

		{#if invite.status === 'used' || invite.status === 'expired'}
			<p class="muted">
				This invite {invite.status === 'used' ? 'was already used' : 'has expired'}. Ask for a new
				one.
			</p>
			<a class="btn" href={resolve('/')}>Go to timeline</a>
		{:else}
			<label>
				<span class="muted">Your name</span>
				<input bind:value={name} maxlength="40" placeholder="How others see you" />
			</label>
			<p class="muted small">
				Everyone in the entry sees your name and can read and edit it. It stays encrypted; the
				server can’t read it.
			</p>
			<div class="actions">
				<button
					type="button"
					class="btn primary"
					onclick={join}
					disabled={view === 'joining' || !name.trim()}
				>
					{view === 'joining' ? 'Joining…' : invite.status === 'member' ? 'Open entry' : 'Join'}
				</button>
				<a class="btn" href={resolve('/')}>Decline</a>
			</div>
		{/if}
	{/if}
</main>

<style>
	.join {
		max-width: 440px;
		margin: 15vh auto 0;
		padding: 0 16px;
		display: grid;
		gap: 14px;
	}
	h1 {
		font-size: 1.35rem;
		font-weight: 600;
		line-height: 1.3;
		margin: 0;
	}
	em {
		font-style: normal;
		color: var(--color-accent);
	}
	.muted {
		color: var(--color-text-muted);
		margin: 0;
	}
	.small {
		font-size: 0.8rem;
	}
	label {
		display: grid;
		gap: 4px;
		font-size: 0.85rem;
	}
	input {
		font: inherit;
		padding: 8px 10px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-surface);
		color: var(--color-text);
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.btn {
		font: inherit;
		font-size: 0.9rem;
		padding: 8px 14px;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		text-decoration: none;
		cursor: pointer;
		justify-self: start;
	}
	.btn.primary {
		background: var(--color-accent);
		border-color: transparent;
		color: var(--color-accent-text);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
