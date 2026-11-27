/**
 * The `ExportOptions.plist` that `xcodebuild -exportArchive` reads: how to export (App Store Connect,
 * release testing, enterprise or debugging) and how to sign.
 */

import { execFile } from "node:child_process";
import type { ResolvedIosSigning } from "../config/signing-config.js";
import type { IosExportMethod } from "../config/wefter-config-schema.js";

/** What goes into the export options. */
export interface ExportOptionsInput {
  method: IosExportMethod;
  signing: ResolvedIosSigning;
  bundleId: string;
  /** Xcode's version as `[major, minor]`; older Xcode versions get the older method names. */
  xcodeVersion?: [number, number] | null;
}

/** The method names Xcode used before 15.3, which renamed them. */
const PRE_XCODE_15_3_METHODS: Record<IosExportMethod, string> = {
  "app-store-connect": "app-store",
  "release-testing": "ad-hoc",
  enterprise: "enterprise",
  debugging: "development",
};

/** The export method name the given Xcode understands. */
export function exportMethodName(method: IosExportMethod, xcodeVersion?: [number, number] | null): string {
  if (!xcodeVersion) return method;
  const [major, minor] = xcodeVersion;
  const renamed = major > 15 || (major === 15 && minor >= 3);
  return renamed ? method : PRE_XCODE_15_3_METHODS[method];
}

/** Escapes text for a plist `<string>`. */
function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The export options as a plist. Manual signing (a provisioning profile is set) names the profile for the
 * app's bundle id and the signing certificate; automatic signing lets Xcode choose. Exports for App Store
 * Connect upload their symbols and keep the version and build number Wefter set.
 */
export function renderExportOptions(input: ExportOptionsInput): string {
  const { signing } = input;
  const manual = Boolean(signing.provisioningProfile);
  const entries: string[] = [
    `\t<key>method</key>\n\t<string>${exportMethodName(input.method, input.xcodeVersion)}</string>`,
    `\t<key>teamID</key>\n\t<string>${xmlEscape(signing.teamId)}</string>`,
    `\t<key>signingStyle</key>\n\t<string>${manual ? "manual" : "automatic"}</string>`,
    `\t<key>destination</key>\n\t<string>export</string>`,
  ];

  if (manual) {
    entries.push(
      `\t<key>provisioningProfiles</key>\n\t<dict>\n\t\t<key>${xmlEscape(input.bundleId)}</key>\n\t\t<string>${xmlEscape(signing.provisioningProfile!)}</string>\n\t</dict>`,
    );
    if (signing.signingIdentity) {
      entries.push(`\t<key>signingCertificate</key>\n\t<string>${xmlEscape(signing.signingIdentity)}</string>`);
    }
  }

  if (input.method === "app-store-connect") {
    entries.push(`\t<key>uploadSymbols</key>\n\t<true/>`);
    entries.push(`\t<key>manageAppVersionAndBuildNumber</key>\n\t<false/>`);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    entries.join("\n"),
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

/** Reads `[major, minor]` from `xcodebuild -version` output such as `Xcode 16.2`. */
export function parseXcodeVersion(output: string): [number, number] | null {
  const match = /Xcode\s+(\d+)(?:\.(\d+))?/.exec(output);
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : null;
}

/** The installed Xcode's version, or `null` when it cannot be read. */
export function readXcodeVersion(): Promise<[number, number] | null> {
  return new Promise((resolve) => {
    execFile("xcodebuild", ["-version"], (error, stdout) => resolve(error ? null : parseXcodeVersion(stdout)));
  });
}
