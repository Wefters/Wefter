import { basename } from "node:path";

/**
 * Turns a build tool's raw output into a short "what is it doing right now" text for the spinner.
 * Each tracker is fed every output line and returns new detail text, or null when the line isn't
 * interesting (most aren't).
 */
export type ProgressTracker = (line: string) => string | null;

/** "compileDevelopmentDebugKotlin" → "Compiling Kotlin"; unknown tasks → null. */
function describeGradleTask(task: string): string | null {
  if (/^compile.*Kotlin$/.test(task)) return "Compiling Kotlin";
  if (/^compile.*JavaWithJavac$/.test(task)) return "Compiling Java";
  if (/^(ksp|kapt).*Kotlin$|^kapt/.test(task)) return "Running annotation processors";
  if (/^(merge|process|generate|package|compile).*Resources$|^parse.*LocalResources$/.test(task)) {
    return "Processing resources";
  }
  if (/^(merge|process).*Manifest/.test(task)) return "Merging manifests";
  if (/^(dexBuilder|mergeExtDex|mergeLibDex|mergeProjectDex|mergeDex)/.test(task)) return "Dexing";
  if (/^(merge|strip).*(NativeLibs|JniLibFolders|DebugSymbols)/.test(task)) return "Bundling native libraries";
  if (/^package[A-Z]/.test(task) && !/Resources$/.test(task)) return "Packaging APK";
  if (/^(minify|shrink).*WithR8/.test(task)) return "Shrinking with R8";
  if (/^(sign|validateSigning)/.test(task)) return "Signing";
  if (/^assemble/.test(task)) return "Assembling";
  return null;
}

/**
 * Tracks Gradle running with `--console=plain` (one `> Task :module:task` line per task).
 * `variant` (e.g. "DevelopmentDebug") is removed from task names that have no friendlier
 * description, so "generateDevelopmentDebugBuildConfig" reads as "generateBuildConfig".
 */
export function createGradleProgress(variant = ""): ProgressTracker {
  let tasks = 0;
  return (raw) => {
    const line = raw.trim();
    if (/^Starting a Gradle Daemon/i.test(line)) return "Starting Gradle daemon";
    if (/^Downloading https?:|^Download https?:|^Downloading .*gradle-.*\.zip/i.test(line)) {
      return "Downloading dependencies (first build can take a while)";
    }
    if (/^> Configure project/.test(line)) return "Configuring project";
    const task = /^> Task (:[\w:-]*?):?([A-Za-z0-9]+)(?:\s+(UP-TO-DATE|NO-SOURCE|SKIPPED|FROM-CACHE))?$/.exec(line);
    if (!task) return null;
    tasks++;
    const module = task[1]!.replace(/^:|:$/g, "");
    const name = variant ? task[2]!.replace(variant, "") : task[2]!;
    const what = describeGradleTask(task[2]!) ?? `Running ${name}`;
    const where = module && module !== "app" ? ` (${module})` : "";
    return `${what}${where} · ${tasks} tasks`;
  };
}

function unescapeXcode(path: string): string {
  return path.replace(/\\(.)/g, "$1");
}

/** Tracks plain `xcodebuild` output (one line per build action). */
export function createXcodeProgress(): ProgressTracker {
  const compiled = new Set<string>();
  return (raw) => {
    const line = raw.trim();
    if (/^(Resolve Package Graph|Resolved source packages|Fetching from|Computing version for)/.test(line)) {
      return "Resolving Swift packages";
    }
    // Xcode 15+: "SwiftCompile normal arm64 Compiling\ ViewController.swift /path/ViewController.swift (in target…)"
    // Older:     "CompileSwift normal arm64 /path/ViewController.swift (in target…)"
    const swift = /^(?:SwiftCompile|CompileSwift)\s+\S+\s+\S+\s+(?:Compiling\\ (.+?\.swift)\s|(\S+?\.swift))/.exec(
      line,
    );
    if (swift) {
      const file = basename(unescapeXcode(swift[1] ?? swift[2]!));
      compiled.add(file);
      return `Compiling ${file} · ${compiled.size} file${compiled.size === 1 ? "" : "s"}`;
    }
    const clang = /^CompileC\s+\S+\s+(\S+?\.(?:m|mm|c|cpp))\s/.exec(line);
    if (clang) {
      const file = basename(unescapeXcode(clang[1]!));
      compiled.add(file);
      return `Compiling ${file} · ${compiled.size} file${compiled.size === 1 ? "" : "s"}`;
    }
    if (/^(SwiftEmitModule|EmitSwiftModule|SwiftDriver\b)/.test(line)) return "Compiling Swift";
    if (/^CompileAssetCatalog/.test(line)) return "Compiling asset catalog";
    if (/^(CompileStoryboard|LinkStoryboards)/.test(line)) return "Compiling storyboards";
    if (/^ProcessInfoPlistFile/.test(line)) return "Processing Info.plist";
    const script = /^PhaseScriptExecution\s+((?:\\ |\S)+)/.exec(line);
    if (script) return `Running script: ${unescapeXcode(script[1]!)}`;
    if (/^Ld\s/.test(line)) return "Linking";
    if (/^CodeSign\s/.test(line)) return "Signing";
    if (/^(CopySwiftLibs|ValidateEmbeddedBinary|RegisterExecutionPolicyException|Touch)\s/.test(line)) {
      return "Finishing app bundle";
    }
    return null;
  };
}
