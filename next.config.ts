import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
  experimental: {
    // Clerk runs via proxy.ts, which buffers request bodies. Without raising
    // this, Next truncates uploads to 10MB and the transcription form fails to
    // parse ("Unexpected end of form").
    proxyClientMaxBodySize: "300mb",
    serverActions: {
      bodySizeLimit: "300mb",
    },
  },
};

export default nextConfig;
