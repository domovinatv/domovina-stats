// vite.config.ts — multi-page build: / (dashboard) + /map (vektorska mapa).
// CF Pages poslužuje map.html kao clean URL /map (kanonizira .html u 308).
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        map: resolve(import.meta.dirname, "map.html"),
      },
    },
  },
});
