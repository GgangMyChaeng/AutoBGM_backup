import { ensureSettings } from "./settings.js";
import { saveSettingsDebounced } from "./deps.js";
import { openFloatingMenu } from "./ui_floating.js";

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
  getBgmSort: () => "manual",
  abgmCycleBgmSort: () => "manual",
  abgmSortNice: (k) => String(k ?? "manual"),
  ensurePlayFile: () => {},
};

export function abgmBindNowPlayingDeps(partial = {}) {
  Object.assign(NP, partial || {});
}

/* ======================================================
   아래부터: index.js에 있던 “Now Playing UI” 덩어리 옮겨오기
   - updateNowPlayingUI
   - setNowControlsLocked
   - bindNowPlayingEventsOnce
   - scheduleNpSeekUpdate / updateNowPlayingGlassSeekUI
   - openNowPlayingGlass / closeNowPlayingGlass / onNpGlassEsc
   - updateNowPlayingGlassUI / updateNowPlayingGlassNavUI / updateNowPlayingGlassPlaylistUI
   - Playlist page: abgmRenderPlaylistPage / abgmPlayFromPlaylist 등
   - (사이드메뉴) bindSideMenuNowPlayingControls(root)
   ====================================================== */

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

/**
 * updateNowPlayingUI
 * index.js 함수 통째로 옮기되, 아래 변수만 NP.*로 바꿔주면 됨:
 *  - _bgmAudio -> NP.getBgmAudio()
 *  - _engineCurrentFileKey -> NP.getEngineCurrentFileKey()
 *  - _engineCurrentPresetId -> NP.getEngineCurrentPresetId()
 *  - engineTick() -> NP.engineTick()
 *  - updateMenuNPAnimation() -> NP.updateMenuNPAnimation()
 *  - updateModalNowPlayingSimple(title) -> NP.updateModalNowPlayingSimple(title)
 */
export function updateNowPlayingUI() {
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
    updateNowPlayingGlassUI(title, presetName, modeLabel);
    updateNowPlayingGlassNavUI(settings, preset);
    try { updateNowPlayingGlassPlaylistUI(settings); } catch {}

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
    const stopped = !settings.enabled || !fk;
    const icon = stopped ? "⏹️" : (_bgmAudio?.paused ? "▶️" : "⏸️");

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
      } else if (_bgmAudio?.paused) {
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
    updateMenuNPAnimation();
  } catch (e) {
    console.error("[AutoBGM] updateNowPlayingUI failed:", e);
  }
}

export function bindNowPlayingEventsOnce() {
  // TODO: index.js 함수 그대로 붙여넣기 + _bgmAudio를 NP.getBgmAudio()로 치환
}

export function openNowPlayingGlass() {
  // TODO: index.js 함수 그대로 붙여넣기 + 아래 치환만
  // - togglePlayPause() -> NP.togglePlayPause()
  // - engineTick() -> NP.engineTick()
  // - getModalHost() -> NP.getModalHost()
  // - fitModalToHost(...) -> NP.fitModalToHost(...)
}

export function closeNowPlayingGlass() {
  // TODO: index.js 함수 그대로 붙여넣기
}

