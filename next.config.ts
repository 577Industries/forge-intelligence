import type { NextConfig } from "next";

/**
 * Content-Security-Policy is the security boundary of this app, not boilerplate.
 *
 * `connect-src 'self'` is why /api/intelligence/tiles exists: the browser
 * cannot reach a tile CDN directly, so the basemap is proxied through a
 * host-allowlisted route. That single directive is what stops a compromised
 * feed renderer exfiltrating anywhere.
 *
 * `worker-src blob:` is required by MapLibre's workers. `frame-src` admits
 * only YouTube's privacy-preserving player, used by the live-broadcast layer —
 * we embed the broadcaster's own player and never re-host a stream.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
