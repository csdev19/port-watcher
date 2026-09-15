// In dev, VITE_ vars are available server-side via Vite SSR
// In production (Cloudflare Worker), set API_URL in worker bindings
export const API_URL =
  process.env.API_URL || process.env.VITE_SERVER_URL || "http://localhost:3002";
