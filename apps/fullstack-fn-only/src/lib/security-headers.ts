/**
 * Security headers for every SSR page. The Worker renders the HTML, and
 * Cloudflare applies `public/_headers` to static assets only, so pages get
 * these through the root route's `headers` option. Keep the two in sync.
 *
 * The CSP restricts framing, plugins, `<base>` and form targets. It does not
 * restrict scripts or styles: TanStack Start's hydration uses inline scripts,
 * which would need per-request nonces first.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};
