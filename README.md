# StreetJS + MarzPay Demo

An end-to-end mobile-money payment demo built on the [StreetJS](https://www.npmjs.com/package/streetjs)
backend framework and the official [`@streetjs/plugin-marzpay`](https://www.npmjs.com/package/@streetjs/plugin-marzpay)
plugin, running against the **real MarzPay sandbox** (no mocked payment responses).

It ships **two frontends over one backend**, runs both locally (long-running
server) and on **Vercel** (serverless), and persists either to StreetJS's
built-in SQLite (local) or to **Supabase** (production) via
[`@streetjs/plugin-supabase`](https://www.npmjs.com/package/@streetjs/plugin-supabase).

- **Server-rendered UI** at `/` — the canonical spec demo (fixed 5,000 UGX).
- **React SPA** at `/app` — built with [`@streetjs/client`](https://www.npmjs.com/package/@streetjs/client)
  + [`@streetjs/react`](https://www.npmjs.com/package/@streetjs/react); supports a
  **user-selected amount (500–1,000,000 UGX)** and **local or international**
  phone numbers.
- **JSON API** at `/api/*` — consumed by the SPA.

> **Live demo:** https://streetjs-marzpay.vercel.app · SPA: https://streetjs-marzpay.vercel.app/app

## Documentation

| Doc | What's inside |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Components, request lifecycle, persistence backends, deployment topology |
| [docs/api.md](docs/api.md) | JSON API reference (`/api/checkout`, `/api/payments/:reference`) |
| [docs/configuration.md](docs/configuration.md) | Every environment variable and the SQLite ↔ Supabase switch |
| [docs/local-development.md](docs/local-development.md) | Running the backend and the SPA dev server locally |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common issues (Vercel crashes, cold starts, webhooks, SPA types) and fixes |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Dev setup, conventions, and test expectations |
| [DEPLOY.md](DEPLOY.md) | Deploying to Vercel + Supabase, step by step |

## Setup

Follow these steps in order. Each step shows the literal command to run.

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   ```

2. **Change into the project directory**

   ```bash
   cd marzpay-demo
   ```

3. **Install dependencies**

   ```bash
   npm install streetjs @streetjs/plugin-marzpay
   ```

   > Alternatively, add the MarzPay plugin to a StreetJS project with the
   > StreetJS CLI:
   >
   > ```bash
   > street add marzpay
   > ```
   >
   > For this repository, `npm install` (no arguments) installs everything the
   > backend needs; the React SPA in `web/` has its own dependencies (see
   > [docs/local-development.md](docs/local-development.md)).

4. **Copy the example environment file**

   ```bash
   cp .env.example .env
   ```

5. **Add your sandbox keys to `.env`**

   Set `MARZPAY_API_KEY` and `MARZPAY_SECRET_KEY` to your MarzPay sandbox
   credentials (see [Obtaining sandbox credentials](#obtaining-marzpay-sandbox-credentials)).

6. **Run the development server**

   ```bash
   npm run dev
   ```

After `npm run dev` starts, the app is reachable at the URL given by the
`APP_URL` environment variable, which points at the host and `PORT` the server
binds to. With the defaults (`APP_URL=http://localhost:3000`, `PORT=3000`), open
**http://localhost:3000** (server-rendered) and **http://localhost:3000/app**
(React SPA). If you change `PORT`, set `APP_URL` to the matching
`http://localhost:<PORT>` so the two stay consistent.

With no Supabase variables set, the app uses the built-in SQLite store. Setting
`SUPABASE_URL` + a Supabase key switches it to the durable Supabase store — see
[docs/configuration.md](docs/configuration.md).

## Environment Variables

The app reads these from the environment at startup (loaded from `.env` in local
development) and validates them **before** binding to any port; if a mandatory
variable is missing/empty or invalid, startup terminates and names every
offending variable.

| Variable | Mandatory at startup | Purpose |
| --- | --- | --- |
| `MARZPAY_API_KEY` | Yes | MarzPay sandbox API key, used as `apiKey` when installing the MarzPay plugin. |
| `MARZPAY_SECRET_KEY` | Yes | MarzPay sandbox secret key, used as `secretKey` when installing the MarzPay plugin. |
| `MARZPAY_ENVIRONMENT` | No — optional, defaults to `sandbox` | Selects the MarzPay target; must be exactly `sandbox` or `production` when set. When absent or empty it resolves to `sandbox`. |
| `APP_URL` | Yes | Public base URL of the app, used to build the success-page URL and the address the app is reached at. |
| `PORT` | Yes | TCP port the server binds to; must be an integer between 1 and 65535 inclusive. |
| `SUPABASE_URL` | No | When set (with a key), switches persistence to the Supabase store. |
| `SUPABASE_KEY` | No | Supabase service-role (preferred) or anon key. `SUPABASE_SERVICE_ROLE_KEY` is also accepted. |

Full details are in [docs/configuration.md](docs/configuration.md).

## Obtaining MarzPay Sandbox Credentials

`MARZPAY_API_KEY` and `MARZPAY_SECRET_KEY` are your MarzPay **sandbox**
credentials. Retrieve them from your **MarzPay sandbox dashboard**: sign in,
switch to the sandbox environment, and copy the API key and secret key from the
API credentials section into your `.env`. The credentials are sent as HTTP Basic
auth over HTTPS when the plugin talks to the sandbox.

## JSON API (summary)

The SPA talks to a small JSON API; full reference in [docs/api.md](docs/api.md).

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/checkout` | Start a collection for `{ phone_number, amount }`; returns the pending payment. |
| `GET` | `/api/payments/:reference` | Fetch the current payment for a reference. |

`amount` must be a whole number of UGX in `[500, 1000000]`; `phone_number`
accepts local (`0700000000`) and international (`+256700000000`) formats.

## End-to-End Payment Flow

The complete mobile-money flow proceeds in this order:

1. **Enter phone and click "Pay".** The customer opens the Home page, enters their mobile-money phone number, and clicks the "Pay 5000 UGX" button, which submits the phone number to the Checkout handler.
2. **Initiate the collection against the sandbox.** The Checkout handler validates the phone number and calls `marzpay.collections.collectMoney({ amount: 5000, country: 'UG', reference, phone_number })` against the MarzPay sandbox, then persists a `pending` payment record keyed by the generated reference and directs the customer to the success page.
3. **Approve the prompt on the phone.** The customer approves the mobile-money payment prompt on their phone.
4. **Webhook delivery.** MarzPay sends a webhook to the Webhook handler at `POST /webhooks/marzpay`.
5. **Validate and authoritatively confirm.** The Webhook handler validates the inbound webhook (best-effort) and then authoritatively confirms completion by calling `collections.getStatus(reference)`. Only when the returned status indicates a completed/successful payment does it read `transactions.get(reference)` for the confirmed amount and currency.
6. **Persist the confirmed payment.** The confirmed payment is recorded as completed in the built-in SQLite payment store (idempotently, so re-delivered webhooks never create duplicates).
7. **Success page.** The customer's success page (`/success?reference=<reference>`) displays the stored payment: its reference, the amount and currency, and the status. It shows "Payment Successful" once the stored status is completed, and an awaiting-approval message while the payment is still `pending`.

> The React SPA at `/app` follows the same flow but lets the customer pick the
> amount (500–1,000,000 UGX) and accepts local or international phone formats.

## Deployment

The app runs serverless on Vercel with Supabase as the durable store. See
[DEPLOY.md](DEPLOY.md) for the full runbook and [docs/architecture.md](docs/architecture.md#deployment-topology)
for how the serverless entrypoint and persistence fit together.

## Testing

```bash
npm test            # vitest --run
```

Property tests use `fast-check` (≥100 runs each); only the MarzPay client
boundary is stubbed and SQLite runs in-memory, so the helpers, controllers, and
store are exercised deterministically. Live-sandbox integration tests run only
when real credentials are present and skip cleanly otherwise.

## Webhook Signature Limitation

The MarzPay webhook **signature scheme** is a documented limitation of the
`@streetjs/plugin-marzpay` plugin. `validateWebhook(rawBody, signature)` is
therefore a **best-effort gate** — never the sole basis for marking a payment
complete. Completion is instead **authoritatively confirmed** by calling
`collections.getStatus(reference)` (to determine the completed/successful
status) together with `transactions.get(reference)` (to read the confirmed
amount and currency) before any payment is recorded as completed. Completion is
derived from the returned status value rather than from any assumed webhook
event name, which is likewise undocumented.

## License

MIT
