import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanPlugins } from "./scan-plugins.js";
import { generateRegistryKotlin, type PluginExtraction } from "./codegen-android.js";
import { generateRegistrySwift, type PluginExtractionSwift } from "./codegen-ios.js";
import { readPluginKotlinSource } from "./read-kotlin-source.js";
import { readPluginSwiftSource } from "./read-swift-source.js";
import {
  extractWefterHooks,
  extractWefterMethods,
  findMalformedWefterHooks,
  findMalformedWefterMethods,
} from "./extract-wefter-plugin.js";
import {
  extractWefterHooksSwift,
  extractWefterMethodsSwift,
  findMalformedWefterHooksSwift,
  findMalformedWefterMethodsSwift,
} from "./extract-wefter-plugin-swift.js";
import { auditPluginConsistency } from "./audit-plugin-consistency.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pluginsDir = resolve(repoRoot, "plugins");
const outFile = resolve(repoRoot, "shells/android-template/app/src/main/java/dev/wefter/bridge/GeneratedRegistry.kt");
const iosOutFile = resolve(repoRoot, "shells/ios-template/WefterBridge/GeneratedRegistry.swift");

const packageNames = readdirSync(pluginsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const plugins = scanPlugins(pluginsDir, packageNames);

const extraction = new Map<string, PluginExtraction>();
const iosExtraction = new Map<string, PluginExtractionSwift>();
for (const plugin of plugins) {
  if (existsSync(join(plugin.packageDir, "android"))) {
    const source = readPluginKotlinSource(plugin.packageDir);

    const malformedMethods = findMalformedWefterMethods(source);
    const malformedHooks = findMalformedWefterHooks(source);
    if (malformedMethods.length > 0 || malformedHooks.length > 0) {
      throw new Error(
        `Plugin "${plugin.manifest.name}": malformed @WefterMethod/@WefterHook signature at line(s) ` +
          `${[...malformedMethods, ...malformedHooks].join(", ")}`,
      );
    }

    const methods = extractWefterMethods(source);
    const hooks = extractWefterHooks(source);
    auditPluginConsistency(plugin, methods, hooks);
    extraction.set(plugin.manifest.name, { methods, hooks });
  }

  if (existsSync(join(plugin.packageDir, "ios"))) {
    const source = readPluginSwiftSource(plugin.packageDir);

    const malformedMethods = findMalformedWefterMethodsSwift(source);
    const malformedHooks = findMalformedWefterHooksSwift(source);
    if (malformedMethods.length > 0 || malformedHooks.length > 0) {
      throw new Error(
        `Plugin "${plugin.manifest.name}": malformed @WefterMethod/@WefterHook signature at line(s) ` +
          `${[...malformedMethods, ...malformedHooks].join(", ")} (ios/)`,
      );
    }

    const methods = extractWefterMethodsSwift(source);
    const hooks = extractWefterHooksSwift(source);
    auditPluginConsistency(plugin, methods, hooks);
    iosExtraction.set(plugin.manifest.name, { methods, hooks });
  }
}

const androidPlugins = plugins.filter((p) => existsSync(join(p.packageDir, "android")));
const iosPlugins = plugins.filter((p) => existsSync(join(p.packageDir, "ios")));

writeFileSync(outFile, generateRegistryKotlin(androidPlugins, "dev.wefter.bridge", extraction) + "\n", "utf-8");
writeFileSync(iosOutFile, generateRegistrySwift(iosPlugins, iosExtraction) + "\n", "utf-8");

console.log(
  `Generated ${outFile} — ${androidPlugins.length} plugin(s): ${androidPlugins.map((p) => p.manifest.name).join(", ")}`,
);
console.log(
  `Generated ${iosOutFile} — ${iosPlugins.length} plugin(s): ${iosPlugins.map((p) => p.manifest.name).join(", ")}`,
);
