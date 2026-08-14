import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function toPascalCase(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

export function createPlugin(targetDir: string, name: string): string {
  const pascalName = toPascalCase(name);
  const dir = join(targetDir, name);
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "android"), { recursive: true });
  mkdirSync(join(dir, "ios"), { recursive: true });

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: `@yourorg/${name}`,
        version: "0.0.1",
        type: "module",
        main: "dist/index.js",
        types: "dist/index.d.ts",
        dependencies: {
          "@wefterjs/core": "^0.0.1",
        },
      },
      null,
      2,
    ) + "\n",
  );

  writeFileSync(
    join(dir, "plugin.json"),
    JSON.stringify(
      {
        name,
        permissions: { android: [], ios: {} },
        methods: [],
        hooks: [],
        events: [],
      },
      null,
      2,
    ) + "\n",
  );

  writeFileSync(
    join(dir, "src/index.ts"),
    `import { invokeNative } from "@wefterjs/core";

export const ${pascalName} = {
  // example(payload: {}): Promise<unknown> {
  //   return invokeNative("${name}", "example", payload);
  // },
};
`,
  );

  writeFileSync(
    join(dir, `android/${pascalName}Plugin.kt`),
    `package dev.wefter.bridge

import android.content.Context
import org.json.JSONObject

class ${pascalName}Plugin(context: Context, dispatcher: BridgeDispatcher) : WefterPlugin(context, dispatcher) {
    @WefterMethod
    fun example(payload: JSONObject, callback: (Result<Any>) -> Unit) {
        resolve(callback, JSONObject().put("ok", true))
    }
}
`,
  );

  writeFileSync(
    join(dir, `ios/${pascalName}Plugin.swift`),
    `import Foundation

// Never force-unwrap (!) or directly subscript a dictionary/array in here — Swift traps
// (force-unwrap, out-of-bounds) crash the whole app and can't be caught the way a thrown
// WefterError can. Use guard let / optional chaining / safe subscripting throughout.
final class ${pascalName}Plugin: WefterPlugin {
    // @WefterMethod
    func example(payload: [String: Any], callback: @escaping (Result<Any, Error>) -> Void) throws {
        resolve(callback, data: ["ok": true])
    }
}
`,
  );

  writeFileSync(
    join(dir, "README.md"),
    `# ${name}

A Wefter plugin.

See: https://wefter.dev/plugins/writing-a-plugin
`,
  );

  return dir;
}
