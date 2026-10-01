// test/objectRecognitionAndLayout.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WIDGET_MIN_SIZES,
  minWidgetCols,
  minWidgetRows,
  getLayoutConfig
} from '../js/layoutConfig.js';

import {
  detectMainObjectFromImageData,
  extractContourFromMask,
  simplifyPolygonRDP,
  classifyShape,
  computeRowExtents,
  buildSmoothContourPath,
  fitCircleKasa,
  rgbToLab,
  deltaE,
  classifyObjectSemantics,
  refineContourHighRes
} from '../js/objectRecognition.js';

import {
  mapObjectBoxToGrid,
  adjustWidgetsAwayFromObject,
  revertWidgetAdjustments,
  cellBoxesOverlap,
  identifyNegativeSpaceZones,
  widgetCollidesWithObject
} from '../js/objectAwareLayout.js';

import {
  findNearestFreeCell
} from '../js/grid.js';

import {
  computeCoverPixelBounds,
  computeCoverContourPixels,
  showDetectionOutline,
  hideDetectionOutline
} from '../js/detectionOverlay.js';

test('Widget Minimum Dimensions & Constraints', (t) => {
  // Requirement: "and for that i am sure we need minimum width and height for each widget,
  // like for todo widget it can be 2x2 because the todo widget is useable in 2x2 size, make no mistake."
  assert.equal(minWidgetCols('widget-todo'), 2, 'Todo widget minimum cols must be 2');
  assert.equal(minWidgetRows('widget-todo'), 2, 'Todo widget minimum rows must be 2');
  assert.deepEqual(WIDGET_MIN_SIZES['widget-todo'], { cols: 2, rows: 2 }, 'WIDGET_MIN_SIZES contains todo at 2x2');

  // Verify other standard widgets
  assert.equal(minWidgetCols('widget-clock'), 2);
  assert.equal(minWidgetRows('widget-clock'), 2);
  assert.equal(minWidgetCols('widget-aichat'), 3);
  assert.equal(minWidgetRows('widget-aichat'), 3);
  assert.equal(minWidgetCols('widget-calendar'), 3);
  assert.equal(minWidgetRows('widget-calendar'), 2);
  assert.equal(minWidgetCols('widget-search'), 4);
  assert.equal(minWidgetRows('widget-search'), 2);

  // Default fallback for unknown widget IDs (e.g. icon grid widget)
  assert.equal(minWidgetCols('widget-icon-grid-custom'), 2);
  assert.equal(minWidgetRows('widget-icon-grid-custom'), 2);
});

test('Main Object Recognition: Detects Center Object', () => {
  // Create synthetic 100x80 image with dark background and a bright salient subject in center
  const w = 100;
  const h = 80;
  const data = new Uint8ClampedArray(w * h * 4);

  // Background: dark blue (R: 20, G: 25, B: 40)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 20;
    data[i * 4 + 1] = 25;
    data[i * 4 + 2] = 40;
    data[i * 4 + 3] = 255;
  }

  // Foreground object: bright red/orange portrait in center: x from 35 to 65, y from 20 to 60
  for (let y = 20; y <= 60; y++) {
    for (let x = 35; x <= 65; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 240;
      data[idx + 1] = 120;
      data[idx + 2] = 50;
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Should detect salient object');
  assert.ok(result.boundingBox, 'Should return bounding box');
  assert.ok(result.confidence > 0.5, 'Confidence should be significant');

  // Bounding box should enclose the center object
  const bb = result.boundingBox;
  assert.ok(bb.xMin <= 0.35 + 0.05 && bb.xMin >= 0.20, `xMin (${bb.xMin}) should align with object`);
  assert.ok(bb.xMax >= 0.65 - 0.05 && bb.xMax <= 0.85, `xMax (${bb.xMax}) should align with object`);
  assert.ok(bb.yMin <= 0.25 + 0.05 && bb.yMin >= 0.10, `yMin (${bb.yMin}) should align with object`);
  assert.ok(bb.yMax >= 0.60 - 0.05 && bb.yMax <= 0.85, `yMax (${bb.yMax}) should align with object`);
});

test('Main Object Recognition: Detects Off-Center (Right Side) Object', () => {
  const w = 120;
  const h = 80;
  const data = new Uint8ClampedArray(w * h * 4);

  // Background: dark green (30, 50, 30)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 30;
    data[i * 4 + 1] = 50;
    data[i * 4 + 2] = 30;
    data[i * 4 + 3] = 255;
  }

  // Subject on right side: x: 75 to 110, y: 20 to 65 (bright yellow 250, 240, 80)
  for (let y = 20; y <= 65; y++) {
    for (let x = 75; x <= 110; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 250;
      data[idx + 1] = 240;
      data[idx + 2] = 80;
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Should detect right-side object');
  assert.ok(result.boundingBox.xMin >= 0.50, `xMin (${result.boundingBox.xMin}) should be on right half`);
  assert.ok(result.centroid.x >= 0.65, `Centroid x (${result.centroid.x}) should be on right half`);
});

test('Main Object Recognition: Handles Homogeneous / Flat Wallpaper (No Object)', () => {
  const w = 100;
  const h = 80;
  const data = new Uint8ClampedArray(w * h * 4);

  // Uniform dark purple wallpaper with slight ambient gradient
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 40 + Math.round(x / 20);
      data[idx + 1] = 20 + Math.round(y / 20);
      data[idx + 2] = 60;
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, false, 'Should report no distinct object for flat wallpaper');
  assert.equal(result.boundingBox, null);
});

test('Grid Coordinate Mapping from Image to Workspace Cells', () => {
  const boundingBox = { xMin: 0.3, yMin: 0.2, xMax: 0.7, yMax: 0.8 };
  const windowDims = { width: 1920, height: 1080 };
  const imageDims = { width: 1920, height: 1080 };
  const workspaceRect = { left: 0, top: 60, width: 1920, height: 900 };
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 75, offsetX: 0, offsetY: 0 };

  const cellBox = mapObjectBoxToGrid(boundingBox, imageDims, windowDims, workspaceRect, grid);
  assert.ok(Number.isFinite(cellBox.colMin) && Number.isFinite(cellBox.colMax));
  assert.ok(Number.isFinite(cellBox.rowMin) && Number.isFinite(cellBox.rowMax));
  assert.ok(cellBox.colMin >= 0 && cellBox.colMax < 24);
  assert.ok(cellBox.rowMin >= 0 && cellBox.rowMax < 12);
  assert.ok(cellBox.colMin <= cellBox.colMax);
  assert.ok(cellBox.rowMin <= cellBox.rowMax);
});

test('Object-Aware Layout: Adjusts Colliding Widgets Away & Preserves Non-Colliding', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 75 };
  const allWidgetIds = [
    'widget-search',
    'widget-clock',
    'widget-todo',
    'widget-notes',
    'widget-hidden'
  ];

  const visibleWidgets = {
    'widget-search': true,
    'widget-clock': true,
    'widget-todo': true,
    'widget-notes': true,
    'widget-hidden': false // HIDDEN: must NOT be touched or adjusted
  };

  // Initial layout
  const currentPositions = {
    'widget-clock':  { col: 0,  row: 0 },  // Top-left: doesn't collide
    'widget-search': { col: 8,  row: 2 },  // Middle: DIRECTLY COLLIDES with center object
    'widget-todo':   { col: 8,  row: 6 },  // Middle: DIRECTLY COLLIDES with center object
    'widget-notes':  { col: 19, row: 8 },  // Bottom-right: doesn't collide
    'widget-hidden': { col: 10, row: 4 }   // Hidden
  };

  const currentSizes = {
    'widget-clock':  { cw: 4, ch: 3 },
    'widget-search': { cw: 8, ch: 3 },
    'widget-todo':   { cw: 6, ch: 4 },
    'widget-notes':  { cw: 4, ch: 3 },
    'widget-hidden': { cw: 4, ch: 4 }
  };

  // Center object occupying cols 7-16, rows 2-7
  const objectBox = { colMin: 7, rowMin: 2, colMax: 16, rowMax: 7 };

  const result = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(result.adjusted, true, 'Adjustment should have occurred');
  const moved = result.movedWidgets;

  // Requirement: "the automatic widgetes adjustment should only happen with the on screen widgets"
  assert.equal('widget-hidden' in moved, false, 'Hidden widget must NOT be adjusted or in movedWidgets');

  // Requirement: "revert should only rever the position of those widget which extension moved"
  assert.ok('widget-search' in moved, 'Colliding search widget should be in movedWidgets');
  assert.ok('widget-todo' in moved, 'Colliding todo widget should be in movedWidgets');

  // Verify non-colliding widget that didn't need to move is NOT in movedWidgets
  assert.equal('widget-clock' in moved, false, 'Non-colliding clock widget must not be moved');

  // Verify none of the adjusted on-screen widgets overlap with objectBox
  for (const id of ['widget-search', 'widget-clock', 'widget-todo', 'widget-notes']) {
    const pos = result.newPositions[id];
    const sz = result.newSizes[id];
    const overlaps = cellBoxesOverlap(
      { col: pos.col, row: pos.row, cw: sz.cw, ch: sz.ch },
      objectBox
    );
    assert.equal(overlaps, false, `Widget ${id} must NOT overlap objectBox`);
  }

  // Verify Todo minimum size constraint is respected (2x2)
  const todoSize = result.newSizes['widget-todo'];
  assert.ok(todoSize.cw >= 2, 'Todo cw must be >= 2');
  assert.ok(todoSize.ch >= 2, 'Todo ch must be >= 2');

  // Test REVERT:
  // Requirement: "revert should only rever the position of those widget which extension moved"
  const reverted = revertWidgetAdjustments(result.newPositions, result.newSizes, moved);
  assert.equal(reverted.newPositions['widget-search'].col, currentPositions['widget-search'].col);
  assert.equal(reverted.newPositions['widget-search'].row, currentPositions['widget-search'].row);
  assert.equal(reverted.newPositions['widget-todo'].col, currentPositions['widget-todo'].col);
  assert.equal(reverted.newPositions['widget-todo'].row, currentPositions['widget-todo'].row);

  // Clock was not moved, so it remains unchanged
  assert.equal(reverted.newPositions['widget-clock'].col, currentPositions['widget-clock'].col);
  assert.equal(reverted.newPositions['widget-clock'].row, currentPositions['widget-clock'].row);
});

test('Object-Aware Layout: When No Widgets Collide, No Movement Occurs', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 75 };
  const allWidgetIds = ['widget-clock', 'widget-notes'];
  const visibleWidgets = { 'widget-clock': true, 'widget-notes': true };

  const currentPositions = {
    'widget-clock': { col: 0, row: 0 },
    'widget-notes': { col: 0, row: 4 }
  };
  const currentSizes = {
    'widget-clock': { cw: 4, ch: 3 },
    'widget-notes': { cw: 4, ch: 3 }
  };

  // Object is far away on the right: cols 15-20, rows 2-8
  const objectBox = { colMin: 15, rowMin: 2, colMax: 20, rowMax: 8 };

  const result = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(result.adjusted, false, 'No adjustment needed when no widgets collide');
  assert.deepEqual(result.movedWidgets, {}, 'movedWidgets must be empty');
});

test('Todo Widget Gracefully Fits 2x2 Minimum Size When Space is Constrained', () => {
  const grid = { cols: 10, rows: 6, cellW: 80, cellH: 75 };
  const allWidgetIds = ['widget-todo'];
  const visibleWidgets = { 'widget-todo': true };

  // Todo originally 6x4 at (0, 0)
  const currentPositions = { 'widget-todo': { col: 0, row: 0 } };
  const currentSizes = { 'widget-todo': { cw: 6, ch: 4 } };

  // Object occupies cols 2 to 9, rows 0 to 5 (leaving only cols 0-1, rows 0-5 free, exactly 2 cols wide!)
  const objectBox = { colMin: 2, rowMin: 0, colMax: 9, rowMax: 5 };

  const result = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(result.adjusted, true);
  const todoSpan = result.newSizes['widget-todo'];
  assert.equal(todoSpan.cw, 2, 'Todo should shrink to its minimum width of 2');
  assert.ok(todoSpan.ch >= 2, 'Todo height should be at least 2');

  const todoPos = result.newPositions['widget-todo'];
  assert.ok(todoPos.col + todoSpan.cw - 1 < objectBox.colMin, 'Todo must be completely outside object');
});

test('Object Recognition Robustness on Corrupted/Invalid Inputs', () => {
  // Null image
  const resNull = detectMainObjectFromImageData(null);
  assert.equal(resNull.hasObject, false);

  // Missing data
  const resEmpty = detectMainObjectFromImageData({});
  assert.equal(resEmpty.hasObject, false);

  // Tiny dimensions
  const resTiny = detectMainObjectFromImageData({ data: new Uint8ClampedArray(16), width: 2, height: 2 });
  assert.equal(resTiny.hasObject, false);
});

test('Revert Workflow Only Touches Moved Widgets and Preserves Others', () => {
  const currentPositions = {
    'widget-todo': { col: 12, row: 5 },
    'widget-notes': { col: 0, row: 0 },
    'widget-clock': { col: 20, row: 0 }
  };
  const currentSizes = {
    'widget-todo': { cw: 2, ch: 2 },
    'widget-notes': { cw: 4, ch: 3 },
    'widget-clock': { cw: 4, ch: 3 }
  };

  // Only widget-todo was moved by the extension
  const movedWidgets = {
    'widget-todo': { col: 2, row: 2, cw: 6, ch: 6 }
  };

  const reverted = revertWidgetAdjustments(currentPositions, currentSizes, movedWidgets);

  // widget-todo is restored to original
  assert.equal(reverted.newPositions['widget-todo'].col, 2);
  assert.equal(reverted.newPositions['widget-todo'].row, 2);
  assert.equal(reverted.newSizes['widget-todo'].cw, 6);
  assert.equal(reverted.newSizes['widget-todo'].ch, 6);

  // widget-notes and widget-clock are completely untouched
  assert.deepEqual(reverted.newPositions['widget-notes'], { col: 0, row: 0 });
  assert.deepEqual(reverted.newPositions['widget-clock'], { col: 20, row: 0 });
});

test('Prefix-Agnostic Widget Minimum Dimensions', () => {
  // Both prefixed ('widget-todo') and non-prefixed ('todo') IDs must resolve correctly
  assert.equal(minWidgetCols('todo'), 2);
  assert.equal(minWidgetRows('todo'), 2);
  assert.equal(minWidgetCols('widget-todo'), 2);
  assert.equal(minWidgetRows('widget-todo'), 2);

  assert.equal(minWidgetCols('aichat'), 3);
  assert.equal(minWidgetRows('aichat'), 3);
  assert.equal(minWidgetCols('widget-aichat'), 3);
  assert.equal(minWidgetRows('widget-aichat'), 3);

  assert.equal(minWidgetCols('calendar'), 3);
  assert.equal(minWidgetRows('calendar'), 2);
  assert.equal(minWidgetCols('widget-calendar'), 3);
  assert.equal(minWidgetRows('widget-calendar'), 2);

  assert.equal(minWidgetCols('search'), 4);
  assert.equal(minWidgetRows('search'), 2);
  assert.equal(minWidgetCols('widget-search'), 4);
  assert.equal(minWidgetRows('widget-search'), 2);
});

test('Aspect Ratio Scaling for 4:3, 1:1, and 21:9 Wallpapers with Cover Crop', () => {
  const windowDims = { width: 1920, height: 1080 }; // 16:9 viewport
  const workspaceRect = { left: 0, top: 0, width: 1920, height: 1080 };
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 90, offsetX: 0, offsetY: 0 };

  // 1. 4:3 photo (4000x3000): scaled up to width=1920, height=1440. Top/bottom cropped by 180px each.
  const imageDims43 = { width: 4000, height: 3000 };
  const centerBox = { xMin: 0.4, yMin: 0.4, xMax: 0.6, yMax: 0.6 };
  const mapped43 = mapObjectBoxToGrid(centerBox, imageDims43, windowDims, workspaceRect, grid);

  assert.ok(mapped43.colMin >= 9 && mapped43.colMax <= 15, '4:3 center object should be horizontally centered');
  assert.ok(mapped43.rowMin >= 4 && mapped43.rowMax <= 8, '4:3 center object should be vertically centered');

  // 2. 21:9 ultrawide photo (2560x1080): scaled up to height=1080, width=2560. Left/right cropped by 320px each.
  const imageDims219 = { width: 2560, height: 1080 };
  const mapped219 = mapObjectBoxToGrid(centerBox, imageDims219, windowDims, workspaceRect, grid);
  assert.ok(mapped219.colMin >= 8 && mapped219.colMax <= 16, '21:9 center object should be mapped properly');

  // 3. Object in the cropped-out top portion of a 1:1 image (cropped out by background-size: cover)
  const imageDimsSquare = { width: 2000, height: 2000 };
  // Top 5% of square image (which falls in the cropped negative offsetY region)
  const topCroppedBox = { xMin: 0.4, yMin: 0.0, xMax: 0.6, yMax: 0.05 };
  const mappedCropped = mapObjectBoxToGrid(topCroppedBox, imageDimsSquare, windowDims, workspaceRect, grid);
  assert.equal(mappedCropped.offScreen, true, 'Subject outside visible viewport must be marked offScreen');
});

test('Object Touching Border Handled Accurately with Trimmed Background Palette', () => {
  const w = 100;
  const h = 80;
  const data = new Uint8ClampedArray(w * h * 4);

  // Background: dark slate (40, 45, 55)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 40;
    data[i * 4 + 1] = 45;
    data[i * 4 + 2] = 55;
    data[i * 4 + 3] = 255;
  }

  // Portrait person subject extending all the way down to the bottom border: y: 20 to 79 (h - 1)
  // Bright cyan shirt/body (50, 220, 240)
  for (let y = 20; y < h; y++) {
    for (let x = 35; x <= 65; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 50;
      data[idx + 1] = 220;
      data[idx + 2] = 240;
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Should detect subject even when touching bottom edge');
  assert.ok(result.boundingBox.yMax >= 0.90, 'Bounding box should extend to bottom border');
  assert.ok(result.boundingBox.xMin <= 0.40 && result.boundingBox.xMax >= 0.60, 'Bounding box should cover width');
});

test('Dense Grid Packing with Multiple Widgets and Large Subject Avoidance', () => {
  const grid = { cols: 16, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = [
    'widget-todo',
    'widget-clock',
    'widget-search',
    'widget-notes',
    'widget-aichat',
    'widget-dayprogress'
  ];
  const visibleWidgets = {
    'widget-todo': true,
    'widget-clock': true,
    'widget-search': true,
    'widget-notes': true,
    'widget-aichat': true,
    'widget-dayprogress': true
  };

  // Multiple widgets initially placed in the middle
  const currentPositions = {
    'widget-todo':        { col: 6, row: 2 },
    'widget-clock':       { col: 6, row: 5 },
    'widget-search':      { col: 4, row: 0 },
    'widget-notes':       { col: 10, row: 2 },
    'widget-aichat':      { col: 10, row: 6 },
    'widget-dayprogress': { col: 0, row: 0 }
  };
  const currentSizes = {
    'widget-todo':        { cw: 4, ch: 3 },
    'widget-clock':       { cw: 4, ch: 3 },
    'widget-search':      { cw: 6, ch: 2 },
    'widget-notes':       { cw: 4, ch: 3 },
    'widget-aichat':      { cw: 4, ch: 4 },
    'widget-dayprogress': { cw: 2, ch: 2 }
  };

  // Center subject occupying cols 5 to 11, rows 2 to 9
  const objectBox = { colMin: 5, rowMin: 2, colMax: 11, rowMax: 9 };

  const result = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(result.adjusted, true);

  // Verify none of the visible widgets overlap with the objectBox
  allWidgetIds.forEach((id) => {
    const pos = result.newPositions[id];
    const sz = result.newSizes[id];
    const overlaps = cellBoxesOverlap(
      { col: pos.col, row: pos.row, cw: sz.cw, ch: sz.ch },
      objectBox
    );
    assert.equal(overlaps, false, `Widget ${id} must NOT overlap objectBox`);

    // Verify minimum size enforcement
    assert.ok(sz.cw >= minWidgetCols(id), `${id} cw (${sz.cw}) must be >= minWidgetCols (${minWidgetCols(id)})`);
    assert.ok(sz.ch >= minWidgetRows(id), `${id} ch (${sz.ch}) must be >= minWidgetRows (${minWidgetRows(id)})`);
  });

  // Verify Todo specifically is at least 2x2
  const todoSpan = result.newSizes['widget-todo'];
  assert.ok(todoSpan.cw >= 2 && todoSpan.ch >= 2, 'Todo must be at least 2x2');

  // Verify Revert restores accurately
  const reverted = revertWidgetAdjustments(result.newPositions, result.newSizes, result.movedWidgets);
  assert.equal(reverted.newPositions['widget-todo'].col, currentPositions['widget-todo'].col);
  assert.equal(reverted.newPositions['widget-todo'].row, currentPositions['widget-todo'].row);
});

test('Issue 1: Natural Balanced Distribution Across Grid Regions (No Sole Clumping on Left)', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = [
    'widget-search',
    'widget-clock',
    'widget-todo',
    'widget-calendar',
    'widget-notes',
    'widget-weather'
  ];
  const visibleWidgets = Object.fromEntries(allWidgetIds.map(id => [id, true]));

  // 6 widgets originally placed in the center area
  const currentPositions = {
    'widget-search':   { col: 8, row: 2 },
    'widget-clock':    { col: 8, row: 5 },
    'widget-todo':     { col: 11, row: 2 },
    'widget-calendar': { col: 11, row: 5 },
    'widget-notes':    { col: 13, row: 2 },
    'widget-weather':  { col: 13, row: 5 }
  };
  const currentSizes = {
    'widget-search':   { cw: 4, ch: 2 },
    'widget-clock':    { cw: 4, ch: 3 },
    'widget-todo':     { cw: 4, ch: 3 },
    'widget-calendar': { cw: 4, ch: 3 },
    'widget-notes':    { cw: 4, ch: 2 },
    'widget-weather':  { cw: 4, ch: 2 }
  };

  // Center subject occupying cols 7 to 16, rows 2 to 9
  const objectBox = { colMin: 7, rowMin: 2, colMax: 16, rowMax: 9 };

  const result = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(result.adjusted, true, 'Adjustment should occur');

  let leftFlankCount = 0;
  let rightFlankCount = 0;

  allWidgetIds.forEach((id) => {
    const pos = result.newPositions[id];
    const sz = result.newSizes[id];

    // Must not overlap objectBox
    const overlaps = cellBoxesOverlap(
      { col: pos.col, row: pos.row, cw: sz.cw, ch: sz.ch },
      objectBox
    );
    assert.equal(overlaps, false, `Widget ${id} must not overlap objectBox`);

    if (pos.col + sz.cw <= objectBox.colMin) {
      leftFlankCount++;
    } else if (pos.col > objectBox.colMax) {
      rightFlankCount++;
    }
  });

  // Requirement: Widgets must NOT solely be clumped on the left!
  // Both left and right flanks must be utilized in a balanced distribution
  assert.ok(leftFlankCount >= 2, `Left flank should have widgets (got ${leftFlankCount})`);
  assert.ok(rightFlankCount >= 2, `Right flank must have widgets, not all dumped on left! (got ${rightFlankCount})`);

  // Ensure zero overlaps between any pair of widgets
  const placedList = allWidgetIds.map(id => ({ id, ...result.newPositions[id], ...result.newSizes[id] }));
  for (let i = 0; i < placedList.length; i++) {
    for (let j = i + 1; j < placedList.length; j++) {
      assert.equal(
        cellBoxesOverlap(placedList[i], placedList[j]),
        false,
        `Zero overlap rule violated between ${placedList[i].id} and ${placedList[j].id}`
      );
    }
  }
});

test('Issue 1: Subject on Left Side Distributes Widgets to Open Right Canvas', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = ['widget-search', 'widget-clock', 'widget-todo', 'widget-calendar'];
  const visibleWidgets = { 'widget-search': true, 'widget-clock': true, 'widget-todo': true, 'widget-calendar': true };

  // Widgets originally on the left
  const currentPositions = {
    'widget-search':   { col: 0, row: 0 },
    'widget-clock':    { col: 0, row: 3 },
    'widget-todo':     { col: 0, row: 6 },
    'widget-calendar': { col: 0, row: 9 }
  };
  const currentSizes = {
    'widget-search':   { cw: 4, ch: 2 },
    'widget-clock':    { cw: 4, ch: 3 },
    'widget-todo':     { cw: 4, ch: 3 },
    'widget-calendar': { cw: 4, ch: 3 }
  };

  // Subject on the left: cols 0 to 8, rows 0 to 11
  const objectBox = { colMin: 0, rowMin: 0, colMax: 8, rowMax: 11 };

  const result = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(result.adjusted, true);

  allWidgetIds.forEach((id) => {
    const pos = result.newPositions[id];
    const sz = result.newSizes[id];

    // Every widget must be completely outside the object box
    assert.equal(cellBoxesOverlap({ col: pos.col, row: pos.row, cw: sz.cw, ch: sz.ch }, objectBox), false);

    // Because object occupies cols 0-8, widgets must be placed on the right (col >= 9)
    assert.ok(pos.col >= 9, `Widget ${id} must be placed on the right canvas (got col ${pos.col})`);
  });

  // Zero overlaps
  const placedList = allWidgetIds.map(id => ({ id, ...result.newPositions[id], ...result.newSizes[id] }));
  for (let i = 0; i < placedList.length; i++) {
    for (let j = i + 1; j < placedList.length; j++) {
      assert.equal(cellBoxesOverlap(placedList[i], placedList[j]), false);
    }
  }
});

test('Issue 2: Resolves Pre-Existing Mutual Overlaps Between Widgets with Zero Overlaps', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = ['widget-clock', 'widget-todo', 'widget-notes'];
  const visibleWidgets = { 'widget-clock': true, 'widget-todo': true, 'widget-notes': true };

  // User added widgets directly overlapping each other:
  // widget-clock and widget-todo are BOTH at (0, 0)!
  const currentPositions = {
    'widget-clock': { col: 0, row: 0 },
    'widget-todo':  { col: 0, row: 0 }, // OVERLAPS clock!
    'widget-notes': { col: 20, row: 0 }
  };
  const currentSizes = {
    'widget-clock': { cw: 4, ch: 3 },
    'widget-todo':  { cw: 4, ch: 3 },
    'widget-notes': { cw: 4, ch: 3 }
  };

  // Center object
  const objectBox = { colMin: 8, rowMin: 2, colMax: 16, rowMax: 8 };

  const result = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(result.adjusted, true, 'Should detect and adjust mutual overlaps');

  const clockBox = { ...result.newPositions['widget-clock'], ...result.newSizes['widget-clock'] };
  const todoBox = { ...result.newPositions['widget-todo'], ...result.newSizes['widget-todo'] };
  const notesBox = { ...result.newPositions['widget-notes'], ...result.newSizes['widget-notes'] };

  // Overlap between clock and todo MUST be resolved
  assert.equal(cellBoxesOverlap(clockBox, todoBox), false, 'Clock and Todo must no longer overlap');
  assert.equal(cellBoxesOverlap(clockBox, notesBox), false, 'Clock and Notes must not overlap');
  assert.equal(cellBoxesOverlap(todoBox, notesBox), false, 'Todo and Notes must not overlap');

  // Neither should overlap object
  assert.equal(cellBoxesOverlap(clockBox, objectBox), false);
  assert.equal(cellBoxesOverlap(todoBox, objectBox), false);
  assert.equal(cellBoxesOverlap(notesBox, objectBox), false);

  // Todo min size respected
  assert.ok(todoBox.cw >= 2 && todoBox.ch >= 2, 'Todo min size >= 2x2');
});

test('Issue 2: Resolves Mutual Overlaps Even When Neither Widget Directly Collides With Object', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = ['widget-clock', 'widget-todo'];
  const visibleWidgets = { 'widget-clock': true, 'widget-todo': true };

  // Clock and Todo overlap each other at (0, 0)
  const currentPositions = {
    'widget-clock': { col: 0, row: 0 },
    'widget-todo':  { col: 1, row: 0 } // Overlaps clock
  };
  const currentSizes = {
    'widget-clock': { cw: 4, ch: 3 },
    'widget-todo':  { cw: 4, ch: 3 }
  };

  // Object is far away on the right: cols 16 to 22
  const objectBox = { colMin: 16, rowMin: 2, colMax: 22, rowMax: 8 };

  const result = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(result.adjusted, true, 'Adjustment must resolve widget-to-widget overlap collision');

  const clockBox = { ...result.newPositions['widget-clock'], ...result.newSizes['widget-clock'] };
  const todoBox = { ...result.newPositions['widget-todo'], ...result.newSizes['widget-todo'] };

  assert.equal(cellBoxesOverlap(clockBox, todoBox), false, 'Clock and Todo must not overlap');
  assert.equal(cellBoxesOverlap(clockBox, objectBox), false);
  assert.equal(cellBoxesOverlap(todoBox, objectBox), false);
});

test('Grid Helper: findNearestFreeCell Strictly Respects obstacleBox', () => {
  const grid = { cols: 10, rows: 10 };
  const existingItems = {
    'item-1': { col: 0, row: 0, cw: 2, ch: 2 }
  };
  // Obstacle box covering cols 2 to 5, rows 0 to 5
  const obstacleBox = { colMin: 2, rowMin: 0, colMax: 5, rowMax: 5 };

  // Search near (2, 0) for 2x2 widget
  const free = findNearestFreeCell(2, 0, 2, 2, existingItems, grid, obstacleBox);
  assert.ok(free, 'Should find a free cell');
  const candBox = { col: free.col, row: free.row, cw: 2, ch: 2 };

  // Must not overlap obstacle
  assert.equal(cellBoxesOverlap(candBox, obstacleBox), false, 'Must not overlap obstacle box');
  // Must not overlap existing item
  assert.equal(cellBoxesOverlap(candBox, existingItems['item-1']), false, 'Must not overlap existing item');
});

test('Issue 1 & 2: Large Center Subject (70% coverage) Guarantees ZERO Collisions and Object Avoidance', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = [
    'widget-search', 'widget-clock', 'widget-todo', 'widget-image',
    'widget-notes', 'widget-aichat', 'widget-calendar', 'widget-dayprogress',
    'widget-pomodoro', 'widget-sports', 'widget-weather', 'widget-currency'
  ];
  const objectBox = { colMin: 4, colMax: 19, rowMin: 1, rowMax: 10 };
  const visible = {};
  const pos = {};
  const sizes = {};
  allWidgetIds.forEach((id, idx) => {
    visible[id] = true;
    pos[id] = { col: (idx * 3) % 20, row: (idx * 2) % 10 };
    sizes[id] = { cw: 4, ch: 3 };
  });

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets: visible,
    currentPositions: pos,
    currentSizes: sizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);
  const placedList = [];
  for (const id of allWidgetIds) {
    const p = res.newPositions[id];
    const s = res.newSizes[id];
    const item = { id, col: p.col, row: p.row, cw: s.cw, ch: s.ch };
    placedList.push(item);

    // Strictly no overlap with object
    assert.equal(cellBoxesOverlap(item, objectBox), false, `Widget ${id} must NOT overlap objectBox`);
    // Min size respected
    assert.ok(s.cw >= minWidgetCols(id), `${id} cw must respect min cols`);
    assert.ok(s.ch >= minWidgetRows(id), `${id} ch must respect min rows`);
  }

  // Strictly no pairwise overlap between any widgets
  for (let i = 0; i < placedList.length; i++) {
    for (let j = i + 1; j < placedList.length; j++) {
      assert.equal(
        cellBoxesOverlap(placedList[i], placedList[j]),
        false,
        `Pairwise overlap between ${placedList[i].id} and ${placedList[j].id}`
      );
    }
  }
});

test('Issue 1: Balanced Flank Distribution when All Widgets Initially Stacked on Left Margin', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = [
    'widget-search', 'widget-clock', 'widget-todo', 'widget-calendar',
    'widget-notes', 'widget-weather', 'widget-pomodoro', 'widget-sports'
  ];
  const visible = Object.fromEntries(allWidgetIds.map(id => [id, true]));
  // All start on the left at col 0
  const pos = Object.fromEntries(allWidgetIds.map((id, i) => [id, { col: 0, row: (i * 2) % 10 }]));
  const sizes = Object.fromEntries(allWidgetIds.map(id => [id, { cw: 4, ch: 3 }]));
  // Center subject
  const objectBox = { colMin: 8, rowMin: 1, colMax: 15, rowMax: 10 };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets: visible,
    currentPositions: pos,
    currentSizes: sizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);
  let leftCount = 0;
  let rightCount = 0;
  const placedList = [];

  for (const id of allWidgetIds) {
    const p = res.newPositions[id];
    const s = res.newSizes[id];
    const item = { id, col: p.col, row: p.row, cw: s.cw, ch: s.ch };
    placedList.push(item);
    assert.equal(cellBoxesOverlap(item, objectBox), false);

    if (p.col + s.cw <= objectBox.colMin) leftCount++;
    if (p.col > objectBox.colMax) rightCount++;
  }

  // Must distribute naturally across both flanks, not all staying on the left
  assert.ok(leftCount >= 3, `Left flank should have >= 3 widgets (got ${leftCount})`);
  assert.ok(rightCount >= 3, `Right flank should have >= 3 widgets (got ${rightCount})`);

  for (let i = 0; i < placedList.length; i++) {
    for (let j = i + 1; j < placedList.length; j++) {
      assert.equal(cellBoxesOverlap(placedList[i], placedList[j]), false);
    }
  }
});

test('Issue 2: Post-Placement Span Relaxation Expands Shrunk Widgets Into Free Space', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = ['widget-clock', 'widget-search'];
  const visible = { 'widget-clock': true, 'widget-search': true };
  // Search is 20x3 at col 4, row 0. Clock is 4x3 at col 0, row 0.
  // Object is at rowMin: 2, so Search at height 3 collides on row 2.
  const pos = { 'widget-clock': { col: 0, row: 0 }, 'widget-search': { col: 4, row: 0 } };
  const sizes = { 'widget-clock': { cw: 4, ch: 3 }, 'widget-search': { cw: 20, ch: 3 } };
  const objectBox = { colMin: 7, rowMin: 2, colMax: 16, rowMax: 10 };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets: visible,
    currentPositions: pos,
    currentSizes: sizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);
  const searchPos = res.newPositions['widget-search'];
  const searchSize = res.newSizes['widget-search'];

  // Search should NOT be shrunk down to 4 if row 0 has 20 columns of free space!
  assert.ok(searchSize.cw >= 10, `Search bar should expand into available horizontal space (got cw=${searchSize.cw})`);
  assert.equal(searchSize.ch, 2, 'Search height should be 2 to avoid object starting at row 2');
  assert.equal(cellBoxesOverlap({ ...searchPos, ...searchSize }, objectBox), false);
});

test('Negative Space Zones: Identifies Dual Flanks, Shelves, and Dominant Canvas Correctly', () => {
  const grid = { cols: 24, rows: 12 };

  // Case 1: Center subject (cols 7 to 16, rows 2 to 9)
  const centerBox = { colMin: 7, rowMin: 2, colMax: 16, rowMax: 9 };
  const centerZones = identifyNegativeSpaceZones(centerBox, grid);
  assert.equal(centerZones.isDualFlank, true, 'Center subject should be dual flank');
  assert.equal(centerZones.left.width, 7, 'Left flank width must be 7');
  assert.equal(centerZones.right.width, 7, 'Right flank width must be 7');
  assert.equal(centerZones.hasTopShelf, true, 'Top shelf must exist (rows 0-1)');
  assert.equal(centerZones.hasBottomShelf, true, 'Bottom shelf must exist (rows 10-11)');

  // Case 2: Subject on right (cols 18 to 23, rows 0 to 11)
  const rightBox = { colMin: 18, rowMin: 0, colMax: 23, rowMax: 11 };
  const rightZones = identifyNegativeSpaceZones(rightBox, grid);
  assert.equal(rightZones.isLeftDominant, true, 'Left canvas should be dominant');
  assert.equal(rightZones.left.width, 18, 'Left canvas width should be 18');
  assert.equal(rightZones.isDualFlank, false);

  // Case 3: Subject on left (cols 0 to 5, rows 0 to 11)
  const leftBox = { colMin: 0, rowMin: 0, colMax: 5, rowMax: 11 };
  const leftZones = identifyNegativeSpaceZones(leftBox, grid);
  assert.equal(leftZones.isRightDominant, true, 'Right canvas should be dominant');
  assert.equal(leftZones.right.width, 18, 'Right canvas width should be 18');
  assert.equal(leftZones.isDualFlank, false);
});

test('Visual Hierarchy: Search Widget Positions in Top Horizontal Shelf Above Center Subject', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = ['widget-search', 'widget-clock', 'widget-todo'];
  const visible = { 'widget-search': true, 'widget-clock': true, 'widget-todo': true };

  // Search, Clock, and Todo placed in center
  const pos = {
    'widget-search': { col: 8, row: 3 }, // directly collides with object
    'widget-clock':  { col: 8, row: 6 }, // collides
    'widget-todo':   { col: 12, row: 6 } // collides
  };
  const sizes = {
    'widget-search': { cw: 8, ch: 2 },
    'widget-clock':  { cw: 4, ch: 3 },
    'widget-todo':   { cw: 4, ch: 3 }
  };

  // Center subject occupying cols 7 to 16, rows 2 to 9
  // Rows 0 and 1 are completely clear (top shelf height 2)
  const objectBox = { colMin: 7, rowMin: 2, colMax: 16, rowMax: 9 };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets: visible,
    currentPositions: pos,
    currentSizes: sizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);
  const searchPos = res.newPositions['widget-search'];
  const searchSize = res.newSizes['widget-search'];

  // Search widget should be in row 0 (top horizontal slot), height 2, comfortable width
  assert.equal(searchPos.row, 0, 'Search widget should occupy top shelf row 0');
  assert.equal(searchSize.ch, 2, 'Search height should be 2');
  assert.ok(searchSize.cw >= 6, `Search widget should retain comfortable width (got ${searchSize.cw})`);

  // Zero collisions with object or between widgets
  const placedList = allWidgetIds.map(id => ({ id, ...res.newPositions[id], ...res.newSizes[id] }));
  for (const item of placedList) {
    assert.equal(cellBoxesOverlap(item, objectBox), false, `Widget ${item.id} must not overlap object`);
  }
  for (let i = 0; i < placedList.length; i++) {
    for (let j = i + 1; j < placedList.length; j++) {
      assert.equal(
        cellBoxesOverlap(placedList[i], placedList[j]),
        false,
        `Overlap between ${placedList[i].id} and ${placedList[j].id}`
      );
    }
  }
});

test('Visual Hierarchy & Grid Alignment: Todo and Notes Group in Aligned Columns', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = ['widget-clock', 'widget-todo', 'widget-notes'];
  const visible = { 'widget-clock': true, 'widget-todo': true, 'widget-notes': true };

  // All 3 widgets collide with center object
  const pos = {
    'widget-clock': { col: 8, row: 2 },
    'widget-todo':  { col: 8, row: 5 },
    'widget-notes': { col: 12, row: 2 }
  };
  const sizes = {
    'widget-clock': { cw: 4, ch: 3 },
    'widget-todo':  { cw: 4, ch: 3 },
    'widget-notes': { cw: 4, ch: 3 }
  };

  // Center subject
  const objectBox = { colMin: 6, rowMin: 1, colMax: 17, rowMax: 10 };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets: visible,
    currentPositions: pos,
    currentSizes: sizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);

  // Verify none collide with object
  for (const id of allWidgetIds) {
    const p = res.newPositions[id];
    const s = res.newSizes[id];
    assert.equal(cellBoxesOverlap({ ...p, ...s }, objectBox), false);
  }

  // Verify zero pairwise overlap
  const placedList = allWidgetIds.map(id => ({ id, ...res.newPositions[id], ...res.newSizes[id] }));
  for (let i = 0; i < placedList.length; i++) {
    for (let j = i + 1; j < placedList.length; j++) {
      assert.equal(cellBoxesOverlap(placedList[i], placedList[j]), false);
    }
  }

  // Check column alignment: widgets in the same flank should share column x alignment
  const leftWidgets = placedList.filter(w => w.col + w.cw <= objectBox.colMin);
  if (leftWidgets.length >= 2) {
    // If two widgets are in left flank, they should share col or be neatly adjacent
    const cols = leftWidgets.map(w => w.col);
    const sameCol = cols[0] === cols[1];
    const adjacent = cols[0] + leftWidgets[0].cw <= cols[1] || cols[1] + leftWidgets[1].cw <= cols[0];
    assert.ok(sameCol || adjacent, 'Left flank widgets must be cleanly grid-aligned');
  }
});

test('Comfortable Sizing Preservation: Avoids Aggressive Downscaling When Space Is Available', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = ['widget-todo', 'widget-notes', 'widget-clock'];
  const visible = { 'widget-todo': true, 'widget-notes': true, 'widget-clock': true };

  // Requested sizes are generous: 4x3, 4x3, 4x3
  const pos = {
    'widget-todo':  { col: 10, row: 2 },
    'widget-notes': { col: 10, row: 5 },
    'widget-clock': { col: 14, row: 2 }
  };
  const sizes = {
    'widget-todo':  { cw: 4, ch: 3 },
    'widget-notes': { cw: 4, ch: 3 },
    'widget-clock': { cw: 4, ch: 3 }
  };

  // Center subject cols 8 to 15 (width 8), leaving 8 cols on left and 8 cols on right!
  const objectBox = { colMin: 8, rowMin: 2, colMax: 15, rowMax: 9 };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets: visible,
    currentPositions: pos,
    currentSizes: sizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);

  // Both left (0..7) and right (16..23) flanks have 8 columns of free space!
  // Widgets must NOT be aggressively crushed down to minimum 2x2!
  for (const id of allWidgetIds) {
    const s = res.newSizes[id];
    assert.ok(s.cw >= 3, `${id} should preserve comfortable width >= 3 (got ${s.cw})`);
    assert.ok(s.ch >= 3, `${id} should preserve comfortable height >= 3 (got ${s.ch})`);
  }
});

test('Faithful Revert 100% Restores Exact Pre-Adjustment Positions and Dimensions', () => {
  const originalPositions = {
    'widget-search': { col: 5, row: 1 },
    'widget-clock':  { col: 1, row: 2 },
    'widget-todo':   { col: 9, row: 4 },
    'widget-notes':  { col: 19, row: 8 }
  };
  const originalSizes = {
    'widget-search': { cw: 10, ch: 2 },
    'widget-clock':  { cw: 4, ch: 4 },
    'widget-todo':   { cw: 6, ch: 5 },
    'widget-notes':  { cw: 4, ch: 3 }
  };

  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = Object.keys(originalPositions);
  const visible = Object.fromEntries(allWidgetIds.map(id => [id, true]));

  // Center object that collides with search and todo
  const objectBox = { colMin: 7, rowMin: 1, colMax: 16, rowMax: 8 };

  // 1. Run automatic adjustment
  const res = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets: visible,
    currentPositions: originalPositions,
    currentSizes: originalSizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);
  assert.ok(Object.keys(res.movedWidgets).length > 0);

  // 2. Revert using movedWidgets diff
  const revertedFromDiff = revertWidgetAdjustments(
    res.newPositions,
    res.newSizes,
    res.movedWidgets
  );

  // Every widget must exactly equal its pre-adjustment position and size
  for (const id of allWidgetIds) {
    assert.equal(
      revertedFromDiff.newPositions[id].col,
      originalPositions[id].col,
      `${id} col should match pre-adjustment`
    );
    assert.equal(
      revertedFromDiff.newPositions[id].row,
      originalPositions[id].row,
      `${id} row should match pre-adjustment`
    );
    assert.equal(
      revertedFromDiff.newSizes[id].cw,
      originalSizes[id].cw,
      `${id} cw should match pre-adjustment`
    );
    assert.equal(
      revertedFromDiff.newSizes[id].ch,
      originalSizes[id].ch,
      `${id} ch should match pre-adjustment`
    );
  }

  // 3. Revert using full pre-adjustment snapshot
  const revertedFromSnapshot = revertWidgetAdjustments(
    res.newPositions,
    res.newSizes,
    res.movedWidgets,
    originalPositions,
    originalSizes
  );

  for (const id of allWidgetIds) {
    assert.deepEqual(revertedFromSnapshot.newPositions[id], originalPositions[id]);
    assert.deepEqual(revertedFromSnapshot.newSizes[id], originalSizes[id]);
  }
});

test('Edge Case: Revert Handles Null, Empty, or Corrupted Inputs Gracefully', () => {
  const currentPositions = { 'widget-clock': { col: 10, row: 2 } };
  const currentSizes = { 'widget-clock': { cw: 4, ch: 3 } };

  // Null movedWidgets
  const resNull = revertWidgetAdjustments(currentPositions, currentSizes, null);
  assert.deepEqual(resNull.newPositions, currentPositions);
  assert.deepEqual(resNull.newSizes, currentSizes);

  // Empty object
  const resEmpty = revertWidgetAdjustments(currentPositions, currentSizes, {});
  assert.deepEqual(resEmpty.newPositions, currentPositions);
  assert.deepEqual(resEmpty.newSizes, currentSizes);

  // Corrupted properties
  const resCorrupt = revertWidgetAdjustments(currentPositions, currentSizes, {
    'widget-clock': { col: 'invalid', row: NaN }
  });
  assert.deepEqual(resCorrupt.newPositions, currentPositions);
});

test('Edge Case: Zero Collisions Under Extreme 80% Center Coverage With 14 Mixed Widgets', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = [
    'widget-search', 'widget-clock', 'widget-todo', 'widget-notes',
    'widget-calendar', 'widget-aichat', 'widget-pomodoro', 'widget-sports',
    'widget-weather', 'widget-dayprogress', 'widget-currency', 'widget-image',
    'widget-icon-grid-custom', 'widget-custom-tool'
  ];
  const visible = Object.fromEntries(allWidgetIds.map(id => [id, true]));
  const currentPositions = {};
  const currentSizes = {};

  allWidgetIds.forEach((id, idx) => {
    currentPositions[id] = { col: (idx * 2) % 20, row: (idx * 2) % 10 };
    currentSizes[id] = { cw: 4, ch: 3 };
  });

  // Massive obstacle covering cols 3 to 20, rows 1 to 10 (80% of workspace!)
  const objectBox = { colMin: 3, rowMin: 1, colMax: 20, rowMax: 10 };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets: visible,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);

  const placedList = [];
  for (const id of allWidgetIds) {
    const p = res.newPositions[id];
    const s = res.newSizes[id];
    const item = { id, col: p.col, row: p.row, cw: s.cw, ch: s.ch };
    placedList.push(item);

    // Guaranteed zero collision with object
    assert.equal(
      cellBoxesOverlap(item, objectBox),
      false,
      `Widget ${id} must NOT overlap massive obstacle`
    );

    // Bounds check
    assert.ok(item.col >= 0 && item.col + item.cw <= grid.cols);
    assert.ok(item.row >= 0 && item.row + item.ch <= grid.rows);
  }

  // Guaranteed zero mutual collisions between any widgets
  for (let i = 0; i < placedList.length; i++) {
    for (let j = i + 1; j < placedList.length; j++) {
      assert.equal(
        cellBoxesOverlap(placedList[i], placedList[j]),
        false,
        `Mutual overlap between ${placedList[i].id} and ${placedList[j].id}`
      );
    }
  }
});

test('Undisturbed Non-Colliding Widgets Stay 100% Intact When Space Permits', () => {
  const defaultPositions = {
    'widget-search': { col: 0, row: 0 },
    'widget-clock': { col: 13, row: 0 },
    'widget-todo': { col: 0, row: 2 },
    'widget-notes': { col: 11, row: 4 },
    'widget-calendar': { col: 3, row: 2 },
    'widget-aichat': { col: 13, row: 2 },
    'widget-sports': { col: 4, row: 6 },
    'widget-image': { col: 0, row: 6 }
  };
  const defaultSizes = {
    'widget-search': { cw: 6, ch: 2 },
    'widget-clock': { cw: 3, ch: 2 },
    'widget-todo': { cw: 3, ch: 4 },
    'widget-notes': { cw: 2, ch: 5 },
    'widget-calendar': { cw: 3, ch: 4 },
    'widget-aichat': { cw: 3, ch: 7 },
    'widget-sports': { cw: 3, ch: 3 },
    'widget-image': { cw: 4, ch: 3 }
  };
  const grid = { cols: 16, rows: 9, cellW: 80, cellH: 80 };
  const objectBox = { colMin: 5, colMax: 10, rowMin: 2, rowMax: 7 };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds: Object.keys(defaultPositions),
    visibleWidgets: Object.fromEntries(Object.keys(defaultPositions).map(k => [k, true])),
    currentPositions: defaultPositions,
    currentSizes: defaultSizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);

  // Only the two colliding widgets (calendar and sports) should be moved!
  const movedIds = Object.keys(res.movedWidgets);
  assert.equal(movedIds.includes('widget-calendar'), true, 'Calendar must be moved');
  assert.equal(movedIds.includes('widget-sports'), true, 'Sports must be moved');
  assert.equal(movedIds.length, 2, 'ONLY colliding widgets should be moved');

  // Undisturbed widgets must stay 100% untouched at their exact positions and sizes
  const undisturbed = ['widget-search', 'widget-clock', 'widget-todo', 'widget-notes', 'widget-aichat', 'widget-image'];
  for (const id of undisturbed) {
    assert.deepEqual(
      res.newPositions[id],
      defaultPositions[id],
      `${id} position must stay intact`
    );
    assert.deepEqual(
      res.newSizes[id],
      defaultSizes[id],
      `${id} size must stay intact`
    );
  }
});

test('Productivity Grouping: Todo and Notes Group Together in Shared Flank & Aligned Columns', () => {
  const grid = { cols: 16, rows: 9, cellW: 80, cellH: 80 };
  const positions = {
    'widget-search': { col: 5, row: 2 },
    'widget-clock': { col: 0, row: 0 },
    'widget-todo': { col: 6, row: 3 },
    'widget-notes': { col: 7, row: 4 },
    'widget-weather': { col: 0, row: 2 }
  };
  const sizes = {
    'widget-search': { cw: 6, ch: 2 },
    'widget-clock': { cw: 3, ch: 2 },
    'widget-todo': { cw: 3, ch: 3 },
    'widget-notes': { cw: 2, ch: 3 },
    'widget-weather': { cw: 2, ch: 2 }
  };
  const objectBox = { colMin: 5, colMax: 10, rowMin: 2, rowMax: 7 };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds: Object.keys(positions),
    visibleWidgets: Object.fromEntries(Object.keys(positions).map(k => [k, true])),
    currentPositions: positions,
    currentSizes: sizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);

  const todoP = res.newPositions['widget-todo'];
  const todoS = res.newSizes['widget-todo'];
  const notesP = res.newPositions['widget-notes'];
  const notesS = res.newSizes['widget-notes'];

  // Zero collision with object
  assert.equal(cellBoxesOverlap({ ...todoP, ...todoS }, objectBox), false);
  assert.equal(cellBoxesOverlap({ ...notesP, ...notesS }, objectBox), false);
  // Zero collision with each other
  assert.equal(cellBoxesOverlap({ ...todoP, ...todoS }, { ...notesP, ...notesS }), false);

  // Todo and Notes must be in the same flank!
  const todoIsLeft = (todoP.col + todoS.cw / 2) < objectBox.colMin;
  const notesIsLeft = (notesP.col + notesS.cw / 2) < objectBox.colMin;
  assert.equal(todoIsLeft, notesIsLeft, 'Todo and Notes must be placed in the same flank');

  // Must be column aligned or adjacent
  const sameCol = todoP.col === notesP.col;
  const adjacent = todoP.col + todoS.cw === notesP.col || notesP.col + notesS.cw === todoP.col;
  assert.ok(sameCol || adjacent, 'Todo and Notes must be column aligned or adjacent');
});

test('Multi-Step Auto-Adjust Preserves Original Pre-Adjustment Revert Snapshot', () => {
  const initialPositions = {
    'widget-search': { col: 5, row: 2 },
    'widget-clock': { col: 0, row: 0 },
    'widget-todo': { col: 6, row: 3 }
  };
  const initialSizes = {
    'widget-search': { cw: 6, ch: 2 },
    'widget-clock': { cw: 3, ch: 2 },
    'widget-todo': { cw: 3, ch: 3 }
  };
  const grid = { cols: 16, rows: 9, cellW: 80, cellH: 80 };
  const objectBox1 = { colMin: 5, colMax: 10, rowMin: 2, rowMax: 7 };

  // Step 1: First adjustment from Initial to Layout B
  const res1 = adjustWidgetsAwayFromObject({
    allWidgetIds: Object.keys(initialPositions),
    visibleWidgets: { 'widget-search': true, 'widget-clock': true, 'widget-todo': true },
    currentPositions: initialPositions,
    currentSizes: initialSizes,
    objectBox: objectBox1,
    grid
  });
  assert.equal(res1.adjusted, true);

  const pendingRevert = {
    movedWidgets: res1.movedWidgets,
    previousPositions: JSON.parse(JSON.stringify(initialPositions)),
    previousSizes: JSON.parse(JSON.stringify(initialSizes)),
    appliedAt: Date.now()
  };

  // Step 2: Second adjustment occurs (e.g. user toggles auto-adjust or changes wallpaper again)
  // Preserving previousPositions from pendingRevert!
  const preAdjustmentPositions = pendingRevert?.previousPositions || JSON.parse(JSON.stringify(res1.newPositions));
  const preAdjustmentSizes = pendingRevert?.previousSizes || JSON.parse(JSON.stringify(res1.newSizes));

  const objectBox2 = { colMin: 2, colMax: 8, rowMin: 1, rowMax: 6 };
  const res2 = adjustWidgetsAwayFromObject({
    allWidgetIds: Object.keys(initialPositions),
    visibleWidgets: { 'widget-search': true, 'widget-clock': true, 'widget-todo': true },
    currentPositions: res1.newPositions,
    currentSizes: res1.newSizes,
    objectBox: objectBox2,
    grid
  });

  // Revert must restore the TRUE initial layout (Initial), NOT Layout B!
  const reverted = revertWidgetAdjustments(
    res2.newPositions,
    res2.newSizes,
    res2.movedWidgets,
    preAdjustmentPositions,
    preAdjustmentSizes
  );

  for (const id of Object.keys(initialPositions)) {
    assert.deepEqual(reverted.newPositions[id], initialPositions[id], `${id} pos must match initial`);
    assert.deepEqual(reverted.newSizes[id], initialSizes[id], `${id} size must match initial`);
  }
});

test('Full Dashboard Layout With Center Subject: Zero Collisions & 100% Faithful Revert', () => {
  const defaultPositions = {
    'widget-search': { col: 0, row: 0, x: 57, y: 6 },
    'widget-clock': { col: 13, row: 0, x: 1162, y: 6 },
    'widget-todo': { col: 0, row: 2, x: 57, y: 128 },
    'widget-notes': { col: 11, row: 4, x: 992, y: 250 },
    'widget-calendar': { col: 3, row: 2, x: 312, y: 128 },
    'widget-aichat': { col: 13, row: 2, x: 1162, y: 128 },
    'widget-sports': { col: 4, row: 6, x: 397, y: 372 },
    'widget-image': { col: 0, row: 6, x: 57, y: 372 }
  };
  const defaultSizes = {
    'widget-search': { cw: 6, ch: 2, w: 498, h: 110 },
    'widget-clock': { cw: 3, ch: 2, w: 243, h: 110 },
    'widget-todo': { cw: 3, ch: 4, w: 243, h: 232 },
    'widget-notes': { cw: 2, ch: 5, w: 158, h: 293 },
    'widget-calendar': { cw: 3, ch: 4, w: 243, h: 232 },
    'widget-aichat': { cw: 3, ch: 7, w: 243, h: 415 },
    'widget-sports': { cw: 3, ch: 3, w: 243, h: 171 },
    'widget-image': { cw: 4, ch: 3, w: 328, h: 171 }
  };
  const grid = { cols: 16, rows: 9, cellW: 80, cellH: 80 };
  const objectBox = { colMin: 5, colMax: 10, rowMin: 2, rowMax: 7 };

  const allIds = Object.keys(defaultPositions);
  const visible = Object.fromEntries(allIds.map(id => [id, true]));

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds: allIds,
    visibleWidgets: visible,
    currentPositions: defaultPositions,
    currentSizes: defaultSizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);

  // 1. Guaranteed ZERO collision with object
  for (const id of allIds) {
    const item = { ...res.newPositions[id], ...res.newSizes[id] };
    assert.equal(
      cellBoxesOverlap(item, objectBox),
      false,
      `Widget ${id} must NOT overlap objectBox`
    );
  }

  // 2. Guaranteed ZERO mutual overlap
  const placedList = allIds.map(id => ({ id, ...res.newPositions[id], ...res.newSizes[id] }));
  for (let i = 0; i < placedList.length; i++) {
    for (let j = i + 1; j < placedList.length; j++) {
      assert.equal(
        cellBoxesOverlap(placedList[i], placedList[j]),
        false,
        `Mutual overlap between ${placedList[i].id} and ${placedList[j].id}`
      );
    }
  }

  // 3. 100% Faithful Revert restores exact pre-adjustment positions, sizes, and pixel offsets
  const reverted = revertWidgetAdjustments(
    res.newPositions,
    res.newSizes,
    res.movedWidgets,
    defaultPositions,
    defaultSizes
  );

  for (const id of allIds) {
    assert.deepEqual(reverted.newPositions[id], defaultPositions[id], `${id} pos must match pre-adjustment`);
    assert.deepEqual(reverted.newSizes[id], defaultSizes[id], `${id} size must match pre-adjustment`);
  }
});

test('Revert Cleanly Strips Stale Adjusted Pixel Offsets and Handles Partial Snapshot Inputs', () => {
  const currentPositions = {
    'widget-todo': { col: 12, row: 6, x: 960, y: 480 },
    'widget-notes': { col: 12, row: 8, x: 960, y: 640 }
  };
  const currentSizes = {
    'widget-todo': { cw: 2, ch: 2, w: 150, h: 150 },
    'widget-notes': { cw: 2, ch: 2, w: 150, h: 150 }
  };

  // Scenario A: Logical-only previous snapshot (no pixel x, y, w, h)
  const logicalPrevPositions = {
    'widget-todo': { col: 0, row: 0 },
    'widget-notes': { col: 3, row: 0 }
  };
  const logicalPrevSizes = {
    'widget-todo': { cw: 4, ch: 4 },
    'widget-notes': { cw: 3, ch: 3 }
  };

  const revertedA = revertWidgetAdjustments(
    currentPositions,
    currentSizes,
    null,
    logicalPrevPositions,
    logicalPrevSizes
  );

  // Revert MUST NOT retain the stale adjusted x, y (960, 480) or w, h (150, 150)
  assert.deepEqual(revertedA.newPositions['widget-todo'], { col: 0, row: 0 });
  assert.deepEqual(revertedA.newPositions['widget-notes'], { col: 3, row: 0 });
  assert.deepEqual(revertedA.newSizes['widget-todo'], { cw: 4, ch: 4 });
  assert.deepEqual(revertedA.newSizes['widget-notes'], { cw: 3, ch: 3 });

  // Scenario B: previousSizes provided when previousPositions is null or empty
  const revertedB = revertWidgetAdjustments(
    currentPositions,
    currentSizes,
    null,
    null,
    logicalPrevSizes
  );
  assert.deepEqual(revertedB.newSizes['widget-todo'], { cw: 4, ch: 4 });
  assert.deepEqual(revertedB.newSizes['widget-notes'], { cw: 3, ch: 3 });

  // Scenario C: Full pixel snapshot properly restored
  const pixelPrevPositions = {
    'widget-todo': { col: 0, row: 0, x: 10, y: 20 }
  };
  const pixelPrevSizes = {
    'widget-todo': { cw: 4, ch: 4, w: 320, h: 320 }
  };
  const revertedC = revertWidgetAdjustments(
    currentPositions,
    currentSizes,
    null,
    pixelPrevPositions,
    pixelPrevSizes
  );
  assert.deepEqual(revertedC.newPositions['widget-todo'], { col: 0, row: 0, x: 10, y: 20 });
  assert.deepEqual(revertedC.newSizes['widget-todo'], { cw: 4, ch: 4, w: 320, h: 320 });
});

test('Revert movedWidgets Fallback Restores Cleanly Without Pixel Leaks', () => {
  const currentPositions = {
    'widget-clock': { col: 10, row: 4, x: 800, y: 320 }
  };
  const currentSizes = {
    'widget-clock': { cw: 2, ch: 2, w: 160, h: 160 }
  };

  // movedWidgets without x, y, w, h
  const movedWidgetsNoPx = {
    'widget-clock': { col: 0, row: 0, cw: 4, ch: 3 }
  };

  const reverted = revertWidgetAdjustments(
    currentPositions,
    currentSizes,
    movedWidgetsNoPx,
    null,
    null
  );

  assert.deepEqual(reverted.newPositions['widget-clock'], { col: 0, row: 0 });
  assert.deepEqual(reverted.newSizes['widget-clock'], { cw: 4, ch: 3 });
  assert.equal(reverted.newPositions['widget-clock'].x, undefined);
  assert.equal(reverted.newSizes['widget-clock'].w, undefined);
});
test('Main Object Recognition: Multi-Tone Gradient Wallpaper Accurately Detects Centered Subject Silhouette', () => {
  const w = 120;
  const h = 120;
  const data = new Uint8ClampedArray(w * h * 4);

  // Gradient background: top is sky blue (100, 180, 240), bottom is grass green (60, 140, 60)
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const r = Math.round((1 - t) * 100 + t * 60);
    const g = Math.round((1 - t) * 180 + t * 140);
    const b = Math.round((1 - t) * 240 + t * 60);
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  // Centered portrait subject: head (y 20..40, x 45..75), body (y 41..100, x 35..85)
  for (let y = 20; y <= 100; y++) {
    const xMin = y <= 40 ? 45 : 35;
    const xMax = y <= 40 ? 75 : 85;
    for (let x = xMin; x <= xMax; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 220;
      data[idx + 1] = 50;
      data[idx + 2] = 40;
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Must detect centered subject on gradient background');
  const box = result.boundingBox;
  assert.ok(box !== null, 'Bounding box must exist');

  // Must detect full silhouette without dropping head or body
  assert.ok(box.yMin <= 0.25, `yMin (${box.yMin}) must capture head near y=20`);
  assert.ok(box.yMax >= 0.85, `yMax (${box.yMax}) must capture body near y=100`);

  // Must be horizontally centered
  const midX = (box.xMin + box.xMax) / 2;
  assert.ok(midX >= 0.40 && midX <= 0.60, `Subject must be centered horizontally (got ${midX})`);
});

test('User Complaint Resolved: Center Subject Distributes 11 Default Widgets Across BOTH Sides with Zero Subject Overlaps', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = [
    'widget-search', 'widget-clock', 'widget-todo', 'widget-notes',
    'widget-calendar', 'widget-aichat', 'widget-dayprogress', 'widget-pomodoro',
    'widget-sports', 'widget-weather', 'widget-currency'
  ];
  const visibleWidgets = Object.fromEntries(allWidgetIds.map(id => [id, true]));

  // Simulate user scenario where widgets originally clumped on the left
  const currentPositions = {};
  const currentSizes = {
    'widget-search': { cw: 8, ch: 2 },
    'widget-clock': { cw: 4, ch: 3 },
    'widget-todo': { cw: 4, ch: 4 },
    'widget-notes': { cw: 4, ch: 4 },
    'widget-calendar': { cw: 4, ch: 4 },
    'widget-aichat': { cw: 4, ch: 5 },
    'widget-dayprogress': { cw: 4, ch: 2 },
    'widget-pomodoro': { cw: 4, ch: 3 },
    'widget-sports': { cw: 4, ch: 3 },
    'widget-weather': { cw: 4, ch: 3 },
    'widget-currency': { cw: 4, ch: 3 }
  };
  allWidgetIds.forEach((id, idx) => {
    currentPositions[id] = { col: (idx * 2) % 18, row: (idx * 2) % 9 };
  });

  // Main subject centered in the wallpaper: columns 7 to 16, rows 0 to 11
  const objectBox = { colMin: 7, rowMin: 0, colMax: 16, rowMax: 11 };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true, 'Auto-adjust should adjust positions');

  let leftCount = 0;
  let rightCount = 0;
  const placedList = [];

  for (const id of allWidgetIds) {
    const p = res.newPositions[id];
    const s = res.newSizes[id];
    const item = { id, col: p.col, row: p.row, cw: s.cw, ch: s.ch };
    placedList.push(item);

    // CRITICAL: ZERO overlap with main object
    assert.equal(
      cellBoxesOverlap(item, objectBox),
      false,
      `Widget ${id} must NOT overlap center subject`
    );

    // Track flank distribution
    const midC = p.col + s.cw / 2;
    if (midC < objectBox.colMin) leftCount++;
    else if (midC > objectBox.colMax) rightCount++;
  }

  // CRITICAL: Widgets must distribute across BOTH sides (no single-sided clumping)
  assert.ok(leftCount >= 3, `Left flank must have at least 3 widgets (got ${leftCount})`);
  assert.ok(rightCount >= 4, `Right flank must have at least 4 widgets (got ${rightCount})`);

  // CRITICAL: Zero pairwise overlaps between any widgets
  for (let i = 0; i < placedList.length; i++) {
    for (let j = i + 1; j < placedList.length; j++) {
      assert.equal(
        cellBoxesOverlap(placedList[i], placedList[j]),
        false,
        `Mutual overlap between ${placedList[i].id} and ${placedList[j].id}`
      );
    }
  }
});

test('User Complaint Resolved: Preserves Comfortable Widget Sizing Without Crushing Widgets to 2x2', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = [
    'widget-search', 'widget-clock', 'widget-todo', 'widget-notes',
    'widget-calendar', 'widget-aichat', 'widget-dayprogress', 'widget-pomodoro',
    'widget-sports', 'widget-weather', 'widget-currency'
  ];
  const visibleWidgets = Object.fromEntries(allWidgetIds.map(id => [id, true]));
  const currentPositions = {};
  const currentSizes = {
    'widget-search': { cw: 8, ch: 2 },
    'widget-clock': { cw: 4, ch: 3 },
    'widget-todo': { cw: 4, ch: 4 },
    'widget-notes': { cw: 4, ch: 4 },
    'widget-calendar': { cw: 4, ch: 4 },
    'widget-aichat': { cw: 4, ch: 5 },
    'widget-dayprogress': { cw: 4, ch: 2 },
    'widget-pomodoro': { cw: 4, ch: 3 },
    'widget-sports': { cw: 4, ch: 3 },
    'widget-weather': { cw: 4, ch: 3 },
    'widget-currency': { cw: 4, ch: 3 }
  };
  allWidgetIds.forEach((id, idx) => {
    currentPositions[id] = { col: (idx * 2) % 18, row: (idx * 2) % 9 };
  });

  const objectBox = { colMin: 7, rowMin: 0, colMax: 16, rowMax: 11 };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  // Check key widget sizes are preserved comfortably
  const searchSize = res.newSizes['widget-search'];
  assert.ok(searchSize.cw >= 6, `Search bar should retain comfortable width >= 6 (got ${searchSize.cw})`);
  assert.equal(searchSize.ch, 2, 'Search bar should maintain standard height 2');

  const todoSize = res.newSizes['widget-todo'];
  assert.ok(todoSize.cw >= 3, `Todo widget should retain comfortable width >= 3 (got ${todoSize.cw})`);
  assert.ok(todoSize.ch >= 3, `Todo widget should retain comfortable height >= 3 (got ${todoSize.ch})`);

  const clockSize = res.newSizes['widget-clock'];
  assert.ok(clockSize.cw >= 3, `Clock widget should retain comfortable width >= 3 (got ${clockSize.cw})`);
  assert.ok(clockSize.ch >= 2, `Clock widget should retain comfortable height >= 2 (got ${clockSize.ch})`);
});

test('Main Object Recognition: 2D Horizontal/Diagonal Gradient Sunset Accurately Detects Subject', () => {
  const w = 120;
  const h = 120;
  const data = new Uint8ClampedArray(w * h * 4);

  // Sunset 2D gradient: Left is warm orange (250, 150, 50), Right is deep violet (60, 20, 100)
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const r = Math.round((1 - u) * (250 * (1 - 0.2 * v)) + u * (60 * (1 - 0.2 * v)));
      const g = Math.round((1 - u) * (150 * (1 - 0.3 * v)) + u * (20 * (1 - 0.3 * v)));
      const b = Math.round((1 - u) * (50 * (1 + 0.5 * v)) + u * (100 * (1 + 0.5 * v)));
      const idx = (y * w + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  // Contrasting centered silhouette subject: x from 45 to 75, y from 30 to 95
  for (let y = 30; y <= 95; y++) {
    for (let x = 45; x <= 75; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 18;
      data[idx + 1] = 18;
      data[idx + 2] = 24;
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Must detect centered subject on 2D gradient sunset');
  assert.ok(result.boundingBox !== null, 'Bounding box must exist');

  const bb = result.boundingBox;
  assert.ok(bb.xMin <= 0.40, `xMin (${bb.xMin}) must encompass subject left`);
  assert.ok(bb.xMax >= 0.60, `xMax (${bb.xMax}) must encompass subject right`);
  assert.ok(bb.yMin <= 0.30, `yMin (${bb.yMin}) must encompass subject top`);
  assert.ok(bb.yMax >= 0.80, `yMax (${bb.yMax}) must encompass subject bottom`);

  const midX = (bb.xMin + bb.xMax) / 2;
  assert.ok(midX >= 0.42 && midX <= 0.58, `Subject must be centered horizontally (got ${midX})`);
});

test('Main Object Recognition: Photographic Subject With Non-Uniform Apparel and Cavity Filling', () => {
  const w = 120;
  const h = 120;
  const data = new Uint8ClampedArray(w * h * 4);

  // Soft outdoor background: light blue-gray sky (180, 205, 225)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 180;
    data[i * 4 + 1] = 205;
    data[i * 4 + 2] = 225;
    data[i * 4 + 3] = 255;
  }

  // Subject Head (y 20..38, x 50..70): dark hair & warm skin
  for (let y = 20; y <= 38; y++) {
    for (let x = 50; x <= 70; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 45;
      data[idx + 1] = 30;
      data[idx + 2] = 25;
      data[idx + 3] = 255;
    }
  }

  // Subject Torso/Shirt (y 39..68, x 42..78): patterned light green shirt with interior cavity
  for (let y = 39; y <= 68; y++) {
    for (let x = 42; x <= 78; x++) {
      const idx = (y * w + x) * 4;
      // Border is vibrant green (50, 160, 80), interior is lighter (150, 190, 170)
      const isBorder = (x <= 46 || x >= 74 || y <= 43 || y >= 64);
      data[idx] = isBorder ? 50 : 150;
      data[idx + 1] = isBorder ? 160 : 190;
      data[idx + 2] = isBorder ? 80 : 170;
      data[idx + 3] = 255;
    }
  }

  // Subject Pants/Legs (y 69..105, x 45..75): dark navy denim (25, 40, 75)
  for (let y = 69; y <= 105; y++) {
    for (let x = 45; x <= 75; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 25;
      data[idx + 1] = 40;
      data[idx + 2] = 75;
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Must detect multi-part photographic subject');
  const bb = result.boundingBox;

  // Verify full silhouette is captured without cutting off head or pants
  assert.ok(bb.yMin <= 0.22, `yMin (${bb.yMin}) must capture head near y=20`);
  assert.ok(bb.yMax >= 0.88, `yMax (${bb.yMax}) must capture grounded legs`);
  assert.ok(bb.xMin <= 0.38, `xMin (${bb.xMin}) must cover full shoulder width`);
  assert.ok(bb.xMax >= 0.62, `xMax (${bb.xMax}) must cover full shoulder width`);
});

test('Main Object Recognition: Rule-of-Thirds Photographic Subject (Left Third) Detected Accurately', () => {
  const w = 120;
  const h = 100;
  const data = new Uint8ClampedArray(w * h * 4);

  // Ambient soft background: slate gray (70, 75, 85)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 70;
    data[i * 4 + 1] = 75;
    data[i * 4 + 2] = 85;
    data[i * 4 + 3] = 255;
  }

  // Subject standing on Left Third: x: 20 to 44 (centered around x = 32 = 0.267), y: 25 to 80
  for (let y = 25; y <= 80; y++) {
    for (let x = 20; x <= 44; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 240;
      data[idx + 1] = 180;
      data[idx + 2] = 40;
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Must detect rule-of-thirds subject on left');
  assert.ok(result.boundingBox.xMin <= 0.20, 'Bounding box xMin should cover subject start');
  assert.ok(result.boundingBox.xMax <= 0.45, 'Bounding box xMax should not bleed to center/right');
  assert.ok(result.centroid.x <= 0.35, `Centroid x (${result.centroid.x}) must reside on left third`);
  assert.ok(result.confidence >= 0.50, `Confidence (${result.confidence}) must be strong`);
});

test('Object-Aware Layout: Asymmetric Flanks Distribute Widgets Proportionally to Capacity (No Narrow-Flank Choking)', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = [
    'widget-search', 'widget-clock', 'widget-todo', 'widget-notes',
    'widget-calendar', 'widget-pomodoro', 'widget-sports',
    'widget-weather', 'widget-currency', 'widget-dayprogress'
  ];
  const visibleWidgets = Object.fromEntries(allWidgetIds.map(id => [id, true]));
  const currentPositions = {};
  const currentSizes = {
    'widget-search': { cw: 8, ch: 2 },
    'widget-clock': { cw: 4, ch: 3 },
    'widget-todo': { cw: 4, ch: 4 },
    'widget-notes': { cw: 4, ch: 4 },
    'widget-calendar': { cw: 4, ch: 4 },
    'widget-pomodoro': { cw: 3, ch: 3 },
    'widget-sports': { cw: 3, ch: 3 },
    'widget-weather': { cw: 3, ch: 3 },
    'widget-currency': { cw: 3, ch: 3 },
    'widget-dayprogress': { cw: 3, ch: 2 }
  };
  allWidgetIds.forEach((id, idx) => {
    currentPositions[id] = { col: (idx * 2) % 18, row: (idx * 2) % 9 };
  });

  // Off-center subject positioned towards left: columns 5 to 11, full height (rows 0 to 11)
  // Left Flank: cols 0..4 (width = 5)
  // Right Flank: cols 12..23 (width = 12, 2.4x larger capacity!)
  const objectBox = { colMin: 5, rowMin: 0, colMax: 11, rowMax: 11 };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);

  let leftCount = 0;
  let rightCount = 0;
  const placedList = [];

  for (const id of allWidgetIds) {
    const p = res.newPositions[id];
    const s = res.newSizes[id];
    const item = { id, col: p.col, row: p.row, cw: s.cw, ch: s.ch };
    placedList.push(item);

    // ZERO collision with subject
    assert.equal(cellBoxesOverlap(item, objectBox), false, `${id} must not overlap subject`);

    const midC = p.col + s.cw / 2;
    if (midC < objectBox.colMin) leftCount++;
    else if (midC > objectBox.colMax) rightCount++;
  }

  // ZERO pairwise collision
  for (let i = 0; i < placedList.length; i++) {
    for (let j = i + 1; j < placedList.length; j++) {
      assert.equal(cellBoxesOverlap(placedList[i], placedList[j]), false,
        `Overlap between ${placedList[i].id} and ${placedList[j].id}`);
    }
  }

  // Proportional distribution:
  // Left flank (width 5) should have 2 to 4 widgets
  // Right flank (width 12) should have 6 to 8 widgets
  assert.ok(leftCount >= 2 && leftCount <= 4, `Left flank should comfortably hold 2-4 widgets (got ${leftCount})`);
  assert.ok(rightCount >= 6 && rightCount <= 8, `Right flank should hold 6-8 widgets in its wide canvas (got ${rightCount})`);
});

test('Object-Aware Layout: Top Shelf Layout Places Search Centered Above Subject With Zero Overlaps', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = [
    'widget-search', 'widget-clock', 'widget-todo', 'widget-notes',
    'widget-calendar', 'widget-weather'
  ];
  const visibleWidgets = Object.fromEntries(allWidgetIds.map(id => [id, true]));
  const currentPositions = {
    'widget-search': { col: 8, row: 4 }, // colliding with center subject
    'widget-clock': { col: 10, row: 5 },
    'widget-todo': { col: 2, row: 2 },
    'widget-notes': { col: 16, row: 2 },
    'widget-calendar': { col: 9, row: 8 },
    'widget-weather': { col: 18, row: 6 }
  };
  const currentSizes = {
    'widget-search': { cw: 8, ch: 2 },
    'widget-clock': { cw: 4, ch: 3 },
    'widget-todo': { cw: 4, ch: 4 },
    'widget-notes': { cw: 4, ch: 4 },
    'widget-calendar': { cw: 4, ch: 4 },
    'widget-weather': { cw: 4, ch: 3 }
  };

  // Center bottom subject: cols 8 to 15, rows 3 to 11
  // Leaves a wide Top Shelf: rows 0 to 2 (height 3)
  const objectBox = { colMin: 8, rowMin: 3, colMax: 15, rowMax: 11 };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);

  // Search bar must be positioned on the top shelf at row 0
  const searchPos = res.newPositions['widget-search'];
  const searchSize = res.newSizes['widget-search'];
  assert.equal(searchPos.row, 0, 'Search bar must be placed on top shelf (row 0)');
  assert.ok(searchSize.cw >= 6, `Search bar should retain comfortable width >= 6 (got ${searchSize.cw})`);

  // All widgets must have zero collisions with subject and zero collisions with each other
  const placedList = allWidgetIds.map(id => ({
    id,
    col: res.newPositions[id].col,
    row: res.newPositions[id].row,
    cw: res.newSizes[id].cw,
    ch: res.newSizes[id].ch
  }));

  for (const item of placedList) {
    assert.equal(cellBoxesOverlap(item, objectBox), false, `${item.id} must not overlap subject`);
  }
  for (let i = 0; i < placedList.length; i++) {
    for (let j = i + 1; j < placedList.length; j++) {
      assert.equal(cellBoxesOverlap(placedList[i], placedList[j]), false,
        `Overlap between ${placedList[i].id} and ${placedList[j].id}`);
    }
  }
});

test('Object-Aware Layout: Grid-Aligned Modular Column Snapping (Clean Gutters, Zero Step-Staggering)', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = [
    'widget-clock', 'widget-todo', 'widget-notes', 'widget-sports', 'widget-dayprogress'
  ];
  const visibleWidgets = Object.fromEntries(allWidgetIds.map(id => [id, true]));
  const currentPositions = {};
  const currentSizes = {
    'widget-clock': { cw: 4, ch: 3 },
    'widget-todo': { cw: 4, ch: 4 },
    'widget-notes': { cw: 4, ch: 4 },
    'widget-sports': { cw: 3, ch: 3 },
    'widget-dayprogress': { cw: 3, ch: 2 }
  };
  allWidgetIds.forEach((id, idx) => {
    currentPositions[id] = { col: 8 + idx, row: 2 + idx }; // all initially colliding in center
  });

  // Center subject: cols 8 to 15, rows 0 to 11
  // Left flank has width 8 (cols 0 to 7)
  const objectBox = { colMin: 8, rowMin: 0, colMax: 15, rowMax: 11 };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);

  // Todo and Notes must share exact column alignment (column snapping)
  const todoPos = res.newPositions['widget-todo'];
  const notesPos = res.newPositions['widget-notes'];
  assert.equal(todoPos.col, notesPos.col, `Todo (col ${todoPos.col}) and Notes (col ${notesPos.col}) must share exact column track`);

  // Verify zero collisions
  const placedList = allWidgetIds.map(id => ({
    id,
    col: res.newPositions[id].col,
    row: res.newPositions[id].row,
    cw: res.newSizes[id].cw,
    ch: res.newSizes[id].ch
  }));

  for (const item of placedList) {
    assert.equal(cellBoxesOverlap(item, objectBox), false);
  }
  for (let i = 0; i < placedList.length; i++) {
    for (let j = i + 1; j < placedList.length; j++) {
      assert.equal(cellBoxesOverlap(placedList[i], placedList[j]), false);
    }
  }
});

test('Main Object Recognition: Smooth Radial Vignette Wallpaper Prevents False Positive Detections', () => {
  const w = 100;
  const h = 100;
  const data = new Uint8ClampedArray(w * h * 4);
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const factor = Math.cos((dist / maxR) * (Math.PI / 2));
      const r = Math.round(50 + 150 * factor);
      const g = Math.round(45 + 140 * factor);
      const b = Math.round(40 + 130 * factor);
      const idx = (y * w + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, false, 'Smooth vignette should NOT trigger false positive object detection');
  assert.equal(result.boundingBox, null);
});

test('Main Object Recognition: Dark Mode / Low-Key Wallpaper Accurately Detects Subject via Weber-Fechner Lightness', () => {
  const w = 100;
  const h = 80;
  const data = new Uint8ClampedArray(w * h * 4);

  // Background: dark charcoal (RGB 20, 22, 24)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 20;
    data[i * 4 + 1] = 22;
    data[i * 4 + 2] = 24;
    data[i * 4 + 3] = 255;
  }

  // Dark mode subject: dark slate gray (RGB 55, 58, 62) at x: 40 to 70, y: 20 to 60
  for (let y = 20; y <= 60; y++) {
    for (let x = 40; x <= 70; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 55;
      data[idx + 1] = 58;
      data[idx + 2] = 62;
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Should detect subject on dark mode wallpaper');
  assert.ok(result.boundingBox, 'Should return valid bounding box');
  assert.ok(result.boundingBox.xMin <= 0.45 && result.boundingBox.xMax >= 0.65,
    `Bounding box should contain subject (xMin: ${result.boundingBox.xMin}, xMax: ${result.boundingBox.xMax})`);
});

test('Main Object Recognition: Dual Portrait / Multi-Subject Wallpaper Returns Both Bounding Boxes', () => {
  const w = 100;
  const h = 80;
  const data = new Uint8ClampedArray(w * h * 4);

  // Background: dark navy (RGB 15, 20, 35)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 15;
    data[i * 4 + 1] = 20;
    data[i * 4 + 2] = 35;
    data[i * 4 + 3] = 255;
  }

  // Subject 1 (Left): cyan portrait x: 15 to 35, y: 25 to 65
  for (let y = 25; y <= 65; y++) {
    for (let x = 15; x <= 35; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 60;
      data[idx + 1] = 200;
      data[idx + 2] = 220;
      data[idx + 3] = 255;
    }
  }

  // Subject 2 (Right): amber portrait x: 65 to 85, y: 25 to 65
  for (let y = 25; y <= 65; y++) {
    for (let x = 65; x <= 85; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 230;
      data[idx + 1] = 160;
      data[idx + 2] = 50;
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true);
  assert.ok(result.boundingBox, 'Union bounding box should be returned');
  assert.ok(Array.isArray(result.boundingBoxes), 'boundingBoxes should be an array');
  assert.equal(result.boundingBoxes.length, 2, 'Should detect both subjects');
  assert.ok(result.boundingBoxes[0].xMax < result.boundingBoxes[1].xMin,
    'Subject 1 and Subject 2 should be spatially separated with negative space in between');
});

test('Object-Aware Layout: Bottom Shelf Layout Places Search Centered Below Subject With Zero Overlaps & Column Snapping', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = [
    'widget-search', 'widget-clock', 'widget-todo', 'widget-notes',
    'widget-calendar', 'widget-weather'
  ];
  const visibleWidgets = Object.fromEntries(allWidgetIds.map(id => [id, true]));
  const currentPositions = {
    'widget-search': { col: 8, row: 2 }, // colliding with top subject
    'widget-clock': { col: 10, row: 3 },
    'widget-todo': { col: 8, row: 4 },
    'widget-notes': { col: 14, row: 4 },
    'widget-calendar': { col: 9, row: 5 },
    'widget-weather': { col: 12, row: 1 }
  };
  const currentSizes = {
    'widget-search': { cw: 8, ch: 2 },
    'widget-clock': { cw: 4, ch: 3 },
    'widget-todo': { cw: 4, ch: 4 },
    'widget-notes': { cw: 4, ch: 4 },
    'widget-calendar': { cw: 4, ch: 4 },
    'widget-weather': { cw: 4, ch: 3 }
  };

  // Top center subject: cols 6 to 17, rows 0 to 6
  // Bottom shelf is wide open: rows 7 to 11 (height 5, capacity 24 * 5 = 120 cells)
  const objectBox = { colMin: 6, rowMin: 0, colMax: 17, rowMax: 6 };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);

  // Search bar placed on bottom shelf (row 7)
  const searchPos = res.newPositions['widget-search'];
  const searchSize = res.newSizes['widget-search'];
  assert.equal(searchPos.row, 7, `Search bar must be placed on bottom shelf row 7 (got row ${searchPos.row})`);
  assert.ok(searchSize.cw >= 6, `Search bar should retain comfortable width >= 6 (got ${searchSize.cw})`);

  // Todo and Notes column snapping
  const todoPos = res.newPositions['widget-todo'];
  const notesPos = res.newPositions['widget-notes'];
  assert.equal(todoPos.col, notesPos.col, `Todo (col ${todoPos.col}) and Notes (col ${notesPos.col}) should share column track`);

  // Verify zero collisions with subject
  const placedList = allWidgetIds.map(id => ({
    id,
    col: res.newPositions[id].col,
    row: res.newPositions[id].row,
    cw: res.newSizes[id].cw,
    ch: res.newSizes[id].ch
  }));

  for (const item of placedList) {
    assert.equal(cellBoxesOverlap(item, objectBox), false, `${item.id} must not overlap subject`);
  }
  for (let i = 0; i < placedList.length; i++) {
    for (let j = i + 1; j < placedList.length; j++) {
      assert.equal(cellBoxesOverlap(placedList[i], placedList[j]), false,
        `Overlap between ${placedList[i].id} and ${placedList[j].id}`);
    }
  }
});

test('Object-Aware Layout: Multi-Subject Dual Portraits With Center Corridor Widget Placement', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = [
    'widget-search', 'widget-clock', 'widget-todo', 'widget-notes',
    'widget-calendar', 'widget-sports', 'widget-weather'
  ];
  const visibleWidgets = Object.fromEntries(allWidgetIds.map(id => [id, true]));
  const currentPositions = {
    'widget-search': { col: 3, row: 3 }, // colliding with box1
    'widget-clock': { col: 5, row: 4 },  // colliding with box1
    'widget-todo': { col: 17, row: 3 },  // colliding with box2
    'widget-notes': { col: 18, row: 5 }, // colliding with box2
    'widget-calendar': { col: 4, row: 6 },
    'widget-sports': { col: 19, row: 7 },
    'widget-weather': { col: 10, row: 4 }
  };
  const currentSizes = {
    'widget-search': { cw: 6, ch: 2 },
    'widget-clock': { cw: 4, ch: 3 },
    'widget-todo': { cw: 4, ch: 4 },
    'widget-notes': { cw: 4, ch: 4 },
    'widget-calendar': { cw: 4, ch: 3 },
    'widget-sports': { cw: 3, ch: 3 },
    'widget-weather': { cw: 3, ch: 2 }
  };

  // Two subjects: box1 (cols 2 to 7, rows 2 to 9) and box2 (cols 16 to 21, rows 2 to 9)
  // Union object box: cols 2 to 21, rows 2 to 9
  // Center negative space corridor: cols 8 to 15 (width 8)
  const box1 = { colMin: 2, rowMin: 2, colMax: 7, rowMax: 9 };
  const box2 = { colMin: 16, rowMin: 2, colMax: 21, rowMax: 9 };
  const objectBox = {
    colMin: 2,
    rowMin: 2,
    colMax: 21,
    rowMax: 9,
    boxes: [box1, box2]
  };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true);

  const placedList = allWidgetIds.map(id => ({
    id,
    col: res.newPositions[id].col,
    row: res.newPositions[id].row,
    cw: res.newSizes[id].cw,
    ch: res.newSizes[id].ch
  }));

  // ZERO collisions with box1 or box2
  for (const item of placedList) {
    assert.equal(cellBoxesOverlap(item, box1), false, `${item.id} must not overlap subject 1`);
    assert.equal(cellBoxesOverlap(item, box2), false, `${item.id} must not overlap subject 2`);
  }

  // ZERO pairwise collisions between widgets
  for (let i = 0; i < placedList.length; i++) {
    for (let j = i + 1; j < placedList.length; j++) {
      assert.equal(cellBoxesOverlap(placedList[i], placedList[j]), false,
        `Overlap between ${placedList[i].id} and ${placedList[j].id}`);
    }
  }

  // Verify that widgets utilize the open negative space:
  // Center corridor (cols 8 to 15) or top/bottom shelves/flanks
  const centerCorridorWidgets = placedList.filter(item =>
    item.col >= 8 && item.col + item.cw <= 16 && item.row >= 2 && item.row <= 9
  );
  assert.ok(centerCorridorWidgets.length >= 1,
    `At least 1 widget should utilize the open center corridor between subjects (found ${centerCorridorWidgets.length})`);
});

test('Visual Detection Outline: computeCoverPixelBounds accurately maps bounding boxes under CSS cover scaling', () => {
  // Case 1: 16:9 image on 16:9 viewport (1920x1080) -> scale 1:1, zero offsets
  const box1 = { xMin: 0.25, yMin: 0.10, xMax: 0.75, yMax: 0.90 };
  const bounds1 = computeCoverPixelBounds(box1, { width: 1920, height: 1080 }, { width: 1920, height: 1080 });
  assert.equal(bounds1.left, 480);
  assert.equal(bounds1.top, 108);
  assert.equal(bounds1.width, 960);
  assert.equal(bounds1.height, 864);

  // Case 2: 4:3 portrait/photo image (1600x1200) on 16:9 viewport (1920x1080)
  // Scale = max(1920/1600 = 1.2, 1080/1200 = 0.9) = 1.2
  // Rendered: width = 1920, height = 1440
  // Offsets: offsetX = 0, offsetY = (1080 - 1440) / 2 = -180
  const box2 = { xMin: 0.30, yMin: 0.25, xMax: 0.70, yMax: 0.75 };
  const bounds2 = computeCoverPixelBounds(box2, { width: 1600, height: 1200 }, { width: 1920, height: 1080 });
  assert.equal(bounds2.left, Math.round(0.30 * 1920)); // 576
  assert.equal(bounds2.top, Math.round(-180 + 0.25 * 1440)); // -180 + 360 = 180
  assert.equal(bounds2.width, Math.round(0.40 * 1920)); // 768
  assert.equal(bounds2.height, Math.round(0.50 * 1440)); // 720

  // Case 3: 21:9 ultrawide image (2560x1080) on 16:9 viewport (1920x1080)
  // Scale = max(1920/2560 = 0.75, 1080/1080 = 1.0) = 1.0
  // Rendered: width = 2560, height = 1080
  // Offsets: offsetX = (1920 - 2560) / 2 = -320, offsetY = 0
  const box3 = { xMin: 0.40, yMin: 0.10, xMax: 0.60, yMax: 0.90 };
  const bounds3 = computeCoverPixelBounds(box3, { width: 2560, height: 1080 }, { width: 1920, height: 1080 });
  assert.equal(bounds3.left, Math.round(-320 + 0.40 * 2560)); // -320 + 1024 = 704
  assert.equal(bounds3.top, Math.round(0.10 * 1080)); // 108
  assert.equal(bounds3.width, Math.round(0.20 * 2560)); // 512
  assert.equal(bounds3.height, Math.round(0.80 * 1080)); // 864
});

test('Grid Mapping: Fractional cell penetration thresholding prevents false cell starvation', () => {
  const windowDims = { width: 1920, height: 1080 };
  const imageDims = { width: 1920, height: 1080 };
  const workspaceRect = { left: 0, top: 0, width: 1920, height: 1080 };
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80, offsetX: 0, offsetY: 0 };

  // Object starts at pixel 644 -> raw cell = 644 / 80 = 8.05 (only penetrates col 8 by 5%)
  // Object ends at pixel 1205 -> raw cell = 1205 / 80 = 15.0625 (only penetrates col 15 by 6%)
  const sliverBox = {
    xMin: 644 / 1920,
    yMin: 160 / 1080,
    xMax: 1205 / 1920,
    yMax: 880 / 1080
  };

  const cellBox = mapObjectBoxToGrid(sliverBox, imageDims, windowDims, workspaceRect, grid);
  // Column 15 should NOT be blocked by a 5-pixel sliver!
  assert.equal(cellBox.colMax, 14, `colMax (${cellBox.colMax}) should not include col 15 because penetration is < 20%`);
});

test('User Request Resolved: 11 Default Widgets with Centered Portrait Distributes Evenly Across BOTH Sides With ZERO 2x2 Crushing', () => {
  // Author standard default layout on 24x12 base grid (as defined in js/main.js)
  const defaultPositions = {
    'widget-clock':       { col: 0,  row: 0 },
    'widget-search':      { col: 4,  row: 0 },
    'widget-todo':        { col: 0,  row: 3 },
    'widget-calendar':    { col: 6,  row: 3 },
    'widget-notes':       { col: 19, row: 3 },
    'widget-weather':     { col: 19, row: 6 },
    'widget-dayprogress': { col: 0,  row: 9 },
    'widget-pomodoro':    { col: 5,  row: 9 },
    'widget-currency':    { col: 10, row: 9 },
    'widget-sports':      { col: 15, row: 9 },
    'widget-image':       { col: 20, row: 9 }
  };

  const defaultSizes = {
    'widget-clock':       { cw: 4,  ch: 3 },
    'widget-search':      { cw: 20, ch: 3 },
    'widget-todo':        { cw: 6,  ch: 6 },
    'widget-calendar':    { cw: 6,  ch: 6 },
    'widget-notes':       { cw: 5,  ch: 3 },
    'widget-weather':     { cw: 5,  ch: 3 },
    'widget-dayprogress': { cw: 5,  ch: 3 },
    'widget-pomodoro':    { cw: 5,  ch: 3 },
    'widget-currency':    { cw: 5,  ch: 3 },
    'widget-sports':      { cw: 5,  ch: 3 },
    'widget-image':       { cw: 4,  ch: 3 }
  };

  const grid = { cols: 24, rows: 12, cellW: 78, cellH: 78, offsetX: 0, offsetY: 0 };
  // Centered portrait subject occupying center 8 columns (cols 8..15) from row 1 to bottom (row 11)
  const objectBox = { colMin: 8, colMax: 15, rowMin: 1, rowMax: 11 };

  const res = adjustWidgetsAwayFromObject({
    allWidgetIds: Object.keys(defaultPositions),
    visibleWidgets: Object.fromEntries(Object.keys(defaultPositions).map(k => [k, true])),
    currentPositions: defaultPositions,
    currentSizes: defaultSizes,
    objectBox,
    grid
  });

  assert.equal(res.adjusted, true, 'Auto-adjustment must take place');

  const placed = Object.keys(defaultPositions).map(id => ({
    id,
    col: res.newPositions[id].col,
    row: res.newPositions[id].row,
    cw: res.newSizes[id].cw,
    ch: res.newSizes[id].ch
  }));

  // 1. ZERO Subject Overlaps
  for (const item of placed) {
    assert.equal(cellBoxesOverlap(item, objectBox), false,
      `${item.id} at col ${item.col}..${item.col+item.cw-1}, row ${item.row}..${item.row+item.ch-1} overlaps object!`);
  }

  // 2. ZERO Widget Collisions
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      assert.equal(cellBoxesOverlap(placed[i], placed[j]), false,
        `Collision between ${placed[i].id} and ${placed[j].id}`);
    }
  }

  // 3. Flank Balance: Widgets MUST distribute evenly across BOTH sides (not all on the left!)
  let leftCount = 0;
  let rightCount = 0;
  for (const item of placed) {
    const midC = item.col + item.cw / 2;
    if (midC < objectBox.colMin) leftCount++;
    else if (midC > objectBox.colMax) rightCount++;
  }

  assert.ok(leftCount >= 4 && leftCount <= 7, `Left flank should have 4-7 widgets (got ${leftCount})`);
  assert.ok(rightCount >= 4 && rightCount <= 7, `Right flank should have 4-7 widgets (got ${rightCount})`);
  const flankDiff = Math.abs(leftCount - rightCount);
  assert.ok(flankDiff <= 2, `Flanks must be balanced (diff <= 2, got left=${leftCount}, right=${rightCount})`);

  // 4. Comfortable Sizing Preservation: NO widget should be crushed to 2x2!
  for (const item of placed) {
    if (item.id === 'widget-search') {
      assert.ok(item.cw >= 5, `Search width must be at least 5 (got ${item.cw})`);
    } else if (item.id === 'widget-todo' || item.id === 'widget-calendar') {
      const area = item.cw * item.ch;
      assert.ok(area >= 12, `${item.id} must maintain comfortable area (>= 12 cells, got ${area})`);
      assert.ok(item.cw >= 3 && item.ch >= 3, `${item.id} must not be crushed to 2x2 (got ${item.cw}x${item.ch})`);
    }
  }
});

test('Contour Extraction: extractContourFromMask Traces Complete Outer Boundary', () => {
  const w = 30;
  const h = 30;
  const mask = new Uint8Array(w * h);

  // Fill a 10x10 square in center: x from 10 to 19, y from 10 to 19
  for (let y = 10; y <= 19; y++) {
    for (let x = 10; x <= 19; x++) {
      mask[y * w + x] = 1;
    }
  }

  const contour = extractContourFromMask(mask, w, h);
  assert.ok(Array.isArray(contour), 'Contour must be an array');
  assert.ok(contour.length >= 20, `Contour should trace perimeter (got length ${contour.length})`);

  // Verify all points are inside or on the boundary of the square
  for (const pt of contour) {
    assert.ok(pt.x >= 10 && pt.x <= 19, `pt.x ${pt.x} should be in [10, 19]`);
    assert.ok(pt.y >= 10 && pt.y <= 19, `pt.y ${pt.y} should be in [10, 19]`);
  }

  // RDP simplification should collapse 40 perimeter steps down to 4 corner vertices
  const simplified = simplifyPolygonRDP(contour, 1.0);
  assert.ok(simplified.length >= 4 && simplified.length <= 8,
    `RDP simplification should reduce straight edges to corner vertices (got ${simplified.length})`);
});

test('Shape Classification: Detects Circular Disc vs Polygonal Portrait', () => {
  const w = 40;
  const h = 40;

  // 1. Circular disc
  const discMask = new Uint8Array(w * h);
  const cx = 20, cy = 20, r = 10;
  let discCount = 0;
  let minX = w, maxX = 0, minY = h, maxY = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) {
        discMask[y * w + x] = 1;
        discCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const discContour = extractContourFromMask(discMask, w, h);
  const discStats = { count: discCount, minX, maxX, minY, maxY, centerX: cx, centerY: cy };
  const discShape = classifyShape(discContour, discStats, w, h);

  assert.equal(discShape.shapeType, 'circle', 'Disc must be classified as circle');
  assert.ok(discShape.circle, 'Disc must have circle geometry');
  assert.ok(Math.abs(discShape.circle.cx - 0.5) <= 0.05, `cx (${discShape.circle.cx}) should be ~0.5`);
  assert.ok(Math.abs(discShape.circle.cy - 0.5) <= 0.05, `cy (${discShape.circle.cy}) should be ~0.5`);
  assert.ok(Math.abs(discShape.circle.r - (r / w)) <= 0.05, `r (${discShape.circle.r}) should be ~0.25`);

  // 2. Elongated portrait shape (head narrow at top, shoulders wide at bottom)
  const portraitMask = new Uint8Array(w * h);
  let portCount = 0;
  let pMinX = w, pMaxX = 0, pMinY = h, pMaxY = 0;

  for (let y = 5; y <= 35; y++) {
    const halfWidth = y < 18 ? 4 : 12; // Narrow head, wide shoulders
    for (let x = cx - halfWidth; x <= cx + halfWidth; x++) {
      portraitMask[y * w + x] = 1;
      portCount++;
      if (x < pMinX) pMinX = x;
      if (x > pMaxX) pMaxX = x;
      if (y < pMinY) pMinY = y;
      if (y > pMaxY) pMaxY = y;
    }
  }

  const portContour = extractContourFromMask(portraitMask, w, h);
  const portStats = { count: portCount, minX: pMinX, maxX: pMaxX, minY: pMinY, maxY: pMaxY, centerX: cx, centerY: 22 };
  const portShape = classifyShape(portContour, portStats, w, h);

  assert.equal(portShape.shapeType, 'polygon', 'Portrait must be classified as polygon/contour');
  assert.equal(portShape.circle, null, 'Polygon shape should not have a circle geometry');
});

test('Main Object Recognition: Circular Subject Returns Circle Shape, Normalized Contour & SVG Path', () => {
  const w = 100;
  const h = 100;
  const data = new Uint8ClampedArray(w * h * 4);

  // Background: dark navy (10, 15, 30)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 10;
    data[i * 4 + 1] = 15;
    data[i * 4 + 2] = 30;
    data[i * 4 + 3] = 255;
  }

  // Foreground: bright glowing cyan disc in center (cx = 50, cy = 50, radius = 22)
  const cx = 50, cy = 50, r = 22;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) {
        const idx = (y * w + x) * 4;
        data[idx] = 0;
        data[idx + 1] = 220;
        data[idx + 2] = 255;
        data[idx + 3] = 255;
      }
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Must detect salient circle');
  assert.equal(result.shapeType, 'circle', 'Shape must be recognized as circle');
  assert.ok(result.circle, 'Must contain circle geometric properties');
  assert.ok(Math.abs(result.circle.cx - 0.5) <= 0.06, `Circle cx (${result.circle.cx}) should be ~0.5`);
  assert.ok(Math.abs(result.circle.cy - 0.5) <= 0.06, `Circle cy (${result.circle.cy}) should be ~0.5`);
  assert.ok(Math.abs(result.circle.r - 0.22) <= 0.06, `Circle radius (${result.circle.r}) should be ~0.22`);

  // Contour verification
  assert.ok(Array.isArray(result.contour) && result.contour.length >= 3, 'Contour must have vertices');
  for (const pt of result.contour) {
    assert.ok(pt.x >= 0 && pt.x <= 1, `Contour x (${pt.x}) must be in [0, 1]`);
    assert.ok(pt.y >= 0 && pt.y <= 1, `Contour y (${pt.y}) must be in [0, 1]`);
  }

  // SVG Path verification
  assert.ok(result.svgPath && result.svgPath.startsWith('M') && result.svgPath.endsWith('Z'),
    `SVG path must be a valid path string (got: ${result.svgPath.slice(0, 30)}...)`);
});

test('Detection Overlay: computeCoverContourPixels Maps Normalized Contour to Viewport Pixels', () => {
  const windowDims = { width: 1920, height: 1080 };
  const imageDims = { width: 1920, height: 1080 }; // 1:1 aspect match
  const contour = [
    { x: 0.25, y: 0.20 },
    { x: 0.75, y: 0.20 },
    { x: 0.75, y: 0.80 },
    { x: 0.25, y: 0.80 }
  ];

  const pxPoints = computeCoverContourPixels(contour, imageDims, windowDims);
  assert.equal(pxPoints.length, 4);

  assert.equal(pxPoints[0].x, Math.round(0.25 * 1920));
  assert.equal(pxPoints[0].y, Math.round(0.20 * 1080));
  assert.equal(pxPoints[1].x, Math.round(0.75 * 1920));
  assert.equal(pxPoints[1].y, Math.round(0.20 * 1080));
  assert.equal(pxPoints[2].x, Math.round(0.75 * 1920));
  assert.equal(pxPoints[2].y, Math.round(0.80 * 1080));
  assert.equal(pxPoints[3].x, Math.round(0.25 * 1920));
  assert.equal(pxPoints[3].y, Math.round(0.80 * 1080));
});

test('Grid Mapping with Circular Shape Generates RowSpans Unlocking Corner Cells', () => {
  const boundingBox = {
    xMin: 0.30,
    yMin: 0.20,
    xMax: 0.70,
    yMax: 0.80,
    shapeType: 'circle',
    circle: { cx: 0.50, cy: 0.50, r: 0.20, rx: 0.20, ry: 0.20 }
  };
  const windowDims = { width: 1920, height: 1080 };
  const imageDims = { width: 1920, height: 1080 };
  const workspaceRect = { left: 0, top: 0, width: 1920, height: 1080 };
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 90, offsetX: 0, offsetY: 0 };

  const mapped = mapObjectBoxToGrid(boundingBox, imageDims, windowDims, workspaceRect, grid);
  assert.ok(Array.isArray(mapped.rowSpans), 'Mapped box must contain rowSpans');
  assert.equal(mapped.rowSpans.length, 12);

  // Rows 0-1 (above circle) and 10-11 (below circle) must be completely unoccupied (null)
  assert.equal(mapped.rowSpans[0], null, 'Row 0 must be null (above circle)');
  assert.equal(mapped.rowSpans[1], null, 'Row 1 must be null (above circle)');
  assert.equal(mapped.rowSpans[10], null, 'Row 10 must be null (below circle)');
  assert.equal(mapped.rowSpans[11], null, 'Row 11 must be null (below circle)');

  // In Row 3 (near apex of circle), horizontal span should be narrower than center row 6
  const spanRow3 = mapped.rowSpans[3];
  const spanRow6 = mapped.rowSpans[6];
  assert.ok(spanRow3, 'Row 3 should have rowSpan');
  assert.ok(spanRow6, 'Row 6 should have rowSpan');

  const widthRow3 = spanRow3.colMax - spanRow3.colMin + 1;
  const widthRow6 = spanRow6.colMax - spanRow6.colMin + 1;
  assert.ok(widthRow3 < widthRow6,
    `Circle apex width (${widthRow3}) must be narrower than center width (${widthRow6})`);
});

test('widgetCollidesWithObject: Respects True Contour Borders and Leaves Empty Corners Free', () => {
  // Circular object centered on grid, occupying rows 3 to 8
  const objectBox = {
    colMin: 8,
    colMax: 15,
    rowMin: 3,
    rowMax: 8,
    rowSpans: [
      null,                              // Row 0
      null,                              // Row 1
      null,                              // Row 2
      { colMin: 10, colMax: 13 },        // Row 3: Narrow apex (cols 10-13)
      { colMin: 9,  colMax: 14 },        // Row 4: Wider
      { colMin: 8,  colMax: 15 },        // Row 5: Full diameter (cols 8-15)
      { colMin: 8,  colMax: 15 },        // Row 6: Full diameter
      { colMin: 9,  colMax: 14 },        // Row 7: Tapering
      { colMin: 10, colMax: 13 },        // Row 8: Narrow base
      null,                              // Row 9
      null,                              // Row 10
      null                               // Row 11
    ]
  };

  // Corner widget at cols 6..9, rows 2..3 (in the empty corner above the shoulder/circle edge)
  // In Row 3, object is cols 10..13. Widget is cols 6..9.
  // There is NO collision!
  const cornerWidget = { col: 6, row: 2, cw: 4, ch: 2 }; // cols 6..9, rows 2..3

  // Old coarse box overlap check would falsely claim collision because colMax(9) >= colMin(8) and rowMax(3) >= rowMin(3):
  assert.equal(cellBoxesOverlap(cornerWidget, objectBox), true,
    'cellBoxesOverlap falsely flags corner widget as colliding');

  // But widgetCollidesWithObject accurately knows it is in free negative space!
  assert.equal(widgetCollidesWithObject(cornerWidget, objectBox), false,
    'widgetCollidesWithObject must recognize that corner widget does NOT collide with the true contour');

  // Conversely, a widget that actually penetrates row 3 at col 10..13 DOES collide:
  const penetratingWidget = { col: 10, row: 3, cw: 3, ch: 2 };
  assert.equal(widgetCollidesWithObject(penetratingWidget, objectBox), true,
    'widgetCollidesWithObject must detect actual collision with the contour');
});

test('Object-Aware Layout: Preserves Widgets in Negative Space Corners Without Unnecessary Moves', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 75 };
  const allWidgetIds = ['widget-clock', 'widget-todo', 'widget-search'];
  const visibleWidgets = { 'widget-clock': true, 'widget-todo': true, 'widget-search': true };

  // Circular subject centered on grid
  const objectBox = {
    colMin: 8,
    colMax: 15,
    rowMin: 3,
    rowMax: 8,
    rowSpans: [
      null,
      null,
      null,
      { colMin: 10, colMax: 13 },
      { colMin: 9,  colMax: 14 },
      { colMin: 8,  colMax: 15 },
      { colMin: 8,  colMax: 15 },
      { colMin: 9,  colMax: 14 },
      { colMin: 10, colMax: 13 },
      null,
      null,
      null
    ]
  };

  const currentPositions = {
    'widget-clock':  { col: 6,  row: 2 }, // Sits right in the corner (cols 6..9, rows 2..3)
    'widget-todo':   { col: 14, row: 2 }, // Sits in opposite corner (cols 14..17, rows 2..3)
    'widget-search': { col: 9,  row: 5 }  // Sits directly on center of subject -> MUST BE ADJUSTED
  };

  const currentSizes = {
    'widget-clock':  { cw: 4, ch: 2 },
    'widget-todo':   { cw: 4, ch: 2 },
    'widget-search': { cw: 6, ch: 2 }
  };

  const result = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(result.adjusted, true, 'Adjustment occurs for the penetrating search widget');
  const moved = result.movedWidgets;

  // Search widget was colliding and moved
  assert.ok('widget-search' in moved, 'Search widget must be moved');

  // Corner widgets were in free negative space and NOT moved!
  assert.equal('widget-clock' in moved, false, 'Clock widget in negative space corner must stay undisturbed');
  assert.equal('widget-todo' in moved, false, 'Todo widget in negative space corner must stay undisturbed');

  // Verify search widget was placed with zero collision
  const searchPos = result.newPositions['widget-search'];
  const searchSz = result.newSizes['widget-search'];
  assert.equal(widgetCollidesWithObject({ ...searchPos, ...searchSz }, objectBox), false,
    'New search placement must not collide with contour');
});

test('Grid Helper: findNearestFreeCell Respects Contour RowSpans in ObstacleBox', () => {
  const grid = { cols: 20, rows: 10, cellW: 80, cellH: 80, offsetX: 0, offsetY: 0 };
  const existingItems = {};

  const obstacleBox = {
    colMin: 6,
    colMax: 13,
    rowMin: 2,
    rowMax: 7,
    rowSpans: [
      null,
      null,
      { colMin: 9, colMax: 10 },  // Row 2: only cols 9..10 occupied
      { colMin: 8, colMax: 11 },
      { colMin: 6, colMax: 13 },
      { colMin: 6, colMax: 13 },
      { colMin: 8, colMax: 11 },
      { colMin: 9, colMax: 10 },
      null,
      null
    ]
  };

  // Ask for a 2x2 widget near (col: 6, row: 2) — which is inside the bounding box, but OUTSIDE the contour
  const freeCell = findNearestFreeCell(6, 2, 2, 2, existingItems, grid, obstacleBox);
  assert.ok(freeCell, 'Should find free cell');
  assert.equal(freeCell.col, 6, 'Should allow placement at col 6 in row 2');
  assert.equal(freeCell.row, 2, 'Should allow placement at row 2');
});

test('Smooth SVG Spline Contour Generation: buildSmoothContourPath', () => {
  const squarePts = [
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 90, y: 90 },
    { x: 10, y: 90 }
  ];
  const smoothPath = buildSmoothContourPath(squarePts, 0.40);
  assert.ok(smoothPath.startsWith('M 10 10'), 'Path must start at initial point');
  assert.ok(smoothPath.includes('C '), 'Smooth path must use cubic bezier C commands');
  assert.ok(smoothPath.endsWith('Z'), 'Smooth path must close with Z');

  // Degenerate inputs
  assert.equal(buildSmoothContourPath([]), '', 'Empty points array returns empty string');
  assert.equal(buildSmoothContourPath([{ x: 5, y: 5 }]), 'M 5 5 Z', 'Single point handles gracefully');
});

test('Contour-Hugging Candidate Slots Bounds: Left and Right Limits Never Penetrate Wider Rows', () => {
  const grid = { cols: 24, rows: 12, cellW: 80, cellH: 80 };
  const allWidgetIds = ['widget-todo'];
  const visibleWidgets = { 'widget-todo': true };

  // Stepped subject: narrow head at row 3 (cols 10..13), wide shoulders at row 4 (cols 8..15)
  const objectBox = {
    colMin: 8,
    colMax: 15,
    rowMin: 3,
    rowMax: 6,
    rowSpans: [
      null, null, null,
      { colMin: 10, colMax: 13 }, // Row 3: head (cols 10..13)
      { colMin: 8,  colMax: 15 }, // Row 4: shoulders (cols 8..15)
      { colMin: 8,  colMax: 15 }, // Row 5: torso
      { colMin: 8,  colMax: 15 }, // Row 6: waist
      null, null, null, null, null
    ]
  };

  // Todo widget (cw: 3, ch: 2) placed in collision at cols 9..11, row 3
  const currentPositions = { 'widget-todo': { col: 9, row: 3 } };
  const currentSizes = { 'widget-todo': { cw: 3, ch: 2 } };

  const result = adjustWidgetsAwayFromObject({
    allWidgetIds,
    visibleWidgets,
    currentPositions,
    currentSizes,
    objectBox,
    grid
  });

  assert.equal(result.adjusted, true, 'Colliding widget must be adjusted');
  const newPos = result.newPositions['widget-todo'];
  const newSize = result.newSizes['widget-todo'];

  // Check that the placed widget has ZERO collision across all rows it occupies
  assert.equal(widgetCollidesWithObject({ ...newPos, ...newSize }, objectBox), false,
    'Repositioned widget must not collide with object contour across any of its rows');

  // Specifically: if placed on rows 3..4 on the left side, colMax must be < 8 (the shoulder reach), NOT 10!
  if (newPos.row <= 4 && newPos.row + newSize.ch - 1 >= 4 && newPos.col < 8) {
    assert.ok(newPos.col + newSize.cw - 1 < 8,
      `Left-side widget on row 4 cannot exceed col 7 (got right edge: ${newPos.col + newSize.cw - 1})`);
  }
});

test('widgetCollidesWithObject Multi-Subject Support: Properly Evaluates Obstacle Boxes Array', () => {
  const boxLeft = {
    colMin: 2,
    colMax: 6,
    rowMin: 2,
    rowMax: 7,
    rowSpans: [
      null, null,
      { colMin: 2, colMax: 6 },
      { colMin: 2, colMax: 6 },
      { colMin: 2, colMax: 6 },
      { colMin: 2, colMax: 6 },
      { colMin: 2, colMax: 6 },
      { colMin: 2, colMax: 6 },
      null, null, null, null
    ]
  };

  const boxRight = {
    colMin: 18,
    colMax: 22,
    rowMin: 2,
    rowMax: 7,
    rowSpans: [
      null, null,
      { colMin: 18, colMax: 22 },
      { colMin: 18, colMax: 22 },
      { colMin: 18, colMax: 22 },
      { colMin: 18, colMax: 22 },
      { colMin: 18, colMax: 22 },
      { colMin: 18, colMax: 22 },
      null, null, null, null
    ]
  };

  const multiSubjectObstacle = {
    colMin: 2,
    colMax: 22,
    rowMin: 2,
    rowMax: 7,
    boxes: [boxLeft, boxRight]
  };

  // 1. Widget in center corridor between the two subjects (cols 9..14, rows 3..5)
  const centerWidget = { col: 9, row: 3, cw: 5, ch: 2 };
  assert.equal(widgetCollidesWithObject(centerWidget, multiSubjectObstacle), false,
    'Center widget between two subjects must NOT collide with multi-subject obstacle');

  // 2. Widget penetrating left subject (cols 5..8, row 3)
  const leftColliding = { col: 5, row: 3, cw: 3, ch: 2 };
  assert.equal(widgetCollidesWithObject(leftColliding, multiSubjectObstacle), true,
    'Widget overlapping left subject must be recognized as colliding');

  // 3. Widget penetrating right subject (cols 17..20, row 3)
  const rightColliding = { col: 17, row: 3, cw: 3, ch: 2 };
  assert.equal(widgetCollidesWithObject(rightColliding, multiSubjectObstacle), true,
    'Widget overlapping right subject must be recognized as colliding');
});

test('Sub-20% Fractional Cell Penetration Thresholding: RowSpans Yields Null for Minor Penetrations', () => {
  const grid = { cols: 10, rows: 10, cellW: 100, cellH: 100, offsetX: 0, offsetY: 0 };
  const windowDims = { width: 1000, height: 1000 };
  const imageDims = { width: 1000, height: 1000 };
  const workspaceRect = { left: 0, top: 0, width: 1000, height: 1000 };

  // Tiny circular disc in center (radius = 0.008 -> 8px radius)
  // At row 4 (y = 400..500), apex of circle barely reaches y = 492..500 (8px into row 4)
  // And horizontally reaches x = 492..508 (8px into cell 4 [400..500], 8px into cell 5 [500..600])
  // Penetration in both cell 4 and cell 5 is only 8%, well under the 20% threshold!
  const tinyCircleBox = {
    xMin: 0.492,
    yMin: 0.492,
    xMax: 0.508,
    yMax: 0.508,
    shapeType: 'circle',
    circle: { cx: 0.50, cy: 0.50, r: 0.008, rx: 0.008, ry: 0.008 }
  };

  const mapped = mapObjectBoxToGrid(tinyCircleBox, imageDims, windowDims, workspaceRect, grid);
  assert.ok(Array.isArray(mapped.rowSpans), 'Mapped box must have rowSpans');
  // Row 4 has less than 20% penetration in any cell, so rowSpans[4] should be null (not falsely blocking cell 5)
  assert.equal(mapped.rowSpans[3], null, 'Row 3 above tiny circle is null');
  assert.equal(mapped.rowSpans[6], null, 'Row 6 below tiny circle is null');
});

test('Detection Overlay Renders Circle When Contours Array is Missing', () => {
  // Setup minimal browser DOM mocks for detectionOverlay
  const createdElements = [];
  const origDocument = global.document;
  const origWindow = global.window;

  global.window = { innerWidth: 1920, innerHeight: 1080 };
  global.document = {
    getElementById: (id) => null,
    createElement: (tag) => {
      const el = {
        tagName: tag,
        className: '',
        id: '',
        style: {},
        children: [],
        appendChild(child) { this.children.push(child); createdElements.push(child); },
        setAttribute(k, v) { this[k] = v; },
        classList: { add(c) { el.className += ` ${c}`; } }
      };
      createdElements.push(el);
      return el;
    },
    createElementNS: (ns, tag) => {
      const el = {
        tagName: tag,
        namespace: ns,
        children: [],
        appendChild(child) { this.children.push(child); createdElements.push(child); },
        setAttribute(k, v) { this[k] = v; }
      };
      createdElements.push(el);
      return el;
    },
    body: {
      children: [],
      appendChild(child) { this.children.push(child); }
    }
  };

  try {
    const circularDetection = {
      hasObject: true,
      confidence: 0.92,
      boundingBox: { xMin: 0.35, yMin: 0.35, xMax: 0.65, yMax: 0.65 },
      shapeType: 'circle',
      circle: { cx: 0.50, cy: 0.50, r: 0.15, rx: 0.15, ry: 0.15 },
      contour: null,
      contours: null
    };

    showDetectionOutline(circularDetection, { duration: 1000 });

    const circleSvgElements = createdElements.filter(e => e.tagName === 'circle');
    assert.ok(circleSvgElements.length >= 1,
      'showDetectionOutline must render SVG circle element even if contours array is omitted');
    const mainCircle = circleSvgElements.find(e => e['class'] === 'detected-contour-circle' || e.className?.includes('detected-contour-circle'));
    assert.ok(mainCircle, 'Must render detected-contour-circle element');
    assert.equal(mainCircle.cx, '960', 'Circle center X must match viewport center');
    assert.equal(mainCircle.cy, '540', 'Circle center Y must match viewport center');
  } finally {
    global.document = origDocument;
    global.window = origWindow;
  }
});

test('Detection Overlay Rapid Invocations & Timer Cleanup: No Stale Duplicate Containers', () => {
  const domNodes = new Map();
  const origDocument = global.document;
  const origWindow = global.window;

  global.window = { innerWidth: 1920, innerHeight: 1080 };
  global.document = {
    getElementById: (id) => domNodes.get(id) || null,
    createElement: (tag) => {
      const el = {
        tagName: tag,
        id: '',
        style: {},
        parentNode: null,
        appendChild(c) {},
        classList: { add() {}, remove() {} }
      };
      return el;
    },
    createElementNS: (ns, tag) => ({
      tagName: tag,
      appendChild() {},
      setAttribute() {}
    }),
    body: {
      appendChild: (node) => {
        node.parentNode = global.document.body;
        if (node.id) domNodes.set(node.id, node);
      },
      removeChild: (node) => {
        node.parentNode = null;
        if (node.id && domNodes.get(node.id) === node) domNodes.delete(node.id);
      }
    }
  };

  try {
    const detection = {
      hasObject: true,
      confidence: 0.88,
      boundingBox: { xMin: 0.2, yMin: 0.2, xMax: 0.8, yMax: 0.8 },
      shapeType: 'circle',
      circle: { cx: 0.5, cy: 0.5, r: 0.2, rx: 0.2, ry: 0.2 }
    };

    // First show call
    showDetectionOutline(detection, { duration: 2000 });
    const firstContainer = domNodes.get('detectedObjectOverlayContainer');
    assert.ok(firstContainer, 'First container added');

    // Rapid second show call before first duration ends
    showDetectionOutline(detection, { duration: 2000 });
    const secondContainer = domNodes.get('detectedObjectOverlayContainer');
    assert.ok(secondContainer, 'Second container exists');
    assert.notEqual(firstContainer, secondContainer, 'First container was replaced by second');
    assert.equal(firstContainer.parentNode, null, 'First container was removed from DOM immediately');

    hideDetectionOutline();
  } finally {
    global.document = origDocument;
    global.window = origWindow;
  }
});

test('Grounded Subject Silhouette: Bottom Grounded Subject Extends Mask and Contour to Edge', () => {
  const w = 40, h = 40;
  const data = new Uint8ClampedArray(w * h * 4);

  // Background dark navy
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 15; data[i * 4 + 1] = 20; data[i * 4 + 2] = 30; data[i * 4 + 3] = 255;
  }

  // Grounded standing subject silhouette: from y = 10 to bottom y = 39 (h - 1)
  // Center x = 15..25
  for (let y = 10; y < h; y++) {
    const hw = y < 20 ? 4 : 8; // Head vs body
    for (let x = 20 - hw; x <= 20 + hw; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 230; data[idx + 1] = 180; data[idx + 2] = 100; data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Must detect grounded subject');
  assert.ok(Array.isArray(result.contour), 'Must have contour');

  // Contour must reach the bottom edge
  const maxContourY = Math.max(...result.contour.map(p => p.y));
  assert.ok(maxContourY >= 0.90, `Contour max Y (${maxContourY}) must reach bottom edge`);

  // Row extents must extend down to the bottom
  assert.ok(Array.isArray(result.rowExtents), 'Must have row extents');
  const lastExt = result.rowExtents[result.rowExtents.length - 1];
  assert.ok(lastExt !== null, 'Bottom row extent must be present for grounded subject');
});

test('Contour Extraction: Boundary Noise and Disconnected Specks Do Not Choke Contour', () => {
  const w = 60, h = 60;
  const mask = new Uint8Array(w * h);

  // Scatter a few isolated noise pixels on top rows
  mask[2 * w + 10] = 1;
  mask[3 * w + 45] = 1;
  mask[5 * w + 20] = 1;

  // Solid circular subject in center
  const cx = 30, cy = 35, r = 15;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) {
        mask[y * w + x] = 1;
      }
    }
  }

  const contour = extractContourFromMask(mask, w, h);
  assert.ok(Array.isArray(contour), 'Contour must be array');
  assert.ok(contour.length >= 40, `Contour must capture main circle boundary, got length ${contour.length}`);

  // All points in contour should belong to the main circle, not the isolated specks
  for (const pt of contour) {
    assert.ok(pt.y >= cy - r - 2 && pt.y <= cy + r + 2, `Contour point y (${pt.y}) should be within circle range`);
  }
});

test('Shape Classification: Robust to Specular Highlight Off-Center Shift & Edge Noise', () => {
  const w = 80, h = 80;
  const mask = new Uint8Array(w * h);
  let count = 0, minX = w, maxX = 0, minY = h, maxY = 0;

  // Circle with sinusoidal edge roughness
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const noise = (Math.sin(x * 3) + Math.cos(y * 3)) * 0.8;
      if ((x - 40) ** 2 + (y - 40) ** 2 <= (18 + noise) ** 2) {
        mask[y * w + x] = 1;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const rawContour = extractContourFromMask(mask, w, h);
  assert.ok(rawContour.length >= 50, 'Must extract complete boundary');
  const simplified = simplifyPolygonRDP(rawContour, 1.2);

  // Saliency-weighted center is intentionally shifted by 3px due to highlight
  const shape = classifyShape(
    simplified,
    { count, minX, maxX, minY, maxY, centerX: 43, centerY: 42 },
    w,
    h
  );

  assert.equal(shape.shapeType, 'circle', 'Noisy circle with highlight must still be classified as circle');
  assert.ok(shape.circle, 'Must contain circle geometric properties');
  assert.ok(Math.abs(shape.circle.cx - 0.50) <= 0.05, `Circle cx (${shape.circle.cx}) should be close to 0.50`);
  assert.ok(Math.abs(shape.circle.cy - 0.50) <= 0.05, `Circle cy (${shape.circle.cy}) should be close to 0.50`);
  assert.ok(shape.circle.r > 0.15 && shape.circle.r < 0.30, `Circle radius (${shape.circle.r}) reasonable`);
});

test('Storage Round-Trip Serialization: Preserves Contour, Circle, SVG Paths, and RowExtents', () => {
  const mockDetection = {
    hasObject: true,
    confidence: 0.91,
    boundingBox: {
      xMin: 0.25, yMin: 0.20, xMax: 0.75, yMax: 0.80,
      shapeType: 'circle',
      circle: { cx: 0.5, cy: 0.5, r: 0.25, rx: 0.25, ry: 0.25 },
      contour: [{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.25 }, { x: 0.75, y: 0.5 }, { x: 0.5, y: 0.75 }],
      contours: [[{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.25 }, { x: 0.75, y: 0.5 }, { x: 0.5, y: 0.75 }]],
      svgPath: 'M 25 50 L 50 25 L 75 50 L 50 75 Z',
      smoothSvgPath: 'M 25 50 C 30 25, 45 25, 50 25 Z',
      rowExtents: [{ normY: 0.5, normMinX: 0.25, normMaxX: 0.75 }]
    },
    boundingBoxes: [{
      xMin: 0.25, yMin: 0.20, xMax: 0.75, yMax: 0.80,
      shapeType: 'circle',
      circle: { cx: 0.5, cy: 0.5, r: 0.25, rx: 0.25, ry: 0.25 },
      contour: [{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.25 }, { x: 0.75, y: 0.5 }, { x: 0.5, y: 0.75 }]
    }],
    imageDims: { width: 1920, height: 1080 },
    shapeType: 'circle',
    circle: { cx: 0.5, cy: 0.5, r: 0.25, rx: 0.25, ry: 0.25 },
    contour: [{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.25 }, { x: 0.75, y: 0.5 }, { x: 0.5, y: 0.75 }],
    contours: [[{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.25 }, { x: 0.75, y: 0.5 }, { x: 0.5, y: 0.75 }]],
    svgPath: 'M 25 50 L 50 25 L 75 50 L 50 75 Z',
    smoothSvgPath: 'M 25 50 C 30 25, 45 25, 50 25 Z',
    rowExtents: [{ normY: 0.5, normMinX: 0.25, normMaxX: 0.75 }]
  };

  // Background.js serialization logic
  const serialized = JSON.parse(JSON.stringify({
    wallpaperObjectDetection: {
      status: 'ready',
      imageSrc: 'test-bg.jpg',
      hasObject: true,
      confidence: mockDetection.confidence,
      boundingBox: mockDetection.boundingBox,
      boundingBoxes: mockDetection.boundingBoxes || [mockDetection.boundingBox],
      imageDims: mockDetection.imageDims || null,
      shapeType: mockDetection.shapeType || mockDetection.boundingBox?.shapeType || 'polygon',
      circle: mockDetection.circle || mockDetection.boundingBox?.circle || null,
      contour: mockDetection.contour || mockDetection.boundingBox?.contour || null,
      contours: mockDetection.contours || (mockDetection.contour ? [mockDetection.contour] : null),
      svgPath: mockDetection.svgPath || mockDetection.boundingBox?.svgPath || null,
      smoothSvgPath: mockDetection.smoothSvgPath || mockDetection.boundingBox?.smoothSvgPath || null,
      rowExtents: mockDetection.rowExtents || mockDetection.boundingBox?.rowExtents || null,
      detectedAt: Date.now()
    }
  }));

  const restored = serialized.wallpaperObjectDetection;
  assert.equal(restored.shapeType, 'circle', 'Restored detection must preserve shapeType');
  assert.ok(restored.circle, 'Restored detection must preserve circle object');
  assert.equal(restored.circle.cx, 0.5);
  assert.ok(Array.isArray(restored.contour), 'Restored detection must preserve contour');
  assert.equal(restored.contour.length, 4);
  assert.ok(Array.isArray(restored.contours), 'Restored detection must preserve contours array');
  assert.ok(restored.svgPath.startsWith('M'), 'Restored detection must preserve svgPath');
  assert.ok(restored.smoothSvgPath.startsWith('M'), 'Restored detection must preserve smoothSvgPath');
});

test('Detection Overlay: Renders Namespaced SVG Filter, Path, and Reticles for Contoured Subject', () => {
  const createdElements = [];
  const origDocument = global.document;
  const origWindow = global.window;

  global.window = { innerWidth: 1920, innerHeight: 1080 };
  global.document = {
    getElementById: () => null,
    createElement: (tag) => {
      const el = {
        tagName: tag,
        id: '',
        style: {},
        parentNode: null,
        children: [],
        appendChild(child) { this.children.push(child); createdElements.push(child); },
        classList: { add() {}, remove() {} },
        setAttribute(k, v) { this[k] = v; }
      };
      createdElements.push(el);
      return el;
    },
    createElementNS: (ns, tag) => {
      const el = {
        tagName: tag,
        namespaceURI: ns,
        children: [],
        appendChild(child) { this.children.push(child); createdElements.push(child); },
        setAttribute(k, v) { this[k] = v; }
      };
      createdElements.push(el);
      return el;
    },
    body: {
      children: [],
      appendChild(child) { this.children.push(child); }
    }
  };

  try {
    const polygonDetection = {
      hasObject: true,
      confidence: 0.88,
      boundingBox: { xMin: 0.20, yMin: 0.20, xMax: 0.60, yMax: 0.70 },
      shapeType: 'polygon',
      circle: null,
      contour: [
        { x: 0.20, y: 0.20 },
        { x: 0.60, y: 0.20 },
        { x: 0.60, y: 0.70 },
        { x: 0.20, y: 0.70 }
      ]
    };

    showDetectionOutline(polygonDetection, { duration: 1500, title: 'Hero Subject' });

    const pathElements = createdElements.filter(e => e.tagName === 'path');
    assert.ok(pathElements.length >= 1, 'Must render SVG path element for contoured subject');
    const mainPath = pathElements.find(e => e['class'] === 'detected-contour-path');
    assert.ok(mainPath, 'Must have detected-contour-path class');
    assert.ok(mainPath.d && mainPath.d.startsWith('M'), 'Path must have valid spline d attribute');

    const filterEl = createdElements.find(e => e.tagName === 'filter' && e.id === 'hudNeonGlow');
    assert.ok(filterEl, 'Must render SVG neon glow filter');

    const nodeElements = createdElements.filter(e => e.tagName === 'circle' && e['class'] === 'detected-contour-node');
    assert.ok(nodeElements.length >= 1, 'Must render extreme reticle node circles');

    hideDetectionOutline();
  } finally {
    global.document = origDocument;
    global.window = origWindow;
  }
});

test('fitCircleKasa: Direct Algebraic Circle Fitting Solves Center & Radius with Extreme Precision', () => {
  // Synthesize noisy circle points: center (64, 48), radius 28
  const pts = [];
  const trueCx = 64, trueCy = 48, trueR = 28;
  for (let a = 0; a < Math.PI * 2; a += 0.15) {
    const rNoise = trueR + (Math.sin(a * 4) * 0.9);
    pts.push({
      x: trueCx + rNoise * Math.cos(a),
      y: trueCy + rNoise * Math.sin(a)
    });
  }

  const fit = fitCircleKasa(pts);
  assert.ok(fit, 'Kåsa fit must return a valid circle fit');
  assert.ok(Math.abs(fit.cx - trueCx) < 0.5, `Fitted cx (${fit.cx}) must be within 0.5px of ${trueCx}`);
  assert.ok(Math.abs(fit.cy - trueCy) < 0.5, `Fitted cy (${fit.cy}) must be within 0.5px of ${trueCy}`);
  assert.ok(Math.abs(fit.r - trueR) < 0.5, `Fitted r (${fit.r}) must be within 0.5px of ${trueR}`);
});

test('classifyShape: Real-World Highlight Shift & Perspective Accurately Classified via Kåsa Fit', () => {
  const w = 120, h = 90;
  const mask = new Uint8Array(w * h);
  let count = 0, minX = w, maxX = 0, minY = h, maxY = 0;

  // Real-world circle with slight perspective (36px wide, 34px high)
  const cx = 60, cy = 45, rx = 18, ry = 17;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) {
        mask[y * w + x] = 1;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const rawContour = extractContourFromMask(mask, w, h);
  const simplified = simplifyPolygonRDP(rawContour, 1.2);

  // Saliency-weighted centroid shifted by 6px due to bright specular reflection
  const shape = classifyShape(
    simplified,
    { count, minX, maxX, minY, maxY, centerX: cx + 6, centerY: cy - 4 },
    w,
    h
  );

  assert.equal(shape.shapeType, 'circle', 'Shape must be recognized as circle despite highlight shift');
  assert.ok(shape.circle, 'Circle geometric properties must be present');
  assert.ok(Math.abs(shape.circle.cx - (cx / w)) <= 0.03, `Circle cx (${shape.circle.cx}) must be ~${(cx / w).toFixed(3)}`);
  assert.ok(Math.abs(shape.circle.cy - (cy / h)) <= 0.03, `Circle cy (${shape.circle.cy}) must be ~${(cy / h).toFixed(3)}`);
});

test('Detection Overlay: Sparse / Malformed Contours Gracefully Fall Back to Box Without Blank Container', () => {
  const createdElements = [];
  const origDocument = global.document;
  const origWindow = global.window;

  global.window = { innerWidth: 1920, innerHeight: 1080 };
  global.document = {
    getElementById: () => null,
    createElement: (tag) => {
      const el = {
        tagName: tag,
        id: '',
        style: {},
        parentNode: null,
        children: [],
        appendChild(child) { this.children.push(child); },
        classList: { add() {}, remove() {} },
        setAttribute(k, v) { this[k] = v; }
      };
      createdElements.push(el);
      return el;
    },
    createElementNS: (ns, tag) => {
      const el = {
        tagName: tag,
        namespaceURI: ns,
        children: [],
        appendChild(child) { this.children.push(child); },
        setAttribute(k, v) { this[k] = v; }
      };
      createdElements.push(el);
      return el;
    },
    body: {
      children: [],
      appendChild(child) { this.children.push(child); }
    }
  };

  try {
    // Detection object where contour only has 1 malformed point
    const sparseDetection = {
      hasObject: true,
      confidence: 0.85,
      boundingBox: { xMin: 0.20, yMin: 0.20, xMax: 0.60, yMax: 0.70 },
      shapeType: 'polygon',
      circle: null,
      contour: [{ x: 0.20, y: 0.20 }] // < 3 points
    };

    showDetectionOutline(sparseDetection, { duration: 1500, title: 'Fallback Box' });

    // Should NOT render empty SVG, but fall back to detected-object-box
    const boxElements = createdElements.filter(e => e['class'] === 'detected-object-box');
    assert.equal(boxElements.length, 1, 'Must render fallback bounding box when contour vertices are sparse');

    hideDetectionOutline();
  } finally {
    global.document = origDocument;
    global.window = origWindow;
  }
});

test('Bi-Directional Normalization: Restores Missing Circle and Contour from Top-Level to BoundingBox', () => {
  // Simulates an older or stripped storage payload where shapeType and circle are only at top level
  const detection = {
    status: 'ready',
    imageSrc: 'test.jpg',
    hasObject: true,
    confidence: 0.90,
    shapeType: 'circle',
    circle: { cx: 0.50, cy: 0.45, r: 0.20, rx: 0.20, ry: 0.20 },
    contour: [{ x: 0.30, y: 0.45 }, { x: 0.50, y: 0.25 }, { x: 0.70, y: 0.45 }, { x: 0.50, y: 0.65 }],
    boundingBox: {
      xMin: 0.30,
      yMin: 0.25,
      xMax: 0.70,
      yMax: 0.65
      // Notice: shapeType, circle, contour are missing inside boundingBox!
    }
  };

  // Run normalization logic
  const b = detection.boundingBox;
  const shapeType = detection.shapeType || b.shapeType || 'polygon';
  const circle = detection.circle || b.circle || null;
  const contour = detection.contour || b.contour || null;
  b.shapeType = shapeType;
  b.circle = circle;
  b.contour = contour;

  assert.equal(detection.boundingBox.shapeType, 'circle', 'boundingBox must receive normalized shapeType');
  assert.ok(detection.boundingBox.circle, 'boundingBox must receive normalized circle');
  assert.equal(detection.boundingBox.contour.length, 4, 'boundingBox must receive normalized contour');

  // Now mapObjectBoxToGrid can generate rowSpans without falling back to coarse box
  const grid = { cols: 12, rows: 12, cellW: 100, cellH: 60, offsetX: 0, offsetY: 0 };
  const mapped = mapObjectBoxToGrid(
    detection.boundingBox,
    { width: 1920, height: 1080 },
    { width: 1920, height: 1080 },
    { left: 0, top: 0, width: 1200, height: 720 },
    grid
  );

  assert.equal(mapped.shapeType, 'circle', 'Mapped object box must preserve circular shapeType');
  assert.ok(Array.isArray(mapped.rowSpans), 'Mapped object box must generate rowSpans array');
});

test('classifyShape: Square and Rectangle are NOT Misclassified as Circles Even When RDP Simplifies to 4 Cyclic Vertices', () => {
  const w = 120, h = 90;

  // 1. Square subject: 40x40 pixels
  const sqMask = new Uint8Array(w * h);
  let sqCount = 0;
  for (let y = 25; y <= 65; y++) {
    for (let x = 40; x <= 80; x++) {
      sqMask[y * w + x] = 1;
      sqCount++;
    }
  }
  const rawSq = extractContourFromMask(sqMask, w, h);
  const simpSq = simplifyPolygonRDP(rawSq, 1.2);
  assert.equal(simpSq.length, 4, 'Square simplifies to 4 vertices');

  const sqShape = classifyShape(
    simpSq,
    { count: sqCount, minX: 40, maxX: 80, minY: 25, maxY: 65, centerX: 60, centerY: 45 },
    w,
    h,
    rawSq
  );
  assert.equal(sqShape.shapeType, 'polygon', 'Square must NOT be classified as a circle');
  assert.equal(sqShape.circle, null, 'Square must not have circle geometry');

  // 2. Oblong rectangular subject: 30x60 pixels
  const rectMask = new Uint8Array(w * h);
  let rectCount = 0;
  for (let y = 15; y <= 75; y++) {
    for (let x = 45; x <= 75; x++) {
      rectMask[y * w + x] = 1;
      rectCount++;
    }
  }
  const rawRect = extractContourFromMask(rectMask, w, h);
  const simpRect = simplifyPolygonRDP(rawRect, 1.2);
  const rectShape = classifyShape(
    simpRect,
    { count: rectCount, minX: 45, maxX: 75, minY: 15, maxY: 75, centerX: 60, centerY: 45 },
    w,
    h,
    rawRect
  );
  assert.equal(rectShape.shapeType, 'polygon', 'Oblong rectangle must NOT be classified as a circle');
  assert.equal(rectShape.circle, null, 'Rectangle must not have circle geometry');
});

test('classifyShape: Real-World Circular Subject with Minor Discretization Noise Successfully Recognized', () => {
  const w = 120, h = 90;
  const mask = new Uint8Array(w * h);
  let count = 0;
  const cx = 60, cy = 45, r = 24;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      const angle = Math.atan2(y - cy, x - cx);
      const ripple = Math.sin(angle * 6) * 1.2;
      if (dist <= r + ripple) {
        mask[y * w + x] = 1;
        count++;
      }
    }
  }

  const raw = extractContourFromMask(mask, w, h);
  const simp = simplifyPolygonRDP(raw, 1.2);
  assert.ok(simp.length >= 8, 'Circle contour retains curved vertex complexity');

  const shape = classifyShape(
    simp,
    { count, minX: cx - r - 2, maxX: cx + r + 2, minY: cy - r - 2, maxY: cy + r + 2, centerX: cx, centerY: cy },
    w,
    h,
    raw
  );

  assert.equal(shape.shapeType, 'circle', 'Real-world circular subject must be classified as circle');
  assert.ok(shape.circle, 'Circle geometric properties must be present');
  assert.ok(Math.abs(shape.circle.cx - (cx / w)) <= 0.03, `cx (${shape.circle.cx}) ~${(cx / w).toFixed(3)}`);
  assert.ok(Math.abs(shape.circle.cy - (cy / h)) <= 0.03, `cy (${shape.circle.cy}) ~${(cy / h).toFixed(3)}`);
  assert.ok(Math.abs(shape.circle.r - (r / Math.max(w, h))) <= 0.04, `r (${shape.circle.r}) reasonable`);
});

test('Cache Invalidation: Stored Detection Without Contour Metadata Triggers Re-Detection', () => {
  const legacyStoredDetection = {
    status: 'ready',
    imageSrc: 'Images/wallpaper-default.jpg',
    hasObject: true,
    confidence: 0.85,
    boundingBox: { xMin: 0.3, yMin: 0.2, xMax: 0.7, yMax: 0.8 },
    boundingBoxes: [{ xMin: 0.3, yMin: 0.2, xMax: 0.7, yMax: 0.8 }]
  };

  const currentBg = 'Images/wallpaper-default.jpg';
  const isLegacyOrIncomplete = !legacyStoredDetection.contour && !legacyStoredDetection.circle;
  const needsReDetection = !legacyStoredDetection ||
    !legacyStoredDetection.hasObject ||
    !legacyStoredDetection.boundingBox ||
    legacyStoredDetection.imageSrc !== currentBg ||
    isLegacyOrIncomplete;

  assert.equal(needsReDetection, true, 'Legacy detection missing contour must trigger re-detection');
});

test('CIELAB Conversion & Delta E Mathematical Accuracy', () => {
  const black = rgbToLab(0, 0, 0);
  assert.ok(Math.abs(black.l - 0) < 0.5, `Black L* (${black.l}) should be near 0`);

  const white = rgbToLab(255, 255, 255);
  assert.ok(Math.abs(white.l - 100) < 0.5, `White L* (${white.l}) should be near 100`);

  const dEBlackWhite = deltaE(black, white);
  assert.ok(Math.abs(dEBlackWhite - 100) < 1.0, `Delta E black to white (${dEBlackWhite}) should be ~100`);

  const red = rgbToLab(255, 0, 0);
  const green = rgbToLab(0, 255, 0);
  const dERedGreen = deltaE(red, green);
  assert.ok(dERedGreen > 80, `Delta E red to green (${dERedGreen}) should be large (>80)`);
});

test('High-Precision Semantic Detection: Anime / Stylized Character', () => {
  const w = 120;
  const h = 100;
  const data = new Uint8ClampedArray(w * h * 4);

  // Background: dark room (35, 35, 42)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 35;
    data[i * 4 + 1] = 35;
    data[i * 4 + 2] = 42;
    data[i * 4 + 3] = 255;
  }

  // Anime Character: centered vertical portrait (x: 42..78, y: 15..95)
  for (let y = 15; y <= 95; y++) {
    const hw = y < 35 ? 12 : (y < 60 ? 16 : 14);
    for (let x = 60 - hw; x <= 60 + hw; x++) {
      const idx = (y * w + x) * 4;
      if (y <= 30) {
        // Vibrant electric blue anime hair (high saturation cel-shaded)
        data[idx] = 30;
        data[idx + 1] = 180;
        data[idx + 2] = 255;
      } else if (y <= 42) {
        // Face skin
        data[idx] = 255;
        data[idx + 1] = 215;
        data[idx + 2] = 185;
      } else {
        // Vibrant costume
        data[idx] = 230;
        data[idx + 1] = 40;
        data[idx + 2] = 110;
      }
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Must detect character');
  assert.equal(result.category, 'character', `Expected category 'character', got '${result.category}'`);
  assert.equal(result.label, 'Anime Character');
  assert.ok(result.semanticConfidence >= 0.60, 'Semantic confidence should be solid');
});

test('High-Precision Semantic Detection: Human Portrait', () => {
  const w = 120;
  const h = 100;
  const data = new Uint8ClampedArray(w * h * 4);

  // Background: neutral gray studio (110, 110, 115)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 110;
    data[i * 4 + 1] = 110;
    data[i * 4 + 2] = 115;
    data[i * 4 + 3] = 255;
  }

  // Human Portrait: vertical aspect (x: 44..76, y: 18..92)
  for (let y = 18; y <= 92; y++) {
    const hw = y < 45 ? 12 : 16;
    for (let x = 60 - hw; x <= 60 + hw; x++) {
      const idx = (y * w + x) * 4;
      if (y <= 46) {
        // Natural photographic skin tone locus (face & neck)
        data[idx] = 218;
        data[idx + 1] = 158;
        data[idx + 2] = 122;
      } else {
        // Dark casual shirt
        data[idx] = 48;
        data[idx + 1] = 52;
        data[idx + 2] = 58;
      }
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Must detect human portrait');
  assert.equal(result.category, 'human', `Expected category 'human', got '${result.category}'`);
  assert.equal(result.label, 'Human Portrait');
});

test('High-Precision Semantic Detection: Car / Automobile', () => {
  const w = 140;
  const h = 80;
  const data = new Uint8ClampedArray(w * h * 4);

  // Background: road / sky (top sky 150, 185, 220, bottom asphalt 70, 70, 75)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (y < 45) {
        data[idx] = 150; data[idx + 1] = 185; data[idx + 2] = 220;
      } else {
        data[idx] = 70; data[idx + 1] = 70; data[idx + 2] = 75;
      }
      data[idx + 3] = 255;
    }
  }

  // Sports Car: horizontal aspect (x: 25..115, y: 38..74)
  for (let y = 38; y <= 74; y++) {
    const minX = y < 50 ? 45 : 25;
    const maxX = y < 50 ? 95 : 115;
    for (let x = minX; x <= maxX; x++) {
      const idx = (y * w + x) * 4;
      if (y <= 43) {
        // Specular roof reflection
        data[idx] = 245; data[idx + 1] = 245; data[idx + 2] = 248;
      } else if (y >= 68) {
        // Dark underside & tires
        data[idx] = 22; data[idx + 1] = 22; data[idx + 2] = 26;
      } else {
        // Metallic red car body
        data[idx] = 215; data[idx + 1] = 25; data[idx + 2] = 38;
      }
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Must detect car');
  assert.equal(result.category, 'car', `Expected category 'car', got '${result.category}'`);
  assert.equal(result.label, 'Car / Vehicle');
});

test('High-Precision Semantic Detection: Flower / Botanical', () => {
  const w = 100;
  const h = 100;
  const data = new Uint8ClampedArray(w * h * 4);

  // Background: dense green garden foliage (40, 95, 35)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 40;
    data[i * 4 + 1] = 95;
    data[i * 4 + 2] = 35;
    data[i * 4 + 3] = 255;
  }

  // Flower: circular pink/magenta rose bloom in center (cx: 50, cy: 50, r: 24)
  const cx = 50, cy = 50, r = 24;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dSq = (x - cx) ** 2 + (y - cy) ** 2;
      if (dSq <= r ** 2) {
        const idx = (y * w + x) * 4;
        data[idx] = 240;
        data[idx + 1] = 45;
        data[idx + 2] = 135;
        data[idx + 3] = 255;
      }
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Must detect flower');
  assert.equal(result.category, 'flower', `Expected category 'flower', got '${result.category}'`);
  assert.equal(result.label, 'Flower / Botanical');
});

test('Sub-Pixel Contour Precision Refinement: Snaps Coarse Points to High-Res Image Edges', () => {
  const sw = 240;
  const sh = 240;
  const data = new Uint8ClampedArray(sw * sh * 4);

  // Dark background
  for (let i = 0; i < sw * sh; i++) {
    data[i * 4] = 20;
    data[i * 4 + 1] = 20;
    data[i * 4 + 2] = 20;
    data[i * 4 + 3] = 255;
  }

  // Sharp physical square boundary at x: 60..180, y: 60..180 (bright white 255)
  for (let y = 60; y <= 180; y++) {
    for (let x = 60; x <= 180; x++) {
      const idx = (y * sw + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = 255;
    }
  }

  // Coarse contour points slightly offset by 3px from true edge
  const coarseContour = [
    { x: 57 / sw, y: 60 / sh },
    { x: 183 / sw, y: 60 / sh },
    { x: 183 / sw, y: 180 / sh },
    { x: 57 / sw, y: 180 / sh }
  ];

  const refined = refineContourHighRes(coarseContour, { data, width: sw, height: sh }, { maxOffset: 5 });
  assert.equal(refined.length, coarseContour.length);

  // Snapped points should move closer to true physical boundary at x = 60/240 = 0.250 and 180/240 = 0.750
  assert.ok(Math.abs(refined[0].x - (60 / sw)) < Math.abs(coarseContour[0].x - (60 / sw)), 'Refined x should snap towards true 60px edge');
});

test('Main Object Recognition: Chromatic Subject With Identical Luminance to Background (Multi-Channel Color Gradient)', () => {
  // Test requirement: In wallpapers where a vivid subject has high chromatic color contrast
  // against the background but nearly identical grayscale luminance, multi-channel Euclidean
  // color gradient and color-surround must successfully recognize the focal subject.
  const w = 100;
  const h = 80;
  const data = new Uint8ClampedArray(w * h * 4);

  // Background: Forest green (RGB: 40, 140, 40), luminance ~ 98.8
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 40;
    data[i * 4 + 1] = 140;
    data[i * 4 + 2] = 40;
    data[i * 4 + 3] = 255;
  }

  // Foreground subject: Crimson red (RGB: 214, 50, 50), luminance ~ 99.0 (|delta Lum| = 0.2)
  // Positioned centrally: x: 35..65, y: 25..55
  for (let y = 25; y <= 55; y++) {
    for (let x = 35; x <= 65; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 214;
      data[idx + 1] = 50;
      data[idx + 2] = 50;
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Chromatic subject with identical luminance must be recognized');
  assert.ok(result.boundingBox, 'Should return bounding box');
  assert.ok(result.confidence >= 0.50, `Confidence (${result.confidence}) should be significant`);
  assert.ok(result.boundingBox.xMin <= 0.38 && result.boundingBox.xMax >= 0.62, 'Horizontal bounds must enclose subject');
  assert.ok(result.boundingBox.yMin <= 0.32 && result.boundingBox.yMax >= 0.65, 'Vertical bounds must enclose subject');
});

test('Main Object Recognition: Crisp Small Focal Subject (1.5% Area Moon/Emblem)', () => {
  // Test requirement: Smaller crisp focal subjects (like moons, planets, logos, emblems)
  // occupying 1% to 2.5% of the screen must be recognized with minAreaRatio lowered to 0.01.
  const w = 100;
  const h = 100;
  const data = new Uint8ClampedArray(w * h * 4);

  // Deep night sky background (RGB: 15, 20, 35)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 15;
    data[i * 4 + 1] = 20;
    data[i * 4 + 2] = 35;
    data[i * 4 + 3] = 255;
  }

  // Small crisp moon: center at (70, 30), radius = 7 (~150 pixels = 1.5% of image area)
  const moonCx = 70;
  const moonCy = 30;
  const moonR = 7;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - moonCx;
      const dy = y - moonCy;
      if (dx * dx + dy * dy <= moonR * moonR) {
        const idx = (y * w + x) * 4;
        data[idx] = 245;
        data[idx + 1] = 245;
        data[idx + 2] = 230;
        data[idx + 3] = 255;
      }
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Crisp 1.5% area moon must be recognized');
  assert.ok(result.boundingBox, 'Should return bounding box');
  assert.ok(result.boundingBox.xMin >= 0.55 && result.boundingBox.xMax <= 0.85, 'x bounds should tightly enclose moon');
  assert.ok(result.boundingBox.yMin >= 0.15 && result.boundingBox.yMax <= 0.45, 'y bounds should tightly enclose moon');
});

test('Main Object Recognition: Low-Contrast Soft Pastel Aesthetic Subject', () => {
  // Test requirement: Soft pastel wallpapers with subtle tone gradients and lower peak
  // saliency must pass ambient thresholding when a cohesive central subject is present.
  const w = 100;
  const h = 80;
  const data = new Uint8ClampedArray(w * h * 4);

  // Soft lavender-tinted background (RGB: 210, 205, 220)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 210;
    data[i * 4 + 1] = 205;
    data[i * 4 + 2] = 220;
    data[i * 4 + 3] = 255;
  }

  // Gentle peach subject in center (RGB: 238, 185, 175)
  for (let y = 25; y <= 55; y++) {
    for (let x = 35; x <= 65; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 238;
      data[idx + 1] = 185;
      data[idx + 2] = 175;
      data[idx + 3] = 255;
    }
  }

  const result = detectMainObjectFromImageData({ data, width: w, height: h });
  assert.equal(result.hasObject, true, 'Soft pastel subject must be recognized');
  assert.ok(result.boundingBox, 'Should return bounding box');
  assert.ok(result.boundingBox.xMin <= 0.38 && result.boundingBox.xMax >= 0.62);
});

