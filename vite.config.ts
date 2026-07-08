import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built app works from any static-hosting subpath.
  base: './',
  server: {
    host: true,
    port: 5175,
  },
});
