export type BrowserStorageKind = "local" | "session";

function getStorage(kind: BrowserStorageKind): Storage | null {
	if (typeof window === "undefined") return null;

	try {
		return kind === "local" ? window.localStorage : window.sessionStorage;
	} catch {
		return null;
	}
}

export function readStoredValue(key: string, kind: BrowserStorageKind = "local"): string | null {
	const storage = getStorage(kind);
	if (!storage) return null;

	try {
		return storage.getItem(key);
	} catch {
		return null;
	}
}

export function writeStoredValue(key: string, value: string, kind: BrowserStorageKind = "local"): void {
	const storage = getStorage(kind);
	if (!storage) return;

	try {
		storage.setItem(key, value);
	} catch {
		// Browser persistence is optional and must not take down the application.
	}
}

export function removeStoredValue(key: string, kind: BrowserStorageKind = "local"): void {
	const storage = getStorage(kind);
	if (!storage) return;

	try {
		storage.removeItem(key);
	} catch {
		// Browser persistence is optional and must not take down the application.
	}
}
