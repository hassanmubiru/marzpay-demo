# Contributing

Thanks for working on the StreetJS + MarzPay demo. This guide covers the dev
setup, conventions, and the test expectations.

## Getting started

```bash
npm install
cp .env.example .env     # add MarzPay sandbox keys
npm run dev
```

See [docs/local-development.md](docs/local-development.md) for the full loop
(backend + Vite SPA) and [docs/configuration.md](docs/configuration.md) for env
vars.

## Project layout

- `src/` — StreetJS backend (TypeScript, ESM, decorators).
  - `config.ts` — pure env validation.
  - `controllers/` — server-rendered controllers + `api.controller.ts` (JSON).
  - `services/marzpay-helpers.ts` — pure helpers (no network/framework).
  - `db/` — `payments.ts` (SQLite), `supabase-store.ts`, `store.ts` (facade).
  - `server.ts` — bootstrap, app assembly, and the Vercel default-export handler.
- `web/` — React SPA (Vite, `@streetjs/client`, `@streetjs/react`).
- `supabase/schema.sql` — Supabase table for the append-only store.
- `test/` — unit, property-based, smoke, and integration tests.
- `docs/` — architecture, API, configuration, local dev, troubleshooting.

## Conventions

- **Keep logic pure where possible.** Network/framework concerns live in
  controllers and the plugin client; deterministic logic (validation, parsing,
  normalization, status interpretation) goes in `services/marzpay-helpers.ts` so
  it can be property-tested.
- **The payment store is a facade.** Don't import `payments.ts` or
  `supabase-store.ts` directly from controllers — use `db/store.ts` so the
  SQLite ↔ Supabase switch keeps working.
- **MarzPay is the integration boundary.** Call it via `ctx.state.marzpay`;
  don't hand-roll HTTP.
- **Two surfaces, one backend.** The server-rendered pages at `/` are the
  canonical spec demo (fixed 5,000 UGX) and are covered by strict spec tests —
  prefer adding new capability on the SPA + JSON API path unless you also update
  the spec and its tests.
- **TypeScript:** ESM + NodeNext on the backend; strict mode. Match the existing
  style (small focused functions, JSDoc on exported symbols).

## Testing

```bash
npm test          # vitest --run
```

- **Property-based tests** use `fast-check` with **≥100 runs** (`numRuns: 100`)
  and a tag comment `// Feature: streetjs-marzpay-demo, Property N: …`. Only the
  MarzPay client boundary is stubbed; SQLite runs in-memory.
- **Add tests for new logic.** New pure helpers should get unit and/or property
  tests; new endpoints should get controller tests.
- **Don't break the spec tests.** The README content test and the home/checkout/
  success/webhook spec tests encode `Requirements`. If a change legitimately
  alters a requirement, update the spec docs and the corresponding test together.
- **Live-sandbox tests** must skip cleanly without credentials (`skipIf`).

Before opening a PR:

```bash
npx tsc            # backend type-check (exit 0)
cd web && npm run build   # SPA type-check + build
npm test           # full suite green
```

## Commits & pull requests

- Work on a feature branch; open a PR against `main`.
- Keep PRs focused; describe what changed, what was tested, and any tradeoffs.
- Don't commit secrets. `.env` is git-ignored; only `.env.example` is tracked.
- If you touch deployment, validate on a Vercel **preview** before production
  (see [DEPLOY.md](DEPLOY.md)).

## Security notes

- Never expose the Supabase **service-role** key to the browser; it's
  server-side only.
- Rotate MarzPay/Supabase keys if they are ever committed or shared.
- The demo's endpoints are public when Deployment Protection is off — don't put
  production credentials behind a public sandbox demo.
