import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, "inputs");
const previewDir = path.join(root, "previews");
await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const TEAM = "Проектный офис";
const PREFIX = "QA-IMP-20260920";
const manifest = [];

function record(file, group, expected, note = "") {
  manifest.push({ file, group, expected, note });
}

async function writeText(file, text, group, expected, note = "") {
  await fs.writeFile(path.join(outDir, file), text, "utf8");
  record(file, group, expected, note);
}

async function writeBytes(file, bytes, group, expected, note = "") {
  await fs.writeFile(path.join(outDir, file), bytes);
  record(file, group, expected, note);
}

function cp1251(text) {
  const bytes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 0x80) bytes.push(code);
    else if (code >= 0x0410 && code <= 0x042f) bytes.push(0xc0 + code - 0x0410);
    else if (code >= 0x0430 && code <= 0x044f) bytes.push(0xe0 + code - 0x0430);
    else if (code === 0x0401) bytes.push(0xa8);
    else if (code === 0x0451) bytes.push(0xb8);
    else if (code === 0x00ab) bytes.push(0xab);
    else if (code === 0x00bb) bytes.push(0xbb);
    else if (code === 0x2014) bytes.push(0x97);
    else if (code === 0x2013) bytes.push(0x96);
    else throw new Error(`Unsupported CP1251 character U+${code.toString(16)}: ${ch}`);
  }
  return Buffer.from(bytes);
}

function csv(headers, rows, delimiter = ";", bom = false, eol = "\r\n") {
  const quote = (value) => {
    const s = String(value ?? "");
    if (s.includes(delimiter) || s.includes('"') || /[\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const body = [headers, ...rows].map((r) => r.map(quote).join(delimiter)).join(eol) + eol;
  return (bom ? "\ufeff" : "") + body;
}

const baseHeaders = ["title", "team_id"];
const baseRow = (suffix) => [`${PREFIX}-${suffix}`, TEAM];

await writeText("01_valid_utf8_bom_semicolon.csv", csv(baseHeaders, [baseRow("VALID-BOM")], ";", true), "positive", "1 created");
await writeText("02_valid_utf8_comma.csv", csv(baseHeaders, [baseRow("VALID-COMMA")], ","), "positive", "1 created");
await writeBytes("03_valid_cp1251_semicolon.csv", cp1251(csv(["Название задачи", "Ответственная команда"], [[`${PREFIX}-CP1251`, TEAM]], ";")), "encoding", "Backend: 1 created; UI preview should preserve Cyrillic", "Frontend currently reads CSV as UTF-8 only.");
await writeText("04_valid_technical_headers_case_space.csv", csv([" TITLE ", " Team_ID "], [[`${PREFIX}-CASE`, `  ${TEAM}  `]]), "mapping", "1 created");
await writeText("05_valid_russian_labels.csv", csv(["Название задачи", "Ответственная команда"], [[`${PREFIX}-RU-LABELS`, TEAM]]), "mapping", "1 created");
await writeText("06_unknown_column_ignored.csv", csv(["title", "team_id", "QA_UNKNOWN"], [[`${PREFIX}-UNKNOWN-COL`, TEAM, "ignored"]]), "mapping", "1 created; unknown column ignored");
await writeText("07_header_only.csv", "title;team_id\r\n", "structure", "200 with total=0, created=0, skipped=0");
await writeText("08_blank_lines_only.csv", "\r\n\r\n", "structure", "UI should explain empty data; server currently returns total=0 if submitted");
await writeBytes("09_empty_zero_bytes.csv", Buffer.alloc(0), "file", "HTTP 400: Файл пуст");
await writeText("10_missing_title_header.csv", csv(["team_id"], [[TEAM]]), "headers", "UI blocks: missing title");
await writeText("11_missing_team_header.csv", csv(["title"], [[`${PREFIX}-NO-TEAM-HEADER`]]), "headers", "UI blocks: missing team");
await writeText("12_unknown_headers_only.csv", csv(["foo", "bar"], [["x", "y"]]), "headers", "UI blocks both required headers; direct API skips row with 2 required_missing errors");
await writeText("13_empty_required_cells.csv", csv(baseHeaders, [["", ""], [`${PREFIX}-NO-TEAM`, ""], ["", TEAM]]), "required", "3 skipped; required_missing");
await writeText("14_whitespace_required_cells.csv", csv(baseHeaders, [["   ", "\t"]]), "required", "1 skipped; required_missing");
await writeText("15_duplicate_title_header.csv", "title;title;team_id\r\nfirst;second;Проектный офис\r\n", "headers", "Observe duplicate-header behavior: DictReader keeps last title");
await writeText("16_duplicate_team_header.csv", "title;team_id;team_id\r\nQA-IMP-20260920-DUP-TEAM;Проектный офис;Несуществующая команда\r\n", "headers", "Observe duplicate-header behavior: last team value wins");
await writeText("17_empty_header_cell.csv", ";title;team_id\r\nignored;QA-IMP-20260920-EMPTY-HEADER;Проектный офис\r\n", "headers", "1 created; unnamed column ignored");
await writeText("18_missing_trailing_cell.csv", "title;team_id;description\r\nQA-IMP-20260920-MISSING-CELL;Проектный офис\r\n", "rows", "1 created; missing optional cell treated blank");
await writeText("19_extra_trailing_cell.csv", "title;team_id\r\nQA-IMP-20260920-EXTRA-CELL;Проектный офис;EXTRA\r\n", "rows", "1 created; extra cell ignored (key None)");
await writeText("20_mixed_delimiters_header_semicolon.csv", "title;team_id;description\r\nQA-IMP-20260920-MIXED,Проектный офис,text\r\n", "delimiter", "1 skipped; row parsed into first column only");
await writeText("21_tab_delimited.csv", "title\tteam_id\r\nQA-IMP-20260920-TAB\tПроектный офис\r\n", "delimiter", "UI blocks/server skips: unsupported delimiter");
await writeText("22_pipe_delimited.csv", "title|team_id\r\nQA-IMP-20260920-PIPE|Проектный офис\r\n", "delimiter", "UI blocks/server skips: unsupported delimiter");
await writeText("23_blank_first_line_semicolon.csv", "\r\ntitle;team_id\r\nQA-IMP-20260920-BLANK-FIRST;Проектный офис\r\n", "delimiter", "Should accept per docs; server currently detects comma from blank first line");
await writeText("24_mac_cr_line_endings.csv", "title;team_id\rQA-IMP-20260920-MAC-CR;Проектный офис\r", "line-endings", "Observe server/UI handling of CR-only rows");
await writeText("25_quoted_delimiters_and_quotes.csv", csv(["title", "team_id", "description"], [[`${PREFIX}-QUOTED`, TEAM, 'Text; comma, and "quote"']]), "csv-quoting", "1 created with exact description");
await writeText("26_quoted_multiline.csv", csv(["title", "team_id", "description"], [[`${PREFIX}-MULTILINE`, TEAM, "line 1\nline 2"]]), "csv-quoting", "Backend should create; UI preview parser currently splits physical lines");
await writeText("27_malformed_unclosed_quote.csv", "title;team_id;description\r\nQA-IMP-20260920-UNCLOSED;Проектный офис;\"never closed\r\n", "csv-quoting", "Observe malformed CSV handling and user-facing error");
await writeBytes("28_utf16le_bom.csv", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv(baseHeaders, [baseRow("UTF16")]), "utf16le")]), "encoding", "Should reject unsupported UTF-16 clearly; current cp1251 fallback may misdecode");
await writeBytes("29_undecodable_byte_98.csv", Buffer.from([0x98]), "encoding", "HTTP 400 decode error");
await writeBytes("30_nul_bytes.csv", Buffer.from("title;team_id\r\nQA\0-IMP;Проектный офис\r\n", "utf8"), "encoding", "Observe NUL handling; no crash/stack trace");

const dateRows = [
  ["YYYY-MM-DD", "2026-09-20"], ["DD.MM.YYYY", "20.09.2026"], ["DD/MM/YYYY", "20/09/2026"],
  ["DD.MM.YY", "20.09.26"], ["DD/MM/YY", "20/09/26"], ["LEAP-VALID", "29.02.2024"],
  ["LEAP-INVALID", "29.02.2025"], ["MONTH-13", "01.13.2026"], ["ISO-TIME", "2026-09-20T10:00:00"],
  ["SPACE", " 2026-09-20 "], ["EMPTY", ""], ["ZERO", "0000-00-00"], ["EXCEL-SERIAL", "45555"],
].map(([name, value]) => [`${PREFIX}-DATE-${name}`, TEAM, value]);
await writeText("31_dates_boundaries.csv", csv(["title", "team_id", "date_received"], dateRows), "date", "Allowed formats create; invalid formats skip; empty uses default date");

const progressValues = ["0", "100", "-1", "101", "1.0", "1.5", "+1", " 50 ", "01", "1e2", "NaN", "Infinity", "", "-0"];
await writeText("32_progress_boundaries.csv", csv(["title", "team_id", "progress"], progressValues.map((v, i) => [`${PREFIX}-PROGRESS-${i}`, TEAM, v])), "number", "Exercise integer parsing and 0..100 bounds");

const numericHeaders = ["title", "team_id", "effort_days", "effort_rub", "effort_designee", "actual_effort_days", "financial_effect", "cv", "metric_kr_plan", "metric_kr_fact"];
const numericValues = ["abc", "1,5", "1.5", "1e3", "NaN", "Infinity", "-1", "999999999999999999999999", "", " 2 "];
await writeText("33_numeric_formats.csv", csv(numericHeaders, numericValues.map((v, i) => [`${PREFIX}-NUM-${i}`, TEAM, v, v, v, v, v, v, v, v])), "number", "Exercise every numeric field with invalid, scientific, non-finite, negative and overflow values");

const boolValues = ["true", "TRUE", "1", "yes", "да", "y", "false", "0", "no", "нет", "maybe", "2", ""];
await writeText("34_boolean_spellings.csv", csv(["title", "team_id", "did_demo"], boolValues.map((v, i) => [`${PREFIX}-BOOL-${i}`, TEAM, v])), "boolean", "Observe permissive boolean mapping: unknown tokens currently become false without warning");

const refHeaders = ["title", "team_id", "channel_id", "business_customer_id", "department_id", "project_id", "task_type_id", "priority_id", "deadline_id", "status_id", "did_client_group_id", "owner_id", "involved_teams"];
const refRows = [
  [`${PREFIX}-REF-CHANNEL`, TEAM, "__NOT_FOUND__", "", "", "", "", "", "", "", "", "", ""],
  [`${PREFIX}-REF-CUSTOMER`, TEAM, "", "__NOT_FOUND__", "", "", "", "", "", "", "", "", ""],
  [`${PREFIX}-REF-DEPARTMENT`, TEAM, "", "", "__NOT_FOUND__", "", "", "", "", "", "", "", ""],
  [`${PREFIX}-REF-PROJECT`, TEAM, "", "", "", "__NOT_FOUND__", "", "", "", "", "", "", ""],
  [`${PREFIX}-REF-TYPE`, TEAM, "", "", "", "", "__NOT_FOUND__", "", "", "", "", "", ""],
  [`${PREFIX}-REF-PRIORITY`, TEAM, "", "", "", "", "", "__NOT_FOUND__", "", "", "", "", ""],
  [`${PREFIX}-REF-DEADLINE`, TEAM, "", "", "", "", "", "", "__NOT_FOUND__", "", "", "", ""],
  [`${PREFIX}-REF-STATUS`, TEAM, "", "", "", "", "", "", "", "__NOT_FOUND__", "", "", ""],
  [`${PREFIX}-REF-DID`, TEAM, "", "", "", "", "", "", "", "", "__NOT_FOUND__", "", ""],
  [`${PREFIX}-REF-OWNER`, TEAM, "", "", "", "", "", "", "", "", "", "__NOT_FOUND__", ""],
  [`${PREFIX}-REF-INVOLVED`, TEAM, "", "", "", "", "", "", "", "", "", "", "__NOT_FOUND__"],
  [`${PREFIX}-REF-INVOLVED-ID`, TEAM, "", "", "", "", "", "", "", "", "", "", "999999999"],
  [`${PREFIX}-REF-TEAM`, "__NOT_FOUND__", "", "", "", "", "", "", "", "", "", "", ""],
];
await writeText("35_reference_not_found.csv", csv(refHeaders, refRows), "reference", "Exercise every lookup; note customer/DID/owner are non-fatal in current code");

await writeText("36_lists_and_urls.csv", csv(["title", "team_id", "involved_teams", "link_jira", "link_mockups"], [
  [`${PREFIX}-LIST-VALID`, TEAM, `${TEAM},${TEAM}`, "https://jira.example/ABC-1;https://jira.example/ABC-1", "javascript:alert(1)"],
  [`${PREFIX}-LIST-EMPTY-TOKENS`, TEAM, `, ; ${TEAM} ;;`, `,;`, "not-a-url"],
]), "list-url", "Exercise duplicate list entries, empty tokens and unvalidated URLs");

await writeText("37_length_and_injection.csv", csv(["title", "team_id", "description", "link_mockups", "metric_kr_unit"], [
  ["A".repeat(255), TEAM, "D".repeat(1000), "https://example.test/" + "x".repeat(470), "u".repeat(50)],
  ["B".repeat(256), TEAM, "long title", "https://example.test/" + "x".repeat(600), "u".repeat(51)],
  [`<img src=x onerror=alert(1)>`, TEAM, `=HYPERLINK("https://example.invalid","CSV")`, "javascript:alert(1)", "<script>"],
  [`'=2+2`, TEAM, `+cmd|' /C calc'!A0`, "@SUM(1+1)", "-1+1"],
]), "length-security", "Exercise DB length limits, HTML escaping and spreadsheet-formula injection surfaces");

await writeText("38_repeated_same_task.csv", csv(baseHeaders, [baseRow("DUPLICATE"), baseRow("DUPLICATE")]), "duplicate", "2 tasks created; no deduplication");
await writeText("39_partial_success.csv", csv(["title", "team_id", "progress"], [baseRow("PARTIAL-OK").concat("50"), [`${PREFIX}-PARTIAL-BAD`, "__NOT_FOUND__", "101"]]), "transaction", "1 created, 1 skipped; errors isolated by row");

async function createXlsx(file, sheets, expected, note = "") {
  const workbook = Workbook.create();
  for (const spec of sheets) {
    const sheet = workbook.worksheets.add(spec.name);
    sheet.showGridLines = false;
    if (spec.rows.length) {
      const width = Math.max(...spec.rows.map((r) => r.length));
      const normalized = spec.rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
      const range = sheet.getRangeByIndexes(0, 0, normalized.length, width);
      range.values = normalized;
      range.format.font = { name: "Arial", size: 10 };
      if (normalized.length > 0) {
        const header = sheet.getRangeByIndexes(0, 0, 1, width);
        header.format = { fill: "#1F4E78", font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, wrapText: true };
      }
      range.format.autofitColumns();
      range.format.autofitRows();
      sheet.freezePanes.freezeRows(1);
    }
  }
  workbook.recalculate();
  const check = await workbook.inspect({ kind: "sheet,table", maxChars: 4000, tableMaxRows: 8, tableMaxCols: 12 });
  await fs.writeFile(path.join(root, `${file}.inspect.ndjson`), check.ndjson, "utf8");
  const firstSheet = sheets[0]?.name;
  if (firstSheet && sheets[0].rows.length) {
    const image = await workbook.render({ sheetName: firstSheet, autoCrop: "all", scale: 1, format: "png" });
    await fs.writeFile(path.join(previewDir, `${file}.png`), new Uint8Array(await image.arrayBuffer()));
  }
  const blob = await SpreadsheetFile.exportXlsx(workbook);
  await blob.save(path.join(outDir, file));
  record(file, "excel", expected, note);
}

await createXlsx("40_valid_minimal.xlsx", [{ name: "Данные", rows: [baseHeaders, baseRow("XLSX-MIN")] }], "UI converts first sheet to CSV; 1 created");

const allHeaders = ["title", "team_id", "description", "date_received", "effort_days", "effort_rub", "effort_designee", "effort_analytics", "effort_be", "effort_python_be", "effort_fe", "effort_test", "effort_test_auto", "effort_delivery", "actual_effort_days", "actual_effort_designee", "actual_effort_analytics", "actual_effort_be", "actual_effort_python_be", "actual_effort_fe", "actual_effort_test", "actual_effort_test_auto", "actual_effort_delivery", "financial_effect", "financial_effect_justification", "cv", "progress", "link_mockups", "link_jira", "rejection_reason", "comment", "key_project_status", "directorate_status", "did_status", "did_demo", "metric_kr_plan", "metric_kr_fact", "metric_kr_unit"];
const allRow = [`${PREFIX}-XLSX-ALL`, TEAM, "All fields without optional references", new Date("2026-09-20T00:00:00Z"), 5, 1000.25, 1, 2, 3, 4, 5, 6, 7, 8, 36, 1, 2, 3, 4, 5, 6, 7, 8, 10.5, "justification", 0.0105, 50, "https://example.test/mockup", "https://jira.example/ABC-1", "", "comment", "key", "directorate", "did", true, 100, 90, "%"];
await createXlsx("41_valid_all_fields.xlsx", [{ name: "Данные", rows: [allHeaders, allRow] }], "UI conversion preserves dates/numbers/boolean; 1 created");
await createXlsx("42_multisheet_instructions_first.xlsx", [
  { name: "Инструкция", rows: [["Этот лист не содержит заголовков импорта"], ["Данные находятся на втором листе"]] },
  { name: "Данные", rows: [baseHeaders, baseRow("SECOND-SHEET")] },
], "UI only reads first sheet and should block with missing required columns");
await createXlsx("43_header_offset.xlsx", [{ name: "Данные", rows: [["Отчёт импорта"], [""], baseHeaders, baseRow("HEADER-OFFSET")] }], "UI treats row 1 as header and should block");

const xlsXml = `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Данные"><Table><Row><Cell><Data ss:Type="String">title</Data></Cell><Cell><Data ss:Type="String">team_id</Data></Cell></Row><Row><Cell><Data ss:Type="String">${PREFIX}-XLS-XML</Data></Cell><Cell><Data ss:Type="String">${TEAM}</Data></Cell></Row></Table></Worksheet></Workbook>`;
await writeText("44_valid_spreadsheetml_2003.xls", xlsXml, "excel", "SheetJS should read SpreadsheetML .xls and create 1 task");
await writeBytes("45_corrupt_excel.xlsx", Buffer.from("PK\x03\x04not-a-real-xlsx", "binary"), "excel-error", "UI toast with readable Excel error; import stays disabled");
await writeText("46_text_renamed_as_xlsx.xlsx", csv(baseHeaders, [baseRow("TEXT-XLSX")]), "excel-error", "Observe signature/content mismatch handling");
await writeBytes("47_corrupt_legacy_excel.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 1, 2, 3]), "excel-error", "UI toast with readable Excel error; no crash");
await writeText("48_wrong_extension.txt", csv(baseHeaders, [baseRow("TXT")]), "file", "UI chooser filters; direct API HTTP 400 only CSV supported");
await writeText("49_uppercase_extension.CSV", csv(baseHeaders, [baseRow("UPPERCASE-EXT")]), "file", "Accepted; 1 created");
await writeBytes("50_xlsx_bytes_named_csv.csv", await fs.readFile(path.join(outDir, "40_valid_minimal.xlsx")), "file", "CSV extension passes router; decode/parse must fail safely");

const rows10000 = [baseHeaders.join(";")];
for (let i = 0; i < 10000; i++) rows10000.push(`;${TEAM}`);
await writeText("51_exactly_10000_rows.csv", rows10000.join("\n") + "\n", "limits", "Accepted parser limit; 10000 skipped required_missing");
const rows10001 = [...rows10000, `;${TEAM}`];
await writeText("52_over_10000_rows.csv", rows10001.join("\n") + "\n", "limits", "HTTP 400: more than 10000 rows");

function makeSizedCsv(size) {
  const header = "title;team_id;description\n";
  const rowPrefix = `;${TEAM};`;
  const chunks = [header];
  let current = Buffer.byteLength(header, "utf8");
  while (current < size) {
    const remaining = size - current;
    if (remaining <= Buffer.byteLength(rowPrefix, "utf8") + 2) {
      chunks.push(" ".repeat(remaining));
      break;
    }
    const payloadLen = Math.min(900, remaining - Buffer.byteLength(rowPrefix, "utf8") - 1);
    const line = rowPrefix + "x".repeat(payloadLen) + "\n";
    chunks.push(line);
    current += Buffer.byteLength(line, "utf8");
  }
  const result = Buffer.from(chunks.join(""), "utf8");
  return result.length === size ? result : Buffer.concat([result, Buffer.alloc(size - result.length, 0x20)]);
}
await writeBytes("53_exactly_10mb.csv", makeSizedCsv(10 * 1024 * 1024), "limits", "Router accepts size boundary; parser outcome captured separately", "Designed with short fields; row-count limit may trigger first.");
await writeBytes("54_over_10mb.csv", makeSizedCsv(10 * 1024 * 1024 + 1), "limits", "HTTP 413: maximum 10 MB");

await writeText("55_many_preview_errors.csv", csv(["title", "team_id", "date_received", "progress", "effort_days"], Array.from({ length: 25 }, (_, i) => ["", TEAM, "bad-date", String(101 + i), "bad-number"])), "ux", "UI shows first 20 row warnings plus remaining count; server skips all");
await writeText("56_long_server_messages.csv", csv(["title", "team_id", "channel_id"], [[`${PREFIX}-LONG-ERROR`, TEAM, "X".repeat(5000)]]), "ux", "Long value/message scrolls or wraps without breaking modal");

await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
const manifestCsv = csv(["file", "group", "expected", "note"], manifest.map((m) => [m.file, m.group, m.expected, m.note]));
await fs.writeFile(path.join(root, "manifest.csv"), manifestCsv, "utf8");

console.log(`Created ${manifest.length} import fixtures in ${outDir}`);
