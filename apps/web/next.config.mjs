/** @type {import("next").NextConfig} */
const nextConfig = {
  // URLs may contain share/download credentials, and browser errors may
  // include the current hash. Do not forward either to server logs.
  logging: { incomingRequests: false, browserToTerminal: false },
  transpilePackages: [
    "@buildurprofile/contracts",
    "@buildurprofile/skills",
    "@buildurprofile/storage"
  ],
  serverExternalPackages: ["alipay-sdk", "image-size", "subset-font"],
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
