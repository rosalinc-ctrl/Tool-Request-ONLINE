/**
 * Meiwa Tool Request — Setup.gs
 * เมนูติดตั้ง สร้างชีต ค่าเริ่มต้น และข้อมูลทดสอบ
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔧 Meiwa Tool Request')
    .addItem('1) ติดตั้งระบบ (Setup sheets)', 'menuSetup')
    .addItem('2) แสดงลิงก์เว็บแอป (Web app URL)', 'menuShowUrl')
    .addItem('3) ติดตั้งแจ้งเตือนรายวัน (Daily digest)', 'menuInstallTrigger')
    .addSeparator()
    .addItem('สร้างข้อมูลทดสอบ (Demo data)', 'menuDemoData')
    .addToUi();
}

function menuSetup() {
  setupAll();
  SpreadsheetApp.getUi().alert(
    'ติดตั้งเรียบร้อย\n\n' +
    'ขั้นต่อไป:\n' +
    '1. แก้ชีต Config: STAFF_PIN, PURCHASING_EMAILS และข้อมูลบริษัทสำหรับใบกำกับภาษี\n' +
    '2. ใส่รายชื่อช่างในชีต Technicians\n' +
    '3. Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone)'
  );
}

function menuShowUrl() {
  var u = webappUrl_();
  if (!u) {
    SpreadsheetApp.getUi().alert('ยังไม่ได้ Deploy เว็บแอป\nไปที่ Deploy > New deployment > Web app');
    return;
  }
  SpreadsheetApp.getUi().alert(
    'ลิงก์สำหรับช่าง (ส่งทาง LINE):\n' + u + '\n\n' +
    'หน้าจัดซื้อ:\n' + u + '?p=dash'
  );
}

function menuInstallTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyDigest').timeBased().atHour(8).everyDays(1).create();
  SpreadsheetApp.getUi().alert('ติดตั้งแจ้งเตือนรายวันเรียบร้อย (ทุกวันประมาณ 08:00 น.)');
}

function setupAll() {
  var ss = SpreadsheetApp.getActive();
  ['Config', 'Technicians', 'Requests', 'Items', 'Options', 'History', 'Notifications']
    .forEach(function (name) { ensureSheet_(name); });

  seedConfig_();
  seedTechs_();
  rootFolder_();

  // ลบชีตเปล่าเริ่มต้นของ Google
  var s1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('แผ่น1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);

  ss.setActiveSheet(ss.getSheetByName(SHEET.CONFIG));
  return 'ok';
}

function ensureSheet_(name) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var headers = HEADERS[name];
  // ชีตใหม่ของ Google มี 26 คอลัมน์ แต่ชีต Items ต้องใช้ 30 -> ขยายก่อนเขียนหัวตาราง
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#e8eef7');
  sh.setFrozenRows(1);
  if (sh.getMaxColumns() > headers.length) {
    sh.deleteColumns(headers.length + 1, sh.getMaxColumns() - headers.length);
  }
  sh.autoResizeColumns(1, Math.min(headers.length, 12));
  return sh;
}

function seedConfig_() {
  var sh = sh_(SHEET.CONFIG);
  var existing = {};
  readAll_(SHEET.CONFIG).forEach(function (r) { existing[r.key] = true; });
  DEFAULT_CONFIG.forEach(function (row) {
    if (!existing[row[0]]) sh.appendRow(row);
  });
  __cfgCache = null;
}

function seedTechs_() {
  if (readAll_(SHEET.TECHS).length) return;
  var sh = sh_(SHEET.TECHS);
  [
    ['ช่างสมชาย ใจดี', 'ช่างชาย', 'โรงงาน 1', '', 'Y'],
    ['ช่างวิชัย แก้วมณี', 'ช่างวิ', 'โรงงาน 1', '', 'Y'],
    ['ช่างนพดล ศรีสุข', 'ช่างนพ', 'โรงงาน 2', '', 'Y']
  ].forEach(function (r) { sh.appendRow(r); });
}

/** ข้อมูลทดสอบ 1 ใบ 2 รายการ */
function menuDemoData() {
  var res = apiSubmitRequest({
    requester_name: 'ช่างสมชาย ใจดี',
    site: 'โรงงาน 1',
    contact: 'LINE: somchai.tech',
    required_date: Utilities.formatDate(new Date(Date.now() + 7 * 86400000), tz_(), 'yyyy-MM-dd'),
    note: 'ข้อมูลทดสอบระบบ',
    items: [
      {
        tool_name: 'สว่านโรตารี่ 26 มม.', qty: 1, unit: 'ตัว',
        intended_use: 'เจาะปูนติดตั้งแป้นเครื่องจักร ไลน์ 3',
        spec_pref: 'SDS-Plus, 800W ขึ้นไป, แรงกระแทก 2.5J ขึ้นไป',
        brand_pref: 'Bosch GBH 2-26 หรือ Makita เทียบเท่า',
        item_note: 'ตัวเดิมหัวจับหลวม ใช้ไม่ได้แล้ว',
        benchmark_price: 4890, benchmark_store: 'Global House (โกลบอลเฮ้าส์)',
        ref_links: ''
      },
      {
        tool_name: 'ประแจทอร์ค 1/2 นิ้ว', qty: 2, unit: 'ตัว',
        required_date: Utilities.formatDate(new Date(Date.now() + 14 * 86400000), tz_(), 'yyyy-MM-dd'),
        intended_use: 'ขันโบลต์หน้าแปลนตามค่าทอร์ค',
        spec_pref: '40-200 N·m มีใบรับรองการสอบเทียบ',
        brand_pref: '',
        item_note: 'ใช้คู่กับงาน PM เดือนหน้า',
        benchmark_price: 2150, benchmark_store: 'Global House (โกลบอลเฮ้าส์)',
        ref_links: ''
      }
    ]
  });
  SpreadsheetApp.getUi().alert('สร้างใบทดสอบ ' + res.req_id + '\n\nลิงก์สำหรับช่าง:\n' + res.url);
}
