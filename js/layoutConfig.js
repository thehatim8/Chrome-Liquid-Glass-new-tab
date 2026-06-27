const DEFAULT_LAYOUT_CONFIG = {
  gridCols: 24,
  gridRows: 12,
  minWidgetCols: 2,
  minWidgetRows: 2,
  maxGridWidth: 3840
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
  const maxGridWidth = clampInt(src.maxGridWidth, 640, 3840, DEFAULT_LAYOUT_CONFIG.maxGridWidth);
  return { gridCols, gridRows, minWidgetCols, minWidgetRows, maxGridWidth };
}

let layoutConfig = { ...DEFAULT_LAYOUT_CONFIG };

export function setLayoutConfig(nextConfig) {
  layoutConfig = normalizeLayoutConfig(nextConfig);
  return layoutConfig;
}

export function getLayoutConfig() {
  return layoutConfig;
}

