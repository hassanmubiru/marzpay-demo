import { useCallback, useEffect, useRef, useState } from "react";
import { useStreetClient } from "@streetjs/react";

// Shape returned by the backend JSON API (api.controller.ts).
interface PaymentDto {
  reference: string;
  amount: number;
  currency: string;
  status: string;
  completed: boolean;
}

// The checkout resource accepts a phone number + amount on create and returns
// the created payment, so its entity type extends PaymentDto with input fields.
interface CheckoutEntity extends PaymentDto {
  phone_number: string;
}

const MIN_AMOUNT = 500;
const MAX_AMOUNT = 1_000_000;
const QUICK_AMOUNTS = [500, 5000, 20000, 50000, 100000, 500000];

/** Format a number with thousands separators (e.g. 50000 → "50,000"). */
function formatAmount(n: number): string {
  return n.toLocaleString("en-US");
}

type Phase = "idle" | "submitting" | "tracking";

/** Pull a human-readable message out of a StreetApiError or unknown error. */
function errorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const body = (err as { body?: unknown }).body;
    if (body && typeof body === "object" && "error" in body) {
      const msg = (body as { error?: unknown }).error;
      if (typeof msg === "string") return msg;
    }
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Something went wrong. Please try again.";
}

export function App() {
  const api = useStreetClient();

  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState<number>(5000);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentDto | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Poll the payment status while a pending payment is being tracked.
  useEffect(() => {
    if (phase !== "tracking" || !payment || payment.completed) {
      stopPolling();
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const latest = await api
          .resource<PaymentDto>("payments")
          .get(payment.reference);
        setPayment(latest);
        if (latest.completed) stopPolling();
      } catch {
        /* transient lookup error — keep polling */
      }
    }, 3000);
    return stopPolling;
  }, [phase, payment, api, stopPolling]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!Number.isInteger(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
        setError(
          `Amount must be a whole number between ${formatAmount(MIN_AMOUNT)} and ${formatAmount(MAX_AMOUNT)} UGX.`,
        );
        return;
      }
      setPhase("submitting");
      try {
        const created = await api
          .resource<CheckoutEntity>("checkout")
          .create({ phone_number: phone, amount });
        setPayment(created);
        setPhase("tracking");
      } catch (err) {
        setError(errorMessage(err));
        setPhase("idle");
      }
    },
    [api, phone, amount],
  );

  const reset = useCallback(() => {
    stopPolling();
    setPayment(null);
    setError(null);
    setPhone("");
    setAmount(5000);
    setPhase("idle");
  }, [stopPolling]);

  return (
    <main className="card">
      <div className="brand">
        <div className="mark" aria-hidden="true">
          S
        </div>
        <div className="name">
          StreetJS &times; MarzPay
          <small>Mobile-money checkout</small>
        </div>
      </div>

      {!payment ? (
        <>
          <h1>Mobile-money checkout</h1>
          <p className="lead">
            Choose an amount and enter your mobile-money number to start a real
            MarzPay <strong>sandbox</strong> collection.
          </p>

          <form className="pay-form" onSubmit={submit}>
            <label className="field" htmlFor="amount">
              Amount (UGX)
            </label>
            <div className="amount-grid">
              {QUICK_AMOUNTS.map((a) => (
                <button
                  type="button"
                  key={a}
                  className={`chip ${amount === a ? "chip-active" : ""}`}
                  onClick={() => setAmount(a)}
                >
                  {formatAmount(a)}
                </button>
              ))}
            </div>
            <input
              id="amount"
              type="number"
              inputMode="numeric"
              min={MIN_AMOUNT}
              max={MAX_AMOUNT}
              step={500}
              value={amount}
              onChange={(e) => setAmount(Math.trunc(Number(e.target.value)))}
              required
            />
            <p className="hint">
              Between {formatAmount(MIN_AMOUNT)} and {formatAmount(MAX_AMOUNT)} UGX.
            </p>

            <label className="field" htmlFor="phone">
              Phone number (local or international)
            </label>
            <div className="input-wrap">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="6" y="2" width="12" height="20" rx="3" />
                <line x1="11" y1="18" x2="13" y2="18" />
              </svg>
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="0700000000 or +256700000000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <p className="hint">
              Local (e.g. 0700000000) and international (e.g. +256700000000)
              formats are accepted.
            </p>

            {error && <p className="alert">{error}</p>}

            <button type="submit" disabled={phase === "submitting"}>
              {phase === "submitting"
                ? "Starting…"
                : `Pay ${formatAmount(amount)} UGX`}
            </button>
          </form>

          <div className="foot">
            <span className="dot" aria-hidden="true" />
            Secured sandbox payment &middot; no real funds are moved
          </div>
        </>
      ) : (
        <>
          <h1>Payment status</h1>

          <div className={`status-banner ${payment.completed ? "ok" : "pending"}`}>
            {payment.completed ? (
              <span>Payment Successful</span>
            ) : (
              <span>
                <span className="spinner" aria-hidden="true" /> Awaiting approval
                on your phone…
              </span>
            )}
          </div>

          <dl className="details">
            <dt>Reference</dt>
            <dd className="reference">{payment.reference}</dd>
            <dt>Amount</dt>
            <dd className="amount">
              {payment.amount} {payment.currency}
            </dd>
            <dt>Status</dt>
            <dd>
              <span className="pill" data-status={payment.status}>
                {payment.status}
              </span>
            </dd>
          </dl>

          <button type="button" className="ghost" onClick={reset}>
            Start another payment
          </button>
        </>
      )}
    </main>
  );
}
