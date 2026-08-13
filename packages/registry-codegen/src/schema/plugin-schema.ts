import { z } from "zod";

const IntentFilterDataSchema = z.object({
  scheme: z.string().optional(),
  host: z.string().optional(),
  path: z.string().optional(),
  pathPrefix: z.string().optional(),
  pathPattern: z.string().optional(),
  mimeType: z.string().optional(),
});

const IntentFilterSchema = z.object({
  action: z.string().min(1),
  categories: z.array(z.string()).default([]),
  data: IntentFilterDataSchema.optional(),
});

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

export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;
export type IntentFilter = z.infer<typeof IntentFilterSchema>;
export type IntentFilterData = z.infer<typeof IntentFilterDataSchema>;

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

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
