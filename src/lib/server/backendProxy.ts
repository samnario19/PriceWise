import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import type { RequestEvent } from '@sveltejs/kit';

const HOP_BY_HOP = new Set([
	'connection',
	'content-length',
	'host',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade'
]);

/** FastAPI prefixes that are not SvelteKit pages (so we can proxy the currently deployed client). */
const API_PREFIXES = [
	'/auth',
	'/workspace',
	'/ingredients',
	'/opex',
	'/other-costs',
	'/local-stores',
	'/monthly-summaries',
	'/ml',
	'/marketplace',
	'/health'
] as const;

function trimSlash(value: string): string {
	return value.trim().replace(/\/+$/, '');
}

function isUsableOrigin(url: string): boolean {
	if (!/^https?:\/\//i.test(url)) return false;
	if (/vercel\.app/i.test(url)) return false;
	if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url) && !dev) return false;
	return true;
}

export function getBackendOrigin(): string | null {
	const candidates = [env.BACKEND_URL, env.API_URL, publicEnv.PUBLIC_API_URL, env.VITE_API_URL];
	for (const raw of candidates) {
		if (typeof raw !== 'string') continue;
		const url = trimSlash(raw);
		if (isUsableOrigin(url)) return url;
	}
	if (dev) return 'http://127.0.0.1:8000';
	return null;
}

function backendPathFromRequest(pathname: string): string | null {
	if (pathname === '/api' || pathname.startsWith('/api/')) {
		const stripped = pathname.slice('/api'.length);
		return stripped === '' ? '/' : stripped;
	}
	if (API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
		return pathname;
	}
	return null;
}

function isKitInternal(event: RequestEvent): boolean {
	if (event.isDataRequest || event.isSubRequest) return true;
	const dest = event.request.headers.get('sec-fetch-dest');
	if (dest === 'document' || dest === 'iframe' || dest === 'script' || dest === 'style') {
		return true;
	}
	return false;
}

export function apiBackendPath(event: RequestEvent): string | null {
	if (isKitInternal(event)) return null;
	return backendPathFromRequest(event.url.pathname);
}

export async function proxyToBackend(event: RequestEvent, backendPath: string): Promise<Response> {
	const origin = getBackendOrigin();
	if (!origin) {
		return Response.json(
			{
				detail:
					'Set BACKEND_URL on Vercel to your Render origin (https://your-service.onrender.com). Do not use the Vercel URL.'
			},
			{ status: 503 }
		);
	}

	const path = backendPath.startsWith('/') ? backendPath : `/${backendPath}`;
	const target = `${origin}${path}${event.url.search}`;

	const headers = new Headers();
	for (const [key, value] of event.request.headers) {
		if (HOP_BY_HOP.has(key.toLowerCase())) continue;
		headers.set(key, value);
	}

	const init: RequestInit = { method: event.request.method, headers };
	if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
		init.body = await event.request.arrayBuffer();
	}

	let upstream: Response;
	try {
		upstream = await fetch(target, init);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Backend unreachable';
		return Response.json({ detail: message }, { status: 502 });
	}

	const out = new Headers();
	const contentType = upstream.headers.get('content-type');
	if (contentType) out.set('content-type', contentType);

	if (upstream.status === 204 || upstream.status === 205 || upstream.status === 304) {
		return new Response(null, { status: upstream.status, headers: out });
	}

	return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: out });
}
