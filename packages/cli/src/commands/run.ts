import { spawn } from "node:child_process";
import chalk from "chalk";
import { buildAndroid } from "../native/android-builder.js";
import { resolveAdbDevice } from "../native/adb-device.js";
import { buildIos } from "../native/ios-builder.js";
import { startDevServer, type DevServer } from "../devserver/vite-launcher.js";
import { resolveLanIp } from "../devserver/lan-ip.js";
import { injectDevServerUrl, injectNetworkSecurityException } from "../native/inject-dev-server.js";
import { injectDevServerUrlIos, injectNetworkSecurityExceptionIos } from "../native/inject-dev-server-ios.js";
import { resolveSimulator, installAndLaunchIos } from "../native/ios-run.js";
import { checkInfoPlistPermissionKeys } from "../native/check-info-plist-permissions.js";
import {
  androidNamespace,
  androidBuildGradlePath,
  androidDebugNetworkSecurityConfigPath,
  iosBuildConfigPath,
  iosBundleId,
  iosInfoPlistPath,
  loadWefterConfig,
  pluginsDirPath,
} from "../config/project-paths.js";
import { runTransactionalSync } from "../utils/transactional-sync.js";
import { checkSyncFreshness } from "../plugins/sync-freshness.js";
import { resolveRegisteredPlugins, unresolvedRegisteredPlugins } from "../plugins/registry.js";
import { runHook } from "../hooks/run-hook.js";
import logger from "../utils/logger.js";

export interface RunOptions {
  watch: boolean;
  env: string;
}

export async function run(projectDir: string, options: RunOptions): Promise<DevServer | null> {
  const device = await resolveAdbDevice();

  const config = loadWefterConfig(projectDir);
  const environment = config.environments[options.env];
  if (!environment) {
    throw new Error(
      `Unknown environment "${options.env}". Configured environments: ${Object.keys(config.environments).join(", ")}`,
    );
  }

  let devServer: DevServer | null = null;

  const freshness = checkSyncFreshness(projectDir);
  if (!freshness.fresh) {
    throw new Error(freshness.reason);
  }

  const pluginsDir = pluginsDirPath(projectDir, config);
  const unresolved = unresolvedRegisteredPlugins(pluginsDir, config.plugins);
  if (unresolved.length > 0) {
    logger.warn(
      `Registered plugin(s) not found in node_modules: ${unresolved.join(", ")}. ` +
        `Run \`wefter sync\` to refresh the registry.`,
    );
  }

  await runHook(projectDir, "run", "before", { platform: "android", environment: options.env });

  if (options.watch) {
    const lanIp = await resolveLanIp();
    devServer = await startDevServer(projectDir, lanIp);

    const buildGradlePath = androidBuildGradlePath(projectDir);
    const networkSecurityConfigPath = androidDebugNetworkSecurityConfigPath(projectDir);

    logger.info("Wiring the dev server into the native project...");
    await runTransactionalSync([buildGradlePath, networkSecurityConfigPath], () => {
      injectNetworkSecurityException(networkSecurityConfigPath, lanIp);
      injectDevServerUrl(buildGradlePath, devServer!.url);
    });
  }

  logger.info(`Building the Android app (env: ${chalk.bold(options.env)})...`);
  const { apkPath } = await buildAndroid(projectDir, config, options.env, false);

  logger.info(`Installing ${chalk.cyan(apkPath)} on ${chalk.bold(device.serial)}...`);
  await installAndLaunch(apkPath, environment.appId, androidNamespace(config), device.serial);

  await announceDevtoolsUrl(devServer);

  await runHook(projectDir, "run", "after", { platform: "android", environment: options.env });

  return devServer;
}

async function announceDevtoolsUrl(devServer: DevServer | null): Promise<void> {
  if (!devServer) return;
  const devtoolsUrl = await devServer.devtoolsUrl;
  if (devtoolsUrl) {
    logger.success(`App is running — devtools dashboard: ${chalk.cyan(devtoolsUrl)}`);
  }
}

function runAdb(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("adb", args, { stdio: "inherit" });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`adb ${args.join(" ")} failed with exit code ${code}`));
    });
    proc.on("error", reject);
  });
}

async function installAndLaunch(
  apkPath: string,
  applicationId: string,
  namespace: string,
  serial: string,
): Promise<void> {
  await runAdb(["-s", serial, "install", "-r", apkPath]);
  logger.info(`Launching ${chalk.bold(applicationId)}...`);
  await runAdb(["-s", serial, "shell", "am", "start", "-n", `${applicationId}/${namespace}.MainActivity`]);
}

export interface IosRunOptions extends RunOptions {
  simulator?: string;
}

export async function runIos(projectDir: string, options: IosRunOptions): Promise<DevServer | null> {
  const config = loadWefterConfig(projectDir);
  const environment = config.environments[options.env];
  if (!environment) {
    throw new Error(
      `Unknown environment "${options.env}". Configured environments: ${Object.keys(config.environments).join(", ")}`,
    );
  }

  let devServer: DevServer | null = null;

  const freshness = checkSyncFreshness(projectDir);
  if (!freshness.fresh) {
    throw new Error(freshness.reason);
  }

  const pluginsDir = pluginsDirPath(projectDir, config);
  const resolved = resolveRegisteredPlugins(pluginsDir, config.plugins);
  const unresolved = unresolvedRegisteredPlugins(pluginsDir, config.plugins);
  if (unresolved.length > 0) {
    logger.warn(
      `Registered plugin(s) not found in node_modules: ${unresolved.join(", ")}. ` +
        `Run \`wefter sync\` to refresh the registry.`,
    );
  }

  await runHook(projectDir, "run", "before", { platform: "ios", environment: options.env });

  if (options.watch) {
    const lanIp = await resolveLanIp();
    devServer = await startDevServer(projectDir, lanIp);

    const buildConfigPath = iosBuildConfigPath(projectDir);
    const infoPlistPath = iosInfoPlistPath(projectDir);

    logger.info("Wiring the dev server into the native project...");
    await runTransactionalSync([buildConfigPath, infoPlistPath], () => {
      injectNetworkSecurityExceptionIos(infoPlistPath, lanIp);
      injectDevServerUrlIos(buildConfigPath, devServer!.url);
    });
  }

  const plistCheck = checkInfoPlistPermissionKeys(projectDir, resolved);
  if (!plistCheck.passed) {
    throw new Error(
      `iOS permission configuration check failed:\n${plistCheck.issues.map((i) => `  - ${i}`).join("\n")}`,
    );
  }

  logger.info(`Building the iOS app (env: ${chalk.bold(options.env)})...`);
  const { appPath } = await buildIos(projectDir, config, options.env, false, { simulator: options.simulator });

  const simulator = await resolveSimulator(options.simulator);
  logger.info(`Installing ${chalk.cyan(appPath)} on ${chalk.bold(simulator)}...`);
  await installAndLaunchIos(appPath, iosBundleId(config, options.env), simulator);

  await announceDevtoolsUrl(devServer);

  await runHook(projectDir, "run", "after", { platform: "ios", environment: options.env });

  return devServer;
}
