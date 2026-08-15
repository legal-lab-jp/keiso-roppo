import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const lawId = "323AC0000000131";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(scriptDir, "..", "..", "..", "work", "keiso-roppo-production", "source");

const lawDataResponse = await fetch(`https://laws.e-gov.go.jp/api/2/law_data/${lawId}`, { headers: { "cache-control": "no-cache" } });
if (!lawDataResponse.ok) throw new Error(`law_data取得失敗: HTTP ${lawDataResponse.status}`);
const lawData = await lawDataResponse.json();
const revisionId = lawData.revision_info?.law_revision_id;
if (!revisionId || lawData.revision_info?.current_revision_status !== "CurrentEnforced") throw new Error("現行施行中リビジョンを取得できませんでした");
const xmlResponse = await fetch(`https://laws.e-gov.go.jp/api/2/law_file/xml/${revisionId}`, { headers: { "cache-control": "no-cache" } });
if (!xmlResponse.ok) throw new Error(`XML取得失敗: HTTP ${xmlResponse.status}`);
const xml = await xmlResponse.text();
if (!xml.includes("<Law")) throw new Error("e-Gov XML本文ではありません");

await mkdir(sourceDir, { recursive: true });
await writeFile(path.join(sourceDir, "law-data.json"), `${JSON.stringify(lawData, null, 2)}\n`, "utf8");
await writeFile(path.join(sourceDir, "keiso.xml"), xml, "utf8");
console.log(JSON.stringify({ lawId, revisionId, sourceDir }, null, 2));
