import { openFreeSourcesModal } from "./ui_freesources.js";

/** ========= Modal logic ========= */
export function initModal(overlay) {
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
