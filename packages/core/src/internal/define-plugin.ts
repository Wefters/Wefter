import { invokeNative } from "./native-bridge.js";

/** Map of method names to their async signatures, as declared by a plugin's TypeScript API. */
type AnyMethods = Record<string, (payload: never) => Promise<unknown>>;

/**
 * The callable plugin object: one function per method. A method whose payload type accepts
 * `undefined` can be called without arguments.
 */
type DefinedPlugin<Methods extends AnyMethods> = {
  [K in keyof Methods]: undefined extends Parameters<Methods[K]>[0]
    ? (payload?: Parameters<Methods[K]>[0]) => ReturnType<Methods[K]>
    : (payload: Parameters<Methods[K]>[0]) => ReturnType<Methods[K]>;
};

/**
 * Builds the JavaScript API for a native plugin. Every listed method becomes a function that forwards
 * its payload to the native side through {@link invokeNative}.
 *
 * @param pluginName The name the native plugin is registered under.
 * @param methodSignatures The method names to expose (the values are only markers).
 * @returns An object with one async function per method.
 *
 * @example
 * const Clipboard = definePlugin<{ read(): Promise<{ text: string }> }>("Clipboard", { read: true });
 * const { text } = await Clipboard.read();
 */
export function definePlugin<Methods extends AnyMethods>(
  pluginName: string,
  methodSignatures: { [K in keyof Methods]: true },
): DefinedPlugin<Methods> {
  const result = {} as DefinedPlugin<Methods>;
  for (const methodName of Object.keys(methodSignatures) as (keyof Methods)[]) {
    (result[methodName] as (payload?: unknown) => Promise<unknown>) = (payload?: unknown) =>
      invokeNative(pluginName, methodName as string, payload);
  }
  return result;
}
