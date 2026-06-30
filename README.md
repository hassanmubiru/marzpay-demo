# StreetJS + MarzPay Demo

An end-to-end mobile-money payment demo built on the [StreetJS](https://www.npmjs.com/package/streetjs)
backend framework and the official [`@streetjs/plugin-marzpay`](https://www.npmjs.com/package/@streetjs/plugin-marzpay)
plugin, running against the **real MarzPay sandbox** (no mocked payment responses).

It ships **two frontends over one backend** and runs both locally (long-running
server) and on **Vercel** (serverless), persisting either to StreetJS's built-in
SQLite (local) or to **Supabase** (production) via
[`@streetjs/plugin-supabase`](https://www.npmjs.com/package/@streetjs/plugin-supabase).

- **Server-rendered UI** at `/` — the canonical spec demo (fixed 5,000 UGX).
- **React SPA** at `/app` — built with [`@streetjs/client`](https://www.npmjs.com/package/@streetjs/client)
  + [`@streetjs/react`](https://www.npmjs.com/package/@streetjs/react); supports a
  **user-selected amount (500 – 1,000,000 UGX)** and **local or international**
  phone numbers.
- **JSON API** at `/api/*` — consumed by the SPA.

> **Live demo:** https://streetjs-marzpay.vercel.app (server-rendered) ·
> https://streetjs-marzpay.vercel.app/app (React SPA)

## Documentation

| Doc | What's inside |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Components, request lifecycle, persistence backends, deployment topology |
| [docs/api.md](docs/api.md) | JSON API reference (`/api/checkout`, `/api/payments/:reference`) |
| [docs/configuration.md](docs/configuration.md) | All environment variables and the SQLite ↔ Supabase switch |
| [docs/local-development.md](docs/local-development.md) | Running the backend and the SPA dev server locally |
| [DEPLOY.md](DEPLOY.md) | Deploying to Vercel + Supabase, step by step |

## Quick start (local)

```bash
git clone <repository-url>
cd marzpay-demo
npm install
cp .env.example .env          # then add your MarzPay sandbox keys
npm run dev                   # builds (tsc) and starts the server on PORT
```

Open **http://localhost:3000** (server-rendered) and **http://localhost:3000/app**
(React SPA). With no Supabase vars set, the app uses the built-in SQLite store.

To develop the SPA with hot reload (Vite proxies `/api` to the backend on :3000):

```bash
cd web && npm install && npm run dev   # http://localhost:5173/app
```

See [docs/local-development.md](docs/local-development.md) for details.

## Features

- Real MarzPay sandbox mobile-money collection (`collections.collectMoney`).
- Authoritative completion via `collections.getStatus` + `transactions.get`
  (the webhook signature is best-effort — see [below](#webhook-signature-limitation)).
- Idempotent persistence keyed by a generated reference.
- Two persistence backends, chosen at runtime: built-in SQLite (local) and
  Supabase append-only events (serverless) — see
  [docs/architecture.md](docs/architecture.md#persistence).
- Configurable amount (500–1,000,000 UGX) and local/international phone
  normalization on the SPA + API path.
- Fast deterministic test suite (unit + property-based) plus live-sandbox
  integration tests.

## Configuration (summary)

The app validates configuration **before** binding a port; missing/invalid
required variables abort startup and name every offending variable.

| Variable | Required | Purpose |
| --- | --- | --- |
| `MARZPAY_API_KEY` | yes | MarzPay sandbox API key |
| `MARZPAY_SECRET_KEY` | yes | MarzPay sandbox secret key |
| `MARZPAY_ENVIRONMENT` | no (default `sandbox`) | `sandbox` or `production` |
| `APP_URL` | yes | Public base URL |
| `PORT` | yes | TCP port (1–65535) |
| `SUPABASE_URL` | no | Enables the Supabase store when set |
| `SUPABASE_KEY` | no | Supabase service-role (or anon) key |

Full details, including how the SQLite ↔ Supabase switch works, are in
[docs/configuration.md](docs/configuration.md).

## End-to-end payment flow

1. Customer chooses an amount (SPA) / uses the fixed amount (server-rendered),
   enters a phone number, and submits.
2. The checkout handler validates input and calls
   `marzpay.collections.collectMoney({ amount, country: 'UG', reference, phone_number })`
   against the MarzPay sandbox, then persists a `pending` record keyed by the
   generated reference.
3. The customer approves the mobile-money prompt on their phone.
4. MarzPay POSTs a webhook to `/webhooks/marzpay`.
5. The webhook handler validates the request (best-effort), then authoritatively
   confirms via `collections.getStatus(reference)`; on a completed status it
   reads `transactions.get(reference)` for the confirmed amount/currency.
6. The confirmed payment is recorded as completed (idempotently).
7. The success page / SPA shows the stored payment — "Payment Successful" only
   once the stored status is completed.

## Webhook signature limitation

The MarzPay webhook **signature scheme** is a documented limitation of
`@streetjs/plugin-marzpay`. `validateWebhook(rawBody, signature)` is therefore a
**best-effort gate only** — never the sole basis for completion. Completion is
**authoritatively confirmed** via `collections.getStatus(reference)` (status) and
`transactions.get(reference)` (amount/currency) before a payment is marked
complete, and is derived from the returned status value rather than any assumed
event name.

## Testing

```bash
npm test            # vitest --run (unit + property-based + smoke + integration)
```

Property tests use `fast-check` (≥100 runs each); only the MarzPay client
boundary is stubbed and SQLite runs in-memory, so the helpers, controllers, and
store are exercised deterministically. Live-sandbox integration tests run only
when real credentials are present and skip cleanly otherwise.

## Project structure

```
src/
  server.ts                 Bootstrap, app assembly, serverless handler
  config.ts                 Pure env validation
  controllers/              Home, Checkout, Webhook, Success (server-rendered)
                            + api.controller.ts (JSON API for the SPA)
  services/marzpay-*.ts     Pure helpers + MarzPay client types
  db/                       payments.ts (SQLite), supabase-store.ts, store.ts (facade)
  web-static.ts             Serves the built SPA under /app
  views/                    Server-rendered HTML templates
web/                        React SPA (Vite + @streetjs/client + @streetjs/react)
supabase/schema.sql         Supabase table for the append-only store
test/                       Unit, property-based, smoke, and integration tests
```

## License

MIT
