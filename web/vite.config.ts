import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// On GitHub Pages the app is served from /<repo-name>/.
// Pass VITE_BASE in CI; defaults to '/' for local dev.
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [svelte()],
});
