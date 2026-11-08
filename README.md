# Retusche Studio

Porträt Retusche auf dem iPhone, so wie ein Retuscheur in Photoshop arbeitet. Pickel und Unreinheiten werden erkannt und gezielt repariert, Poren und Hautstruktur bleiben erhalten. Kein Weichzeichner.

**App öffnen:** https://elyasimpulslabs.github.io/Retusche-Studio/

## Was Retusche Studio kann

* **Gesichtserkennung** mit 68 Punkten: Augen, Brauen, Lippen, Nasenlöcher, Bart und Haare werden automatisch ausgespart
* **Pickel & Unreinheiten:** findet kleine dunkle, rote oder helle Stellen (auch Mitesser), die in allen Richtungen von Haut umgeben sind. Falten, Kanten und Schatten bleiben. Repariert wird wie mit dem Reparaturpinsel: Farbe aus der Haut daneben, Poren bleiben
* **Entfernen Pinsel wie in Lightroom:** mit dem Finger über eine Stelle wischen, sie wird rot markiert und beim Loslassen entfernt. Die App sucht automatisch eine passende Quelle daneben und gleicht Farbe und Helligkeit nahtlos an. Modi Reparieren und Klonen, Quelle mit dem Finger verschiebbar
* **Schützen Pinsel:** Bereiche, die die Auto Retusche nicht anfassen soll (z. B. Sommersprossen)
* **Flecken sichtbar machen:** Schwarz Weiß Ansicht, in der Unreinheiten deutlich hervortreten (wie Visualize Spots)
* **Deckkraft** für Pickel und Flecken, um die Retusche natürlicher zu halten
* **Antippen:** weitere Stellen antippen zum Entfernen (bereits markierte bleiben markiert). Modus **Behalten** für Leberflecke und Muttermale
* **Dunkle Flecken:** Pigmentflecken und Aknemale werden in Helligkeit und Farbe angeglichen, die Struktur bleibt
* **Haut glätten:** Frequenztrennung in drei Bändern, beruhigt nur die mittleren Frequenzen. Die feine Struktur wird nie angefasst
* **Hautton angleichen:** automatisches Dodge & Burn für Rötungen, Schatten und Flecken
* **Augen** aufhellen, **Zähne** aufhellen und Gelbstich entfernen
* **Bild verbessern:** Entrauschen (Luminanz kantenerhaltend, Farbrauschen), Details (Klarheit, Mikrokontrast), **Super Resolution** 2× mit KI (ESRGAN, auf dem Gerät)
* **Schärfe** wie High Pass, Haut wird geschont
* **Licht:** Belichtung, Kontrast, Wärme
* **RAW:** DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2 und mehr (LibRaw); dazu JPEG, HEIC, PNG
* Vorher/Nachher mit Trennlinie oder Gedrückthalten, Maskenansicht, Zoom bis 100 % in voller Auflösung, Rückgängig/Wiederholen
* Sichern in voller Auflösung als neue Datei (`name_retusche.jpg`), das Original bleibt unverändert. Aufnahmedatum und Kameradaten (EXIF) bleiben bei JPEG erhalten
* **An Lightroom senden** über das Teilen Menü, außerdem In Fotos oder In Dateien sichern. Aus Lightroom kommt ein Foto über „Exportieren als“ in die App

## Datenschutz

Fotos verlassen nie das Gerät. Die App lädt keine Schriften, Skripte oder Bilder von fremden Servern. Gesichtserkennung, RAW Entwicklung und KI laufen komplett auf dem iPhone.

## Als App installieren

* **iPhone (Safari):** Seite öffnen, Teilen, „Zum Home Bildschirm“
* **Android (Chrome):** Seite öffnen, Menü, „App installieren“

Danach funktioniert Retusche Studio auch ohne Internet.

## Dateien

| Datei | Zweck |
| --- | --- |
| `index.html`, `css/`, `js/app.js` | Oberfläche |
| `js/engine.js` | Retusche: Hautmaske, Pickelerkennung, Frequenztrennung, Entrauschen, Schärfen |
| `js/worker.js` | Rechnet im Hintergrund, Export in voller Auflösung |
| `lib/face-api/`, `models/face/` | Gesichtserkennung (MIT) |
| `lib/libraw/` | RAW Entwicklung (LibRaw) |
| `lib/jpeg/` | JPEG für sehr große Bilder (über 16 MP) |
| `models/esrgan/` | KI Modell für Super Resolution (MIT) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline und Installation als App |
