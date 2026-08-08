import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function syncMarkerPath(projectDir: string): string {
  return join(projectDir, ".wefter", ".sync-marker");
}

function configHash(projectDir: string): string {
  const configPath = join(projectDir, "wefter.config.json");
  const contents = existsSync(configPath) ? readFileSync(configPath) : Buffer.alloc(0);
  return createHash("sha256").update(contents).digest("hex");
}

export interface SyncFreshness {
  fresh: boolean;
  reason?: string;
}

export function checkSyncFreshness(projectDir: string): SyncFreshness {
  const markerPath = syncMarkerPath(projectDir);
  if (!existsSync(markerPath)) {
    return { fresh: false, reason: "Project has never been synced. Run `wefter sync` first." };
  }

  const lastSyncedHash = readFileSync(markerPath, "utf-8").trim();
  if (lastSyncedHash !== configHash(projectDir)) {
    return {
      fresh: false,
      reason: "wefter.config.json has changed since the last `wefter sync`. Run `wefter sync` before building.",
    };
  }

  return { fresh: true };
}

export function writeSyncMarker(projectDir: string): void {
  const markerPath = syncMarkerPath(projectDir);
  mkdirSync(join(projectDir, ".wefter"), { recursive: true });
  writeFileSync(markerPath, configHash(projectDir), "utf-8");
}
