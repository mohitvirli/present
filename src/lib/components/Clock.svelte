<script lang="ts">
	import { onMount } from 'svelte';

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
	let hh = $derived(String(d.getHours()).padStart(2, '0'));
	let mm = $derived(String(d.getMinutes()).padStart(2, '0'));
	let date = $derived(
		d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
	);
</script>

<span
	class="clock"
	class:static={at != null}
	aria-label={at != null ? 'entry time' : 'current time'}
	role="timer"
>
	<span class="time">
		<span class="digits">{hh}</span><span class="colon">:</span><span class="digits">{mm}</span>
	</span>
	<span class="date">{date}</span>
</span>
