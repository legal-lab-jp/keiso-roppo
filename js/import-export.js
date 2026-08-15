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
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    appVersion: version.appVersion,
    contentVersion: version.contentVersion,
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

function validLegacyNotes(source) {
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

function validNewNotes(notes, validProvisionIds) {
  if (!Array.isArray(notes)) return [];
  return notes.filter((note) => (
    note && typeof note === "object"
    && validProvisionIds.has(note.provisionId)
    && typeof note.value === "string"
    && note.value.trim()
  )).map((note) => ({
    provisionId: note.provisionId,
    articleId: note.articleId,
    value: note.value,
    updatedAt: typeof note.updatedAt === "string" ? note.updatedAt : new Date().toISOString(),
    contentVersion: "2026-08-15.test1"
  }));
}

export function parseImport(text, validProvisionIds, validArticleIds) {
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error("invalid-json"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid-shape");

  if (payload.format === "keiso-roppo-user-data") {
    const notes = validNewNotes(payload.notes, validProvisionIds);
    const bookmarks = Array.isArray(payload.bookmarks)
      ? payload.bookmarks.filter((item) => item && validArticleIds.has(item.articleId)).map((item) => ({ articleId: item.articleId, createdAt: item.createdAt || new Date().toISOString() }))
      : [];
    const preferences = payload.preferences && typeof payload.preferences === "object" && !Array.isArray(payload.preferences) ? payload.preferences : {};
    return { notes, bookmarks, preferences, ignored: (Array.isArray(payload.notes) ? payload.notes.length : 0) - notes.length };
  }

  if (payload.format === "criminal-procedure-key-articles-2027-memos" || payload.format === "criminal-procedure-key-articles-2027-local-memos") {
    return { ...validLegacyNotes(payload.memos), bookmarks: [], preferences: {} };
  }

  return { ...validLegacyNotes(payload), bookmarks: [], preferences: {} };
}
