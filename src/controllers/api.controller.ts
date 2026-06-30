// JSON API controllers for the React SPA frontend (@streetjs/client).
//
// These endpoints are ADDITIVE: they expose the same mobile-money flow as the
// server-rendered controllers, but as JSON so the SDK-driven SPA can consume
// them. They are registered only by `main()` (see server.ts) and are NOT part
// of the tested `CONTROLLERS` list, so the existing spec tests are unaffected.
//
// Routes (consumed by @streetjs/client resources):
//   POST /api/checkout            -> api.resource('checkout').create({ phone_number })
//   GET  /api/payments/:reference -> api.resource('payments').get(reference)

import type { StreetContext } from "streetjs";
import { Controller, Get, Post } from "streetjs";

import { insertPending, findByReference, markCompleted } from "../db/store.js";
import {
  generateReference,
  acceptablePhone,
  parseAmount,
  isCompletedStatus,
} from "../services/marzpay-helpers.js";
import type { MarzPayClient } from "../services/marzpay-types.js";

/** Fixed collection parameters for this demo (UGX mobile money, Uganda). */
const PAYMENT_CURRENCY = "UGX";
const PAYMENT_COUNTRY = "UG";
const PENDING_STATUS = "pending";

/** Shape returned to the SPA for a payment. */
interface PaymentDto {
  reference: string;
  amount: number;
  currency: string;
  status: string;
  completed: boolean;
}

/** Read the submitted phone number from a JSON (or form) body. */
function readPhoneNumber(ctx: StreetContext): string | undefined {
  const body = ctx.body;
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const value = (body as Record<string, unknown>)["phone_number"];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

/** Read the submitted amount (number or string) from a JSON body. */
function readAmount(ctx: StreetContext): unknown {
  const body = ctx.body;
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    return (body as Record<string, unknown>)["amount"];
  }
  return undefined;
}

@Controller("/api/checkout")
export class ApiCheckoutController {
  /**
   * POST /api/checkout — initiate a mobile-money collection for a user-selected
   * amount and persist a pending record. Responds with JSON.
   *
   * Body: { phone_number: string, amount: number | string }
   *   - phone_number accepts local (07…) or international (+…) formats.
   *   - amount must be a whole number of UGX in [500, 1_000_000].
   */
  @Post("/")
  async create(ctx: StreetContext): Promise<void> {
    const marzpay = ctx.state["marzpay"] as MarzPayClient | undefined;
    const rawPhone = readPhoneNumber(ctx);

    if (marzpay === undefined) {
      ctx.json({ error: "payment service unavailable" }, 503);
      return;
    }

    // Accept local or international phone formats; get back a normalized E.164.
    const phoneNumber = acceptablePhone(marzpay.utils, rawPhone);
    if (phoneNumber === null) {
      ctx.json({ error: "a valid phone number is required" }, 400);
      return;
    }

    // Validate the user-selected amount (500 – 1,000,000 UGX).
    const amountResult = parseAmount(readAmount(ctx));
    if (!amountResult.ok) {
      ctx.json({ error: amountResult.error }, 400);
      return;
    }
    const amount = amountResult.amount;

    const reference = generateReference();

    try {
      await marzpay.collections.collectMoney({
        amount,
        country: PAYMENT_COUNTRY,
        reference,
        phone_number: phoneNumber,
      });
    } catch {
      ctx.json({ error: "payment initiation failed" }, 502);
      return;
    }

    const write = await insertPending({
      reference,
      amount,
      currency: PAYMENT_CURRENCY,
      status: PENDING_STATUS,
      createdAt: new Date().toISOString(),
    });
    if (!write.ok) {
      ctx.json({ error: "payment could not be saved" }, 500);
      return;
    }

    const dto: PaymentDto = {
      reference,
      amount,
      currency: PAYMENT_CURRENCY,
      status: PENDING_STATUS,
      completed: false,
    };
    ctx.json(dto, 201);
  }
}

@Controller("/api/payments")
export class ApiPaymentsController {
  /**
   * GET /api/payments/:reference — look up a stored payment by reference.
   * Returns the record (with a derived `completed` flag) or 404.
   */
  @Get("/:reference")
  async get(ctx: StreetContext): Promise<void> {
    const reference = ctx.params["reference"];
    if (reference === undefined || reference.trim() === "") {
      ctx.json({ error: "a reference is required" }, 400);
      return;
    }

    const lookup = await findByReference(reference);
    if (!lookup.found) {
      ctx.json({ error: "payment not found" }, 404);
      return;
    }

    const { payment } = lookup;
    const dto: PaymentDto = {
      reference: payment.reference,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      completed: isCompletedStatus(payment.status),
    };
    ctx.json(dto, 200);
  }
}
