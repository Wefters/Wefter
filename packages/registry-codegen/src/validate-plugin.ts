import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PluginManifestSchema, type PluginManifest } from "./schema/plugin-schema.js";
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
      ? findMalformedWefterMethods(androidSource).map((line) => `Malformed @WefterMethod signature at line ${line} (android/)`)
      : []),
    ...(hasAndroid
      ? findMalformedWefterHooks(androidSource).map((line) => `Malformed @WefterHook signature at line ${line} (android/)`)
      : []),
    ...(hasIos
      ? findMalformedWefterMethodsSwift(iosSource).map((line) => `Malformed @WefterMethod signature at line ${line} (ios/)`)
      : []),
    ...(hasIos
      ? findMalformedWefterHooksSwift(iosSource).map((line) => `Malformed @WefterHook signature at line ${line} (ios/)`)
      : []),
  ];
  if (malformedIssues.length > 0) return { valid: false, issues: malformedIssues };

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
