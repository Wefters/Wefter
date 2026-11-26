/** Schema of `plugin.json`, the manifest every Wefter plugin ships next to its `package.json`. */

import { z } from "zod";

/**
 * Attributes of an intent filter's `<data>` element. Values may contain `${key}` placeholders filled from
 * `pluginConfig`.
 */
const IntentFilterDataSchema = z.object({
  scheme: z.string().optional(),
  host: z.string().optional(),
  path: z.string().optional(),
  pathPrefix: z.string().optional(),
  pathPattern: z.string().optional(),
  mimeType: z.string().optional(),
});

/** An Android intent filter: one action, its categories and optional data. */
const IntentFilterSchema = z.object({
  action: z.string().min(1),
  categories: z.array(z.string()).default([]),
  data: IntentFilterDataSchema.optional(),
});

/**
 * An Android component a plugin adds to the app's manifest, such as an activity that receives an OAuth
 * redirect.
 */
const ManifestEntrySchema = z.object({
  type: z.enum(["activity"]),
  name: z
    .string()
    .min(1)
    .regex(/^\.[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        'must be a single-segment relative class reference starting with "." (e.g. ".BrowserAuthActivity"), resolved against the app\'s own namespace at build time — the same way the template\'s own ".MainActivity" entry already is. Wefter flattens every plugin\'s android/ source into one package, so a nested reference like ".auth.BrowserAuthActivity" can never resolve.',
    }),
  exported: z.boolean().default(false),
  intentFilters: z.array(IntentFilterSchema).default([]),
});

/** An Android component declared by a plugin. */
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;
/** An Android intent filter declared by a plugin. */
export type IntentFilter = z.infer<typeof IntentFilterSchema>;
/** The `<data>` attributes of an intent filter. */
export type IntentFilterData = z.infer<typeof IntentFilterDataSchema>;

/**
 * The whole `plugin.json`.
 *
 * - `name`: the bridge name, which also gives the native class name (see `classNameFor`).
 * - `permissions.android`: Android permissions to add to the manifest.
 * - `permissions.ios`: `Info.plist` usage descriptions, by key.
 * - `nativeDependencies`: Gradle coordinates, ProGuard rules and Swift packages the plugin needs.
 * - `android.manifestEntries`: components to add to the Android manifest.
 * - `methods`, `hooks`, `events`: what the plugin exposes; checked against its native source.
 */
export const PluginManifestSchema = z.object({
  name: z.string().min(1),
  permissions: z
    .object({
      android: z.array(z.string()).default([]),

      ios: z.record(z.string(), z.string()).default({}),
    })
    .default({ android: [], ios: {} }),
  nativeDependencies: z
    .object({
      android: z
        .object({
          gradle: z.array(z.string()).default([]),
          proguardRules: z.string().optional(),
        })
        .optional(),
      ios: z
        .object({
          spm: z
            .array(
              z.object({
                url: z.string(),
                from: z.string(),
                product: z.string(),
              }),
            )
            .optional(),
        })
        .optional(),
    })
    .default({}),
  android: z
    .object({
      manifestEntries: z.array(ManifestEntrySchema).default([]),
    })
    .default({ manifestEntries: [] }),
  methods: z.array(z.string()).default([]),
  hooks: z.array(z.string()).default([]),
  events: z.array(z.string()).default([]),
});

/** A parsed `plugin.json`. */
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
