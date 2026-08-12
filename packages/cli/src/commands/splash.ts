import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const EXAMPLE_INDEX_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <div class="mark"></div>
</body>
</html>
`;

const EXAMPLE_STYLES_CSS = `body {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: #0F766E;
}
.mark {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: #ffffff;
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(0.92); }
}
`;

export function splashGenerate(projectDir: string, targetPath = "splash"): string {
  const dest = resolve(projectDir, targetPath);
  if (existsSync(dest)) {
    throw new Error(`${dest} already exists — remove it first or choose a different path.`);
  }
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "index.html"), EXAMPLE_INDEX_HTML);
  writeFileSync(join(dest, "styles.css"), EXAMPLE_STYLES_CSS);
  return dest;
}
