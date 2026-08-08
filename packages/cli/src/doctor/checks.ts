import { exec } from "node:child_process";
import { REQUIREMENTS } from "../config/requirements.js";

function execAsync(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
  fix?: string;
}

export async function checkNodeVersion(): Promise<CheckResult> {
  const version = process.version;
  const major = Number(version.replace(/^v/, "").split(".")[0]);

  if (Number.isNaN(major)) {
    return {
      name: "Node.js version",
      passed: false,
      fix: `Could not parse Node.js version "${version}". Install Node.js ${REQUIREMENTS.node.min}+.`,
    };
  }

  if (major >= REQUIREMENTS.node.min) {
    return { name: "Node.js version", passed: true, detail: version };
  }

  return {
    name: "Node.js version",
    passed: false,
    detail: `found ${version}, need ${REQUIREMENTS.node.min}+`,
    fix: `install Node.js ${REQUIREMENTS.node.min}+ (nvm install ${REQUIREMENTS.node.min}, or from nodejs.org)`,
  };
}

export async function checkAndroidHome(): Promise<CheckResult> {
  const value = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;

  if (value) {
    return { name: "ANDROID_HOME set", passed: true, detail: value };
  }

  return {
    name: "ANDROID_HOME set",
    passed: false,
    fix: "set ANDROID_HOME (or ANDROID_SDK_ROOT) to your Android SDK install path",
  };
}

export async function checkAdbOnPath(): Promise<CheckResult> {
  try {
    await execAsync("adb version");
    return { name: "adb on PATH", passed: true };
  } catch {
    return {
      name: "adb on PATH",
      passed: false,
      fix: "add $ANDROID_HOME/platform-tools to your PATH",
    };
  }
}

export async function checkJdkVersion(): Promise<CheckResult> {
  let output: string;
  try {
    const { stdout, stderr } = await execAsync("java -version");
    output = stderr || stdout;
  } catch {
    return {
      name: "JDK version",
      passed: false,
      fix: `java not found on PATH. Install JDK ${REQUIREMENTS.jdk.min} and set JAVA_HOME.`,
    };
  }

  const match = output.match(/version "(\d+)(?:\.(\d+))?/);
  const major = match ? (match[1] === "1" ? Number(match[2]) : Number(match[1])) : null;

  if (major !== null && major >= REQUIREMENTS.jdk.min) {
    return { name: "JDK version", passed: true, detail: String(major) };
  }

  return {
    name: "JDK version",
    passed: false,
    detail: major !== null ? `found ${major}, need ${REQUIREMENTS.jdk.min}` : "no version detected",
    fix: `install JDK ${REQUIREMENTS.jdk.min} and set JAVA_HOME to point at it`,
  };
}

export async function checkConnectedDevice(): Promise<CheckResult> {
  let stdout: string;
  try {
    ({ stdout } = await execAsync("adb devices"));
  } catch {
    return {
      name: "No connected device or running emulator",
      passed: false,
      fix: "could not run `adb devices` — fix the adb on PATH check first",
    };
  }

  const devices = stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.endsWith("device"));

  if (devices.length > 0) {
    return {
      name: "Connected device or running emulator",
      passed: true,
      detail: `${devices.length} device(s)`,
    };
  }

  return {
    name: "No connected device or running emulator",
    passed: false,
    fix: "run `emulator -avd <name>` or connect a device with USB debugging enabled",
  };
}

function isMacOS(): boolean {
  return process.platform === "darwin";
}

export async function checkMacOS(): Promise<CheckResult> {
  if (isMacOS()) {
    return { name: "Running on macOS", passed: true };
  }
  return {
    name: "Running on macOS",
    passed: false,
    detail: `found ${process.platform}`,
    fix: "iOS builds require a Mac (local or CI, e.g. GitHub Actions' macos-latest runner) — the rest of the iOS checks below will also fail until then",
  };
}

export async function checkXcodeInstalled(): Promise<CheckResult> {
  if (!isMacOS()) {
    return { name: "Xcode installed", passed: false, fix: "requires macOS" };
  }
  try {
    const { stdout } = await execAsync("xcodebuild -version");
    return { name: "Xcode installed", passed: true, detail: stdout.split("\n")[0] };
  } catch {
    return { name: "Xcode installed", passed: false, fix: "install Xcode from the App Store, then run `xcodebuild -version` to verify" };
  }
}

export async function checkXcodeCommandLineTools(): Promise<CheckResult> {
  if (!isMacOS()) {
    return { name: "Xcode Command Line Tools", passed: false, fix: "requires macOS" };
  }
  try {
    const { stdout } = await execAsync("xcode-select -p");
    return { name: "Xcode Command Line Tools", passed: true, detail: stdout.trim() };
  } catch {
    return { name: "Xcode Command Line Tools", passed: false, fix: "run `xcode-select --install`" };
  }
}

export async function checkSimulatorAvailable(): Promise<CheckResult> {
  if (!isMacOS()) {
    return { name: "iOS Simulator available", passed: false, fix: "requires macOS" };
  }
  try {
    const { stdout } = await execAsync("xcrun simctl list devices available -j");
    const parsed = JSON.parse(stdout) as { devices: Record<string, unknown[]> };
    const count = Object.values(parsed.devices).reduce((sum, devices) => sum + devices.length, 0);
    if (count > 0) {
      return { name: "iOS Simulator available", passed: true, detail: `${count} device(s)` };
    }
    return {
      name: "iOS Simulator available",
      passed: false,
      fix: "create one in Xcode (Window > Devices and Simulators)",
    };
  } catch {
    return {
      name: "iOS Simulator available",
      passed: false,
      fix: "could not run `xcrun simctl list devices` — fix the Xcode Command Line Tools check first",
    };
  }
}

export async function runAllChecks(): Promise<CheckResult[]> {
  return Promise.all([
    checkNodeVersion(),
    checkAndroidHome(),
    checkAdbOnPath(),
    checkJdkVersion(),
    checkConnectedDevice(),
    checkMacOS(),
    checkXcodeInstalled(),
    checkXcodeCommandLineTools(),
    checkSimulatorAvailable(),
  ]);
}
