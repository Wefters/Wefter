import { spawn } from "node:child_process";

export function openCommandFor(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["cmd", ["/c", "start", '""', url]];
  return ["xdg-open", [url]];
}

/** Opens a URL in the default browser. Resolves false if no opener could be started. */
export function openUrl(url: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const [command, args] = openCommandFor(platform, url);
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: "ignore", detached: true });
      child.on("error", () => resolve(false));
      child.on("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
