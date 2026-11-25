import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkSyncFreshness, writeSyncMarker } from "../src/plugins/sync-freshness.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("checkSyncFreshness", () => {
  it("is not fresh when the project has never been synced", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-freshness-"));
    writeFileSync(join(dir, "wefter.config.json"), JSON.stringify({}));

    const result = checkSyncFreshness(dir);

    expect(result.fresh).toBe(false);
    expect(result.reason).toMatch(/never been synced/);
  });

  it("is fresh right after writeSyncMarker, with no config changes since", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-freshness-"));
    writeFileSync(join(dir, "wefter.config.json"), JSON.stringify({ webDir: "dist" }));
    writeSyncMarker(dir);

    expect(checkSyncFreshness(dir)).toEqual({ fresh: true });
  });

  it("is stale once wefter.config.json changes after the last sync", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-freshness-"));
    writeFileSync(join(dir, "wefter.config.json"), JSON.stringify({ webDir: "dist" }));
    writeSyncMarker(dir);

    writeFileSync(join(dir, "wefter.config.json"), JSON.stringify({ webDir: "dist", plugins: ["new-one"] }));

    const result = checkSyncFreshness(dir);
    expect(result.fresh).toBe(false);
    expect(result.reason).toMatch(/changed since the last `wefter sync`/);
  });

  it("is stale when the marker was written by a different CLI version (e.g. after upgrading wefter)", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-freshness-"));
    writeFileSync(join(dir, "wefter.config.json"), JSON.stringify({ webDir: "dist" }));
    writeSyncMarker(dir);

    const markerPath = join(dir, ".wefter", ".sync-marker");
    const [hash] = readFileSync(markerPath, "utf-8").split("\n");
    writeFileSync(markerPath, `${hash}\n0.0.0-old\n`);

    const result = checkSyncFreshness(dir);
    expect(result.fresh).toBe(false);
    expect(result.reason).toMatch(/different Wefter CLI version \(0\.0\.0-old →/);
  });

  it("treats a legacy marker (config hash only, no CLI version) as stale", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-freshness-"));
    writeFileSync(join(dir, "wefter.config.json"), JSON.stringify({ webDir: "dist" }));
    writeSyncMarker(dir);

    const markerPath = join(dir, ".wefter", ".sync-marker");
    const [hash] = readFileSync(markerPath, "utf-8").split("\n");
    mkdirSync(join(dir, ".wefter"), { recursive: true });
    writeFileSync(markerPath, hash!);

    const result = checkSyncFreshness(dir);
    expect(result.fresh).toBe(false);
    expect(result.reason).toMatch(/unknown →/);
  });
});
