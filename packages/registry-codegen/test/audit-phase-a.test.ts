import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { permissionApiWarnings } from "../src/audit-permission-handling.js";
import { i18nWarnings } from "../src/audit-i18n.js";
import { PluginManifestSchema } from "../src/schema/plugin-schema.js";

const manifest = (fields: Record<string, unknown>) => PluginManifestSchema.parse({ name: "scanner", ...fields });

describe("permissionApiWarnings", () => {
  it("warns when a plugin needing permissions lacks checkPermissions or requestPermissions", () => {
    expect(
      permissionApiWarnings(manifest({ permissions: { android: ["android.permission.CAMERA"] }, methods: ["scan"] })),
    ).toEqual([expect.stringMatching(/no checkPermissions or requestPermissions/)]);
    expect(
      permissionApiWarnings(
        manifest({ permissions: { ios: { NSCameraUsageDescription: "x" } }, methods: ["scan", "checkPermissions"] }),
      ),
    ).toEqual([expect.stringMatching(/no requestPermissions method/)]);
  });

  it("passes plugins with both methods, without runtime permissions, or with Face ID only", () => {
    expect(
      permissionApiWarnings(
        manifest({
          permissions: { android: ["android.permission.CAMERA"] },
          methods: ["checkPermissions", "requestPermissions"],
        }),
      ),
    ).toEqual([]);
    expect(permissionApiWarnings(manifest({ permissions: { android: ["android.permission.VIBRATE"] } }))).toEqual([]);
    expect(permissionApiWarnings(manifest({ permissions: { ios: { NSFaceIDUsageDescription: "x" } } }))).toEqual([]);
  });
});

describe("i18nWarnings", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wefter-i18n-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("passes a plugin without i18n/, or with prefixed keys and English", () => {
    expect(i18nWarnings("scanner", dir)).toEqual([]);
    mkdirSync(join(dir, "i18n"));
    writeFileSync(join(dir, "i18n/en.json"), JSON.stringify({ "scanner.title": "Scan" }));
    expect(i18nWarnings("scanner", dir)).toEqual([]);
  });

  it("warns about missing English, unprefixed keys, bad JSON and non-text values", () => {
    mkdirSync(join(dir, "i18n"));
    writeFileSync(join(dir, "i18n/fr.json"), JSON.stringify({ title: "Scanner", "scanner.n": 3 }));
    writeFileSync(join(dir, "i18n/de.json"), "{");
    const warnings = i18nWarnings("scanner", dir);
    expect(warnings).toEqual(
      expect.arrayContaining([
        'Plugin "scanner" has i18n/ but no i18n/en.json',
        'Plugin "scanner": i18n/fr.json key "title" must start with "scanner."',
        'Plugin "scanner": i18n/fr.json "scanner.n" is not text',
        expect.stringMatching(/i18n\/de.json is not valid JSON/),
      ]),
    );
  });
});
