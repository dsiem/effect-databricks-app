import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    port: 5186,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
});
