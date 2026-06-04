<script lang="ts">
	import { onMount } from 'svelte';
	import { listEntries, type Entry } from '$lib/db';
	import Timeline from '$lib/components/Timeline.svelte';

	let entries = $state<Entry[]>([]);
	let loaded = $state(false);

	onMount(async () => {
		entries = await listEntries();
		loaded = true;
	});
</script>

<div class="home">
	<Timeline {entries} {loaded} />
</div>
