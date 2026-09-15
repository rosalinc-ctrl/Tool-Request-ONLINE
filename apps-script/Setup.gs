/**
 * Meiwa Tool Request — Setup.gs
 * เมนูติดตั้ง สร้างชีต ค่าเริ่มต้น และข้อมูลทดสอบ
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔧 Meiwa Tool Request')
    .addItem('1) ติดตั้งระบบ (Setup sheets)', 'menuSetup')
    .addItem('2) แสดงลิงก์เว็บแอปทั้ง 3 หน้า', 'menuShowUrl')
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
    '1. แก้ชีต Config: STAFF_PIN, MGR_PIN, PURCHASING_EMAILS, MANAGEMENT_EMAILS\n' +
    '   และข้อมูลบริษัทสำหรับใบกำกับภาษี (COMPANY_*)\n' +
    '2. ใส่รหัสพนักงานและรายชื่อช่างในชีต Technicians\n' +
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
    'ฟอร์มขอซื้อ (ส่งช่างทาง LINE):\n' + u + '\n\n' +
    'หน้าจัดซื้อ:\n' + u + '?p=dash\n\n' +
    'หน้าผู้บริหารอนุมัติ:\n' + u + '?p=mgr'
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
  // ชีตใหม่ของ Google มี 26 คอลัมน์ แต่ชีต Items ใช้มากกว่านั้น -> ขยายก่อนเขียนหัวตาราง
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
    ['1042', 'ช่างสมชาย ใจดี', 'ช่างชาย', 'โรงงาน 1', '', 'Y'],
    ['1078', 'ช่างวิชัย แก้วมณี', 'ช่างวิ', 'โรงงาน 1', '', 'Y'],
    ['1103', 'ช่างนพดล ศรีสุข', 'ช่างนพ', 'โรงงาน 2', '', 'Y']
  ].forEach(function (r) { sh.appendRow(r); });
}

/** ข้อมูลทดสอบ 1 ใบ 2 รายการ พร้อมราคาที่ช่างไปดูมาจากร้านข้างนอก */
function menuDemoData() {
  var res = apiSubmitRequest({
    emp_code: '1042',
    requester_name: 'ช่างสมชาย ใจดี',
    site: 'โรงงาน 1',
    contact: 'LINE: somchai.tech',
    required_date: Utilities.formatDate(new Date(Date.now() + 7 * 86400000), tz_(), 'yyyy-MM-dd'),
    note: 'ข้อมูลทดสอบระบบ',
    items: [
      {
        tool_name: 'ไดอัลเกจ / Dial Gauge', qty: 1, unit: 'ตัว',
        intended_use: 'วัดความเยื้องศูนย์เพลามอเตอร์ ไลน์ 3',
        spec_pref: 'ช่วงวัด 0–10 มม. ความละเอียด 0.01 มม. พร้อมขาแม่เหล็ก',
        brand_pref: 'Mitutoyo 2046A หรือเทียบเท่า',
        item_note: 'ตัวเดิมเข็มค้าง อ่านค่าไม่ได้',
        bench_price: 1650, bench_store: 'Global House (โกลบอลเฮ้าส์)',
        bench_note: 'เห็นที่ชั้นวางเครื่องมือวัด ซื้อได้เลยวันนี้'
      },
      {
        tool_name: 'ประแจทอร์ค 1/2 นิ้ว', qty: 2, unit: 'ตัว',
        intended_use: 'ขันโบลต์หน้าแปลนตามค่าทอร์ค',
        spec_pref: '40–200 N·m มีใบรับรองการสอบเทียบ',
        item_note: 'ใช้คู่กับงาน PM เดือนหน้า'
      }
    ]
  });
  SpreadsheetApp.getUi().alert(
    'สร้างใบทดสอบ ' + res.req_id + '\n\n' +
    'ลิงก์สำหรับช่าง:\n' + res.url + '\n\n' +
    'ขั้นต่อไป: เปิดหน้าจัดซื้อ (?p=dash) แล้วกด "ส่งสเปคให้ช่างตรวจ"'
  );
}
