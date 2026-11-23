/* ADOFAI ANALYZER 관리자 페이지
 * 서버(Cloudflare Pages Functions + D1)가 있는 배포에서만 동작합니다. 권한은 서버가 확인합니다
 * (환경 변수 ADMIN_IDS 에 적힌 ID 로 로그인했을 때만). 이 화면은 편의 도구일 뿐입니다. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const TYPE = { update: "업데이트", map: "맵 추가", info: "안내" };
  let seed = [], server = [], levelNames = {}, current = null, loaded = { notice: false, users: false, dash: false };

  async function api(path, body) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
    try {
      const o = { credentials: "same-origin", signal: ctl.signal };
      if (body !== undefined) { o.method = "POST"; o.headers = { "content-type": "application/json" }; o.body = JSON.stringify(body); }
      const r = await fetch("/api/" + path, o);
      let data = null; try { data = await r.json(); } catch { /* HTML 등 */ }
      return { status: r.status, data };
    } finally { clearTimeout(t); }
  }
  let toastT = 0;
  function toast(msg) { const t = $("#atoast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), 2400); }
  const fmtDate = (sec) => { const d = new Date(sec * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const todayStr = () => fmtDate(Date.now() / 1000);
  const confirmTwice = (btn, label, action) => {          // 한 번 누르면 확인 문구, 4초 안에 또 누르면 실행
    let armed = false, timer = 0; const orig = btn.textContent;
    btn.onclick = () => {
      if (!armed) { armed = true; btn.textContent = label; timer = setTimeout(() => { armed = false; btn.textContent = orig; }, 4000); return; }
      clearTimeout(timer); armed = false; btn.textContent = orig; action();
    };
  };

  /* ---------- 접속 상태 ---------- */
  function gate(msg, showForm) {
    $("#panel").classList.add("hidden"); $("#gate").classList.remove("hidden");
    $("#gate-msg").textContent = msg; $("#gate-form").classList.toggle("hidden", !showForm);
  }
  async function start() {
    let res;
    try { res = await api("me"); } catch { res = null; }
    const d = res && res.data;
    if (!d) return gate("서버(API)에 연결되지 않았습니다. 이 페이지는 Cloudflare Pages + D1 이 연결된 배포 주소에서만 쓸 수 있습니다. (파일로 열거나 GitHub Pages 에서는 동작하지 않습니다.)");
    if (d.code === "no-db") return gate("서버는 있지만 D1 데이터베이스가 연결되지 않았습니다. README 의 'D1 연결' 순서를 먼저 마쳐 주세요.");
    if (!d.ok) return gate("서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.");
    if (!d.user) return gate("관리자 계정으로 로그인해 주세요.", true);
    $("#adm-who").textContent = d.user.nick + " 님"; $("#adm-who").classList.remove("hidden"); $("#adm-logout").classList.remove("hidden");
    if (!d.user.admin) return gate("이 계정은 관리자가 아닙니다. Cloudflare Pages 설정의 환경 변수 ADMIN_IDS 에 이 계정의 ID를 적고 다시 배포하세요.");
    $("#gate").classList.add("hidden"); $("#panel").classList.remove("hidden");
    loadLevelNames(); showTab("dash");
  }
  $("#gate-form").addEventListener("submit", async (e) => {
    e.preventDefault(); $("#g-err").textContent = "";
    try {
      const { data } = await api("login", { id: $("#g-id").value, pw: $("#g-pw").value });
      if (data && data.ok) { $("#g-pw").value = ""; return start(); }
      $("#g-err").textContent = (data && data.error) || "로그인에 실패했습니다.";
    } catch { $("#g-err").textContent = "서버에 연결하지 못했습니다."; }
  });
  $("#adm-logout").addEventListener("click", async () => { try { await api("logout", {}); } catch { /* 무시 */ } location.reload(); });

  /* ---------- 탭 ---------- */
  function showTab(name) {
    document.querySelectorAll(".adm-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.id === "tab-" + name));
    if (name === "dash") loadDash(); if (name === "notice") loadNotices(); if (name === "users") loadUsers();
  }
  document.querySelectorAll(".adm-tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  async function loadLevelNames() {
    try { const r = await fetch("levels.json", { cache: "no-cache" }); (await r.json()).forEach((l) => { levelNames[l.id] = l.name; }); } catch { /* 이름 없이 ID 만 표시 */ }
  }

  /* ---------- 대시보드 ---------- */
  async function loadDash() {
    const { data } = await api("admin/stats").catch(() => ({}));
    if (!data || !data.ok) return toast("통계를 불러오지 못했습니다.");
    const g = $("#stat-grid"); g.replaceChildren();
    [["회원", data.users], ["최근 7일 가입", data.newUsers7d], ["로그인 세션", data.sessions], ["저장된 맵(합계)", data.saved], ["서버 공지", data.notices]].forEach(([k, v]) => {
      const s = el("div", "stat"); s.append(el("b", "", String(v)), el("span", "", k)); g.append(s);
    });
    const ol = $("#toplist"); ol.replaceChildren();
    if (!data.topSaved.length) { ol.append(el("li", "empty", "아직 저장된 맵이 없습니다.")); return; }
    data.topSaved.forEach((t, i) => {
      const li = el("li"); li.append(el("span", "rk", String(i + 1)), el("span", "nm", levelNames[t.levelId] ? `${levelNames[t.levelId]}  (${t.levelId})` : t.levelId), el("span", "ct", t.count + "명"));
      ol.append(li);
    });
  }

  /* ---------- 공지 ---------- */
  function merged() {
    const serverIds = new Set(server.map((n) => n.id)), seedIds = new Set(seed.map((n) => n.id));
    const rows = server.map((n) => ({ ...n, src: seedIds.has(n.id) ? "override" : "server" }));
    seed.forEach((n) => { if (!serverIds.has(n.id)) rows.push({ ...n, hidden: false, src: "file" }); });
    return rows.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.date).localeCompare(String(a.date)));
  }
  async function loadNotices(selectId) {
    try { const r = await fetch("notices.json", { cache: "no-cache" }); seed = r.ok ? await r.json() : []; if (!Array.isArray(seed)) seed = []; } catch { seed = []; }
    const { data } = await api("admin/notices").catch(() => ({}));
    if (!data || !data.ok) return toast("공지를 불러오지 못했습니다. (schema.sql 의 notices 테이블을 실행했는지 확인하세요)");
    server = data.notices; renderNoticeList(selectId);
  }
  function renderNoticeList(selectId) {
    const box = $("#n-list"); box.replaceChildren();
    const rows = merged();
    if (!rows.length) box.append(el("p", "empty", "등록된 공지가 없습니다."));
    rows.forEach((n) => {
      const b = el("button", "n-item" + (current && current.id === n.id ? " on" : "")); b.type = "button";
      const m = el("span", "m");
      m.append(el("span", "tag", TYPE[n.type] || "안내"), el("span", "", n.date));
      if (n.pinned) m.append(el("span", "tag pin", "고정"));
      if (n.hidden) m.append(el("span", "tag hid", "숨김"));
      if (n.src === "file") m.append(el("span", "tag file", "파일 공지"));
      if (n.src === "override") m.append(el("span", "tag file", "파일 공지(수정됨)"));
      b.append(el("span", "t", n.title), m); b.onclick = () => selectNotice(n); box.append(b);
    });
    if (selectId) { const n = rows.find((x) => x.id === selectId); if (n) return selectNotice(n); }
    if (current) { const n = rows.find((x) => x.id === current.id); if (n) return selectNotice(n); }
  }
  function fillForm(n) {
    $("#n-date").value = n ? n.date : todayStr(); $("#n-type").value = n ? n.type : "update";
    $("#n-title").value = n ? n.title : ""; $("#n-body").value = n ? n.body : "";
    $("#n-pinned").checked = !!(n && n.pinned); $("#n-hidden").checked = !!(n && n.hidden);
    count(); $("#n-msg").textContent = "";
  }
  function selectNotice(n) {
    current = n; fillForm(n);
    $("#n-form-title").textContent = n.src === "file" ? "파일 공지 수정" : "공지 수정";
    $("#n-src").textContent = n.src === "file" ? "notices.json 의 공지입니다. 저장하면 서버에 같은 ID로 덮어쓰기가 만들어지고, 파일은 그대로 남습니다. 지우려면 '숨김'을 체크하세요."
      : n.src === "override" ? "notices.json 공지를 서버에서 덮어쓴 상태입니다. 삭제하면 파일의 원래 공지로 돌아갑니다." : "";
    const del = $("#n-del"); del.classList.toggle("hidden", n.src === "file");
    confirmTwice(del, "한 번 더 누르면 삭제", deleteNotice);
    document.querySelectorAll(".n-item").forEach((x) => x.classList.remove("on"));
    [...$("#n-list").children].forEach((c, i) => { if (merged()[i] && merged()[i].id === n.id) c.classList.add("on"); });
  }
  function newNotice() {
    current = null; fillForm(null); $("#n-form-title").textContent = "새 공지"; $("#n-src").textContent = ""; $("#n-del").classList.add("hidden");
    document.querySelectorAll(".n-item").forEach((x) => x.classList.remove("on")); $("#n-title").focus();
  }
  function count() { $("#n-title-cnt").textContent = $("#n-title").value.length + "/80"; $("#n-body-cnt").textContent = $("#n-body").value.length + "/2000"; }
  ["#n-title", "#n-body"].forEach((s) => $(s).addEventListener("input", count));
  $("#n-new").addEventListener("click", newNotice);
  $("#n-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const btn = $("#n-save"); btn.disabled = true; $("#n-msg").textContent = "";
    try {
      const payload = { date: $("#n-date").value, type: $("#n-type").value, title: $("#n-title").value, body: $("#n-body").value, pinned: $("#n-pinned").checked, hidden: $("#n-hidden").checked };
      if (current) payload.id = current.id;
      const { data } = await api("admin/notice", payload);
      if (data && data.ok) { server = data.notices; current = null; renderNoticeList(data.id); toast("저장했습니다."); }
      else { $("#n-msg").textContent = (data && data.error) || "저장하지 못했습니다."; }
    } catch { $("#n-msg").textContent = "서버에 연결하지 못했습니다."; }
    btn.disabled = false;
  });
  async function deleteNotice() {
    if (!current) return;
    try {
      const { data } = await api("admin/notice-delete", { id: current.id });
      if (data && data.ok) { server = data.notices; newNotice(); renderNoticeList(); toast("삭제했습니다."); } else toast((data && data.error) || "삭제하지 못했습니다.");
    } catch { toast("서버에 연결하지 못했습니다."); }
  }

  /* ---------- 회원 ---------- */
  let users = [];
  async function loadUsers() {
    const { data } = await api("admin/users").catch(() => ({}));
    if (!data || !data.ok) return toast("회원 목록을 불러오지 못했습니다.");
    users = data.users; renderUsers();
  }
  function renderUsers() {
    const q = $("#u-search").value.trim().toLowerCase();
    const rows = users.filter((u) => !q || u.id.toLowerCase().includes(q) || u.nick.toLowerCase().includes(q));
    $("#u-count").textContent = `${rows.length}명`;
    const box = $("#u-table"); box.replaceChildren();
    const h = el("div", "u-row h"); ["ID", "닉네임", "가입일", "저장", ""].forEach((t) => h.append(el("span", "", t))); box.append(h);
    if (!rows.length) box.append(el("div", "empty", "회원이 없습니다."));
    rows.forEach((u) => {
      const r = el("div", "u-row"), idc = el("span", "", u.id);
      if (u.admin) idc.append(el("span", "adminTag", "관리자"));
      const act = el("span");
      if (!u.admin) { const b = el("button", "abtn danger sm", "삭제"); b.type = "button"; confirmTwice(b, "정말 삭제?", async () => {
        try { const { data } = await api("admin/user-delete", { id: u.id }); if (data && data.ok) { users = users.filter((x) => x.id !== u.id); renderUsers(); toast("회원을 삭제했습니다."); } else toast((data && data.error) || "삭제하지 못했습니다."); }
        catch { toast("서버에 연결하지 못했습니다."); } }); act.append(b); }
      r.append(idc, el("span", "", u.nick), el("span", "", fmtDate(u.createdAt)), el("span", "", String(u.saved)), act); box.append(r);
    });
  }
  $("#u-search").addEventListener("input", renderUsers);

  start();
})();
