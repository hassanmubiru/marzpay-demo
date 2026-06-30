# Troubleshooting

Real issues seen while building and deploying this demo, with the cause and the
fix. Grouped by where they show up.

## Startup / configuration

### "Configuration is invalid; the server cannot start: - PORT is required…"
`validateConfig` aborts before binding when a required variable is missing or
invalid. The message names every offending variable.

- **Fix:** set the named variables. On Vercel, `PORT` and `APP_URL` are **not**
  auto-injected by the `node` framework — set them explicitly (`PORT=3000`,
  `APP_URL=https://<your-app>.vercel.app`). See [configuration.md](configuration.md).

### App runs but payments don't persist across restarts (local)
The built-in SQLite is an in-process WASM database (`payments.db` is virtual),
so it resets per process.

- **Fix (durable):** configure Supabase (`SUPABASE_URL` + `SUPABASE_KEY`); the
  store switches automatically. See [configuration.md](configuration.md#persistence-sqlite--supabase).

## Vercel deployment

### `FUNCTION_INVOCATION_FAILED` (opaque 500 crash)
The function process terminated before returning. Common causes here:

1. **Missing env var** → `validateConfig` called `process.exit(1)`. Fix: set all
   required vars (see above) and redeploy.
2. **No default export** → Vercel's `node` framework imports `src/server.ts` and
   needs a default-export handler. This repo's `src/server.ts` exports one; if
   you refactor, keep it. Error in logs:
   `Invalid export found … default export must be a function or server`.

Read the real cause from the runtime logs (the public error page only shows an
ID):

```bash
vercel logs <deployment-url> --json | tail
# or: Vercel dashboard → Deployment → Runtime Logs
```

### Build log says "Using src/server.ts as the root entrypoint"
That's expected — the project's framework is `node`, so Vercel serves
`src/server.ts`'s default export and ignores any `api/` functions or `vercel.json`
rewrites. Route everything through the StreetJS app (it already handles `/`,
`/app`, `/api/*`, `/webhooks/marzpay`).

### Every request 302-redirects to a Vercel login
**Deployment Protection** (Vercel Authentication) is on; anonymous requests are
bounced to SSO before the function runs (so there are no runtime logs).

- **Fix:** Project → Settings → Deployment Protection → turn off Vercel
  Authentication for a public demo, or use a protection-bypass token for
  automated checks.

### First request after a deploy is slow (~5–10s)
Cold start: the MarzPay and Supabase plugins install on first invocation. The
app is cached on the warm instance, so subsequent requests are fast.

### SPA assets 404 under `/app`
`web/dist` wasn't built or wasn't included in the deployment.

- **Fix:** ensure `vercel-build` ran `npm run build:web`; the SPA dir is resolved
  from `process.cwd()` at runtime. Locally, run `cd web && npm run build`.

## Webhooks

### `GET /webhooks/marzpay` returns 404
Expected — the webhook route is **POST-only** (that's how MarzPay calls it). A
`POST` with no valid signature returns `401`, which confirms the route exists.

### Genuine webhooks get 401
The MarzPay webhook signature scheme is a documented plugin limitation, so
`validateWebhook` is best-effort. If real sandbox webhooks fail validation,
completion still works because it's authoritatively confirmed via
`collections.getStatus`. If you need to stop rejecting genuine events, relax the
signature gate while keeping the `getStatus` confirmation (open an issue/PR).

### Checkout returns `502 payment initiation failed`
`collectMoney` was rejected by the sandbox — often an unprovisioned test MSISDN
or an amount outside sandbox limits. Use a valid sandbox number; the error
handling is working as designed.

## React SPA / TypeScript

### `Cannot find type definition file for 'babel__core' / 'prop-types' …`
TypeScript was implicitly loading every `@types/*` package. `web/tsconfig.json`
sets `"types": []` (and `typeRoots`) to stop this; the compiler is clean.

- **If the editor still shows it:** it's a stale TS server program. Run
  **TypeScript: Restart TS Server** or reload the window.

## Tests

### Live-sandbox integration tests are skipped
They require real credentials. They `skipIf` when `MARZPAY_API_KEY` /
`MARZPAY_SECRET_KEY` are absent, and the `collectMoney` leg additionally needs
`MARZPAY_TEST_PHONE`. This is expected in CI without secrets.
