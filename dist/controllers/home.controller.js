/**
 * HomeController — the Home_Page route.
 *
 * Renders the static `views/home.html` template, which carries the demo's
 * fixed contract: the exact title text "StreetJS + MarzPay Demo", exactly one
 * mobile-money phone-number input, and exactly one enabled button labeled
 * "Pay 5000 UGX" inside a form that POSTs to `/checkout`.
 *
 * Responsibilities (Requirements 3.1–3.5):
 *   - GET `/` returns HTTP 200 with the rendered home page (Req 3.1–3.4).
 *   - If the page cannot be rendered (e.g. the template cannot be read),
 *     respond with HTTP 500 and a message indicating the page could not be
 *     loaded (Req 3.5).
 *
 * The template itself is static; this controller's only job is to load and
 * serve it, and to fail safely with a 500 when loading throws.
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { readFile } from "node:fs/promises";
import { Controller, Get } from "streetjs";
/**
 * Candidate locations for `home.html`, resolved relative to this module so the
 * controller works both when executed from compiled output (`dist/controllers`)
 * and directly from source (`src/controllers`, e.g. under the test runner).
 *
 * `tsc` does not copy `.html` templates into `dist/`, so the canonical source
 * location (`src/views`) is included as the authoritative fallback. The first
 * readable candidate wins.
 */
const HOME_VIEW_CANDIDATES = [
    // Colocated with compiled output, in case a build step copies views to dist.
    new URL("../views/home.html", import.meta.url),
    // Canonical source location (works from both dist and src module locations).
    new URL("../../src/views/home.html", import.meta.url),
];
/**
 * Body returned when the home page cannot be rendered (Req 3.5). Kept minimal
 * and self-contained so it never depends on the very template that failed.
 */
const HOME_LOAD_FAILURE_HTML = "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\" />" +
    "<title>StreetJS + MarzPay Demo</title></head><body>" +
    "<p>The page could not be loaded. Please try again later.</p>" +
    "</body></html>";
/**
 * Load the home page template from the first readable candidate location.
 *
 * @throws The underlying filesystem error if no candidate can be read, so the
 *         controller can map it to an HTTP 500 (Req 3.5).
 */
export async function loadHomeView() {
    let lastError;
    for (const candidate of HOME_VIEW_CANDIDATES) {
        try {
            return await readFile(candidate, "utf8");
        }
        catch (err) {
            lastError = err;
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error("home.html could not be read");
}
let HomeController = class HomeController {
    /**
     * View loader seam. Defaults to reading `home.html` from disk; tests can
     * replace it to exercise both the success (200) and render-failure (500)
     * paths without touching the filesystem.
     */
    loadView = loadHomeView;
    /**
     * GET `/` — render the home page.
     *
     * Returns HTTP 200 with the rendered template on success (Req 3.1–3.4); if
     * loading/rendering throws, returns HTTP 500 with a message indicating the
     * page could not be loaded (Req 3.5).
     */
    async index(ctx) {
        try {
            const html = await this.loadView();
            ctx.html(html, 200);
        }
        catch {
            ctx.html(HOME_LOAD_FAILURE_HTML, 500);
        }
    }
};
__decorate([
    Get("/"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], HomeController.prototype, "index", null);
HomeController = __decorate([
    Controller("/")
], HomeController);
export { HomeController };
//# sourceMappingURL=home.controller.js.map