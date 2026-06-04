<script lang="ts">
	import EntryCard from './EntryCard.svelte';
	import type { Entry } from '$lib/db';

	let { entries, loaded }: { entries: Entry[]; loaded: boolean } = $props();

	function dayKey(ts: number): string {
		return new Date(ts).toISOString().slice(0, 10);
	}

	function dayLabel(key: string): string {
		const today = new Date().toISOString().slice(0, 10);
		const yest = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
		if (key === today) return 'Today';
		if (key === yest) return 'Yesterday';
		return new Date(key).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		});
	}

	const groups = $derived.by(() => {
		const map = new Map<string, Entry[]>();
		for (const e of entries) {
			const k = dayKey(e.createdAt);
			if (!map.has(k)) map.set(k, []);
			map.get(k)!.push(e);
		}
		return [...map.entries()];
	});
</script>

{#if !loaded}
	<p class="muted">Loading…</p>
{:else if entries.length === 0}
	<div class="timeline-empty">
		<p>Nothing here yet.</p>
		<a class="empty-cta" href="/new">Write your first entry</a>
	</div>
{:else}
	<ol class="timeline">
		{#each groups as [day, items] (day)}
			<li class="day-group">
				<h2 class="day-label">{dayLabel(day)}</h2>
				<ul>
					{#each items as entry (entry.id)}
						<EntryCard {entry} />
					{/each}
				</ul>
			</li>
		{/each}
	</ol>
{/if}
