import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PluginManifestSchema, type PluginManifest } from "./schema/plugin-schema.js";
import { readPluginKotlinSource } from "./read-kotlin-source.js";
import { readPluginSwiftSource } from "./read-swift-source.js";
import {
  extractDeclaredClassNames,
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
import { auditPermissionHandling } from "./audit-permission-handling.js";
import type { PluginExtraction } from "./codegen-android.js";
import type { PluginExtractionSwift } from "./codegen-ios.js";

export interface PluginValidationResult {
  valid: boolean;
  issues: string[];
  manifest?: PluginManifest;
  extraction?: PluginExtraction;
  iosExtraction?: PluginExtractionSwift;
}

function simpleClassName(name: string): string {
  const segments = name.replace(/^\.+/, "").split(".");
  return segments[segments.length - 1];
}

function validateManifestEntries(manifest: PluginManifest, hasAndroid: boolean, androidSource: string): string[] {
  const entries = manifest.android?.manifestEntries ?? [];
  if (entries.length === 0) return [];

  if (!hasAndroid) {
    return [`plugin.json declares "android.manifestEntries" but this plugin ships no android/ directory.`];
  }

  const declaredClasses = extractDeclaredClassNames(androidSource);
  return entries
    .filter((entry) => !declaredClasses.includes(simpleClassName(entry.name)))
    .map(
      (entry) =>
        `manifestEntries declares "${entry.name}" but no "class ${simpleClassName(entry.name)}" (or "object ${simpleClassName(entry.name)}") was found in android/ source.`,
    );
}

const GRADLE_COORDINATE_PATTERN = /^[\w.-]+:[\w.-]+:[\w.+-]+$/;

function validateGradleCoordinates(manifest: PluginManifest): string[] {
  const coordinates = manifest.nativeDependencies?.android?.gradle ?? [];
  return coordinates
    .filter((c) => !GRADLE_COORDINATE_PATTERN.test(c))
    .map(
      (c) =>
        `Malformed Gradle coordinate "${c}" in nativeDependencies.android.gradle — expected "group:artifact:version".`,
    );
}

export function validatePluginDirectory(pluginDir: string): PluginValidationResult {
  const manifestPath = join(pluginDir, "plugin.json");
  if (!existsSync(manifestPath)) {
    return { valid: false, issues: ["No plugin.json found — not a Wefter plugin."] };
  }

  const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { valid: false, issues: [`Invalid plugin.json: ${parsed.error.message}`] };
  }
  const manifest = parsed.data;

  const hasAndroid = existsSync(join(pluginDir, "android"));
  const hasIos = existsSync(join(pluginDir, "ios"));
  if (!hasAndroid && !hasIos) {
    return {
      valid: false,
      issues: [
        "No android/ or ios/ directory found — a Wefter plugin must ship native source for at least one platform.",
      ],
    };
  }

  const androidSource = hasAndroid ? readPluginKotlinSource(pluginDir) : "";
  const iosSource = hasIos ? readPluginSwiftSource(pluginDir) : "";

  const malformedIssues = [
    ...(hasAndroid
      ? findMalformedWefterMethods(androidSource).map(
          (line) => `Malformed @WefterMethod signature at line ${line} (android/)`,
        )
      : []),
    ...(hasAndroid
      ? findMalformedWefterHooks(androidSource).map(
          (line) => `Malformed @WefterHook signature at line ${line} (android/)`,
        )
      : []),
    ...(hasIos
      ? findMalformedWefterMethodsSwift(iosSource).map(
          (line) => `Malformed @WefterMethod signature at line ${line} (ios/)`,
        )
      : []),
    ...(hasIos
      ? findMalformedWefterHooksSwift(iosSource).map((line) => `Malformed @WefterHook signature at line ${line} (ios/)`)
      : []),
  ];
  if (malformedIssues.length > 0) return { valid: false, issues: malformedIssues };

  const schemaLevelIssues = [
    ...validateManifestEntries(manifest, hasAndroid, androidSource),
    ...validateGradleCoordinates(manifest),
  ];
  if (schemaLevelIssues.length > 0) return { valid: false, issues: schemaLevelIssues };

  const androidMethods = hasAndroid ? extractWefterMethods(androidSource) : [];
  const androidHooks = hasAndroid ? extractWefterHooks(androidSource) : [];
  const iosMethods = hasIos ? extractWefterMethodsSwift(iosSource) : [];
  const iosHooks = hasIos ? extractWefterHooksSwift(iosSource) : [];

  try {
    if (hasAndroid) auditPluginConsistency({ manifest, packageDir: pluginDir }, androidMethods, androidHooks);
    if (hasIos) auditPluginConsistency({ manifest, packageDir: pluginDir }, iosMethods, iosHooks);
  } catch (e) {
    return { valid: false, issues: [(e as Error).message] };
  }

  const permissionIssues = hasAndroid ? auditPermissionHandling(manifest, androidSource) : [];
  if (permissionIssues.length > 0) return { valid: false, issues: permissionIssues };

  return {
    valid: true,
    issues: [],
    manifest,
    extraction: hasAndroid ? { methods: androidMethods, hooks: androidHooks } : undefined,
    iosExtraction: hasIos ? { methods: iosMethods, hooks: iosHooks } : undefined,
  };
}
