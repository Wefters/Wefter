import { z } from "zod";

/**
 * Schemes a deep link may not use: web and system schemes, the iOS shell's own asset scheme (`app`), and
 * `wefter`, which every Wefter app would otherwise share.
 */
const RESERVED_DEEP_LINK_SCHEMES = new Set([
  "http",
  "https",
  "file",
  "content",
  "data",
  "about",
  "javascript",
  "intent",
  "app",
  "wefter",
]);

/**
 * A custom URL scheme the app opens for, such as `myshop` for `myshop://product/42`. Lower case, so browsers
 * and both platforms match it the same way; `.auth` endings are kept for the Browser plugin's sign-in
 * redirects (`<app id>.auth`).
 */
const DeepLinkSchemeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9+.-]*$/, "must be lower case, start with a letter and use only a-z, 0-9, +, . and -")
  .refine((scheme) => !RESERVED_DEEP_LINK_SCHEMES.has(scheme), {
    message: "is reserved; choose a scheme of your own, such as your app's name",
  })
  .refine((scheme) => !scheme.endsWith(".auth"), {
    message: "ends in .auth, which is kept for sign-in redirects (<app id>.auth)",
  });

/** A web domain whose `https` links open the app, such as `shop.example.com`: a lower-case host name only. */
const DeepLinkDomainSchema = z
  .string()
  .regex(
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    "must be a lower-case host name such as shop.example.com, without https://, a path or a port",
  );

/**
 * A path of the verified domains that opens the app: an exact path (`/about`) or a prefix ending in `*`
 * (`/product/*`). `*` alone means every path. Both platforms support exactly these two forms.
 */
const DeepLinkPathSchema = z
  .string()
  .regex(/^(\*|\/[^*?#\s]*\*?)$/, 'must be "*", an exact path such as /about, or a prefix such as /product/*');

/** A list that may not name the same value twice. */
function uniqueList<T extends z.ZodTypeAny>(item: T) {
  return z.array(item).refine((values) => new Set(values).size === values.length, {
    message: "must not list a value twice",
  });
}

/**
 * Deep link settings.
 *
 * - `schemes`: custom URL schemes (`myshop://…`).
 * - `domains`: web domains whose `https` links open the app once verified (Android App Links, iOS Universal
 *   Links). Each domain must serve the files from `wefter deep-links files`.
 * - `paths`: which paths of those domains open the app; every path when left out.
 *
 * Set at the top level they apply to every environment; set in an environment, each field given replaces
 * the top-level one for that environment.
 */
const DeepLinksSchema = z.object({
  schemes: uniqueList(DeepLinkSchemeSchema).optional(),
  domains: uniqueList(DeepLinkDomainSchema).optional(),
  paths: uniqueList(DeepLinkPathSchema).optional(),
});

/**
 * Keyboard settings.
 *
 * - `accessoryBar`: shows the bar iOS puts above the keyboard in web forms (previous, next and Done). Off by
 *   default, as in native apps. Android has no such bar.
 */
const KeyboardSchema = z.object({
  accessoryBar: z.boolean().optional(),
});

/**
 * One build environment, such as `development` or `production`. Each is installed as a separate app, and
 * may override the top-level `deepLinks` (for example a `myshop-dev` scheme for development builds).
 */
const EnvironmentSchema = z.object({
  appId: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "Invalid Android application ID"),
  appName: z.string(),

  iosBundleId: z.string().optional(),
  deepLinks: DeepLinksSchema.optional(),
});

/**
 * Schema of `wefter.config.json`.
 *
 * - `plugins`: package names of the plugins to include.
 * - `pluginsDir`: where those packages are installed.
 * - `webDir`: the web app's build output.
 * - `pluginConfig`: values for `${key}` placeholders in plugin manifests.
 * - `environments`: app id, name, optional iOS bundle id and deep link overrides per environment.
 * - `icon`, `launchBackground`, `splash`, `landscape`: app look and orientation.
 * - `deepLinks`: custom URL schemes and verified web domains the app opens for.
 * - `keyboard`: keyboard behaviour in the web view.
 * - `signing`, `iosSigning`: release signing for Android and iOS.
 */
export const WefterConfigSchema = z.object({
  plugins: z.array(z.string()).default([]),
  pluginsDir: z.string().default("node_modules"),
  webDir: z.string().default("dist"),
  pluginConfig: z.record(z.string(), z.string()).default({}),
  environments: z.record(z.string(), EnvironmentSchema).default({
    development: { appId: "dev.wefter.bridge.dev", appName: "Wefter (Dev)" },
  }),
  icon: z.string().optional(),
  launchBackground: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "launchBackground must be a 6-digit hex color, e.g. #14161C")
    .optional(),

  landscape: z.boolean().optional(),

  deepLinks: DeepLinksSchema.optional(),

  keyboard: KeyboardSchema.optional(),

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

/** A parsed `wefter.config.json`, with defaults applied. */
export type WefterConfig = z.infer<typeof WefterConfigSchema>;
