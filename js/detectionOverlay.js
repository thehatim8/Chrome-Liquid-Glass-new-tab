// js/detectionOverlay.js
// Visual HUD overlay for displaying detected wallpaper subjects, bounding boxes, and confidence metrics.

import { buildSmoothContourPath } from './objectRecognition.js';

/**
 * Computes exact viewport pixel coordinates for a normalized bounding box [0, 1]
 * matching CSS `background-size: cover; background-position: center center;`.
 *
 * @param {{xMin: number, yMin: number, xMax: number, yMax: number}} box
 * @param {{width: number, height: number}} [imageDims]
 * @param {{width: number, height: number}} [windowDims]
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function computeCoverPixelBounds(box, imageDims, windowDims) {
  if (!box) return { left: 0, top: 0, width: 0, height: 0 };
  const winW = (windowDims && windowDims.width) || (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const winH = (windowDims && windowDims.height) || (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const imgW = (imageDims && imageDims.width) || winW;
  const imgH = (imageDims && imageDims.height) || winH;

  const scale = Math.max(winW / Math.max(1, imgW), winH / Math.max(1, imgH));
  const renderedW = imgW * scale;
  const renderedH = imgH * scale;
  const offsetX = (winW - renderedW) / 2;
  const offsetY = (winH - renderedH) / 2;

  const left = offsetX + box.xMin * renderedW;
  const top = offsetY + box.yMin * renderedH;
  const width = Math.max(1, (box.xMax - box.xMin) * renderedW);
  const height = Math.max(1, (box.yMax - box.yMin) * renderedH);

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height)
  };
}

/**
 * Computes exact viewport pixel coordinates for normalized contour points [0, 1]
 * matching CSS `background-size: cover; background-position: center center;`.
 *
 * @param {Array<{x: number, y: number}>} contour
 * @param {{width: number, height: number}} [imageDims]
 * @param {{width: number, height: number}} [windowDims]
 * @returns {Array<{x: number, y: number}>}
 */
export function computeCoverContourPixels(contour, imageDims, windowDims) {
  if (!Array.isArray(contour) || contour.length === 0) return [];
  const winW = (windowDims && windowDims.width) || (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const winH = (windowDims && windowDims.height) || (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const imgW = (imageDims && imageDims.width) || winW;
  const imgH = (imageDims && imageDims.height) || winH;

  const scale = Math.max(winW / Math.max(1, imgW), winH / Math.max(1, imgH));
  const renderedW = imgW * scale;
  const renderedH = imgH * scale;
  const offsetX = (winW - renderedW) / 2;
  const offsetY = (winH - renderedH) / 2;

  return contour
    .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map(p => ({
      x: Math.round(offsetX + p.x * renderedW),
      y: Math.round(offsetY + p.y * renderedH)
    }));
}

let activeOverlayTimer = null;
let activeFadeTimer = null;

/**
 * Removes any active detection outline overlay from the DOM.
 */
export function hideDetectionOutline() {
  if (activeOverlayTimer) {
    clearTimeout(activeOverlayTimer);
    activeOverlayTimer = null;
  }
  if (activeFadeTimer) {
    clearTimeout(activeFadeTimer);
    activeFadeTimer = null;
  }
  if (typeof document === 'undefined' || !document.getElementById) return;
  const existing = document.getElementById('detectedObjectOverlayContainer');
  if (existing) {
    if (existing.classList && existing.classList.add) {
      existing.classList.add('fading-out');
    }
    activeFadeTimer = setTimeout(() => {
      activeFadeTimer = null;
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }, 600);
  }
}

/**
 * Renders a temporary visual detection outline overlay over the wallpaper.
 *
 * @param {Object} detection - Detection result with boundingBox, boundingBoxes, contour, shapeType, circle, etc.
 * @param {Object} [options]
 * @param {number} [options.duration=4000] - Duration in ms before auto-fading
 * @param {string} [options.title='Detected Subject'] - Badge title
 * @param {Object} [options.gridBox] - Mapped grid cell box {colMin, rowMin, colMax, rowMax}
 */
export function showDetectionOutline(detection, options = {}) {
  if (typeof document === 'undefined') return;

  // Clear timers and immediately remove any preexisting container
  if (activeOverlayTimer) {
    clearTimeout(activeOverlayTimer);
    activeOverlayTimer = null;
  }
  if (activeFadeTimer) {
    clearTimeout(activeFadeTimer);
    activeFadeTimer = null;
  }
  const existingContainer = document.getElementById('detectedObjectOverlayContainer');
  if (existingContainer && existingContainer.parentNode) {
    existingContainer.parentNode.removeChild(existingContainer);
  }

  if (!detection || !detection.hasObject || !detection.boundingBox) {
    return;
  }

  const duration = typeof options.duration === 'number' ? options.duration : 4000;
  const defaultTitle = options.title || null;
  const confidencePct = Math.round((detection.confidence || 0.85) * 100);
  const imageDims = detection.imageDims || null;
  const windowDims = { width: window.innerWidth, height: window.innerHeight };

  const getDisplayTitle = (itemBox) => {
    if (defaultTitle) return defaultTitle;
    const cat = itemBox?.category || detection.category;
    const lbl = itemBox?.label || detection.label;
    if (lbl && lbl !== 'Main Object' && lbl !== 'Detected Subject') return lbl;
    if (cat === 'character') return 'Anime Character';
    if (cat === 'human') return 'Human Portrait';
    if (cat === 'car') return 'Car / Vehicle';
    if (cat === 'flower') return 'Flower / Botanical';
    if (cat === 'object') return 'Main Object';
    return lbl || 'Detected Subject';
  };

  const rawBoxes = Array.isArray(detection.boundingBoxes) && detection.boundingBoxes.length > 0
    ? detection.boundingBoxes
    : [detection.boundingBox];

  const container = document.createElement('div');
  container.id = 'detectedObjectOverlayContainer';
  container.className = 'detected-object-overlay-container';

  // Check if contours or circular shapes are present
  const rawContours = (Array.isArray(detection.contours) && detection.contours.length > 0)
    ? detection.contours
    : (detection.contour
        ? [detection.contour]
        : (Array.isArray(detection.boundingBoxes)
            ? detection.boundingBoxes.map(b => b?.contour).filter(Boolean)
            : (detection.boundingBox?.contour ? [detection.boundingBox.contour] : [])));

  const validContours = rawContours
    .map(c => Array.isArray(c) ? c : c?.contour)
    .filter(c => Array.isArray(c) && c.length >= 3);

  const hasCircle = (detection.shapeType === 'circle' && detection.circle) ||
    rawBoxes.some(b => b?.shapeType === 'circle' && b?.circle);

  if (validContours.length > 0 || hasCircle) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svgEl = document.createElementNS ? document.createElementNS(svgNS, 'svg') : document.createElement('svg');
    svgEl.setAttribute('class', 'detected-object-svg');
    svgEl.setAttribute('width', `${windowDims.width}`);
    svgEl.setAttribute('height', `${windowDims.height}`);
    svgEl.setAttribute('viewBox', `0 0 ${windowDims.width} ${windowDims.height}`);
    svgEl.setAttribute('xmlns', svgNS);

    // Neon glow filter
    const defs = document.createElementNS ? document.createElementNS(svgNS, 'defs') : document.createElement('defs');
    try {
      const filter = document.createElementNS ? document.createElementNS(svgNS, 'filter') : document.createElement('filter');
      filter.setAttribute('id', 'hudNeonGlow');
      filter.setAttribute('x', '-20%');
      filter.setAttribute('y', '-20%');
      filter.setAttribute('width', '140%');
      filter.setAttribute('height', '140%');

      const blur1 = document.createElementNS ? document.createElementNS(svgNS, 'feGaussianBlur') : document.createElement('feGaussianBlur');
      blur1.setAttribute('stdDeviation', '4');
      blur1.setAttribute('result', 'blur1');
      filter.appendChild(blur1);

      const blur2 = document.createElementNS ? document.createElementNS(svgNS, 'feGaussianBlur') : document.createElement('feGaussianBlur');
      blur2.setAttribute('in', 'SourceGraphic');
      blur2.setAttribute('stdDeviation', '2');
      blur2.setAttribute('result', 'blur2');
      filter.appendChild(blur2);

      const merge = document.createElementNS ? document.createElementNS(svgNS, 'feMerge') : document.createElement('feMerge');
      const node1 = document.createElementNS ? document.createElementNS(svgNS, 'feMergeNode') : document.createElement('feMergeNode');
      node1.setAttribute('in', 'blur1');
      merge.appendChild(node1);
      const node2 = document.createElementNS ? document.createElementNS(svgNS, 'feMergeNode') : document.createElement('feMergeNode');
      node2.setAttribute('in', 'blur2');
      merge.appendChild(node2);
      const node3 = document.createElementNS ? document.createElementNS(svgNS, 'feMergeNode') : document.createElement('feMergeNode');
      node3.setAttribute('in', 'SourceGraphic');
      merge.appendChild(node3);
      filter.appendChild(merge);

      defs.appendChild(filter);
    } catch (_) {
      defs.innerHTML = `
        <filter id="hudNeonGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur1" />
          <feMerge>
            <feMergeNode in="blur1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      `;
    }
    svgEl.appendChild(defs);

    const itemsToDraw = validContours.length > 0 ? validContours : rawBoxes;

    itemsToDraw.forEach((item, idx) => {
      const correspBox = rawBoxes[idx] || rawBoxes[0];
      const circle = correspBox?.circle || detection.circle || null;
      const isCircle = (correspBox?.shapeType === 'circle' && circle) ||
        (detection.shapeType === 'circle' && circle && idx === 0);

      if (isCircle && circle) {
        const winW = (windowDims && windowDims.width) || (typeof window !== 'undefined' ? window.innerWidth : 1920);
        const winH = (windowDims && windowDims.height) || (typeof window !== 'undefined' ? window.innerHeight : 1080);
        const imgW = (imageDims && imageDims.width) || winW;
        const imgH = (imageDims && imageDims.height) || winH;
        const scale = Math.max(winW / Math.max(1, imgW), winH / Math.max(1, imgH));
        const renderedW = imgW * scale;
        const renderedH = imgH * scale;
        const offsetX = (winW - renderedW) / 2;
        const offsetY = (winH - renderedH) / 2;

        const cxPx = offsetX + circle.cx * renderedW;
        const cyPx = offsetY + circle.cy * renderedH;
        const rPx = circle.rx ? circle.rx * renderedW : (circle.r * Math.max(renderedW, renderedH));

        const safeCx = Number.isFinite(cxPx) ? Math.round(cxPx) : Math.round(winW / 2);
        const safeCy = Number.isFinite(cyPx) ? Math.round(cyPx) : Math.round(winH / 2);
        const safeRadius = Math.max(6, Number.isFinite(rPx) ? Math.round(rPx) : 30);

        const circleEl = document.createElementNS ? document.createElementNS(svgNS, 'circle') : document.createElement('circle');
        circleEl.setAttribute('cx', `${safeCx}`);
        circleEl.setAttribute('cy', `${safeCy}`);
        circleEl.setAttribute('r', `${safeRadius}`);
        circleEl.setAttribute('class', 'detected-contour-circle');
        circleEl.setAttribute('filter', 'url(#hudNeonGlow)');
        svgEl.appendChild(circleEl);

        // 4 cardinal reticle nodes
        const nodes = [
          { x: safeCx, y: safeCy - safeRadius },
          { x: safeCx, y: safeCy + safeRadius },
          { x: safeCx - safeRadius, y: safeCy },
          { x: safeCx + safeRadius, y: safeCy }
        ];
        nodes.forEach((np) => {
          const nodeEl = document.createElementNS ? document.createElementNS(svgNS, 'circle') : document.createElement('circle');
          nodeEl.setAttribute('cx', `${Math.round(np.x)}`);
          nodeEl.setAttribute('cy', `${Math.round(np.y)}`);
          nodeEl.setAttribute('r', '3.5');
          nodeEl.setAttribute('class', 'detected-contour-node');
          svgEl.appendChild(nodeEl);
        });

        // Badge clamped within viewport
        const badge = document.createElement('div');
        badge.className = 'detected-contour-badge';
        const badgeLeft = Math.max(90, Math.min(winW - 90, safeCx));
        badge.style.left = `${badgeLeft}px`;
        badge.style.top = `${Math.max(16, safeCy - safeRadius - 34)}px`;
        let label = `🎯 ${getDisplayTitle(correspBox)}${itemsToDraw.length > 1 ? ` #${idx + 1}` : ''} (${confidencePct}%) • Circular Shape`;
        if (options.gridBox && idx === 0) {
          const colsLabel = options.gridBox.colMin === options.gridBox.colMax
            ? `Col ${options.gridBox.colMin + 1}`
            : `Cols ${options.gridBox.colMin + 1}-${options.gridBox.colMax + 1}`;
          label += ` • ${colsLabel}`;
        }
        badge.textContent = label;
        container.appendChild(badge);
      } else {
        const normContour = Array.isArray(item) ? item : item?.contour;
        if (!Array.isArray(normContour) || normContour.length < 3) return;

        const pxPoints = computeCoverContourPixels(normContour, imageDims, windowDims);
        if (pxPoints.length < 3) return;

        // Render smooth spline contour path
        let pathD = buildSmoothContourPath(pxPoints, 0.38);
        if (!pathD) {
          pathD = pxPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
        }
        const pathEl = document.createElementNS ? document.createElementNS(svgNS, 'path') : document.createElement('path');
        pathEl.setAttribute('d', pathD);
        pathEl.setAttribute('class', 'detected-contour-path');
        pathEl.setAttribute('filter', 'url(#hudNeonGlow)');
        svgEl.appendChild(pathEl);

        let topPt = pxPoints[0], botPt = pxPoints[0], leftPt = pxPoints[0], rightPt = pxPoints[0];
        for (const pt of pxPoints) {
          if (pt.y < topPt.y) topPt = pt;
          if (pt.y > botPt.y) botPt = pt;
          if (pt.x < leftPt.x) leftPt = pt;
          if (pt.x > rightPt.x) rightPt = pt;
        }

        // Deduplicate cardinal/corner nodes
        const rawExtremes = [topPt, botPt, leftPt, rightPt];
        const uniqueNodes = [];
        const seenCoord = new Set();
        rawExtremes.forEach((pt) => {
          const key = `${pt.x},${pt.y}`;
          if (!seenCoord.has(key)) {
            seenCoord.add(key);
            uniqueNodes.push(pt);
          }
        });

        uniqueNodes.forEach((np) => {
          const nodeEl = document.createElementNS ? document.createElementNS(svgNS, 'circle') : document.createElement('circle');
          nodeEl.setAttribute('cx', `${np.x}`);
          nodeEl.setAttribute('cy', `${np.y}`);
          nodeEl.setAttribute('r', '3.5');
          nodeEl.setAttribute('class', 'detected-contour-node');
          svgEl.appendChild(nodeEl);
        });

        const badge = document.createElement('div');
        badge.className = 'detected-contour-badge';
        const midX = (leftPt.x + rightPt.x) / 2;
        const badgeLeft = Math.max(90, Math.min(windowDims.width - 90, Math.round(midX)));
        badge.style.left = `${badgeLeft}px`;
        badge.style.top = `${Math.max(16, Math.round(topPt.y - 34))}px`;
        let label = `🎯 ${getDisplayTitle(correspBox)}${itemsToDraw.length > 1 ? ` #${idx + 1}` : ''} (${confidencePct}%) • Contoured Shape`;
        if (options.gridBox && idx === 0) {
          const colsLabel = options.gridBox.colMin === options.gridBox.colMax
            ? `Col ${options.gridBox.colMin + 1}`
            : `Cols ${options.gridBox.colMin + 1}-${options.gridBox.colMax + 1}`;
          label += ` • ${colsLabel}`;
        }
        badge.textContent = label;
        container.appendChild(badge);
      }
    });

    container.appendChild(svgEl);
  } else {
    // Fallback: rectangular bounding box
    rawBoxes.forEach((box, idx) => {
      const px = computeCoverPixelBounds(box, imageDims, windowDims);
      if (px.left + px.width <= 0 || px.left >= windowDims.width || px.top + px.height <= 0 || px.top >= windowDims.height) {
        return;
      }

      const boxEl = document.createElement('div');
      boxEl.className = 'detected-object-box';
      boxEl.setAttribute('class', 'detected-object-box');
      boxEl.style.left = `${px.left}px`;
      boxEl.style.top = `${px.top}px`;
      boxEl.style.width = `${px.width}px`;
      boxEl.style.height = `${px.height}px`;

      const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
      corners.forEach((c) => {
        const reticle = document.createElement('span');
        reticle.className = `detected-reticle detected-reticle-${c}`;
        reticle.setAttribute('class', `detected-reticle detected-reticle-${c}`);
        boxEl.appendChild(reticle);
      });

      const badge = document.createElement('div');
      badge.className = 'detected-object-badge';
      badge.setAttribute('class', 'detected-object-badge');
      let label = `🎯 ${getDisplayTitle(box)}${rawBoxes.length > 1 ? ` #${idx + 1}` : ''} (${confidencePct}%)`;
      if (options.gridBox && idx === 0) {
        label += ` • Cols ${options.gridBox.colMin + 1}-${options.gridBox.colMax + 1}`;
      }
      badge.textContent = label;
      boxEl.appendChild(badge);

      container.appendChild(boxEl);
    });
  }

  if (document.body && document.body.appendChild) {
    document.body.appendChild(container);
  }

  // Trigger animation reflow
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      container.classList.add('visible');
    });
  } else if (container.classList && container.classList.add) {
    container.classList.add('visible');
  }

  // Auto hide after duration
  activeOverlayTimer = setTimeout(() => {
    activeOverlayTimer = null;
    hideDetectionOutline();
  }, duration);
}
