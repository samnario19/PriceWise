<script lang="ts">
	import './layout.css';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authState, clearAuth, fetchMe, homePathForUser, hydrateAuthFromStorage, isCafeOwner, isLocalSupplier } from '$lib/state/auth.svelte';
	import {
		bootstrapUserWorkspace,
		cancelWorkspacePersistDebounce,
		clearInMemoryUserData,
		isWorkspaceSaveEnabled,
		pushWorkspaceNow,
		scheduleWorkspacePersist
	} from '$lib/state/userDataPersistence.svelte';
	import { costingSettings } from '$lib/state/costingSettings.svelte';
	import { ingredientCatalog } from '$lib/state/ingredientCatalog.svelte';
	import { opexStore } from '$lib/state/opexStore.svelte';
	import { otherCatalog } from '$lib/state/otherCatalog.svelte';
	import { recipeStore } from '$lib/state/recipes.svelte';
	import { salesStore } from '$lib/state/salesStore.svelte';
	import { summarySales } from '$lib/state/summarySales.svelte';
	import { replaceMonthlySummariesFromApi } from '$lib/state/monthlySummaryStore.svelte';
	import { hydrateUserPrefs, userPrefs } from '$lib/state/userPrefs.svelte';
	import RecipePricingSync from '$lib/components/recipes/RecipePricingSync.svelte';

	const { children } = $props();

	/** Only hydrate from the server when the logged-in user id changes — not on every `fetchMe()` profile refresh (same id), which would overwrite in-memory stores before persist runs. */
	let hydratedUserId = $state<number | null>(null);

	const cafeLinks = [
		{ href: '/recipes', label: 'Recipes' },
		{ href: '/Ingredients', label: 'Ingredients' },
		{ href: '/Others', label: 'Others' },
		{ href: '/local-store', label: 'Local Store' },
		{ href: '/Opex', label: 'OPEX' },
		{ href: '/business', label: 'Business Hub' },
		{ href: '/Statistics', label: 'Statistics' },
		{ href: '/smart-pricing', label: 'Smart Pricing' }
	];

	const links = $derived(cafeLinks);

	const isSupplierRoute = $derived($page.url.pathname.startsWith('/supplier'));

	const showAppHeader = $derived(
		!['/', '/login', '/register'].includes($page.url.pathname) &&
			!$page.url.pathname.startsWith('/register/supplier') &&
			!isSupplierRoute
	);

	$effect(() => {
		if (!browser) return;
		hydrateUserPrefs();
	});

	$effect(() => {
		if (!browser) return;
		void userPrefs.darkMode;
		document.documentElement.classList.toggle('dark', userPrefs.darkMode);
	});

	$effect(() => {
		hydrateAuthFromStorage();
		if (authState.token) void fetchMe();
	});

	$effect(() => {
		if (!browser) return;
		const publicPaths = ['/', '/landing', '/login', '/register', '/register/supplier'];
		const path = $page.url.pathname;
		if (publicPaths.includes(path) || path.startsWith('/register/supplier')) return;
		if (!authState.token) {
			void goto('/login', { replaceState: true });
			return;
		}
		if (!authState.user) return;
		if (isSupplierRoute && isCafeOwner()) {
			void goto('/recipes');
			return;
		}
		const cafeOnlyPrefixes = [
			'/recipes',
			'/Ingredients',
			'/Others',
			'/local-store',
			'/Opex',
			'/business',
			'/Summary',
			'/sales',
			'/Statistics',
			'/smart-pricing',
			'/settings'
		];
		if (isLocalSupplier() && cafeOnlyPrefixes.some((p) => path === p || path.startsWith(p + '/'))) {
			void goto('/supplier');
		}
	});

	$effect(() => {
		if (!browser) return;
		const id = authState.user?.id ?? null;
		if (id === null) {
			hydratedUserId = null;
			return;
		}
		if (!isCafeOwner()) return;
		if (hydratedUserId === id) return;
		hydratedUserId = id;
		const tok = authState.token;
		if (tok) {
			void bootstrapUserWorkspace(tok);
		} else {
			replaceMonthlySummariesFromApi([]);
		}
	});

	$effect(() => {
		if (!browser) return;
		if (!authState.user?.id) return;
		if (!isCafeOwner()) return;
		if (!isWorkspaceSaveEnabled()) return;
		const tok = authState.token;
		if (!tok) return;
		recipeStore.recipes;
		ingredientCatalog.items;
		otherCatalog.items;
		opexStore.lines;
		summarySales.ordersPerMonthByRecipeId;
		salesStore.transactions;
		costingSettings.vatRegistered;
		costingSettings.vatPct;
		costingSettings.batchSize;
		costingSettings.targetMarginPct;
		costingSettings.discountPct;
		scheduleWorkspacePersist(tok);
		return () => cancelWorkspacePersistDebounce();
	});

	$effect(() => {
		if (!browser) return;
		function flushWorkspace(): void {
			if (!isWorkspaceSaveEnabled()) return;
			const tok = authState.token;
			if (!tok) return;
			void pushWorkspaceNow(tok);
		}
		const onVis = (): void => {
			if (document.visibilityState === 'hidden') flushWorkspace();
		};
		window.addEventListener('pagehide', flushWorkspace);
		document.addEventListener('visibilitychange', onVis);
		return () => {
			window.removeEventListener('pagehide', flushWorkspace);
			document.removeEventListener('visibilitychange', onVis);
		};
	});

	function logout(): void {
		clearAuth();
		clearInMemoryUserData();
		void goto('/login');
	}
</script>

<div class="min-h-screen bg-zinc-100 text-zinc-900 antialiased">
	{#if isCafeOwner()}
		<RecipePricingSync />
	{/if}
	{#if showAppHeader}
		<header
			class="sticky top-0 z-40 border-b border-emerald-200 bg-emerald-50/95 backdrop-blur-md supports-backdrop-filter:bg-emerald-50/80"
		>
			<div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
				<a href="/recipes" class="text-lg font-semibold tracking-tight text-emerald-900">Pricewise</a>
				<nav class="flex flex-wrap gap-1 rounded-xl bg-emerald-100 p-1" aria-label="Main">
					{#each links as link}
						<a
							href={link.href}
							class={[
								'rounded-lg px-3 py-2 text-sm font-medium transition',
								$page.url.pathname === link.href
									? 'bg-emerald-600 text-white shadow-sm'
									: 'text-emerald-900 hover:bg-emerald-200'
							].join(' ')}
						>
							{link.label}
						</a>
					{/each}
				</nav>
				<div class="flex flex-wrap items-center justify-end gap-2">
					{#if authState.user}
						<span class="max-w-[140px] truncate text-xs text-emerald-900 sm:max-w-[220px]" title={authState.user.email}
							>{authState.user.email}</span
						>
						<a
							href="/settings"
							class={[
								'rounded-xl border px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur-sm transition',
								$page.url.pathname === '/settings'
									? 'border-emerald-600 bg-emerald-600 text-white'
									: 'border-emerald-600/25 bg-white/70 text-emerald-900 hover:bg-white dark:border-emerald-500/30 dark:bg-zinc-900/60 dark:text-emerald-100 dark:hover:bg-zinc-800'
							].join(' ')}
						>
							Settings
						</a>
						<button
							type="button"
							class="rounded-xl border border-emerald-700/30 bg-emerald-600/10 px-3 py-1.5 text-xs font-semibold text-emerald-900 backdrop-blur-sm hover:bg-emerald-600/15 dark:border-emerald-400/25 dark:text-emerald-100 dark:hover:bg-emerald-950/40"
							onclick={logout}
						>
							Logout
						</button>
					{:else}
						<a href="/login" class="rounded-lg border border-emerald-500 px-2 py-1 text-xs text-emerald-800">Login</a>
						<a href="/register" class="rounded-lg border border-emerald-500 px-2 py-1 text-xs text-emerald-800">Register</a>
					{/if}
				</div>
			</div>
		</header>
	{/if}

	{#if isSupplierRoute}
		{@render children()}
	{:else}
		<main class="mx-auto max-w-6xl px-4 py-6 sm:py-8">
			{@render children()}
		</main>
	{/if}
</div>
