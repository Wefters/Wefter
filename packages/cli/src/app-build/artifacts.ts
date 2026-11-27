/**
 * The output folder of `wefter build`: built files are copied to `<output>/<platform>/<env>/<version>-<build>/`
 * with a `build-info.json` describing them (version, git commit, checksums, signing certificate), so every
 * build can be traced back to its source.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CLI_VERSION } from "../internal/version.js";

/** What a built file is. */
export type ArtifactKind = "apk" | "aab" | "app" | "ipa" | "mapping" | "native-symbols" | "dsyms";

/** A file in the output folder. Folders (a simulator `.app`) have no checksum. */
export interface Artifact {
  kind: ArtifactKind;
  path: string;
  sizeBytes: number;
  sha256: string | null;
}

/** The contents of `build-info.json`. */
export interface BuildInfo {
  app: { name: string; id: string };
  platform: "android" | "ios";
  environment: string;
  release: boolean;
  version: string;
  buildNumber: number;
  format?: string;
  exportMethod?: string;
  signed: boolean;
  signingCertificateSha256?: string;
  git: { commit: string | null; dirty: boolean | null };
  cli: string;
  builtAt: string;
  artifacts: { kind: ArtifactKind; file: string; sizeBytes: number; sha256: string | null }[];
}

/**
 * The output folder: `--output`, else `build.output` from the config, made absolute.
 *
 * @throws {Error} When it is the project itself, the web app's folder (or contains it), or inside `.wefter`.
 */
export function resolveOutputRoot(projectDir: string, configured: string, webDir: string, option?: string): string {
  const output = resolve(projectDir, option ?? configured);
  const web = resolve(projectDir, webDir);
  const project = resolve(projectDir);
  const inside = (child: string, parent: string) => child === parent || child.startsWith(parent + sep);

  if (output === project) {
    throw new Error(`The build output folder cannot be the project folder itself; choose one such as "build"`);
  }
  if (inside(output, web) || inside(web, output)) {
    throw new Error(
      `The build output folder (${relative(project, output) || "."}) overlaps the web app's folder "${webDir}"; ` +
        `choose another with --output or "build": { "output": … } in wefter.config.json`,
    );
  }
  if (inside(output, join(project, ".wefter"))) {
    throw new Error("The build output folder cannot be inside .wefter, which `wefter sync` regenerates");
  }
  return output;
}

/** The folder one build's files go to: `<output>/<platform>/<env>/<version>-<buildNumber>`. */
export function buildOutputDir(
  outputRoot: string,
  platform: "android" | "ios",
  env: string,
  version: { version: string; buildNumber: number },
): string {
  return join(outputRoot, platform, env, `${version.version}-${version.buildNumber}`);
}

/** SHA-256 of a file, in hex. */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolvePromise(hash.digest("hex")));
  });
}

/** Total size of a file or folder. */
function sizeOf(path: string): number {
  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.size;
  return readdirSync(path).reduce((total, entry) => total + sizeOf(join(path, entry)), 0);
}

/**
 * Copies a built file (or folder) into `outDir`, replacing an earlier copy, and describes it.
 *
 * @param fileName Name in the output folder; the source's own name when left out.
 */
export async function collectArtifact(
  kind: ArtifactKind,
  source: string,
  outDir: string,
  fileName = basename(source),
): Promise<Artifact> {
  mkdirSync(outDir, { recursive: true });
  const target = join(outDir, fileName);
  if (resolve(source) !== resolve(target)) {
    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, { recursive: true });
  }
  const isDirectory = statSync(target).isDirectory();
  return { kind, path: target, sizeBytes: sizeOf(target), sha256: isDirectory ? null : await sha256File(target) };
}

/** The current git commit of the project and whether there are uncommitted changes; `null`s outside git. */
export function gitState(projectDir: string): { commit: string | null; dirty: boolean | null } {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectDir, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: projectDir,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    return { commit: commit || null, dirty: status.trim().length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}

/** Writes `build-info.json` into `outDir`, listing the artifacts by file name. */
export function writeBuildInfo(
  outDir: string,
  info: Omit<BuildInfo, "artifacts" | "cli" | "builtAt">,
  artifacts: Artifact[],
): {
  path: string;
  info: BuildInfo;
} {
  const full: BuildInfo = {
    ...info,
    cli: CLI_VERSION,
    builtAt: new Date().toISOString(),
    artifacts: artifacts.map((a) => ({
      kind: a.kind,
      file: basename(a.path),
      sizeBytes: a.sizeBytes,
      sha256: a.sha256,
    })),
  };
  const path = join(outDir, "build-info.json");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path, JSON.stringify(full, null, 2) + "\n");
  return { path, info: full };
}

/**
 * The highest build number of an earlier release build of this platform and environment in the output
 * folder, other than the one in `excludeDir` (a rebuild of the same version replaces it). `null` when
 * there is none.
 */
export function highestReleasedBuildNumber(
  outputRoot: string,
  platform: "android" | "ios",
  env: string,
  excludeDir?: string,
): { buildNumber: number; version: string } | null {
  const envDir = join(outputRoot, platform, env);
  if (!existsSync(envDir)) return null;
  let best: { buildNumber: number; version: string } | null = null;
  for (const entry of readdirSync(envDir)) {
    const dir = join(envDir, entry);
    if (excludeDir && resolve(dir) === resolve(excludeDir)) continue;
    const infoPath = join(dir, "build-info.json");
    if (!existsSync(infoPath)) continue;
    try {
      const info = JSON.parse(readFileSync(infoPath, "utf-8")) as Partial<BuildInfo>;
      if (!info.release || typeof info.buildNumber !== "number") continue;
      if (!best || info.buildNumber > best.buildNumber) {
        best = { buildNumber: info.buildNumber, version: String(info.version ?? "") };
      }
    } catch {
      continue;
    }
  }
  return best;
}

/** A path relative to the project when it is inside it, for display. */
export function displayPath(projectDir: string, path: string): string {
  const rel = relative(projectDir, path);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path;
}

/**
 * Whether the project's `.gitignore` lists the output folder, so built apps (and their symbols) stay out of
 * git. `true` when there is no `.gitignore` or the folder is outside the project.
 */
export function outputFolderIgnored(projectDir: string, outputRoot: string): boolean {
  const gitignorePath = join(projectDir, ".gitignore");
  const rel = relative(projectDir, outputRoot).split(sep).join("/");
  if (!existsSync(gitignorePath) || !rel || rel.startsWith("..")) return true;
  const entries = readFileSync(gitignorePath, "utf-8")
    .split("\n")
    .map((line) => line.trim().replace(/^\//, "").replace(/\/$/, ""))
    .filter((line) => line && !line.startsWith("#"));
  return entries.some((entry) => entry === rel || rel.startsWith(`${entry}/`));
}
