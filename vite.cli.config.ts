import { readFileSync } from "node:fs";

import { defineConfig } from "vite";

const packageDocument = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version?: unknown;
};
const packageVersion = typeof packageDocument.version === "string" ? packageDocument.version : "0.0.0";
const releaseVersion = process.env.NARROWSLINK_BUILD_VERSION?.trim() || packageVersion;
const releaseCommit = process.env.NARROWSLINK_BUILD_COMMIT?.trim() || "unknown";
const cliOutDir = process.env.NARROWSLINK_CLI_OUT_DIR?.trim() || "dist-cli";

export default defineConfig({
  define: {
    __NARROWSLINK_COMMIT__: JSON.stringify(releaseCommit),
    __NARROWSLINK_VERSION__: JSON.stringify(releaseVersion),
  },
  publicDir: false,
  build: {
    emptyOutDir: true,
    lib: {
      entry: "scripts/narrowslink.ts",
      formats: ["es"],
      fileName: () => "narrowslink.mjs",
    },
    minify: false,
    outDir: cliOutDir,
    rollupOptions: {
      external: [/^node:/],
      output: {
        banner: "#!/usr/bin/env node",
      },
    },
    sourcemap: false,
    target: "node20",
  },
});
