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

// The checkout resource accepts a phone number on create and returns the
// created payment, so its entity type extends PaymentDto with the input field.
interface CheckoutEntity extends PaymentDto {
  phone_number: string;
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
      setPhase("submitting");
      try {
        const created = await api
          .resource<CheckoutEntity>("checkout")
          .create({ phone_number: phone });
        setPayment(created);
        setPhase("tracking");
      } catch (err) {
        setError(errorMessage(err));
        setPhase("idle");
      }
    },
    [api, phone],
  );

  const reset = useCallback(() => {
    stopPolling();
    setPayment(null);
    setError(null);
    setPhone("");
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
          <small>React SPA &middot; @streetjs/client</small>
        </div>
      </div>

      {!payment ? (
        <>
          <h1>Mobile-money checkout</h1>
          <p className="lead">
            Enter your mobile-money phone number to start a real MarzPay{" "}
            <strong>sandbox</strong> collection in Uganda.
          </p>

          <div className="amount-chip">
            <span>Pay</span>
            <span className="big">5,000</span>
            <span>UGX</span>
          </div>

          <form className="pay-form" onSubmit={submit}>
            <label className="field" htmlFor="phone">
              Mobile-money phone number
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
                placeholder="e.g. +256700000000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>

            {error && <p className="alert">{error}</p>}

            <button type="submit" disabled={phase === "submitting"}>
              {phase === "submitting" ? "Starting…" : "Pay 5000 UGX"}
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
