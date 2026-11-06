/* ADOFAI ANALYZER - 메인 스크립트 (순수 JS, 빌드 불필요) */
(() => {
  "use strict";

  /* ================= 설정 ================= */
  const CONFIG = {
    TUF_URL: "https://tuforums.com",               // TUF 메인 (문서의 tufforums.com 은 오타로 보임)
    LEVELS_URL: "https://tuforums.com/levels",     // 레벨 포럼 주소. 실제 경로와 다르면 여기만 수정
    LEVEL_PAGE: "https://tuforums.com/levels/",    // 맵 페이지 주소 = LEVEL_PAGE + tufId
    PAGE_SIZE: 30,                                 // "더 보기" 한 번에 보여줄 개수
    PATTERNS: ["질주", "복합", "체력", "개박", "동타", "마법진", "기믹", "판정제한"],
    MAX_KEYS: 16,
  };

  /* ================= 난이도 스케일 ================= */
  const PGU = [];
  ["P", "G", "U"].forEach((t) => { for (let i = 1; i <= 20; i++) PGU.push(t + i); });
  const LEGACY = [
    ...Array.from({ length: 20 }, (_, i) => String(i + 1)),
    "21.0", "21.0+", "21.1", "21.1+", "21.2", "21.2+", "21.3", "21.3+",
  ];
  const SCALES = { PGU, LEGACY };
  let LEVELS = [];          // levels.json 에서 불러옴
  let loadError = false;

  /* ================= 상태 ================= */
  const state = {
    unit: "PGU",
    lo: 0,
    hi: PGU.length - 1,
    keys: 0,                 // 0 = 선택 안 함, 1~16 = n키 이하, 17 = "16+" (16키 넘는 맵까지 전부)
    kmode: "",               // "" = 전체, "normal" = 일반 맵만, "limit" = 키 제한 맵만
    patterns: new Set(),
    pmode: "or",
    refOnly: false,
    view: "recommend",       // recommend | saved
    limit: CONFIG.PAGE_SIZE, // 지금 보여줄 개수
  };

  /* ================= 유틸 ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  /* ================= 인증 (데모용: localStorage) =================
   * 정적 사이트(GitHub Pages)에는 서버가 없어서 계정이 브라우저에만 저장됩니다.
   * 실제 서비스로 만들려면 Supabase / Firebase 같은 백엔드로 교체하세요.
   */
  const Auth = {
    users() { return LS.get("adofai_users", {}); },
    session() { return LS.get("adofai_session", null); },
    async hash(pw, salt) {
      const data = new TextEncoder().encode(salt + ":" + pw);
      if (window.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest("SHA-256", data);
        return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
      }
      let h = 5381; for (const b of data) h = ((h << 5) + h + b) >>> 0; // 폴백(보안성 낮음)
      return "f" + h.toString(16);
    },
    nickTaken(nick) {
      const n = nick.trim().toLowerCase();
      return Object.values(this.users()).some((u) => u.nick.toLowerCase() === n);
    },
    validId(id) { return /^[A-Za-z0-9!-\/:-@\[-`{-~]{8,}$/.test(id); },   // 영문/숫자/특수문자, 8자 이상
    validPw(pw) { return pw.length >= 7 && /[A-Za-z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw); },
    async signup(id, pw, nick) {
      const users = this.users();
      if (users[id]) return { ok: false, error: "이미 사용중인 ID입니다." };
      if (this.nickTaken(nick)) return { ok: false, error: "이미 사용중인 닉네임!" };
      const salt = crypto.getRandomValues ? [...crypto.getRandomValues(new Uint8Array(8))].join("") : String(Math.random());
      users[id] = { salt, hash: await this.hash(pw, salt), nick: nick.trim() };
      LS.set("adofai_users", users);
      return { ok: true };
    },
    async login(id, pw) {
      const u = this.users()[id];
      if (!u || (await this.hash(pw, u.salt)) !== u.hash) return { ok: false, error: "ID 또는 비밀번호가 올바르지 않습니다." };
      LS.set("adofai_session", { id, nick: u.nick });
      return { ok: true };
    },
    logout() { try { localStorage.removeItem("adofai_session"); } catch { /* ignore */ } },
  };

  const Saved = {
    key() { const s = Auth.session(); return s ? "adofai_saved_" + s.id : null; },
    list() { const k = this.key(); return k ? LS.get(k, []) : []; },
    has(id) { return this.list().includes(id); },
    toggle(id) {
      const k = this.key(); if (!k) return false;
      const l = this.list(); const i = l.indexOf(id);
      if (i >= 0) l.splice(i, 1); else l.push(id);
      LS.set(k, l); return true;
    },
  };

  /* ================= 필터 로직 ================= */
  const KEYS_PLUS = 17;   // "16+" 버튼 값. 레벨의 keys 가 17 이상이면 "16+키"로 표시
  function keyText(l) {
    if (l.keys == null) return "키 수 미확인";
    return (l.keys > CONFIG.MAX_KEYS ? CONFIG.MAX_KEYS + "+" : l.keys) + "키" + (l.keyLimit ? " 제한" : "");
  }

  function diffIndex(level) {
    const v = state.unit === "PGU" ? level.pgu : level.legacy;
    if (!v) return -1;
    return SCALES[state.unit].indexOf(v);
  }

  // 난이도를 모르는 레벨(-1)은 목록 맨 뒤로 보낸다
  const byDiff = (a, b) => (a.d < 0 ? 1e9 : a.d) - (b.d < 0 ? 1e9 : b.d);
  // 난이도 범위를 건드리지 않았을 때(전체 범위)만 난이도 미상 레벨도 보여준다
  const fullRange = () => state.lo === 0 && state.hi === SCALES[state.unit].length - 1;

  function getResults() {
    let list = LEVELS.map((l) => ({ l, d: diffIndex(l) }));
    if (state.view === "saved") {
      const ids = Saved.list();
      return list.filter((x) => ids.includes(x.l.id)).sort(byDiff).map((x) => x.l);
    }
    list = list.filter(({ l, d }) => {
      if (d < 0 ? !fullRange() : (d < state.lo || d > state.hi)) return false;
      if (state.kmode === "limit" && !l.keyLimit) return false;
      if (state.kmode === "normal" && l.keyLimit) return false;
      if (state.keys > 0 && state.keys < KEYS_PLUS && l.keys != null && l.keys > state.keys) return false;
      if (state.refOnly && !l.reference) return false;
      if (state.patterns.size) {
        const sel = [...state.patterns];
        const ok = state.pmode === "and"
          ? sel.every((p) => l.patterns.includes(p))
          : sel.some((p) => l.patterns.includes(p));
        if (!ok) return false;
      }
      return true;
    });
    return list.sort(byDiff).map((x) => x.l);
  }

  /* ================= 데이터 ================= */
  async function loadLevels() {
    try {
      const r = await fetch("levels.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      LEVELS = await r.json();
    } catch (e) {
      loadError = true;   // file:// 로 직접 열면 fetch 가 막힐 수 있음
    }
  }

  // 포럼 링크: forumUrl 이 있으면 그것, 없으면 tufId 로 TUF 맵 페이지 주소를 만든다
  function forumLink(l) {
    if (l.forumUrl && /^https?:\/\//i.test(l.forumUrl)) return l.forumUrl;
    if (l.tufId) return CONFIG.LEVEL_PAGE + encodeURIComponent(l.tufId);
    return "";
  }

  /* ================= 렌더링 ================= */
  // U1~U16 배지 색은 TUF 난이도표의 색상. P, G 는 표를 못 봐서 임의의 색
  const U_COLORS = ["#7B4FB2", "#744AA8", "#6E469F", "#674295", "#613E8C", "#5A3A83", "#543679", "#4D3170",
                    "#472D67", "#40295D", "#3A2554", "#33214A", "#34214C", "#261838", "#20142E", "#191025"];
  function tierColor(pgu) {
    if (!pgu) return "#3a2c58";
    const n = parseInt(pgu.slice(1), 10);
    if (pgu[0] === "U") return U_COLORS[Math.min(Math.max(n, 1), 16) - 1];
    return pgu[0] === "G" ? "#5a63b5" : "#a8528f";
  }
  // 큰 글씨 = 선택한 단위의 난이도, 작은 글씨 = 다른 단위의 난이도
  function diffBadge(l) {
    const main = state.unit === "PGU" ? l.pgu : l.legacy;
    const alt = state.unit === "PGU" ? l.legacy : l.pgu;
    const d = el("div", "diff");
    d.style.setProperty("--b", tierColor(l.pgu));
    if (l.pgu && l.pgu[0] === "U" && parseInt(l.pgu.slice(1), 10) >= 15) d.classList.add("hot");
    d.append(el("b", "", main || "-"), el("small", "", alt || ""));
    return d;
  }

  function renderList(keepLimit) {
    const box = $("#level-list");
    box.replaceChildren();
    if (!keepLimit) state.limit = CONFIG.PAGE_SIZE;
    const all = getResults();
    const rows = all.slice(0, state.limit);
    $("#results-title").textContent = state.view === "saved" ? "저장한 맵" : "추천 레벨 목록";
    $("#btn-recommend").classList.toggle("active", state.view === "recommend");
    $("#btn-saved").classList.toggle("active", state.view === "saved");
    $("#results-count").textContent = all.length + "개";

    if (!all.length) {
      const msg = loadError
        ? "levels.json 을 불러오지 못했습니다. GitHub Pages 또는 로컬 서버(python -m http.server)로 열어 주세요."
        : state.view === "saved" ? "저장한 맵이 없습니다." : "조건에 맞는 레벨이 없습니다.";
      box.append(el("div", "empty", msg));
      return;
    }
    rows.forEach((l) => {
      const card = el("div", "card");
      card.append(diffBadge(l));

      const mid = el("div");
      const title = el("div", "title", l.name);
      if (l.reference) title.append(el("span", "badge-ref", "기준맵" + (l.refFor ? " · " + l.refFor : "")));
      mid.append(title);
      mid.append(el("div", "meta", `${l.creator} · ${keyText(l)} · BPM ${l.bpm != null ? l.bpm : "-"}`));
      const chips = el("div", "chips");
      l.patterns.forEach((p) => chips.append(el("span", "chip static", p)));
      mid.append(chips);
      card.append(mid);

      const act = el("div", "actions");
      const bDetail = el("button", "btn", "상세");
      bDetail.onclick = () => openDetail(l);
      const bSave = el("button", "btn" + (Saved.has(l.id) ? " saved" : ""), Saved.has(l.id) ? "저장됨" : "저장");
      bSave.onclick = () => {
        if (!Auth.session()) { alert("맵 저장은 로그인 후 이용할 수 있습니다."); openModal("login"); return; }
        Saved.toggle(l.id); renderList(true);
      };
      const href = forumLink(l);
      if (href) {
        const bForum = el("a", "btn forum", "포럼 ↗");
        bForum.href = href; bForum.target = "_blank"; bForum.rel = "noopener";
        act.append(bForum);
      }
      act.append(bDetail, bSave);
      card.append(act);
      box.append(card);
    });

    if (all.length > rows.length) {
      const more = el("button", "btn block", `더 보기 (${all.length - rows.length}개 남음)`);
      more.onclick = () => { state.limit += CONFIG.PAGE_SIZE; renderList(true); };
      box.append(more);
    }
  }

  function openDetail(l) {
    const body = $("#detail-body");
    body.replaceChildren();
    const wrap = el("div", "detail");
    wrap.append(el("h2", "", l.name));
    wrap.append(el("div", "meta", "제작자: " + l.creator));
    const dl = el("dl");
    const add = (k, v) => { dl.append(el("dt", "", k), el("dd", "", v)); };
    add("PGU", l.pgu || "-");
    add("레거시", l.legacy || "-");
    add("권장 키", l.keys != null ? keyText(l) : "-");
    add("BPM", l.bpm != null ? String(l.bpm) : "-");
    add("패턴", l.patterns.join(", ") || "-");
    add("기준 맵", l.reference ? "예" + (l.refFor ? " (" + l.refFor + ")" : "") : "아니오");
    wrap.append(dl);
    wrap.append(el("div", "desc", l.desc || "설명이 없습니다."));
    const links = el("div", "links");
    const addLink = (label, url) => {
      if (!url || !/^https?:\/\//i.test(url)) return;
      const a = el("a", "btn", label); a.href = url; a.target = "_blank"; a.rel = "noopener"; links.append(a);
    };
    addLink("영상 보기", l.videoUrl);
    addLink("포럼 페이지", forumLink(l));
    if (links.children.length) wrap.append(links);
    body.append(wrap);
    openModal("detail");
  }

  /* ================= 필터 UI ================= */
  function syncRange() {
    const max = SCALES[state.unit].length - 1;
    const lo = $("#range-min"), hi = $("#range-max");
    lo.max = hi.max = max;
    lo.value = state.lo; hi.value = state.hi;
    const s = SCALES[state.unit];
    $("#range-label").textContent = `${s[state.lo]} ~ ${s[state.hi]}`;
    const fill = $("#range-fill");
    fill.style.left = (state.lo / max) * 100 + "%";
    fill.style.right = (100 - (state.hi / max) * 100) + "%";
  }

  function onRange(which) {
    let lo = +$("#range-min").value, hi = +$("#range-max").value;
    if (lo > hi) { if (which === "min") lo = hi; else hi = lo; }
    state.lo = lo; state.hi = hi;
    syncRange(); renderList();
  }

  function buildKeyDots() {
    const box = $("#key-dots");
    for (let i = 1; i <= CONFIG.MAX_KEYS; i++) {
      const d = el("button", "dot", String(i));
      d.type = "button";
      d.onclick = () => { state.keys = state.keys === i ? 0 : i; syncKeys(); renderList(); };
      box.append(d);
    }
    const plus = el("button", "dot plus", CONFIG.MAX_KEYS + "+");
    plus.type = "button";
    plus.title = "16키를 넘는 맵까지 전부";
    plus.onclick = () => { state.keys = state.keys === KEYS_PLUS ? 0 : KEYS_PLUS; syncKeys(); renderList(); };
    box.append(plus);
  }
  function syncKeys() {
    $$(".dot").forEach((d, i) => d.classList.toggle("on", state.keys > 0 && i + 1 <= state.keys));
    $("#keys-label").textContent = !state.keys ? "제한 없음" : state.keys >= KEYS_PLUS ? CONFIG.MAX_KEYS + "+ (전부)" : `${state.keys}키 이하`;
    $$("#keymode .seg").forEach((b) => b.classList.toggle("active", b.dataset.kmode === state.kmode));
  }

  function buildPatternChips() {
    const box = $("#pattern-chips");
    CONFIG.PATTERNS.forEach((p) => {
      const c = el("button", "chip", p); c.type = "button";
      c.onclick = () => {
        state.patterns.has(p) ? state.patterns.delete(p) : state.patterns.add(p);
        c.classList.toggle("on", state.patterns.has(p)); renderList();
      };
      box.append(c);
    });
  }

  function setUnit(unit) {
    state.unit = unit;
    state.lo = 0; state.hi = SCALES[unit].length - 1;
    $$("#unit-select .seg").forEach((b) => b.classList.toggle("active", b.dataset.unit === unit));
    syncRange(); renderList();
  }

  function resetFilters() {
    state.patterns.clear(); state.keys = 0; state.kmode = ""; state.refOnly = false; state.pmode = "or";
    $$(".chip").forEach((c) => c.classList.remove("on"));
    $("#ref-only").checked = false;
    $('input[name="pmode"][value="or"]').checked = true;
    syncKeys(); setUnit(state.unit);
  }

  /* ================= 모달 ================= */
  function openModal(name) { $("#modal-" + name).classList.remove("hidden"); }
  function closeModals() { $$(".modal").forEach((m) => m.classList.add("hidden")); }

  function refreshAuthUI() {
    const s = Auth.session();
    $("#user-label").classList.toggle("hidden", !s);
    $("#user-label").textContent = s ? s.nick + " 님" : "";
    $("#btn-login").classList.toggle("hidden", !!s);
    $("#btn-signup").classList.toggle("hidden", !!s);
    $("#btn-logout").classList.toggle("hidden", !s);
  }

  function setMsg(id, text, ok) {
    const m = $(id); m.textContent = text; m.classList.toggle("ok", !!ok);
  }

  function bindSignup() {
    const idI = $("#su-id"), pwI = $("#su-pw"), nickI = $("#su-nick");
    idI.oninput = () => {
      if (!idI.value) return setMsg("#su-id-msg", "");
      Auth.validId(idI.value) ? setMsg("#su-id-msg", "사용 가능한 형식입니다.", true) : setMsg("#su-id-msg", "영문·숫자·특수문자 8자리 이상이어야 합니다.");
    };
    pwI.oninput = () => {
      if (!pwI.value) return setMsg("#su-pw-msg", "");
      Auth.validPw(pwI.value) ? setMsg("#su-pw-msg", "사용 가능한 비밀번호입니다.", true) : setMsg("#su-pw-msg", "영문, 숫자, 특수기호를 모두 포함하고 7자리 이상이어야 합니다.");
    };
    nickI.oninput = () => {   // 자동 중복 확인
      if (!nickI.value.trim()) return setMsg("#su-nick-msg", "");
      Auth.nickTaken(nickI.value) ? setMsg("#su-nick-msg", "이미 사용중인 닉네임!") : setMsg("#su-nick-msg", "사용 가능한 닉네임입니다.", true);
    };
    $("#form-signup").onsubmit = async (e) => {
      e.preventDefault();
      if (!Auth.validId(idI.value)) return setMsg("#su-id-msg", "ID 형식을 확인해 주세요.");
      if (!Auth.validPw(pwI.value)) return setMsg("#su-pw-msg", "비밀번호 형식을 확인해 주세요.");
      if (!nickI.value.trim()) return setMsg("#su-nick-msg", "닉네임을 입력해 주세요.");
      const r = await Auth.signup(idI.value, pwI.value, nickI.value);
      if (!r.ok) {
        if (r.error.includes("닉네임")) setMsg("#su-nick-msg", r.error); else setMsg("#su-id-msg", r.error);
        return;
      }
      await Auth.login(idI.value, pwI.value);
      e.target.reset(); ["#su-id-msg", "#su-pw-msg", "#su-nick-msg"].forEach((m) => setMsg(m, ""));
      closeModals(); refreshAuthUI(); renderList();
    };
  }

  function bindLogin() {
    $("#form-login").onsubmit = async (e) => {
      e.preventDefault();
      const r = await Auth.login($("#login-id").value, $("#login-pw").value);
      if (!r.ok) return setMsg("#login-msg", r.error);
      e.target.reset(); setMsg("#login-msg", "");
      closeModals(); refreshAuthUI(); renderList();
    };
  }

  /* ================= 초기화 ================= */
  async function init() {
    $("#link-tuf").href = CONFIG.TUF_URL;
    $("#link-levels").href = CONFIG.LEVELS_URL;

    buildKeyDots(); buildPatternChips(); syncKeys(); syncRange();

    $$("#unit-select .seg").forEach((b) => (b.onclick = () => setUnit(b.dataset.unit)));
    $("#range-min").oninput = () => onRange("min");
    $("#range-max").oninput = () => onRange("max");
    $("#keys-reset").onclick = () => { state.keys = 0; syncKeys(); renderList(); };
    $$("#keymode .seg").forEach((b) => (b.onclick = () => {
      state.kmode = state.kmode === b.dataset.kmode ? "" : b.dataset.kmode;   // 한 번 더 누르면 해제
      syncKeys(); renderList();
    }));
    $$('input[name="pmode"]').forEach((r) => (r.onchange = () => { state.pmode = r.value; renderList(); }));
    $("#ref-only").onchange = (e) => { state.refOnly = e.target.checked; renderList(); };
    $("#filters-reset").onclick = resetFilters;

    $("#btn-recommend").onclick = () => { state.view = "recommend"; closeModals(); renderList(); };
    $("#btn-saved").onclick = () => {
      if (!Auth.session()) { alert("저장한 맵은 로그인 후 볼 수 있습니다."); openModal("login"); return; }
      state.view = "saved"; renderList();
    };
    $("#btn-login").onclick = () => openModal("login");
    $("#btn-signup").onclick = () => openModal("signup");
    $("#btn-logout").onclick = () => { Auth.logout(); state.view = "recommend"; refreshAuthUI(); renderList(); };
    $("#btn-close").onclick = () => {
      const anyOpen = $$(".modal").some((m) => !m.classList.contains("hidden"));
      if (anyOpen) return closeModals();
      if (state.view === "saved") { state.view = "recommend"; return renderList(); }
      window.close();   // 스크립트로 연 탭이 아니면 브라우저가 무시할 수 있음
    };
    $$("[data-close]").forEach((b) => (b.onclick = closeModals));
    $$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeModals(); }));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModals(); });

    bindSignup(); bindLogin(); refreshAuthUI();
    await loadLevels();
    renderList();
    window.__levelCount = LEVELS.length;
    window.__PATTERN_COUNT = CONFIG.PATTERNS.length;
    document.dispatchEvent(new CustomEvent("levels-ready", { detail: LEVELS.length }));
  }

  document.addEventListener("DOMContentLoaded", init);
})();

/* ================= 소개 화면 (얼불춤 느낌) =================
   ① 배경: 불·얼음 두 행성이 타일 길을 도는 캔버스 (각도가 클수록 오래 도는 것도 게임처럼)
   ② 스트로크 타이틀: SVG 외곽선이 그려진 뒤 색이 차오름 (CSS)
   ③ 스크롤 확장: 스크롤하면 둥근 프레임이 화면 가득 커지며 문구가 차례로 나타남
   ④ 별빛 테두리 버튼: 버튼 테두리를 따라 별이 돌며 꼬리와 별가루를 남김 */
(function () {
  const intro = document.getElementById("intro");
  const cv = document.getElementById("intro-canvas");
  if (!intro || !cv) return;
  const ctx = cv.getContext("2d");
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FIRE = [255, 106, 61], FIRE2 = [255, 190, 90], ICE = [70, 200, 255], ICE2 = [140, 170, 255];
  const EMBER = [255, 77, 46], VIOLET = [168, 85, 247];
  const BEAT = 0.4;                       // 반 바퀴(180°)에 걸리는 시간(초)
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const TAU = Math.PI * 2;
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);

  /* ---------- ① 배경 캔버스 ---------- */
  let seed = 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const P = [[0, 0], [1, 0]];
  let dir = 0, seen = new Set(["0,0", "1,0"]);
  function extend(n) {
    while (P.length < n) {
      const [x, y] = P[P.length - 1];
      const r = rnd();
      const order = r < 0.5 ? [0, 1, 3] : r < 0.75 ? [1, 0, 3] : [3, 0, 1];
      let placed = false;
      for (const t of order) {
        const nd = (dir + t) % 4, nx = x + DIRS[nd][0], ny = y + DIRS[nd][1];
        if (!seen.has(nx + "," + ny)) { dir = nd; P.push([nx, ny]); seen.add(nx + "," + ny); placed = true; break; }
      }
      if (!placed) seen = new Set([P[P.length - 1].join(",")]);   // 갇히면 기록만 비우고 계속
    }
  }
  const swing = [];
  let tEnd = 0;
  function buildSwing(i) {
    extend(i + 2);
    const a0 = Math.atan2(P[i - 1][1] - P[i][1], P[i - 1][0] - P[i][0]);
    const a1 = Math.atan2(P[i + 1][1] - P[i][1], P[i + 1][0] - P[i][0]);
    let d = (a1 - a0) % TAU; if (d < 0) d += TAU;
    const dur = BEAT * (d / Math.PI);
    swing[i] = { a0, delta: d, t0: tEnd, dur };
    tEnd += dur;
  }

  let W = 0, H = 0, dpr = 1, step = 60, raf = 0, last = 0, clock = 0, idx = 1;
  let camX = 0, camY = 0, sparks = [], covered = false;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = intro.clientWidth; H = intro.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    step = Math.max(44, Math.min(84, Math.min(W, H) * 0.105));
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function draw() {
    while (!swing[idx] || clock >= swing[idx].t0 + swing[idx].dur) {
      if (!swing[idx]) buildSwing(idx);
      if (clock >= swing[idx].t0 + swing[idx].dur) {
        const land = P[idx + 1], col = (idx + 1) % 2 === 0 ? FIRE2 : ICE2;
        for (let k = 0; k < 10; k++) {
          const ang = rnd() * TAU, sp = 40 + rnd() * 110;
          sparks.push({ x: land[0], y: land[1], vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0.55 + rnd() * 0.3, age: 0, col });
        }
        idx++;
      }
    }
    const s = swing[idx], f = Math.min(1, (clock - s.t0) / s.dur);
    const pv = P[idx];
    const pivotFire = idx % 2 === 0;
    const ang = s.a0 + s.delta * f;
    const mx = pv[0] * step + Math.cos(ang) * step, my = pv[1] * step + Math.sin(ang) * step;
    const tx = pv[0] * step - W * 0.5, ty = pv[1] * step - H * (W > H * 1.25 ? 0.85 : 0.86);
    camX += (tx - camX) * 0.08; camY += (ty - camY) * 0.08;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const lo = Math.max(0, idx - 16), hi = idx + 16;
    extend(hi + 2);
    const ts = step * 0.8;
    for (let i = lo; i <= hi; i++) {
      const x = P[i][0] * step - camX, y = P[i][1] * step - camY;
      if (x < -step || x > W + step || y < -step || y > H + step) continue;
      const owner = i % 2 === 0 ? FIRE : ICE, owner2 = i % 2 === 0 ? FIRE2 : ICE2;
      let lit = 0;
      if (i <= idx) {
        const landed = i <= 1 ? 0 : (swing[i - 1] ? swing[i - 1].t0 + swing[i - 1].dur : 0);
        lit = Math.exp(-(clock - landed) / 1.1);
      }
      const ahead = i > idx ? Math.max(0, 1 - (i - idx) / 14) : 0;
      ctx.save();
      ctx.translate(x, y);
      roundRect(-ts / 2, -ts / 2, ts, ts, step * 0.16);
      ctx.fillStyle = lit > 0.02 ? rgba(mix([34, 22, 66], owner, 0.55 * lit), 0.55 + 0.4 * lit) : rgba([30, 20, 58], 0.35 + 0.35 * ahead);
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = lit > 0.02 ? rgba(mix([90, 70, 150], owner2, lit), 0.5 + 0.45 * lit) : rgba([110, 84, 190], 0.16 + 0.22 * ahead);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalCompositeOperation = "lighter";
    const orb = (x, y, c, c2, r, a) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.4);
      g.addColorStop(0, rgba(c2, 0.95 * a)); g.addColorStop(0.28, rgba(c, 0.55 * a)); g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.4, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba([255, 255, 255], 0.92 * a); ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, TAU); ctx.fill();
    };
    const mc = pivotFire ? ICE : FIRE, mc2 = pivotFire ? ICE2 : FIRE2;
    for (let k = 7; k >= 1; k--) {
      const fk = Math.max(0, f - k * 0.05 / Math.max(0.5, s.delta / Math.PI));
      const a = s.a0 + s.delta * fk;
      orb(pv[0] * step + Math.cos(a) * step - camX, pv[1] * step + Math.sin(a) * step - camY, mc, mc2, step * 0.1 * (1 - k / 9), 0.22 * (1 - k / 8));
    }
    orb(mx - camX, my - camY, mc, mc2, step * 0.2, 1);
    orb(pv[0] * step - camX, pv[1] * step - camY, pivotFire ? FIRE : ICE, pivotFire ? FIRE2 : ICE2, step * 0.2, 1);
    for (const p of sparks) {
      const k = p.age / p.life; if (k >= 1) continue;
      ctx.fillStyle = rgba(p.col, (1 - k) * 0.9);
      ctx.beginPath(); ctx.arc(p.x * step - camX + p.vx * p.age, p.y * step - camY + p.vy * p.age, 2.2 * (1 - k) + 0.4, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /* ---------- ④ 별빛 테두리 버튼 ---------- */
  const STAR = { lap: 3.4, trail: 0.45, glow: 0.8, pad: 16 };
  const stars = Array.from(document.querySelectorAll(".star-btn")).map((btn) => {
    const cvs = btn.querySelector(".star-canvas"), c = cvs.getContext("2d");
    let w = 0, h = 0, dp = 1, per = 0, dust = [], lastT = 0;
    const size = () => {
      w = btn.offsetWidth; h = btn.offsetHeight; if (!w || !h) return;
      dp = Math.min(window.devicePixelRatio || 1, 2);
      cvs.width = Math.round((w + STAR.pad * 2) * dp); cvs.height = Math.round((h + STAR.pad * 2) * dp);
      cvs.style.width = w + STAR.pad * 2 + "px"; cvs.style.height = h + STAR.pad * 2 + "px";
      per = 2 * (w - h) + Math.PI * h;
    };
    const at = (s) => {                              // 알약 모양 테두리 위의 점 (둘레 s 지점)
      s = ((s % per) + per) % per;
      const r = h / 2, L = w - h, arc = Math.PI * r;
      if (s < L) return [r + s, 0];
      s -= L;
      if (s < arc) { const a = -Math.PI / 2 + s / r; return [w - r + Math.cos(a) * r, r + Math.sin(a) * r]; }
      s -= arc;
      if (s < L) return [w - r - s, h];
      s -= L;
      const a = Math.PI / 2 + s / r; return [r + Math.cos(a) * r, r + Math.sin(a) * r];
    };
    const sparkle = (x, y, R, rot, a) => {
      c.save(); c.translate(x, y); c.rotate(rot);
      c.beginPath();
      for (let k = 0; k < 4; k++) {
        const t = (k * Math.PI) / 2;
        c.lineTo(Math.cos(t) * R, Math.sin(t) * R);
        c.lineTo(Math.cos(t + Math.PI / 4) * R * 0.28, Math.sin(t + Math.PI / 4) * R * 0.28);
      }
      c.closePath(); c.fillStyle = `rgba(255,244,230,${a})`; c.fill(); c.restore();
    };
    return {
      size,
      draw(t) {
        if (!w || !h) size();
        if (!w) return;
        const rc = cvs.getBoundingClientRect();
        if (rc.bottom < -20 || rc.top > innerHeight + 20 || rc.right < 0 || rc.left > innerWidth) return;
        const dt = Math.min(0.05, t - lastT || 0.016); lastT = t;
        c.setTransform(dp, 0, 0, dp, 0, 0);
        c.clearRect(0, 0, w + STAR.pad * 2, h + STAR.pad * 2);
        c.translate(STAR.pad, STAR.pad);
        // 가는 보라 테두리
        c.lineWidth = 1; c.strokeStyle = rgba(VIOLET, 0.38);
        c.beginPath(); c.roundRect ? c.roundRect(0.5, 0.5, w - 1, h - 1, h / 2) : (c.rect(0.5, 0.5, w - 1, h - 1)); c.stroke();
        const head = (t / STAR.lap) * per, len = STAR.trail * per, N = 48;
        c.globalCompositeOperation = "lighter"; c.lineCap = "round";
        let prev = at(head);
        for (let k = 1; k <= N; k++) {                // 꼬리: 머리는 붉은 불씨색, 끝은 보라색으로 사라짐
          const u = k / N, p = at(head - u * len);
          const col = mix(EMBER, VIOLET, Math.pow(u, 0.7));
          c.strokeStyle = rgba(col, Math.pow(1 - u, 1.7) * 0.95);
          c.lineWidth = 0.7 + (1 - u) * 3.3;
          c.shadowColor = rgba(col, 0.9); c.shadowBlur = STAR.glow * 12 * (1 - u);
          c.beginPath(); c.moveTo(prev[0], prev[1]); c.lineTo(p[0], p[1]); c.stroke();
          prev = p;
        }
        c.shadowBlur = 0;
        const hp = at(head);
        const g = c.createRadialGradient(hp[0], hp[1], 0, hp[0], hp[1], 22);
        g.addColorStop(0, rgba(EMBER, 0.85 * STAR.glow)); g.addColorStop(1, rgba(EMBER, 0));
        c.fillStyle = g; c.beginPath(); c.arc(hp[0], hp[1], 22, 0, TAU); c.fill();
        sparkle(hp[0], hp[1], 8.5 + Math.sin(t * 9) * 1.6, t * 1.7, 1);
        // 별가루
        if (!reduce) {
          for (let n = 0; n < 1.2 * (dt * 60) && dust.length < 90; n++) {
            const p = at(head - Math.random() * len * 0.35), ang = Math.random() * TAU, sp = 6 + Math.random() * 20;
            dust.push({ x: p[0], y: p[1], vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0.7 + Math.random() * 0.8, age: 0, r: 0.5 + Math.random() * 1.1, col: mix(FIRE2, VIOLET, Math.random() * 0.8) });
          }
          dust = dust.filter((d) => (d.age += dt) < d.life);
        }
        for (const d of dust) {
          const k = d.age / d.life;
          c.fillStyle = rgba(d.col, (1 - k) * 0.85);
          c.beginPath(); c.arc(d.x + d.vx * d.age, d.y + d.vy * d.age, d.r * (1 - k * 0.5), 0, TAU); c.fill();
        }
        c.globalCompositeOperation = "source-over";
      },
    };
  });
  const drawStars = () => stars.forEach((s) => s.draw(clock));

  /* ---------- ③ 스크롤 확장 ---------- */
  const ex = document.getElementById("intro-expand");
  const frame = document.getElementById("expand-frame");
  const ex1 = document.getElementById("ex-1"), ex2 = document.getElementById("ex-2");
  const exCta = document.getElementById("ex-cta"), exLabel = document.getElementById("expand-label");
  const reveal = (el, from, to, p) => {
    const t = smooth(clamp((p - from) / (to - from), 0, 1));
    el.style.opacity = t; el.style.transform = `translateY(${(1 - t) * 26}px)`; el.style.filter = t < 1 ? `blur(${(1 - t) * 8}px)` : "none";
  };
  function setExpand() {
    if (!ex || !frame) return;
    const vh = intro.clientHeight, vw = intro.clientWidth;
    const total = Math.max(1, ex.offsetHeight - vh);
    const p = clamp((intro.scrollTop - ex.offsetTop) / total, 0, 1);
    const e = smooth(clamp(p / 0.62, 0, 1));
    const w0 = Math.min(vw * 0.72, 780), h0 = Math.min(vh * 0.5, 440);
    frame.style.width = lerp(w0, vw, e) + "px";
    frame.style.height = lerp(h0, vh, e) + "px";
    frame.style.borderRadius = lerp(34, 0, e) + "px";
    exLabel.style.opacity = String(clamp(1 - p * 8, 0, 1));
    reveal(ex1, 0.30, 0.52, p);
    reveal(ex2, 0.52, 0.72, p);
    const c = smooth(clamp((p - 0.76) / 0.16, 0, 1));
    exCta.style.opacity = c; exCta.style.transform = `translateY(${(1 - c) * 18}px)`;
    exCta.classList.toggle("on", c > 0.6);
    covered = p > 0.985;
  }
  let scrollTick = 0;
  intro.addEventListener("scroll", () => { if (!scrollTick) scrollTick = requestAnimationFrame(() => { scrollTick = 0; setExpand(); if (reduce) drawStars(); }); }, { passive: true });

  /* ---------- 루프 / 열기 / 닫기 ---------- */
  function frameLoop(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    clock += dt;
    for (const p of sparks) p.age += dt;
    if (sparks.length > 60) sparks = sparks.filter((p) => p.age < p.life);
    if (!covered) draw();
    drawStars();
    raf = requestAnimationFrame(frameLoop);
  }
  function start() {
    if (raf) return;
    resize(); stars.forEach((s) => s.size()); setExpand();
    if (reduce) { clock = BEAT * 5.5; draw(); draw(); clock = 1.2; drawStars(); return; }
    last = performance.now(); raf = requestAnimationFrame(frameLoop);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  window.addEventListener("resize", () => {
    if (intro.classList.contains("hidden")) return;
    resize(); stars.forEach((s) => s.size()); setExpand(); if (reduce) { draw(); drawStars(); }
  });

  const page = () => document.querySelectorAll(".topbar, main");
  const KEY = "adofai-analyzer-intro";
  const storage = {
    get() { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } },
    set() { try { sessionStorage.setItem(KEY, "1"); } catch (e) {} },
  };
  const title = intro.querySelector(".stroke-text");
  function open() {
    intro.classList.remove("hidden", "leaving");
    document.body.classList.add("intro-on");
    page().forEach((el) => el.setAttribute("inert", ""));
    intro.scrollTop = 0; covered = false;
    if (title) { title.classList.remove("play"); void title.getBoundingClientRect(); title.classList.add("play"); }
    start();
    intro.focus({ preventScroll: true });
  }
  let closing = false;
  function close() {
    if (closing || intro.classList.contains("hidden")) return;
    closing = true; storage.set();
    intro.classList.add("leaving");
    setTimeout(() => {
      intro.classList.add("hidden"); intro.classList.remove("leaving");
      document.body.classList.remove("intro-on");
      page().forEach((el) => el.removeAttribute("inert"));
      stop(); closing = false;
      const t = document.getElementById("brand"); if (t) t.focus({ preventScroll: true });
    }, reduce ? 0 : 520);
  }

  const countEl = document.getElementById("intro-count");
  function setCount(n) {
    if (!countEl || !n) return;
    if (reduce) { countEl.textContent = n; return; }
    const t0 = performance.now();
    (function tick(now) {
      const k = Math.min(1, (now - t0) / 900), e = 1 - Math.pow(1 - k, 3);
      countEl.textContent = Math.round(n * e);
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }
  const pe = document.getElementById("intro-patterns");
  const fillStats = (n) => { setCount(n); if (pe && window.__PATTERN_COUNT) pe.textContent = window.__PATTERN_COUNT; };
  document.addEventListener("levels-ready", (e) => fillStats(e.detail));
  if (window.__levelCount) fillStats(window.__levelCount);

  document.querySelectorAll("[data-intro-go]").forEach((b) => b.addEventListener("click", close));
  document.addEventListener("keydown", (e) => {
    if (intro.classList.contains("hidden")) return;
    if (e.key === "Escape" || (e.key === "Enter" && !(e.target instanceof HTMLButtonElement))) { e.preventDefault(); close(); }
  });
  const brand = document.getElementById("brand");
  if (brand) {
    brand.addEventListener("click", open);
    brand.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  }

  if (storage.get()) { intro.classList.add("hidden"); }
  else { open(); }
})();
