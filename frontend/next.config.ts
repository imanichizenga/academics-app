import type { NextConfig } from "next";

const api = process.env.INTERNAL_API_URL ?? "http://localhost:8000";
const dev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:" + (dev ? " ws:" : ""),
  "worker-src 'self' blob:",
  "frame-src https://www.youtube-nocookie.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const config: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  skipTrailingSlashRedirect: true, // Django's API urls end in a slash
  poweredByHeader: false,
  devIndicators: false,
  async rewrites() {
    return [
      { source: "/api/:path*/", destination: `${api}/api/:path*/` }, // Django's API urls end in a slash, so keep it
      { source: "/api/:path*", destination: `${api}/api/:path*` },
    ];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
      ],
    }];
  },
};
export default config;
