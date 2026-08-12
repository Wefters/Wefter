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
      z
        .object({
          source: z.string(),
          minDuration: z.number().min(0).max(20000).default(0),
          maxDuration: z.number().min(0).max(20000).default(5000),
          dismissOn: z.enum(["ready", "timer"]).default("ready"),
          transition: z.enum(["fade", "none"]).default("fade"),
        })
        .refine((s) => s.minDuration <= s.maxDuration, {
          message: "splash.minDuration must not be greater than splash.maxDuration",
          path: ["minDuration"],
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
