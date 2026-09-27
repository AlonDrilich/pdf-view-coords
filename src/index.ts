/**
 * pdf-view-coords — draw on a PDF page in the coordinates you actually see.
 *
 * pdf-lib draws in the page's raw user space: origin at the bottom-left of the
 * MediaBox, y upwards, and the page's /Rotate entry ignored. A PDF viewer (and
 * pdf.js, which most web apps render with) shows something else: the CropBox,
 * turned by /Rotate, with the origin at the top-left. On an ordinary portrait
 * page the difference is only a y-flip. On a scanned page stored sideways with
 * /Rotate 90, or a cropped/imposed page, anything placed by on-screen
 * coordinates lands in the wrong place, the wrong way up, or off the page.
 *
 * This module does that translation. Give it a rectangle in "view space" —
 * points, origin top-left of the page as displayed, y downwards — and it draws
 * there, upright, whatever the page's rotation and crop.
 */
import { degrees, type PDFFont, type PDFImage, type PDFPage, type Color, type Degrees } from "pdf-lib";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle in view space: points, origin at the displayed top-left, y down. */
export type ViewRect = Box;

export type Rotation = 0 | 90 | 180 | 270;

export interface PageViewport {
  /** Width of the page as displayed, in points (rotation and crop applied). */
  width: number;
  /** Height of the page as displayed, in points. */
  height: number;
  /** The page's effective /Rotate, normalised to 0, 90, 180 or 270. */
  rotation: Rotation;
  /** The visible region in user space (CropBox clipped to the MediaBox). */
  box: Box;
  /** View-space point → pdf-lib user-space point. */
  toUser(x: number, y: number): { x: number; y: number };
  /** pdf-lib user-space point → view-space point. The inverse of toUser. */
  toView(x: number, y: number): { x: number; y: number };
  /** Pass as `rotate` when drawing, so content reads upright once the viewer applies /Rotate. */
  angle: Degrees;
}

/**
 * The region a viewer actually shows: the CropBox, clipped to the MediaBox.
 * `page.getSize()` reports the MediaBox, which on a cropped page is larger than
 * what anyone sees and shifts every coordinate by the crop offset.
 */
export function visibleBox(page: PDFPage): Box {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const x0 = Math.max(media.x, crop.x);
  const y0 = Math.max(media.y, crop.y);
  const x1 = Math.min(media.x + media.width, crop.x + crop.width);
  const y1 = Math.min(media.y + media.height, crop.y + crop.height);
  if (x1 - x0 > 0 && y1 - y0 > 0) return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  return { x: media.x, y: media.y, width: media.width, height: media.height };
}

/**
 * /Rotate values that are not a multiple of 90 are invalid, and pdf.js ignores
 * them. Treat them as 0 so drawing agrees with what the user was shown.
 */
export function effectiveRotation(page: PDFPage): Rotation {
  const raw = ((page.getRotation().angle % 360) + 360) % 360;
  return (raw % 90 === 0 ? raw : 0) as Rotation;
}

export function viewport(page: PDFPage): PageViewport {
  const box = visibleBox(page);
  const rotation = effectiveRotation(page);
  const swap = rotation === 90 || rotation === 270;
  const width = swap ? box.height : box.width;
  const height = swap ? box.width : box.height;

  const toUser = (vx: number, vy: number) => {
    switch (rotation) {
      case 90:
        return { x: box.x + vy, y: box.y + vx };
      case 180:
        return { x: box.x + box.width - vx, y: box.y + vy };
      case 270:
        return { x: box.x + box.width - vy, y: box.y + box.height - vx };
      default:
        return { x: box.x + vx, y: box.y + box.height - vy };
    }
  };

  const toView = (ux: number, uy: number) => {
    const dx = ux - box.x;
    const dy = uy - box.y;
    switch (rotation) {
      case 90:
        return { x: dy, y: dx };
      case 180:
        return { x: box.width - dx, y: dy };
      case 270:
        return { x: box.height - dy, y: box.width - dx };
      default:
        return { x: dx, y: box.height - dy };
    }
  };

  return { width, height, rotation, box, toUser, toView, angle: degrees(rotation) };
}

/**
 * Convert a rectangle given as fractions of the displayed page (0–1) — what you
 * get from dividing on-screen pixels by the rendered page's size — into points.
 */
export function rectFromFractions(vp: PageViewport, f: ViewRect): ViewRect {
  return { x: f.x * vp.width, y: f.y * vp.height, width: f.width * vp.width, height: f.height * vp.height };
}

/**
 * Draw an image into a view-space rectangle.
 *
 * `fit: "contain"` (the default) keeps the image's aspect ratio and centres it,
 * which is what a signature preview with `object-fit: contain` shows; "fill"
 * stretches it to the rectangle.
 */
export function drawImageInView(
  page: PDFPage,
  image: PDFImage,
  rect: ViewRect,
  opts: { fit?: "contain" | "fill"; opacity?: number } = {},
): void {
  const vp = viewport(page);
  let { x, y, width, height } = rect;
  if ((opts.fit ?? "contain") === "contain") {
    const fitted = image.scaleToFit(width, height);
    x += (width - fitted.width) / 2;
    y += (height - fitted.height) / 2;
    width = fitted.width;
    height = fitted.height;
  }
  // pdf-lib rotates about the drawing origin, which must be the rectangle's
  // bottom-left *as displayed*.
  const origin = vp.toUser(x, y + height);
  page.drawImage(image, { x: origin.x, y: origin.y, width, height, rotate: vp.angle, opacity: opts.opacity });
}

/** Draw a rectangle (border and/or fill) at a view-space position. */
export function drawRectangleInView(
  page: PDFPage,
  rect: ViewRect,
  opts: { color?: Color; borderColor?: Color; borderWidth?: number; opacity?: number } = {},
): void {
  const vp = viewport(page);
  const origin = vp.toUser(rect.x, rect.y + rect.height);
  page.drawRectangle({ x: origin.x, y: origin.y, width: rect.width, height: rect.height, rotate: vp.angle, ...opts });
}

/**
 * Draw a single line of text whose top-left corner is at (x, y) in view space.
 * The baseline sits at y + ascent, so the text occupies the space a user saw.
 */
export function drawTextInView(
  page: PDFPage,
  text: string,
  at: { x: number; y: number },
  opts: { font: PDFFont; size: number; color?: Color },
): void {
  const vp = viewport(page);
  const ascent = opts.font.heightAtSize(opts.size, { descender: false });
  const origin = vp.toUser(at.x, at.y + ascent);
  page.drawText(text, { x: origin.x, y: origin.y, size: opts.size, font: opts.font, color: opts.color, rotate: vp.angle });
}
