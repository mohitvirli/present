<script lang="ts">
	import { onMount } from 'svelte';
	import RollingNumber from './RollingNumber.svelte';
	import { monthName } from '$lib/recap';

	// `at` = fixed timestamp (viewing an existing entry → show its created time,
	// static). When null, run as a live clock. `month` ('YYYY-MM') = viewing a
	// monthly recap: the month it covers replaces the time it was written.
	let { at = null, month = null }: { at?: number | null; month?: string | null } = $props();

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

{#if month}
	<span class="clock static recap-clock" aria-label="Monthly recap of {monthName(month)} {month.slice(0, 4)}">
		<span class="time">{monthName(month)} {month.slice(0, 4)}</span>
		<span class="date">Monthly recap</span>
	</span>
{:else}
<span class="clock" class:static={at != null} aria-label={at != null ? 'entry time' : 'current time'} role="timer">
	<span class="time">
		<span class="digits"><RollingNumber value={hh} pad={2} /></span><span class="colon">:</span><span
			class="digits"><RollingNumber value={mm} pad={2} /></span>
	</span>
	<span class="date">{date}</span>
</span>
{/if}
