import { storage } from './storage.js';

const DEFAULT_IMAGE_WIDGET = {
  src: ''
};

let widgetEl = null;
let previewEl = null;
let emptyEl = null;
let state = { ...DEFAULT_IMAGE_WIDGET };

function applyShape() {
  if (!widgetEl) return;
  widgetEl.classList.remove('shape-square', 'shape-rectangle', 'shape-circle');
  widgetEl.classList.add('shape-rectangle');
}

function applySrc(src) {
  if (!previewEl || !emptyEl) return;
  if (!src) {
    previewEl.src = '';
    previewEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }
  previewEl.src = src;
  previewEl.classList.remove('hidden');
  emptyEl.classList.add('hidden');
}

function applyState() {
  applyShape();
  applySrc(state.src);
}

export async function initImageWidget(appState) {
  widgetEl = document.getElementById('widget-image');
  previewEl = document.getElementById('imageWidgetPreview');
  emptyEl = document.getElementById('imageWidgetEmpty');
  if (!widgetEl || !previewEl || !emptyEl) return;
  previewEl.draggable = false;

  const res = await storage.get(['imageWidget']);
  state = { ...DEFAULT_IMAGE_WIDGET, ...(res.imageWidget || {}) };
  if ('shape' in state) delete state.shape;
  applyState();
  await storage.set({ imageWidget: state });

  if (appState) appState.imageWidget = state;
}

export function getImageWidgetState() {
  return { ...state };
}

export async function updateImageWidgetState(patch) {
  state = { ...state, ...patch };
  if ('shape' in state) delete state.shape;
  applyState();
  await storage.set({ imageWidget: state });
}
