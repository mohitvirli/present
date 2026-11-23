// Phase 2 check for shared entries. Dev only: paste into the DevTools console on
// https://localhost:5173/entry (signed in to sync, shared-entries flag on).
// Creates a shared entry, edits it, wipes this device's copy, restores it from
// the server, and prints what matched. Leaves the test entry on your timeline.
(async () => {
	const store = await import('/src/lib/shared/store.ts');
	const db = await import('/src/lib/db.ts');
	const schema = window.__editor?.schema;
	if (!schema) return console.error('Open /entry first (needs window.__editor).');

	const content = {
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: [{ type: 'text', text: 'Shared test ' + new Date().toISOString() }]
			},
			{ type: 'paragraph', content: [{ type: 'tagRef', attrs: { tag: 'shared-test' } }] }
		]
	};
	const id = await store.createShared({
		content,
		meta: { title: 'Shared test', tags: ['shared-test'], createdAt: Date.now() },
		schema
	});
	const mirror1 = await db.getEntry(id);

	// edit: change the title through the doc, as the editor will
	const open = await store.openShared(id);
	store.sharedMeta(open.doc).set('title', 'Shared test (edited)');
	open.dispose();
	await new Promise((r) => setTimeout(r, 2500)); // debounce + push

	const list1 = await fetch('/api/shared').then((r) => r.json());
	const page1 = await fetch(`/api/shared/${id}/updates?after=0`).then((r) => r.json());

	// pretend to be a fresh device: drop local shared state, then sync it back
	await store.clearShared();
	const gone = !(await db.getEntry(id));
	await store.syncShared();
	const mirror2 = await db.getEntry(id);

	const text = (e) => JSON.stringify(e?.content);
	const result = {
		id,
		created: !!mirror1 && mirror1.metadata.shared?.role === 'owner',
		listed: list1.some((i) => i.id === id),
		serverHasSnapshot: !!page1.snapshot,
		serverUpdates: page1.updates.length,
		ciphertextOnly: !JSON.stringify(page1).includes('Shared test'),
		wipedLocally: gone,
		restored: !!mirror2,
		contentMatches: text(mirror1) === text(mirror2),
		titleAfterRestore: mirror2?.metadata.title,
		tags: mirror2?.metadata.tags,
		notInPrivatePush: !(await db.listDirty()).some((e) => e.id === id)
	};
	console.table(result);
	return result;
})();
