// modules/tags.js

/* =========================
   Tag auto categorizer
   ========================= */

// 단어(1토큰) 별칭 (주로 기호/표기 통일)
const TAG_ALIASES = new Map([
  ["hip-hop", "hiphop"],
  ["hip hop", "hiphop"],
  ["r&b", "rnb"],
  ["rnb", "rnb"],
  ["lofi", "lo-fi"], // 취향
]);

// “문구(여러 단어)”를 통째로 확정 매핑 (제일 정확함)
const PHRASE_ALIASES = new Map([
  ["alternative r&b", ["mood:alternative", "genre:rnb"]],
  ["acoustic pop", ["inst:acoustic", "genre:pop"]],
  ["neo soul", ["genre:neo_soul"]],
  ["bossa nova", ["genre:bossa_nova"]],
  ["lo-fi hip hop", ["mood:lofi", "genre:hiphop"]],
  ["glitch hop", ["genre:glitch_hop"]],
  ["jazz hop", ["genre:jazz_hop"]],
  ["industrial techno", ["genre:industrial", "genre:techno"]],
  ["electronic/edm", ["genre:electronic", "genre:edm"]],
  ["darksynth", ["genre:darksynth", "mood:dark", "inst:synth"]],
  ["french glitch", ["genre:french", "genre:glitch"]],
  ["808 bassline", ["inst:808_bass"]],
  ["industrial horror", ["mood:industrial", "mood:horror"]],
  ["mechanical groove", ["mood:mechanical", "mood:groove"]],
  ["night vibes", ["mood:night_vibes"]],
  ["tension", ["mood:tense"]],
  ["high-energy j-rock", ["mood:high-energy", "genre:j-rock"]],
]);

const GENRE_WORDS = new Set([
  "blues","jazz","rock","pop","country","classical","folk","funk","soul","reggae","metal","ambient",
  "electronic","edm","hiphop","rap","rnb","drill","idm","techno","glitch","j-rock"
]);

const MOOD_WORDS = new Set([
  "calm","dark","sad","happy","tense","chill","cozy","epic","mysterious",
  "alternative","chaotic","cinematic","cold","cyberpunk","tension","night","tight","lofi",
  "east asian influence","exploration","high-energy","hopeless","horizon","military",
  "underscore","mundane","soft"
]);

const INST_WORDS = new Set([
  "piano","guitar","strings","synth","bass","drums","orchestra",
  "acoustic","808","turntable","scratch","808_bass"
]);

const LYRIC_WORDS = new Set([
  "lyric","lyrics","no lyric","instrumental","vocal","male","female"
]);

function abgmCanonRawTag(raw) {
  let s = String(raw || "").trim().toLowerCase();
  if (!s) return "";

  // 공백 정리
  s = s.replace(/\s+/g, " ");

  // 숫자만 있으면 bpm
  if (/^\d{2,3}$/.test(s)) {
    const bpm = Number(s);
    if (bpm >= 40 && bpm <= 260) return `bpm:${bpm}`;
  }

  // 통째 문구 별칭 먼저
  if (PHRASE_ALIASES.has(s)) return s;

  // 단어 별칭 적용 (토큰 단위)
  s = s.split(" ").map(t => TAG_ALIASES.get(t) || t).join(" ");

  return s;
}

export function abgmNormTags(raw) {
  const s0 = abgmCanonRawTag(raw);
  if (!s0) return [];

  // bpm:xxx 같은 건 그대로 단일 반환
  if (s0.startsWith("bpm:")) return [s0];

  // 이미 cat:tag 형태면 그대로
  if (s0.includes(":") && !PHRASE_ALIASES.has(s0)) return [s0];

  // 문구 확정 매핑
  if (PHRASE_ALIASES.has(s0)) return PHRASE_ALIASES.get(s0).slice();

  // "/" 같은 구분자 들어오면 나눠서 재귀 처리
  if (s0.includes("/")) {
    return s0.split("/").flatMap(part => abgmNormTags(part));
  }

  // 여러 단어면 “마지막 단어=장르” 휴리스틱
  const toks = s0.split(" ").filter(Boolean);
  if (toks.length >= 2) {
    const lastRaw = toks[toks.length - 1];
    const last = TAG_ALIASES.get(lastRaw) || lastRaw;

    // 마지막이 장르면: genre:last + 앞 단어들은 mood/inst로 분류 시도
    if (GENRE_WORDS.has(last)) {
      const out = [`genre:${last}`];
      for (const w0 of toks.slice(0, -1)) {
        const w = TAG_ALIASES.get(w0) || w0;
        if (INST_WORDS.has(w)) out.push(`inst:${w}`);
        else if (MOOD_WORDS.has(w)) out.push(`mood:${w}`);
        else out.push(w); // 모르면 etc(콜론 없는 태그)
      }
      return out;
    }
  }

  // 한 단어면 단어사전으로 분류
  if (GENRE_WORDS.has(s0)) return [`genre:${s0}`];
  if (MOOD_WORDS.has(s0))  return [`mood:${s0}`];
  if (INST_WORDS.has(s0))  return [`inst:${s0}`];
  if (LYRIC_WORDS.has(s0)) return [`lyric:${s0}`];

  // 모르면 그대로 (etc)
  return [s0];
}

// 기존 코드 호환용: “단일 문자열”만 필요한 곳에서 쓰기
export function abgmNormTag(raw) {
  return abgmNormTags(raw)[0] || "";
}

// ===== tag display helper =====
export function tagVal(t){
  const s = abgmNormTag(t);
  const i = s.indexOf(":");
  return i > 0 ? s.slice(i + 1) : s;
}

const TAG_PRETTY_MAP = new Map([
  ["rnb", "R&B"],
  ["hiphop", "hip-hop"],
  ["lofi", "lo-fi"],
  ["idm", "IDM"],
  ["edm", "EDM"],
]);

export function tagCat(t) {
  const s = String(t || "").trim().toLowerCase();
  const i = s.indexOf(":");
  if (i <= 0) return "etc";
  return s.slice(0, i);
}

export function tagPretty(t){
  const s = abgmNormTag(t);
  const cat = tagCat(s);
  let v = tagVal(s).replace(/[_]+/g, " ").trim(); // neo_soul -> neo soul

  if (TAG_PRETTY_MAP.has(v)) v = TAG_PRETTY_MAP.get(v);
  if (cat === "bpm") return `${v} BPM`;
  return v;
}

const TAG_CAT_ORDER = ["genre","mood","inst","lyric","bpm","tempo","etc"];

function tagSortKey(t){
  const s = abgmNormTag(t);
  const cat = tagCat(s);
  const ci = TAG_CAT_ORDER.indexOf(cat);
  const catRank = ci === -1 ? 999 : ci;

  // bpm은 숫자 정렬
  if (cat === "bpm") {
    const n = Number(s.split(":")[1] ?? 0);
    return [catRank, n, s];
  }
  return [catRank, 0, s];
}

export function sortTags(arr){
  return [...arr].sort((a,b)=>{
    const A = tagSortKey(a), B = tagSortKey(b);
    if (A[0] !== B[0]) return A[0]-B[0];
    if (A[1] !== B[1]) return A[1]-B[1];
    return String(A[2]).localeCompare(String(B[2]), undefined, {numeric:true, sensitivity:"base"});
  });
}
