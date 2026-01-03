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
import { abgmBindModalDeps, openModal, closeModal, fitModalToHost, getModalHost, fitModalToViewport } from "./modules/ui_modal.js";
import { initModal, abgmBindSettingsModalDeps } from "./modules/ui_settings_modal.js";
// import { abgmBindFreeSourcesCoreDeps, bootFreeSourcesSync } from "./modules/freesources.js";
import { abgmBindFreeSourcesDeps, closeFreeSourcesModal } from "./modules/ui_freesources.js";

let __abgmDebugLine = ""; // 키워드 모드 디버깅
let __abgmDebugMode = false;
let _engineLastPresetId = "";

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

  // 부팅/바인딩
  abgmBindModalDeps({
    loadHtml,
    initModal,
    bindNowPlayingEventsOnce,
    updateNowPlayingUI,
  });
  abgmBindFloatingActions({
    openModal,
    openNowPlayingGlass,
    toggleDebugMode,
    updateMenuNPAnimation,
  });
  abgmBindNowPlayingDeps({
    // 상태 읽기
    getBgmAudio: () => _bgmAudio,
    getEngineCurrentFileKey: () => _engineCurrentFileKey,
    getEngineCurrentPresetId: () => _engineCurrentPresetId,

    // 엔진/액션
    engineTick: () => engineTick(),
    togglePlayPause: () => togglePlayPause(),
    npPrevAction: () => abgmNpPrevAction(),
    npNextAction: () => abgmNpNextAction(),

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

    // 디버그/컨텍스트
    getDebugMode: () => __abgmDebugMode,
    getDebugLine: () => __abgmDebugLine,
    getSTContextSafe: () => getSTContextSafe(),
    getChatKeyFromContext: (ctx) => getChatKeyFromContext(ctx),
    ensureEngineFields: (settings) => ensureEngineFields(settings),
  });
  abgmBindFreeSourcesDeps({
    loadHtml,
    ensureSettings,
    saveSettingsDebounced,
    syncFreeSourcesFromJson,
    syncBundledFreeSourcesIntoSettings,
  });
  abgmBindSettingsModalDeps({
    getBgmSort,
    getSortedBgms,
    getActivePreset,
    setPlayButtonsLocked,
    saveSettingsDebounced,
    
    uid,
    abgmConfirm,
    abgmPrompt,
    getSTContextSafe,
    getChatKeyFromContext,
    exportPresetFile,
    rekeyPreset,
    pickPresetFromImportData,
    basenameNoExt,
    clone,
    dropboxToRaw,
    importZip,
    isFileKeyReferenced,
    maybeSetDefaultOnFirstAdd,
    abgmPickPreset,
    abgmGetDurationSecFromBlob,

    // storage / modal 쪽
    idbPut,
    idbDel,
    ensureAssetList,
    fitModalToHost,
    getModalHost,
    EXT_BIND_KEY,
    
    rerenderAll,
    renderDefaultSelect,
    updateNowPlayingUI,
    engineTick: () => engineTick(),
    setDebugMode: (on) => {
      __abgmDebugMode = !!on;
      if (!__abgmDebugMode) __abgmDebugLine = "";
      window.__abgmDebugMode = __abgmDebugMode;
    }
  });
  await bootFreeSourcesSync();
  mount();
  startEngine();
  
  // 플로팅 버튼 초기화
  const settings = ensureSettings();
  // 디버그: 콘솔에서 설정 확인용
  window.__ABGM_DBG__ = { getSettings: () => ensureSettings() };
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







