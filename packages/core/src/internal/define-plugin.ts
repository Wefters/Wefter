import { invokeNative } from "./native-bridge.js";

type AnyMethods = Record<string, (payload: any) => Promise<any>>;

type DefinedPlugin<Methods extends AnyMethods> = {
  [K in keyof Methods]: undefined extends Parameters<Methods[K]>[0]
    ? (payload?: Parameters<Methods[K]>[0]) => ReturnType<Methods[K]>
    : (payload: Parameters<Methods[K]>[0]) => ReturnType<Methods[K]>;
};

export function definePlugin<Methods extends AnyMethods>(
  pluginName: string,
  methodSignatures: { [K in keyof Methods]: true }
): DefinedPlugin<Methods> {
  const result = {} as DefinedPlugin<Methods>;
  for (const methodName of Object.keys(methodSignatures) as (keyof Methods)[]) {
    (result[methodName] as (payload?: unknown) => Promise<unknown>) = (payload?: unknown) =>
      invokeNative(pluginName, methodName as string, payload);
  }
  return result;
}
