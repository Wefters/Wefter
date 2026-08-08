import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DiscoveredPlugin } from "@wefter/registry-codegen";

const LOCKFILE_NAME = "wefter.lock.json";

interface LockEntry {
  resolved: string;
  integrity: string;
}

interface WefterLock {
  plugins: Record<string, LockEntry>;
  syncedAt: string;
}

function lockfilePath(projectDir: string): string {
  return join(projectDir, LOCKFILE_NAME);
}

export function readInstalledVersion(packageDir: string): string {
  const packageJsonPath = join(packageDir, "package.json");
  if (!existsSync(packageJsonPath)) return "0.0.0";
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function computeIntegrityHash(packageDir: string): string {
  const hash = createHash("sha256");

  const manifestPath = join(packageDir, "plugin.json");
  if (existsSync(manifestPath)) hash.update(readFileSync(manifestPath));

  hash.update(readInstalledVersion(packageDir));

  const androidDir = join(packageDir, "android");
  if (existsSync(androidDir)) {
    for (const file of readdirSync(androidDir).filter((f) => f.endsWith(".kt")).sort()) {
      hash.update(file);
      hash.update(readFileSync(join(androidDir, file)));
    }
  }

  
  
  
  const iosDir = join(packageDir, "ios");
  if (existsSync(iosDir)) {
    for (const file of readdirSync(iosDir).filter((f) => f.endsWith(".swift")).sort()) {
      hash.update(file);
      hash.update(readFileSync(join(iosDir, file)));
    }
  }

  return `sha256-${hash.digest("hex")}`;
}

export function readLockfileIfExists(projectDir: string): WefterLock | null {
  const path = lockfilePath(projectDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as WefterLock;
}

export function writeLockfile(projectDir: string, plugins: DiscoveredPlugin[]): void {
  const lock: WefterLock = {
    plugins: Object.fromEntries(
      plugins.map((p) => [
        p.manifest.name,
        { resolved: readInstalledVersion(p.packageDir), integrity: computeIntegrityHash(p.packageDir) },
      ]),
    ),
    syncedAt: new Date().toISOString(),
  };
  writeFileSync(lockfilePath(projectDir), JSON.stringify(lock, null, 2) + "\n", "utf-8");
}

export function checkLockDrift(projectDir: string, plugins: DiscoveredPlugin[]): string[] {
  const lock = readLockfileIfExists(projectDir);
  if (!lock) return [];

  const drifted: string[] = [];
  for (const plugin of plugins) {
    const locked = lock.plugins[plugin.manifest.name];
    if (!locked) continue;
    const currentVersion = readInstalledVersion(plugin.packageDir);
    if (locked.resolved !== currentVersion) {
      drifted.push(`${plugin.manifest.name}: locked at ${locked.resolved}, found ${currentVersion}`);
    }
  }
  return drifted;
}
