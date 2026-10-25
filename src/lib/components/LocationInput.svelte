<script lang="ts">
	import { gIn } from '$lib/transitions';
	import type { KnownPlace } from '$lib/db';
	import { formatCoords, hasCoords, mapsUrl, type Place, type PlaceHit } from '$lib/place';
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
		| { kind: 'pin'; name: string };

	let draft = $state('');
	let focused = $state(false);
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
	// allows it — focusing a field must never pop a permission dialog.
	let near: Coords | null = null;

	const options = $derived.by<Option[]>(() => {
		if (!focused) return [];
		const q = draft.trim().toLowerCase();
		const mine = known.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, q ? 3 : 4);
		const mineNames = new Set(mine.map((p) => p.name.toLowerCase()));
		const remote = q ? hits.filter((h) => !mineNames.has(h.name.toLowerCase())) : [];
		const exact = mine.some((p) => p.name.toLowerCase() === q);
		return [
			{ kind: 'here' },
			...mine.map((p) => ({ kind: 'known', p }) as const),
			...remote.map((h) => ({ kind: 'hit', h }) as const),
			...(q && !exact ? [{ kind: 'pin', name: draft.trim() } as const] : [])
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

	function set(next: Omit<Place, 'source'>) {
		place = { ...next, source: 'manual' };
		draft = '';
		hits = [];
		active = -1;
		note = '';
		session = crypto.randomUUID();
	}

	async function pick(o: Option) {
		if (busy) return;
		if (o.kind === 'known') {
			const { name, area, lat, lon, placeId } = o.p;
			set({ name, area, lat, lon, placeId });
			return;
		}
		busy = true;
		try {
			if (o.kind === 'here') {
				const at = await currentPosition({ prompt: true });
				if (!at) {
					note = 'Location is off for this site.';
					return;
				}
				set(await resolvePlace(at, known));
			} else if (o.kind === 'hit') {
				const h = o.h;
				if (!hasCoords(h) && h.placeId) {
					const at = await placeCoords(h.placeId, session);
					set({ ...h, ...(at ?? {}) });
				} else set(h);
			} else {
				// your own name for where you are — pinned here if the browser allows
				const at = await currentPosition({ prompt: true });
				set({ name: o.name, ...(at ?? {}) });
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
			if (active >= 0) active = -1;
			else inputEl?.blur();
		}
	}

	async function onFocus() {
		focused = true;
		near ??= await currentPosition({ prompt: false });
	}

	function remove() {
		place = undefined;
		renaming = false;
		onremove?.();
	}

	// Renaming keeps the coordinates, which is what lets "Home" be recognised
	// the next time you write from there.
	async function startRename() {
		if (readonly || !place) return;
		renameDraft = place.name;
		renaming = true;
		await Promise.resolve();
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
		return `Pin “${o.name}” here`;
	}

	const sub = $derived(
		place
			? [place.area, hasCoords(place) ? formatCoords(place.lat, place.lon) : ''].filter(Boolean)
			: []
	);
	const href = $derived(place ? mapsUrl(place) : null);
	const showAttribution = $derived(focused && hits.length > 0 && !!draft.trim());
</script>

{#snippet pinIcon(size = 12)}
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

<div class="loc-field" class:readonly>
	{#if place}
		<div class="loc-row" in:gIn={{ y: -4, duration: 0.4 }}>
			<span class="loc-chip">
				<span class="loc-pin">{@render pinIcon()}</span>
				{#if readonly}
					{#if href}
						<!-- external Google Maps link, not an app route -->
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							class="loc-name loc-link"
							{href}
							target="_blank"
							rel="noopener noreferrer"
							title="Open in Google Maps">{place.name}</a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{:else}
						<span class="loc-name">{place.name}</span>
					{/if}
				{:else if renaming}
					<input
						bind:this={renameEl}
						class="loc-rename"
						bind:value={renameDraft}
						size={Math.max(4, renameDraft.length)}
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
					<button type="button" class="loc-name loc-edit" title="Rename" onclick={startRename}
						>{place.name}</button
					>
				{/if}
				{#if !readonly}
					<button type="button" class="loc-remove" aria-label="Remove {place.name}" onclick={remove}
						>×</button
					>
				{/if}
			</span>
			{#if sub.length}
				<span class="loc-sub">
					{#each sub as s, i (i)}<span class:mono={i === sub.length - 1 && hasCoords(place)}
							>{s}</span
						>{/each}
				</span>
			{/if}
		</div>
	{:else if !readonly}
		<div class="loc-draft">
			<span class="loc-pin muted" class:pulse={locating || busy}>{@render pinIcon(13)}</span>
			<input
				bind:this={inputEl}
				class="loc-input"
				bind:value={draft}
				placeholder={locating ? 'Locating…' : 'Add place'}
				autocomplete="off"
				spellcheck="false"
				role="combobox"
				aria-expanded={options.length > 0}
				aria-controls="loc-options"
				aria-autocomplete="list"
				onkeydown={onKeydown}
				onfocus={onFocus}
				onblur={() => (focused = false)}
			/>
			{#if note && !focused}<span class="loc-note">{note}</span>{/if}
			{#if options.length}
				<ul id="loc-options" class="loc-options" role="listbox">
					{#each options as o, i (i)}
						<li>
							<button
								type="button"
								role="option"
								aria-selected={i === active}
								class="loc-option"
								class:active={i === active}
								class:here={o.kind === 'here'}
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
										{@render pinIcon(13)}
									{:else}
										<svg
											width="13"
											height="13"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.4"
											stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg
										>
									{/if}
								</span>
								<span class="opt-text">
									<span class="opt-name">{optionLabel(o)}</span>
									{#if o.kind === 'hit' && o.h.area}
										<span class="opt-area">{o.h.area}</span>
									{:else if o.kind === 'known' && o.p.area}
										<span class="opt-area">{o.p.area}</span>
									{/if}
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
	{/if}
</div>

<style>
	.loc-field {
		position: relative;
		--tag-c: var(--color-accent);
	}

	.loc-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.6rem;
	}

	/* same chip as a tag, tinted with the accent so a place reads as its own thing */
	.loc-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.8rem;
		font-weight: 550;
		line-height: 1;
		padding: 0.3rem 0.5rem 0.3rem 0.5rem;
		border-radius: 999px;
		color: var(--tag-fg);
		background: var(--tag-bg);
		box-shadow: inset 0 0 0 1px var(--tag-ring);
		--tag-bg: color-mix(in oklab, var(--tag-c) 14%, var(--color-surface));
		--tag-fg: color-mix(in oklab, var(--tag-c) 78%, var(--color-text));
		--tag-ring: color-mix(in oklab, var(--tag-c) 28%, transparent);
	}

	.loc-pin {
		display: inline-flex;
		flex: none;
	}

	.loc-pin.muted {
		color: var(--color-text-muted);
		opacity: 0.6;
	}

	.loc-pin.pulse {
		animation: loc-pulse 1.2s ease-in-out infinite;
		color: var(--color-accent);
		opacity: 1;
	}

	@keyframes loc-pulse {
		50% {
			transform: translateY(-2px);
			opacity: 0.45;
		}
	}

	.loc-name {
		max-width: 16rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.loc-edit,
	.loc-link {
		padding: 0;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		line-height: inherit;
		text-decoration: none;
		cursor: text;
	}

	.loc-link {
		cursor: pointer;
	}

	.loc-link:hover {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.loc-rename {
		min-width: 4ch;
		padding: 0;
		border: none;
		outline: none;
		background: transparent;
		color: inherit;
		font: inherit;
		line-height: inherit;
	}

	.loc-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.05rem;
		height: 1.05rem;
		margin-right: -0.15rem;
		padding: 0;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: inherit;
		font-size: 0.95rem;
		line-height: 1;
		opacity: 0.55;
		cursor: pointer;
		transition:
			opacity 0.12s ease,
			background 0.12s ease;
	}

	.loc-remove:hover {
		opacity: 1;
		background: var(--tag-ring);
	}

	.loc-sub {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		font-size: 0.72rem;
		font-weight: 500;
		color: var(--color-text-muted);
		opacity: 0.8;
	}

	.loc-sub span + span::before {
		content: '·';
		margin-right: 0.5rem;
		opacity: 0.7;
	}

	.loc-sub .mono {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.68rem;
		letter-spacing: -0.01em;
	}

	/* ---------- empty state: the input ---------- */
	.loc-draft {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.loc-input {
		flex: 1;
		min-width: 7rem;
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

	.loc-note {
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}

	/* ---------- dropdown ---------- */
	.loc-options {
		position: absolute;
		z-index: 20;
		top: calc(100% + 0.35rem);
		left: 0;
		width: min(20rem, 100%);
		min-width: 14rem;
		list-style: none;
		margin: 0;
		padding: 0.3rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.7rem;
		box-shadow: var(--shadow-md);
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

	.loc-option.here {
		color: var(--color-accent);
	}

	.opt-icon {
		display: inline-flex;
		flex: none;
		width: 1rem;
		justify-content: center;
		color: var(--color-text-muted);
	}

	.here .opt-icon {
		color: var(--color-accent);
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
		.loc-pin.pulse {
			animation: none;
		}
		.loc-remove {
			transition: none;
		}
	}
</style>
