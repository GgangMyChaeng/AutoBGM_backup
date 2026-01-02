// AutoBGM/modules/ui_nowplaying.js
import { ensureSettings } from "./settings.js";
import { saveSettingsDebounced } from "./deps.js";
import { openFloatingMenu } from "./ui_floating.js";

/**
 * index.js 쪽 함수/상태를 “그대로” 쓰기 위한 브릿지
 * (로직 변경 없이 위치만 옮기려고)
 */
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

/**
 * (사이드메뉴) Now Playing controls bind
 * index.js의 `// ===== side-menu Now Playing controls bind =====` 블록을 통째로 여기로 옮기면 됨
 */
export function bindSideMenuNowPlayingControls(root) {
  // TODO: index.js 블록 그대로 붙여넣기
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
  // TODO: index.js 함수 그대로 붙여넣기 + 위 치환만
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

