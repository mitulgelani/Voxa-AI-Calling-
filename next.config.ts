import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // node-edge-tts drives a WebSocket through `ws`. If Next bundles it, the bundler
  // rewrites internal buffer helpers and every synthesis throws "b.mask is not a function".
  serverExternalPackages: ['node-edge-tts', 'ws'],
};

export default nextConfig;
