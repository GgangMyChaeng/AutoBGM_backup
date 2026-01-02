// 플로팅 버튼 + 플로팅 메뉴 + 드래그/스냅
// (index.js에서 ctx로 필요한 함수만 주입받아서 돌아가게 설계)

export function initFloatingUI(ctx) {
  // ctx:
  // - ensureSettings()
  // - saveSettingsDebounced()
  // - openModal()
  // - openNowPlayingGlass()
  // - toggleDebugMode()
  // - getIsPlaying(): boolean
  // - getDebugOn(): boolean

  let _floatingBtn = null;
  let _floatingMenu = null;
  let _floatingMenuOpen = false;
  let _floatingDragging = false;
  let _floatingDragOffset = { x: 0, y: 0 };

  function createFloatingButton() {
    if (_floatingBtn) return _floatingBtn;

    const settings = ctx.ensureSettings();

    const btn = document.createElement("div");
    btn.id = "abgm_floating_btn";
    btn.className = "abgm-floating-btn";
    btn.innerHTML = `
      <div class="abgm-floating-icon">
        <img src="https://i.postimg.cc/P5Dxmj6T/Floating.png"
             style="width:100%; height:100%; border-radius:50%; object-fit:cover;"
             alt="AutoBGM">
      </div>
    `;

    // 초기 위치
    const x = settings.floating?.x ?? window.innerWidth - 40;
    const y = settings.floating?.y ?? window.innerHeight - 100;
    btn.style.left = `${x}px`;
    btn.style.top = `${y}px`;

    // 드래그 시작
    btn.addEventListener("mousedown", onDragStart);
    btn.addEventListener("touchstart", onDragStart, { passive: false });

    // 클릭(탭)하면 메뉴 토글
    btn.addEventListener("click", (e) => {
      // 드래그 끝난 직후 클릭 튀는 거 방지
      if (_floatingDragging) return;
      if (_floatingMenuOpen) closeFloatingMenu();
      else openFloatingMenu();
      e.stopPropagation();
    });

    document.documentElement.appendChild(btn);
    _floatingBtn = btn;
    return btn;
  }

  function removeFloatingButton() {
    if (_floatingBtn) {
      _floatingBtn.remove();
      _floatingBtn = null;
    }
  }

  function createFloatingMenu() {
    if (_floatingMenu) return _floatingMenu;

    const menu = document.createElement("div");
    menu.id = "abgm_floating_menu";
    menu.className = "abgm-floating-menu";
    menu.innerHTML = `
      <div class="abgm-floating-menu-bg">
        <img src="https://i.postimg.cc/6p5Tk9G0/Home.png" class="abgm-menu-body-img" alt="Menu">
      </div>
      <div class="abgm-floating-menu-buttons">
        <button type="button" class="abgm-menu-btn abgm-menu-np" data-action="nowplaying" title="Now Playing">
          <img src="https://i.postimg.cc/3R8x5D3T/Now_Playing.png" class="abgm-menu-icon abgm-menu-icon-np" alt="NP">
        </button>
        <button type="button" class="abgm-menu-btn abgm-menu-debug" data-action="debug" title="Debug">
          <img src="https://i.postimg.cc/sDNDNb5c/Debug_off.png" class="abgm-menu-icon abgm-menu-icon-debug" alt="Debug">
        </button>
        <button type="button" class="abgm-menu-btn abgm-menu-help" data-action="help" title="Help">
          <img src="https://i.postimg.cc/NGPfSMVZ/Help.png" class="abgm-menu-icon" alt="Help">
        </button>
        <button type="button" class="abgm-menu-btn abgm-menu-settings" data-action="settings" title="Settings">
          <img src="https://i.postimg.cc/j5cRQ1sC/Settings.png" class="abgm-menu-icon" alt="Settings">
        </button>
      </div>
    `;

    // 버튼 클릭 이벤트
    menu.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) {
        // 배경 클릭 시 닫기
        if (e.target === menu) closeFloatingMenu();
        return;
      }

      const action = btn.dataset.action;

      if (action === "nowplaying") {
        ctx.openNowPlayingGlass?.();
        closeFloatingMenu();
      } else if (action === "debug") {
        ctx.toggleDebugMode?.();
        syncIcons();
      } else if (action === "help") {
        console.log("[AutoBGM] Help clicked");
      } else if (action === "settings") {
        ctx.openModal?.();
        closeFloatingMenu();
      }
    });

    document.documentElement.appendChild(menu);
    _floatingMenu = menu;
    return menu;
  }

  function openFloatingMenu() {
    if (_floatingMenuOpen) return;
    const menu = createFloatingMenu();

    // viewport 기준 중앙
    menu.style.left = "50vw";
    menu.style.top = "50vh";

    menu.classList.add("is-open");
    _floatingMenuOpen = true;

    syncIcons();

    // 메뉴 바깥 클릭 감지
    setTimeout(() => {
      document.addEventListener("click", onMenuOutsideClick, true);
    }, 100);
  }

  function closeFloatingMenu() {
    if (!_floatingMenu) return;
    _floatingMenu.classList.remove("is-open");
    _floatingMenuOpen = false;
    document.removeEventListener("click", onMenuOutsideClick, true);
  }

  function onMenuOutsideClick(e) {
    if (!_floatingMenu || !_floatingMenuOpen) return;
    if (!_floatingMenu.contains(e.target) && e.target !== _floatingBtn) {
      closeFloatingMenu();
    }
  }

  function removeFloatingMenu() {
    if (_floatingMenu) {
      _floatingMenu.remove();
      _floatingMenu = null;
      _floatingMenuOpen = false;
    }
  }

  function updateMenuDebugIcon() {
    if (!_floatingMenu) return;
    const on = !!ctx.getDebugOn?.();
    const icon = _floatingMenu.querySelector(".abgm-menu-icon-debug");
    if (icon) {
      icon.src = on
        ? "https://i.postimg.cc/N0hGgTJ7/Debug_on.png"
        : "https://i.postimg.cc/sDNDNb5c/Debug_off.png";
    }
  }

  function updateMenuNPAnimation() {
    if (!_floatingMenu) return;
    const icon = _floatingMenu.querySelector(".abgm-menu-icon-np");
    if (!icon) return;
    const isPlaying = !!ctx.getIsPlaying?.();
    icon.classList.toggle("is-playing", isPlaying);
  }

  function syncIcons() {
    updateMenuDebugIcon();
    updateMenuNPAnimation();
  }

  function onDragStart(e) {
    e.preventDefault();
    if (!_floatingBtn) return;
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
    if (!_floatingDragging || !_floatingBtn) return;
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

  function onDragEnd() {
    if (!_floatingDragging || !_floatingBtn) return;
    _floatingDragging = false;
    _floatingBtn.classList.remove("dragging");

    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("touchmove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    document.removeEventListener("touchend", onDragEnd);

    const rect = _floatingBtn.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // SillyTavern 영역 기준
    const appEl = document.querySelector("#app") || document.querySelector("main") || document.body;
    const appRect = appEl.getBoundingClientRect();

    const screenW = appRect.width;
    const screenH = appRect.height;

    // 상단 중앙(비활성화)
    const topCenterLeft = appRect.left + screenW * 0.25;
    const topCenterRight = appRect.left + screenW * 0.75;
    const topThreshold = appRect.top + screenH * 0.2;

    // 하단 중앙(메뉴 오픈)
    const bottomCenterLeft = appRect.left + screenW * 0.35;
    const bottomCenterRight = appRect.left + screenW * 0.85;
    const bottomThreshold = appRect.top + screenH * 0.8;

    // 상단 중앙에 놓으면 → 비활성화
    if (centerY < topThreshold && centerX > topCenterLeft && centerX < topCenterRight) {
      const s = ctx.ensureSettings();
      s.floating.enabled = false;
      ctx.saveSettingsDebounced?.();
      removeFloatingButton();
      removeFloatingMenu();

      const toggle = document.querySelector("#autobgm_floating_toggle");
      if (toggle) {
        const stateEl = toggle.querySelector(".autobgm-menu-state");
        if (stateEl) stateEl.textContent = "Off";
      }
      return;
    }

    // 하단 중앙에 놓으면 → 메뉴 열기
    if (centerY > bottomThreshold && centerX > bottomCenterLeft && centerX < bottomCenterRight) {
      snapToEdge();
      openFloatingMenu();
      persistPos();
      return;
    }

    // 그 외: 벽 스냅만
    snapToEdge();
    persistPos();
  }

  function persistPos() {
    if (!_floatingBtn) return;
    const s = ctx.ensureSettings();
    const r = _floatingBtn.getBoundingClientRect();
    s.floating.x = r.left;
    s.floating.y = r.top;
    ctx.saveSettingsDebounced?.();
  }

  function snapToEdge() {
    if (!_floatingBtn) return;
    const rect = _floatingBtn.getBoundingClientRect();
    const w = rect.width;
    const centerX = rect.left + w / 2;

    let targetX = rect.left;
    if (centerX < window.innerWidth / 2) {
      targetX = 10; // 왼쪽
    } else {
      targetX = window.innerWidth - w - 10; // 오른쪽
    }

    _floatingBtn.style.left = `${targetX}px`;
  }

  return {
    createFloatingButton,
    removeFloatingButton,
    openFloatingMenu,
    closeFloatingMenu,
    removeFloatingMenu,
    syncIcons,
  };
}
