import { spawn } from "node:child_process";

export function runNpmInstall(projectDir: string, packageSpec: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("npm", ["install", packageSpec], { cwd: projectDir, stdio: "inherit" });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install ${packageSpec} failed with exit code ${code}`));
    });
    proc.on("error", reject);
  });
}
