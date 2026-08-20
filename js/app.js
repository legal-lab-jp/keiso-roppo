import { goToArticle, goToView, onRouteChange, parseRoute } from "./router.js";
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
  renderNotFound,
  renderRail,
  searchBody,
  settingsBody,
  sourcesBody
} from "./render.js";

const CONTENT_VERSION = "2026-08-15.exam114.1";
const defaults = {
  theme: "system",
  fontScale: "standard",
  displayMode: "law",
  lastArticleNumber: "320",
  listMode: "statute",
  priorityFilter: "all",
  topicFilter: "all",
  recentArticles: []
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
  openMemos: new Set(),
  theme: "system",
  fontScale: "standard",
  listMode: "statute",
  priorityFilter: "all",
  topicFilter: "all",
  recentArticles: [],
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
  return articles.get(state.activeArticleNumber) ?? null;
}

function visibleArticles() {
  const filtered = catalog.articles.filter((article) => {
    const priority = state.priorityFilter === "all"
      || (state.priorityFilter === "essayA" && article.essayPriority === "A")
      || (state.priorityFilter === "preliminaryShortA" && article.preliminaryShortPriority === "A")
      || (state.priorityFilter === "supplementalBB" && article.essayPriority === "B" && article.preliminaryShortPriority === "B");
    const topic = state.topicFilter === "all" || article.topic === state.topicFilter;
    return priority && topic;
  });
  if (state.listMode !== "topic") return filtered;
  const topicOrder = new Map(catalog.topics.map((topic, index) => [topic.name, index]));
  return [...filtered].sort((left, right) => topicOrder.get(left.topic) - topicOrder.get(right.topic) || left.order - right.order);
}

function render() {
  if (!catalog) return;
  renderRail(rail, catalog, { ...state, bookmarkCount: state.bookmarks.size }, {
    getVisibleArticles: visibleArticles,
    onNavigate: navigate,
    onFilterChange: updateListPreference,
    onOpenBookmarks: () => goToView("bookmarks"),
    onOpenSources: () => goToView("sources"),
    onOpenSettings: () => goToView("settings")
  });
  const current = currentArticle();
  if (current) {
    renderArticle(main, current, state, state.notes, state.bookmarks, {
      onToggleStudy: toggleStudy,
      onBookmark: toggleBookmark,
      onCopy: copyCurrentLaw,
      onNavigate: navigate,
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
  }
  applyVisualPreferences();
}

function renderUnknownRoute() {
  renderRail(rail, catalog, { ...state, bookmarkCount: state.bookmarks.size }, {
    getVisibleArticles: visibleArticles,
    onNavigate: navigate,
    onFilterChange: updateListPreference,
    onOpenBookmarks: () => goToView("bookmarks"),
    onOpenSources: () => goToView("sources"),
    onOpenSettings: () => goToView("settings")
  });
  renderNotFound(main, catalog, navigate);
  applyVisualPreferences();
}

function updateRecent(routeNumber) {
  state.recentArticles = [routeNumber, ...state.recentArticles.filter((item) => item !== routeNumber)].slice(0, 20);
  return persistPreference("recentArticles", state.recentArticles);
}

function closeOverlay({ preserveRoute = false } = {}) {
  if (!activeOverlay) return;
  overlayRoot.replaceChildren();
  if (overlayKeyHandler) document.removeEventListener("keydown", overlayKeyHandler);
  activeOverlay = null;
  overlayKeyHandler = null;
  const origin = overlayOrigin;
  overlayOrigin = null;
  origin?.focus?.();
  if (!preserveRoute && parseRoute().kind !== "article") goToArticle(state.activeArticleNumber, { replace: true });
}

function trapOverlayFocus(event, panel) {
  if (event.key === "Escape") {
    closeOverlay();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...panel.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]")];
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
  closeOverlay({ preserveRoute: true });
  overlayOrigin = document.activeElement;
  const { backdrop, panel } = createOverlay({ title, body, kind, onClose: closeOverlay });
  activeOverlay = backdrop;
  overlayRoot.replaceChildren(backdrop);
  overlayKeyHandler = (event) => trapOverlayFocus(event, panel);
  document.addEventListener("keydown", overlayKeyHandler);
  requestAnimationFrame(() => panel.querySelector("input, button, select, textarea, a[href]")?.focus());
}

function openOverlay(kind, query = "") {
  if (!catalog) return;
  const articleHandlers = {
    getVisibleArticles: visibleArticles,
    onNavigate: navigate,
    onFilterChange: updateListPreference
  };
  if (kind === "articles") setOverlay("収録条文", articleListBody({ catalog, state, handlers: articleHandlers }), "side-sheet");
  if (kind === "search") setOverlay("検索", searchBody({ onSearch: (value) => searchArticles(catalog, articles, value), onNavigate: navigate, initialQuery: query }));
  if (kind === "bookmarks") setOverlay("しおり", bookmarksBody(catalog, state.bookmarks, navigate));
  if (kind === "settings") setOverlay("設定", settingsBody({
    state,
    version,
    catalog,
    onTheme: async (value) => { state.theme = value; applyVisualPreferences(); await persistPreference("theme", value); },
    onFontScale: async (value) => { state.fontScale = value; applyVisualPreferences(); await persistPreference("fontScale", value); },
    onExport: exportBackup,
    onImport: () => importFile.click()
  }));
  if (kind === "sources") setOverlay("出典", sourcesBody(catalog, version));
}

async function navigate(routeNumber) {
  if (!articles.has(String(routeNumber))) return;
  closeOverlay({ preserveRoute: true });
  goToArticle(String(routeNumber));
}

async function handleRoute(route) {
  if (route.kind === "article") {
    if (!articles.has(route.routeNumber)) {
      closeOverlay({ preserveRoute: true });
      renderUnknownRoute();
      return;
    }
    state.activeArticleNumber = route.routeNumber;
    state.openMemos.clear();
    const preferenceWrites = [
      persistPreference("lastArticleNumber", route.routeNumber),
      updateRecent(route.routeNumber)
    ];
    closeOverlay({ preserveRoute: true });
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
    const writeResults = await Promise.allSettled(preferenceWrites);
    if (writeResults.some((result) => result.status === "rejected")) console.warn("条文の閲覧履歴を端末に保存できませんでした。");
    return;
  }
  if (["articles", "bookmarks", "search", "settings", "sources"].includes(route.kind)) {
    render();
    openOverlay(route.kind, route.query);
    return;
  }
  closeOverlay({ preserveRoute: true });
  renderUnknownRoute();
}

async function updateListPreference(key, value) {
  state[key] = value;
  await persistPreference(key, value);
  render();
  if (parseRoute().kind === "articles") openOverlay("articles");
}

async function toggleStudy() {
  state.displayMode = state.displayMode === "law" ? "study" : "law";
  await persistPreference("displayMode", state.displayMode);
  render();
}

async function toggleBookmark() {
  const current = currentArticle();
  if (!current) return;
  const articleId = current.statute.article.id;
  if (state.bookmarks.has(articleId)) {
    state.bookmarks.delete(articleId);
    await storage.remove("bookmarks", articleId);
    showToast("しおりを外しました");
  } else {
    state.bookmarks.add(articleId);
    await storage.put("bookmarks", { articleId, createdAt: new Date().toISOString() });
    showToast("しおりに追加しました");
  }
  render();
}

async function copyCurrentLaw() {
  const current = currentArticle();
  if (!current) return;
  const law = current.statute.article;
  const text = `${law.displayNumber}${law.officialCaption ? ` ${law.officialCaption}` : ""}\n${law.paragraphs.map((paragraph) => paragraph.plainText).join("\n")}`;
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
    noteTimers.set(provision.id, window.setTimeout(() => persistPendingMemo(provision.id), 1000));
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
      const note = {
        provisionId: provision.id,
        articleId: currentArticle().statute.article.id,
        value,
        updatedAt: new Date().toISOString(),
        contentVersion: CONTENT_VERSION
      };
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

function validPreferences(preferences) {
  const result = {};
  if (["system", "light", "dark"].includes(preferences.theme)) result.theme = preferences.theme;
  if (["small", "standard", "large"].includes(preferences.fontScale)) result.fontScale = preferences.fontScale;
  if (["law", "study"].includes(preferences.displayMode)) result.displayMode = preferences.displayMode;
  if (["statute", "topic"].includes(preferences.listMode)) result.listMode = preferences.listMode;
  if (["all", "essayA", "preliminaryShortA", "supplementalBB"].includes(preferences.priorityFilter)) result.priorityFilter = preferences.priorityFilter;
  if (preferences.topicFilter === "all" || catalog.topics.some((topic) => topic.name === preferences.topicFilter)) result.topicFilter = preferences.topicFilter;
  if (articles.has(preferences.lastArticleNumber)) result.lastArticleNumber = preferences.lastArticleNumber;
  if (Array.isArray(preferences.recentArticles)) result.recentArticles = preferences.recentArticles.filter((route) => articles.has(route)).slice(0, 20);
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
  const preferences = validPreferences(parsed.preferences);
  await storage.putMany({ notes: writes, bookmarks: importedBookmarks, preferences });
  for (const note of writes) state.notes.set(note.provisionId, note);
  for (const bookmark of importedBookmarks) state.bookmarks.add(bookmark.articleId);
  Object.assign(state, preferences);
  applyVisualPreferences();
  closeOverlay();
  render();
  const ignored = parsed.ignored ? ` 対象外の${parsed.ignored}件は変更していません。` : "";
  showToast(`${writes.length}件のメモを読み込みました。${ignored}`);
}

function collectOfficialNoteIds(article) {
  const ids = new Set();
  const scan = (blocks) => {
    for (const block of blocks) {
      if (block.kind === "item") { ids.add(block.item.id); scan(block.item.blocks); }
      if (block.kind === "subitem1" || block.kind === "subitem2") { ids.add(block.subitem.id); scan(block.subitem.blocks); }
      if (block.kind === "columns") for (const column of block.columns) scan(column.blocks);
    }
  };
  for (const paragraph of article.paragraphs) {
    ids.add(paragraph.id);
    ids.add(paragraph.noteTargetId);
    scan(paragraph.blocks);
  }
  return ids;
}

async function handleImportFile(file) {
  if (!file) return;
  if (file.size > 1024 * 1024) {
    showToast("このファイルは読み込めません。刑訴条文ナビのバックアップJSONを選んでください。");
    return;
  }
  try {
    const provisionIds = new Set();
    for (const current of articles.values()) {
      for (const id of collectOfficialNoteIds(current.statute.article)) provisionIds.add(id);
      for (const provision of current.study.study.provisions) provisionIds.add(provision.id);
    }
    const articleIds = new Set(catalog.articles.map((article) => article.id));
    const parsed = parseImport(await file.text(), provisionIds, articleIds, CONTENT_VERSION);
    if (!parsed.notes.length && !parsed.bookmarks.length) {
      showToast("収録114条に対応するメモ又はしおりはありませんでした。");
      return;
    }
    const conflicts = parsed.notes.filter((note) => state.notes.has(note.provisionId) && state.notes.get(note.provisionId).value !== note.value);
    if (!conflicts.length) {
      await applyImport(parsed, "keep");
      return;
    }
    setOverlay("メモの競合", conflictBody(conflicts.length, () => applyImport(parsed, "keep"), () => applyImport(parsed, "replace"), closeOverlay), "dialog-panel");
  } catch {
    showToast("このファイルは読み込めません。刑訴条文ナビのバックアップJSONを選んでください。");
  }
}

async function loadData() {
  const [catalogResponse, versionResponse] = await Promise.all([
    fetch("./data/catalog.json"),
    fetch("./version.json", { cache: "no-store" })
  ]);
  if (!catalogResponse.ok || !versionResponse.ok) throw new Error("Data load failed");
  catalog = await catalogResponse.json();
  version = await versionResponse.json();
  if (catalog.contentVersion !== CONTENT_VERSION || version.contentVersion !== CONTENT_VERSION || catalog.selectionVersion !== version.selectionVersion) throw new Error("Content version mismatch");
  const loaded = await Promise.all(catalog.articles.map(async (meta) => {
    const [statuteResponse, studyResponse] = await Promise.all([fetch(meta.statuteHref), fetch(meta.studyHref)]);
    if (!statuteResponse.ok || !studyResponse.ok) throw new Error(`Article ${meta.routeNumber} load failed`);
    const [statute, study] = await Promise.all([statuteResponse.json(), studyResponse.json()]);
    if (statute.article.id !== meta.id || study.articleId !== meta.id || statute.contentVersion !== CONTENT_VERSION || study.contentVersion !== CONTENT_VERSION) throw new Error(`Article ${meta.routeNumber} version mismatch`);
    return [meta.routeNumber, { meta, statute, study }];
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
    Object.assign(state, defaults, validPreferences(snapshot.preferences));
    state.verifiedLabel = new Date(`${version.verifiedAt}T00:00:00+09:00`).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
    applyVisualPreferences();
    onRouteChange(handleRoute);
    if (!window.location.hash) goToArticle(state.activeArticleNumber, { replace: true });
    else await handleRoute(parseRoute());
    document.getElementById("header-search").addEventListener("click", () => goToView("search"));
    document.getElementById("header-settings").addEventListener("click", () => goToView("settings"));
    document.querySelectorAll("[data-overlay]").forEach((button) => button.addEventListener("click", () => goToView(button.dataset.overlay)));
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
    console.error(error);
    main.replaceChildren(Object.assign(document.createElement("div"), { className: "error-state", textContent: "条文データを読み込めませんでした。通信できる状態で再試行してください。" }));
  }
}

initialize();
