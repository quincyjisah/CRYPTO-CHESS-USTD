import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
