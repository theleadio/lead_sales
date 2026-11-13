import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The funnel editor autosaves { project, html, css } through a Server Action;
  // the draft cap is 2 MB of html + css, plus the project JSON.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
