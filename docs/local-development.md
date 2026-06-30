# Local Development

This guide covers running the backend and the React SPA on your machine.

## Prerequisites

- Node.js >= 20
- MarzPay **sandbox** credentials (`MARZPAY_API_KEY`, `MARZPAY_SECRET_KEY`)

## 1. Install and configure

```bash
npm install
cp .env.example .env
```

Edit `.env` and set at least `MARZPAY_API_KEY`, `MARZPAY_SECRET_KEY`, `APP_URL`,
and `PORT`. Leave the `SUPABASE_*` variables blank to use the local SQLite store.
See [configuration.md](configuration.md) for every variable.

## 2. Run the backend

```bash
npm run dev      # tsc && node dist/server.js
```

This builds the TypeScript backend to `dist/` and starts the server. On startup
it logs the active persistence backend, for example:

```
StreetJS + MarzPay demo listening on http://0.0.0.0:3000 (MarzPay environment: sandbox)
  - Server-rendered UI:  http://localhost:3000/
  - React SPA (SDK):     http://localhost:3000/app
  - Persistence:         built-in SQLite
```

- Server-rendered UI: http://localhost:3000/
- React SPA (served from the last `web/dist` build): http://localhost:3000/app

> Note: StreetJS's built-in SQLite is an in-process WASM database and does not
> persist to a real file across restarts. For durable local storage, configure
> Supabase (see [configuration.md](configuration.md)).

## 3. Develop the React SPA (hot reload)

The SPA lives in `web/` (Vite + React + `@streetjs/client` + `@streetjs/react`).
For an iterative dev loop, run the backend (step 2) **and** the Vite dev server:

```bash
cd web
npm install
npm run dev      # Vite on http://localhost:5173/app
```

Vite is configured with `base: '/app/'` and proxies `/api` to the backend on
`http://localhost:3000`, so the SPA's API calls reach the running backend. Open
**http://localhost:5173/app**.

To produce the production SPA bundle the backend serves at `/app`:

```bash
cd web && npm run build   # outputs web/dist
```

## 4. Run the tests

```bash
npm test         # vitest --run
```

- Unit + property-based tests (`fast-check`, ≥100 runs) stub only the MarzPay
  client boundary and run SQLite in-memory.
- Smoke/config tests check project artifacts and the README.
- Live-sandbox integration tests run only when real credentials are present and
  skip cleanly otherwise. To run them, ensure `MARZPAY_API_KEY` /
  `MARZPAY_SECRET_KEY` are set; set `MARZPAY_TEST_PHONE` to drive the live
  `collectMoney` path.

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Build backend and start the server |
| `npm run build` | Compile the backend (`tsc`) to `dist/` |
| `npm run build:web` | Install + build the React SPA into `web/dist` |
| `npm run vercel-build` | Backend + SPA build (used by Vercel) |
| `npm test` | Run the full test suite |

## Exercising the full flow locally

1. Open `/app`, choose an amount and enter a sandbox phone number, submit.
2. Approve the prompt on the phone (real sandbox).
3. Point your MarzPay sandbox webhook at `http(s)://<your-host>/webhooks/marzpay`
   (use a tunnel such as ngrok if testing from your machine) so the completion
   leg runs.
4. The SPA polls `/api/payments/:reference` and flips to "Payment Successful"
   once the webhook + `getStatus` confirm completion.
