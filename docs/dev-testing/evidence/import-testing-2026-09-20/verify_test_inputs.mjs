import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const root = path.dirname(fileURLToPath(import.meta.url));
const inputDir = path.join(root, "inputs");
const previewDir = path.join(root, "previews", "all-sheets");
await fs.mkdir(previewDir, { recursive: true });

const workbooks = [
  "40_valid_minimal.xlsx",
  "41_valid_all_fields.xlsx",
  "42_multisheet_instructions_first.xlsx",
  "43_header_offset.xlsx",
];

const results = [];
for (const file of workbooks) {
  const blob = await FileBlob.load(path.join(inputDir, file));
  const workbook = await SpreadsheetFile.importXlsx(blob);
  workbook.recalculate();
  const sheetsInspect = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 4000 });
  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
    options: { useRegex: true, maxResults: 300 },
    summary: `formula errors in ${file}`,
    maxChars: 4000,
  });
  const sheetRecords = String(sheetsInspect.ndjson || "").split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const names = [...new Set(sheetRecords.map((r) => r.name).filter(Boolean))];
  for (const name of names) {
    const image = await workbook.render({ sheetName: name, autoCrop: "all", scale: 1, format: "png" });
    const safe = name.replace(/[^\p{L}\p{N}._-]+/gu, "_");
    await fs.writeFile(path.join(previewDir, `${file}__${safe}.png`), new Uint8Array(await image.arrayBuffer()));
  }
  results.push({ file, sheets: names, formulaErrorScan: String(errors.ndjson || "") });
}

await fs.writeFile(path.join(root, "xlsx-verification.json"), JSON.stringify(results, null, 2), "utf8");
console.log(JSON.stringify(results.map((r) => ({ file: r.file, sheets: r.sheets, errorScanLength: r.formulaErrorScan.length })), null, 2));
