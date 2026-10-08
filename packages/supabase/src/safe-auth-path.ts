/** Auth redirects are internal routes, never arbitrary provider/client URLs. */
export function safeAuthPath(value: string | null | undefined, fallback = '/home'): string {
 if (!value || value.length > 1024 || /[\\\u0000-\u0020]/.test(value)) return fallback;
 let decoded: string; try { decoded = decodeURIComponent(value); } catch { return fallback; }
 if (/[\\\u0000-\u0020]/.test(decoded) || !decoded.startsWith('/') || decoded.startsWith('//')) return fallback;
 const url = new URL(decoded, 'https://auth.invalid');
 if (url.origin !== 'https://auth.invalid' || !(/^\/home(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(url.pathname) || url.pathname === '/update-password')) return fallback;
 return url.pathname;
}
