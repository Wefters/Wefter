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

export interface RunOptions {
  watch: boolean;
  env: string;
}

export interface IosRunOptions extends RunOptions {
  simulator?: string;
}

/** A launched app, plus what the interactive session needs to reload or rebuild it. */
export interface RunSession {
  platform: "android" | "ios";
  appName: string;
  /** Where the app is running, e.g. "iPhone 17 Pro Max" or "Pixel 8 (emulator-5554)". */
  targetName: string;
  devServer: DevServer | null;
  devtoolsUrl: string | null;
  /** How long the first build + install + launch took. */
  buildMs: number;
  /** Rebuilds the native app, reinstalls and relaunches it (Ctrl+R). */
  rebuild(): Promise<void>;
  /** Kills and relaunches the app without rebuilding (fallback for `r`). */
  restartApp(): Promise<void>;
}

function environmentOf(config: WefterConfig, env: string) {
  const environment = config.environments[env];
  if (!environment) {
    throw new Error(
      `Unknown environment "${env}". Configured environments: ${Object.keys(config.environments).join(", ")}`,
    );
  }
  return environment;
}

/** Fails fast with `wefter sync` advice if the native project no longer matches the config. */
function assertSynced(projectDir: string): void {
  const freshness = checkSyncFreshness(projectDir);
  if (!freshness.fresh) throw new Error(freshness.reason);
}

function warnUnresolved(unresolved: string[]): void {
  if (unresolved.length === 0) return;
  logger.warn(
    `Registered plugin(s) not found in node_modules: ${unresolved.join(", ")}. ` +
      `Run \`wefter sync\` to refresh the registry.`,
  );
}

async function startWatchServer(projectDir: string): Promise<{ devServer: DevServer; lanIp: string }> {
  // Choosing a network interface may prompt, so it happens before any spinner starts.
  const lanIp = await resolveLanIp();
  const devServer = await step("Starting dev server", () => startDevServer(projectDir, lanIp), {
    done: (server) => `Dev server ready at ${chalk.cyan(server.url)}`,
  });
  return { devServer, lanIp };
}

function describeAdbDevice(device: AdbDevice): string {
  const model = device.model?.replace(/_/g, " ");
  return model ? `${model} (${device.serial})` : device.serial;
}

export async function run(projectDir: string, options: RunOptions): Promise<RunSession> {
  const config = loadWefterConfig(projectDir);
  const environment = environmentOf(config, options.env);
  assertSynced(projectDir);
  warnUnresolved(unresolvedRegisteredPlugins(pluginsDirPath(projectDir, config), config.plugins));

  // May prompt when several devices are connected, so it also runs before any spinner.
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
      await step(`Installing on ${targetName}`, () => installAndroidApp(target, apkPath));
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
    // A dev server started before the failure must not keep the process alive.
    devServer?.stop();
    throw err;
  }
}

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
        // The simulator may have been shut down since the first launch.
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
