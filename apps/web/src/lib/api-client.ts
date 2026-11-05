const BASE_URL = '/api';

let csrfToken: string | null =
  (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('examvault_csrf') : null) ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('examvault_csrf') : null);

export function setCsrfToken(token: string | null) {
  csrfToken = token;
  if (token) {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('examvault_csrf', token);
    if (typeof localStorage !== 'undefined') localStorage.setItem('examvault_csrf', token);
  } else {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('examvault_csrf');
    if (typeof localStorage !== 'undefined') localStorage.removeItem('examvault_csrf');
  }
}

export function getCsrfToken(): string | null {
  if (!csrfToken) {
    csrfToken =
      (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('examvault_csrf') : null) ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem('examvault_csrf') : null);
  }
  return csrfToken;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: any,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
  bypassCache?: boolean;
}

// Client-Side High-Speed In-Memory Cache (SWR)
interface CacheEntry {
  data: any;
  timestamp: number;
}
const apiCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30000; // 30 seconds fresh cache
const REVALIDATE_AFTER_MS = 6000; // Revalidate in background after 6 seconds

export function clearApiCache() {
  apiCache.clear();
}

export function invalidateApiCache(pattern?: string) {
  if (!pattern) {
    apiCache.clear();
    return;
  }
  for (const key of apiCache.keys()) {
    if (key.includes(pattern)) {
      apiCache.delete(key);
    }
  }
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  let url = `${BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  if (options.params) {
    const searchParams = new URLSearchParams();
    Object.entries(options.params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        searchParams.append(key, String(val));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  const method = (options.method || 'GET').toUpperCase();
  const isGet = method === 'GET';

  // If not a GET request, invalidate cache because data is being modified
  if (!isGet) {
    apiCache.clear();
  }

  // Check cache for GET requests
  if (isGet && !options.bypassCache) {
    const cached = apiCache.get(url);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < CACHE_TTL_MS) {
        // If data is getting slightly old (> 6s), revalidate silently in background
        if (age > REVALIDATE_AFTER_MS) {
          fetchFresh<T>(url, options)
            .then((fresh) => {
              apiCache.set(url, { data: fresh, timestamp: Date.now() });
            })
            .catch(() => {});
        }
        return cached.data as T;
      }
    }
  }

  const result = await fetchFresh<T>(url, options);

  if (isGet) {
    apiCache.set(url, { data: result, timestamp: Date.now() });
  }

  return result;
}

async function fetchFresh<T>(url: string, options: RequestOptions): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const activeCsrfToken = getCsrfToken();
  if (activeCsrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(options.method?.toUpperCase() || 'GET')) {
    headers.set('X-CSRF-Token', activeCsrfToken);
  }

  const bearerToken = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  if (bearerToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${bearerToken}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;
    let errorData = null;
    try {
      errorData = await response.json();
      errorMessage = errorData.message || errorData.error || errorMessage;
      if (Array.isArray(errorMessage)) {
        errorMessage = errorMessage.join(', ');
      }
    } catch {
      // not JSON
    }
    throw new ApiError(errorMessage, response.status, errorData);
  }

  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }

  return response.text() as unknown as T;
}
