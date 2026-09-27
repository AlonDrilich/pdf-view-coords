# pdf-view-coords

Draw on PDF pages with [pdf-lib](https://pdf-lib.js.org/) **in the coordinates a viewer actually shows** — correct on rotated and cropped pages.

## The problem

pdf-lib draws in a page's raw user space: origin at the bottom-left of the MediaBox, y pointing up, and the page's `/Rotate` entry ignored. A PDF viewer — and pdf.js, which most web apps render with — shows the **CropBox**, turned by **`/Rotate`**, with the origin at the top-left.

On an ordinary portrait page that is just a y-flip. But take a scanned page stored sideways with `/Rotate 90`, or a cropped page, and a signature or stamp placed where the user clicked lands in the wrong spot, the wrong way up, or off the page entirely.

```
What the user sees (view space)        What pdf-lib draws in (user space, /Rotate 90)

(0,0) ┌──────────────────┐              ┌──────────┐ (600,800)
      │  ▣ click here    │              │          │
      │                  │    ≠         │     ▣    │  ← same point,
      │                  │              │          │     different axes
      └──────────────────┘ (800,600)    └──────────┘
                                   (0,0)
```

This package does the translation, so you can work entirely in view space.

## Install

```bash
npm install github:AlonDrilich/pdf-view-coords pdf-lib
```

## Usage

```ts
import { PDFDocument } from "pdf-lib";
import { viewport, drawImageInView, drawTextInView, rectFromFractions } from "pdf-view-coords";

const pdf = await PDFDocument.load(bytes);
const page = pdf.getPage(0);
const signature = await pdf.embedPng(signaturePng);

// A box the user drew on the rendered page, as fractions of its on-screen size.
const vp = viewport(page);
const rect = rectFromFractions(vp, { x: 0.1, y: 0.8, width: 0.3, height: 0.08 });

drawImageInView(page, signature, rect);               // aspect ratio kept, centred, upright
drawTextInView(page, "2026-09-27", { x: rect.x, y: rect.y + rect.height + 4 }, { font, size: 10 });

const out = await pdf.save();
```

It works the same whether the page has `/Rotate 0`, `90`, `180` or `270`, and whether or not it is cropped.

## API

| Function | What it does |
|---|---|
| `viewport(page)` | Displayed `width`/`height`, effective `rotation`, the visible `box`, `toUser(x, y)` and its inverse `toView(x, y)`, and the `angle` to pass as `rotate` when drawing yourself. |
| `drawImageInView(page, image, rect, { fit })` | Draws an image into a view-space rectangle. `fit: "contain"` (default) keeps its aspect ratio; `"fill"` stretches it. |
| `drawRectangleInView(page, rect, options)` | Draws a rectangle (border and/or fill). |
| `drawTextInView(page, text, { x, y }, { font, size, color })` | Draws one line of text with its top-left corner at `(x, y)`. |
| `rectFromFractions(viewport, rect)` | Converts a 0–1 rectangle (on-screen pixels ÷ rendered size) into points. |
| `visibleBox(page)` | The CropBox clipped to the MediaBox — what a viewer shows. |
| `effectiveRotation(page)` | `/Rotate` normalised to 0/90/180/270. Invalid values (not a multiple of 90) are treated as 0, matching pdf.js. |

View space is always: **points, origin at the top-left of the page as displayed, y downwards.**

## Tested

`npm test` checks, for every rotation and with a crop applied, that `toView` inverts `toUser`, that the displayed corners map onto the visible box, and — the important one — that the area pdf-lib actually paints, after rotating about its origin, is exactly the view-space rectangle you asked for.

## Where this comes from

This is the placement logic behind [esign.website](https://esign.website), a PDF signer that runs entirely in the browser — the document is never uploaded. It was extracted because the rotated-page bug it fixes is common and easy to miss: it only shows up on real-world scans.

## License

MIT
