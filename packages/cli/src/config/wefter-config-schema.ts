import { z } from "zod";

const EnvironmentSchema = z.object({
  appId: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/,
      "Invalid Android application ID",
    ),
  appName: z.string(),
  
  
  
  iosBundleId: z.string().optional(),
});

export const WefterConfigSchema = z.object({
  plugins: z.array(z.string()).default([]),
  pluginsDir: z.string().default("node_modules"),
  webDir: z.string().default("dist"),
  environments: z
    .record(z.string(), EnvironmentSchema)
    .default({
      development: { appId: "dev.wefter.bridge.dev", appName: "Wefter (Dev)" },
    }),
  icon: z.string().optional(),
  
  splash: z
    .union([
      z.literal(false),
      z.object({
        html: z.string(),
        minDurationMs: z.number().min(0).max(5000).default(600),
        fadeOutDurationMs: z.number().min(0).max(1000).default(300),
      }),
    ])
    .optional(),
  signing: z
    .object({
      keystorePath: z.string(),
      keyAlias: z.string(),
    })
    .optional(),
  
  
  iosSigning: z
    .object({
      teamId: z.string(),
      provisioningProfile: z.string().optional(),
    })
    .optional(),
});

export type WefterConfig = z.infer<typeof WefterConfigSchema>;
