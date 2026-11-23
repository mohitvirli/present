<script lang="ts">
	// The members sheet of a shared entry: who's in it, your own name, and (for
	// the owner) single-use invite links. Names are stored in the entry's
	// encrypted doc, keyed by user id; roles and join dates come from the server.
	import { onMount } from 'svelte';
	import type * as Y from 'yjs';
	import { sharedNames } from '$lib/shared/store';
	import { createInvite, lastName, rememberName } from '$lib/shared/invites';
	import type { MembersResponse } from '../../routes/api/shared/[id]/members/+server';

	let {
		entryId,
		doc,
		title = '',
		onClose
	}: { entryId: string; doc: Y.Doc; title?: string; onClose: () => void } = $props();

	const MAX = 8;
	const names = $derived(sharedNames(doc));

	let me = $state<string | null>(null);
	let members = $state<MembersResponse['members']>([]);
	let nameMap = $state<Record<string, string>>({});
	let myName = $state('');
	let loadError = $state('');
	let invite = $state<{ link: string; copied: boolean } | null>(null);
	let inviting = $state(false);
	let inviteError = $state('');

	const isOwner = $derived(members.find((m) => m.userId === me)?.role === 'owner');
	const full = $derived(members.length >= MAX);

	function readNames() {
		nameMap = Object.fromEntries(names.entries());
	}
	$effect(() => {
		const n = names;
		readNames();
		n.observe(readNames);
		return () => n.unobserve(readNames);
	});

	onMount(async () => {
		try {
			const res = await fetch(`/api/shared/${entryId}/members`);
			if (!res.ok) throw new Error(`(${res.status})`);
			const data = (await res.json()) as MembersResponse;
			me = data.me;
			members = data.members;
			myName = names.get(data.me) ?? lastName();
		} catch (e) {
			loadError = `Couldn’t load members ${e instanceof Error ? e.message : ''}`.trim();
		}
	});

	function saveName() {
		const n = myName.trim().slice(0, 40);
		if (!me || !n || names.get(me) === n) return;
		names.set(me, n);
		rememberName(n);
	}

	async function makeInvite() {
		saveName();
		inviting = true;
		inviteError = '';
		try {
			const link = await createInvite(entryId, {
				title: title.trim() || undefined,
				inviter: myName.trim()
			});
			invite = { link, copied: false };
			await copy();
		} catch (e) {
			inviteError = e instanceof Error ? e.message : 'Could not create invite.';
		} finally {
			inviting = false;
		}
	}

	async function copy() {
		if (!invite) return;
		try {
			await navigator.clipboard.writeText(invite.link);
			invite.copied = true;
		} catch {
			/* clipboard blocked — the link stays selectable */
		}
	}

	// stable per person, same on every member's screen
	function hue(id: string): number {
		let h = 0;
		for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
		return h;
	}

	function label(userId: string, i: number): string {
		return nameMap[userId] || `Member ${i + 1}`;
	}

	function joined(at: string): string {
		return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="sheet" role="dialog" aria-label="Members">
	<header>
		<strong>Shared entry</strong>
		<span class="count">{members.length} of {MAX}</span>
		<button type="button" class="close" onclick={onClose} aria-label="Close">×</button>
	</header>

	{#if loadError}
		<p class="error">{loadError}</p>
	{:else}
		<label class="name">
			<span>Your name</span>
			<input
				bind:value={myName}
				onblur={saveName}
				onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
				maxlength="40"
				placeholder="How others see you"
				autocomplete="nickname"
			/>
		</label>

		<ul class="members">
			{#each members as m, i (m.userId)}
				<li>
					<span class="avatar" style="--h: {hue(m.userId)}" aria-hidden="true">
						{label(m.userId, i).slice(0, 1).toUpperCase()}
					</span>
					<span class="who">
						{m.userId === me ? 'You' : label(m.userId, i)}
					</span>
					<span class="role">
						{m.role === 'owner' ? 'Owner' : `Joined ${joined(m.joinedAt)}`}
					</span>
				</li>
			{/each}
		</ul>

		{#if isOwner}
			<div class="invite">
				{#if invite}
					<input
						class="link"
						readonly
						value={invite.link}
						onfocus={(e) => e.currentTarget.select()}
					/>
					<button type="button" onclick={copy}>{invite.copied ? 'Copied' : 'Copy'}</button>
					<p class="hint">Single use · expires in 7 days · anyone with it can join</p>
				{:else}
					<button
						type="button"
						class="primary"
						onclick={makeInvite}
						disabled={inviting || full || !myName.trim()}
					>
						{inviting ? 'Creating…' : 'Invite someone'}
					</button>
					<p class="hint">
						{full
							? 'This entry is full.'
							: !myName.trim()
								? 'Add your name first.'
								: 'Makes a link to send.'}
					</p>
				{/if}
				{#if inviteError}<p class="error">{inviteError}</p>{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.sheet {
		position: fixed;
		top: 64px;
		right: max(16px, calc(50vw - 380px));
		z-index: 30;
		width: min(320px, calc(100vw - 32px));
		padding: 14px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		box-shadow: var(--shadow-sm);
		font-size: 0.85rem;
		color: var(--color-text);
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}
	.count {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}
	.close {
		margin-left: auto;
		border: none;
		background: none;
		font-size: 1.1rem;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.name {
		display: grid;
		gap: 4px;
		margin-bottom: 12px;
	}
	.name span,
	.hint {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}
	input {
		font: inherit;
		padding: 6px 8px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		color: var(--color-text);
		min-width: 0;
	}
	.members {
		list-style: none;
		margin: 0 0 12px;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	.members li {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.avatar {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: 0.7rem;
		font-weight: 600;
		color: #fff;
		background: hsl(var(--h) 45% 50%);
		flex: none;
	}
	.who {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.role {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}
	.invite {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.invite .link {
		flex: 1;
		font-size: 0.75rem;
	}
	.invite .hint {
		flex-basis: 100%;
		margin: 0;
	}
	button {
		font: inherit;
		padding: 6px 10px;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		color: var(--color-text);
		cursor: pointer;
	}
	button.primary {
		background: var(--color-accent);
		border-color: transparent;
		color: var(--color-accent-text);
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.error {
		color: var(--color-danger);
		margin: 6px 0 0;
		font-size: 0.75rem;
	}
</style>
