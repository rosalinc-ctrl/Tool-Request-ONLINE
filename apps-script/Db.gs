/**
 * Meiwa Tool Request — Db.gs
 * ตัวช่วยอ่าน/เขียน Google Sheet แบบ object (header -> field)
 */

function sh_(name) {
  var s = SpreadsheetApp.getActive().getSheetByName(name);
  if (!s) throw new Error('ไม่พบชีต "' + name + '" — กรุณารันเมนู Meiwa > 1) ติดตั้งระบบ (Setup) ก่อน');
  return s;
}

function norm_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm:ss');
  return v;
}

/** อ่านทั้งชีตเป็น array ของ object พร้อมเลขแถว (_row) */
function readAll_(name) {
  var sheet = sh_(name);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.join('') === '') continue;
    var o = { _row: r + 1 };
    for (var c = 0; c < headers.length; c++) {
      if (headers[c]) o[String(headers[c])] = norm_(row[c]);
    }
    out.push(o);
  }
  return out;
}

function appendRow_(name, obj) {
  var headers = HEADERS[name];
  var row = headers.map(function (h) {
    var v = obj[h];
    return (v === undefined || v === null) ? '' : v;
  });
  sh_(name).appendRow(row);
}

function updateRow_(name, rowIndex, patch) {
  var headers = HEADERS[name];
  var range = sh_(name).getRange(rowIndex, 1, 1, headers.length);
  var row = range.getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (Object.prototype.hasOwnProperty.call(patch, headers[i])) {
      var v = patch[headers[i]];
      row[i] = (v === undefined || v === null) ? '' : v;
    }
  }
  range.setValues([row]);
}

function findBy_(name, field, value) {
  var v = String(value);
  return readAll_(name).filter(function (o) { return String(o[field]) === v; });
}

function findOne_(name, field, value) {
  var r = findBy_(name, field, value);
  return r.length ? r[0] : null;
}

/** เลขที่คำขอแบบอ่านง่าย เช่น TR-2609-0001 */
function nextReqId_() {
  var props = PropertiesService.getDocumentProperties();
  var n = Number(props.getProperty('SEQ_REQ') || '0') + 1;
  props.setProperty('SEQ_REQ', String(n));
  return 'TR-' + Utilities.formatDate(new Date(), tz_(), 'yyMM') + '-' + ('0000' + n).slice(-4);
}

function newToken_() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 16);
}

function num_(v) {
  if (v === null || v === undefined || v === '') return 0;
  var n = Number(String(v).replace(/[, ฿]/g, ''));
  return isNaN(n) ? 0 : n;
}

function str_(v, max) {
  var s = (v === null || v === undefined) ? '' : String(v).trim();
  if (max && s.length > max) s = s.substring(0, max);
  return s;
}

function logHistory_(reqId, itemId, optionId, actor, role, action, detail) {
  appendRow_(SHEET.HISTORY, {
    ts: now_(), req_id: reqId || '', item_id: itemId || '', option_id: optionId || '',
    actor: actor || '', role: role || '', action: action || '', detail: str_(detail, 500)
  });
}

function activeTechs_() {
  return readAll_(SHEET.TECHS)
    .filter(function (t) { return String(t.active).toUpperCase() !== 'N' && String(t.name).trim(); })
    .map(function (t) {
      return { name: String(t.name).trim(), nickname: str_(t.nickname), site: str_(t.site), line_id: str_(t.line_id) };
    });
}
