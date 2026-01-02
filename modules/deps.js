// 의존성 로더

export async function resolveDeps() {
  const base = import.meta.url;

  const tryImport = async (rel) => {
    try {
      return await import(new URL(rel, base));
    } catch {
      return null;
    }
  };

  const extMod =
    (await tryImport("./././extensions.js")) ||
    (await tryImport("././extensions.js"));

  if (!extMod?.extension_settings) {
    throw new Error("[AutoBGM] Failed to import extension_settings (extensions.js path mismatch)");
  }

  const scriptMod =
    (await tryImport("././././script.js")) ||
    (await tryImport("./././script.js"));

  if (!scriptMod?.saveSettingsDebounced) {
    throw new Error("[AutoBGM] Failed to import saveSettingsDebounced (script.js path mismatch)");
  }

  return {
    extension_settings: extMod.extension_settings,
    saveSettingsDebounced: scriptMod.saveSettingsDebounced,
  };
}

