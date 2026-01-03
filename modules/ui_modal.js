// (index.js에서 모달 관련 open/close/fit/host만 분리)
// 로직/타이밍/동작 그대로, 의존성은 bind로만 주입

let _loadHtml = async () => "";
let _initModal = () => {};
let _bindNowPlayingEventsOnce = () => {};
let _updateNowPlayingUI = () => {};

export function abgmBindModalDeps(deps = {}) {
  if (typeof deps.loadHtml === "function") _loadHtml = deps.loadHtml;
  if (typeof deps.initModal === "function") _initModal = deps.initModal;
  if (typeof deps.bindNowPlayingEventsOnce === "function") _bindNowPlayingEventsOnce = deps.bindNowPlayingEventsOnce;
  if (typeof deps.updateNowPlayingUI === "function") _updateNowPlayingUI = deps.updateNowPlayingUI;
}

const MODAL_OVERLAY_ID = "abgm_modal_overlay";
let _abgmViewportHandler = null;

export function fitModalToViewport(overlay) {
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

export function getModalHost() {
  return (
    document.querySelector("#app") ||
    document.querySelector("#sillytavern") ||
    document.querySelector("main") ||
    document.body
  );
}

export function fitModalToHost(overlay, host) {
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

function onEscClose(e) {
  if (e.key === "Escape") closeModal();
}

/** ========= Modal open/close ========= */
export function closeModal() {
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

  _updateNowPlayingUI();
}

export async function openModal() {
  if (document.getElementById(MODAL_OVERLAY_ID)) return;

  let html = "";
  try {
    html = await _loadHtml("templates/popup.html");
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

  _initModal(overlay);
  _bindNowPlayingEventsOnce();
  _updateNowPlayingUI();

  console.log("[AutoBGM] modal opened");
}
