# Retusche Studio Engine API

Die gesamte Bildbearbeitung steckt in diesen Dateien. Sie sind fertig, getestet und dürfen NICHT neu geschrieben, vereinfacht oder durch Attrappen ersetzt werden:

| Datei | Aufgabe |
| --- | --- |
| `js/engine.js` | Retusche Mathematik: Hautmaske, Pickel und Flecken Erkennung, Frequenztrennung, Reparatur, Entrauschen, Schärfe, Licht |
| `js/worker.js` | Web Worker (ES Modul). Hält das Bild in voller Auflösung und rechnet alles im Hintergrund |
| `lib/face-api/face-api.esm.js` + `models/face/` | Gesichtserkennung mit 68 Punkten (läuft im Hauptthread) |
| `lib/libraw/` | RAW Entwicklung (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2) |
| `lib/jpeg/` | JPEG lesen und schreiben für Bilder über 16 MP |
| `models/esrgan/` | KI Modell für Super Resolution 2× (TensorFlow.js über face-api `faceapi.tf`) |

In einem Vite oder React Projekt gehören diese Ordner unverändert nach `public/`, damit relative Pfade, Worker und Modelle 1:1 funktionieren.

## Worker starten

```js
const W = new Worker("/js/worker.js?v=11", { type: "module" });
```

## Ablauf

1. **Bild laden**
   * Normale Bilder bis 16 MP: im Hauptthread dekodieren (`<img>` + Canvas, beachtet die EXIF Ausrichtung), in RGB ohne Alpha umwandeln:
     `W.postMessage({ type: "image", w, h, data: rgbArrayBuffer }, [rgbArrayBuffer])`
   * JPEG über 16 MP: `W.postMessage({ type: "jpeg", bytes: arrayBuffer, orientation }, [arrayBuffer])`
   * RAW: mit `lib/libraw/index.js` entwickeln (`outputBps: 8, useCameraWb: true, userQual: 3`), dann wie „image“ senden.
   * Antwort: `{ type: "loaded", w, h, pw, ph, rgba, noise }`. `rgba` ist die Vorschau (lange Kante 1600 px) als Uint8ClampedArray.
2. **Gesichter erkennen** (Hauptthread, auf der Vorschau)
   ```js
   const fa = await import("/lib/face-api/face-api.esm.js");
   await fa.tf.setBackend("webgl"); await fa.tf.ready();
   await fa.nets.ssdMobilenetv1.loadFromUri("/models/face");
   await fa.nets.faceLandmark68Net.loadFromUri("/models/face");
   const res = await fa.detectAllFaces(previewCanvas, new fa.SsdMobilenetv1Options({ minConfidence: 0.42 })).withFaceLandmarks();
   const k = w / pw; // Vorschau auf Original umrechnen
   const faces = res.map(r => r.landmarks.positions.map(p => [p.x * k, p.y * k]));
   W.postMessage({ type: "faces", faces });
   ```
   Antwort: `{ type: "analyzed", n, teeth }`
3. **Vorschau rendern**: `W.postMessage({ type: "render", P, mask: false, vis: false, id })`
   Antwort: `{ type: "rendered", id, w, h, rgba }` und `{ type: "count", count, marks }`
4. **100 % Zoom Ausschnitt**: `{ type: "region", P, mask, vis, id, rect: {x,y,w,h}, maxOut }` → `{ type: "region", id, rect, w, h, rgba, before }`
5. **Antippen (Pickel)**: `{ type: "tap", x, y, spots: P.spots, mode: "add" | "keep" }` → `{ type: "spots", spots, action }`
6. **Sichern**: `{ type: "export", P, maxEdge: 0 | 4000 | 2048, quality: 95, sr: false }` → Fortschritt über `{ type: "progress", label, p }`, Ergebnis `{ type: "exported", blob, w, h }` (JPEG Blob)
7. Fehler kommen immer als `{ type: "error", message, during }`.

## Parameter P (alle Werte 0 bis 100, sofern nicht anders angegeben)

```js
const DEF  = { strokes: [], restores: [], spots: [], blemFade: 100, texture: 100, uniform: 0,
               blemish: 0, marks: 0, skin: 0, tone: 0, eyes: 0, teeth: 0, sharpen: 0,
               denoise: 0, detail: 0, exposure: 0, contrast: 0, warmth: 0 };
const AUTO = { blemish: 70, marks: 70, skin: 50, tone: 65, uniform: 25, eyes: 20, teeth: 45, sharpen: 20 };
```

* `blemish` Pickel Empfindlichkeit, `blemFade` Deckkraft der Pickel Reparatur
* `marks` dunkle Flecken, `skin` Haut glätten (nur Mitten), `texture` Struktur 0 bis 150 (100 = Original)
* `tone` Hautton angleichen, `uniform` Farbe vereinheitlichen
* `eyes`, `teeth`, `sharpen`, `denoise`, `detail`
* `exposure`, `contrast`, `warmth` von minus 100 bis plus 100
* `strokes`: Entfernen Pinsel, Liste von `{ r, pts: [[x,y],...], mode?: "clone", off?: [dx,dy] }` in Originalpixeln
* `restores`: Schützen Pinsel, gleiches Format
* `spots`: angetippte Stellen `{ x, y, r, m: "a" | "r" }`

Die vollständige, funktionierende Referenz für Oberfläche, Gesten, Verlauf und Export ist `js/app.js`.
