import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees, rgb } from "pdf-lib";
import { viewport, visibleBox, drawImageInView, drawRectangleInView, drawTextInView, rectFromFractions } from "../src/index.ts";

const ROTATIONS = [0, 90, 180, 270] as const;
const close = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

async function page(rotation: number, crop?: [number, number, number, number]) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([600, 800]);
  p.setRotation(degrees(rotation));
  if (crop) p.setCropBox(...crop);
  return { doc, p };
}

/** Where pdf-lib actually puts a w×h box drawn at `origin` rotated `deg` counter-clockwise. */
function footprint(origin: { x: number; y: number }, w: number, h: number, deg: number) {
  const t = (deg * Math.PI) / 180;
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => ({
    x: origin.x + x * Math.cos(t) - y * Math.sin(t),
    y: origin.y + x * Math.sin(t) + y * Math.cos(t),
  }));
}

for (const r of ROTATIONS) {
  test(`rotation ${r}: displayed size swaps for 90/270`, async () => {
    const { p } = await page(r);
    const vp = viewport(p);
    const sideways = r === 90 || r === 270;
    assert.equal(vp.width, sideways ? 800 : 600);
    assert.equal(vp.height, sideways ? 600 : 800);
  });

  test(`rotation ${r}: toView inverts toUser`, async () => {
    const { p } = await page(r, [50, 40, 500, 700]);
    const vp = viewport(p);
    for (const [x, y] of [[0, 0], [10, 20], [vp.width, vp.height], [123.5, 456.25]]) {
      const back = vp.toView(vp.toUser(x, y).x, vp.toUser(x, y).y);
      close(back.x, x, "x");
      close(back.y, y, "y");
    }
  });

  test(`rotation ${r}: view corners land on the visible box corners`, async () => {
    const { p } = await page(r, [50, 40, 500, 700]);
    const vp = viewport(p);
    const b = vp.box;
    const user = [[0, 0], [vp.width, 0], [0, vp.height], [vp.width, vp.height]].map(([x, y]) => vp.toUser(x, y));
    for (const u of user) {
      assert.ok([b.x, b.x + b.width].some((e) => Math.abs(e - u.x) < 1e-6), `x ${u.x} is a box edge`);
      assert.ok([b.y, b.y + b.height].some((e) => Math.abs(e - u.y) < 1e-6), `y ${u.y} is a box edge`);
    }
  });

  test(`rotation ${r}: a drawn rectangle covers exactly the requested view rectangle`, async () => {
    const { p } = await page(r, [50, 40, 500, 700]);
    const vp = viewport(p);
    const rect = { x: 30, y: 70, width: 120, height: 40 };
    const origin = vp.toUser(rect.x, rect.y + rect.height);
    const corners = footprint(origin, rect.width, rect.height, r).map((c) => vp.toView(c.x, c.y));
    const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
    close(Math.min(...xs), rect.x, "left");
    close(Math.max(...xs), rect.x + rect.width, "right");
    close(Math.min(...ys), rect.y, "top");
    close(Math.max(...ys), rect.y + rect.height, "bottom");
  });
}

test("visibleBox clips the CropBox to the MediaBox", async () => {
  const { p } = await page(0, [-20, -20, 400, 400]);
  assert.deepEqual(visibleBox(p), { x: 0, y: 0, width: 380, height: 380 });
});

test("a /Rotate that is not a multiple of 90 is treated as 0, like pdf.js", async () => {
  // pdf-lib refuses to write one, but files from other producers contain them.
  const { p } = await page(0);
  p.node.set(PDFName.of("Rotate"), PDFNumber.of(45));
  assert.equal(viewport(p).rotation, 0);
});

test("rectFromFractions scales by the displayed size", async () => {
  const { p } = await page(90);
  const vp = viewport(p);
  assert.deepEqual(rectFromFractions(vp, { x: 0.5, y: 0.5, width: 0.25, height: 0.1 }), { x: 400, y: 300, width: 200, height: 60 });
});

test("the drawing helpers produce a valid PDF on every rotation", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // 1×1 transparent PNG
  const png = await doc.embedPng(Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0)));
  for (const r of ROTATIONS) {
    const p = doc.addPage([600, 800]);
    p.setRotation(degrees(r));
    drawRectangleInView(p, { x: 20, y: 20, width: 100, height: 30 }, { borderColor: rgb(0, 0, 0), borderWidth: 1 });
    drawImageInView(p, png, { x: 20, y: 60, width: 100, height: 30 });
    drawTextInView(p, `rotation ${r}`, { x: 20, y: 100 }, { font, size: 12 });
  }
  const bytes = await doc.save();
  const reloaded = await PDFDocument.load(bytes);
  assert.equal(reloaded.getPageCount(), 4);
});
