/**
 * M12 Expense Tracker - Centralized API & Authentication Token Client
 * Manages canonical token storage under 'm12_expense_tracker_token',
 * Bearer authorization header injection, and cross-domain API requests.
 */

export const AUTH_TOKEN_KEY = 'm12_expense_tracker_token';
export const LEGACY_AUTH_TOKEN_KEY = 'finora_token';

/**
 * Returns the configured backend API base URL
 */
export const getApiUrl = (): string => {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
};

/**
 * Retrieves the stored JWT from localStorage (with legacy fallback)
 */
export const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const token =
      localStorage.getItem(AUTH_TOKEN_KEY) ||
      localStorage.getItem(LEGACY_AUTH_TOKEN_KEY) ||
      null;
    return token;
  } catch {
    return null;
  }
};

/**
 * Persists the JWT under the project canonical storage key
 */
export const setAuthToken = (token: string): void => {
  if (typeof window === 'undefined' || !token) return;
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    // Remove legacy key if it exists to maintain a single canonical key
    if (localStorage.getItem(LEGACY_AUTH_TOKEN_KEY)) {
      localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
    }
  } catch (err) {
    console.warn('[Auth] Failed to write token to localStorage:', err);
  }
};

/**
 * Clears the authentication token from localStorage
 */
export const clearAuthToken = (): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
  } catch (err) {
    console.warn('[Auth] Failed to clear token from localStorage:', err);
  }
};

/**
 * Authenticated fetch helper that automatically injects the Bearer token header
 * and includes credentials for cookie compatibility.
 */
export const authFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const token = getAuthToken();
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : {}));

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const updatedInit: RequestInit = {
    ...init,
    headers,
    credentials: init?.credentials || 'include',
  };

  if (input instanceof Request) {
    const newRequest = new Request(input, updatedInit);
    return fetch(newRequest);
  }

  return fetch(input, updatedInit);
};

let interceptorInstalled = false;

/**
 * Automatically intercepts browser window.fetch calls directed to the API base URL
 * or /api/ endpoints to inject the Authorization Bearer header transparently.
 */
export const installAuthFetchInterceptor = (): void => {
  if (typeof window === 'undefined' || interceptorInstalled) return;
  interceptorInstalled = true;

  const originalFetch = window.fetch;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      const urlString =
        typeof input === 'string'
          ? input
          : input instanceof URL
          ? input.href
          : (input as Request).url;

      const apiUrl = getApiUrl();
      const isApiRequest =
        urlString.startsWith(apiUrl) ||
        urlString.startsWith('/api/') ||
        urlString.includes('/api/v1/');

      if (isApiRequest) {
        const token = getAuthToken();
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : {}));

        if (token && !headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
        }

        const newInit: RequestInit = {
          ...init,
          headers,
          credentials: init?.credentials || 'include',
        };

        if (input instanceof Request) {
          const newRequest = new Request(input, newInit);
          return originalFetch.call(this, newRequest);
        }

        return originalFetch.call(this, input, newInit);
      }
    } catch {
      // In case of any header parsing issue, gracefully fallback to original fetch
    }

    return originalFetch.call(this, input as any, init);
  };
};

// Auto-install interceptor on client load
if (typeof window !== 'undefined') {
  installAuthFetchInterceptor();
}
