/**
 * `wefter run`: builds the app, installs it on a device or simulator and launches it. With `--watch` it
 * also starts the Vite dev server and points the app at it, so web changes hot-reload on the device.
 */

import chalk from "chalk";
import { buildAndroid } from "../native/android-builder.js";
import { resolveAdbDevice, type AdbDevice } from "../native/adb-device.js";
import { installAndroidApp, launchAndroidApp, restartAndroidApp, type AndroidTarget } from "../native/android-run.js";
import { buildIos } from "../native/ios-builder.js";
import { startDevServer, type DevServer } from "../devserver/vite-launcher.js";
import { resolveLanIp } from "../devserver/lan-ip.js";
import { injectDevServerUrl, injectNetworkSecurityException } from "../native/inject-dev-server.js";
import { injectDevServerUrlIos, injectNetworkSecurityExceptionIos } from "../native/inject-dev-server-ios.js";
import { bootSimulator, installIosApp, launchIosApp, resolveSimulator, restartIosApp } from "../native/ios-run.js";
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
import type { WefterConfig } from "../config/wefter-config-schema.js";
import { runTransactionalSync } from "../utils/transactional-sync.js";
import { checkSyncFreshness } from "../plugins/sync-freshness.js";
import { resolveRegisteredPlugins, unresolvedRegisteredPlugins } from "../plugins/registry.js";
import { runHook } from "../hooks/run-hook.js";
import { step } from "../ui/steps.js";
import logger from "../utils/logger.js";

/** Which environment to run, and whether to use the dev server. */
export interface RunOptions {
  watch: boolean;
  env: string;
}

/** iOS run options; `simulator` picks the simulator by name or UDID. */
export interface IosRunOptions extends RunOptions {
  simulator?: string;
}

/**
 * A running app, as returned by {@link run} and {@link runIos}. The keyboard shortcuts use `rebuild` and
 * `restartApp`.
 */
export interface RunSession {
  platform: "android" | "ios";
  appName: string;
  targetName: string;
  devServer: DevServer | null;
  devtoolsUrl: string | null;
  buildMs: number;
  rebuild(): Promise<void>;
  restartApp(): Promise<void>;
}

/**
 * The configured environment named `env`.
 *
 * @throws {Error} Listing the available environments when it does not exist.
 */
function environmentOf(config: WefterConfig, env: string) {
  const environment = config.environments[env];
  if (!environment) {
    throw new Error(
      `Unknown environment "${env}". Configured environments: ${Object.keys(config.environments).join(", ")}`,
    );
  }
  return environment;
}

/** Throws when the native project needs a `wefter sync` first. */
function assertSynced(projectDir: string): void {
  const freshness = checkSyncFreshness(projectDir);
  if (!freshness.fresh) throw new Error(freshness.reason);
}

/** Warns about plugins listed in the config but not installed. */
function warnUnresolved(unresolved: string[]): void {
  if (unresolved.length === 0) return;
  logger.warn(
    `Registered plugin(s) not found in node_modules: ${unresolved.join(", ")}. ` +
      `Run \`wefter sync\` to refresh the registry.`,
  );
}

/** Picks the LAN address and starts the dev server on it. */
async function startWatchServer(projectDir: string): Promise<{ devServer: DevServer; lanIp: string }> {
  const lanIp = await resolveLanIp();
  const devServer = await step("Starting dev server", () => startDevServer(projectDir, lanIp), {
    done: (server) => `Dev server ready at ${chalk.cyan(server.url)}`,
  });
  return { devServer, lanIp };
}

/** A device's model and serial, for messages. */
function describeAdbDevice(device: AdbDevice): string {
  const model = device.model?.replace(/_/g, " ");
  return model ? `${model} (${device.serial})` : device.serial;
}

/**
 * Runs the app on an Android device or emulator.
 *
 * With `watch`, the dev server is started and the debug build is pointed at it (the changed files are
 * restored if that fails). The dev server is stopped again if any later step fails.
 *
 * @throws {Error} When the project needs a sync, no device is available, or the environment is unknown.
 * @throws {ProcessFailure} When building, installing or launching fails.
 */
export async function run(projectDir: string, options: RunOptions): Promise<RunSession> {
  const config = loadWefterConfig(projectDir);
  const environment = environmentOf(config, options.env);
  assertSynced(projectDir);
  warnUnresolved(unresolvedRegisteredPlugins(pluginsDirPath(projectDir, config), config.plugins));

  const device = await resolveAdbDevice();
  const target: AndroidTarget = {
    serial: device.serial,
    appId: environment.appId,
    namespace: androidNamespace(config),
  };
  const targetName = describeAdbDevice(device);

  await runHook(projectDir, "run", "before", { platform: "android", environment: options.env });

  let devServer: DevServer | null = null;
  try {
    if (options.watch) {
      const started = await startWatchServer(projectDir);
      devServer = started.devServer;
      const buildGradlePath = androidBuildGradlePath(projectDir);
      const networkSecurityConfigPath = androidDebugNetworkSecurityConfigPath(projectDir);
      await step("Connecting the app to the dev server", () =>
        runTransactionalSync([buildGradlePath, networkSecurityConfigPath], () => {
          injectNetworkSecurityException(networkSecurityConfigPath, started.lanIp);
          injectDevServerUrl(buildGradlePath, devServer!.url);
        }),
      );
    }

    const buildInstallLaunch = async () => {
      const { apkPath } = await step(`Building Android app (${options.env})`, (s) =>
        buildAndroid(projectDir, config, options.env, false, { onProgress: s.detail }),
      );
      await step(`Installing on ${targetName}`, () => installAndroidApp(target, apkPath!));
      await step("Launching app", () => launchAndroidApp(target));
    };

    const startedAt = Date.now();
    await buildInstallLaunch();
    const buildMs = Date.now() - startedAt;
    const devtoolsUrl = devServer ? await devServer.devtoolsUrl : null;

    await runHook(projectDir, "run", "after", { platform: "android", environment: options.env });

    return {
      platform: "android",
      appName: environment.appName,
      targetName,
      devServer,
      devtoolsUrl,
      buildMs,
      rebuild: async () => {
        assertSynced(projectDir);
        await buildInstallLaunch();
      },
      restartApp: () => restartAndroidApp(target),
    };
  } catch (err) {
    devServer?.stop();
    throw err;
  }
}

/**
 * Runs the app on an iOS simulator, booting it if needed.
 *
 * With `watch`, the dev server is started and the debug build is pointed at it. Before building, the
 * `Info.plist` permission check runs. The dev server is stopped again if any later step fails.
 *
 * @throws {Error} When the project needs a sync, a check fails, or no simulator is available.
 * @throws {ProcessFailure} When building, installing or launching fails.
 */
export async function runIos(projectDir: string, options: IosRunOptions): Promise<RunSession> {
  const config = loadWefterConfig(projectDir);
  const environment = environmentOf(config, options.env);
  assertSynced(projectDir);

  const pluginsDir = pluginsDirPath(projectDir, config);
  const resolved = resolveRegisteredPlugins(pluginsDir, config.plugins);
  warnUnresolved(unresolvedRegisteredPlugins(pluginsDir, config.plugins));

  await runHook(projectDir, "run", "before", { platform: "ios", environment: options.env });

  let devServer: DevServer | null = null;
  try {
    if (options.watch) {
      const started = await startWatchServer(projectDir);
      devServer = started.devServer;
      const buildConfigPath = iosBuildConfigPath(projectDir);
      const infoPlistPath = iosInfoPlistPath(projectDir);
      await step("Connecting the app to the dev server", () =>
        runTransactionalSync([buildConfigPath, infoPlistPath], () => {
          injectNetworkSecurityExceptionIos(infoPlistPath, started.lanIp);
          injectDevServerUrlIos(buildConfigPath, devServer!.url);
        }),
      );
    }

    const plistCheck = checkInfoPlistPermissionKeys(projectDir, resolved);
    if (!plistCheck.passed) {
      throw new Error(
        `iOS permission configuration check failed:\n${plistCheck.issues.map((i) => `  - ${i}`).join("\n")}`,
      );
    }

    const simulator = await resolveSimulator(options.simulator);
    const bundleId = iosBundleId(config, options.env);

    const buildInstallLaunch = async () => {
      const { appPath } = await step(`Building iOS app (${options.env})`, (s) =>
        buildIos(projectDir, config, options.env, false, { simulator: simulator.udid, onProgress: s.detail }),
      );
      await step(`Installing on ${simulator.name}`, () => installIosApp(appPath, simulator.udid));
      await step("Launching app", () => launchIosApp(bundleId, simulator.udid));
    };

    const startedAt = Date.now();
    if (simulator.state !== "Booted") {
      await step(`Booting ${simulator.name}`, () => bootSimulator(simulator.udid));
    }
    await buildInstallLaunch();
    const buildMs = Date.now() - startedAt;
    const devtoolsUrl = devServer ? await devServer.devtoolsUrl : null;

    await runHook(projectDir, "run", "after", { platform: "ios", environment: options.env });

    return {
      platform: "ios",
      appName: environment.appName,
      targetName: simulator.name,
      devServer,
      devtoolsUrl,
      buildMs,
      rebuild: async () => {
        assertSynced(projectDir);
        await bootSimulator(simulator.udid);
        await buildInstallLaunch();
      },
      restartApp: () => restartIosApp(bundleId, simulator.udid),
    };
  } catch (err) {
    devServer?.stop();
    throw err;
  }
}
