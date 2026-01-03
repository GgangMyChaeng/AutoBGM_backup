import { abgmNormTag, abgmNormTags, tagCat, sortTags, tagPretty } from "./tags.js";
import { getModalHost } from "./ui_modal.js";

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// 프리뷰 재생(지금 playAsset/_testAudio undefined라서 최소 구현)
let _testAudio = null;
function playAsset(src, vol01 = 0.6) {
  try {
    if (!_testAudio) _testAudio = new Audio();
    _testAudio.pause();
    _testAudio.src = String(src || "");
    _testAudio.volume = Math.max(0, Math.min(1, Number(vol01 ?? 0.6)));
    _testAudio.currentTime = 0;
    _testAudio.play().catch(() => {});
  } catch {}
}

let _loadHtml = async () => "";
let _ensureSettings = () => ({});
let _saveSettingsDebounced = () => {};
let _openModal = async () => {};
let _closeModal = () => {};

// (FreeSources가 프리뷰/재생에 NP 엔진 쓰면 여기도 주입)
let _ensurePlayFile = async () => {};
let _stopRuntime = () => {};

let _syncFreeSourcesFromJson = async () => {};
let _syncBundledFreeSourcesIntoSettings = async () => {};

export function abgmBindFreeSourcesDeps(deps = {}) {
  if (typeof deps.loadHtml === "function") _loadHtml = deps.loadHtml;
  if (typeof deps.ensureSettings === "function") _ensureSettings = deps.ensureSettings;
  if (typeof deps.saveSettingsDebounced === "function") _saveSettingsDebounced = deps.saveSettingsDebounced;
  if (typeof deps.openModal === "function") _openModal = deps.openModal;
  if (typeof deps.closeModal === "function") _closeModal = deps.closeModal;

  if (typeof deps.ensurePlayFile === "function") _ensurePlayFile = deps.ensurePlayFile;
  if (typeof deps.stopRuntime === "function") _stopRuntime = deps.stopRuntime;

  if (typeof deps.syncFreeSourcesFromJson === "function") _syncFreeSourcesFromJson = deps.syncFreeSourcesFromJson;
  if (typeof deps.syncBundledFreeSourcesIntoSettings === "function") _syncBundledFreeSourcesIntoSettings = deps.syncBundledFreeSourcesIntoSettings;
}

// 여기 아래에 index.js에서 잘라낸 FreeSources 코드 덩어리 그대로 붙여넣기
// 그리고 그 코드 안에서 loadHtml/ensureSettings/openModal/... 쓰던 건
// !!룰!! _loadHtml/_ensureSettings/_openModal 이런 식으로만 치환

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

// ===== FreeSources UI state 프리소스UI =====
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
export function closeFreeSourcesModal() {
  const overlay = document.getElementById(FS_OVERLAY_ID);
  if (overlay) overlay.remove();
  window.removeEventListener("keydown", abgmFsOnEsc);
}

function abgmFsOnEsc(e) {
  if (e.key === "Escape") closeFreeSourcesModal();
}

// main
export async function openFreeSourcesModal() {
  await _syncFreeSourcesFromJson({ force: true, save: true });
  if (document.getElementById(FS_OVERLAY_ID)) return;

  let html = "";
  try {
    html = await _loadHtml("templates/freesources.html");
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

  // overlay 스타일
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
  const settings = _ensureSettings();
  await _syncBundledFreeSourcesIntoSettings(settings, { force: true, save: true });

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

      _saveSettingsDebounced();
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

      _saveSettingsDebounced();
      renderFsAll(root, settings);
    });
  });

  // search
  const search = root.querySelector("#abgm_fs_search");
  search?.addEventListener("input", (e) => {
    settings.fsUi.search = e.target.value || "";
    _saveSettingsDebounced();
    renderFsList(root, settings);
  });

  // 프리뷰 볼륨
  const prevRange = root.querySelector("#abgm_fs_prevvol");
  prevRange?.addEventListener("input", (e) => {
    if (fsGetPreviewLock(settings)) return;
    fsSetPreviewVol100(settings, e.target.value);
    _saveSettingsDebounced();
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
    _saveSettingsDebounced();
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
      _saveSettingsDebounced();
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
      _saveSettingsDebounced();
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
      _saveSettingsDebounced();
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

