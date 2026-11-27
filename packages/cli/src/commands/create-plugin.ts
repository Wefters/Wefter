/**
 * `wefter plugin create`: scaffolds a new plugin package with a TypeScript API, an Android and an iOS
 * implementation, and a `plugin.json`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** `my-plugin` → `MyPlugin`. */
function toPascalCase(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Creates the plugin in `<targetDir>/<name>`.
 *
 * @returns The new plugin's folder.
 */
export function createPlugin(targetDir: string, name: string): string {
  const pascalName = toPascalCase(name);
  const dir = join(targetDir, name);
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "android"), { recursive: true });
  mkdirSync(join(dir, "ios"), { recursive: true });
  mkdirSync(join(dir, "i18n"), { recursive: true });

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: `@yourorg/${name}`,
        version: "0.0.1",
        type: "module",
        main: "dist/index.js",
        types: "dist/index.d.ts",
        files: ["dist", "plugin.json", "android", "ios", "i18n", "README.md"],
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
        methods: ["example"],
        hooks: [],
        events: [],
      },
      null,
      2,
    ) + "\n",
  );

  writeFileSync(
    join(dir, "src/index.ts"),
    `import { definePlugin } from "@wefterjs/core";

/**
 * The ${pascalName} plugin. A plugin that needs a runtime permission (camera, location, …) also exposes
 * \`checkPermissions()\` and \`requestPermissions()\`, each resolving to \`{ <name>: "granted" | "prompt" |
 * "denied" | "limited" }\`.
 */
export const ${pascalName} = definePlugin<{
  /** Answers with a greeting in the user's language. */
  example: () => Promise<{ ok: boolean; message: string }>;
}>("${name}", { example: true });
`,
  );

  writeFileSync(
    join(dir, `android/${pascalName}Plugin.kt`),
    `package dev.wefter.bridge

import android.content.Context
import org.json.JSONObject

/**
 * Override onResume, onPause, onNewIntent and onDestroy to follow the app's lifecycle. Use
 * checkPermissions/requestPermissions for runtime permissions, launchForResult to start other screens, and
 * emit(name, data, hold = true) for events that must wait until the page listens.
 */
class ${pascalName}Plugin(context: Context, dispatcher: BridgeDispatcher) : WefterPlugin(context, dispatcher) {
    @WefterMethod
    fun example(payload: JSONObject, callback: (Result<Any>) -> Unit) {
        // Text users see comes from i18n/<language>.json, in their language.
        resolve(callback, JSONObject().put("ok", true).put("message", WefterText.get(context, "${name}.greeting")))
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
//
// Override appDidBecomeActive, handleOpenURL, handleNotificationResponse and the other WefterPlugin
// methods to follow the app's lifecycle. Report permissions with PermissionState, and use
// emit(_:_:hold: true) for events that must wait until the page listens.
final class ${pascalName}Plugin: WefterPlugin {
    // @WefterMethod
    func example(payload: [String: Any], callback: @escaping (Result<Any, Error>) -> Void) throws {
        // Text users see comes from i18n/<language>.json, in their language.
        resolve(callback, data: ["ok": true, "message": WefterText.get("${name}.greeting")])
    }
}
`,
  );

  writeFileSync(
    join(dir, "i18n/en.json"),
    JSON.stringify({ [`${name}.greeting`]: "Hello from ${pascalName}" }, null, 2) + "\n",
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
