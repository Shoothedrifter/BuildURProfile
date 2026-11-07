/** @type {import("next").NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@buildurprofile/contracts",
    "@buildurprofile/skills",
    "@buildurprofile/storage"
  ],
  serverExternalPackages: ["alipay-sdk", "image-size"],
  async rewrites() {
    return [
      {
        source: "/_internal/agent/:path*",
        destination: "/api/_internal/agent/:path*"
      }
    ];
  }
};

export default nextConfig;
