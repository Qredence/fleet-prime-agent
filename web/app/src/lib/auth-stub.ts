// v1: no auth — local tool on 127.0.0.1.
// All imports of @/lib/auth/use-auth funnel through here.

export type AuthUser = {
	id: string;
	email: string;
};

export function useAuth(): {
	user: AuthUser | null;
	isLoading: boolean;
	isAuthenticated: boolean;
} {
	return {
		user: null,
		isLoading: false,
		isAuthenticated: true,
	};
}

export function useOptionalUser(): AuthUser | null {
	return null;
}

export function getChatAuthBearerToken(): string | null {
	return null;
}

export function clearChatAuthBearerTokenCache(): void {}

export async function signIn(_credentials?: unknown): Promise<void> {}

export async function signOut(): Promise<void> {}
