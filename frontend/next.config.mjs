

const nextConfig = {
  // Allow the API URL to be injected at build time via Vercel env vars
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  },
};

export default nextConfig;
