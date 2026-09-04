"""Small dependency-free OOXML workbook and printable HTML exports."""
from datetime import datetime
from html import escape
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape as xml_escape
from services.did_backlog import COLUMNS, TITLE, display_value, summary


def metadata(quarter, rows):
    return [TITLE, quarter, f'Задач: {len(rows)} · Не заполнено: {summary(rows)["empty_values"]}',
            f'Сформировано: {datetime.now().astimezone().strftime("%d.%m.%Y %H:%M %Z")}']


def workbook(quarter, rows, widths):
    def cell(ref, value, style=0, numeric=False):
        if numeric:
            return f'<c r="{ref}" s="{style}"><v>{value}</v></c>'
        # Inline strings cannot be interpreted as formulas by Excel.
        text = ''.join(ch for ch in str(value) if ord(ch) >= 32 or ch in '\n\r\t')
        return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{xml_escape(text)}</t></is></c>'
    data = []
    for i, text in enumerate(metadata(quarter, rows), 1):
        data.append(f'<row r="{i}">{cell(f"A{i}", text, 1)}</row>')
    data.append('<row r="6">' + ''.join(cell(f'{chr(65+i)}6', label, 1) for i, (_, label, _) in enumerate(COLUMNS)) + '</row>')
    for number, row in enumerate(rows, 7):
        data.append(f'<row r="{number}">' + ''.join(
            cell(f'{chr(65+i)}{number}', row[key] if key == 'financial_effect' and key not in row['gaps'] else display_value(row, key),
                 2 if key in row['gaps'] else (3 if key == 'financial_effect' else 0),
                 key == 'financial_effect' and key not in row['gaps']) for i, (key, _, _) in enumerate(COLUMNS)) + '</row>')
    cols = ''.join(f'<col min="{i}" max="{i}" width="{widths[key]*2}" customWidth="1"/>' for i, (key, _, _) in enumerate(COLUMNS, 1))
    files = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Бэклог ДИД" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        'xl/styles.xml': '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="# ##0.0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF4D6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"><alignment wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"><alignment wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
        'xl/worksheets/sheet1.xml': f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>{cols}</cols><sheetData>{"".join(data)}</sheetData><mergeCells count="4">' + ''.join(f'<mergeCell ref="A{i}:I{i}"/>' for i in range(1,5)) + '</mergeCells></worksheet>',
    }
    output = BytesIO()
    with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
        for name, xml in files.items():
            archive.writestr(name, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + xml)
    return output.getvalue()


def print_html(quarter, rows, widths):
    head = ''.join(f'<p>{escape(line)}</p>' for line in metadata(quarter, rows))
    cols = ''.join(f'<col style="width:{widths[key]}%">' for key, _, _ in COLUMNS)
    headers = ''.join(f'<th>{escape(label)}</th>' for _, label, _ in COLUMNS)
    body = ''.join('<tr>' + ''.join(f'<td class="{"gap" if key in row["gaps"] else ""}">{escape(display_value(row, key))}</td>' for key, _, _ in COLUMNS) + '</tr>' for row in rows)
    return f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>{escape(TITLE)}</title>
    <style>@page {{size:A4 landscape;margin:10mm}} body {{font:10px Arial,sans-serif;color:#172033}}
    table {{width:100%;border-collapse:collapse;table-layout:fixed}} th,td {{border:1px solid #d1d5db;padding:5px;overflow-wrap:anywhere;vertical-align:top}}
    th {{background:#f1f5f9;text-align:left}} thead {{display:table-header-group}} tr {{break-inside:avoid}}
    .gap {{background:#fff4d6!important;color:#855a15;font-style:italic}} * {{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head>
    <body>{head}<table><colgroup>{cols}</colgroup><thead><tr>{headers}</tr></thead><tbody>{body}</tbody></table></body></html>'''
