import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: true,
    lib: {
      entry: "scripts/narrowslink.ts",
      formats: ["es"],
      fileName: () => "narrowslink.mjs",
    },
    minify: false,
    outDir: "dist-cli",
    rollupOptions: {
      external: [/^node:/],
      output: {
        banner: "#!/usr/bin/env node",
      },
    },
    sourcemap: true,
    target: "node20",
  },
});
