import { describe, expect, it } from "vitest";
import { diagnoseAdb, diagnoseGradle } from "../src/native/android-diagnostics.js";

const lines = (text: string) => text.split("\n");

describe("diagnoseGradle — compiler errors", () => {
  it("extracts Kotlin (K2) errors with file:line:col and drops the long path", () => {
    const { errors } = diagnoseGradle(
      lines(`> Task :app:compileDevelopmentDebugKotlin FAILED
e: file:///Users/me/app/.wefter/native/android/app/src/main/java/dev/wefter/ScannerPlugin.kt:41:17 Unresolved reference 'barcodeOptions'.
e: file:///Users/me/app/.wefter/native/android/app/src/main/java/dev/wefter/ScannerPlugin.kt:58:9 Argument type mismatch: actual type is 'String?', but 'String' was expected.

FAILURE: Build failed with an exception.`),
    );
    expect(errors).toEqual([
      "ScannerPlugin.kt:41:17 Unresolved reference 'barcodeOptions'.",
      "ScannerPlugin.kt:58:9 Argument type mismatch: actual type is 'String?', but 'String' was expected.",
    ]);
  });

  it("extracts Kotlin (K1) errors in the older (line, col) format", () => {
    const { errors } = diagnoseGradle(lines(`e: /Users/me/app/src/Foo.kt: (12, 5): Unresolved reference: bar`));
    expect(errors).toEqual(["Foo.kt:12:5 Unresolved reference: bar"]);
  });

  it("extracts javac errors", () => {
    const { errors } = diagnoseGradle(
      lines(`/Users/me/app/src/main/java/dev/wefter/Legacy.java:12: error: cannot find symbol
    Foo foo = new Foo();
    ^
  symbol:   class Foo`),
    );
    expect(errors).toEqual(["Legacy.java:12 cannot find symbol"]);
  });

  it("extracts AAPT resource errors", () => {
    const { errors } = diagnoseGradle(
      lines(
        `ERROR: /Users/me/app/src/main/res/layout/activity_main.xml:7: AAPT: error: attribute android:foo not found.`,
      ),
    );
    expect(errors).toEqual(["activity_main.xml:7 attribute android:foo not found."]);
  });

  it("de-duplicates repeated errors and caps the list", () => {
    const repeated = Array.from({ length: 40 }, (_, i) => `e: file:///a/Foo.kt:${i}:1 Broken`);
    const { errors } = diagnoseGradle([...repeated, ...repeated]);
    expect(errors).toHaveLength(15);
    expect(new Set(errors).size).toBe(15);
  });
});

describe("diagnoseGradle — Gradle's own summary", () => {
  it("falls back to the “What went wrong” block when there are no compiler errors", () => {
    const { errors } = diagnoseGradle(
      lines(`FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':app:mergeDevelopmentDebugResources'.
> A failure occurred while executing com.android.build.gradle.internal.res.ResourceCompilerRunnable
   > Resource compilation failed (Failed to compile values resource file).

* Try:
> Run with --stacktrace option to get the stack trace.`),
    );
    expect(errors).toEqual([
      "Execution failed for task ':app:mergeDevelopmentDebugResources'.",
      "A failure occurred while executing com.android.build.gradle.internal.res.ResourceCompilerRunnable",
      "Resource compilation failed (Failed to compile values resource file).",
    ]);
  });

  it("prefers compiler errors over the generic summary", () => {
    const { errors } = diagnoseGradle(
      lines(`e: file:///a/Foo.kt:1:1 Broken

* What went wrong:
Execution failed for task ':app:compileDevelopmentDebugKotlin'.`),
    );
    expect(errors).toEqual(["Foo.kt:1:1 Broken"]);
  });

  it("returns no errors for output it doesn't recognise (the runner then shows the last lines)", () => {
    expect(diagnoseGradle(["something odd happened"]).errors).toEqual([]);
  });
});

describe("diagnoseGradle — environment problems", () => {
  const hintFor = (text: string) => diagnoseGradle(lines(text)).hints;

  it("explains a missing Android SDK", () => {
    expect(
      hintFor(
        "SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or by setting the sdk.dir path in your project's local properties file",
      )[0],
    ).toMatch(/ANDROID_HOME/);
  });

  it("names the JDK version Gradle asked for", () => {
    expect(hintFor("Android Gradle plugin requires Java 17 to run. You are currently using Java 11.")[0]).toMatch(
      /JDK 17/,
    );
    expect(hintFor("Unsupported class file major version 65")[0]).toMatch(/JAVA_HOME/);
  });

  it("explains unaccepted SDK licences", () => {
    expect(
      hintFor("Failed to install the following Android SDK packages as some licences have not been accepted.")[0],
    ).toBe("Accept the Android SDK licences: sdkmanager --licenses");
  });

  it("explains dependency download failures", () => {
    expect(hintFor("Could not resolve all files for configuration ':app:debugRuntimeClasspath'.")[0]).toMatch(
      /internet connection/,
    );
  });

  it("suggests wefter sync when the generated registry doesn't compile", () => {
    expect(hintFor("e: file:///a/GeneratedRegistry.kt:9:5 Unresolved reference 'ScannerPlugin'.")).toContain(
      "The generated plugin registry is out of date. Run `wefter sync` and try again.",
    );
  });

  it("doesn't blame the registry for an error in another file", () => {
    expect(
      hintFor(`> Task :app:compileDevelopmentDebugKotlin
w: file:///a/GeneratedRegistry.kt:3:1 'x' is deprecated
e: file:///a/ScannerPlugin.kt:9:5 Unresolved reference 'barcodeOptions'.`),
    ).toEqual([]);
  });

  it("explains a Gradle lock held by another build", () => {
    expect(
      hintFor("Timeout waiting to lock build cache. It is currently in use by another Gradle instance.")[0],
    ).toMatch(/--stop/);
  });

  it("explains Gradle running out of memory", () => {
    expect(hintFor("java.lang.OutOfMemoryError: Java heap space")[0]).toMatch(/org\.gradle\.jvmargs/);
  });

  it("adds no hints for an ordinary compile error", () => {
    expect(hintFor("e: file:///a/Foo.kt:1:1 Broken")).toEqual([]);
  });
});

describe("diagnoseAdb", () => {
  const ctx = { serial: "R58N12ABC", appId: "dev.wefter.demo" };

  it.each([
    ["INSTALL_FAILED_UPDATE_INCOMPATIBLE", /adb -s R58N12ABC uninstall dev\.wefter\.demo/],
    ["INSTALL_FAILED_VERSION_DOWNGRADE", /uninstall dev\.wefter\.demo/],
    ["INSTALL_FAILED_INSUFFICIENT_STORAGE", /out of storage/],
    ["INSTALL_FAILED_OLDER_SDK", /minSdk/],
    ["INSTALL_FAILED_NO_MATCHING_ABIS", /CPU/],
    ["INSTALL_FAILED_USER_RESTRICTED", /Install via USB/],
    ["INSTALL_FAILED_INVALID_APK", /Rebuild/],
    ["INSTALL_PARSE_FAILED_NO_CERTIFICATES", /signed/],
  ])("explains %s", (code, hint) => {
    const result = diagnoseAdb(
      lines(`Performing Streamed Install
adb: failed to install /out/app.apk: Failure [${code}: details from the package manager]`),
      ctx,
    );
    expect(result.errors).toEqual([`${code}: details from the package manager`]);
    expect(result.hints).toHaveLength(1);
    expect(result.hints[0]).toMatch(hint);
  });

  it("uses a placeholder app id when it isn't known", () => {
    const { hints } = diagnoseAdb(["Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]"]);
    expect(hints[0]).toMatch(/adb uninstall <appId>/);
  });

  it("explains an offline device", () => {
    const { errors, hints } = diagnoseAdb(["adb: error: device offline"]);
    expect(errors).toEqual(["adb: error: device offline"]);
    expect(hints[0]).toMatch(/Reconnect/);
  });

  it("explains an unauthorised device", () => {
    expect(diagnoseAdb(["adb: error: device unauthorized."])).toMatchObject({
      hints: [expect.stringMatching(/Allow USB debugging/)],
    });
  });

  it("explains a device that disappeared", () => {
    expect(diagnoseAdb(["adb: error: device 'R58N12ABC' not found"]).hints[0]).toMatch(/no longer connected/);
  });

  it("explains a missing launcher activity", () => {
    const { errors, hints } = diagnoseAdb(
      lines(`Starting: Intent { cmp=dev.wefter.demo/dev.wefter.MainActivity }
Error type 3
Error: Activity class {dev.wefter.demo/dev.wefter.MainActivity} does not exist.`),
    );
    expect(errors).toContain("Error: Activity class {dev.wefter.demo/dev.wefter.MainActivity} does not exist.");
    expect(hints[0]).toMatch(/wefter sync/);
  });
});
