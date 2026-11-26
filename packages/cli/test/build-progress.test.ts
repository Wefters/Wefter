import { describe, expect, it } from "vitest";
import { createGradleProgress, createXcodeProgress } from "../src/native/build-progress.js";

describe("createGradleProgress", () => {
  it("describes the build phases Gradle goes through and counts tasks", () => {
    const track = createGradleProgress();
    const seen = [
      "Starting a Gradle Daemon (subsequent builds will be faster)",
      "> Configure project :app",
      "> Task :app:preBuild UP-TO-DATE",
      "> Task :app:processDevelopmentDebugMainManifest",
      "> Task :app:mergeDevelopmentDebugResources",
      "> Task :app:compileDevelopmentDebugKotlin",
      "> Task :app:compileDevelopmentDebugJavaWithJavac NO-SOURCE",
      "> Task :app:dexBuilderDevelopmentDebug",
      "> Task :app:mergeDevelopmentDebugNativeLibs",
      "> Task :app:packageDevelopmentDebug",
      "> Task :app:assembleDevelopmentDebug",
    ].map(track);

    expect(seen).toEqual([
      "Starting Gradle daemon",
      "Configuring project",
      "Running preBuild · 1 tasks",
      "Merging manifests · 2 tasks",
      "Processing resources · 3 tasks",
      "Compiling Kotlin · 4 tasks",
      "Compiling Java · 5 tasks",
      "Dexing · 6 tasks",
      "Bundling native libraries · 7 tasks",
      "Packaging APK · 8 tasks",
      "Assembling · 9 tasks",
    ]);
  });

  it("drops the build variant from task names it has no description for", () => {
    const track = createGradleProgress("DevelopmentDebug");
    expect(track("> Task :app:generateDevelopmentDebugBuildConfig")).toBe("Running generateBuildConfig · 1 tasks");
    expect(track("> Task :app:preDevelopmentDebugBuild")).toBe("Running preBuild · 2 tasks");
    expect(track("> Task :app:compileDevelopmentDebugKotlin")).toBe("Compiling Kotlin · 3 tasks");
  });

  it("names the plugin module when the task isn't in :app", () => {
    const track = createGradleProgress();
    expect(track("> Task :wefter-scanner:compileDebugKotlin")).toBe("Compiling Kotlin (wefter-scanner) · 1 tasks");
  });

  it("handles root-level tasks", () => {
    expect(createGradleProgress()("> Task :assembleDebug")).toBe("Assembling · 1 tasks");
  });

  it("explains slow first builds while dependencies download", () => {
    expect(createGradleProgress()("Downloading https://services.gradle.org/distributions/gradle-8.9-bin.zip")).toMatch(
      /Downloading dependencies/,
    );
  });

  it("ignores everything else", () => {
    const track = createGradleProgress();
    expect(track("BUILD SUCCESSFUL in 41s")).toBeNull();
    expect(track("w: some warning")).toBeNull();
    expect(track("")).toBeNull();
  });
});

describe("createXcodeProgress", () => {
  it("names each Swift file and counts distinct files (Xcode 15+ format)", () => {
    const track = createXcodeProgress();
    expect(
      track(
        "SwiftCompile normal arm64 Compiling\\ ViewController.swift /Users/me/ios/WefterBridge/ViewController.swift (in target 'WefterBridge' from project 'WefterBridge')",
      ),
    ).toBe("Compiling ViewController.swift · 1 file");
    expect(
      track(
        "SwiftCompile normal arm64 Compiling\\ BridgeDispatcher.swift /Users/me/ios/WefterBridge/BridgeDispatcher.swift (in target 'WefterBridge' from project 'WefterBridge')",
      ),
    ).toBe("Compiling BridgeDispatcher.swift · 2 files");
    expect(
      track(
        "SwiftCompile normal arm64 Compiling\\ ViewController.swift /Users/me/ios/WefterBridge/ViewController.swift (in target 'WefterBridge' from project 'WefterBridge')",
      ),
    ).toBe("Compiling ViewController.swift · 2 files");
  });

  it("understands the older CompileSwift format and Objective-C files", () => {
    const track = createXcodeProgress();
    expect(track("CompileSwift normal arm64 /Users/me/ios/App/AppDelegate.swift (in target 'App')")).toBe(
      "Compiling AppDelegate.swift · 1 file",
    );
    expect(track("CompileC /build/Legacy.o /Users/me/ios/App/Legacy.m normal arm64 objective-c")).toBe(
      "Compiling Legacy.m · 2 files",
    );
  });

  it("describes the other build phases", () => {
    const track = createXcodeProgress();
    expect(track("Resolve Package Graph")).toBe("Resolving Swift packages");
    expect(track("CompileAssetCatalog /build/App.app /Users/me/ios/Assets.xcassets")).toBe("Compiling asset catalog");
    expect(track("CompileStoryboard /Users/me/ios/LaunchScreen.storyboard")).toBe("Compiling storyboards");
    expect(track("ProcessInfoPlistFile /build/App.app/Info.plist /Users/me/ios/Info.plist")).toBe(
      "Processing Info.plist",
    );
    expect(track("PhaseScriptExecution Copy\\ web\\ assets /build/Script-1.sh")).toBe(
      "Running script: Copy web assets",
    );
    expect(track("Ld /build/App.app/App normal")).toBe("Linking");
    expect(track("CodeSign /build/App.app")).toBe("Signing");
    expect(track("Touch /build/App.app")).toBe("Finishing app bundle");
  });

  it("ignores noise", () => {
    const track = createXcodeProgress();
    expect(track("    cd /Users/me/ios")).toBeNull();
    expect(track("note: Using new build system")).toBeNull();
    expect(track("** BUILD SUCCEEDED **")).toBeNull();
  });
});
