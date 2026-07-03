import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite's dev server already falls back to index.html for unknown routes,
// which makes deep links like /dashboard or /projects/learning work on
// refresh in development. Production hosts are handled via vercel.json
// and public/_redirects (Netlify/Cloudflare Pages).
export default defineConfig({
  plugins: [react()],
  // Allow the app to be previewed through sandbox/proxy hostnames during
  // development. This only affects the local dev/preview servers, never the
  // production build output.
  server: { host: true, allowedHosts: true },
  preview: { host: true, allowedHosts: true },
})
