// 의존성 로더

export let extension_settings;
export let saveSettingsDebounced;

export const EXT_BIND_KEY = "autobgm_binding";

export async function __abgmResolveDeps() {
  const base = import.meta.url;

  const tryImport = async (rel) => {
    try {
      return await import(new URL(rel, base));
    } catch (e) {
      return null;
    }
  };

const extMod =
  // third-party 레이아웃: /scripts/extensions/third-party/<ext>/modules/deps.js
  (await tryImport("../../../../extensions.js")) ||
  // 일반 레이아웃: /scripts/extensions/<ext>/modules/deps.js
  (await tryImport("../../../extensions.js")) ||
  // (구버전/예외 fallback)
  (await tryImport("../../extensions.js"));

  if (!extMod?.extension_settings) {
    throw new Error("[AutoBGM] Failed to import extension_settings (extensions.js path mismatch)");
  }
  extension_settings = extMod.extension_settings;

  const scriptMod =
    // third-party 레이아웃이면 deps.js 기준 5단계 위
    (await tryImport("../../../../../script.js")) ||
    // 일반 레이아웃이면 deps.js 기준 4단계 위
    (await tryImport("../../../../script.js")) ||
    // (구버전/예외 fallback)
    (await tryImport("../../../script.js"));

  if (!scriptMod?.saveSettingsDebounced) {
    throw new Error("[AutoBGM] Failed to import saveSettingsDebounced (script.js path mismatch)");
  }
  saveSettingsDebounced = scriptMod.saveSettingsDebounced;
}

export function getSTContextSafe() {
  try {
    if (window.SillyTavern?.getContext) return window.SillyTavern.getContext();
  } catch {}
  try {
    if (typeof getContext === "function") return getContext();
  } catch {}
  return null;
}

export function getBoundPresetIdFromContext(ctx) {
  try {
    const cid = ctx?.characterId;
    const chars = ctx?.characters;
    if (cid === undefined || cid === null) return "";
    const ch = chars?.[cid];
    const pid = ch?.data?.extensions?.[EXT_BIND_KEY]?.presetId;
    return pid ? String(pid) : "";
  } catch {
    return "";
  }
}
