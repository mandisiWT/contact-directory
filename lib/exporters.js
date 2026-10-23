// CSV and Excel (.xlsx) writers shared by the contact export and the activity report.
function csvCell(value) {
  let text = String(value ?? '');
  // Protect spreadsheet users from CSV formula injection.
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function toCsv(headers, rows) {
  return '\uFEFF' + [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function colName(n) {
  let out = '';
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

function makeXlsx(headers, rows, sheetName = 'Sheet1') {
  const { zipSync } = require('fflate');
  const data = [headers, ...rows];
  const sheetRows = data.map((row, ri) => '<row r="' + (ri + 1) + '">' +
    row.map((v, ci) => '<c r="' + colName(ci + 1) + (ri + 1) + '" t="inlineStr"><is><t xml:space="preserve">' +
      xmlEscape(v) + '</t></is></c>').join('') + '</row>').join('');
  const safeName = xmlEscape(String(sheetName).replace(/[\[\]\*\?\/\\:]/g, ' ').slice(0, 31) || 'Sheet1');
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = {
    '[Content_Types].xml': head +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': head +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': head +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + safeName + '" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': head +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': head +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      sheetRows + '</sheetData></worksheet>'
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)]))));
}

module.exports = { csvCell, toCsv, makeXlsx, xmlEscape };
