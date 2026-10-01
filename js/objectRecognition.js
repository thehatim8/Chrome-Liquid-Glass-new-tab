// js/objectRecognition.js
// Saliency and main object recognition system for wallpapers

/**
 * Computes row-by-row horizontal extents for a binary subject mask.
 *
 * @param {Uint8Array} mask
 * @param {number} w
 * @param {number} h
 * @param {number} sMinY
 * @param {number} sMaxY
 * @returns {Array<{y: number, minX: number, maxX: number, normY: number, normMinX: number, normMaxX: number}|null>}
 */
export function computeRowExtents(mask, w, h, sMinY, sMaxY) {
  const extents = new Array(h).fill(null);
  for (let y = 0; y < h; y++) {
    let firstX = -1;
    let lastX = -1;
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[rowOffset + x] === 1) {
        if (firstX < 0) firstX = x;
        lastX = x;
      }
    }
    if (firstX >= 0) {
      extents[y] = {
        y,
        minX: firstX,
        maxX: lastX,
        normY: Number((y / h).toFixed(4)),
        normMinX: Number((firstX / w).toFixed(4)),
        normMaxX: Number(((lastX + 1) / w).toFixed(4))
      };
    }
  }

  // Grounded subject extension: if subject anchors to bottom (sMaxY === h - 1),
  // ensure rows from last seen foreground down to h-1 have extents
  if (sMaxY === h - 1) {
    let lastSeenExtent = null;
    for (let y = h - 1; y >= 0; y--) {
      if (extents[y]) {
        lastSeenExtent = extents[y];
        break;
      }
    }
    if (lastSeenExtent) {
      for (let y = lastSeenExtent.y + 1; y < h; y++) {
        extents[y] = {
          y,
          minX: lastSeenExtent.minX,
          maxX: lastSeenExtent.maxX,
          normY: Number((y / h).toFixed(4)),
          normMinX: lastSeenExtent.normMinX,
          normMaxX: lastSeenExtent.normMaxX
        };
      }
    }
  }

  return extents;
}

/**
 * Traces the complete outer boundary contour of a binary mask using Moore-Neighbor tracing.
 * Robustly scans for boundary loops, skipping isolated noise pixels and tiny specks.
 *
 * @param {Uint8Array} mask
 * @param {number} w
 * @param {number} h
 * @returns {Array<{x: number, y: number}>}
 */
export function extractContourFromMask(mask, w, h) {
  if (!mask || w <= 0 || h <= 0) return [];

  // 8 directions (clockwise, 0 = N, 1 = NE, 2 = E, 3 = SE, 4 = S, 5 = SW, 6 = W, 7 = NW)
  const DX = [0, 1, 1, 1, 0, -1, -1, -1];
  const DY = [-1, -1, 0, 1, 1, 1, 0, -1];

  function isFg(x, y) {
    if (x < 0 || x >= w || y < 0 || y >= h) return false;
    return mask[y * w + x] === 1;
  }

  let bestContour = [];
  let fallbackSingle = null;
  const visited = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[rowOffset + x] !== 1) continue;
      if (!fallbackSingle) fallbackSingle = { x, y };

      // Must be an outer boundary pixel (at least one 4-neighbor is background)
      const isBoundary = !isFg(x, y - 1) || !isFg(x, y + 1) || !isFg(x - 1, y) || !isFg(x + 1, y);
      if (!isBoundary) continue;
      if (visited[rowOffset + x] === 1) continue;

      let hasNeighbors = false;
      for (let d = 0; d < 8; d++) {
        if (isFg(x + DX[d], y + DY[d])) {
          hasNeighbors = true;
          break;
        }
      }
      if (!hasNeighbors) continue;

      // Trace contour from this start pixel using Moore-Neighbor algorithm
      const contour = [{ x, y }];
      visited[rowOffset + x] = 1;
      let currX = x;
      let currY = y;
      let backtrackDir = 6; // Came from West
      let firstNextX = -1;
      let firstNextY = -1;
      const maxSteps = w * h * 2;
      let steps = 0;

      while (steps++ < maxSteps) {
        let foundNext = false;
        let nextDir = -1;
        for (let i = 1; i <= 8; i++) {
          const d = (backtrackDir + i) % 8;
          const nx = currX + DX[d];
          const ny = currY + DY[d];
          if (isFg(nx, ny)) {
            foundNext = true;
            nextDir = d;
            break;
          }
        }

        if (!foundNext) break;

        const nextX = currX + DX[nextDir];
        const nextY = currY + DY[nextDir];

        if (steps === 1) {
          firstNextX = nextX;
          firstNextY = nextY;
        } else if (currX === x && currY === y && nextX === firstNextX && nextY === firstNextY) {
          // Jacob's stopping condition
          break;
        }

        contour.push({ x: nextX, y: nextY });
        visited[nextY * w + nextX] = 1;
        backtrackDir = (nextDir + 4) % 8;
        currX = nextX;
        currY = nextY;
      }

      // Pop duplicate closing point if present
      if (contour.length > 2 && contour[contour.length - 1].x === contour[0].x && contour[contour.length - 1].y === contour[0].y) {
        contour.pop();
      }

      if (contour.length > bestContour.length) {
        bestContour = contour;
      }
    }
  }

  if (bestContour.length > 0) return bestContour;
  if (fallbackSingle) return [fallbackSingle];
  return [];
}

function getPerpendicularDist(p, p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const px = p.x - p1.x;
    const py = p.y - p1.y;
    return Math.sqrt(px * px + py * py);
  }
  const num = Math.abs(dy * p.x - dx * p.y + p2.x * p1.y - p2.y * p1.x);
  return num / Math.sqrt(lenSq);
}

function rdpRecursive(pts, startIdx, endIdx, epsilon, keepSet) {
  if (endIdx <= startIdx + 1) return;
  let maxDist = 0;
  let maxIdx = -1;
  const p1 = pts[startIdx];
  const p2 = pts[endIdx];

  for (let i = startIdx + 1; i < endIdx; i++) {
    const dist = getPerpendicularDist(pts[i], p1, p2);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon && maxIdx !== -1) {
    keepSet.add(maxIdx);
    rdpRecursive(pts, startIdx, maxIdx, epsilon, keepSet);
    rdpRecursive(pts, maxIdx, endIdx, epsilon, keepSet);
  }
}

/**
 * Simplifies a closed polygonal contour using Ramer-Douglas-Peucker algorithm.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {number} [epsilon=1.2]
 * @returns {Array<{x: number, y: number}>}
 */
export function simplifyPolygonRDP(points, epsilon = 1.2) {
  if (!Array.isArray(points) || points.length <= 4) return points || [];

  let minXIdx = 0, maxXIdx = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x < points[minXIdx].x) minXIdx = i;
    if (points[i].x > points[maxXIdx].x) maxXIdx = i;
  }

  if (minXIdx === maxXIdx) {
    for (let i = 1; i < points.length; i++) {
      if (points[i].y < points[minXIdx].y) minXIdx = i;
      if (points[i].y > points[maxXIdx].y) maxXIdx = i;
    }
  }

  let idx1 = Math.min(minXIdx, maxXIdx);
  let idx2 = Math.max(minXIdx, maxXIdx);
  if (idx1 === idx2) {
    idx1 = 0;
    idx2 = Math.floor(points.length / 2);
  }

  const keep = new Set([idx1, idx2]);
  rdpRecursive(points, idx1, idx2, epsilon, keep);

  const wrapped = [];
  const wrappedOrigIndices = [];
  for (let i = idx2; i < points.length; i++) {
    wrapped.push(points[i]);
    wrappedOrigIndices.push(i);
  }
  for (let i = 0; i <= idx1; i++) {
    wrapped.push(points[i]);
    wrappedOrigIndices.push(i);
  }
  const wrappedKeep = new Set([0, wrapped.length - 1]);
  rdpRecursive(wrapped, 0, wrapped.length - 1, epsilon, wrappedKeep);
  for (const wi of wrappedKeep) {
    keep.add(wrappedOrigIndices[wi]);
  }

  const simplified = [];
  for (let i = 0; i < points.length; i++) {
    if (keep.has(i)) simplified.push(points[i]);
  }
  return simplified.length >= 3 ? simplified : points;
}

/**
 * Generates a smooth C1-continuous SVG path string (Catmull-Rom to cubic Bezier)
 * passing through the given points.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {number} [tension=0.40]
 * @returns {string}
 */
export function buildSmoothContourPath(points, tension = 0.40) {
  if (!Array.isArray(points) || points.length === 0) return '';
  if (points.length < 3) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
  }
  const n = points.length;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];

    const cp1x = Number((p1.x + (p2.x - p0.x) * (tension / 3)).toFixed(2));
    const cp1y = Number((p1.y + (p2.y - p0.y) * (tension / 3)).toFixed(2));
    const cp2x = Number((p2.x - (p3.x - p1.x) * (tension / 3)).toFixed(2));
    const cp2y = Number((p2.y - (p3.y - p1.y) * (tension / 3)).toFixed(2));

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d + ' Z';
}

/**
 * Classifies the detected contour as a circle or general polygon and computes geometric parameters.
 *
 * @param {Array<{x: number, y: number}>} contour
 * @param {Object} maskStats
 * @param {number} w
 * @param {number} h
/**
 * Fits a circle to 2D points using the algebraic Kåsa method (linear least squares on circle equation).
 * Direct closed-form solution that finds the true mathematical center minimizing radial variance.
 *
 * @param {Array<{x: number, y: number}>} points
 * @returns {{cx: number, cy: number, r: number}|null}
 */
export function fitCircleKasa(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += points[i].x;
    sumY += points[i].y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let Suu = 0;
  let Svv = 0;
  let Suv = 0;
  let Suuu = 0;
  let Svvv = 0;
  let Suvv = 0;
  let Svuu = 0;

  for (let i = 0; i < n; i++) {
    const u = points[i].x - meanX;
    const v = points[i].y - meanY;
    const u2 = u * u;
    const v2 = v * v;
    Suu += u2;
    Svv += v2;
    Suv += u * v;
    Suuu += u2 * u;
    Svvv += v2 * v;
    Suvv += u * v2;
    Svuu += v * u2;
  }

  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-6) return null;

  const uc = (Svv * (Suuu + Suvv) - Suv * (Svvv + Svuu)) / (2 * det);
  const vc = (Suu * (Svvv + Svuu) - Suv * (Suuu + Suvv)) / (2 * det);

  const cx = meanX + uc;
  const cy = meanY + vc;
  const rSq = uc * uc + vc * vc + (Suu + Svv) / n;
  if (rSq <= 0) return null;
  const r = Math.sqrt(rSq);

  return { cx, cy, r };
}

/**
 * Classifies the detected contour as a circle or general polygon and computes geometric parameters.
 *
 * @param {Array<{x: number, y: number}>} contour
 * @param {Object} maskStats
 * @param {number} w
 * @param {number} h
 * @returns {{shapeType: 'circle'|'polygon', circularity: number, circle: {cx: number, cy: number, r: number, rx: number, ry: number}|null}}
 */
export function classifyShape(contour, maskStats, w, h, denseContour = null) {
  if (!Array.isArray(contour) || contour.length < 3) {
    return { shapeType: 'polygon', circularity: 0, circle: null };
  }

  const { count: area, minX, maxX, minY, maxY, centerX, centerY } = maskStats;
  const width = Math.max(1, maxX - minX + 1);
  const height = Math.max(1, maxY - minY + 1);
  const aspect = width / height;

  let perimeter = 0;
  for (let i = 0; i < contour.length; i++) {
    const p1 = contour[i];
    const p2 = contour[(i + 1) % contour.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  if (perimeter <= 0) return { shapeType: 'polygon', circularity: 0, circle: null };

  const circularity = (4 * Math.PI * area) / (perimeter * perimeter);

  // If dense contour points are provided, use them for evaluating radial variance to capture flat edges
  const evalPoints = Array.isArray(denseContour) && denseContour.length >= 8 ? denseContour : contour;

  // Evaluate candidate centers to prevent illumination/saliency highlights from skewing radial fit
  let sumContourX = 0, sumContourY = 0;
  for (const pt of evalPoints) {
    sumContourX += pt.x;
    sumContourY += pt.y;
  }
  const avgContourX = sumContourX / evalPoints.length;
  const avgContourY = sumContourY / evalPoints.length;
  const boxMidX = (minX + maxX) / 2;
  const boxMidY = (minY + maxY) / 2;

  const candidateCenters = [
    { cx: centerX, cy: centerY },
    { cx: avgContourX, cy: avgContourY },
    { cx: boxMidX, cy: boxMidY }
  ];

  // Algebraic Kåsa circle fit directly solves for optimal center minimizing radial variance
  const kasaFit = fitCircleKasa(evalPoints);
  if (kasaFit && Number.isFinite(kasaFit.cx) && Number.isFinite(kasaFit.cy)) {
    if (kasaFit.cx >= minX - width && kasaFit.cx <= maxX + width &&
        kasaFit.cy >= minY - height && kasaFit.cy <= maxY + height) {
      candidateCenters.push({ cx: kasaFit.cx, cy: kasaFit.cy });
    }
  }

  let bestFit = null;
  let minCoeffVar = Infinity;

  for (const cand of candidateCenters) {
    let sumR = 0;
    let curMinR = Infinity;
    let curMaxR = -Infinity;
    const dists = [];
    for (const pt of evalPoints) {
      const d = Math.sqrt((pt.x - cand.cx) ** 2 + (pt.y - cand.cy) ** 2);
      dists.push(d);
      sumR += d;
      if (d < curMinR) curMinR = d;
      if (d > curMaxR) curMaxR = d;
    }
    const meanR = sumR / evalPoints.length;
    let sumSqDiff = 0;
    for (const d of dists) {
      sumSqDiff += (d - meanR) ** 2;
    }
    const stdDevR = Math.sqrt(sumSqDiff / evalPoints.length);
    const radialCoeffVar = stdDevR / Math.max(0.001, meanR);

    if (radialCoeffVar < minCoeffVar) {
      minCoeffVar = radialCoeffVar;
      bestFit = { cx: cand.cx, cy: cand.cy, meanR, radialCoeffVar, minR: curMinR, maxR: curMaxR };
    }
  }

  const radialCoeffVar = bestFit.radialCoeffVar;
  const fittedCircleArea = Math.PI * bestFit.meanR * bestFit.meanR;
  const areaRatio = area / Math.max(0.001, fittedCircleArea);

  // A true circle must:
  // 1. Have balanced aspect ratio (0.70 - 1.42)
  // 2. Have vertex complexity: a circle with r >= 4 simplifies to >= 6 vertices with epsilon 1.2, whereas quads/rectangles simplify to 4
  // 3. Have an area close to pi * r^2 (0.72 - 1.28). Squares circumscribed by 4 corners have areaRatio = 0.636, and rectangles even less!
  // 4. Have low radial coefficient of variation (<= 0.10)
  const isCircular = aspect >= 0.70 && aspect <= 1.42 &&
    (contour.length >= 6 || evalPoints.length >= 10) &&
    areaRatio >= 0.72 && areaRatio <= 1.28 &&
    (
      (radialCoeffVar <= 0.08) ||
      (radialCoeffVar <= 0.11 && circularity >= 0.35)
    );

  if (isCircular) {
    const normR = bestFit.meanR / Math.max(w, h);
    return {
      shapeType: 'circle',
      circularity: Number(circularity.toFixed(3)),
      circle: {
        cx: Number((bestFit.cx / w).toFixed(4)),
        cy: Number((bestFit.cy / h).toFixed(4)),
        r: Number(normR.toFixed(4)),
        rx: Number((bestFit.meanR / w).toFixed(4)),
        ry: Number((bestFit.meanR / h).toFixed(4))
      }
    };
  }

  return {
    shapeType: 'polygon',
    circularity: Number(circularity.toFixed(3)),
    circle: null
  };
}

/**
 * Converts sRGB (0-255) to CIE L*a*b* color space.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {{l: number, a: number, b: number}}
 */
export function rgbToLab(r, g, b) {
  let rL = r / 255;
  let gL = g / 255;
  let bL = b / 255;
  rL = rL > 0.04045 ? Math.pow((rL + 0.055) / 1.055, 2.4) : rL / 12.92;
  gL = gL > 0.04045 ? Math.pow((gL + 0.055) / 1.055, 2.4) : gL / 12.92;
  bL = bL > 0.04045 ? Math.pow((bL + 0.055) / 1.055, 2.4) : bL / 12.92;

  // D65 standard illuminant
  const X = (rL * 0.4124564 + gL * 0.3575761 + bL * 0.1804375) / 0.95047;
  const Y = (rL * 0.2126729 + gL * 0.7151522 + bL * 0.0721750) / 1.00000;
  const Z = (rL * 0.0193339 + gL * 0.1191920 + bL * 0.9503041) / 1.08883;

  function f(t) {
    return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  }

  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  };
}

/**
 * Computes CIE76 perceptual color difference Delta E between two L*a*b* colors.
 *
 * @param {{l: number, a: number, b: number}} lab1
 * @param {{l: number, a: number, b: number}} lab2
 * @returns {number}
 */
export function deltaE(lab1, lab2) {
  const dl = lab1.l - lab2.l;
  const da = lab1.a - lab2.a;
  const db = lab1.b - lab2.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

/**
 * Classifies the semantic category of the detected subject using multi-spectral color,
 * spatial geometry, skin-locus analysis, and morphological cues.
 * Accurately recognizes:
 * - 'character': Anime, manga, comic, 3D gaming character, cel-shaded illustration
 * - 'human': Person, portrait, full body photography
 * - 'car': Automobile, sports car, vehicle
 * - 'flower': Flower, blossom, plant, floral arrangement
 * - 'object': General salient real-world physical object
 *
 * @param {Uint8Array} mask
 * @param {number} w
 * @param {number} h
 * @param {Float32Array} rBuf
 * @param {Float32Array} gBuf
 * @param {Float32Array} bBuf
 * @param {Float32Array} lumBuf
 * @param {Object} maskStats - { count, minX, maxX, minY, maxY, centerX, centerY }
 * @param {Array<{x: number, y: number}>} [contour]
 * @param {Object} [shapeInfo] - { shapeType, circularity, circle }
 * @param {Array<Object>} [borderPixels]
 * @returns {{category: 'character'|'human'|'car'|'flower'|'object', label: string, confidence: number, scores: Object}}
 */
export function classifyObjectSemantics(
  mask,
  w,
  h,
  rBuf,
  gBuf,
  bBuf,
  lumBuf,
  maskStats,
  contour = null,
  shapeInfo = null,
  borderPixels = []
) {
  const count = Math.max(1, maskStats.count);
  const minX = maskStats.minX;
  const maxX = maskStats.maxX;
  const minY = maskStats.minY;
  const maxY = maskStats.maxY;
  const boxW = Math.max(1, maxX - minX + 1);
  const boxH = Math.max(1, maxY - minY + 1);
  const aspect = boxW / boxH;
  const solidity = count / (boxW * boxH);
  const isGroundGrounded = maxY >= Math.round(h * 0.72);

  let skinCount = 0;
  let upperSkinCount = 0;
  let vibrantCount = 0;
  let stylizedHairCount = 0;
  let petalColorCount = 0;
  let specularCount = 0;
  let darkBottomCount = 0;
  let totalSatSum = 0;

  const upperYThreshold = minY + boxH * 0.40;
  const lowerYThreshold = maxY - boxH * 0.25;

  for (let y = minY; y <= maxY; y++) {
    const rowOffset = y * w;
    for (let x = minX; x <= maxX; x++) {
      const idx = rowOffset + x;
      if (mask[idx] !== 1) continue;

      const r = rBuf[idx];
      const g = gBuf[idx];
      const b = bBuf[idx];
      const lum = lumBuf[idx];

      const rn = r / 255;
      const gn = g / 255;
      const bn = b / 255;
      const mx = Math.max(rn, gn, bn);
      const mn = Math.min(rn, gn, bn);
      const diff = mx - mn;
      const v = mx;
      const s = mx === 0 ? 0 : diff / mx;

      let hue = 0;
      if (diff > 0.001) {
        if (mx === rn) hue = ((gn - bn) / diff) % 6;
        else if (mx === gn) hue = (bn - rn) / diff + 2;
        else hue = (rn - gn) / diff + 4;
        hue *= 60;
        if (hue < 0) hue += 360;
      }

      totalSatSum += s;

      // 1. Skin locus (Peer / Kovac human skin locus in normalized RGB + HSV)
      const isSkin = (
        r > 95 && g > 40 && b > 20 &&
        (r > g) && (r > b) &&
        (r - g > 15) &&
        ((hue >= 0 && hue <= 52) || (hue >= 340 && hue <= 360)) &&
        s >= 0.12 && s <= 0.72 &&
        v >= 0.25
      );
      if (isSkin) {
        skinCount++;
        if (y <= upperYThreshold) {
          upperSkinCount++;
        }
      }

      // 2. High saturation (Anime / Cartoon / Cel-shaded character palettes)
      if (s >= 0.52 && v >= 0.30) {
        vibrantCount++;
      }

      // Stylized character cues: vibrant anime hair / eyes / outfits
      if (s >= 0.58 && v >= 0.35) {
        if ((hue >= 175 && hue <= 335) || (hue >= 25 && hue <= 55) || (hue >= 85 && hue <= 155)) {
          stylizedHairCount++;
        }
      }

      // 3. Flower Petal Colors:
      const isPetalHue = (
        ((hue >= 290 && hue <= 345) && s >= 0.38) ||
        (((hue >= 345 && hue <= 360) || (hue >= 0 && hue <= 25)) && s >= 0.48) ||
        ((hue >= 32 && hue <= 65) && s >= 0.55) ||
        ((hue >= 250 && hue <= 290) && s >= 0.38)
      );
      if (isPetalHue) {
        petalColorCount++;
      }

      // 4. Car / Vehicle Cues:
      if (lum >= 210 && s <= 0.22) {
        specularCount++;
      }
      if (y >= lowerYThreshold && lum <= 55) {
        darkBottomCount++;
      }
    }
  }

  // Check surrounding background context for green foliage (leaves/stems around flower)
  let foliageCount = 0;
  if (Array.isArray(borderPixels) && borderPixels.length > 0) {
    for (const bp of borderPixels) {
      const rn = bp.r / 255, gn = bp.g / 255, bn = bp.b / 255;
      const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn);
      const diff = mx - mn;
      if (diff > 0.001) {
        let hDeg = 0;
        if (mx === rn) hDeg = ((gn - bn) / diff) % 6;
        else if (mx === gn) hDeg = (bn - rn) / diff + 2;
        else hDeg = (rn - gn) / diff + 4;
        hDeg = (hDeg * 60 + 360) % 360;
        const sat = diff / mx;
        if (hDeg >= 75 && hDeg <= 165 && sat >= 0.20 && bp.lum >= 25 && bp.lum <= 200) {
          foliageCount++;
        }
      }
    }
  }

  const foliageRatio = borderPixels.length > 0 ? foliageCount / borderPixels.length : 0;
  const skinRatio = skinCount / count;
  const upperRegionArea = Math.max(1, count * 0.40);
  const upperSkinRatio = upperSkinCount / upperRegionArea;
  const vibrantRatio = vibrantCount / count;
  const stylizedRatio = stylizedHairCount / count;
  const petalRatio = petalColorCount / count;
  const specularRatio = specularCount / count;
  const darkBottomRatio = darkBottomCount / Math.max(1, count * 0.25);
  const avgSat = totalSatSum / count;

  const isPortraitAspect = aspect >= 0.28 && aspect <= 1.15;
  const isHorizontalAspect = aspect >= 1.25 && aspect <= 3.8;
  const circularity = shapeInfo?.circularity || 0;
  // A true circle is determined by rigorous Kåsa algebraic fit, radial CV, and aspect ratio
  const isCircular = shapeInfo?.shapeType === 'circle';

  // --- SCORE COMPUTATION ---

  // 1. Flower Score:
  // True flowers MUST have either radial/circular geometry (shapeType === 'circle')
  // OR botanical foliage context (green leaves/stems in background/perimeter)
  const hasBotanicalContext = foliageRatio >= 0.08;
  const hasFlowerGeometry = isCircular;

  let flowerScore = 0;
  if (hasFlowerGeometry || hasBotanicalContext) {
    flowerScore += petalRatio * 1.6;
    if (isCircular) flowerScore += 0.45;
    if (hasBotanicalContext) flowerScore += 0.40;
    if (hasFlowerGeometry && hasBotanicalContext) flowerScore += 0.35;
  } else {
    // Without radial circularity or foliage, red/pink is just paint or apparel
    flowerScore = petalRatio * 0.15;
  }
  // Flowers are rarely wide horizontal rectangles; penalize if clearly horizontal
  if (isHorizontalAspect) flowerScore *= 0.15;

  // 2. Car Score:
  // Horizontal aspect ratio + grounded to bottom + high solidity + specular highlights + dark wheels
  let carScore = 0;
  if (isHorizontalAspect) carScore += 0.55;
  if (isGroundGrounded) carScore += 0.35;
  if (solidity >= 0.40 && solidity <= 0.96) carScore += 0.25;
  carScore += Math.min(0.35, specularRatio * 3.0);
  carScore += Math.min(0.35, darkBottomRatio * 2.0);
  if (isHorizontalAspect && isGroundGrounded) {
    carScore += 0.40;
  }
  // Cars are not circular and not vertical portraits
  if (isCircular) carScore *= 0.10;
  if (isPortraitAspect) carScore *= 0.20;

  // 3. Human Score:
  // Photographic skin locus concentrated in upper face/neck + portrait aspect ratio + natural saturation
  let humanScore = skinRatio * 2.2 + upperSkinRatio * 1.4;
  if (isPortraitAspect) humanScore += 0.30;
  if (isGroundGrounded) humanScore += 0.12;
  if (avgSat <= 0.48) humanScore += 0.12;
  if (skinRatio >= 0.08 && isPortraitAspect) humanScore += 0.20;
  if (isHorizontalAspect) humanScore *= 0.40;

  // 4. Character (Anime / Stylized) Score:
  // Very high color saturation, stylized vibrant hair/costume, cel-shading outlines
  let characterScore = vibrantRatio * 1.6 + stylizedRatio * 1.8;
  if (isPortraitAspect) characterScore += 0.25;
  if (avgSat >= 0.45) characterScore += 0.25;
  if (stylizedRatio >= 0.15) characterScore += 0.30;
  if (isPortraitAspect && (stylizedRatio >= 0.08 || vibrantRatio >= 0.30)) {
    characterScore += 0.30;
  }

  // Mutual exclusion between Anime/Stylized Character vs Natural Photographic Human:
  // If vibrant anime hair or cel-shaded palette is detected, penalize humanScore and boost characterScore
  const isStylized = stylizedRatio >= 0.06 || vibrantRatio >= 0.25 || (avgSat >= 0.45 && stylizedRatio >= 0.03);
  if (isStylized) {
    characterScore += 0.50;
    humanScore *= 0.30;
  }

  // Circular blooms and horizontal cars are not characters
  if (isCircular && (petalRatio >= 0.20 || hasBotanicalContext)) characterScore *= 0.15;
  if (isHorizontalAspect) characterScore *= 0.40;

  const scores = {
    character: Number(characterScore.toFixed(3)),
    human: Number(humanScore.toFixed(3)),
    car: Number(carScore.toFixed(3)),
    flower: Number(flowerScore.toFixed(3))
  };

  let category = 'object';
  let label = 'Main Object';
  let bestScore = 0.35;

  if (carScore > bestScore && carScore > Math.max(humanScore, characterScore, flowerScore)) {
    category = 'car';
    label = 'Car / Vehicle';
    bestScore = carScore;
  } else if (flowerScore > bestScore && flowerScore > Math.max(humanScore, characterScore, carScore)) {
    category = 'flower';
    label = 'Flower / Botanical';
    bestScore = flowerScore;
  } else if (characterScore > bestScore && characterScore > humanScore) {
    category = 'character';
    label = 'Anime Character';
    bestScore = characterScore;
  } else if (humanScore > bestScore) {
    category = 'human';
    label = 'Human Portrait';
    bestScore = humanScore;
  }

  const semanticConfidence = Math.min(0.98, Math.max(0.55, Number(bestScore.toFixed(2))));

  return {
    category,
    label,
    confidence: semanticConfidence,
    scores
  };
}

/**
 * Refines a normalized polygon contour against higher-resolution image edge gradients.
 * Uses normal-vector edge gradient sniffing to snap coarse points to razor-sharp physical boundaries.
 *
 * @param {Array<{x: number, y: number}>} normContour
 * @param {ImageData|{data: Uint8ClampedArray|Uint8Array, width: number, height: number}} imageData
 * @param {Object} [options]
 * @returns {Array<{x: number, y: number}>}
 */
export function refineContourHighRes(normContour, imageData, options = {}) {
  if (!Array.isArray(normContour) || normContour.length < 3 || !imageData || !imageData.data) {
    return normContour || [];
  }
  const sw = imageData.width;
  const sh = imageData.height;
  if (sw < 120 || sh < 120) return normContour;

  const data = imageData.data;
  const n = normContour.length;
  const maxPixelSearch = Math.max(2, Math.min(8, Math.round(options.maxOffset || 4)));

  function getLum(px, py) {
    const x = Math.max(0, Math.min(sw - 1, px));
    const y = Math.max(0, Math.min(sh - 1, py));
    const idx = (y * sw + x) * 4;
    return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  function getGrad(px, py) {
    const gx = getLum(px + 1, py) - getLum(px - 1, py);
    const gy = getLum(px, py + 1) - getLum(px, py - 1);
    return Math.sqrt(gx * gx + gy * gy);
  }

  const refined = [];

  for (let i = 0; i < n; i++) {
    const curr = normContour[i];
    const prev = normContour[(i - 1 + n) % n];
    const next = normContour[(i + 1) % n];

    const cx = curr.x * sw;
    const cy = curr.y * sh;

    const tx = (next.x - prev.x) * sw;
    const ty = (next.y - prev.y) * sh;
    const tLen = Math.sqrt(tx * tx + ty * ty);

    if (tLen < 1e-4) {
      refined.push(curr);
      continue;
    }

    const nx = -ty / tLen;
    const ny = tx / tLen;

    const baseGrad = getGrad(Math.round(cx), Math.round(cy));
    let bestGrad = baseGrad;
    let bestOffset = 0;

    for (let step = -maxPixelSearch; step <= maxPixelSearch; step++) {
      if (step === 0) continue;
      const sx = Math.round(cx + nx * step);
      const sy = Math.round(cy + ny * step);
      if (sx < 1 || sx >= sw - 1 || sy < 1 || sy >= sh - 1) continue;

      const g = getGrad(sx, sy);
      if (g > bestGrad && g >= 24) {
        bestGrad = g;
        bestOffset = step;
      }
    }

    if (bestOffset !== 0) {
      const snappedX = Math.max(0, Math.min(1, Number(((cx + nx * bestOffset) / sw).toFixed(4))));
      const snappedY = Math.max(0, Math.min(1, Number(((cy + ny * bestOffset) / sh).toFixed(4))));
      refined.push({ x: snappedX, y: snappedY });
    } else {
      refined.push(curr);
    }
  }

  return refined;
}

/**
 * Detects the main salient object(s) using an external Vision AI model (e.g. OpenRouter).
 * Identifies characters, humans, cars, flowers, and real-world objects with open-vocabulary precision.
 *
 * @param {string} imageSrc - Image URL or Data URL
 * @param {Object} [options] - Configuration including apiKey and model
 * @returns {Promise<{hasObject: boolean, category: string, label: string, confidence: number, boundingBox: Object, boundingBoxes?: Array<Object>}|null>}
 */
export async function detectMainObjectWithVisionAI(imageSrc, options = {}) {
  let provider = options.provider || null;
  let apiKey = options.apiKey || null;
  let model = options.model || null;

  if (typeof chrome !== 'undefined' && chrome.storage?.local && (!apiKey || !provider)) {
    try {
      const stored = await new Promise((resolve) => chrome.storage.local.get(['aiChatSettings'], resolve));
      if (!provider) provider = stored?.aiChatSettings?.provider || 'openrouter';
      if (!apiKey) {
        apiKey = stored?.aiChatSettings?.providers?.[provider]?.apiKey || stored?.aiChatSettings?.apiKey || null;
      }
      if (!model) {
        model = stored?.aiChatSettings?.providers?.[provider]?.model || stored?.aiChatSettings?.model || null;
      }
    } catch (_) {}
  }

  provider = String(provider || 'openrouter').trim().toLowerCase();
  if (provider === 'gemini' || provider === 'google-ai-studio') provider = 'google';

  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return null;
  }

  const systemPrompt = `Analyze this wallpaper image. Identify the PRIMARY main salient object in the scene (such as a character, human, car, flower, animal, or prominent real-world object).
Return ONLY a valid, raw JSON object without markdown formatting, code fences, or explanations.
The JSON MUST conform strictly to this format:
{
  "hasObject": true,
  "category": "character" | "human" | "car" | "flower" | "object",
  "label": "Brief descriptive label (e.g. Anime Character, Sports Car, Red Rose, Human Portrait)",
  "confidence": 0.95,
  "boundingBox": {
    "xMin": 0.20,
    "yMin": 0.15,
    "xMax": 0.80,
    "yMax": 0.85
  }
}`;

  try {
    let response = null;

    if (provider === 'openai') {
      const oaiModel = (model || 'gpt-4o-mini').replace(/^openai\//, '');
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify({
          model: oaiModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: systemPrompt },
                { type: 'image_url', image_url: { url: imageSrc } }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 600
        })
      });
    } else if (provider === 'google') {
      let cleanModel = (model || 'gemini-flash-latest').replace(/^models\//, '').replace(/^google\//, '');
      if (!cleanModel || cleanModel.includes('/') || cleanModel.startsWith('gpt-')) cleanModel = 'gemini-flash-latest';

      const parts = [{ text: systemPrompt }];
      const dataMatch = String(imageSrc).match(/^data:([^;]+);base64,(.+)$/);
      if (dataMatch) {
        parts.push({
          inlineData: {
            mimeType: dataMatch[1],
            data: dataMatch[2]
          }
        });
      }

      const makeGoogleVisionUrl = (mName) =>
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mName)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

      response = await fetch(makeGoogleVisionUrl(cleanModel), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey.trim()
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 600
          }
        })
      });

      if (!response.ok && response.status === 404) {
        const visionFallbacks = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash-latest'].filter((m) => m !== cleanModel);
        for (const fbModel of visionFallbacks) {
          try {
            const fbResp = await fetch(makeGoogleVisionUrl(fbModel), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': apiKey.trim()
              },
              body: JSON.stringify({
                contents: [{ role: 'user', parts }],
                generationConfig: {
                  temperature: 0.1,
                  maxOutputTokens: 600
                }
              })
            });
            if (fbResp.ok) {
              response = fbResp;
              break;
            }
          } catch (_) {}
        }
      }
    } else {
      const orModel = model || 'google/gemini-2.0-flash-001';
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
          'HTTP-Referer': 'https://chrome-liquid-glass.local',
          'X-Title': 'Liquid Glass New Tab'
        },
        body: JSON.stringify({
          model: orModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: systemPrompt },
                { type: 'image_url', image_url: { url: imageSrc } }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 600
        })
      });
    }

    if (!response || !response.ok) return null;

    const data = await response.json();
    let rawContent = '';
    if (provider === 'google') {
      const parts = data.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        rawContent = parts.map((p) => p?.text || '').join('\n').trim();
      }
    } else {
      rawContent = data.choices?.[0]?.message?.content?.trim() || '';
    }
    if (!rawContent) return null;

    const cleanJson = rawContent.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleanJson);

    if (parsed && parsed.hasObject && parsed.boundingBox) {
      const b = parsed.boundingBox;
      const xMin = Math.max(0, Math.min(1, Number(b.xMin)));
      const xMax = Math.max(0, Math.min(1, Number(b.xMax)));
      const yMin = Math.max(0, Math.min(1, Number(b.yMin)));
      const yMax = Math.max(0, Math.min(1, Number(b.yMax)));
      const category = parsed.category || 'object';
      const label = parsed.label || 'Main Object';
      const confidence = Number(parsed.confidence) || 0.95;

      const normBox = {
        xMin,
        yMin,
        xMax,
        yMax,
        category,
        label,
        shapeType: 'polygon',
        circle: null,
        contour: [
          { x: xMin, y: yMin },
          { x: xMax, y: yMin },
          { x: xMax, y: yMax },
          { x: xMin, y: yMax }
        ],
        contours: [[
          { x: xMin, y: yMin },
          { x: xMax, y: yMin },
          { x: xMax, y: yMax },
          { x: xMin, y: yMax }
        ]],
        svgPath: `M ${(xMin * 100).toFixed(2)} ${(yMin * 100).toFixed(2)} L ${(xMax * 100).toFixed(2)} ${(yMin * 100).toFixed(2)} L ${(xMax * 100).toFixed(2)} ${(yMax * 100).toFixed(2)} L ${(xMin * 100).toFixed(2)} ${(yMax * 100).toFixed(2)} Z`,
        svgPaths: [`M ${(xMin * 100).toFixed(2)} ${(yMin * 100).toFixed(2)} L ${(xMax * 100).toFixed(2)} ${(yMin * 100).toFixed(2)} L ${(xMax * 100).toFixed(2)} ${(yMax * 100).toFixed(2)} L ${(xMin * 100).toFixed(2)} ${(yMax * 100).toFixed(2)} Z`]
      };

      return {
        hasObject: true,
        category,
        label,
        confidence,
        boundingBox: normBox,
        boundingBoxes: [normBox],
        shapeType: 'polygon',
        circle: null,
        contour: normBox.contour,
        contours: normBox.contours,
        svgPath: normBox.svgPath,
        svgPaths: normBox.svgPaths,
        source: 'vision-ai'
      };
    }
  } catch (err) {
    // Graceful fallback to Tier 2 CV
  }
  return null;
}

/**
 * Detects the main salient object in an image from pixel data.
 * Works across Service Worker (OffscreenCanvas), DOM Window (HTMLCanvas), and headless/test environments.
 *
 * @param {ImageData|{data: Uint8ClampedArray|Uint8Array, width: number, height: number}} imageData
 * @param {Object} [options]
 * @returns {{hasObject: boolean, confidence: number, boundingBox: {xMin: number, yMin: number, xMax: number, yMax: number}|null, centroid?: {x: number, y: number}, message?: string}}
 */
export function detectMainObjectFromImageData(imageData, options = {}) {
  const {
    minAreaRatio = 0.01, // Lowered to 1% to recognize crisp smaller focal subjects (moons, emblems, distant silhouettes)
    maxAreaRatio = 0.85, // At most 85% of image area
    marginRatio = 0.04,  // 4% margin around detected object
    downsampleMax = 120  // Downsample to max 120px for high-speed analysis
  } = options;

  if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
    return { hasObject: false, confidence: 0, boundingBox: null, error: 'Invalid image data' };
  }

  const srcW = imageData.width;
  const srcH = imageData.height;
  const srcData = imageData.data;

  // 1. Compute downsampled processing dimensions
  const scale = Math.min(1, downsampleMax / Math.max(srcW, srcH));
  const w = Math.max(16, Math.round(srcW * scale));
  const h = Math.max(16, Math.round(srcH * scale));

  // Buffers for downsampled RGB and luminance
  const rBuf = new Float32Array(w * h);
  const gBuf = new Float32Array(w * h);
  const bBuf = new Float32Array(w * h);
  const lumBuf = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const srcY = Math.min(srcH - 1, Math.floor(y / scale));
    const rowOffset = y * w;
    const srcRowOffset = srcY * srcW;
    for (let x = 0; x < w; x++) {
      const srcX = Math.min(srcW - 1, Math.floor(x / scale));
      const srcIdx = (srcRowOffset + srcX) * 4;
      const r = srcData[srcIdx];
      const g = srcData[srcIdx + 1];
      const b = srcData[srcIdx + 2];
      const idx = rowOffset + x;
      rBuf[idx] = r;
      gBuf[idx] = g;
      bBuf[idx] = b;
      lumBuf[idx] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

  // 2. Sample perimeter border pixels to model multi-modal background palette
  const borderMarginX = Math.max(1, Math.round(w * 0.08));
  const borderMarginY = Math.max(1, Math.round(h * 0.08));

  // Partition perimeter into 4 edges and 4 corners to handle 2D, horizontal, vertical & diagonal gradients
  const borderPixels = [];
  const topPixels = [];
  const bottomPixels = [];
  const leftPixels = [];
  const rightPixels = [];
  const tlPixels = [];
  const trPixels = [];
  const blPixels = [];
  const brPixels = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const isTop = y < borderMarginY;
      const isBottom = y >= h - borderMarginY;
      const isLeft = x < borderMarginX;
      const isRight = x >= w - borderMarginX;

      if (isTop || isBottom || isLeft || isRight) {
        const idx = y * w + x;
        const p = { r: rBuf[idx], g: gBuf[idx], b: bBuf[idx], lum: lumBuf[idx], x, y };
        borderPixels.push(p);
        if (isTop) topPixels.push(p);
        if (isBottom) bottomPixels.push(p);
        if (isLeft) leftPixels.push(p);
        if (isRight) rightPixels.push(p);
        if (isTop && isLeft) tlPixels.push(p);
        if (isTop && isRight) trPixels.push(p);
        if (isBottom && isLeft) blPixels.push(p);
        if (isBottom && isRight) brPixels.push(p);
      }
    }
  }

  function getMedianColor(pixels) {
    if (!pixels.length) return { r: 128, g: 128, b: 128, lum: 128 };
    const sorted = [...pixels].sort((a, b) => a.lum - b.lum);
    const medianLum = sorted[Math.floor(sorted.length / 2)].lum;
    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    for (const p of sorted) {
      if (Math.abs(p.lum - medianLum) <= 50) {
        sumR += p.r;
        sumG += p.g;
        sumB += p.b;
        count++;
      }
    }
    if (!count) return sorted[Math.floor(sorted.length / 2)];
    return { r: sumR / count, g: sumG / count, b: sumB / count, lum: medianLum };
  }

  const globalBg = getMedianColor(borderPixels);
  const topBg = getMedianColor(topPixels.length ? topPixels : borderPixels);
  const bottomBg = getMedianColor(bottomPixels.length ? bottomPixels : borderPixels);
  const leftBg = getMedianColor(leftPixels.length ? leftPixels : borderPixels);
  const rightBg = getMedianColor(rightPixels.length ? rightPixels : borderPixels);
  const tlBg = getMedianColor(tlPixels.length ? tlPixels : borderPixels);
  const trBg = getMedianColor(trPixels.length ? trPixels : borderPixels);
  const blBg = getMedianColor(blPixels.length ? blPixels : borderPixels);
  const brBg = getMedianColor(brPixels.length ? brPixels : borderPixels);

  // Collect distinct background color modes
  const bgClusters = [globalBg, topBg, bottomBg, leftBg, rightBg, tlBg, trBg, blBg, brBg];

  // Perceptual color distance function (weighted CIE approximation in RGB + non-linear lightness & Weber contrast)
  function getPerceptualColorDist(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    const meanR = (r1 + r2) * 0.5;
    const wR = 2.0 + meanR / 256.0;
    const wG = 4.0;
    const wB = 2.0 + (255.0 - meanR) / 256.0;
    const rgbDist = Math.sqrt(wR * dr * dr + wG * dg * dg + wB * db * db) / 765.0; // Normalized [0, 1]

    // Perceptual non-linear lightness contrast (cube-root lightness response)
    const l1 = (0.299 * r1 + 0.587 * g1 + 0.114 * b1) / 255.0;
    const l2 = (0.299 * r2 + 0.587 * g2 + 0.114 * b2) / 255.0;
    const pL1 = Math.cbrt(Math.max(0, l1));
    const pL2 = Math.cbrt(Math.max(0, l2));
    const deltaLightness = Math.abs(pL1 - pL2);

    // Weber-Fechner relative contrast for dark mode images
    const weberContrast = Math.abs(l1 - l2) / Math.max(0.08, Math.min(l1, l2) + 0.05);
    const weberNorm = Math.min(1.0, weberContrast * 0.35);

    // CIELAB Delta E perceptual color distance
    const lab1 = rgbToLab(r1, g1, b1);
    const lab2 = rgbToLab(r2, g2, b2);
    const dE = deltaE(lab1, lab2) / 100.0;

    return Math.max(rgbDist, deltaLightness * 0.90, weberNorm * 0.50, dE * 0.85);
  }

  // Multi-scale separable box blur of luminance and RGB channels for local center-surround contrast
  function boxBlurChannel(channelBuf, radius) {
    const temp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        let sum = 0, count = 0;
        const x1 = Math.max(0, x - radius);
        const x2 = Math.min(w - 1, x + radius);
        for (let kx = x1; kx <= x2; kx++) {
          sum += channelBuf[rowOffset + kx];
          count++;
        }
        temp[rowOffset + x] = sum / count;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let sum = 0, count = 0;
        const y1 = Math.max(0, y - radius);
        const y2 = Math.min(h - 1, y + radius);
        for (let ky = y1; ky <= y2; ky++) {
          sum += temp[ky * w + x];
          count++;
        }
        out[y * w + x] = sum / count;
      }
    }
    return out;
  }

  const blurRadius = Math.max(2, Math.min(6, Math.round(Math.min(w, h) * 0.05)));
  const blurLum = boxBlurChannel(lumBuf, blurRadius);
  const surroundRadius = Math.max(3, Math.min(10, Math.round(Math.min(w, h) * 0.08)));
  const blurR = boxBlurChannel(rBuf, surroundRadius);
  const blurG = boxBlurChannel(gBuf, surroundRadius);
  const blurB = boxBlurChannel(bBuf, surroundRadius);

  // Raw gradient magnitude buffer for boundary edge verification
  const gradBuf = new Float32Array(w * h);

  // 3. Compute Perceptual Color Contrast + Edge Energy + Local Contrast + Spatial Prior for Saliency
  const saliency = new Float32Array(w * h);
  let maxSal = 0;
  let sumSal = 0;

  const cx = w / 2;
  const cy = h / 2;

  for (let y = 0; y < h; y++) {
    const v = y / Math.max(1, h - 1);
    // Vertical gradient reference
    const vertBgR = topBg.r * (1 - v) + bottomBg.r * v;
    const vertBgG = topBg.g * (1 - v) + bottomBg.g * v;
    const vertBgB = topBg.b * (1 - v) + bottomBg.b * v;

    for (let x = 0; x < w; x++) {
      const u = x / Math.max(1, w - 1);
      const idx = y * w + x;
      const r = rBuf[idx];
      const g = gBuf[idx];
      const b = bBuf[idx];

      // Horizontal gradient reference
      const horizBgR = leftBg.r * (1 - u) + rightBg.r * u;
      const horizBgG = leftBg.g * (1 - u) + rightBg.g * u;
      const horizBgB = leftBg.b * (1 - u) + rightBg.b * u;

      // 4-corner bilinear gradient reference
      const b11 = (1 - u) * (1 - v);
      const b12 = u * (1 - v);
      const b21 = (1 - u) * v;
      const b22 = u * v;
      const bilinBgR = b11 * tlBg.r + b12 * trBg.r + b21 * blBg.r + b22 * brBg.r;
      const bilinBgG = b11 * tlBg.g + b12 * trBg.g + b21 * blBg.g + b22 * brBg.g;
      const bilinBgB = b11 * tlBg.b + b12 * trBg.b + b21 * blBg.b + b22 * brBg.b;

      // Perceptual distance to 2D gradient models
      let minColorDist = getPerceptualColorDist(r, g, b, bilinBgR, bilinBgG, bilinBgB);
      const distVert = getPerceptualColorDist(r, g, b, vertBgR, vertBgG, vertBgB);
      if (distVert < minColorDist) minColorDist = distVert;
      const distHoriz = getPerceptualColorDist(r, g, b, horizBgR, horizBgG, horizBgB);
      if (distHoriz < minColorDist) minColorDist = distHoriz;

      // Also compare against perimeter mode clusters
      for (const bg of bgClusters) {
        const d = getPerceptualColorDist(r, g, b, bg.r, bg.g, bg.b);
        if (d < minColorDist) minColorDist = d;
      }

      // Multi-channel Euclidean color gradient across R, G, B channels
      const lIdx = x > 0 ? idx - 1 : idx;
      const rIdx = x < w - 1 ? idx + 1 : idx;
      const tIdx = y > 0 ? idx - w : idx;
      const bIdx = y < h - 1 ? idx + w : idx;

      const drX = (rBuf[rIdx] - rBuf[lIdx]) * 0.5;
      const dgX = (gBuf[rIdx] - gBuf[lIdx]) * 0.5;
      const dbX = (bBuf[rIdx] - bBuf[lIdx]) * 0.5;
      const drY = (rBuf[bIdx] - rBuf[tIdx]) * 0.5;
      const dgY = (gBuf[bIdx] - gBuf[tIdx]) * 0.5;
      const dbY = (bBuf[bIdx] - bBuf[tIdx]) * 0.5;

      const colorGradX = Math.sqrt(drX * drX + dgX * dgX + dbX * dbX);
      const colorGradY = Math.sqrt(drY * drY + dgY * dgY + dbY * dbY);
      const colorGradMag = Math.sqrt(colorGradX * colorGradX + colorGradY * colorGradY);
      gradBuf[idx] = colorGradMag;
      const grad = Math.min(1, colorGradMag / 80);

      // Local center-surround contrast (both chromatic and luminance)
      const localColorDist = getPerceptualColorDist(r, g, b, blurR[idx], blurG[idx], blurB[idx]);
      const localLumContrast = Math.abs(lumBuf[idx] - blurLum[idx]) / 255;
      const localContrast = Math.max(localColorDist, localLumContrast);

      // Rule-of-thirds plateau spatial prior (avoids penalizing off-center photographic compositions)
      const distX = Math.max(0, Math.abs(x - cx) - w * 0.16);
      const distY = Math.max(0, Math.abs(y - cy) - h * 0.18);
      const normDist = (distX / (w * 0.38)) ** 2 + (distY / (h * 0.40)) ** 2;
      const spatialPrior = Math.exp(-0.5 * normDist);
      const spatialWeight = 0.40 + 0.60 * spatialPrior;

      // Combined multi-cue saliency
      const s = (0.45 * minColorDist + 0.33 * grad + 0.22 * localContrast) * spatialWeight;
      saliency[idx] = s;
      if (s > maxSal) maxSal = s;
      sumSal += s;
    }
  }

  // 4. Smooth saliency map with two-pass box filter
  const smoothed = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? saliency : smoothed;
    const dest = smoothed;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum += src[(y + dy) * w + (x + dx)];
          }
        }
        dest[y * w + x] = sum / 9;
      }
    }
    // Copy borders
    for (let x = 0; x < w; x++) {
      dest[x] = src[x];
      dest[(h - 1) * w + x] = src[(h - 1) * w + x];
    }
    for (let y = 0; y < h; y++) {
      dest[y * w] = src[y * w];
      dest[y * w + (w - 1)] = src[y * w + (w - 1)];
    }
  }

  // 5. Compute variance of saliency to check if a distinct object exists
  const meanSal = sumSal / (w * h);
  let variance = 0;
  for (let i = 0; i < w * h; i++) {
    const diff = smoothed[i] - meanSal;
    variance += diff * diff;
  }
  const stdDev = Math.sqrt(variance / (w * h));

  // If variance is very small or peak saliency is negligible, image is flat/ambient
  if (stdDev < 0.010 || maxSal < 0.045) {
    return {
      hasObject: false,
      confidence: 0,
      boundingBox: null,
      message: 'Homogeneous image with no salient object'
    };
  }

  // 6. Otsu's Adaptive Thresholding for optimal foreground binarization
  const NUM_BINS = 100;
  const hist = new Int32Array(NUM_BINS);
  const binScale = (NUM_BINS - 1) / Math.max(0.001, maxSal);
  for (let i = 0; i < w * h; i++) {
    const b = Math.max(0, Math.min(NUM_BINS - 1, Math.round(smoothed[i] * binScale)));
    hist[b]++;
  }

  const totalPixels = w * h;
  let sumB = 0;
  let wB = 0;
  let maximumVariance = 0;
  let otsuThresholdBin = 0;
  let totalSum = 0;
  for (let i = 0; i < NUM_BINS; i++) totalSum += i * hist[i];

  for (let t = 0; t < NUM_BINS; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = totalPixels - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (totalSum - sumB) / wF;
    const betweenVariance = wB * wF * (mB - mF) * (mB - mF);
    if (betweenVariance > maximumVariance) {
      maximumVariance = betweenVariance;
      otsuThresholdBin = t;
    }
  }

  const otsuThreshold = (otsuThresholdBin / binScale);
  // Adaptive threshold balancing Otsu's method, statistical mean+spread, and peak saliency floor
  const threshold = Math.max(0.045, Math.min(maxSal * 0.65, Math.max(otsuThreshold, meanSal + 0.35 * stdDev, maxSal * 0.30)));

  const binary = new Uint8Array(w * h);
  let salientCount = 0;

  for (let i = 0; i < w * h; i++) {
    if (smoothed[i] >= threshold) {
      binary[i] = 1;
      salientCount++;
    }
  }

  const salientAreaRatio = salientCount / (w * h);
  if (salientAreaRatio < minAreaRatio || salientAreaRatio > maxAreaRatio) {
    return {
      hasObject: false,
      confidence: 0.15,
      boundingBox: null,
      message: 'Salient area outside reasonable object boundaries'
    };
  }

  // Morphological Closing (Dilation followed by Erosion) to bridge adjacent subject parts (head, body, limbs)
  const dilated = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let isSet = 0;
      for (let dy = -1; dy <= 1 && !isSet; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w && binary[ny * w + nx] === 1) {
            isSet = 1;
            break;
          }
        }
      }
      dilated[y * w + x] = isSet;
    }
  }

  const closed = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let allSet = 1;
      for (let dy = -1; dy <= 1 && allSet; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w && dilated[ny * w + nx] === 0) {
            allSet = 0;
            break;
          }
        }
      }
      closed[y * w + x] = allSet;
    }
  }

  // Exact morphological hole / cavity filling via boundary-seeded flood-fill:
  // Reaches all outer background pixels connected to the borders. Any unreached pixel is internal cavity.
  const bgReached = new Uint8Array(w * h);
  const floodQueue = [];
  for (let x = 0; x < w; x++) {
    if (closed[x] === 0 && !bgReached[x]) { bgReached[x] = 1; floodQueue.push(x); }
    const bIdx = (h - 1) * w + x;
    if (closed[bIdx] === 0 && !bgReached[bIdx]) { bgReached[bIdx] = 1; floodQueue.push(bIdx); }
  }
  for (let y = 0; y < h; y++) {
    const lIdx = y * w;
    if (closed[lIdx] === 0 && !bgReached[lIdx]) { bgReached[lIdx] = 1; floodQueue.push(lIdx); }
    const rIdx = y * w + (w - 1);
    if (closed[rIdx] === 0 && !bgReached[rIdx]) { bgReached[rIdx] = 1; floodQueue.push(rIdx); }
  }
  let fHead = 0;
  while (fHead < floodQueue.length) {
    const curr = floodQueue[fHead++];
    const cy = Math.floor(curr / w);
    const cx = curr % w;
    const neighbors = [
      cx > 0 ? curr - 1 : -1,
      cx < w - 1 ? curr + 1 : -1,
      cy > 0 ? curr - w : -1,
      cy < h - 1 ? curr + w : -1
    ];
    for (const n of neighbors) {
      if (n >= 0 && closed[n] === 0 && bgReached[n] === 0) {
        bgReached[n] = 1;
        floodQueue.push(n);
      }
    }
  }

  const filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    filled[i] = bgReached[i] === 0 ? 1 : 0;
  }

  // 7. Find Connected Components on the closed & filled mask
  const labels = new Int32Array(w * h).fill(0);
  let currentLabel = 0;
  const rawComponents = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (filled[idx] === 1 && labels[idx] === 0) {
        currentLabel++;
        const queue = [idx];
        const compPixels = [idx];
        labels[idx] = currentLabel;
        let compMinX = x;
        let compMaxX = x;
        let compMinY = y;
        let compMaxY = y;
        let compCount = 0;
        let compMass = 0;
        let sumX = 0;
        let sumY = 0;

        let qHead = 0;
        while (qHead < queue.length) {
          const curr = queue[qHead++];
          const cy = Math.floor(curr / w);
          const cx = curr % w;

          compCount++;
          const weight = smoothed[curr];
          compMass += weight;
          sumX += cx * weight;
          sumY += cy * weight;

          if (cx < compMinX) compMinX = cx;
          if (cx > compMaxX) compMaxX = cx;
          if (cy < compMinY) compMinY = cy;
          if (cy > compMaxY) compMaxY = cy;

          // 4-neighborhood
          const neighbors = [
            cx > 0 ? curr - 1 : -1,
            cx < w - 1 ? curr + 1 : -1,
            cy > 0 ? curr - w : -1,
            cy < h - 1 ? curr + w : -1
          ];

          for (const n of neighbors) {
            if (n >= 0 && filled[n] === 1 && labels[n] === 0) {
              labels[n] = currentLabel;
              queue.push(n);
              compPixels.push(n);
            }
          }
        }

        // Measure boundary edge gradient to distinguish physical objects from diffuse vignettes
        let sumBoundaryGrad = 0;
        let edgePixelCount = 0;
        let maxBoundaryGrad = 0;

        for (const pIdx of compPixels) {
          const cy = Math.floor(pIdx / w);
          const cx = pIdx % w;
          const isBoundary = (cx === 0 || cx === w - 1 || cy === 0 || cy === h - 1) ||
            (filled[pIdx - 1] === 0 || filled[pIdx + 1] === 0 || filled[pIdx - w] === 0 || filled[pIdx + w] === 0);
          if (isBoundary) {
            const g = gradBuf[pIdx];
            sumBoundaryGrad += g;
            edgePixelCount++;
            if (g > maxBoundaryGrad) maxBoundaryGrad = g;
          }
        }

        const avgBoundaryGrad = edgePixelCount > 0 ? sumBoundaryGrad / edgePixelCount : 0;

        rawComponents.push({
          label: currentLabel,
          count: compCount,
          mass: compMass,
          minX: compMinX,
          maxX: compMaxX,
          minY: compMinY,
          maxY: compMaxY,
          centerX: sumX / Math.max(1, compMass),
          centerY: sumY / Math.max(1, compMass),
          avgBoundaryGrad,
          maxBoundaryGrad
        });
      }
    }
  }

  // Filter components: eliminate diffuse ambient gradients, vignettes, or smooth lighting
  // A true object must have a coherent boundary gradient (max edge >= 8.0 or avg edge >= 5.0 for multi-channel RGB)
  const components = rawComponents.filter(c => c.maxBoundaryGrad >= 8.0 || c.avgBoundaryGrad >= 5.0);

  if (!components.length) {
    return {
      hasObject: false,
      confidence: 0,
      boundingBox: null,
      message: 'Homogeneous or diffuse ambient gradient with no distinct object boundary'
    };
  }

  // Sort components by mass (most salient primary component first)
  components.sort((a, b) => b.mass - a.mass);
  const primary = components[0];

  if (primary.count / (w * h) < minAreaRatio) {
    return { hasObject: false, confidence: 0.2, boundingBox: null };
  }

  // Multi-pass component grouping to build a cohesive subject entity from seed component
  function buildSubjectFromSeed(seedComp, pool) {
    let sMinX = seedComp.minX;
    let sMaxX = seedComp.maxX;
    let sMinY = seedComp.minY;
    let sMaxY = seedComp.maxY;
    let sMass = seedComp.mass;
    let sCount = seedComp.count;
    let sSumX = seedComp.centerX * seedComp.mass;
    let sSumY = seedComp.centerY * seedComp.mass;

    const mergedLabels = new Set([seedComp.label]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of pool) {
        if (mergedLabels.has(c.label)) continue;

        const xDist = Math.max(0, Math.max(sMinX - c.maxX, c.minX - sMaxX));
        const yDist = Math.max(0, Math.max(sMinY - c.maxY, c.minY - sMaxY));

        const overlapX = Math.max(0, Math.min(sMaxX, c.maxX) - Math.max(sMinX, c.minX));
        const overlapY = Math.max(0, Math.min(sMaxY, c.maxY) - Math.max(sMinY, c.minY));

        const isClose = xDist <= w * 0.10 && yDist <= h * 0.12;
        const isVerticallyAligned = (xDist <= w * 0.08 || overlapX > 0) && yDist <= h * 0.20;
        const isHorizontallyAligned = (yDist <= h * 0.08 || overlapY > 0) && xDist <= w * 0.12;

        const isSignificant = (c.count / (w * h) > 0.010 || c.mass >= seedComp.mass * 0.08);
        const wouldOverExpand = (Math.max(sMaxX, c.maxX) - Math.min(sMinX, c.minX)) >= w * 0.88;

        if ((isClose || isVerticallyAligned || isHorizontallyAligned) && isSignificant && !wouldOverExpand) {
          sMinX = Math.min(sMinX, c.minX);
          sMaxX = Math.max(sMaxX, c.maxX);
          sMinY = Math.min(sMinY, c.minY);
          sMaxY = Math.max(sMaxY, c.maxY);
          sMass += c.mass;
          sCount += c.count;
          sSumX += c.centerX * c.mass;
          sSumY += c.centerY * c.mass;
          mergedLabels.add(c.label);
          changed = true;
        }
      }
    }

    // Grounded Subject Extension: If subject extends into bottom edge area (yMax >= 82%),
    // anchor down to bottom edge so widgets never overlap lower body.
    if (sMaxY >= h * 0.82 && (sMaxY - sMinY) >= h * 0.38) {
      sMaxY = h - 1;
    }
    if (sMinY <= h * 0.10 && (sMaxY - sMinY) >= h * 0.45) {
      sMinY = 0;
    }

    const xMin = Math.max(0, (sMinX / w) - marginRatio);
    const xMax = Math.min(1, ((sMaxX + 1) / w) + marginRatio);
    const yMin = Math.max(0, (sMinY / h) - marginRatio);
    const yMax = Math.min(1, ((sMaxY + 1) / h) + marginRatio);

    // Extract binary mask for this connected subject entity
    const subjectMask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (mergedLabels.has(labels[i])) {
        subjectMask[i] = 1;
      }
    }

    // Grounded Subject Extension: If subject was grounded to the bottom edge, extend mask downwards
    // to ensure contour tracing, row extents, and visual outlines are completely synchronized.
    if (sMaxY === h - 1) {
      let lastSeenMinX = sMinX;
      let lastSeenMaxX = sMaxX;
      let lastFgRow = -1;
      for (let y = h - 1; y >= 0; y--) {
        for (let x = 0; x < w; x++) {
          if (subjectMask[y * w + x] === 1) {
            lastFgRow = y;
            break;
          }
        }
        if (lastFgRow >= 0) {
          let fX = -1, lX = -1;
          for (let x = 0; x < w; x++) {
            if (subjectMask[lastFgRow * w + x] === 1) {
              if (fX < 0) fX = x;
              lX = x;
            }
          }
          if (fX >= 0) {
            lastSeenMinX = fX;
            lastSeenMaxX = lX;
          }
          break;
        }
      }
      if (lastFgRow >= 0 && lastFgRow < h - 1) {
        for (let y = lastFgRow + 1; y < h; y++) {
          for (let x = lastSeenMinX; x <= lastSeenMaxX; x++) {
            subjectMask[y * w + x] = 1;
          }
        }
      }
    }

    // Row-by-row horizontal extents across downsampled grid
    const rowExtents = computeRowExtents(subjectMask, w, h, sMinY, sMaxY);

    // Extract outer boundary contour and apply RDP polygon simplification
    let rawContour = extractContourFromMask(subjectMask, w, h);
    if (!Array.isArray(rawContour) || rawContour.length < 3) {
      // Synthesize an envelope contour directly from rowExtents to guarantee shrink-wrapped geometry
      rawContour = [];
      const rightPts = [];
      for (let y = sMinY; y <= sMaxY; y++) {
        const ext = rowExtents[y];
        if (ext) {
          rawContour.push({ x: ext.minX, y });
          rightPts.push({ x: ext.maxX, y });
        }
      }
      for (let i = rightPts.length - 1; i >= 0; i--) {
        rawContour.push(rightPts[i]);
      }
    }
    const simplifiedContour = simplifyPolygonRDP(rawContour, 1.2);

    // Classify shape (circle / contoured polygon) and fit geometric parameters
    const shapeInfo = classifyShape(
      simplifiedContour,
      {
        count: sCount,
        minX: sMinX,
        maxX: sMaxX,
        minY: sMinY,
        maxY: sMaxY,
        centerX: sSumX / Math.max(1, sMass),
        centerY: sSumY / Math.max(1, sMass)
      },
      w,
      h,
      rawContour
    );

    // Normalized contour points strictly in [0, 1]
    let normContour = simplifiedContour.map((pt) => ({
      x: Math.max(0, Math.min(1, Number((pt.x / w).toFixed(4)))),
      y: Math.max(0, Math.min(1, Number((pt.y / h).toFixed(4))))
    }));

    // Sub-pixel edge refinement against higher-resolution image if available
    if (options.refineEdges !== false && imageData && imageData.width > w) {
      normContour = refineContourHighRes(normContour, imageData, options);
    }

    // Classify semantic category of this subject
    const semanticInfo = classifyObjectSemantics(
      subjectMask,
      w,
      h,
      rBuf,
      gBuf,
      bBuf,
      lumBuf,
      {
        count: sCount,
        minX: sMinX,
        maxX: sMaxX,
        minY: sMinY,
        maxY: sMaxY,
        centerX: sSumX / Math.max(1, sMass),
        centerY: sSumY / Math.max(1, sMass)
      },
      normContour,
      shapeInfo,
      borderPixels
    );

    // SVG path string in 0..100 viewBox coordinate format (polygonal and smooth spline)
    const svgPath = normContour.length > 0
      ? normContour.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x * 100).toFixed(2)} ${(p.y * 100).toFixed(2)}`).join(' ') + ' Z'
      : '';
    const smoothSvgPath = normContour.length > 0
      ? buildSmoothContourPath(normContour.map((p) => ({ x: Number((p.x * 100).toFixed(2)), y: Number((p.y * 100).toFixed(2)) })), 0.38)
      : '';

    return {
      category: semanticInfo.category,
      label: semanticInfo.label,
      semanticConfidence: semanticInfo.confidence,
      scores: semanticInfo.scores,
      mergedLabels,
      box: {
        xMin: Number(xMin.toFixed(4)),
        yMin: Number(yMin.toFixed(4)),
        xMax: Number(xMax.toFixed(4)),
        yMax: Number(yMax.toFixed(4)),
        category: semanticInfo.category,
        label: semanticInfo.label,
        shapeType: shapeInfo.shapeType,
        circle: shapeInfo.circle,
        contour: normContour,
        contours: [normContour],
        svgPath,
        svgPaths: [svgPath],
        smoothSvgPath,
        smoothSvgPaths: [smoothSvgPath],
        rowExtents
      },
      shapeType: shapeInfo.shapeType,
      circle: shapeInfo.circle,
      contour: normContour,
      contours: [normContour],
      svgPath,
      svgPaths: [svgPath],
      smoothSvgPath,
      smoothSvgPaths: [smoothSvgPath],
      rowExtents,
      minX: sMinX,
      maxX: sMaxX,
      minY: sMinY,
      maxY: sMaxY,
      mass: sMass,
      count: sCount,
      centerX: sSumX / Math.max(1, sMass),
      centerY: sSumY / Math.max(1, sMass)
    };
  }

  // Build Subject 1 from primary component
  const subject1 = buildSubjectFromSeed(primary, components.slice(1));

  // Multi-Subject / Dual Portrait Detection:
  // Check if there is another distinct prominent subject (e.g. couple, dual portrait, two objects)
  const unmergedComps = components.filter(c => !subject1.mergedLabels.has(c.label));
  let subject2 = null;

  if (unmergedComps.length > 0) {
    unmergedComps.sort((a, b) => b.mass - a.mass);
    const cand2 = unmergedComps[0];
    const xDistFromSubj1 = Math.max(0, Math.max(subject1.minX - cand2.maxX, cand2.minX - subject1.maxX));
    const yDistFromSubj1 = Math.max(0, Math.max(subject1.minY - cand2.maxY, cand2.minY - subject1.maxY));

    const isSignificantSubj2 = (cand2.count / (w * h) >= 0.025 && cand2.mass >= primary.mass * 0.25);
    const isDistinctSpatialLocation = (xDistFromSubj1 >= w * 0.15 || yDistFromSubj1 >= h * 0.15);

    if (isSignificantSubj2 && isDistinctSpatialLocation) {
      subject2 = buildSubjectFromSeed(cand2, unmergedComps.slice(1));
    }
  }

  let finalBoundingBox;
  let boundingBoxes;
  let centroidX;
  let centroidY;
  let totalMass = subject1.mass;
  let totalCount = subject1.count;

  if (subject2) {
    // Both subjects detected: sort left-to-right
    const allBoxes = [subject1.box, subject2.box].sort((a, b) => a.xMin - b.xMin);
    boundingBoxes = allBoxes;
    finalBoundingBox = {
      xMin: Number(Math.min(subject1.box.xMin, subject2.box.xMin).toFixed(4)),
      yMin: Number(Math.min(subject1.box.yMin, subject2.box.yMin).toFixed(4)),
      xMax: Number(Math.max(subject1.box.xMax, subject2.box.xMax).toFixed(4)),
      yMax: Number(Math.max(subject1.box.yMax, subject2.box.yMax).toFixed(4)),
      category: subject1.category,
      label: subject1.label,
      semanticConfidence: subject1.semanticConfidence,
      shapeType: 'polygon',
      circle: null,
      contour: subject1.contour,
      contours: [subject1.contour, subject2.contour],
      svgPath: subject1.svgPath,
      svgPaths: [subject1.svgPath, subject2.svgPath],
      smoothSvgPath: subject1.smoothSvgPath,
      smoothSvgPaths: [subject1.smoothSvgPath, subject2.smoothSvgPath],
      rowExtents: subject1.rowExtents,
      boxes: allBoxes
    };
    totalMass += subject2.mass;
    totalCount += subject2.count;
    centroidX = (subject1.centerX * subject1.mass + subject2.centerX * subject2.mass) / totalMass;
    centroidY = (subject1.centerY * subject1.mass + subject2.centerY * subject2.mass) / totalMass;
  } else {
    boundingBoxes = [subject1.box];
    finalBoundingBox = {
      ...subject1.box,
      category: subject1.category,
      label: subject1.label,
      semanticConfidence: subject1.semanticConfidence,
      shapeType: subject1.shapeType,
      circle: subject1.circle || null,
      contour: subject1.contour,
      contours: [subject1.contour],
      svgPath: subject1.svgPath,
      svgPaths: [subject1.svgPath],
      smoothSvgPath: subject1.smoothSvgPath,
      smoothSvgPaths: [subject1.smoothSvgPath],
      rowExtents: subject1.rowExtents
    };
    centroidX = subject1.centerX;
    centroidY = subject1.centerY;
  }

  const avgMass = totalMass / Math.max(1, totalCount);
  const areaRatio = (finalBoundingBox.xMax - finalBoundingBox.xMin) * (finalBoundingBox.yMax - finalBoundingBox.yMin);
  const confidence = Math.min(0.98, Math.max(0.40, avgMass * 2.0 + areaRatio * 0.30));

  return {
    hasObject: true,
    category: subject1.category,
    label: subject1.label,
    semanticConfidence: subject1.semanticConfidence,
    scores: subject1.scores,
    confidence: Number(confidence.toFixed(2)),
    boundingBox: finalBoundingBox,
    boundingBoxes,
    centroid: {
      x: Number((centroidX / w).toFixed(4)),
      y: Number((centroidY / h).toFixed(4))
    },
    shapeType: subject2 ? 'polygon' : subject1.shapeType,
    circle: subject2 ? null : (subject1.circle || null),
    contour: subject1.contour,
    contours: subject2 ? [subject1.contour, subject2.contour] : [subject1.contour],
    svgPath: subject1.svgPath,
    svgPaths: subject2 ? [subject1.svgPath, subject2.svgPath] : [subject1.svgPath],
    smoothSvgPath: subject1.smoothSvgPath,
    smoothSvgPaths: subject2 ? [subject1.smoothSvgPath, subject2.smoothSvgPath] : [subject1.smoothSvgPath],
    rowExtents: subject1.rowExtents
  };
}

/**
 * Detects the main object from an image source URL or Data URL.
 * Automatically uses OffscreenCanvas in ServiceWorker or HTMLCanvas in Window.
 *
 * @param {string} imageSrc
 * @param {Object} [options]
 * @returns {Promise<{hasObject: boolean, confidence: number, boundingBox: {xMin: number, yMin: number, xMax: number, yMax: number}|null}>}
 */
export async function detectMainObject(imageSrc, options = {}) {
  if (!imageSrc || typeof imageSrc !== 'string') {
    return { hasObject: false, confidence: 0, boundingBox: null, error: 'Missing image source' };
  }

  let resolvedSrc = imageSrc;
  if (
    typeof chrome !== 'undefined' &&
    chrome.runtime?.getURL &&
    !resolvedSrc.startsWith('data:') &&
    !resolvedSrc.startsWith('blob:') &&
    !resolvedSrc.startsWith('http:') &&
    !resolvedSrc.startsWith('https:') &&
    !resolvedSrc.startsWith('chrome-extension:')
  ) {
    resolvedSrc = chrome.runtime.getURL(resolvedSrc);
  }

  // Attempt Tier 1: Semantic Vision AI if enabled
  if (options.useVisionAI !== false) {
    try {
      const aiResult = await detectMainObjectWithVisionAI(resolvedSrc, options);
      if (aiResult && aiResult.hasObject) {
        return aiResult;
      }
    } catch (_) {}
  }

  // Service Worker / Web Worker path (OffscreenCanvas + createImageBitmap)
  try {
    if (typeof fetch !== 'undefined' && typeof createImageBitmap !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      let blob;
      if (resolvedSrc.startsWith('data:')) {
        try {
          const parts = resolvedSrc.split(',');
          const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
          const binary = atob(parts[1]);
          const array = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
          blob = new Blob([array], { type: mime });
        } catch (_) {
          const resp = await fetch(resolvedSrc);
          blob = await resp.blob();
        }
      } else {
        const resp = await fetch(resolvedSrc);
        blob = await resp.blob();
      }

      const bitmap = await createImageBitmap(blob);
      const origW = bitmap.width;
      const origH = bitmap.height;
      const maxDim = options.downsampleMax || 120;
      const aspect = origW / Math.max(1, origH);
      const targetW = aspect >= 1 ? Math.min(origW, maxDim) : Math.max(16, Math.round(maxDim * aspect));
      const targetH = aspect >= 1 ? Math.max(16, Math.round(targetW / aspect)) : Math.min(origH, maxDim);

      const canvas = new OffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      const imageData = ctx.getImageData(0, 0, targetW, targetH);
      if (bitmap.close) bitmap.close();
      const detected = detectMainObjectFromImageData(imageData, options);
      return {
        ...detected,
        imageDims: { width: origW, height: origH }
      };
    }
  } catch (workerErr) {
    // Continue to window DOM fallback if present
  }

  // Browser Window DOM path (HTMLImageElement + HTMLCanvasElement)
  if (typeof document !== 'undefined') {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = resolvedSrc;
      });

      const origW = img.naturalWidth || img.width;
      const origH = img.naturalHeight || img.height;
      const maxDim = options.downsampleMax || 120;
      const aspect = origW / Math.max(1, origH);
      const targetW = aspect >= 1 ? Math.min(origW, maxDim) : Math.max(16, Math.round(maxDim * aspect));
      const targetH = aspect >= 1 ? Math.max(16, Math.round(targetW / aspect)) : Math.min(origH, maxDim);

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const imageData = ctx.getImageData(0, 0, targetW, targetH);
      const detected = detectMainObjectFromImageData(imageData, options);
      return {
        ...detected,
        imageDims: { width: origW, height: origH }
      };
    } catch (domErr) {
      return { hasObject: false, confidence: 0, boundingBox: null, error: domErr?.message || 'DOM Image load failed' };
    }
  }

  return { hasObject: false, confidence: 0, boundingBox: null, error: 'No suitable canvas context available' };
}

