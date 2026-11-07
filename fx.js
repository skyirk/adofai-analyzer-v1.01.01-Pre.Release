/* ADOFAI ANALYZER - 화면 효과 모음 (TUF 레벨 목록 느낌)
   ① 점 격자 배경(마우스에 반응)  ② 카드 스포트라이트·기울기·반짝임  ③ 고난도 카드의 도는 테두리
   ④ 샤이니 텍스트(CSS)  ⑤ 목록 등장 애니메이션(CSS)  ⑥ 숫자 카운트업  ⑦ 제목 스크램블
   ⑧ 클릭 스파크  ⑨ 마그넷 버튼  ⑩ 스크롤 진행 바
   마우스가 없는 기기(터치)나 "모션 줄이기" 설정에서는 움직이는 효과를 끈다. app.js 가 FX.countTo / FX.scramble 을 부른다. */
(function () {
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches;
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const introOpen = () => { const i = document.getElementById("intro"); return !!i && !i.classList.contains("hidden"); };
  const rgb = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const PURPLE = [182, 92, 245], PINK = [255, 93, 122], GOLD = [245, 192, 74];
  const mkCanvas = (id, z) => {
    const c = document.createElement("canvas");
    c.id = id; c.setAttribute("aria-hidden", "true");
    c.style.cssText = `position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:${z}`;
    document.body.prepend(c); return c;
  };

  /* ---------- ① 점 격자 배경 ---------- */
  if (fine && !reduce) {
    const cv = mkCanvas("dot-grid", 0), ctx = cv.getContext("2d");
    const GAP = 34, R = 170;
    let W = 0, H = 0, dpr = 1, raf = 0, mx = -999, my = -999, tx = -999, ty = -999, moved = 0, waves = [];
    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); draw(performance.now());
    };
    function draw(now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const cols = Math.ceil(W / GAP) + 1, rows = Math.ceil(H / GAP) + 1;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          let x = i * GAP + GAP / 2, y = j * GAP + GAP / 2;
          let t = 0;
          const dx = x - mx, dy = y - my, d = Math.hypot(dx, dy);
          if (d < R) { t = 1 - d / R; const push = t * t * 9; x += (dx / (d || 1)) * push; y += (dy / (d || 1)) * push; }
          for (const w of waves) {                      // 클릭하면 퍼지는 물결
            const wd = Math.abs(Math.hypot(x - w.x, y - w.y) - w.r);
            if (wd < 46) t = Math.max(t, (1 - wd / 46) * w.a);
          }
          const col = mix(PURPLE, PINK, clamp(t * 1.2, 0, 1));
          ctx.fillStyle = rgb(col, 0.16 + t * 0.78);
          ctx.beginPath(); ctx.arc(x, y, 1.05 + t * 2.7, 0, TAU); ctx.fill();
        }
      }
    }
    let last = 0;
    function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
      mx += (tx - mx) * 0.18; my += (ty - my) * 0.18;
      for (const w of waves) { w.r += 620 * dt; w.a -= dt * 1.1; }
      waves = waves.filter((w) => w.a > 0);
      if (!introOpen()) draw(now);
      if (now - moved < 1400 || waves.length) raf = requestAnimationFrame(loop); else raf = 0;
    }
    const wake = () => { moved = performance.now(); if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } };
    addEventListener("pointermove", (e) => { tx = e.clientX; ty = e.clientY; if (mx < -900) { mx = tx; my = ty; } wake(); }, { passive: true });
    addEventListener("pointerdown", (e) => { if (!introOpen()) { waves.push({ x: e.clientX, y: e.clientY, r: 0, a: 1 }); wake(); } }, { passive: true });
    document.addEventListener("pointerleave", () => { tx = ty = -999; wake(); });
    addEventListener("resize", size);
    size();
  }

  /* ---------- ② 카드 스포트라이트 / 기울기 / 반짝임 ---------- */
  const list = document.getElementById("level-list");
  if (list && fine) {
    list.addEventListener("pointermove", (e) => {
      const c = e.target.closest && e.target.closest(".card");
      if (!c) return;
      const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      c.style.setProperty("--mx", x + "px"); c.style.setProperty("--my", y + "px");
      if (!reduce) {
        c.style.setProperty("--rx", (((y / r.height) - 0.5) * -3.2).toFixed(2) + "deg");
        c.style.setProperty("--ry", (((x / r.width) - 0.5) * 3.2).toFixed(2) + "deg");
      }
    });
    list.addEventListener("pointerout", (e) => {
      const c = e.target.closest && e.target.closest(".card");
      if (c && !c.contains(e.relatedTarget)) { c.style.removeProperty("--rx"); c.style.removeProperty("--ry"); }
    });
  }

  /* ---------- ⑥ 숫자 카운트업 ---------- */
  const counters = new WeakMap();
  function countTo(el, n, suffix = "") {
    const from = counters.has(el) ? counters.get(el).value : 0;
    if (counters.has(el)) cancelAnimationFrame(counters.get(el).raf);
    if (reduce || from === n) { el.textContent = n + suffix; counters.set(el, { value: n, raf: 0 }); return; }
    const t0 = performance.now(), dur = 520;
    const st = { value: from, raf: 0 }; counters.set(el, st);
    (function tick(now) {
      const k = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
      st.value = Math.round(from + (n - from) * e); el.textContent = st.value + suffix;
      if (k < 1) st.raf = requestAnimationFrame(tick); else { st.value = n; el.textContent = n + suffix; }
    })(t0);
  }

  /* ---------- ⑦ 제목 스크램블 (글자가 뒤섞이다 왼쪽부터 제자리) ---------- */
  const POOL = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*가나다라마바사아자차카타파하";
  const scr = new WeakMap();
  function scramble(el, text) {
    if (scr.has(el)) cancelAnimationFrame(scr.get(el));
    el.setAttribute("aria-label", text);
    if (reduce) { el.textContent = text; return; }
    const t0 = performance.now(), dur = 520 + text.length * 22;
    (function tick(now) {
      const k = clamp((now - t0) / dur, 0, 1), fixed = Math.floor(k * text.length);
      let s = "";
      for (let i = 0; i < text.length; i++) s += i < fixed || text[i] === " " ? text[i] : POOL[(Math.random() * POOL.length) | 0];
      el.textContent = s;
      if (k < 1) scr.set(el, requestAnimationFrame(tick)); else el.textContent = text;
    })(t0);
  }

  /* ---------- ⑧ 클릭 스파크 ---------- */
  if (!reduce) {
    let cv = null, ctx = null, sparks = [], raf = 0, last = 0, dpr = 1;
    const COLS = [PURPLE, PINK, GOLD];
    function ensure() {
      if (cv) return;
      cv = mkCanvas("click-spark", 45); ctx = cv.getContext("2d");
      const fit = () => { dpr = Math.min(devicePixelRatio || 1, 2); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
      fit(); addEventListener("resize", fit);
    }
    function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const s of sparks) {
        s.age += dt; const k = s.age / s.life; if (k >= 1) continue;
        const d0 = s.v * (1 - Math.pow(1 - k, 2)), d1 = d0 + 9 * (1 - k);
        ctx.strokeStyle = rgb(s.c, 1 - k); ctx.lineWidth = 2; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(s.x + Math.cos(s.a) * d0, s.y + Math.sin(s.a) * d0); ctx.lineTo(s.x + Math.cos(s.a) * d1, s.y + Math.sin(s.a) * d1); ctx.stroke();
      }
      sparks = sparks.filter((s) => s.age < s.life);
      raf = sparks.length ? requestAnimationFrame(loop) : 0;
      if (!raf) ctx.clearRect(0, 0, innerWidth, innerHeight);
    }
    addEventListener("pointerdown", (e) => {
      if (introOpen() || e.button > 0) return;
      ensure();
      const base = Math.random() * TAU, c = COLS[(Math.random() * COLS.length) | 0];
      for (let i = 0; i < 9; i++) sparks.push({ x: e.clientX, y: e.clientY, a: base + (i / 9) * TAU, v: 22 + Math.random() * 14, life: 0.42 + Math.random() * 0.18, age: 0, c });
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    }, { passive: true });
  }

  /* ---------- ⑨ 마그넷 버튼 (커서 쪽으로 살짝 끌려옴) ---------- */
  if (fine && !reduce) {
    const SEL = ".nav .btn, .auth .btn, #filters-reset";
    document.addEventListener("pointermove", (e) => {
      const b = e.target.closest && e.target.closest(SEL);
      if (!b) return;
      const r = b.getBoundingClientRect();
      const x = clamp((e.clientX - (r.left + r.width / 2)) * 0.18, -6, 6), y = clamp((e.clientY - (r.top + r.height / 2)) * 0.28, -4, 4);
      b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    });
    document.addEventListener("pointerout", (e) => {
      const b = e.target.closest && e.target.closest(SEL);
      if (b && !b.contains(e.relatedTarget)) b.style.transform = "";
    });
  }

  /* ---------- ⑩ 스크롤 진행 바 ---------- */
  const bar = document.createElement("div");
  bar.id = "scroll-progress"; bar.setAttribute("aria-hidden", "true");
  document.body.append(bar);
  let ticking = false;
  const upd = () => {
    ticking = false;
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${h > 0 ? clamp(scrollY / h, 0, 1) : 0})`;
  };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(upd); } }, { passive: true });
  addEventListener("resize", upd); upd();

  /* 소개 화면 마우스 시차 */
  const introEl = document.getElementById("intro");
  if (introEl) {
    let raf = 0;
    introEl.addEventListener("pointermove", (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        introEl.style.setProperty("--px", ((e.clientX / innerWidth) * 2 - 1).toFixed(3));
        introEl.style.setProperty("--py", ((e.clientY / innerHeight) * 2 - 1).toFixed(3));
      });
    }, { passive: true });
  }

  window.FX = { countTo, scramble };
})();
