import { openDB, type IDBPDatabase } from 'idb';

// Persists the PRF-derived AES key as a NON-EXTRACTABLE CryptoKey. IndexedDB
// stores the key handle, not the raw bytes — they can never be read back out
// (deriveKey sets extractable=false), so this is safe to keep at rest. Without
// this, the key would be memory-only and every app reload would trigger a
// passkey ceremony to re-derive it (perceived as "sign in again").

const DB = 'present-keys';
const STORE = 'keys';
const ID = 'sync-aes';

let dbPromise: Promise<IDBPDatabase> | null = null;
function getDB() {
	if (!dbPromise) {
		dbPromise = openDB(DB, 1, {
			upgrade(db) {
				db.createObjectStore(STORE);
			}
		});
	}
	return dbPromise;
}

export async function saveAesKey(key: CryptoKey): Promise<void> {
	const db = await getDB();
	await db.put(STORE, key, ID);
}

export async function loadAesKey(): Promise<CryptoKey | null> {
	const db = await getDB();
	return (await db.get(STORE, ID)) ?? null;
}

export async function clearAesKey(): Promise<void> {
	const db = await getDB();
	await db.delete(STORE, ID);
}
