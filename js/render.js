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
  if (options.checked !== undefined) element.checked = options.checked;
  if (options.attrs) for (const [key, value] of Object.entries(options.attrs)) element.setAttribute(key, value);
  if (options.on) for (const [event, listener] of Object.entries(options.on)) element.addEventListener(event, listener);
  for (const child of children.flat()) if (child !== null && child !== undefined) element.append(child);
  return element;
}

function button(text, onClick, options = {}) {
  return node("button", { className: options.className || "secondary-button", type: "button", text, attrs: options.attrs, on: { click: onClick } });
}

function iconButton(symbol, label, onClick, active = false) {
  return button(symbol, onClick, { className: `article-action${active ? " is-active" : ""}`, attrs: { "aria-label": label, title: label, "aria-pressed": String(active) } });
}

function priorityText(meta) {
  return `論文${meta.essayPriority}／予備短答${meta.preliminaryShortPriority}`;
}

function displayRoute(routeNumber) {
  return String(routeNumber).replaceAll("-", "の");
}

function categoryChips(meta) {
  return node("div", { className: "article-tags" }, [
    node("span", { className: "article-tag", text: `論文 ${meta.essayPriority}` }),
    node("span", { className: "article-tag", text: `予備短答 ${meta.preliminaryShortPriority}` }),
    node("span", { className: "article-tag is-topic", text: meta.topic })
  ]);
}

function renderInline(inline) {
  const fragment = document.createDocumentFragment();
  for (const part of inline ?? []) {
    if (part.type === "ruby") {
      const ruby = document.createElement("ruby");
      ruby.append(document.createTextNode(part.base));
      ruby.append(node("rt", { text: part.reading }));
      fragment.append(ruby);
    } else {
      fragment.append(document.createTextNode(part.text));
    }
  }
  return fragment;
}

function memoControl(targetId, label, state, notes, handlers) {
  const current = notes.get(targetId)?.value ?? "";
  const open = state.openMemos.has(targetId);
  const container = node("div", { className: "official-memo" });
  const memoId = `memo-${targetId}`;
  const area = node("div", { className: "memo-area", hidden: !open });
  const textarea = node("textarea", {
    id: memoId,
    className: "memo-input",
    value: current,
    placeholder: "自分の理解、判例、疑問を残せます。",
    attrs: { "aria-label": `${label}への自分のメモ`, rows: "4" },
    on: {
      input: (event) => handlers.onMemoInput({ id: targetId, label }, event.target),
      blur: (event) => handlers.onMemoBlur({ id: targetId, label }, event.target)
    }
  });
  area.append(
    node("label", { className: "memo-label", text: `${label}への自分のメモ`, attrs: { for: memoId } }),
    textarea,
    node("div", { className: "memo-footer" }, [
      node("span", { className: "memo-status", text: current ? "保存済み" : "未入力" }),
      button("閉じる", () => handlers.onCloseMemo(targetId), { className: "text-button" })
    ])
  );
  container.append(
    button(current ? "メモあり・表示" : "この項・号にメモ", () => handlers.onOpenMemo(targetId), { className: `memo-toggle${current ? " has-memo" : ""}` }),
    area
  );
  return container;
}

function renderTable(table) {
  const element = node("table", { className: "statute-table", attrs: { "aria-label": "条文内の表" } });
  const body = document.createElement("tbody");
  for (const row of table.rows) {
    const tr = document.createElement("tr");
    for (const cell of row.cells) {
      const td = document.createElement("td");
      if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
      td.append(renderInline(cell.inline));
      tr.append(td);
    }
    body.append(tr);
  }
  element.append(body);
  return node("div", { className: `statute-table-wrap${table.writingMode === "vertical" ? " is-vertical" : ""}` }, [element]);
}

function renderBlocks(blocks, state, notes, handlers) {
  const result = [];
  for (const block of blocks) {
    if (block.kind === "sentence") {
      const paragraph = node("p", { className: "statute-text" });
      paragraph.append(renderInline(block.sentence.inline));
      result.push(paragraph);
    } else if (block.kind === "table") {
      result.push(renderTable(block.table));
    } else if (block.kind === "columns") {
      const columns = node("div", { className: "statute-columns" });
      for (const column of block.columns) {
        const columnNode = node("div", { className: "statute-column" }, [node("span", { className: "column-number", text: column.num }), renderBlocks(column.blocks, state, notes, handlers)]);
        columns.append(columnNode);
      }
      result.push(columns);
    } else if (block.kind === "item") {
      const item = node("section", { className: "statute-item", id: `text-${block.item.id}` });
      const title = node("div", { className: "statute-line" }, [node("span", { className: "item-mark", text: `${block.item.titleText}　` }), renderBlocks(block.item.blocks, state, notes, handlers)]);
      item.append(title, memoControl(block.item.id, `${block.item.titleText}号`, state, notes, handlers));
      result.push(item);
    } else if (block.kind === "subitem1" || block.kind === "subitem2") {
      const subitem = node("section", { className: "statute-subitem", id: `text-${block.subitem.id}` });
      subitem.append(
        node("div", { className: "statute-line" }, [node("span", { className: "item-mark", text: `${block.subitem.titleText}　` }), renderBlocks(block.subitem.blocks, state, notes, handlers)]),
        memoControl(block.subitem.id, block.subitem.titleText, state, notes, handlers)
      );
      result.push(subitem);
    }
  }
  return result;
}

function renderParagraph(paragraph, law, state, notes, handlers) {
  const section = node("section", { className: "statute-provision", id: `text-${paragraph.noteTargetId}` });
  const label = `${law.displayNumber}${paragraph.num > 1 ? `第${paragraph.num}項` : ""}`;
  if (paragraph.caption) section.append(node("p", { className: "paragraph-caption", text: paragraph.caption }));
  if (paragraph.numberText) section.append(node("span", { className: "paragraph-number", text: paragraph.numberText }));
  section.append(...renderBlocks(paragraph.blocks, state, notes, handlers));
  section.append(memoControl(paragraph.noteTargetId, label, state, notes, handlers));
  return section;
}

function renderStudy(study, state) {
  const section = node("section", { className: "study-section", attrs: { "aria-label": `${study.title}の学習解説` } });
  section.append(node("p", { className: "study-notice", text: "学習用解説です。公式の注釈ではありません。条文本文は上の公式表示を確認してください。" }));
  section.append(
    node("div", { className: "study-intro" }, [
      node("div", { className: "study-card" }, [node("strong", { text: "一行要約" }), node("p", { text: study.oneLine })]),
      node("div", { className: "study-card" }, [node("strong", { text: "この条文を開く場面" }), node("p", { text: study.trigger })]),
      node("div", { className: "study-card study-card-wide" }, [node("strong", { text: "制度趣旨" }), node("p", { text: study.overview })])
    ]),
    node("div", { className: "learning-grid" }, [
      node("div", { className: "learning-card" }, [node("strong", { text: "覚える" }), node("p", { text: study.learning.remember })]),
      node("div", { className: "learning-card" }, [node("strong", { text: "理解する" }), node("p", { text: study.learning.understand })]),
      node("div", { className: "learning-card" }, [node("strong", { text: "必要時に確認する" }), node("p", { text: study.learning.lookup })])
    ])
  );
  const legend = node("div", { className: "marker-legend", attrs: { "aria-label": "学習マーカーの凡例" } });
  for (const role of ["actor", "requirement", "limit", "effect"]) legend.append(node("span", { className: `legend-item role-${role}`, text: roleNames[role] }));
  section.append(legend);

  const explanations = node("div", { className: "explanation-list" });
  for (const provision of study.provisions) {
    const card = node("section", { className: "explanation-card", id: `study-${provision.id}`, attrs: { "aria-label": provision.label } });
    card.append(
      node("div", { className: "explanation-heading" }, [
        node("strong", { text: provision.label }),
        node("span", { className: "study-badge", text: provision.studyTitle })
      ]),
      node("p", { className: "purpose-text", text: provision.purpose })
    );
    const list = node("div", { className: "explanation-segments" });
    for (const segment of provision.segments) {
      list.append(node("div", { className: `explanation-segment role-${segment.role}`, id: `explain-${segment.id}` }, [
        node("span", { className: `role-label role-${segment.role}`, text: roleNames[segment.role] }),
        node("strong", { text: segment.tag }),
        node("span", { text: segment.text })
      ]));
    }
    card.append(list);
    explanations.append(card);
  }
  section.append(explanations);
  if (study.omitted) section.append(node("p", { className: "study-omitted", text: `学習解説で省略した箇所: ${study.omitted}` }));
  return section;
}

function renderRelated(study, handlers) {
  const nav = node("nav", { className: "related-row", attrs: { "aria-label": `${study.title}の関連条文` } });
  nav.append(node("strong", { text: "関連条文" }));
  for (const related of study.related) {
    if (related.available) nav.append(button(`${related.displayNumber}条`, () => handlers.onNavigate(related.routeNumber), { className: "related-chip" }));
    else nav.append(node("span", { className: "related-chip is-unavailable", text: `${related.displayNumber}条 未収録` }));
  }
  return nav;
}

function renderPreviousNext(meta, handlers) {
  const nav = node("nav", { className: "previous-next", attrs: { "aria-label": "前後の収録条文" } });
  nav.append(
    meta.previousRouteNumber ? button(`← ${displayRoute(meta.previousRouteNumber)}条`, () => handlers.onNavigate(meta.previousRouteNumber), { className: "secondary-button" }) : node("span"),
    meta.nextRouteNumber ? button(`${displayRoute(meta.nextRouteNumber)}条 →`, () => handlers.onNavigate(meta.nextRouteNumber), { className: "secondary-button" }) : node("span")
  );
  return nav;
}

export function renderArticle(root, current, state, notes, bookmarks, handlers) {
  const { meta, statute, study: studyFile } = current;
  const law = statute.article;
  const study = studyFile.study;
  const articleNode = node("article", { className: "article-view" });
  articleNode.append(
    node("nav", { className: "breadcrumb", text: law.path.join(" ＞ "), attrs: { "aria-label": "法令上の位置" } }),
    node("p", { className: "article-number", text: law.displayNumber }),
    node("h1", { text: law.officialCaption ?? study.title })
  );
  if (!law.officialCaption) articleNode.append(node("p", { className: "study-heading-note", text: `学習見出し: ${study.title}` }));
  articleNode.append(categoryChips(meta), node("p", { className: "article-meta", text: `現行法・${state.verifiedLabel}確認　${study.loadLabel}` }));
  articleNode.append(node("div", { className: "article-actions" }, [
    iconButton(bookmarks.has(law.id) ? "★" : "☆", bookmarks.has(law.id) ? "しおりを外す" : "しおりに追加", handlers.onBookmark, bookmarks.has(law.id)),
    button("条文をコピー", handlers.onCopy, { className: "secondary-button" })
  ]));
  const lawText = node("section", { className: "law-text", attrs: { "aria-label": `${law.displayNumber}の公式条文全文` } });
  lawText.append(node("p", { className: "official-label", text: "e-Gov現行法による公式条文全文" }));
  for (const paragraph of law.paragraphs) lawText.append(renderParagraph(paragraph, law, state, notes, handlers));
  articleNode.append(lawText);
  articleNode.append(button(state.displayMode === "study" ? "学習解説を閉じる" : "学習解説を開く", handlers.onToggleStudy, { className: "study-toggle", attrs: { "aria-expanded": String(state.displayMode === "study") } }));
  if (state.displayMode === "study") articleNode.append(renderStudy(study, state));
  articleNode.append(renderRelated(study, handlers), renderPreviousNext(meta, handlers));
  root.replaceChildren(articleNode);
}

function filterControls(catalog, state, onChange) {
  const controls = node("div", { className: "list-controls" });
  const order = node("div", { className: "list-mode" }, [
    button("条文順", () => onChange("listMode", "statute"), { className: `filter-chip${state.listMode === "statute" ? " is-active" : ""}`, attrs: { "aria-pressed": String(state.listMode === "statute") } }),
    button("論点別", () => onChange("listMode", "topic"), { className: `filter-chip${state.listMode === "topic" ? " is-active" : ""}`, attrs: { "aria-pressed": String(state.listMode === "topic") } })
  ]);
  const priority = node("select", { className: "filter-select", value: state.priorityFilter, attrs: { "aria-label": "優先度で絞り込む" } });
  for (const [value, label] of [["all", "すべて 114"], ["essayA", "論文A 50"], ["preliminaryShortA", "予備短答A 103"], ["supplementalBB", "補充B/B 11"]]) priority.append(node("option", { value, text: label }));
  priority.addEventListener("change", () => onChange("priorityFilter", priority.value));
  const topic = node("select", { className: "filter-select", value: state.topicFilter, attrs: { "aria-label": "テーマで絞り込む" } });
  topic.append(node("option", { value: "all", text: "すべてのテーマ" }));
  for (const entry of catalog.topics) topic.append(node("option", { value: entry.name, text: `${entry.name} ${entry.count}` }));
  topic.addEventListener("change", () => onChange("topicFilter", topic.value));
  controls.append(order, priority, topic);
  return controls;
}

function appendArticleRows(container, articles, activeRoute, onNavigate, listMode) {
  if (!articles.length) {
    container.append(node("p", { className: "empty-state", text: "条件に合う収録条文はありません" }));
    return;
  }
  const appendRow = (article) => {
    const row = button("", () => onNavigate(article.routeNumber), { className: `overlay-article${article.routeNumber === activeRoute ? " is-active" : ""}`, attrs: { "aria-current": article.routeNumber === activeRoute ? "page" : "false" } });
    row.append(
      node("strong", { text: `${displayRoute(article.routeNumber)}条　${article.studyTitle}` }),
      node("small", { text: `${priorityText(article)}　${article.topic}` }),
      node("span", { text: article.oneLine })
    );
    container.append(row);
  };
  if (listMode !== "topic") {
    articles.forEach(appendRow);
    return;
  }
  for (const topic of [...new Set(articles.map((article) => article.topic))]) {
    container.append(node("h3", { className: "topic-heading", text: topic }));
    articles.filter((article) => article.topic === topic).forEach(appendRow);
  }
}

export function renderRail(root, catalog, state, handlers) {
  const visible = handlers.getVisibleArticles();
  const list = node("div", { className: "rail-list" });
  appendArticleRows(list, visible, state.activeArticleNumber, handlers.onNavigate, state.listMode);
  root.replaceChildren(
    node("div", { className: "rail-heading" }, [
      node("strong", { text: "重要条文" }),
      node("span", { text: `${visible.length} / 114条` }),
      filterControls(catalog, state, handlers.onFilterChange)
    ]),
    list,
    node("div", { className: "rail-footer" }, [
      button(`しおり${state.bookmarkCount ? ` ${state.bookmarkCount}` : ""}`, handlers.onOpenBookmarks, { className: "rail-utility" }),
      button("出典", handlers.onOpenSources, { className: "rail-utility" }),
      button("設定", handlers.onOpenSettings, { className: "rail-utility" })
    ])
  );
}

export function createOverlay({ title, onClose, body, kind = "sheet" }) {
  const backdrop = node("div", { className: "overlay-backdrop", on: { click: (event) => { if (event.target === backdrop) onClose(); } } });
  const panel = node("aside", { className: `overlay-panel ${kind}`, attrs: { role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1" } });
  panel.append(node("div", { className: "overlay-heading" }, [node("h2", { text: title }), button("閉じる", onClose, { className: "close-button", attrs: { "aria-label": `${title}を閉じる` } })]), body);
  backdrop.append(panel);
  return { backdrop, panel };
}

export function articleListBody({ catalog, state, handlers }) {
  const body = node("div", { className: "overlay-body article-list-body" });
  body.append(node("p", { className: "overlay-description", text: catalog.scopeNotice }));
  body.append(filterControls(catalog, state, handlers.onFilterChange));
  const list = node("div", { className: "article-list-results" });
  appendArticleRows(list, handlers.getVisibleArticles(), state.activeArticleNumber, handlers.onNavigate, state.listMode);
  body.append(list);
  return body;
}

export function searchBody({ onSearch, onNavigate, initialQuery = "" }) {
  const body = node("div", { className: "overlay-body search-body" });
  body.append(node("p", { className: "overlay-description", text: "収録114条だけを検索します。刑事訴訟法の全条文検索ではありません。" }));
  const label = node("label", { text: "条文番号・語句で検索", attrs: { for: "search-field" } });
  const input = node("input", { id: "search-field", type: "search", value: initialQuery, placeholder: "例：321、特信情況、逮捕の現場", attrs: { autocomplete: "off" } });
  const results = node("div", { className: "search-results", attrs: { "aria-live": "polite" } });
  let timer;
  const update = () => {
    const found = onSearch(input.value);
    results.replaceChildren();
    if (!input.value.trim()) {
      results.append(node("p", { className: "overlay-description", text: "条文番号、公式条文、学習解説から検索できます。" }));
      return;
    }
    if (!found.length) {
      results.append(node("p", { className: "empty-state", text: "収録114条には見つかりませんでした。全条文検索ではありません。" }));
      return;
    }
    for (const article of found) {
      const row = button("", () => onNavigate(article.routeNumber), { className: "search-result" });
      row.append(node("strong", { text: `${displayRoute(article.routeNumber)}条　${article.studyTitle}` }), node("span", { text: article.oneLine }), node("small", { text: `一致元: ${article.matchedBy}` }));
      results.append(row);
    }
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = window.setTimeout(update, 120); });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { const found = onSearch(input.value); if (found[0]) onNavigate(found[0].routeNumber); } });
  body.append(label, input, results);
  queueMicrotask(() => input.focus());
  update();
  return body;
}

export function bookmarksBody(catalog, bookmarks, onNavigate) {
  const body = node("div", { className: "overlay-body" });
  const marked = catalog.articles.filter((article) => bookmarks.has(article.id));
  if (!marked.length) body.append(node("p", { className: "empty-state", text: "しおりはまだありません" }));
  appendArticleRows(body, marked, null, onNavigate, "statute");
  return body;
}

export function settingsBody({ state, version, catalog, onTheme, onFontScale, onExport, onImport }) {
  const body = node("div", { className: "overlay-body settings-body" });
  const createChoices = (title, values, current, onChange) => {
    const group = node("fieldset", { className: "settings-group" });
    group.append(node("legend", { text: title }));
    for (const [value, label] of values) {
      const labelNode = node("label", { className: "setting-choice" });
      const input = node("input", { type: "radio", value, checked: current === value, attrs: { name: title } });
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
      node("p", { className: "settings-note", text: "メモ、しおり、設定はこのiPad内に保存されます。大切なメモは定期的にJSONへ書き出してください。" })
    ]),
    node("section", { className: "settings-group" }, [
      node("h3", { text: "アプリ情報" }),
      node("p", { text: `アプリ版 ${version.appVersion}／コンテンツ版 ${version.contentVersion}` }),
      node("p", { text: `確認日 ${version.verifiedAt}` }),
      node("p", { text: `法令改訂ID ${version.lawRevisionId}` }),
      node("p", { className: "settings-note", text: catalog.scopeNotice }),
      node("a", { text: "e-Gov法令検索を開く", attrs: { href: catalog.law.sourceUrl, target: "_blank", rel: "noopener noreferrer" } }),
      node("p", { className: "settings-note", text: "Safariの共有ボタンから「ホーム画面に追加」を選び、「Webアプリとして開く」をオンにしてください。" })
    ])
  );
  return body;
}

export function sourcesBody(catalog, version) {
  return node("div", { className: "overlay-body sources-body" }, [
    node("p", { className: "overlay-description", text: catalog.scopeNotice }),
    node("h3", { text: "条文本文" }),
    node("p", { text: `${catalog.law.name} ${catalog.law.lawNumber}` }),
    node("p", { text: `現行法リビジョン: ${catalog.law.revisionId}` }),
    node("p", { text: `確認日: ${version.verifiedAt}` }),
    node("a", { text: "e-Gov法令検索を開く", attrs: { href: catalog.law.sourceUrl, target: "_blank", rel: "noopener noreferrer" } }),
    node("a", { text: "e-Gov法令API Version 2", attrs: { href: catalog.law.apiUrl, target: "_blank", rel: "noopener noreferrer" } }),
    node("h3", { text: "学習解説" }),
    node("p", { text: "既存の自作重要条文版から移行した学習用コンテンツです。重要度は公式評価ではありません。" }),
    node("p", { className: "settings-note", text: "本アプリは学習用であり、公式注釈、最新法令の代替又は個別の法的助言ではありません。" })
  ]);
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

export function renderNotFound(root, catalog, onNavigate) {
  const box = node("section", { className: "error-state not-found" }, [
    node("h1", { text: "この条文は収録対象外です" }),
    node("p", { text: catalog.scopeNotice }),
    button("第320条を開く", () => onNavigate("320"), { className: "primary-button" }),
    node("a", { text: "e-Govで刑事訴訟法全文を確認する", attrs: { href: catalog.law.sourceUrl, target: "_blank", rel: "noopener noreferrer" } })
  ]);
  root.replaceChildren(box);
}
