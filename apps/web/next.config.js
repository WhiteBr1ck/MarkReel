/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NODE_ENV === "production" ? "standalone" : undefined,
  reactStrictMode: true,
  async rewrites() {
    const apiTarget =
      process.env.INTERNAL_API_BASE_URL ||
      process.env.API_BASE_URL ||
      "http://localhost:4000";
    return [
      {
        source: "/api/:path*",
        destination: `${apiTarget}/api/:path*`
      }
    ];
  }
};

module.exports = nextConfig;
