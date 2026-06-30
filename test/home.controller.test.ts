import { describe, it, expect } from "vitest";

import { HomeController } from "../src/controllers/home.controller.js";
import type { StreetContext } from "streetjs";

/**
 * Unit tests for HomeController (Task 6.2).
 *
 * These exercise the Home_Page contract (Requirements 3.1–3.5) using a stub
 * StreetContext that captures the single `html(body, status)` call the
 * controller makes. The success path uses the controller's default `loadView`
 * seam (which reads the real `src/views/home.html`), so the assertions verify
 * the actual shipped template. The failure path replaces `loadView` with a
 * throwing stub to exercise the 500 render-failure branch (Req 3.5).
 */

interface CapturedHtml {
  body: string;
  status: number | undefined;
}

/**
 * Minimal StreetContext stub that records the arguments passed to `html(...)`.
 * Only the surface HomeController touches is implemented; everything else is
 * present to satisfy the type but is never invoked by the controller.
 */
function createStubContext(): { ctx: StreetContext; captured: CapturedHtml[] } {
  const captured: CapturedHtml[] = [];
  const ctx = {
    html(body: string, status?: number): void {
      captured.push({ body, status });
    },
  } as unknown as StreetContext;
  return { ctx, captured };
}

describe("HomeController.index", () => {
  it("responds 200 and renders the home page contract on success (Req 3.1–3.4)", async () => {
    const controller = new HomeController();
    const { ctx, captured } = createStubContext();

    await controller.index(ctx);

    // Exactly one response was sent, with HTTP 200.
    expect(captured).toHaveLength(1);
    const { body, status } = captured[0];
    expect(status).toBe(200);

    // Req 3.1: contains the exact title text.
    expect(body).toContain("StreetJS + MarzPay Demo");

    // Req 3.2: exactly one input control (the phone-number field), and it is a
    // tel input bound to the phone_number field.
    const inputMatches = body.match(/<input\b/gi) ?? [];
    expect(inputMatches).toHaveLength(1);
    expect(body).toMatch(/<input\b[^>]*\btype="tel"/i);
    expect(body).toMatch(/<input\b[^>]*\bname="phone_number"/i);

    // Req 3.3: exactly one button, enabled (no `disabled` attribute), labeled
    // exactly "Pay 5000 UGX".
    const buttonOpenTags = body.match(/<button\b/gi) ?? [];
    expect(buttonOpenTags).toHaveLength(1);
    const buttonMatch = body.match(/<button\b[^>]*>([\s\S]*?)<\/button>/i);
    expect(buttonMatch).not.toBeNull();
    const [buttonTag, buttonLabel] = buttonMatch!;
    expect(buttonTag).not.toMatch(/\bdisabled\b/i);
    expect(buttonLabel.trim()).toBe("Pay 5000 UGX");

    // Req 3.4: the button submits to /checkout via the form's POST.
    const formMatch = body.match(/<form\b[^>]*>/i);
    expect(formMatch).not.toBeNull();
    const formTag = formMatch![0];
    expect(formTag).toMatch(/\bmethod="POST"/i);
    expect(formTag).toMatch(/\baction="\/checkout"/i);
  });

  it("responds 500 with a load-failure message when rendering throws (Req 3.5)", async () => {
    const controller = new HomeController();
    // Induce a render failure via the loadView seam.
    controller.loadView = async () => {
      throw new Error("induced render failure");
    };
    const { ctx, captured } = createStubContext();

    await controller.index(ctx);

    expect(captured).toHaveLength(1);
    const { body, status } = captured[0];
    expect(status).toBe(500);
    // Surfaces a message indicating the page could not be loaded.
    expect(body.toLowerCase()).toContain("could not be loaded");
    // The button label must not be presented on the failure page.
    expect(body).not.toContain("Pay 5000 UGX");
  });
});
