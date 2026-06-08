<script lang="ts">
	import { onMount } from 'svelte';
	import RollingNumber from './RollingNumber.svelte';

	// `at` = fixed timestamp (viewing an existing entry → show its created time,
	// static). When null, run as a live clock.
	let { at = null }: { at?: number | null } = $props();

	let now = $state(new Date());

	onMount(() => {
		if (at != null) return; // static, no ticking
		const id = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(id);
	});

	let d = $derived(at != null ? new Date(at) : now);
	let hh = $derived(d.getHours());
	let mm = $derived(d.getMinutes());
	let date = $derived(
		d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
	);
</script>

<span class="clock" class:static={at != null} aria-label={at != null ? 'entry time' : 'current time'} role="timer">
	<span class="time">
		<span class="digits"><RollingNumber value={hh} pad={2} /></span><span class="colon">:</span><span
			class="digits"><RollingNumber value={mm} pad={2} /></span>
	</span>
	<span class="date">{date}</span>
</span>
