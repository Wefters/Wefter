/**
 * Builds the publishable CLI package.
 *
 * - Bundles `cli.ts` and `index.ts` with esbuild, then removes the per-file JS that `tsc` emitted.
 * - Vendors the registry-codegen type declarations and points imports at them.
 * - Copies the native shell templates into `dist/shells`, without build output.
 */

import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const registryCodegenDistDir = join(rootDir, "../registry-codegen/dist");
const vendoredTypesDir = join(rootDir, "dist/internal/registry-codegen");

const external = ["chalk", "commander", "dotenv", "sharp", "zod"];

for (const entry of ["cli", "index"]) {
  await build({
    entryPoints: [join(rootDir, `src/${entry}.ts`)],
    outfile: join(rootDir, `dist/${entry}.js`),
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: true,
    external,
  });
}

/** Deletes compiled `.js` files under `dir`, keeping the bundles, shells and vendored files at the root. */
function pruneCompiledJs(dir, isRoot) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (
      isRoot &&
      (name === "cli.js" ||
        name === "cli.js.map" ||
        name === "index.js" ||
        name === "index.js.map" ||
        name === "shells" ||
        name === "internal")
    ) {
      continue;
    }
    if (statSync(path).isDirectory()) {
      pruneCompiledJs(path, false);
    } else if (name.endsWith(".js") || name.endsWith(".js.map")) {
      rmSync(path);
    }
  }
}
pruneCompiledJs(join(rootDir, "dist"), true);

/** Copies the `.d.ts` files of `srcDir` into `destDir`. */
function copyDtsTree(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    const srcPath = join(srcDir, name);
    if (statSync(srcPath).isDirectory()) {
      copyDtsTree(srcPath, join(destDir, name));
    } else if (name.endsWith(".d.ts")) {
      writeFileSync(join(destDir, name), readFileSync(srcPath, "utf-8"));
    }
  }
}
copyDtsTree(registryCodegenDistDir, vendoredTypesDir);

/** Copies the Android and iOS templates into the package, skipping build and IDE folders. */
function copyShellTemplates() {
  const repoShellsDir = join(rootDir, "../../shells");
  const distShellsDir = join(rootDir, "dist/shells");
  if (existsSync(repoShellsDir)) {
    mkdirSync(distShellsDir, { recursive: true });
    for (const shell of ["android-template", "ios-template"]) {
      const src = join(repoShellsDir, shell);
      const dest = join(distShellsDir, shell);
      if (existsSync(src)) {
        rmSync(dest, { recursive: true, force: true });
        cpSync(src, dest, {
          recursive: true,
          filter: (f) => !/[\\/](build|\.gradle|\.wefter|\.idea|\.DS_Store)([\\/]|$)/.test(f),
        });
      }
    }
  }
}
copyShellTemplates();

/** Points `@wefterjs/registry-codegen` imports in declarations at the vendored copy. */
function rewriteVendoredImports(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      rewriteVendoredImports(path);
      continue;
    }
    if (!name.endsWith(".d.ts")) continue;
    const contents = readFileSync(path, "utf-8");
    if (!contents.includes("@wefterjs/registry-codegen")) continue;
    let vendoredEntry = relative(dirname(path), join(vendoredTypesDir, "index.js"));
    if (!vendoredEntry.startsWith(".")) vendoredEntry = `./${vendoredEntry}`;
    writeFileSync(path, contents.replaceAll("@wefterjs/registry-codegen", vendoredEntry));
  }
}
rewriteVendoredImports(join(rootDir, "dist"));
