<script lang="ts">
	import { goto } from '$app/navigation';
	import { API_BASE } from '$lib/api/apiBase';
	import { saveToken, fetchMe, homePathForUser } from '$lib/state/auth.svelte';
	import GoogleAuthButton from '$lib/components/GoogleAuthButton.svelte';

	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let error = $state('');
	let showAccountError = $state(false);
	let showPassword = $state(false);

	async function submit(e: Event): Promise<void> {
		e.preventDefault();
		loading = true;
		error = '';
		showAccountError = false;
		try {
			const body = new URLSearchParams();
			body.set('username', email.trim());
			body.set('password', password);
			const res = await fetch(`${API_BASE}/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body
			});
			if (!res.ok) throw new Error('Invalid email or password');
			const data = await res.json();
			saveToken(data.access_token);
			await fetchMe();
			await goto(homePathForUser());
		} catch (e) {
			error = e instanceof Error ? e.message : 'Login failed';
			showAccountError = true;
		} finally {
			loading = false;
		}
	}
</script>

{#if loading}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-white/40 backdrop-blur-sm">
		<div class="flex flex-col items-center gap-4">
			<div class="h-12 w-12 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
			<p class="font-medium text-emerald-900">Signing in...</p>
		</div>
	</div>
{/if}

<div class="flex min-h-[calc(100vh-4rem)] overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl">
	<!-- Side Panel -->
	<div class="relative hidden w-1/2 flex-col justify-between bg-emerald-900 p-12 lg:flex">
		<!-- Background shapes -->
		<div class="absolute inset-0 overflow-hidden">
			<div class="absolute -left-20 -top-20 h-80 w-80 rounded-full bg-emerald-800/50 blur-3xl"></div>
			<div class="absolute -right-20 bottom-0 h-96 w-96 rounded-full bg-teal-800/30 blur-3xl"></div>
		</div>

		<div class="relative z-10">
			<a href="/" class="flex items-center gap-2 text-2xl font-bold text-white">
				<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-white p-2">
					<img src="/icon.png" alt="PriceWise" class="h-full w-full object-contain" />
				</div>
				PriceWise
			</a>
		</div>

		<div class="relative z-10">
			<h2 class="text-3xl font-bold leading-tight text-emerald-50">
				The smarter way to manage your cafe margins.
			</h2>
			<p class="mt-4 text-lg text-emerald-300">
				Track ingredients, calculate costs, and optimize your pricing in one place.
			</p>
		</div>

		<div class="relative z-10 text-sm text-emerald-400">
			&copy; 2026 PriceWise Inc. All rights reserved.
		</div>
	</div>

	<!-- Form Panel -->
	<div class="flex w-full flex-col justify-center px-6 py-12 lg:w-1/2 lg:px-20">
		<div class="mx-auto w-full max-w-sm">
			<div class="lg:hidden mb-8 flex justify-center">
				<img src="/icon.png" alt="PriceWise" class="h-16 w-16 object-contain" />
			</div>

			<h2 class="text-3xl font-bold tracking-tight text-zinc-900">Welcome back</h2>
			<p class="mt-2 text-zinc-600">Enter your credentials to access your dashboard.</p>

			<div class="mt-8">
				<GoogleAuthButton
					text="Sign in with Google"
					onError={(msg) => {
						error = msg;
						showAccountError = true;
					}}
				/>

				<div class="relative my-6">
					<div class="absolute inset-0 flex items-center">
						<div class="w-full border-t border-zinc-200"></div>
					</div>
					<div class="relative flex justify-center text-xs uppercase">
						<span class="bg-white px-3 text-zinc-400 font-semibold tracking-wider">or sign in with email</span>
					</div>
				</div>
			</div>

			<form onsubmit={submit} class="space-y-6">
				<div>
					<label for="email" class="block text-sm font-semibold text-zinc-900">Email address</label>
					<div class="mt-2">
						<input
							type="email"
							id="email"
							bind:value={email}
							required
							placeholder="you@example.com"
							class="block w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-zinc-900 shadow-sm transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
						/>
					</div>
				</div>

				<div>
					<div class="flex items-center justify-between">
						<label for="password" class="block text-sm font-semibold text-zinc-900">Password</label>
						<div class="text-sm">
							<a href="#" class="font-medium text-emerald-600 hover:text-emerald-500">Forgot password?</a>
						</div>
					</div>
					<div class="mt-2 relative">
						<input
							type={showPassword ? 'text' : 'password'}
							id="password"
							bind:value={password}
							required
							placeholder="••••••••"
							class="block w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 pr-12 text-zinc-900 shadow-sm transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
						/>
						<button
							type="button"
							class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 focus:outline-none"
							onclick={() => (showPassword = !showPassword)}
						>
							{#if showPassword}
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-5 w-5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
								</svg>
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-5 w-5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.644C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
								</svg>
							{/if}
						</button>
					</div>
				</div>

				{#if showAccountError && error}
					<div class="rounded-xl bg-red-50 p-4 text-sm font-medium text-red-600">
						{error}
					</div>
				{/if}

				<button
					type="submit"
					class="flex w-full justify-center rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-700 hover:shadow-xl active:scale-95"
				>
					Sign in
				</button>
			</form>

			<p class="mt-10 text-center text-sm text-zinc-600">
				Not a member?
				<a href="/register" class="font-bold text-emerald-600 hover:text-emerald-500 underline underline-offset-4">
					Cafe owner account
				</a>
				·
				<a href="/register/supplier" class="font-bold text-amber-700 hover:underline underline-offset-4">
					Local supplier
				</a>
			</p>
		</div>
	</div>
</div>


