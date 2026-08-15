import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaw, parseXml, normalizeForCompare } from "./law-xml.mjs";

const LAW_ID = "323AC0000000131";
const APP_VERSION = "1.0.1";
const CONTENT_VERSION = "2026-08-15.exam114.1";
const SELECTION_VERSION = "exam114-2026-08-15.1";
const EXPECTED_REVISION_ID = "323AC0000000131_20260813_508AC0000000067";
const VERIFIED_AT = "2026-08-15";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const workspaceDir = path.resolve(rootDir, "..", "..");
const sourceDir = path.join(workspaceDir, "work", "keiso-roppo-production", "source");
const masterPath = process.env.KEISO_MASTER_PATH ?? path.join(rootDir, "source", "criminal-procedure-key-articles-2027.html");

const FIXED_ROUTE_NUMBERS = [
  "1", "30", "36", "37", "37-2", "39", "60", "61", "81", "82", "87", "88", "89", "90", "93", "96",
  "99", "100", "102", "105", "110", "111", "114", "116", "123", "129", "131",
  "189", "191", "197", "198", "199", "200", "201", "203", "204", "205", "206", "207", "208", "210", "211", "212", "213", "217", "218", "219", "220", "221", "222", "223", "225",
  "246", "247", "248", "250", "254", "256",
  "282", "286", "289", "291", "292", "294", "295", "296", "297", "298", "299", "304", "305", "306", "312",
  "316-2", "316-13", "316-14", "316-15", "316-17", "316-18", "316-20", "316-26", "316-32",
  "317", "318", "319", "320", "321", "321-2", "321-3", "322", "323", "324", "325", "326", "327", "328",
  "335", "336", "337", "338", "339", "373", "379", "380", "381", "382", "397", "400", "402", "405", "411", "435", "448", "452"
];

const EXPECTED_TOPIC_COUNTS = {
  "総則": 1, "弁護": 5, "勾留": 5, "保釈": 5, "捜査総論": 3, "取調べ": 1, "逮捕": 12, "被疑者勾留": 2,
  "捜索・差押え": 14, "検証・鑑定": 4, "公訴・訴因": 7, "公判前整理・証拠開示": 9, "公判手続": 7,
  "証拠調べ・証拠総則": 9, "自白・被告人供述": 2, "伝聞・証拠例外": 10, "裁判": 5, "控訴・上告": 10, "再審": 3
};

const EXPECTED_PRIORITY_COUNTS = { "A/A": 50, "B/A": 53, "B/B": 11 };

const LEGACY_PROVISION_IDS = [
  "jp-323AC0000000131-a320-p1", "jp-323AC0000000131-a320-p2",
  "jp-323AC0000000131-a321-p1-intro", "jp-323AC0000000131-a321-p1-i1", "jp-323AC0000000131-a321-p1-i2", "jp-323AC0000000131-a321-p1-i3", "jp-323AC0000000131-a321-p2", "jp-323AC0000000131-a321-p3", "jp-323AC0000000131-a321-p4",
  "jp-323AC0000000131-a322-p1", "jp-323AC0000000131-a322-p2"
];

const LEGACY_SEGMENT_COUNTS = new Map([
  ["jp-323AC0000000131-a320-p1", 4], ["jp-323AC0000000131-a320-p2", 4],
  ["jp-323AC0000000131-a321-p1-intro", 4], ["jp-323AC0000000131-a321-p1-i1", 3], ["jp-323AC0000000131-a321-p1-i2", 3], ["jp-323AC0000000131-a321-p1-i3", 4], ["jp-323AC0000000131-a321-p2", 3], ["jp-323AC0000000131-a321-p3", 4], ["jp-323AC0000000131-a321-p4", 2],
  ["jp-323AC0000000131-a322-p1", 9], ["jp-323AC0000000131-a322-p2", 3]
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function displayRoute(routeNumber) {
  return routeNumber.replaceAll("-", "の");
}

function routeNumber(number) {
  return String(number).replaceAll("の", "-");
}

function sortRoutes(left, right) {
  const leftParts = left.split("-").map(Number);
  const rightParts = right.split("-").map(Number);
  return leftParts[0] - rightParts[0] || (leftParts[1] ?? 0) - (rightParts[1] ?? 0);
}

function compact(value) {
  return normalizeForCompare(String(value ?? "").normalize("NFKC"));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function extractMaster(html) {
  const marker = "article-data";
  const markerIndex = html.indexOf(marker);
  assert(markerIndex >= 0, "重要条文版のarticle-dataが見つかりません");
  const start = html.indexOf(">", markerIndex) + 1;
  const end = html.indexOf("</script>", start);
  assert(start > markerIndex && end > start, "重要条文版のarticle-data JSON範囲が不正です");
  const data = JSON.parse(html.slice(start, end));
  assert(Array.isArray(data), "重要条文版のarticle-dataが配列ではありません");
  return data;
}

function studySuffix(articleNumber, label) {
  const displayed = String(articleNumber).includes("の")
    ? String(articleNumber).replace(/^(.+)の(.+)$/, "$1条の$2")
    : `${articleNumber}条`;
  const prefix = `第${displayed}`;
  assert(label.startsWith(prefix), `学習ブロックの条文番号が不正です: ${label}`);
  const rest = label.slice(prefix.length);
  if (!rest) return "p1";
  const paragraph = rest.match(/^第(\d+)項/);
  const item = rest.match(/第(\d+)号/);
  let suffix = paragraph ? `p${paragraph[1]}` : "p1";
  if (item) suffix += `-i${item[1]}`;
  if (rest.includes("柱書")) suffix += "-intro";
  else if (rest.includes("前段")) suffix += "-first";
  else if (rest.includes("各号")) suffix += "-items";
  if (rest.includes("（")) suffix += "-subitems";
  return suffix;
}

function collectStudyText(study) {
  return [
    study.title, study.topic, study.loadLabel, study.keywords, study.oneLine, study.trigger, study.overview,
    study.learning?.remember, study.learning?.understand, study.learning?.lookup,
    ...study.provisions.flatMap((provision) => [
      provision.label, provision.studyTitle, provision.purpose,
      ...provision.segments.flatMap((segment) => [segment.tag, segment.text])
    ])
  ].filter(Boolean).join(" ");
}

function countBlocks(article) {
  const counts = { paragraphs: article.paragraphs.length, sentence: 0, item: 0, subitem1: 0, columns: 0 };
  const scan = (blocks) => {
    for (const block of blocks) {
      if (block.kind === "sentence") counts.sentence += 1;
      if (block.kind === "item") { counts.item += 1; scan(block.item.blocks); }
      if (block.kind === "subitem1") { counts.subitem1 += 1; scan(block.subitem.blocks); }
      if (block.kind === "subitem2") scan(block.subitem.blocks);
      if (block.kind === "columns") { counts.columns += 1; for (const column of block.columns) scan(column.blocks); }
    }
  };
  for (const paragraph of article.paragraphs) scan(paragraph.blocks);
  return counts;
}

function equalObjects(left, right) {
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

const [lawData, xml, masterHtml] = await Promise.all([
  readJson(path.join(sourceDir, "law-data.json")),
  readFile(path.join(sourceDir, "keiso.xml"), "utf8"),
  readFile(masterPath, "utf8")
]);

const revision = lawData.revision_info;
assert(lawData.law_info?.law_id === LAW_ID, "取得法令IDが刑事訴訟法ではありません");
assert(revision?.law_title === "刑事訴訟法", "取得法令名が刑事訴訟法ではありません");
assert(revision?.current_revision_status === "CurrentEnforced", "現行施行中リビジョンではありません");
assert(revision?.law_revision_id === EXPECTED_REVISION_ID, `法令リビジョンが設計値と異なります: ${revision?.law_revision_id}`);

const master = extractMaster(masterHtml);
const masterByRoute = new Map(master.map((article) => [routeNumber(article.number), article]));
assert(master.length === 114, `重要条文版の条文数が114ではありません: ${master.length}`);
assert(equalObjects([...masterByRoute.keys()].sort(sortRoutes), FIXED_ROUTE_NUMBERS), "固定114条の集合が設計書と一致しません");

const priorityCounts = {};
const topicCounts = {};
for (const article of master) {
  const priority = `${article.essay}/${article.short}`;
  priorityCounts[priority] = (priorityCounts[priority] ?? 0) + 1;
  topicCounts[article.topic] = (topicCounts[article.topic] ?? 0) + 1;
}
assert(equalObjects(priorityCounts, EXPECTED_PRIORITY_COUNTS), `優先度件数が不正です: ${JSON.stringify(priorityCounts)}`);
assert(equalObjects(topicCounts, EXPECTED_TOPIC_COUNTS), `テーマ件数が不正です: ${JSON.stringify(topicCounts)}`);

const built = buildLaw(parseXml(xml), { lawId: LAW_ID });
const officialByRoute = new Map(built.articles.map((article) => [article.routeNum, article]));
const selectedOfficial = FIXED_ROUTE_NUMBERS.map((route) => {
  const article = officialByRoute.get(route);
  assert(article, `現行法に固定収録条文がありません: ${route}`);
  return article;
});

const selectionArticles = [];
const statuteFiles = [];
const studyFiles = [];
const catalogArticles = [];
let studyProvisionCount = 0;
let segmentCount = 0;
let omittedCount = 0;
const allStudyProvisionIds = new Set();
const allSegmentIds = new Set();

for (let index = 0; index < FIXED_ROUTE_NUMBERS.length; index += 1) {
  const route = FIXED_ROUTE_NUMBERS[index];
  const source = masterByRoute.get(route);
  const official = officialByRoute.get(route);
  const articleId = official.id;
  const officialText = compact(official.plainText);
  const provisions = source.provisions.map((provision) => {
    const id = `${articleId}-${studySuffix(source.number, provision.label)}`;
    assert(!allStudyProvisionIds.has(id), `学習ブロックIDが重複しています: ${id}`);
    allStudyProvisionIds.add(id);
    const segments = provision.parts.map((part, segmentIndex) => {
      const segmentId = `${id}-s${String(segmentIndex + 1).padStart(2, "0")}`;
      assert(!allSegmentIds.has(segmentId), `segment IDが重複しています: ${segmentId}`);
      assert(officialText.includes(compact(part.text)), `現行本文に存在しない学習segmentです: ${segmentId}`);
      allSegmentIds.add(segmentId);
      return { id: segmentId, role: part.role, tag: part.tag, text: part.text };
    });
    studyProvisionCount += 1;
    segmentCount += segments.length;
    return { id, label: provision.label, studyTitle: provision.study, purpose: provision.purpose, segments };
  });
  if (source.omitted) omittedCount += 1;
  const related = source.related.map((number) => {
    const relatedRoute = routeNumber(number);
    return { routeNumber: relatedRoute, displayNumber: displayRoute(relatedRoute), available: FIXED_ROUTE_NUMBERS.includes(relatedRoute) };
  });
  const study = {
    title: source.title,
    topic: source.topic,
    priority: { essay: source.essay, preliminaryShort: source.short },
    loadLabel: source.load,
    oneLine: source.oneLine,
    trigger: source.trigger,
    overview: source.overview,
    learning: source.learn,
    provisions,
    omitted: source.omitted,
    related
  };
  const statuteHref = `./data/statutes/${route}.json`;
  const studyHref = `./data/study/${route}.json`;
  const selection = {
    routeNumber: route,
    displayNumber: displayRoute(route),
    topic: source.topic,
    essayPriority: source.essay,
    preliminaryShortPriority: source.short,
    selectionReason: "既存重要条文版収録"
  };
  selectionArticles.push(selection);
  await writeJson(path.join(rootDir, "data", "statutes", `${route}.json`), {
    schemaVersion: 2,
    contentVersion: CONTENT_VERSION,
    selectionVersion: SELECTION_VERSION,
    lawId: LAW_ID,
    revisionId: revision.law_revision_id,
    source: {
      provider: "e-Gov法令API Version 2",
      sourceUrl: `https://laws.e-gov.go.jp/law/${LAW_ID}`,
      apiUrl: `https://laws.e-gov.go.jp/api/2/law_file/xml/${revision.law_revision_id}`,
      verifiedAt: VERIFIED_AT
    },
    article: official
  });
  await writeJson(path.join(rootDir, "data", "study", `${route}.json`), {
    schemaVersion: 2,
    contentVersion: CONTENT_VERSION,
    selectionVersion: SELECTION_VERSION,
    lawId: LAW_ID,
    routeNumber: route,
    articleId,
    study
  });
  statuteFiles.push(statuteHref);
  studyFiles.push(studyHref);
  catalogArticles.push({
    id: articleId,
    routeNumber: route,
    displayNumber: official.displayNumber,
    officialCaption: official.officialCaption,
    studyTitle: source.title,
    path: official.path,
    topic: source.topic,
    essayPriority: source.essay,
    preliminaryShortPriority: source.short,
    loadLabel: source.load,
    oneLine: source.oneLine,
    statuteHref,
    studyHref,
    previousRouteNumber: FIXED_ROUTE_NUMBERS[index - 1] ?? null,
    nextRouteNumber: FIXED_ROUTE_NUMBERS[index + 1] ?? null,
    order: official.order
  });
}

assert(studyProvisionCount === 271, `学習ブロック数が271ではありません: ${studyProvisionCount}`);
assert(segmentCount === 850, `segment数が850ではありません: ${segmentCount}`);
assert(omittedCount === 47, `omitted件数が47ではありません: ${omittedCount}`);
assert(LEGACY_PROVISION_IDS.every((id) => allStudyProvisionIds.has(id)), "既存11学習ブロックIDを維持できません");
for (const [provisionId, count] of LEGACY_SEGMENT_COUNTS) {
  for (let index = 1; index <= count; index += 1) {
    const id = `${provisionId}-s${String(index).padStart(2, "0")}`;
    assert(allSegmentIds.has(id), `既存segment IDを維持できません: ${id}`);
  }
}
assert([...LEGACY_SEGMENT_COUNTS.values()].reduce((total, value) => total + value, 0) === 43, "既存segment期待値が43ではありません");

const officialCounts = selectedOfficial.reduce((total, article) => {
  const counts = countBlocks(article);
  total.paragraphs += counts.paragraphs;
  total.sentence += counts.sentence;
  total.item += counts.item;
  total.subitem1 += counts.subitem1;
  total.columns += counts.columns;
  return total;
}, { articles: selectedOfficial.length, paragraphs: 0, sentence: 0, item: 0, subitem1: 0, columns: 0 });
assert(equalObjects(officialCounts, { articles: 114, paragraphs: 285, sentence: 489, item: 106, subitem1: 11, columns: 28 }), `公式要素件数が不正です: ${JSON.stringify(officialCounts)}`);

await writeJson(path.join(rootDir, "data", "selection.json"), {
  schemaVersion: 2,
  contentVersion: CONTENT_VERSION,
  selectionVersion: SELECTION_VERSION,
  lawId: LAW_ID,
  scope: "司法試験・司法試験予備試験向け重要条文",
  articles: selectionArticles
});

await writeJson(path.join(rootDir, "data", "catalog.json"), {
  schemaVersion: 2,
  contentVersion: CONTENT_VERSION,
  selectionVersion: SELECTION_VERSION,
  law: {
    id: LAW_ID,
    name: revision.law_title,
    lawNumber: lawData.law_info.law_num,
    revisionId: revision.law_revision_id,
    verifiedAt: VERIFIED_AT,
    sourceUrl: `https://laws.e-gov.go.jp/law/${LAW_ID}`,
    apiUrl: "https://laws.e-gov.go.jp/api/2/swagger-ui"
  },
  scopeNotice: "司法試験・予備試験向けの重要条文114条を収録しています。刑事訴訟法の全条文ではありません。",
  topics: Object.entries(EXPECTED_TOPIC_COUNTS).map(([name, count]) => ({ name, count })),
  filters: { all: 114, essayA: 50, preliminaryShortA: 103, supplementalBB: 11 },
  articles: catalogArticles
});

const shellAssets = [
  "./", "./index.html", "./manifest.webmanifest", "./version.json", "./sw.js", "./NOTICE.md",
  `./assets/css/app.css?v=${APP_VERSION}`, "./assets/icons/app-icon.svg", "./assets/icons/icon-180.png", "./assets/icons/icon-192.png", "./assets/icons/icon-512.png",
  `./js/app.js?v=${APP_VERSION}`, "./js/router.js", "./js/render.js", "./js/search.js", "./js/storage.js", "./js/import-export.js", "./js/pwa.js",
  "./data/offline-assets.json"
];
const contentAssets = ["./data/catalog.json", "./data/selection.json", ...statuteFiles, ...studyFiles];
await writeJson(path.join(rootDir, "data", "offline-assets.json"), {
  schemaVersion: 2,
  contentVersion: CONTENT_VERSION,
  selectionVersion: SELECTION_VERSION,
  shellAssets,
  contentAssets
});

const generatedFiles = await Promise.all([...statuteFiles, ...studyFiles, "./data/catalog.json", "./data/selection.json", "./data/offline-assets.json"].map(async (href) => {
  const file = path.join(rootDir, href.replace(/^\.\//, ""));
  const info = await stat(file);
  return { href, bytes: info.size };
}));
const tooLarge = generatedFiles.filter((file) => file.bytes > 100 * 1024);
const totalJsonBytes = generatedFiles.reduce((total, file) => total + file.bytes, 0);
assert(!tooLarge.length, `100KBを超えるJSONがあります: ${tooLarge.map((file) => file.href).join(", ")}`);
assert(totalJsonBytes <= 5 * 1024 * 1024, `JSON合計が5MBを超えています: ${totalJsonBytes}`);

console.log(JSON.stringify({
  revisionId: revision.law_revision_id,
  articles: selectedOfficial.length,
  officialCounts,
  studyProvisionCount,
  segmentCount,
  omittedCount,
  priorityCounts,
  topicCounts,
  totalJsonBytes,
  maxJsonBytes: Math.max(...generatedFiles.map((file) => file.bytes))
}, null, 2));
