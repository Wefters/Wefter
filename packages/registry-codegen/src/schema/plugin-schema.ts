import { z } from 'zod';

export const PluginManifestSchema = z.object({
  name: z.string().min(1),
  permissions: z.object({
    android: z.array(z.string()).default([]),
    
    
    
    
    ios: z.record(z.string(), z.string()).default({}),
  }).default({ android: [], ios: {} }),
  nativeDependencies: z.object({
    android: z.object({
      gradle: z.string().optional(),
      proguardRules: z.string().optional(),
    }).optional(),
    ios: z.object({
      spm: z.array(z.object({
        url: z.string(),
        from: z.string(),
        product: z.string(),
      })).optional(),
    }).optional(),
  }).default({}),
  methods: z.array(z.string()).default([]),
  hooks: z.array(z.string()).default([]),
  events: z.array(z.string()).default([]),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;