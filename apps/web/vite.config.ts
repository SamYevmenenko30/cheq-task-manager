// The SPA's build and its dev server.
//
// The invariant THIS file carries: the two API paths resolve WITHOUT a base URL. In production
// CloudFront is the proxy — one distribution in front of both halves (`infra/cdn.tf`), chosen so
// that no API origin is baked into this build output. The dev server has no CloudFront, so the
// same two paths are forwarded here instead, and the app's `fetch` calls stay relative in both
// (CHQ-003, Cross-package effects). `pnpm dev:api` is what `target` points at.

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_ORIGIN = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/tasks': { target: API_ORIGIN, changeOrigin: true },
      '/health': { target: API_ORIGIN, changeOrigin: true },
    },
  },
});
