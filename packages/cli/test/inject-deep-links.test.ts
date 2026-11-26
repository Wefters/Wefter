import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  androidFlavorManifestPath,
  injectDeepLinksAndroid,
  injectDeepLinksIos,
  iosEntitlementsPath,
  renderAndroidFlavorManifest,
} from "../src/native/inject-deep-links.js";

const iosTemplateDir = join(dirname(fileURLToPath(import.meta.url)), "../../../shells/ios-template");

const none = { schemes: [], domains: [], paths: [] };
const shop = { schemes: ["myshop"], domains: ["shop.example.com"], paths: ["/product/*", "/about"] };
const shopDev = { schemes: ["myshop-dev", "myshop-test"], domains: [], paths: [] };

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "wefter-deep-links-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Reads a plist as JSON with `plutil` (macOS only). */
function plistJson(path: string): Record<string, unknown> {
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path], { encoding: "utf-8" }));
}

describe("renderAndroidFlavorManifest", () => {
  it("adds a filter per scheme and an autoVerify filter per domain, limited to the paths", () => {
    const manifest = renderAndroidFlavorManifest(shop)!;

    expect(manifest).toContain('<activity android:name=".MainActivity">');
    expect(manifest).toContain('<data android:scheme="myshop" />');
    expect(manifest).toContain('<intent-filter android:autoVerify="true">');
    expect(manifest).toContain('<data android:host="shop.example.com" />');
    expect(manifest).toContain('<data android:pathPrefix="/product/" />');
    expect(manifest).toContain('<data android:path="/about" />');
  });

  it("opens every path of a domain when no paths are given", () => {
    const manifest = renderAndroidFlavorManifest({ ...shop, paths: [] })!;
    expect(manifest).not.toMatch(/android:path/);
  });

  it("gives null for an environment without deep links", () => {
    expect(renderAndroidFlavorManifest(none)).toBeNull();
  });
});

describe("injectDeepLinksAndroid", () => {
  it("writes each environment's flavor manifest and removes it once its links are gone", () => {
    injectDeepLinksAndroid(tmpDir, { development: shopDev, production: shop });

    const dev = readFileSync(androidFlavorManifestPath(tmpDir, "development"), "utf-8");
    const prod = readFileSync(androidFlavorManifestPath(tmpDir, "production"), "utf-8");
    expect(dev).toContain('android:scheme="myshop-dev"');
    expect(dev).not.toContain('android:scheme="myshop"');
    expect(prod).toContain('android:host="shop.example.com"');

    injectDeepLinksAndroid(tmpDir, { development: none, production: shop });
    expect(existsSync(androidFlavorManifestPath(tmpDir, "development"))).toBe(false);
  });

  it("refuses to replace a flavor manifest written by hand, and leaves it alone when there is nothing to write", () => {
    const path = androidFlavorManifestPath(tmpDir, "production");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "<manifest />");

    expect(() => injectDeepLinksAndroid(tmpDir, { production: shop })).toThrow(/not written by wefter sync/);
    injectDeepLinksAndroid(tmpDir, { production: none });
    expect(readFileSync(path, "utf-8")).toBe("<manifest />");
  });
});

describe("injectDeepLinksIos", () => {
  let projectDir: string;
  let plistPath: string;
  let configDir: string;

  beforeEach(() => {
    projectDir = join(tmpDir, "ios");
    cpSync(join(iosTemplateDir, "Config"), join(projectDir, "Config"), { recursive: true });
    mkdirSync(join(projectDir, "WefterBridge"));
    cpSync(join(iosTemplateDir, "WefterBridge/Info.plist"), join(projectDir, "WefterBridge/Info.plist"));
    plistPath = join(projectDir, "WefterBridge/Info.plist");
    configDir = join(projectDir, "Config");
  });

  const xcconfig = (env: string) => readFileSync(join(configDir, `Environment-${env}.xcconfig`), "utf-8");

  it("lists one scheme slot per scheme and fills the slots per environment", () => {
    injectDeepLinksIos(plistPath, configDir, { development: shopDev, production: shop });

    const plist = readFileSync(plistPath, "utf-8");
    expect(plist).toContain("<string>$(WEFTER_URL_SCHEME_1)</string>");
    expect(plist).toContain("<string>$(WEFTER_URL_SCHEME_2)</string>");
    expect(plist).not.toContain("WEFTER_URL_SCHEME_3");

    expect(xcconfig("development")).toContain("WEFTER_URL_SCHEME_1 = myshop-dev");
    expect(xcconfig("development")).toContain("WEFTER_URL_SCHEME_2 = myshop-test");
    expect(xcconfig("production")).toContain("WEFTER_URL_SCHEME_1 = myshop");
    expect(xcconfig("production")).toContain("WEFTER_URL_SCHEME_2 = myshop");

    if (process.platform === "darwin") {
      const urlTypes = plistJson(plistPath).CFBundleURLTypes as { CFBundleURLSchemes: string[] }[];
      expect(urlTypes[0].CFBundleURLSchemes).toEqual(["$(WEFTER_URL_SCHEME_1)", "$(WEFTER_URL_SCHEME_2)"]);
    }
  });

  it("fills the slots of an environment without schemes with its bundle id", () => {
    injectDeepLinksIos(plistPath, configDir, { production: shop });

    expect(xcconfig("development")).toContain("WEFTER_URL_SCHEME_1 = $(PRODUCT_BUNDLE_IDENTIFIER)");
  });

  it("writes an entitlements file for an environment with domains and points its xcconfig at it", () => {
    injectDeepLinksIos(plistPath, configDir, { development: shopDev, production: shop });

    const entitlementsPath = iosEntitlementsPath(join(projectDir, "WefterBridge"), "production");
    expect(xcconfig("production")).toContain(
      "CODE_SIGN_ENTITLEMENTS = WefterBridge/Entitlements-production.entitlements",
    );
    expect(xcconfig("development")).not.toContain("CODE_SIGN_ENTITLEMENTS");
    expect(existsSync(iosEntitlementsPath(join(projectDir, "WefterBridge"), "development"))).toBe(false);

    if (process.platform === "darwin") {
      expect(plistJson(entitlementsPath)["com.apple.developer.associated-domains"]).toEqual([
        "applinks:shop.example.com",
      ]);
    }
  });

  it("gives the same files when run twice, and returns to the template when the links are removed", () => {
    const templatePlist = readFileSync(plistPath, "utf-8");
    injectDeepLinksIos(plistPath, configDir, { development: shopDev, production: shop });
    const once = [readFileSync(plistPath, "utf-8"), xcconfig("development"), xcconfig("production")];
    injectDeepLinksIos(plistPath, configDir, { development: shopDev, production: shop });
    expect([readFileSync(plistPath, "utf-8"), xcconfig("development"), xcconfig("production")]).toEqual(once);

    injectDeepLinksIos(plistPath, configDir, {});
    expect(readFileSync(plistPath, "utf-8")).toBe(templatePlist);
    expect(xcconfig("production")).toBe(
      readFileSync(join(iosTemplateDir, "Config/Environment-production.xcconfig"), "utf-8"),
    );
    expect(existsSync(iosEntitlementsPath(join(projectDir, "WefterBridge"), "production"))).toBe(false);
  });

  it("adds the markers to files that predate them", () => {
    writeFileSync(
      plistPath,
      `<plist version="1.0">\n<dict>\n\t<key>CFBundleName</key>\n\t<string>X</string>\n</dict>\n</plist>`,
    );
    writeFileSync(join(configDir, "Environment-production.xcconfig"), "PRODUCT_NAME = X\n");

    injectDeepLinksIos(plistPath, configDir, { production: shop });

    expect(readFileSync(plistPath, "utf-8")).toContain("$(WEFTER_URL_SCHEME_1)");
    expect(xcconfig("production")).toBe(
      "PRODUCT_NAME = X\n// WEFTER-DEEPLINKS-START\nWEFTER_URL_SCHEME_1 = myshop\n" +
        "CODE_SIGN_ENTITLEMENTS = WefterBridge/Entitlements-production.entitlements\n// WEFTER-DEEPLINKS-END\n",
    );
  });

  it("refuses to add a second CFBundleURLTypes next to one written by hand", () => {
    writeFileSync(
      plistPath,
      `<plist version="1.0">\n<dict>\n\t<key>CFBundleURLTypes</key>\n\t<array/>\n</dict>\n</plist>`,
    );

    expect(() => injectDeepLinksIos(plistPath, configDir, { production: shop })).toThrow(
      /already declares CFBundleURLTypes/,
    );
    expect(() => injectDeepLinksIos(plistPath, configDir, {})).not.toThrow();
  });
});
