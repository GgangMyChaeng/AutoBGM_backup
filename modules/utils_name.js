// modules/utils_name.js

export function isProbablyUrl(s) {
  const v = String(s ?? "").trim();
  return /^https?:\/\//i.test(v);
}

// ===== Entry Name helpers =====
export function nameFromSource(src = "") {
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

export function getEntryName(bgm) {
  const n = String(bgm?.name ?? "").trim();
  return n ? n : nameFromSource(bgm?.fileKey ?? "");
}

export function ensureBgmNames(preset) {
  for (const b of preset?.bgms ?? []) {
    if (!String(b?.name ?? "").trim()) {
      b.name = nameFromSource(b.fileKey);
    }
  }
}

// ===== Dropbox URL normalize (audio용) =====
export function dropboxToRaw(u) {
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
