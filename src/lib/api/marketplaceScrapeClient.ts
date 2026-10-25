import { API_BASE } from '$lib/api/apiBase';
import { env } from '$env/dynamic/public';
import type { ChannelMarketplace } from '$lib/types/recipe';

export type ScrapeMarketplaceResult =
	| { ok: true; bodyJson: string }
	| { ok: false; error: string };

function parseJsonSafe(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
}

/**
 * Get the base URL for scrape requests.
 * Hits the Render backend directly via PUBLIC_BACKEND_URL to avoid Vercel's
 * 10-second serverless timeout.
 */
function getScrapeBase(): string {
	const direct = env.PUBLIC_BACKEND_URL?.trim().replace(/\/+$/, '');
	if (direct && /^https?:\/\//i.test(direct) && !/vercel\.app/i.test(direct)) {
		return direct;
	}
	return API_BASE;
}

/** Parse Shopee shop_id and item_id from a product URL. */
function parseShopeeIds(url: string): { shopId: string; itemId: string } | null {
	try {
		const u = new URL(url);
		if (!u.hostname.includes('shopee.')) return null;
		const path = u.pathname.replace(/\/$/, '');
		// /product-name-i.SHOPID.ITEMID
		let m = path.match(/-i\.(\d+)\.(\d+)$/) || path.match(/\.i\.(\d+)\.(\d+)$/);
		if (m) return { shopId: m[1], itemId: m[2] };
		// /product/SHOPID/ITEMID
		m = path.match(/\/product\/(\d+)\/(\d+)/);
		if (m) return { shopId: m[1], itemId: m[2] };
	} catch {
		// ignore
	}
	return null;
}

/**
 * Call Shopee's item/get API directly from the user's browser.
 *
 * The browser already has valid Shopee session cookies from normal browsing
 * so DataDome lets the request through — unlike server-side requests which
 * are blocked with 403 Forbidden from data-center IPs.
 */
async function shopeeDirectBrowserFetch(url: string): Promise<ScrapeMarketplaceResult> {
	const ids = parseShopeeIds(url);
	if (!ids) return { ok: false, error: 'Could not parse Shopee product IDs from URL.' };

	const { shopId, itemId } = ids;
	const apiUrl = `https://shopee.ph/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`;

	try {
		const res = await fetch(apiUrl, {
			credentials: 'include', // sends existing shopee.ph cookies
			headers: {
				Accept: 'application/json, text/plain, */*',
				Referer: url,
				'X-Requested-With': 'XMLHttpRequest'
			}
		});

		if (!res.ok) {
			return { ok: false, error: `Shopee API returned HTTP ${res.status}` };
		}

		const data = (await res.json()) as Record<string, unknown>;

		// Validate we got useful product data
		const dataField = data.data;
		const item =
			typeof dataField === 'object' && dataField !== null
				? (dataField as Record<string, unknown>).item
				: null;

		if (item && typeof (item as Record<string, unknown>).price_min === 'number') {
			return { ok: true, bodyJson: JSON.stringify(data) };
		}

		// Got a response but it's an error payload (e.g. {"error": -1})
		const errCode = data.error;
		if (errCode !== undefined && errCode !== 0) {
			return {
				ok: false,
				error: `Shopee API error ${String(errCode)}. Make sure you are logged in to shopee.ph in this browser, then try again.`
			};
		}

		// Return whatever we have — the frontend parser will extract what it can
		return { ok: true, bodyJson: JSON.stringify(data) };
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : 'Browser fetch to Shopee failed.'
		};
	}
}

/**
 * Scrape a marketplace product URL.
 *
 * For Shopee: tries a direct browser-side API call first (uses the user's
 * existing shopee.ph session cookies — bypasses DataDome server-IP blocks).
 * Falls back to the server-side backend scrape for all other marketplaces or
 * if the direct Shopee fetch fails.
 */
export async function scrapeMarketplaceFromBrowser(
	url: string,
	marketplace: ChannelMarketplace
): Promise<ScrapeMarketplaceResult> {
	// Shopee: try direct browser fetch first (bypasses DataDome server blocks)
	if (marketplace === 'shopee') {
		const direct = await shopeeDirectBrowserFetch(url);
		if (direct.ok) return direct;
		// Fall through to backend as last resort (helps local dev / relaxed CORS)
	}

	const scrapeBase = getScrapeBase();
	try {
		const res = await fetch(`${scrapeBase}/marketplace/scrape`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url, marketplace })
		});

		const rawText = await res.text();
		const parsed = parseJsonSafe(rawText);

		if (parsed === null) {
			const snippet = rawText.trim().slice(0, 280);
			return {
				ok: false,
				error:
					snippet ||
					`HTTP ${res.status} ${res.statusText || ''}`.trim() ||
					'Invalid response from API (not JSON). Is the backend running?'
			};
		}

		const data = parsed as {
			ok?: boolean;
			body_json?: string | null;
			error?: string | null;
			detail?: unknown;
		};

		if (!res.ok) {
			const detail =
				typeof data.detail === 'string'
					? data.detail
					: Array.isArray(data.detail)
						? data.detail.map((d) => String(d)).join('; ')
						: res.statusText || 'Scrape request failed';
			return { ok: false, error: detail };
		}

		if (data.ok && data.body_json) {
			return { ok: true, bodyJson: data.body_json };
		}
		return { ok: false, error: data.error || 'Scrape returned no data' };
	} catch (e) {
		return {
			ok: false,
			error:
				e instanceof Error
					? e.message
					: 'Could not reach the API. Is the PriceWise backend running?'
		};
	}
}
