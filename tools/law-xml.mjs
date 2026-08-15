import { createHash } from "node:crypto";

const ENTITY_MAP = new Map([
  ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", "\""], ["apos", "'"]
]);

function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (_, token) => {
    if (token.startsWith("#x")) return String.fromCodePoint(Number.parseInt(token.slice(2), 16));
    if (token.startsWith("#")) return String.fromCodePoint(Number.parseInt(token.slice(1), 10));
    return ENTITY_MAP.get(token) ?? `&${token};`;
  });
}

function parseAttributes(source) {
  const attrs = {};
  const matcher = /([\w:-]+)\s*=\s*("[^"]*"|'[^']*')/g;
  for (const match of source.matchAll(matcher)) attrs[match[1]] = decodeEntities(match[2].slice(1, -1));
  return attrs;
}

export function parseXml(xml) {
  const root = { name: "#document", attrs: {}, children: [] };
  const stack = [root];
  const tokens = xml.match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[^]*?-->|<\?[^]*?\?>|<[^>]+>|[^<]+/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith("<?") || token.startsWith("<!--")) continue;
    if (token.startsWith("<![CDATA[")) {
      stack.at(-1).children.push(token.slice(9, -3));
      continue;
    }
    if (token.startsWith("</")) {
      const name = token.slice(2, -1).trim();
      const node = stack.pop();
      if (!node || node.name !== name) throw new Error(`XML終了タグが不正です: ${name}`);
      continue;
    }
    if (token.startsWith("<")) {
      const selfClosing = /\/>$/.test(token);
      const body = token.slice(1, selfClosing ? -2 : -1).trim();
      const nameMatch = body.match(/^([^\s/>]+)/);
      if (!nameMatch) throw new Error(`XML開始タグが不正です: ${token.slice(0, 80)}`);
      const node = { name: nameMatch[1], attrs: parseAttributes(body.slice(nameMatch[0].length)), children: [] };
      stack.at(-1).children.push(node);
      if (!selfClosing) stack.push(node);
      continue;
    }
    stack.at(-1).children.push(decodeEntities(token));
  }
  if (stack.length !== 1) throw new Error("XMLの開始・終了タグが一致しません");
  const law = root.children.find((child) => typeof child !== "string");
  if (!law?.name) throw new Error("XML rootが見つかりません");
  return law;
}

export function elementChildren(node) {
  return node.children.filter((child) => typeof child !== "string");
}

export function childrenNamed(node, name) {
  return elementChildren(node).filter((child) => child.name === name);
}

export function childNamed(node, name) {
  return childrenNamed(node, name)[0] ?? null;
}

function leafText(value) {
  if (!value.trim()) return "";
  return value.replace(/[\r\n\t]/g, "");
}

export function plainText(node, { omitRt = true } = {}) {
  if (typeof node === "string") return leafText(node);
  if (omitRt && node.name === "Rt") return "";
  return node.children.map((child) => plainText(child, { omitRt })).join("");
}

function mergeText(inline, text) {
  if (!text) return;
  const previous = inline.at(-1);
  if (previous?.type === "text") previous.text += text;
  else inline.push({ type: "text", text });
}

export function inlineText(node) {
  const inline = [];
  for (const child of node.children) {
    if (typeof child === "string") {
      mergeText(inline, leafText(child));
      continue;
    }
    if (child.name === "Ruby") {
      const base = child.children.filter((item) => typeof item === "string" || item.name !== "Rt").map((item) => plainText(item)).join("");
      const reading = childrenNamed(child, "Rt").map((item) => plainText(item, { omitRt: false })).join("");
      if (base) inline.push({ type: "ruby", base, reading });
      continue;
    }
    if (child.name === "Rt") continue;
    mergeText(inline, plainText(child));
  }
  return inline;
}

function requireOnly(node, allowed, context) {
  for (const child of elementChildren(node)) {
    if (!allowed.has(child.name)) throw new Error(`${context}: 未対応XML要素 ${child.name}`);
  }
}

function articleSlug(num) {
  return String(num).replaceAll("_", "-");
}

function sentenceFrom(node, id) {
  return { id, inline: inlineText(node), plainText: plainText(node) };
}

function tableFrom(struct, id) {
  requireOnly(struct, new Set(["Table"]), `${id} TableStruct`);
  const table = childNamed(struct, "Table");
  if (!table) throw new Error(`${id}: TableStruct内にTableがありません`);
  requireOnly(table, new Set(["TableRow"]), `${id} Table`);
  return {
    id,
    writingMode: table.attrs.WritingMode === "vertical" ? "vertical" : "horizontal",
    rows: childrenNamed(table, "TableRow").map((row, rowIndex) => {
      requireOnly(row, new Set(["TableColumn"]), `${id} row ${rowIndex + 1}`);
      return {
        cells: childrenNamed(row, "TableColumn").map((cell) => ({
          inline: inlineText(cell),
          plainText: plainText(cell),
          rowSpan: cell.attrs.rowspan ? Number.parseInt(cell.attrs.rowspan, 10) : 1,
          borderTop: cell.attrs.BorderTop ?? "solid",
          borderRight: cell.attrs.BorderRight ?? "solid",
          borderBottom: cell.attrs.BorderBottom ?? "solid",
          borderLeft: cell.attrs.BorderLeft ?? "solid"
        }))
      };
    })
  };
}

function blocksFrom(nodes, parentId, level, sentenceIndex = { value: 0 }) {
  const blocks = [];
  const wrapperNames = new Set(["ParagraphSentence", "ItemSentence", "Subitem1Sentence", "Subitem2Sentence"]);
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (typeof node === "string") {
      if (leafText(node)) throw new Error(`${parentId}: 構造外テキストがあります`);
      continue;
    }
    if (wrapperNames.has(node.name)) {
      blocks.push(...blocksFrom(node.children, parentId, level, sentenceIndex));
      continue;
    }
    if (node.name === "Sentence") {
      sentenceIndex.value += 1;
      blocks.push({ kind: "sentence", sentence: sentenceFrom(node, `${parentId}-sentence-${sentenceIndex.value}`) });
      continue;
    }
    if (node.name === "TableStruct") {
      sentenceIndex.value += 1;
      blocks.push({ kind: "table", table: tableFrom(node, `${parentId}-table-${sentenceIndex.value}`) });
      continue;
    }
    if (node.name === "Column") {
      const columns = [];
      while (nodes[index]?.name === "Column") {
        const column = nodes[index];
        const columnId = `${parentId}-column-${column.attrs.Num ?? columns.length + 1}`;
        requireOnly(column, new Set(["Sentence", "TableStruct"]), columnId);
        columns.push({ num: column.attrs.Num ?? String(columns.length + 1), blocks: blocksFrom(column.children, columnId, "column") });
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: "columns", columns });
      continue;
    }
    if (node.name === "Item" && level === "paragraph") {
      blocks.push({ kind: "item", item: itemFrom(node, parentId) });
      continue;
    }
    if (node.name === "Subitem1" && level === "item") {
      blocks.push({ kind: "subitem1", subitem: subitemFrom(node, parentId, 1) });
      continue;
    }
    if (node.name === "Subitem2" && level === "subitem1") {
      blocks.push({ kind: "subitem2", subitem: subitemFrom(node, parentId, 2) });
      continue;
    }
    throw new Error(`${parentId}: ${level}内の未対応要素 ${node.name}`);
  }
  return blocks;
}

function itemFrom(node, paragraphId) {
  requireOnly(node, new Set(["ItemTitle", "ItemSentence", "Sentence", "TableStruct", "Subitem1"]), `${paragraphId} Item`);
  const num = node.attrs.Num;
  if (!num) throw new Error(`${paragraphId}: Item Numがありません`);
  const id = `${paragraphId}-i${num}`;
  const blocks = blocksFrom(node.children.filter((child) => typeof child === "string" || child.name !== "ItemTitle"), id, "item");
  return { id, num, titleText: plainText(childNamed(node, "ItemTitle") ?? { children: [] }), blocks, plainText: blocksPlainText(blocks) };
}

function subitemFrom(node, parentId, level) {
  const nextName = level === 1 ? "Subitem2" : null;
  const allowed = new Set([`${level === 1 ? "Subitem1" : "Subitem2"}Title`, `${level === 1 ? "Subitem1" : "Subitem2"}Sentence`, "Sentence", "TableStruct"]);
  if (nextName) allowed.add(nextName);
  requireOnly(node, allowed, `${parentId} Subitem${level}`);
  const num = node.attrs.Num;
  if (!num) throw new Error(`${parentId}: Subitem${level} Numがありません`);
  const id = `${parentId}-s${level}-${num}`;
  const titleName = `Subitem${level}Title`;
  const blocks = blocksFrom(node.children.filter((child) => typeof child === "string" || child.name !== titleName), id, `subitem${level}`);
  return { id, num, titleText: plainText(childNamed(node, titleName) ?? { children: [] }), blocks, plainText: blocksPlainText(blocks) };
}

export function blocksPlainText(blocks) {
  return blocks.map((block) => {
    if (block.kind === "sentence") return block.sentence.plainText;
    if (block.kind === "table") return block.table.rows.flatMap((row) => row.cells.map((cell) => cell.plainText)).join("");
    if (block.kind === "columns") return block.columns.map((column) => blocksPlainText(column.blocks)).join("");
    if (block.kind === "item") return block.item.titleText + block.item.plainText;
    if (block.kind === "subitem1" || block.kind === "subitem2") return block.subitem.titleText + block.subitem.plainText;
    throw new Error(`未対応block kind: ${block.kind}`);
  }).join("");
}

export function paragraphFrom(node, articleId) {
  requireOnly(node, new Set(["ParagraphCaption", "ParagraphNum", "ParagraphSentence", "Sentence", "TableStruct", "Item"]), `${articleId} Paragraph`);
  const num = node.attrs.Num;
  if (!num) throw new Error(`${articleId}: Paragraph Numがありません`);
  const id = `${articleId}-p${num}`;
  const blocks = blocksFrom(node.children.filter((child) => typeof child === "string" || !["ParagraphCaption", "ParagraphNum"].includes(child.name)), id, "paragraph");
  const firstItemIndex = blocks.findIndex((block) => block.kind === "item");
  const hasIntro = firstItemIndex > 0 && blocks.slice(0, firstItemIndex).some((block) => block.kind === "sentence" || block.kind === "table");
  const caption = plainText(childNamed(node, "ParagraphCaption") ?? { children: [] });
  const numberText = plainText(childNamed(node, "ParagraphNum") ?? { children: [] });
  return {
    id,
    noteTargetId: hasIntro ? `${id}-intro` : id,
    num,
    caption,
    numberText,
    blocks,
    plainText: caption + numberText + blocksPlainText(blocks)
  };
}

export function articleFrom(node, { lawId, prefix = "jp", path = [], order = 0, chunk = "" } = {}) {
  requireOnly(node, new Set(["ArticleCaption", "ArticleTitle", "Paragraph"]), `Article ${node.attrs.Num}`);
  const num = node.attrs.Num;
  if (!num) throw new Error("Article Numがありません");
  const routeNum = articleSlug(num);
  const id = prefix === "jp" ? `jp-${lawId}-a${routeNum}` : `${prefix}-a${routeNum}`;
  const officialCaption = plainText(childNamed(node, "ArticleCaption") ?? { children: [] }) || null;
  const displayNumber = plainText(childNamed(node, "ArticleTitle") ?? { children: [] });
  const paragraphs = childrenNamed(node, "Paragraph").map((paragraph) => paragraphFrom(paragraph, id));
  return {
    id,
    num,
    routeNum,
    displayNumber,
    officialCaption,
    path,
    order,
    paragraphs,
    plainText: `${officialCaption ?? ""}${displayNumber}${paragraphs.map((paragraph) => paragraph.plainText).join("")}`
  };
}

function titleFor(node, name) {
  const title = childNamed(node, name);
  if (!title) throw new Error(`${node.name}に${name}がありません`);
  return plainText(title);
}

const STRUCTURES = new Map([
  ["Chapter", { kind: "chapter", title: "ChapterTitle" }],
  ["Section", { kind: "section", title: "SectionTitle" }],
  ["Subsection", { kind: "subsection", title: "SubsectionTitle" }],
  ["Division", { kind: "division", title: "DivisionTitle" }]
]);

function childNodesWithoutTitle(node, titleName) {
  return node.children.filter((child) => typeof child === "string" || child.name !== titleName);
}

function treeFromChildren(children, state, parentTree, path, partIndex) {
  for (const child of children) {
    if (typeof child === "string") {
      if (leafText(child)) throw new Error(`MainProvision: 構造外テキストがあります`);
      continue;
    }
    if (child.name === "Article") {
      const article = articleFrom(child, { lawId: state.lawId, path, order: state.order++, chunk: `main-part-${partIndex}.json` });
      state.parts[partIndex - 1].push(article);
      parentTree.children.push({ id: article.id, kind: "article", title: article.displayNumber, order: article.order, entryId: article.id, children: [] });
      state.articles.push(article);
      continue;
    }
    const structure = STRUCTURES.get(child.name);
    if (!structure) throw new Error(`MainProvision: 未対応構造要素 ${child.name}`);
    const title = titleFor(child, structure.title);
    const tree = { id: `toc-${state.treeOrder++}`, kind: structure.kind, title, order: state.treeOrder, children: [] };
    parentTree.children.push(tree);
    treeFromChildren(childNodesWithoutTitle(child, structure.title), state, tree, [...path, title], partIndex);
  }
}

function supplementFrom(node, lawId, order) {
  requireOnly(node, new Set(["SupplProvisionLabel", "Article", "Paragraph"]), `SupplProvision ${order}`);
  const amendment = node.attrs.AmendLawNum ?? null;
  const id = amendment
    ? `jp-${lawId}-suppl-${createHash("sha256").update(amendment.normalize("NFKC").trim(), "utf8").digest("hex").slice(0, 16)}`
    : `jp-${lawId}-suppl-origin`;
  const label = plainText(childNamed(node, "SupplProvisionLabel") ?? { children: [] });
  const blocks = [];
  for (const child of node.children) {
    if (typeof child === "string") {
      if (leafText(child)) throw new Error(`${id}: 構造外テキストがあります`);
      continue;
    }
    if (child.name === "SupplProvisionLabel") continue;
    if (child.name === "Article") blocks.push({ kind: "article", article: articleFrom(child, { lawId, prefix: id, path: [label], order }) });
    else if (child.name === "Paragraph") blocks.push({ kind: "paragraph", paragraph: paragraphFrom(child, id) });
  }
  const plain = `${label}${blocks.map((block) => block.kind === "article" ? block.article.plainText : block.paragraph.plainText).join("")}`;
  return {
    id,
    label,
    amendLawNumber: amendment,
    extract: node.attrs.Extract === "true",
    order,
    route: `#/law/${lawId}/supplement/${id}`,
    blocks,
    plainText: plain,
    plainTextPreview: plain.slice(0, 80)
  };
}

export function buildLaw(root, { lawId, studyTitles = new Map() } = {}) {
  if (root.name !== "Law") throw new Error(`Law rootではありません: ${root.name}`);
  const body = childNamed(root, "LawBody");
  if (!body) throw new Error("LawBodyがありません");
  requireOnly(body, new Set(["LawTitle", "TOC", "MainProvision", "SupplProvision"]), "LawBody");
  const main = childNamed(body, "MainProvision");
  if (!main) throw new Error("MainProvisionがありません");
  requireOnly(main, new Set(["Part"]), "MainProvision");
  const parts = childrenNamed(main, "Part");
  if (parts.length !== 7) throw new Error(`Part件数が7件ではありません: ${parts.length}`);

  const state = { lawId, parts: Array.from({ length: 7 }, () => []), articles: [], order: 1, treeOrder: 1 };
  const mainTree = [];
  parts.forEach((part, index) => {
    requireOnly(part, new Set(["PartTitle", "Chapter", "Article"]), `Part ${index + 1}`);
    const title = titleFor(part, "PartTitle");
    const tree = { id: `toc-part-${index + 1}`, kind: "part", title, order: state.treeOrder++, children: [] };
    mainTree.push(tree);
    treeFromChildren(childNodesWithoutTitle(part, "PartTitle"), state, tree, [title], index + 1);
  });

  const supplements = childrenNamed(body, "SupplProvision").map((supplement, index) => supplementFrom(supplement, lawId, index + 1));
  const mainCanonical = canonicalMain(mainTree, state.articles);
  const supplementCanonical = supplements.map((item) => item.plainText).join("");
  return {
    mainTree,
    articles: state.articles,
    chunks: state.parts,
    supplements,
    canonical: `${mainCanonical}${supplementCanonical}`,
    counts: countXml(root)
  };
}

function canonicalMain(tree, articles) {
  const byId = new Map(articles.map((article) => [article.id, article]));
  const join = (nodes) => nodes.map((node) => {
    if (node.kind === "article") return byId.get(node.entryId)?.plainText ?? "";
    return `${node.title}${join(node.children)}`;
  }).join("");
  return join(tree);
}

export function canonicalHash(text) {
  return createHash("sha256").update(normalizeForCompare(text), "utf8").digest("hex");
}

export function normalizeForCompare(text) {
  return String(text).normalize("NFC").replace(/[\s　]+/g, "");
}

export function countXml(root) {
  const counts = {};
  const walk = (node) => {
    if (typeof node === "string") return;
    counts[node.name] = (counts[node.name] ?? 0) + 1;
    node.children.forEach(walk);
  };
  walk(root);
  return counts;
}

export function findProvision(article, provisionId) {
  for (const paragraph of article.paragraphs) {
    if (paragraph.id === provisionId || paragraph.noteTargetId === provisionId) return paragraph;
    const scan = (blocks) => {
      for (const block of blocks) {
        if (block.kind === "item" && block.item.id === provisionId) return block.item;
        if ((block.kind === "subitem1" || block.kind === "subitem2") && block.subitem.id === provisionId) return block.subitem;
        const nested = block.kind === "item" ? scan(block.item.blocks) : (block.kind === "subitem1" || block.kind === "subitem2") ? scan(block.subitem.blocks) : null;
        if (nested) return nested;
      }
      return null;
    };
    const found = scan(paragraph.blocks);
    if (found) return found;
  }
  return null;
}

export function provisionPlainText(provision) {
  return provision?.plainText ?? blocksPlainText(provision?.blocks ?? []);
}
