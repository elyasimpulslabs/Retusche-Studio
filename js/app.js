/* Retusche Studio. © 2026 Elyas Saciri (Ervin Saciri). Alle Rechte vorbehalten. */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const RAW_EXT = new Set(["dng", "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "raf", "orf", "rw2", "pef", "srw", "3fr", "iiq", "erf", "raw", "rwl", "mos", "kdc", "dcr", "x3f"]);
const CANVAS_MAX = 16000000;
const SR_MAX = 12500000;

/* ---------- Zustand ---------- */
const DEF = { strokes: [], restores: [], blemFade: 100, blemish: 0, marks: 0, skin: 0, tone: 0, eyes: 0, teeth: 0, sharpen: 0, denoise: 0, detail: 0, exposure: 0, contrast: 0, warmth: 0, spots: [] };
const AUTO = { blemish: 70, marks: 70, skin: 50, tone: 65, eyes: 20, teeth: 45, sharpen: 20 };
let P = clone(DEF);
let hist = [], hi = -1;
let img = null; // {name, w, h, pw, ph, noise, raw}
let faces = [], analyzed = false, spotCount = 0, markCount = 0, hasTeeth = false;
let tool = "auto", blemMode = "auto", enhMode = "denoise", autoAmt = 70;
let brushSize = 44, paintStroke = null, healMode = "heal", visSpots = false, srcOffs = [];
let showMask = false, split = false, splitX = 0.5, holdBefore = false;
const SR = { on: false, amt: 100 };
const exp = { maxEdge: 0, quality: 95 };
function clone(o) { return JSON.parse(JSON.stringify(o)); }

/* ---------- Worker ---------- */
const W = new Worker(new URL("./worker.js?v=7", import.meta.url), { type: "module" });
let rendering = false, dirty = false, version = 0, regionTimer = 0, regionBusy = false;
let afterCanvas = document.createElement("canvas"), beforeCanvas = document.createElement("canvas");
let region = null;
let pending = {};
const waitFor = (type) => new Promise((res, rej) => { pending[type] = { res, rej }; });

W.onmessage = (ev) => {
  const m = ev.data;
  switch (m.type) {
    case "loaded": onLoaded(m); break;
    case "progress": setBusy(m.label, m.p); break;
    case "analyzed": hasTeeth = m.teeth; resolve("analyzed", m); break;
    case "count": spotCount = m.count; markCount = m.marks || 0; updateBadges(); updateMeta(); break;
    case "rendered": {
      putRGBA(afterCanvas, m.rgba, m.w, m.h);
      rendering = false;
      if (paintStroke && paintStroke.done) paintStroke = null;
      draw();
      if (dirty) sendRender(); else scheduleRegion();
      break;
    }
    case "region": {
      regionBusy = false;
      if (m.id === version) {
        const a = document.createElement("canvas"), b = document.createElement("canvas");
        putRGBA(a, m.rgba, m.w, m.h); putRGBA(b, m.before, m.w, m.h);
        region = { v: m.id, mask: showMask, vis: visSpots, rect: m.rect, after: a, before: b };
        draw();
      } else scheduleRegion();
      break;
    }
    case "spots": {
      if (JSON.stringify(m.spots) !== JSON.stringify(P.spots)) { P.spots = m.spots; commit(); requestRender(); }
      const t = { added: "Stelle wird entfernt", already: "Diese Stelle wird bereits entfernt", kept: "Stelle bleibt erhalten", alreadyKept: "Diese Stelle bleibt schon erhalten", unmarked: "Deine Markierung aufgehoben", restored: "Stelle wird wieder entfernt", nothing: "Hier wurde nichts erkannt" }[m.action];
      if (t) toast(t);
      break;
    }
    case "patchinfo": srcOffs = m.offs; draw(); break;
    case "srInput": resolve("srInput", m); break;
    case "exported": resolve("exported", m); break;
    case "crop": resolve("crop", m); break;
    case "error": {
      console.error(m);
      rendering = false; regionBusy = false;
      reject(m.message);
      if (!Object.keys(pending).length) toast("Fehler: " + m.message, true);
      break;
    }
  }
};
function resolve(t, m) { const p = pending[t]; if (p) { delete pending[t]; p.res(m); } }
function reject(msg) { for (const k of Object.keys(pending)) { const p = pending[k]; delete pending[k]; p.rej(new Error(msg)); } }

function putRGBA(c, rgba, w, h) {
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer || rgba), w, h), 0, 0);
}

function requestRender() {
  version++;
  region = region && region.v === version ? region : null;
  if (!img || !analyzed) return;
  if (rendering) { dirty = true; return; }
  sendRender();
}
function sendRender() {
  rendering = true; dirty = false;
  W.postMessage({ type: "render", P, mask: showMask, vis: visSpots, id: version });
}

/* ---------- Ansicht ---------- */
const cv = $("view"), ctx = cv.getContext("2d");
let cssW = 0, cssH = 0, dpr = 1;
const view = { s: 1, tx: 0, ty: 0, fit: 1 };
/* Vollbild auf dem iPhone (Home Bildschirm App): iOS rechnet die Höhe sonst um die Statusleiste zu kurz */
const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
if (standalone) document.documentElement.classList.add("standalone");
function fixHeight() {
  if (!standalone) return;
  const portrait = innerHeight >= innerWidth;
  const sh = portrait ? Math.max(screen.height, screen.width) : Math.min(screen.height, screen.width);
  document.documentElement.style.setProperty("--app-h", Math.max(innerHeight, sh) + "px");
}
fixHeight();
addEventListener("resize", fixHeight);
addEventListener("orientationchange", () => setTimeout(fixHeight, 300));
function resize() {
  const r = $("stage").getBoundingClientRect();
  dpr = Math.min(3, window.devicePixelRatio || 1);
  cssW = r.width; cssH = r.height;
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  if (img) { const wasFit = Math.abs(view.s - view.fit) < 1e-6; computeFit(); if (wasFit) fitView(); else clampView(); }
  draw();
}
function computeFit() { view.fit = Math.min((cssW - 16) / img.w, (cssH - 16) / img.h); }
function fitView() { view.s = view.fit; view.tx = (cssW - img.w * view.s) / 2; view.ty = (cssH - img.h * view.s) / 2; }
function clampView() {
  const w = img.w * view.s, h = img.h * view.s;
  view.tx = w <= cssW ? (cssW - w) / 2 : clamp(view.tx, cssW - w, 0);
  view.ty = h <= cssH ? (cssH - h) / 2 : clamp(view.ty, cssH - h, 0);
}
function zoomAt(ns, cx, cy) {
  ns = clamp(ns, view.fit * 0.8, Math.max(view.fit * 2, 3 / dpr));
  const fx = (cx - view.tx) / view.s, fy = (cy - view.ty) / view.s;
  view.s = ns; view.tx = cx - fx * ns; view.ty = cy - fy * ns;
  clampView();
}
function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  $("lblBefore").hidden = $("lblAfter").hidden = !(img && split);
  if (!img || !afterCanvas.width) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  const dx = view.tx, dy = view.ty, dw = img.w * view.s, dh = img.h * view.s;
  const hasRegion = region && region.v === version && region.mask === showMask && region.vis === visSpots;
  const side = (before) => {
    ctx.drawImage(before ? beforeCanvas : afterCanvas, dx, dy, dw, dh);
    if (hasRegion) {
      const r = region.rect;
      ctx.imageSmoothingEnabled = view.s * dpr < 1.5;
      ctx.drawImage(before ? region.before : region.after, dx + r.x * view.s, dy + r.y * view.s, r.w * view.s, r.h * view.s);
      ctx.imageSmoothingEnabled = true;
    }
  };
  if (holdBefore) side(true);
  else if (split) {
    const sx = splitX * cssW;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, sx, cssH); ctx.clip(); side(true); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(sx, 0, cssW - sx, cssH); ctx.clip(); side(false); ctx.restore();
    ctx.fillStyle = "#fff"; ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 8;
    ctx.fillRect(sx - 1, 0, 2, cssH);
    ctx.beginPath(); ctx.arc(sx, cssH / 2, 17, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.strokeStyle = "#111"; ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(sx - 4, cssH / 2 - 5); ctx.lineTo(sx - 9, cssH / 2); ctx.lineTo(sx - 4, cssH / 2 + 5);
    ctx.moveTo(sx + 4, cssH / 2 - 5); ctx.lineTo(sx + 9, cssH / 2); ctx.lineTo(sx + 4, cssH / 2 + 5); ctx.stroke();
    $("lblBefore").style.left = "12px"; $("lblAfter").style.right = "12px";
  } else side(false);
  // Quelle des letzten Strichs (verschiebbar)
  const si = P.strokes.length - 1;
  if (tool === "heal" && !holdBefore && si >= 0 && srcOffs[si] && !(paintStroke && !paintStroke.done)) {
    const st = P.strokes[si], off = st.off || srcOffs[si];
    ctx.save();
    ctx.lineCap = ctx.lineJoin = "round";
    const path = (ox, oy) => { ctx.beginPath(); const p0 = st.pts[0]; ctx.moveTo(dx + (p0[0] + ox) * view.s, dy + (p0[1] + oy) * view.s); for (const p of st.pts) ctx.lineTo(dx + (p[0] + ox) * view.s, dy + (p[1] + oy) * view.s); if (st.pts.length === 1) ctx.lineTo(dx + (p0[0] + ox) * view.s + 0.01, dy + (p0[1] + oy) * view.s); };
    ctx.lineWidth = st.r * 2 * view.s + 3; ctx.strokeStyle = "rgba(255,255,255,0.9)"; path(off[0], off[1]); ctx.stroke();
    ctx.lineWidth = st.r * 2 * view.s - 1; ctx.strokeStyle = "rgba(20,20,24,0.35)"; path(off[0], off[1]); ctx.stroke();
    const c = srcCenter(st, off);
    ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath(); ctx.moveTo(dx + c[2] * view.s, dy + c[3] * view.s); ctx.lineTo(dx + c[0] * view.s, dy + c[1] * view.s); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(dx + c[0] * view.s, dy + c[1] * view.s, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  if (paintStroke) {
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = paintStroke.restore ? "rgba(70,220,120,0.5)" : "rgba(255,58,58,0.5)";
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.lineWidth = paintStroke.r * 2 * view.s;
    const p0 = paintStroke.pts[0];
    if (paintStroke.pts.length === 1) { ctx.beginPath(); ctx.arc(dx + p0[0] * view.s, dy + p0[1] * view.s, paintStroke.r * view.s, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(dx + p0[0] * view.s, dy + p0[1] * view.s); for (const p of paintStroke.pts) ctx.lineTo(dx + p[0] * view.s, dy + p[1] * view.s); ctx.stroke(); }
    ctx.restore();
  }
}
function srcCenter(st, off) {
  let x = 0, y = 0; for (const p of st.pts) { x += p[0]; y += p[1]; }
  x /= st.pts.length; y /= st.pts.length;
  return [x + off[0], y + off[1], x, y];
}
function scheduleRegion() {
  clearTimeout(regionTimer);
  if (!img || !analyzed) return;
  const devPerFull = view.s * dpr, prevPerFull = img.pw / img.w;
  if (devPerFull < prevPerFull * 1.25) { if (region) { region = null; } return; }
  regionTimer = setTimeout(() => {
    if (rendering || regionBusy) { scheduleRegion(); return; }
    const x0 = clamp(Math.floor(-view.tx / view.s), 0, img.w), y0 = clamp(Math.floor(-view.ty / view.s), 0, img.h);
    const x1 = clamp(Math.ceil((cssW - view.tx) / view.s), 0, img.w), y1 = clamp(Math.ceil((cssH - view.ty) / view.s), 0, img.h);
    if (x1 - x0 < 4 || y1 - y0 < 4) return;
    if (region && region.v === version && region.mask === showMask && region.vis === visSpots) {
      const r = region.rect;
      if (r.x <= x0 + 1 && r.y <= y0 + 1 && r.x + r.w >= x1 - 1 && r.y + r.h >= y1 - 1 && r.w / region.after.width <= 1 / devPerFull * 1.3 + 0.01) return;
    }
    regionBusy = true;
    W.postMessage({ type: "region", P, mask: showMask, vis: visSpots, id: version, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, maxOut: Math.min(2400, Math.max(cv.width, cv.height)) });
  }, 220);
}

/* Gesten */
const ptrs = new Map();
let gest = null, lastTap = { t: 0, x: 0, y: 0 };
cv.addEventListener("pointerdown", (e) => {
  if (!img) return;
  cv.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (ptrs.size === 1 && tool === "heal" && !(split && Math.abs(e.offsetX - splitX * cssW) < 26)) {
    const fx = (e.offsetX - view.tx) / view.s, fy = (e.offsetY - view.ty) / view.s;
    const si = P.strokes.length - 1;
    if (si >= 0 && srcOffs[si] && healMode !== "restore") {
      const st = P.strokes[si], off = st.off || srcOffs[si], c = srcCenter(st, off);
      if (Math.hypot((c[0] - fx) * view.s, (c[1] - fy) * view.s) < Math.max(28, st.r * view.s)) {
        gest = { type: "src", x0: e.offsetX, y0: e.offsetY, off0: off.slice() }; return;
      }
    }
    paintStroke = { r: brushSize / 2 / view.s, pts: [[fx, fy]], restore: healMode === "restore" };
    gest = { type: "paint" };
    draw();
    return;
  }
  if (ptrs.size === 1) {
    const nearKnob = split && Math.abs(e.offsetX - splitX * cssW) < 26;
    gest = { type: nearKnob ? "split" : "tap", x0: e.offsetX, y0: e.offsetY, t0: performance.now(), tx: view.tx, ty: view.ty };
  } else if (ptrs.size === 2) {
    if (gest && gest.type === "paint") { paintStroke = null; }
    const [a, b] = [...ptrs.values()];
    gest = { type: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), s0: view.s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, tx: view.tx, ty: view.ty };
  }
});
cv.addEventListener("pointermove", (e) => {
  if (!ptrs.has(e.pointerId) || !gest) return;
  ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (gest.type === "src") {
    const si = P.strokes.length - 1, st = Object.assign({}, P.strokes[si]);
    st.off = [Math.round(gest.off0[0] + (e.offsetX - gest.x0) / view.s), Math.round(gest.off0[1] + (e.offsetY - gest.y0) / view.s)];
    P.strokes = P.strokes.slice(0, si).concat([st]); srcOffs[si] = st.off; draw();
    return;
  }
  if (gest.type === "paint" && paintStroke) {
    const fx = (e.offsetX - view.tx) / view.s, fy = (e.offsetY - view.ty) / view.s, l = paintStroke.pts[paintStroke.pts.length - 1];
    if (Math.hypot(fx - l[0], fy - l[1]) > paintStroke.r * 0.3) { paintStroke.pts.push([fx, fy]); draw(); }
    return;
  }
  if (gest.type === "split") { splitX = clamp(e.offsetX / cssW, 0.02, 0.98); draw(); return; }
  if (gest.type === "tap" && Math.hypot(e.offsetX - gest.x0, e.offsetY - gest.y0) > 8) gest.type = "pan";
  if (gest.type === "pan") { view.tx = gest.tx + e.offsetX - gest.x0; view.ty = gest.ty + e.offsetY - gest.y0; clampView(); draw(); }
  if (gest.type === "pinch" && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const ns = clamp(gest.s0 * d / gest.d0, view.fit * 0.8, Math.max(view.fit * 2, 3 / dpr));
    const fx = (gest.mx - gest.tx) / gest.s0, fy = (gest.my - gest.ty) / gest.s0;
    view.s = ns; view.tx = mx - fx * ns; view.ty = my - fy * ns; clampView(); draw();
  }
});
const endPtr = (e) => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (gest && gest.type === "src" && ptrs.size === 0) { gest = null; commit(); requestRender(); return; }
  if (gest && gest.type === "paint" && ptrs.size === 0) {
    if (paintStroke) {
      const st = { r: Math.round(paintStroke.r * 10) / 10, pts: paintStroke.pts.map(([x, y]) => [Math.round(x), Math.round(y)]) };
      if (healMode === "clone") st.mode = "clone";
      paintStroke.done = true;
      if (paintStroke.restore) P.restores = [...P.restores, st]; else P.strokes = [...P.strokes, st];
      commit(); requestRender(); updateToolDots();
      if (tool === "heal") renderPanel();
    }
    gest = null; return;
  }
  if (gest && gest.type === "tap" && ptrs.size === 0 && performance.now() - gest.t0 < 400) onTap(gest.x0, gest.y0);
  if (ptrs.size === 0) { gest = null; scheduleRegion(); }
  else if (gest && gest.type === "pinch") gest = null;
};
cv.addEventListener("pointerup", endPtr);
cv.addEventListener("pointercancel", endPtr);
cv.addEventListener("wheel", (e) => { if (!img) return; e.preventDefault(); zoomAt(view.s * Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); draw(); scheduleRegion(); }, { passive: false });
function onTap(x, y) {
  const fx = (x - view.tx) / view.s, fy = (y - view.ty) / view.s;
  if (tool === "blem" && (blemMode === "tap" || blemMode === "keep")) {
    if (fx < 0 || fy < 0 || fx > img.w || fy > img.h) return;
    if (!faces.length) { toast("Kein Gesicht erkannt"); return; }
    W.postMessage({ type: "tap", x: fx, y: fy, spots: P.spots, mode: blemMode === "keep" ? "keep" : "add" });
    return;
  }
  const now = performance.now();
  if (now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
    if (view.s > view.fit * 1.05) fitView(); else zoomAt(Math.max(1 / dpr, view.fit * 2.5), x, y);
    draw(); scheduleRegion(); lastTap.t = 0; return;
  }
  lastTap = { t: now, x, y };
}

/* ---------- Hinweise, Arbeitsanzeige ---------- */
let toastT = 0;
function toast(msg, err) {
  const t = $("toast"); t.textContent = msg; t.className = "toast show" + (err ? " err" : "");
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = "toast"), 2600);
}
let cancelFlag = false;
function showBusy(label, sub, cancelable) {
  $("busy").hidden = false; $("busyLabel").textContent = label; $("busySub").textContent = sub || "";
  $("busyBar").style.width = "0%"; $("busyCancel").hidden = !cancelable; cancelFlag = false;
  $("busy").querySelector(".spin").hidden = false;
  $("busy").querySelectorAll(".done-box").forEach((x) => x.remove());
}
function setBusy(label, p) { if ($("busy").hidden) return; if (label) $("busyLabel").textContent = label; if (p != null) $("busyBar").style.width = Math.round(clamp(p, 0, 1) * 100) + "%"; }
function hideBusy() { $("busy").hidden = true; }
$("busyCancel").onclick = () => { cancelFlag = true; $("busySub").textContent = "Wird abgebrochen …"; };

/* ---------- Datei öffnen ---------- */
$("btnOpen").onclick = $("btnOpenBig").onclick = () => $("file").click();
$("file").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) openFile(f).catch((err) => { console.error(err); hideBusy(); toast(err.message || "Foto konnte nicht geöffnet werden", true); }); };

function u16(b, o, le) { return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]; }
function u32(b, o, le) { return le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216 : b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]); }
function tiffOrientation(b, base) {
  if (base + 8 > b.length) return 1;
  const le = b[base] === 0x49 && b[base + 1] === 0x49;
  if (!le && !(b[base] === 0x4d && b[base + 1] === 0x4d)) return 1;
  const ifd = base + u32(b, base + 4, le);
  if (ifd + 2 > b.length) return 1;
  const n = u16(b, ifd, le);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > b.length) break;
    if (u16(b, e, le) === 0x0112) return u16(b, e + 8, le) || 1;
  }
  return 1;
}
function jpegInfo(b, start = 0) {
  if (b[start] !== 0xff || b[start + 1] !== 0xd8) return null;
  let o = start + 2, w = 0, h = 0, orient = 1;
  while (o + 4 < b.length) {
    if (b[o] !== 0xff) { o++; continue; }
    const mk = b[o + 1];
    if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { o += 2; continue; }
    if (mk === 0xd9 || mk === 0xda) break;
    const len = u16(b, o + 2, false);
    if (mk === 0xe1 && b[o + 4] === 0x45 && b[o + 5] === 0x78) orient = tiffOrientation(b, o + 10);
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) { h = u16(b, o + 5, false); w = u16(b, o + 7, false); break; }
    o += 2 + len;
  }
  return w && h ? { w, h, orient } : null;
}
async function decodeViaImage(blob, limit) {
  const url = URL.createObjectURL(blob);
  try {
    const im = new Image(); im.src = url; await im.decode();
    let w = im.naturalWidth, h = im.naturalHeight;
    const f = Math.min(1, Math.sqrt(limit / (w * h)));
    const cw = Math.round(w * f), ch = Math.round(h * f);
    const c = document.createElement("canvas"); c.width = cw; c.height = ch;
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(im, 0, 0, cw, ch);
    const d = x.getImageData(0, 0, cw, ch).data, rgb = new Uint8Array(cw * ch * 3);
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { rgb[j] = d[i]; rgb[j + 1] = d[i + 1]; rgb[j + 2] = d[i + 2]; }
    c.width = c.height = 1;
    return { w: cw, h: ch, data: rgb, reduced: f < 1, ow: w, oh: h };
  } finally { URL.revokeObjectURL(url); }
}
async function decodeRaw(bytes) {
  const { default: LibRaw } = await import("../lib/libraw/index.js");
  const raw = new LibRaw();
  try {
    const t = setTimeout(() => raw.dispose(), 180000);
    await raw.open(bytes.slice(), { useCameraWb: true, outputBps: 8, userQual: 3, outputColor: 1, highlight: 0 });
    setBusy("RAW wird entwickelt", 0.55);
    const meta = await raw.metadata().catch(() => ({}));
    const d = await raw.imageData();
    clearTimeout(t);
    if (!d || !d.width || d.colors !== 3) throw new Error("RAW Format nicht lesbar");
    let data = d.data;
    if (data.byteOffset || data.length !== d.width * d.height * 3) data = data.slice(0, d.width * d.height * 3);
    return { w: d.width, h: d.height, data, cam: ((meta.camera_make || "") + " " + (meta.camera_model || "")).trim() };
  } finally { try { raw.dispose(); } catch (e) { /* egal */ } }
}
function embeddedJpeg(b) {
  let best = null;
  for (let i = 0, tries = 0; i < b.length - 3 && tries < 60; i++) {
    if (b[i] === 0xff && b[i + 1] === 0xd8 && b[i + 2] === 0xff) {
      tries++;
      const inf = jpegInfo(b, i);
      if (inf && (!best || inf.w * inf.h > best.w * best.h)) best = Object.assign({ off: i }, inf);
      if (inf) i += 1000;
    }
  }
  return best;
}

/* EXIF aus JPEG übernehmen, damit Lightroom Aufnahmedatum und Kamera kennt. Ausrichtung wird auf 1 gesetzt, weil sie schon angewendet ist. */
function extractExif(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  while (o + 4 < b.length && b[o] === 0xff) {
    const mk = b[o + 1], len = u16(b, o + 2, false);
    if (mk === 0xda) break;
    if (mk === 0xe1 && b[o + 4] === 0x45 && b[o + 5] === 0x78 && b[o + 6] === 0x69 && b[o + 7] === 0x66) {
      const seg = b.slice(o, o + 2 + len), base = 10, le = seg[base] === 0x49;
      try {
        const ifd = base + u32(seg, base + 4, le), cnt = u16(seg, ifd, le);
        for (let i = 0; i < cnt; i++) {
          const e = ifd + 2 + i * 12;
          if (u16(seg, e, le) === 0x0112) { if (le) { seg[e + 8] = 1; seg[e + 9] = 0; } else { seg[e + 8] = 0; seg[e + 9] = 1; } }
        }
      } catch (err) { /* EXIF unlesbar, trotzdem übernehmen */ }
      return seg;
    }
    o += 2 + len;
  }
  return null;
}
async function withExif(blob) {
  if (!img || !img.exif) return blob;
  const b = new Uint8Array(await blob.arrayBuffer());
  if (b[0] !== 0xff || b[1] !== 0xd8) return blob;
  let o = 2;
  if (b[2] === 0xff && b[3] === 0xe0) o = 4 + u16(b, 4, false); // JFIF Kopf ersetzen
  return new Blob([b.subarray(0, 2), img.exif, b.subarray(o)], { type: "image/jpeg" });
}

async function openFile(file) {
  showBusy("Foto wird geladen", file.name);
  analyzed = false; faces = []; region = null; spotCount = 0;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  let note = "";
  const meta = { name: file.name.replace(/\.[^.]+$/, ""), raw: false, exif: isJpeg ? extractExif(bytes) : null };
  const loaded = waitFor("loaded");
  if (RAW_EXT.has(ext) || (!isJpeg && !file.type.startsWith("image/") && ext !== "heic" && ext !== "heif")) {
    meta.raw = true;
    setBusy("RAW wird entwickelt", 0.1);
    $("busySub").textContent = "Das kann ein paar Sekunden dauern";
    let rgb = null;
    try { rgb = await decodeRaw(bytes); }
    catch (e) {
      console.warn("LibRaw", e);
      const emb = embeddedJpeg(bytes);
      if (!emb) throw new Error("Dieses RAW Format kann nicht gelesen werden");
      const orient = tiffOrientation(bytes, 0);
      note = "Kamera Vorschau aus der RAW Datei verwendet";
      const sub = bytes.slice(emb.off);
      if (emb.w * emb.h > CANVAS_MAX || orient !== 1) {
        W.postMessage({ type: "jpeg", bytes: sub.buffer, orientation: orient }, [sub.buffer]);
      } else { rgb = await decodeViaImage(new Blob([sub], { type: "image/jpeg" }), CANVAS_MAX); }
    }
    if (rgb) { meta.cam = rgb.cam; W.postMessage({ type: "image", w: rgb.w, h: rgb.h, data: rgb.data.buffer }, [rgb.data.buffer]); }
  } else if (isJpeg) {
    const inf = jpegInfo(bytes);
    if (inf && inf.w * inf.h > CANVAS_MAX) {
      W.postMessage({ type: "jpeg", bytes: bytes.buffer, orientation: inf.orient }, [bytes.buffer]);
    } else {
      const rgb = await decodeViaImage(file, CANVAS_MAX);
      W.postMessage({ type: "image", w: rgb.w, h: rgb.h, data: rgb.data.buffer }, [rgb.data.buffer]);
    }
  } else {
    const rgb = await decodeViaImage(file, CANVAS_MAX);
    if (rgb.reduced) note = "Sehr großes Bild, auf 16 MP verkleinert";
    W.postMessage({ type: "image", w: rgb.w, h: rgb.h, data: rgb.data.buffer }, [rgb.data.buffer]);
  }
  const m = await loaded;
  img = Object.assign(meta, { w: m.w, h: m.h, pw: m.pw, ph: m.ph, noise: m.noise });
  putRGBA(beforeCanvas, m.rgba, m.pw, m.ph);
  putRGBA(afterCanvas, m.rgba, m.pw, m.ph);
  $("empty").hidden = true; $("dock").hidden = false; $("stageTools").hidden = false; $("badges").hidden = false;
  $("btnSave").disabled = false;
  const mp = (img.w * img.h / 1e6).toFixed(1).replace(".", ",");
  $("fileInfo").textContent = `${file.name} · ${img.w}×${img.h} · ${mp} MP${meta.cam ? " · " + meta.cam : ""}`;
  resize(); computeFit(); fitView(); draw();
  // Gesichter
  setBusy("Gesichter werden erkannt", 0.15);
  $("busySub").textContent = "";
  try {
    const fa = await loadFaceApi();
    const res = await fa.detectAllFaces(beforeCanvas, new fa.SsdMobilenetv1Options({ minConfidence: 0.42, maxResults: 12 })).withFaceLandmarks();
    const k = img.w / img.pw;
    faces = res.map((r) => r.landmarks.positions.map((p) => [p.x * k, p.y * k]))
      .filter((lm) => Math.hypot(lm[16][0] - lm[0][0], lm[16][1] - lm[0][1]) > 40)
      .sort((a, b) => Math.hypot(b[16][0] - b[0][0], b[16][1] - b[0][1]) - Math.hypot(a[16][0] - a[0][0], a[16][1] - a[0][1]));
  } catch (e) { console.error(e); note = "Gesichtserkennung nicht verfügbar"; faces = []; }
  const an = waitFor("analyzed");
  W.postMessage({ type: "faces", faces });
  await an;
  analyzed = true;
  hideBusy();
  P = clone(DEF); hist = []; hi = -1;
  if (faces.length) applyAuto(autoAmt, false);
  commit();
  requestRender();
  selectTool("auto");
  updateBadges();
  if (note) toast(note);
  else if (!faces.length) toast("Kein Gesicht erkannt. Licht, Schärfe und Verbessern funktionieren trotzdem.");
  else toast(`Auto Retusche angewendet · ${faces.length === 1 ? "1 Gesicht" : faces.length + " Gesichter"}`);
}
function onLoaded(m) { resolve("loaded", m); }

let faMod = null;
async function loadFaceApi() {
  if (faMod) return faMod;
  const fa = await import("../lib/face-api/face-api.esm.js");
  try { await fa.tf.setBackend("webgl"); } catch (e) { await fa.tf.setBackend("cpu"); }
  await fa.tf.ready();
  await fa.nets.ssdMobilenetv1.loadFromUri("models/face");
  await fa.nets.faceLandmark68Net.loadFromUri("models/face");
  faMod = fa;
  return fa;
}

/* ---------- Verlauf ---------- */
function commit() {
  const snap = JSON.stringify(P);
  if (hi >= 0 && hist[hi] === snap) return;
  hist = hist.slice(0, hi + 1); hist.push(snap); hi = hist.length - 1;
  if (hist.length > 80) { hist.shift(); hi--; }
  updateHistory();
}
function updateHistory() { $("btnUndo").disabled = hi <= 0; $("btnRedo").disabled = hi >= hist.length - 1; }
function restore(i) { hi = i; P = JSON.parse(hist[hi]); updateHistory(); requestRender(); renderPanel(); updateToolDots(); }
$("btnUndo").onclick = () => { if (hi > 0) restore(hi - 1); };
$("btnRedo").onclick = () => { if (hi < hist.length - 1) restore(hi + 1); };

function applyAuto(amt, doCommit = true) {
  const f = amt / 70;
  for (const k of Object.keys(AUTO)) P[k] = Math.round(clamp(AUTO[k] * f, 0, 100));
  if (!hasTeeth) P.teeth = Math.round(clamp(AUTO.teeth * f, 0, 100));
  if (doCommit) commit();
  updateToolDots();
}

/* ---------- Werkzeuge ---------- */
const TOOLS = [
  { id: "auto", label: "Auto", icon: "i-auto" },
  { id: "heal", label: "Entfernen", icon: "i-heal", keys: ["strokes", "restores"], face: false },
  { id: "blem", label: "Pickel", icon: "i-blem", keys: ["blemish"], face: true },
  { id: "marks", label: "Flecken", icon: "i-marks", keys: ["marks"], face: true },
  { id: "skin", label: "Haut", icon: "i-skin", keys: ["skin"], face: true },
  { id: "tone", label: "Hautton", icon: "i-tone", keys: ["tone"], face: true },
  { id: "eyes", label: "Augen", icon: "i-eye", keys: ["eyes"], face: true },
  { id: "teeth", label: "Zähne", icon: "i-teeth", keys: ["teeth"], face: true },
  { id: "enh", label: "Verbessern", icon: "i-enh", keys: ["denoise", "detail"] },
  { id: "sharp", label: "Schärfe", icon: "i-sharp", keys: ["sharpen"] },
  { id: "light", label: "Licht", icon: "i-light", keys: ["exposure", "contrast", "warmth"] }
];
function buildTools() {
  const nav = $("tools"); nav.innerHTML = "";
  for (const t of TOOLS) {
    const b = document.createElement("button");
    b.className = "tool"; b.dataset.id = t.id;
    b.innerHTML = `<svg><use href="#${t.icon}"/></svg><span>${t.label}</span>`;
    b.onclick = () => selectTool(t.id);
    nav.appendChild(b);
  }
}
function updateToolDots() {
  for (const b of $("tools").children) {
    const t = TOOLS.find((x) => x.id === b.dataset.id);
    const on = t.keys ? t.keys.some((k) => (Array.isArray(P[k]) ? P[k].length : P[k])) || (t.id === "blem" && P.spots.length) || (t.id === "enh" && SR.on) : false;
    let d = b.querySelector(".on");
    if (on && !d) { d = document.createElement("i"); d.className = "on"; b.appendChild(d); }
    if (!on && d) d.remove();
    b.disabled = t.face && !faces.length;
  }
}
function selectTool(id) {
  if (visSpots && id !== "heal") { visSpots = false; region = null; requestRender(); }
  setTimeout(draw, 0);
  if (tool === "blem" && id !== "blem" && blemMode !== "auto") { blemMode = "auto"; }
  tool = id;
  for (const b of $("tools").children) b.classList.toggle("sel", b.dataset.id === id);
  renderPanel(); updateToolDots();
}

function slider(key, label, opts = {}) {
  const min = opts.min ?? 0, max = opts.max ?? 100, bip = min < 0;
  const wrap = document.createElement("div"); wrap.className = "sl" + (opts.compact ? " compact" : "");
  const top = document.createElement("div"); top.className = "sl-top";
  const lab = document.createElement("span"); lab.textContent = label;
  const val = document.createElement("span"); val.className = "v";
  top.append(lab, val);
  const r = document.createElement("input"); r.type = "range"; r.min = min; r.max = max; r.step = 1;
  const get = opts.get || (() => P[key]), set = opts.set || ((v) => { P[key] = v; });
  const fmt = opts.fmt || ((v) => (bip && v > 0 ? "+" : "") + v + (opts.unit ?? ""));
  const paint = () => {
    const v = get(); r.value = v; val.textContent = fmt(v);
    const pct = ((v - min) / (max - min)) * 100, mid = bip ? 50 : 0;
    r.style.setProperty("--a", Math.min(mid, pct) + "%"); r.style.setProperty("--b", Math.max(mid, pct) + "%");
  };
  r.oninput = () => { set(+r.value); paint(); if (!opts.noRender) requestRender(); updateToolDots(); if (opts.onInput) opts.onInput(); };
  r.onchange = () => { if (!opts.noCommit) commit(); };
  let lt = 0;
  top.onclick = () => { const n = performance.now(); if (n - lt < 350) { set(opts.def ?? 0); paint(); if (!opts.noRender) requestRender(); if (!opts.noCommit) commit(); updateToolDots(); } lt = n; };
  paint();
  wrap.append(top, r);
  return wrap;
}
function seg(items, cur, onPick) {
  const s = document.createElement("div"); s.className = "seg";
  for (const [v, l] of items) {
    const b = document.createElement("button"); b.textContent = l; if (v === cur) b.className = "sel";
    b.onclick = () => onPick(v);
    s.appendChild(b);
  }
  return s;
}
function head(title, meta) {
  const h = document.createElement("div"); h.className = "panel-head";
  h.innerHTML = `<h2>${title}</h2><span class="meta" id="pmeta">${meta || ""}</span>`;
  return h;
}
function desc(t) { const p = document.createElement("p"); p.className = "desc"; p.textContent = t; return p; }
function updateMeta() {
  const m = $("pmeta"); if (!m) return;
  if (tool === "blem") m.innerHTML = `<b>${spotCount}</b> ${spotCount === 1 ? "Stelle" : "Stellen"}`;
  if (tool === "marks") m.innerHTML = `<b>${markCount}</b> ${markCount === 1 ? "Fleck" : "Flecken"}`;
}
function updateBadges() {
  $("tagFaces").lastChild.textContent = faces.length === 1 ? "1 Gesicht" : faces.length + " Gesichter";
  $("tagSpots").lastChild.textContent = (spotCount === 1 ? "1 Stelle" : spotCount + " Stellen") + (markCount ? ` · ${markCount} ${markCount === 1 ? "Fleck" : "Flecken"}` : "");
  $("tagSpots").hidden = !faces.length;
}
function noiseLabel() {
  const n = img ? img.noise : 0;
  return n < 1.6 ? "gering" : n < 3.2 ? "mittel" : "stark";
}
function renderPanel() {
  const p = $("panel"); p.innerHTML = "";
  const noFace = !faces.length;
  switch (tool) {
    case "auto": {
      p.append(head("Auto Retusche", noFace ? "kein Gesicht" : (faces.length === 1 ? "1 Gesicht" : faces.length + " Gesichter")));
      const b = document.createElement("button"); b.className = "autobtn"; b.innerHTML = `<svg><use href="#i-auto"/></svg>Auto Retusche anwenden`;
      b.disabled = noFace;
      b.onclick = () => { applyAuto(autoAmt); requestRender(); toast("Auto Retusche angewendet"); };
      p.append(b, slider(null, "Intensität", { get: () => autoAmt, set: (v) => { autoAmt = v; applyAuto(v, false); }, unit: " %", def: 70, compact: true, onInput: () => {} }));
      break;
    }
    case "heal": {
      const n = P.strokes.length, nr = P.restores.length;
      p.append(head("Entfernen", (n ? `<b>${n}</b> entfernt` : "") + (nr ? ` · <b>${nr}</b> geschützt` : "")));
      p.append(seg([["heal", "Reparieren"], ["clone", "Klonen"], ["restore", "Schützen"]], healMode, (v) => { healMode = v; renderPanel(); draw(); }));
      p.append(desc({ heal: "Über die Stelle wischen. Den weißen Punkt ziehen, um die Quelle zu verschieben.", clone: "Kopiert die Quelle 1:1 ohne Angleichen. Weißen Punkt ziehen für eine andere Quelle.", restore: "Über Bereiche wischen, die die Auto Retusche nicht anfassen soll, z. B. Sommersprossen." }[healMode]));
      const row = document.createElement("div"); row.className = "row";
      const g = document.createElement("div"); g.className = "grow";
      g.append(slider(null, "Pinsel", { min: 12, max: 160, get: () => brushSize, set: (v) => (brushSize = v), unit: " px", def: 44, noRender: true, noCommit: true, compact: true }));
      const vis = document.createElement("button"); vis.className = "ghost" + (visSpots ? " gold" : ""); vis.innerHTML = `<svg><use href="#i-before"/></svg>Sichtbar`;
      vis.onclick = () => { visSpots = !visSpots; region = null; requestRender(); renderPanel(); toast(visSpots ? "Flecken sichtbar: helle und dunkle Punkte sind Unreinheiten" : "Normale Ansicht"); };
      const del = document.createElement("button"); del.className = "ghost"; del.textContent = "Letzte"; del.disabled = !(healMode === "restore" ? nr : n);
      del.onclick = () => { if (healMode === "restore") P.restores = P.restores.slice(0, -1); else P.strokes = P.strokes.slice(0, -1); commit(); requestRender(); renderPanel(); updateToolDots(); };
      row.append(g, vis, del);
      p.append(row);
      p.style.gap = "8px";
      return;
    }
    case "blem": {
      p.append(head("Pickel & Unreinheiten", ""));
      p.append(seg([["auto", "Automatisch"], ["tap", "Antippen"], ["keep", "Behalten"]], blemMode, (v) => { blemMode = v; if (v !== "auto" && !showMask) setMask(true); renderPanel(); }));
      if (blemMode === "auto") { p.append(slider("blemish", "Empfindlichkeit", { unit: " %", compact: true }), slider("blemFade", "Deckkraft", { unit: " %", compact: true, def: 100 })); p.style.gap = "6px"; updateMeta(); return; }
      else if (blemMode === "tap") p.append(desc("Tippe auf weitere Stellen, um sie zu entfernen. Schon markierte Stellen bleiben markiert. Rückgängig oben links."));
      else p.append(desc("Tippe auf eine erkannte Stelle (pink), die bleiben soll, z. B. ein Leberfleck oder Muttermal."));
      updateMeta();
      break;
    }
    case "marks":
      p.append(head("Dunkle Flecken", ""), desc("Pigmentflecken, Aknemale und dunkle Stellen werden in Helligkeit und Farbe an die Haut angeglichen. Die Struktur bleibt komplett erhalten. In der Maske violett."), slider("marks", "Empfindlichkeit", { unit: " %" }));
      updateMeta();
      break;
    case "skin":
      p.append(head("Haut glätten", "Poren bleiben"), desc("Beruhigt Flecken und Unebenheiten in den mittleren Frequenzen. Die feine Hautstruktur wird nie weichgezeichnet."), slider("skin", "Glätten", { unit: " %" }));
      break;
    case "tone":
      p.append(head("Hautton angleichen", "Dodge & Burn"), desc("Gleicht Rötungen, Schatten und fleckige Stellen aus. Die Form des Gesichts bleibt erhalten."), slider("tone", "Angleichen", { unit: " %" }));
      break;
    case "eyes":
      p.append(head("Augen", ""), desc("Hellt Iris und Augenweiß auf und betont die Details."), slider("eyes", "Aufhellen", { unit: " %" }));
      break;
    case "teeth":
      p.append(head("Zähne", hasTeeth ? "" : "keine Zähne sichtbar"), desc(hasTeeth ? "Entfernt den Gelbstich und hellt leicht auf. Lippen bleiben unberührt." : "Bei geschlossenem Mund hat dieser Regler keine Wirkung."), slider("teeth", "Aufhellen", { unit: " %" }));
      break;
    case "enh": {
      p.append(head("Bild verbessern", enhMode === "denoise" ? `Rauschen: ${noiseLabel()}` : enhMode === "sr" ? (SR.on ? "beim Sichern aktiv" : "aus") : ""));
      p.append(seg([["denoise", "Entrauschen"], ["detail", "Details"], ["sr", "Super Res."]], enhMode, (v) => { enhMode = v; renderPanel(); }));
      if (enhMode === "denoise") p.append(slider("denoise", "Stärke", { unit: " %" }), );
      else if (enhMode === "detail") p.append(slider("detail", "Klarheit & Mikrokontrast", { unit: " %" }));
      else {
        const row = document.createElement("div"); row.className = "row";
        const g = document.createElement("div"); g.className = "grow";
        g.append(slider(null, "KI Stärke", { get: () => SR.amt, set: (v) => (SR.amt = v), unit: " %", def: 100, noRender: true, noCommit: true, compact: true }));
        const pv = document.createElement("button"); pv.className = "ghost"; pv.textContent = "Vorschau"; pv.onclick = openSRPreview;
        const tg = document.createElement("button"); tg.className = "toggle" + (SR.on ? " on" : ""); tg.setAttribute("aria-label", "Super Resolution beim Sichern");
        tg.onclick = () => { SR.on = !SR.on; renderPanel(); updateToolDots(); };
        row.append(g, pv, tg);
        p.append(row);
      }
      break;
    }
    case "sharp":
      p.append(head("Schärfe", "Haut wird geschont"), desc("Ausgabeschärfe wie High Pass. Augen, Haare und Kleidung profitieren, die Haut wird nur leicht geschärft."), slider("sharpen", "Schärfen", { unit: " %" }));
      break;
    case "light":
      p.append(slider("exposure", "Belichtung", { min: -100, max: 100, compact: true, fmt: (v) => (v > 0 ? "+" : "") + (v / 50).toFixed(2).replace(".", ",") + " EV" }),
        slider("contrast", "Kontrast", { min: -100, max: 100, compact: true }),
        slider("warmth", "Wärme", { min: -100, max: 100, compact: true }));
      p.style.gap = "4px";
      return;
  }
  p.style.gap = "";
}

/* Bühnen Knöpfe */
function setMask(on) { showMask = on; $("btnMask").classList.toggle("on", on); region = null; requestRender(); }
$("btnMask").onclick = () => setMask(!showMask);
$("btnSplit").onclick = () => { split = !split; $("btnSplit").classList.toggle("on", split); draw(); };
const bb = $("btnBefore");
const beforeOn = (e) => { e.preventDefault(); holdBefore = true; bb.classList.add("on"); draw(); };
const beforeOff = () => { if (!holdBefore) return; holdBefore = false; bb.classList.remove("on"); draw(); };
bb.addEventListener("pointerdown", beforeOn); bb.addEventListener("pointerup", beforeOff); bb.addEventListener("pointercancel", beforeOff); bb.addEventListener("pointerleave", beforeOff);

/* ---------- Blätter ---------- */
let openSheetEl = null;
function openSheet(el) {
  openSheetEl = el; $("scrim").hidden = false;
  requestAnimationFrame(() => { $("scrim").classList.add("show"); el.classList.add("show"); });
}
function closeSheet() {
  if (!openSheetEl) return;
  openSheetEl.classList.remove("show"); $("scrim").classList.remove("show");
  const el = openSheetEl; openSheetEl = null;
  setTimeout(() => { if (!openSheetEl) $("scrim").hidden = true; }, 250);
  return el;
}
$("scrim").onclick = closeSheet;

function outDims() {
  let w = img.w, h = img.h;
  if (exp.maxEdge && Math.max(w, h) > exp.maxEdge) { const f = exp.maxEdge / Math.max(w, h); w = Math.round(w * f); h = Math.round(h * f); }
  return { w, h };
}
function srAllowed() { const d = outDims(); return d.w * d.h <= SR_MAX; }
function fileName() { return `${img.name}_retusche${SR.on && srAllowed() ? "_2x" : ""}.jpg`; }
function refreshExport() {
  for (const b of $("segSize").children) b.classList.toggle("sel", +b.dataset.v === exp.maxEdge);
  for (const b of $("segQ").children) b.classList.toggle("sel", +b.dataset.v === exp.quality);
  const ok = srAllowed(), d = outDims();
  $("tglSR").classList.toggle("on", SR.on && ok);
  $("tglSR").disabled = !ok;
  $("srNote").innerHTML = ok ? `Auflösung mit KI verdoppeln${SR.on ? ` · <b>${d.w * 2}×${d.h * 2}</b>` : ""}` : "Nur bis 12 MP. Wähle 4000 px oder 2048 px.";
  $("fname").textContent = `${fileName()} · ${SR.on && ok ? d.w * 2 : d.w}×${SR.on && ok ? d.h * 2 : d.h}`;
}
$("segSize").onclick = (e) => { const v = e.target.dataset.v; if (v == null) return; exp.maxEdge = +v; refreshExport(); };
$("segQ").onclick = (e) => { const v = e.target.dataset.v; if (v == null) return; exp.quality = +v; refreshExport(); };
$("tglSR").onclick = () => { SR.on = !SR.on; refreshExport(); updateToolDots(); };
$("btnSave").onclick = () => { if (!img) return; refreshExport(); openSheet($("sheetExport")); };

$("btnDoExport").onclick = async () => {
  closeSheet();
  const useSR = SR.on && srAllowed();
  const name = fileName();
  showBusy("Retusche in voller Auflösung", `${outDims().w}×${outDims().h}`, useSR);
  try {
    let res;
    if (useSR) {
      const got = waitFor("srInput");
      W.postMessage({ type: "export", P, maxEdge: exp.maxEdge, quality: exp.quality, sr: true });
      const m = await got;
      setBusy("Super Resolution (KI)", 0.6);
      const up = await upscale(new Uint8Array(m.rgb.buffer || m.rgb), m.w, m.h, SR.amt / 100, (p) => setBusy(null, 0.6 + p * 0.25), (t) => ($("busySub").textContent = t));
      const ex = waitFor("exported");
      W.postMessage({ type: "encode", rgb: up.data.buffer, w: up.w, h: up.h, quality: exp.quality }, [up.data.buffer]);
      res = await ex;
    } else {
      const ex = waitFor("exported");
      W.postMessage({ type: "export", P, maxEdge: exp.maxEdge, quality: exp.quality, sr: false });
      res = await ex;
    }
    showDone(await withExif(res.blob), name, res.w, res.h);
  } catch (e) {
    console.error(e); hideBusy();
    toast(e.message === "cancel" ? "Abgebrochen" : "Sichern fehlgeschlagen: " + (e.message || e), e.message !== "cancel");
  }
};
function showDone(blob, name, w, h) {
  const card = $("busy").querySelector(".busy-card");
  $("busy").querySelector(".spin").hidden = true;
  $("busyLabel").textContent = "Fertig";
  $("busyBar").style.width = "100%";
  $("busySub").textContent = `${w}×${h} · ${(blob.size / 1048576).toFixed(1).replace(".", ",")} MB`;
  $("busyCancel").hidden = true;
  const box = document.createElement("div"); box.className = "done-box"; box.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:16px";
  const file = new File([blob], name, { type: "image/jpeg" });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  const share = async () => {
    try { await navigator.share({ files: [file] }); } catch (e) { if (e.name !== "AbortError") download(blob, name); }
  };
  if (canShare) {
    const lr = document.createElement("button"); lr.className = "big"; lr.innerHTML = `<svg><use href="#i-lr-app"/></svg>An Lightroom senden`;
    lr.onclick = share;
    const note = document.createElement("div"); note.className = "done-note"; note.textContent = "Im Teilen Menü „Lightroom“ wählen. Fehlt es, ganz rechts auf „Mehr“ tippen.";
    const ph = document.createElement("button"); ph.className = "ghost"; ph.style.justifyContent = "center"; ph.innerHTML = `<svg><use href="#i-save"/></svg>In Fotos sichern`;
    ph.onclick = share;
    const dl = document.createElement("button"); dl.className = "ghost"; dl.style.justifyContent = "center"; dl.textContent = "In Dateien sichern";
    dl.onclick = () => download(blob, name);
    box.append(lr, note, ph, dl);
  } else {
    const b1 = document.createElement("button"); b1.className = "big"; b1.innerHTML = `<svg><use href="#i-save"/></svg>Herunterladen`;
    b1.onclick = () => download(blob, name);
    box.append(b1);
  }
  const b2 = document.createElement("button"); b2.className = "ghost"; b2.textContent = "Schließen"; b2.style.justifyContent = "center";
  b2.onclick = () => { box.remove(); hideBusy(); };
  box.append(b2);
  card.append(box);
}
function download(blob, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/* ---------- Super Resolution (KI, auf dem Gerät) ---------- */
let srModel = null;
async function loadSR() {
  const fa = await loadFaceApi();
  if (!srModel) srModel = await fa.tf.loadLayersModel("models/esrgan/model.json");
  return { tf: fa.tf, model: srModel };
}
async function upscale(rgb, w, h, amt, onP, onText) {
  const { tf, model } = await loadSR();
  const W2 = w * 2, H2 = h * 2, out = new Uint8Array(W2 * H2 * 3);
  const T = 160, PAD = 10, nx = Math.ceil(w / T), ny = Math.ceil(h / T), total = nx * ny;
  const t0 = performance.now();
  let done = 0;
  for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
    if (cancelFlag) throw new Error("cancel");
    const x0 = tx * T, y0 = ty * T, x1 = Math.min(w, x0 + T), y1 = Math.min(h, y0 + T);
    const px0 = Math.max(0, x0 - PAD), py0 = Math.max(0, y0 - PAD), px1 = Math.min(w, x1 + PAD), py1 = Math.min(h, y1 + PAD);
    const tw = px1 - px0, th = py1 - py0, buf = new Float32Array(tw * th * 3);
    for (let y = 0; y < th; y++) { const s = ((py0 + y) * w + px0) * 3; for (let i = 0; i < tw * 3; i++) buf[y * tw * 3 + i] = rgb[s + i]; }
    const res = tf.tidy(() => {
      const t = tf.tensor4d(buf, [1, th, tw, 3]);
      let o = model.predict(t).clipByValue(0, 255);
      if (amt < 0.999) o = o.mul(amt).add(tf.image.resizeBilinear(t, [th * 2, tw * 2]).mul(1 - amt));
      return o;
    });
    const d = await res.data(); res.dispose();
    const ow = tw * 2;
    for (let y = y0 * 2; y < y1 * 2; y++) {
      const so = ((y - py0 * 2) * ow + (x0 * 2 - px0 * 2)) * 3, oo = (y * W2 + x0 * 2) * 3, len = (x1 - x0) * 2 * 3;
      for (let i = 0; i < len; i++) { const v = d[so + i]; out[oo + i] = v < 0 ? 0 : v > 255 ? 255 : v + 0.5; }
    }
    done++;
    onP(done / total);
    if (onText && done % 4 === 0) {
      const el = (performance.now() - t0) / done * (total - done) / 1000;
      onText(el > 60 ? `noch etwa ${Math.ceil(el / 60)} Min.` : `noch etwa ${Math.ceil(el)} Sek.`);
    }
  }
  return { data: out, w: W2, h: H2 };
}
async function openSRPreview() {
  if (!img) return;
  showBusy("KI Vorschau wird berechnet", "Modell wird geladen");
  try {
    const S = 128;
    let cx = img.w / 2, cy = img.h / 2;
    if (faces.length) { const lm = faces[0]; cx = (lm[36][0] + lm[45][0]) / 2; cy = (lm[36][1] + lm[45][1]) / 2; }
    const x = Math.round(clamp(cx - S / 2, 0, img.w - S)), y = Math.round(clamp(cy - S / 2, 0, img.h - S));
    const got = waitFor("crop");
    W.postMessage({ type: "crop", P, rect: { x, y, w: S, h: S } });
    const m = await got;
    const rgba = new Uint8ClampedArray(m.rgba.buffer || m.rgba), rgb = new Uint8Array(S * S * 3);
    for (let i = 0; i < S * S; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
    $("busySub").textContent = "KI wird vorbereitet";
    await upscale(rgb.subarray(0, 32 * 32 * 3), 32, 32, 1, () => {}); // Aufwärmen (Shader)
    const t0 = performance.now();
    $("busySub").textContent = "KI rechnet";
    const up = await upscale(rgb, S, S, SR.amt / 100, (p) => setBusy(null, p));
    const ms = performance.now() - t0;
    const a = $("srA"), b = $("srB");
    const src = document.createElement("canvas"); putRGBA(src, rgba, S, S);
    a.width = b.width = S * 2; a.height = b.height = S * 2;
    const ac = a.getContext("2d"); ac.imageSmoothingQuality = "high"; ac.drawImage(src, 0, 0, S * 2, S * 2);
    const rgba2 = new Uint8ClampedArray(S * 2 * S * 2 * 4);
    for (let i = 0; i < S * S * 4; i++) { rgba2[i * 4] = up.data[i * 3]; rgba2[i * 4 + 1] = up.data[i * 3 + 1]; rgba2[i * 4 + 2] = up.data[i * 3 + 2]; rgba2[i * 4 + 3] = 255; }
    b.getContext("2d").putImageData(new ImageData(rgba2, S * 2, S * 2), 0, 0);
    setCompare(0.5);
    const d = outDims(), est = ms * (d.w * d.h) / (S * S) / 1000;
    $("srInfo").innerHTML = srAllowed()
      ? `Geschätzte Dauer beim Sichern: <b>${est > 90 ? Math.ceil(est / 60) + " Min." : Math.ceil(est) + " Sek."}</b> für ${d.w * 2}×${d.h * 2} Pixel.`
      : "Für dieses Bild beim Sichern 4000 px oder 2048 px wählen (bis 12 MP).";
    hideBusy();
    openSheet($("sheetSR"));
  } catch (e) { console.error(e); hideBusy(); toast("KI Vorschau fehlgeschlagen: " + (e.message || e), true); }
}
function setCompare(f) {
  f = clamp(f, 0, 1);
  $("srB").style.clipPath = `inset(0 0 0 ${f * 100}%)`;
  $("srLine").style.left = $("srKnob").style.left = f * 100 + "%";
}
$("srCompare").addEventListener("pointerdown", (e) => {
  const el = $("srCompare"); el.setPointerCapture(e.pointerId);
  const mv = (ev) => { const r = el.getBoundingClientRect(); setCompare((ev.clientX - r.left) / r.width); };
  mv(e);
  el.onpointermove = mv;
  el.onpointerup = el.onpointercancel = () => { el.onpointermove = null; };
});
$("btnSRClose").onclick = closeSheet;

/* ---------- Start ---------- */
buildTools();
new ResizeObserver(resize).observe($("stage"));
resize();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
window.__rs = { get P() { return P; }, get faces() { return faces; }, get img() { return img; }, openFile, setMask, selectTool, view, draw, scheduleRegion, zoomAt, applyAuto, requestRender, upscale, openSRPreview, get spotCount() { return spotCount; } };
