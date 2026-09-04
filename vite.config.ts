import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite's dev server already falls back to index.html for unknown routes,
// which makes deep links like /dashboard or /projects/learning work on
// refresh in development. Production hosts are handled via vercel.json
// and public/_redirects (Netlify/Cloudflare Pages).
//
// VERIFY_HARNESS=1 swaps the Supabase client for a local stub so the
// verify/ harnesses can drive the real app (auth gate, bootstrap, stores,
// sync engine) without a live backend. It is opt-in via env, so a normal
// `npm run build` / `npm run dev` is completely unaffected.
const harness = process.env.VERIFY_HARNESS === '1'

export default defineConfig({
  plugins: [react()],
  resolve: harness
    ? {
      alias: [{
        find: /^.*\/supabaseClient$/,
        replacement: fileURLToPath(new URL('./verify/board-supabase-stub.ts', import.meta.url)),
      }],
    }
    : undefined,
  // Allow the app to be previewed through sandbox/proxy hostnames during
  // development. This only affects the local dev/preview servers, never the
  // production build output.
  server: { host: true, allowedHosts: true },
  preview: { host: true, allowedHosts: true },
})
