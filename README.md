# StreetJS + MarzPay Demo

A minimal, end-to-end demonstration that proves the [StreetJS](https://www.npmjs.com/package/streetjs) web framework integrates correctly with the official [`@streetjs/plugin-marzpay`](https://www.npmjs.com/package/@streetjs/plugin-marzpay) plugin against the **real MarzPay sandbox**.

The demo implements exactly one business flow: a customer enters a mobile-money phone number, clicks "Pay 5000 UGX", approves the prompt on their phone, and the app confirms and persists the completed payment before showing a success page. No fake APIs or mocked payment responses are used — the happy path exercises the genuine MarzPay sandbox over HTTPS.

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

   > Alternatively, you can add the MarzPay plugin to a StreetJS project with the StreetJS CLI:
   >
   > ```bash
   > street add marzpay
   > ```

4. **Copy the example environment file**

   ```bash
   cp .env.example .env
   ```

5. **Add your sandbox keys to `.env`**

   Open `.env` and set `MARZPAY_API_KEY` and `MARZPAY_SECRET_KEY` to your MarzPay sandbox credentials (see [Obtaining sandbox credentials](#obtaining-marzpay-sandbox-credentials)).

6. **Run the development server**

   ```bash
   npm run dev
   ```

After `npm run dev` starts, the running app is reachable at the URL given by the `APP_URL` environment variable, which points at the host and `PORT` the server binds to. With the defaults from `.env.example` (`APP_URL=http://localhost:3000` and `PORT=3000`), open **http://localhost:3000** in your browser. If you change `PORT`, set `APP_URL` to the matching `http://localhost:<PORT>` (or your public base URL) so the two stay consistent.

## Environment Variables

The app reads the following variables from the environment at startup (loaded from `.env` in local development). It validates them **before** binding to any port; if a mandatory variable is missing/empty or a value is invalid, startup terminates and names every offending variable.

| Variable | Mandatory at startup | Purpose |
| --- | --- | --- |
| `MARZPAY_API_KEY` | Yes | MarzPay sandbox API key, used as `apiKey` when installing the MarzPay plugin. |
| `MARZPAY_SECRET_KEY` | Yes | MarzPay sandbox secret key, used as `secretKey` when installing the MarzPay plugin. |
| `MARZPAY_ENVIRONMENT` | No — optional, defaults to `sandbox` | Selects the MarzPay target; must be exactly `sandbox` or `production` when set. When absent or empty it resolves to `sandbox`. |
| `APP_URL` | Yes | Public base URL of the app, used to build the success-page URL and the address the app is reached at. |
| `PORT` | Yes | TCP port the server binds to; must be an integer between 1 and 65535 inclusive. |

## Obtaining MarzPay Sandbox Credentials

`MARZPAY_API_KEY` and `MARZPAY_SECRET_KEY` are your MarzPay **sandbox** credentials. Retrieve them from your **MarzPay sandbox dashboard**: sign in to your MarzPay account, switch to the sandbox environment, and copy the API key and secret key from the API credentials section. Paste those two values into your `.env` file. The credentials are sent as HTTP Basic auth over HTTPS when the plugin talks to the sandbox.

## End-to-End Payment Flow

The complete mobile-money flow proceeds in this order:

1. **Enter phone and click "Pay".** The customer opens the Home page, enters their mobile-money phone number, and clicks the "Pay 5000 UGX" button, which submits the phone number to the Checkout handler.
2. **Initiate the collection against the sandbox.** The Checkout handler validates the phone number and calls `marzpay.collections.collectMoney({ amount: 5000, country: 'UG', reference, phone_number })` against the MarzPay sandbox, then persists a `pending` payment record keyed by the generated reference and directs the customer to the success page.
3. **Approve the prompt on the phone.** The customer approves the mobile-money payment prompt on their phone.
4. **Webhook delivery.** MarzPay sends a webhook to the Webhook handler at `POST /webhooks/marzpay`.
5. **Validate and authoritatively confirm.** The Webhook handler validates the inbound webhook (best-effort) and then authoritatively confirms completion by calling `collections.getStatus(reference)`. Only when the returned status indicates a completed/successful payment does it read `transactions.get(reference)` for the confirmed amount and currency.
6. **Persist the confirmed payment.** The confirmed payment is recorded as completed in the built-in SQLite payment store (idempotently, so re-delivered webhooks never create duplicates).
7. **Success page.** The customer's success page (`/success?reference=<reference>`) displays the stored payment: its reference, the amount and currency, and the status. It shows "Payment Successful" once the stored status is completed, and an awaiting-approval message while the payment is still `pending`.

## Webhook Signature Limitation

The MarzPay webhook **signature scheme** is a documented limitation of the `@streetjs/plugin-marzpay` plugin. Because of this, `validateWebhook(rawBody, signature)` is treated only as a **best-effort gate** — it is never the sole basis for marking a payment complete. Payment completion is instead **authoritatively confirmed** by calling `collections.getStatus(reference)` (to determine the completed/successful status) together with `transactions.get(reference)` (to read the confirmed amount and currency) before any payment is recorded as completed. Completion is derived from the returned status value rather than from any assumed webhook event name, which is likewise undocumented.
