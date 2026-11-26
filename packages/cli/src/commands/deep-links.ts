/**
 * `wefter deep-links`: the files a website serves so the app may open its `https` links, and a check of the
 * files a domain is serving.
 *
 * Android verifies App Links against `https://<domain>/.well-known/assetlinks.json` (package names and
 * signing certificate fingerprints). iOS verifies Universal Links against
 * `https://<domain>/.well-known/apple-app-site-association` (team id, bundle id and paths). Both must be
 * served directly, without redirects.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { iosBundleId, loadWefterConfig } from "../config/project-paths.js";
import { appleComponents, resolveDeepLinks } from "../config/deep-links.js";
import type { WefterConfig } from "../config/wefter-config-schema.js";
import type { CheckResult } from "../doctor/checks.js";
import { DEBUG_KEYSTORE, normalizeFingerprint, readKeystoreFingerprint } from "../native/certificate-fingerprint.js";

/** The relation that lets an app open every link of a domain. */
const HANDLE_ALL_URLS = "delegate_permission/common.handle_all_urls";

/** One `apple-app-site-association` entry: the app ids it covers and the paths they open. */
interface AppleAppLinkDetail {
  appIDs: string[];
  components: { "/": string }[];
}

/** The contents of `apple-app-site-association`. */
export interface AppleAppSiteAssociation {
  applinks: { details: AppleAppLinkDetail[] };
}

/** One `assetlinks.json` statement: an Android app and the certificates it may be signed with. */
export interface AssetLinkStatement {
  relation: string[];
  target: { namespace: "android_app"; package_name: string; sha256_cert_fingerprints: string[] };
}

/** The verification files for one domain. `apple` is `null` when the iOS team id is unknown. */
export interface DomainFiles {
  domain: string;
  apple: AppleAppSiteAssociation | null;
  android: AssetLinkStatement[];
}

/** Every verified domain, with the environments that open its links. */
function environmentsByDomain(config: WefterConfig): Map<string, string[]> {
  const byDomain = new Map<string, string[]>();
  for (const env of Object.keys(config.environments)) {
    for (const domain of resolveDeepLinks(config, env).domains) {
      byDomain.set(domain, [...(byDomain.get(domain) ?? []), env]);
    }
  }
  return byDomain;
}

/**
 * Builds both verification files for every domain in `deepLinks.domains` (top level and per environment).
 * Each environment that opens a domain's links is listed: on iOS by `<team id>.<bundle id>` with its paths,
 * on Android by app id with `fingerprints`.
 */
export function buildDomainFiles(config: WefterConfig, fingerprints: string[]): DomainFiles[] {
  const teamId = config.iosSigning?.teamId;
  return [...environmentsByDomain(config)].map(([domain, envs]) => ({
    domain,
    apple: teamId
      ? {
          applinks: {
            details: envs.map((env) => ({
              appIDs: [`${teamId}.${iosBundleId(config, env)}`],
              components: appleComponents(resolveDeepLinks(config, env).paths),
            })),
          },
        }
      : null,
    android: envs.map((env) => ({
      relation: [HANDLE_ALL_URLS],
      target: {
        namespace: "android_app",
        package_name: config.environments[env].appId,
        sha256_cert_fingerprints: fingerprints,
      },
    })),
  }));
}

/** Options for {@link collectFingerprints}. */
export interface FingerprintOptions {
  /** Extra fingerprints, such as the Play App Signing key from the Play Console. */
  extra?: string[];
  /** Also include the local debug keystore, so debug builds verify. Not for a production site. */
  debug?: boolean;
}

/**
 * The certificate fingerprints to list in `assetlinks.json`: the release keystore from `signing` (when
 * `WEFTER_KEYSTORE_PASSWORD` is set), the local debug keystore with `debug`, and any `extra` ones.
 *
 * @returns The fingerprints, and warnings about the ones that could not be read.
 * @throws {Error} When an `extra` value is not a SHA-256 fingerprint.
 */
export async function collectFingerprints(
  projectDir: string,
  config: WefterConfig,
  options: FingerprintOptions = {},
): Promise<{ fingerprints: string[]; warnings: string[] }> {
  const fingerprints: string[] = [];
  const warnings: string[] = [];

  if (config.signing) {
    const keystorePath = resolve(projectDir, config.signing.keystorePath);
    const password = process.env.WEFTER_KEYSTORE_PASSWORD;
    if (!password) {
      warnings.push("WEFTER_KEYSTORE_PASSWORD is not set, so the release keystore's fingerprint was left out");
    } else {
      try {
        fingerprints.push(await readKeystoreFingerprint(keystorePath, config.signing.keyAlias, password));
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  if (options.debug) {
    if (existsSync(DEBUG_KEYSTORE.path)) {
      try {
        fingerprints.push(
          await readKeystoreFingerprint(DEBUG_KEYSTORE.path, DEBUG_KEYSTORE.alias, DEBUG_KEYSTORE.password),
        );
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
    } else {
      warnings.push(`No debug keystore at ${DEBUG_KEYSTORE.path}; build a debug app once to create it`);
    }
  }

  for (const value of options.extra ?? []) {
    const fingerprint = normalizeFingerprint(value);
    if (!fingerprint) throw new Error(`"${value}" is not a SHA-256 certificate fingerprint`);
    fingerprints.push(fingerprint);
  }

  if (fingerprints.length === 0) {
    warnings.push(
      "assetlinks.json lists no certificate, so Android will not verify the app. Pass --fingerprint with the " +
        "app signing key from the Play Console, or set WEFTER_KEYSTORE_PASSWORD for the release keystore",
    );
  }
  return { fingerprints: [...new Set(fingerprints)], warnings };
}

/**
 * Writes each domain's files to `<outDir>/<domain>/.well-known/`, the layout they are served from.
 *
 * @returns The paths written.
 */
export function writeDomainFiles(outDir: string, files: DomainFiles[]): string[] {
  const written: string[] = [];
  for (const { domain, apple, android } of files) {
    const dir = join(outDir, domain, ".well-known");
    mkdirSync(dir, { recursive: true });

    const assetLinksPath = join(dir, "assetlinks.json");
    writeFileSync(assetLinksPath, JSON.stringify(android, null, 2) + "\n", "utf-8");
    written.push(assetLinksPath);

    if (apple) {
      const applePath = join(dir, "apple-app-site-association");
      writeFileSync(applePath, JSON.stringify(apple, null, 2) + "\n", "utf-8");
      written.push(applePath);
    }
  }
  return written;
}

/** Options for {@link deepLinkFiles}. */
export interface DeepLinkFilesOptions extends FingerprintOptions {
  /** Where to write the files; `.wefter/deep-links` by default. */
  outDir?: string;
}

/**
 * `wefter deep-links files`: writes the verification files of every domain.
 *
 * @returns The files written and warnings to show.
 * @throws {Error} When no domain is configured.
 */
export async function deepLinkFiles(
  projectDir: string,
  options: DeepLinkFilesOptions = {},
): Promise<{ written: string[]; warnings: string[] }> {
  const config = loadWefterConfig(projectDir);
  const { fingerprints, warnings } = await collectFingerprints(projectDir, config, options);
  const files = buildDomainFiles(config, fingerprints);
  if (files.length === 0) {
    throw new Error('No verified domains: add "deepLinks": { "domains": [...] } to wefter.config.json first.');
  }
  if (!config.iosSigning) {
    warnings.push('apple-app-site-association needs your Apple team id: add "iosSigning": { "teamId": ... }');
  }
  const outDir = resolve(projectDir, options.outDir ?? ".wefter/deep-links");
  return { written: writeDomainFiles(outDir, files), warnings };
}

/** Fetches a URL; replaceable in tests. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Downloads one verification file the way the platforms do: directly, without following redirects. */
async function fetchVerificationFile(
  url: string,
  fetcher: Fetcher,
): Promise<{ ok: true; json: unknown; contentType: string } | { ok: false; problem: string }> {
  let response: Response;
  try {
    response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    return { ok: false, problem: `could not be fetched (${error instanceof Error ? error.message : String(error)})` };
  }
  if (response.status >= 300 && response.status < 400) {
    return { ok: false, problem: `redirects (HTTP ${response.status}); it must be served directly` };
  }
  if (response.status !== 200) return { ok: false, problem: `returned HTTP ${response.status}` };
  try {
    return { ok: true, json: await response.json(), contentType: response.headers.get("content-type") ?? "" };
  } catch {
    return { ok: false, problem: "is not valid JSON" };
  }
}

/** Checks a served `apple-app-site-association` against the app ids it should list. */
function checkAppleFile(json: unknown, expected: AppleAppSiteAssociation | null): string | null {
  if (!expected) return 'the Apple team id is unknown; add "iosSigning": { "teamId": ... } to check this file';
  const details = (json as { applinks?: { details?: { appIDs?: string[]; appID?: string }[] } }).applinks?.details;
  if (!Array.isArray(details)) return "has no applinks.details";
  const served = new Set(details.flatMap((d) => [...(d.appIDs ?? []), ...(d.appID ? [d.appID] : [])]));
  const missing = expected.applinks.details.flatMap((d) => d.appIDs).filter((id) => !served.has(id));
  return missing.length > 0 ? `does not list ${missing.join(", ")}` : null;
}

/** Checks a served `assetlinks.json` against the packages and fingerprints it should list. */
function checkAndroidFile(json: unknown, contentType: string, expected: AssetLinkStatement[]): string | null {
  if (!contentType.includes("application/json")) return `is served as "${contentType}"; Android needs application/json`;
  if (!Array.isArray(json)) return "is not a JSON array";
  const statements = json as Partial<AssetLinkStatement>[];
  for (const { target } of expected) {
    const served = statements.find(
      (s) => s.target?.package_name === target.package_name && s.relation?.includes(HANDLE_ALL_URLS),
    );
    if (!served) return `does not list ${target.package_name} with ${HANDLE_ALL_URLS}`;
    const servedFingerprints = new Set(
      (served.target?.sha256_cert_fingerprints ?? []).map((f) => normalizeFingerprint(f) ?? f),
    );
    if (servedFingerprints.size === 0) return `lists no certificate for ${target.package_name}`;
    const missing = target.sha256_cert_fingerprints.filter((f) => !servedFingerprints.has(f));
    if (missing.length > 0) return `does not list the certificate ${missing.join(", ")} for ${target.package_name}`;
  }
  return null;
}

/**
 * `wefter deep-links check`: downloads both files from every domain and checks that they list this app.
 * Fingerprints are only compared when given; otherwise each package just needs one.
 */
export async function checkDeepLinkDomains(
  projectDir: string,
  options: { fingerprints?: string[]; fetcher?: Fetcher } = {},
): Promise<CheckResult[]> {
  const config = loadWefterConfig(projectDir);
  const fingerprints = (options.fingerprints ?? []).map((value) => {
    const fingerprint = normalizeFingerprint(value);
    if (!fingerprint) throw new Error(`"${value}" is not a SHA-256 certificate fingerprint`);
    return fingerprint;
  });
  const fetcher = options.fetcher ?? fetch;
  const results: CheckResult[] = [];

  for (const expected of buildDomainFiles(config, fingerprints)) {
    const base = `https://${expected.domain}/.well-known`;

    const android = await fetchVerificationFile(`${base}/assetlinks.json`, fetcher);
    const androidProblem = android.ok
      ? checkAndroidFile(android.json, android.contentType, expected.android)
      : android.problem;
    results.push({
      name: `${expected.domain} assetlinks.json`,
      passed: androidProblem === null,
      fix: androidProblem ? `${base}/assetlinks.json ${androidProblem}` : undefined,
    });

    const apple = await fetchVerificationFile(`${base}/apple-app-site-association`, fetcher);
    const appleProblem = apple.ok ? checkAppleFile(apple.json, expected.apple) : apple.problem;
    results.push({
      name: `${expected.domain} apple-app-site-association`,
      passed: appleProblem === null,
      fix: appleProblem ? `${base}/apple-app-site-association ${appleProblem}` : undefined,
    });
  }

  if (results.length === 0) {
    throw new Error('No verified domains: add "deepLinks": { "domains": [...] } to wefter.config.json first.');
  }
  return results;
}
