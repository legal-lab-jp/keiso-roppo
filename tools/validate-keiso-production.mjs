import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { normalizeForCompare } from "./law-xml.mjs";

const root = resolve(import.meta.dirname, "..");
const errors = [];
let checks = 0;
const check = (ok, message) => { checks += 1; if (!ok) errors.push(message); };
const exists = async (file) => { try { await stat(file); return true; } catch { return false; } };
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const compact = (value) => normalizeForCompare(String(value ?? "").normalize("NFKC"));
const equalObjects = (left, right) => {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
};
const routeSort = (left, right) => {
  const l = left.split("-").map(Number);
  const r = right.split("-").map(Number);
  return l[0] - r[0] || (l[1] ?? 0) - (r[1] ?? 0);
};
const fixedRoutes = [
  "1", "30", "36", "37", "37-2", "39", "60", "61", "81", "82", "87", "88", "89", "90", "93", "96",
  "99", "100", "102", "105", "110", "111", "114", "116", "123", "129", "131",
  "189", "191", "197", "198", "199", "200", "201", "203", "204", "205", "206", "207", "208", "210", "211", "212", "213", "217", "218", "219", "220", "221", "222", "223", "225",
  "246", "247", "248", "250", "254", "256",
  "282", "286", "289", "291", "292", "294", "295", "296", "297", "298", "299", "304", "305", "306", "312",
  "316-2", "316-13", "316-14", "316-15", "316-17", "316-18", "316-20", "316-26", "316-32",
  "317", "318", "319", "320", "321", "321-2", "321-3", "322", "323", "324", "325", "326", "327", "328",
  "335", "336", "337", "338", "339", "373", "379", "380", "381", "382", "397", "400", "402", "405", "411", "435", "448", "452"
];
const expectedTopics = {
  "総則": 1, "弁護": 5, "勾留": 5, "保釈": 5, "捜査総論": 3, "取調べ": 1, "逮捕": 12, "被疑者勾留": 2,
  "捜索・差押え": 14, "検証・鑑定": 4, "公訴・訴因": 7, "公判前整理・証拠開示": 9, "公判手続": 7,
  "証拠調べ・証拠総則": 9, "自白・被告人供述": 2, "伝聞・証拠例外": 10, "裁判": 5, "控訴・上告": 10, "再審": 3
};
const expectedPriorities = { "A/A": 50, "B/A": 53, "B/B": 11 };
const expectedLegacyIds = [
  "jp-323AC0000000131-a320-p1", "jp-323AC0000000131-a320-p2",
  "jp-323AC0000000131-a321-p1-intro", "jp-323AC0000000131-a321-p1-i1", "jp-323AC0000000131-a321-p1-i2", "jp-323AC0000000131-a321-p1-i3", "jp-323AC0000000131-a321-p2", "jp-323AC0000000131-a321-p3", "jp-323AC0000000131-a321-p4",
  "jp-323AC0000000131-a322-p1", "jp-323AC0000000131-a322-p2"
];

for (const file of ["index.html", "manifest.webmanifest", "sw.js", "version.json", "assets/css/app.css", "assets/icons/icon-180.png", "assets/icons/icon-192.png", "assets/icons/icon-512.png", "data/catalog.json", "data/selection.json", "data/offline-assets.json", "js/app.js", "js/render.js", "js/router.js", "js/search.js", "js/storage.js", "js/import-export.js", "js/pwa.js", "tools/build-exam-corpus.mjs"]) check(await exists(resolve(root, file)), `不足ファイル: ${file}`);
for (const obsolete of ["data/articles", "data/laws", "data/laws.json", "tools/build-law-data.mjs", "tools/validate-keiso-test-app.mjs"]) check(!(await exists(resolve(root, obsolete))), `全文版又はテスト版の不要ファイルが残っています: ${obsolete}`);

const [catalog, selection, offline, version, index, manifest, serviceWorker, appSource, renderSource, routerSource] = await Promise.all([
  readJson(resolve(root, "data/catalog.json")), readJson(resolve(root, "data/selection.json")), readJson(resolve(root, "data/offline-assets.json")), readJson(resolve(root, "version.json")), readFile(resolve(root, "index.html"), "utf8"), readJson(resolve(root, "manifest.webmanifest")),
  readFile(resolve(root, "sw.js"), "utf8"), readFile(resolve(root, "js/app.js"), "utf8"), readFile(resolve(root, "js/render.js"), "utf8"), readFile(resolve(root, "js/router.js"), "utf8")
]);
check(catalog.contentVersion === "2026-08-15.exam114.1", "catalogのcontentVersionが不正です。");
check(selection.contentVersion === catalog.contentVersion && offline.contentVersion === catalog.contentVersion && version.contentVersion === catalog.contentVersion, "コンテンツversionが一致しません。");
check(catalog.selectionVersion === "exam114-2026-08-15.1" && selection.selectionVersion === catalog.selectionVersion && offline.selectionVersion === catalog.selectionVersion && version.selectionVersion === catalog.selectionVersion, "selectionVersionが一致しません。");
check(catalog.law.revisionId === "323AC0000000131_20260813_508AC0000000067" && version.lawRevisionId === catalog.law.revisionId, "法令revision IDが不正です。");
check(catalog.articles.length === 114 && selection.articles.length === 114, "収録条文数が114ではありません。");
check(JSON.stringify(catalog.articles.map((article) => article.routeNumber)) === JSON.stringify(fixedRoutes), "catalogの固定条文順が不正です。");
check(JSON.stringify(selection.articles.map((article) => article.routeNumber)) === JSON.stringify(fixedRoutes), "selectionの固定条文順が不正です。");
check(manifest.id === "./" && manifest.start_url === "./" && manifest.scope === "./", "Manifestの固定URLが不正です。");
check(/<html lang="ja">/.test(index) && /default-src 'self'/.test(index), "indexのlang又はCSPが不正です。");
check(!/<script(?![^>]*\bsrc=)/i.test(index) && !/<style[\s>]/i.test(index) && !/\sstyle=/.test(index), "インラインscript又はstyleは禁止です。");
check(/重要条文114条/.test(index) && !/テスト版/.test(index), "本番版の表示文言が不正です。");
check(version.appVersion === "1.0.2" && /APP_VERSION = "1\.0\.2"/.test(serviceWorker), "appVersionが1.0.2で一致していません。");
check(index.includes("app.css?v=1.0.2") && index.includes("app.js?v=1.0.2") && offline.shellAssets.includes("./assets/css/app.css?v=1.0.2") && offline.shellAssets.includes("./js/app.js?v=1.0.2"), "1.0.2のPWA資産URLが一致していません。");
check(/HashChangeEvent\("hashchange"\)/.test(routerSource), "同一条文の再選択時にroute処理を再実行できません。");
check(/window\.scrollTo\(\{ top: 0/.test(appSource) && /Promise\.allSettled\(preferenceWrites\)/.test(appSource), "条文遷移の即時表示又は保存分離がありません。");
check(/paragraphReference/.test(renderSource) && /itemReference/.test(renderSource) && /className: "provision-reference paragraph-reference"/.test(renderSource), "公式条文の項・号表示がありません。");
check(/input\.addEventListener\("input", update\)/.test(renderSource), "検索結果の即時更新がありません。");

const topicCounts = {};
const priorityCounts = {};
const studyProvisionIds = new Set();
const segmentIds = new Set();
let studyProvisionCount = 0;
let segmentCount = 0;
let omittedCount = 0;
const officialCounts = { articles: 0, paragraphs: 0, sentence: 0, item: 0, subitem1: 0, columns: 0 };
const routeFiles = await readdir(resolve(root, "data/statutes"));
const studyFiles = await readdir(resolve(root, "data/study"));
check(routeFiles.filter((name) => name.endsWith(".json")).length === 114, "公式条文JSONが114件ではありません。");
check(studyFiles.filter((name) => name.endsWith(".json")).length === 114, "学習JSONが114件ではありません。");

const scanBlocks = (blocks) => {
  for (const block of blocks) {
    if (block.kind === "sentence") officialCounts.sentence += 1;
    if (block.kind === "item") { officialCounts.item += 1; scanBlocks(block.item.blocks); }
    if (block.kind === "subitem1") { officialCounts.subitem1 += 1; scanBlocks(block.subitem.blocks); }
    if (block.kind === "subitem2") scanBlocks(block.subitem.blocks);
    if (block.kind === "columns") { officialCounts.columns += 1; for (const column of block.columns) scanBlocks(column.blocks); }
  }
};

for (const meta of catalog.articles) {
  const [statute, study] = await Promise.all([
    readJson(resolve(root, meta.statuteHref.replace(/^\.\//, ""))),
    readJson(resolve(root, meta.studyHref.replace(/^\.\//, "")))
  ]);
  check(statute.article.id === meta.id && study.articleId === meta.id, `ID不一致: ${meta.routeNumber}`);
  check(statute.article.routeNum === meta.routeNumber && study.routeNumber === meta.routeNumber, `route不一致: ${meta.routeNumber}`);
  check(statute.revisionId === catalog.law.revisionId && study.contentVersion === catalog.contentVersion, `version不一致: ${meta.routeNumber}`);
  officialCounts.articles += 1;
  officialCounts.paragraphs += statute.article.paragraphs.length;
  for (const paragraph of statute.article.paragraphs) scanBlocks(paragraph.blocks);
  const body = compact(statute.article.plainText);
  const priority = `${study.study.priority.essay}/${study.study.priority.preliminaryShort}`;
  priorityCounts[priority] = (priorityCounts[priority] ?? 0) + 1;
  topicCounts[study.study.topic] = (topicCounts[study.study.topic] ?? 0) + 1;
  if (study.study.omitted) omittedCount += 1;
  for (const provision of study.study.provisions) {
    studyProvisionCount += 1;
    check(!studyProvisionIds.has(provision.id), `学習ブロックIDが重複しています: ${provision.id}`);
    studyProvisionIds.add(provision.id);
    for (const segment of provision.segments) {
      segmentCount += 1;
      check(!segmentIds.has(segment.id), `segment IDが重複しています: ${segment.id}`);
      segmentIds.add(segment.id);
      check(body.includes(compact(segment.text)), `現行条文にないsegment: ${segment.id}`);
      check(["actor", "requirement", "limit", "effect"].includes(segment.role) && segment.tag && segment.text, `segment形式が不正: ${segment.id}`);
    }
  }
}

check(equalObjects(priorityCounts, expectedPriorities), "優先度件数が不正です。");
check(equalObjects(topicCounts, expectedTopics), "テーマ件数が不正です。");
check(studyProvisionCount === 271 && segmentCount === 850 && omittedCount === 47, `学習データ件数が不正です: ${studyProvisionCount}/${segmentCount}/${omittedCount}`);
check(expectedLegacyIds.every((id) => studyProvisionIds.has(id)), "320条から322条までの既存学習IDが維持されていません。");
check([...segmentIds].filter((id) => /^jp-323AC0000000131-a(320|321|322)-p.*-s\d{2}$/.test(id)).length === 43, "320条から322条までの既存segment数が43ではありません。");
check(JSON.stringify(officialCounts) === JSON.stringify({ articles: 114, paragraphs: 285, sentence: 489, item: 106, subitem1: 11, columns: 28 }), `公式要素件数が不正です: ${JSON.stringify(officialCounts)}`);

const offlineAssets = [...offline.shellAssets, ...offline.contentAssets];
check(offline.contentAssets.length === 230, `offline content資産数が不正です: ${offline.contentAssets.length}`);
check(new Set(offlineAssets).size === offlineAssets.length, "offline-assetsに重複があります。");
for (const href of offlineAssets) check(await exists(resolve(root, href.replace(/^\.\//, "").split("?")[0])), `offline assetがありません: ${href}`);
for (const href of offline.contentAssets.filter((value) => value.includes("/statutes/") || value.includes("/study/"))) {
  const info = await stat(resolve(root, href.replace(/^\.\//, "")));
  check(info.size <= 100 * 1024, `100KBを超えるJSONがあります: ${href}`);
}
const contentBytes = (await Promise.all(offline.contentAssets.map(async (href) => (await stat(resolve(root, href.replace(/^\.\//, "")))).size))).reduce((total, bytes) => total + bytes, 0);
check(contentBytes <= 5 * 1024 * 1024, `JSON合計が5MBを超えています: ${contentBytes}`);

const sourceFiles = ["index.html", "manifest.webmanifest", "sw.js", "version.json", "assets/css/app.css", "js/app.js", "js/render.js", "js/router.js", "js/search.js", "js/storage.js", "js/import-export.js", "js/pwa.js"];
const source = (await Promise.all(sourceFiles.map((file) => readFile(resolve(root, file), "utf8")))).join("\n");
check(!/indexedDB\.deleteDatabase|localStorage\.clear|sessionStorage\.clear/.test(source), "利用者データの一括削除は禁止です。");
check(!/google-analytics|googletagmanager|analytics\.js/i.test(source), "トラッキングを含められません。");
check(!/innerHTML\s*=/.test(source), "公式条文表示にinnerHTMLを使用してはいけません。");
check(!/https?:\/\/[^\s"']+\.js/i.test(source), "外部JavaScriptを含められません。");
for (const file of ["sw.js", ...sourceFiles.filter((file) => file.endsWith(".js")), "tools/build-exam-corpus.mjs", "tools/validate-keiso-production.mjs"]) {
  try {
    execFileSync(process.execPath, ["--check", resolve(root, file)], { stdio: "pipe" });
    check(true, file);
  } catch {
    check(false, `JS構文エラー: ${file}`);
  }
}

if (errors.length) {
  console.error(`FAIL ${errors.length}/${checks}`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`PASS ${checks}/${checks} checks`);
  console.log(JSON.stringify({ officialCounts, studyProvisionCount, segmentCount, omittedCount, contentBytes, offlineAssets: offlineAssets.length }, null, 2));
}
