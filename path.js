/* ADOFAI ANALYZER 계정 API (Cloudflare Pages Functions + D1)
 *
 *   GET  /api/me        현재 로그인 정보 + 저장한 맵 목록
 *   GET  /api/nick?n=   닉네임 중복 확인
 *   POST /api/signup    회원가입 (가입 후 자동 로그인)
 *   POST /api/login     로그인
 *   POST /api/logout    로그아웃
 *   POST /api/saved     맵 저장/해제  { levelId, on: true|false }
 *   GET  /api/notices   공지사항 목록 (숨김 처리된 것 포함. 화면에서 걸러 냄)
 *
 *   관리자 전용 (환경 변수 ADMIN_IDS 에 적은 ID 로 로그인했을 때만):
 *   GET  /api/admin/stats     통계
 *   GET  /api/admin/notices   공지 전체
 *   POST /api/admin/notice    공지 저장  { id?, date, type, title, body, pinned, hidden }
 *   POST /api/admin/notice-delete  { id }
 *   GET  /api/admin/users     회원 목록
 *   POST /api/admin/user-delete    { id }
 *
 * D1 바인딩 이름은 반드시 DB 여야 합니다 (README 참고). 테이블은 schema.sql 로 만듭니다.
 * 비밀번호는 PBKDF2-SHA256(10만 회) + 사용자별 소금값으로 저장하고, 로그인 세션은
 * 무작위 토큰(쿠키)이며 DB에는 토큰의 해시만 저장합니다.
 */

const enc = new TextEncoder();
const ITER = 100000;                 // Workers 의 PBKDF2 최대 반복 횟수
const SESSION_SEC = 30 * 24 * 3600;  // 로그인 유지 30일
const MAX_FAILS = 5, LOCK_SEC = 300; // 비밀번호 5회 틀리면 5분 잠금
const MAX_SAVED = 500;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
const fail = (status, error, extra = {}) => json({ ok: false, error, ...extra }, status);

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s) => Uint8Array.from(s.match(/../g) || [], (h) => parseInt(h, 16));
const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const now = () => Math.floor(Date.now() / 1000);

async function pbkdf2(pw, salt, iters) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iters }, key, 256));
}
function same(a, b) {                // 길이가 같을 때 시간차 없이 비교
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---- 입력 규칙 (화면의 규칙과 같게 유지) ---- */
const validId = (id) => typeof id === "string" && /^[A-Za-z0-9!-\/:-@\[-`{-~]{8,32}$/.test(id);
const validPw = (pw) =>
  typeof pw === "string" && pw.length >= 7 && pw.length <= 14 &&
  /[A-Za-z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw);
const cleanNick = (n) => (typeof n === "string" ? n.trim().replace(/\s+/g, " ") : "");
const validNick = (n) => n.length >= 1 && n.length <= 30 && !/[\u0000-\u001f\u007f<>]/.test(n);
const validLevelId = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(s);

/* ---- 세션 ---- */
function readCookie(request, name) {
  const m = (request.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : "";
}
function cookie(value, maxAge, secure) {
  return `adofai_sid=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
async function currentUser(env, request) {
  const token = readCookie(request, "adofai_sid");
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  return env.DB.prepare(
    "SELECT u.id AS id, u.nick AS nick FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  ).bind(await sha256(token), now()).first();
}
async function startSession(env, userId, secure) {
  const token = randHex(32), t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(t),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), userId, t + SESSION_SEC),
  ]);
  return cookie(token, SESSION_SEC, secure);
}
const savedList = async (env, userId) =>
  (await env.DB.prepare("SELECT level_id FROM saved WHERE user_id = ? ORDER BY created_at, level_id").bind(userId).all()).results.map((r) => r.level_id);

async function body(request, max = 4096) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  const text = await request.text();
  if (text.length > max) return null;
  try { const v = JSON.parse(text); return v && typeof v === "object" ? v : null; } catch { return null; }
}

/* ---- 관리자 ---- */
const isAdmin = (env, u) => !!u && String(env.ADMIN_IDS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).includes(u.id.toLowerCase());
const NOTICE_TYPES = ["update", "map", "info"];
const rowToNotice = (r) => ({ id: r.id, date: r.date, type: r.type, title: r.title, body: r.body, pinned: !!r.pinned, hidden: !!r.hidden });
const noticeList = async (env) =>
  (await env.DB.prepare("SELECT id, date, type, title, body, pinned, hidden FROM notices ORDER BY pinned DESC, date DESC, updated_at DESC").all()).results.map(rowToNotice);

export async function onRequest({ request, env }) {
  try {
    if (!env.DB) return fail(500, "서버 DB(D1)가 연결되지 않았습니다.", { code: "no-db" });
    const url = new URL(request.url);
    const secure = url.protocol === "https:";
    const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
    const method = request.method;

    if (method === "POST") {         // 다른 사이트에서 몰래 보내는 요청 차단
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) return fail(403, "허용되지 않은 요청입니다.");
    }

    if (route === "me" && method === "GET") {
      const u = await currentUser(env, request);
      return json({ ok: true, user: u ? { id: u.id, nick: u.nick, admin: isAdmin(env, u) } : null, saved: u ? await savedList(env, u.id) : [] });
    }

    if (route === "nick" && method === "GET") {
      const n = cleanNick(url.searchParams.get("n") || "");
      if (!validNick(n)) return json({ ok: true, taken: false });
      const row = await env.DB.prepare("SELECT 1 AS x FROM users WHERE nick_lower = ?").bind(n.toLowerCase()).first();
      return json({ ok: true, taken: !!row });
    }

    if (route === "signup" && method === "POST") {
      const b = await body(request);
      if (!b) return fail(400, "요청 형식이 올바르지 않습니다.");
      const nick = cleanNick(b.nick);
      if (!validId(b.id)) return fail(400, "ID는 영문·숫자·특수문자 8~32자리여야 합니다.", { field: "id" });
      if (!validPw(b.pw)) return fail(400, "비밀번호는 영문·숫자·특수기호를 모두 포함한 7~14자리여야 합니다.", { field: "pw" });
      if (!validNick(nick)) return fail(400, "닉네임은 1~30자로 입력해 주세요.", { field: "nick" });
      if (await env.DB.prepare("SELECT 1 AS x FROM users WHERE id_lower = ?").bind(b.id.toLowerCase()).first())
        return fail(409, "이미 사용중인 ID입니다.", { field: "id" });
      if (await env.DB.prepare("SELECT 1 AS x FROM users WHERE nick_lower = ?").bind(nick.toLowerCase()).first())
        return fail(409, "이미 사용중인 닉네임!", { field: "nick" });
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await pbkdf2(b.pw, salt, ITER);
      try {
        await env.DB.prepare(
          "INSERT INTO users (id, id_lower, nick, nick_lower, pw_hash, pw_salt, iters, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(b.id, b.id.toLowerCase(), nick, nick.toLowerCase(), hash, hex(salt), ITER, now()).run();
      } catch {
        return fail(409, "이미 사용중인 ID 또는 닉네임입니다.");   // 동시에 같은 값으로 가입한 경우
      }
      const setCookie = await startSession(env, b.id, secure);
      return json({ ok: true, user: { id: b.id, nick }, saved: [] }, 200, { "set-cookie": setCookie });
    }

    if (route === "login" && method === "POST") {
      const b = await body(request);
      if (!b || typeof b.id !== "string" || typeof b.pw !== "string" || b.id.length > 64 || b.pw.length > 64)
        return fail(400, "요청 형식이 올바르지 않습니다.");
      const bad = "ID 또는 비밀번호가 올바르지 않습니다.";
      const u = await env.DB.prepare("SELECT * FROM users WHERE id_lower = ?").bind(b.id.toLowerCase()).first();
      if (u && u.locked_until > now()) return fail(429, "비밀번호를 여러 번 틀려 잠시 잠겼습니다. 몇 분 뒤에 다시 시도해 주세요.");
      // ID가 없어도 같은 계산을 해서 ID 존재 여부가 응답 시간으로 드러나지 않게 한다
      const salt = u ? unhex(u.pw_salt) : new Uint8Array(16);
      const hash = await pbkdf2(b.pw, salt, u ? u.iters : ITER);
      if (!u || !same(hash, u.pw_hash)) {
        if (u) {
          const fails = u.fail_count + 1;
          await env.DB.prepare("UPDATE users SET fail_count = ?, locked_until = ? WHERE id = ?")
            .bind(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? now() + LOCK_SEC : 0, u.id).run();
        }
        return fail(401, bad);
      }
      await env.DB.prepare("UPDATE users SET fail_count = 0, locked_until = 0 WHERE id = ?").bind(u.id).run();
      const setCookie = await startSession(env, u.id, secure);
      return json({ ok: true, user: { id: u.id, nick: u.nick }, saved: await savedList(env, u.id) }, 200, { "set-cookie": setCookie });
    }

    if (route === "logout" && method === "POST") {
      const token = readCookie(request, "adofai_sid");
      if (/^[0-9a-f]{64}$/.test(token)) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
      return json({ ok: true }, 200, { "set-cookie": cookie("", 0, secure) });
    }

    if (route === "saved" && method === "POST") {
      const u = await currentUser(env, request);
      if (!u) return fail(401, "로그인이 필요합니다.");
      const b = await body(request);
      if (!b || !validLevelId(b.levelId) || typeof b.on !== "boolean") return fail(400, "요청 형식이 올바르지 않습니다.");
      if (b.on) {
        const c = await env.DB.prepare("SELECT COUNT(*) AS c FROM saved WHERE user_id = ?").bind(u.id).first();
        if (c.c >= MAX_SAVED) return fail(400, `저장은 최대 ${MAX_SAVED}개까지 가능합니다.`);
        await env.DB.prepare("INSERT OR IGNORE INTO saved (user_id, level_id, created_at) VALUES (?, ?, ?)").bind(u.id, b.levelId, now()).run();
      } else {
        await env.DB.prepare("DELETE FROM saved WHERE user_id = ? AND level_id = ?").bind(u.id, b.levelId).run();
      }
      return json({ ok: true, saved: await savedList(env, u.id) });
    }

    if (route === "notices" && method === "GET") {       // 공개: 테이블이 아직 없어도 사이트가 깨지지 않게 빈 목록
      try { return json({ ok: true, notices: await noticeList(env) }); } catch { return json({ ok: true, notices: [] }); }
    }

    if (route.startsWith("admin/")) {
      const u = await currentUser(env, request);
      if (!u) return fail(401, "로그인이 필요합니다.");
      if (!isAdmin(env, u)) return fail(403, "관리자 권한이 없습니다.");
      const r = route.slice(6);

      if (r === "stats" && method === "GET") {
        const one = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).first()) || {};
        const top = (await env.DB.prepare("SELECT level_id, COUNT(*) AS c FROM saved GROUP BY level_id ORDER BY c DESC, level_id LIMIT 10").all()).results;
        const day = now() - 7 * 24 * 3600;
        return json({
          ok: true,
          users: (await one("SELECT COUNT(*) AS c FROM users")).c,
          newUsers7d: (await one("SELECT COUNT(*) AS c FROM users WHERE created_at > ?", day)).c,
          sessions: (await one("SELECT COUNT(*) AS c FROM sessions WHERE expires_at > ?", now())).c,
          saved: (await one("SELECT COUNT(*) AS c FROM saved")).c,
          notices: (await one("SELECT COUNT(*) AS c FROM notices")).c,
          topSaved: top.map((t) => ({ levelId: t.level_id, count: t.c })),
        });
      }

      if (r === "notices" && method === "GET") return json({ ok: true, notices: await noticeList(env) });

      if (r === "notice" && method === "POST") {
        const b = await body(request, 8192);
        if (!b) return fail(400, "요청 형식이 올바르지 않습니다.");
        const title = typeof b.title === "string" ? b.title.trim() : "", text = typeof b.body === "string" ? b.body.trim() : "";
        if (!title || title.length > 80) return fail(400, "제목은 1~80자로 입력해 주세요.", { field: "title" });
        if (!text || text.length > 2000) return fail(400, "본문은 1~2000자로 입력해 주세요.", { field: "body" });
        if (!NOTICE_TYPES.includes(b.type)) return fail(400, "종류가 올바르지 않습니다.", { field: "type" });
        if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return fail(400, "날짜는 YYYY-MM-DD 형식이어야 합니다.", { field: "date" });
        let id = typeof b.id === "string" && b.id ? b.id : "d-" + randHex(5);
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return fail(400, "공지 ID 형식이 올바르지 않습니다.");
        await env.DB.prepare(
          "INSERT INTO notices (id, date, type, title, body, pinned, hidden, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET date = excluded.date, type = excluded.type, title = excluded.title, body = excluded.body, pinned = excluded.pinned, hidden = excluded.hidden, updated_at = excluded.updated_at"
        ).bind(id, b.date, b.type, title, text, b.pinned ? 1 : 0, b.hidden ? 1 : 0, now()).run();
        return json({ ok: true, id, notices: await noticeList(env) });
      }

      if (r === "notice-delete" && method === "POST") {
        const b = await body(request);
        if (!b || typeof b.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(b.id)) return fail(400, "요청 형식이 올바르지 않습니다.");
        await env.DB.prepare("DELETE FROM notices WHERE id = ?").bind(b.id).run();
        return json({ ok: true, notices: await noticeList(env) });
      }

      if (r === "users" && method === "GET") {
        const rows = (await env.DB.prepare(
          "SELECT u.id AS id, u.nick AS nick, u.created_at AS created_at, (SELECT COUNT(*) FROM saved s WHERE s.user_id = u.id) AS saved FROM users u ORDER BY u.created_at DESC LIMIT 500"
        ).all()).results;
        return json({ ok: true, users: rows.map((x) => ({ id: x.id, nick: x.nick, createdAt: x.created_at, saved: x.saved, admin: isAdmin(env, x) })) });
      }

      if (r === "user-delete" && method === "POST") {
        const b = await body(request);
        if (!b || typeof b.id !== "string" || b.id.length > 64) return fail(400, "요청 형식이 올바르지 않습니다.");
        if (b.id.toLowerCase() === u.id.toLowerCase() || isAdmin(env, { id: b.id })) return fail(400, "관리자 계정은 여기서 삭제할 수 없습니다.");
        await env.DB.batch([
          env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(b.id),
          env.DB.prepare("DELETE FROM saved WHERE user_id = ?").bind(b.id),
          env.DB.prepare("DELETE FROM users WHERE id = ?").bind(b.id),
        ]);
        return json({ ok: true });
      }
      return fail(404, "없는 주소입니다.");
    }

    return fail(404, "없는 주소입니다.");
  } catch (e) {
    console.error("api error", e && e.stack || e);
    return fail(500, "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
  }
}
