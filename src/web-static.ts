// Minimal static-file middleware that serves the built React SPA under a mount
// path (default "/app"). StreetJS core has no static-file serving, so this is a
// small, dependency-free MiddlewareFn that:
//   - serves real files from the build directory (correct Content-Type),
//   - falls back to index.html for client-side routes (SPA history fallback),
//   - guards against path traversal,
//   - delegates everything else (e.g. /api, /, /checkout) via next().
//
// It is registered only by main() in server.ts, so it never affects the tested
// bootstrap path.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

import type { StreetContext } from "streetjs";
import type { MiddlewareFn } from "streetjs";

/** Map a file extension to a Content-Type for the assets the SPA ships. */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export interface SpaMiddlewareOptions {
  /** Absolute path to the built SPA directory (e.g. web/dist). */
  root: string;
  /** URL prefix the SPA is mounted at. Default "/app". */
  mountPath?: string;
}

/**
 * Stream a file to the raw response with the right Content-Type. Returns true
 * if the file existed and was sent, false otherwise (so the caller can fall
 * back to index.html or next()).
 */
async function sendFile(ctx: StreetContext, filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return false;
    }
    const isHashed = /\.[0-9a-f]{8,}\.(js|css|woff2?|png|jpe?g|svg|webp)$/i.test(
      filePath,
    );
    ctx.res.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Content-Length": info.size,
      "Cache-Control": isHashed
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    await new Promise<void>((resolveStream, reject) => {
      const stream = createReadStream(filePath);
      stream.on("error", reject);
      stream.on("end", () => resolveStream());
      stream.pipe(ctx.res);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the SPA static middleware. Requests under `mountPath` are served from
 * `root`; anything else is passed through to the next handler.
 */
export function createSpaMiddleware(options: SpaMiddlewareOptions): MiddlewareFn {
  const root = resolve(options.root);
  const mountPath = options.mountPath ?? "/app";
  const indexHtml = join(root, "index.html");

  return async (ctx, next) => {
    const { path } = ctx;

    // Only handle GET/HEAD under the mount path; defer everything else.
    if (
      (ctx.method !== "GET" && ctx.method !== "HEAD") ||
      (path !== mountPath && !path.startsWith(`${mountPath}/`))
    ) {
      await next();
      return;
    }

    // Strip the mount prefix to get the path relative to the build root.
    let rel = path.slice(mountPath.length);
    if (rel.startsWith("/")) {
      rel = rel.slice(1);
    }

    // Resolve safely and reject any path that escapes the build root.
    const candidate = normalize(join(root, rel));
    const withinRoot =
      candidate === root || candidate.startsWith(`${root}${sep}`);

    if (withinRoot && rel !== "") {
      if (await sendFile(ctx, candidate)) {
        return;
      }
    }

    // SPA history fallback: serve index.html for the mount root and unknown
    // sub-routes so client-side routing works.
    if (await sendFile(ctx, indexHtml)) {
      return;
    }

    // Build output is missing — let the request fall through (404).
    await next();
  };
}
