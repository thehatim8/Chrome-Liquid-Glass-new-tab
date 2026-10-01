// js/objectAwareLayout.js
// Maps wallpaper object bounding boxes to workspace grid and repositions widgets away from the main object.

import { minWidgetCols, minWidgetRows } from './layoutConfig.js';
import { findNearestFreeCell } from './grid.js';

/**
 * Maps a normalized object bounding box [0, 1] to workspace grid cells.
 * Accounts for CSS `background-size: cover; background-position: center;`.
 *
 * @param {{xMin: number, yMin: number, xMax: number, yMax: number}} boundingBox
 * @param {{width: number, height: number}} [imageDims]
 * @param {{width: number, height: number}} windowDims
 * @param {DOMRect|{left: number, top: number, width: number, height: number}} workspaceRect
 * @param {{cols: number, rows: number, cellW: number, cellH: number, offsetX: number, offsetY: number}} grid
 * @returns {{colMin: number, rowMin: number, colMax: number, rowMax: number, offScreen?: boolean}}
 */
export function mapObjectBoxToGrid(boundingBox, imageDims, windowDims, workspaceRect, grid, additionalBoxes = null) {
  if (!boundingBox) {
    return { colMin: 0, rowMin: 0, colMax: 0, rowMax: 0 };
  }

  function mapSingleBox(box) {
    if (!box) return { colMin: 0, rowMin: 0, colMax: 0, rowMax: 0 };
    const winW = windowDims?.width || 1920;
    const winH = windowDims?.height || 1080;
    const imgW = imageDims?.width || winW;
    const imgH = imageDims?.height || winH;

    // background-size: cover aspect ratio scaling
    const scale = Math.max(winW / Math.max(1, imgW), winH / Math.max(1, imgH));
    const renderedW = imgW * scale;
    const renderedH = imgH * scale;
    const offsetX = (winW - renderedW) / 2;
    const offsetY = (winH - renderedH) / 2;

    // Convert normalized box to window pixel coordinates
    const winX1 = offsetX + box.xMin * renderedW;
    const winX2 = offsetX + box.xMax * renderedW;
    const winY1 = offsetY + box.yMin * renderedH;
    const winY2 = offsetY + box.yMax * renderedH;

    // If the object is cropped completely outside the visible viewport
    if (winX2 <= 0 || winX1 >= winW || winY2 <= 0 || winY1 >= winH) {
      return { colMin: -1, rowMin: -1, colMax: -1, rowMax: -1, offScreen: true };
    }

    // Convert window coordinates to workspace-relative pixels
    const wsLeft = workspaceRect?.left || 0;
    const wsTop = workspaceRect?.top || 0;
    const wsX1 = Math.max(0, winX1 - wsLeft);
    const wsX2 = Math.min(workspaceRect?.width || winW, winX2 - wsLeft);
    const wsY1 = Math.max(0, winY1 - wsTop);
    const wsY2 = Math.min(workspaceRect?.height || winH, winY2 - wsTop);

    // Convert to grid cell indices with fractional cell penetration thresholding (>= 20% penetration required to block an edge cell)
    const cellW = grid?.cellW || 80;
    const cellH = grid?.cellH || 80;
    const gridOffsetX = grid?.offsetX || 0;
    const gridOffsetY = grid?.offsetY || 0;

    const rawColMin = (wsX1 - gridOffsetX) / cellW;
    const rawColMax = (wsX2 - gridOffsetX) / cellW;
    const rawRowMin = (wsY1 - gridOffsetY) / cellH;
    const rawRowMax = (wsY2 - gridOffsetY) / cellH;

    const colMinCell = (rawColMin - Math.floor(rawColMin) > 0.80)
      ? Math.ceil(rawColMin)
      : Math.floor(rawColMin);
    const colMaxCell = (rawColMax - Math.floor(rawColMax) < 0.20)
      ? Math.floor(rawColMax) - 1
      : Math.ceil(rawColMax) - 1;

    const rowMinCell = (rawRowMin - Math.floor(rawRowMin) > 0.80)
      ? Math.ceil(rawRowMin)
      : Math.floor(rawRowMin);
    const rowMaxCell = (rawRowMax - Math.floor(rawRowMax) < 0.20)
      ? Math.floor(rawRowMax) - 1
      : Math.ceil(rawRowMax) - 1;

    const colMin = Math.max(0, Math.min(grid.cols - 1, colMinCell));
    const colMax = Math.max(0, Math.min(grid.cols - 1, Math.max(colMinCell, colMaxCell)));
    const rowMin = Math.max(0, Math.min(grid.rows - 1, rowMinCell));
    const rowMax = Math.max(0, Math.min(grid.rows - 1, Math.max(rowMinCell, rowMaxCell)));

    // Compute tighter row-by-row horizontal occupancy spans if contour / circle / rowExtents is present
    const numRows = grid?.rows || 12;
    const rowSpans = new Array(numRows).fill(null);

    if (box.shapeType === 'circle' && box.circle) {
      const circ = box.circle;
      const circCx = circ.cx;
      const circCy = circ.cy;
      const circRx = circ.rx || circ.r;
      const circRy = circ.ry || circ.r;

      for (let r = 0; r < numRows; r++) {
        const wsRowY1 = gridOffsetY + r * cellH;
        const wsRowY2 = wsRowY1 + cellH;
        const winRowY1 = wsTop + wsRowY1;
        const winRowY2 = wsTop + wsRowY2;

        const normY1 = (winRowY1 - offsetY) / renderedH;
        const normY2 = (winRowY2 - offsetY) / renderedH;

        const circTop = circCy - circRy;
        const circBottom = circCy + circRy;

        if (normY2 < circTop || normY1 > circBottom) {
          rowSpans[r] = null;
          continue;
        }

        const clampY = Math.max(normY1, Math.min(circCy, normY2));
        const dy = (clampY - circCy) / Math.max(0.0001, circRy);
        const dxNorm = Math.sqrt(Math.max(0, 1 - dy * dy));
        const halfWNorm = dxNorm * circRx;

        const subWinX1 = offsetX + (circCx - halfWNorm) * renderedW;
        const subWinX2 = offsetX + (circCx + halfWNorm) * renderedW;

        const subWsX1 = Math.max(0, subWinX1 - wsLeft);
        const subWsX2 = Math.min(workspaceRect?.width || winW, subWinX2 - wsLeft);

        const rawCMin = (subWsX1 - gridOffsetX) / cellW;
        const rawCMax = (subWsX2 - gridOffsetX) / cellW;

        const cMinCell = (rawCMin - Math.floor(rawCMin) > 0.80) ? Math.ceil(rawCMin) : Math.floor(rawCMin);
        const cMaxCell = (rawCMax - Math.floor(rawCMax) < 0.20) ? Math.floor(rawCMax) - 1 : Math.ceil(rawCMax) - 1;

        if (cMinCell <= cMaxCell) {
          const clMin = Math.max(0, Math.min(grid.cols - 1, cMinCell));
          const clMax = Math.max(0, Math.min(grid.cols - 1, cMaxCell));
          if (clMin <= clMax) {
            rowSpans[r] = { colMin: clMin, colMax: clMax };
          } else {
            rowSpans[r] = null;
          }
        } else {
          rowSpans[r] = null;
        }
      }
    } else if (Array.isArray(box.rowExtents) && box.rowExtents.length > 0) {
      const extents = box.rowExtents;
      for (let r = 0; r < numRows; r++) {
        const wsRowY1 = gridOffsetY + r * cellH;
        const wsRowY2 = wsRowY1 + cellH;
        const winRowY1 = wsTop + wsRowY1;
        const winRowY2 = wsTop + wsRowY2;

        const normY1 = (winRowY1 - offsetY) / renderedH;
        const normY2 = (winRowY2 - offsetY) / renderedH;

        let rowMinX = Infinity;
        let rowMaxX = -Infinity;

        for (const ext of extents) {
          if (!ext) continue;
          const extYTop = ext.normY;
          const extYBottom = ext.normY + (1 / extents.length);
          if (extYBottom >= normY1 && extYTop <= normY2) {
            if (ext.normMinX < rowMinX) rowMinX = ext.normMinX;
            if (ext.normMaxX > rowMaxX) rowMaxX = ext.normMaxX;
          }
        }

        if (rowMinX !== Infinity && rowMaxX !== -Infinity) {
          const subWinX1 = offsetX + rowMinX * renderedW;
          const subWinX2 = offsetX + rowMaxX * renderedW;

          const subWsX1 = Math.max(0, subWinX1 - wsLeft);
          const subWsX2 = Math.min(workspaceRect?.width || winW, subWinX2 - wsLeft);

          const rawCMin = (subWsX1 - gridOffsetX) / cellW;
          const rawCMax = (subWsX2 - gridOffsetX) / cellW;

          const cMinCell = (rawCMin - Math.floor(rawCMin) > 0.80) ? Math.ceil(rawCMin) : Math.floor(rawCMin);
          const cMaxCell = (rawCMax - Math.floor(rawCMax) < 0.20) ? Math.floor(rawCMax) - 1 : Math.ceil(rawCMax) - 1;

          if (cMinCell <= cMaxCell) {
            const clMin = Math.max(0, Math.min(grid.cols - 1, cMinCell));
            const clMax = Math.max(0, Math.min(grid.cols - 1, cMaxCell));
            if (clMin <= clMax) {
              rowSpans[r] = { colMin: clMin, colMax: clMax };
            } else {
              rowSpans[r] = null;
            }
          } else {
            rowSpans[r] = null;
          }
        } else {
          rowSpans[r] = null;
        }
      }
    } else if (Array.isArray(box.contour) && box.contour.length >= 3) {
      const contour = box.contour;
      for (let r = 0; r < numRows; r++) {
        const wsRowY1 = gridOffsetY + r * cellH;
        const wsRowY2 = wsRowY1 + cellH;
        const winRowY1 = wsTop + wsRowY1;
        const winRowY2 = wsTop + wsRowY2;

        const normY1 = (winRowY1 - offsetY) / renderedH;
        const normY2 = (winRowY2 - offsetY) / renderedH;

        let minXInRow = Infinity;
        let maxXInRow = -Infinity;

        for (const pt of contour) {
          if (pt.y >= normY1 && pt.y <= normY2) {
            if (pt.x < minXInRow) minXInRow = pt.x;
            if (pt.x > maxXInRow) maxXInRow = pt.x;
          }
        }

        const yMid = (normY1 + normY2) / 2;
        for (let i = 0; i < contour.length; i++) {
          const p1 = contour[i];
          const p2 = contour[(i + 1) % contour.length];
          const dy = p2.y - p1.y;
          if (Math.abs(dy) > 0.00001) {
            const segMinY = Math.min(p1.y, p2.y);
            const segMaxY = Math.max(p1.y, p2.y);
            for (const sampleY of [normY1, yMid, normY2]) {
              if (sampleY >= segMinY && sampleY <= segMaxY) {
                const t = (sampleY - p1.y) / dy;
                const xIntersect = p1.x + t * (p2.x - p1.x);
                if (xIntersect < minXInRow) minXInRow = xIntersect;
                if (xIntersect > maxXInRow) maxXInRow = xIntersect;
              }
            }
          }
        }

        if (minXInRow !== Infinity && maxXInRow !== -Infinity) {
          const subWinX1 = offsetX + minXInRow * renderedW;
          const subWinX2 = offsetX + maxXInRow * renderedW;

          const subWsX1 = Math.max(0, subWinX1 - wsLeft);
          const subWsX2 = Math.min(workspaceRect?.width || winW, subWinX2 - wsLeft);

          const rawCMin = (subWsX1 - gridOffsetX) / cellW;
          const rawCMax = (subWsX2 - gridOffsetX) / cellW;

          const cMinCell = (rawCMin - Math.floor(rawCMin) > 0.80) ? Math.ceil(rawCMin) : Math.floor(rawCMin);
          const cMaxCell = (rawCMax - Math.floor(rawCMax) < 0.20) ? Math.floor(rawCMax) - 1 : Math.ceil(rawCMax) - 1;

          if (cMinCell <= cMaxCell) {
            const clMin = Math.max(0, Math.min(grid.cols - 1, cMinCell));
            const clMax = Math.max(0, Math.min(grid.cols - 1, cMaxCell));
            if (clMin <= clMax) {
              rowSpans[r] = { colMin: clMin, colMax: clMax };
            } else {
              rowSpans[r] = null;
            }
          } else {
            rowSpans[r] = null;
          }
        } else {
          rowSpans[r] = null;
        }
      }
    } else {
      // Coarse box fallback
      for (let r = rowMin; r <= rowMax; r++) {
        rowSpans[r] = { colMin, colMax };
      }
    }

    return {
      colMin: Math.min(colMin, colMax),
      rowMin: Math.min(rowMin, rowMax),
      colMax: Math.max(colMin, colMax),
      rowMax: Math.max(rowMin, rowMax),
      rowSpans,
      shapeType: box.shapeType || 'polygon',
      circle: box.circle || null,
      contour: box.contour || null
    };
  }

  const mainMapped = mapSingleBox(boundingBox);

  const rawBoxes = Array.isArray(additionalBoxes) && additionalBoxes.length > 0
    ? additionalBoxes
    : (Array.isArray(boundingBox.boundingBoxes)
        ? boundingBox.boundingBoxes
        : (Array.isArray(boundingBox.boxes) ? boundingBox.boxes : null));

  if (rawBoxes && rawBoxes.length > 1) {
    const mappedBoxes = rawBoxes.map(mapSingleBox).filter((b) => !b.offScreen);
    if (mappedBoxes.length > 0) {
      return {
        ...mainMapped,
        boxes: mappedBoxes
      };
    }
  }

  return mainMapped;
}

/**
 * Checks if two axis-aligned cell boxes overlap.
 */
export function cellBoxesOverlap(a, b) {
  if (!a || !b) return false;
  const aColMin = Number.isFinite(a.colMin) ? a.colMin : a.col;
  const aColMax = Number.isFinite(a.colMax) ? a.colMax : a.col + a.cw - 1;
  const aRowMin = Number.isFinite(a.rowMin) ? a.rowMin : a.row;
  const aRowMax = Number.isFinite(a.rowMax) ? a.rowMax : a.row + a.ch - 1;

  const bColMin = Number.isFinite(b.colMin) ? b.colMin : b.col;
  const bColMax = Number.isFinite(b.colMax) ? b.colMax : b.col + b.cw - 1;
  const bRowMin = Number.isFinite(b.rowMin) ? b.rowMin : b.row;
  const bRowMax = Number.isFinite(b.rowMax) ? b.rowMax : b.row + b.ch - 1;

  return !(
    aColMax < bColMin ||
    aColMin > bColMax ||
    aRowMax < bRowMin ||
    aRowMin > bRowMax
  );
}

/**
 * Tests whether a widget overlaps with a detected object.
 * Leverages rowSpans (precise contour / circle horizontal extents) when present,
 * allowing widgets to freely occupy open corners and negative space without
 * being falsely blocked by coarse bounding boxes.
 *
 * @param {{col?: number, row?: number, cw?: number, ch?: number, colMin?: number, colMax?: number, rowMin?: number, rowMax?: number}} widget
 * @param {{colMin: number, rowMin: number, colMax: number, rowMax: number, rowSpans?: Array<{colMin: number, colMax: number}|null>, offScreen?: boolean}} objectBox
 * @returns {boolean}
 */
export function widgetCollidesWithObject(widget, objectBox) {
  if (!widget || !objectBox) return false;
  if (objectBox.offScreen) return false;

  // Multi-subject support: if multiple obstacle boxes are present, test collision against each box
  if (Array.isArray(objectBox.boxes) && objectBox.boxes.length > 0) {
    return objectBox.boxes.some(b => widgetCollidesWithObject(widget, b));
  }

  const wColMin = Number.isFinite(widget.col) ? widget.col : widget.colMin;
  const wCw = Number.isFinite(widget.cw) ? widget.cw : (widget.colMax - widget.colMin + 1);
  const wRowMin = Number.isFinite(widget.row) ? widget.row : widget.rowMin;
  const wCh = Number.isFinite(widget.ch) ? widget.ch : (widget.rowMax - widget.rowMin + 1);

  if (!Number.isFinite(wColMin) || !Number.isFinite(wRowMin) || !Number.isFinite(wCw) || !Number.isFinite(wCh)) {
    return false;
  }

  const wColMax = wColMin + wCw - 1;
  const wRowMax = wRowMin + wCh - 1;

  // 1. Coarse bounding box rejection
  const bColMin = Number.isFinite(objectBox.colMin) ? objectBox.colMin : 0;
  const bColMax = Number.isFinite(objectBox.colMax) ? objectBox.colMax : 0;
  const bRowMin = Number.isFinite(objectBox.rowMin) ? objectBox.rowMin : 0;
  const bRowMax = Number.isFinite(objectBox.rowMax) ? objectBox.rowMax : 0;

  if (wColMax < bColMin || wColMin > bColMax || wRowMax < bRowMin || wRowMin > bRowMax) {
    return false;
  }

  // 2. If precise rowSpans available, test row-by-row occupancy
  if (Array.isArray(objectBox.rowSpans) && objectBox.rowSpans.length > 0) {
    for (let r = wRowMin; r <= wRowMax; r++) {
      const span = objectBox.rowSpans[r];
      if (span && !(wColMax < span.colMin || wColMin > span.colMax)) {
        return true;
      }
    }
    return false;
  }

  // Fallback to bounding box overlap
  return true;
}

/**
 * Computes Euclidean distance between a widget cell rect and the object,
 * using precise rowSpans contour boundary when available.
 */
function distanceToObject(col, row, cw, ch, objectBox) {
  if (Array.isArray(objectBox?.boxes) && objectBox.boxes.length > 0) {
    let minD = Infinity;
    for (const b of objectBox.boxes) {
      const d = distanceToObject(col, row, cw, ch, b);
      if (d < minD) minD = d;
    }
    return minD === Infinity ? 10 : minD;
  }

  if (Array.isArray(objectBox?.rowSpans) && objectBox.rowSpans.length > 0) {
    let minDist = Infinity;
    const wRight = col + cw - 1;
    const wBottom = row + ch - 1;

    for (let r = 0; r < objectBox.rowSpans.length; r++) {
      const span = objectBox.rowSpans[r];
      if (!span) continue;

      const dy = row > r ? row - r : (wBottom < r ? r - wBottom : 0);
      const dx = col > span.colMax
        ? col - span.colMax
        : (wRight < span.colMin ? span.colMin - wRight : 0);

      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) minDist = dist;
    }
    return minDist === Infinity ? 10 : minDist;
  }

  const wRight = col + cw - 1;
  const wBottom = row + ch - 1;

  const dx = col > objectBox.colMax
    ? col - objectBox.colMax
    : (wRight < objectBox.colMin ? objectBox.colMin - wRight : 0);

  const dy = row > objectBox.rowMax
    ? row - objectBox.rowMax
    : (wBottom < objectBox.rowMin ? objectBox.rowMin - wBottom : 0);

  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Identifies clear open negative space zones in the wallpaper around the detected subject.
 * Analyzes open flanks, shelves, and quadrants.
 *
 * @param {{colMin: number, rowMin: number, colMax: number, rowMax: number, boxes?: Array}} objectBox
 * @param {{cols: number, rows: number}} grid
 */
export function identifyNegativeSpaceZones(objectBox, grid) {
  const leftWidth = Math.max(0, objectBox.colMin);
  const rightWidth = Math.max(0, grid.cols - 1 - objectBox.colMax);
  const topHeight = Math.max(0, objectBox.rowMin);
  const bottomHeight = Math.max(0, grid.rows - 1 - objectBox.rowMax);

  const zones = {
    left: {
      id: 'left',
      colMin: 0,
      colMax: Math.max(-1, objectBox.colMin - 1),
      rowMin: 0,
      rowMax: grid.rows - 1,
      width: leftWidth,
      height: grid.rows,
      capacity: leftWidth * grid.rows,
      isPrimary: leftWidth >= 3
    },
    right: {
      id: 'right',
      colMin: Math.min(grid.cols, objectBox.colMax + 1),
      colMax: grid.cols - 1,
      rowMin: 0,
      rowMax: grid.rows - 1,
      width: rightWidth,
      height: grid.rows,
      capacity: rightWidth * grid.rows,
      isPrimary: rightWidth >= 3
    },
    top: {
      id: 'top',
      colMin: 0,
      colMax: grid.cols - 1,
      rowMin: 0,
      rowMax: Math.max(-1, objectBox.rowMin - 1),
      width: grid.cols,
      height: topHeight,
      capacity: grid.cols * topHeight,
      isPrimary: topHeight >= 2
    },
    bottom: {
      id: 'bottom',
      colMin: 0,
      colMax: grid.cols - 1,
      rowMin: Math.min(grid.rows, objectBox.rowMax + 1),
      rowMax: grid.rows - 1,
      width: grid.cols,
      height: bottomHeight,
      capacity: grid.cols * bottomHeight,
      isPrimary: bottomHeight >= 2
    }
  };

  // Center corridor negative space zone if multiple flanking obstacle boxes exist
  let hasCenterCanvas = false;
  if (Array.isArray(objectBox?.boxes) && objectBox.boxes.length >= 2) {
    const sortedBoxes = [...objectBox.boxes].sort((a, b) => a.colMin - b.colMin);
    const boxA = sortedBoxes[0];
    const boxB = sortedBoxes[1];
    const cWidth = Math.max(0, boxB.colMin - boxA.colMax - 1);
    if (cWidth >= 3) {
      zones.center = {
        id: 'center',
        colMin: boxA.colMax + 1,
        colMax: boxB.colMin - 1,
        rowMin: 0,
        rowMax: grid.rows - 1,
        width: cWidth,
        height: grid.rows,
        capacity: cWidth * grid.rows,
        isPrimary: cWidth >= 4
      };
      hasCenterCanvas = true;
    }
  }

  const isDualFlank = zones.left.width >= 3 && zones.right.width >= 3;
  const isLeftDominant = zones.left.width >= 4 && zones.right.width < 3;
  const isRightDominant = zones.right.width >= 4 && zones.left.width < 3;
  const hasTopShelf = zones.top.height >= 2;
  const hasBottomShelf = zones.bottom.height >= 2;
  const isTopDominant = zones.top.height >= 3 && zones.left.width < 4 && zones.right.width < 4;
  const isBottomDominant = zones.bottom.height >= 3 && zones.left.width < 4 && zones.right.width < 4;

  const totalFlankCapacity = Math.max(1, zones.left.capacity + zones.right.capacity);
  const leftCapacityRatio = zones.left.capacity / totalFlankCapacity;
  const rightCapacityRatio = zones.right.capacity / totalFlankCapacity;
  const flankWidthDifference = Math.abs(zones.left.width - zones.right.width);

  return {
    ...zones,
    isDualFlank,
    isLeftDominant,
    isRightDominant,
    hasTopShelf,
    hasBottomShelf,
    isTopDominant,
    isBottomDominant,
    hasCenterCanvas,
    leftCapacityRatio,
    rightCapacityRatio,
    flankWidthDifference
  };
}

/**
 * Visual hierarchy information for widget placement.
 * Search bar is primary horizontal element, followed by clock anchor,
 * then primary content cards, productivity cards, and utility widgets.
 */
function getWidgetVisualHierarchy(id) {
  const normId = String(id || '').replace(/^widget-/, '');
  if (normId === 'search') return { rank: 1, role: 'search', isHorizontal: true };
  if (normId === 'clock') return { rank: 2, role: 'clock', isAnchor: true };
  if (normId === 'todo') return { rank: 3, role: 'todo', partner: 'widget-notes' };
  if (normId === 'notes') return { rank: 4, role: 'notes', partner: 'widget-todo' };
  if (normId === 'calendar') return { rank: 5, role: 'card-large' };
  if (normId === 'aichat') return { rank: 6, role: 'card-large' };
  if (normId === 'pomodoro' || normId === 'sports') return { rank: 7, role: 'card-medium' };
  if (normId === 'weather' || normId === 'dayprogress' || normId === 'currency' || normId === 'image') {
    return { rank: 8, role: 'card-compact' };
  }
  return { rank: 9, role: 'other' };
}

/**
 * Builds candidate spans for a widget, prioritizing comfortable sizes.
 * Avoids aggressive down-scaling unless required by space constraints.
 */
/**
 * Builds candidate spans for a widget, prioritizing comfortable sizes.
 * Avoids aggressive down-scaling unless required by space constraints.
 */
function getCandidateSpansForWidget(id, currentSpan, grid, preferredZone = null, spanMode = 'comfortable') {
  const minCols = Math.min(minWidgetCols(id), grid.cols);
  const minRows = Math.min(minWidgetRows(id), grid.rows);
  const maxCols = Math.max(minCols, Math.min(currentSpan?.cw || minCols, grid.cols));
  const maxRows = Math.max(minRows, Math.min(currentSpan?.ch || minRows, grid.rows));

  const candidates = [];
  const seen = new Set();

  function addCandidate(cw, ch) {
    const c = Math.max(minCols, Math.min(cw, grid.cols));
    const r = Math.max(minRows, Math.min(ch, grid.rows));
    const key = `${c}x${r}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({ cw: c, ch: r, area: c * r });
    }
  }

  const normId = String(id || '').replace(/^widget-/, '');

  if (spanMode === 'min-size') {
    addCandidate(minCols, minRows);
    return candidates;
  }

  // If spanMode === 'zone-fit', prioritize compact row heights so all widgets fit without choking
  if (spanMode === 'zone-fit') {
    const compactRows = Math.min(maxRows, Math.max(minRows, 2));
    if (preferredZone && preferredZone.width >= minCols) {
      const zw = Math.min(preferredZone.width, maxCols);
      addCandidate(zw, compactRows);
      addCandidate(zw, minRows);
    }
    addCandidate(maxCols, compactRows);
    addCandidate(minCols, compactRows);
    addCandidate(minCols, minRows);
    candidates.sort((a, b) => {
      if (a.area !== b.area) return a.area - b.area;
      return a.ch - b.ch;
    });
    return candidates;
  }

  // COMFORTABLE MODE:
  // 1. Exact original requested span (Search allowed to preserve wide shelf span if space permits)
  addCandidate(maxCols, maxRows);

  // 2. Zone width adaptation (e.g. if flank is 4, 5, 6, or 7 cols, match flank width)
  if (preferredZone && preferredZone.width >= minCols) {
    const zw = Math.min(preferredZone.width, normId === 'search' ? 8 : maxCols);
    addCandidate(zw, maxRows);
    if (normId === 'search') addCandidate(zw, 2);
    if (maxRows > minRows) addCandidate(zw, maxRows - 1);
    if (maxRows - 2 >= minRows) addCandidate(zw, maxRows - 2);
    if (zw - 1 >= minCols) addCandidate(zw - 1, maxRows);
  }

  // 3. Search bar specific comfortable spans (keep search height at 2 unless explicitly larger)
  if (normId === 'search') {
    addCandidate(Math.min(maxCols, 8), 2);
    addCandidate(Math.min(maxCols, 7), 2);
    addCandidate(Math.min(maxCols, 6), 2);
    addCandidate(Math.min(maxCols, 5), 2);
    addCandidate(Math.min(maxCols, 4), 2);
    if (maxRows >= 3) {
      addCandidate(Math.min(maxCols, 6), 3);
    }
  }

  // 4. Comfortable stepwise reductions preserving usable aspect ratio:
  if (maxRows - 1 >= minRows) addCandidate(maxCols, maxRows - 1);
  if (maxCols - 1 >= minCols) addCandidate(maxCols - 1, maxRows);
  if (maxCols - 1 >= minCols && maxRows - 1 >= minRows) addCandidate(maxCols - 1, maxRows - 1);

  // 5. Gradual reduction spans down to minimum dimensions
  for (let dc = 0; dc <= maxCols - minCols; dc++) {
    for (let dr = 0; dr <= maxRows - minRows; dr++) {
      addCandidate(maxCols - dc, maxRows - dr);
    }
  }

  // Sort candidates:
  candidates.sort((a, b) => {
    if (b.area !== a.area) return b.area - a.area;
    const diffH_A = Math.abs(a.ch - maxRows);
    const diffH_B = Math.abs(b.ch - maxRows);
    if (diffH_A !== diffH_B) return diffH_A - diffH_B;
    return b.cw - a.cw;
  });

  return candidates;
}

/**
 * Generates natural, grid-aligned candidate coordinate slots within open negative space zones.
 */
function generateStructuredCandidateSlots(grid, objectBox, zones, span, widgetId, placed) {
  const { cw, ch } = span;
  const maxCol = grid.cols - cw;
  const maxRow = grid.rows - ch;
  if (maxCol < 0 || maxRow < 0) return [];

  const slots = [];
  const seenSlots = new Set();

  function addSlot(c, r, priority = 0) {
    if (c < 0 || r < 0 || c > maxCol || r > maxRow) return;

    // Strictly protect the subject! Widgets must not collide with the subject's true contour or bounding boxes.
    const obstacleBoxes = Array.isArray(objectBox?.boxes) && objectBox.boxes.length > 0
      ? objectBox.boxes
      : (objectBox && Number.isFinite(objectBox.colMin) ? [objectBox] : []);
    for (const b of obstacleBoxes) {
      if (widgetCollidesWithObject({ col: c, row: r, cw, ch }, b)) return;
    }

    const key = `${c},${r}`;
    if (!seenSlots.has(key)) {
      seenSlots.add(key);
      slots.push({ col: c, row: r, cw, ch, slotPriority: priority });
    }
  }

  const role = getWidgetVisualHierarchy(widgetId);
  const normId = String(widgetId || '').replace(/^widget-/, '');

  // 1. PRODUCTIVITY PAIRING SLOTS (Todo & Notes):
  if (normId === 'todo' || normId === 'notes') {
    const partnerId = normId === 'todo' ? 'widget-notes' : 'widget-todo';
    const partner = placed[partnerId] || placed[normId === 'todo' ? 'notes' : 'todo'];
    if (partner) {
      // Primary: Stack flush directly below partner in the same column
      addSlot(partner.col, partner.row + partner.ch, 200);
      // Stack flush directly above partner in the same column
      if (partner.row >= ch) addSlot(partner.col, partner.row - ch, 190);
      // Flush beside partner in adjacent column
      addSlot(partner.col + partner.cw, partner.row, 180);
      if (partner.col >= cw) addSlot(partner.col - cw, partner.row, 175);
    }
  }

  // 2. SEARCH BAR SLOTS:
  if (role.role === 'search') {
    if (zones.hasTopShelf && zones.top.height >= ch) {
      // Wide open top shelf: center or align search widget above subject
      addSlot(Math.max(0, Math.round((grid.cols - cw) / 2)), 0, 190);
      addSlot(0, 0, 180);
      if (zones.right.width >= cw) addSlot(zones.right.colMin, 0, 170);
      addSlot(grid.cols - cw, 0, 160);
    } else if (zones.hasBottomShelf && zones.bottom.height >= ch) {
      // Wide open bottom shelf: center or align search widget below subject
      const bRow = zones.bottom.rowMin;
      addSlot(Math.max(0, Math.round((grid.cols - cw) / 2)), bRow, 190);
      addSlot(0, bRow, 180);
      if (zones.right.width >= cw) addSlot(zones.right.colMin, bRow, 170);
      addSlot(grid.cols - cw, bRow, 160);
    } else if (zones.isDualFlank) {
      // Flank header bar in Left Flank or Right Flank
      addSlot(0, 0, 170);
      if (zones.right.width >= cw) {
        addSlot(zones.right.colMin, 0, 170);
        addSlot(grid.cols - cw, 0, 160);
      }
    } else {
      if (zones.isRightDominant) {
        addSlot(zones.right.colMin, 0, 160);
        addSlot(grid.cols - cw, 0, 150);
      } else {
        addSlot(0, 0, 160);
        if (zones.right.width >= cw) addSlot(zones.right.colMin, 0, 150);
      }
    }
  }

  // 3. CLOCK SLOTS:
  if (role.role === 'clock') {
    if (zones.isDualFlank) {
      addSlot(0, 0, 170);
      if (zones.right.width >= cw) {
        addSlot(zones.right.colMin, 0, 170);
        addSlot(grid.cols - cw, 0, 160);
      }
    } else {
      if (zones.right.width >= cw) {
        addSlot(grid.cols - cw, 0, 150);
        addSlot(zones.right.colMin, 0, 145);
      }
      if (zones.left.width >= cw) {
        addSlot(0, 0, 150);
      }
      if (zones.hasTopShelf) {
        addSlot(0, 0, 140);
        addSlot(grid.cols - cw, 0, 140);
      }
    }
  }

  // 4. CENTER CANVAS SLOTS (Multi-subject / Dual-portrait negative space corridor):
  if (zones.hasCenterCanvas && zones.center.width >= cw) {
    const cCenter = zones.center.colMin + Math.floor((zones.center.width - cw) / 2);
    addSlot(cCenter, 0, 185);
    for (let r = 0; r <= maxRow; r += 2) addSlot(cCenter, r, 160);
    addSlot(cCenter, maxRow, 170);
    addSlot(zones.center.colMin, 0, 150);
    addSlot(zones.center.colMax - cw + 1, 0, 150);
  }

  // 5. COLUMN-ALIGNED STACKING SLOTS IN OPEN FLANKS:
  // Left Flank
  if (zones.left.width >= cw) {
    const lMax = objectBox.colMin - cw;
    const lTracks = [0];
    if (lMax > 0) lTracks.push(lMax);
    if (zones.left.width >= cw + 2) {
      lTracks.push(Math.floor((objectBox.colMin - cw) / 2));
    }
    Object.values(placed).forEach((other) => {
      if (other.col + other.cw <= objectBox.colMin) {
        lTracks.push(other.col);
        if (other.col + other.cw <= objectBox.colMin - cw) lTracks.push(other.col + other.cw);
        if (other.col >= cw) lTracks.push(other.col - cw);
      }
    });

    for (const c of lTracks) {
      addSlot(c, 0, 120);
      for (let r = 0; r <= maxRow; r += 2) addSlot(c, r, 100);
      addSlot(c, maxRow, 110);
    }

    Object.values(placed).forEach((other) => {
      if (other.col + other.cw <= objectBox.colMin) {
        addSlot(other.col, other.row + other.ch, 140);
        if (other.row >= ch) addSlot(other.col, other.row - ch, 130);
        if (other.col + other.cw <= objectBox.colMin - cw) {
          addSlot(other.col + other.cw, other.row, 125);
          addSlot(other.col + other.cw, other.row + other.ch, 120);
        }
      }
    });
  }

  // Right Flank
  if (zones.right.width >= cw) {
    const rStart = zones.right.colMin;
    const rEnd = grid.cols - cw;
    const rTracks = [rStart, rEnd];
    if (zones.right.width >= cw + 2) {
      rTracks.push(rStart + Math.floor((zones.right.width - cw) / 2));
    }
    Object.values(placed).forEach((other) => {
      if (other.col >= zones.right.colMin) {
        rTracks.push(other.col);
        if (other.col + other.cw <= grid.cols - cw) rTracks.push(other.col + other.cw);
        if (other.col - cw >= zones.right.colMin) rTracks.push(other.col - cw);
      }
    });

    for (const c of rTracks) {
      addSlot(c, 0, 120);
      for (let r = 0; r <= maxRow; r += 2) addSlot(c, r, 100);
      addSlot(c, maxRow, 110);
    }

    Object.values(placed).forEach((other) => {
      if (other.col >= zones.right.colMin) {
        addSlot(other.col, other.row + other.ch, 140);
        if (other.row >= ch) addSlot(other.col, other.row - ch, 130);
        if (other.col + other.cw <= grid.cols - cw) {
          addSlot(other.col + other.cw, other.row, 125);
          addSlot(other.col + other.cw, other.row + other.ch, 120);
        }
      }
    });
  }

  // 5b. CONTOUR-HUGGING CANDIDATE SLOTS (Negative space utilization right up to subject's true contour)
  const candidateObstacles = Array.isArray(objectBox?.boxes) && objectBox.boxes.length > 0
    ? objectBox.boxes
    : (Array.isArray(objectBox?.rowSpans) ? [objectBox] : []);

  for (const obs of candidateObstacles) {
    if (Array.isArray(obs?.rowSpans)) {
      for (let r = 0; r <= maxRow; r++) {
        let minColMin = Infinity;
        let maxColMax = -Infinity;
        let hasOccupancy = false;
        for (let subR = r; subR < r + ch && subR < grid.rows; subR++) {
          const sp = obs.rowSpans[subR];
          if (sp) {
            hasOccupancy = true;
            if (sp.colMin < minColMin) minColMin = sp.colMin;
            if (sp.colMax > maxColMax) maxColMax = sp.colMax;
          }
        }
        if (hasOccupancy) {
          if (minColMin >= cw) {
            addSlot(minColMin - cw, r, 135);
          }
          if (maxColMax + 1 <= grid.cols - cw) {
            addSlot(maxColMax + 1, r, 135);
          }
        }
      }
    }
  }

  // 6. SHELF SLOTS (All shelf rows):
  if (zones.hasTopShelf && zones.top.height >= ch) {
    for (let r = 0; r <= zones.top.rowMax - ch + 1; r++) {
      const prio = r === 0 ? 90 : 80;
      addSlot(0, r, prio);
      addSlot(Math.max(0, Math.round((grid.cols - cw) / 2)), r, prio - 5);
      addSlot(grid.cols - cw, r, prio - 10);
      for (let c = 0; c <= maxCol; c += Math.max(1, cw)) {
        addSlot(c, r, prio - 15);
      }
    }
    Object.values(placed).forEach((other) => {
      if (other.row + other.ch <= objectBox.rowMin) {
        addSlot(other.col + other.cw, 0, 85);
        if (other.col >= cw) addSlot(other.col - cw, 0, 85);
      }
    });
  }
  if (zones.hasBottomShelf && zones.bottom.height >= ch) {
    for (let r = zones.bottom.rowMin; r <= grid.rows - ch; r++) {
      const prio = r === zones.bottom.rowMin ? 75 : 65;
      addSlot(0, r, prio);
      addSlot(Math.max(0, Math.round((grid.cols - cw) / 2)), r, prio - 5);
      addSlot(grid.cols - cw, r, prio - 10);
      for (let c = 0; c <= maxCol; c += Math.max(1, cw)) {
        addSlot(c, r, prio - 15);
      }
    }
    Object.values(placed).forEach((other) => {
      if (other.row >= zones.bottom.rowMin) {
        addSlot(other.col + other.cw, other.row, 65);
        if (other.col >= cw) addSlot(other.col - cw, other.row, 65);
      }
    });
  }

  // 7. ADJACENCY SLOTS to all placed widgets:
  Object.values(placed).forEach((other) => {
    addSlot(other.col, other.row + other.ch, 85);
    addSlot(other.col + other.cw, other.row, 75);
    if (other.row >= ch) addSlot(other.col, other.row - ch, 80);
    if (other.col >= cw) addSlot(other.col - cw, other.row, 70);
  });

  // 8. EXHAUSTIVE SCAN FALLBACK:
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c <= maxCol; c++) {
      addSlot(c, r, 0);
    }
  }

  return slots;
}

/**
 * Scores a candidate placement based on clearance, negative space zone balancing,
 * grid alignment, visual hierarchy, and comfortable sizing.
 */
function scoreCandidate({
  cand,
  widgetId,
  origPos,
  origSpan,
  objectBox,
  grid,
  zones,
  placed
}) {
  const { col, row, cw, ch, slotPriority = 0 } = cand;
  const role = getWidgetVisualHierarchy(widgetId);
  const normId = String(widgetId || '').replace(/^widget-/, '');

  // 1. Distance & clearance from object
  const distObj = distanceToObject(col, row, cw, ch, objectBox);
  const clearanceScore = Math.min(distObj, 3.0) * 3.5;

  // 2. Zone loads & balancing
  let loadLeft = 0, loadRight = 0, loadTop = 0, loadBottom = 0, loadCenter = 0;
  let countLeft = 0, countRight = 0, countCenter = 0;
  for (const pId of Object.keys(placed)) {
    const it = placed[pId];
    const area = it.cw * it.ch;
    const midC = it.col + it.cw / 2;
    const midR = it.row + it.ch / 2;
    if (zones.hasCenterCanvas && it.col >= zones.center.colMin && it.col + it.cw - 1 <= zones.center.colMax) {
      loadCenter += area;
      countCenter++;
    } else {
      if (midC < objectBox.colMin) {
        loadLeft += area;
        countLeft++;
      } else if (midC > objectBox.colMax) {
        loadRight += area;
        countRight++;
      }
    }
    if (midR < objectBox.rowMin) loadTop += area;
    if (midR > objectBox.rowMax) loadBottom += area;
  }

  const capLeft = Math.max(1, zones.left.capacity);
  const capRight = Math.max(1, zones.right.capacity);
  const capTop = Math.max(1, zones.top.capacity);
  const capBottom = Math.max(1, zones.bottom.capacity);
  const capCenter = zones.hasCenterCanvas ? Math.max(1, zones.center.capacity) : 1;

  const densityLeft = loadLeft / capLeft;
  const densityRight = loadRight / capRight;
  const densityTop = loadTop / capTop;
  const densityBottom = loadBottom / capBottom;
  const densityCenter = loadCenter / capCenter;

  const midC = col + cw / 2;
  const midR = row + ch / 2;
  const isLeft = midC < objectBox.colMin;
  const isRight = midC > objectBox.colMax;
  const isTop = midR < objectBox.rowMin;
  const isBottom = midR > objectBox.rowMax;
  const isCenter = zones.hasCenterCanvas && col >= zones.center.colMin && col + cw - 1 <= zones.center.colMax;

  // Soft density penalty (preventing overcrowding while not overriding alignment)
  let densityPenalty = 0;
  if (isLeft) densityPenalty += densityLeft * 12.0;
  if (isRight) densityPenalty += densityRight * 12.0;
  if (isTop) densityPenalty += densityTop * 8.0;
  if (isBottom) densityPenalty += densityBottom * 8.0;
  if (isCenter) densityPenalty += densityCenter * 14.0;

  // Zone capacity reward
  let spaceReward = 0;
  if (isLeft) spaceReward += (zones.left.width / grid.cols) * 6.0;
  if (isRight) spaceReward += (zones.right.width / grid.cols) * 6.0;
  if (isTop) spaceReward += (zones.top.height / grid.rows) * 4.0;
  if (isBottom) spaceReward += (zones.bottom.height / grid.rows) * 4.0;

  // Decisive Dual-Flank & Negative Space Balancing: Guarantees widgets distribute naturally
  let balanceBonus = 0;
  if (isCenter) {
    // High reward for utilizing open negative space between multi-subject obstacles,
    // tapering once center is comfortably occupied so flanks also get widgets.
    balanceBonus += Math.max(10.0, 50.0 - countCenter * 15.0);
  } else if (zones.isDualFlank) {
    const partnerId = role.partner;
    const partner = partnerId ? (placed[partnerId] || placed[partnerId.replace(/^widget-/, '')]) : null;
    if (partner) {
      const partnerIsLeft = (partner.col + partner.cw / 2) < objectBox.colMin;
      if ((isLeft && partnerIsLeft) || (isRight && !partnerIsLeft)) {
        balanceBonus += 80.0;
      } else {
        balanceBonus -= 80.0;
      }
    } else {
      const totalFlankCap = capLeft + capRight;
      const targetRatioL = capLeft / Math.max(1, totalFlankCap);
      const targetRatioR = capRight / Math.max(1, totalFlankCap);
      const totalWidgets = countLeft + countRight;

      const targetL = totalWidgets * targetRatioL;
      const targetR = totalWidgets * targetRatioR;
      const diffL = countLeft - targetL;
      const diffR = countRight - targetR;

      // Primary: Capacity-proportional count balancing
      if (diffL >= 0.4) {
        if (isRight) balanceBonus += 75.0 + diffL * 35.0;
        if (isLeft) balanceBonus -= 75.0 + diffL * 35.0;
      } else if (diffR >= 0.4) {
        if (isLeft) balanceBonus += 75.0 + diffR * 35.0;
        if (isRight) balanceBonus -= 75.0 + diffR * 35.0;
      } else {
        // Equal or near-proportional counts: balance by widget count and density
        if (countLeft > countRight) {
          if (isRight) balanceBonus += 45.0;
          if (isLeft) balanceBonus -= 45.0;
        } else if (countRight > countLeft) {
          if (isLeft) balanceBonus += 45.0;
          if (isRight) balanceBonus -= 45.0;
        } else if (densityLeft > densityRight) {
          if (isRight) balanceBonus += 35.0;
          if (isLeft) balanceBonus -= 35.0;
        } else if (densityRight > densityLeft) {
          if (isLeft) balanceBonus += 35.0;
          if (isRight) balanceBonus -= 35.0;
        }
      }
    }
  } else if (zones.isLeftDominant && isLeft) {
    balanceBonus += 30.0;
  } else if (zones.isRightDominant && isRight) {
    balanceBonus += 30.0;
  }

  // 3. Natural Grid Alignment & Column Snapping Bonuses
  let alignmentBonus = 0;
  if (col === 0) alignmentBonus += 8.0; // Left flush margin
  if (col + cw === grid.cols) alignmentBonus += 8.0; // Right flush margin
  if (col === zones.right.colMin) alignmentBonus += 8.0; // Right flank start margin
  if (col + cw === objectBox.colMin) alignmentBonus += 8.0; // Left flank end margin (flush against subject)
  if (row === 0) alignmentBonus += 6.0; // Flush top
  if (row + ch === grid.rows) alignmentBonus += 6.0; // Flush bottom

  for (const pId of Object.keys(placed)) {
    const other = placed[pId];
    if (other.col === col) {
      alignmentBonus += 12.0; // Shares exact column!
      if (other.row + other.ch === row || row + ch === other.row) {
        alignmentBonus += 18.0; // Flush vertical stack!
      }
      if (other.cw === cw) {
        alignmentBonus += 6.0; // Identical column width!
      }
    } else if (other.col + other.cw === col + cw) {
      alignmentBonus += 8.0; // Flush right edge alignment!
    } else if (other.row === row) {
      if (other.col + other.cw === col || col + cw === other.col) {
        alignmentBonus += 10.0; // Flush horizontal adjacency!
      }
      if (other.ch === ch) {
        alignmentBonus += 6.0; // Identical row height!
      }
    } else if (other.row + other.ch === row + ch) {
      alignmentBonus += 6.0; // Flush bottom row alignment!
    }
  }

  // 4. Productivity Companion Bonus (Todo & Notes)
  let companionBonus = 0;
  if (normId === 'todo' || normId === 'notes') {
    const partnerId = normId === 'todo' ? 'widget-notes' : 'widget-todo';
    const partner = placed[partnerId] || placed[normId === 'todo' ? 'notes' : 'todo'];
    if (partner) {
      if (partner.col === col) {
        companionBonus += 20.0;
        if (partner.row + partner.ch === row || row + ch === partner.row) {
          companionBonus += 30.0; // Direct vertical stack!
        }
      } else if (partner.row === row && (partner.col + partner.cw === col || col + cw === partner.col)) {
        companionBonus += 25.0; // Direct side-by-side!
      } else {
        const partnerIsLeft = (partner.col + partner.cw / 2) < objectBox.colMin;
        const candIsLeft = (col + cw / 2) < objectBox.colMin;
        if (partnerIsLeft === candIsLeft) {
          companionBonus += 15.0; // Both in the same open flank!
        }
      }
    }
  }

  // 5. Visual Hierarchy Specific Bonuses
  let hierarchyBonus = 0;
  if (role.role === 'search') {
    if (row === 0) {
      hierarchyBonus += 35.0;
      if (cw >= 4) hierarchyBonus += 10.0;
    } else if (zones.hasBottomShelf && row === zones.bottom.rowMin) {
      hierarchyBonus += 32.0;
      if (cw >= 4) hierarchyBonus += 10.0;
      if (col === Math.max(0, Math.round((grid.cols - cw) / 2))) hierarchyBonus += 15.0;
    } else if (row <= 2) {
      hierarchyBonus += 15.0;
    }
    // In dual-flank mode without top shelf, place Search complementarily opposite to Clock
    if (zones.isDualFlank && !zones.hasTopShelf && !zones.hasBottomShelf) {
      const clockPlaced = placed['widget-clock'] || placed['clock'];
      if (clockPlaced && clockPlaced.row === 0) {
        const clockIsLeft = (clockPlaced.col + clockPlaced.cw / 2) < objectBox.colMin;
        if (clockIsLeft && isRight && row === 0) hierarchyBonus += 45.0;
        if (!clockIsLeft && isLeft && row === 0) hierarchyBonus += 45.0;
      }
    }
  } else if (role.role === 'clock') {
    if (row === 0) hierarchyBonus += 30.0;
    else if (zones.hasBottomShelf && row === zones.bottom.rowMin) hierarchyBonus += 25.0;
    else if (row <= 2) hierarchyBonus += 10.0;
    if (zones.isDualFlank && !zones.hasTopShelf && !zones.hasBottomShelf) {
      const searchPlaced = placed['widget-search'] || placed['search'];
      if (searchPlaced && searchPlaced.row === 0) {
        const searchIsLeft = (searchPlaced.col + searchPlaced.cw / 2) < objectBox.colMin;
        if (searchIsLeft && isRight && row === 0) hierarchyBonus += 45.0;
        if (!searchIsLeft && isLeft && row === 0) hierarchyBonus += 45.0;
      }
    }
  } else if (role.role === 'card-large' || role.role === 'card-medium') {
    if (row === 0 || row === 2 || row === 3) hierarchyBonus += 8.0;
  }

  // 6. Size Comfort Bonus
  const origArea = Math.max(1, origSpan.cw * origSpan.ch);
  const curArea = cw * ch;
  const areaRatio = curArea / origArea;
  const comfortBonus = areaRatio * 25.0;

  // 7. Proximity to original position (tie breaker)
  const colDelta = Math.abs(col - origPos.col);
  const rowDelta = Math.abs(row - origPos.row);
  const proximityBonus = Math.max(0, 3.0 - (colDelta * 0.10 + rowDelta * 0.15));

  return (
    clearanceScore -
    densityPenalty +
    spaceReward +
    balanceBonus +
    alignmentBonus +
    companionBonus +
    hierarchyBonus +
    comfortBonus +
    proximityBonus +
    slotPriority * 0.25
  );
}

/**
 * Adjusts on-screen widgets away from the wallpaper's main object.
 *
 * Rules:
 * 1. Only on-screen (visible) widgets are adjusted.
 * 2. Widgets must not overlap the object box.
 * 3. Widgets must not overlap each other.
 * 4. Widgets respect their minimum width and height (e.g. Todo is at least 2x2).
 * 5. Revert tracking ONLY records widgets whose position or size actually changed.
 *
 * @param {Object} params
 * @param {string[]} params.allWidgetIds
 * @param {Object.<string, boolean>} [params.visibleWidgets]
 * @param {Object.<string, {col: number, row: number, x?: number, y?: number}>} [params.currentPositions]
 * @param {Object.<string, {cw: number, ch: number, w?: number, h?: number}>} [params.currentSizes]
 * @param {{colMin: number, rowMin: number, colMax: number, rowMax: number, offScreen?: boolean}} params.objectBox
 * @param {{cols: number, rows: number, cellW: number, cellH: number}} params.grid
 * @returns {{adjusted: boolean, newPositions: Object, newSizes: Object, movedWidgets: Object}}
 */
export function adjustWidgetsAwayFromObject({
  allWidgetIds,
  visibleWidgets = {},
  currentPositions = {},
  currentSizes = {},
  objectBox,
  objectBoxes = null,
  grid
}) {
  if (!objectBox || !grid || !Array.isArray(allWidgetIds) || objectBox.offScreen) {
    return {
      adjusted: false,
      newPositions: currentPositions,
      newSizes: currentSizes,
      movedWidgets: {}
    };
  }

  // 1. Filter to ONLY on-screen widgets
  const onScreenIds = allWidgetIds.filter((id) => visibleWidgets[id] !== false);
  if (!onScreenIds.length) {
    return {
      adjusted: false,
      newPositions: currentPositions,
      newSizes: currentSizes,
      movedWidgets: {}
    };
  }

  // Support multiple obstacle boxes (e.g. dual portraits)
  const obstacleBoxes = Array.isArray(objectBox?.boxes) && objectBox.boxes.length > 0
    ? objectBox.boxes
    : (Array.isArray(objectBoxes) && objectBoxes.length > 0 ? objectBoxes : [objectBox]);

  // 2. Normalize current positions & spans
  const normPositions = {};
  const normSpans = {};
  onScreenIds.forEach((id) => {
    const p = currentPositions[id] || { col: 0, row: 0 };
    const s = currentSizes[id] || { cw: minWidgetCols(id), ch: minWidgetRows(id) };
    const minC = minWidgetCols(id);
    const minR = minWidgetRows(id);
    normPositions[id] = {
      col: Math.max(0, Math.min(grid.cols - 1, Math.round(Number.isFinite(p.col) ? p.col : 0))),
      row: Math.max(0, Math.min(grid.rows - 1, Math.round(Number.isFinite(p.row) ? p.row : 0)))
    };
    normSpans[id] = {
      cw: Math.max(minC, Math.min(grid.cols, Math.round(Number.isFinite(s.cw) ? s.cw : minC))),
      ch: Math.max(minR, Math.min(grid.rows, Math.round(Number.isFinite(s.ch) ? s.ch : minR)))
    };
  });

  // 3. Identify collisions:
  // (a) Widgets that directly collide with any detected main object box
  // (b) Widgets that overlap each other on the grid
  const objectCollidingIds = new Set();
  onScreenIds.forEach((id) => {
    const box = { ...normPositions[id], ...normSpans[id] };
    for (const b of obstacleBoxes) {
      if (widgetCollidesWithObject(box, b)) {
        objectCollidingIds.add(id);
        break;
      }
    }
  });

  const widgetOverlapIds = new Set();
  for (let i = 0; i < onScreenIds.length; i++) {
    const idA = onScreenIds[i];
    const boxA = { ...normPositions[idA], ...normSpans[idA] };
    for (let j = i + 1; j < onScreenIds.length; j++) {
      const idB = onScreenIds[j];
      const boxB = { ...normPositions[idB], ...normSpans[idB] };
      if (cellBoxesOverlap(boxA, boxB)) {
        widgetOverlapIds.add(idA);
        widgetOverlapIds.add(idB);
      }
    }
  }

  // If no on-screen widgets collide with the object AND no widgets overlap each other,
  // no layout adjustment is required!
  if (objectCollidingIds.size === 0 && widgetOverlapIds.size === 0) {
    return {
      adjusted: false,
      newPositions: currentPositions,
      newSizes: currentSizes,
      movedWidgets: {}
    };
  }

  // 4. Negative space zones analysis
  const zones = identifyNegativeSpaceZones(objectBox, grid);

  // 5. Determine undisturbed widgets vs widgets needing relocation.
  const placed = {};
  const toPlace = [];

  for (const id of onScreenIds) {
    const box = { ...normPositions[id], ...normSpans[id] };
    const hitsObj = objectCollidingIds.has(id);
    const hasWidgetOverlap = widgetOverlapIds.has(id);

    if (!hitsObj && !hasWidgetOverlap) {
      placed[id] = { ...box };
    } else if (!hitsObj && hasWidgetOverlap) {
      let overlapsAlreadyPlaced = false;
      for (const otherId of Object.keys(placed)) {
        if (cellBoxesOverlap(box, placed[otherId])) {
          overlapsAlreadyPlaced = true;
          break;
        }
      }
      if (!overlapsAlreadyPlaced) {
        placed[id] = { ...box };
      } else {
        toPlace.push(id);
      }
    } else {
      toPlace.push(id);
    }
  }

  // Sort widgets needing placement by visual hierarchy priority first, then area descending
  toPlace.sort((a, b) => {
    const prioA = getWidgetVisualHierarchy(a).rank;
    const prioB = getWidgetVisualHierarchy(b).rank;
    if (prioA !== prioB) return prioA - prioB;
    const areaA = normSpans[a].cw * normSpans[a].ch;
    const areaB = normSpans[b].cw * normSpans[b].ch;
    return areaB - areaA || minWidgetCols(b) - minWidgetCols(a);
  });

  const allWidgetsSorted = [...onScreenIds].sort((a, b) => {
    const prioA = getWidgetVisualHierarchy(a).rank;
    const prioB = getWidgetVisualHierarchy(b).rank;
    if (prioA !== prioB) return prioA - prioB;
    const areaA = normSpans[a].cw * normSpans[a].ch;
    const areaB = normSpans[b].cw * normSpans[b].ch;
    return areaB - areaA || minWidgetCols(b) - minWidgetCols(a);
  });

  function canPlaceWidget(item, placedMap = placed) {
    if (!item || item.col < 0 || item.row < 0) return false;
    if (item.col + item.cw > grid.cols) return false;
    if (item.row + item.ch > grid.rows) return false;
    for (const b of obstacleBoxes) {
      if (widgetCollidesWithObject(item, b)) return false;
    }
    for (const otherId of Object.keys(placedMap)) {
      if (cellBoxesOverlap(item, placedMap[otherId])) return false;
    }
    return true;
  }

  function attemptPlacement(widgetsList, spanMode = 'comfortable', placedMap = placed) {
    const unplacedList = [];
    for (const id of widgetsList) {
      const origPos = normPositions[id];
      const origSpan = normSpans[id];
      let candidateSpans = [];

      let domZone = zones.left.capacity >= zones.right.capacity ? zones.left : zones.right;
      if (zones.hasTopShelf && zones.top.capacity >= domZone.capacity && zones.top.height >= 3) {
        domZone = zones.top;
      } else if (zones.hasBottomShelf && zones.bottom.capacity >= domZone.capacity && zones.bottom.height >= 3) {
        domZone = zones.bottom;
      } else if (zones.hasCenterCanvas && zones.center.capacity >= domZone.capacity) {
        domZone = zones.center;
      }

      if (spanMode === 'comfortable') {
        candidateSpans = getCandidateSpansForWidget(id, origSpan, grid, domZone, 'comfortable');
      } else if (spanMode === 'zone-fit') {
        candidateSpans = getCandidateSpansForWidget(id, origSpan, grid, domZone, 'zone-fit');
      } else {
        candidateSpans = getCandidateSpansForWidget(id, origSpan, grid, domZone, 'min-size');
      }

      let bestPlacement = null;
      let bestScore = -Infinity;
      const origArea = origSpan.cw * origSpan.ch;

      for (const span of candidateSpans) {
        // In comfortable mode, do not evaluate heavily downgraded spans (< 70% area) if a comfortable placement already exists
        if (spanMode === 'comfortable' && bestPlacement && span.area < origArea * 0.70) {
          break;
        }

        const slots = generateStructuredCandidateSlots(grid, objectBox, zones, span, id, placedMap);
        let spanBestPlacement = null;
        let spanBestScore = -Infinity;

        for (const slot of slots) {
          if (canPlaceWidget(slot, placedMap)) {
            const sc = scoreCandidate({
              cand: slot,
              widgetId: id,
              origPos,
              origSpan,
              objectBox,
              grid,
              zones,
              placed: placedMap
            });
            if (sc > spanBestScore) {
              spanBestScore = sc;
              spanBestPlacement = slot;
            }
          }
        }

        if (spanBestPlacement) {
          if (!bestPlacement) {
            bestPlacement = spanBestPlacement;
            bestScore = spanBestScore;
          } else if (spanBestScore > bestScore + 25.0) {
            // Adopt a slightly smaller comfortable span (e.g. 4x3 vs 4x4) only if it achieves a major layout gain (+25 points)
            bestPlacement = spanBestPlacement;
            bestScore = spanBestScore;
          }
          if (bestScore >= 200) break;
        }
      }

      if (bestPlacement) {
        placedMap[id] = bestPlacement;
      } else {
        unplacedList.push(id);
      }
    }
    return unplacedList;
  }

  // Pass 1: Attempt placement with requested / comfortable spans keeping undisturbed widgets
  let unplaced = attemptPlacement(toPlace, 'comfortable');

  // Pass 2: If any widget failed, try zone-fit spans
  if (unplaced.length > 0) {
    unplaced = attemptPlacement(unplaced, 'zone-fit');
  }

  // In dual-flank mode (center object), verify if the resulting layout is balanced across BOTH sides
  let isBalancedDualFlank = true;
  if (zones.isDualFlank && !zones.hasCenterCanvas && unplaced.length === 0) {
    let countL = 0, countR = 0;
    for (const id of onScreenIds) {
      if (placed[id]) {
        const midC = placed[id].col + placed[id].cw / 2;
        if (midC < objectBox.colMin) countL++;
        else if (midC > objectBox.colMax) countR++;
      }
    }
    // Severe imbalance detection:
    // 1. When 4+ widgets needed placement and were dumped mostly on one flank (<=1 on the other)
    // 2. When 4+ widgets needed placement and flank difference is >= 3
    // 3. When 3+ widgets needed placement and any widget was severely crushed to < 40% area
    const hasCrushedWidget = onScreenIds.some((id) => {
      const p = placed[id];
      const orig = normSpans[id];
      return p && (p.cw * p.ch < orig.cw * orig.ch * 0.40);
    });

    if (
      (toPlace.length >= 4 && (countL <= 1 || countR <= 1 || Math.abs(countL - countR) >= 3)) ||
      (toPlace.length >= 3 && hasCrushedWidget)
    ) {
      isBalancedDualFlank = false;
    }
  }

  // If undisturbed widgets choked the layout (unplaced > 0) OR resulted in severe one-sided clumping in dual-flank mode:
  // Re-distribute ALL on-screen widgets fresh in a balanced dual-flank layout!
  if (unplaced.length > 0 || (zones.isDualFlank && !isBalancedDualFlank)) {
    for (const pId of Object.keys(placed)) {
      delete placed[pId];
    }
    unplaced = attemptPlacement(allWidgetsSorted, 'comfortable', placed);
    if (unplaced.length > 0) {
      unplaced = attemptPlacement(unplaced, 'zone-fit', placed);
    }
    if (unplaced.length > 0) {
      for (const pId of Object.keys(placed)) {
        delete placed[pId];
      }
      unplaced = attemptPlacement(allWidgetsSorted, 'zone-fit', placed);
    }
    if (unplaced.length > 0) {
      for (const pId of Object.keys(placed)) {
        delete placed[pId];
      }
      unplaced = attemptPlacement(allWidgetsSorted, 'min-size', placed);
    }
  }

  // Pass 3: If still unplaced, allow unplaced widgets to try down to minimum size
  if (unplaced.length > 0) {
    unplaced = attemptPlacement(unplaced, 'min-size', placed);
  }

  // Pass 4: Zero-overlap emergency fallback guaranteeing ALL widgets find a valid spot
  if (unplaced.length > 0) {
    for (const id of unplaced) {
      const minCw = Math.min(minWidgetCols(id), grid.cols);
      const minCh = Math.min(minWidgetRows(id), grid.rows);
      let found = null;

      // Primary: try at exact min dimensions
      for (let r = 0; r <= grid.rows - minCh && !found; r++) {
        for (let c = 0; c <= grid.cols - minCw && !found; c++) {
          const cand = { col: c, row: r, cw: minCw, ch: minCh };
          if (canPlaceWidget(cand, placed)) {
            found = cand;
            break;
          }
        }
      }

      // Secondary: if massive obstacle leaves narrower clearance than default minCw/minCh
      if (!found) {
        for (let testCw = minCw; testCw >= 1 && !found; testCw--) {
          for (let testCh = minCh; testCh >= 1 && !found; testCh--) {
            for (let r = 0; r <= grid.rows - testCh && !found; r++) {
              for (let c = 0; c <= grid.cols - testCw && !found; c++) {
                const cand = { col: c, row: r, cw: testCw, ch: testCh };
                if (canPlaceWidget(cand, placed)) {
                  found = cand;
                  break;
                }
              }
            }
          }
        }
      }

      if (found) {
        placed[id] = found;
      }
    }
  }

  // 6. Post-placement relaxation: expand shrunk widgets into adjacent free cells if possible
  // RUNS FOR ALL PLACED WIDGETS!
  for (const id of onScreenIds) {
    const p = placed[id];
    if (!p) continue;
    const origSpan = normSpans[id];

    // Try expanding horizontally towards original width
    while (p.cw < origSpan.cw) {
      const testItem = { col: p.col, row: p.row, cw: p.cw + 1, ch: p.ch };
      let fits = true;
      if (testItem.col + testItem.cw > grid.cols) fits = false;
      for (const b of obstacleBoxes) {
        if (widgetCollidesWithObject(testItem, b)) {
          fits = false;
          break;
        }
      }
      if (fits) {
        for (const otherId of Object.keys(placed)) {
          if (otherId !== id && cellBoxesOverlap(testItem, placed[otherId])) {
            fits = false;
            break;
          }
        }
      }
      if (fits) p.cw++;
      else break;
    }

    // Try expanding vertically towards original height
    while (p.ch < origSpan.ch) {
      const testItem = { col: p.col, row: p.row, cw: p.cw, ch: p.ch + 1 };
      let fits = true;
      if (testItem.row + testItem.ch > grid.rows) fits = false;
      for (const b of obstacleBoxes) {
        if (widgetCollidesWithObject(testItem, b)) {
          fits = false;
          break;
        }
      }
      if (fits) {
        for (const otherId of Object.keys(placed)) {
          if (otherId !== id && cellBoxesOverlap(testItem, placed[otherId])) {
            fits = false;
            break;
          }
        }
      }
      if (fits) p.ch++;
      else break;
    }
  }

  // 7. Compute movedWidgets: ONLY record widgets that actually changed position or size
  const movedWidgets = {};
  const newPositions = { ...currentPositions };
  const newSizes = { ...currentSizes };

  onScreenIds.forEach((id) => {
    const origP = normPositions[id];
    const origS = normSpans[id];
    const newP = placed[id];

    if (!newP) return;

    const posChanged = newP.col !== origP.col || newP.row !== origP.row;
    const sizeChanged = newP.cw !== origS.cw || newP.ch !== origS.ch;

    if (posChanged || sizeChanged) {
      movedWidgets[id] = {
        col: origP.col,
        row: origP.row,
        cw: origS.cw,
        ch: origS.ch,
        ...(Number.isFinite(currentPositions[id]?.x) ? { x: currentPositions[id].x } : {}),
        ...(Number.isFinite(currentPositions[id]?.y) ? { y: currentPositions[id].y } : {}),
        ...(Number.isFinite(currentSizes[id]?.w) ? { w: currentSizes[id].w } : {}),
        ...(Number.isFinite(currentSizes[id]?.h) ? { h: currentSizes[id].h } : {})
      };
      newPositions[id] = {
        ...(newPositions[id] || {}),
        col: newP.col,
        row: newP.row
      };
      newSizes[id] = {
        ...(newSizes[id] || {}),
        cw: newP.cw,
        ch: newP.ch
      };
    }
  });

  const hasAdjusted = Object.keys(movedWidgets).length > 0;

  return {
    adjusted: hasAdjusted,
    newPositions,
    newSizes,
    movedWidgets
  };
}

/**
 * Reverts automatic widget adjustments for ONLY the widgets that were moved.
 * Supports full previous layout snapshot if provided, otherwise cleanly restores movedWidgets.
 *
 * @param {Object.<string, {col: number, row: number, x?: number, y?: number}>} currentPositions
 * @param {Object.<string, {cw: number, ch: number, w?: number, h?: number}>} currentSizes
 * @param {Object.<string, {col: number, row: number, cw?: number, ch?: number, x?: number, y?: number, w?: number, h?: number}>} movedWidgets
 * @param {Object.<string, {col: number, row: number, x?: number, y?: number}>} [previousPositions]
 * @param {Object.<string, {cw: number, ch: number, w?: number, h?: number}>} [previousSizes]
 * @returns {{newPositions: Object, newSizes: Object}}
 */
export function revertWidgetAdjustments(
  currentPositions,
  currentSizes,
  movedWidgets,
  previousPositions,
  previousSizes
) {
  const newPositions = { ...(currentPositions || {}) };
  const newSizes = { ...(currentSizes || {}) };

  // If full previous snapshot is provided, restore exactly from it
  const hasPrevPositions = previousPositions && typeof previousPositions === 'object' && Object.keys(previousPositions).length > 0;
  const hasPrevSizes = previousSizes && typeof previousSizes === 'object' && Object.keys(previousSizes).length > 0;

  if (hasPrevPositions || hasPrevSizes) {
    if (hasPrevPositions) {
      Object.keys(previousPositions).forEach((id) => {
        const p = previousPositions[id];
        if (p && Number.isFinite(p.col) && Number.isFinite(p.row)) {
          const nextPos = {
            col: p.col,
            row: p.row
          };
          if (Number.isFinite(p.x)) nextPos.x = p.x;
          if (Number.isFinite(p.y)) nextPos.y = p.y;
          newPositions[id] = nextPos;
        }
      });
    }
    if (hasPrevSizes) {
      Object.keys(previousSizes).forEach((id) => {
        const s = previousSizes[id];
        if (s && Number.isFinite(s.cw) && Number.isFinite(s.ch)) {
          const nextSize = {
            cw: s.cw,
            ch: s.ch
          };
          if (Number.isFinite(s.w)) nextSize.w = s.w;
          if (Number.isFinite(s.h)) nextSize.h = s.h;
          newSizes[id] = nextSize;
        }
      });
    }
    return { newPositions, newSizes };
  }

  // Otherwise revert based on movedWidgets diff
  if (!movedWidgets || typeof movedWidgets !== 'object') {
    return { newPositions, newSizes };
  }

  Object.keys(movedWidgets).forEach((id) => {
    const orig = movedWidgets[id];
    if (orig && Number.isFinite(orig.col) && Number.isFinite(orig.row)) {
      const nextPos = {
        col: orig.col,
        row: orig.row
      };
      if (Number.isFinite(orig.x)) nextPos.x = orig.x;
      if (Number.isFinite(orig.y)) nextPos.y = orig.y;
      newPositions[id] = nextPos;
    }
    if (orig && Number.isFinite(orig.cw) && Number.isFinite(orig.ch)) {
      const nextSize = {
        cw: orig.cw,
        ch: orig.ch
      };
      if (Number.isFinite(orig.w)) nextSize.w = orig.w;
      if (Number.isFinite(orig.h)) nextSize.h = orig.h;
      newSizes[id] = nextSize;
    }
  });

  return { newPositions, newSizes };
}
