// Kleiner Client für /api/v1. Fehler kommen als ApiError mit code/details aus dem einheitlichen Fehlerformat.

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(method, path, body) {
  const init = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(API_BASE + path, init);
  } catch {
    throw new ApiError(0, 'network', 'Keine Verbindung zum Server.');
  }
  if (res.status === 401 && path !== '/auth/login') {
    location.href = '/studio/login.html';
    throw new ApiError(401, 'unauthorized', 'Bitte erneut anmelden.');
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    // leerer oder kaputter Body
  }
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? `Fehler ${res.status}`, e.details ?? {});
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b) => api('PUT', p, b);
export const patch = (p, b) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);
