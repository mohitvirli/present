<script lang="ts">
	// The members sheet of a shared entry: who's in it, your name, invites and
	// member actions. A native modal <dialog> (Escape, focus trap, backdrop),
	// anchored under the header on wide screens and a bottom sheet on phones.
	// Names live encrypted in the doc, keyed by user id; roles and join dates come
	// from the server, cached so the list is there the moment the sheet opens.
	import gsap from 'gsap';
	import { onMount, tick } from 'svelte';
	import type * as Y from 'yjs';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		cachedMembers,
		deleteForEveryone,
		fetchMembers,
		leaveShared,
		memberHue,
		removeMember,
		sharedNames,
		transferOwner
	} from '$lib/shared/store';
	import { createInvite, lastName, rememberName } from '$lib/shared/invites';
	import { confirmDialog } from '$lib/dialogs.svelte';
	import type { MembersResponse } from '../../routes/api/shared/[id]/members/+server';

	let {
		entryId,
		doc,
		title = '',
		onClose
	}: { entryId: string; doc: Y.Doc; title?: string; onClose: () => void } = $props();

	const MAX = 8;
	const names = $derived(sharedNames(doc));

	// svelte-ignore state_referenced_locally
	const cached = cachedMembers(entryId);
	let me = $state<string | null>(cached?.me ?? null);
	let members = $state<MembersResponse['members']>(cached?.members ?? []);
	let loaded = $state(!!cached);
	let nameMap = $state<Record<string, string>>({});
	let myName = $state('');
	let loadError = $state('');
	let invite = $state<{ link: string; copied: boolean } | null>(null);
	let inviting = $state(false);
	let inviteError = $state('');
	let busy = $state(false);
	let actionError = $state('');

	let el = $state<HTMLDialogElement | null>(null);
	let listEl = $state<HTMLUListElement | null>(null);
	let closing = false;

	const isOwner = $derived(members.find((m) => m.userId === me)?.role === 'owner');
	const full = $derived(members.length >= MAX);
	const phone = () => window.matchMedia('(max-width: 639px)').matches;

	function readNames() {
		nameMap = Object.fromEntries(names.entries());
	}
	$effect(() => {
		const n = names;
		readNames();
		n.observe(readNames);
		return () => n.unobserve(readNames);
	});

	onMount(() => {
		if (me) myName = names.get(me) ?? lastName();
		open();
		void loadMembers();
	});

	function open() {
		if (!el) return;
		el.showModal();
		const fromPhone = phone();
		gsap.fromTo(el, fromPhone ? { y: 40, autoAlpha: 0 } : { autoAlpha: 0, y: -6, scale: 0.96 }, {
			autoAlpha: 1,
			y: 0,
			scale: 1,
			duration: fromPhone ? 0.32 : 0.24,
			ease: 'power3.out'
		});
		void staggerRows();
	}

	function close() {
		if (!el || closing) return;
		closing = true;
		saveName();
		const d = el;
		gsap.to(d, {
			...(phone() ? { y: 40 } : { y: -6, scale: 0.96 }),
			autoAlpha: 0,
			duration: 0.16,
			ease: 'power2.in',
			onComplete: () => {
				d.close();
				onClose();
			}
		});
	}

	async function staggerRows() {
		await tick();
		const rows = listEl?.querySelectorAll(':scope > li:not(.skeleton)');
		if (!rows?.length) return;
		gsap.fromTo(
			rows,
			{ autoAlpha: 0, y: 6 },
			{ autoAlpha: 1, y: 0, duration: 0.28, ease: 'power3.out', stagger: 0.05, delay: 0.06 }
		);
	}

	async function loadMembers() {
		try {
			const data = await fetchMembers(entryId);
			const first = !loaded;
			me = data.me;
			members = data.members;
			loaded = true;
			if (!myName) myName = names.get(data.me) ?? lastName();
			if (first) void staggerRows();
		} catch (e) {
			if (!loaded)
				loadError = `Couldn’t load members ${e instanceof Error ? e.message : ''}`.trim();
		}
	}

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
			setTimeout(() => invite && (invite.copied = false), 2000);
		} catch {
			/* clipboard blocked — the link stays selectable */
		}
	}

	async function act(fn: () => Promise<void>, after: 'reload' | 'leave') {
		busy = true;
		actionError = '';
		try {
			await fn();
			if (after === 'leave') {
				el?.close();
				onClose();
				await goto(resolve('/'));
			} else {
				invite = null;
				await loadMembers();
			}
		} catch (e) {
			actionError = e instanceof Error ? e.message : 'Something went wrong.';
		} finally {
			busy = false;
		}
	}

	async function remove(userId: string, i: number) {
		const who = label(userId, i);
		const ok = await confirmDialog({
			title: `Remove ${who}?`,
			body: `${who} keeps a read-only copy of what they’ve seen, but gets nothing new. The entry moves to a new key.`,
			confirmLabel: 'Remove',
			danger: true
		});
		if (ok) void act(() => removeMember(entryId, userId), 'reload');
	}

	async function makeOwner(userId: string, i: number) {
		const who = label(userId, i);
		const ok = await confirmDialog({
			title: `Make ${who} the owner?`,
			body: 'They’ll be able to invite and remove people. You’ll become an editor.',
			confirmLabel: 'Make owner'
		});
		if (ok) void act(() => transferOwner(entryId, userId), 'reload');
	}

	async function leave() {
		if (!me) return;
		const ok = await confirmDialog({
			title: 'Leave this shared entry?',
			body: 'It disappears from your journal. Someone would need to invite you again.',
			confirmLabel: 'Leave',
			danger: true
		});
		if (ok) void act(() => leaveShared(entryId, me!), 'leave');
	}

	async function deleteAll() {
		const ok = await confirmDialog({
			title: 'Delete for everyone?',
			body: 'The entry is removed from every member’s journal. This can’t be undone.',
			confirmLabel: 'Delete',
			danger: true
		});
		if (ok) void act(() => deleteForEveryone(entryId), 'leave');
	}

	const hue = memberHue;

	function label(userId: string, i: number): string {
		return nameMap[userId] || `Member ${i + 1}`;
	}

	function initial(userId: string, i: number): string {
		return (userId === me ? myName.trim() || label(userId, i) : label(userId, i))
			.slice(0, 1)
			.toUpperCase();
	}

	function joined(at: string): string {
		return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	// a tap on the backdrop lands on the <dialog> itself
	function backdropClick(e: MouseEvent) {
		if (e.target === el) close();
	}
</script>

<dialog
	bind:this={el}
	class="members-dialog"
	aria-labelledby="members-title"
	oncancel={(e) => {
		e.preventDefault();
		close();
	}}
	onclick={backdropClick}
>
	<div class="members-shell">
		<header class="members-head">
			<div class="members-heading">
				<h2 id="members-title">{title.trim() || 'Shared entry'}</h2>
				<p>
					{#if loaded}
						{members.length} of {MAX} people · end-to-end encrypted
					{:else}
						End-to-end encrypted
					{/if}
				</p>
			</div>
			<button class="settings-close" type="button" onclick={close} aria-label="Close">
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
		</header>

		{#if loadError}
			<p class="members-error">{loadError}</p>
		{:else}
			<ul class="members-list" bind:this={listEl}>
				{#if !loaded}
					{#each [0, 1] as i (i)}
						<li class="skeleton" aria-hidden="true">
							<span class="avatar"></span>
							<span class="bar"></span>
						</li>
					{/each}
				{:else}
					{#each members as m, i (m.userId)}
						<li class:me={m.userId === me}>
							<span class="avatar" style="--h: {hue(m.userId)}" aria-hidden="true"
								>{initial(m.userId, i)}</span
							>
							<span class="who">
								{#if m.userId === me}
									<input
										class="name-input"
										bind:value={myName}
										onblur={saveName}
										onkeydown={(e) =>
											e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
										maxlength="40"
										placeholder="Add your name"
										aria-label="Your name"
										autocomplete="nickname"
									/>
									<span class="sub">You · how others see you</span>
								{:else}
									<span class="name">{label(m.userId, i)}</span>
									<span class="sub">
										{m.role === 'owner' ? 'Owner' : `Joined ${joined(m.joinedAt)}`}
									</span>
								{/if}
							</span>
							{#if m.userId === me && m.role === 'owner'}
								<span class="chip">Owner</span>
							{:else if isOwner && m.userId !== me}
								<span class="row-actions">
									<button
										type="button"
										class="icon-btn"
										disabled={busy}
										onclick={() => makeOwner(m.userId, i)}
										title="Make owner"
										aria-label="Make {label(m.userId, i)} the owner"
									>
										<svg
											width="15"
											height="15"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											aria-hidden="true"
										>
											<path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5Z" />
										</svg>
									</button>
									<button
										type="button"
										class="icon-btn danger"
										disabled={busy}
										onclick={() => remove(m.userId, i)}
										title="Remove"
										aria-label="Remove {label(m.userId, i)}"
									>
										<svg
											width="15"
											height="15"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											aria-hidden="true"
										>
											<path d="M18 6 6 18M6 6l12 12" />
										</svg>
									</button>
								</span>
							{/if}
						</li>
					{/each}
				{/if}
			</ul>

			{#if isOwner}
				<section class="invite-card">
					{#if invite}
						<div class="link-row">
							<input
								class="link"
								readonly
								value={invite.link}
								aria-label="Invite link"
								onfocus={(e) => e.currentTarget.select()}
							/>
							<button class="sync-btn primary" type="button" onclick={copy}>
								{invite.copied ? 'Copied' : 'Copy'}
							</button>
						</div>
						<p class="hint">Works once · expires in 7 days · send it privately</p>
					{:else}
						<button
							class="invite-btn"
							type="button"
							onclick={makeInvite}
							disabled={inviting || full || !myName.trim()}
						>
							<svg
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
								<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
								<path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
							</svg>
							<span>
								<strong>{inviting ? 'Creating link…' : 'Invite someone'}</strong>
								<small>
									{full
										? 'This entry is full.'
										: !myName.trim()
											? 'Add your name first.'
											: 'A single-use link, copied for you.'}
								</small>
							</span>
						</button>
					{/if}
					{#if inviteError}<p class="members-error">{inviteError}</p>{/if}
				</section>
			{/if}
		{/if}

		<footer class="members-foot">
			{#if loaded && me}
				{#if isOwner}
					<button class="sync-btn danger-ghost" type="button" disabled={busy} onclick={deleteAll}
						>Delete for everyone</button
					>
				{:else}
					<button class="sync-btn danger-ghost" type="button" disabled={busy} onclick={leave}
						>Leave entry</button
					>
				{/if}
			{/if}
			<button class="sync-btn primary" type="button" onclick={close}>Done</button>
		</footer>
		{#if actionError}<p class="members-error">{actionError}</p>{/if}
	</div>
</dialog>
