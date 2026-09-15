/**
 * Meiwa Tool Request — Config.gs
 * ค่าคงที่ โครงสร้างชีต และการอ่าน/เขียนค่าตั้งค่า
 *
 * ลำดับผู้ใช้งาน 3 ฝ่าย
 *   ช่าง        — ขอซื้อ + ยืนยัน "สเปค" เท่านั้น (ไม่เห็นราคาผู้ขาย)
 *   จัดซื้อ     — ร่างสเปคอ้างอิง, เทียบราคาอย่างน้อย 3 เจ้า, แนะนำตัวที่ควรซื้อ, เปิด PO
 *   ผู้บริหาร   — ดูตารางเทียบบนจอ แล้วกดอนุมัติ (รายรายการ หรือ ทั้งใบ)
 */

var SHEET = {
  CONFIG: 'Config',
  TECHS: 'Technicians',
  REQUESTS: 'Requests',
  ITEMS: 'Items',
  OPTIONS: 'Options',
  HISTORY: 'History',
  NOTIFY: 'Notifications'
};

/** หัวตารางของแต่ละชีต (ห้ามสลับลำดับหลังเริ่มใช้งานจริง) */
var HEADERS = {
  Config: ['key', 'value', 'note'],

  Technicians: ['emp_code', 'name', 'nickname', 'site', 'line_id', 'active'],

  Requests: [
    'req_id', 'token', 'created_at', 'emp_code', 'requester_name', 'site', 'contact',
    'required_date', 'note', 'status', 'updated_at'
  ],

  Items: [
    // สิ่งที่ช่างขอ
    'item_id', 'req_id', 'seq', 'tool_name', 'qty', 'unit', 'required_date',
    'intended_use', 'spec_pref', 'brand_pref', 'item_note', 'ref_links', 'ref_photos',
    // ราคาที่ช่างไปดูมาเองจากร้านข้างนอก (ใส่ตอนขอ หรือ ตามมาทีหลังก็ได้)
    'bench_price', 'bench_store', 'bench_note', 'bench_photo', 'bench_by', 'bench_at',
    // สเปคอ้างอิง 1 ชิ้นที่จัดซื้อร่างให้ช่างตรวจก่อนไปเทียบราคา
    'spec_brand', 'spec_model', 'spec_detail', 'spec_photo', 'spec_link', 'spec_by', 'spec_at',
    // ช่างยืนยันสเปค (ไม่เกี่ยวกับราคา)
    'tech_status', 'tech_note', 'tech_by', 'tech_at',
    // จัดซื้อเทียบราคาและเสนอความเห็น
    'pur_note', 'recommend_option_id', 'recommend_reason', 'quoted_at', 'purchase_status',
    // ผู้บริหารอนุมัติ
    'approved_option_id', 'buy_mode', 'mgr_by', 'mgr_at', 'mgr_note',
    // เปิด PO / รับของ / ใบเสร็จกรณีช่างซื้อเอง
    'po_ref', 'po_by', 'po_at', 'tax_invoice_ok', 'actual_price', 'receipt_url', 'receipt_at',
    'updated_at'
  ],

  Options: [
    'option_id', 'item_id', 'created_at', 'created_by', 'source',
    'brand', 'model', 'spec', 'supplier', 'product_link', 'photo_url',
    'unit_price', 'vat_rate', 'vat_amount', 'shipping', 'subtotal', 'total_cost',
    'availability', 'delivery_date', 'payment_terms', 'note', 'status'
  ],

  History: ['ts', 'req_id', 'item_id', 'option_id', 'actor', 'role', 'action', 'detail'],

  Notifications: ['ts', 'channel', 'to', 'ref', 'subject', 'message', 'link', 'status', 'error']
};

/** สถานะฝั่งช่าง — ยืนยัน "สเปค" อย่างเดียว */
var T = {
  NO_SPEC: 'NO_SPEC',        // จัดซื้อยังไม่ได้ร่างสเปคมาให้ดู
  WAITING: 'WAITING',        // มีสเปคแล้ว รอช่างตรวจ
  CONFIRMED: 'CONFIRMED',    // สเปคถูกต้อง ใช้กับงานได้
  CHANGE: 'CHANGE',          // ขอให้แก้สเปค
  REJECTED: 'REJECTED'       // สเปคใช้ไม่ได้
};

/** สถานะฝั่งจัดซื้อ/ผู้บริหาร — แยกจากการยืนยันสเปคของช่างโดยเจตนา */
var P = {
  NEW: 'NEW',                            // เพิ่งขอเข้ามา รอจัดซื้อร่างสเปค
  WAITING_TECH: 'WAITING_TECH',          // ส่งสเปคให้ช่างตรวจแล้ว
  QUOTING: 'QUOTING',                    // ช่างยืนยันสเปคแล้ว จัดซื้อกำลังเทียบราคา
  PENDING_APPROVAL: 'PENDING_APPROVAL',  // ส่งให้ผู้บริหารอนุมัติ
  APPROVED: 'APPROVED',                  // ผู้บริหารอนุมัติแล้ว
  PO_ISSUED: 'PO_ISSUED',                // จัดซื้อเปิด PO แล้ว
  RECEIVED: 'RECEIVED',
  CLOSED: 'CLOSED',
  REJECTED: 'REJECTED',                  // ผู้บริหารไม่อนุมัติ
  CANCELLED: 'CANCELLED'
};

/** วิธีได้ของ หลังผู้บริหารอนุมัติ */
var MODE = { SUPPLIER: 'SUPPLIER', LOCAL: 'LOCAL' };

/** ที่มาของตัวเลือกราคา */
var SRC = { SUPPLIER: 'SUPPLIER', TECH: 'TECH' };

/** สถานะที่ช่างแก้สเปคเองไม่ได้แล้ว (เข้ากระบวนการราคา/อนุมัติแล้ว) */
var LOCKED_FOR_TECH = [P.PENDING_APPROVAL, P.APPROVED, P.PO_ISSUED, P.RECEIVED, P.CLOSED, P.REJECTED, P.CANCELLED];

var DEFAULT_CONFIG = [
  ['PURCHASING_EMAILS', '', 'อีเมลทีมจัดซื้อที่จะรับแจ้งเตือน คั่นด้วยเครื่องหมาย ,'],
  ['MANAGEMENT_EMAILS', '', 'อีเมลฝ่ายบริหารที่จะรับแจ้งเตือนเมื่อมีรายการรออนุมัติ คั่นด้วย ,'],
  ['STAFF_PIN', '2468', 'รหัสผ่านหน้าจัดซื้อ (Purchasing) — เปลี่ยนก่อนใช้งานจริง'],
  ['MGR_PIN', '9753', 'รหัสผ่านหน้าผู้บริหาร (Management approval) — เปลี่ยนก่อนใช้งานจริง'],
  ['MIN_QUOTES', '3', 'จำนวนเจ้าที่ต้องเทียบราคาขั้นต่ำต่อ 1 รายการ ก่อนส่งผู้บริหารอนุมัติ'],
  ['DRIVE_FOLDER_ID', '', 'โฟลเดอร์ Drive เก็บรูป/ใบเสร็จ (ระบบสร้างให้ตอน Setup)'],
  ['WEBAPP_URL', '', 'ลิงก์เว็บแอป (ระบบเติมให้อัตโนมัติหลัง Deploy)'],
  ['VAT_RATE', '7', 'อัตรา VAT เริ่มต้น (%)'],
  ['APPROVAL_LIMIT', '10000', 'ยอดรวมเกินจำนวนนี้ ระบบจะเตือนผู้บริหารเป็นพิเศษ (บาท)'],
  ['COMPANY_NAME', '<<ชื่อบริษัท / COMPANY NAME>>', 'ข้อมูลออกใบกำกับภาษี — แก้เป็นข้อมูลจริงของบริษัท'],
  ['COMPANY_TAX_ID', '<<เลขประจำตัวผู้เสียภาษี 13 หลัก>>', 'ข้อมูลออกใบกำกับภาษี'],
  ['COMPANY_BRANCH', '<<สำนักงานใหญ่ / สาขา>>', 'ข้อมูลออกใบกำกับภาษี'],
  ['COMPANY_ADDRESS', '<<ที่อยู่สำหรับออกใบกำกับภาษี>>', 'ข้อมูลออกใบกำกับภาษี'],
  ['DEFAULT_BENCHMARK_STORE', 'Global House (โกลบอลเฮ้าส์)', 'ร้านอ้างอิงราคาเริ่มต้นที่ช่างมักไปดู'],
  ['LINE_CHANNEL_TOKEN', '', '(ไม่บังคับ) LINE Messaging API channel access token สำหรับส่งข้อความอัตโนมัติ']
];

var __cfgCache = null;

function cfgAll_() {
  if (__cfgCache) return __cfgCache;
  var map = {};
  try {
    var rows = SpreadsheetApp.getActive().getSheetByName(SHEET.CONFIG).getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0]) map[String(rows[i][0]).trim()] = rows[i][1];
    }
  } catch (e) { /* ยังไม่ได้ Setup */ }
  __cfgCache = map;
  return map;
}

function cfg_(key, fallback) {
  var v = cfgAll_()[key];
  if (v === undefined || v === null || v === '') return (fallback === undefined ? '' : fallback);
  return v;
}

function setCfg_(key, value) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET.CONFIG);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) {
      sh.getRange(i + 1, 2).setValue(value);
      __cfgCache = null;
      return;
    }
  }
  sh.appendRow([key, value, '']);
  __cfgCache = null;
}

function minQuotes_() { return Math.max(1, num_(cfg_('MIN_QUOTES', 3)) || 3); }

/** ค่าที่ปลอดภัยจะส่งให้หน้าเว็บ (ไม่มี PIN / token) */
function publicCfg_() {
  return {
    vatRate: num_(cfg_('VAT_RATE', 7)) || 7,
    approvalLimit: num_(cfg_('APPROVAL_LIMIT', 10000)) || 0,
    minQuotes: minQuotes_(),
    benchmarkStore: cfg_('DEFAULT_BENCHMARK_STORE', 'Global House'),
    company: {
      name: cfg_('COMPANY_NAME', ''),
      taxId: cfg_('COMPANY_TAX_ID', ''),
      branch: cfg_('COMPANY_BRANCH', ''),
      address: cfg_('COMPANY_ADDRESS', '')
    }
  };
}

function tz_() { return Session.getScriptTimeZone() || 'Asia/Bangkok'; }
function now_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }

function webappUrl_() {
  var u = String(cfg_('WEBAPP_URL', ''));
  if (!u) {
    try {
      u = ScriptApp.getService().getUrl() || '';
      if (u) setCfg_('WEBAPP_URL', u);
    } catch (e) { /* ignore */ }
  }
  return u;
}

function techLink_(token) {
  var u = webappUrl_();
  return u ? (u + '?p=r&t=' + token) : '(ยังไม่ได้ตั้งค่า WEBAPP_URL ในชีต Config)';
}
