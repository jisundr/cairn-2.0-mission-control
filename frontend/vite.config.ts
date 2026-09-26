import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// No Tailwind plugin here (unlike token-metering/frontend) - this build
// ports design.css literally rather than reinterpreting it as utility
// classes. outDir stays Vite's default ("dist") rather than a served
// static/ path - this phase's frontend isn't wired into any served command
// yet (REQUIREMENTS.md's Constraints), so there's nothing to point it at.
//
// `preview.proxy` forwards `/api` to a `server.py` instance: server.py does
// have its own static_dir route (STATIC_DIR_NAME, same mechanism as
// token-metering/server.py's), but pointing this build's outDir at it would
// be the "wire into a served command" step this phase still defers - so
// e2e coverage instead runs the built `dist/` through `vite preview` and
// proxies just the API, leaving that deferral intact. `E2E_API_TARGET`
// lets playwright.config.ts point each of its two preview instances at its
// own server.py port; unset (a bare `npm run preview` against a manually
// started `python3 server.py`), it falls back to server.py's own
// DEFAULT_PORT.
export default defineConfig({
  plugins: [react()],
  preview: {
    proxy: {
      "/api": process.env.E2E_API_TARGET || "http://127.0.0.1:4317",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    globals: true,
    // Vitest's default excludes don't cover e2e/ - without this it also
    // tries (and fails) to collect the Playwright specs there, which use
    // their own `test()`/`test.describe()` from @playwright/test.
    exclude: ["e2e/**", "node_modules/**"],
  },
});
