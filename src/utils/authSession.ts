const SESSION_TOKEN_STORAGE_KEY = 'armazem_admin_session_token';

let inMemoryToken: string | null = null;

export function getAdminSessionToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
    if (stored) {
      inMemoryToken = stored;
      return stored;
    }
  } catch {
    // Ignore storage access errors
  }
  return null;
}

export function setAdminSessionToken(token: string | null | undefined): void {
  if (!token) return;
  inMemoryToken = token;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage quota/privacy errors
  }
}

export function clearAdminSessionToken(): void {
  inMemoryToken = null;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage access errors
  }
}

export function adminFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAdminSessionToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(input, {
    ...init,
    credentials: 'include',
    headers,
  });
}
