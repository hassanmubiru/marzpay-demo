# Configuration

All configuration is via environment variables, loaded from `.env` locally (and
from the platform's env in deployment). A pure validator (`src/config.ts`,
`validateConfig`) checks them **before** the server binds a port; if a mandatory
variable is missing/empty or invalid, startup aborts and prints **every**
offending variable.

## Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MARZPAY_API_KEY` | yes | — | MarzPay sandbox API key (`apiKey` for the plugin). |
| `MARZPAY_SECRET_KEY` | yes | — | MarzPay sandbox secret key (`secretKey` for the plugin). |
| `MARZPAY_ENVIRONMENT` | no | `sandbox` | `sandbox` or `production`. Absent/empty → `sandbox`; any other value is rejected. |
| `APP_URL` | yes | — | Public base URL (used for the success-page URL and the reachable address). |
| `PORT` | yes | — | TCP port to bind; integer in `[1, 65535]`. |
| `SUPABASE_URL` | no | — | Supabase project URL, e.g. `https://xxxx.supabase.co`. Enables the Supabase store. |
| `SUPABASE_KEY` | no | — | Supabase API key. Prefer the service-role key (server-side, bypasses RLS). |
| `SUPABASE_SERVICE_ROLE_KEY` | no | — | Accepted as an alternative to `SUPABASE_KEY`. |
| `SPA_DIST_DIR` | no | auto | Override the directory the built SPA is served from (rarely needed). |
| `PAYMENTS_DB_PATH` | no | `payments.db` | SQLite file path (local store only). Use `:memory:` for ephemeral. |

## Validation rules

- **Required** (`MARZPAY_API_KEY`, `MARZPAY_SECRET_KEY`, `APP_URL`, `PORT`):
  absent or empty string ⇒ offending.
- **`PORT`**: must parse to an integer in `[1, 65535]`; otherwise offending.
- **`MARZPAY_ENVIRONMENT`**: absent/empty ⇒ resolves to `sandbox`; exactly
  `sandbox`/`production` accepted; any other non-empty value ⇒ offending.
- The error list names **every** offending variable at once.

## Persistence: SQLite ↔ Supabase

The store facade (`src/db/store.ts`) decides the backend at call time:

```ts
usingSupabase() === Boolean(
  process.env.SUPABASE_URL &&
  (process.env.SUPABASE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)
);
```

- **Neither set** → built-in SQLite (`payments.db`, or in-memory in tests).
  Good for local development and the test suite.
- **Both set** → Supabase append-only store via `@streetjs/plugin-supabase`.
  Required on serverless (Vercel), where the in-process WASM SQLite does not
  persist across invocations.

The Supabase table is created out-of-band (PostgREST cannot run DDL) by running
[`supabase/schema.sql`](../supabase/schema.sql) in the Supabase SQL editor.

### Choosing the Supabase key

- **Service-role key** (recommended): server-side only; bypasses Row Level
  Security, so no policies are needed. Never expose it to the browser.
- **Anon key**: enable RLS and add `select`/`insert` policies on
  `payment_events` (commented examples are in `supabase/schema.sql`).

## Example `.env`

```dotenv
MARZPAY_API_KEY=your-sandbox-api-key
MARZPAY_SECRET_KEY=your-sandbox-secret-key
MARZPAY_ENVIRONMENT=sandbox
APP_URL=http://localhost:3000
PORT=3000

# Optional — enable the durable Supabase store
SUPABASE_URL=
SUPABASE_KEY=
```

See [`.env.example`](../.env.example) for the tracked template, and
[DEPLOY.md](../DEPLOY.md) for the Vercel environment-variable setup.

## Notes on Vercel

- Vercel's `node` framework does **not** auto-inject `PORT`/`APP_URL`; set both
  in the project's environment variables (e.g. `PORT=3000`,
  `APP_URL=https://<your-app>.vercel.app`).
- Set `SUPABASE_URL` and `SUPABASE_KEY` so the deployed app uses Supabase rather
  than the (non-persistent) SQLite store.
