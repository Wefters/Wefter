/** Reads build tool output line by line and turns it into a short progress message for the spinner. */

import { basename } from "node:path";

/** Takes one line of output and returns a new progress message, or `null` when the line says nothing new. */
export type ProgressTracker = (line: string) => string | null;

/** A readable name for a Gradle task, or `null` for tasks with no clear meaning. */
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
 * Progress for Gradle's `--console=plain` output: daemon start-up, downloads, configuration, then each task
 * with a running count.
 *
 * @param variant Variant name (such as `DevelopmentDebug`) removed from task names for display.
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

/** Removes the backslash escapes xcodebuild puts in paths. */
function unescapeXcode(path: string): string {
  return path.replace(/\\(.)/g, "$1");
}

/**
 * Progress for xcodebuild output: package resolution, each compiled file with a running count, then
 * linking, signing and bundling.
 */
export function createXcodeProgress(): ProgressTracker {
  const compiled = new Set<string>();
  return (raw) => {
    const line = raw.trim();
    if (/^(Resolve Package Graph|Resolved source packages|Fetching from|Computing version for)/.test(line)) {
      return "Resolving Swift packages";
    }
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
