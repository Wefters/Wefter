import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface Snapshot {
  restore(): void;
  discard(): void;
}

function snapshotFiles(paths: string[]): Snapshot {
  const backupDir = join(tmpdir(), `wefter-sync-backup-${Date.now()}-${process.pid}`);
  const backups: { original: string; backup: string; existed: boolean }[] = [];

  for (const path of paths) {
    const existed = existsSync(path);
    const backup = join(backupDir, path.replace(/[/\\]/g, "_"));
    if (existed) {
      mkdirSync(backupDir, { recursive: true });
      cpSync(path, backup, { recursive: true });
    }
    backups.push({ original: path, backup, existed });
  }

  return {
    restore() {
      for (const { original, backup, existed } of backups) {
        rmSync(original, { recursive: true, force: true });
        if (existed) cpSync(backup, original, { recursive: true });
      }
      rmSync(backupDir, { recursive: true, force: true });
    },
    discard() {
      rmSync(backupDir, { recursive: true, force: true });
    },
  };
}

export async function runTransactionalSync<T>(filesToProtect: string[], syncFn: () => T | Promise<T>): Promise<T> {
  const snapshot = snapshotFiles(filesToProtect);
  try {
    const result = await syncFn();
    snapshot.discard();
    return result;
  } catch (err) {
    snapshot.restore();
    throw err;
  }
}
