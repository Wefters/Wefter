import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exec } from "node:child_process";
import {
  checkAdbOnPath,
  checkAndroidHome,
  checkConnectedDevice,
  checkJdkVersion,
  checkNodeVersion,
  runAllChecks,
} from "../src/doctor/checks.js";

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

const mockExec = vi.mocked(exec);

function execSucceedsWith(stdout: string, stderr = "") {
  mockExec.mockImplementation(((command: string, callback: any) => {
    callback(null, stdout, stderr);
  }) as any);
}

function execFails() {
  mockExec.mockImplementation(((command: string, callback: any) => {
    callback(new Error("command not found"), "", "");
  }) as any);
}

beforeEach(() => {
  mockExec.mockReset();
});

describe("checkNodeVersion", () => {
  const originalVersion = process.version;

  afterEach(() => {
    Object.defineProperty(process, "version", { value: originalVersion, configurable: true });
  });

  it("passes when the running Node.js meets the minimum", async () => {
    Object.defineProperty(process, "version", { value: "v20.11.0", configurable: true });

    const result = await checkNodeVersion();

    expect(result.passed).toBe(true);
    expect(result.detail).toBe("v20.11.0");
  });

  it("fails clearly when the running Node.js is below the minimum", async () => {
    Object.defineProperty(process, "version", { value: "v16.2.0", configurable: true });

    const result = await checkNodeVersion();

    expect(result.passed).toBe(false);
    expect(result.fix).toContain("Node.js");
  });
});

describe("checkAndroidHome", () => {
  const originalHome = process.env.ANDROID_HOME;
  const originalRoot = process.env.ANDROID_SDK_ROOT;

  afterEach(() => {
    if (originalHome === undefined) delete process.env.ANDROID_HOME;
    else process.env.ANDROID_HOME = originalHome;
    if (originalRoot === undefined) delete process.env.ANDROID_SDK_ROOT;
    else process.env.ANDROID_SDK_ROOT = originalRoot;
  });

  it("passes and reports the path when ANDROID_HOME is set", async () => {
    process.env.ANDROID_HOME = "/opt/android-sdk";
    delete process.env.ANDROID_SDK_ROOT;

    const result = await checkAndroidHome();

    expect(result.passed).toBe(true);
    expect(result.detail).toBe("/opt/android-sdk");
  });

  it("fails clearly when neither ANDROID_HOME nor ANDROID_SDK_ROOT is set", async () => {
    delete process.env.ANDROID_HOME;
    delete process.env.ANDROID_SDK_ROOT;

    const result = await checkAndroidHome();

    expect(result.passed).toBe(false);
    expect(result.fix).toContain("ANDROID_HOME");
  });
});

describe("checkAdbOnPath", () => {
  it("passes when adb responds to `adb version`", async () => {
    execSucceedsWith("Android Debug Bridge version 1.0.41");

    const result = await checkAdbOnPath();

    expect(result.passed).toBe(true);
  });

  it("fails clearly when adb is not on PATH", async () => {
    execFails();

    const result = await checkAdbOnPath();

    expect(result.passed).toBe(false);
    expect(result.fix).toContain("PATH");
  });
});

describe("checkJdkVersion", () => {
  it("passes when java -version reports at least the minimum major version", async () => {
    execSucceedsWith("", 'openjdk version "17.0.9" 2023-10-17');

    const result = await checkJdkVersion();

    expect(result.passed).toBe(true);
    expect(result.detail).toBe("17");
  });

  it("fails clearly and names both found and required versions when JDK is too old", async () => {
    execSucceedsWith("", 'java version "11.0.2" 2019-01-15');

    const result = await checkJdkVersion();

    expect(result.passed).toBe(false);
    expect(result.detail).toBe("found 11, need 17");
    expect(result.fix).toContain("JDK 17");
  });

  it("handles the legacy 1.8-style version string", async () => {
    execSucceedsWith("", 'java version "1.8.0_311"');

    const result = await checkJdkVersion();

    expect(result.passed).toBe(false);
    expect(result.detail).toBe("found 8, need 17");
  });

  it("fails clearly when java is not on PATH", async () => {
    execFails();

    const result = await checkJdkVersion();

    expect(result.passed).toBe(false);
    expect(result.fix).toContain("JDK 17");
  });
});

describe("checkConnectedDevice", () => {
  it("passes when adb devices lists at least one attached device", async () => {
    execSucceedsWith("List of devices attached\nemulator-5554\tdevice\n\n");

    const result = await checkConnectedDevice();

    expect(result.passed).toBe(true);
    expect(result.detail).toBe("1 device(s)");
  });

  it("fails clearly with the exact no-device wording when none are attached", async () => {
    execSucceedsWith("List of devices attached\n\n");

    const result = await checkConnectedDevice();

    expect(result.passed).toBe(false);
    expect(result.name).toBe("No connected device or running emulator");
    expect(result.fix).toContain("emulator");
  });

  it("does not count an unauthorized or offline device as connected", async () => {
    execSucceedsWith("List of devices attached\nR58M12345\tunauthorized\n\n");

    const result = await checkConnectedDevice();

    expect(result.passed).toBe(false);
  });
});

describe("runAllChecks", () => {
  it("returns a result for every check even when all of them fail", async () => {
    execFails();
    delete process.env.ANDROID_HOME;
    delete process.env.ANDROID_SDK_ROOT;

    const results = await runAllChecks();

    expect(results).toHaveLength(9);
    expect(results.every((r) => typeof r.passed === "boolean")).toBe(true);
  });
});

describe("iOS checks — on this (non-macOS) test machine", () => {
  
  
  
  it("checkMacOS fails with a clear fix message off Darwin", async () => {
    const { checkMacOS } = await import("../src/doctor/checks.js");
    const result = await checkMacOS();

    if (process.platform !== "darwin") {
      expect(result.passed).toBe(false);
      expect(result.fix).toContain("Mac");
    } else {
      expect(result.passed).toBe(true);
    }
  });

  it("checkXcodeInstalled short-circuits to 'requires macOS' without touching exec, off Darwin", async () => {
    if (process.platform === "darwin") return;
    execFails(); 
    const { checkXcodeInstalled } = await import("../src/doctor/checks.js");

    const result = await checkXcodeInstalled();

    expect(result.passed).toBe(false);
    expect(result.fix).toBe("requires macOS");
  });

  it("checkXcodeCommandLineTools short-circuits to 'requires macOS' off Darwin", async () => {
    if (process.platform === "darwin") return;
    const { checkXcodeCommandLineTools } = await import("../src/doctor/checks.js");

    const result = await checkXcodeCommandLineTools();

    expect(result.passed).toBe(false);
    expect(result.fix).toBe("requires macOS");
  });

  it("checkSimulatorAvailable short-circuits to 'requires macOS' off Darwin", async () => {
    if (process.platform === "darwin") return;
    const { checkSimulatorAvailable } = await import("../src/doctor/checks.js");

    const result = await checkSimulatorAvailable();

    expect(result.passed).toBe(false);
    expect(result.fix).toBe("requires macOS");
  });
});
