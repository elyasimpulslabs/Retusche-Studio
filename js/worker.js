/* Retusche Studio Rechen Worker. © 2026 Elyas Saciri (Ervin Saciri). */
import * as E from "./engine.js?v=6";
import jpegEncode from "../lib/jpeg/encoder.js";
import jpegDecode from "../lib/jpeg/decoder.js";

const PREVIEW_EDGE = 1600;
let full = null, prev = null, faces = [], G = { noise: 0, longEdge: 0 }, lastBlem = null;

const post = (type, data, transfer) => self.postMessage(Object.assign({ type }, data), transfer || []);

const patchCache = new Map();
let lastOffs = "", lastRestore = "";
function ensureStrokes(P) {
  const list = P.strokes || [];
  G.patches = list.map((st) => {
    const key = JSON.stringify(st);
    if (!patchCache.has(key)) patchCache.set(key, E.buildPatch(full, st));
    return patchCache.get(key);
  });
  const offs = G.patches.map((p) => (p && p.off ? p.off : null)), ok = JSON.stringify(offs);
  if (ok !== lastOffs) { lastOffs = ok; post("patchinfo", { offs }); }
  const rk = JSON.stringify(P.restores || []);
  if (rk !== lastRestore) { lastRestore = rk; G.restore = E.buildRestore(full.w, full.h, P.restores); }
  if (patchCache.size > 200) { const keep = new Set(list.map((st) => JSON.stringify(st))); for (const k of patchCache.keys()) if (!keep.has(k)) patchCache.delete(k); }
}
function blemKey(P) { return P.blemish + "|" + (P.marks || 0) + "|" + JSON.stringify(P.spots || []); }
function ensureBlemishes(P) {
  const key = blemKey(P);
  if (key === lastBlem) return;
  let count = 0, marks = 0;
  for (const F of faces) { E.updateBlemishes(F, P.blemish / 100, P.spots, (P.marks || 0) / 100); count += F.count; marks += F.countP; }
  lastBlem = key;
  post("count", { count, marks });
}

function toRGBA(pl, w, h) { return E.planarToRGBA(pl, w, h); }

function rotateRGB(img, orient) {
  if (!orient || orient === 1) return img;
  const { w, h, data } = img, swap = orient >= 5;
  const W = swap ? h : w, H = swap ? w : h, out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let nx, ny;
    switch (orient) {
      case 2: nx = w - 1 - x; ny = y; break;
      case 3: nx = w - 1 - x; ny = h - 1 - y; break;
      case 4: nx = x; ny = h - 1 - y; break;
      case 5: nx = y; ny = x; break;
      case 6: nx = h - 1 - y; ny = x; break;
      case 7: nx = h - 1 - y; ny = w - 1 - x; break;
      case 8: nx = y; ny = w - 1 - x; break;
      default: nx = x; ny = y;
    }
    const s = (y * w + x) * 3, o = (ny * W + nx) * 3;
    out[o] = data[s]; out[o + 1] = data[s + 1]; out[o + 2] = data[s + 2];
  }
  return { w: W, h: H, data: out };
}

function setImage(img) {
  full = { w: img.w, h: img.h, data: img.data, k: 1 };
  prev = E.downscaleImage(full, PREVIEW_EDGE);
  faces = []; lastBlem = null; patchCache.clear(); lastOffs = ""; lastRestore = "";
  G = { noise: E.estimateNoise(full), longEdge: Math.max(full.w, full.h) };
  const rgba = new Uint8ClampedArray(prev.w * prev.h * 4);
  for (let i = 0, o = 0; i < prev.w * prev.h; i++, o += 4) { rgba[o] = prev.data[i * 3]; rgba[o + 1] = prev.data[i * 3 + 1]; rgba[o + 2] = prev.data[i * 3 + 2]; rgba[o + 3] = 255; }
  post("loaded", { w: full.w, h: full.h, pw: prev.w, ph: prev.h, rgba, noise: G.noise }, [rgba.buffer]);
}

async function encodeJPEG(rgb, w, h, quality, onP) {
  if (typeof OffscreenCanvas !== "undefined" && w * h <= 16000000) {
    try {
      const c = new OffscreenCanvas(w, h), ctx = c.getContext("2d");
      const id = ctx.createImageData(w, h);
      for (let i = 0, o = 0; i < w * h; i++, o += 4) { id.data[o] = rgb[i * 3]; id.data[o + 1] = rgb[i * 3 + 1]; id.data[o + 2] = rgb[i * 3 + 2]; id.data[o + 3] = 255; }
      ctx.putImageData(id, 0, 0);
      return await c.convertToBlob({ type: "image/jpeg", quality: quality / 100 });
    } catch (e) { /* weiter mit JS Encoder */ }
  }
  const res = jpegEncode({ data: rgb, width: w, height: h, channels: 3, onRow: (y, H) => { if (y % 64 === 0) onP(y / H); } }, quality);
  return new Blob([res.data], { type: "image/jpeg" });
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === "image") {
      setImage({ w: m.w, h: m.h, data: new Uint8Array(m.data) });
    } else if (m.type === "jpeg") {
      post("progress", { label: "Großes Foto wird gelesen", p: 0.2 });
      const img = jpegDecode(new Uint8Array(m.bytes), { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 200, maxMemoryUsageInMB: 1500 });
      setImage(rotateRGB({ w: img.width, h: img.height, data: img.data }, m.orientation));
    } else if (m.type === "faces") {
      faces = [];
      const list = m.faces.slice(0, 8);
      for (let i = 0; i < list.length; i++) {
        post("progress", { label: "Haut wird analysiert", p: (i + 0.5) / list.length });
        faces.push(E.analyzeFace(full, list[i], i));
      }
      lastBlem = null;
      post("analyzed", { n: faces.length, teeth: faces.some((F) => F.teeth) });
    } else if (m.type === "render") {
      ensureBlemishes(m.P); ensureStrokes(m.P);
      const pl = E.renderRegion(prev, 0, 0, prev.w, prev.h, m.P, faces, G, { mask: m.mask, vis: m.vis });
      const rgba = toRGBA(pl, prev.w, prev.h);
      post("rendered", { id: m.id, w: prev.w, h: prev.h, rgba }, [rgba.buffer]);
    } else if (m.type === "region") {
      ensureBlemishes(m.P); ensureStrokes(m.P);
      // Ausschnitt in Originalpixeln, Ausgabe höchstens 1:1
      const { x, y, w, h } = m.rect;
      const scale = Math.min(1, m.maxOut / Math.max(w, h));
      let src, rx, ry, rw, rh;
      if (scale >= 0.999) { src = full; rx = x; ry = y; rw = w; rh = h; }
      else {
        const pad = Math.ceil(40 / scale);
        const sx = Math.max(0, x - pad), sy = Math.max(0, y - pad), sw = Math.min(full.w, x + w + pad) - sx, sh = Math.min(full.h, y + h + pad) - sy;
        const dw = Math.max(1, Math.round(sw * scale)), dh = Math.max(1, Math.round(sh * scale));
        const [R, Gc, B] = E.resampleRGB(full, sx, sy, sw, sh, dw, dh);
        const data = new Uint8Array(dw * dh * 3);
        for (let i = 0; i < dw * dh; i++) { data[i * 3] = R[i] + 0.5; data[i * 3 + 1] = Gc[i] + 0.5; data[i * 3 + 2] = B[i] + 0.5; }
        // eigenes kleines Quellbild, das bei (sx,sy) im Original beginnt
        src = { w: dw, h: dh, data, k: sw / dw, ox: sx, oy: sy };
        rx = 0; ry = 0; rw = dw; rh = dh;
      }
      const shifted = src.ox !== undefined ? faces.map((F) => Object.assign(Object.create(F), { cx0: F.cx0 - src.ox, cy0: F.cy0 - src.oy })) : faces;
      const pl = E.renderRegion(src, rx, ry, rw, rh, m.P, shifted, G, { mask: m.mask, vis: m.vis });
      const before = new Uint8ClampedArray(rw * rh * 4);
      for (let yy = 0; yy < rh; yy++) for (let xx = 0; xx < rw; xx++) {
        const s = ((ry + yy) * src.w + rx + xx) * 3, o = (yy * rw + xx) * 4;
        before[o] = src.data[s]; before[o + 1] = src.data[s + 1]; before[o + 2] = src.data[s + 2]; before[o + 3] = 255;
      }
      const rgba = toRGBA(pl, rw, rh);
      const ox = src.ox !== undefined ? src.ox : 0, oy = src.oy !== undefined ? src.oy : 0;
      post("region", { id: m.id, rect: { x: ox + rx * src.k, y: oy + ry * src.k, w: rw * src.k, h: rh * src.k }, w: rw, h: rh, rgba, before }, [rgba.buffer, before.buffer]);
    } else if (m.type === "tap") {
      const r = E.toggleSpot(faces, m.spots, m.x, m.y, m.mode);
      post("spots", r);
    } else if (m.type === "export") {
      ensureBlemishes(m.P); ensureStrokes(m.P);
      let src = full;
      if (m.maxEdge && Math.max(full.w, full.h) > m.maxEdge) {
        post("progress", { label: "Größe wird angepasst", p: 0.02 });
        src = E.downscaleImage(full, m.maxEdge);
      }
      const rgb = E.renderFull(src, m.P, faces, G, (p) => post("progress", { label: "Retusche in voller Auflösung", p: p * 0.6 }));
      if (m.sr) {
        post("srInput", { w: src.w, h: src.h, rgb }, [rgb.buffer]);
        return;
      }
      const blob = await encodeJPEG(rgb, src.w, src.h, m.quality, (p) => post("progress", { label: "JPEG wird gespeichert", p: 0.6 + p * 0.4 }));
      post("exported", { blob, w: src.w, h: src.h });
    } else if (m.type === "encode") {
      const blob = await encodeJPEG(new Uint8Array(m.rgb), m.w, m.h, m.quality, (p) => post("progress", { label: "JPEG wird gespeichert", p: 0.85 + p * 0.15 }));
      post("exported", { blob, w: m.w, h: m.h });
    } else if (m.type === "crop") {
      // Ausschnitt in Originalauflösung (für KI Vorschau)
      const { x, y, w, h } = m.rect;
      ensureStrokes(m.P);
      const pl = E.renderRegion(full, x, y, w, h, m.P, faces, G);
      const rgba = toRGBA(pl, w, h);
      post("crop", { w, h, rgba }, [rgba.buffer]);
    }
  } catch (e) {
    post("error", { message: (e && e.message) || String(e), during: m.type });
  }
};
