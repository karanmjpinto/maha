const STORE_KEY = "emilie_auth";

interface StoredAuth {
    token: string;
    userId: string;
    email: string;
}

export function getStoredAuth(): StoredAuth | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = localStorage.getItem(STORE_KEY);
        return raw ? (JSON.parse(raw) as StoredAuth) : null;
    } catch {
        return null;
    }
}

export function setStoredAuth(auth: StoredAuth): void {
    localStorage.setItem(STORE_KEY, JSON.stringify(auth));
}

export function clearStoredAuth(): void {
    localStorage.removeItem(STORE_KEY);
}

export function getToken(): string | null {
    return getStoredAuth()?.token ?? null;
}
