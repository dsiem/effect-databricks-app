import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  cacheDir: fileURLToPath(
    new URL("../../node_modules/.vite-saved-view-study", import.meta.url),
  ),
  server: { host: "127.0.0.1", port: 5188, strictPort: true },
});
