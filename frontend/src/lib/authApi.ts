const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export interface AuthResult {
    token: string;
    userId: string;
    email: string;
}

export async function login(email: string, password: string): Promise<AuthResult> {
    const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { detail?: string }).detail ?? "Login failed");
    }
    return res.json() as Promise<AuthResult>;
}

export async function signup(
    email: string,
    password: string,
    opts?: { name?: string; organisation?: string },
): Promise<AuthResult> {
    const res = await fetch(`${API_BASE}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ...opts }),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { detail?: string }).detail ?? "Signup failed");
    }
    return res.json() as Promise<AuthResult>;
}
