#!/usr/bin/env node
/**
 * The `wefter` command. Defines every subcommand with Commander, loads `.env`, and turns failures into
 * readable reports and exit codes.
 */

import { statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import chalk from "chalk";
import { config as loadDotenv } from "dotenv";
import { Command, type Help } from "commander";
import { init } from "./commands/init.js";
import { CLI_VERSION, CORE_VERSION } from "./internal/version.js";
import { sync } from "./commands/sync.js";
import { buildApp, type BuildPlatform, type PlatformBuildResult } from "./commands/build.js";
import { formatAppVersion } from "./app-build/app-version.js";
import { setHookOutputToStderr } from "./hooks/run-hook.js";
import { loadWefterConfig, readRawConfig } from "./config/project-paths.js";
import { legacyConfigNotes } from "./config/wefter-config-schema.js";
import { outputFolderIgnored, resolveOutputRoot } from "./app-build/artifacts.js";
import { run, runAll, runIos, type RunPlatform } from "./commands/run.js";
import { attachRunSession } from "./commands/run-interactive.js";
import { openRunLog } from "./process/run-log.js";
import { configureUi, setTerminalStreams, uiSettings, writeLine } from "./ui/terminal.js";
import { debugRetryCommand, printBuildResult, printFailure, printWarning } from "./ui/report.js";
import { eject } from "./commands/eject.js";
import { audit } from "./commands/audit.js";
import { add } from "./commands/add.js";
import { createPlugin } from "./commands/create-plugin.js";
import { iconGenerate } from "./commands/icon.js";
import { splashGenerate } from "./commands/splash.js";
import { pluginValidate } from "./commands/plugin-validate.js";
import { checkDeepLinkDomains, deepLinkFiles } from "./commands/deep-links.js";
import { runAllChecks } from "./doctor/checks.js";
import { runReleaseReadinessChecks } from "./doctor/release-readiness.js";
import { allPassed, buildReportLines } from "./doctor/report.js";
import { renderHelp } from "./help/render-help.js";
import { printInitSuccessSummary } from "./utils/banner.js";
import logger from "./utils/logger.js";

loadDotenv({ quiet: true });

/**
 * The arguments needed to repeat a `run` or `build` command, used for the `--debug` retry suggestion.
 * Defaults (the current folder and the `development` environment) are left out.
 */
function commonFlags(projectDir: string, env: string, simulator: string | undefined, leading: string[]): string[] {
  const flags: string[] = [];
  if (resolve(projectDir) !== process.cwd()) flags.push(JSON.stringify(projectDir));
  flags.push(...leading);
  if (env !== "development") flags.push("--env", env);
  if (simulator) flags.push("--simulator", JSON.stringify(simulator));
  return flags;
}

/** Work to do before exiting on Ctrl+C, such as stopping the dev server. */
let activeCleanup: (() => void | Promise<void>) | null = null;

/** Sets (or clears, with `null`) the work to do before exiting on Ctrl+C. */
export function registerCleanup(fn: (() => void | Promise<void>) | null): void {
  activeCleanup = fn;
}

/** Runs the registered cleanup on Ctrl+C and exits with code 130. */
process.on("SIGINT", async () => {
  console.log("");
  if (activeCleanup) {
    try {
      await activeCleanup();
    } catch {}
  }
  logger.warn("Operation cancelled by user (Ctrl+C).");
  process.exit(130);
});

const program = new Command();

program.name("wefter").description("Wefter CLI").version(CLI_VERSION);

program
  .command("init")
  .description(
    "Wrap an existing JS/TS project with wefter.config.json, add @wefterjs/core + @wefterjs/cli to package.json, and write WEFTER_* env keys",
  )
  .argument("[projectDir]", "project root directory", process.cwd())
  .action(async (projectDir: string) => {
    try {
      const result = await init(resolve(projectDir));
      printInitSuccessSummary({
        appId: result.appId,
        webDir: result.webDir,
        packageManager: result.packageManager,
        gitignoreEntries: result.gitignoreEntries,
        coreVersion: CORE_VERSION,
        cliVersion: CLI_VERSION,
      });
      process.exitCode = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Init failed: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("doctor")
  .description("Check that your environment is set up correctly for building Wefter apps")
  .argument("[projectDir]", "project root directory (required for --release-readiness)", process.cwd())
  .option("--release-readiness", "also check whether this project is ready for a --release build", false)
  .action(async (projectDir: string, opts: { releaseReadiness: boolean }) => {
    logger.info("Running environment checks...");

    const results = await runAllChecks();
    for (const line of buildReportLines(results)) {
      logger.segmentColor(line);
    }

    let releaseReadinessPassed = true;
    if (opts.releaseReadiness) {
      logger.info("Running release-readiness checks...");
      const releaseResults = await runReleaseReadinessChecks(resolve(projectDir));
      for (const line of buildReportLines(releaseResults)) {
        logger.segmentColor(line);
      }
      releaseReadinessPassed = allPassed(releaseResults);
    }

    if (allPassed(results) && releaseReadinessPassed) {
      logger.success("All checks passed.");
      process.exitCode = 0;
    } else {
      logger.error("Some checks failed — see the Fix lines above.");
      process.exitCode = 1;
    }
  });

program
  .command("sync")
  .description(
    "Resolve plugins declared in wefter.config.json, verify lockfile integrity, and regenerate the native project",
  )
  .argument("[projectDir]", "project root directory", process.cwd())
  .option("--update-lock", "accept plugin versions that drifted from wefter.lock.json and re-lock them", false)
  .action(async (projectDir: string, opts: { updateLock: boolean }) => {
    try {
      const root = resolve(projectDir);
      const result = await sync(root, { updateLock: opts.updateLock });
      logger.success(`Synced ${result.plugins.length} plugin(s): ${result.plugins.join(", ")}`);
      for (const note of legacyConfigNotes(readRawConfig(root))) logger.warn(`wefter.config.json: ${note}`);
      for (const warning of result.warnings) logger.warn(warning);
      if (result.languages.length > 1) logger.info(`Languages: ${result.languages.join(", ")}`);
      const syncedConfig = loadWefterConfig(root);
      try {
        const outputRoot = resolveOutputRoot(root, syncedConfig.build.output, syncedConfig.webDir);
        if (!outputFolderIgnored(root, outputRoot)) {
          logger.warn(
            `.gitignore does not list the build output folder "${syncedConfig.build.output}/"; add it so built apps stay out of git.`,
          );
        }
      } catch (error) {
        logger.warn(error instanceof Error ? error.message : String(error));
      }
      for (const [env, links] of Object.entries(result.deepLinks)) {
        const targets = [...links.schemes.map((s) => `${s}://`), ...links.domains.map((d) => `https://${d}`)];
        if (targets.length > 0) logger.info(`Deep links (${env}): ${targets.join(", ")}`);
      }

      const exported = result.manifestEntriesAdded.filter((e) => e.exported);
      if (exported.length > 0) {
        logger.warn("Exported components woven into AndroidManifest.xml (reachable from outside the app):");
        for (const e of exported) logger.warn(`  - ${e.pluginName}: ${e.type} ${e.name}`);
      }
      if (result.gradleConflicts.length > 0) {
        logger.warn("Gradle dependency version conflicts:");
        for (const c of result.gradleConflicts) logger.warn(`  - ${c}`);
      }

      process.exitCode = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Sync failed: ${message}`);
      logger.info("Fix the problem and run `wefter sync` again.");
      process.exitCode = 1;
    }
  });

/** Options of `wefter build`, as Commander gives them. */
interface BuildCliOptions {
  release: boolean;
  env?: string;
  appVersion?: string;
  buildNumber?: string;
  format?: string;
  output?: string;
  unsigned: boolean;
  exportMethod?: string;
  simulator?: string;
  strict: boolean;
  clean: boolean;
  json: boolean;
  debug: boolean;
}

/** The arguments needed to repeat a `build` command, for the `--debug` retry suggestion. */
function buildFlags(projectDir: string, opts: BuildCliOptions): string[] {
  const flags: string[] = [];
  if (resolve(projectDir) !== process.cwd()) flags.push(JSON.stringify(projectDir));
  if (opts.release) flags.push("--release");
  const valued: [string, string | undefined][] = [
    ["--env", opts.env],
    ["--app-version", opts.appVersion],
    ["--build-number", opts.buildNumber],
    ["--format", opts.format],
    ["--output", opts.output],
    ["--export-method", opts.exportMethod],
    ["--simulator", opts.simulator],
  ];
  for (const [flag, value] of valued) if (value !== undefined) flags.push(flag, JSON.stringify(value));
  if (opts.unsigned) flags.push("--unsigned");
  if (opts.strict) flags.push("--strict");
  if (opts.clean) flags.push("--clean");
  return flags;
}

/** A build result as `--json` prints it. */
function buildResultJson(result: PlatformBuildResult) {
  return {
    platform: result.platform,
    app: { name: result.appName, id: result.appId },
    environment: result.env,
    release: result.release,
    version: result.appVersion.version,
    buildNumber: result.appVersion.buildNumber,
    ...(result.target ? { target: result.target } : {}),
    ...(result.format ? { format: result.format } : {}),
    outputDir: result.outputDir,
    buildInfo: result.buildInfoPath,
    artifacts: result.artifacts.map((a) => ({ kind: a.kind, path: a.path, sizeBytes: a.sizeBytes, sha256: a.sha256 })),
    ...(result.signingCertificateSha256 ? { signingCertificateSha256: result.signingCertificateSha256 } : {}),
    warnings: result.warnings,
  };
}

/** `Android · release · production`, `iOS · release · production · device` and the like. */
function platformLabel(result: PlatformBuildResult): string {
  const parts = [result.platform === "ios" ? "iOS" : "Android", result.release ? "release" : "debug", result.env];
  if (result.target) parts.push(result.target);
  return parts.join(" · ");
}

/**
 * `wefter build <platform>`: builds the app (see `commands/build.ts` for the steps), logging everything to
 * `.wefter/logs`, and prints what was built and where. With `--json`, progress goes to stderr and stdout
 * gets one JSON document, also on failure. When it fails, the report suggests the same command with
 * `--debug`.
 */
program
  .command("build")
  .description("Build the app for testing or for the stores")
  .argument("<platform>", '"android", "ios" or "all"')
  .argument("[projectDir]", "project root directory", process.cwd())
  .option("--release", "build a signed release for the stores (uses the production environment)", false)
  .option("--env <environment>", "environment to build (default: production with --release, else development)")
  .option("--app-version <version>", 'app version such as 1.4.0, instead of "version" in wefter.config.json')
  .option("--build-number <number>", 'build number such as 42, instead of "buildNumber" in wefter.config.json')
  .option("--format <format>", "Android: apk, aab or both (default: both for --release, else apk)")
  .option("--output <dir>", 'folder for the built files (default: "build", or build.output in wefter.config.json)')
  .option("--unsigned", "build a release without signing it, to sign it elsewhere", false)
  .option(
    "--export-method <method>",
    "iOS: app-store-connect, release-testing, enterprise or debugging (default: app-store-connect)",
  )
  .option("--simulator <name>", "iOS: build for this simulator (name or UDID) instead of devices")
  .option("--strict", "treat release check warnings as errors", false)
  .option("--clean", "clean the native build caches first", false)
  .option("--json", "print the result as JSON on stdout (progress goes to stderr)", false)
  .option("--debug", "stream the full Xcode/Gradle output instead of a progress spinner", false)
  .action(async (platform: string, projectDir: string, opts: BuildCliOptions) => {
    if (platform !== "android" && platform !== "ios" && platform !== "all") {
      logger.error(`Unsupported platform "${platform}". Use "android", "ios" or "all".`);
      process.exitCode = 1;
      return;
    }
    configureUi({ debug: opts.debug });
    if (opts.json) {
      const toStderr = (chunk: string) => process.stderr.write(chunk);
      setTerminalStreams({ out: toStderr, err: toStderr, columns: () => process.stderr.columns || 80 });
      setHookOutputToStderr(true);
    }
    const root = resolve(projectDir);
    const platforms: BuildPlatform[] = platform === "all" ? ["android", "ios"] : [platform];
    const label = platform === "all" ? "Build" : `${platform === "ios" ? "iOS" : "Android"} build`;
    openRunLog(root, `build-${platform}`);
    try {
      const results = await buildApp(root, platforms, {
        release: opts.release,
        env: opts.env,
        appVersion: opts.appVersion,
        buildNumber: opts.buildNumber,
        format: opts.format,
        output: opts.output,
        unsigned: opts.unsigned,
        exportMethod: opts.exportMethod,
        simulator: opts.simulator,
        strict: opts.strict,
        clean: opts.clean,
        onWarning: printWarning,
      });
      const config = loadWefterConfig(root);
      for (const result of results) {
        if (result.unresolvedRegisteredPlugins.length > 0) {
          printWarning(
            `Registered plugin(s) not found in node_modules: ${result.unresolvedRegisteredPlugins.join(", ")}. ` +
              `Run \`wefter sync\` to refresh the registry.`,
          );
        }
        printBuildResult({
          appName: result.appName,
          versionLabel: formatAppVersion(result.appVersion),
          platformLabel: platformLabel(result),
          outputDir: relative(process.cwd(), result.outputDir) || ".",
          files: [
            ...result.artifacts,
            { path: result.buildInfoPath, sizeBytes: statSync(result.buildInfoPath).size },
          ].map((a) => ({ name: basename(a.path), sizeBytes: a.sizeBytes })),
          signingFingerprint: result.signingCertificateSha256,
          webDir: config.webDir,
          webBuiltAt: result.webBuiltAt,
          plugins: result.syncedPlugins,
          warningCount: result.warnings.length,
        });
      }
      if (opts.json) {
        process.stdout.write(JSON.stringify({ ok: true, builds: results.map(buildResultJson) }, null, 2) + "\n");
      }
      process.exitCode = 0;
    } catch (err) {
      printFailure(
        `${label} failed`,
        err,
        debugRetryCommand({ command: "build", platform, flags: buildFlags(projectDir, opts) }),
      );
      if (opts.json) {
        const message = err instanceof Error ? err.message : String(err);
        process.stdout.write(JSON.stringify({ ok: false, error: message }, null, 2) + "\n");
      }
      process.exitCode = 1;
    }
  });

/** "Android" or "iOS". */
function runPlatformLabel(platform: RunPlatform): string {
  return platform === "ios" ? "iOS" : "Android";
}

/**
 * `wefter run <platform>`: runs the app, logging everything to `.wefter/logs`. When it succeeds, the run session
 * takes over (summary and, with `--watch`, keyboard shortcuts); when it fails, the report suggests
 * the same command with `--debug`. `run all` runs Android and iOS with one dev server; when one of them
 * fails, the other keeps running and the command exits with code 1 (without `--watch`).
 */
program
  .command("run")
  .description("Sync, build, install and launch the app — optionally with hot reload")
  .argument("<platform>", 'target platform: "android", "ios" or "all" (both, with one dev server)')
  .argument("[projectDir]", "project root directory", process.cwd())
  .option("--watch", "enable hot reload via a local dev server", false)
  .option("--env <environment>", "environment to run (from wefter.config.json)", "development")
  .option("--simulator <name>", "iOS only: xcrun simctl device name/UDID to run on")
  .option("--debug", "stream the full Xcode/Gradle/adb output instead of a progress spinner", false)
  .action(
    async (
      platform: string,
      projectDir: string,
      opts: { watch: boolean; env: string; simulator?: string; debug: boolean },
    ) => {
      if (platform !== "android" && platform !== "ios" && platform !== "all") {
        logger.error(`Unsupported platform "${platform}". Use "android", "ios" or "all".`);
        process.exitCode = 1;
        return;
      }
      configureUi({ debug: opts.debug });
      const root = resolve(projectDir);
      openRunLog(root, `run-${platform}`);
      const flags = commonFlags(projectDir, opts.env, opts.simulator, opts.watch ? ["--watch"] : []);
      const retryWithDebug = debugRetryCommand({ command: "run", platform, flags });
      try {
        if (platform === "all") {
          const failed = new Set<RunPlatform>();
          const session = await runAll(root, {
            watch: opts.watch,
            env: opts.env,
            simulator: opts.simulator,
            onPlatformFailure: (failedPlatform, err) => {
              failed.add(failedPlatform);
              printFailure(`Couldn't run the ${runPlatformLabel(failedPlatform)} app`, err, retryWithDebug);
            },
          });
          if (!session) {
            process.exitCode = 1;
            return;
          }
          const stop = attachRunSession(session, { retryWithDebug });
          if (session.devServer) registerCleanup(stop);
          if (failed.size > 0) {
            const names = [...failed].map(runPlatformLabel).join(" and ");
            const shortcuts = Boolean(session.devServer) && uiSettings().interactive && process.stdin.isTTY;
            writeLine(
              chalk.dim(
                `The ${names} app isn't running.` +
                  (shortcuts ? " Fix the problem, then press Ctrl+R to try again." : ""),
              ),
            );
            if (!session.devServer) process.exitCode = 1;
          }
          return;
        }
        const session =
          platform === "android"
            ? await run(root, { watch: opts.watch, env: opts.env })
            : await runIos(root, { watch: opts.watch, env: opts.env, simulator: opts.simulator });
        const stop = attachRunSession(session, { retryWithDebug });
        if (session.devServer) registerCleanup(stop);
      } catch (err) {
        const what = platform === "all" ? "the app" : `the ${runPlatformLabel(platform)} app`;
        printFailure(`Couldn't run ${what}`, err, retryWithDebug);
        process.exitCode = 1;
      }
    },
  );

program
  .command("eject")
  .description(
    "Copy the generated native project(s) to android/ and ios/ for hand-editing — wefter stops regenerating them",
  )
  .argument("[projectDir]", "project root directory", process.cwd())
  .action(async (projectDir: string) => {
    try {
      const dests = await eject(resolve(projectDir));
      logger.success(
        `Ejected. ${dests.join(", ")} ${dests.length === 1 ? "is" : "are"} now yours — wefter will no longer regenerate them automatically.`,
      );
      process.exitCode = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Eject failed: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("audit")
  .description("Print the plugins, permissions, and dependencies this project would sync — read-only")
  .argument("[projectDir]", "project root directory", process.cwd())
  .action(async (projectDir: string) => {
    try {
      const result = await audit(resolve(projectDir));

      logger.bold(`Plugins (${result.plugins.length}):`);
      for (const plugin of result.plugins) {
        const permissions = plugin.permissions.length > 0 ? plugin.permissions.join(", ") : "none";
        const gradle = plugin.gradleDependencies.length > 0 ? `, gradle: ${plugin.gradleDependencies.join(", ")}` : "";
        logger.info(`  ${plugin.name} — permissions: ${permissions}${gradle}`);
        for (const component of plugin.components) {
          logger.info(`    component: ${component.type} ${component.name}${component.exported ? " (exported)" : ""}`);
        }
      }

      if (result.unresolvedRegisteredPlugins.length > 0) {
        logger.warn(`Declared but not installed: ${result.unresolvedRegisteredPlugins.join(", ")}`);
      }
      if (result.exportedComponentWarnings.length > 0) {
        logger.warn("Exported components (reachable from outside the app):");
        for (const warning of result.exportedComponentWarnings) logger.warn(`  - ${warning}`);
      }
      if (result.gradleConflicts.length > 0) {
        logger.warn("Gradle dependency version conflicts:");
        for (const conflict of result.gradleConflicts) logger.warn(`  - ${conflict}`);
      }
      if (result.requiredConfigKeys.length > 0) {
        logger.warn(`Required "pluginConfig" keys not yet set: ${result.requiredConfigKeys.join(", ")}`);
      }
      if (result.permissionViolations.length > 0) {
        logger.error("Permission audit violations:");
        for (const violation of result.permissionViolations) logger.error(`  - ${violation}`);
      }
      if (result.lockDrift.length > 0) {
        logger.warn("Lockfile drift:");
        for (const drift of result.lockDrift) logger.warn(`  - ${drift}`);
      }

      process.exitCode = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Audit failed: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("add")
  .description(
    "Declare a plugin in wefter.config.json and add it to package.json dependencies (install is left to you)",
  )
  .argument("<plugin>", "npm package name, optionally with a version or dist-tag (e.g. name@1.0.0)")
  .argument("[projectDir]", "project root directory", process.cwd())
  .action(async (plugin: string, projectDir: string) => {
    try {
      const result = await add(resolve(projectDir), plugin);
      if (result.alreadyDeclared) {
        logger.warn(`${plugin} is already declared in wefter.config.json — nothing to add.`);
        process.exitCode = 0;
        return;
      }
      if (!result.added) {
        logger.error(`Could not add ${plugin}:`);
        for (const issue of result.issues) logger.error(`  - ${issue}`);
        process.exitCode = 1;
        return;
      }
      logger.success(`Added ${plugin}@${result.resolvedVersion} to wefter.config.json.`);
      logger.info(`Now install it with your package manager:`);
      logger.info(`  ${result.installHint}`);
      logger.info("Then run `wefter sync` to weave it into the native project.");
      process.exitCode = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Add failed: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("create-plugin")
  .description("Scaffold a new Wefter plugin package from working boilerplate")
  .argument("<name>", "plugin package name, e.g. secure-storage")
  .argument("[targetDir]", "directory to scaffold into", process.cwd())
  .action((name: string, targetDir: string) => {
    try {
      const dir = createPlugin(resolve(targetDir), name);
      logger.success(`Created plugin scaffold at ${dir}`);
      logger.info("Next: implement your native logic in android/, then `wefter add` it into a test project.");
      process.exitCode = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`create-plugin failed: ${message}`);
      process.exitCode = 1;
    }
  });

const iconCommand = program.command("icon").description("Generate app icons");
iconCommand
  .command("generate")
  .description(
    'Preview Android launcher icons from a source image — LOST on the next `wefter sync` unless "icon" is also set in wefter.config.json',
  )
  .argument("<source>", "path to a source image, relative to projectDir")
  .argument("[projectDir]", "project root directory", process.cwd())
  .action(async (source: string, projectDir: string) => {
    try {
      await iconGenerate(resolve(projectDir), source);
      logger.success("Icons generated.");
      logger.warn(
        'This output will be LOST on the next `wefter sync` unless "icon" is also set in wefter.config.json.',
      );
      process.exitCode = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Icon generation failed: ${message}`);
      process.exitCode = 1;
    }
  });

const splashCommand = program.command("splash").description("Scaffold a splash screen folder");
splashCommand
  .command("generate")
  .description("Scaffold a working example splash folder — a starting point to edit, not a build step")
  .argument("[targetPath]", "where to write the scaffolded folder, relative to projectDir", "splash")
  .argument("[projectDir]", "project root directory", process.cwd())
  .action((targetPath: string, projectDir: string) => {
    try {
      const dest = splashGenerate(resolve(projectDir), targetPath);
      logger.success(`Scaffolded ${dest}`);
      logger.info(`Set "splash": { "source": "${targetPath}" } in wefter.config.json, then \`wefter sync\`.`);
      process.exitCode = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Splash scaffold failed: ${message}`);
      process.exitCode = 1;
    }
  });

const pluginCommand = program.command("plugin").description("Author and validate Wefter plugins");
pluginCommand
  .command("validate")
  .description("Validate a plugin directory against the Wefter plugin schema and source conventions")
  .argument("[pluginDir]", "plugin directory to validate", process.cwd())
  .action((pluginDir: string) => {
    const result = pluginValidate(resolve(pluginDir));
    if (!result.valid) {
      logger.error("Plugin validation failed:");
      for (const issue of result.issues) logger.error(`  - ${issue}`);
      process.exitCode = 1;
      return;
    }
    for (const warning of result.warnings ?? []) logger.warn(warning);
    logger.success("Plugin is valid.");
    process.exitCode = 0;
  });

/** Adds a repeatable option's value to the values given so far. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const deepLinksCommand = program
  .command("deep-links")
  .description("Website files for verified https links (App Links, Universal Links), and a check of them");
deepLinksCommand
  .command("files")
  .description("Write assetlinks.json and apple-app-site-association for every domain in deepLinks.domains")
  .argument("[projectDir]", "project root directory", process.cwd())
  .option("--out <dir>", "where to write the files", ".wefter/deep-links")
  .option(
    "--fingerprint <sha256>",
    "add a signing certificate, such as the Play App Signing key (repeatable)",
    collect,
    [],
  )
  .option("--debug", "also allow debug builds signed with this machine's debug keystore", false)
  .action(async (projectDir: string, opts: { out: string; fingerprint: string[]; debug: boolean }) => {
    try {
      const root = resolve(projectDir);
      const result = await deepLinkFiles(root, { outDir: opts.out, extra: opts.fingerprint, debug: opts.debug });
      for (const warning of result.warnings) logger.warn(warning);
      logger.success("Wrote the deep link verification files:");
      for (const path of result.written) logger.info(`  ${path}`);
      logger.info(
        "Serve each folder's .well-known files at https://<domain>/.well-known/ as application/json, without " +
          "redirects, then run `wefter deep-links check`.",
      );
      process.exitCode = 0;
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });
deepLinksCommand
  .command("check")
  .description("Download the verification files from every domain and check that they list this app")
  .argument("[projectDir]", "project root directory", process.cwd())
  .option("--fingerprint <sha256>", "also require this signing certificate (repeatable)", collect, [])
  .action(async (projectDir: string, opts: { fingerprint: string[] }) => {
    try {
      const results = await checkDeepLinkDomains(resolve(projectDir), { fingerprints: opts.fingerprint });
      for (const line of buildReportLines(results)) logger.segmentColor(line);
      process.exitCode = allPassed(results) ? 0 : 1;
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

/** Uses the coloured help renderer for `cmd` and all its subcommands. */
function applyHelpStyle(cmd: Command): void {
  cmd.configureHelp({
    formatHelp: (targetCmd: Command, helper: Help) => {
      for (const line of renderHelp(targetCmd, helper)) logger.segmentColor(line);
      return "";
    },
  });
  for (const sub of cmd.commands) applyHelpStyle(sub);
}

applyHelpStyle(program);

/** Running `wefter` without arguments shows the help instead of an error. */
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exitCode = 0;
} else {
  program.parse();
}
