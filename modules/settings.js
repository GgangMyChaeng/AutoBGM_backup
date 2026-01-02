// 설정 스키마/기본값/마이그레이션 전담

import { extension_settings, saveSettingsDebounced } from "./deps.js";
import { idbPut } from "./storage.js";

export const SETTINGS_KEY = "autobgm";

/** settings.assets = { [fileKey]: { fileKey, label } } */
function ensureAssetList(settings) {
  settings.assets ??= {};
  return settings.assets;
}

// 1) ensureEngineFields에서 chatStates 보정까지 같이 & 재생모드
export function ensureEngineFields(settings) {
  settings.playMode ??= "manual";
  settings.chatStates ??= {};     // { [chatKey]: { currentKey, listIndex } }
  settings.presetBindings ??= {}; // (나중에 캐릭-프리셋 매칭용)

  // 구버전 보정
  for (const k of Object.keys(settings.chatStates)) {
    const st = settings.chatStates[k] || (settings.chatStates[k] = {});
    st.currentKey ??= "";
    st.listIndex ??= 0;
    st.lastSig ??= "";
    st.defaultPlayedSig ??= "";
    st.prevKey ??= "";
  }
}

// preset bgm id 보정에 필요
function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** ========= Settings schema + migration =========
 * preset.bgms[]: { id, fileKey, keywords, priority, volume, volLocked }
 * preset.defaultBgmKey: "neutral_01.mp3"
 */
export function ensureSettings() {
  extension_settings[SETTINGS_KEY] ??= {
    enabled: true,
    keywordMode: true,
    debugMode: false,
    globalVolume: 0.7,
    globalVolLocked: false,
    keywordOnce: false,
    useDefault: true,
    activePresetId: "default",
    presets: {
      default: {
        id: "default",
        name: "Default",
        defaultBgmKey: "",
        bgms: [],
      },
    },
    assets: {},
    chatStates: {},
    ui: { bgmSort: "added_asc" },
    floating: {
      enabled: false,
      x: null,
      y: null,
    },
  };

  const s = extension_settings[SETTINGS_KEY];
  s.globalVolLocked ??= false;
  s.keywordOnce ??= false;
  ensureEngineFields(s);

  s.ui ??= { bgmSort: "added_asc" };
  s.ui.bgmSort ??= "added_asc";
  s.floating ??= { enabled: false, x: null, y: null };
  s.floating.enabled ??= false;

  // ensureSettings 프리소스
  s.freeSources ??= [];
  s.mySources ??= [];
  s.fsUi ??= { tab: "free", selectedTags: [], search: "" };
  s.fsUi.cat ??= "all";
  s.fsUi.previewVolFree ??= 60; // 0~100
  s.fsUi.previewVolMy ??= 60;   // 0~100
  s.fsUi.previewVolLockFree ??= false;
  s.fsUi.previewVolLockMy ??= false;

  // 안전장치
  if (!s.presets || Object.keys(s.presets).length === 0) {
    s.presets = {
      default: { id: "default", name: "Default", defaultBgmKey: "", bgms: [] },
    };
    s.activePresetId = "default";
  }
  if (!s.presets[s.activePresetId]) s.activePresetId = Object.keys(s.presets)[0];

  ensureAssetList(s);
  s.chatStates ??= {};
  s.debugMode ??= false;

  // 프리셋/곡 스키마 보정 + 구버전 변환
  Object.values(s.presets).forEach((p) => {
    p.defaultBgmKey ??= "";
    p.bgms ??= [];

    // 구버전: preset.defaultBgmId가 있으면 -> defaultBgmKey로 변환
    if (p.defaultBgmId && !p.defaultBgmKey) {
      const hit = p.bgms.find((b) => b.id === p.defaultBgmId);
      if (hit?.fileKey) p.defaultBgmKey = hit.fileKey;
      else if (hit?.name) p.defaultBgmKey = `${hit.name}.mp3`;
      delete p.defaultBgmId;
    }

    // bgm들 스키마 보정
    p.bgms.forEach((b) => {
      b.id ??= uid();

      if (!b.fileKey) {
        if (b.name) b.fileKey = `${b.name}.mp3`;
        else b.fileKey = "";
      }

      b.keywords ??= "";
      b.priority ??= 0;
      b.volume ??= 1.0;
      b.volLocked ??= false;
      b.license ??= "";
    });
  });

  // 구버전: settings.defaultBgmId 같은 전역 값 남아있으면 제거 (있어도 안 쓰게)
  if (s.defaultBgmId) delete s.defaultBgmId;
  return s;
}

/** ========= Legacy: dataUrl -> idb로 옮기기 (있으면 한번만) ========= */
let _legacyMigrated = false;

export async function migrateLegacyDataUrlsToIDB(settings) {
  if (_legacyMigrated) return;
  _legacyMigrated = true;

  let changed = false;
  const assets = ensureAssetList(settings);

  for (const p of Object.values(settings.presets)) {
    for (const b of p.bgms) {
      if (b.dataUrl && b.fileKey) {
        try {
          const blob = await (await fetch(b.dataUrl)).blob();
          await idbPut(b.fileKey, blob);
          assets[b.fileKey] = { fileKey: b.fileKey, label: b.fileKey.replace(/\.mp3$/i, "") };
          delete b.dataUrl;
          changed = true;
        } catch (e) {
          console.warn("[AutoBGM] legacy dataUrl migrate failed:", b.fileKey, e);
        }
      }
    }
  }

  if (changed) {
    try { saveSettingsDebounced?.(); } catch {}
  }
}
