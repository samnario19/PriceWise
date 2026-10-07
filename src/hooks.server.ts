import type { Handle } from '@sveltejs/kit';
import { apiBackendPath, proxyToBackend } from '$lib/server/backendProxy';

export const handle: Handle = async ({ event, resolve }) => {
	const backendPath = apiBackendPath(event);
	if (backendPath) {
		return proxyToBackend(event, backendPath);
	}
	return resolve(event);
};
