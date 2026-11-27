/**
 * `wefter run`: builds the app, installs it on a device or simulator and launches it. With `--watch` it
 * also starts the Vite dev server and points the app at it, so web changes hot-reload on the device.
 * `wefter run all` does this for Android and then iOS, with one dev server for both.
 */

import chalk from "chalk";
import { buildAndroid } from "../native/android-builder.js";
import { resolveAdbDevice, reverseAdbPort, type AdbDevice } from "../native/adb-device.js";
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
import { writeLine } from "../ui/terminal.js";
import logger from "../utils/logger.js";

/** Which environment to run, and whether to use the dev server. */
export interface RunOptions {
  watch: boolean;
  env: string;
  /**
   * With `watch`, a dev server that is already running (`run all` shares one) instead of starting one. It is
   * left running when the run fails.
   */
  devServer?: DevServer;
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
  platform: "android" | "ios" | "all";
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
async function startWatchServer(projectDir: string): Promise<DevServer> {
  const lanIp = await resolveLanIp();
  return step("Starting dev server", () => startDevServer(projectDir, lanIp), {
    done: (server) => `Dev server ready at ${chalk.cyan(server.url)}`,
  });
}

/**
 * The dev server's address on `localhost`, for a device that reaches this computer's ports there: an iOS
 * simulator, or an Android device after `adb reverse`. Web views treat `localhost` as a secure origin, so
 * the camera, microphone and location work as in the built app.
 */
export function localhostUrl(devServerUrl: string): string {
  const url = new URL(devServerUrl);
  url.hostname = "localhost";
  return url.toString().replace(/\/$/, "");
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
      devServer = options.devServer ?? (await startWatchServer(projectDir));
      const server = devServer;
      const buildGradlePath = androidBuildGradlePath(projectDir);
      const networkSecurityConfigPath = androidDebugNetworkSecurityConfigPath(projectDir);
      await step("Connecting the app to the dev server", async () => {
        const port = Number(new URL(server.url).port);
        const appUrl = (await reverseAdbPort(device.serial, port)) ? localhostUrl(server.url) : server.url;
        runTransactionalSync([buildGradlePath, networkSecurityConfigPath], () => {
          injectNetworkSecurityException(networkSecurityConfigPath, new URL(appUrl).hostname);
          injectDevServerUrl(buildGradlePath, appUrl);
        });
      });
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
    if (devServer !== options.devServer) devServer?.stop();
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
      devServer = options.devServer ?? (await startWatchServer(projectDir));
      const appUrl = localhostUrl(devServer.url);
      const buildConfigPath = iosBuildConfigPath(projectDir);
      const infoPlistPath = iosInfoPlistPath(projectDir);
      await step("Connecting the app to the dev server", () =>
        runTransactionalSync([buildConfigPath, infoPlistPath], () => {
          injectNetworkSecurityExceptionIos(infoPlistPath, "localhost");
          injectDevServerUrlIos(buildConfigPath, appUrl);
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
    if (devServer !== options.devServer) devServer?.stop();
    throw err;
  }
}

/** A platform `run all` runs. */
export type RunPlatform = "android" | "ios";

/** `run all` options. */
export interface RunAllOptions extends IosRunOptions {
  /**
   * Reports a platform that could not run, when it fails and again when Ctrl+R retries it. The other
   * platform keeps running.
   */
  onPlatformFailure(platform: RunPlatform, error: unknown): void;
  /** Where the iOS app can run; defaults to this computer's OS. Replaced in tests. */
  hostPlatform?: NodeJS.Platform;
}

const PLATFORM_LABELS: Record<RunPlatform, string> = { android: "Android", ios: "iOS" };

/**
 * Runs the app on an Android device and an iOS simulator, one after the other, with one dev server for
 * both when watching. iOS is left out on computers other than Macs.
 *
 * A platform that fails is reported through `onPlatformFailure` and the other still runs; the session's
 * `rebuild()` then tries the failed one again too.
 *
 * @returns The session of the apps that are running, or `null` when none could run (each failure has
 *   been reported).
 * @throws {Error} When the environment is unknown, the project needs a sync, or the dev server does not start.
 */
export async function runAll(projectDir: string, options: RunAllOptions): Promise<RunSession | null> {
  const config = loadWefterConfig(projectDir);
  const environment = environmentOf(config, options.env);
  assertSynced(projectDir);

  const platforms: RunPlatform[] = ["android"];
  if ((options.hostPlatform ?? process.platform) === "darwin") {
    platforms.push("ios");
  } else {
    logger.warn("iOS apps need a Mac with Xcode; running the Android app only.");
  }

  const startedAt = Date.now();
  const devServer = options.watch ? await startWatchServer(projectDir) : null;
  const shared: RunOptions = { watch: options.watch, env: options.env, devServer: devServer ?? undefined };
  const start = (platform: RunPlatform) =>
    platform === "android" ? run(projectDir, shared) : runIos(projectDir, { ...shared, simulator: options.simulator });

  const running = new Map<RunPlatform, RunSession>();
  /** Starts each of `toStart` in turn; returns the errors of those that failed. */
  const startEach = async (toStart: RunPlatform[]) => {
    const errors: { platform: RunPlatform; error: unknown }[] = [];
    for (const platform of toStart) {
      writeLine("");
      writeLine(chalk.bold(PLATFORM_LABELS[platform]));
      try {
        running.set(platform, await start(platform));
      } catch (error) {
        errors.push({ platform, error });
      }
    }
    return errors;
  };

  const failures = await startEach(platforms);
  for (const { platform, error } of failures) options.onPlatformFailure(platform, error);
  if (running.size === 0) {
    devServer?.stop();
    return null;
  }
  const buildMs = Date.now() - startedAt;
  const sessions = () => platforms.flatMap((platform) => running.get(platform) ?? []);

  return {
    platform: "all",
    appName: environment.appName,
    get targetName() {
      return sessions()
        .map((session) => session.targetName)
        .join(" and ");
    },
    devServer,
    devtoolsUrl: sessions()[0].devtoolsUrl,
    buildMs,
    /**
     * Rebuilds the running apps and tries the failed ones again. Every platform is tried; all failures but
     * the last are reported through `onPlatformFailure`, and the last is thrown.
     */
    async rebuild() {
      const errors: { platform: RunPlatform; error: unknown }[] = [];
      for (const platform of platforms) {
        const session = running.get(platform);
        if (!session) {
          errors.push(...(await startEach([platform])));
          continue;
        }
        writeLine("");
        writeLine(chalk.bold(PLATFORM_LABELS[platform]));
        try {
          await session.rebuild();
        } catch (error) {
          errors.push({ platform, error });
        }
      }
      const last = errors.pop();
      for (const { platform, error } of errors) options.onPlatformFailure(platform, error);
      if (last) throw last.error;
    },
    async restartApp() {
      await Promise.all(sessions().map((session) => session.restartApp()));
    },
  };
}
