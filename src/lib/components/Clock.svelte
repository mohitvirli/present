<script lang="ts">
	import { onMount } from 'svelte';

	let now = $state(new Date());

	onMount(() => {
		const id = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(id);
	});

	let hh = $derived(String(now.getHours()).padStart(2, '0'));
	let mm = $derived(String(now.getMinutes()).padStart(2, '0'));
	let date = $derived(
		now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
	);
</script>

<span class="clock" aria-label="current time" role="timer">
	<span class="time">
		<span class="digits">{hh}</span><span class="colon">:</span><span class="digits">{mm}</span>
	</span>
	<span class="date">{date}</span>
</span>
