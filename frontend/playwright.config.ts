import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Two independent server.py instances back this suite, same split as
// token-metering/frontend's playwright.config.ts: "populated" (seeded via
// e2e/fixtures/seed.py, under a scratch HOME so server.py's import-time
// DEFAULT_CLAUDE_PROJECTS_DIR/DEFAULT_KNOWN_PROJECTS_PATH resolution can't
// pick up this machine's real projects - the same isolation gap that
// caused a real-data leak during phase 5's manual testing) and "cold-start"
// (an empty, never-seeded project root).
//
// Unlike token-metering, mission-control/server.py's static_dir isn't
// wired to this frontend's build output yet (see vite.config.ts's own
// comment) - that wiring is deferred to a later phase, not this one. So
// each fixture runs two processes instead of one: server.py serving just
// the JSON API, and `vite preview` serving the built `dist/` with
// `/api` proxied to that API port (vite.config.ts's `preview.proxy`,
// pointed here via the `E2E_API_TARGET` env var). `npm run build` must
// still precede `playwright test` - `vite preview` serves whatever's
// already in `dist/`, it doesn't build it.
const FRONTEND_ROOT = path.dirname(fileURLToPath(import.meta.url));
const MISSION_CONTROL_ROOT = path.resolve(FRONTEND_ROOT, "..");
const SCRATCH_ROOT = path.resolve(FRONTEND_ROOT, ".e2e-scratch");
const POPULATED_SCRATCH = path.join(SCRATCH_ROOT, "populated");
const COLD_START_SCRATCH = path.join(SCRATCH_ROOT, "cold-start");
const COLD_START_ROOT = path.join(COLD_START_SCRATCH, "project");

const POPULATED_API_PORT = 4417;
const POPULATED_PORT = 4418;
const COLD_START_API_PORT = 4419;
const COLD_START_PORT = 4420;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "populated",
      testDir: "./e2e/populated",
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${POPULATED_PORT}` },
    },
    {
      name: "cold-start",
      testDir: "./e2e/cold-start",
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${COLD_START_PORT}` },
    },
  ],
  webServer: [
    {
      command: `python3 e2e/fixtures/seed.py "${POPULATED_SCRATCH}" && python3 "${MISSION_CONTROL_ROOT}/server.py" "${POPULATED_SCRATCH}/project" ${POPULATED_API_PORT}`,
      url: `http://127.0.0.1:${POPULATED_API_PORT}/api/projects`,
      cwd: FRONTEND_ROOT,
      env: { HOME: POPULATED_SCRATCH },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // `--host 127.0.0.1`: `vite preview` binds "localhost" (IPv6-first
      // under Node) without it, so a plain `http://127.0.0.1:<port>`
      // health-check/baseURL - what this config and server.py's own
      // DEFAULT_HOST both use - would otherwise get connection-refused.
      command: `npm run preview -- --port ${POPULATED_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${POPULATED_PORT}/`,
      cwd: FRONTEND_ROOT,
      env: { E2E_API_TARGET: `http://127.0.0.1:${POPULATED_API_PORT}` },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `python3 "${MISSION_CONTROL_ROOT}/server.py" "${COLD_START_ROOT}" ${COLD_START_API_PORT}`,
      url: `http://127.0.0.1:${COLD_START_API_PORT}/api/projects`,
      cwd: FRONTEND_ROOT,
      // Overridden too (not left pointing at the real machine's HOME) so
      // DEFAULT_KNOWN_PROJECTS_PATH/DEFAULT_CLAUDE_PROJECTS_DIR (both
      // computed once from Path.home() at import time) can't pick up stray
      // real projects and break the hermetic empty-state fixture.
      env: { HOME: COLD_START_SCRATCH },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npm run preview -- --port ${COLD_START_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${COLD_START_PORT}/`,
      cwd: FRONTEND_ROOT,
      env: { E2E_API_TARGET: `http://127.0.0.1:${COLD_START_API_PORT}` },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
