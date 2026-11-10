import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React app lives in web/ and builds to web/dist, which Express serves.
// In development Vite serves the UI on :5180 (WEB_PORT) and forwards API and
// PayPal redirect routes to the Express server on :3000 (PORT).
const backend = `http://localhost:${process.env.PORT || 3000}`;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    // Fixed port: PayPal returns the buyer to BASE_URL, which `npm run dev` sets to this address.
    port: Number(process.env.WEB_PORT || 5180),
    strictPort: true,
    proxy: {
      '/api': backend,
      '/paypal': backend,
      '/sim': backend,
    },
  },
});
