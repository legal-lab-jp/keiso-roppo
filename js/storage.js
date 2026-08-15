const DB_NAME = "keiso-roppo";
const DB_VERSION = 1;
const FALLBACK_KEY = "keiso-roppo:fallback:v1";
const stores = ["notes", "bookmarks", "preferences", "meta"];

function emptyFallback() {
  return { notes: {}, bookmarks: {}, preferences: {}, meta: {} };
}

function readFallback() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FALLBACK_KEY) || "null");
    if (parsed && typeof parsed === "object") return { ...emptyFallback(), ...parsed };
  } catch {}
  return emptyFallback();
}

function writeFallback(value) {
  window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(value));
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("notes")) db.createObjectStore("notes", { keyPath: "provisionId" });
      if (!db.objectStoreNames.contains("bookmarks")) db.createObjectStore("bookmarks", { keyPath: "articleId" });
      if (!db.objectStoreNames.contains("preferences")) db.createObjectStore("preferences", { keyPath: "key" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function createStorage() {
  let database = null;
  let mode = "indexeddb";
  let fallback = emptyFallback();
  try {
    database = await openDatabase();
  } catch {
    try {
      fallback = readFallback();
      writeFallback(fallback);
      mode = "localstorage";
    } catch {
      mode = "memory";
    }
  }

  async function getAll(store) {
    if (database) {
      const tx = database.transaction(store, "readonly");
      return requestResult(tx.objectStore(store).getAll());
    }
    return Object.values(fallback[store]);
  }

  async function get(store, key) {
    if (database) {
      const tx = database.transaction(store, "readonly");
      return requestResult(tx.objectStore(store).get(key));
    }
    return fallback[store][key] || null;
  }

  function keyFor(store, record) {
    return store === "notes" ? record.provisionId : store === "bookmarks" ? record.articleId : record.key;
  }

  async function put(store, record) {
    if (database) {
      const tx = database.transaction(store, "readwrite");
      await requestResult(tx.objectStore(store).put(record));
      return;
    }
    fallback[store][keyFor(store, record)] = record;
    if (mode === "localstorage") writeFallback(fallback);
  }

  async function remove(store, key) {
    if (database) {
      const tx = database.transaction(store, "readwrite");
      await requestResult(tx.objectStore(store).delete(key));
      return;
    }
    delete fallback[store][key];
    if (mode === "localstorage") writeFallback(fallback);
  }

  async function putMany(records) {
    if (database) {
      const tx = database.transaction(stores, "readwrite");
      for (const record of records.notes || []) tx.objectStore("notes").put(record);
      for (const record of records.bookmarks || []) tx.objectStore("bookmarks").put(record);
      for (const [key, value] of Object.entries(records.preferences || {})) tx.objectStore("preferences").put({ key, value });
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return;
    }
    for (const record of records.notes || []) fallback.notes[record.provisionId] = record;
    for (const record of records.bookmarks || []) fallback.bookmarks[record.articleId] = record;
    for (const [key, value] of Object.entries(records.preferences || {})) fallback.preferences[key] = { key, value };
    if (mode === "localstorage") writeFallback(fallback);
  }

  return {
    mode,
    getAll,
    get,
    put,
    remove,
    putMany,
    async snapshot() {
      const [notes, bookmarks, preferences] = await Promise.all([getAll("notes"), getAll("bookmarks"), getAll("preferences")]);
      return {
        notes,
        bookmarks,
        preferences: Object.fromEntries(preferences.map((record) => [record.key, record.value]))
      };
    }
  };
}
