## Gates
- `pytest` clean before any commit
- Frontend: `npm run build` and `npm test` inside `frontend/` clean before any commit
- Frontend: `npm run e2e` inside `frontend/` (builds, then runs `playwright test`) clean before any commit
- One artifact per commit

## Testing
- Frontend: `frontend/e2e/` (Playwright) against two `server.py` instances started by `playwright.config.ts` - "populated" (seeded by `e2e/fixtures/seed.py` via `db.py`'s insert helpers) and "cold-start" (an empty, never-seeded project root). Neither instance's build is wired into server.py's static route yet (that wiring is deferred, not this suite's job) - each fixture instead runs `vite preview` against the built `dist/`, proxying `/api` to its own `server.py` port (`vite.config.ts`'s `preview.proxy`, `E2E_API_TARGET`-driven). `npm run build` must precede `playwright test` - `vite preview` serves whatever's already in `dist/`.
