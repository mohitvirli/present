<script lang="ts">
	import { tick } from 'svelte';
	import { gIn } from '$lib/transitions';
	import type { KnownPlace } from '$lib/db';
	import { formatCoords, hasCoords, mapsUrl, toPlace, type Place, type PlaceHit } from '$lib/place';
	import {
		currentPosition,
		placeCoords,
		resolvePlace,
		searchPlaces,
		type Coords,
		type Provider
	} from '$lib/location';

	let {
		place = $bindable(),
		known = [],
		readonly = false,
		locating = false,
		onremove
	}: {
		place: Place | undefined;
		known?: KnownPlace[];
		readonly?: boolean;
		locating?: boolean; // silent capture in flight — the field says so
		onremove?: () => void;
	} = $props();

	type Option =
		| { kind: 'here' }
		| { kind: 'known'; p: KnownPlace }
		| { kind: 'hit'; h: PlaceHit }
		| { kind: 'pin'; name: string }
		| { kind: 'remove' };

	let open = $state(false); // the search picker is showing
	let draft = $state('');
	let active = $state(-1);
	let busy = $state(false); // resolving a pick (position / coordinates)
	let note = $state(''); // one-line failure, e.g. permission denied
	let hits = $state<PlaceHit[]>([]);
	let provider = $state<Provider | null>(null);
	let renaming = $state(false);
	let renameDraft = $state('');
	let inputEl: HTMLInputElement | undefined = $state();
	let renameEl: HTMLInputElement | undefined = $state();

	// One Google autocomplete session per search: every keystroke plus the final
	// pick bill as a single session, so a fresh token after each pick.
	let session = crypto.randomUUID();
	// Biases suggestions toward where you are, but only if the browser already
	// allows it — opening the picker must never pop a permission dialog.
	let near: Coords | null = null;

	const options = $derived.by<Option[]>(() => {
		if (!open) return [];
		const q = draft.trim().toLowerCase();
		const mine = known
			.filter((p) => p.name.toLowerCase() !== place?.name.toLowerCase())
			.filter((p) => !q || p.name.toLowerCase().includes(q))
			.slice(0, q ? 3 : 4);
		const mineNames = new Set(mine.map((p) => p.name.toLowerCase()));
		const remote = q ? hits.filter((h) => !mineNames.has(h.name.toLowerCase())) : [];
		const exact = mine.some((p) => p.name.toLowerCase() === q);
		return [
			{ kind: 'here' },
			...mine.map((p) => ({ kind: 'known', p }) as const),
			...remote.map((h) => ({ kind: 'hit', h }) as const),
			...(q && !exact ? [{ kind: 'pin', name: draft.trim() } as const] : []),
			...(place && !q ? [{ kind: 'remove' } as const] : [])
		];
	});

	// debounced remote suggestions
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let searchSeq = 0;
	$effect(() => {
		const q = draft.trim();
		clearTimeout(searchTimer);
		if (q.length < 2) {
			hits = [];
			return;
		}
		const seq = ++searchSeq;
		searchTimer = setTimeout(async () => {
			const res = await searchPlaces(q, session, near);
			if (seq !== searchSeq) return; // a newer keystroke already asked
			hits = res?.hits ?? [];
			provider = res?.provider ?? provider;
		}, 250);
	});

	$effect(() => {
		if (active >= options.length) active = -1;
	});

	async function openPicker() {
		if (readonly || renaming) return;
		open = true;
		note = '';
		await tick();
		inputEl?.focus();
		near ??= await currentPosition({ prompt: false });
	}

	function closePicker() {
		if (busy) return; // a pick is still resolving — it closes itself
		open = false;
		draft = '';
		hits = [];
		active = -1;
	}

	function set(next: Place) {
		place = next;
		session = crypto.randomUUID();
		busy = false;
		closePicker();
	}

	async function pick(o: Option) {
		if (busy) return;
		if (o.kind === 'remove') {
			place = undefined;
			closePicker();
			onremove?.();
			return;
		}
		if (o.kind === 'known') {
			set(toPlace(o.p, 'manual'));
			return;
		}
		busy = true;
		try {
			if (o.kind === 'here') {
				const at = await currentPosition({ prompt: true });
				if (!at) {
					note = 'Location is off for this site.';
					busy = false;
					closePicker();
					return;
				}
				set(toPlace(await resolvePlace(at, known), 'manual'));
			} else if (o.kind === 'hit') {
				const h = o.h;
				if (!hasCoords(h) && h.placeId) {
					const at = await placeCoords(h.placeId, session);
					set(toPlace({ ...h, ...(at ?? {}), city: at?.city ?? h.city }, 'manual'));
				} else set(toPlace(h, 'manual'));
			} else {
				// your own name for where you are — pinned here if the browser allows
				const at = await currentPosition({ prompt: true });
				set(toPlace({ name: o.name, ...(at ?? {}) }, 'manual'));
			}
		} finally {
			busy = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (options.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			e.preventDefault();
			const dir = e.key === 'ArrowDown' ? 1 : -1;
			active = (active + dir + options.length) % options.length;
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			if (active >= 0 && options[active]) void pick(options[active]);
			else if (draft.trim()) {
				// Enter on typed text takes the best match, else pins the text itself
				const first = options.find((o) => o.kind !== 'here');
				if (first) void pick(first);
			}
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			if (active >= 0) active = -1;
			else closePicker();
		}
	}

	// Renaming keeps the coordinates, which is what lets "Home" be recognised
	// the next time you write from there.
	async function startRename() {
		if (readonly || !place) return;
		renameDraft = place.name;
		renaming = true;
		await tick();
		renameEl?.focus();
		renameEl?.select();
	}

	function commitRename() {
		if (!renaming || !place) return;
		const name = renameDraft.trim();
		if (name && name !== place.name) place = { ...place, name, source: 'manual' };
		renaming = false;
	}

	function optionLabel(o: Option): string {
		if (o.kind === 'here') return 'Current location';
		if (o.kind === 'known') return o.p.name;
		if (o.kind === 'hit') return o.h.name;
		if (o.kind === 'pin') return `Pin “${o.name}” here`;
		return 'Remove place';
	}

	function optionSub(o: Option): string | undefined {
		if (o.kind === 'hit') return o.h.area ?? o.h.city;
		if (o.kind === 'known') return o.p.city;
	}

	const coords = $derived(place && hasCoords(place) ? formatCoords(place.lat, place.lon) : '');
	const href = $derived(place ? mapsUrl(place) : null);
	const showAttribution = $derived(open && hits.length > 0 && !!draft.trim());
</script>

{#snippet pinIcon(size = 13)}
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2.2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
		<circle cx="12" cy="9.5" r="2.4" />
	</svg>
{/snippet}

<div class="loc-field" class:readonly class:open>
	{#if open}
		<div class="loc-picker">
			<input
				bind:this={inputEl}
				class="loc-input"
				bind:value={draft}
				placeholder={place ? `Change from ${place.name}` : 'Search a place'}
				autocomplete="off"
				spellcheck="false"
				role="combobox"
				aria-expanded={options.length > 0}
				aria-controls="loc-options"
				aria-autocomplete="list"
				onkeydown={onKeydown}
				onblur={closePicker}
			/>
			{#if options.length}
				<ul id="loc-options" class="loc-options" role="listbox">
					{#each options as o, i (o.kind === 'known' ? `k:${o.p.name}` : o.kind === 'hit' ? `h:${o.h.placeId ?? o.h.name}` : o.kind)}
						<li style="--i: {i}">
							<button
								type="button"
								role="option"
								aria-selected={i === active}
								class="loc-option"
								class:active={i === active}
								class:here={o.kind === 'here'}
								class:remove={o.kind === 'remove'}
								disabled={busy}
								onmousedown={(e) => {
									e.preventDefault();
									void pick(o);
								}}
							>
								<span class="opt-icon" aria-hidden="true">
									{#if o.kind === 'here'}
										<svg
											width="13"
											height="13"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.2"
											stroke-linecap="round"
											class:spin={busy}
											><circle cx="12" cy="12" r="3.2" /><path
												d="M12 2v3M12 19v3M2 12h3M19 12h3"
											/><circle cx="12" cy="12" r="7.5" /></svg
										>
									{:else if o.kind === 'known'}
										<svg
											width="13"
											height="13"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.2"
											stroke-linecap="round"
											stroke-linejoin="round"
											><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path
												d="M12 7v5l3 2"
											/></svg
										>
									{:else if o.kind === 'hit'}
										{@render pinIcon()}
									{:else if o.kind === 'pin'}
										<svg
											width="13"
											height="13"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.4"
											stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg
										>
									{:else}
										<svg
											width="13"
											height="13"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.4"
											stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg
										>
									{/if}
								</span>
								<span class="opt-text">
									<span class="opt-name">{optionLabel(o)}</span>
									{#if optionSub(o)}<span class="opt-area">{optionSub(o)}</span>{/if}
								</span>
								{#if o.kind === 'known'}<span class="opt-count">{o.p.count}</span>{/if}
							</button>
						</li>
					{/each}
					{#if showAttribution}
						<li class="opt-attrib" aria-hidden="true">
							{provider === 'google' ? 'Powered by Google' : '© OpenStreetMap contributors'}
						</li>
					{/if}
				</ul>
			{/if}
		</div>
	{:else if place}
		<!-- [pin] Name, City · lat, lon — the name renames, everything else re-picks -->
		<!-- name + city never split across lines; only the coordinates wrap -->
		<div class="loc-line" in:gIn={{ y: -3, duration: 0.36 }}>
			{#if readonly}
				<span class="loc-main">
					<span class="loc-icon">{@render pinIcon()}</span>
					{#if href}
						<!-- external Google Maps link, not an app route -->
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							class="loc-name"
							{href}
							target="_blank"
							rel="noopener noreferrer"
							title="Open in Google Maps">{place.name}</a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{:else}
						<span class="loc-name">{place.name}</span>
					{/if}
					{#if place.city}<span class="loc-city">, {place.city}</span>{/if}
				</span>
				{#if coords}<span class="loc-coords">{coords}</span>{/if}
			{:else}
				<span class="loc-main">
					<button
						type="button"
						class="loc-icon loc-change"
						aria-label="Change place"
						onclick={openPicker}>{@render pinIcon()}</button
					>
					{#if renaming}
						<input
							bind:this={renameEl}
							class="loc-name loc-rename"
							bind:value={renameDraft}
							size={Math.max(3, renameDraft.length)}
							aria-label="Rename place"
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									commitRename();
								} else if (e.key === 'Escape') renaming = false;
							}}
							onblur={commitRename}
						/>
					{:else}
						<button type="button" class="loc-name" title="Rename" onclick={startRename}
							>{place.name}</button
						>
					{/if}
					{#if place.city}
						<button
							type="button"
							class="loc-city loc-change"
							title="Change place"
							onclick={openPicker}>, {place.city}</button
						>
					{/if}
				</span>
				{#if coords}
					<button
						type="button"
						class="loc-coords loc-change"
						title="Change place"
						onclick={openPicker}>{coords}</button
					>
				{/if}
			{/if}
		</div>
	{:else if !readonly}
		<button type="button" class="loc-add" class:locating onclick={openPicker}>
			{locating ? 'Locating…' : 'Add a place'}
		</button>
		{#if note}<span class="loc-note">{note}</span>{/if}
	{/if}
</div>

<style>
	.loc-field {
		position: relative;
		min-height: 1.6rem;
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	/* sit above the editor that follows, so the dropdown can overhang it */
	.loc-field.open {
		z-index: 30;
	}

	/* ---------- empty: reads like the other fields' placeholders ---------- */
	.loc-add {
		padding: 0.2rem 0;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		opacity: 0.6;
		font-family: var(--font-sans);
		font-size: 0.95rem;
		font-weight: 500;
		letter-spacing: -0.003em;
		cursor: text;
		transition: opacity 0.15s ease;
	}

	.loc-add:hover {
		opacity: 0.85;
	}

	.loc-add.locating {
		animation: loc-breathe 1.4s ease-in-out infinite;
	}

	@keyframes loc-breathe {
		50% {
			opacity: 0.3;
		}
	}

	.loc-note {
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}

	/* ---------- set: one quiet line ---------- */
	.loc-line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 0.5rem;
		row-gap: 0.15rem;
		min-width: 0;
		font-size: 0.92rem;
	}

	.loc-line button {
		padding: 0;
		border: none;
		background: transparent;
		font: inherit;
		color: inherit;
		text-align: left;
	}

	.loc-icon {
		display: inline-flex;
		align-self: center;
		margin-right: 0.4rem;
		color: var(--color-accent);
	}

	.loc-name {
		max-width: 16rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
		color: var(--color-text);
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-decoration-color: color-mix(in oklab, var(--color-text-muted) 45%, transparent);
		text-underline-offset: 3px;
		transition: text-decoration-color 0.15s ease;
	}

	button.loc-name {
		cursor: text;
	}

	.loc-name:hover {
		text-decoration-color: var(--color-accent);
	}

	.loc-rename {
		field-sizing: content; /* hug the text so the comma stays put */
		min-width: 3ch;
		padding: 0;
		border: none;
		outline: none;
		background: transparent;
		font: inherit;
		font-weight: 600;
		text-decoration-color: var(--color-accent);
	}

	.loc-main {
		display: inline-flex;
		align-items: baseline;
		min-width: 0;
		max-width: 100%;
		white-space: nowrap;
	}

	/* the city glues to the name with its comma */
	.loc-city {
		color: var(--color-text-muted);
	}

	.loc-coords {
		color: var(--color-text-muted);
	}

	.loc-change {
		cursor: pointer;
	}

	.loc-line .loc-change:hover {
		color: var(--color-text);
	}

	/* .loc-line prefix: outranks the button reset above */
	.loc-line .loc-coords {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.72rem;
		letter-spacing: -0.01em;
		opacity: 0.85;
	}

	.loc-line .loc-coords::before {
		content: '·';
		margin-right: 0.5rem;
		font-family: var(--font-sans);
		opacity: 0.7;
	}

	/* on a phone the coordinates drop to their own line — no dangling dot */
	@media (max-width: 480px) {
		.loc-line .loc-coords::before {
			content: none;
		}
		.loc-line .loc-coords {
			padding-left: calc(13px + 0.4rem); /* under the name, past the pin */
		}
	}

	/* ---------- picker ---------- */
	/* a CSS entrance, not gIn: gIn starts at visibility:hidden, and a hidden
	   input can't take the focus openPicker hands it */
	.loc-picker {
		position: relative;
		flex: 1;
		animation: loc-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) backwards;
	}

	@keyframes loc-in {
		from {
			opacity: 0;
			transform: translateY(-3px);
		}
	}

	.loc-input {
		width: 100%;
		background: transparent;
		border: none;
		outline: none;
		color: var(--color-text);
		font-family: var(--font-sans);
		font-size: 0.95rem;
		font-weight: 500;
		letter-spacing: -0.003em;
		padding: 0.2rem 0;
	}

	.loc-input::placeholder {
		color: var(--color-text-muted);
		opacity: 0.6;
	}

	.loc-options {
		position: absolute;
		z-index: 20;
		top: calc(100% + 0.35rem);
		left: 0;
		width: min(21rem, 100%);
		min-width: 14rem;
		list-style: none;
		margin: 0;
		padding: 0.3rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.7rem;
		box-shadow: var(--shadow-md);
		transform-origin: top left;
		animation: loc-drop 0.26s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	@keyframes loc-drop {
		from {
			opacity: 0;
			transform: translateY(-4px) scale(0.98);
		}
	}

	/* options settle in one after another */
	.loc-options li {
		animation: loc-opt 0.3s cubic-bezier(0.22, 1, 0.36, 1) both;
		animation-delay: calc(var(--i, 0) * 28ms + 40ms);
	}

	@keyframes loc-opt {
		from {
			opacity: 0;
			transform: translateY(-3px);
		}
	}

	.loc-option {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		padding: 0.42rem 0.5rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--color-text);
		font-family: var(--font-sans);
		font-size: 0.85rem;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
	}

	.loc-option:hover,
	.loc-option.active {
		background: var(--color-surface-2);
	}

	.loc-option:disabled {
		cursor: progress;
	}

	.loc-option.here,
	.here .opt-icon {
		color: var(--color-accent);
	}

	.loc-option.remove {
		color: var(--color-text-muted);
	}

	.opt-icon {
		display: inline-flex;
		flex: none;
		width: 1rem;
		justify-content: center;
		color: var(--color-text-muted);
	}

	.spin {
		animation: loc-spin 1s linear infinite;
	}

	@keyframes loc-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.opt-text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		flex: 1;
		min-width: 0;
	}

	.opt-name,
	.opt-area {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.opt-area {
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}

	.opt-count {
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	.opt-attrib {
		padding: 0.35rem 0.5rem 0.15rem;
		font-size: 0.65rem;
		text-align: right;
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	@media (prefers-reduced-motion: reduce) {
		.loc-add.locating,
		.loc-picker,
		.loc-options,
		.loc-options li,
		.spin {
			animation: none;
		}
	}
</style>
