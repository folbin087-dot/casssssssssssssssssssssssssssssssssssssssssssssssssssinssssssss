/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Allow cross-origin requests from production domain during dev
  allowedDevOrigins: ['moneycas.live', 'www.moneycas.live'],
  // Turbopack configuration (empty to allow both webpack and turbopack)
  turbopack: {},
  // Force webpack for compatibility
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    // Return config to use webpack instead of turbopack
    return config;
  },
}

export default nextConfig
