export const LEGACY_KEY_MAP = {
  "320::第320条第1項": "jp-323AC0000000131-a320-p1",
  "320::第320条第2項": "jp-323AC0000000131-a320-p2",
  "321::第321条第1項柱書": "jp-323AC0000000131-a321-p1-intro",
  "321::第321条第1項第1号": "jp-323AC0000000131-a321-p1-i1",
  "321::第321条第1項第2号": "jp-323AC0000000131-a321-p1-i2",
  "321::第321条第1項第3号": "jp-323AC0000000131-a321-p1-i3",
  "321::第321条第2項": "jp-323AC0000000131-a321-p2",
  "321::第321条第3項": "jp-323AC0000000131-a321-p3",
  "321::第321条第4項": "jp-323AC0000000131-a321-p4",
  "322::第322条第1項": "jp-323AC0000000131-a322-p1",
  "322::第322条第2項": "jp-323AC0000000131-a322-p2"
};

export function backupPayload(snapshot, version) {
  return {
    format: "keiso-roppo-user-data",
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    appVersion: version.appVersion,
    contentVersion: version.contentVersion,
    selectionVersion: version.selectionVersion,
    notes: snapshot.notes,
    bookmarks: snapshot.bookmarks,
    preferences: snapshot.preferences
  };
}

export function downloadBackup(payload) {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(/:/g, "-");
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `刑訴条文ナビ_バックアップ_${stamp}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

function legacyNotes(source) {
  const notes = [];
  let ignored = 0;
  for (const [key, value] of Object.entries(source || {})) {
    const provisionId = LEGACY_KEY_MAP[key];
    if (!provisionId || typeof value !== "string" || !value.trim()) {
      ignored += 1;
      continue;
    }
    notes.push({
      provisionId,
      articleId: provisionId.slice(0, provisionId.lastIndexOf("-p")),
      value,
      updatedAt: new Date().toISOString(),
      contentVersion: "2026-08-15.test1"
    });
  }
  return { notes, ignored };
}

function validNotes(notes, validProvisionIds, contentVersion) {
  if (!Array.isArray(notes)) return [];
  return notes.filter((note) => (
    note && typeof note === "object"
    && validProvisionIds.has(note.provisionId)
    && typeof note.value === "string"
    && note.value.trim()
    && note.value.length <= 100000
  )).map((note) => ({
    provisionId: note.provisionId,
    articleId: typeof note.articleId === "string" ? note.articleId : note.provisionId.slice(0, note.provisionId.lastIndexOf("-p")),
    value: note.value,
    updatedAt: typeof note.updatedAt === "string" ? note.updatedAt : new Date().toISOString(),
    contentVersion
  }));
}

export function parseImport(text, validProvisionIds, validArticleIds, contentVersion) {
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error("invalid-json"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid-shape");

  if (payload.format === "keiso-roppo-user-data") {
    if (![1, 2].includes(payload.schemaVersion)) throw new Error("unsupported-schema");
    const notes = validNotes(payload.notes, validProvisionIds, contentVersion);
    const bookmarks = Array.isArray(payload.bookmarks)
      ? payload.bookmarks.filter((item) => item && validArticleIds.has(item.articleId)).map((item) => ({ articleId: item.articleId, createdAt: item.createdAt || new Date().toISOString() }))
      : [];
    const preferences = payload.preferences && typeof payload.preferences === "object" && !Array.isArray(payload.preferences) ? payload.preferences : {};
    const ignored = (Array.isArray(payload.notes) ? payload.notes.length : 0) - notes.length;
    return { notes, bookmarks, preferences, ignored };
  }

  if (payload.format === "criminal-procedure-key-articles-2027-memos" || payload.format === "criminal-procedure-key-articles-2027-local-memos") {
    return { ...legacyNotes(payload.memos), bookmarks: [], preferences: {} };
  }

  return { ...legacyNotes(payload), bookmarks: [], preferences: {} };
}
