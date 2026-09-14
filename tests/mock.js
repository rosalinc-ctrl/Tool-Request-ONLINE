/* Mock ของ Google Apps Script services เพื่อทดสอบ logic ฝั่งเซิร์ฟเวอร์ใน Node */
const crypto = require('crypto');

function pad(n, l) { return ('0000' + n).slice(-(l || 2)); }
function formatDate(d, tz, fmt) {
  const o = { yyyy: d.getFullYear(), yy: String(d.getFullYear()).slice(-2), MM: pad(d.getMonth() + 1),
    dd: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()) };
  return fmt.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, k => o[k]);
}

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet._row(this.r + i);
      out.push(row.slice(this.c - 1, this.c - 1 + this.nc).map(v => v === undefined ? '' : v));
    }
    return out;
  }
  setValues(vals) {
    vals.forEach((rowVals, i) => {
      const row = this.sheet._row(this.r + i);
      rowVals.forEach((v, j) => { row[this.c - 1 + j] = v; });
    });
    return this;
  }
  setValue(v) { this.sheet._row(this.r)[this.c - 1] = v; return this; }
  setFontWeight() { return this; } setBackground() { return this; } setNumberFormat() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; this.maxCols = 26; this.maxRows = 1000; }
  _row(r) { while (this.data.length < r) this.data.push([]); return this.data[r - 1]; }
  getName() { return this.name; }
  getLastRow() {
    let last = 0;
    this.data.forEach((row, i) => { if (row.some(v => v !== '' && v !== undefined && v !== null)) last = i + 1; });
    return last;
  }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(after, howMany) { this.maxCols += howMany; return this; }
  getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  getRange(r, c, nr, nc) {
    const cols = nc === undefined ? 1 : nc;
    if (c + cols - 1 > this.maxCols) {
      throw new Error('Range exceeds sheet columns: sheet "' + this.name + '" has ' + this.maxCols +
        ' columns, requested up to ' + (c + cols - 1));
    }
    return new Range(this, r, c, nr === undefined ? 1 : nr, cols);
  }
  appendRow(arr) {
    if (arr.length > this.maxCols) {
      throw new Error('appendRow: ' + arr.length + ' values but sheet "' + this.name + '" has ' + this.maxCols + ' columns');
    }
    this.data.push(arr.slice());
  }
  setFrozenRows() { return this; }
  autoResizeColumns() { return this; }
  deleteColumns(pos, howMany) { this.maxCols -= howMany; return this; }
}

class Spreadsheet {
  constructor() { this.sheets = []; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  setActiveSheet() { return this; }
}

const SS = new Spreadsheet();
const MAIL = [];
const FILES = {};
const FOLDERS = {};

function makeFolder(name) {
  const id = 'fld_' + crypto.randomBytes(6).toString('hex');
  const f = {
    _name: name, _children: {},
    getId: () => id, getName: () => name,
    getFoldersByName(n) {
      const c = f._children[n];
      let done = !c;
      return { hasNext: () => !done, next: () => { done = true; return c; } };
    },
    createFolder(n) { const nf = makeFolder(n); f._children[n] = nf; return nf; },
    createFile(blob) {
      const fid = 'file_' + crypto.randomBytes(8).toString('hex');
      const file = { getId: () => fid, getName: () => blob.getName(), setSharing: () => file };
      FILES[fid] = { name: blob.getName(), bytes: blob._bytes.length, folder: name };
      return file;
    }
  };
  FOLDERS[id] = f;
  return f;
}

const g = {
  console,
  SpreadsheetApp: {
    getActive: () => SS,
    getUi: () => ({ alert: m => { g.__alerts.push(m); }, createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() { } }) })
  },
  __alerts: [],
  Utilities: {
    formatDate,
    getUuid: () => crypto.randomUUID(),
    base64Decode: s => Array.from(Buffer.from(s, 'base64')),
    newBlob: (bytes, mime, name) => ({ _bytes: bytes, getName: () => name, getContentType: () => mime }),
    sleep: () => { }
  },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok', getActiveUser: () => ({ getEmail: () => '' }) },
  PropertiesService: (() => {
    const store = {};
    const api = { getProperty: k => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = v; return api; } };
    return { getDocumentProperties: () => api, getScriptProperties: () => api };
  })(),
  CacheService: (() => {
    const store = {};
    const api = { put: (k, v) => { store[k] = v; }, get: k => (k in store ? store[k] : null), remove: k => { delete store[k]; } };
    return { getScriptCache: () => api };
  })(),
  LockService: { getScriptLock: () => ({ waitLock: () => { }, releaseLock: () => { } }) },
  DriveApp: {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
    Permission: { VIEW: 'VIEW' },
    createFolder: n => makeFolder(n),
    getFolderById: id => { if (!FOLDERS[id]) throw new Error('not found'); return FOLDERS[id]; }
  },
  MailApp: { sendEmail: (to, subject, body) => MAIL.push({ to, subject, body }) },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => 'ok' }) },
  ScriptApp: {
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TESTDEPLOY/exec' }),
    getProjectTriggers: () => [], deleteTrigger: () => { },
    newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({ create: () => { } }) }) }) })
  },
  HtmlService: { createTemplateFromFile: () => ({ evaluate: () => ({ setTitle: () => ({ addMetaTag: () => ({}) }) }) }) }
};

module.exports = { g, SS, MAIL, FILES, FOLDERS };
