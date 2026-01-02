import { ensureSettings } from "./settings.js";
import { saveSettingsDebounced } from "./deps.js";

// index.js에 있던 다른 기능(모달/NP/디버그 토글) 콜백만 연결해줌
let openModal = () => {};
let openNowPlayingGlass = () => {};
let toggleDebugMode = () => {};

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

// 마지막에 필요한 것만 export로 열어주기
export {
  createFloatingButton,
  removeFloatingButton,
  removeFloatingMenu,
  openFloatingMenu,
  closeFloatingMenu,
  updateFloatingButtonPosition,
};

