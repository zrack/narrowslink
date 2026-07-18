import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs", "verifier/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
