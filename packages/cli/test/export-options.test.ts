import { describe, expect, it } from "vitest";
import { exportMethodName, parseXcodeVersion, renderExportOptions } from "../src/native/export-options.js";
import type { ResolvedIosSigning } from "../src/config/signing-config.js";

const automatic: ResolvedIosSigning = {
  teamId: "ABCDE12345",
  provisioningProfile: undefined,
  signingIdentity: undefined,
  appStoreConnect: undefined,
  problems: [],
};

describe("renderExportOptions", () => {
  it("exports for App Store Connect with automatic signing, symbols on and Xcode's versioning off", () => {
    const plist = renderExportOptions({ method: "app-store-connect", signing: automatic, bundleId: "com.example.app" });

    expect(plist).toContain("<key>method</key>\n\t<string>app-store-connect</string>");
    expect(plist).toContain("<key>teamID</key>\n\t<string>ABCDE12345</string>");
    expect(plist).toContain("<key>signingStyle</key>\n\t<string>automatic</string>");
    expect(plist).toContain("<key>uploadSymbols</key>\n\t<true/>");
    expect(plist).toContain("<key>manageAppVersionAndBuildNumber</key>\n\t<false/>");
    expect(plist).not.toContain("provisioningProfiles");
  });

  it("names the profile and certificate for manual signing", () => {
    const plist = renderExportOptions({
      method: "release-testing",
      signing: { ...automatic, provisioningProfile: "Shop Ad Hoc", signingIdentity: "Apple Distribution" },
      bundleId: "com.example.shop",
    });

    expect(plist).toContain("<string>manual</string>");
    expect(plist).toContain("<key>com.example.shop</key>\n\t\t<string>Shop Ad Hoc</string>");
    expect(plist).toContain("<key>signingCertificate</key>\n\t<string>Apple Distribution</string>");
    expect(plist).not.toContain("uploadSymbols");
  });
});

describe("export method names", () => {
  it("uses the older names before Xcode 15.3", () => {
    expect(exportMethodName("app-store-connect", [15, 2])).toBe("app-store");
    expect(exportMethodName("release-testing", [14, 3])).toBe("ad-hoc");
    expect(exportMethodName("app-store-connect", [15, 3])).toBe("app-store-connect");
    expect(exportMethodName("debugging", [26, 0])).toBe("debugging");
  });

  it("reads the Xcode version", () => {
    expect(parseXcodeVersion("Xcode 16.2\nBuild version 16C5032a")).toEqual([16, 2]);
    expect(parseXcodeVersion("Xcode 26\n")).toEqual([26, 0]);
    expect(parseXcodeVersion("nope")).toBeNull();
  });
});
