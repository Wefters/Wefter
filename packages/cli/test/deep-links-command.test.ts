import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WefterConfigSchema } from "../src/config/wefter-config-schema.js";
import {
  buildDomainFiles,
  checkDeepLinkDomains,
  collectFingerprints,
  deepLinkFiles,
  type Fetcher,
} from "../src/commands/deep-links.js";
import {
  DEBUG_KEYSTORE,
  normalizeFingerprint,
  parseSha256Fingerprint,
  readKeystoreFingerprint,
} from "../src/native/certificate-fingerprint.js";

const FINGERPRINT = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");

const rawConfig = {
  environments: {
    development: {
      appId: "com.example.shop.dev",
      appName: "Shop Dev",
      deepLinks: { domains: ["dev.shop.example.com"] },
    },
    production: { appId: "com.example.shop", appName: "Shop", iosBundleId: "com.example.shop.ios" },
  },
  deepLinks: { schemes: ["myshop"], domains: ["shop.example.com"], paths: ["/product/*"] },
  iosSigning: { teamId: "ABCDE12345" },
};

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "wefter-deep-links-cmd-"));
  writeFileSync(join(projectDir, "wefter.config.json"), JSON.stringify(rawConfig));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("fingerprints", () => {
  it("normalises any case, with or without colons, and rejects other values", () => {
    expect(normalizeFingerprint(FINGERPRINT.replace(/:/g, "").toLowerCase())).toBe(FINGERPRINT);
    expect(normalizeFingerprint("AB:CD")).toBeNull();
  });

  it("reads the SHA-256 line of keytool's output", () => {
    const output = `Alias name: androiddebugkey\nCertificate fingerprints:\n\t SHA1: AA:BB\n\t SHA256: ${FINGERPRINT}\n`;
    expect(parseSha256Fingerprint(output)).toBe(FINGERPRINT);
    expect(parseSha256Fingerprint("no fingerprint")).toBeNull();
  });

  it.runIf(existsSync(DEBUG_KEYSTORE.path))("reads this machine's debug keystore with keytool", async () => {
    const fingerprint = await readKeystoreFingerprint(
      DEBUG_KEYSTORE.path,
      DEBUG_KEYSTORE.alias,
      DEBUG_KEYSTORE.password,
    );
    expect(normalizeFingerprint(fingerprint)).toBe(fingerprint);
  });

  it("adds extra fingerprints and warns when none could be found", async () => {
    const config = WefterConfigSchema.parse(rawConfig);

    const withExtra = await collectFingerprints(projectDir, config, { extra: [FINGERPRINT.toLowerCase()] });
    expect(withExtra).toEqual({ fingerprints: [FINGERPRINT], warnings: [] });

    const none = await collectFingerprints(projectDir, config);
    expect(none.fingerprints).toEqual([]);
    expect(none.warnings.join(" ")).toMatch(/Android will not verify/);

    await expect(collectFingerprints(projectDir, config, { extra: ["nope"] })).rejects.toThrow(/not a SHA-256/);
  });
});

describe("buildDomainFiles", () => {
  it("lists every environment that opens a domain, with its own ids and paths", () => {
    const files = buildDomainFiles(WefterConfigSchema.parse(rawConfig), [FINGERPRINT]);

    expect(files.map((f) => f.domain)).toEqual(["dev.shop.example.com", "shop.example.com"]);
    const shop = files.find((f) => f.domain === "shop.example.com")!;
    expect(shop.apple).toEqual({
      applinks: { details: [{ appIDs: ["ABCDE12345.com.example.shop.ios"], components: [{ "/": "/product/*" }] }] },
    });
    expect(shop.android).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: "com.example.shop", sha256_cert_fingerprints: [FINGERPRINT] },
      },
    ]);
  });

  it("leaves out apple-app-site-association without a team id", () => {
    const { iosSigning: _, ...withoutTeam } = rawConfig;
    const files = buildDomainFiles(WefterConfigSchema.parse(withoutTeam), []);
    expect(files.every((f) => f.apple === null)).toBe(true);
  });
});

describe("deepLinkFiles", () => {
  it("writes each domain's files in the .well-known layout", async () => {
    const result = await deepLinkFiles(projectDir, { extra: [FINGERPRINT] });

    const dir = join(projectDir, ".wefter/deep-links/shop.example.com/.well-known");
    expect(result.written).toContain(join(dir, "assetlinks.json"));
    expect(JSON.parse(readFileSync(join(dir, "apple-app-site-association"), "utf-8")).applinks.details).toHaveLength(1);
  });

  it("explains that domains are needed when there are none", async () => {
    writeFileSync(
      join(projectDir, "wefter.config.json"),
      JSON.stringify({ ...rawConfig, deepLinks: {}, environments: { production: rawConfig.environments.production } }),
    );
    await expect(deepLinkFiles(projectDir)).rejects.toThrow(/No verified domains/);
  });
});

describe("checkDeepLinkDomains", () => {
  /** A fake site serving each domain's correct files, with `override` replacing some responses. */
  function site(override: Record<string, () => Response> = {}): Fetcher {
    const files = buildDomainFiles(WefterConfigSchema.parse(rawConfig), [FINGERPRINT]);
    return async (url) => {
      if (override[url]) return override[url]();
      const file = files.find((f) => url.startsWith(`https://${f.domain}/`))!;
      const body = url.endsWith("assetlinks.json") ? file.android : file.apple;
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    };
  }

  it("passes when every domain serves files that list the app", async () => {
    const results = await checkDeepLinkDomains(projectDir, { fingerprints: [FINGERPRINT], fetcher: site() });
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("fails a redirect, a wrong content type and a missing certificate", async () => {
    const assetLinks = "https://shop.example.com/.well-known/assetlinks.json";
    const aasa = "https://shop.example.com/.well-known/apple-app-site-association";

    const redirected = await checkDeepLinkDomains(projectDir, {
      fetcher: site({ [aasa]: () => new Response(null, { status: 301, headers: { location: "https://www.x" } }) }),
    });
    expect(redirected.find((r) => r.name === "shop.example.com apple-app-site-association")?.fix).toMatch(/redirects/);

    const asText = await checkDeepLinkDomains(projectDir, {
      fetcher: site({ [assetLinks]: () => new Response("[]", { headers: { "content-type": "text/plain" } }) }),
    });
    expect(asText.find((r) => r.name === "shop.example.com assetlinks.json")?.fix).toMatch(/application\/json/);

    const otherKey = normalizeFingerprint("ff".repeat(32))!;
    const wrongKey = await checkDeepLinkDomains(projectDir, { fingerprints: [otherKey], fetcher: site() });
    expect(wrongKey.find((r) => r.name === "shop.example.com assetlinks.json")?.fix).toMatch(
      /does not list the certificate/,
    );
  });

  it("fails a file that does not list one of the app ids", async () => {
    const aasa = "https://shop.example.com/.well-known/apple-app-site-association";
    const results = await checkDeepLinkDomains(projectDir, {
      fetcher: site({
        [aasa]: () =>
          new Response(JSON.stringify({ applinks: { details: [{ appIDs: ["OTHER.app"], components: [] }] } }), {
            headers: { "content-type": "application/json" },
          }),
      }),
    });
    expect(results.find((r) => r.name === "shop.example.com apple-app-site-association")?.fix).toMatch(
      /does not list ABCDE12345.com.example.shop.ios/,
    );
  });
});
