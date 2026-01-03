import { ensureSettings } from "./settings.js";
import { saveSettingsDebounced } from "./deps.js";
import { openFloatingMenu } from "./ui_floating.js";

let _abgmNowPlayingBound = false;

const NP = {
  // state getters
  getBgmAudio: () => null,
  getEngineCurrentFileKey: () => "",
  getEngineCurrentPresetId: () => "",

  // engine/actions
  engineTick: () => {},
  togglePlayPause: () => {},

  // modal host sizing (나중에 ui_modal.js로 갈 애들)
  getModalHost: () => document.body,
  fitModalToHost: () => {},

  // UI hooks
  updateMenuNPAnimation: () => {},
  updateModalNowPlayingSimple: () => {},

  // helpers (index.js에 이미 있는 함수들 그대로 연결)
  getActivePreset: () => ({}),
  getEntryName: (b) => String(b?.name ?? b?.fileKey ?? ""),
  getSortedBgms: (preset, sortKey) => (preset?.bgms ?? []),
  getSortedKeys: () => [],
  getBgmSort: () => "manual",
  abgmCycleBgmSort: () => "manual",
  abgmSortNice: (k) => String(k ?? "manual"),
  ensurePlayFile: () => {},

  getDebugMode: () => false,
  getDebugLine: () => "",

  getSTContextSafe: () => null,
  getChatKeyFromContext: () => "",
  ensureEngineFields: () => {},

  // nav actions (index.js 쪽 로직 호출)
  npPrevAction: () => {},
  npNextAction: () => {},
};

/** ========= Floating Now Playing (Glass) ========= */
const NP_GLASS_OVERLAY_ID = "ABGM_NP_GLASS_OVERLAY";

// NP Glass: control icons (image = direct link)
const ABGM_NP_CTRL_ICON = {
  prev:         "https://i.postimg.cc/1XTpkT5K/Previous.png",
  next:         "https://i.postimg.cc/4ND6wrSP/Next.png",
  useDefaultOn: "https://i.postimg.cc/PrkPPTpg/Default_On.png",
  useDefaultOff:"https://i.postimg.cc/VLy3x3qC/Stop.png",
  kwHold:       "https://i.postimg.cc/jdQkGCqp/Loop_List.png",
  kwOnce:       "https://i.postimg.cc/SR9HXrhj/Play.png",
};

// NP seek 상태
let _abgmNpIsSeeking = false;
let _abgmNpSeekRaf = 0;

// seconds -> "m:ss" / "h:mm:ss"
function abgmFmtTime(sec) {
  const n = Math.max(0, Number(sec || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = Math.floor(n % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// NP Glass: play mode icons (image = direct link)
const ABGM_NP_MODE_ICON = {
  manual:   "https://i.postimg.cc/SR9HXrhj/Play.png",
  loop_one: "https://i.postimg.cc/L4PW3NcK/Loop_One.png",
  loop_list:"https://i.postimg.cc/jdQkGCqp/Loop_List.png",
  random:   "https://i.postimg.cc/L8xQ87PM/Random.png",
  keyword:  "https://i.postimg.cc/8CsKJHdc/Keyword.png",
};

export function abgmBindNowPlayingDeps(partial = {}) {
  Object.assign(NP, partial || {});
}

function abgmGetNpOverlay() {
  return document.getElementById(NP_GLASS_OVERLAY_ID);
}

function _abgmSetText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(text ?? "");
}

function abgmNpShowPage(page /* 'np' | 'pl' */) {
  const overlay = abgmGetNpOverlay();
  if (!overlay) return;

  const np = overlay.querySelector('[data-abgm-page="np"]');
  const pl = overlay.querySelector('[data-abgm-page="pl"]');

  overlay.dataset.abgmPage = page;

  if (np) np.style.display = (page === "np") ? "" : "none";
  if (pl) pl.style.display = (page === "pl") ? "" : "none";

  if (page === "pl") {
    try { abgmRenderPlaylistPage(overlay); } catch {}
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

export function updateNowPlayingUI() {
  try {
    const fk = String(NP.getEngineCurrentFileKey() || "");
    const settings = ensureSettings?.() || {};

    const pid = String(NP.getEngineCurrentPresetId() || settings?.activePresetId || "");
    const preset =
      (pid && settings?.presets?.[pid]) ||
      settings?.presets?.[settings?.activePresetId] ||
      Object.values(settings?.presets || {})[0] ||
      {};

    const bgm = (preset.bgms ?? []).find((b) => String(b?.fileKey ?? "") === fk) || null;
    const title = bgm ? NP.getEntryName(bgm) : (fk || "(none)");

    const presetName = preset?.name || "Preset";
    const modeLabel = settings?.keywordMode ? "Keyword" : (settings?.playMode || "manual");
    const meta = `${modeLabel} · ${presetName}`;
    const debugLine = (NP.getDebugMode?.() && NP.getDebugLine?.()) ? String(NP.getDebugLine()) : "";

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
    updateNowPlayingGlassUI(title, presetName, modeLabel);
    updateNowPlayingGlassNavUI(settings, preset);
    try { updateNowPlayingGlassPlaylistUI(settings); } catch {}

    const dbg = document.getElementById("autobgm_now_debug");
    if (dbg) {
      dbg.style.display = debugLine ? "" : "none";
      dbg.textContent = debugLine;
    }

    // 모달(simple)
    NP.updateModalNowPlayingSimple(title);

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
    const stopped = !settings.enabled || !fk;
    const icon = stopped ? "⏹️" : (NP.getBgmAudio()?.paused ? "▶️" : "⏸️");

    btnPlay.textContent = icon;
    btnPlay.title =
      icon === "▶️" ? "Play" :
      icon === "⏸️" ? "Pause" :
      "Start";
        }

    // ===== NP Glass 아이콘 동기화 NP 아이콘 =====
    const glassIcon = document.querySelector("#abgm_np_play img");
    if (glassIcon) {
      if (!settings.enabled || !fk) {
        glassIcon.src = "https://i.postimg.cc/VLy3x3qC/Stop.png";
      } else if (NP.getBgmAudio()?.paused) {
        glassIcon.src = "https://i.postimg.cc/SR9HXrhj/Play.png";
      } else {
        glassIcon.src = "https://i.postimg.cc/v8xJSQVQ/Pause.png";
      }
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
    NP.updateMenuNPAnimation();
  } catch (e) {
    console.error("[AutoBGM] updateNowPlayingUI failed:", e);
  }
}

export function bindNowPlayingEventsOnce() {
  if (_abgmNowPlayingBound) return;
  _abgmNowPlayingBound = true;
  
  try {
   NP.getBgmAudio().addEventListener("play", updateNowPlayingUI);
   NP.getBgmAudio().addEventListener("pause", updateNowPlayingUI);
   NP.getBgmAudio().addEventListener("ended", updateNowPlayingUI);
   NP.getBgmAudio().addEventListener("error", updateNowPlayingUI);

    // seek UI는 updateNowPlayingUI에 묶으면 너무 무거워서 분리
    const kickSeek = () => scheduleNpSeekUpdate();
   NP.getBgmAudio().addEventListener("timeupdate", kickSeek);
   NP.getBgmAudio().addEventListener("loadedmetadata", kickSeek);
   NP.getBgmAudio().addEventListener("durationchange", kickSeek);
   NP.getBgmAudio().addEventListener("seeking", kickSeek);
   NP.getBgmAudio().addEventListener("seeked", kickSeek);
  } catch {}
}

function scheduleNpSeekUpdate() {
  if (_abgmNpSeekRaf) return;
  _abgmNpSeekRaf = requestAnimationFrame(() => {
    _abgmNpSeekRaf = 0;
    updateNowPlayingGlassSeekUI();
  });
}

function updateNowPlayingGlassSeekUI() {
  const overlay = document.getElementById(NP_GLASS_OVERLAY_ID);
  if (!overlay) return;

  const seek = overlay.querySelector("#abgm_np_seek");
  const curEl = overlay.querySelector("#abgm_np_time_cur");
  const durEl = overlay.querySelector("#abgm_np_time_dur");
  if (!seek) return;

  const settings = ensureSettings?.() || {};
  const enabled = !!settings.enabled;
  const a = NP.getBgmAudio();
  const fk = String(NP.getEngineCurrentFileKey() || "");
  const dur = Number(a?.duration);
  const cur = Number(a?.currentTime);

  const ready = enabled && !!fk && Number.isFinite(dur) && dur > 0;

  seek.disabled = !ready;

  // range: ms 단위(더 부드럽게)
  const max = ready ? Math.max(1, Math.floor(dur * 1000)) : 0;
  if (String(seek.max) !== String(max)) seek.max = String(max);
  if (seek.min !== "0") seek.min = "0";

  // 드래그 중이면 값 덮어쓰기 금지
  if (!_abgmNpIsSeeking && ready) {
    const v = Math.min(max, Math.max(0, Math.floor((Number.isFinite(cur) ? cur : 0) * 1000)));
    seek.value = String(v);
  } else if (!ready) {
    seek.value = "0";
  }

  if (curEl) curEl.textContent = ready ? abgmFmtTime(Number.isFinite(cur) ? cur : 0) : "0:00";
  if (durEl) durEl.textContent = ready ? abgmFmtTime(dur) : "0:00";
}

export function openNowPlayingGlass() {
  if (document.getElementById(NP_GLASS_OVERLAY_ID)) return;

  const overlay = document.createElement("div");
  overlay.id = NP_GLASS_OVERLAY_ID;
  overlay.className = "autobgm-overlay"; // 기존 overlay CSS 재활용
  overlay.dataset.abgmPage = "np";

  overlay.innerHTML = `
    <div class="autobgm-modal abgm-np-glass" style="
      width: min(360px, 75vw);
      height: min(480px, 80vh);
      aspect-ratio: 3/4;
      background: rgba(255,255,255,.95);
      color: rgba(0,0,0,.88);
    ">
      <div class="abgm-np-glass-inner">

        <!-- ===== Page: NP (Home) ===== -->
        <div data-abgm-page="np">

          <div class="abgm-np-art" id="abgm_np_art"></div>

          <div class="abgm-np-title" id="abgm_np_title">(none)</div>
          <div class="abgm-np-sub" id="abgm_np_preset">Preset</div>

          <div class="abgm-np-seek-wrap">
            <input id="abgm_np_seek" class="abgm-np-seek" type="range" min="0" max="0" value="0" />
            <div class="abgm-np-time">
              <span id="abgm_np_time_cur">0:00</span>
              <span id="abgm_np_time_dur">0:00</span>
            </div>
          </div>

          <div class="abgm-np-ctrl">
            <button class="abgm-np-btn" type="button" id="abgm_np_prev" title="Prev" disabled>
              <img id="abgm_np_prev_icon" src="${ABGM_NP_CTRL_ICON.prev}" class="abgm-np-icon" alt="prev"/>
            </button>

            <button class="abgm-np-btn abgm-np-btn-main" type="button" id="abgm_np_play" title="Play/Pause">
              <img src="https://i.postimg.cc/SR9HXrhj/Play.png" class="abgm-np-icon" alt="play"/>
            </button>

            <button class="abgm-np-btn" type="button" id="abgm_np_next" title="Next" disabled>
              <img id="abgm_np_next_icon" src="${ABGM_NP_CTRL_ICON.next}" class="abgm-np-icon" alt="next"/>
            </button>
          </div>

          <div class="abgm-np-bottom">
            <button class="abgm-np-pill" type="button" id="abgm_np_list" title="Playlist">
              <i class="fa-solid fa-list"></i>
            </button>

            <button class="abgm-np-pill" type="button" id="abgm_np_mode" title="Mode">
              <img id="abgm_np_mode_icon" src="${ABGM_NP_MODE_ICON.manual}" class="abgm-np-icon abgm-np-icon-sm" alt="mode" />
              <span id="abgm_np_mode_text" class="abgm-np-sr">Manual</span>
            </button>

            <button class="abgm-np-pill abgm-np-back" type="button" id="abgm_np_back" title="Back">
              <i class="fa-solid fa-arrow-left"></i>
            </button>
          </div>

        </div>

<!-- ===== Page: Playlist ===== -->
<div data-abgm-page="pl" style="display:none; height:100%;">
  <div class="abgm-pl-card">

    <div class="abgm-pl-header">
      <button type="button" class="menu_button abgm-pl-topbtn" id="abgm_pl_to_np" title="Back to NP">←</button>
      <div class="abgm-pl-title">Playlist</div>
      <button type="button" class="menu_button abgm-pl-topbtn" id="abgm_pl_sort" title="Sort">⋯</button>
    </div>

    <div class="abgm-pl-presetbar">
      <select id="abgm_pl_preset" class="abgm-pl-select"></select>
    </div>

    <div id="abgm_pl_list" class="abgm-pl-list"></div>

    <div class="abgm-pl-footer">
      <button type="button" class="menu_button abgm-pl-home" id="abgm_pl_home" title="Back to Floating Menu">
        <i class="fa-solid fa-arrow-left"></i>
      </button>
    </div>

  </div>
</div>

      </div>
    </div>
  `;

  // 바깥 클릭 닫기
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeNowPlayingGlass();
  });

  const host = NP.getModalHost();
  const cs = getComputedStyle(host);
  if (cs.position === "static") host.style.position = "relative";

  // overlay 스타일(기존 모달 방식 맞춤)
  const setO = (k, v) => overlay.style.setProperty(k, v, "important");
  setO("position", "absolute");
  setO("inset", "0");
  setO("display", "block");
  setO("overflow", "hidden");
  setO("background", "rgba(0,0,0,.55)");
  setO("z-index", "2147483647");
  setO("padding", "0");

  host.appendChild(overlay);
  // 플리 UI는 페이지 전환 전에 미리 한번 렌더해두기(프리셋 옵션/리스트 초기화)
  try { abgmRenderPlaylistPage(overlay); } catch {}

  // ===== NP(Home) events =====
  const playBtn = overlay.querySelector("#abgm_np_play");
  playBtn?.addEventListener("click", () => {
    NP.togglePlayPause();
  });

  overlay.querySelector("#abgm_np_prev")?.addEventListener("click", (e) => {
  e.stopPropagation?.();
  try { NP.npPrevAction?.(); } catch {}
});
overlay.querySelector("#abgm_np_next")?.addEventListener("click", (e) => {
  e.stopPropagation?.();
  try { NP.npNextAction?.(); } catch {}
});

  // NP seek
  const seek = overlay.querySelector("#abgm_np_seek");
  if (seek) {
    const preview = () => {
      const a = NP.getBgmAudio();
      const curEl = document.getElementById("abgm_np_time_cur");
      const durEl = document.getElementById("abgm_np_time_dur");
      const v = Number(seek.value || 0) / 1000;
      const dur = Number(a?.duration);
      if (curEl) curEl.textContent = abgmFmtTime(v);
      if (durEl) durEl.textContent = Number.isFinite(dur) && dur > 0 ? abgmFmtTime(dur) : "0:00";
    };

    seek.addEventListener("input", () => {
      _abgmNpIsSeeking = true;
      preview();
    });

    seek.addEventListener("change", () => {
      const a = NP.getBgmAudio();
      const v = Number(seek.value || 0) / 1000;
      if (Number.isFinite(v)) {
        try { a.currentTime = Math.max(0, v); } catch {}
      }
      _abgmNpIsSeeking = false;
      scheduleNpSeekUpdate();
    });

    const endSeek = () => {
      _abgmNpIsSeeking = false;
      scheduleNpSeekUpdate();
    };
    seek.addEventListener("pointerup", endSeek);
    seek.addEventListener("pointercancel", endSeek);
  }

  // Mode cycle
  const modeBtn = overlay.querySelector("#abgm_np_mode");
  modeBtn?.addEventListener("click", () => {
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
    } else {
      s.keywordMode = false;
      s.playMode = next;
    }

    saveSettingsDebounced();
    try { NP.engineTick(); } catch {}
    updateNowPlayingUI();
  });

  // 뒤로가기(플로팅 메뉴 홈)
  overlay.querySelector("#abgm_np_back")?.addEventListener("click", () => {
    closeNowPlayingGlass();
    openFloatingMenu();
  });

  // ===== Playlist page events =====
  overlay.querySelector("#abgm_np_list")?.addEventListener("click", (e) => {
    e?.stopPropagation?.();
    abgmNpShowPage("pl");
  });

  overlay.querySelector("#abgm_pl_to_np")?.addEventListener("click", (e) => {
    e?.stopPropagation?.();
    abgmNpShowPage("np");
  });

  overlay.querySelector("#abgm_pl_home")?.addEventListener("click", (e) => {
    e?.stopPropagation?.();
    closeNowPlayingGlass();
    openFloatingMenu();
  });

  // 사이즈 맞추기
  try {
    NP.fitModalToHost(overlay, host);
    requestAnimationFrame(() => NP.fitModalToHost(overlay, host));
    setTimeout(() => NP.fitModalToHost(overlay, host), 120);
  } catch {}

  window.addEventListener("keydown", onNpGlassEsc);

  // 초기 업데이트
  bindNowPlayingEventsOnce();
  updateNowPlayingUI();
}

export function closeNowPlayingGlass() {
  const overlay = document.getElementById(NP_GLASS_OVERLAY_ID);
  if (overlay) overlay.remove();
  window.removeEventListener("keydown", onNpGlassEsc);
}

function onNpGlassEsc(e) {
  if (e.key === "Escape") closeNowPlayingGlass();
}

/** updateNowPlayingUI()에서 이 유리창도 같이 갱신 */
function updateNowPlayingGlassUI(title, presetName, modeLabel) {
  const t = document.getElementById("abgm_np_title");
  const p = document.getElementById("abgm_np_preset");
  const m = document.getElementById("abgm_np_mode_text"); // (숨김) 상태값 보관용
  const icon = document.getElementById("abgm_np_mode_icon");
  const btn = document.getElementById("abgm_np_mode");

  if (t) t.textContent = String(title ?? "(none)");
  if (p) p.textContent = String(presetName ?? "Preset");

  const keyRaw = String(modeLabel ?? "manual");
  const key = keyRaw.toLowerCase() === "keyword" ? "keyword" : keyRaw;

  const nice =
    key === "keyword" ? "Keyword" :
    key === "loop_one" ? "Loop One" :
    key === "loop_list" ? "Loop List" :
    key === "random" ? "Random" : "Manual";

  if (m) m.textContent = nice;
  if (icon) icon.src = ABGM_NP_MODE_ICON[key] || ABGM_NP_MODE_ICON.manual;
  if (btn) btn.title = `Mode: ${nice}`;
  
  scheduleNpSeekUpdate();
}

function updateNowPlayingGlassNavUI(settings, preset) {
  const prevBtn = document.getElementById('abgm_np_prev');
  const nextBtn = document.getElementById('abgm_np_next');
  if (!prevBtn || !nextBtn) return;

  const prevIcon = document.getElementById('abgm_np_prev_icon');
  const nextIcon = document.getElementById('abgm_np_next_icon');

  // Keyword mode: replace with (Use Default / Logic) buttons
  if (settings?.keywordMode) {
    if (prevIcon) prevIcon.src = settings.useDefault ? ABGM_NP_CTRL_ICON.useDefaultOn : ABGM_NP_CTRL_ICON.useDefaultOff;
    if (nextIcon) nextIcon.src = settings.keywordOnce ? ABGM_NP_CTRL_ICON.kwOnce : ABGM_NP_CTRL_ICON.kwHold;

    prevBtn.disabled = !settings.enabled;
    nextBtn.disabled = !settings.enabled;

    prevBtn.title = settings.useDefault ? 'Use Default: ON' : 'Use Default: OFF';
    nextBtn.title = settings.keywordOnce ? 'Keyword Logic: Once' : 'Keyword Logic: Hold';
    return;
  }

  if (prevIcon) prevIcon.src = ABGM_NP_CTRL_ICON.prev;
  if (nextIcon) nextIcon.src = ABGM_NP_CTRL_ICON.next;

  if (!settings?.enabled) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const ctx = NP.getSTContextSafe();
  const chatKey = NP.getChatKeyFromContext(ctx);
  settings.chatStates ??= {};
  settings.chatStates[chatKey] ??= { currentKey: '', listIndex: 0, lastSig: '', defaultPlayedSig: '', prevKey: '' };
  NP.ensureEngineFields(settings);

  const st = settings.chatStates[chatKey];
  const sort = NP.getBgmSort(settings);
  const keys = NP.getSortedKeys(preset, sort);

  if (!keys.length) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const mode = settings.playMode || 'manual';
  const cur = String(NP.getEngineCurrentFileKey() || st.currentKey || '');
  let idx = cur ? keys.indexOf(cur) : -1;
  if (idx < 0) idx = Math.max(0, Math.min(Number(st.listIndex || 0), keys.length - 1));

  let canPrev = false;
  let canNext = false;

  if (mode === 'loop_list') {
    canPrev = keys.length > 1;
    canNext = keys.length > 1;
  } else if (mode === 'random') {
    canNext = keys.length > 1;
    canPrev = !!st.prevKey;
  } else {
    if (!cur) {
      canPrev = keys.length > 0;
      canNext = keys.length > 0;
    } else {
      canPrev = idx > 0;
      canNext = idx < keys.length - 1;
    }
  }

  prevBtn.disabled = !canPrev;
  nextBtn.disabled = !canNext;

  prevBtn.title = prevBtn.disabled ? 'Prev' : 'Prev';
  nextBtn.title = nextBtn.disabled ? 'Next' : 'Next';
}

function updateNowPlayingGlassPlaylistUI(settings) {
  const overlay = abgmGetNpOverlay();
  if (!overlay) return;
  if (String(overlay.dataset.abgmPage || "np") !== "pl") return;
  
  const a = NP.getBgmAudio();
  const fk = String(NP.getEngineCurrentFileKey() || "");
  const isPlaying = !!settings?.enabled && !!fk && !a?.paused;

  overlay.querySelectorAll(".abgm-pl-item")?.forEach?.((row) => {
    const key = String(row.dataset.filekey || "");
    const isCur = key && fk && key === fk;

    row.classList.toggle("is-current", isCur);

    const btn = row.querySelector(".abgm-pl-play");
    if (btn) btn.textContent = (isCur && isPlaying) ? "⏸" : "▶";
  });
}

export function bindSideMenuNowPlayingControls(root) {
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
      try { NP.engineTick(); } catch {}
      updateNowPlayingUI();
    });

    // 처음 한번 UI 맞추기
    syncKeywordOnceUI();

    // Use Default 토글 (keywordMode일 때만 의미 있음)
    btnDef?.addEventListener("click", () => {
      const s = ensureSettings();
      s.useDefault = !s.useDefault;
      saveSettingsDebounced();
      try { NP.engineTick(); } catch {}
      updateNowPlayingUI();
    });

    // Play/Pause/Start
    btnPlay?.addEventListener("click", async () => {
      const s = ensureSettings();
      if (!s.enabled) return;

      // 현재 재생중이면 pause
      if (NP.getEngineCurrentFileKey() && !NP.getBgmAudio().paused) {
        try { NP.getBgmAudio().pause(); } catch {}
        updateNowPlayingUI();
        return;
      }

      // paused면 resume
      if (NP.getEngineCurrentFileKey() && NP.getBgmAudio().paused) {
        try { await NP.getBgmAudio().play(); } catch {}
        updateNowPlayingUI();
        return;
      }

      // stopped면 엔진 로직대로 “알아서” 시작
      try { NP.engineTick(); } catch {}
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
      try { NP.engineTick(); } catch {}
      updateNowPlayingUI();
      syncKeywordOnceUI();
    });
  }

function abgmRenderPlaylistPage(overlay, pidOverride) {
  const settings = ensureSettings();

  // 플리 렌더는 "UI 선택/override"가 최우선 (엔진 pid는 최후 fallback)
  const sel = overlay?.querySelector("#abgm_pl_preset");
  const pid = String(
    pidOverride ||
    sel?.value ||
    settings?.activePresetId ||
    NP.getEngineCurrentPresetId?.() ||
    ""
  );

  let preset =
    (pid && settings?.presets?.[pid]) ||
    settings?.presets?.[settings?.activePresetId] ||
    Object.values(settings?.presets || {})[0] ||
    null;

  // activePresetId가 실제로 없는 값이면 UI/렌더 일치시키기
  if (!settings?.presets?.[settings?.activePresetId] && preset?.id) {
    settings.activePresetId = String(preset.id);
  }

// --- preset select ---
const sel = overlay.querySelector("#abgm_pl_preset");
if (sel && !sel.__abgmBound) {
  sel.__abgmBound = true;

  sel.addEventListener("change", (e) => {
    const pid = String(e?.target?.value || "");
    const settings = ensureSettings();

    // 1) 새 pid를 settings에 먼저 확정
    settings.activePresetId = pid;
    // 2) 저장
    try { saveSettingsDebounced?.(); } catch {}
    // 3) 렌더는 "명시적으로 pid" 넘겨서 (렌더쪽이 헷갈릴 여지 제거)
    try { abgmRenderPlaylistPage(overlay, pid); }
    catch (err) { console.error("[AutoBGM] render playlist failed", err); }
    // 4) NP 상단도 동기화
    try { updateNowPlayingUI(); } catch {}
  });
}

  if (sel) {
    sel.innerHTML = "";
    const presetsSorted = Object.values(settings.presets || {}).sort((a, b) =>
      String(a?.name ?? a?.id ?? "").localeCompare(
        String(b?.name ?? b?.id ?? ""),
        undefined,
        { numeric: true, sensitivity: "base" }
      )
    );

    for (const p of presetsSorted) {
      const opt = document.createElement("option");
      opt.value = String(p.id);
      opt.textContent = String(p.name || p.id);
      if (String(p.id) === String(settings.activePresetId)) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  // --- sort button ---
  const sortBtn = overlay.querySelector("#abgm_pl_sort");
  if (sortBtn && !sortBtn.__abgmBound) {
    sortBtn.__abgmBound = true;

    sortBtn.addEventListener("click", () => {
      const next = NP.abgmCycleBgmSort(settings);
      saveSettingsDebounced();
      sortBtn.title = `Sort: ${NP.abgmSortNice(next)}`;
      try { abgmRenderPlaylistPage(overlay); } catch {}
    });
  }
  if (sortBtn) sortBtn.title = `Sort: ${NP.abgmSortNice(NP.getBgmSort(settings))}`;

  // --- list render ---
  const list = overlay.querySelector("#abgm_pl_list");
  if (!list) return;

  if (!list.__abgmBound) {
    list.__abgmBound = true;

    list.addEventListener("click", (e) => {
      const play = e.target.closest(".abgm-pl-play");
      if (!play) return;
      const fk = String(play.dataset.filekey || "").trim();
      abgmPlayFromPlaylist(fk);
    });
  }

  const bgms = NP.getSortedBgms(preset || {}, NP.getBgmSort(settings))
    .filter(b => String(b?.fileKey ?? "").trim());

  list.innerHTML = "";

  if (!bgms.length) {
    const empty = document.createElement("div");
    empty.className = "abgm-pl-empty";
    empty.textContent = "곡 없음";
    list.appendChild(empty);
    return;
  }

  const curKey = String(NP.getEngineCurrentFileKey() || "");
  const a = NP.getBgmAudio();
  const isPlaying = !!settings.enabled && !!curKey && !a?.paused;

  for (const b of bgms) {
    const fk = String(b.fileKey || "");
    const name = NP.getEntryName(b);
    const dur = Number(b.durationSec ?? 0);
    const durText = (Number.isFinite(dur) && dur > 0) ? abgmFmtTime(dur) : "";

    const row = document.createElement("div");
    row.className = "abgm-pl-item";
    row.dataset.filekey = fk;

    const isCur = (fk === curKey);
    if (isCur) row.classList.add("is-current");

    const icon = (isCur && isPlaying) ? "⏸" : "▶";

    row.innerHTML = `
      <div class="abgm-pl-left">
        <div class="abgm-pl-row1">
          <div class="abgm-pl-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="abgm-pl-dur">${escapeHtml(durText ? `(${durText})` : "")}</div>
        </div>
      </div>

      <button type="button" class="menu_button abgm-pl-play" data-filekey="${escapeHtml(fk)}" title="Play">
        ${icon}
      </button>
    `;

    list.appendChild(row);
  }
}

function abgmPlayFromPlaylist(fileKey) {
  const fk = String(fileKey || "").trim();
  if (!fk) return;

  const settings = ensureSettings();
  if (!settings.enabled) return;

  // "리스트에서 골라 재생"이면 일단 수동 모드로 확정 (원하면 나중에 정책 바꿔도 됨)
  settings.keywordMode = false;
  settings.playMode = "manual";

  const preset = NP.getActivePreset(settings);
  // findBgmByKey 대신(주입 안 돼있을 수도 있어서) 그냥 똑같이 찾기
  const b = (preset?.bgms ?? []).find(x => String(x?.fileKey ?? "").trim() === fk) || null;
  const gv = Number(settings.globalVolume ?? 0.7);
  const bv = Number(b?.volume ?? 1);
  const vol01 = Math.max(0, Math.min(1, gv * bv));

  saveSettingsDebounced();
  NP.ensurePlayFile(fk, vol01, false, preset?.id || "");
  updateNowPlayingUI();
}
