"use client";

import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    ReactNode,
    useCallback,
} from "react";
import { getToken } from "@/lib/tokenStore";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const MONTHLY_CREDIT_LIMIT = 999999;

interface UserProfile {
    displayName: string | null;
    organisation: string | null;
    messageCreditsUsed: number;
    creditsResetDate: string;
    creditsRemaining: number;
    tier: string;
    tabularModel: string;
    claudeApiKey: string | null;
    geminiApiKey: string | null;
}

interface UserProfileContextType {
    profile: UserProfile | null;
    loading: boolean;
    updateDisplayName: (name: string) => Promise<boolean>;
    updateOrganisation: (organisation: string) => Promise<boolean>;
    updateModelPreference: (
        field: "tabularModel",
        value: string,
    ) => Promise<boolean>;
    updateApiKey: (
        provider: "claude" | "gemini",
        value: string | null,
    ) => Promise<boolean>;
    reloadProfile: () => Promise<void>;
    incrementMessageCredits: () => Promise<boolean>;
}

const UserProfileContext = createContext<UserProfileContextType | undefined>(
    undefined,
);

function authHeaders(): Record<string, string> {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function patchProfile(fields: Record<string, unknown>): Promise<boolean> {
    try {
        const res = await fetch(`${API_BASE}/user/profile`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify(fields),
        });
        return res.ok;
    } catch {
        return false;
    }
}

function fallbackProfile(): UserProfile {
    const futureReset = new Date();
    futureReset.setDate(futureReset.getDate() + 30);
    return {
        displayName: null,
        organisation: null,
        messageCreditsUsed: 0,
        creditsResetDate: futureReset.toISOString(),
        creditsRemaining: MONTHLY_CREDIT_LIMIT,
        tier: "Free",
        tabularModel: "gemini-3-flash-preview",
        claudeApiKey: null,
        geminiApiKey: null,
    };
}

export function UserProfileProvider({ children }: { children: ReactNode }) {
    const { user, isAuthenticated } = useAuth();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    const loadProfile = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/user/profile`, {
                headers: authHeaders(),
            });

            if (!res.ok) {
                setProfile(fallbackProfile());
                return;
            }

            const data = await res.json() as {
                display_name: string | null;
                organisation: string | null;
                message_credits_used: number;
                credits_reset_date: string | null;
                tier: string | null;
                tabular_model: string | null;
                claude_api_key: string | null;
                gemini_api_key: string | null;
            };

            let creditsUsed = data.message_credits_used ?? 0;
            let resetDate = data.credits_reset_date;
            let creditsRemaining = MONTHLY_CREDIT_LIMIT - creditsUsed;

            if (resetDate && new Date() > new Date(resetDate)) {
                const newReset = new Date();
                newReset.setDate(newReset.getDate() + 30);
                resetDate = newReset.toISOString();
                creditsUsed = 0;
                creditsRemaining = MONTHLY_CREDIT_LIMIT;
                patchProfile({ message_credits_used: 0, credits_reset_date: resetDate }).catch(() => {});
            }

            if (!resetDate) {
                const newReset = new Date();
                newReset.setDate(newReset.getDate() + 30);
                resetDate = newReset.toISOString();
            }

            setProfile({
                displayName: data.display_name,
                organisation: data.organisation ?? null,
                messageCreditsUsed: creditsUsed,
                creditsResetDate: resetDate,
                creditsRemaining,
                tier: data.tier ?? "Free",
                tabularModel: data.tabular_model ?? "gemini-3-flash-preview",
                claudeApiKey: data.claude_api_key ?? null,
                geminiApiKey: data.gemini_api_key ?? null,
            });
        } catch {
            setProfile(fallbackProfile());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isAuthenticated && user) {
            setLoading(true);
            loadProfile();
        } else {
            setProfile(null);
            setLoading(false);
        }
    }, [isAuthenticated, user, loadProfile]);

    const updateDisplayName = useCallback(
        async (displayName: string): Promise<boolean> => {
            const ok = await patchProfile({ display_name: displayName });
            if (ok) setProfile((prev) => (prev ? { ...prev, displayName } : null));
            return ok;
        },
        [],
    );

    const updateOrganisation = useCallback(
        async (organisation: string): Promise<boolean> => {
            const ok = await patchProfile({ organisation });
            if (ok) setProfile((prev) => (prev ? { ...prev, organisation } : null));
            return ok;
        },
        [],
    );

    const updateModelPreference = useCallback(
        async (field: "tabularModel", value: string): Promise<boolean> => {
            const dbField = field === "tabularModel" ? "tabular_model" : "";
            if (!dbField) return false;
            const ok = await patchProfile({ [dbField]: value });
            if (ok) setProfile((prev) => (prev ? { ...prev, [field]: value } : null));
            return ok;
        },
        [],
    );

    const updateApiKey = useCallback(
        async (provider: "claude" | "gemini", value: string | null): Promise<boolean> => {
            const dbField = provider === "claude" ? "claude_api_key" : "gemini_api_key";
            const stateField = provider === "claude" ? "claudeApiKey" : "geminiApiKey";
            const normalized = value?.trim() || null;
            const ok = await patchProfile({ [dbField]: normalized });
            if (ok) setProfile((prev) => (prev ? { ...prev, [stateField]: normalized } : null));
            return ok;
        },
        [],
    );

    const reloadProfile = useCallback(async () => {
        if (user) await loadProfile();
    }, [user, loadProfile]);

    const incrementMessageCredits = useCallback(async (): Promise<boolean> => {
        if (!profile) return false;
        if (profile.creditsRemaining <= 0) return false;

        const newCreditsUsed = profile.messageCreditsUsed + 1;
        const ok = await patchProfile({ message_credits_used: newCreditsUsed });
        if (ok) {
            setProfile((prev) =>
                prev
                    ? {
                          ...prev,
                          messageCreditsUsed: newCreditsUsed,
                          creditsRemaining: MONTHLY_CREDIT_LIMIT - newCreditsUsed,
                      }
                    : null,
            );
        }
        return ok;
    }, [profile]);

    return (
        <UserProfileContext.Provider
            value={{
                profile,
                loading,
                updateDisplayName,
                updateOrganisation,
                updateModelPreference,
                updateApiKey,
                reloadProfile,
                incrementMessageCredits,
            }}
        >
            {children}
        </UserProfileContext.Provider>
    );
}

export function useUserProfile() {
    const context = useContext(UserProfileContext);
    if (context === undefined) {
        throw new Error(
            "useUserProfile must be used within a UserProfileProvider",
        );
    }
    return context;
}
