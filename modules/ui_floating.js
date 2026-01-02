import { ensureSettings } from "./settings.js";
import { saveSettingsDebounced } from "./deps.js";

// index.js에 있던 다른 기능(모달/NP/디버그 토글) 콜백만 연결해줌
let openModal = () => {};
let openNowPlayingGlass = () => {};
let toggleDebugMode = () => {};

export function abgmGetFloatingMenuEl() {
  return _floatingMenu;
}

export function abgmBindFloatingActions(actions = {}) {
  if (typeof actions.openModal === "function") openModal = actions.openModal;
  if (typeof actions.openNowPlayingGlass === "function") openNowPlayingGlass = actions.openNowPlayingGlass;
  if (typeof actions.toggleDebugMode === "function") toggleDebugMode = actions.toggleDebugMode;
}

/** ========= Floating Button ========= */
let _floatingBtn = null;
let _floatingMenu = null;
let _floatingMenuOpen = false;
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
    <img src="https://i.postimg.cc/P5Dxmj6T/Floating.png" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" 
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

  document.documentElement.appendChild(btn);
  _floatingBtn = btn;
  return btn;
}

// 플로팅 버튼 작동 로직
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

  const rect = _floatingBtn.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  // SillyTavern 영역 기준
  const appEl = document.querySelector("#app") || document.querySelector("main") || document.body;
  const appRect = appEl.getBoundingClientRect();
  
  const screenW = appRect.width;
  const screenH = appRect.height;
  
  // 상단 중앙 영역 (화면 가로 중앙 ±25%, 세로 상단 20% 이내)
  const topCenterLeft = appRect.left + screenW * 0.25;
  const topCenterRight = appRect.left + screenW * 0.75;
  const topThreshold = appRect.top + screenH * 0.2;
  
  // 하단 중앙 영역 (화면 가로 중앙 ±25%, 세로 하단 20% 이내)
  const bottomCenterLeft = appRect.left + screenW * 0.35;
  const bottomCenterRight = appRect.left + screenW * 0.85;
  const bottomThreshold = appRect.top + screenH * 0.8;

  // 상단 중앙에 놓으면 → 비활성화
  if (centerY < topThreshold && centerX > topCenterLeft && centerX < topCenterRight) {
    const s = ensureSettings();
    s.floating.enabled = false;
    saveSettingsDebounced();
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
    
    const s = ensureSettings();
    const rect2 = _floatingBtn.getBoundingClientRect();
    s.floating.x = rect2.left;
    s.floating.y = rect2.top;
    saveSettingsDebounced();
    return;
  }

  // 그 외: 벽에 스냅만
  snapToEdge();

  const s = ensureSettings();
  const rect3 = _floatingBtn.getBoundingClientRect();
  s.floating.x = rect3.left;
  s.floating.y = rect3.top;
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

function removeFloatingButton() {
  if (_floatingBtn) {
    _floatingBtn.remove();
    _floatingBtn = null;
  }
}

// 플로팅 메뉴 생성
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
      // 버튼이 아닌 메뉴 바깥(배경) 클릭 시 닫기
      if (e.target === menu) {
        closeFloatingMenu();
      }
      return;
    }

    const action = btn.dataset.action;
    
    if (action === "nowplaying") {
      openNowPlayingGlass();
      closeFloatingMenu(); // NP 뜨면 플로팅 메뉴는 닫기
    } else if (action === "debug") {
      toggleDebugMode();
    } else if (action === "help") {
      // Help 섹션 열기 (나중에 구현)
      console.log("[AutoBGM] Help clicked");
    } else if (action === "settings") {
      openModal();
      closeFloatingMenu();
    }
  });

  document.documentElement.appendChild(menu);
  _floatingMenu = menu;
  return menu;
}

function updateMenuDebugIcon() {
  if (!_floatingMenu) return;
  const s = ensureSettings();
  const on = !!s.debugMode;
  const icon = _floatingMenu.querySelector(".abgm-menu-icon-debug");
  if (icon) {
    icon.src = on ? "https://i.postimg.cc/N0hGgTJ7/Debug_on.png" : "https://i.postimg.cc/sDNDNb5c/Debug_off.png";
  }
}

function openFloatingMenu() {
  if (_floatingMenuOpen) return;
  const menu = createFloatingMenu();
  
  // viewport 기준으로 고정 (폭 줄 때 상단으로 튀는 거 방지)
  menu.style.left = "50vw";
  menu.style.top = "50vh";
  
  menu.classList.add("is-open");
  _floatingMenuOpen = true;
  updateMenuDebugIcon();
  updateMenuNPAnimation();
  
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
  
  // 메뉴 영역 밖 클릭이면 닫기
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

// 창 크기 변경 시 플로팅 버튼 위치 조정
function updateFloatingButtonPosition() {
  if (!_floatingBtn) return;
  
  const rect = _floatingBtn.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const centerX = rect.left + w / 2;

  // 어느 쪽 벽에 붙어있었는지 판별
  const isLeft = centerX < window.innerWidth / 2;

  let targetX = isLeft ? (-w / 2) : (window.innerWidth - w / 2);
  let targetY = Math.max(0, Math.min(window.innerHeight - h, rect.top));

  _floatingBtn.style.left = `${targetX}px`;
  _floatingBtn.style.top = `${targetY}px`;

  const s = ensureSettings();
  s.floating.x = targetX;
  s.floating.y = targetY;
  saveSettingsDebounced();
}

// 마지막에 필요한 것만 export로 열어주기
export {
  createFloatingButton,
  removeFloatingButton,
  removeFloatingMenu,
  openFloatingMenu,
  closeFloatingMenu,
  updateFloatingButtonPosition,
};

