import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import { WefterConfigSchema } from "../config/wefter-config-schema.js";
import { runTransactionalSync } from "../utils/transactional-sync.js";
import { CLI_VERSION, CORE_VERSION } from "../internal/version.js";

export type PackageManager = "npm" | "yarn" | "pnpm";

export type PromptFn = (question: string, defaultValue: string) => Promise<string>;

export interface InitVersions {
  coreVersion?: string;
  cliVersion?: string;
}

export interface InitResult {
  configPath: string;
  packageManager: PackageManager;
  envWritten: boolean;
  gitignoreUpdated: boolean;
  appId: string;
  appName: string;
  webDir: string;
}

const LOCKFILES: { file: string; packageManager: PackageManager }[] = [
  { file: "package-lock.json", packageManager: "npm" },
  { file: "yarn.lock", packageManager: "yarn" },
  { file: "pnpm-lock.yaml", packageManager: "pnpm" },
];

const ENV_KEYS = ["WEFTER_APP_ID", "WEFTER_APP_NAME", "WEFTER_WEB_DIR"] as const;
const ENV_START_MARKER = "# --- wefter ---";
const ENV_END_MARKER = "# --- end wefter ---";

function unscopedName(pkgName: string): string {
  return pkgName.replace(/^@[^/]+\//, "");
}

function deriveAppIdDefault(pkgName: string): string {
  const sanitized = unscopedName(pkgName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "");
  return `dev.local.${sanitized || "app"}`;
}

function deriveAppNameDefault(pkgName: string): string {
  const words = unscopedName(pkgName)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1));
  return words.length > 0 ? words.join(" ") : "App";
}

function detectPackageManager(projectDir: string): PackageManager {
  const found = LOCKFILES.filter(({ file }) => existsSync(join(projectDir, file)));
  if (found.length > 1) {
    throw new Error(
      `Multiple lockfiles found (${found.map((f) => f.file).join(", ")}) — remove all but one so wefter knows which package manager to use.`,
    );
  }
  return found.length === 1 ? found[0].packageManager : "npm";
}

async function withRealPrompt<T>(run: (ask: PromptFn) => Promise<T>): Promise<T> {
  const rl = createInterface({ input: stdin, output: stdout });

  const onSigint = () => {
    stdout.write("\n" + chalk.yellow("✖ Initialization cancelled.") + "\n\n");
    process.exit(130);
  };
  rl.on("SIGINT", onSigint);
  process.on("SIGINT", onSigint);

  stdout.write("\n" + chalk.bold.cyan("🚀 Welcome to Wefter!") + "\n");
  stdout.write(
    chalk.gray("   Let's set up your project. Press ") +
      chalk.bold("Ctrl+C") +
      chalk.gray(" at any prompt to cancel.") +
      "\n\n",
  );

  const lines = rl[Symbol.asyncIterator]();
  const ask: PromptFn = async (question, defaultValue) => {
    const prefix = chalk.cyan(chalk.bold("?"));
    const label = chalk.bold(question);
    const defaultHint = chalk.gray(`(${defaultValue})`);
    const pointer = chalk.cyan("›");
    stdout.write(`${prefix} ${label} ${defaultHint} ${pointer} `);
    const { value, done } = await lines.next();
    if (!rl.terminal) {
      stdout.write("\n");
    }
    const answer = done ? "" : value.trim();
    return answer === "" ? defaultValue : answer;
  };
  try {
    return await run(ask);
  } finally {
    rl.off("SIGINT", onSigint);
    process.off("SIGINT", onSigint);
    rl.close();
  }
}

function readPackageJson(projectDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8"));
}

function findExistingWefterDeps(pkg: Record<string, unknown>): string[] {
  const deps = (pkg.dependencies as Record<string, string> | undefined) ?? {};
  const devDeps = (pkg.devDependencies as Record<string, string> | undefined) ?? {};
  return ["@wefterjs/core", "@wefterjs/cli"].filter((name) => deps[name] !== undefined || devDeps[name] !== undefined);
}

function findEnvKeyConflicts(projectDir: string): string[] {
  const envPath = join(projectDir, ".env");
  if (!existsSync(envPath)) return [];
  const content = readFileSync(envPath, "utf-8");
  return ENV_KEYS.filter((key) => new RegExp(`^${key}=`, "m").test(content));
}

function updatePackageJson(projectDir: string, versions: { coreVersion: string; cliVersion: string }): void {
  const pkgPath = join(projectDir, "package.json");
  const pkg = readPackageJson(projectDir);
  pkg.dependencies = {
    ...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
    "@wefterjs/core": versions.coreVersion,
  };
  pkg.devDependencies = {
    ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
    "@wefterjs/cli": versions.cliVersion,
  };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

function writeEnvBlock(projectDir: string, values: { appId: string; appName: string; webDir: string }): void {
  const envPath = join(projectDir, ".env");
  const block = [
    ENV_START_MARKER,
    `WEFTER_APP_ID=${values.appId}`,
    `WEFTER_APP_NAME=${values.appName}`,
    `WEFTER_WEB_DIR=${values.webDir}`,
    ENV_END_MARKER,
    "",
  ].join("\n");

  if (existsSync(envPath)) {
    const existing = readFileSync(envPath, "utf-8");
    const sep = existing === "" || existing.endsWith("\n") ? "" : "\n";
    writeFileSync(envPath, existing + sep + block);
  } else {
    writeFileSync(envPath, block);
  }
}

function appendGitignore(projectDir: string): boolean {
  const gitignorePath = join(projectDir, ".gitignore");
  if (!existsSync(gitignorePath)) return false;
  const content = readFileSync(gitignorePath, "utf-8");
  if (/(^|\n)\.wefter\/?\s*(\n|$)/.test(content)) return false;
  const sep = content === "" || content.endsWith("\n") ? "" : "\n";
  writeFileSync(gitignorePath, content + sep + ".wefter/\n");
  return true;
}

export async function init(
  projectDir: string,
  versions: InitVersions | string = { coreVersion: CORE_VERSION, cliVersion: CLI_VERSION },
  promptFn?: PromptFn,
): Promise<InitResult> {
  const resolvedVersions: { coreVersion: string; cliVersion: string } =
    typeof versions === "string"
      ? { coreVersion: versions, cliVersion: versions }
      : {
          coreVersion: versions.coreVersion ?? CORE_VERSION,
          cliVersion: versions.cliVersion ?? CLI_VERSION,
        };

  const configPath = join(projectDir, "wefter.config.json");
  if (existsSync(configPath)) {
    throw new Error(
      "wefter.config.json already exists — wefter init only sets up a project once. Edit it by hand from here.",
    );
  }

  const packageJsonPath = join(projectDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error(
      `No package.json found in ${projectDir} — wefter wraps an existing JS/TS project, it doesn't scaffold one. Run your package manager's init first.`,
    );
  }

  const pkg = readPackageJson(projectDir);
  const existingDeps = findExistingWefterDeps(pkg);
  if (existingDeps.length > 0) {
    throw new Error(
      `${existingDeps.join(", ")} already declared in package.json — update the version manually instead of running init again.`,
    );
  }

  const packageManager = detectPackageManager(projectDir);

  const envConflicts = findEnvKeyConflicts(projectDir);
  if (envConflicts.length > 0) {
    throw new Error(
      `.env already declares ${envConflicts.join(", ")} — remove or rename them before running init, so init doesn't overwrite a value you may have customized.`,
    );
  }

  const pkgName = typeof pkg.name === "string" ? pkg.name : "app";
  const askAnswers = async (ask: PromptFn) => ({
    appId: await ask("App ID (reverse-DNS)", deriveAppIdDefault(pkgName)),
    appName: await ask("App name", deriveAppNameDefault(pkgName)),
    webDir: await ask("Web build output directory", "dist"),
  });
  const { appId, appName, webDir } = promptFn ? await askAnswers(promptFn) : await withRealPrompt(askAnswers);

  const candidateConfig = {
    webDir,
    environments: { development: { appId, appName } },
    plugins: [],
  };
  const validation = WefterConfigSchema.safeParse(candidateConfig);
  if (!validation.success) {
    throw new Error(`Invalid config: ${validation.error.message}`);
  }

  return runTransactionalSync(
    [configPath, packageJsonPath, join(projectDir, ".env"), join(projectDir, ".gitignore")],
    async () => {
      writeFileSync(configPath, JSON.stringify(validation.data, null, 2) + "\n");

      updatePackageJson(projectDir, resolvedVersions);

      writeEnvBlock(projectDir, { appId, appName, webDir });
      const gitignoreUpdated = appendGitignore(projectDir);

      return { configPath, packageManager, envWritten: true, gitignoreUpdated, appId, appName, webDir };
    },
  );
}
