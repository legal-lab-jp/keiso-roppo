import { goToArticle, onRouteChange, routeNumber } from "./router.js";
import { searchArticles } from "./search.js";
import { createStorage } from "./storage.js";
import { backupPayload, downloadBackup, parseImport } from "./import-export.js";
import { registerPwa } from "./pwa.js";
import {
  articleListBody,
  bookmarksBody,
  conflictBody,
  createOverlay,
  renderArticle,
  renderRail,
  searchBody,
  settingsBody
} from "./render.js";

const CONTENT_VERSION = "2026-08-15.test1";
const defaults = { theme: "system", fontScale: "standard", displayMode: "law", lastArticleNumber: "320" };
const validPreferenceValues = {
  theme: new Set(["system", "light", "dark"]),
  fontScale: new Set(["small", "standard", "large"]),
  displayMode: new Set(["law", "study"]),
  lastArticleNumber: new Set(["320", "321", "322"])
};

const appShell = document.getElementById("app-shell");
const rail = document.getElementById("article-rail");
const main = document.getElementById("article-main");
const overlayRoot = document.getElementById("overlay-root");
const toastRoot = document.getElementById("toast-region");
const importFile = document.getElementById("import-file");
const connectionState = document.getElementById("connection-state");
const updateBanner = document.getElementById("update-banner");

let storage;
let catalog;
let version;
let articles = new Map();
let pwa;
let activeOverlay = null;
let overlayOrigin = null;
let overlayKeyHandler = null;
let noteTimers = new Map();
let pendingNoteValues = new Map();
let undoNote = null;
let toastTimer = null;

const state = {
  activeArticleNumber: "320",
  displayMode: "law",
  activeSegmentId: null,
  openMemos: new Set(),
  theme: "system",
  fontScale: "standard",
  notes: new Map(),
  bookmarks: new Set(),
  storageMode: "memory",
  offlineReady: false,
  verifiedLabel: "2026年8月15日"
};

function showToast(message, action = null) {
  clearTimeout(toastTimer);
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  if (action) {
    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.textContent = action.label;
    actionButton.addEventListener("click", () => {
      action.run();
      toast.remove();
    });
    toast.append(actionButton);
  }
  toastRoot.replaceChildren(toast);
  toastTimer = window.setTimeout(() => toast.remove(), action ? 5000 : 3000);
}

function applyVisualPreferences() {
  appShell.dataset.theme = state.theme;
  appShell.dataset.fontScale = state.fontScale;
}

function updateConnectionLabel() {
  if (!navigator.onLine) connectionState.textContent = "オフライン";
  else if (state.offlineReady) connectionState.textContent = "オフライン利用可";
  else connectionState.textContent = "オフライン準備中";
}

async function persistPreference(key, value) {
  await storage.put("preferences", { key, value });
}

function currentArticle() {
  return articles.get(state.activeArticleNumber)?.article;
}

function scrollToTarget(id) {
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
}

function render() {
  const article = currentArticle();
  if (!article) {
    main.replaceChildren(Object.assign(document.createElement("p"), { className: "error-state", textContent: "条文データを読み込めませんでした。" }));
    return;
  }
  renderRail(rail, catalog, state.activeArticleNumber, state.bookmarks, navigate, () => openOverlay("bookmarks"), () => openOverlay("settings"));
  renderArticle(main, article, state, state.notes, state.bookmarks, {
    onToggleStudy: async () => {
      state.displayMode = state.displayMode === "law" ? "study" : "law";
      state.activeSegmentId = null;
      await persistPreference("displayMode", state.displayMode);
      render();
    },
    onBookmark: toggleBookmark,
    onCopy: copyCurrentLaw,
    onSegment: selectSegment,
    onRelated: navigate,
    onOpenMemo: (provisionId) => {
      state.openMemos.add(provisionId);
      render();
      requestAnimationFrame(() => document.getElementById(`memo-${provisionId}`)?.focus());
    },
    onCloseMemo: (provisionId) => {
      state.openMemos.delete(provisionId);
      render();
    },
    onMemoInput: (provision, textarea) => scheduleMemoSave(provision, textarea, false),
    onMemoBlur: (provision, textarea) => scheduleMemoSave(provision, textarea, true)
  });
  applyVisualPreferences();
}

async function navigate(number) {
  if (!["320", "321", "322"].includes(String(number))) return;
  closeOverlay();
  state.activeSegmentId = null;
  state.openMemos.clear();
  goToArticle(String(number));
}

async function handleRoute(number) {
  const next = number || state.activeArticleNumber || "320";
  if (!number) {
    showToast("指定された条文は収録されていないため、第320条を開きました。");
    goToArticle("320", { replace: true });
    return;
  }
  state.activeArticleNumber = next;
  state.activeSegmentId = null;
  state.openMemos.clear();
  await persistPreference("lastArticleNumber", next);
  render();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function selectSegment(segmentId, destination) {
  state.activeSegmentId = segmentId;
  render();
  scrollToTarget(destination === "text" ? `text-${segmentId}` : `explain-${segmentId}`);
}

async function toggleBookmark() {
  const article = currentArticle();
  if (!article) return;
  if (state.bookmarks.has(article.id)) {
    state.bookmarks.delete(article.id);
    await storage.remove("bookmarks", article.id);
    showToast("しおりを外しました");
  } else {
    state.bookmarks.add(article.id);
    await storage.put("bookmarks", { articleId: article.id, createdAt: new Date().toISOString() });
    showToast("しおりに追加しました");
  }
  render();
}

async function copyCurrentLaw() {
  const article = currentArticle();
  const text = [article.displayNumber, ...article.provisions.map((provision) => `${provision.itemMark ? `${provision.itemMark}　` : ""}${provision.segments.map((segment) => segment.text).join("")}`)].join("\n");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  showToast("条文をコピーしました");
}

function memoStatus(textarea, message, failed = false) {
  const status = textarea.closest(".memo-area")?.querySelector(".memo-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", failed);
}

function scheduleMemoSave(provision, textarea, immediate) {
  pendingNoteValues.set(provision.id, { provision, value: textarea.value, textarea });
  clearTimeout(noteTimers.get(provision.id));
  if (immediate) {
    persistPendingMemo(provision.id);
  } else {
    memoStatus(textarea, "保存中…");
    noteTimers.set(provision.id, window.setTimeout(() => persistPendingMemo(provision.id), 500));
  }
}

async function incrementEditCount() {
  const previous = await storage.get("meta", "editCountSinceExport");
  await storage.put("meta", { key: "editCountSinceExport", value: Number(previous?.value || 0) + 1 });
}

async function persistPendingMemo(provisionId) {
  clearTimeout(noteTimers.get(provisionId));
  noteTimers.delete(provisionId);
  const pending = pendingNoteValues.get(provisionId);
  if (!pending) return;
  pendingNoteValues.delete(provisionId);
  const { provision, value, textarea } = pending;
  const previous = state.notes.get(provision.id);
  try {
    if (value.trim()) {
      const note = { provisionId: provision.id, articleId: currentArticle().id, value, updatedAt: new Date().toISOString(), contentVersion: CONTENT_VERSION };
      await storage.put("notes", note);
      state.notes.set(provision.id, note);
      memoStatus(textarea, `保存済み ${new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`);
    } else {
      await storage.remove("notes", provision.id);
      state.notes.delete(provision.id);
      memoStatus(textarea, "未入力");
      if (previous?.value) {
        undoNote = previous;
        showToast("メモを削除しました", { label: "元に戻す", run: async () => {
          await storage.put("notes", undoNote);
          state.notes.set(undoNote.provisionId, undoNote);
          render();
          showToast("メモを戻しました");
        } });
      }
    }
    await incrementEditCount();
  } catch {
    memoStatus(textarea, "端末に保存できません。先にバックアップを書き出してください。", true);
  }
}

function closeOverlay() {
  if (!activeOverlay) return;
  overlayRoot.replaceChildren();
  if (overlayKeyHandler) document.removeEventListener("keydown", overlayKeyHandler);
  activeOverlay = null;
  overlayKeyHandler = null;
  const origin = overlayOrigin;
  overlayOrigin = null;
  origin?.focus?.();
}

function trapOverlayFocus(event, panel) {
  if (event.key === "Escape") {
    closeOverlay();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...panel.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]")];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function setOverlay(title, body, kind = "sheet") {
  closeOverlay();
  overlayOrigin = document.activeElement;
  const { backdrop, panel } = createOverlay({ title, body, kind, onClose: closeOverlay });
  activeOverlay = backdrop;
  overlayRoot.replaceChildren(backdrop);
  overlayKeyHandler = (event) => trapOverlayFocus(event, panel);
  document.addEventListener("keydown", overlayKeyHandler);
  requestAnimationFrame(() => panel.querySelector("input, button, textarea, a[href]")?.focus());
}

function openOverlay(kind) {
  if (!catalog) return;
  if (kind === "articles") {
    setOverlay("収録条文", articleListBody(catalog, state.activeArticleNumber, navigate), "side-sheet");
  } else if (kind === "search") {
    setOverlay("検索", searchBody({ onSearch: (query) => searchArticles(catalog, query), onNavigate: navigate }));
  } else if (kind === "bookmarks") {
    setOverlay("しおり", bookmarksBody(catalog, state.bookmarks, navigate));
  } else if (kind === "settings") {
    setOverlay("設定", settingsBody({
      state,
      version,
      sourceUrl: catalog.law.sourceUrl,
      onTheme: async (value) => { state.theme = value; applyVisualPreferences(); await persistPreference("theme", value); },
      onFontScale: async (value) => { state.fontScale = value; applyVisualPreferences(); await persistPreference("fontScale", value); },
      onExport: exportBackup,
      onImport: () => importFile.click()
    }));
  }
}

async function exportBackup() {
  try {
    const snapshot = await storage.snapshot();
    downloadBackup(backupPayload(snapshot, version));
    await storage.put("meta", { key: "lastExportedAt", value: new Date().toISOString() });
    await storage.put("meta", { key: "editCountSinceExport", value: 0 });
    showToast("バックアップを書き出しました");
  } catch {
    showToast("バックアップを書き出せませんでした");
  }
}

function filteredPreferences(preferences) {
  const result = {};
  for (const [key, value] of Object.entries(preferences || {})) if (validPreferenceValues[key]?.has(value)) result[key] = value;
  return result;
}

async function applyImport(parsed, conflictPolicy) {
  const importedNotes = new Map(parsed.notes.map((note) => [note.provisionId, note]));
  const writes = [];
  for (const [id, note] of importedNotes) {
    const existing = state.notes.get(id);
    if (!existing || existing.value === note.value || conflictPolicy === "replace") writes.push(note);
  }
  const importedBookmarks = parsed.bookmarks.filter((bookmark) => !state.bookmarks.has(bookmark.articleId));
  const preferences = filteredPreferences(parsed.preferences);
  await storage.putMany({ notes: writes, bookmarks: importedBookmarks, preferences });
  for (const note of writes) state.notes.set(note.provisionId, note);
  for (const bookmark of importedBookmarks) state.bookmarks.add(bookmark.articleId);
  for (const [key, value] of Object.entries(preferences)) state[key] = value;
  applyVisualPreferences();
  closeOverlay();
  render();
  const ignoredMessage = parsed.ignored ? ` 対象外の${parsed.ignored}件は変更していません。` : "";
  showToast(`${writes.length}件のメモを読み込みました。${ignoredMessage}`);
}

async function handleImportFile(file) {
  if (!file) return;
  if (file.size > 1024 * 1024) {
    showToast("このファイルは読み込めません。刑訴条文ナビのバックアップJSONを選んでください。");
    return;
  }
  try {
    const provisionIds = new Set([...articles.values()].flatMap(({ article }) => article.provisions.map((provision) => provision.id)));
    const articleIds = new Set(catalog.articles.map((article) => article.id));
    const parsed = parseImport(await file.text(), provisionIds, articleIds);
    if (!parsed.notes.length && !parsed.bookmarks.length) {
      showToast("320条から322条に対応するメモはありませんでした。");
      return;
    }
    const conflicts = parsed.notes.filter((note) => state.notes.has(note.provisionId) && state.notes.get(note.provisionId).value !== note.value);
    if (!conflicts.length) {
      await applyImport(parsed, "keep");
      return;
    }
    setOverlay("メモの競合", conflictBody(
      conflicts.length,
      () => applyImport(parsed, "keep"),
      () => applyImport(parsed, "replace"),
      closeOverlay
    ), "dialog-panel");
  } catch {
    showToast("このファイルは読み込めません。刑訴条文ナビのバックアップJSONを選んでください。");
  }
}

async function loadData() {
  const [catalogResponse, versionResponse] = await Promise.all([
    fetch(`./data/catalog.json?cv=${CONTENT_VERSION}`),
    fetch("./version.json", { cache: "no-store" })
  ]);
  if (!catalogResponse.ok || !versionResponse.ok) throw new Error("Data load failed");
  catalog = await catalogResponse.json();
  version = await versionResponse.json();
  const loaded = await Promise.all(catalog.articles.map(async (item) => {
    const response = await fetch(`${item.href}?cv=${CONTENT_VERSION}`);
    if (!response.ok) throw new Error(`Article ${item.number} load failed`);
    const json = await response.json();
    return [item.number, json];
  }));
  articles = new Map(loaded);
}

async function initialize() {
  try {
    storage = await createStorage();
    state.storageMode = storage.mode;
    await loadData();
    const snapshot = await storage.snapshot();
    state.notes = new Map(snapshot.notes.map((note) => [note.provisionId, note]));
    state.bookmarks = new Set(snapshot.bookmarks.map((bookmark) => bookmark.articleId));
    const preferences = { ...defaults, ...filteredPreferences(snapshot.preferences) };
    state.theme = preferences.theme;
    state.fontScale = preferences.fontScale;
    state.displayMode = preferences.displayMode;
    state.activeArticleNumber = routeNumber() || preferences.lastArticleNumber || "320";
    state.verifiedLabel = new Date(`${version.verifiedAt}T00:00:00+09:00`).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
    applyVisualPreferences();
    if (!routeNumber()) goToArticle(state.activeArticleNumber, { replace: true });
    else await handleRoute(routeNumber());
    render();
    onRouteChange(handleRoute);
    document.getElementById("header-search").addEventListener("click", () => openOverlay("search"));
    document.getElementById("header-settings").addEventListener("click", () => openOverlay("settings"));
    document.querySelectorAll("[data-overlay]").forEach((button) => button.addEventListener("click", () => openOverlay(button.dataset.overlay)));
    document.getElementById("apply-update").addEventListener("click", () => pwa?.applyUpdate());
    document.getElementById("dismiss-update").addEventListener("click", () => { updateBanner.hidden = true; });
    importFile.addEventListener("change", async () => { const [file] = importFile.files || []; await handleImportFile(file); importFile.value = ""; });
    window.addEventListener("online", updateConnectionLabel);
    window.addEventListener("offline", updateConnectionLabel);
    window.addEventListener("pagehide", () => { for (const provisionId of [...pendingNoteValues.keys()]) persistPendingMemo(provisionId); });
    pwa = await registerPwa({
      onState: ({ ready }) => { state.offlineReady = ready; updateConnectionLabel(); },
      onUpdate: () => { updateBanner.hidden = false; }
    });
    updateConnectionLabel();
    if (state.storageMode === "memory") showToast("端末に保存できません。先にバックアップを書き出してください。");
  } catch (error) {
    main.replaceChildren(Object.assign(document.createElement("div"), { className: "error-state", textContent: "条文データを読み込めませんでした。通信できる状態で再試行してください。" }));
    console.error(error);
  }
}

initialize();
