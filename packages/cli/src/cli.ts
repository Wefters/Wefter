#!/usr/bin/env node
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Command } from "commander";
import { sync } from "./commands/sync.js";
import { build, buildIosCommand } from "./commands/build.js";
import { run, runIos } from "./commands/run.js";
import { eject } from "./commands/eject.js";
import { audit } from "./commands/audit.js";
import { add } from "./commands/add.js";
import { createPlugin } from "./commands/create-plugin.js";
import { iconGenerate } from "./commands/icon.js";
import { splashGenerate } from "./commands/splash.js";
import { pluginValidate } from "./commands/plugin-validate.js";
import { runAllChecks } from "./doctor/checks.js";
import { runReleaseReadinessChecks } from "./doctor/release-readiness.js";
import { allPassed, buildReportLines } from "./doctor/report.js";
import { buildHelpLines } from "./help/render-help.js";
import logger from "./utils/logger.js";

loadDotenv();

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const program = new Command();

program.name("wefter").description("Wefter CLI");

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
  .description("Resolve plugins declared in wefter.config.json, verify lockfile integrity, and regenerate the native project")
  .argument("[projectDir]", "project root directory", process.cwd())
  .option("--update-lock", "accept plugin versions that drifted from wefter.lock.json and re-lock them", false)
  .action(async (projectDir: string, opts: { updateLock: boolean }) => {
    try {
      const result = await sync(resolve(projectDir), { updateLock: opts.updateLock });
      logger.success(`Synced ${result.plugins.length} plugin(s): ${result.plugins.join(", ")}`);
      process.exitCode = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Sync failed: ${message}`);
      logger.info("Fix the problem and run `wefter sync` again.");
      process.exitCode = 1;
    }
  });

program
  .command("build")
  .description("Sync and build the native app")
  .argument("<platform>", "target platform: \"android\" or \"ios\"")
  .argument("[projectDir]", "project root directory", process.cwd())
  .option("--release", "build a release artifact instead of debug", false)
  .option("--env <environment>", "environment to build (from wefter.config.json)", "development")
  .option("--simulator <name>", "iOS only: xcrun simctl device name/UDID to build for")
  .action(async (platform: string, projectDir: string, opts: { release: boolean; env: string; simulator?: string }) => {
    if (platform !== "android" && platform !== "ios") {
      logger.error(`Unsupported platform "${platform}". Use "android" or "ios".`);
      process.exitCode = 1;
      return;
    }
    try {
      logger.info(`Building the native project (env: ${opts.env})...`);
      if (platform === "android") {
        const result = await build(resolve(projectDir), { release: opts.release, env: opts.env });
        logger.success(`Built ${result.apkPath} (${formatBytes(result.sizeBytes)})`);
        logger.info(`Using ${result.syncedPlugins.length} registered plugin(s): ${result.syncedPlugins.join(", ")}`);
        if (result.unresolvedRegisteredPlugins.length > 0) {
          logger.warn(
            `Registered plugin(s) not found in node_modules: ${result.unresolvedRegisteredPlugins.join(", ")}. ` +
              `Run \`wefter sync\` to refresh the registry.`
          );
        }
      } else {
        const result = await buildIosCommand(resolve(projectDir), {
          release: opts.release,
          env: opts.env,
          simulator: opts.simulator,
        });
        logger.success(`Built ${result.appPath} (${formatBytes(result.sizeBytes)})`);
        logger.info(`Using ${result.syncedPlugins.length} registered plugin(s): ${result.syncedPlugins.join(", ")}`);
        if (result.unresolvedRegisteredPlugins.length > 0) {
          logger.warn(
            `Registered plugin(s) not found in node_modules: ${result.unresolvedRegisteredPlugins.join(", ")}. ` +
              `Run \`wefter sync\` to refresh the registry.`
          );
        }
      }
      process.exitCode = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Build failed: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("run")
  .description("Sync, build, install and launch the app — optionally with hot reload")
  .argument("<platform>", "target platform: \"android\" or \"ios\"")
  .argument("[projectDir]", "project root directory", process.cwd())
  .option("--watch", "enable hot reload via a local dev server", false)
  .option("--env <environment>", "environment to run (from wefter.config.json)", "development")
  .option("--simulator <name>", "iOS only: xcrun simctl device name/UDID to run on")
  .action(async (platform: string, projectDir: string, opts: { watch: boolean; env: string; simulator?: string }) => {
    if (platform !== "android" && platform !== "ios") {
      logger.error(`Unsupported platform "${platform}". Use "android" or "ios".`);
      process.exitCode = 1;
      return;
    }
    try {
      const devServer =
        platform === "android"
          ? await run(resolve(projectDir), { watch: opts.watch, env: opts.env })
          : await runIos(resolve(projectDir), { watch: opts.watch, env: opts.env, simulator: opts.simulator });
      logger.success(`App installed and launched (env: ${opts.env}).`);
      if (devServer) {
        logger.info(`Watching ${devServer.url} — edits will hot-reload on-device. Press Ctrl+C to stop.`);
        process.on("SIGINT", () => {
          devServer.stop();
          process.exitCode = 0;
          process.exit();
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Run failed: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("eject")
  .description("Copy the generated native project(s) to android/ and ios/ for hand-editing — wefter stops regenerating them")
  .argument("[projectDir]", "project root directory", process.cwd())
  .action(async (projectDir: string) => {
    try {
      const dests = await eject(resolve(projectDir));
      logger.success(`Ejected. ${dests.join(", ")} ${dests.length === 1 ? "is" : "are"} now yours — wefter will no longer regenerate them automatically.`);
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
        logger.info(`  ${plugin.name} — permissions: ${permissions}${plugin.gradleDependency ? `, gradle: ${plugin.gradleDependency}` : ""}`);
      }

      if (result.unresolvedRegisteredPlugins.length > 0) {
        logger.warn(`Declared but not installed: ${result.unresolvedRegisteredPlugins.join(", ")}`);
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
  .description("Install a plugin, validate it, and declare it in wefter.config.json")
  .argument("<plugin>", "npm package name, optionally with a version (e.g. name@1.0.0)")
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
        logger.error(`${plugin} failed validation and will NOT be added:`);
        for (const issue of result.issues) logger.error(`  - ${issue}`);
        logger.info("The package was installed but NOT declared in wefter.config.json.");
        process.exitCode = 1;
        return;
      }
      logger.success(`Validated and added ${plugin} to wefter.config.json.`);
      logger.info("Run `wefter sync` to weave it into the native project.");
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
    "Preview Android launcher icons from a source image — LOST on the next `wefter sync` unless \"icon\" is also set in wefter.config.json"
  )
  .argument("<source>", "path to a source image, relative to projectDir")
  .argument("[projectDir]", "project root directory", process.cwd())
  .action(async (source: string, projectDir: string) => {
    try {
      await iconGenerate(resolve(projectDir), source);
      logger.success("Icons generated.");
      logger.warn('This output will be LOST on the next `wefter sync` unless "icon" is also set in wefter.config.json.');
      process.exitCode = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Icon generation failed: ${message}`);
      process.exitCode = 1;
    }
  });

const splashCommand = program.command("splash").description("Scaffold splash screen HTML");
splashCommand
  .command("generate")
  .description("Scaffold a working example splash.html — a starting point to edit, not a build step")
  .argument("[targetPath]", "where to write the scaffolded file, relative to projectDir", "splash.html")
  .argument("[projectDir]", "project root directory", process.cwd())
  .action((targetPath: string, projectDir: string) => {
    try {
      const dest = splashGenerate(resolve(projectDir), targetPath);
      logger.success(`Scaffolded ${dest}`);
      logger.info(`Set "splash": { "html": "${targetPath}" } in wefter.config.json, then \`wefter sync\`.`);
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
    logger.success("Plugin is valid.");
    process.exitCode = 0;
  });

function printHelp(): void {
  for (const line of buildHelpLines(program)) logger.segmentColor(line);
}

program.configureHelp({
  formatHelp: () => {
    printHelp();
    return "";
  },
});

if (process.argv.length <= 2) {
  printHelp();
  process.exitCode = 0;
} else {
  program.parse();
}
