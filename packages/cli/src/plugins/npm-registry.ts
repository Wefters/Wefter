const NPM_REGISTRY = "https://registry.npmjs.org";

export interface NpmPackageInfo {
  name: string;
  version: string;
  description?: string;
}

export async function fetchNpmPackageInfo(spec: string): Promise<NpmPackageInfo> {
  const atIdx = spec.lastIndexOf("@");
  let pkgName: string;
  let versionOrTag: string | undefined;

  if (atIdx > 0) {
    pkgName = spec.slice(0, atIdx);
    versionOrTag = spec.slice(atIdx + 1) || undefined;
  } else {
    pkgName = spec;
    versionOrTag = undefined;
  }

  const encodedName = pkgName.replace("/", "%2F");
  const url = versionOrTag
    ? `${NPM_REGISTRY}/${encodedName}/${encodeURIComponent(versionOrTag)}`
    : `${NPM_REGISTRY}/${encodedName}/latest`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Package "${spec}" was not found on the npm registry.`);
    }
    throw new Error(`npm registry returned HTTP ${res.status} for "${spec}".`);
  }

  const data = (await res.json()) as { name?: string; version?: string; description?: string };

  if (!data.name || !data.version) {
    throw new Error(`Unexpected registry response for "${spec}" — missing name or version field.`);
  }

  return {
    name: data.name,
    version: data.version,
    description: data.description,
  };
}
