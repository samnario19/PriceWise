<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { loginWithGoogle, homePathForUser } from '$lib/state/auth.svelte';

	interface Props {
		text?: string;
		onError?: (error: string) => void;
	}

	let { text = 'Continue with Google', onError }: Props = $props();

	let loading = $state(false);
	let showInfoModal = $state(false);
	let googleScriptLoaded = $state(false);

	const googleClientId = typeof import.meta.env?.VITE_GOOGLE_CLIENT_ID === 'string'
		? import.meta.env.VITE_GOOGLE_CLIENT_ID.trim()
		: '';

	onMount(() => {
		if (googleClientId && typeof window !== 'undefined') {
			if (!(window as any).google?.accounts?.id) {
				const script = document.createElement('script');
				script.src = 'https://accounts.google.com/gsi/client';
				script.async = true;
				script.defer = true;
				script.onload = () => {
					googleScriptLoaded = true;
					initGoogleGIS();
				};
				document.head.appendChild(script);
			} else {
				googleScriptLoaded = true;
				initGoogleGIS();
			}
		}
	});

	function initGoogleGIS() {
		if (typeof window === 'undefined') return;
		const google = (window as any).google;
		if (!google?.accounts?.id || !googleClientId) return;

		google.accounts.id.initialize({
			client_id: googleClientId,
			callback: async (response: { credential: string }) => {
				loading = true;
				try {
					await loginWithGoogle({ credential: response.credential });
					await goto(homePathForUser());
				} catch (e) {
					const msg = e instanceof Error ? e.message : 'Google authentication failed';
					onError?.(msg);
				} finally {
					loading = false;
				}
			}
		});
	}

	async function handleClick() {
		if (loading) return;

		if (googleClientId && (window as any).google?.accounts?.id) {
			loading = true;
			try {
				(window as any).google.accounts.id.prompt((notification: any) => {
					if (notification.isNotDisplayed() || notification.isSkippedMomentum()) {
						loading = false;
						showInfoModal = true;
					}
				});
			} catch (e) {
				loading = false;
				showInfoModal = true;
			}
		} else {
			// No Google Client ID configured: explain requirement to user
			showInfoModal = true;
		}
	}
</script>

<button
	type="button"
	onclick={handleClick}
	disabled={loading}
	class="group relative flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:border-zinc-300 hover:shadow active:scale-[0.99] disabled:opacity-60"
>
	{#if loading}
		<div class="h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent"></div>
		<span>Verifying with Google...</span>
	{:else}
		<!-- Google Multi-Color SVG Icon -->
		<svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
			<path
				fill="#4285F4"
				d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
			/>
			<path
				fill="#34A853"
				d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
			/>
			<path
				fill="#FBBC05"
				d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
			/>
			<path
				fill="#EA4335"
				d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
			/>
		</svg>
		<span>{text}</span>
	{/if}
</button>

<!-- Google Client ID Setup Notice Modal -->
{#if showInfoModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
		<div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl transition-all">
			<div class="flex items-center justify-between pb-3 border-b border-zinc-100">
				<div class="flex items-center gap-2.5">
					<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
						<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
							<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h2v2h-2v-2zm0-10h2v8h-2V7z"/>
						</svg>
					</div>
					<div>
						<h3 class="text-base font-bold text-zinc-900">Google OAuth Verification</h3>
						<p class="text-xs text-zinc-500">Secure Gmail Authentication</p>
					</div>
				</div>
				<button
					type="button"
					aria-label="Close"
					onclick={() => (showInfoModal = false)}
					class="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
				>
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="mt-4 space-y-3">
				<p class="text-sm text-zinc-600 leading-relaxed">
					To securely verify your real Gmail account with Google's password & 2FA servers, Google OAuth requires a registered Client ID.
				</p>

				<div class="rounded-xl bg-amber-50/80 p-3.5 text-xs text-amber-900 leading-relaxed border border-amber-200/80">
					<p class="font-bold text-amber-950 mb-1">How to enable 1-Click Google Sign-In:</p>
					Add your Google OAuth Client ID to your project's <code class="bg-amber-100 px-1 py-0.5 rounded font-mono text-amber-900">.env</code>:
					<div class="mt-1.5 rounded bg-amber-100/70 p-2 font-mono text-[11px] text-amber-950">
						VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
					</div>
				</div>

				<div class="rounded-xl bg-zinc-50 p-3.5 text-xs text-zinc-600 border border-zinc-200">
					<p class="font-bold text-zinc-800 mb-1">Standard Login:</p>
					You can always log in securely with your Gmail account using your password in the login form below.
				</div>
			</div>

			<div class="mt-6 flex justify-end gap-2">
				<button
					type="button"
					onclick={() => (showInfoModal = false)}
					class="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-emerald-200 hover:bg-emerald-700"
				>
					Use Email & Password
				</button>
			</div>
		</div>
	</div>
{/if}
