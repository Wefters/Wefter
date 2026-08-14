export interface ExtractedMethod {
  name: string;
  lineNumber: number;
}

export interface ExtractedHook {
  hookName: string;
  methodName: string;
  lineNumber: number;
}

function lineNumberAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

const METHOD_PATTERN_SOURCE = String.raw`@WefterMethod\s*\n\s*fun\s+(\w+)\s*\(\s*payload:\s*JSONObject\s*,\s*callback:\s*\(Result<Any>\)\s*->\s*Unit\s*\)`;

const METHOD_ANNOTATION_PATTERN = /@WefterMethod\s*\n\s*fun\s+\w+\s*\(/g;

export function extractWefterMethods(source: string): ExtractedMethod[] {
  const pattern = new RegExp(METHOD_PATTERN_SOURCE, "g");
  const results: ExtractedMethod[] = [];
  for (const match of source.matchAll(pattern)) {
    results.push({ name: match[1], lineNumber: lineNumberAt(source, match.index!) });
  }
  return results;
}

export function findMalformedWefterMethods(source: string): number[] {
  const strictPattern = new RegExp(`^${METHOD_PATTERN_SOURCE}`);
  const malformed: number[] = [];
  for (const match of source.matchAll(METHOD_ANNOTATION_PATTERN)) {
    const index = match.index!;
    if (!strictPattern.test(source.slice(index))) {
      malformed.push(lineNumberAt(source, index));
    }
  }
  return malformed;
}

const HOOK_PATTERN_SOURCE = String.raw`@WefterHook\("(\w+)"\)\s*\n\s*fun\s+(\w+)\s*\(\s*\)`;

const HOOK_ANNOTATION_PATTERN = /@WefterHook\([^)]*\)\s*\n\s*fun\s+\w+\s*\([^)]*\)/g;

export function extractWefterHooks(source: string): ExtractedHook[] {
  const pattern = new RegExp(HOOK_PATTERN_SOURCE, "g");
  const results: ExtractedHook[] = [];
  for (const match of source.matchAll(pattern)) {
    results.push({ hookName: match[1], methodName: match[2], lineNumber: lineNumberAt(source, match.index!) });
  }
  return results;
}

export function findMalformedWefterHooks(source: string): number[] {
  const strictPattern = new RegExp(`^${HOOK_PATTERN_SOURCE}`);
  const malformed: number[] = [];
  for (const match of source.matchAll(HOOK_ANNOTATION_PATTERN)) {
    const index = match.index!;
    if (!strictPattern.test(source.slice(index))) {
      malformed.push(lineNumberAt(source, index));
    }
  }
  return malformed;
}

const CLASS_DECLARATION_PATTERN = /\b(?:class|object)\s+(\w+)/g;

export function extractDeclaredClassNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(CLASS_DECLARATION_PATTERN)) {
    names.add(match[1]);
  }
  return [...names];
}
