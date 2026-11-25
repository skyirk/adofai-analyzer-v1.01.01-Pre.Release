/* ADOFAI 맵 테스트 플레이어 (오토 재생 전용)
   .adofai 파일을 읽어 타일/공/연출 이벤트를 Canvas 로 재생합니다.
   - 지원: 타일 배치(angleData / pathData), SetSpeed, Twirl, Pause, Hold, 미드스핀,
           MoveCamera, MoveTrack, PositionTrack, ColorTrack, RecolorTrack, Flash, SetFilter(일부),
           Bloom(근사), ShakeScreen, CustomBackground(색), 트랙 등장/퇴장 애니메이션(근사)
   - 미지원: 데코레이션(이미지/텍스트), 배경 이미지, 일부 필터, 3인 이상 멀티플래닛, 조건부 이벤트 등 */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const D2R = Math.PI / 180;
  const mod = (a, m) => ((a % m) + m) % m;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------- 이징 ---------- */
  const bounceOut = (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  };
  const BASE = {
    Sine: (t) => 1 - Math.cos((t * Math.PI) / 2), Quad: (t) => t * t, Cubic: (t) => t ** 3,
    Quart: (t) => t ** 4, Quint: (t) => t ** 5, Expo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
    Circ: (t) => 1 - Math.sqrt(1 - t * t),
    Back: (t) => { const c = 1.70158; return (c + 1) * t ** 3 - c * t * t; },
    Elastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3))),
    Bounce: (t) => 1 - bounceOut(1 - t),
  };
  const easeCache = {};
  function easeFn(name) {
    if (!name || name === "Linear") return (t) => t;
    if (easeCache[name]) return easeCache[name];
    const m = /^(InOut|In|Out)(.+)$/.exec(name);
    let f = (t) => t;
    if (m && BASE[m[2]]) {
      const b = BASE[m[2]];
      if (m[1] === "In") f = b;
      else if (m[1] === "Out") f = (t) => 1 - b(1 - t);
      else f = (t) => (t < 0.5 ? b(2 * t) / 2 : 1 - b(2 - 2 * t) / 2);
    }
    return (easeCache[name] = f);
  }

  /* ---------- 색 ---------- */
  function hex(v, fallback) {
    if (typeof v !== "string") return fallback;
    const h = v.replace("#", "");
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) return fallback;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  const css = (c, alphaMul = 1) => `rgba(${c.r},${c.g},${c.b},${(c.a * alphaMul).toFixed(3)})`;
  const mix = (a, b, t) => ({ r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t), a: 1 });
  const bool = (v, def = false) => (v === undefined || v === null ? def : v === true || v === "Enabled" || v === "true");

  /* ---------- 파일 파싱 ---------- */
  const PATH = { R: 0, p: 15, J: 30, E: 45, T: 60, o: 75, U: 90, q: 105, G: 120, Q: 135, H: 150, W: 165, L: 180, x: 195, N: 210, Z: 225, F: 240, V: 255, D: 270, Y: 285, B: 300, C: 315, M: 330, A: 345, "!": 999 };
  function parseAdofai(text) {
    text = text.replace(/^﻿/, "");
    try { return JSON.parse(text); } catch (e) { /* 뒤쪽 쉼표 허용 */ }
    return JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
  }
  function getAngles(m) {
    if (Array.isArray(m.angleData)) return m.angleData.map(Number);
    if (typeof m.pathData === "string") return [...m.pathData].map((c) => (c in PATH ? PATH[c] : 0));
    throw new Error("angleData / pathData 가 없는 파일입니다.");
  }

  /* ---------- 지원 이벤트 ---------- */
  const SUPPORTED = new Set(["SetSpeed", "Twirl", "Pause", "Hold", "MoveCamera", "MoveTrack", "PositionTrack", "ColorTrack", "RecolorTrack", "Flash", "SetFilter", "Bloom", "ShakeScreen", "CustomBackground", "MoveDecorations", "AddDecoration", "AddText"]);
  const HARMLESS = new Set(["EditorComment", "Bookmark", "SetHitsound", "Checkpoint", "SetPlanetRotation", "AnimateTrack", "SetFrameRate", "SetFloorIcon", "ScaleMargin", "ScaleRadius", "ScalePlanets"]);
  const FILTER_CSS = {
    Grayscale: (i) => `grayscale(${i}%)`, Sepia: (i) => `sepia(${i}%)`, Invert: (i) => `invert(${i}%)`,
    Blur: (i) => `blur(${(i / 100) * 8}px)`, BlurFocus: (i) => `blur(${(i / 100) * 5}px)`,
    NightVision: (i) => `grayscale(${i}%) sepia(${i * 0.4}%) hue-rotate(60deg) brightness(1.2)`,
    Neon: (i) => `saturate(${100 + i * 1.5}%) contrast(${100 + i * 0.3}%)`,
    Funk: (i) => `hue-rotate(${i * 3.6}deg)`,
  };

  /* ---------- 레벨 빌드 ---------- */
  function buildLevel(m) {
    const S = m.settings || {};
    const ang = getAngles(m);
    const n = ang.length + 1;
    if (n < 2) throw new Error("타일이 너무 적습니다.");
    const actions = Array.isArray(m.actions) ? m.actions : [];
    const byFloor = Array.from({ length: n }, () => []);
    for (const a of actions) {
      const f = a.floor | 0;
      if (f >= 0 && f < n) byFloor[f].push(a);
    }

    // 방향/위치
    const eff = new Array(n - 1), mid = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      mid[i] = ang[i] === 999;
      eff[i] = mid[i] ? mod((i > 0 ? eff[i - 1] : 0) + 180, 360) : mod(ang[i], 360);
    }
    const X = new Float64Array(n), Y = new Float64Array(n);
    for (let i = 0; i < n - 1; i++) {
      X[i + 1] = X[i] + Math.cos(eff[i] * D2R);
      Y[i + 1] = Y[i] + Math.sin(eff[i] * D2R);
    }
    const aIn = new Float64Array(n), aOut = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      aIn[i] = i === 0 ? 180 : mod(eff[i - 1] + 180, 360);
      aOut[i] = i < n - 1 ? eff[i] : mod(aIn[i] + 180, 360);
    }

    // 시간 계산
    const T = new Float64Array(n), bpmAt = new Float64Array(n);
    const cw = new Uint8Array(n), delta = new Float64Array(n), waitT = new Float64Array(n), rotT = new Float64Array(n);
    let bpm = Number(S.bpm) > 0 ? Number(S.bpm) : 100, dirCW = true;
    for (let i = 0; i < n; i++) {
      let pause = 0, hold = 0;
      for (const ev of byFloor[i]) {
        if (ev.eventType === "SetSpeed") {
          if (ev.speedType === "Multiplier") bpm *= Number(ev.bpmMultiplier) || 1;
          else if (Number(ev.beatsPerMinute) > 0) bpm = Number(ev.beatsPerMinute);
        } else if (ev.eventType === "Twirl") dirCW = !dirCW;
        else if (ev.eventType === "Pause") pause += Number(ev.duration) || 0;
        else if (ev.eventType === "Hold") hold += Number(ev.duration) || 0;
      }
      bpmAt[i] = bpm; cw[i] = dirCW ? 1 : 0;
      const beat = 60 / bpm;
      let d = 0;
      if (i < n - 1) {
        if (!mid[i]) {
          d = dirCW ? mod(aIn[i] - aOut[i], 360) : mod(aOut[i] - aIn[i], 360);
          if (d < 1e-6) d = 360;
          d += hold * 360;
        }
        delta[i] = d; waitT[i] = pause * beat; rotT[i] = (d / 180) * beat;
        T[i + 1] = T[i] + waitT[i] + rotT[i];
      }
    }

    // 이벤트 시간
    const beatAt = (f) => 60 / bpmAt[f];
    const evT = (ev) => T[ev.floor | 0] + ((Number(ev.angleOffset) || 0) / 180) * beatAt(ev.floor | 0);
    const evDur = (ev) => Math.max(0, Number(ev.duration) || 0) * beatAt(ev.floor | 0);
    const tileRef = (arr, floor, dflt) => {
      if (!Array.isArray(arr)) return clamp(dflt, 0, n - 1);
      const k = Number(arr[0]) || 0, ref = arr[1];
      const base = ref === "Start" ? 0 : ref === "End" ? n - 1 : floor;
      return clamp(base + k, 0, n - 1);
    };

    // 정적 트랙 색 / 위치
    const baseColor1 = hex(S.trackColor, hex("debb7b")), baseColor2 = hex(S.secondaryTrackColor, hex("ffffff"));
    let cur = { type: S.trackColorType || "Single", c1: baseColor1, c2: baseColor2, style: S.trackStyle || "Standard" };
    const colMode = new Array(n), col1 = new Array(n), col2 = new Array(n), tstyle = new Array(n);
    const base = { dx: new Float32Array(n), dy: new Float32Array(n), rot: new Float32Array(n), sx: new Float32Array(n).fill(1), sy: new Float32Array(n).fill(1), op: new Float32Array(n).fill(1) };
    for (let i = 0; i < n; i++) {
      for (const ev of byFloor[i]) {
        if (ev.eventType === "ColorTrack") {
          cur = {
            type: ev.trackColorType || cur.type, c1: hex(ev.trackColor, cur.c1), c2: hex(ev.secondaryTrackColor, cur.c2),
            style: ev.trackStyle || cur.style,
          };
        } else if (ev.eventType === "PositionTrack" && !bool(ev.editorOnly)) {
          const p = ev.positionOffset;
          if (Array.isArray(p)) { base.dx[i] = Number(p[0]) || 0; base.dy[i] = Number(p[1]) || 0; }
          if (typeof ev.rotation === "number") base.rot[i] = ev.rotation;
          if (typeof ev.opacity === "number") base.op[i] = ev.opacity / 100;
          if (typeof ev.scale === "number") { base.sx[i] = base.sy[i] = ev.scale / 100; }
          else if (Array.isArray(ev.scale)) { base.sx[i] = (Number(ev.scale[0]) || 100) / 100; base.sy[i] = (Number(ev.scale[1]) || 100) / 100; }
        }
      }
      colMode[i] = cur.type; col1[i] = cur.c1; col2[i] = cur.c2; tstyle[i] = cur.style;
    }

    // 동적 이벤트
    const timed = [], cams = [], flashes = [], shakes = [], filtEv = [], bloomEv = [], bgEv = [];
    const typeCount = {}, unsupportedFilters = new Set();
    for (const ev of actions) {
      const type = ev.eventType;
      typeCount[type] = (typeCount[type] || 0) + 1;
      if (!((ev.floor | 0) >= 0 && (ev.floor | 0) < n)) continue;
      const t = evT(ev), dur = evDur(ev), f = ev.floor | 0;
      switch (type) {
        case "MoveTrack": timed.push({ t, dur, kind: "move", ev, a: tileRef(ev.startTile, f, f), b: tileRef(ev.endTile, f, f), ease: easeFn(ev.ease) }); break;
        case "RecolorTrack": timed.push({ t, dur: 0, kind: "recolor", ev, a: tileRef(ev.startTile, f, f), b: tileRef(ev.endTile, f, f) }); break;
        case "MoveCamera": cams.push({ t, dur, ev, floor: f, ease: easeFn(ev.ease) }); break;
        case "Flash": flashes.push({ t, dur, ev, ease: easeFn(ev.ease) }); break;
        case "ShakeScreen": shakes.push({ t, dur, ev }); break;
        case "SetFilter": filtEv.push({ t, ev }); break;
        case "Bloom": bloomEv.push({ t, ev }); break;
        case "CustomBackground": bgEv.push({ t, ev }); break;
        default: break;
      }
    }
    const byT = (a, b) => a.t - b.t;
    [timed, cams, flashes, shakes, filtEv, bloomEv, bgEv].forEach((l) => l.sort(byT));

    // 카메라 상태 (이벤트마다 도착 상태)
    const initCam = { rel: S.relativeTo || "Player", pos: Array.isArray(S.position) ? [Number(S.position[0]) || 0, Number(S.position[1]) || 0] : [0, 0], rot: Number(S.rotation) || 0, zoom: Number(S.zoom) || 100, tile: 0 };
    let prev = initCam;
    for (const c of cams) {
      const e = c.ev, p = Array.isArray(e.position) ? e.position : [];
      const rel = e.relativeTo || prev.rel;
      c.to = {
        rel, tile: c.floor,
        pos: [typeof p[0] === "number" ? p[0] : prev.pos[0], typeof p[1] === "number" ? p[1] : prev.pos[1]],
        rot: typeof e.rotation === "number" ? e.rotation : prev.rot,
        zoom: typeof e.zoom === "number" ? e.zoom : prev.zoom,
      };
      c.from = prev;
      prev = c.to;
    }

    // 필터 / 블룸 / 배경 상태 열
    const filtStates = [];
    let fs = {};
    for (const f of filtEv) {
      const e = f.ev, name = e.filter;
      if (bool(e.disableOthers)) fs = {};
      else fs = { ...fs };
      const on = bool(e.enabled, true);
      if (on) { fs[name] = clamp(Number(e.intensity ?? 100), 0, 100); if (!FILTER_CSS[name]) unsupportedFilters.add(name); }
      else delete fs[name];
      filtStates.push(fs);
    }
    const bloomStates = bloomEv.map((b) => ({ on: bool(b.ev.enabled, true), intensity: Number(b.ev.intensity ?? 100), threshold: Number(b.ev.threshold ?? 50), color: hex(b.ev.color, hex("ffffff")) }));
    const par2 = (v) => (Array.isArray(v) ? [Number(v[0]) || 0, Number(v[1]) || 0] : [100, 100]);
    const bgBase = { color: hex(S.backgroundColor, hex("000000")), img: S.bgImage || "", imgColor: hex(S.bgImageColor, hex("ffffff")), mode: S.bgDisplayMode || "FitToScreen", parallax: par2(S.parallax), loop: bool(S.loopBG) };
    let pb = bgBase;
    const bgStates = bgEv.map((b) => {
      const e = b.ev;
      pb = { color: hex(e.color, null) || pb.color, img: e.bgImage !== undefined ? e.bgImage : pb.img, imgColor: hex(e.imageColor, null) || pb.imgColor, mode: e.bgDisplayMode || pb.mode, parallax: e.parallax ? par2(e.parallax) : pb.parallax, loop: e.loopBG !== undefined ? bool(e.loopBG) : pb.loop };
      return pb;
    });

    // 데코레이션
    const decos = [], fromActions = new Set(actions);
    const decSrc = (Array.isArray(m.decorations) ? m.decorations : []).concat(actions.filter((a) => a.eventType === "AddDecoration" || a.eventType === "AddText"));
    const v2 = (v, d) => (Array.isArray(v) ? [Number(v[0]), Number(v[1])] .map((x, k) => (Number.isFinite(x) ? x : d[k])) : d);
    for (const d of decSrc) {
      if (d.eventType !== "AddDecoration" && d.eventType !== "AddText") continue;
      if (!fromActions.has(d)) typeCount[d.eventType] = (typeCount[d.eventType] || 0) + 1;
      const par = Array.isArray(d.parallax) && d.parallax[0] >= 0 ? v2(d.parallax, [100, 100]) : null;
      decos.push({
        text: d.eventType === "AddText", img: d.decorationImage || "", str: String(d.decText || "").replace(/<[^>]*>/g, ""),
        pos: v2(d.position, [0, 0]), rel: d.relativeTo || "Tile", floor: clamp(d.floor | 0, 0, n - 1), pivot: v2(d.pivotOffset, [0, 0]), rot: Number(d.rotation) || 0,
        sc: v2(d.scale, [100, 100]), color: hex(d.color, hex("ffffff")), op: Number(d.opacity ?? 100) / 100, depth: Number(d.depth ?? -1),
        parallax: par, parOff: v2(d.parallaxOffset, [0, 0]), tags: String(d.tag || "").split(/\s+/).filter(Boolean), visible: d.visible === undefined ? true : bool(d.visible, true),
      });
    }
    const tagMap = {};
    decos.forEach((d, i) => d.tags.forEach((t) => (tagMap[t] = tagMap[t] || []).push(i)));
    for (const ev of actions) {
      if (ev.eventType !== "MoveDecorations" || !((ev.floor | 0) >= 0 && (ev.floor | 0) < n)) continue;
      const idx = [...new Set(String(ev.tag || "").split(/\s+/).flatMap((t) => tagMap[t] || []))];
      if (idx.length) timed.push({ t: evT(ev), dur: evDur(ev), kind: "decmove", ev, idx, ease: easeFn(ev.ease) });
    }
    timed.sort(byT);
    const decBack = decos.map((_, i) => i).filter((i) => decos[i].depth > 0).sort((a, b) => decos[b].depth - decos[a].depth);
    const decFront = decos.map((_, i) => i).filter((i) => decos[i].depth <= 0).sort((a, b) => decos[b].depth - decos[a].depth);

    // 트랙 등장/퇴장
    const appear = S.trackAnimation && S.trackAnimation !== "None" ? S.trackAnimation : null;
    const disappear = S.trackDisappearAnimation && S.trackDisappearAnimation !== "None" ? S.trackDisappearAnimation : null;
    const ahead = Number(S.beatsAhead ?? 3), behind = Number(S.beatsBehind ?? 4);

    // 요약
    const bpms = []; for (let i = 0; i < n - 1; i++) bpms.push(bpmAt[i]);
    const unsupported = {}, supported = {};
    for (const k of Object.keys(typeCount)) {
      if (SUPPORTED.has(k)) supported[k] = typeCount[k];
      else if (!HARMLESS.has(k)) unsupported[k] = typeCount[k];
    }
    const decoCount = 0;

    return {
      S, n, X, Y, eff, mid, aIn, aOut, T, bpmAt, cw, delta, waitT, rotT, byFloor,
      col1, col2, colMode, tstyle, base, timed, cams, initCam, flashes, shakes,
      filtEv, filtStates, bloomEv, bloomStates, bgEv, bgStates, bgBase, decos, decBack, decFront, appear, disappear, ahead, behind,
      pre: (Number(S.countdownTicks ?? 4) || 0) * (60 / (Number(S.bpm) > 0 ? Number(S.bpm) : bpmAt[0])),
      end: T[n - 1] + 2 * (60 / bpmAt[n - 1]),
      info: { images: [...new Set(decos.map((d) => d.img).concat(bgBase.img, bgStates.map((b) => b.img)).filter(Boolean))], tiles: n, bpmMin: Math.min(...bpms), bpmMax: Math.max(...bpms), supported, unsupported, decoCount, unsupportedFilters: [...unsupportedFilters], duration: T[n - 1] },
    };
  }

  /* ---------- 상태 엔진 (MoveTrack / RecolorTrack) ---------- */
  class Engine {
    constructor(L) { this.L = L; this.reset(); }
    reset() {
      const b = this.L.base, n = this.L.n;
      this.dx = Float32Array.from(b.dx); this.dy = Float32Array.from(b.dy); this.rot = Float32Array.from(b.rot);
      this.sx = Float32Array.from(b.sx); this.sy = Float32Array.from(b.sy); this.op = Float32Array.from(b.op);
      this.c1 = this.L.col1.slice(); this.c2 = this.L.col2.slice(); this.cm = this.L.colMode.slice();
      this.dpx = new Float32Array(this.L.decos.length); this.dpy = new Float32Array(this.L.decos.length); this.drot = new Float32Array(this.L.decos.length);
      this.dsx = Float32Array.from(this.L.decos, (d) => d.sc[0] / 100); this.dsy = Float32Array.from(this.L.decos, (d) => d.sc[1] / 100); this.dop = Float32Array.from(this.L.decos, (d) => d.op);
      this.ptr = 0; this.active = []; this.last = -Infinity; this.n = n;
    }
    start(it) {
      if (it.kind === "recolor") {
        const e = it.ev;
        for (let i = it.a; i <= it.b; i++) {
          if (e.trackColor) this.c1[i] = hex(e.trackColor, this.c1[i]);
          if (e.secondaryTrackColor) this.c2[i] = hex(e.secondaryTrackColor, this.c2[i]);
          if (e.trackColorType) this.cm[i] = e.trackColorType;
        }
        return;
      }
      if (it.kind === "decmove") {
        const e = it.ev, tw = { t0: it.t, dur: it.dur, idx: it.idx, ease: it.ease, props: [] };
        const addD = (arr, target, rel) => { if (typeof target === "number" && !Number.isNaN(target)) tw.props.push({ arr, target, rel, s: Float32Array.from(it.idx, (i) => arr[i]) }); };
        const po = e.positionOffset; if (Array.isArray(po)) { addD(this.dpx, po[0]); addD(this.dpy, po[1]); }
        addD(this.drot, e.rotationOffset, true);
        if (Array.isArray(e.scale)) { addD(this.dsx, e.scale[0] / 100); addD(this.dsy, e.scale[1] / 100); } else addD(this.dsx, e.scale / 100) , addD(this.dsy, e.scale / 100);
        addD(this.dop, e.opacity / 100);
        if (tw.props.length) this.active.push(tw);
        return;
      }
      const e = it.ev, a = Math.min(it.a, it.b), b = Math.max(it.a, it.b), cnt = b - a + 1;
      const tw = { t0: it.t, dur: it.dur, a, b, ease: it.ease, props: [] };
      const add = (arr, target, s) => { if (target !== null && target !== undefined && !Number.isNaN(target)) tw.props.push({ arr, target, s: Float32Array.from(arr.subarray(a, b + 1)) }); };
      const po = e.positionOffset;
      if (Array.isArray(po)) { add(this.dx, typeof po[0] === "number" ? po[0] : null); add(this.dy, typeof po[1] === "number" ? po[1] : null); }
      if (typeof e.rotationOffset === "number") add(this.rot, e.rotationOffset);
      if (typeof e.scale === "number") { add(this.sx, e.scale / 100); add(this.sy, e.scale / 100); }
      else if (Array.isArray(e.scale)) { add(this.sx, typeof e.scale[0] === "number" ? e.scale[0] / 100 : null); add(this.sy, typeof e.scale[1] === "number" ? e.scale[1] / 100 : null); }
      if (typeof e.opacity === "number") add(this.op, e.opacity / 100);
      if (cnt > 0 && tw.props.length) this.active.push(tw);
    }
    applyActive(t) {
      for (let k = this.active.length - 1; k >= 0; k--) {
        const tw = this.active[k];
        const p = tw.dur > 0 ? clamp((t - tw.t0) / tw.dur, 0, 1) : 1, e = tw.ease(p);
        if (tw.idx) { for (const pr of tw.props) for (let k = 0; k < tw.idx.length; k++) pr.arr[tw.idx[k]] = pr.s[k] + ((pr.rel ? pr.s[k] + pr.target : pr.target) - pr.s[k]) * e; }
        else for (const pr of tw.props) for (let i = tw.a; i <= tw.b; i++) pr.arr[i] = pr.s[i - tw.a] + (pr.target - pr.s[i - tw.a]) * e;
        if (p >= 1) this.active.splice(k, 1);
      }
    }
    advance(t) {
      if (t < this.last - 1e-6) { this.seek(t); return; }
      const list = this.L.timed;
      while (this.ptr < list.length && list[this.ptr].t <= t) this.start(list[this.ptr++]);
      this.applyActive(t);
      this.last = t;
    }
    seek(t) {
      this.reset();
      const span = t - Math.min(0, this.L.timed.length ? this.L.timed[0].t : 0);
      const step = span > 300 ? 0.25 : 0.1;
      const first = this.L.timed.length ? this.L.timed[0].t : t;
      for (let x = first; x < t; x += step) this.advance(x);
      this.advance(t);
    }
  }

  /* ---------- 유틸: 이진 탐색 ---------- */
  function lastLE(arr, key, get = (v) => v) {
    let lo = 0, hi = arr.length - 1, r = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (get(arr[mid]) <= key) { r = mid; lo = mid + 1; } else hi = mid - 1; }
    return r;
  }
  function tileIndexAt(L, t) {
    if (t <= 0) return 0;
    const T = L.T; let lo = 0, hi = L.n - 1, r = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (T[mid] <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; }
    return r;
  }

  /* ---------- 상태 ---------- */
  const cv = $("#cv"), ctx = cv.getContext("2d");
  const small = document.createElement("canvas"), sctx = small.getContext("2d");
  let infoArgs = null, L = null, eng = null, T = 0, playing = false, rate = 1, offsetMs = 0, hitOn = false, audio = null, audioUrl = null, lastTs = 0, lastIdx = 0;
  let pitch = 1, lastFilter = "", ac = null, vol = 0.6;
  const RED = "#ff4d4d", BLUE = "#4d8dff";

  /* ---------- 카메라 ---------- */
  function follow(t) {
    const i = tileIndexAt(L, t);
    if (i >= L.n - 1) return [L.X[L.n - 1], L.Y[L.n - 1]];
    const span = L.T[i + 1] - L.T[i];
    let p = span > 0 ? clamp((t - L.T[i]) / span, 0, 1) : 1;
    if (t < 0) p = 0;
    p = p * p * (3 - 2 * p);
    return [lerp(L.X[i], L.X[i + 1], p), lerp(L.Y[i], L.Y[i + 1], p)];
  }
  function worldOf(st, t, fol) {
    if (st.rel === "Global") return [st.pos[0], st.pos[1]];
    if (st.rel === "Tile") return [L.X[st.tile] + st.pos[0], L.Y[st.tile] + st.pos[1]];
    return [fol[0] + st.pos[0], fol[1] + st.pos[1]];
  }
  function camAt(t) {
    const fol = follow(t);
    const k = lastLE(L.cams, t, (c) => c.t);
    if (k < 0) { const w = worldOf(L.initCam, t, fol); return { x: w[0], y: w[1], rot: L.initCam.rot, zoom: L.initCam.zoom }; }
    const c = L.cams[k];
    const p = c.dur > 0 ? clamp((t - c.t) / c.dur, 0, 1) : 1, e = c.ease(p);
    const a = worldOf(c.from, t, fol), b = worldOf(c.to, t, fol);
    return { x: lerp(a[0], b[0], e), y: lerp(a[1], b[1], e), rot: lerp(c.from.rot, c.to.rot, e), zoom: lerp(c.from.zoom, c.to.zoom, e) };
  }

  /* ---------- 그리기 ---------- */
  function resize() {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; small.width = Math.max(2, w >> 3); small.height = Math.max(2, h >> 3); }
  }
  function overlayFlash(plane, t, W, H) {
    const list = L.flashes; if (!list.length) return;
    const k = lastLE(list, t, (f) => f.t);
    for (let i = k; i >= 0 && i > k - 40; i--) {
      const f = list[i], e = f.ev;
      if (t > f.t + f.dur + 0.001) continue;
      if ((e.plane || "Background") !== plane) continue;
      const p = f.dur > 0 ? clamp((t - f.t) / f.dur, 0, 1) : 1, q = f.ease(p);
      const c0 = hex(e.startColor, hex("ffffff")), c1 = hex(e.endColor, hex("ffffff"));
      const o = lerp(Number(e.startOpacity ?? 100), Number(e.endOpacity ?? 0), q) / 100;
      if (o <= 0.001) continue;
      ctx.globalAlpha = clamp(o, 0, 1); ctx.fillStyle = css(mix(c0, c1, q)); ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  }
  function tileLook(i, t) {
    // 등장/퇴장 애니메이션 -> [alpha, scale]
    let al = 1, sc = 1;
    if (L.appear) {
      const bt = 60 / L.bpmAt[i], aT = Math.max(0.05, L.ahead * bt);
      const a = clamp((t - (L.T[i] - aT)) / (aT * 0.45), 0, 1);
      if (a <= 0) return null;
      al *= a; if (L.appear !== "Fade") sc *= 0.4 + 0.6 * a;
    }
    if (L.disappear) {
      const bt = 60 / L.bpmAt[i], bT = Math.max(0.05, L.behind * bt);
      const d = clamp((t - (L.T[i] + bT)) / (bT * 0.45), 0, 1);
      if (d >= 1) return null;
      al *= 1 - d; if (L.disappear !== "Fade") sc *= 1 - 0.6 * d;
    }
    return [al, sc];
  }
  function drawTile(i, al, sc, mode, color) {
    const x = L.X[i] + eng.dx[i], y = L.Y[i] + eng.dy[i];
    const h = 0.5 - 0.035;
    const ai = L.aIn[i] * D2R, ao = L.aOut[i] * D2R;
    const hasIn = i > 0, hasOut = i < L.n - 1;
    const px = hasIn ? Math.cos(ai) * h : -Math.cos(ao) * h, py = hasIn ? Math.sin(ai) * h : -Math.sin(ao) * h;
    const qx = hasOut ? Math.cos(ao) * h : -Math.cos(ai) * h, qy = hasOut ? Math.sin(ao) * h : -Math.sin(ai) * h;
    const ro = eng.rot[i], sx = eng.sx[i] * sc, sy = eng.sy[i] * sc;
    ctx.save();
    ctx.translate(x, y);
    if (ro) ctx.rotate(ro * D2R);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(0, 0); ctx.lineTo(qx, qy);
    ctx.globalAlpha = al;
    if (L.mid[i]) {
      // 미드스핀: 한쪽만 이어진 짧은 타일 + 마름모 표식
      ctx.beginPath(); ctx.moveTo(px * 0.7, py * 0.7); ctx.lineTo(0, 0);
      ctx.lineWidth = 0.9; ctx.strokeStyle = css(mix(color, { r: 255, g: 255, b: 255 }, 0.6), 0.9); ctx.stroke();
      ctx.lineWidth = 0.7; ctx.strokeStyle = css(mix(color, { r: 255, g: 255, b: 255 }, 0.25)); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.beginPath(); ctx.moveTo(0, 0.16); ctx.lineTo(0.16, 0); ctx.lineTo(0, -0.16); ctx.lineTo(-0.16, 0); ctx.closePath(); ctx.fill();
      ctx.restore(); return;
    }
    const style = L.tstyle[i];
    if (style === "Basic" || style === "Minimal") {
      ctx.lineWidth = 0.8; ctx.strokeStyle = css(color); ctx.stroke();
    } else if (style === "Neon" || style === "NeonLight") {
      ctx.lineWidth = 0.9; ctx.strokeStyle = css(color); ctx.stroke();
      ctx.lineWidth = 0.7; ctx.strokeStyle = "rgba(8,4,16,.92)"; ctx.stroke();
    } else {
      ctx.lineWidth = 0.9; ctx.strokeStyle = css(mix(color, { r: 255, g: 255, b: 255 }, 0.45), 0.9); ctx.stroke();
      ctx.lineWidth = 0.74; ctx.strokeStyle = css(color); ctx.stroke();
    }
    ctx.restore();
  }
  function tileColor(i) {
    const m = eng.cm[i];
    if (m === "Stripes") return i % 2 === 0 ? eng.c1[i] : eng.c2[i];
    if (m === "Rainbow") { const h = (i * 7) % 360; return hex(hslHex(h), eng.c1[i]); }
    return eng.c1[i];
  }
  function hslHex(h) {
    const f = (n) => { const k = (n + h / 30) % 12; const v = 0.5 - 0.25 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(v * 255).toString(16).padStart(2, "0"); };
    return f(0) + f(8) + f(4);
  }

  /* ---------- 에셋(이미지) ---------- */
  const assets = new Map(), imgCache = new Map();
  const normKey = (p) => String(p || "").replace(/\\/g, "/").toLowerCase();
  function addAsset(file) {
    const rel = normKey(file.webkitRelativePath || file.name), base = rel.split("/").pop();
    const parts = rel.split("/"); for (let i = 0; i < parts.length; i++) assets.set(parts.slice(i).join("/"), file);
    assets.set(base, assets.get(base) || file);
    for (const k of [...imgCache.keys()]) if (!imgCache.get(k).ok) imgCache.delete(k);
  }
  function assetImg(name) {
    if (!name) return null;
    const key = normKey(name);
    let c = imgCache.get(key);
    if (c) return c.ok ? c.img : null;
    const f = assets.get(key) || assets.get(key.split("/").pop());
    if (!f) return null;
    const img = new Image(); c = { img, ok: false };
    img.onload = () => { c.ok = true; };
    img.onerror = () => { c.err = true; };
    img.src = URL.createObjectURL(f);
    imgCache.set(key, c);
    return null;
  }
  function drawBgImage(bg, cam, W, H, ppt) {
    const img = assetImg(bg.img); if (!img) return;
    ctx.save(); ctx.globalAlpha = bg.imgColor.a;
    const px = bg.parallax[0] / 100, py = bg.parallax[1] / 100;
    const ox = -cam.x * ppt * (1 - px) * 0.0 + 0, oy = 0;
    if (bg.mode === "Tiled" || bg.loop) {
      const w = img.width * (ppt / 100), h = img.height * (ppt / 100);
      if (w > 4 && h > 4) {
        const sx = mod(-(cam.x * ppt * (1 - px)) + W / 2 - w / 2, w) - w, sy = mod((cam.y * ppt * (1 - py)) + H / 2 - h / 2, h) - h;
        for (let x = sx; x < W; x += w) for (let y = sy; y < H; y += h) ctx.drawImage(img, x, y, w, h);
      }
    } else if (bg.mode === "Unscaled") {
      const w = img.width * (ppt / 100), h = img.height * (ppt / 100);
      ctx.drawImage(img, W / 2 - w / 2 + ox, H / 2 - h / 2 + oy, w, h);
    } else {
      const k = Math.max(W / img.width, H / img.height), w = img.width * k, h = img.height * k;
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    }
    ctx.restore();
  }
  function drawDecors(list, cam, shx, shy) {
    if (!list.length) return;
    const R = 40 / Math.max(0.1, cam.zoom / 100);
    for (const di of list) {
      const d = L.decos[di];
      if (!d.visible) continue;
      const op = eng.dop[di]; if (op <= 0.003) continue;
      let bx, by;
      if (d.rel === "Global") { bx = d.pos[0]; by = d.pos[1]; }
      else if (d.rel === "Camera" || d.rel === "CameraAspect") { bx = cam.x + d.pos[0]; by = cam.y + d.pos[1]; }
      else { bx = L.X[d.floor] + d.pos[0]; by = L.Y[d.floor] + d.pos[1]; }
      bx += eng.dpx[di]; by += eng.dpy[di];
      if (d.parallax) { bx += (1 - d.parallax[0] / 100) * (cam.x - d.parOff[0]); by += (1 - d.parallax[1] / 100) * (cam.y - d.parOff[1]); }
      if (Math.abs(bx - cam.x) > R * 3 && !d.parallax) continue;
      ctx.save(); ctx.globalAlpha = clamp(op, 0, 1);
      ctx.translate(bx, by);
      if (d.rel === "Camera" || d.rel === "CameraAspect") ctx.rotate(-cam.rot * D2R);
      const r = d.rot + eng.drot[di]; if (r) ctx.rotate(r * D2R);
      const sx = eng.dsx[di], sy = eng.dsy[di];
      if (d.text) {
        const k = 0.008;
        ctx.scale(sx * k, -sy * k); ctx.font = "100px 'Noto Sans KR', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = css(d.color);
        ctx.fillText(d.str, -d.pivot[0] * 100, d.pivot[1] * 100);
      } else {
        const img = assetImg(d.img);
        if (img) {
          const w = img.width / 100, h = img.height / 100;
          ctx.scale(sx, -sy); ctx.drawImage(img, -w / 2 - d.pivot[0], -h / 2 + d.pivot[1], w, h);
        }
      }
      ctx.restore();
    }
  }

  function planetState(t) {
    const i = tileIndexAt(L, t);
    const last = i >= L.n - 1;
    let ang, pivot = i;
    const u = t < 0 ? 0 : t - L.T[i];
    const dirSign = L.cw[i] ? -1 : 1;
    if (last) {
      const beat = 60 / L.bpmAt[i];
      ang = L.aIn[i] + dirSign * (u / beat) * 180;
    } else if (u < L.waitT[i]) ang = L.aIn[i];
    else {
      const rt = L.rotT[i];
      const p = rt > 0 ? clamp((u - L.waitT[i]) / rt, 0, 1) : 1;
      ang = L.aIn[i] + dirSign * p * L.delta[i];
    }
    return { i: pivot, ang, last };
  }

  function render() {
    resize();
    const W = cv.width, H = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    const kb = lastLE(L.bgEv, T, (b) => b.t);
    const bgs = kb >= 0 ? L.bgStates[kb] : L.bgBase;
    ctx.fillStyle = css(bgs.color);
    ctx.fillRect(0, 0, W, H);
    overlayFlash("Background", T, W, H);

    eng.advance(T);
    const cam = camAt(T);
    // 화면 흔들림
    let shx = 0, shy = 0;
    if (L.shakes.length) {
      const k = lastLE(L.shakes, T, (s) => s.t);
      for (let i = k; i >= 0 && i > k - 20; i--) {
        const s = L.shakes[i];
        if (T > s.t + s.dur) continue;
        const p = s.dur > 0 ? clamp((T - s.t) / s.dur, 0, 1) : 1;
        const e = s.ev, amp = ((Number(e.strength ?? 100) / 100) * (Number(e.intensity ?? 100) / 100)) * 0.35 * (bool(e.fadeOut, true) ? 1 - p : 1);
        const ph = (T - s.t) * Number(e.frequency ?? 30);
        shx += amp * (Math.sin(ph * 2.3) + 0.5 * Math.sin(ph * 5.1)); shy += amp * (Math.cos(ph * 1.7) + 0.5 * Math.cos(ph * 4.3));
      }
    }
    const ppt = ((H / 10) * cam.zoom) / 100;
    drawBgImage(bgs, cam, W, H, ppt);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(cam.rot * D2R);
    ctx.scale(ppt, -ppt);
    ctx.translate(-(cam.x + shx), -(cam.y + shy));
    ctx.lineCap = "butt"; ctx.lineJoin = "miter"; ctx.miterLimit = 2.2;

    drawDecors(L.decBack, cam, shx, shy);
    const R = (0.5 * Math.hypot(W, H)) / ppt + 3;
    const cx = cam.x + shx, cy = cam.y + shy;
    const animated = L.appear || L.disappear;
    for (let i = 0; i < L.n; i++) {
      const x = L.X[i] + eng.dx[i], y = L.Y[i] + eng.dy[i];
      if (Math.abs(x - cx) > R || Math.abs(y - cy) > R) continue;
      let al = eng.op[i], sc = 1;
      if (al <= 0.002) continue;
      if (animated) { const lk = tileLook(i, T); if (!lk) continue; al *= lk[0]; sc = lk[1]; }
      drawTile(i, al, sc, eng.cm[i], tileColor(i));
    }
    ctx.globalAlpha = 1;

    drawDecors(L.decFront, cam, shx, shy);
    // 공
    const ps = planetState(T);
    const pi = ps.i, a = ps.ang * D2R;
    const nxt = Math.min(L.n - 1, pi + 1);
    const pvx = L.X[pi] + eng.dx[pi], pvy = L.Y[pi] + eng.dy[pi];
    let ox = 0, oy = 0;
    if (!ps.last) {
      const span = L.T[pi + 1] - L.T[pi], p = span > 0 ? clamp((T - L.T[pi]) / span, 0, 1) : 1;
      ox = (eng.dx[nxt] - eng.dx[pi]) * p; oy = (eng.dy[nxt] - eng.dy[pi]) * p;
    }
    const mx = pvx + Math.cos(a) + ox, my = pvy + Math.sin(a) + oy;
    ctx.lineWidth = 0.025; ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.beginPath(); ctx.arc(pvx, pvy, 1, 0, Math.PI * 2); ctx.stroke();
    const pivotCol = pi % 2 === 0 ? RED : BLUE, moveCol = pi % 2 === 0 ? BLUE : RED;
    const planet = (x, y, c) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 0.42);
      g.addColorStop(0, c + "aa"); g.addColorStop(1, c + "00");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c; ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 0.045;
      ctx.beginPath(); ctx.arc(x, y, 0.17, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    };
    planet(pvx, pvy, pivotCol); planet(mx, my, moveCol);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    overlayFlash("Foreground", T, W, H);

    // 블룸 (근사)
    const kbl = lastLE(L.bloomEv, T, (b) => b.t);
    const bl = kbl >= 0 ? L.bloomStates[kbl] : null;
    if (bl && bl.on) {
      sctx.clearRect(0, 0, small.width, small.height);
      sctx.imageSmoothingEnabled = true;
      sctx.drawImage(cv, 0, 0, small.width, small.height);
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = clamp(bl.intensity / 100, 0, 2) * 0.55;
      ctx.drawImage(small, 0, 0, W, H);
      ctx.restore();
    }

    // 필터
    const kf = lastLE(L.filtEv, T, (f) => f.t);
    let fcss = "";
    if (kf >= 0) {
      const st = L.filtStates[kf];
      fcss = Object.keys(st).filter((k) => FILTER_CSS[k]).map((k) => FILTER_CSS[k](st[k])).join(" ");
    }
    if (fcss !== lastFilter) { cv.style.filter = fcss || "none"; lastFilter = fcss; }

    // 히트음
    if (ps.i !== lastIdx) {
      if (playing && hitOn && ps.i > lastIdx && ps.i - lastIdx < 4) for (let k = 0; k < Math.min(2, ps.i - lastIdx); k++) tick();
      lastIdx = ps.i;
    }
  }

  function tick() {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "square"; o.frequency.value = 1320;
      g.gain.setValueAtTime(0.12 * vol, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.06);
      o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.07);
    } catch (e) { /* 소리 실패는 무시 */ }
  }

  /* ---------- 재생 제어 ---------- */
  const el = {
    play: $("#c-play"), seek: $("#c-seek"), time: $("#c-time"), rate: $("#c-rate"), hit: $("#c-hit"), vol: $("#c-vol"), off: $("#c-off"),
    fs: $("#c-fs"), empty: $("#empty"), info: $("#info"), infoBody: $("#info-body"), infoBtn: $("#c-info"), title: $("#hud-title"), msg: $("#pmsg"),
  };
  const fmt = (s) => { const neg = s < 0; s = Math.abs(s); const m = Math.floor(s / 60), r = s - m * 60; return (neg ? "-" : "") + m + ":" + r.toFixed(2).padStart(5, "0"); };
  function say(t, bad) { el.msg.textContent = t || ""; el.msg.className = "pmsg" + (bad ? " bad" : ""); }

  function audioPos() { return T - offsetMs / 1000; }
  function syncAudio() {
    if (!audio) return;
    audio.playbackRate = clamp(pitch * rate, 0.0625, 16);
    audio.volume = vol;
    const ap = audioPos();
    if (!playing || ap < 0 || ap >= (audio.duration || Infinity)) { if (!audio.paused) audio.pause(); return; }
    if (audio.paused) { audio.currentTime = ap; audio.play().catch(() => {}); }
    else if (Math.abs(audio.currentTime - ap) > 0.12) audio.currentTime = ap;
  }
  function setPlaying(v) {
    if (!L) return;
    if (v && T >= L.end - 0.01) seekTo(-L.pre);
    playing = v; el.play.textContent = v ? "일시정지" : "재생"; el.play.setAttribute("aria-pressed", String(v));
    lastTs = 0; syncAudio();
  }
  function seekTo(t) {
    if (!L) return;
    T = clamp(t, -L.pre, L.end);
    eng.seek(T); lastIdx = tileIndexAt(L, T);
    if (audio) { audio.pause(); }
    syncAudio();
  }
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!L) return;
    if (playing) {
      if (lastTs) T += Math.min(0.1, (ts - lastTs) / 1000) * rate * pitch;
      lastTs = ts;
      if (T >= L.end) { T = L.end; setPlaying(false); }
      syncAudio();
    }
    render();
    el.time.textContent = fmt(Math.min(T, L.info.duration)) + " / " + fmt(L.info.duration);
    if (document.activeElement !== el.seek) el.seek.value = T;
  }

  /* ---------- 불러오기 ---------- */
  function loadMap(text, name) {
    let obj;
    try { obj = parseAdofai(text); } catch (e) { say("파일을 읽지 못했습니다. .adofai 파일이 맞는지 확인해 주세요.", true); return; }
    let lv;
    try { lv = buildLevel(obj); } catch (e) { say(e.message || "맵을 해석하지 못했습니다.", true); return; }
    L = lv; eng = new Engine(L); lastFilter = "x";
    pitch = clamp((Number(L.S.pitch) || 100) / 100, 0.1, 5);
    offsetMs = Number(L.S.offset) || 0; el.off.value = Math.round(offsetMs);
    el.seek.min = -L.pre; el.seek.max = L.end; el.seek.step = 0.01;
    T = -L.pre; eng.seek(T); lastIdx = 0; playing = false; el.play.textContent = "재생";
    el.empty.classList.add("hidden");
    ["c-play", "c-seek", "c-rate", "c-hit", "c-vol", "c-off", "c-info", "c-fs"].forEach((id) => ($("#" + id).disabled = false));
    const title = [L.S.artist, L.S.song].filter(Boolean).join(" - ") || name;
    el.title.textContent = title; document.title = title + " · 맵 테스트";
    infoArgs = [L, obj, name]; renderInfo(L, obj, name);
    say(`불러왔습니다 · 타일 ${L.n.toLocaleString()}개. 음악 파일을 같이 불러오면 소리가 재생됩니다.`);
  }
  function renderInfo(Lv, obj, name) {
    const I = Lv.info, S = Lv.S, esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const rows = [["곡", S.song], ["아티스트", S.artist], ["제작자", S.author], ["파일", name], ["타일 수", I.tiles.toLocaleString()],
      ["BPM", I.bpmMin === I.bpmMax ? I.bpmMin.toFixed(1) : `${I.bpmMin.toFixed(1)} ~ ${I.bpmMax.toFixed(1)}`], ["길이", fmt(I.duration)], ["오프셋", (Number(S.offset) || 0) + " ms"], ["피치", (Number(S.pitch) || 100) + "%"]];
    let h = rows.filter((r) => r[1] !== undefined && r[1] !== "").map((r) => `<div class="irow"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join("");
    const list = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<code>${esc(k)}<i>${v}</i></code>`).join("");
    h += `<h3>적용되는 이벤트</h3><div class="chips">${list(I.supported) || "<em>없음</em>"}</div>`;
    const un = list(I.unsupported);
    h += `<h3>적용되지 않는 이벤트</h3><div class="chips off">${un || "<em>없음</em>"}</div>`;
    if (I.images.length) {
      const miss = I.images.filter((n) => !assets.has(normKey(n)) && !assets.has(normKey(n).split("/").pop()));
      h += miss.length ? `<p class="note">이미지 ${miss.length}/${I.images.length}개가 없어 표시되지 않습니다. 맵 폴더째로 불러와 주세요.<br>${miss.slice(0, 6).map(esc).join(", ")}${miss.length > 6 ? " …" : ""}</p>` : `<p class="note">이미지 ${I.images.length}개 모두 불러왔습니다.</p>`;
    }
    if (I.unsupportedFilters.length) h += `<p class="note">미적용 필터: ${I.unsupportedFilters.map(esc).join(", ")}</p>`;
    el.infoBody.innerHTML = h;
  }
  function loadAudio(file) {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    if (audio) audio.pause();
    audioUrl = URL.createObjectURL(file);
    audio = new Audio(audioUrl); audio.preload = "auto";
    audio.addEventListener("error", () => { say("이 음악 파일은 브라우저에서 재생할 수 없습니다. (mp3 / ogg / wav 권장)", true); audio = null; });
    say("음악을 불러왔습니다: " + file.name);
    syncAudio();
  }
  const isAudio = (f) => /^audio\//.test(f.type) || /\.(mp3|ogg|wav|m4a|flac|aac|opus|oga)$/i.test(f.name);
  const isImage = (f) => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name);
  const isMap = (f) => /\.(adofai|json|txt)$/i.test(f.name);
  function takeFiles(list) {
    const files = [...list];
    const imgs = files.filter(isImage), audios = files.filter(isAudio), maps = files.filter((f) => /\.adofai$/i.test(f.name) || (isMap(f) && files.length === 1));
    imgs.forEach(addAsset);
    if (imgs.length) say(`이미지 ${imgs.length}개를 불러왔습니다.`);
    if (audios.length) loadAudio(audios.sort((a, b) => b.size - a.size)[0]);
    if (maps.length) {
      const pick = maps.find((f) => /main\.adofai$/i.test(f.name)) || maps[0];
      if (pick.size > 60 * 1024 * 1024) { say("파일이 너무 큽니다 (60MB 이하).", true); return; }
      pick.text().then((t) => { loadMap(t, pick.name); if (imgs.length) say(`불러왔습니다 · 타일 ${L ? L.n.toLocaleString() : 0}개 · 이미지 ${imgs.length}개` + (maps.length > 1 ? ` · .adofai ${maps.length}개 중 ${pick.name} 선택` : "")); });
    } else if (infoArgs) renderInfo(...infoArgs);
    if (!imgs.length && !audios.length && !maps.length) say("지원하지 않는 파일입니다.", true);
  }
  async function walkEntries(entries) {
    const out = [];
    async function walk(en, path) {
      if (en.isFile) await new Promise((res) => en.file((f) => { try { Object.defineProperty(f, "webkitRelativePath", { value: path + f.name }); } catch (e) { /* 무시 */ } out.push(f); res(); }, () => res()));
      else if (en.isDirectory) {
        const rd = en.createReader(); let batch;
        do { batch = await new Promise((res) => rd.readEntries(res, () => res([]))); for (const c of batch) await walk(c, path + en.name + "/"); } while (batch.length);
      }
    }
    for (const en of entries) await walk(en, "");
    return out;
  }

  /* ---------- 이벤트 연결 ---------- */
  $("#f-map").addEventListener("change", (e) => { takeFiles(e.target.files); e.target.value = ""; });
  $("#f-dir").addEventListener("change", (e) => { takeFiles(e.target.files); e.target.value = ""; });
  $("#f-audio").addEventListener("change", (e) => { takeFiles(e.target.files); e.target.value = ""; });
  ["dragover", "dragenter"].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "drop" || e.target === document.documentElement || !e.relatedTarget) document.body.classList.remove("drag"); }));
  window.addEventListener("drop", (e) => {
    const dt = e.dataTransfer; if (!dt) return;
    const ents = dt.items ? [...dt.items].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean) : [];
    if (ents.some((x) => x.isDirectory)) { say("폴더를 읽는 중…"); walkEntries(ents).then(takeFiles); }
    else if (dt.files.length) takeFiles(dt.files);
  });
  el.play.addEventListener("click", () => setPlaying(!playing));
  el.seek.addEventListener("input", () => seekTo(Number(el.seek.value)));
  el.rate.addEventListener("change", () => { rate = Number(el.rate.value) || 1; syncAudio(); });
  el.hit.addEventListener("change", () => { hitOn = el.hit.checked; });
  el.vol.addEventListener("input", () => { vol = Number(el.vol.value); syncAudio(); });
  el.off.addEventListener("change", () => { offsetMs = Number(el.off.value) || 0; if (audio) audio.pause(); syncAudio(); });
  el.infoBtn.addEventListener("click", () => el.info.classList.toggle("hidden"));
  $("#info-close").addEventListener("click", () => el.info.classList.add("hidden"));
  el.fs.addEventListener("click", () => {
    const st = $("#stage");
    if (document.fullscreenElement) document.exitFullscreen(); else if (st.requestFullscreen) st.requestFullscreen();
  });
  window.addEventListener("keydown", (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== "range") return;
    if (!L) return;
    if (e.code === "Space") { e.preventDefault(); setPlaying(!playing); }
    else if (e.code === "ArrowLeft") { e.preventDefault(); seekTo(T - (e.shiftKey ? 1 : 5)); }
    else if (e.code === "ArrowRight") { e.preventDefault(); seekTo(T + (e.shiftKey ? 1 : 5)); }
    else if (e.code === "Home") seekTo(-L.pre);
  });
  el.vol.value = vol;
  window.addEventListener("resize", resize);
  requestAnimationFrame(loop);

  // 테스트/디버그용 훅
  window.__player = { get T() { return T; }, seek: seekTo, play: setPlaying, get level() { return L; }, loadMap };
})();
