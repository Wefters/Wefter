/**
 * Checks on built Android files: that release APKs and App Bundles are signed, and that APKs with native
 * libraries are aligned for 16 KB memory pages, which Google Play requires for apps targeting Android 15+.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeFingerprint } from "./certificate-fingerprint.js";

/** The Android SDK folder: `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or the default Android Studio location. */
export function androidSdkDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    process.platform === "darwin" ? join(homedir(), "Library/Android/sdk") : undefined,
    process.platform === "linux" ? join(homedir(), "Android/Sdk") : undefined,
    process.platform === "win32" && env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Android", "Sdk") : undefined,
  ];
  return candidates.find((dir): dir is string => Boolean(dir && existsSync(dir))) ?? null;
}

/** Compares build-tools folder names such as `35.0.0` and `36.0.0-rc1` by their numbers. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** A tool from the newest installed build-tools, such as `apksigner` or `zipalign`, or `null`. */
export function findBuildTool(name: "apksigner" | "zipalign", env: NodeJS.ProcessEnv = process.env): string | null {
  const sdk = androidSdkDir(env);
  if (!sdk) return null;
  const buildToolsDir = join(sdk, "build-tools");
  if (!existsSync(buildToolsDir)) return null;
  const versions = readdirSync(buildToolsDir).sort(compareVersions).reverse();
  const fileName = process.platform === "win32" ? (name === "apksigner" ? "apksigner.bat" : "zipalign.exe") : name;
  for (const version of versions) {
    const tool = join(buildToolsDir, version, fileName);
    if (existsSync(tool)) return tool;
  }
  return null;
}

/** `jarsigner` from `JAVA_HOME` when it is set, else from the `PATH`. */
function jarsignerCommand(): string {
  const javaHome = process.env.JAVA_HOME;
  const fromJavaHome = javaHome
    ? join(javaHome, "bin", process.platform === "win32" ? "jarsigner.exe" : "jarsigner")
    : null;
  return fromJavaHome && existsSync(fromJavaHome) ? fromJavaHome : "jarsigner";
}

/** Runs a command and gives its exit status and output, without throwing. */
function run(command: string, args: string[]): Promise<{ ok: boolean; output: string; notFound: boolean }> {
  return new Promise((resolve) => {
    execFile(command, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const notFound = (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
      resolve({ ok: !error, output: `${stdout}${stderr}`, notFound });
    });
  });
}

/** Outcome of a check: `ok`, or a warning explaining what is wrong or could not be checked. */
export interface VerifyResult {
  ok: boolean;
  warning?: string;
  /** The signing certificate's SHA-256 fingerprint, when the check read it. */
  fingerprint?: string;
}

/** The SHA-256 of the first signer in `apksigner verify --print-certs` output. */
export function parseApksignerFingerprint(output: string): string | null {
  const match = /certificate SHA-256 digest:\s*([0-9a-fA-F]{64})/.exec(output);
  return match ? normalizeFingerprint(match[1]) : null;
}

/** Verifies an APK's signature with `apksigner`, and reads its certificate fingerprint. */
export async function verifyApkSignature(apkPath: string): Promise<VerifyResult> {
  const apksigner = findBuildTool("apksigner");
  if (!apksigner) {
    return { ok: false, warning: "could not verify the APK signature: apksigner was not found in the Android SDK" };
  }
  const result = await run(apksigner, ["verify", "--print-certs", apkPath]);
  if (!result.ok) {
    const reason =
      result.output
        .trim()
        .split("\n")
        .find((line) => line.trim()) ?? "unknown error";
    return { ok: false, warning: `the APK signature does not verify: ${reason}` };
  }
  return { ok: true, fingerprint: parseApksignerFingerprint(result.output) ?? undefined };
}

/** Verifies an App Bundle's signature with `jarsigner`. */
export async function verifyAabSignature(aabPath: string): Promise<VerifyResult> {
  const result = await run(jarsignerCommand(), ["-verify", aabPath]);
  if (result.notFound) {
    return { ok: false, warning: "could not verify the App Bundle signature: jarsigner was not found (set JAVA_HOME)" };
  }
  if (!result.ok || !/jar verified/i.test(result.output) || /unsigned/i.test(result.output)) {
    const reason =
      result.output
        .trim()
        .split("\n")
        .find((line) => line.trim()) ?? "unknown error";
    return { ok: false, warning: `the App Bundle signature does not verify: ${reason}` };
  }
  return { ok: true };
}

/**
 * Checks that the native libraries in an APK are aligned for 16 KB memory pages (`zipalign -c -P 16`).
 * An APK without native libraries passes.
 */
export async function verify16KbAlignment(apkPath: string): Promise<VerifyResult> {
  const zipalign = findBuildTool("zipalign");
  if (!zipalign) return { ok: false, warning: "could not check 16 KB page alignment: zipalign was not found" };
  const result = await run(zipalign, ["-c", "-P", "16", "-v", "4", apkPath]);
  if (result.ok) return { ok: true };
  if (/invalid option|unknown option|usage:/i.test(result.output) && !/Verifying alignment/i.test(result.output)) {
    return {
      ok: false,
      warning:
        "could not check 16 KB page alignment: zipalign is too old (install Android SDK build-tools 35 or newer)",
    };
  }
  const misaligned = result.output
    .split("\n")
    .filter((line) => /\.so\b/.test(line) && /BAD/i.test(line))
    .map((line) => line.trim().split(/\s+/).pop())
    .filter(Boolean);
  return {
    ok: false,
    warning:
      misaligned.length > 0
        ? `native libraries are not 16 KB aligned, which Google Play rejects: ${misaligned.slice(0, 5).join(", ")}`
        : "the APK is not 16 KB page aligned, which Google Play rejects for apps targeting Android 15+",
  };
}
