const DEFAULT_LAYOUT_CONFIG = {
  // Base grid — also the MINIMUM. The default widget layout is authored
  // against this, so the grid never shrinks below it (keeps defaults intact).
  gridCols: 24,
  gridRows: 12,
  minWidgetCols: 2,
  minWidgetRows: 2,
  // Effectively uncapped so the grid spans the full workspace width on
  // ultra-wide / 4K displays instead of leaving dead side-space.
  maxGridWidth: 10000,
  // Dynamic sizing: derive column/row counts from the workspace so cells stay
  // ~this many px and bigger screens gain MORE cells (not just bigger widgets).
  dynamic: true,
  targetCellPx: 78,
  maxCols: 80,
  maxRows: 40
};

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  return Math.max(min, Math.min(max, rounded));
}

export function normalizeLayoutConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const gridCols = clampInt(src.gridCols, 4, 64, DEFAULT_LAYOUT_CONFIG.gridCols);
  const gridRows = clampInt(src.gridRows, 4, 64, DEFAULT_LAYOUT_CONFIG.gridRows);
  const minWidgetCols = clampInt(src.minWidgetCols, 1, gridCols, DEFAULT_LAYOUT_CONFIG.minWidgetCols);
  const minWidgetRows = clampInt(src.minWidgetRows, 1, gridRows, DEFAULT_LAYOUT_CONFIG.minWidgetRows);
  const maxGridWidth = clampInt(src.maxGridWidth, 640, 10000, DEFAULT_LAYOUT_CONFIG.maxGridWidth);
  const dynamic = typeof src.dynamic === 'boolean' ? src.dynamic : DEFAULT_LAYOUT_CONFIG.dynamic;
  const targetCellPx = clampInt(src.targetCellPx, 40, 200, DEFAULT_LAYOUT_CONFIG.targetCellPx);
  // Upper bounds can't fall below the base grid, so defaults always fit.
  const maxCols = clampInt(src.maxCols, gridCols, 200, DEFAULT_LAYOUT_CONFIG.maxCols);
  const maxRows = clampInt(src.maxRows, gridRows, 200, DEFAULT_LAYOUT_CONFIG.maxRows);
  return { gridCols, gridRows, minWidgetCols, minWidgetRows, maxGridWidth, dynamic, targetCellPx, maxCols, maxRows };
}

let layoutConfig = { ...DEFAULT_LAYOUT_CONFIG };

export function setLayoutConfig(nextConfig) {
  layoutConfig = normalizeLayoutConfig(nextConfig);
  return layoutConfig;
}

export function getLayoutConfig() {
  return layoutConfig;
}

// Resolve the live column/row counts for a given available workspace size.
// Bigger viewports yield more cells (cells stay ~targetCellPx); the count is
// clamped to [base, max] so it never shrinks below the authored default grid.
export function resolveDynamicGridSize(availableWidth, availableHeight, cfg = layoutConfig) {
  if (!cfg.dynamic || !Number.isFinite(availableWidth) || !Number.isFinite(availableHeight)) {
    return { cols: cfg.gridCols, rows: cfg.gridRows };
  }
  const t = cfg.targetCellPx || 78;
  const cols = Math.max(cfg.gridCols, Math.min(cfg.maxCols, Math.round(availableWidth / t)));
  const rows = Math.max(cfg.gridRows, Math.min(cfg.maxRows, Math.round(availableHeight / t)));
  return { cols, rows };
}
