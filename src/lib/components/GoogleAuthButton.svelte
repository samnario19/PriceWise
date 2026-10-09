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
	let showModal = $state(false);
	let fallbackEmail = $state('');
	let fallbackError = $state('');
	let googleScriptLoaded = $state(false);

	const googleClientId = typeof import.meta.env?.VITE_GOOGLE_CLIENT_ID === 'string'
		? import.meta.env.VITE_GOOGLE_CLIENT_ID.trim()
		: '';

	onMount(() => {
		// Load Google Identity Services if client ID is set
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
					const msg = e instanceof Error ? e.message : 'Google sign-in failed';
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
			// Trigger Google Identity Services prompt
			loading = true;
			try {
				(window as any).google.accounts.id.prompt((notification: any) => {
					if (notification.isNotDisplayed() || notification.isSkippedMomentum()) {
						// Fallback to manual entry modal if prompt is suppressed or blocked
						loading = false;
						showModal = true;
					}
				});
			} catch (e) {
				loading = false;
				showModal = true;
			}
		} else {
			// No Google Client ID configured yet — open seamless Gmail modal
			showModal = true;
		}
	}

	async function handleFallbackSubmit(e: Event) {
		e.preventDefault();
		fallbackError = '';
		const trimmed = fallbackEmail.trim();

		if (!trimmed) {
			fallbackError = 'Please enter your Gmail address';
			return;
		}

		if (!trimmed.toLowerCase().endsWith('@gmail.com')) {
			fallbackError = 'Must be a valid @gmail.com address';
			return;
		}

		loading = true;
		try {
			await loginWithGoogle({ email: trimmed });
			showModal = false;
			await goto(homePathForUser());
		} catch (e) {
			fallbackError = e instanceof Error ? e.message : 'Google sign-in failed';
			onError?.(fallbackError);
		} finally {
			loading = false;
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
		<span>Authenticating with Google...</span>
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

<!-- Gmail Direct / Dev Modal -->
{#if showModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fade-in">
		<div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl transition-all">
			<div class="flex items-center justify-between pb-3 border-b border-zinc-100">
				<div class="flex items-center gap-2.5">
					<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-600">
						<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
							<path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
						</svg>
					</div>
					<div>
						<h3 class="text-base font-bold text-zinc-900">Sign in with Gmail</h3>
						<p class="text-xs text-zinc-500">Fast sign-in with your Google account</p>
					</div>
				</div>
				<button
					type="button"
					aria-label="Close"
					onclick={() => (showModal = false)}
					class="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
				>
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<form onsubmit={handleFallbackSubmit} class="mt-5 space-y-4">
				<div>
					<label for="gmail-input" class="block text-xs font-semibold text-zinc-700">Gmail Address</label>
					<div class="mt-1.5 relative">
						<input
							type="email"
							id="gmail-input"
							bind:value={fallbackEmail}
							placeholder="example@gmail.com"
							required
							class="block w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-900 shadow-sm focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
						/>
					</div>
					{#if fallbackError}
						<p class="mt-1.5 text-xs text-red-500">{fallbackError}</p>
					{/if}
				</div>

				<div class="rounded-lg bg-emerald-50/60 p-3 text-xs text-emerald-800 leading-relaxed border border-emerald-100/80">
					<p class="font-semibold text-emerald-900">Seamless Account Access</p>
					If you have an existing account with this Gmail, you'll be signed in. If not, a new account will be created automatically.
				</div>

				{#if !googleClientId}
					<div class="rounded-lg bg-zinc-50 p-3 text-[11px] text-zinc-500 leading-normal border border-zinc-200">
						💡 <strong>Note for Admin/Dev:</strong> To activate Google's one-click popup dialog, set <code class="text-zinc-700 bg-zinc-200/70 px-1 py-0.5 rounded">VITE_GOOGLE_CLIENT_ID</code> in your <code class="text-zinc-700">.env</code>.
					</div>
				{/if}

				<div class="flex items-center justify-end gap-2 pt-2">
					<button
						type="button"
						onclick={() => (showModal = false)}
						class="rounded-xl px-4 py-2.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-100"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={loading}
						class="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-60"
					>
						{#if loading}
							<div class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
						{/if}
						Continue
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
