import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// No Tailwind plugin here (unlike token-metering/frontend) - this build
// ports design.css literally rather than reinterpreting it as utility
// classes. outDir stays Vite's default ("dist") rather than a served
// static/ path - this phase's frontend isn't wired into any served command
// yet (REQUIREMENTS.md's Constraints), so there's nothing to point it at.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    globals: true,
  },
});
