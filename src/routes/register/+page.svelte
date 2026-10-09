<script lang="ts">
	import { goto } from '$app/navigation';
	import { API_BASE } from '$lib/api/apiBase';
	import GoogleAuthButton from '$lib/components/GoogleAuthButton.svelte';

	let email = $state('');
	let password = $state('');
	let firstName = $state('');
	let lastName = $state('');
	let middleName = $state('');
	let contactNumber = $state('');
	let loading = $state(false);
	let error = $state('');
	let emailError = $state('');
	let passwordError = $state('');
	let firstNameError = $state('');
	let lastNameError = $state('');
	let contactNumberError = $state('');
	let showPassword = $state(false);

	async function submit(e: Event): Promise<void> {
		e.preventDefault();
		loading = true;
		error = '';
		emailError = '';
		passwordError = '';
		firstNameError = '';
		lastNameError = '';
		contactNumberError = '';

		if (!email.trim()) {
			emailError = 'Email is required';
		} else if (!email.trim().toLowerCase().endsWith('@gmail.com')) {
			emailError = 'Please use a Gmail address (@gmail.com)';
		}
		if (!password.trim()) passwordError = 'Password is required';
		if (!firstName.trim()) firstNameError = 'First Name is required';
		if (!lastName.trim()) lastNameError = 'Last Name is required';
		// contactNumber is now optional

		if (emailError || passwordError || firstNameError || lastNameError || contactNumberError) {
			loading = false;
			return;
		}

		try {
			const res = await fetch(`${API_BASE}/auth/register`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: email.trim(), password, role: 'cafe_owner' })
			});
			if (!res.ok) {
				const msg = await res.text();
				throw new Error(msg || 'Registration failed');
			}
			await goto('/login');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Registration failed';
		} finally {
			loading = false;
		}
	}
</script>

{#if loading}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-white/40 backdrop-blur-sm">
		<div class="flex flex-col items-center gap-4">
			<div class="h-12 w-12 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
			<p class="font-medium text-emerald-900">Creating your account...</p>
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
				Start your journey with PriceWise today.
			</h2>
			<p class="mt-4 text-lg text-emerald-300">
				Join hundreds of cafe owners optimizing their business logic.
			</p>
		</div>

		<div class="relative z-10 text-sm text-emerald-400">
			&copy; 2026 PriceWise Inc. All rights reserved.
		</div>
	</div>

	<!-- Form Panel -->
	<div class="flex w-full flex-col justify-center px-6 py-12 lg:w-1/2 lg:px-20">
		<div class="mx-auto w-full max-w-lg">
			<div class="lg:hidden mb-8 flex justify-center">
				<img src="/icon.png" alt="PriceWise" class="h-16 w-16 object-contain" />
			</div>

						<a
				href="/"
				onclick={(e) => {
					if (typeof window !== 'undefined' && window.history.length > 1) {
						e.preventDefault();
						window.history.back();
					}
				}}
				class="group mb-6 inline-flex items-center gap-2 text-sm font-semibold text-zinc-500 hover:text-emerald-600 transition-colors"
			>
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-4 w-4 transition-transform group-hover:-translate-x-1">
					<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
				</svg>
				Back to landing page
			</a>

			<h2 class="text-3xl font-bold tracking-tight text-zinc-900">Create account</h2>
			<p class="mt-2 text-zinc-600">Enter your details to get started with PriceWise.</p>

			<div class="mt-8">
				<GoogleAuthButton
					text="Sign up with Google"
					onError={(msg) => {
						error = msg;
					}}
				/>

				<div class="relative my-6">
					<div class="absolute inset-0 flex items-center">
						<div class="w-full border-t border-zinc-200"></div>
					</div>
					<div class="relative flex justify-center text-xs uppercase">
						<span class="bg-white px-3 text-zinc-400 font-semibold tracking-wider">or register with email</span>
					</div>
				</div>
			</div>

			<form onsubmit={submit} class="space-y-4">
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label for="firstName" class="block text-sm font-semibold text-zinc-900">First Name</label>
						<input
							type="text"
							id="firstName"
							bind:value={firstName}
							placeholder="Jane"
							class="mt-2 block w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-zinc-900 shadow-sm transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
						/>
						{#if firstNameError}<p class="mt-1 text-xs text-red-500">{firstNameError}</p>{/if}
					</div>
					<div>
						<label for="lastName" class="block text-sm font-semibold text-zinc-900">Last Name</label>
						<input
							type="text"
							id="lastName"
							bind:value={lastName}
							placeholder="Doe"
							class="mt-2 block w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-zinc-900 shadow-sm transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
						/>
						{#if lastNameError}<p class="mt-1 text-xs text-red-500">{lastNameError}</p>{/if}
					</div>
				</div>

				<div>
					<label for="email" class="block text-sm font-semibold text-zinc-900">Email address</label>
					<input
						type="email"
						id="email"
						bind:value={email}
						placeholder="jane.doe@gmail.com"
						class="mt-2 block w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-zinc-900 shadow-sm transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
					/>
					{#if emailError}<p class="mt-1 text-xs text-red-500">{emailError}</p>{/if}
				</div>

				<div>
					<label for="password" class="block text-sm font-semibold text-zinc-900">Password</label>
					<div class="relative">
						<input
							type={showPassword ? 'text' : 'password'}
							id="password"
							bind:value={password}
							placeholder="••••••••"
							class="mt-2 block w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 pr-12 text-zinc-900 shadow-sm transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
						/>
						<button
							type="button"
							class="absolute right-3 top-1/2 mt-1 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 focus:outline-none"
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
					{#if passwordError}<p class="mt-1 text-xs text-red-500">{passwordError}</p>{/if}
				</div>

				<div>
					<label for="contactNumber" class="block text-sm font-semibold text-zinc-900">
						Contact Number <span class="text-xs font-normal text-zinc-500">(Optional)</span>
					</label>
					<input
						type="tel"
						id="contactNumber"
						bind:value={contactNumber}
						placeholder="+63 900 000 0000"
						class="mt-2 block w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-zinc-900 shadow-sm transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
					/>
					{#if contactNumberError}<p class="mt-1 text-xs text-red-500">{contactNumberError}</p>{/if}
				</div>

				{#if error}
					<div class="rounded-xl bg-red-50 p-4 text-sm font-medium text-red-600">
						{error}
					</div>
				{/if}

				<button
					type="submit"
					disabled={loading}
					class="mt-4 flex w-full justify-center rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-700 hover:shadow-xl active:scale-95 disabled:opacity-60"
				>
					{loading ? 'Creating account...' : 'Create account'}
				</button>
			</form>

			<p class="mt-10 text-center text-sm text-zinc-600">
				Already have an account?
				<a href="/login" class="font-bold text-emerald-600 hover:text-emerald-500 underline underline-offset-4">
					Sign in instead
				</a>
				·
				<a href="/register/supplier" class="font-bold text-amber-700 hover:underline underline-offset-4">
					Register as local supplier
				</a>
			</p>
		</div>
	</div>
</div>


