import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { injectExportComplianceIos } from "../src/native/inject-export-compliance-ios.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const PLIST =
  '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleName</key>\n\t<string>App</string>\n</dict>\n</plist>\n';

describe("injectExportComplianceIos", () => {
  it("sets, changes and removes ITSAppUsesNonExemptEncryption", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-export-compliance-"));
    const plist = join(dir, "Info.plist");
    writeFileSync(plist, PLIST);

    injectExportComplianceIos(plist, false);
    expect(readFileSync(plist, "utf-8")).toContain("\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n</dict>");

    injectExportComplianceIos(plist, true);
    const changed = readFileSync(plist, "utf-8");
    expect(changed.match(/ITSAppUsesNonExemptEncryption/g)).toHaveLength(1);
    expect(changed).toContain("<true/>");

    injectExportComplianceIos(plist, undefined);
    expect(readFileSync(plist, "utf-8")).toBe(PLIST);
  });
});
