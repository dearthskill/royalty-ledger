import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // database drivers stay plain Node modules on the server
  serverExternalPackages: ['pg', 'mongodb'],
};

export default nextConfig;
