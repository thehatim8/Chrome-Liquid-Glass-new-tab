// storage.js - wrapper around chrome.storage.local
export const storage = {
  async get(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  },
  async set(obj) {
    return new Promise(resolve => chrome.storage.local.set(obj, () => resolve()));
  },
  async remove(keys) {
    return new Promise(resolve => chrome.storage.local.remove(keys, () => resolve()));
  }
};
