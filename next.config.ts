import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The editor autosaves { project } through a Server Action (html/css are rendered
  // on publish); the project JSON cap is 1.5 MB, so 6mb is generous headroom.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
