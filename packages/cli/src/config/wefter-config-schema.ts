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

/** The message iOS shows when asking for a permission, such as "Used to scan receipts". */
const UsageDescriptionSchema = z.string().trim().min(1, "must be the message shown when asking for the permission");

/**
 * Device access the web app itself uses through standard web APIs: `camera` (`getUserMedia` video and
 * taking photos from `<input type="file">`), `microphone` (`getUserMedia` audio) and `location`
 * (`navigator.geolocation`). Each value is the message iOS shows when asking; Android asks with its own
 * wording. Plugins declare their own permissions and do not need these.
 */
const PermissionsSchema = z
  .object({
    camera: UsageDescriptionSchema.optional(),
    microphone: UsageDescriptionSchema.optional(),
    location: UsageDescriptionSchema.optional(),
  })
  .strict();

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
 * Names Gradle reserves for its own source sets and build types, which an environment (a product flavor)
 * cannot use.
 */
const RESERVED_ENVIRONMENT_NAMES = new Set(["main", "test", "androidTest", "testFixtures", "debug", "release"]);

/**
 * An environment name, such as `staging`. It becomes an Android product flavor and an Xcode build
 * configuration (`Release-Staging`), so it starts with a lower-case letter and uses only letters and digits.
 */
const EnvironmentNameSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*$/, "must start with a lower-case letter and use only letters and digits")
  .refine((name) => !RESERVED_ENVIRONMENT_NAMES.has(name), {
    message: "is reserved by Gradle (main, test, androidTest, testFixtures, debug and release are taken)",
  });

/** The app version shown in the stores, such as `1.4.0`: three whole numbers, as the App Store requires. */
export const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** Highest build number Google Play accepts as a `versionCode`. */
export const MAX_BUILD_NUMBER = 2_100_000_000;

/** Android output formats: an APK to install directly, an App Bundle for Google Play, or both. */
export const ANDROID_FORMATS = ["apk", "aab", "both"] as const;
export type AndroidFormat = (typeof ANDROID_FORMATS)[number];

/**
 * How an iOS release is exported, with Xcode's current names. The older names (`app-store`, `ad-hoc`,
 * `development`) are accepted and mapped to these.
 */
export const IOS_EXPORT_METHODS = ["app-store-connect", "release-testing", "enterprise", "debugging"] as const;
export type IosExportMethod = (typeof IOS_EXPORT_METHODS)[number];

/** Older export method names and the current names they map to. */
export const LEGACY_IOS_EXPORT_METHODS: Record<string, IosExportMethod> = {
  "app-store": "app-store-connect",
  "ad-hoc": "release-testing",
  development: "debugging",
};

/** An export method in either the current or the older naming, normalised to the current one. */
const IosExportMethodSchema = z
  .string()
  .transform((value) => LEGACY_IOS_EXPORT_METHODS[value] ?? value)
  .pipe(z.enum(IOS_EXPORT_METHODS));

/**
 * Build settings.
 *
 * - `output`: folder the built files are copied to, relative to the project (default `build`).
 * - `android.format`: what a build produces; release builds default to `both`, debug builds to `apk`.
 * - `ios.exportMethod`: how a release `.ipa` is exported (default `app-store-connect`).
 * - `ios.usesNonExemptEncryption`: written to `Info.plist` as `ITSAppUsesNonExemptEncryption`, so App Store
 *   Connect stops asking about encryption on every upload. `false` for apps that only use HTTPS.
 */
const BuildSchema = z.object({
  output: z.string().min(1).default("build"),
  android: z
    .object({
      format: z.enum(ANDROID_FORMATS).optional(),
    })
    .default({}),
  ios: z
    .object({
      exportMethod: IosExportMethodSchema.default("app-store-connect"),
      usesNonExemptEncryption: z.boolean().optional(),
    })
    .default({ exportMethod: "app-store-connect" }),
});

/**
 * Android release signing. Any value may be written as `${VAR}` to read it from the environment (`.env` is
 * loaded); the `WEFTER_KEYSTORE_PATH`, `WEFTER_KEY_ALIAS`, `WEFTER_KEYSTORE_PASSWORD` and
 * `WEFTER_KEY_PASSWORD` variables take precedence over the config. `keyPassword` falls back to
 * `storePassword`.
 */
const AndroidSigningSchema = z.object({
  keystorePath: z.string(),
  keyAlias: z.string(),
  storePassword: z.string().optional(),
  keyPassword: z.string().optional(),
});

/**
 * iOS release signing. `provisioningProfile` (with `signingIdentity`) switches to manual signing;
 * `appStoreConnect` is an App Store Connect API key, which lets automatic signing create certificates and
 * profiles on a CI machine. Any value may be written as `${VAR}`; the `WEFTER_IOS_*` and `WEFTER_ASC_*`
 * variables take precedence over the config.
 */
const IosSigningSchema = z.object({
  teamId: z.string(),
  provisioningProfile: z.string().optional(),
  signingIdentity: z.string().optional(),
  appStoreConnect: z
    .object({
      keyPath: z.string(),
      keyId: z.string(),
      issuerId: z.string(),
    })
    .optional(),
});

/** Release signing for each platform. Either may be left out. */
const SigningSchema = z.object({
  android: AndroidSigningSchema.optional(),
  ios: IosSigningSchema.optional(),
});

/**
 * Moves settings written in an older shape to the current one, so existing projects keep working:
 * `signing: { keystorePath, keyAlias }` becomes `signing.android`, and `iosSigning` becomes `signing.ios`.
 * See {@link legacyConfigNotes} for the messages telling the developer to update.
 */
export function migrateLegacyConfig(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const config = { ...(raw as Record<string, unknown>) };
  const signing = config.signing;

  if (signing && typeof signing === "object" && ("keystorePath" in signing || "keyAlias" in signing)) {
    config.signing = { android: signing };
  }

  if (config.iosSigning !== undefined) {
    const current = (config.signing ?? {}) as Record<string, unknown>;
    if (current.ios === undefined) config.signing = { ...current, ios: config.iosSigning };
    delete config.iosSigning;
  }

  return config;
}

/** Messages for each setting written in an older shape, telling the developer what to change. */
export function legacyConfigNotes(raw: unknown): string[] {
  if (raw === null || typeof raw !== "object") return [];
  const config = raw as Record<string, unknown>;
  const notes: string[] = [];
  const signing = config.signing;
  if (signing && typeof signing === "object" && ("keystorePath" in signing || "keyAlias" in signing)) {
    notes.push('"signing": { keystorePath, keyAlias } has moved to "signing": { "android": { … } }');
  }
  if (config.iosSigning !== undefined) {
    notes.push('"iosSigning" has moved to "signing": { "ios": { … } }');
  }
  return notes;
}

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
 * - `permissions`: camera, microphone and location used by the web app itself, with the iOS messages.
 * - `version`, `buildNumber`: the app version (`1.4.0`) and build number (`42`) the stores see.
 * - `build`: output folder, Android format and iOS export settings.
 * - `signing`: release signing, `android` and `ios`.
 *
 * Settings in an older shape are moved to the current one first; see {@link migrateLegacyConfig}.
 */
export const WefterConfigSchema = z.preprocess(
  migrateLegacyConfig,
  z.object({
    plugins: z.array(z.string()).default([]),
    pluginsDir: z.string().default("node_modules"),
    webDir: z.string().default("dist"),
    pluginConfig: z.record(z.string(), z.string()).default({}),
    environments: z.record(EnvironmentNameSchema, EnvironmentSchema).default({
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

    permissions: PermissionsSchema.optional(),

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
    version: z.string().regex(APP_VERSION_PATTERN, "must be three numbers such as 1.4.0").optional(),
    buildNumber: z.number().int().min(1).max(MAX_BUILD_NUMBER).optional(),

    build: BuildSchema.default({ output: "build", android: {}, ios: { exportMethod: "app-store-connect" } }),

    signing: SigningSchema.optional(),
  }),
);

/** A parsed `wefter.config.json`, with defaults applied. */
export type WefterConfig = z.infer<typeof WefterConfigSchema>;

/** The `permissions` the web app uses, as written in the config. */
export type AppPermissionsConfig = z.infer<typeof PermissionsSchema>;

/** Android signing settings as written in the config. */
export type AndroidSigningConfig = z.infer<typeof AndroidSigningSchema>;

/** iOS signing settings as written in the config. */
export type IosSigningConfig = z.infer<typeof IosSigningSchema>;
