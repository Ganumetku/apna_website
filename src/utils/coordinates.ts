import { util } from 'fabric';
import type { Matrix, PageInfo } from '../types';

/*
 * COORDINATE SYSTEMS — read this before touching export code.
 *
 *  1. Screen pixels   : what the browser draws. = display points × zoom × DPR.
 *  2. Display points  : PDF points, origin TOP-LEFT, y grows DOWN, after the
 *                       page's /Rotate is applied. Every Fabric object lives
 *                       here: each page's Fabric canvas has
 *                       viewportTransform = [zoom,0,0,zoom,0,0], so object
 *                       left/top/width/height never change when zooming.
 *  3. PDF user space  : origin BOTTOM-LEFT, y grows UP, unrotated, possibly
 *                       offset by the MediaBox/CropBox origin. This is what
 *                       pdf-lib writes into the content stream.
 *
 * PDF.js gives us `viewport.transform` (at scale 1) which maps
 * user space -> display points. For a plain unrotated A4 page it is
 * [1, 0, 0, -1, 0, 842]: i.e. x' = x, y' = 842 - y — the classic Y flip.
 * For rotated pages or pages with a non-zero MediaBox origin it also
 * contains the rotation and translation.
 *
 * Exporting therefore needs the INVERSE (display -> user space). Composed
 * with each Fabric object's own transform (object-local -> display), we get
 * one matrix that we emit as a PDF `cm` operator; the object is then drawn
 * in its local coordinates and lands exactly where the user saw it, with
 * rotation, scale, skew and flips preserved.
 */

/** display points -> PDF user space for a page. */
export function displayToUserSpace(page: Pick<PageInfo, 'viewportTransform'>): Matrix {
  return util.invertTransform(page.viewportTransform) as Matrix;
}

/** Plain Y flip, for freshly created pages (raster fallback): display -> user space. */
export function flipYMatrix(pageHeight: number): Matrix {
  return [1, 0, 0, -1, 0, pageHeight];
}

/**
 * Compose: object-local -> display points -> PDF user space.
 * `multiplyTransformMatrices(a, b)` applies `b` first, then `a`.
 */
export function objectToUserSpace(displayToUser: Matrix, objectMatrix: Matrix): Matrix {
  return util.multiplyTransformMatrices(displayToUser, objectMatrix) as Matrix;
}

/** Map a point from display points to PDF user space (handy for debugging/tests). */
export function displayPointToUserSpace(page: Pick<PageInfo, 'viewportTransform'>, x: number, y: number) {
  const [a, b, c, d, e, f] = displayToUserSpace(page);
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}
