import { describe, expect, it } from "vitest";
import { parseApksignerFingerprint } from "../src/native/android-verify.js";

describe("parseApksignerFingerprint", () => {
  it("reads the first signer's SHA-256 in assetlinks format", () => {
    const output = [
      "Signer #1 certificate DN: CN=Upload",
      "Signer #1 certificate SHA-256 digest: 0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9",
      "Signer #1 certificate SHA-1 digest: 0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d",
    ].join("\n");

    expect(parseApksignerFingerprint(output)).toBe(
      "0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9",
    );
  });

  it("gives null when there is no digest", () => {
    expect(parseApksignerFingerprint("DOES NOT VERIFY")).toBeNull();
  });
});
