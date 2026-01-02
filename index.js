/*
  AutoBGM (SillyTavern Extension)
  - Dynamic dependency resolver so it works in both layouts:
    /scripts/extensions/<ext>/...
    /scripts/extensions/third-party/<ext>/...
  ==============================
  모듈화 규칙 (반드시 지키기)

  [0] 최우선 목표
  - "리팩토링"이 아니라 "분리"다
  - 동작(로직/UX/타이밍/상태변화/버그 포함) 절대 바꾸지 말 것
    (플로팅 버튼 반응, NP 글라스, 모달, 프리소스, 키워드 선곡, 저장 타이밍 등)

  [1] 금지사항
  - 기능을 너무 잘게 쪼개지 말 것
    * 파일 20~30줄짜리 모듈 난사 금지
    * 1파일 최소 200~400줄 목표(최대 제한 없음)
  - “한 기능” 코드가 여러 파일에 흩어지는 구조 금지
    * 예) 플로팅 메뉴 수정하는데 ui_floating.js / ui_modal.js / engine.js 다 건드리게 만들지 말기
  - 모듈 간 순환 의존(서로 import) 금지

  [2] 모듈 소유권(Ownership) — "어디를 고치면 되는가"를 고정
  - modules/engine.js
    * 오디오 런타임(재생/정지/틱/선곡/키워드 판정)만
    * DOM 절대 만지지 않기 (querySelector 금지)
  - modules/state.js
    * 공유 상태 단 1곳(읽기/쓰기 창구)
    * 전역 변수/플래그/캐시도 여기로 이주
  - modules/settings.js
    * ensure/load/save/schema/migration
    * extension_settings 접근은 여기(or deps.js)에서만
  - modules/storage.js
    * IndexedDB / blob url / assets 목록 관리
  - modules/deps.js
    * ST 의존성 resolve (extension_settings, saveSettingsDebounced, getContext 등)
  - modules/utils.js
    * 공용 유틸(순수함수 위주 + DOM 보조는 “아주 얇게”)
  - modules/tags.js
    * 태그 정규화/정렬/표시 (이미 분리됨)

  - modules/ui_floating.js
    * 플로팅 버튼/홈/드래그/스냅/리사이즈 + 그 UI 이벤트/렌더 전담
  - modules/ui_nowplaying.js
    * Now Playing(UI) 업데이트/글라스/seek/아이콘 동기화 등 “NP 화면 전담”
  - modules/ui_modal.js
    * 설정 모달(open/close/fit/탭 전환/공통 modal 유틸)
  - modules/ui_playlist.js
    * 플리 렌더/정렬/검색/선택/버튼 핸들러(플리 화면 전담)
  - modules/ui_freesources.js
    * 프리소스 모달/탭/태그/추가/동기화 (templates/freesources.html 사용)

  [3] 의존성 방향(Dependency Direction) — 단방향만 허용
  - ui_*  -> (engine, settings, storage, state, utils, tags, deps) 호출 가능
  - engine -> (state, settings, storage, utils, tags)만 사용 가능 / ui_* 호출 금지
  - settings/storage/state/utils/tags/deps 는 서로 최소한으로만 (특히 ui_* import 금지)

  [4] "통신 방식" 규칙
  - UI가 엔진을 직접 조작해야 하면: engine의 공개 API 함수 호출로만
  - UI 갱신 트리거:
    * 엔진 상태 변화 시: engine이 콜백/이벤트를 emit -> ui_nowplaying 등에서 구독
    * (당장 어렵다면) 최소한 index.js가 허브 역할로 연결만 하고,
      기존 호출 순서/타이밍은 그대로 유지
  - settings 저장은 saveSettingsDebounced 타이밍을 기존과 동일하게 유지

  [5] 퍼블릭 API 규칙(노출 최소화)
  - 각 모듈은 “큰 덩어리 함수” 중심으로 export
    * 세부 helper는 파일 내부에 숨기기(외부 export 금지)
  - 모듈 간 공유해야 하는 값은 state를 통해서만(전역 변수 늘리지 말기)

  [6] 마이그레이션 규칙(안전 이관)
  - 1회 작업 단위:
    * "한 섹션(주제)" 통째로 옮기고
    * import/export만 맞춘 다음
    * 기능 테스트 후 다음 섹션으로 이동
  - 섹션 예시:
    1) deps + settings 부팅
    2) storage(idb) + asset
    3) engine 런타임
    4) NP UI (drawer + glass)
    5) floating menu
    6) modal
    7) freesources

  [7] 파일 분리 기준(이 프로젝트의 핵심)
  - "수정하려는 기능"의 진입점이 한 파일에 모이게 만들 것
    * 플로팅 메뉴 고치려면 ui_floating.js만 보면 되게
    * NP 글라스 고치려면 ui_nowplaying.js만 보면 되게
    * 프리소스 고치려면 ui_freesources.js만 보면 되게

  ※ 결론: 모듈화는 기능 동일 유지 + 파일만 이동일 뿐, 로직을 예쁘게 바꾸는 시간이 아니다
    - 편의성/가독성/리팩토링 목적의 코드 자체 로직 수정 금지
    * 허용: import/export 정리, 파일 분리, 함수/상수 이동, 이름만 바꾸기(외부 API 동일할 때), 주석 추가
    * 금지: 조건문/타이밍/이벤트 흐름/상태 구조 변경, UX 동작 변경, “더 깔끔한 방식”으로 재설계
*/

import { abgmNormTags, abgmNormTag, tagVal, tagPretty, tagCat, sortTags } from "./modules/tags.js";
import { extension_settings, saveSettingsDebounced, __abgmResolveDeps, getSTContextSafe, getBoundPresetIdFromContext, EXT_BIND_KEY } from "./modules/deps.js";
import { openDb, idbPut, idbGet, idbDel, ensureAssetList } from "./modules/storage.js";
import { ensureSettings, migrateLegacyDataUrlsToIDB, ensureEngineFields } from "./modules/settings.js";
import { abgmBindFloatingActions, createFloatingButton, removeFloatingButton, removeFloatingMenu, openFloatingMenu, closeFloatingMenu, updateFloatingButtonPosition, abgmGetFloatingMenuEl, updateMenuDebugIcon } from "./modules/ui_floating.js";
import { abgmBindNowPlayingDeps, bindSideMenuNowPlayingControls, updateNowPlayingUI, bindNowPlayingEventsOnce, openNowPlayingGlass, closeNowPlayingGlass } from "./modules/ui_nowplaying.js";

let __abgmDebugLine = ""; // 키워드 모드 디버깅
let __abgmDebugMode = false;
let _engineLastPresetId = "";

const MODAL_OVERLAY_ID = "abgm_modal_overlay";

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

async function togglePlayPause() {
  const s = ensureSettings();
  if (!s.enabled) return;

  // 재생 중이면 pause
  if (_engineCurrentFileKey && !_bgmAudio.paused) {
    try { _bgmAudio.pause(); } catch {}
    updateNowPlayingUI();
    return;
  }

  // 일시정지면 resume
  if (_engineCurrentFileKey && _bgmAudio.paused) {
    try { await _bgmAudio.play(); } catch {}
    updateNowPlayingUI();
    return;
  }

  // stopped면 엔진 로직대로 시작
  try { engineTick(); } catch {}
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

function abgmGetNavCtx() {
  try {
    const settings = ensureSettings();
    ensureEngineFields(settings);

    const ctx = getSTContextSafe();
    const chatKey = getChatKeyFromContext(ctx);

    settings.chatStates[chatKey] ??= {
      currentKey: "",
      listIndex: 0,
      lastSig: "",
      defaultPlayedSig: "",
      prevKey: "",
    };

    const st = settings.chatStates[chatKey];

    let preset = settings.presets?.[settings.activePresetId];
    if (!preset) preset = Object.values(settings.presets ?? {})[0];
    if (!preset) return null;

    const sort = getBgmSort(settings);
    const keys = getSortedKeys(preset, sort);
    const defKey = String(preset.defaultBgmKey ?? "");

    const getVol = (fk) => {
      const b = findBgmByKey(preset, fk);
      return clamp01((settings.globalVolume ?? 0.7) * (b?.volume ?? 1));
    };

    return { settings, ctx, chatKey, st, preset, keys, defKey, getVol };
  } catch {
    return null;
  }
}

function abgmNpPrevAction() {
  const info = abgmGetNavCtx();
  if (!info) return;
  const { settings, st, preset, keys, defKey, getVol } = info;
  if (!settings.enabled) return;

  // Keyword mode: Prev button = Use Default toggle
  if (settings.keywordMode) {
    settings.useDefault = !settings.useDefault;
    saveSettingsDebounced();
    try { engineTick(); } catch {}
    updateNowPlayingUI();
    return;
  }

  const mode = settings.playMode || "manual";
  if (!keys.length) return;

  const cur = String(_engineCurrentFileKey || st.currentKey || "");
  const remember = (nextKey) => {
    if (cur && nextKey && cur !== nextKey) st.prevKey = cur;
  };

  // Random: Prev = last played key
  if (mode === "random") {
    const pk = String(st.prevKey || "");
    if (!pk) return;
    remember(pk);
    st.currentKey = pk;
    _engineCurrentFileKey = pk;
    ensurePlayFile(pk, getVol(pk), false, preset.id);
    saveSettingsDebounced();
    updateNowPlayingUI();
    return;
  }

  // When nothing is selected yet
  if (!cur) {
    const startKey = defKey || keys[keys.length - 1] || keys[0] || "";
    if (!startKey) return;
    st.currentKey = startKey;
    if (mode === "loop_list") st.listIndex = Math.max(0, keys.indexOf(startKey));
    _engineCurrentFileKey = startKey;
    ensurePlayFile(startKey, getVol(startKey), mode === "loop_one", preset.id);
    saveSettingsDebounced();
    updateNowPlayingUI();
    return;
  }

  let idx = keys.indexOf(cur);
  if (idx < 0) idx = Math.max(0, Math.min(Number(st.listIndex || 0), keys.length - 1));

  if (mode === "loop_list") {
    idx = (idx - 1 + keys.length) % keys.length;
    st.listIndex = idx;
  } else {
    idx = Math.max(0, idx - 1);
  }

  const nextKey = String(keys[idx] || "");
  if (!nextKey) return;

  remember(nextKey);
  st.currentKey = nextKey;
  _engineCurrentFileKey = nextKey;

  const loop = (mode === "loop_one");
  ensurePlayFile(nextKey, getVol(nextKey), loop, preset.id);
  saveSettingsDebounced();
  updateNowPlayingUI();
}

function abgmNpNextAction() {
  const info = abgmGetNavCtx();
  if (!info) return;
  const { settings, st, preset, keys, defKey, getVol } = info;
  if (!settings.enabled) return;

  // Keyword mode: Next button = keyword logic toggle (hold ↔ once)
  if (settings.keywordMode) {
    settings.keywordOnce = !settings.keywordOnce;
    saveSettingsDebounced();
    try { engineTick(); } catch {}
    updateNowPlayingUI();
    return;
  }

  const mode = settings.playMode || "manual";
  if (!keys.length) return;

  const cur = String(_engineCurrentFileKey || st.currentKey || "");
  const remember = (nextKey) => {
    if (cur && nextKey && cur !== nextKey) st.prevKey = cur;
  };

  // When nothing is selected yet
  if (!cur) {
    const startKey = defKey || keys[0] || "";
    if (!startKey) return;
    st.currentKey = startKey;
    if (mode === "loop_list") st.listIndex = Math.max(0, keys.indexOf(startKey));
    _engineCurrentFileKey = startKey;
    ensurePlayFile(startKey, getVol(startKey), mode === "loop_one", preset.id);
    saveSettingsDebounced();
    updateNowPlayingUI();
    return;
  }

  // Random: Next = random (avoid current)
  if (mode === "random") {
    const nextKey = pickRandomKey(keys, cur);
    if (!nextKey) return;
    remember(nextKey);
    st.currentKey = nextKey;
    _engineCurrentFileKey = nextKey;
    ensurePlayFile(nextKey, getVol(nextKey), false, preset.id);
    saveSettingsDebounced();
    updateNowPlayingUI();
    return;
  }

  let idx = keys.indexOf(cur);
  if (idx < 0) idx = Math.max(0, Math.min(Number(st.listIndex || 0), keys.length - 1));

  if (mode === "loop_list") {
    idx = (idx + 1) % keys.length;
    st.listIndex = idx;
  } else {
    idx = Math.min(keys.length - 1, idx + 1);
  }

  const nextKey = String(keys[idx] || "");
  if (!nextKey) return;

  remember(nextKey);
  st.currentKey = nextKey;
  _engineCurrentFileKey = nextKey;

  const loop = (mode === "loop_one");
  ensurePlayFile(nextKey, getVol(nextKey), loop, preset.id);
  saveSettingsDebounced();
  updateNowPlayingUI();
}

// ===== NP Glass: Playlist View =====
const ABGM_SORT_CYCLE = [
  "name_asc",
  "name_desc",
  "added_asc",
  "added_desc",
  "priority_desc",
  "priority_asc",
];

function abgmSortNice(mode) {
  const m = String(mode || "");
  if (m === "name_asc") return "Name A→Z";
  if (m === "name_desc") return "Name Z→A";
  if (m === "added_asc") return "Added ↑";
  if (m === "added_desc") return "Added ↓";
  if (m === "priority_desc") return "Priority ↓";
  if (m === "priority_asc") return "Priority ↑";
  return m || "Sort";
}

function abgmCycleBgmSort(settings) {
  settings.ui ??= {};
  const cur = String(getBgmSort(settings) || "added_asc");
  const i = ABGM_SORT_CYCLE.indexOf(cur);
  const next = ABGM_SORT_CYCLE[(i + 1) % ABGM_SORT_CYCLE.length] || "added_asc";
  settings.ui.bgmSort = next;
  return next;
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
      settings.chatStates[chatKey] ??= { currentKey: "", listIndex: 0, lastSig: "", defaultPlayedSig: "", prevKey: "" };
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

    bindSideMenuNowPlayingControls(root);

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
      if (!settings.enabled) {
          stopRuntime();          // OFF면 즉시 정리 + _engineCurrentFileKey 비움
        } else {
          try { engineTick(); } catch {}
        }
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

function toggleDebugMode() {
  const s = ensureSettings();
  s.debugMode = !s.debugMode;
  __abgmDebugMode = !!s.debugMode;
  if (!__abgmDebugMode) __abgmDebugLine = "";
  saveSettingsDebounced();
  updateMenuDebugIcon();
  updateNowPlayingUI();
}

function updateMenuNPAnimation() {
  const menu = abgmGetFloatingMenuEl();
  if (!menu) return;

  const icon = menu.querySelector(".abgm-menu-icon-np");
  if (!icon) return;

  const isPlaying = !!_engineCurrentFileKey && !_bgmAudio.paused;
  icon.classList.toggle("is-playing", isPlaying);
}

/** ========= init 이닛 ========= */
async function init() {
  console.log("[AutoBGM] init entered");
  // 중복 로드/실행 방지 (메뉴 2개 뜨는 거 방지)
  if (window.__AUTOBGM_BOOTED__) return;
  window.__AUTOBGM_BOOTED__ = true;
  abgmBindFloatingActions({ openModal, openNowPlayingGlass, toggleDebugMode, updateMenuNPAnimation });
  abgmBindNowPlayingDeps({
    // 상태 읽기
    getBgmAudio: () => _bgmAudio,
    getEngineCurrentFileKey: () => _engineCurrentFileKey,
    getEngineCurrentPresetId: () => _engineCurrentPresetId,

    // 엔진/액션
    engineTick: () => engineTick(),
    togglePlayPause: () => togglePlayPause(),

    // 모달/호스트
    getModalHost: () => getModalHost(),
    fitModalToHost: (overlay, host) => fitModalToHost(overlay, host),

    // UI 훅
    updateMenuNPAnimation: () => updateMenuNPAnimation(),
    updateModalNowPlayingSimple: (title) => updateModalNowPlayingSimple(title),

    // 플리/정렬/표시 헬퍼들 (ui_nowplaying에서 쓰는 것만 연결)
    getActivePreset: (settings) => getActivePreset(settings),
    getEntryName: (b) => getEntryName(b),
    getSortedBgms: (preset, sortKey) => getSortedBgms(preset, sortKey),
    getSortedKeys: (preset, sortKey) => getSortedKeys(preset, sortKey),
    getBgmSort: (settings) => getBgmSort(settings),
    abgmCycleBgmSort: (settings) => abgmCycleBgmSort(settings),
    abgmSortNice: (k) => abgmSortNice(k),
    ensurePlayFile: (fk, vol01, autoplay, presetId) => ensurePlayFile(fk, vol01, autoplay, presetId),
 
    getDebugMode: () => __abgmDebugMode,
    getDebugLine: () => __abgmDebugLine,

    getSTContextSafe: () => getSTContextSafe(),
    getChatKeyFromContext: (ctx) => getChatKeyFromContext(ctx),
    ensureEngineFields: (settings) => ensureEngineFields(settings),
  });
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
  // 창 크기 변경 리스너
  window.addEventListener("resize", updateFloatingButtonPosition);
  window.addEventListener("orientationchange", updateFloatingButtonPosition);
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
    prevKey: "",
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
  st.prevKey = "";

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
  settings.chatStates[chatKey] ??= { currentKey: "", listIndex: 0, lastSig: "", defaultPlayedSig: "", prevKey: "" };
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
    st.prevKey = String(st.currentKey || _engineCurrentFileKey || "");
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
    st.prevKey = String(st.currentKey || _engineCurrentFileKey || "");
    const cur = String(st.currentKey ?? "");
    const pool = keys.filter((k) => k !== cur);
    const pickFrom = pool.length ? pool : keys;
    const next = pickFrom[Math.floor(Math.random() * pickFrom.length)];

    st.currentKey = next;
    ensurePlayFile(next, getVol(next), false, preset.id);
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







