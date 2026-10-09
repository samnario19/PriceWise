<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { loginWithGoogle, homePathForUser } from '$lib/state/auth.svelte';

	interface Props {
		text?: 'signin_with' | 'signup_with' | 'continue_with';
		onError?: (error: string) => void;
	}

	let { text = 'continue_with', onError }: Props = $props();

	let buttonContainer: HTMLDivElement | null = $state(null);
	let loading = $state(false);
	let showMissingClientIdModal = $state(false);

	const googleClientId = typeof import.meta.env?.VITE_GOOGLE_CLIENT_ID === 'string'
		? import.meta.env.VITE_GOOGLE_CLIENT_ID.trim()
		: '';

	async function handleGoogleCredentialResponse(response: { credential: string }) {
		if (!response?.credential) return;
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

	function setupGoogleGIS() {
		if (typeof window === 'undefined') return;
		const google = (window as any).google;
		if (!google?.accounts?.id || !googleClientId) return;

		try {
			google.accounts.id.initialize({
				client_id: googleClientId,
				callback: handleGoogleCredentialResponse,
				auto_select: false,
				cancel_on_tap_outside: true
			});

			if (buttonContainer) {
				buttonContainer.innerHTML = '';
				google.accounts.id.renderButton(buttonContainer, {
					type: 'standard',
					theme: 'outline',
					size: 'large',
					text: text,
					shape: 'rectangular',
					logo_alignment: 'left',
					width: 384
				});
			}

			// Trigger Google One Tap floating card for logged-in Chrome users
			google.accounts.id.prompt();
		} catch (err) {
			console.warn('Google Identity Services initialization warning:', err);
		}
	}

	onMount(() => {
		if (typeof window === 'undefined') return;

		if (!googleClientId) {
			return;
		}

		if ((window as any).google?.accounts?.id) {
			setupGoogleGIS();
		} else {
			let script = document.getElementById('google-gsi-script') as HTMLScriptElement | null;
			if (!script) {
				script = document.createElement('script');
				script.id = 'google-gsi-script';
				script.src = 'https://accounts.google.com/gsi/client';
				script.async = true;
				script.defer = true;
				script.onload = () => setupGoogleGIS();
				document.head.appendChild(script);
			} else {
				script.addEventListener('load', () => setupGoogleGIS());
			}
		}
	});
</script>

{#if !googleClientId}
	<button
		type="button"
		onclick={() => (showMissingClientIdModal = true)}
		class="group relative flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 hover:border-zinc-300 active:scale-[0.99]"
	>
		<svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
			<path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
			<path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
			<path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
			<path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
		</svg>
		<span>{text === 'signup_with' ? 'Sign up with Google' : 'Sign in with Google'}</span>
	</button>
{:else}
	{#if loading}
		<div class="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-600">
			<div class="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent"></div>
			<span>Signing in with Google...</span>
		</div>
	{/if}
	<div
		bind:this={buttonContainer}
		class="w-full flex justify-center min-h-[44px] [&>div]:w-full [&_iframe]:!w-full [&_iframe]:!mx-auto"
		class:hidden={loading}
	></div>
{/if}

<!-- Setup Client ID Modal -->
{#if showMissingClientIdModal}
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
						<h3 class="text-base font-bold text-zinc-900">Chrome Gmail Account Chooser</h3>
						<p class="text-xs text-zinc-500">Google OAuth 2.0 Integration</p>
					</div>
				</div>
				<button
					type="button"
					aria-label="Close"
					onclick={() => (showMissingClientIdModal = false)}
					class="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
				>
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="mt-4 space-y-3">
				<p class="text-sm text-zinc-600 leading-relaxed">
					To display your <strong>Chrome logged-in Gmail accounts</strong> in Google's official popup list, Google requires your app's Client ID:
				</p>

				<div class="rounded-xl bg-emerald-50/70 p-3.5 text-xs text-emerald-950 border border-emerald-200/80 space-y-2">
					<p class="font-bold text-emerald-950">Quick 2-Minute Setup:</p>
					<ol class="list-decimal pl-4 space-y-1 text-emerald-900">
						<li>Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" class="underline font-semibold text-emerald-700">Google Cloud Console</a>.</li>
						<li>Create <strong>OAuth client ID</strong> &rarr; Application type: <strong>Web application</strong>.</li>
						<li>Add Authorized JavaScript origin: <code class="bg-emerald-100/90 px-1 py-0.5 rounded font-mono">http://localhost:5173</code></li>
						<li>Copy the Client ID and paste into your <code class="bg-emerald-100/90 px-1 py-0.5 rounded font-mono">.env</code>:</li>
					</ol>
					<div class="rounded bg-white/90 p-2 font-mono text-[11px] text-zinc-800 border border-emerald-200">
						VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
					</div>
				</div>

				<p class="text-xs text-zinc-500">
					Once added, clicking this button immediately displays Google's native popup showing all Gmail accounts active in your browser.
				</p>
			</div>

			<div class="mt-6 flex justify-end gap-2">
				<button
					type="button"
					onclick={() => (showMissingClientIdModal = false)}
					class="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-emerald-200 hover:bg-emerald-700"
				>
					Got it, close
				</button>
			</div>
		</div>
	</div>
{/if}
