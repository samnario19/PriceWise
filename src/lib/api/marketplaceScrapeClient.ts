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
 * Scraping uses Playwright (~55 s) so we bypass the Vercel serverless proxy
 * (10 s timeout) and hit the Render backend directly via PUBLIC_BACKEND_URL.
 * In local dev (no PUBLIC_BACKEND_URL) it falls back to the normal /api proxy.
 */
function getScrapeBase(): string {
	const direct = env.PUBLIC_BACKEND_URL?.trim().replace(/\/+$/, '');
	if (direct && /^https?:\/\//i.test(direct) && !/vercel\.app/i.test(direct)) {
		return direct;
	}
	return API_BASE;
}

/**
 * Server-side Playwright capture (Chromium). Start the FastAPI backend and run
 * `playwright install chromium` in the backend venv once.
 */
export async function scrapeMarketplaceFromBrowser(
	url: string,
	marketplace: ChannelMarketplace
): Promise<ScrapeMarketplaceResult> {
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

