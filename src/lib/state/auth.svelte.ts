import { API_BASE } from '$lib/api/apiBase';
import type { UserRole } from '$lib/types/localStore';

export type AuthUser = {
	id: number;
	email: string;
	role: UserRole;
} | null;

export const authState = $state({
	token: '',
	user: null as AuthUser
});

const TOKEN_KEY = 'pricewise_token';

export function hydrateAuthFromStorage(): void {
	if (typeof localStorage === 'undefined') return;
	authState.token = localStorage.getItem(TOKEN_KEY) ?? '';
}

export function saveToken(token: string): void {
	authState.token = token;
	if (typeof localStorage !== 'undefined') localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuth(): void {
	authState.token = '';
	authState.user = null;
	if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_KEY);
}

export async function fetchMe(): Promise<void> {
	if (!authState.token) return;
	const res = await fetch(`${API_BASE}/auth/me`, {
		headers: { Authorization: `Bearer ${authState.token}` }
	});
	if (!res.ok) {
		clearAuth();
		return;
	}
	const raw = (await res.json()) as { id: number; email: string; role?: string };
	authState.user = {
		id: raw.id,
		email: raw.email,
		role: raw.role === 'local_supplier' ? 'local_supplier' : 'cafe_owner'
	};
}

export function isAuthenticated(): boolean {
	return Boolean(authState.token && authState.user);
}

export function isCafeOwner(): boolean {
	return authState.user?.role === 'cafe_owner';
}

export function isLocalSupplier(): boolean {
	return authState.user?.role === 'local_supplier';
}

export function homePathForRole(role: UserRole): string {
	return role === 'local_supplier' ? '/supplier' : '/recipes';
}

export function homePathForUser(): string {
	if (!authState.user) return '/login';
	return homePathForRole(authState.user.role);
}

export async function loginWithGoogle(payload: { credential?: string; email?: string }): Promise<void> {
	const res = await fetch(${API_BASE}/auth/google, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: 'Google sign-in failed' }));
		throw new Error(err.detail || 'Google sign-in failed');
	}
	const data = await res.json();
	saveToken(data.access_token);
	await fetchMe();
}

