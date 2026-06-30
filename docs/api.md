# JSON API Reference

The React SPA at `/app` consumes this small JSON API. All paths are relative to
the deployment origin (e.g. `https://streetjs-marzpay.vercel.app`). Requests and
responses are `application/json`.

These endpoints are served by `src/controllers/api.controller.ts` and share the
same MarzPay client and payment store as the server-rendered flow.

---

## POST /api/checkout

Start a mobile-money collection against the MarzPay sandbox and persist a
`pending` payment.

### Request body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `phone_number` | string | yes | Local (`0700000000`) or international (`+256700000000`). Normalized to E.164 server-side. |
| `amount` | number \| string | yes | Whole number of UGX in `[500, 1000000]`. Commas/spaces tolerated for strings (e.g. `"50,000"`). |

```json
{ "phone_number": "0700000000", "amount": 25000 }
```

### Responses

| Status | When | Body |
| --- | --- | --- |
| `201 Created` | Collection initiated and pending record stored | `PaymentDto` (below) |
| `400 Bad Request` | Missing/invalid phone | `{ "error": "a valid phone number is required" }` |
| `400 Bad Request` | Amount out of range / not a whole number | `{ "error": "amount must be between 500 and 1000000 UGX" }` |
| `502 Bad Gateway` | `collectMoney` rejected (e.g. unprovisioned number, sandbox decline, timeout) | `{ "error": "payment initiation failed" }` |
| `500 Internal Server Error` | Persistence failed after a successful collection | `{ "error": "payment could not be saved" }` |
| `503 Service Unavailable` | MarzPay client not available | `{ "error": "payment service unavailable" }` |

```json
{
  "reference": "cb2f5b9f-5fec-4a32-b48d-07564faffc2f",
  "amount": 25000,
  "currency": "UGX",
  "status": "pending",
  "completed": false
}
```

### Example

```bash
curl -X POST https://streetjs-marzpay.vercel.app/api/checkout \
  -H 'Content-Type: application/json' \
  -d '{"phone_number":"0700000000","amount":25000}'
```

---

## GET /api/payments/:reference

Fetch the current state of a payment by its reference.

### Path parameters

| Param | Type | Notes |
| --- | --- | --- |
| `reference` | string | The reference returned by `POST /api/checkout`. |

### Responses

| Status | When | Body |
| --- | --- | --- |
| `200 OK` | Payment found | `PaymentDto` |
| `404 Not Found` | No payment for that reference | `{ "error": "payment not found" }` |
| `400 Bad Request` | Empty reference | `{ "error": "a reference is required" }` |

### Example

```bash
curl https://streetjs-marzpay.vercel.app/api/payments/cb2f5b9f-5fec-4a32-b48d-07564faffc2f
```

---

## Types

### `PaymentDto`

| Field | Type | Notes |
| --- | --- | --- |
| `reference` | string | Unique payment reference (UUID v4). |
| `amount` | number | Amount in UGX. |
| `currency` | string | Always `"UGX"`. |
| `status` | string | `"pending"` until confirmed, then a completed/successful value. |
| `completed` | boolean | Derived from `status` via `isCompletedStatus`. |

---

## Webhook endpoint

MarzPay delivers payment events to:

```
POST /webhooks/marzpay
```

This endpoint is **POST-only** (a `GET` returns `404` by design). It validates
the request (best-effort signature), then authoritatively confirms completion
via `collections.getStatus` and reads `transactions.get` before recording a
completed payment. See the [architecture doc](architecture.md#request-lifecycle-happy-path)
and the README's "Webhook Signature Limitation" section.

| Status | When |
| --- | --- |
| `200 OK` | Acknowledged (status applied or intentionally unchanged) |
| `401 Unauthorized` | `validateWebhook` rejected the request |
| `400 Bad Request` | Validated but body unparseable or missing a reference |
| `500 Internal Server Error` | Database write failed (no partial row) |

## Notes

- Using `@streetjs/client`, these map to `api.resource('checkout').create(...)`
  and `api.resource('payments').get(reference)`.
- Cold starts on Vercel re-install the MarzPay/Supabase plugins, so the first
  request after a deploy can take several seconds; subsequent requests are fast.
