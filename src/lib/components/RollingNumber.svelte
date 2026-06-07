<script lang="ts">
	// Odometer-style number. Each digit is a column of 0–9 clipped to one
	// digit's height; translateY rolls the column so the old digit slides up and
	// the next enters from below. Only digits that change animate.
	let { value = 0, duration = 450 }: { value?: number; duration?: number } = $props();

	const digits = $derived(String(Math.max(0, Math.floor(value))).split(''));
	const nums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
</script>

<span class="rolling" aria-hidden="true">
	{#each digits as d, i (digits.length - i)}
		<span class="rolling-digit">
			<span class="rolling-col" style="transform: translateY(-{Number(d)}em); transition-duration: {duration}ms">
				{#each nums as n (n)}
					<span class="rolling-num">{n}</span>
				{/each}
			</span>
		</span>
	{/each}
</span>

<style>
	.rolling {
		display: inline-flex;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}

	.rolling-digit {
		display: inline-block;
		height: 1em;
		overflow: hidden;
	}

	.rolling-col {
		display: flex;
		flex-direction: column;
		transition-property: transform;
		transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
		will-change: transform;
	}

	.rolling-num {
		height: 1em;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	@media (prefers-reduced-motion: reduce) {
		.rolling-col {
			transition-duration: 0ms !important;
		}
	}
</style>
