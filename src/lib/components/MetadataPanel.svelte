<script lang="ts">
	import type { EntryMetadata, Mood } from '$lib/db';

	let { meta = $bindable() }: { meta: EntryMetadata } = $props();

	const moods: { value: Mood; label: string; glyph: string }[] = [
		{ value: 'great', label: 'Great', glyph: '◎' },
		{ value: 'good', label: 'Good', glyph: '○' },
		{ value: 'neutral', label: 'Neutral', glyph: '–' },
		{ value: 'low', label: 'Low', glyph: '◌' },
		{ value: 'bad', label: 'Bad', glyph: '●' }
	];

	let tagsInput = $state((meta.tags ?? []).join(', '));
	$effect(() => {
		meta.tags = tagsInput
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
	});
</script>

<div class="meta-panel">
	<label>
		<span>Title</span>
		<input bind:value={meta.title} placeholder="(optional)" />
	</label>

	<fieldset class="mood">
		<legend>Mood</legend>
		<div class="mood-row">
			{#each moods as m (m.value)}
				<button
					type="button"
					class:active={meta.mood === m.value}
					onclick={() => (meta.mood = meta.mood === m.value ? undefined : m.value)}
					aria-label={m.label}
					title={m.label}>{m.glyph}</button
				>
			{/each}
		</div>
	</fieldset>

	<label>
		<span>Tags</span>
		<input bind:value={tagsInput} placeholder="work, reflection, idea" />
	</label>

	<label>
		<span>Location</span>
		<input bind:value={meta.location} placeholder="(optional)" />
	</label>
</div>
