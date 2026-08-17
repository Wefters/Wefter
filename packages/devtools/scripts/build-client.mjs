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
