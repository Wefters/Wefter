/** Minimum major versions of the tools Wefter needs, checked by `wefter doctor`. */
export const REQUIREMENTS = {
  jdk: { min: 17 },
  node: { min: 18 },
} as const;
