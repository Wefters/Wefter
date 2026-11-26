import { describe, expect, it } from "vitest";
import { WefterConfigSchema } from "../src/config/wefter-config-schema.js";
import {
  androidPathAttribute,
  appleComponents,
  resolveDeepLinks,
  usesVerifiedDomains,
} from "../src/config/deep-links.js";

const environments = {
  development: { appId: "com.example.shop.dev", appName: "Shop Dev" },
  production: { appId: "com.example.shop", appName: "Shop" },
};

describe("resolveDeepLinks", () => {
  it("gives every environment the top-level settings", () => {
    const config = WefterConfigSchema.parse({
      environments,
      deepLinks: { schemes: ["myshop"], domains: ["shop.example.com"], paths: ["/product/*"] },
    });

    expect(resolveDeepLinks(config, "development")).toEqual({
      schemes: ["myshop"],
      domains: ["shop.example.com"],
      paths: ["/product/*"],
    });
  });

  it("lets an environment replace single fields and keep the rest", () => {
    const config = WefterConfigSchema.parse({
      environments: {
        ...environments,
        development: { ...environments.development, deepLinks: { schemes: ["myshop-dev"], domains: [] } },
      },
      deepLinks: { schemes: ["myshop"], domains: ["shop.example.com"], paths: ["/product/*"] },
    });

    expect(resolveDeepLinks(config, "development")).toEqual({
      schemes: ["myshop-dev"],
      domains: [],
      paths: ["/product/*"],
    });
    expect(resolveDeepLinks(config, "production").schemes).toEqual(["myshop"]);
    expect(usesVerifiedDomains(config)).toBe(true);
  });

  it("treats * as every path, and gives empty settings without deepLinks", () => {
    const config = WefterConfigSchema.parse({ environments, deepLinks: { paths: ["*"] } });
    expect(resolveDeepLinks(config, "production")).toEqual({ schemes: [], domains: [], paths: [] });
    expect(usesVerifiedDomains(config)).toBe(false);
  });
});

describe("path patterns", () => {
  it("maps a trailing * to an Android prefix and an exact path to path", () => {
    expect(androidPathAttribute("/product/*")).toEqual({ name: "pathPrefix", value: "/product/" });
    expect(androidPathAttribute("/about")).toEqual({ name: "path", value: "/about" });
  });

  it("uses the paths as Apple components, or * for every path", () => {
    expect(appleComponents(["/product/*"])).toEqual([{ "/": "/product/*" }]);
    expect(appleComponents([])).toEqual([{ "/": "*" }]);
  });
});

describe("WefterConfigSchema — deep link domains and paths", () => {
  it.each(["https://shop.example.com", "shop.example.com/x", "Shop.Example.com", "localhost", "shop.example.com:8443"])(
    "rejects the domain %s",
    (domain) => {
      expect(WefterConfigSchema.safeParse({ environments, deepLinks: { domains: [domain] } }).success).toBe(false);
    },
  );

  it.each(["product/*", "/pro*duct", "/a?b", "**"])("rejects the path %s", (path) => {
    expect(WefterConfigSchema.safeParse({ environments, deepLinks: { paths: [path] } }).success).toBe(false);
  });

  it("validates an environment's own deepLinks too", () => {
    const result = WefterConfigSchema.safeParse({
      environments: { development: { ...environments.development, deepLinks: { schemes: ["Bad"] } } },
    });
    expect(result.success).toBe(false);
  });
});
