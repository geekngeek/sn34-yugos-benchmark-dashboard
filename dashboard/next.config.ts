import type { NextConfig } from "next";

// `next dev` only serves its client JavaScript to localhost by default. When the
// dev server is opened through another host (e.g. the server's IP), that host
// must be listed here, or the page never becomes interactive (filters, sorting).
// Override with ALLOWED_DEV_ORIGINS="host1,host2". Has no effect on `next start`.
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "116.202.214.45")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins,
};

export default nextConfig;
