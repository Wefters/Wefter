/**
 * Bundles the DevTools dashboard (`src/client/main.ts`) into `dist/client/bundle.js`. Stylesheets are
 * imported as text and injected at runtime, so the bundle is a single file the Vite plugin can serve.
 */

import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

mkdirSync(join(rootDir, "dist/client"), { recursive: true });

await build({
  entryPoints: [join(rootDir, "src/client/main.ts")],
  outfile: join(rootDir, "dist/client/bundle.js"),
  bundle: true,
  format: "esm",
  sourcemap: true,
  loader: { ".css": "text" },
});
