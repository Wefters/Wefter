import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkWebBuild, webBuildWarnings } from "../src/app-build/web-checks.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function webDir(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "wefter-web-checks-"));
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), contents);
  }
  return dir;
}

describe("checkWebBuild", () => {
  it("finds nothing in a clean build, even with SVG namespaces and https API calls", () => {
    const findings = checkWebBuild(
      webDir({
        "index.html":
          '<link rel="stylesheet" href="/assets/index.css"><script type="module" src="/assets/index.js"></script>',
        "assets/index.js":
          'const ns="http://www.w3.org/2000/svg"; fetch("https://api.example.com/items"); const base = location.href || "http://localhost";',
        "assets/index.css": "@font-face{src:url(/assets/inter.woff2)}",
      }),
    );
    expect(findings).toEqual({ indexHtmlMissing: false, sourceMaps: [], devAddresses: [], blockedResources: [] });
  });

  it("reports a missing index.html", () => {
    expect(checkWebBuild(webDir({ "app.js": "" })).indexHtmlMissing).toBe(true);
  });

  it("finds source maps, development addresses and outside stylesheets, scripts and fonts", () => {
    const findings = checkWebBuild(
      webDir({
        "index.html":
          '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">' +
          '<script src="https://cdn.example.com/lib.js"></script>',
        "assets/index.js": 'const API = "http://localhost:3000/api"; const LAN = "http://192.168.1.20:5173";',
        "assets/index.js.map": "{}",
        "assets/index.css":
          '@import url("https://cdn.example.com/theme.css"); @font-face{src:url(https://fonts.gstatic.com/a.woff2)}',
      }),
    );

    expect(findings.sourceMaps).toEqual([join("assets", "index.js.map")]);
    expect(findings.devAddresses.map((d) => d.address).sort()).toEqual([
      "http://192.168.1.20:5173",
      "http://localhost:3000/api",
    ]);
    expect(findings.blockedResources.map((r) => r.type).sort()).toEqual(["font", "script", "stylesheet", "stylesheet"]);

    const warnings = webBuildWarnings(findings, "dist");
    expect(warnings).toHaveLength(3);
    expect(warnings[2]).toContain("fonts.googleapis.com");
  });
});
