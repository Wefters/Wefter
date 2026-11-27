/**
 * Native build setups for environments beyond the templates' `development` and `production`: an Android
 * product flavor, and iOS build configurations (`Debug-<Env>`, `Release-<Env>`) with their `.xcconfig`
 * files. Existing setups are left alone, so this can run on every sync.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Upper-cases the first character, as Gradle and the Xcode configurations name environments. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Index of the `}` closing the `{` at `openIndex`. */
function matchingBrace(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Adds a product flavor, with the `WEFTER-ENV-CONFIG` markers sync fills in, for each environment the
 * Android `build.gradle.kts` does not have yet.
 *
 * @returns The environments added.
 * @throws {Error} When the file has no `productFlavors` block.
 */
export function ensureAndroidFlavors(buildGradlePath: string, envs: string[]): string[] {
  let gradle = readFileSync(buildGradlePath, "utf-8");
  const missing = envs.filter((env) => !new RegExp(`create\\("${env}"\\)`).test(gradle));
  if (missing.length === 0) return [];

  const blockStart = gradle.search(/productFlavors\s*\{/);
  if (blockStart === -1) throw new Error(`No productFlavors block found in ${buildGradlePath}`);
  const open = gradle.indexOf("{", blockStart);
  const close = matchingBrace(gradle, open);
  if (close === -1) throw new Error(`Unbalanced productFlavors block in ${buildGradlePath}`);

  const flavors = missing
    .map((env) =>
      [
        `        create("${env}") {`,
        `            dimension = "environment"`,
        `            // WEFTER-ENV-CONFIG-START`,
        ``,
        `            // WEFTER-ENV-CONFIG-END`,
        `        }`,
      ].join("\n"),
    )
    .join("\n");
  const before = gradle.slice(0, close).replace(/\s*$/, "\n");
  gradle = `${before}${flavors}\n    ${gradle.slice(close)}`;
  writeFileSync(buildGradlePath, gradle);
  return missing;
}

/** A stable 24-character Xcode object id for one part of an environment's setup. */
export function xcodeObjectId(env: string, role: string): string {
  return createHash("sha1").update(`wefter-env:${env}:${role}`).digest("hex").slice(0, 24).toUpperCase();
}

/** The `.xcconfig` files of an environment, as the templates write them for development and production. */
function writeEnvironmentXcconfigs(configDir: string, env: string): void {
  const files: Record<string, string> = {
    [`Environment-${env}.xcconfig`]: [
      "// WEFTER-ENV-CONFIG-START",
      "// WEFTER-ENV-CONFIG-END",
      "// WEFTER-DEEPLINKS-START",
      "// WEFTER-DEEPLINKS-END",
      "",
    ].join("\n"),
    [`Debug-${capitalize(env)}.xcconfig`]: `#include "Debug.xcconfig"\n#include "Environment-${env}.xcconfig"\n`,
    [`Release-${capitalize(env)}.xcconfig`]: `#include "Release.xcconfig"\n#include "Environment-${env}.xcconfig"\n`,
  };
  for (const [name, contents] of Object.entries(files)) {
    const path = join(configDir, name);
    if (!existsSync(path)) writeFileSync(path, contents);
  }
}

/**
 * Adds `Debug-<Env>` and `Release-<Env>` build configurations to the Xcode project for each environment it
 * does not have yet, copied from the `Production` ones, with their `.xcconfig` files in `Config/`.
 *
 * @returns The environments added.
 * @throws {Error} When the project has no Production configurations to copy.
 */
export function ensureIosConfigurations(pbxprojPath: string, configDir: string, envs: string[]): string[] {
  let pbx = readFileSync(pbxprojPath, "utf-8");
  const missing = envs.filter((env) => !pbx.includes(`name = "Release-${capitalize(env)}";`));
  for (const env of missing) {
    const Env = capitalize(env);
    writeEnvironmentXcconfigs(configDir, env);

    const fileRefs: Record<string, string> = {
      environment: `Environment-${env}.xcconfig`,
      Debug: `Debug-${Env}.xcconfig`,
      Release: `Release-${Env}.xcconfig`,
    };
    const fileRefIds = Object.fromEntries(
      Object.keys(fileRefs).map((role) => [role, xcodeObjectId(env, `file:${role}`)]),
    );

    const fileRefLines = Object.entries(fileRefs)
      .map(
        ([role, name]) =>
          `\t\t${fileRefIds[role]} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = "${name}"; sourceTree = "<group>"; };\n`,
      )
      .join("");
    pbx = pbx.replace("/* End PBXFileReference section */", `${fileRefLines}/* End PBXFileReference section */`);

    const groupEntry = /^([ \t]*)[0-9A-F]{24} \/\* Release-Production\.xcconfig \*\/,\n/m.exec(pbx);
    if (groupEntry) {
      const indent = groupEntry[1];
      const added = Object.entries(fileRefs)
        .map(([role, name]) => `${indent}${fileRefIds[role]} /* ${name} */,\n`)
        .join("");
      pbx = pbx.replace(groupEntry[0], `${groupEntry[0]}${added}`);
    }

    const blocks = [
      ...pbx.matchAll(/\t\t([0-9A-F]{24}) \/\* (Debug|Release)-Production \*\/ = \{\n[\s\S]*?\n\t\t\};\n/g),
    ];
    if (blocks.length === 0)
      throw new Error(`No Production build configurations found in ${pbxprojPath} to copy for "${env}"`);

    let newBlocks = "";
    for (const [block, id, buildType] of blocks) {
      const level = block.includes("baseConfigurationReference") ? "target" : "project";
      const newId = xcodeObjectId(env, `config:${level}:${buildType}`);
      let copy = block
        .replace(`${id} /* ${buildType}-Production */`, `${newId} /* ${buildType}-${Env} */`)
        .replace(`name = "${buildType}-Production";`, `name = "${buildType}-${Env}";`);
      copy = copy.replace(
        /baseConfigurationReference = [0-9A-F]{24} \/\* [^*]+ \*\//,
        `baseConfigurationReference = ${fileRefIds[buildType]} /* ${fileRefs[buildType]} */`,
      );
      newBlocks += copy;
      pbx = pbx.replace(
        new RegExp(`(\\t+)${id} /\\* ${buildType}-Production \\*/,\\n`),
        (line, indent: string) => `${line}${indent}${newId} /* ${buildType}-${Env} */,\n`,
      );
    }
    pbx = pbx.replace("/* End XCBuildConfiguration section */", `${newBlocks}/* End XCBuildConfiguration section */`);
  }
  if (missing.length > 0) writeFileSync(pbxprojPath, pbx);
  return missing;
}
