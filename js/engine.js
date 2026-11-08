/* Retusche Studio Engine. © 2026 Elyas Saciri (Ervin Saciri).
 * Reine Bildverarbeitung ohne DOM. Läuft im Worker.
 * Prinzip wie in Photoshop: Frequenztrennung, Reparatur nur an erkannten Stellen,
 * Poren (hohe Frequenzen) bleiben immer erhalten.
 */

/* ---------- Grundlagen ---------- */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/* Separabler Gauß. Kleine Radien exakt, große über 3 Boxfilter. */
function boxPass(src, dst, w, h, r, horiz) {
  const n = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 1 : w, lstep = horiz ? w : 1;
  const inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = l * lstep;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[base + clamp(i, 0, n - 1) * step];
    for (let i = 0; i < n; i++) {
      dst[base + i * step] = acc * inv;
      acc += src[base + Math.min(i + r + 1, n - 1) * step] - src[base + Math.max(i - r, 0) * step];
    }
  }
}
function kernelPass(src, dst, w, h, k, horiz) {
  const r = (k.length - 1) >> 1;
  if (horiz) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        let a = 0;
        for (let i = -r; i <= r; i++) { let xx = x + i; xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx; a += src[o + xx] * k[i + r]; }
        dst[o + x] = a;
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      for (let i = -r; i <= r; i++) {
        let yy = y + i; yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
        const kv = k[i + r], so = yy * w, d = y * w;
        if (i === -r) for (let x = 0; x < w; x++) dst[d + x] = src[so + x] * kv;
        else for (let x = 0; x < w; x++) dst[d + x] += src[so + x] * kv;
      }
    }
  }
}
let TMP = null;
function tmp(n) { if (!TMP || TMP.length < n) TMP = new Float32Array(n); return TMP; }
export function gauss(src, w, h, sigma, out) {
  const n = w * h;
  out = out || new Float32Array(n);
  if (sigma < 0.35) { out.set(src.subarray(0, n)); return out; }
  const t = tmp(n);
  if (sigma < 3) {
    const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1);
    let s = 0;
    for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    kernelPass(src, t, w, h, k, true);
    kernelPass(t, out, w, h, k, false);
    return out;
  }
  // 3 Boxfilter (Kovesi)
  const wIdeal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2, m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
  const radii = [0, 1, 2].map((i) => ((i < m ? wl : wu) - 1) / 2);
  let a = src, first = true;
  for (const r of radii) {
    boxPass(a, t, w, h, r, true);
    boxPass(t, out, w, h, r, false);
    a = out; first = false;
  }
  return out;
}
/* Normierte Faltung: mittelt nur über Pixel mit Gewicht (z. B. nur Haut ohne Pickel) */
function normConv(chans, wgt, w, h, sigma, fallback) {
  const n = w * h, bw = gauss(wgt, w, h, sigma);
  const outs = [];
  const tmpc = new Float32Array(n);
  for (let c = 0; c < chans.length; c++) {
    const src = chans[c];
    for (let i = 0; i < n; i++) tmpc[i] = src[i] * wgt[i];
    const b = gauss(tmpc, w, h, sigma);
    const fb = fallback ? fallback[c] : src;
    for (let i = 0; i < n; i++) { const ww = bw[i]; b[i] = ww > 0.02 ? b[i] / ww : fb[i]; }
    outs.push(b);
  }
  return outs;
}
export const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const toCb = (r, g, b) => -0.168736 * r - 0.331264 * g + 0.5 * b;
const toCr = (r, g, b) => 0.5 * r - 0.418688 * g - 0.081312 * b;

/* Polygon füllen (Mittelpunkt Abtastung), Werte maximieren */
function fillPoly(mask, w, h, pts, val = 1) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h - 1, Math.ceil(maxY));
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5; xs.length = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > cy) !== (b[1] > cy)) xs.push(a[0] + ((cy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) { const o = y * w + x; if (mask[o] < val) mask[o] = val; }
    }
  }
}
function fillDisc(mask, w, h, cx, cy, r, val = 1) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    if (dx * dx + dy * dy <= r * r) { const o = y * w + x; if (mask[o] < val) mask[o] = val; }
  }
}
function capsule(mask, w, h, a, b, r) {
  const steps = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(1, r * 0.5)));
  for (let i = 0; i <= steps; i++) { const t = i / steps; fillDisc(mask, w, h, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r); }
}
function scalePoly(pts, f) {
  let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  return pts.map((p) => [cx + (p[0] - cx) * f, cy + (p[1] - cy) * f]);
}
function polyArea(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return Math.abs(a / 2); }
/* weiche Erweiterung: Maske um d Pixel vergrößern und weich auslaufen lassen */
function grow(mask, w, h, d, feather) {
  const g = gauss(mask, w, h, Math.max(0.5, d / 2));
  for (let i = 0; i < g.length; i++) g[i] = g[i] > 0.12 ? 1 : g[i] / 0.12;
  return feather > 0.3 ? gauss(g, w, h, feather) : g;
}
function median(arr) { if (!arr.length) return 0; const a = Float32Array.from(arr).sort(); return a[a.length >> 1]; }

/* ---------- Bilder ---------- */
/* Flächenmittelung: Ausschnitt (sx,sy,sw,sh) aus RGB Uint8 auf dw x dh, planar Float32 */
export function resampleRGB(img, sx, sy, sw, sh, dw, dh) {
  const R = new Float32Array(dw * dh), G = new Float32Array(dw * dh), B = new Float32Array(dw * dh);
  const fx = sw / dw, fy = sh / dh, W = img.w, H = img.h, d = img.data;
  if (fx <= 1.0001 && fy <= 1.0001) { // 1:1 oder Vergrößerung: bilinear
    for (let y = 0; y < dh; y++) {
      const syf = clamp(sy + (y + 0.5) * fy - 0.5, 0, H - 1), y0 = Math.floor(syf), y1 = Math.min(H - 1, y0 + 1), ty = syf - y0;
      for (let x = 0; x < dw; x++) {
        const sxf = clamp(sx + (x + 0.5) * fx - 0.5, 0, W - 1), x0 = Math.floor(sxf), x1 = Math.min(W - 1, x0 + 1), tx = sxf - x0;
        const a = (y0 * W + x0) * 3, b = (y0 * W + x1) * 3, c = (y1 * W + x0) * 3, e = (y1 * W + x1) * 3, o = y * dw + x;
        const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty;
        R[o] = d[a] * w00 + d[b] * w01 + d[c] * w10 + d[e] * w11;
        G[o] = d[a + 1] * w00 + d[b + 1] * w01 + d[c + 1] * w10 + d[e + 1] * w11;
        B[o] = d[a + 2] * w00 + d[b + 2] * w01 + d[c + 2] * w10 + d[e + 2] * w11;
      }
    }
    return [R, G, B];
  }
  for (let y = 0; y < dh; y++) {
    const ya = sy + y * fy, yb = ya + fy;
    for (let x = 0; x < dw; x++) {
      const xa = sx + x * fx, xb = xa + fx;
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let yy = Math.floor(ya); yy < Math.ceil(yb); yy++) {
        if (yy < 0 || yy >= H) continue;
        const wy = Math.min(yb, yy + 1) - Math.max(ya, yy);
        for (let xx = Math.floor(xa); xx < Math.ceil(xb); xx++) {
          if (xx < 0 || xx >= W) continue;
          const ww = wy * (Math.min(xb, xx + 1) - Math.max(xa, xx)), o = (yy * W + xx) * 3;
          r += d[o] * ww; g += d[o + 1] * ww; b += d[o + 2] * ww; wsum += ww;
        }
      }
      const o = y * dw + x, inv = wsum > 0 ? 1 / wsum : 0;
      R[o] = r * inv; G[o] = g * inv; B[o] = b * inv;
    }
  }
  return [R, G, B];
}
export function downscaleImage(img, maxEdge) {
  const f = Math.min(1, maxEdge / Math.max(img.w, img.h));
  const w = Math.max(1, Math.round(img.w * f)), h = Math.max(1, Math.round(img.h * f));
  if (f === 1) return { w, h, data: img.data, k: 1 };
  const [R, G, B] = resampleRGB(img, 0, 0, img.w, img.h, w, h);
  const data = new Uint8Array(w * h * 3);
  for (let i = 0, o = 0; i < w * h; i++, o += 3) { data[o] = R[i] + 0.5; data[o + 1] = G[i] + 0.5; data[o + 2] = B[i] + 0.5; }
  return { w, h, data, k: img.w / w };
}

/* Rauschschätzung (Immerkær) auf mehreren Kacheln, Median */
export function estimateNoise(img) {
  const T = 192, est = [];
  const spots = [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75], [0.5, 0.15], [0.5, 0.85]];
  for (const [fx, fy] of spots) {
    const x0 = Math.floor(clamp(img.w * fx - T / 2, 0, Math.max(0, img.w - T))), y0 = Math.floor(clamp(img.h * fy - T / 2, 0, Math.max(0, img.h - T)));
    const tw = Math.min(T, img.w), th = Math.min(T, img.h);
    if (tw < 8 || th < 8) continue;
    const Y = new Float32Array(tw * th);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const o = ((y0 + y) * img.w + x0 + x) * 3; Y[y * tw + x] = luma(img.data[o], img.data[o + 1], img.data[o + 2]); }
    let s = 0;
    for (let y = 1; y < th - 1; y++) for (let x = 1; x < tw - 1; x++) {
      const o = y * tw + x;
      const v = Y[o - tw - 1] - 2 * Y[o - tw] + Y[o - tw + 1] - 2 * Y[o - 1] + 4 * Y[o] - 2 * Y[o + 1] + Y[o + tw - 1] - 2 * Y[o + tw] + Y[o + tw + 1];
      s += Math.abs(v);
    }
    est.push((s * Math.sqrt(Math.PI / 2)) / (6 * (tw - 2) * (th - 2)));
  }
  return est.length ? median(est) : 0;
}

/* ---------- Gesichtsanalyse ---------- */
const ANA_FACE = 400; // Gesichtsbreite in Analysepixeln

export function analyzeFace(img, lmFull, idx) {
  const P = (i) => lmFull[i];
  const faceW = Math.hypot(P(16)[0] - P(0)[0], P(16)[1] - P(0)[1]);
  const browMid = [(P(19)[0] + P(24)[0]) / 2, (P(19)[1] + P(24)[1]) / 2];
  const chin = P(8);
  const faceH = Math.max(1, Math.hypot(browMid[0] - chin[0], browMid[1] - chin[1]));
  const u = [(browMid[0] - chin[0]) / faceH, (browMid[1] - chin[1]) / faceH]; // Richtung "oben"

  // Ausschnitt in Originalpixeln (mit Hals)
  const xs = lmFull.map((p) => p[0]), ys = lmFull.map((p) => p[1]);
  const top = [browMid[0] + u[0] * faceH * 0.95, browMid[1] + u[1] * faceH * 0.95];
  const neck = [chin[0] - u[0] * faceH * 1.0, chin[1] - u[1] * faceH * 1.0];
  const cx0 = Math.max(0, Math.floor(Math.min(...xs, top[0], neck[0]) - faceW * 0.3));
  const cx1 = Math.min(img.w, Math.ceil(Math.max(...xs, top[0], neck[0]) + faceW * 0.3));
  const cy0 = Math.max(0, Math.floor(Math.min(...ys, top[1], neck[1]) - faceW * 0.15));
  const cy1 = Math.min(img.h, Math.ceil(Math.max(...ys, top[1], neck[1]) + faceW * 0.1));
  const cw = cx1 - cx0, ch = cy1 - cy0;
  const a = Math.min(1, ANA_FACE / faceW);
  const aw = Math.max(8, Math.round(cw * a)), ah = Math.max(8, Math.round(ch * a));
  const ax = cw / aw, ay = ch / ah; // Originalpixel pro Analysepixel
  const A = resampleRGB(img, cx0, cy0, cw, ch, aw, ah);
  const n = aw * ah;
  const L = lmFull.map((p) => [(p[0] - cx0) / ax, (p[1] - cy0) / ay]);
  const fw = faceW / ax, fh = faceH / ay; // in Analysepixeln
  const s = fw / 400;
  const uu = u;
  const Lp = (i) => L[i];

  // Luminanz und Farbe
  const Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let i = 0; i < n; i++) { const r = A[0][i], g = A[1][i], b = A[2][i]; Y[i] = luma(r, g, b); Cb[i] = toCb(r, g, b); Cr[i] = toCr(r, g, b); }

  // Hautfarbe an Wangen und Stirn messen (Median, robust gegen Pickel)
  const sampleAt = (c, rad) => {
    const out = [];
    const x0 = Math.max(0, Math.floor(c[0] - rad)), x1 = Math.min(aw - 1, Math.ceil(c[0] + rad));
    const y0 = Math.max(0, Math.floor(c[1] - rad)), y1 = Math.min(ah - 1, Math.ceil(c[1] + rad));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x - c[0]) ** 2 + (y - c[1]) ** 2 <= rad * rad) out.push(y * aw + x);
    return out;
  };
  const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const bm = [(Lp(19)[0] + Lp(24)[0]) / 2, (Lp(19)[1] + Lp(24)[1]) / 2];
  const samples = [
    ...sampleAt(mix(Lp(2), Lp(31), 0.5), fw * 0.06),
    ...sampleAt(mix(Lp(14), Lp(35), 0.5), fw * 0.06),
    ...sampleAt([bm[0] + uu[0] * fh * 0.22, bm[1] + uu[1] * fh * 0.22], fw * 0.07),
    ...sampleAt(mix(Lp(29), Lp(30), 0.5), fw * 0.03)
  ];
  const mY = median(samples.map((i) => Y[i])), mCb = median(samples.map((i) => Cb[i])), mCr = median(samples.map((i) => Cr[i]));
  const mad = (vals, m) => median(vals.map((v) => Math.abs(v - m))) * 1.4826;
  const sCb = Math.max(3.5, mad(samples.map((i) => Cb[i]), mCb)), sCr = Math.max(3.5, mad(samples.map((i) => Cr[i]), mCr));

  // Regionen
  const faceReg = new Float32Array(n), neckReg = new Float32Array(n), feat = new Float32Array(n), featBig = new Float32Array(n);
  const forehead = [];
  for (let i = 26; i >= 17; i--) {
    const t = (i - 21.5) / 4.5, off = fh * (0.92 - 0.3 * t * t);
    forehead.push([Lp(i)[0] + uu[0] * off, Lp(i)[1] + uu[1] * off]);
  }
  const facePoly = [];
  for (let i = 0; i <= 16; i++) facePoly.push(Lp(i));
  facePoly.push(...forehead);
  fillPoly(faceReg, aw, ah, facePoly);
  const down = (p, f) => [p[0] - uu[0] * fh * f, p[1] - uu[1] * fh * f];
  const neckPoly = [];
  for (let i = 3; i <= 13; i++) neckPoly.push(Lp(i));
  neckPoly.push(down(Lp(13), 1.0), down(Lp(8), 1.1), down(Lp(3), 1.0));
  fillPoly(neckReg, aw, ah, neckPoly);

  const eyeL = [36, 37, 38, 39, 40, 41].map(Lp), eyeR = [42, 43, 44, 45, 46, 47].map(Lp);
  const lipsOuter = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59].map(Lp);
  const lipsInner = [60, 61, 62, 63, 64, 65, 66, 67].map(Lp);
  // Merkmale, die nie als Haut gelten
  fillPoly(feat, aw, ah, scalePoly(eyeL, 1.5)); fillPoly(feat, aw, ah, scalePoly(eyeR, 1.5));
  for (const [i0, i1] of [[17, 21], [22, 26]]) for (let i = i0; i < i1; i++) capsule(feat, aw, ah, Lp(i), Lp(i + 1), fw * 0.03);
  fillPoly(feat, aw, ah, scalePoly(lipsOuter, 1.08));
  capsule(feat, aw, ah, Lp(31), Lp(35), fw * 0.03);
  // Größere Sperrzone nur für die Pickelsuche (Nasenlöcher, Augenwinkel, Lippenrand, Brauen)
  featBig.set(feat);
  fillPoly(featBig, aw, ah, scalePoly(eyeL, 2.1)); fillPoly(featBig, aw, ah, scalePoly(eyeR, 2.1));
  for (const [i0, i1] of [[17, 21], [22, 26]]) for (let i = i0; i < i1; i++) capsule(featBig, aw, ah, Lp(i), Lp(i + 1), fw * 0.055);
  fillPoly(featBig, aw, ah, scalePoly(lipsOuter, 1.25));
  capsule(featBig, aw, ah, Lp(31), Lp(35), fw * 0.075);
  capsule(featBig, aw, ah, Lp(32), Lp(34), fw * 0.08);
  capsule(featBig, aw, ah, Lp(36), Lp(39), fw * 0.055); capsule(featBig, aw, ah, Lp(42), Lp(45), fw * 0.055);
  fillDisc(featBig, aw, ah, Lp(48)[0], Lp(48)[1], fw * 0.06); fillDisc(featBig, aw, ah, Lp(54)[0], Lp(54)[1], fw * 0.06);
  const featS = grow(feat, aw, ah, fw * 0.012, fw * 0.008);
  const featBigS = grow(featBig, aw, ah, fw * 0.01, 1);
  const faceS = gauss(faceReg, aw, ah, fw * 0.02);
  const neckS = gauss(neckReg, aw, ah, fw * 0.04);

  // Textur (Haare, Stoff) und Haarbereiche (Bart) erkennen
  const Yb2 = gauss(Y, aw, ah, 2 * s);
  const tex = new Float32Array(n);
  for (let i = 0; i < n; i++) tex[i] = Math.abs(Y[i] - Yb2[i]);
  const texS = gauss(tex, aw, ah, 7 * s);
  const dark = new Float32Array(n);
  for (let i = 0; i < n; i++) dark[i] = Y[i] < mY * 0.62 && tex[i] > mY * 0.05 ? 1 : 0; // dunkel UND strukturiert = Haare, Bart
  const darkD = gauss(dark, aw, ah, 4 * s);

  // Hautmaske
  const skin = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dcb = (Cb[i] - mCb) / (sCb * 4), dcr = (Cr[i] - mCr) / (sCr * 4);
    let col = Math.exp(-0.5 * (dcb * dcb + dcr * dcr));
    col *= smooth(mY * 0.28, mY * 0.5, Y[i]);
    const texOk = 1 - smooth(0.06, 0.11, texS[i] / Math.max(20, mY));
    const reg = Math.max(faceS[i], neckS[i] * 0.85 * texOk);
    skin[i] = clamp(reg * col * (1 - featS[i]), 0, 1);
  }
  const skinS = gauss(skin, aw, ah, 1.5 * s);

  // Pickel Kandidaten: dunkler, röter oder (Mitesser) heller als die Umgebung, klein und rund.
  // Bewertet relativ zur eigenen Haut der Person (robuste Statistik), damit Poren und Hautstruktur nie zählen.
  // Ring Test: ein Fleck ist in ALLEN Richtungen von hellerer (bzw. weniger roter) Haut umgeben.
  // Kanten, Falten und Schatten sind nur auf einer Seite dunkler und fallen dadurch raus.
  const Yb1 = gauss(Y, aw, ah, 1.0 * s), Crb1 = gauss(Cr, aw, ah, 1.0 * s);
  const Ys = gauss(Y, aw, ah, 1.6 * s), Crs = gauss(Cr, aw, ah, 1.6 * s);
  const dA = new Float32Array(n), rA = new Float32Array(n), bA = new Float32Array(n), allow = new Uint8Array(n);
  const sd = [], sr = [], sb = [];
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];
  const RADII = [4 * s, 7.5 * s, 12 * s], RV = new Float32Array(8), RC = new Float32Array(8);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const i = y * aw + x;
    const ok = skinS[i] > 0.4 && featBigS[i] < 0.2 && darkD[i] < 0.12;
    allow[i] = ok ? 1 : 0;
    if (!ok) continue;
    let bd = -1, br = -99, bb = -1;
    for (const R of RADII) {
      // drittkleinster bzw. drittgrößter Ringwert: Nachbarflecken stören nicht, Kanten (3 dunkle Richtungen) schon
      for (let k = 0; k < 8; k++) {
        const xx = Math.min(aw - 1, Math.max(0, Math.round(x + DIRS[k][0] * R))), yy = Math.min(ah - 1, Math.max(0, Math.round(y + DIRS[k][1] * R)));
        const j = yy * aw + xx; RV[k] = Ys[j]; RC[k] = Crs[j];
      }
      RV.sort(); RC.sort();
      const mn = RV[2], mx = RV[5], cmax = RC[5];
      bd = Math.max(bd, (mn - Yb1[i]) / Math.max(20, mn));
      br = Math.max(br, Crb1[i] - cmax);
      bb = Math.max(bb, (Yb1[i] - mx) / Math.max(20, mx));
    }
    dA[i] = bd; rA[i] = br; bA[i] = bb;
    if ((i & 3) === 0) { sd.push(bd); sr.push(br); sb.push(bb); }
  }
  const stat = (arr) => { const m = median(arr); return [m, Math.max(1e-3, median(arr.map((v) => Math.abs(v - m))) * 1.4826)]; };
  const [mdD, sdD] = stat(sd), [mdR, sdR] = stat(sr), [mdB, sdB] = stat(sb);
  const score = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!allow[i]) continue;
    const zd = dA[i] > 0.02 ? (dA[i] - mdD) / Math.max(sdD, 0.01) : 0;
    const zr = rA[i] > 1.5 ? (rA[i] - mdR) / Math.max(sdR, 0.8) : 0;
    const zb = bA[i] > 0.04 ? (bA[i] - mdB) / Math.max(sdB, 0.01) / 1.4 : 0;
    score[i] = Math.max(zd, zr * 0.9, zb, 0.6 * (zd + zr * 0.9));
  }

  // Dunkle Flecken (Pigmentflecken, Aknemale): größer und flacher als Pickel, nur dunkler als die Haut rundherum
  const Yp = gauss(Y, aw, ah, 3 * s);
  const RP = [12 * s, 20 * s, 30 * s];
  const pA = new Float32Array(n), sp = [];
  const featHuge = grow(featBig, aw, ah, fw * 0.05, 0);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const i = y * aw + x;
    if (!allow[i] || featHuge[i] > 0.15) continue;
    let bp = -1;
    for (const R of RP) {
      for (let k = 0; k < 8; k++) {
        const xx = Math.min(aw - 1, Math.max(0, Math.round(x + DIRS[k][0] * R))), yy = Math.min(ah - 1, Math.max(0, Math.round(y + DIRS[k][1] * R)));
        RV[k] = Yp[yy * aw + xx];
      }
      RV.sort();
      bp = Math.max(bp, (RV[2] - Yp[i]) / Math.max(20, RV[2]));
    }
    pA[i] = bp;
    if ((i & 3) === 0) sp.push(bp);
  }
  const [mdP, sdP] = stat(sp);
  const scoreP = new Float32Array(n);
  for (let i = 0; i < n; i++) if (allow[i] && pA[i] > 0.035) scoreP[i] = (pA[i] - mdP) / Math.max(sdP, 0.01);

  // Augen und Zähne
  const eye = new Float32Array(n);
  fillPoly(eye, aw, ah, scalePoly(eyeL, 1.05)); fillPoly(eye, aw, ah, scalePoly(eyeR, 1.05));
  const eyeS = gauss(eye, aw, ah, fw * 0.006);
  const teeth = new Float32Array(n);
  const innerArea = polyArea(lipsInner);
  let mouthY = 0, hasTeeth = false;
  if (innerArea > fw * fw * 0.004) {
    fillPoly(teeth, aw, ah, scalePoly(lipsInner, 0.96));
    const vals = []; for (let i = 0; i < n; i++) if (teeth[i] > 0.5) vals.push(Y[i]);
    vals.sort((p, q) => p - q);
    mouthY = vals.length ? vals[Math.floor(vals.length * 0.85)] : 0;
    hasTeeth = vals.length > 20 && mouthY > mY * 0.7;
  }
  const teethS = hasTeeth ? gauss(teeth, aw, ah, fw * 0.004) : null;

  // Kanten für Augenwinkel etc. bleiben unberührt
  return {
    idx, cx0, cy0, cw, ch, aw, ah, ax, ay, s, fw, faceWFull: faceW, A, Y,
    stats: { mdD, sdD, mdR, sdR, mdB, sdB }, dA, rA,
    scoreP, labelP: new Int32Array(n), mp: null, PD: null,
    skin: skinS, score, allow, eye: eyeS, teeth: teethS, mouthY, mY,
    label: new Int32Array(n), comps: [], mb: new Float32Array(n), H: null, B2: null, B3: null,
    lm: lmFull, box: [cx0, cy0, cw, ch]
  };
}

/* Pickel Maske aus Empfindlichkeit + manuellen Punkten neu berechnen (schnell) */
export function updateBlemishes(F, sens, spots, sensP = 0) {
  const { aw, ah, s, score, allow, label } = F, n = aw * ah;
  const T = 7.5 - 5.0 * sens; // z Schwelle, sens 0..1
  label.fill(0);
  const comps = [];
  const stack = new Int32Array(n);
  const maxArea = Math.PI * (12 * s) ** 2, grow2 = T * 0.5;
  const toA = (fx, fy) => [(fx - F.cx0) / F.ax, (fy - F.cy0) / F.ay];
  const removes = (spots || []).filter((p) => p.m === "r").map((p) => { const q = toA(p.x, p.y); return [q[0], q[1], p.r / F.ax]; });
  if (sens > 0.001) {
    for (let i = 0; i < n; i++) {
      if (label[i] || score[i] < T || !allow[i]) continue;
      const id = comps.length + 1;
      let sp = 0, area = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, peak = 0, sx = 0, sy = 0;
      stack[sp++] = i; label[i] = id;
      while (sp) {
        const p = stack[--sp], x = p % aw, y = (p / aw) | 0;
        area++; sx += x; sy += y; peak = Math.max(peak, score[p]);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (area > maxArea * 1.5) continue;
        const nb = [p - 1, p + 1, p - aw, p + aw];
        if (x === 0) nb[0] = -1; if (x === aw - 1) nb[1] = -1;
        for (const q of nb) if (q >= 0 && q < n && !label[q] && allow[q] && score[q] >= grow2) { label[q] = id; stack[sp++] = q; }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1, ext = Math.max(bw, bh);
      let ok = area <= maxArea && ext * ext / area < 7.5 && area >= 1;
      const cxp = sx / area, cyp = sy / area;
      if (ok) for (const r of removes) if (Math.hypot(r[0] - cxp, r[1] - cyp) < r[2] + ext / 2) ok = false;
      comps.push({ id, ok, x: cxp, y: cyp, rad: Math.sqrt(area / Math.PI), peak });
    }
  }
  const hard = new Float32Array(n);
  for (let i = 0; i < n; i++) if (label[i] && comps[label[i] - 1].ok) hard[i] = 1;
  for (const c of comps) if (c.ok) fillDisc(hard, aw, ah, c.x + 0.5, c.y + 0.5, c.rad * 1.35 + 1.2 * s);
  let manual = 0;
  for (const p of spots || []) {
    if (p.m !== "a") continue;
    const q = toA(p.x, p.y);
    if (q[0] < -5 || q[1] < -5 || q[0] > aw + 5 || q[1] > ah + 5) continue;
    fillDisc(hard, aw, ah, q[0], q[1], p.r / F.ax); manual++;
  }
  F.comps = comps;
  F.count = comps.filter((c) => c.ok).length + manual;
  // weich und etwas größer als der Fleck, damit kein Rand bleibt
  const mb = grow(hard, aw, ah, 1.8 * s, 1.1 * s);
  for (let i = 0; i < n; i++) mb[i] = Math.min(1, mb[i]);
  F.mb = mb;
  // Ersatzfarbe aus der Haut rundherum (ohne Fleck), wie Reparaturpinsel
  const wgt = new Float32Array(n), hardD = grow(hard, aw, ah, 2.5 * s, 0);
  for (let i = 0; i < n; i++) wgt[i] = F.skin[i] > 0.3 ? (1 - Math.min(1, hardD[i])) * F.skin[i] : 0;
  const B2o = F.A.map((c) => gauss(c, aw, ah, 6 * s));
  F.H = normConv(F.A, wgt, aw, ah, 5 * s, B2o);
  // geheilte Version für Mitten und Tiefen
  const Ah = F.A.map((c, k) => { const o = new Float32Array(n); const h = F.H[k]; for (let i = 0; i < n; i++) o[i] = c[i] + mb[i] * (h[i] - c[i]); return o; });
  F.B2 = Ah.map((c) => gauss(c, aw, ah, 6 * s));
  const wsk = new Float32Array(n); for (let i = 0; i < n; i++) wsk[i] = F.skin[i] > 0.25 ? F.skin[i] : 0;
  F.B3 = normConv(Ah, wsk, aw, ah, 18 * s, F.B2);
  // Dunkle Flecken: nur tiefe Frequenzen angleichen, Struktur bleibt vollständig
  F.countP = 0; F.mp = null; F.PD = null;
  if (sensP > 0.001) {
    const TP = 7.5 - 5.0 * sensP, gP = TP * 0.5, lab = F.labelP, sc = F.scoreP;
    lab.fill(0);
    const maxP = Math.PI * (32 * s) ** 2, hardP = new Float32Array(n);
    let id = 0;
    for (let i = 0; i < n; i++) {
      if (lab[i] || sc[i] < TP || !allow[i]) continue;
      id++;
      let sp = 0, area = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      const members = [];
      stack[sp++] = i; lab[i] = id;
      while (sp) {
        const p = stack[--sp], x = p % aw, y = (p / aw) | 0;
        area++; members.push(p);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (area > maxP * 1.5) continue;
        const nb = [x > 0 ? p - 1 : -1, x < aw - 1 ? p + 1 : -1, p - aw, p + aw];
        for (const q of nb) if (q >= 0 && q < n && !lab[q] && allow[q] && sc[q] >= gP) { lab[q] = id; stack[sp++] = q; }
      }
      const ext = Math.max(x1 - x0 + 1, y1 - y0 + 1);
      if (area <= maxP && area >= Math.PI * (2.5 * s) ** 2 && (ext * ext) / area < 10) { for (const m of members) hardP[m] = 1; F.countP++; }
    }
    if (F.countP) {
      const keep = grow(hardP, aw, ah, 4 * s, 0);
      const wP = new Float32Array(n);
      for (let i = 0; i < n; i++) wP[i] = F.skin[i] > 0.3 ? F.skin[i] * (1 - Math.min(1, keep[i])) : 0;
      const Hp = normConv(Ah, wP, aw, ah, 12 * s, F.B2);
      const mp = grow(hardP, aw, ah, 2.5 * s, 3.5 * s);
      F.mp = mp;
      F.PD = Ah.map((c, k) => {
        const L = gauss(c, aw, ah, 4 * s), d = new Float32Array(n), h = Hp[k];
        for (let i = 0; i < n; i++) { const m = Math.min(1, mp[i]) * (F.skin[i] > 0.2 ? 1 : F.skin[i] * 5); d[i] = m * (h[i] - L[i]); }
        return gauss(d, aw, ah, 2 * s);
      });
    }
  }
  return F.count + F.countP;
}

/* ---------- Rendern ---------- */
function sampler(F) {
  const { aw, ah } = F;
  return (field, ax, ay) => {
    if (ax < 0) ax = 0; else if (ax > aw - 1.001) ax = aw - 1.001;
    if (ay < 0) ay = 0; else if (ay > ah - 1.001) ay = ah - 1.001;
    const x0 = ax | 0, y0 = ay | 0, tx = ax - x0, ty = ay - y0, o = y0 * aw + x0;
    return (field[o] * (1 - tx) + field[o + 1] * tx) * (1 - ty) + (field[o + aw] * (1 - tx) + field[o + aw + 1] * tx) * ty;
  };
}

/* Retusche eines Gesichts in den Arbeitspuffer (planar R,G,B, Region rx,ry,rw,rh im Quellbild, k = Originalpixel pro Quellpixel) */
function synthFace(pl, rx, ry, rw, rh, k, F, P, skinMap) {
  const tx0 = Math.max(rx, Math.floor(F.cx0 / k)), tx1 = Math.min(rx + rw, Math.ceil((F.cx0 + F.cw) / k));
  const ty0 = Math.max(ry, Math.floor(F.cy0 / k)), ty1 = Math.min(ry + rh, Math.ceil((F.cy0 + F.ch) / k));
  if (tx1 <= tx0 || ty1 <= ty0) return;
  const r1 = (1.2 * F.faceWFull / 400) / k;
  const pad = Math.ceil(r1 * 3) + 1;
  const ex0 = Math.max(rx, tx0 - pad), ex1 = Math.min(rx + rw, tx1 + pad), ey0 = Math.max(ry, ty0 - pad), ey1 = Math.min(ry + rh, ty1 + pad);
  const ew = ex1 - ex0, eh = ey1 - ey0;
  const sub = [new Float32Array(ew * eh), new Float32Array(ew * eh), new Float32Array(ew * eh)];
  for (let y = 0; y < eh; y++) { const so = (ey0 - ry + y) * rw + (ex0 - rx); for (let c = 0; c < 3; c++) sub[c].set(pl[c].subarray(so, so + ew), y * ew); }
  const B1 = sub.map((c) => gauss(c, ew, eh, r1));
  const S = sampler(F);
  const amS = P.skin / 100, amT = P.tone / 100, amE = P.eyes / 100, amZ = P.teeth / 100;
  const doTeeth = F.teeth && amZ > 0;
  for (let y = ty0; y < ty1; y++) {
    const fy = (y + 0.5) * k, ay = (fy - F.cy0) / F.ay - 0.5;
    for (let x = tx0; x < tx1; x++) {
      const fx = (x + 0.5) * k, ax = (fx - F.cx0) / F.ax - 0.5;
      const sk = S(F.skin, ax, ay), mb = S(F.mb, ax, ay), ey = amE > 0 ? S(F.eye, ax, ay) : 0;
      const th = doTeeth ? S(F.teeth, ax, ay) : 0;
      const mpv = F.mp ? S(F.mp, ax, ay) : 0;
      if (sk < 0.002 && mb < 0.002 && ey < 0.002 && th < 0.002 && mpv < 0.002) continue;
      const so = (y - ey0) * ew + (x - ex0), po = (y - ry) * rw + (x - rx);
      if (skinMap && sk > skinMap[po]) skinMap[po] = sk;
      const O = [sub[0][so], sub[1][so], sub[2][so]];
      const out = [0, 0, 0];
      const low = [0, 0, 0];
      const mid = [0, 0, 0], fine = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const b1 = B1[c][so], h = S(F.H[c], ax, ay), b2 = S(F.B2[c], ax, ay);
        const fn = O[c] - b1;
        const b1h = b1 + mb * (h - b1);
        fine[c] = fn * (1 - 0.55 * mb);
        mid[c] = (b1h - b2) * (1 - amS * 0.9 * sk);
        low[c] = b2;
      }
      if (amT > 0 && sk > 0.002) {
        const b3r = S(F.B3[0], ax, ay), b3g = S(F.B3[1], ax, ay), b3b = S(F.B3[2], ax, ay);
        const Y = luma(low[0], low[1], low[2]), cb = toCb(low[0], low[1], low[2]), cr = toCr(low[0], low[1], low[2]);
        const Y3 = luma(b3r, b3g, b3b), cb3 = toCb(b3r, b3g, b3b), cr3 = toCr(b3r, b3g, b3b);
        const f = amT * sk;
        const Yn = Y - f * 0.55 * (Y - Y3), cbn = cb - f * 0.85 * (cb - cb3), crn = cr - f * 0.85 * (cr - cr3);
        low[0] = Yn + 1.402 * crn; low[1] = Yn - 0.344136 * cbn - 0.714136 * crn; low[2] = Yn + 1.772 * cbn;
      }
      for (let c = 0; c < 3; c++) out[c] = low[c] + mid[c] + fine[c];
      if (F.PD) for (let c = 0; c < 3; c++) out[c] += S(F.PD[c], ax, ay);
      if (ey > 0.002) {
        const Y = luma(out[0], out[1], out[2]);
        const lift = amE * ey * 0.5 * Y * (1 - Math.min(255, Y) / 255);
        const ratio = Y > 1 ? (Y + lift) / Y : 1;
        for (let c = 0; c < 3; c++) out[c] = out[c] * ratio + amE * ey * 0.45 * (mid[c] + fine[c]);
      }
      if (th > 0.002) {
        const Y = luma(out[0], out[1], out[2]), cb = toCb(out[0], out[1], out[2]), cr = toCr(out[0], out[1], out[2]);
        const t = smooth(F.mouthY * 0.55, F.mouthY * 0.85, Y) * (1 - smooth(10, 24, cr)) * th * amZ;
        if (t > 0.001) {
          const Yn = Y + t * 0.16 * (255 - Y), cbn = cb < 0 ? cb * (1 - 0.8 * t) : cb, crn = cr * (1 - 0.35 * t);
          out[0] = Yn + 1.402 * crn; out[1] = Yn - 0.344136 * cbn - 0.714136 * crn; out[2] = Yn + 1.772 * cbn;
        }
      }
      for (let c = 0; c < 3; c++) pl[c][po] = out[c];
    }
  }
}

/* Entrauschen: Luminanz kantenerhaltend (Guided Filter), Farbrauschen weich */
function denoise(pl, w, h, amt, sigmaT, k) {
  if (amt <= 0) return;
  const n = w * h, Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let i = 0; i < n; i++) { const r = pl[0][i], g = pl[1][i], b = pl[2][i]; Y[i] = luma(r, g, b); Cb[i] = toCb(r, g, b); Cr[i] = toCr(r, g, b); }
  const sig = Math.max(0.4, sigmaT);
  const rad = Math.max(1, Math.round(k < 1.5 ? 2 : 1));
  const eps = (2.2 * sig) ** 2 * (0.4 + amt);
  const box = (src) => { const t1 = new Float32Array(n), t2 = new Float32Array(n); boxPass(src, t1, w, h, rad, true); boxPass(t1, t2, w, h, rad, false); return t2; };
  const mI = box(Y), YY = new Float32Array(n); for (let i = 0; i < n; i++) YY[i] = Y[i] * Y[i];
  const mII = box(YY), av = new Float32Array(n), bv = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = mII[i] - mI[i] * mI[i], a = v / (v + eps); av[i] = a; bv[i] = mI[i] * (1 - a); }
  const ma = box(av), mbb = box(bv);
  const cs = Math.max(0.6, 2.5 / Math.sqrt(k)) * (0.6 + amt);
  const Cbs = gauss(Cb, w, h, cs), Crs = gauss(Cr, w, h, cs);
  for (let i = 0; i < n; i++) {
    const q = ma[i] * Y[i] + mbb[i];
    const Yn = Y[i] + amt * (q - Y[i]), cb = Cb[i] + Math.min(1, amt * 1.2) * (Cbs[i] - Cb[i]), cr = Cr[i] + Math.min(1, amt * 1.2) * (Crs[i] - Cr[i]);
    pl[0][i] = Yn + 1.402 * cr; pl[1][i] = Yn - 0.344136 * cb - 0.714136 * cr; pl[2][i] = Yn + 1.772 * cb;
  }
}

/* Details (Klarheit + Mikrokontrast) und Ausgabeschärfe, Haut wird geschont */
function detailAndSharpen(pl, w, h, P, k, longEdgeFull, skinMap) {
  const amD = P.detail / 100, amS = P.sharpen / 100;
  if (amD <= 0 && amS <= 0) return;
  const n = w * h, Y = new Float32Array(n);
  for (let i = 0; i < n; i++) Y[i] = luma(pl[0][i], pl[1][i], pl[2][i]);
  const dY = new Float32Array(n);
  if (amD > 0) {
    const big = gauss(Y, w, h, Math.max(2, (0.006 * longEdgeFull) / k));
    const small = gauss(Y, w, h, Math.max(0.6, 1.4 / k));
    for (let i = 0; i < n; i++) {
      const sk = skinMap ? skinMap[i] : 0;
      let c = Y[i] - big[i]; c = 40 * Math.tanh(c / 40);
      const m = Y[i] - small[i];
      dY[i] += amD * (0.55 * c * (1 - 0.6 * sk) + 0.6 * m * (1 - 0.7 * sk));
    }
  }
  if (amS > 0) {
    const bl = gauss(Y, w, h, Math.max(0.55, 0.9 / k));
    for (let i = 0; i < n; i++) {
      const sk = skinMap ? skinMap[i] : 0;
      let d = Y[i] - bl[i]; const ad = Math.abs(d);
      if (ad < 2) d *= ad / 2;
      dY[i] += amS * 1.3 * d * (1 - 0.55 * sk);
    }
  }
  for (let i = 0; i < n; i++) { const d = dY[i]; pl[0][i] += d; pl[1][i] += d; pl[2][i] += d; }
}

/* Licht: Belichtung, Kontrast, Wärme als Tabellen */
function lightLUT(P) {
  const ev = P.exposure / 50, con = P.contrast / 100, warm = P.warmth / 100;
  if (!ev && !con && !warm) return null;
  const mul = [Math.pow(2, ev) * (1 + 0.12 * warm), Math.pow(2, ev) * (1 + 0.01 * warm), Math.pow(2, ev) * (1 - 0.14 * warm)];
  const luts = [];
  for (let c = 0; c < 3; c++) {
    const L = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      let v = i / 1023;
      let lin = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      lin *= mul[c];
      if (lin > 0.75) lin = 0.75 + 0.25 * Math.tanh((lin - 0.75) / 0.25); // weiche Lichter
      v = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
      if (con > 0) v = v + con * (v * v * (3 - 2 * v) - v);
      else if (con < 0) v = v + con * 0.5 * (v - 0.5);
      L[i] = clamp(v, 0, 1) * 255;
    }
    luts.push(L);
  }
  return luts;
}

/* Region rendern. src = {w,h,data RGB Uint8, k}. Gibt planar Float32 zurück */
export function renderRegion(src, rx, ry, rw, rh, P, faces, G, opts = {}) {
  const n = rw * rh, k = src.k;
  const pl = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const d = src.data, W = src.w;
  for (let y = 0; y < rh; y++) {
    let si = ((ry + y) * W + rx) * 3, o = y * rw;
    for (let x = 0; x < rw; x++, si += 3, o++) { pl[0][o] = d[si]; pl[1][o] = d[si + 1]; pl[2][o] = d[si + 2]; }
  }
  applyPatches(pl, rx, ry, rw, rh, k, src.ox || 0, src.oy || 0, G.patches);
  denoise(pl, rw, rh, P.denoise / 100, G.noise / Math.max(1, k), k);
  const skinMap = new Float32Array(n);
  if (faces) for (const F of faces) if (F.H) synthFace(pl, rx, ry, rw, rh, k, F, P, skinMap);
  detailAndSharpen(pl, rw, rh, P, k, G.longEdge, skinMap);
  const luts = lightLUT(P);
  if (luts) for (let c = 0; c < 3; c++) { const L = luts[c], p = pl[c]; for (let i = 0; i < n; i++) { const v = p[i]; p[i] = L[v <= 0 ? 0 : v >= 255 ? 1023 : (v * 4.0118) | 0]; } }
  if (opts.mask && faces) overlayMask(pl, rx, ry, rw, rh, k, faces);
  return pl;
}

function overlayMask(pl, rx, ry, rw, rh, k, faces) {
  for (const F of faces) {
    if (!F.H) continue;
    const S = sampler(F);
    const tx0 = Math.max(rx, Math.floor(F.cx0 / k)), tx1 = Math.min(rx + rw, Math.ceil((F.cx0 + F.cw) / k));
    const ty0 = Math.max(ry, Math.floor(F.cy0 / k)), ty1 = Math.min(ry + rh, Math.ceil((F.cy0 + F.ch) / k));
    for (let y = ty0; y < ty1; y++) {
      const ay = ((y + 0.5) * k - F.cy0) / F.ay - 0.5;
      for (let x = tx0; x < tx1; x++) {
        const ax = ((x + 0.5) * k - F.cx0) / F.ax - 0.5, o = (y - ry) * rw + (x - rx);
        const sk = S(F.skin, ax, ay) * 0.42, mb = Math.min(1, S(F.mb, ax, ay) * 1.4);
        if (sk > 0.002) { pl[0][o] += (214 - pl[0][o]) * sk; pl[1][o] += (178 - pl[1][o]) * sk; pl[2][o] += (110 - pl[2][o]) * sk; }
        const mpv = F.mp ? Math.min(1, S(F.mp, ax, ay)) : 0;
        if (mpv > 0.2) { const m = mpv * 0.55; pl[0][o] += (150 - pl[0][o]) * m; pl[1][o] += (95 - pl[1][o]) * m; pl[2][o] += (255 - pl[2][o]) * m; }
        if (mb > 0.15) { const m = mb * 0.85; pl[0][o] += (255 - pl[0][o]) * m; pl[1][o] += (40 - pl[1][o]) * m; pl[2][o] += (140 - pl[2][o]) * m; }
      }
    }
  }
}

export function planarToRGBA(pl, w, h, out) {
  out = out || new Uint8ClampedArray(w * h * 4);
  for (let i = 0, o = 0; i < w * h; i++, o += 4) { out[o] = pl[0][i]; out[o + 1] = pl[1][i]; out[o + 2] = pl[2][i]; out[o + 3] = 255; }
  return out;
}

/* Ganzes Bild in Streifen rendern (für Export), Ergebnis RGB Uint8 */
export function renderFull(src, P, faces, G, onProgress) {
  const out = new Uint8Array(src.w * src.h * 3);
  const pad = Math.ceil(Math.max(12, (P.detail > 0 ? 3 * (0.006 * G.longEdge) / src.k : 0) + 6));
  const STRIP = 384;
  for (let y = 0; y < src.h; y += STRIP) {
    const y0 = Math.max(0, y - pad), y1 = Math.min(src.h, y + STRIP + pad);
    const pl = renderRegion(src, 0, y0, src.w, y1 - y0, P, faces, G);
    const ys = y - y0, ye = Math.min(STRIP, src.h - y);
    for (let yy = 0; yy < ye; yy++) {
      let i = (ys + yy) * src.w, o = (y + yy) * src.w * 3;
      for (let x = 0; x < src.w; x++, i++, o += 3) {
        const r = pl[0][i], g = pl[1][i], b = pl[2][i];
        out[o] = r < 0 ? 0 : r > 255 ? 255 : r + 0.5; out[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g + 0.5; out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b + 0.5;
      }
    }
    if (onProgress) onProgress(Math.min(1, (y + STRIP) / src.h));
  }
  return out;
}

/* Tippen. mode "add": Stelle entfernen (nie rückgängig, bereits markierte bleiben markiert).
 * mode "keep": erkannte Stelle behalten bzw. eigene Markierung wieder aufheben. */
export function toggleSpot(faces, spots, fx, fy, mode = "add") {
  spots = (spots || []).slice();
  let best = null, bd = Infinity;
  for (const F of faces) {
    const cx = F.cx0 + F.cw / 2, cy = F.cy0 + F.ch / 2, dd = Math.hypot(cx - fx, cy - fy);
    if (dd < bd) { bd = dd; best = F; }
  }
  const r = best ? best.faceWFull * 0.022 : 12;
  const hitSpot = (m) => { for (let i = spots.length - 1; i >= 0; i--) { const p = spots[i]; if (p.m === m && Math.hypot(p.x - fx, p.y - fy) <= Math.max(p.r * 1.3, 4)) return i; } return -1; };
  let comp = null;
  if (best && best.H) {
    const ax = Math.round((fx - best.cx0) / best.ax), ay = Math.round((fy - best.cy0) / best.ay);
    const rr = Math.max(2, Math.round((r / best.ax) * 0.6));
    for (let dy = -rr; dy <= rr && !comp; dy++) for (let dx = -rr; dx <= rr; dx++) {
      const x = ax + dx, y = ay + dy;
      if (x < 0 || y < 0 || x >= best.aw || y >= best.ah) continue;
      const l = best.label[y * best.aw + x];
      if (l && best.comps[l - 1] && best.comps[l - 1].ok) { comp = best.comps[l - 1]; break; }
    }
  }
  if (mode === "keep") {
    const ia = hitSpot("a"); if (ia >= 0) { spots.splice(ia, 1); return { spots, action: "unmarked" }; }
    const ir = hitSpot("r"); if (ir >= 0) return { spots, action: "alreadyKept" };
    if (comp) { spots.push({ x: best.cx0 + comp.x * best.ax, y: best.cy0 + comp.y * best.ay, r: Math.max(r * 0.5, comp.rad * best.ax), m: "r" }); return { spots, action: "kept" }; }
    return { spots, action: "nothing" };
  }
  // add: eine behaltene Stelle wird durch Antippen wieder entfernt, sonst nur hinzufügen
  const ir = hitSpot("r"); if (ir >= 0) { spots.splice(ir, 1); return { spots, action: "restored" }; }
  if (comp || hitSpot("a") >= 0) return { spots, action: "already" };
  spots.push({ x: fx, y: fy, r, m: "a" });
  return { spots, action: "added" };
}

/* ---------- Entfernen Pinsel (wie Lightroom) ----------
 * Strich = Liste von Punkten mit Radius (Originalpixel).
 * Sucht automatisch eine passende Quelle daneben, kopiert deren Struktur
 * und gleicht Farbe und Helligkeit am Rand an (Reparaturpinsel Prinzip).
 */
export function buildPatch(img, stroke) {
  const r = stroke.r, pts = stroke.pts;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); }
  const ring = Math.max(3, Math.round(r * 0.5));
  const bx = Math.max(0, Math.floor(x0 - ring - 2)), by = Math.max(0, Math.floor(y0 - ring - 2));
  const bx1 = Math.min(img.w, Math.ceil(x1 + ring + 2)), by1 = Math.min(img.h, Math.ceil(y1 + ring + 2));
  const bw = bx1 - bx, bh = by1 - by;
  if (bw < 2 || bh < 2) return null;
  const n = bw * bh;
  const m = new Float32Array(n);
  const lp = pts.map(([x, y]) => [x - bx, y - by]);
  if (lp.length === 1) fillDisc(m, bw, bh, lp[0][0], lp[0][1], r);
  for (let i = 1; i < lp.length; i++) capsule(m, bw, bh, lp[i - 1], lp[i], r);
  const big = grow(m, bw, bh, ring, 0);
  const ringW = new Float32Array(n);
  for (let i = 0; i < n; i++) ringW[i] = big[i] > 0.5 && m[i] < 0.5 ? 1 : 0;
  const d = img.data, W = img.w;
  const T = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const s = ((by + y) * W + bx + x) * 3, o = y * bw + x; T[0][o] = d[s]; T[1][o] = d[s + 1]; T[2][o] = d[s + 2]; }
  // Quelle suchen: Kandidaten rund um die Stelle, Bewertung am Rand (Struktur und Helligkeit)
  const step = Math.max(1, Math.round(Math.sqrt(n / 6000)));
  const ringIdx = [], inIdx = [];
  for (let y = 0; y < bh; y += step) for (let x = 0; x < bw; x += step) { const o = y * bw + x; if (ringW[o]) ringIdx.push(o); else if (m[o] > 0.5) inIdx.push(o); }
  const lum = (src, sx, sy, o) => { const x = o % bw, y = (o / bw) | 0, s = ((sy + y) * W + sx + x) * 3; return 0.299 * src[s] + 0.587 * src[s + 1] + 0.114 * src[s + 2]; };
  let tMean = 0; for (const o of ringIdx) tMean += lum(d, bx, by, o); tMean /= Math.max(1, ringIdx.length);
  let tVar = 0; for (const o of ringIdx) { const v = lum(d, bx, by, o) - tMean; tVar += v * v; } tVar /= Math.max(1, ringIdx.length);
  const size = Math.max(x1 - x0, y1 - y0);
  let best = null;
  for (const f of [0.75, 1.1, 1.6, 2.3]) {
    const dist = size * f + r * 0.5;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2, ox = Math.round(Math.cos(ang) * dist), oy = Math.round(Math.sin(ang) * dist);
      const sx = bx + ox, sy = by + oy;
      if (sx < 0 || sy < 0 || sx + bw > img.w || sy + bh > img.h) continue;
      let sMean = 0; for (const o of ringIdx) sMean += lum(d, sx, sy, o); sMean /= Math.max(1, ringIdx.length);
      let e = 0; for (const o of ringIdx) { const v = lum(d, bx, by, o) - tMean - (lum(d, sx, sy, o) - sMean); e += v * v; }
      e /= Math.max(1, ringIdx.length);
      // Innen soll die Quelle so ruhig sein wie der Rand der Zielstelle (keine Kanten hineinkopieren)
      let im = 0, iv = 0; for (const o of inIdx) im += lum(d, sx, sy, o); im /= Math.max(1, inIdx.length);
      for (const o of inIdx) { const v = lum(d, sx, sy, o) - im; iv += v * v; } iv /= Math.max(1, inIdx.length);
      const score = e + Math.abs(iv - tVar) * 0.6 + Math.abs(sMean - tMean) * 0.8 + f * 4;
      if (!best || score < best.score) best = { score, sx, sy };
    }
  }
  let S;
  if (best) {
    S = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const s = ((best.sy + y) * W + best.sx + x) * 3, o = y * bw + x; S[0][o] = d[s]; S[1][o] = d[s + 1]; S[2][o] = d[s + 2]; }
  } else {
    // keine Quelle möglich (Bildrand): nur glatt auffüllen
    S = normConv(T, ringW, bw, bh, Math.max(2, r * 0.8));
  }
  // Rand Differenz ins Innere ziehen (nahtloser Übergang)
  const D = [0, 1, 2].map((c) => { const t = new Float32Array(n); for (let i = 0; i < n; i++) t[i] = ringW[i] ? T[c][i] - S[c][i] : 0; return t; });
  const Dc = normConv(D, ringW, bw, bh, Math.max(2, r * 0.6), D.map(() => new Float32Array(n)));
  const A = gauss(grow(m, bw, bh, Math.max(1, r * 0.15), 0), bw, bh, Math.max(0.8, r * 0.18));
  const R = [0, 1, 2].map((c) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = S[c][i] + Dc[c][i]; return o; });
  return { bx, by, bw, bh, R, A };
}

export function applyPatches(pl, rx, ry, rw, rh, k, ox, oy, patches) {
  if (!patches || !patches.length) return;
  for (const p of patches) {
    if (!p) continue;
    const tx0 = Math.max(rx, Math.floor((p.bx - ox) / k)), tx1 = Math.min(rx + rw, Math.ceil((p.bx + p.bw - ox) / k));
    const ty0 = Math.max(ry, Math.floor((p.by - oy) / k)), ty1 = Math.min(ry + rh, Math.ceil((p.by + p.bh - oy) / k));
    for (let y = ty0; y < ty1; y++) {
      const py = clamp((y + 0.5) * k + oy - p.by - 0.5, 0, p.bh - 1.001), y0 = py | 0, fy = py - y0;
      for (let x = tx0; x < tx1; x++) {
        const px = clamp((x + 0.5) * k + ox - p.bx - 0.5, 0, p.bw - 1.001), x0 = px | 0, fx = px - x0, o = y0 * p.bw + x0;
        const bil = (f) => (f[o] * (1 - fx) + f[o + 1] * fx) * (1 - fy) + (f[o + p.bw] * (1 - fx) + f[o + p.bw + 1] * fx) * fy;
        const a = bil(p.A);
        if (a < 0.003) continue;
        const t = (y - ry) * rw + (x - rx);
        for (let c = 0; c < 3; c++) pl[c][t] += (bil(p.R[c]) - pl[c][t]) * a;
      }
    }
  }
}
