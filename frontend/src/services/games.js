import { API_BASE_URL } from '../config/api.js';

/** Game transport carries credentials only in headers and preserves command keys across uncertain retries. */
export async function gameRequest({ accessToken, path = '', method = 'GET', body, key, signal,
  basePath = `${API_BASE_URL}/api/v1/games` }) {
  let response;
  try {
    response = await fetch(`${basePath}${path}`, {
      method, credentials: 'include', signal,
      headers: { Accept: 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch (cause) {
    if (cause.name === 'AbortError' || signal?.aborted) throw cause;
    throw Object.assign(new Error('Unable to connect. Retry the same action after connection is restored.'), {
      code: 'DISCONNECTED', unknownOutcome: method !== 'GET'
    });
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw Object.assign(new Error('Server response could not be read. Retry the same action.'), {
      code: 'INVALID_RESPONSE', unknownOutcome: method !== 'GET'
    });
  }
  if (!response.ok || payload?.success !== true) {
    throw Object.assign(new Error(payload?.error?.message || 'Game request failed.'), {
      code: payload?.error?.code || 'REQUEST_FAILED', status: response.status,
      unknownOutcome: method !== 'GET' && (response.status >= 500 || response.status === 408
        || payload?.error?.code === 'DUPLICATE_ACTION')
    });
  }
  return payload;
}

/** Public reads use a separate endpoint family and never require a pairing credential. */
export function publicGameRequest(request) {
  return gameRequest({ ...request, basePath: `${API_BASE_URL}/api/v1/public` });
}

/**
 * Downloads authoritative game CSV export as a file.
 *
 * @param {object} params Parameters.
 * @param {string} params.accessToken Admin bearer token.
 * @param {string} params.gameId Game identifier.
 * @param {string} [params.scope='all'] Export scope.
 * @param {string} [params.teamId] Optional team UUID.
 * @returns {Promise<string>} Downloaded filename.
 */
export async function downloadGameCsv({ accessToken, gameId, scope = 'all', teamId }) {
  const params = new globalThis.URLSearchParams();
  if (scope && scope !== 'all') params.set('scope', scope);
  if (teamId) params.set('teamId', teamId);
  const query = params.toString() ? `?${params.toString()}` : '';

  const res = await fetch(`${API_BASE_URL}/api/v1/games/${gameId}/export.csv${query}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    }
  });

  if (!res.ok) {
    let errorMsg = 'Failed to download CSV file.';
    try {
      const errJson = await res.json();
      if (errJson?.error?.message) errorMsg = errJson.error.message;
    } catch {
      // ignore non-json response
    }
    throw new Error(errorMsg);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : `leadership-race-${gameId.slice(0, 8)}.csv`;

  if (typeof window !== 'undefined' && window.document?.createElement) {
    const url = window.URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = filename;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  return filename;
}
