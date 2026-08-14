"use strict";
(() => {
  var pending = new Map();
  var hooks = new Map();
  var callCounter = 0;
  window.__wefterNative = {
    resolve(callId, resultJson) {
      pending.get(callId)?.resolve(JSON.parse(resultJson));
      pending.delete(callId);
    },
    reject(callId, errorJson) {
      pending.get(callId)?.reject(JSON.parse(errorJson));
      pending.delete(callId);
    },
    emit(hookName, dataJson) {
      const data = JSON.parse(dataJson);
      hooks.get(hookName)?.forEach((cb) => cb(data));
    },
  };
  function invokeNative(plugin, method, payload = {}) {
    const callId = String(callCounter++);
    return new Promise((resolve, reject) => {
      pending.set(callId, { resolve, reject });
      if (window.AndroidBridge) {
        window.AndroidBridge.invoke(callId, plugin, method, JSON.stringify(payload));
      } else {
        reject(new Error("No native bridge available"));
      }
    });
  }
  function registerHook(hookName, callback) {
    if (!hooks.has(hookName)) hooks.set(hookName, new Set());
    hooks.get(hookName).add(callback);
    return { remove: () => hooks.get(hookName)?.delete(callback) };
  }

  window.Wefter = { invokeNative, registerHook };
})();
