import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  initSchema,
  getPool,
  closeStore,
} from "../src/db/payments.js";

/**
 * Task 10.1 — Smoke/config tests for project artifacts.
 *
 * These tests read the committed project artifacts (package.json,
 * tsconfig.json, .env.example, README.md) and the real `payments` schema, and
 * assert they declare the configuration the demo depends on.
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.10, 6.1_
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/** Read a repo-root file as UTF-8 text. */
function readRootFile(relPath: string): string {
  return readFileSync(resolve(root, relPath), "utf8");
}

describe("package.json", () => {
  const pkg = JSON.parse(readRootFile("package.json")) as {
    type?: string;
    engines?: { node?: string };
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it("declares the streetjs, marzpay plugin, and reflect-metadata dependencies (Req 1.1)", () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps).toHaveProperty("streetjs");
    expect(deps).toHaveProperty("@streetjs/plugin-marzpay");
    expect(deps).toHaveProperty("reflect-metadata");
  });

  it('sets "type": "module" (Req 1.2)', () => {
    expect(pkg.type).toBe("module");
  });

  it("declares a Node >=20 engine (Req 1.3)", () => {
    expect(pkg.engines?.node).toBeDefined();
    expect(pkg.engines!.node).toMatch(/>=\s*20/);
  });

  it("has a dev script that builds and starts the server (Req 1.10)", () => {
    const dev = pkg.scripts?.dev;
    expect(dev).toBeDefined();
    // Build step (tsc) followed by starting the compiled server.
    expect(dev).toMatch(/tsc/);
    expect(dev).toMatch(/node\b.*server/);
  });
});

describe("tsconfig.json", () => {
  // tsconfig may contain comments; strip line/block comments before parsing.
  const raw = readRootFile("tsconfig.json");
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const tsconfig = JSON.parse(stripped) as {
    compilerOptions?: Record<string, unknown>;
  };
  const opts = tsconfig.compilerOptions ?? {};

  it("enables experimentalDecorators (Req 1.2)", () => {
    expect(opts.experimentalDecorators).toBe(true);
  });

  it("enables emitDecoratorMetadata (Req 1.2)", () => {
    expect(opts.emitDecoratorMetadata).toBe(true);
  });

  it("uses NodeNext module resolution (Req 1.2)", () => {
    expect(opts.module).toBe("NodeNext");
    expect(opts.moduleResolution).toBe("NodeNext");
  });
});

describe(".env.example", () => {
  const env = readRootFile(".env.example");

  it("lists the five environment variables (Req 1.3)", () => {
    const expected = [
      "MARZPAY_API_KEY",
      "MARZPAY_SECRET_KEY",
      "MARZPAY_ENVIRONMENT",
      "APP_URL",
      "PORT",
    ];
    for (const name of expected) {
      // Match the variable as an assignment key (start of a line).
      expect(env).toMatch(new RegExp(`^${name}=`, "m"));
    }
  });
});

describe("payments schema (Req 6.1)", () => {
  afterAll(async () => {
    await closeStore();
  });

  it("has the six columns with reference NOT NULL and UNIQUE", async () => {
    await initSchema({ filePath: ":memory:" });
    const pool = getPool();

    const info = await pool.query(`PRAGMA table_info(payments)`);
    const columns = info.rows.map((r) => ({
      name: String(r.name),
      notnull: Number(r.notnull),
    }));
    const names = columns.map((c) => c.name).sort();

    expect(names).toEqual(
      ["amount", "created_at", "currency", "id", "reference", "status"].sort(),
    );

    // reference is NOT NULL.
    const reference = columns.find((c) => c.name === "reference");
    expect(reference).toBeDefined();
    expect(reference!.notnull).toBe(1);

    // reference is UNIQUE: find a unique index covering exactly `reference`.
    const indexes = await pool.query(`PRAGMA index_list(payments)`);
    let referenceIsUnique = false;
    for (const idx of indexes.rows) {
      if (Number(idx.unique) !== 1) continue;
      const cols = await pool.query(
        `PRAGMA index_info(${String(idx.name)})`,
      );
      const idxCols = cols.rows.map((c) => String(c.name));
      if (idxCols.length === 1 && idxCols[0] === "reference") {
        referenceIsUnique = true;
        break;
      }
    }
    expect(referenceIsUnique).toBe(true);
  });
});

describe("README.md (Req 1.1)", () => {
  const readme = readRootFile("README.md");

  it("has substantive content", () => {
    expect(readme.trim().length).toBeGreaterThan(0);
  });

  it("documents the demo and setup", () => {
    expect(readme).toMatch(/StreetJS/);
    expect(readme).toMatch(/MarzPay/);
    expect(readme.toLowerCase()).toMatch(/setup|install/);
  });
});
