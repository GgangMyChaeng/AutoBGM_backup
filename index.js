/*
  AutoBGM (SillyTavern Extension)
  - Dynamic dependency resolver so it works in both layouts:
    /scripts/extensions/<ext>/...
    /scripts/extensions/third-party/<ext>/...
*/
let extension_settings;
let saveSettingsDebounced;
let __abgmDebugLine = ""; // 키워드 모드 디버깅
let __abgmDebugMode = false;
let _engineLastPresetId = "";

async function __abgmResolveDeps() {
  const base = import.meta.url;

  const tryImport = async (rel) => {
    try {
      return await import(new URL(rel, base));
    } catch (e) {
      return null;
    }
  };

  const extMod =
    (await tryImport("../../../extensions.js")) ||
    (await tryImport("../../extensions.js"));

  if (!extMod?.extension_settings) {
    throw new Error("[AutoBGM] Failed to import extension_settings (extensions.js path mismatch)");
  }
  extension_settings = extMod.extension_settings;

  const scriptMod =
    (await tryImport("../../../../script.js")) ||
    (await tryImport("../../../script.js"));

  if (!scriptMod?.saveSettingsDebounced) {
    throw new Error("[AutoBGM] Failed to import saveSettingsDebounced (script.js path mismatch)");
  }
  saveSettingsDebounced = scriptMod.saveSettingsDebounced;
}

const SETTINGS_KEY = "autobgm";
const MODAL_OVERLAY_ID = "abgm_modal_overlay";
const EXT_BIND_KEY = "autobgm_binding";

function getSTContextSafe() {
  try {
    if (window.SillyTavern?.getContext) return window.SillyTavern.getContext();
  } catch {}
  try {
    if (typeof getContext === "function") return getContext();
  } catch {}
  return null;
}

function getBoundPresetIdFromContext(ctx) {
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

let _abgmViewportHandler = null;

function fitModalToViewport(overlay) {
  const modal = overlay?.querySelector?.(".autobgm-modal");
  if (!modal) return;

  const vv = window.visualViewport;
  const hRaw = Math.max(vv?.height || 0, window.innerHeight || 0, 600);
  const maxH = Math.max(240, Math.floor(hRaw - 24));

  const setI = (k, v) => modal.style.setProperty(k, v, "important");

  // 좁은 폭에서도 무조건 화면 안
  setI("box-sizing", "border-box");
  setI("display", "block");
  setI("position", "relative");
  setI("width", "calc(100vw - 24px)");
  setI("max-width", "calc(100vw - 24px)");
  setI("min-width", "0");
  setI("margin", "12px");

  // 높이 강제 (CSS !important도 뚫음)
  setI("min-height", "240px");
  setI("height", `${maxH}px`);
  setI("max-height", `${maxH}px`);
  setI("overflow", "auto");

  setI("visibility", "visible");
  setI("opacity", "1");
  setI("transform", "none");

  setI("background", "rgba(20,20,20,.96)");
  setI("border", "1px solid rgba(255,255,255,.14)");
  setI("border-radius", "14px");
}

function getModalHost() {
  return (
    document.querySelector("#app") ||
    document.querySelector("#sillytavern") ||
    document.querySelector("main") ||
    document.body
  );
}

function fitModalToHost(overlay, host) {
  const modal = overlay?.querySelector?.(".autobgm-modal");
  if (!modal) return;

  const vv = window.visualViewport;
  const vw = vv?.width || window.innerWidth;
  const vh = vv?.height || window.innerHeight;

  // PC만 여백/최대폭 제한
  const isPc = vw >= 900;
  const pad = isPc ? 18 : 12;          // PC는 살짝 더 여유
  const maxWDesktop = 860;              // <-- 여기 숫자 줄이면 더 콤팩트

  const wRaw = Math.max(280, Math.floor(vw - pad * 2));
  const w = isPc ? Math.min(maxWDesktop, wRaw) : wRaw;

  const h = Math.max(240, Math.floor(vh - pad * 2));

  const setI = (k, v) => modal.style.setProperty(k, v, "important");

  setI("box-sizing", "border-box");
  setI("display", "block");
  setI("position", "relative");
  setI("width", `${w}px`);
  setI("max-width", `${w}px`);
  setI("min-width", "0");
  setI("margin", `${pad}px auto`);

  setI("min-height", "240px");
  setI("height", `${h}px`);
  setI("max-height", `${h}px`);
  setI("overflow", "auto");

  setI("visibility", "visible");
  setI("opacity", "1");
  setI("transform", "none");

  setI("background", "rgba(20,20,20,.96)");
  setI("border", "1px solid rgba(255,255,255,.14)");
  setI("border-radius", "14px");
}

/** ========= util 유틸리티 ========= */
function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function basenameNoExt(s = "") {
  const v = String(s || "").trim();
  if (!v) return "";
  const base = v.split("/").pop() || v;
  return base.replace(/\.[^/.]+$/, "");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getActivePreset(settings) {
  return settings.presets[settings.activePresetId];
}

/** ========= 삭제 확인 및 취소 ========= */
function abgmConfirm(containerOrDoc, message, {
  title = "Confirm",
  okText = "확인",
  cancelText = "취소",
} = {}) {
  const doc = containerOrDoc?.ownerDocument || document;

  // overlay(=root) 같은 엘리먼트가 들어오면 거기에 붙임
  const container =
    containerOrDoc && containerOrDoc.nodeType === 1 ? containerOrDoc : doc.body;

  return new Promise((resolve) => {
    const wrap = doc.createElement("div");
    wrap.className = "abgm-confirm-wrap";

    // overlay 안에 붙일 때는 absolute 센터링 모드
    if (container !== doc.body) wrap.classList.add("abgm-confirm-in-modal");

    wrap.innerHTML = `
      <div class="abgm-confirm-backdrop"></div>
      <div class="abgm-confirm" role="dialog" aria-modal="true">
        <div class="abgm-confirm-title">${escapeHtml(title)}</div>
        <div class="abgm-confirm-msg">${escapeHtml(message)}</div>
        <div class="abgm-confirm-actions">
          <button class="menu_button abgm-confirm-ok" type="button">${escapeHtml(okText)}</button>
          <button class="menu_button abgm-confirm-cancel" type="button">${escapeHtml(cancelText)}</button>
        </div>
      </div>
    `;

    const done = (v) => {
      doc.removeEventListener("keydown", onKey);
      wrap.remove();
      resolve(v);
    };

    wrap.querySelector(".abgm-confirm-backdrop")?.addEventListener("click", () => done(false));
    wrap.querySelector(".abgm-confirm-cancel")?.addEventListener("click", () => done(false));
    wrap.querySelector(".abgm-confirm-ok")?.addEventListener("click", () => done(true));

    const onKey = (e) => { if (e.key === "Escape") done(false); };
    doc.addEventListener("keydown", onKey);

    container.appendChild(wrap);
  });
}

// 라이센스 입력 쿠션창
function abgmPrompt(containerOrDoc, message, {
  title = "Edit",
  okText = "확인",
  cancelText = "취소",
  resetText = "초기화",
  initialValue = "",
  placeholder = "License / Description...",
} = {}) {
  const doc = containerOrDoc?.ownerDocument || document;
  const container =
    containerOrDoc && containerOrDoc.nodeType === 1 ? containerOrDoc : doc.body;

  return new Promise((resolve) => {
    const wrap = doc.createElement("div");
    wrap.className = "abgm-confirm-wrap";
    if (container !== doc.body) wrap.classList.add("abgm-confirm-in-modal");

    wrap.innerHTML = `
      <div class="abgm-confirm-backdrop"></div>
      <div class="abgm-confirm" role="dialog" aria-modal="true">
        <div class="abgm-confirm-title">${escapeHtml(title)}</div>
        <div class="abgm-confirm-msg">${escapeHtml(message)}</div>

        <textarea class="abgm-prompt-text" style="
          width:100%; min-height:96px; resize:vertical;
          margin-top:10px; padding:10px;
          border-radius:10px;
          border:1px solid rgba(255,255,255,.14);
          background:rgba(0,0,0,.25);
          color:inherit;
          box-sizing:border-box;
        " placeholder="${escapeHtml(placeholder)}"></textarea>

        <div class="abgm-confirm-row" style="margin-top:10px;">
  <div class="abgm-confirm-left">
    <button class="menu_button abgm-confirm-reset" type="button">초기화</button>
  </div>

  <div class="abgm-confirm-right">
    <button class="menu_button abgm-confirm-ok" type="button">확인</button>
    <button class="menu_button abgm-confirm-cancel" type="button">취소</button>
  </div>
</div>
    `;

    const ta = wrap.querySelector(".abgm-prompt-text");
    if (ta) ta.value = String(initialValue ?? "");

    const done = (v) => {
      doc.removeEventListener("keydown", onKey);
      wrap.remove();
      resolve(v);
    };

    const onKey = (e) => { if (e.key === "Escape") done(null); };
    doc.addEventListener("keydown", onKey);

    wrap.querySelector(".abgm-confirm-backdrop")?.addEventListener("click", () => done(null));
    wrap.querySelector(".abgm-confirm-cancel")?.addEventListener("click", () => done(null));
    wrap.querySelector(".abgm-confirm-ok")?.addEventListener("click", () => done(ta ? ta.value : ""));
    wrap.querySelector(".abgm-confirm-reset")?.addEventListener("click", () => {
      if (ta) ta.value = "";
      // reset 후 즉시 저장시키고 싶으면 여기서 done("")로 바꿔도 됨
    });

    container.appendChild(wrap);

    // 포커스
    setTimeout(() => { try { ta?.focus(); } catch {} }, 0);
  });
}

/** ========= 항목 이동 ========= */
function abgmPickPreset(containerOrDoc, settings, {
  title = "Select Preset",
  message = "어느 프리셋으로 보낼까?",
  okText = "확인",
  cancelText = "취소",
  excludePresetId = "",
} = {}) {
  const doc = containerOrDoc?.ownerDocument || document;
  const container =
    containerOrDoc && containerOrDoc.nodeType === 1 ? containerOrDoc : doc.body;

  return new Promise((resolve) => {
    const wrap = doc.createElement("div");
    wrap.className = "abgm-confirm-wrap";
    if (container !== doc.body) wrap.classList.add("abgm-confirm-in-modal");

    const options = getPresetsSortedByName(settings)
      .filter((p) => String(p.id) !== String(excludePresetId))
      .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`)
      .join("");

    wrap.innerHTML = `
      <div class="abgm-confirm-backdrop"></div>
      <div class="abgm-confirm" role="dialog" aria-modal="true">
        <div class="abgm-confirm-title">${escapeHtml(title)}</div>
        <div class="abgm-confirm-msg">${escapeHtml(message)}</div>

        <select class="abgm-pickpreset" style="
          width:100%;
          margin-top:10px;
          padding:10px;
          border-radius:10px;
          border:1px solid rgba(255,255,255,.14);
          background:rgba(0,0,0,.25);
          color:inherit;
          box-sizing:border-box;
        ">
          ${options}
        </select>

        <div class="abgm-confirm-actions" style="margin-top:10px;">
          <button class="menu_button abgm-confirm-ok" type="button">${escapeHtml(okText)}</button>
          <button class="menu_button abgm-confirm-cancel" type="button">${escapeHtml(cancelText)}</button>
        </div>
      </div>
    `;

    const sel = wrap.querySelector(".abgm-pickpreset");

    const done = (v) => {
      doc.removeEventListener("keydown", onKey);
      wrap.remove();
      resolve(v);
    };

    wrap.querySelector(".abgm-confirm-backdrop")?.addEventListener("click", () => done(null));
    wrap.querySelector(".abgm-confirm-cancel")?.addEventListener("click", () => done(null));
    wrap.querySelector(".abgm-confirm-ok")?.addEventListener("click", () => done(sel?.value || null));

    const onKey = (e) => { if (e.key === "Escape") done(null); };
    doc.addEventListener("keydown", onKey);

    container.appendChild(wrap);
    setTimeout(() => { try { sel?.focus(); } catch {} }, 0);
  });
}

/** ========= IndexedDB Assets =========
 * key: fileKey (예: "neutral_01.mp3")
 * value: Blob(File)
 */
const DB_NAME = "autobgm_db";
const DB_VER = 1;
const STORE_ASSETS = "assets";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ASSETS)) db.createObjectStore(STORE_ASSETS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, "readwrite");
    tx.objectStore(STORE_ASSETS).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, "readonly");
    const req = tx.objectStore(STORE_ASSETS).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDel(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, "readwrite");
    tx.objectStore(STORE_ASSETS).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** settings.assets = { [fileKey]: { fileKey, label } } */
function ensureAssetList(settings) {
  settings.assets ??= {};
  return settings.assets;
}

/** ========= Template loader ========= */
async function loadHtml(relPath) {
  const url = new URL(relPath, import.meta.url);
  url.searchParams.set("v", String(Date.now())); // 캐시 버스터
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Template fetch failed: ${res.status} ${url}`);
  return await res.text();
}

// ===== FreeSources boot wrappers (missing refs fix) =====
async function bootFreeSourcesSync() {
  const settings = ensureSettings();
  await syncBundledFreeSourcesIntoSettings(settings, { force: false, save: true });
}

// 예전 이름으로 호출하는 곳 있으면 이것도 받쳐줌
async function syncFreeSourcesFromJson(opts = {}) {
  const settings = ensureSettings();
  await syncBundledFreeSourcesIntoSettings(settings, opts);
}

// 혹시 남아있으면 merge도 받쳐줌 (동작은 "없는 것만"이 아니라 '덮어쓰기'로 맞춤)
async function mergeBundledFreeSourcesIntoSettings(settings) {
  await syncBundledFreeSourcesIntoSettings(settings, { force: false, save: true });
}

/** ========= 제공된 프리소스 인식 (JSON -> settings.freeSources "싹 덮어쓰기") ========= */

let __abgmFreeSourcesLoaded = false;

async function loadBundledFreeSources() {
  const url = new URL("data/freesources.json", import.meta.url);
  url.searchParams.set("v", String(Date.now())); // 개발 중 캐시 방지
  const res = await fetch(url);
  if (!res.ok) {
    console.warn("[AutoBGM] freesources.json load failed:", res.status);
    return [];
  }
  const json = await res.json();
  // 구조 유지: { sources: [...] }
  return Array.isArray(json?.sources) ? json.sources : [];
}

function simpleHash(s) {
  const str = String(s || "");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function normalizeFreeSourceItem(raw) {
  const src = String(raw?.src ?? raw?.url ?? raw?.fileKey ?? "").trim();
  if (!src) return null;

  const title = String(raw?.title ?? raw?.name ?? "").trim() || nameFromSource(src);
  const durationSec = Number(raw?.durationSec ?? raw?.duration ?? 0) || 0;

  const tagsRaw = raw?.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map(t => String(t || "").trim()).filter(Boolean)
    : String(tagsRaw || "")
        .split(/[,\n]+/)
        .map(t => t.trim())
        .filter(Boolean);

  // id는 믿지 말고, 없으면 src 기반으로 안정 생성
  const id = String(raw?.id || "").trim() || `fs_${simpleHash(src)}`;

  return { id, src, title, durationSec, tags };
}

/**
 * JSON을 진실로 두고 settings.freeSources를 "항상" JSON값으로 교체
 * - src 기준으로 유니크(중복 src면 마지막 승)
 */
async function syncBundledFreeSourcesIntoSettings(settings, { force = false, save = true } = {}) {
  if (__abgmFreeSourcesLoaded && !force) return;

  const bundledRaw = await loadBundledFreeSources();

  const map = new Map(); // key: src
  for (const r of bundledRaw) {
    const it = normalizeFreeSourceItem(r);
    if (!it) continue;
    map.set(it.src, it); // 마지막이 승리
  }

  settings.freeSources = Array.from(map.values());
  __abgmFreeSourcesLoaded = true;

  if (save) {
    try { saveSettingsDebounced?.(); } catch {}
  }

  console.log("[AutoBGM] freeSources synced:", settings.freeSources.length);
}

/** ========= Settings schema + migration =========
 * preset.bgms[]: { id, fileKey, keywords, priority, volume, volLocked }
 * preset.defaultBgmKey: "neutral_01.mp3"
 */
function ensureSettings() {
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
async function migrateLegacyDataUrlsToIDB(settings) {
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

  if (changed) saveSettingsDebounced();
}

/** ========= Audio player (test) ========= */
const _testAudio = new Audio();
let _testUrl = "";
async function playAsset(fileKey, volume01) {
  const fk = String(fileKey ?? "").trim();
  if (!fk) return;

  // URL이면 그대로 재생
  if (isProbablyUrl(fk)) {
    if (_testUrl) URL.revokeObjectURL(_testUrl);
    _testUrl = ""; // url은 revoke 대상 아님

    _testAudio.pause();
    _testAudio.currentTime = 0;
    _testAudio.src = fk;
    _testAudio.volume = Math.max(0, Math.min(1, volume01));
    _testAudio.play().catch(() => {});
    return;
  }

  // 파일키면 기존대로 IDB
  const blob = await idbGet(fk);
  if (!blob) {
    console.warn("[AutoBGM] missing asset:", fk);
    return;
  }

  if (_testUrl) URL.revokeObjectURL(_testUrl);
  _testUrl = URL.createObjectURL(blob);

  _testAudio.pause();
  _testAudio.currentTime = 0;
  _testAudio.src = _testUrl;
  _testAudio.volume = Math.max(0, Math.min(1, volume01));
  _testAudio.play().catch(() => {});
}

  /** ========= Runtime Audio Engine ========= */
const _bgmAudio = new Audio();
let _bgmUrl = "";
let _engineTimer = null;
let _engineLastChatKey = "";
let _engineCurrentFileKey = "";
let _engineCurrentPresetId = "";


// ===== Now Playing UI =====
let _abgmNowPlayingBound = false;

function updateModalNowPlayingSimple(title) {
  const el = document.getElementById("abgm_now_title");
  if (!el) return;
  el.textContent = String(title ?? "(none)");
}

function _abgmSetText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(text ?? "");
}

function updateNowPlayingUI() {
  try {
    const fk = String(_engineCurrentFileKey || "");
    const settings = ensureSettings?.() || {};

    const pid = String(_engineCurrentPresetId || settings?.activePresetId || "");
    const preset =
      (pid && settings?.presets?.[pid]) ||
      settings?.presets?.[settings?.activePresetId] ||
      Object.values(settings?.presets || {})[0] ||
      {};

    const bgm = (preset.bgms ?? []).find((b) => String(b?.fileKey ?? "") === fk) || null;
    const title = bgm ? getEntryName(bgm) : (fk || "(none)");

    const presetName = preset?.name || "Preset";
    const modeLabel = settings?.keywordMode ? "Keyword" : (settings?.playMode || "manual");
    const meta = `${modeLabel} · ${presetName}`;
    const debugLine = (__abgmDebugMode && __abgmDebugLine) ? String(__abgmDebugLine) : "";

    // ===== modal license area =====
    const licWrap = document.getElementById("abgm_np_license_wrap");
    const licText = document.getElementById("abgm_np_license_text");
    if (licWrap && licText) {
      const lic = bgm ? String(bgm.license ?? "").trim() : "";
      if (lic) { licWrap.style.display = ""; licText.textContent = lic; }
      else { licWrap.style.display = "none"; licText.textContent = ""; }
    }

    // drawer(확장메뉴)
    _abgmSetText("autobgm_now_title", title);
    _abgmSetText("autobgm_now_meta", meta);

    const dbg = document.getElementById("autobgm_now_debug");
    if (dbg) {
      dbg.style.display = debugLine ? "" : "none";
      dbg.textContent = debugLine;
    }

    // 모달(simple)
    updateModalNowPlayingSimple(title);

    // 버튼들 처리(너 기존 그대로)
    const btnDef = document.getElementById("autobgm_now_btn_default");
    const btnPlay = document.getElementById("autobgm_now_btn_play");
    const btnMode = document.getElementById("autobgm_now_btn_mode");

    if (btnDef) {
      const leftWrap = btnDef.closest(".np-left");
      if (leftWrap) leftWrap.classList.toggle("is-hidden", !settings?.keywordMode);

      btnDef.textContent = settings?.useDefault ? "⭐" : "☆";
      btnDef.title = settings?.useDefault ? "Use Default: ON" : "Use Default: OFF";
    }

    if (btnPlay) {
      const icon = !fk ? "⏹️" : (_bgmAudio?.paused ? "⏸️" : "▶️");
      btnPlay.textContent = icon;
      btnPlay.title = icon === "▶️" ? "Pause" : (icon === "⏸️" ? "Play" : "Start");
    }

    if (btnMode) {
      const modeIcon =
        settings?.keywordMode ? "💬" :
        (settings?.playMode === "loop_one" ? "🔂" :
         settings?.playMode === "loop_list" ? "🔁" :
         settings?.playMode === "random" ? "🔀" : "▶️");

      btnMode.textContent = modeIcon;
      btnMode.title =
        settings?.keywordMode ? "Mode: Keyword" :
        `Mode: ${settings?.playMode || "manual"}`;
    }

    setNowControlsLocked(!settings.enabled);
  } catch (e) {
    console.error("[AutoBGM] updateNowPlayingUI failed:", e);
  }
}

function setNowControlsLocked(locked) {
  const root = document.getElementById("autobgm-root");
  if (!root) return;

  const btnPlay = root.querySelector("#autobgm_now_btn_play");
  const btnDef  = root.querySelector("#autobgm_now_btn_default");
  const btnMode = root.querySelector("#autobgm_now_btn_mode");

  const lockBtn = (el, on) => {
    if (!el) return;
    el.classList.toggle("abgm-disabled", !!on);
    el.style.pointerEvents = on ? "none" : "";
    el.style.opacity = on ? "0.35" : "";
    el.setAttribute("aria-disabled", on ? "true" : "false");
    el.title = on ? "Disabled (Extension Off)" : "";
  };

  lockBtn(btnPlay, locked);
  lockBtn(btnDef, locked);
  lockBtn(btnMode, locked);
}

function bindNowPlayingEventsOnce() {
  if (_abgmNowPlayingBound) return;
  _abgmNowPlayingBound = true;

  try {
    _bgmAudio.addEventListener("play", updateNowPlayingUI);
    _bgmAudio.addEventListener("pause", updateNowPlayingUI);
    _bgmAudio.addEventListener("ended", updateNowPlayingUI);
    _bgmAudio.addEventListener("error", updateNowPlayingUI);
  } catch {}
}

// 1) ensureEngineFields에서 chatStates 보정까지 같이 & 재생모드
function ensureEngineFields(settings) {
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
  }
}

function clamp01(x) {
  x = Number(x);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function stopRuntime() {
  try { _bgmAudio.pause(); } catch {}
  _bgmAudio.currentTime = 0;
  if (_bgmUrl) URL.revokeObjectURL(_bgmUrl);
  _bgmUrl = "";
  _bgmAudio.src = "";
  _engineCurrentFileKey = "";
  _engineCurrentPresetId = "";
  updateNowPlayingUI();

}

function getChatKeyFromContext(ctx) {
  // ST 버전차 대비 (대충이라도 안정적으로)
  const chatId = ctx?.chatId ?? ctx?.chat_id ?? ctx?.chat?.id ?? "global";
  const char = ctx?.characterId ?? ctx?.character_id ?? ctx?.character?.id ?? ctx?.name2 ?? "";
  return `${chatId}::${char}`;
}

// Ai 컨텍스트 제발 돼라 ㅅㅂ
function getLastAssistantText(ctx) {
  try {
    // 1) ctx에서 먼저 시도
    let chat = (ctx && (ctx.chat || ctx.messages)) || null;

    // 2) 그래도 없으면 SillyTavern 객체/함수에서 시도
    if (!Array.isArray(chat) || chat.length === 0) {
      try {
        const st = window.SillyTavern || window?.parent?.SillyTavern;
        const gc = st && typeof st.getContext === "function" ? st.getContext() : null;
        chat = (gc && (gc.chat || gc.messages)) || chat;
      } catch {}
    }

    // 3) 그래도 없으면 (가능하면) window.chat 시도
    if (!Array.isArray(chat) || chat.length === 0) {
      if (Array.isArray(window.chat)) chat = window.chat;
    }

    // 4) 배열이 있으면 거기서 마지막 assistant 찾기
    if (Array.isArray(chat) && chat.length) {
      for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i] || {};
        if (m.is_user === true) continue;

        const role = String(m.role || m.sender || "").toLowerCase();
        if (role === "user") continue;

        const text = (m.content ?? m.mes ?? m.message ?? m.text ?? "");
        if (typeof text === "string" && text.trim()) return text;
      }
    }

    // 5) 최후의 수단: DOM에서 마지막 assistant 메시지 긁기
    // (ST UI 구조가 바뀌어도 최대한 버티도록 넓게 잡음)
    const root =
      document.querySelector("#chat") ||
      document.querySelector("#chat_content") ||
      document.querySelector("main") ||
      document.body;

    if (root) {
      const nodes = Array.from(root.querySelectorAll(".mes, .message, .chat_message"));
      for (let i = nodes.length - 1; i >= 0; i--) {
        const el = nodes[i];
        if (!el) continue;

        // 유저 메시지로 보이는 것들 최대한 스킵
        const cls = el.classList;
        if (cls && (cls.contains("is_user") || cls.contains("user") || cls.contains("from_user"))) continue;

        // 메시지 텍스트 후보
        const textEl =
          el.querySelector(".mes_text, .message_text, .text, .content, .mes_content") || el;

        const txt = (textEl.innerText || textEl.textContent || "").trim();
        if (txt) return txt;
      }
    }
  } catch {}

  return "";
}

// 지문 시그니처
function makeAsstSig(text) {
  const t = String(text ?? "");
  // 너무 큰 문자열 통째로 저장하지 말고 "변하면 변하는 값"만
  const head = t.slice(0, 40).replace(/\s+/g, " ");
  const tail = t.slice(-20).replace(/\s+/g, " ");
  return `${t.length}:${head}:${tail}`;
}

// 키워드 구분 (쉼표, 띄어쓰기)
function parseKeywords(s) {
  return String(s ?? "")
    .split(/[,\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// 우선도에 따른 곡 선정 로직
function pickByKeyword(preset, text, preferKey = "", avoidKey = "") {
  const t = String(text ?? "").toLowerCase();
  if (!t) return null;

  let bestPri = -Infinity;
  let candidates = [];

  for (const b of preset.bgms ?? []) {
    const fk = String(b.fileKey ?? "");
    if (!fk) continue;

    // 제외곡 스킵
    if (avoidKey && fk === avoidKey) continue;

    const kws = parseKeywords(b.keywords);
    if (!kws.length) continue;

    const hit = kws.some((kw) => t.includes(kw.toLowerCase()));
    if (!hit) continue;

    const pri = Number(b.priority ?? 0);

    if (pri > bestPri) {
      bestPri = pri;
      candidates = [b];
    } else if (pri === bestPri) {
      candidates.push(b);
    }
  }

  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  // loop모드용 유지 로직(그대로)
  if (preferKey) {
    const keep = candidates.find((x) => String(x.fileKey ?? "") === String(preferKey));
    if (keep) return keep;
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

function getSortedKeys(preset, sort) {
  return getSortedBgms(preset, sort)
    .map((b) => String(b.fileKey ?? ""))
    .filter(Boolean);
}

function pickRandomKey(keys, avoid = "") {
  const arr = (keys ?? []).filter(Boolean);
  if (!arr.length) return "";
  if (arr.length === 1) return arr[0];

  const pool = arr.filter((k) => k !== avoid);
  const pickFrom = pool.length ? pool : arr;
  return pickFrom[Math.floor(Math.random() * pickFrom.length)];
}

function findBgmByKey(preset, fileKey) {
  return (preset.bgms ?? []).find((b) => String(b.fileKey ?? "") === String(fileKey ?? ""));
}

// presetId 인자 추가 버전
async function ensurePlayFile(fileKey, vol01, loop, presetId = "") {
  const fk = String(fileKey ?? "").trim();
  if (!fk) return false;

  // URL이면 IDB 없이 바로 재생
  if (isProbablyUrl(fk)) {
    if (_bgmUrl) URL.revokeObjectURL(_bgmUrl);
    _bgmUrl = ""; // url은 revoke 대상 아님

    _bgmAudio.loop = !!loop;
    _bgmAudio.src = fk;
    _bgmAudio.volume = clamp01(vol01);

    try { await _bgmAudio.play(); } catch {}

    _engineCurrentFileKey = fk;
    if (presetId) _engineCurrentPresetId = String(presetId);
    updateNowPlayingUI();
    return true;
  }

  // 파일키면 기존대로 IDB
  const blob = await idbGet(fk);
  if (!blob) return false;

  if (_bgmUrl) URL.revokeObjectURL(_bgmUrl);
  _bgmUrl = URL.createObjectURL(blob);

  _bgmAudio.loop = !!loop;
  _bgmAudio.src = _bgmUrl;
  _bgmAudio.volume = clamp01(vol01);

  try { await _bgmAudio.play(); } catch {}

  _engineCurrentFileKey = fk;
  if (presetId) _engineCurrentPresetId = String(presetId);
  updateNowPlayingUI();
  return true;
}

// ===== Entry Name helpers =====
function nameFromSource(src = "") {
  const s = String(src || "").trim();
  if (!s) return "";

  // URL이면 path 마지막 조각 or hostname
  if (isProbablyUrl(s)) {
    try {
      const u = new URL(s);
      const last = (u.pathname.split("/").pop() || "").trim();
      const cleanLast = last.replace(/\.[^/.]+$/, ""); // 확장자 제거
      return cleanLast || u.hostname || "URL";
    } catch {
      return "URL";
    }
  }

  // 파일이면 기존대로
  const base = s.split("/").pop() || s;
  return base.replace(/\.[^/.]+$/, "");
}

function getEntryName(bgm) {
  const n = String(bgm?.name ?? "").trim();
  return n ? n : nameFromSource(bgm?.fileKey ?? "");
}

function ensureBgmNames(preset) {
  for (const b of preset?.bgms ?? []) {
    if (!String(b?.name ?? "").trim()) {
      b.name = nameFromSource(b.fileKey);
    }
  }
}

/** ========= url 판별 함수 ========= */
function isProbablyUrl(s) {
  const v = String(s ?? "").trim();
  return /^https?:\/\//i.test(v);
}

// ===== Dropbox URL normalize (audio용) =====
function dropboxToRaw(u) {
  try {
    const url = new URL(String(u || "").trim());
    if (!/dropbox\.com$/i.test(url.hostname)) return String(u || "").trim();

    // 미리보기 파라미터 제거 + raw=1 강제
    url.searchParams.delete("dl");
    url.searchParams.set("raw", "1");

    return url.toString();
  } catch {
    return String(u || "").trim();
  }
}

/** ========= ZIP (JSZip 필요) ========= */
async function ensureJSZipLoaded() {
  if (window.JSZip) return window.JSZip;

  // vendor/jszip.min.js를 확장 폴더에 넣으면 여기서 로드됨
  const s = document.createElement("script");
  s.src = new URL("vendor/jszip.min.js", import.meta.url).toString();
  document.head.appendChild(s);

  await new Promise((resolve, reject) => {
    s.onload = resolve;
    s.onerror = reject;
  });

  return window.JSZip;
}

async function importZip(file, settings) {
  const JSZip = await ensureJSZipLoaded();
  const zip = await JSZip.loadAsync(file);

  const assets = ensureAssetList(settings);
  const importedKeys = [];

  const entries = Object.values(zip.files).filter(
    (f) => !f.dir && f.name.toLowerCase().endsWith(".mp3")
  );

  for (const entry of entries) {
    const blob = await entry.async("blob");
    const fileKey = entry.name.split("/").pop(); // 폴더 제거

    await idbPut(fileKey, blob);
    assets[fileKey] = { fileKey, label: fileKey.replace(/\.mp3$/i, "") };
    importedKeys.push(fileKey);
  }

  saveSettingsDebounced();
  return importedKeys;
}

/** ========= Helpers: asset delete safely ========= */
function isFileKeyReferenced(settings, fileKey) {
  for (const p of Object.values(settings.presets)) {
    if (p.defaultBgmKey === fileKey) return true;
    if (p.bgms?.some((b) => b.fileKey === fileKey)) return true;
  }
  return false;
}

/** ========= Modal open/close ========= */
function closeModal() {
  const overlay = document.getElementById(MODAL_OVERLAY_ID);
  if (overlay) overlay.remove();
  document.body.classList.remove("autobgm-modal-open");
  window.removeEventListener("keydown", onEscClose);
  
  if (_abgmViewportHandler) {
  window.removeEventListener("resize", _abgmViewportHandler);
  window.visualViewport?.removeEventListener("resize", _abgmViewportHandler);
  window.visualViewport?.removeEventListener("scroll", _abgmViewportHandler);
  _abgmViewportHandler = null;
  }
    updateNowPlayingUI();
}

function onEscClose(e) {
  if (e.key === "Escape") closeModal();
}

async function openModal() {
  if (document.getElementById(MODAL_OVERLAY_ID)) return;

  let html = "";
  try {
    html = await loadHtml("templates/popup.html");
  } catch (e) {
    console.error("[AutoBGM] popup.html load failed", e);
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = MODAL_OVERLAY_ID;
  overlay.className = "autobgm-overlay";
  overlay.innerHTML = html;

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

   // 모바일 WebView 강제 스타일 (CSS 씹는 경우 방지) — important 버전
const host = getModalHost();

// host가 static이면 absolute overlay가 제대로 안 잡힘
const cs = getComputedStyle(host);
if (cs.position === "static") host.style.position = "relative";

// overlay는 컨테이너 기준 absolute로
const setO = (k, v) => overlay.style.setProperty(k, v, "important");
setO("position", "absolute");
setO("inset", "0");
setO("display", "block");
setO("overflow", "auto");
setO("-webkit-overflow-scrolling", "touch");
setO("background", "rgba(0,0,0,.55)");
setO("z-index", "2147483647");
setO("padding", "0"); // modal이 margin/pad 갖고 있으니 overlay는 0

host.appendChild(overlay);

// 컨테이너 기준으로 사이징
fitModalToHost(overlay, host);
requestAnimationFrame(() => fitModalToHost(overlay, host));
setTimeout(() => fitModalToHost(overlay, host), 120);

// 키보드/주소창 변화 대응 (visualViewport)
_abgmViewportHandler = () => {
  // 키보드 올라왔다 내려올 때 width/height가 바뀜
  fitModalToHost(overlay, host);
};

// 키보드 내려갈 때 resize 이벤트가 안 오기도 해서, 포커스 빠질 때 강제 재계산
const kickFit = () => {
  _abgmViewportHandler?.();
  setTimeout(() => _abgmViewportHandler?.(), 60);
  setTimeout(() => _abgmViewportHandler?.(), 240);
};

overlay.addEventListener("focusout", kickFit, true);
overlay.addEventListener("touchend", kickFit, { passive: true });
overlay.addEventListener("pointerup", kickFit, { passive: true });

// window resize도 유지
window.addEventListener("resize", _abgmViewportHandler);

// visualViewport가 있으면 더 정확히
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", _abgmViewportHandler);
  window.visualViewport.addEventListener("scroll", _abgmViewportHandler); // 중요: 키보드 올라오면 scroll도 같이 변함
}

  document.body.classList.add("autobgm-modal-open");
  window.addEventListener("keydown", onEscClose);

  const closeBtn = overlay.querySelector("#abgm_modal_close");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);

  initModal(overlay);
  bindNowPlayingEventsOnce();
  updateNowPlayingUI();

  console.log("[AutoBGM] modal opened");
}

// ===============================
// FreeSources Modal 프리소스모달 (Free/My + Tag filter AND)
// ===============================
const FS_OVERLAY_ID = "abgm_fs_overlay";

// duration seconds -> "m:ss"
function abgmFmtDur(sec) {
  const n = Math.max(0, Number(sec || 0));
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function bpmToTempoTag(bpm){
  const n = Number(bpm);
  if (!Number.isFinite(n)) return "";
  if (n < 60)  return "tempo:larghissimo";
  if (n < 66)  return "tempo:largo";
  if (n < 76)  return "tempo:adagio";
  if (n < 108) return "tempo:andante";
  if (n < 120) return "tempo:moderato";
  if (n < 156) return "tempo:allegro";
  if (n < 176) return "tempo:vivace";
  if (n < 200) return "tempo:presto";
  return "tempo:prestissimo";
}

/* =========================
   Tag auto categorizer
   ========================= */

// 단어(1토큰) 별칭 (주로 기호/표기 통일)
const TAG_ALIASES = new Map([
  ["hip-hop", "hiphop"],
  ["hip hop", "hiphop"],
  ["r&b", "rnb"],
  ["rnb", "rnb"],
  ["lofi", "lo-fi"], // 취향
]);

// “문구(여러 단어)”를 통째로 확정 매핑 (제일 정확함)
const PHRASE_ALIASES = new Map([
  ["alternative r&b", ["mood:alternative", "genre:rnb"]],
  ["acoustic pop", ["inst:acoustic", "genre:pop"]],
  ["neo soul", ["genre:neo_soul"]],
  ["bossa nova", ["genre:bossa_nova"]],
  ["lo-fi hip hop", ["mood:lofi", "genre:hiphop"]],
  ["glitch hop", ["genre:glitch_hop"]],
  ["jazz hop", ["genre:jazz_hop"]],
  ["industrial techno", ["genre:industrial", "genre:techno"]],
  ["electronic/edm", ["genre:electronic", "genre:edm"]],
  ["darksynth", ["genre:darksynth", "mood:dark", "inst:synth"]],
  ["french glitch", ["genre:french", "genre:glitch"]],
  ["808 bassline", ["inst:808_bass"]],
  ["industrial horror", ["mood:industrial", "mood:horror"]],
  ["mechanical groove", ["mood:mechanical", "mood:groove"]],
  ["night vibes", ["mood:night_vibes"]],
  ["tension", ["mood:tense"]],
  ["high-energy j-rock", ["mood:high-energy", "genre:j-rock"]],
]);

const GENRE_WORDS = new Set([
  "blues","jazz","rock","pop","country","classical","folk","funk","soul","reggae","metal","ambient",
  "electronic","edm","hiphop","rap","rnb","drill","idm","techno","glitch","j-rock"
]);

const MOOD_WORDS = new Set([
  "calm","dark","sad","happy","tense","chill","cozy","epic","mysterious",
  "alternative","chaotic","cinematic","cold","cyberpunk","tension","night","tight","lofi",
  "east asian influence","exploration","high-energy","hopeless","horizon","military",
  "underscore","mundane","soft"
]);

const INST_WORDS = new Set([
  "piano","guitar","strings","synth","bass","drums","orchestra",
  "acoustic","808","turntable","scratch","808_bass"
]);

const LYRIC_WORDS = new Set([
  "lyric","lyrics","no lyric","instrumental","vocal","male","female"
]);

function abgmCanonRawTag(raw) {
  let s = String(raw || "").trim().toLowerCase();
  if (!s) return "";

  // 공백 정리
  s = s.replace(/\s+/g, " ");

  // 숫자만 있으면 bpm
  if (/^\d{2,3}$/.test(s)) {
    const bpm = Number(s);
    if (bpm >= 40 && bpm <= 260) return `bpm:${bpm}`;
  }

  // 통째 문구 별칭 먼저
  if (PHRASE_ALIASES.has(s)) return s;

  // 일반 별칭 적용 (예: "r&b" → "rnb")
  if (TAG_ALIASES.has(s)) s = TAG_ALIASES.get(s);

  return s;
}

// ✅ “하나 입력”을 “여러 태그”로 확장
function abgmNormTags(raw) {
  const s0 = abgmCanonRawTag(raw);
  if (!s0) return [];

  // bpm:xxx 같은 건 그대로 단일 반환
  if (s0.startsWith("bpm:")) return [s0];

  // 이미 cat:tag 형태면 그대로
  if (s0.includes(":") && !PHRASE_ALIASES.has(s0)) return [s0];

  // 문구 확정 매핑
  if (PHRASE_ALIASES.has(s0)) return PHRASE_ALIASES.get(s0).slice();

  // "/" 같은 구분자 들어오면 나눠서 재귀 처리
  if (s0.includes("/")) {
    return s0.split("/").flatMap(part => abgmNormTags(part));
  }

  // 여러 단어면 “마지막 단어=장르” 휴리스틱 (대충 알터네이티브 알앤비 같은 거)
  const toks = s0.split(" ").filter(Boolean);
  if (toks.length >= 2) {
    const lastRaw = toks[toks.length - 1];
    const last = TAG_ALIASES.get(lastRaw) || lastRaw;

    // 마지막이 장르면: genre:last + 앞 단어들은 mood/inst로 분류 시도
    if (GENRE_WORDS.has(last)) {
      const out = [`genre:${last}`];
      for (const w0 of toks.slice(0, -1)) {
        const w = TAG_ALIASES.get(w0) || w0;
        if (INST_WORDS.has(w)) out.push(`inst:${w}`);
        else if (MOOD_WORDS.has(w)) out.push(`mood:${w}`);
        else out.push(w); // 모르면 기존처럼 etc(콜론 없는 태그)로 둠
      }
      return out;
    }
  }

  // 한 단어면 단어사전으로 분류
  if (GENRE_WORDS.has(s0)) return [`genre:${s0}`];
  if (MOOD_WORDS.has(s0))  return [`mood:${s0}`];
  if (INST_WORDS.has(s0))  return [`inst:${s0}`];
  if (LYRIC_WORDS.has(s0)) return [`lyric:${s0}`];

  // 모르면 그대로 (etc)
  return [s0];
}

// 기존 코드 호환용: “단일 문자열”만 필요한 곳에서 쓰기
function abgmNormTag(raw) {
  return abgmNormTags(raw)[0] || "";
}

function matchTagsAND(itemTags = [], selectedSet) {
  if (!selectedSet || selectedSet.size === 0) return true;
  const set = new Set((itemTags || []).flatMap(abgmNormTags).filter(Boolean));
  for (const t of selectedSet) {
    if (!set.has(abgmNormTag(t))) return false;
  }
  return true;
}

function matchSearch(item, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return true;

  const title = String(item?.title ?? item?.name ?? "").toLowerCase();
  const tags = (item?.tags ?? []).map(abgmNormTag).join(" ");
  const src = String(item?.src ?? item?.fileKey ?? "").toLowerCase();

  return (title.includes(s) || tags.includes(s) || src.includes(s));
}

function getFsActiveList(settings) {
  const tab = String(settings?.fsUi?.tab || "free");
  const arr = tab === "my" ? (settings.mySources ?? []) : (settings.freeSources ?? []);
  return Array.isArray(arr) ? arr : [];
}

// 프리뷰 볼륨
function fsGetPreviewVol100(settings) {
  const tab = String(settings?.fsUi?.tab || "free");
  const v = (tab === "my") ? settings?.fsUi?.previewVolMy : settings?.fsUi?.previewVolFree;
  const n = Math.max(0, Math.min(100, Number(v ?? 60)));
  return Number.isFinite(n) ? n : 60;
}
function fsSetPreviewVol100(settings, v100) {
  const tab = String(settings?.fsUi?.tab || "free");
  const n = Math.max(0, Math.min(100, Number(v100 ?? 60)));
  if (tab === "my") settings.fsUi.previewVolMy = n;
  else settings.fsUi.previewVolFree = n;
}
function fsGetPreviewLock(settings) {
  const tab = String(settings?.fsUi?.tab || "free");
  return tab === "my" ? !!settings?.fsUi?.previewVolLockMy : !!settings?.fsUi?.previewVolLockFree;
}
function fsSetPreviewLock(settings, locked) {
  const tab = String(settings?.fsUi?.tab || "free");
  if (tab === "my") settings.fsUi.previewVolLockMy = !!locked;
  else settings.fsUi.previewVolLockFree = !!locked;
}

// ===== tag display helper (tagCat 근처에 추가 추천) =====
function tagVal(t){
  const s = abgmNormTag(t);
  const i = s.indexOf(":");
  return i > 0 ? s.slice(i + 1) : s;
}

const TAG_PRETTY_MAP = new Map([
  ["rnb", "R&B"],
  ["hiphop", "hip-hop"],
  ["lofi", "lo-fi"],
  ["idm", "IDM"],
  ["edm", "EDM"],
]);

function tagPretty(t){
  const s = abgmNormTag(t);
  const cat = tagCat(s);
  let v = tagVal(s).replace(/[_]+/g, " ").trim(); // neo_soul -> neo soul

  // 약간만 보기 좋게
  if (TAG_PRETTY_MAP.has(v)) v = TAG_PRETTY_MAP.get(v);

  // bpm은 표시만 예쁘게
  if (cat === "bpm") return `${v} BPM`;

  return v;
}

// 카테고리별 태그 수집
function tagCat(t) {
  const s = String(t || "").trim().toLowerCase();
  const i = s.indexOf(":");
  if (i <= 0) return "etc";
  return s.slice(0, i);
}

const TAG_CAT_ORDER = ["genre","mood","inst","lyric","bpm","tempo","etc"];

function tagSortKey(t){
  const s = abgmNormTag(t);
  const cat = tagCat(s);
  const ci = TAG_CAT_ORDER.indexOf(cat);
  const catRank = ci === -1 ? 999 : ci;

  // bpm은 숫자 정렬
  if (cat === "bpm") {
    const n = Number(s.split(":")[1] ?? 0);
    return [catRank, n, s];
  }
  return [catRank, 0, s];
}

function sortTags(arr){
  return [...arr].sort((a,b)=>{
    const A = tagSortKey(a), B = tagSortKey(b);
    if (A[0] !== B[0]) return A[0]-B[0];
    if (A[1] !== B[1]) return A[1]-B[1];
    return String(A[2]).localeCompare(String(B[2]), undefined, {numeric:true, sensitivity:"base"});
  });
}

function collectAllTagsForTabAndCat(settings) {
  const list = getFsActiveList(settings);
  const cat = String(settings?.fsUi?.cat || "all");
  const bag = new Set();

  for (const it of list) {
    for (const raw of (it?.tags ?? [])) {
      const t = abgmNormTag(raw);
      if (!t) continue;

      const c = tagCat(t);

      // All = "분류 안 된 것만" (콜론 없는 태그들 = etc)
      if (cat === "all") {
        if (c !== "etc") continue;
      } else {
        if (c !== cat) continue;
      }

      bag.add(t);
    }
  }
  return sortTags(Array.from(bag));
} // 태그 수집 닫

function renderFsTagPicker(root, settings) {
  const box = root.querySelector("#abgm_fs_tag_picker");
  if (!box) return;

  // computed 기준으로 진짜 열림/닫힘 판단
  const open = getComputedStyle(box).display !== "none";
  if (!open) return;

  const wrap   = root.querySelector(".abgm-fs-wrap") || root;
  const catbar = root.querySelector("#abgm_fs_catbar");
  if (!catbar) return;

  const top = catbar.offsetTop + catbar.offsetHeight + 8;
  box.style.top = `${top}px`;

  const wrapH = wrap.clientHeight || 0;
  const maxH = Math.max(120, wrapH - top - 12);
  box.style.maxHeight = `${Math.min(240, maxH)}px`;

  const all = collectAllTagsForTabAndCat(settings);
  const selected = new Set((settings.fsUi?.selectedTags ?? []).map(abgmNormTag).filter(Boolean));

  box.innerHTML = "";

  if (!all.length) {
    const p = document.createElement("div");
    p.style.opacity = ".75";
    p.style.fontSize = "12px";
    p.style.padding = "6px 2px";
    p.textContent = "태그 없음";
    box.appendChild(p);
    return;
  }

  for (const t of all) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menu_button abgm-fs-tagpick";
    btn.dataset.tag = t;
    const label = tagPretty(t);
    btn.textContent = selected.has(t) ? `✅ ${label}` : label;
    btn.title = t; // hover하면 원본(genre:xxx) 보이게
    box.appendChild(btn);
  }
}

function fsRelayoutTagPicker(root) {
  const box = root.querySelector("#abgm_fs_tag_picker");
  if (!box || box.style.display === "none") return;

  const wrap   = root.querySelector(".abgm-fs-wrap") || root;
  const catbar = root.querySelector("#abgm_fs_catbar");
  if (!catbar) return;

  const top = catbar.offsetTop + catbar.offsetHeight + 8;
  box.style.top = `${top}px`;

  const wrapH = wrap.clientHeight || 0;
  const maxH = Math.max(120, wrapH - top - 12);
  box.style.maxHeight = `${Math.min(240, maxH)}px`;
}


function renderFsList(root, settings) {
  const listEl = root.querySelector("#abgm_fs_list");
  if (!listEl) return;

  const selected = new Set(
    (settings.fsUi?.selectedTags ?? []).map(abgmNormTag).filter(Boolean)
  );
  const q = String(settings.fsUi?.search ?? "");

  const listRaw = getFsActiveList(settings);

  const filtered = listRaw
    .filter((it) => matchTagsAND(it?.tags ?? [], selected) && matchSearch(it, q))
    // 이름 A→Z 강제
    .sort((a, b) => {
      const an = String(a?.title ?? a?.name ?? "").trim();
      const bn = String(b?.title ?? b?.name ?? "").trim();
      return an.localeCompare(bn, undefined, { numeric: true, sensitivity: "base" });
    });

  listEl.innerHTML = "";

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.style.opacity = ".75";
    empty.style.fontSize = "12px";
    empty.style.padding = "10px";
    empty.textContent = "결과 없음";
    listEl.appendChild(empty);
    return;
  }

  for (const it of filtered) {
    const id = String(it?.id ?? "");
    const title = String(it?.title ?? it?.name ?? "(no title)");
    const dur = abgmFmtDur(it?.durationSec ?? 0);
    const tags = Array.isArray(it?.tags) ? it.tags.map(abgmNormTag).filter(Boolean) : [];
    const src = String(it?.src ?? it?.fileKey ?? "");

    const row = document.createElement("div");
    row.className = "abgm-fs-item";
    row.dataset.id = id;

    row.innerHTML = `
      <button type="button" class="abgm-fs-main" title="Toggle tags">
        <div class="abgm-fs-name">${escapeHtml(title)}</div>
        <div class="abgm-fs-time">${escapeHtml(dur)}</div>
      </button>

      <div class="abgm-fs-side">
        <div class="abgm-fs-actions">
          <button type="button" class="menu_button abgm-fs-play" title="Play" data-src="${escapeHtml(src)}">▶</button>
          <button type="button" class="menu_button abgm-fs-copy" title="Copy" data-src="${escapeHtml(src)}">Copy</button>
        </div>

        <div class="abgm-fs-tagpanel">
          ${tags.map(t => `<button type="button" class="abgm-fs-tag menu_button" data-tag="${escapeHtml(t)}" title="${escapeHtml(t)}">#${escapeHtml(tagPretty(t))}</button>`).join("")}
        </div>
      </div>
    `;

    listEl.appendChild(row);
  }
}

// ===== FreeSources UI state =====
function renderFsAll(root, settings) {
  // tab active UI
  root.querySelectorAll(".abgm-fs-tab")?.forEach?.((b) => {
    const t = String(b.dataset.tab || "");
    const on = t === String(settings.fsUi?.tab || "free");
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });

  // search ui
  const search = root.querySelector("#abgm_fs_search");
  if (search) search.value = String(settings.fsUi?.search ?? "");

  // cat active UI
  const cur = String(settings?.fsUi?.cat || "all");
  root.querySelectorAll(".abgm-fs-cat")?.forEach?.((b) => {
    b.classList.toggle("is-active", String(b.dataset.cat || "all") === cur);
  });

  renderFsTagPicker(root, settings);
  renderFsList(root, settings);
  renderFsPreviewVol(root, settings);
}

function renderFsPreviewVol(root, settings) {
  const range = root.querySelector("#abgm_fs_prevvol");
  const valEl = root.querySelector("#abgm_fs_prevvol_val");
  const lockBtn = root.querySelector("#abgm_fs_prevvol_lock");
  const lockIcon = lockBtn?.querySelector?.("i");
  if (!range) return;

  const v100 = fsGetPreviewVol100(settings);
  const locked = fsGetPreviewLock(settings);

  range.value = String(v100);
  range.disabled = !!locked;
  if (valEl) valEl.textContent = `${v100}%`;
  if (lockIcon) lockIcon.className = `fa-solid ${locked ? "fa-lock" : "fa-lock-open"}`;
  if (lockBtn) lockBtn.classList.toggle("abgm-locked", !!locked);
}

// open/close
function closeFreeSourcesModal() {
  const overlay = document.getElementById(FS_OVERLAY_ID);
  if (overlay) overlay.remove();
  window.removeEventListener("keydown", abgmFsOnEsc);
}

function abgmFsOnEsc(e) {
  if (e.key === "Escape") closeFreeSourcesModal();
}

// main
async function openFreeSourcesModal() {
  await syncFreeSourcesFromJson({ force: true, save: true });
  if (document.getElementById(FS_OVERLAY_ID)) return;

  let html = "";
  try {
    html = await loadHtml("templates/freesources.html");
  } catch (e) {
    console.error("[AutoBGM] freesources.html load failed", e);
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = FS_OVERLAY_ID;
  overlay.className = "autobgm-overlay"; // 니 기존 overlay css 재활용
  overlay.innerHTML = html;

  // 바깥 클릭 닫기(원하면)
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeFreeSourcesModal();
  });

  const host = getModalHost();
  const cs = getComputedStyle(host);
  if (cs.position === "static") host.style.position = "relative";

  // overlay 스타일(니 openModal 스타일이랑 맞춤)
  const setO = (k, v) => overlay.style.setProperty(k, v, "important");
  setO("position", "absolute");
  setO("inset", "0");
  setO("display", "block");
  setO("overflow", "auto");
  setO("-webkit-overflow-scrolling", "touch");
  setO("background", "rgba(0,0,0,.55)");
  setO("z-index", "2147483647");
  setO("padding", "0");

  host.appendChild(overlay);
  window.addEventListener("keydown", abgmFsOnEsc);

  await initFreeSourcesModal(overlay);
  console.log("[AutoBGM] freesources modal opened");
}

async function initFreeSourcesModal(overlay) {
  const settings = ensureSettings();
  await syncBundledFreeSourcesIntoSettings(settings, { force: true, save: true });

  const root = overlay;

  root.addEventListener("scroll", () => fsRelayoutTagPicker(root), true);
  window.addEventListener("resize", () => fsRelayoutTagPicker(root));

  // close btn
  root.querySelector(".abgm-fs-close")?.addEventListener("click", closeFreeSourcesModal);

  // tab switch
  root.querySelectorAll(".abgm-fs-tab")?.forEach?.((btn) => {
    btn.addEventListener("click", () => {
      settings.fsUi.tab = String(btn.dataset.tab || "free");
      settings.fsUi.search = "";
      settings.fsUi.selectedTags = [];
      settings.fsUi.cat = "all";

      // picker 닫기
      const picker = root.querySelector("#abgm_fs_tag_picker");
      if (picker) picker.style.display = "none";

      saveSettingsDebounced();
      renderFsAll(root, settings);
    });
  });

  // category click => dropdown toggle
  root.querySelectorAll(".abgm-fs-cat")?.forEach?.((btn) => {
    btn.addEventListener("click", () => {
      const nextCat = String(btn.dataset.cat || "all");
      const picker = root.querySelector("#abgm_fs_tag_picker");
      if (!picker) return;

      const sameCat = String(settings.fsUi.cat || "all") === nextCat;
      const isOpen = picker.style.display !== "none";

      settings.fsUi.cat = nextCat;

      // 같은 카테고리 다시 누르면 닫기 / 아니면 열기
      picker.style.display = (sameCat && isOpen) ? "none" : "block";

      saveSettingsDebounced();
      renderFsAll(root, settings);
    });
  });

  // search
  const search = root.querySelector("#abgm_fs_search");
  search?.addEventListener("input", (e) => {
    settings.fsUi.search = e.target.value || "";
    saveSettingsDebounced();
    renderFsList(root, settings);
  });

  // 프리뷰 볼륨
  const prevRange = root.querySelector("#abgm_fs_prevvol");
  prevRange?.addEventListener("input", (e) => {
    if (fsGetPreviewLock(settings)) return;
    fsSetPreviewVol100(settings, e.target.value);
    saveSettingsDebounced();
    renderFsPreviewVol(root, settings);
    try {
    const v = fsGetPreviewVol100(settings) / 100;
    if (_testAudio && _testAudio.src) _testAudio.volume = Math.max(0, Math.min(1, v));
    } catch {}
  });

  // clear
  root.querySelector("#abgm_fs_clear")?.addEventListener("click", () => {
    settings.fsUi.search = "";
    settings.fsUi.selectedTags = [];
    settings.fsUi.cat = "all";
    const picker = root.querySelector("#abgm_fs_tag_picker");
    if (picker) picker.style.display = "none";
    saveSettingsDebounced();
    renderFsAll(root, settings);
  });

  // ===== event delegation =====
  root.addEventListener("click", (e) => {
    // tag pick toggle (in dropdown)
    const pick = e.target.closest(".abgm-fs-tagpick");
    if (pick && pick.dataset.tag) {
      const t = abgmNormTag(pick.dataset.tag);
      const set = new Set((settings.fsUi.selectedTags ?? []).map(abgmNormTag).filter(Boolean));
      if (set.has(t)) set.delete(t);
      else set.add(t);
      settings.fsUi.selectedTags = Array.from(set);
      saveSettingsDebounced();
      renderFsList(root, settings);
      renderFsTagPicker(root, settings); // 표시만 갱신
      return;
    }

    // item main click => toggle show-tags (actions <-> tags panel)
    const main = e.target.closest(".abgm-fs-main");
    if (main) {
      const row = main.closest(".abgm-fs-item");
      if (!row) return;
      row.classList.toggle("show-tags");
      return;
    }

    // Preview Vol
    const prevLockBtn = e.target.closest("#abgm_fs_prevvol_lock");
    if (prevLockBtn) {
      fsSetPreviewLock(settings, !fsGetPreviewLock(settings));
      saveSettingsDebounced();
      renderFsPreviewVol(root, settings);
      return;
    }

    // play
    const playBtn = e.target.closest(".abgm-fs-play");
    if (playBtn) {
      const src = String(playBtn.dataset.src || "").trim();
      if (!src) return;
      const v = fsGetPreviewVol100(settings) / 100;
      try { playAsset(src, v); } catch {}
      return;
    }

    // copy
    const copyBtn = e.target.closest(".abgm-fs-copy");
    if (copyBtn) {
      const src = String(copyBtn.dataset.src || "").trim();
      if (!src) return;
      navigator.clipboard?.writeText?.(src).catch(() => {});
      return;
    }

    // tag button inside item tagpanel => 필터에 추가(원하면)
    const tagBtn = e.target.closest(".abgm-fs-tag");
    if (tagBtn && tagBtn.dataset.tag) {
      const t = abgmNormTag(tagBtn.dataset.tag);
      const set = new Set((settings.fsUi.selectedTags ?? []).map(abgmNormTag).filter(Boolean));
      set.add(t);
      settings.fsUi.selectedTags = Array.from(set);
      saveSettingsDebounced();
      renderFsList(root, settings);
      return;
    }
  });

  // 밖 클릭하면 picker 닫기(원하면)
  root.addEventListener("mousedown", (e) => {
    const picker = root.querySelector("#abgm_fs_tag_picker");
    if (!picker) return;
    const inPicker = e.target.closest("#abgm_fs_tag_picker");
    const inCat = e.target.closest(".abgm-fs-catbar");
    if (!inPicker && !inCat) picker.style.display = "none";
  }, true);

  renderFsAll(root, settings);
}

// ===============================
// (연결) "BGM List의 MP3 추가 버튼 좌측" 버튼에서 호출만 하면 됨
// 예: root.querySelector("#abgm_open_freesources")?.addEventListener("click", openFreeSourcesModal);
// ===============================

/** ========= UI render ========= */
function getBgmSort(settings) {
  return settings?.ui?.bgmSort ?? "added_asc";
}

function getSortedBgms(preset, sort) {
  const arr = [...(preset?.bgms ?? [])];
  const mode = sort || "added_asc";

  // 우선도 순
  if (mode === "priority_asc" || mode === "priority_desc") {
    const dir = (mode === "priority_desc") ? -1 : 1;

    arr.sort((a, b) => {
      const pa = Number(a?.priority ?? 0);
      const pb = Number(b?.priority ?? 0);

      if (pa !== pb) return (pa - pb) * dir;

      return getEntryName(a).localeCompare(
        getEntryName(b),
        undefined,
        { numeric: true, sensitivity: "base" }
      );
    });

    return arr;
  }

  // 이름순
  if (mode === "name_asc" || mode === "name_desc") {
    arr.sort((a, b) =>
      getEntryName(a).localeCompare(
        getEntryName(b),
        undefined,
        { numeric: true, sensitivity: "base" }
      )
    );
    if (mode === "name_desc") arr.reverse();
    return arr;
  }

  // 추가순
  if (mode === "added_desc") return arr.reverse();
  return arr; // added_asc
}

// 프리셋 선택
function renderPresetSelect(root, settings) {
  const sel = root.querySelector("#abgm_preset_select");
  const nameInput = root.querySelector("#abgm_preset_name");
  if (!sel) return;

  sel.innerHTML = "";

  // 프리셋 이름순 정렬
  const presetsSorted = Object.values(settings.presets).sort((a, b) =>
    String(a?.name ?? a?.id ?? "").localeCompare(
      String(b?.name ?? b?.id ?? ""),
      undefined,
      { numeric: true, sensitivity: "base" }
    )
  );

  presetsSorted.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name || p.id;
    if (p.id === settings.activePresetId) opt.selected = true;
    sel.appendChild(opt);
  });

  if (nameInput) nameInput.value = getActivePreset(settings).name || "";
}

// 디폴트에 이름 뜨는 거 개선
function renderDefaultSelect(root, settings) {
  const preset = getActivePreset(settings);
  const sel = root.querySelector("#abgm_default_select");
  if (!sel) return;

  const cur = String(preset.defaultBgmKey ?? "");
  const list = getSortedBgms(preset, getBgmSort(settings));

  sel.innerHTML = "";

  // (none)
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "(none)";
  sel.appendChild(none);

  // 현재 default가 룰 목록에 없으면(=missing) 옵션을 하나 만들어서 고정 유지
  if (cur && !list.some((b) => String(b.fileKey ?? "") === cur)) {
    const miss = document.createElement("option");
    miss.value = cur;
    miss.textContent = `${cur} (missing rule)`;
    sel.appendChild(miss);
  }

  // rules
  for (const b of list) {
    const fk = String(b.fileKey ?? "").trim();
    if (!fk) continue;

    const opt = document.createElement("option");
    opt.value = fk;

    // 이름 있으면 이름, 없으면 fileKey/URL에서 자동 생성된 표시명
    opt.textContent = getEntryName(b); 
    sel.appendChild(opt);
  }

  sel.value = cur;
}

  // Default 자동 세팅 정책: "그 프리셋에 곡이 처음 들어올 때만" 자동 지정
function maybeSetDefaultOnFirstAdd(preset, newFileKey) {
  const cur = String(preset.defaultBgmKey ?? "").trim();
  if (cur) return; // 이미 default가 있으면 절대 건드리지 않음

  const bgmCount = (preset.bgms ?? []).filter(b => String(b?.fileKey ?? "").trim()).length;

  // "첫 곡"일 때만 default 자동 지정
  if (bgmCount <= 1) {
    preset.defaultBgmKey = String(newFileKey ?? "").trim();
  }
}

function renderBgmTable(root, settings) {
  const preset = getActivePreset(settings);
  const tbody = root.querySelector("#abgm_bgm_tbody");
  if (!tbody) return;

  ensureBgmNames(preset);

  const selected = root?.__abgmSelected instanceof Set ? root.__abgmSelected : new Set();
  root.__abgmSelected = selected;

  const expanded = root?.__abgmExpanded instanceof Set ? root.__abgmExpanded : new Set();
  root.__abgmExpanded = expanded;

  const list = getSortedBgms(preset, getBgmSort(settings));
  tbody.innerHTML = "";

  list.forEach((b) => {
    const isOpen = expanded.has(b.id);

    // ===== summary row (collapsed) =====
    const tr = document.createElement("tr");
    tr.dataset.id = b.id;
    tr.className = `abgm-bgm-summary${isOpen ? " abgm-expanded" : ""}`;
    tr.innerHTML = `
      <td class="abgm-col-check">
        <input type="checkbox" class="abgm_sel" ${selected.has(b.id) ? "checked" : ""}>
      </td>
      <td class="abgm-filecell">
      <input type="text" class="abgm_name" value="${escapeHtml(getEntryName(b))}" placeholder="Entry name">
      </td>

      <td>
        <div class="menu_button abgm-iconbtn abgm_test" title="Play">
          <i class="fa-solid fa-play"></i>
        </div>
      </td>
      <td>
        <div class="menu_button abgm-iconbtn abgm_toggle" title="More">
          <i class="fa-solid fa-chevron-down"></i>
        </div>
      </td>
    `;

    // ===== detail row (expanded) =====
    const tr2 = document.createElement("tr");
    tr2.dataset.id = b.id;
    tr2.className = "abgm-bgm-detail";
    if (!isOpen) tr2.style.display = "none";

    const vol100 = Math.round((b.volume ?? 1) * 100);
    const locked = !!b.volLocked;

    tr2.innerHTML = `
      <td colspan="4">
        <div class="abgm-detail-grid">
          <!-- Keywords (left, taller) -->
          <div class="abgm-keywords">
          <small>Keywords</small>
          <textarea class="abgm_keywords" placeholder="rain, storm...">${escapeHtml(b.keywords ?? "")}</textarea>
          <small class="abgm-src-title">Source</small>

<!-- 좌측 애들 -->
<div class="abgm-source-row" style="display:flex; gap:8px; align-items:center;">
  <input type="text" class="abgm_source" placeholder="file.mp3 or https://..." value="${escapeHtml(b.fileKey ?? "")}" style="flex:1; min-width:0;">
<div class="menu_button abgm-iconbtn abgm_change_mp3" title="Change MP3" style="white-space:nowrap;">
  <i class="fa-solid fa-file-audio"></i>
  </div>
<div class="menu_button abgm-iconbtn abgm_license_btn" title="License / Description" style="white-space:nowrap;">
  <i class="fa-solid fa-file-lines"></i>
</div>

  <!-- 엔트리별 파일선택 input (숨김) -->
  <input type="file" class="abgm_change_mp3_file" accept="audio/mpeg,audio/mp3" style="display:none;">
  </div>
</div>
          <!-- Right stack: Priority (top) / Volume (bottom) -->
          <div class="abgm-side">
            <div class="abgm-field-tight">
              <small>Priority</small>
              <input type="number" class="abgm_priority abgm_narrow" value="${Number(b.priority ?? 0)}" step="1">
            </div>

            <div class="abgm-field-tight">
              <small>Volume</small>
              <div class="abgm-volcell">
                <input type="range" class="abgm_vol" min="0" max="100" value="${vol100}" ${locked ? "disabled" : ""}>
                <input type="number" class="abgm_volnum" min="0" max="100" step="1" value="${vol100}">
                <div class="menu_button abgm-iconbtn abgm_vol_lock" title="Lock slider">
                  <i class="fa-solid ${locked ? "fa-lock" : "fa-lock-open"}"></i>
                </div>
              </div>
            </div>
          </div>

          <!-- Delete (right) -->
          <div class="abgm-detail-actions">
          <div class="menu_button abgm_copy" title="Copy to another preset">
            <i class="fa-solid fa-copy"></i> Copy
          </div>
          <div class="menu_button abgm_move" title="Move to another preset">
            <i class="fa-solid fa-arrow-right-arrow-left"></i> Move
          </div>
          <div class="menu_button abgm_del" title="Delete">
            <i class="fa-solid fa-trash"></i> <span class="abgm-del-label">Delete</span>
            </div>
          </div>
        </div>
      </td>
    `;
    
    tbody.appendChild(tr);
    tbody.appendChild(tr2);
  });
}


function setPlayButtonsLocked(root, locked) {
  root?.querySelectorAll?.(".abgm_test")?.forEach((btn) => {
    btn.classList.toggle("abgm-test-locked", !!locked);
    btn.setAttribute("aria-disabled", locked ? "true" : "false");
    btn.title = locked ? "Disabled in Keyword Mode" : "Play";
  });
}

function rerenderAll(root, settings) {
  renderPresetSelect(root, settings);
  renderDefaultSelect(root, settings);
  renderBgmTable(root, settings);

  // 이건 “함수 안”에 있어야 함
  if (typeof root?.__abgmUpdateSelectionUI === "function") {
    root.__abgmUpdateSelectionUI();
  }
  // KeywordMode 상태에 따라 Play 버튼 잠금/해제
  setPlayButtonsLocked(root, !!settings.keywordMode);
}

/** ========= Preset Import/Export (preset 단위 / 파일은 포함 안 함) ========= */
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getPresetsSortedByName(settings) {
  const arr = Object.values(settings?.presets ?? {});
  arr.sort((a, b) => {
    const an = String(a?.name ?? a?.id ?? "").trim();
    const bn = String(b?.name ?? b?.id ?? "").trim();
    return an.localeCompare(bn, undefined, { numeric: true, sensitivity: "base" });
  });
  return arr;
}

// export는 "룰만" 보냄 (dataUrl 없음)
function exportPresetFile(preset) {
  const clean = {
    id: preset.id,
    name: preset.name,
    defaultBgmKey: preset.defaultBgmKey ?? "",
    bgms: (preset.bgms ?? []).map((b) => ({
      id: b.id,
      fileKey: b.fileKey ?? "",
      name: b.name ?? "", // 엔트리 이름 저장
      keywords: b.keywords ?? "",
      priority: Number(b.priority ?? 0),
      volume: Number(b.volume ?? 1),
      volLocked: !!b.volLocked,
      license: b.license ?? "",
    })),
  };

  return {
    type: "autobgm_preset",
    version: 3,
    exportedAt: new Date().toISOString(),
    preset: clean,
  };
}

function rekeyPreset(preset) {
  const p = clone(preset);

  p.id = uid();
  p.name = (p.name && String(p.name).trim()) ? p.name : "Imported Preset";
  p.defaultBgmKey ??= "";

  p.bgms = (p.bgms ?? []).map((b) => ({
    id: uid(),
    fileKey: b.fileKey ?? "",
    name: b.name ?? "", // 엔트리 이름 복원
    keywords: b.keywords ?? "",
    priority: Number(b.priority ?? 0),
    volume: Number(b.volume ?? 1),
    volLocked: !!b.volLocked,
    license: b.license ?? "",
  }));

  if (!p.defaultBgmKey && p.bgms.length && p.bgms[0].fileKey) {
    p.defaultBgmKey = p.bgms[0].fileKey;
  }

// defaultBgmKey가 bgms에 실제로 존재하는지 보정
if (p.defaultBgmKey && !p.bgms.some(b => b.fileKey === p.defaultBgmKey)) {
  p.defaultBgmKey = p.bgms[0]?.fileKey ?? "";
}

  return p;
  
}
function pickPresetFromImportData(data) {
  if (data?.type === "autobgm_preset" && data?.preset) return data.preset;

  // (구형 전체 설정 파일) 들어오면 activePreset 하나만 뽑아서 import
  if (data?.presets && typeof data.presets === "object") {
    const pid =
      data.activePresetId && data.presets[data.activePresetId]
        ? data.activePresetId
        : Object.keys(data.presets)[0];

    return data.presets?.[pid] ?? null;
  }

  return null;
}

/** ========= Modal logic ========= */
function initModal(overlay) {
  const settings = ensureSettings();
  const root = overlay;

  root.__abgmSelected = new Set();
  root.__abgmExpanded = new Set();

  const updateSelectionUI = () => {
  const preset = getActivePreset(settings);
  const list = getSortedBgms(preset, getBgmSort(settings));
  const selected = root.__abgmSelected;

  const countEl = root.querySelector("#abgm_selected_count");
  if (countEl) countEl.textContent = `${selected.size} selected`;

  const allChk = root.querySelector("#abgm_sel_all");
  if (allChk) {
      const total = list.length;
      const checked = list.filter((b) => selected.has(b.id)).length;
      allChk.checked = total > 0 && checked === total;
      allChk.indeterminate = checked > 0 && checked < total;
    }
  };
  root.__abgmUpdateSelectionUI = updateSelectionUI;

  // 구버전 dataUrl 있으면 IndexedDB로 옮김 (있어도 한번만)
  migrateLegacyDataUrlsToIDB(settings);

  // ===== 상단 옵션 =====
  const kw = root.querySelector("#abgm_keywordMode");
  const dbg = root.querySelector("#abgm_debugMode");
  const pm = root.querySelector("#abgm_playMode");
  const gv = root.querySelector("#abgm_globalVol");
  const gvText = root.querySelector("#abgm_globalVolText");
  const gvLock = root.querySelector("#abgm_globalVol_lock");
  const useDef = root.querySelector("#abgm_useDefault");

  if (kw) kw.checked = !!settings.keywordMode;
  if (dbg) dbg.checked = !!settings.debugMode;
  __abgmDebugMode = !!settings.debugMode;

  if (pm) {
    pm.value = settings.playMode ?? "manual";
    pm.disabled = !!settings.keywordMode;

    pm.addEventListener("change", (e) => {
      settings.playMode = e.target.value;
      saveSettingsDebounced();
    });
  }

  if (kw) {
    kw.addEventListener("change", (e) => {
      settings.keywordMode = !!e.target.checked;
      if (pm) pm.disabled = !!settings.keywordMode;
      // KeywordMode 상태에 따라 Play 버튼 잠금/해제
      setPlayButtonsLocked(root, !!settings.keywordMode);
      saveSettingsDebounced();
    });
  }

  if (dbg) {
    dbg.addEventListener("change", (e) => {
      settings.debugMode = !!e.target.checked;
      __abgmDebugMode = !!settings.debugMode;
      if (!__abgmDebugMode) __abgmDebugLine = "";
      saveSettingsDebounced();
      updateNowPlayingUI();
    });
  }

  // ===== Global Volume + Lock =====
  settings.globalVolLocked ??= false; // 안전빵(ensureSettings에도 넣는게 정석)

  const syncGlobalVolUI = () => {
    const locked = !!settings.globalVolLocked;

    if (gv) gv.disabled = locked;

    if (gvLock) {
      gvLock.classList.toggle("abgm-locked", locked);
      gvLock.title = locked ? "Global Volume Locked" : "Lock Global Volume";

      const icon = gvLock.querySelector("i");
      if (icon) {
        icon.classList.toggle("fa-lock", locked);
        icon.classList.toggle("fa-lock-open", !locked);
      }
    }
  };

  if (gv) gv.value = String(Math.round((settings.globalVolume ?? 0.7) * 100));
  if (gvText) gvText.textContent = gv?.value ?? "70";
  syncGlobalVolUI();

  gv?.addEventListener("input", (e) => {
    if (settings.globalVolLocked) return; // 락이면 입력 무시

    const v = Number(e.target.value);
    settings.globalVolume = Math.max(0, Math.min(1, v / 100));
    if (gvText) gvText.textContent = String(v);

    saveSettingsDebounced();
    engineTick();
  });

  gvLock?.addEventListener("click", () => {
    settings.globalVolLocked = !settings.globalVolLocked;
    saveSettingsDebounced();
    syncGlobalVolUI();
  });

  if (useDef) useDef.checked = !!settings.useDefault;
  useDef?.addEventListener("change", (e) => {
    settings.useDefault = !!e.target.checked;
    saveSettingsDebounced();
  });

  // ===== Sort =====
  const sortSel = root.querySelector("#abgm_sort");
  if (sortSel) {
    sortSel.value = getBgmSort(settings);
    sortSel.addEventListener("change", (e) => {
      settings.ui.bgmSort = e.target.value;
      saveSettingsDebounced();
      rerenderAll(root, settings);
    });
  }

  // ===== select all =====
  root.querySelector("#abgm_sel_all")?.addEventListener("change", (e) => {
    const preset = getActivePreset(settings);
    const list = getSortedBgms(preset, getBgmSort(settings));
    const selected = root.__abgmSelected;

    if (e.target.checked) list.forEach((b) => selected.add(b.id));
    else selected.clear();

    rerenderAll(root, settings);
  });

  // ===== row checkbox =====
  root.querySelector("#abgm_bgm_tbody")?.addEventListener("change", (e) => {
    if (!e.target.classList?.contains("abgm_sel")) return;
    const tr = e.target.closest("tr");
    if (!tr) return;

    const id = tr.dataset.id;
    if (e.target.checked) root.__abgmSelected.add(id);
    else root.__abgmSelected.delete(id);

    updateSelectionUI();
  });

  // ===== License =====
  const licToggle = root.querySelector("#abgm_np_license_toggle");
  const licText = root.querySelector("#abgm_np_license_text");
  licToggle?.addEventListener("click", () => {
    if (!licText) return;
    const on = licText.style.display !== "none";
    licText.style.display = on ? "none" : "block";
  });


  // ===== bulk delete =====
  root.querySelector("#abgm_delete_selected")?.addEventListener("click", async () => {
    const selected = root.__abgmSelected;
    if (!selected.size) return;

    const preset = getActivePreset(settings);

    const names = [];
    for (const id of selected) {
      const bgm = preset.bgms.find((x) => x.id === id);
      if (bgm?.fileKey) names.push(bgm.fileKey);
    }

    const preview = names.slice(0, 6).map((x) => `- ${x}`).join("\n");
    const more = names.length > 6 ? `\n...외 ${names.length - 6}개` : "";
    const ok = await abgmConfirm(root, `선택한 ${names.length}개 BGM 삭제?\n${preview}${more}`, {
      title: "Delete selected",
      okText: "확인",
      cancelText: "취소",
    });
    if (!ok) return;

    const idsToDelete = new Set(selected);
    const removedKeys = [];

    for (const id of idsToDelete) {
      const bgm = preset.bgms.find((x) => x.id === id);
      if (bgm?.fileKey) removedKeys.push(bgm.fileKey);
    }

    preset.bgms = preset.bgms.filter((x) => !idsToDelete.has(x.id));

    if (preset.defaultBgmKey && !preset.bgms.some((b) => b.fileKey === preset.defaultBgmKey)) {
      preset.defaultBgmKey = preset.bgms[0]?.fileKey ?? "";
    }

    selected.clear();

    for (const fk of removedKeys) {
      if (!fk) continue;
      if (isFileKeyReferenced(settings, fk)) continue;
      try { await idbDel(fk); delete settings.assets[fk]; } catch {}
    }

    saveSettingsDebounced();
    rerenderAll(root, settings);
  });

  // ===== bulk reset volume (selected) =====
root.querySelector("#abgm_reset_vol_selected")?.addEventListener("click", async () => {
  const selected = root.__abgmSelected;
  if (!selected?.size) return;

  const preset = getActivePreset(settings);

  const ok = await abgmConfirm(root, `선택한 ${selected.size}개 BGM의 볼륨을 100으로 초기화?`, {
    title: "Reset volume",
    okText: "확인",
    cancelText: "취소",
  });
  if (!ok) return;

  for (const id of selected) {
    const bgm = preset.bgms.find((x) => x.id === id);
    if (!bgm) continue;
    bgm.volume = 1.0;      // 잠겨있어도 볼륨 값은 초기화
    // bgm.volLocked 는 건드리지 않음(요구사항)
  }

  saveSettingsDebounced();
  rerenderAll(root, settings);
  try { engineTick(); } catch {}
});

  // ===== Add empty entry row =====
  root.querySelector("#abgm_bgm_add_row")?.addEventListener("click", () => {
  const preset = getActivePreset(settings);

  preset.bgms ??= [];
  preset.bgms.push({
    id: uid(),
    fileKey: "",          // Source 비어있음 (재생/모드에서 자동 무시됨)
    name: "",             // Entry name도 비어있게 (placeholder 보이게)
    keywords: "",
    priority: 0,
    volume: 1.0,
    volLocked: false,
  });

  saveSettingsDebounced();
  rerenderAll(root, settings);
});

  // ===== Expand/Collapse all =====
  root.querySelector("#abgm_expand_all")?.addEventListener("click", () => {
    const preset = getActivePreset(settings);
    const list = getSortedBgms(preset, getBgmSort(settings));
    list.forEach((b) => root.__abgmExpanded.add(b.id));
    rerenderAll(root, settings);
  });

  root.querySelector("#abgm_collapse_all")?.addEventListener("click", () => {
    root.__abgmExpanded.clear();
    rerenderAll(root, settings);
  });

  // ===== lock all volume sliders =====
  root.querySelector("#abgm_lock_all_vol")?.addEventListener("click", () => {
    const preset = getActivePreset(settings);
    (preset.bgms ?? []).forEach((b) => { b.volLocked = true; });
    saveSettingsDebounced();
    rerenderAll(root, settings);
  });

  // ===== preset select =====
  root.querySelector("#abgm_preset_select")?.addEventListener("change", (e) => {
    settings.activePresetId = e.target.value;
    root.__abgmSelected.clear();
    saveSettingsDebounced();
    rerenderAll(root, settings);
  });

  // ===== preset add/del/rename =====
  root.querySelector("#abgm_preset_add")?.addEventListener("click", () => {
    const id = uid();
    settings.presets[id] = { id, name: "New Preset", defaultBgmKey: "", bgms: [] };
    settings.activePresetId = id;
    saveSettingsDebounced();
    rerenderAll(root, settings);
  });

  root.querySelector("#abgm_preset_del")?.addEventListener("click", async () => {
    const keys = Object.keys(settings.presets);
    if (keys.length <= 1) return;

    const cur = getActivePreset(settings);
    const name = cur?.name || cur?.id || "Preset";

    const ok = await abgmConfirm(root, `"${name}" 프리셋 삭제?`, {
      title: "Delete preset",
      okText: "삭제",
      cancelText: "취소",
    });
    if (!ok) return;

    delete settings.presets[settings.activePresetId];
    settings.activePresetId = Object.keys(settings.presets)[0];

    root.__abgmSelected?.clear?.();
    root.__abgmExpanded?.clear?.();

    saveSettingsDebounced();
    rerenderAll(root, settings);
  });

  // 프리셋 이름 변경
  root.querySelector("#abgm_preset_rename_btn")?.addEventListener("click", async () => {
  const preset = getActivePreset(settings);
  const out = await abgmPrompt(root, `Preset name 변경`, {
    title: "Rename Preset",
    okText: "확인",
    cancelText: "취소",
    resetText: "초기화",
    initialValue: preset?.name ?? "",
    placeholder: "Preset name...",
  });

  if (out === null) return;
  const name = String(out ?? "").trim();
  if (!name) return;

  preset.name = name;
  saveSettingsDebounced();
  rerenderAll(root, settings);
  updateNowPlayingUI();
});

  root.querySelector("#abgm_open_freesources")?.addEventListener("click", openFreeSourcesModal);

  // ===== Preset Binding UI (bind preset to character cards) =====
  const bindOpen = root.querySelector("#abgm_bind_open");
  const bindOverlay = root.querySelector("#abgm_bind_overlay");
  const bindClose = root.querySelector("#abgm_bind_close");
  const bindList = root.querySelector("#abgm_bind_list");
  const bindTitle = root.querySelector("#abgm_bind_title");
  const bindSub = root.querySelector("#abgm_bind_sub");

  const hideBindOverlay = () => {
    if (bindOverlay) bindOverlay.style.display = "none";
  };

  const renderBindOverlay = async () => {
    if (!bindList) return;

    const settingsNow = ensureSettings();
    const preset = getActivePreset(settingsNow);
    const presetId = String(preset?.id ?? "");
    const presetName = String(preset?.name ?? presetId);

    if (bindTitle) bindTitle.textContent = `Bind Preset → Characters`;
    if (bindSub) bindSub.textContent = `"${presetName}" 프리셋을 연결할 캐릭터를 선택`;

    const ctx = getSTContextSafe();
    const chars = ctx?.characters;
    const writeExtensionField = ctx?.writeExtensionField;

    bindList.innerHTML = "";

    if (!chars || !Array.isArray(chars) || typeof writeExtensionField !== "function") {
      const p = document.createElement("div");
      p.style.opacity = ".8";
      p.style.fontSize = "12px";
      p.style.padding = "10px";
      p.textContent = "SillyTavern 컨텍스트를 못 불러옴 (getContext/writeExtensionField 없음)";
      bindList.appendChild(p);
      return;
    }

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (!ch) continue;

      const name =
        String(ch.name ?? ch?.data?.name ?? ch?.data?.first_mes ?? `Character #${i}`).trim() || `Character #${i}`;

      const boundId = String(ch?.data?.extensions?.[EXT_BIND_KEY]?.presetId ?? "");
      const boundName = boundId && settingsNow.presets?.[boundId] ? String(settingsNow.presets[boundId].name ?? boundId) : (boundId || "");

      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      row.style.padding = "8px 10px";
      row.style.border = "1px solid rgba(255,255,255,.12)";
      row.style.borderRadius = "10px";
      row.style.background = "rgba(0,0,0,.18)";

      const mainBtn = document.createElement("button");
      mainBtn.type = "button";
      mainBtn.className = "menu_button";
      mainBtn.style.flex = "1";
      mainBtn.style.textAlign = "left";
      mainBtn.style.whiteSpace = "nowrap";
      mainBtn.style.overflow = "hidden";
      mainBtn.style.textOverflow = "ellipsis";
      mainBtn.textContent = boundId ? `${name}  ·  (Bound: ${boundName || boundId})` : `${name}  ·  (Not bound)`;

      mainBtn.addEventListener("click", async () => {
        try {
          await writeExtensionField(i, EXT_BIND_KEY, { presetId, presetName, at: Date.now() });
        } catch (e) {
          console.error("[AutoBGM] bind failed", e);
        }
        await renderBindOverlay();
        try { engineTick(); } catch {}
      });

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "menu_button";
      clearBtn.textContent = "Unbind";
      clearBtn.style.flex = "0 0 auto";
      clearBtn.style.opacity = boundId ? "1" : ".5";
      clearBtn.disabled = !boundId;

      clearBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        try {
          await writeExtensionField(i, EXT_BIND_KEY, null);
        } catch {
          try { await writeExtensionField(i, EXT_BIND_KEY, {}); } catch {}
        }
        await renderBindOverlay();
        try { engineTick(); } catch {}
      });

      row.appendChild(mainBtn);
      row.appendChild(clearBtn);
      bindList.appendChild(row);
    }
  };

  const showBindOverlay = async () => {
    if (!bindOverlay) return;
    bindOverlay.style.display = "flex";
    await renderBindOverlay();
  };

  bindOpen?.addEventListener("click", showBindOverlay);
  bindClose?.addEventListener("click", hideBindOverlay);
  bindOverlay?.addEventListener("click", (e) => {
    if (e.target === bindOverlay) hideBindOverlay();
  });

// ===== MP3 add =====
  const mp3Input = root.querySelector("#abgm_bgm_file");
  root.querySelector("#abgm_bgm_add")?.addEventListener("click", () => mp3Input?.click());

  mp3Input?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const preset = getActivePreset(settings);
    const fileKey = file.name;

    await idbPut(fileKey, file);
    const durationSec = await abgmGetDurationSecFromBlob(file);
    const assets = ensureAssetList(settings);
    assets[fileKey] = { fileKey, label: fileKey.replace(/\.mp3$/i, "") };

    const exists = preset.bgms.some((b) => b.fileKey === fileKey);
    if (!exists) {
      preset.bgms.push({
        id: uid(),
        fileKey,
        name: basenameNoExt(fileKey),
        keywords: "",
        priority: 0,
        volume: 1.0,
        volLocked: false,
        durationSec,
      });
    }

    maybeSetDefaultOnFirstAdd(preset, fileKey);

    e.target.value = "";
    saveSettingsDebounced();
    rerenderAll(root, settings);
  });

  // ===== ZIP add =====
  const zipInput = root.querySelector("#abgm_zip_file");
  root.querySelector("#abgm_zip_add")?.addEventListener("click", () => zipInput?.click());

  zipInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const importedKeys = await importZip(file, settings);
      const preset = getActivePreset(settings);

      for (const fk of importedKeys) {
        if (!preset.bgms.some((b) => b.fileKey === fk)) {
          preset.bgms.push({
            id: uid(),
            fileKey: fk,
            name: basenameNoExt(fk),
            keywords: "",
            priority: 0,
            volume: 1.0,
            volLocked: false,
          });
        }
      }
      
      let firstAddedKey = "";
      for (const fk of importedKeys) {
        if (!firstAddedKey) firstAddedKey = fk;
          // bgm push 로직...
        }
      maybeSetDefaultOnFirstAdd(preset, firstAddedKey);

      saveSettingsDebounced();
      rerenderAll(root, settings);
    } catch (err) {
      console.error("[AutoBGM] zip import failed:", err);
      console.warn("[AutoBGM] vendor/jszip.min.js 없으면 zip 안 됨");
    } finally {
      e.target.value = "";
    }
  });

  // ===== default select =====
  root.querySelector("#abgm_default_select")?.addEventListener("change", (e) => {
    const preset = getActivePreset(settings);
    preset.defaultBgmKey = e.target.value;
    saveSettingsDebounced();
  });

  // ===== tbody input =====
  root.querySelector("#abgm_bgm_tbody")?.addEventListener("input", (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;

    const id = tr.dataset.id;
    const preset = getActivePreset(settings);
    const bgm = preset.bgms.find((x) => x.id === id);
    if (!bgm) return;

    if (e.target.classList.contains("abgm_keywords")) bgm.keywords = e.target.value;
    if (e.target.classList.contains("abgm_priority")) bgm.priority = Number(e.target.value || 0);
    
    // 엔트리 이름 개선
    if (e.target.classList.contains("abgm_name")) {
      bgm.name = String(e.target.value || "").trim();
      updateNowPlayingUI(); // 엔트리 이름 바꾸면 Now Playing도 즉시 갱신
      renderDefaultSelect(root, settings); // Default 셀렉트에 엔트리 이름 표시하려면 즉시 재렌더
      saveSettingsDebounced();
      return;
    }

// Source (정규화된 거)
if (e.target.classList.contains("abgm_source")) {
  const oldKey = String(bgm.fileKey ?? "");

  let newKey = String(e.target.value || "").trim();
  newKey = dropboxToRaw(newKey);     // 여기
  e.target.value = newKey;           // 입력창도 변환된 걸로 보여주기

  bgm.fileKey = newKey;

  if (oldKey && preset.defaultBgmKey === oldKey) {
    preset.defaultBgmKey = newKey;
  }

  saveSettingsDebounced();
  renderDefaultSelect(root, settings);
  return;
}

    const detailRow = tr.classList.contains("abgm-bgm-detail") ? tr : tr.closest("tr.abgm-bgm-detail") || tr;

    if (e.target.classList.contains("abgm_vol")) {
      if (bgm.volLocked) return;
      const v = Math.max(0, Math.min(100, Number(e.target.value || 100)));
      bgm.volume = v / 100;
      engineTick();
      const n = detailRow.querySelector(".abgm_volnum");
      if (n) n.value = String(v);
    }

    if (e.target.classList.contains("abgm_volnum")) {
      const v = Math.max(0, Math.min(100, Number(e.target.value || 100)));
      bgm.volume = v / 100;
      engineTick();
      if (!bgm.volLocked) {
        const r = detailRow.querySelector(".abgm_vol");
        if (r) r.value = String(v);
      }
    }

    saveSettingsDebounced();
  });

  // ===== tbody click (toggle/lock/del/test) =====
  root.querySelector("#abgm_bgm_tbody")?.addEventListener("click", async (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;

    // toggle
    if (e.target.closest(".abgm_toggle")) {
      const summary = tr.classList.contains("abgm-bgm-summary") ? tr : tr.closest("tr.abgm-bgm-summary");
      if (!summary) return;

      const id = summary.dataset.id;
      const open = !root.__abgmExpanded.has(id);

      if (open) root.__abgmExpanded.add(id);
      else root.__abgmExpanded.delete(id);

      const detail = summary.nextElementSibling;
      summary.classList.toggle("abgm-expanded", open);

      if (detail?.classList?.contains("abgm-bgm-detail")) {
        detail.style.display = open ? "" : "none";
      } else {
        rerenderAll(root, settings);
      }
      return;
    }

    // id/bgm
    const id = tr.dataset.id;
    const preset = getActivePreset(settings);
    const bgm = preset.bgms.find((x) => x.id === id);
    if (!bgm) return;

      // license / description edit
if (e.target.closest(".abgm_license_btn")) {
  const current = String(bgm.license ?? "");
  const out = await abgmPrompt(root, `License / Description (이 엔트리에만 저장됨)`, {
    title: "License / Description",
    okText: "확인",
    cancelText: "취소",
    resetText: "초기화",
    initialValue: current,
    placeholder: "예) CC BY 4.0 / 출처 링크 / 사용조건 요약...",
  });

  // 취소면 null
  if (out === null) return;
  bgm.license = String(out ?? "").trim();
  saveSettingsDebounced();
  try { updateNowPlayingUI(); } catch {}
  return;
}

    // change mp3 (swap only this entry's asset)
if (e.target.closest(".abgm_change_mp3")) {
  const detailRow = tr.classList.contains("abgm-bgm-detail")
    ? tr
    : tr.closest("tr.abgm-bgm-detail") || tr;

  const fileInput = detailRow.querySelector(".abgm_change_mp3_file");
  if (!fileInput) return;

  // 이 엔트리의 id를 fileInput에 기억시켜둠
  fileInput.dataset.bgmId = String(id);
  fileInput.click();
  return;
}

    // lock volume
    if (e.target.closest(".abgm_vol_lock")) {
      bgm.volLocked = !bgm.volLocked;

      const detailRow = tr.classList.contains("abgm-bgm-detail") ? tr : tr.closest("tr.abgm-bgm-detail") || tr;
      const range = detailRow.querySelector(".abgm_vol");
      const icon = detailRow.querySelector(".abgm_vol_lock i");

      if (range) range.disabled = !!bgm.volLocked;
      if (icon) icon.className = `fa-solid ${bgm.volLocked ? "fa-lock" : "fa-lock-open"}`;

      saveSettingsDebounced();
      return;
    }

    // copy
if (e.target.closest(".abgm_copy")) {
  const curPreset = getActivePreset(settings);
  const targetId = await abgmPickPreset(root, settings, {
    title: "Copy entry",
    message: "복사할 프리셋 선택",
    okText: "확인",
    cancelText: "취소",
  });
  if (!targetId) return;

  const target = settings.presets?.[targetId];
  if (!target) return;

  target.bgms ??= [];
  target.bgms.push({
    ...clone(bgm),
    id: uid(), // 복사면 새 id
  });

  // target default 비어있으면 "자동으로" 바꾸고 싶냐? -> 난 비추라서 안 함
  saveSettingsDebounced();
  // 현재 화면 프리셋은 그대로니까 그냥 UI 갱신만
  rerenderAll(root, settings);
  return;
}

// Entry move
if (e.target.closest(".abgm_move")) {
  const curPreset = getActivePreset(settings);
  const targetId = await abgmPickPreset(root, settings, {
    title: "Move entry",
    message: "이동할 프리셋 선택",
    okText: "확인",
    cancelText: "취소",
    excludePresetId: curPreset.id,
  });
  if (!targetId) return;

  const target = settings.presets?.[targetId];
  if (!target) return;

  target.bgms ??= [];
  target.bgms.push({
    ...clone(bgm),
    id: uid(), // 이동도 새 id로 안전빵(겹침 방지)
  });

  // 원본에서 제거
  const fileKey = bgm.fileKey;
  curPreset.bgms = (curPreset.bgms ?? []).filter((x) => x.id !== id);

  // default가 옮긴 항목이었다면 보정
  if (curPreset.defaultBgmKey === fileKey) {
    curPreset.defaultBgmKey = curPreset.bgms[0]?.fileKey ?? "";
  }

  root.__abgmSelected?.delete(id);
  saveSettingsDebounced();
  rerenderAll(root, settings);
  return;
}

    // delete
    if (e.target.closest(".abgm_del")) {
      const fk = bgm.fileKey || "(unknown)";
      const ok = await abgmConfirm(root, `"${fk}" 삭제?`, {
        title: "Delete",
        okText: "확인",
        cancelText: "취소",
      });
      if (!ok) return;

      root.__abgmSelected?.delete(id);
      const fileKey = bgm.fileKey;

      preset.bgms = preset.bgms.filter((x) => x.id !== id);

      if (preset.defaultBgmKey === fileKey) {
        preset.defaultBgmKey = preset.bgms[0]?.fileKey ?? "";
      }

      if (fileKey && !isFileKeyReferenced(settings, fileKey)) {
        try {
          await idbDel(fileKey);
          delete settings.assets[fileKey];
        } catch {}
      }

      saveSettingsDebounced();
      rerenderAll(root, settings);
      return;
    }

    // test / runtime play
    if (e.target.closest(".abgm_test")) {
      if (settings.keywordMode) return; // 키워드 모드에서는 개별 재생 금지

      settings.playMode = "manual";
      if (pm) { pm.value = "manual"; pm.disabled = false; }

      const ctx = getSTContextSafe();
      const chatKey = getChatKeyFromContext(ctx);
      settings.chatStates ??= {};
      settings.chatStates[chatKey] ??= { currentKey: "", listIndex: 0 };
      settings.chatStates[chatKey].currentKey = bgm.fileKey;

      saveSettingsDebounced();
      return;
    }
  });

  // file picker change (per-entry mp3 swap)
root.querySelector("#abgm_bgm_tbody")?.addEventListener("change", async (e) => {
  if (!e.target.classList?.contains("abgm_change_mp3_file")) return;

  const file = e.target.files?.[0];
  const bgmId = String(e.target.dataset.bgmId || "");
  e.target.value = ""; // 같은 파일 다시 선택 가능하게

  if (!file || !bgmId) return;

  const preset = getActivePreset(settings);
  const bgm = preset.bgms.find((x) => String(x.id) === bgmId);
  if (!bgm) return;

  const oldKey = String(bgm.fileKey ?? "");
  const newKey = String(file.name ?? "").trim();
  if (!newKey) return;

  try {
    // 새 파일 저장
    await idbPut(newKey, file);
    const assets = ensureAssetList(settings);
    assets[newKey] = { fileKey: newKey, label: newKey.replace(/\.mp3$/i, "") };

    // 엔트리 소스 교체
    bgm.fileKey = newKey;

    // default 최초만 따라가게
    if (oldKey && preset.defaultBgmKey === oldKey) {
  preset.defaultBgmKey = newKey;
}

    // oldKey가 더 이상 참조 안 되면 정리(선택)
    if (oldKey && oldKey !== newKey && !isFileKeyReferenced(settings, oldKey)) {
      try { await idbDel(oldKey); delete settings.assets[oldKey]; } catch {}
    }

    saveSettingsDebounced();
    rerenderAll(root, settings);
    try { engineTick(); } catch {}
  } catch (err) {
    console.error("[AutoBGM] change mp3 failed:", err);
  }
});

  // ===== Import/Export (preset 1개: 룰만) =====
  const importFile = root.querySelector("#abgm_import_file");
  root.querySelector("#abgm_import")?.addEventListener("click", () => importFile?.click());

  importFile?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const incomingPresetRaw = pickPresetFromImportData(data);
      if (!incomingPresetRaw) return;

      const incomingPreset = rekeyPreset(incomingPresetRaw);

      const names = new Set(Object.values(settings.presets).map((p) => p.name));
      if (names.has(incomingPreset.name)) incomingPreset.name = `${incomingPreset.name} (imported)`;

      settings.presets[incomingPreset.id] = incomingPreset;
      settings.activePresetId = incomingPreset.id;

      saveSettingsDebounced();
      rerenderAll(root, settings);
    } catch (err) {
      console.error("[AutoBGM] import failed", err);
    } finally {
      e.target.value = "";
    }
  });

  root.querySelector("#abgm_export")?.addEventListener("click", () => {
    const preset = getActivePreset(settings);
    const out = exportPresetFile(preset);

    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${(String(preset.name || preset.id || "Preset").trim() || "Preset")
      .replace(/[\\\/:*?"<>|]+/g, "")
      .replace(/[._-]+$/g, "")}_AutoBGM.json`;
    a.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // ===== Free Sources button bind =====
  const freeBtn = root.querySelector("#abgm_free_open"); // popup.html 버튼 id
  if (freeBtn && freeBtn.dataset.bound !== "1") {
    freeBtn.dataset.bound = "1";
    freeBtn.addEventListener("click", () => {
      openFreeSourcesModal(root);
    });
  }

  // ===== 헬프 토글 =====
  function setupHelpToggles(root) {
  // 버튼ID : 박스ID
  const helps = [
    ["abgm_modal_help_toggle", "abgm_modal_help"],
    ["abgm_preset_help_toggle", "abgm_preset_help"],
    ["abgm_bgm_help_toggle", "abgm_bgm_help"],
    ["abgm_bgm_entry_help_toggle", "abgm_bgm_entry_help"],
  ];

  const boxes = helps
    .map(([, boxId]) => root.querySelector(`#${boxId}`))
    .filter(Boolean);

  function closeAll(exceptEl = null) {
    for (const el of boxes) {
      if (exceptEl && el === exceptEl) continue;
      el.style.display = "none";
    }
  }

  for (const [btnId, boxId] of helps) {
    const btn = root.querySelector(`#${btnId}`);
    const box = root.querySelector(`#${boxId}`);
    if (!btn || !box) continue;

    // 중복 바인딩 방지
    if (btn.dataset.abgmHelpBound === "1") continue;
    btn.dataset.abgmHelpBound = "1";
    
    // 초기 안전빵
    if (!box.style.display) box.style.display = "none";

    btn.addEventListener("click", () => {
      const isOpen = box.style.display !== "none";
      if (isOpen) {
        box.style.display = "none";
      } else {
        closeAll(box);     // 나 말고 다 닫기
        box.style.display = "block";
      }
    });
  }
  // 옵션: 밖(빈 곳) 클릭하면 다 닫기 하고 싶으면 이거 추가
  // root.addEventListener("click", (e) => { ... });
}

  // 키보드/주소창 변화 대응
  overlay.addEventListener("focusin", () => {
    requestAnimationFrame(() => fitModalToHost(overlay, getModalHost()));
    setTimeout(() => fitModalToHost(overlay, getModalHost()), 120);
  });
  rerenderAll(root, settings);
  setupHelpToggles(root);
} // initModal 닫기

/** ========= Side menu mount 마운트 ========= */
async function mount() {
  const host = document.querySelector("#extensions_settings");
  if (!host) return;

  // 이미 붙었으면 끝
  if (document.getElementById("autobgm-root")) return;

  // mount 레이스 방지 (핵심)
  if (window.__AUTOBGM_MOUNTING__) return;
  window.__AUTOBGM_MOUNTING__ = true;

  try {
    const settings = ensureSettings();

    let html;
    try {
      html = await loadHtml("templates/window.html");
    } catch (e) {
      console.error("[AutoBGM] window.html load failed", e);
      return;
    }

    // 혹시 레이스로 여기 도달 전에 다른 mount가 붙였으면 종료
    if (document.getElementById("autobgm-root")) return;

    const root = document.createElement("div");
    root.id = "autobgm-root";
    root.innerHTML = html;
    host.appendChild(root);

    // ===== side-menu Now Playing controls bind =====
    const btnDef = root.querySelector("#autobgm_now_btn_default");
    const btnPlay = root.querySelector("#autobgm_now_btn_play");
    const btnMode = root.querySelector("#autobgm_now_btn_mode");
    const btnOnce = root.querySelector("#autobgm_now_btn_kwonce");

    const syncKeywordOnceUI = () => {
      const s = ensureSettings();
      if (!btnOnce) return;

      // 키워드 모드 아닐 땐 숨김
      btnOnce.style.display = s.keywordMode ? "" : "none";

      btnOnce.textContent = s.keywordOnce ? "1️⃣" : "🔁";
      btnOnce.title = s.keywordOnce ? "Keyword: Once" : "Keyword: Loop";
    };

    btnOnce?.addEventListener("click", () => {
      const s = ensureSettings();
      if (!s.enabled) return;

      s.keywordOnce = !s.keywordOnce;
      saveSettingsDebounced();
      syncKeywordOnceUI();
      try { engineTick(); } catch {}
      updateNowPlayingUI();
    });

    // 처음 한번 UI 맞추기
    syncKeywordOnceUI();

    // Use Default 토글 (keywordMode일 때만 의미 있음)
    btnDef?.addEventListener("click", () => {
      const s = ensureSettings();
      s.useDefault = !s.useDefault;
      saveSettingsDebounced();
      try { engineTick(); } catch {}
      updateNowPlayingUI();
    });

    // Play/Pause/Start
    btnPlay?.addEventListener("click", async () => {
      const s = ensureSettings();
      if (!s.enabled) return;

      // 현재 재생중이면 pause
      if (_engineCurrentFileKey && !_bgmAudio.paused) {
        try { _bgmAudio.pause(); } catch {}
        updateNowPlayingUI();
        return;
      }

      // paused면 resume
      if (_engineCurrentFileKey && _bgmAudio.paused) {
        try { await _bgmAudio.play(); } catch {}
        updateNowPlayingUI();
        return;
      }

      // stopped면 엔진 로직대로 “알아서” 시작
      try { engineTick(); } catch {}
      updateNowPlayingUI();
    });

    // Mode cycle: manual → loop_one → loop_list → random → keyword → manual ...
    btnMode?.addEventListener("click", () => {
      const s = ensureSettings();
      if (!s.enabled) return;

      const next = (() => {
        if (s.keywordMode) return "manual";
        const cur = s.playMode || "manual";
        if (cur === "manual") return "loop_one";
        if (cur === "loop_one") return "loop_list";
        if (cur === "loop_list") return "random";
        if (cur === "random") return "keyword";
        return "manual";
      })();

      if (next === "keyword") {
        s.keywordMode = true;
        // keywordMode면 playMode는 의미 적지만 혹시 모르니 남겨둠
      } else {
        s.keywordMode = false;
        s.playMode = next; // manual/loop_one/loop_list/random
      }

      saveSettingsDebounced();
      try { engineTick(); } catch {}
      updateNowPlayingUI();
      syncKeywordOnceUI();
    });

    const helpBtn = root.querySelector("#autobgm_help_toggle");
    const helpText = root.querySelector("#autobgm_help_text");
    
    const enabledBtn = root.querySelector("#autobgm_enabled_btn");
    const enabledState = root.querySelector("#autobgm_enabled_state");
    const enabledIcon = root.querySelector("#autobgm_enabled_icon");
    const openBtn = root.querySelector("#autobgm_open");
    const debugBtn = root.querySelector("#autobgm_debug_btn");
    
    if (!enabledBtn || !enabledState || !openBtn) return;
    
    const syncEnabledUI = () => {
      const on = !!settings.enabled;
      enabledState.textContent = on ? "On" : "Off";
      
      if (enabledIcon) {
    // on/off 아이콘 바꾸기 (원하면 다른 아이콘 사용 가능)
    enabledIcon.classList.toggle("fa-toggle-off", !on);
    enabledIcon.classList.toggle("fa-toggle-on", on);
  }
};

    const syncDebugUI = () => {
      const s = ensureSettings();
      const on = !!s.debugMode;
      if (!debugBtn) return;
      
      debugBtn.classList.toggle("abgm-debug-on", on);
      debugBtn.title = on ? "Debug: ON" : "Debug: OFF";

      const icon = debugBtn.querySelector("i");
      if (icon) {
        icon.classList.toggle("fa-bug", !on);
        icon.classList.toggle("fa-bug-slash", on); // 싫으면 이 줄 빼고 bug만 써도 됨
      }
    };

    syncEnabledUI();
    syncDebugUI();
    
    enabledBtn.addEventListener("click", () => {
      settings.enabled = !settings.enabled;
      saveSettingsDebounced();
      syncEnabledUI();
      try { engineTick(); } catch {}
      updateNowPlayingUI(); // 이거도 같이 해주는 게 깔끔
      syncDebugUI();
    });

    debugBtn?.addEventListener("click", () => {
      const s = ensureSettings();
      s.debugMode = !s.debugMode;
      __abgmDebugMode = !!s.debugMode;
      
      if (!__abgmDebugMode) __abgmDebugLine = ""; // 끌 때 즉시 비우기
      
      saveSettingsDebounced();
      syncDebugUI();
      updateNowPlayingUI();
    });

    // Floating 버튼 토글
    const floatingToggle = root.querySelector("#autobgm_floating_toggle");
    const syncFloatingUI = () => {
      const s = ensureSettings();
      const on = !!s.floating.enabled;
      if (!floatingToggle) return;

      const stateEl = floatingToggle.querySelector(".autobgm-menu-state");
      if (stateEl) stateEl.textContent = on ? "On" : "Off";
    };

    syncFloatingUI();

    floatingToggle?.addEventListener("click", () => {
      const s = ensureSettings();
      s.floating.enabled = !s.floating.enabled;
      saveSettingsDebounced();
      syncFloatingUI();

      if (s.floating.enabled) {
        createFloatingButton();
      } else {
        removeFloatingButton();
      }
    });
    
    helpBtn?.addEventListener("click", () => {
      if (!helpText) return;
      const on = helpText.style.display !== "none";
      helpText.style.display = on ? "none" : "block";
    });
    
    openBtn.addEventListener("click", () => openModal());

    bindNowPlayingEventsOnce();
    updateNowPlayingUI();

    console.log("[AutoBGM] mounted OK");
  } finally {
    window.__AUTOBGM_MOUNTING__ = false;
  }
}

// 프리소스 관련
async function bootstrapDataOnce() {
  if (window.__AUTOBGM_FS_BOOTSTRAPPED__) return;
  window.__AUTOBGM_FS_BOOTSTRAPPED__ = true;

  const settings = ensureSettings(); // 기존 거 그대로 사용
  await mergeBundledFreeSourcesIntoSettings(settings);
}

/** ========= Floating Button ========= */
let _floatingBtn = null;
let _floatingDragging = false;
let _floatingDragOffset = { x: 0, y: 0 };

function createFloatingButton() {
  if (_floatingBtn) return _floatingBtn;

  const settings = ensureSettings();
  
  const btn = document.createElement("div");
  btn.id = "abgm_floating_btn";
  btn.className = "abgm-floating-btn";
btn.innerHTML = `
  <div class="abgm-floating-icon">
    <img src="data:image/png;base64,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" 
         style="width:100%; height:100%; border-radius:50%; object-fit:cover;" 
         alt="AutoBGM">
  </div>
`;

  // 초기 위치
  const x = settings.floating.x ?? window.innerWidth - 40;
  const y = settings.floating.y ?? window.innerHeight - 100;
  btn.style.left = `${x}px`;
  btn.style.top = `${y}px`;

  // 드래그 시작
  btn.addEventListener("mousedown", onDragStart);
  btn.addEventListener("touchstart", onDragStart, { passive: false });

  document.body.appendChild(btn);
  _floatingBtn = btn;
  return btn;
}

function removeFloatingButton() {
  if (_floatingBtn) {
    _floatingBtn.remove();
    _floatingBtn = null;
  }
}

function onDragStart(e) {
  e.preventDefault();
  _floatingDragging = true;

  const rect = _floatingBtn.getBoundingClientRect();
  const clientX = e.type.startsWith("touch") ? e.touches[0].clientX : e.clientX;
  const clientY = e.type.startsWith("touch") ? e.touches[0].clientY : e.clientY;

  _floatingDragOffset.x = clientX - rect.left;
  _floatingDragOffset.y = clientY - rect.top;

  _floatingBtn.classList.add("dragging");

  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("touchmove", onDragMove, { passive: false });
  document.addEventListener("mouseup", onDragEnd);
  document.addEventListener("touchend", onDragEnd);
}

function onDragMove(e) {
  if (!_floatingDragging) return;
  e.preventDefault();

  const clientX = e.type.startsWith("touch") ? e.touches[0].clientX : e.clientX;
  const clientY = e.type.startsWith("touch") ? e.touches[0].clientY : e.clientY;

  let x = clientX - _floatingDragOffset.x;
  let y = clientY - _floatingDragOffset.y;

  // 화면 밖 방지
  const w = _floatingBtn.offsetWidth;
  const h = _floatingBtn.offsetHeight;
  x = Math.max(-w / 2, Math.min(window.innerWidth - w / 2, x));
  y = Math.max(0, Math.min(window.innerHeight - h, y));

  _floatingBtn.style.left = `${x}px`;
  _floatingBtn.style.top = `${y}px`;
}

function onDragEnd(e) {
  if (!_floatingDragging) return;
  _floatingDragging = false;
  _floatingBtn.classList.remove("dragging");

  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("touchmove", onDragMove);
  document.removeEventListener("mouseup", onDragEnd);
  document.removeEventListener("touchend", onDragEnd);

  // 벽에 스냅
  snapToEdge();

  // 위치 저장
  const settings = ensureSettings();
  const rect = _floatingBtn.getBoundingClientRect();
  settings.floating.x = rect.left;
  settings.floating.y = rect.top;
  saveSettingsDebounced();
}

function snapToEdge() {
  const rect = _floatingBtn.getBoundingClientRect();
  const w = rect.width;
  const centerX = rect.left + w / 2;

  let targetX = rect.left;

  // 좌/우 중 가까운 쪽으로
  if (centerX < window.innerWidth / 2) {
    // 좌측 벽에 반쯤 걸치게
    targetX = -w / 2;
  } else {
    // 우측 벽에 반쯤 걸치게
    targetX = window.innerWidth - w / 2;
  }

  _floatingBtn.style.transition = "left 0.2s ease-out";
  _floatingBtn.style.left = `${targetX}px`;

  setTimeout(() => {
    _floatingBtn.style.transition = "";
  }, 200);
}

/** ========= init 이닛 ========= */
async function init() {
  // 중복 로드/실행 방지 (메뉴 2개 뜨는 거 방지)
  if (window.__AUTOBGM_BOOTED__) return;
  window.__AUTOBGM_BOOTED__ = true;

  await bootFreeSourcesSync();
  mount();
  startEngine();
  
  // 플로팅 버튼 초기화
  const settings = ensureSettings();
  if (settings.floating.enabled) {
    createFloatingButton();
  }
  
  const obs = new MutationObserver(() => mount());
  obs.observe(document.body, { childList: true, subtree: true });
}

/** ========= 엔진틱 ========= */
  function engineTick() {
  const settings = ensureSettings();
  ensureEngineFields(settings);

  if (!settings.enabled) {
    stopRuntime();
    return;
  }

  // ST 컨텍스트 (없어도 global로 굴러가게)
  const ctx = getSTContextSafe();
  const chatKey = getChatKeyFromContext(ctx);

 settings.chatStates[chatKey] ??= {
    currentKey: "",
    listIndex: 0,
    lastSig: "",
    defaultPlayedSig: "",
  };
    
  const st = settings.chatStates[chatKey];

  // ====== Character Binding (card extensions) ======
  // 캐릭 단일 채팅에서: 캐릭 카드(data.extensions)에 저장된 프리셋 종속이 있으면 그걸 강제 적용
  const boundPresetId = getBoundPresetIdFromContext(ctx);
  if (boundPresetId && settings.presets?.[boundPresetId] && String(settings.activePresetId) !== String(boundPresetId)) {
    settings.activePresetId = boundPresetId;
    try { saveSettingsDebounced?.(); } catch {}
  }


  // 채팅 바뀌면: 이전 곡은 끄고, 새 채팅 규칙으로 다시 판단
  if (_engineLastChatKey && _engineLastChatKey !== chatKey) {
    stopRuntime();
  }
  _engineLastChatKey = chatKey;

  // preset 선택(지금은 activePresetId 기준. 나중에 캐릭 매칭 끼우면 여기서 바꾸면 됨)
  let preset = settings.presets?.[settings.activePresetId];
  if (!preset) preset = Object.values(settings.presets ?? {})[0];
  if (!preset) return;

  _engineCurrentPresetId = preset.id;
    
 // 프리셋이 바뀌면: 이전곡 유지값/런타임 키 전부 초기화
if (_engineLastPresetId && _engineLastPresetId !== String(preset.id)) {
  stopRuntime();  // 재생 멈추기
  st.currentKey = "";  // "이전곡 유지" 방지용: 채팅 상태 초기화
  st.listIndex = 0;

  st.lastSig = "";
  st.defaultPlayedSig = "";

  _engineCurrentFileKey = "";  // Now Playing/엔진 상태도 초기화
}
_engineLastPresetId = String(preset.id);

  const sort = getBgmSort(settings);
  const keys = getSortedKeys(preset, sort);
  const lastAsst = getLastAssistantText(ctx);
  const as = String(lastAsst ?? "");
  if (__abgmDebugMode) {
    __abgmDebugLine = `asstLen:${as.length} ${as.slice(0, 18).replace(/\s+/g, " ")}`;
    try { updateNowPlayingUI(); } catch {}
  }
  const useDefault = !!settings.useDefault;
  const defKey = String(preset.defaultBgmKey ?? "");

  // 현재 곡 볼륨 계산용
  const getVol = (fk) => {
    const b = findBgmByKey(preset, fk);
    return clamp01((settings.globalVolume ?? 0.7) * (b?.volume ?? 1));
  };

// ====== Keyword Mode ON ======
if (settings.keywordMode) {
  const asstText = String(lastAsst ?? "");
  const sig = makeAsstSig(asstText);

  // =========================
  // (A) 기존: 무한 유지 로직
  // =========================
  if (!settings.keywordOnce) {
    const prefer = st.currentKey || _engineCurrentFileKey || "";
    const hit = pickByKeyword(preset, asstText, prefer);
    const hitKey = hit?.fileKey ? String(hit.fileKey) : "";

    const desired = hitKey
      ? hitKey
      : (useDefault && defKey ? defKey : "");

    if (__abgmDebugMode) {
      const tLower = asstText.toLowerCase();
      let kwList = [];
      const seen = new Set();

      for (const b of (preset.bgms ?? [])) {
        const kws = parseKeywords(b.keywords);
        for (const kw of kws) {
          const k = String(kw ?? "").trim();
          if (!k) continue;
          const kLower = k.toLowerCase();
          if (tLower.includes(kLower) && !seen.has(kLower)) {
            seen.add(kLower);
            kwList.push(k);
          }
        }
      }
      const kwText = kwList.length ? kwList.join(", ") : "none";
      __abgmDebugLine = `asstLen:${asstText.length} kw:${kwText} hit:${desired || "none"}`;
      try { updateNowPlayingUI(); } catch {}
    }

    if (desired) {
      st.currentKey = desired;

      if (_engineCurrentFileKey !== desired) {
        _engineCurrentFileKey = desired;
        ensurePlayFile(desired, getVol(desired), true, preset.id);
        try { updateNowPlayingUI(); } catch {}
      } else {
        _bgmAudio.loop = true;
        _bgmAudio.volume = getVol(desired);
      }
      return;
    }

    if (st.currentKey) {
      if (_engineCurrentFileKey !== st.currentKey) {
        _engineCurrentFileKey = st.currentKey;
        ensurePlayFile(st.currentKey, getVol(st.currentKey), true, preset.id);
        try { updateNowPlayingUI(); } catch {}
      } else {
        _bgmAudio.loop = true;
        _bgmAudio.volume = getVol(st.currentKey);
      }
    }
    return;
  }

  // =========================
  // (B) 신규: 1회 재생 로직
  // =========================

  // 같은 assistant 지문이면 재트리거 금지
  if (st.lastSig === sig) {
    // 재생 중이면 볼륨만 갱신
    if (_engineCurrentFileKey) {
      _bgmAudio.loop = false;
      _bgmAudio.volume = getVol(_engineCurrentFileKey);
    }
    return;
  }
  st.lastSig = sig;

  // 현재 재생 중인 곡의 키워드도 걸렸으면 "그 곡 제외"
  let avoidKey = "";
  const curKey = String(_engineCurrentFileKey || "");
  if (curKey) {
    const cur = findBgmByKey(preset, curKey);
    const curKws = parseKeywords(cur?.keywords);
    const tLower = asstText.toLowerCase();
    if (curKws.some((kw) => tLower.includes(String(kw).toLowerCase()))) {
      avoidKey = curKey;
    }
  }

  // 후보 선정: prefer는 의미 없음(1회니까), 대신 avoidKey만 적용
  const hit = pickByKeyword(preset, asstText, "", avoidKey);
  const hitKey = hit?.fileKey ? String(hit.fileKey) : "";

  // 현재 곡 재생 중이면 새 키워드 와도 무시 (덜어내기)
  const isPlayingNow =
    !!_engineCurrentFileKey &&
    !_bgmAudio.paused &&
    !_bgmAudio.ended;

  if (isPlayingNow) {
    return;
  }

  // 같은 곡 또 걸린 거면 굳이 다시 틀지 않음
  if (hitKey && hitKey === _engineCurrentFileKey) {
    return;
  }
  
  // 디버그는 기존처럼 유지(요구사항)
  if (__abgmDebugMode) {
    const tLower = asstText.toLowerCase();
    let kwList = [];
    const seen = new Set();

    for (const b of (preset.bgms ?? [])) {
      const kws = parseKeywords(b.keywords);
      for (const kw of kws) {
        const k = String(kw ?? "").trim();
        if (!k) continue;
        const kLower = k.toLowerCase();
        if (tLower.includes(kLower) && !seen.has(kLower)) {
          seen.add(kLower);
          kwList.push(k);
        }
      }
    }
    const kwText = kwList.length ? kwList.join(", ") : "none";
    const finalKey = hitKey || (useDefault && defKey ? defKey : "");
    __abgmDebugLine = `asstLen:${asstText.length} kw:${kwText} hit:${finalKey || "none"}`;
    try { updateNowPlayingUI(); } catch {}
  }

  // 1) 키워드 히트면: 그 곡 1회
  if (hitKey) {
    st.currentKey = "";       // 1회 모드에서는 sticky 안 씀
    st.defaultPlayedSig = ""; // default 1회 기록도 리셋(선택이지만 깔끔)
    _engineCurrentFileKey = hitKey;
    ensurePlayFile(hitKey, getVol(hitKey), false, preset.id);
    try { updateNowPlayingUI(); } catch {}
    return;
  }

  // 2) 히트 없으면: default 1회(단, 이번 지문에서 처음일 때만)
  if (useDefault && defKey) {
    if (st.defaultPlayedSig !== sig) {
      st.defaultPlayedSig = sig;
      st.currentKey = "";
      _engineCurrentFileKey = defKey;
      ensurePlayFile(defKey, getVol(defKey), false, preset.id);
      try { updateNowPlayingUI(); } catch {}
    }
  }

  // 3) 그 다음 지문도 키워드 없으면: 아무것도 안 틀게 됨(위에서 sig로 막힘)
  return;
}

  // ====== Keyword Mode OFF ======
  const mode = settings.playMode ?? "manual";

  // manual: 자동재생 안 함 (유저가 누른 곡만)
  if (mode === "manual") {
    if (st.currentKey) {
      // manual은 루프 안 함 (원하면 loop_one으로 바꾸면 됨)
      if (_engineCurrentFileKey !== st.currentKey) {
        ensurePlayFile(st.currentKey, getVol(st.currentKey), false, preset.id);
      } else {
        _bgmAudio.loop = false;
        _bgmAudio.volume = getVol(st.currentKey);
      }
    }
    return;
  }

  // loop_one: currentKey 없으면 default -> 첫곡
  if (mode === "loop_one") {
    const fk = st.currentKey || defKey || keys[0] || "";
    if (!fk) return;

    if (_engineCurrentFileKey !== fk) {
      ensurePlayFile(fk, getVol(fk), true, preset.id);
      st.currentKey = fk;
    } else {
      _bgmAudio.loop = true;
      _bgmAudio.volume = getVol(fk);
    }
    return;
  }

// loop_list / random 은 ended 이벤트에서 다음곡 넘김(여기선 “시작 보장” + 재생중 볼륨 갱신)
if (mode === "loop_list" || mode === "random") {

  // 이미 재생 중이면: 볼륨만 갱신(글로벌/개별 모두 반영)
  if (_engineCurrentFileKey) {
    const fk = _engineCurrentFileKey;
    _bgmAudio.loop = false;
    _bgmAudio.volume = getVol(fk);
    st.currentKey = fk;
    return;
  }

  // 아직 아무것도 안 틀었으면: 모드에 맞게 시작
  if (mode === "loop_list") {
    const idx = Math.max(0, Math.min(st.listIndex ?? 0, keys.length - 1));
    const fk = keys[idx] || "";
    if (fk) {
      ensurePlayFile(fk, getVol(fk), false, preset.id);
      st.currentKey = fk;
      st.listIndex = idx;
    }
    return;
  }

  if (mode === "random") {
    const fk = pickRandomKey(keys, st.currentKey || "");
    if (fk) {
      ensurePlayFile(fk, getVol(fk), false, preset.id);
      st.currentKey = fk;
    }
    return;
  }
 }
}
  
  // ended & (A) keywordMode + keywordOnce면: 재생 끝나면 상태만 정리하고 종료
_bgmAudio.addEventListener("ended", () => {
  const settings = ensureSettings();
  ensureEngineFields(settings);
  if (!settings.enabled) return;

  const ctx = getSTContextSafe();
  const chatKey = getChatKeyFromContext(ctx);
  settings.chatStates[chatKey] ??= { currentKey: "", listIndex: 0, lastSig: "", defaultPlayedSig: "" };
  const st = settings.chatStates[chatKey];

  // (A) keywordMode + 1회 모드: 재생 끝나면 "현재 재생 없음"으로 정리
  if (settings.keywordMode && settings.keywordOnce) {
    _engineCurrentFileKey = "";
    try { updateNowPlayingUI(); } catch {}
    return;
  }

  // (B) keywordMode + 무한 유지: ended는 거의 안 오니까 무시
  if (settings.keywordMode && !settings.keywordOnce) return;

  // (C) keywordMode OFF: loop_list/random 다음곡 처리
  let preset = settings.presets?.[settings.activePresetId];
  if (!preset) preset = Object.values(settings.presets ?? {})[0];
  if (!preset) return;

  const sort = getBgmSort(settings);
  const keys = getSortedKeys(preset, sort);
  if (!keys.length) return;

  const getVol = (fk) => {
    const b = findBgmByKey(preset, fk);
    return clamp01((settings.globalVolume ?? 0.7) * (b?.volume ?? 1));
  };

  const mode = settings.playMode ?? "manual";

  if (mode === "loop_list") {
    let idx = Number(st.listIndex ?? 0);
    idx = (idx + 1) % keys.length;
    st.listIndex = idx;

    const fk = keys[idx];
    st.currentKey = fk;
    ensurePlayFile(fk, getVol(fk), false, preset.id);
    try { saveSettingsDebounced?.(); } catch {}
    return;
  }

  if (mode === "random") {
    const cur = String(st.currentKey ?? "");
    const pool = keys.filter((k) => k !== cur);
    const pickFrom = pool.length ? pool : keys;
    const next = pickFrom[Math.floor(Math.random() * pickFrom.length)];

    st.currentKey = next;
    ensurePlayFile(next, getVol(next), false);
    try { saveSettingsDebounced?.(); } catch {}
    return;
  }
});

function startEngine() {
  if (_engineTimer) clearInterval(_engineTimer);
  _engineTimer = setInterval(engineTick, 900);
  engineTick();
}

(async () => {
  try {
    await __abgmResolveDeps();
    console.log("[AutoBGM] index.js loaded", import.meta.url);

    const onReady = () => init();

    if (typeof jQuery === "function") {
      jQuery(() => onReady());
    } else if (typeof $ === "function") {
      $(() => onReady());
    } else {
      window.addEventListener("DOMContentLoaded", onReady, { once: true });
    }
  } catch (e) {
    console.error("[AutoBGM] boot failed", e);
  }
})();

// ====== mp3 및 url 시간 인식 ======
async function abgmGetDurationSecFromBlob(blob) {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";

    const url = URL.createObjectURL(blob);

    audio.onloadedmetadata = () => {
      const sec = audio.duration;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(sec) ? sec : 0);
    };

    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };

    audio.src = url;
  });
}

