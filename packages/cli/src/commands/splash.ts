import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const EXAMPLE_SPLASH_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; display: flex; align-items: center; justify-content: center;
           height: 100vh; background: #0F766E; }
    img { width: 96px; height: 96px; animation: pulse 1.2s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
  </style>
</head>
<body>
  <!-- Replace this with your own artwork/animation. -->
  <img src="./icon.png" alt="">
</body>
</html>
`;

export function splashGenerate(projectDir: string, targetPath = "splash.html"): string {
  const dest = resolve(projectDir, targetPath);
  if (existsSync(dest)) {
    throw new Error(`${dest} already exists — remove it first or choose a different path.`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, EXAMPLE_SPLASH_HTML);
  return dest;
}
