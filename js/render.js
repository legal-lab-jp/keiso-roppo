const roleNames = { actor: "主体", requirement: "要件", limit: "例外・限定", effect: "効果" };

function node(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.id) element.id = options.id;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.type) element.type = options.type;
  if (options.hidden !== undefined) element.hidden = options.hidden;
  if (options.value !== undefined) element.value = options.value;
  if (options.placeholder !== undefined) element.placeholder = options.placeholder;
  if (options.attrs) for (const [key, value] of Object.entries(options.attrs)) element.setAttribute(key, value);
  if (options.on) for (const [event, listener] of Object.entries(options.on)) element.addEventListener(event, listener);
  for (const child of children.flat()) {
    if (child !== null && child !== undefined) element.append(child);
  }
  return element;
}

function button(text, onClick, options = {}) {
  return node("button", {
    className: options.className || "secondary-button",
    type: "button",
    text,
    attrs: options.attrs,
    on: { click: onClick }
  });
}

function iconButton(symbol, label, onClick, active = false) {
  return button(symbol, onClick, {
    className: `article-action${active ? " is-active" : ""}`,
    attrs: { "aria-label": label, title: label, "aria-pressed": String(active) }
  });
}

export function renderRail(root, catalog, activeNumber, bookmarks, onNavigate, onOpenBookmarks, onOpenSettings) {
  const list = node("div", { className: "rail-list" });
  for (const article of catalog.articles) {
    const selected = article.number === activeNumber;
    const item = button("", () => onNavigate(article.number), {
      className: `rail-article${selected ? " is-active" : ""}`,
      attrs: { "aria-current": selected ? "page" : "false" }
    });
    item.append(
      node("strong", { text: `${article.number}条` }),
      node("span", { text: article.title })
    );
    list.append(item);
  }
  root.replaceChildren(
    node("div", { className: "rail-heading" }, [
      node("strong", { text: "収録条文" }),
      node("span", { text: "3条を収録" })
    ]),
    list,
    node("div", { className: "rail-footer" }, [
      button(`しおり${bookmarks.size ? ` ${bookmarks.size}` : ""}`, onOpenBookmarks, { className: "rail-utility" }),
      button("設定", onOpenSettings, { className: "rail-utility" })
    ])
  );
}

function makeSegment(segment, state, onSelect) {
  const study = state.displayMode === "study";
  const selected = state.activeSegmentId === segment.id;
  const element = node("span", {
    id: `text-${segment.id}`,
    className: `statute-segment role-${segment.role}${study ? " is-study" : ""}${selected ? " is-selected" : ""}`,
    text: segment.text,
    attrs: study ? {
      role: "button",
      tabindex: "0",
      "aria-describedby": `explain-${segment.id}`,
      "aria-label": `${roleNames[segment.role]}。${segment.tag}。${segment.text}`
    } : {}
  });
  if (study) {
    element.addEventListener("click", () => onSelect(segment.id, "explanation"));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(segment.id, "explanation");
      }
    });
  }
  return element;
}

function renderProvisionText(provision, state, handlers) {
  const section = node("section", { className: `statute-provision${provision.item ? " statute-item" : ""}` });
  const label = provision.itemMark ? `${provision.itemMark}　${provision.label}` : provision.label;
  section.append(node("h2", { className: "visually-hidden", text: label }));
  const text = node("p", { className: "statute-text" });
  if (provision.itemMark) text.append(node("span", { className: "item-mark", text: `${provision.itemMark}　` }));
  for (const segment of provision.segments) text.append(makeSegment(segment, state, handlers.onSegment));
  section.append(text);
  return section;
}

function renderRelated(article, handlers) {
  const nav = node("nav", { className: "related-row", attrs: { "aria-label": `${article.number}条の関連条文` } });
  nav.append(node("strong", { text: "関連条文" }));
  for (const related of article.related) {
    if (related.available) {
      nav.append(button(`${related.number}条`, () => handlers.onRelated(related.number), { className: "related-chip" }));
    } else {
      nav.append(node("span", { className: "related-chip is-unavailable", text: `${related.number}条 未収録` }));
    }
  }
  return nav;
}

function renderStudy(article, state, notes, handlers) {
  const section = node("section", { className: "study-section", attrs: { "aria-label": `${article.number}条の学習解説` } });
  section.append(node("p", { className: "study-notice", text: "学習用解説です。公式の注釈ではありません。" }));
  const intro = node("div", { className: "study-intro" }, [
    node("div", { className: "study-card" }, [node("strong", { text: "この条文を開く場面" }), node("p", { text: article.trigger })]),
    node("div", { className: "study-card" }, [node("strong", { text: "条文の役割・趣旨" }), node("p", { text: article.overview })])
  ]);
  const learning = node("div", { className: "learning-grid" }, [
    node("div", { className: "learning-card" }, [node("strong", { text: "覚える" }), node("p", { text: article.learning.remember })]),
    node("div", { className: "learning-card" }, [node("strong", { text: "理解する" }), node("p", { text: article.learning.understand })]),
    node("div", { className: "learning-card" }, [node("strong", { text: "見ればよい" }), node("p", { text: article.learning.lookup })])
  ]);
  const legend = node("div", { className: "marker-legend", attrs: { "aria-label": "条文マーカーの凡例" } });
  for (const role of ["actor", "requirement", "limit", "effect"]) legend.append(node("span", { className: `legend-item role-${role}`, text: roleNames[role] }));
  section.append(intro, learning, legend);

  const explanations = node("div", { className: "explanation-list" });
  for (const provision of article.provisions) {
    const card = node("section", { className: "explanation-card", attrs: { "aria-label": provision.label } });
    card.append(
      node("div", { className: "explanation-heading" }, [
        node("strong", { text: provision.itemMark ? `${provision.itemMark}　${provision.label}` : provision.label }),
        node("span", { className: "study-badge", text: provision.studyTitle })
      ]),
      node("p", { className: "purpose-text", text: provision.purpose })
    );
    const segmentList = node("div", { className: "explanation-segments" });
    for (const segment of provision.segments) {
      const selected = state.activeSegmentId === segment.id;
      const segmentButton = button("", () => handlers.onSegment(segment.id, "text"), {
        className: `explanation-segment role-${segment.role}${selected ? " is-selected" : ""}`,
        attrs: { id: `explain-${segment.id}`, "aria-pressed": String(selected) }
      });
      segmentButton.append(
        node("span", { className: "role-label", text: roleNames[segment.role] }),
        node("strong", { text: segment.tag }),
        node("span", { text: segment.text })
      );
      segmentList.append(segmentButton);
    }
    card.append(segmentList);

    const memo = notes.get(provision.id)?.value || "";
    const memoOpen = state.openMemos.has(provision.id);
    const memoArea = node("div", { className: "memo-area", hidden: !memoOpen });
    const memoId = `memo-${provision.id}`;
    const textarea = node("textarea", {
      id: memoId,
      className: "memo-input",
      value: memo,
      placeholder: "自分の理解、判例、疑問を残せます。",
      attrs: { "aria-label": `${provision.label}への自分のメモ`, rows: "4" },
      on: {
        input: (event) => handlers.onMemoInput(provision, event.target),
        blur: (event) => handlers.onMemoBlur(provision, event.target)
      }
    });
    memoArea.append(
      node("label", { className: "memo-label", text: `${provision.label}への自分のメモ`, attrs: { for: memoId } }),
      textarea,
      node("div", { className: "memo-footer" }, [
        node("span", { className: "memo-status", text: memo ? "保存済み" : "未入力" }),
        button("閉じる", () => handlers.onCloseMemo(provision.id), { className: "text-button" })
      ])
    );
    card.append(button(memo ? "メモあり・表示" : "この項・号にメモ", () => handlers.onOpenMemo(provision.id), { className: `memo-toggle${memo ? " has-memo" : ""}` }), memoArea);
    explanations.append(card);
  }
  section.append(explanations);
  return section;
}

export function renderArticle(root, article, state, notes, bookmarks, handlers) {
  const articleNode = node("article", { className: "article-view" });
  articleNode.append(node("nav", { className: "breadcrumb", text: article.path.join(" ＞ "), attrs: { "aria-label": "法令上の位置" } }));
  articleNode.append(node("p", { className: "article-number", text: article.displayNumber }));
  articleNode.append(node("h1", { text: article.title }));
  articleNode.append(node("p", { className: "article-meta", text: `現行法・${state.verifiedLabel}確認` }));
  const actions = node("div", { className: "article-actions" }, [
    iconButton(bookmarks.has(article.id) ? "★" : "☆", bookmarks.has(article.id) ? "しおりを外す" : "しおりに追加", handlers.onBookmark, bookmarks.has(article.id)),
    button("条文をコピー", handlers.onCopy, { className: "secondary-button" })
  ]);
  articleNode.append(actions);
  const law = node("section", { className: "law-text", attrs: { "aria-label": `${article.displayNumber}の条文本文` } });
  for (const provision of article.provisions) law.append(renderProvisionText(provision, state, handlers));
  articleNode.append(law);
  articleNode.append(button(state.displayMode === "study" ? "六法表示に戻す" : "学習解説を開く", handlers.onToggleStudy, { className: "study-toggle", attrs: { "aria-expanded": String(state.displayMode === "study") } }));
  if (state.displayMode === "study") articleNode.append(renderStudy(article, state, notes, handlers));
  articleNode.append(renderRelated(article, handlers));
  root.replaceChildren(articleNode);
}

export function createOverlay({ title, onClose, body, kind = "sheet" }) {
  const backdrop = node("div", { className: "overlay-backdrop", on: { click: (event) => { if (event.target === backdrop) onClose(); } } });
  const panel = node("aside", { className: `overlay-panel ${kind}`, attrs: { role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1" } });
  panel.append(node("div", { className: "overlay-heading" }, [node("h2", { text: title }), button("閉じる", onClose, { className: "close-button", attrs: { "aria-label": `${title}を閉じる` } })]), body);
  backdrop.append(panel);
  return { backdrop, panel };
}

export function articleListBody(catalog, activeNumber, onNavigate) {
  const body = node("div", { className: "overlay-body article-list-body" });
  body.append(node("p", { className: "overlay-description", text: "3条を収録" }));
  for (const article of catalog.articles) {
    const item = button("", () => onNavigate(article.number), { className: `overlay-article${article.number === activeNumber ? " is-active" : ""}` });
    item.append(node("strong", { text: `${article.number}条` }), node("span", { text: article.title }), node("small", { text: article.oneLine }));
    body.append(item);
  }
  return body;
}

export function searchBody({ onSearch, onNavigate }) {
  const body = node("div", { className: "overlay-body search-body" });
  const label = node("label", { text: "条文番号・語句で検索", attrs: { for: "search-field" } });
  const input = node("input", { id: "search-field", type: "search", placeholder: "例：321、特信情況、供述書", attrs: { autocomplete: "off" } });
  const results = node("div", { className: "search-results", attrs: { "aria-live": "polite" } });
  let timer;
  const update = () => {
    const found = onSearch(input.value);
    results.replaceChildren();
    if (!input.value.trim()) {
      results.append(node("p", { className: "overlay-description", text: "条文番号、語句、解説から検索できます。" }));
      return;
    }
    if (!found.length) {
      results.append(node("p", { className: "empty-state", text: "一致する条文はありません" }));
      return;
    }
    for (const article of found) {
      const item = button("", () => onNavigate(article.number), { className: "search-result" });
      item.append(node("strong", { text: `${article.number}条　${article.title}` }), node("span", { text: article.oneLine }), node("small", { text: `一致元：${article.matchedBy}` }));
      results.append(item);
    }
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = window.setTimeout(update, 120); });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { const found = onSearch(input.value); if (found[0]) onNavigate(found[0].number); } });
  body.append(label, input, results);
  queueMicrotask(() => input.focus());
  update();
  return body;
}

export function bookmarksBody(catalog, bookmarks, onNavigate) {
  const body = node("div", { className: "overlay-body" });
  const marked = catalog.articles.filter((article) => bookmarks.has(article.id));
  if (!marked.length) body.append(node("p", { className: "empty-state", text: "しおりはまだありません" }));
  for (const article of marked) {
    const item = button(`${article.number}条　${article.title}`, () => onNavigate(article.number), { className: "overlay-article" });
    body.append(item);
  }
  return body;
}

export function settingsBody({ state, version, sourceUrl, onTheme, onFontScale, onExport, onImport }) {
  const body = node("div", { className: "overlay-body settings-body" });
  const createChoices = (title, values, current, onChange) => {
    const group = node("fieldset", { className: "settings-group" });
    group.append(node("legend", { text: title }));
    for (const [value, label] of values) {
      const labelNode = node("label", { className: "setting-choice" });
      const input = node("input", { type: "radio", value, attrs: { name: title } });
      input.checked = current === value;
      input.addEventListener("change", () => { if (input.checked) onChange(value); });
      labelNode.append(input, node("span", { text: label }));
      group.append(labelNode);
    }
    return group;
  };
  body.append(
    createChoices("表示テーマ", [["system", "端末に合わせる"], ["light", "明るい"], ["dark", "暗い"]], state.theme, onTheme),
    createChoices("条文文字サイズ", [["small", "小"], ["standard", "標準"], ["large", "大"]], state.fontScale, onFontScale),
    node("section", { className: "settings-group" }, [
      node("h3", { text: "データ管理" }),
      button("バックアップを書き出す", onExport, { className: "settings-action" }),
      button("バックアップを読み込む", onImport, { className: "settings-action" }),
      node("p", { className: "settings-note", text: "メモはこのiPad内に保存されます。大切なメモは定期的にJSONへ書き出してください。" })
    ]),
    node("section", { className: "settings-group" }, [
      node("h3", { text: "アプリ情報" }),
      node("p", { text: `アプリ版 ${version.appVersion}／コンテンツ版 ${version.contentVersion}` }),
      node("p", { text: `確認日 ${version.verifiedAt}` }),
      node("p", { text: `法令改訂ID ${version.lawRevisionId}` }),
      node("a", { text: "e-Gov法令検索を開く", attrs: { href: sourceUrl, target: "_blank", rel: "noopener noreferrer" } }),
      node("p", { className: "settings-note", text: "Safariの共有ボタンから「ホーム画面に追加」を選び、「Webアプリとして開く」をオンにしてください。" }),
      node("p", { className: "settings-note", text: "学習用資料であり、公式の注釈や個別事件への法的助言ではありません。" })
    ])
  );
  return body;
}

export function conflictBody(conflictCount, onKeep, onReplace, onCancel) {
  return node("div", { className: "overlay-body conflict-body" }, [
    node("p", { text: `${conflictCount}件の同じ項・号に別内容のメモがあります。` }),
    node("div", { className: "conflict-actions" }, [
      button("既存メモを残す", onKeep, { className: "primary-button" }),
      button("読み込んだメモで置き換える", onReplace, { className: "secondary-button" }),
      button("キャンセル", onCancel, { className: "text-button" })
    ])
  ]);
}
