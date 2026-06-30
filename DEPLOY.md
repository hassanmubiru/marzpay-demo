# Deploying to Vercel + Supabase

This guide deploys the StreetJS + MarzPay demo to **Vercel** (serverless) with
**Supabase** (Postgres via PostgREST) as the durable store, using
[`@streetjs/plugin-supabase`](https://www.npmjs.com/package/@streetjs/plugin-supabase).

> **Status / honesty note.** The local app, the JSON API, the React SPA, and the
> full test suite are verified locally. The **serverless adapter** (`api/index.ts`
> wrapping `app._handleRequest`) and the **Supabase store** are code-complete but
> **untested against live Vercel/Supabase** — verify on a Vercel *preview*
> deployment before promoting to production. StreetJS has no official Vercel
> adapter; this wraps its documented in-process request handler.

## Architecture on serverless

- StreetJS normally runs a long-lived `app.listen()`. On Vercel, `api/index.ts`
  assembles the app once per cold start and routes every request to
  `app._handleRequest(req, res)`. `vercel.json` rewrites all paths to that
  function.
- The built-in SQLite is in-process (WASM MEMFS) and does **not** persist on
  serverless. When `SUPABASE_URL` + a Supabase key are set, the app switches to
  the Supabase store automatically (`src/db/store.ts`).
- The Supabase plugin supports only `select` + `insert`, so payments are stored
  **append-only** in `payment_events`; the current state is derived in code
  (`src/db/supabase-store.ts`). Re-delivered webhooks are idempotent (a duplicate
  completed event is skipped).

## 0. Prerequisites

- A [Supabase](https://supabase.com) project.
- A [Vercel](https://vercel.com) account + the Vercel CLI (`npm i -g vercel`).
- **Rotate your MarzPay keys first.** The `.env` was committed earlier in git
  history; generate fresh sandbox keys before deploying anything public.

## 1. Supabase: create the table

1. Open your Supabase project → **SQL Editor**.
2. Paste and run [`supabase/schema.sql`](./supabase/schema.sql). This creates
   `public.payment_events` and its index.
3. Project URL and keys live under **Project Settings → API**:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` secret → `SUPABASE_KEY` (server-side only; bypasses RLS).
     If you instead use the `anon` key, enable RLS and add the policies shown
     (commented) in `schema.sql`.

## 2. Configure environment variables (Vercel)

In the Vercel project (**Settings → Environment Variables**), set:

| Variable | Value | Notes |
|----------|-------|-------|
| `MARZPAY_API_KEY` | your sandbox API key | required |
| `MARZPAY_SECRET_KEY` | your sandbox secret key | required |
| `MARZPAY_ENVIRONMENT` | `sandbox` | optional (defaults to `sandbox`) |
| `APP_URL` | your Vercel URL, e.g. `https://your-app.vercel.app` | required |
| `PORT` | `3000` | required by config validation; unused by the serverless function |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | switches the app to Supabase |
| `SUPABASE_KEY` | service_role (or anon) key | server-side secret |

## 3. Deploy

From the project root:

```bash
vercel            # first run: link/create the project (preview deploy)
vercel --prod     # promote to production
```

Vercel runs `npm run vercel-build`, which:
1. `tsc` → compiles the backend to `dist/`,
2. builds the React SPA → `web/dist/` (included in the function via
   `vercel.json` `includeFiles`).

## 4. Verify the preview deployment

```bash
BASE=https://<your-preview-url>

curl -s -o /dev/null -w "home=%{http_code}\n"  "$BASE/"
curl -s -o /dev/null -w "spa=%{http_code}\n"   "$BASE/app"
curl -s "$BASE/api/payments/none"   # expect {"error":"payment not found"} 404
curl -s -X POST "$BASE/api/checkout" -H 'Content-Type: application/json' \
  -d '{"phone_number":""}'           # expect 400 valid-phone-required
```

Then open `$BASE/app`, submit a sandbox phone number, approve the prompt, and
confirm a `payment_events` row appears in Supabase (Table Editor) and the SPA
flips to **Payment Successful** after the webhook + `getStatus` confirmation.

## 5. MarzPay webhook

Point your MarzPay sandbox webhook at:

```
https://<your-prod-url>/webhooks/marzpay
```

## Troubleshooting

- **500 `server_initialization_failed`** — usually a missing/invalid env var
  (config validation aborts startup). Check all required vars above.
- **SPA 404 under `/app`** — `web/dist` wasn't included in the function; confirm
  `vercel-build` ran the web build and `includeFiles` is set in `vercel.json`.
- **Supabase reads/writes fail** — confirm `payment_events` exists, the key is
  correct, and (if using the anon key) RLS policies are in place.
- **Status never completes** — completion is authoritative via
  `collections.getStatus`; ensure the webhook reaches `/webhooks/marzpay` and
  the phone prompt was approved.
