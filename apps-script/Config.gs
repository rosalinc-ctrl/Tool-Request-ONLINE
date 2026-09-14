/**
 * Meiwa Tool Request — Config.gs
 * ค่าคงที่ โครงสร้างชีต และการอ่าน/เขียนค่าตั้งค่า
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

  Technicians: ['name', 'nickname', 'site', 'line_id', 'active'],

  Requests: [
    'req_id', 'token', 'created_at', 'requester_name', 'site', 'contact',
    'required_date', 'note', 'status', 'updated_at'
  ],

  Items: [
    'item_id', 'req_id', 'seq', 'tool_name', 'qty', 'unit', 'required_date',
    'intended_use', 'spec_pref', 'brand_pref', 'item_note',
    'benchmark_price', 'benchmark_store', 'ref_links', 'ref_photos',
    'tech_status', 'tech_note', 'decided_by', 'decided_at', 'chosen_option_id', 'pur_note',
    'fulfil_mode', 'local_est_price', 'local_store', 'tax_invoice_ok', 'receipt_url', 'receipt_at',
    'purchase_status', 'approved_by', 'approved_at', 'approval_note', 'po_ref', 'updated_at'
  ],

  Options: [
    'option_id', 'item_id', 'created_at', 'created_by', 'brand', 'model', 'spec', 'supplier',
    'product_link', 'photo_url', 'unit_price', 'vat_rate', 'vat_amount', 'shipping',
    'subtotal', 'total_cost', 'availability', 'delivery_date', 'payment_terms', 'note',
    'is_recommended', 'status'
  ],

  History: ['ts', 'req_id', 'item_id', 'option_id', 'actor', 'role', 'action', 'detail'],

  Notifications: ['ts', 'channel', 'to', 'ref', 'subject', 'message', 'link', 'status', 'error']
};

/** สถานะฝั่งช่าง (ยืนยันสเปค) */
var T = {
  WAITING_OPTION: 'WAITING_OPTION',      // ยังไม่มีตัวเลือกจากจัดซื้อ
  WAITING_TECH: 'WAITING_TECH',          // มีตัวเลือกแล้ว รอช่างยืนยัน
  CONFIRMED: 'CONFIRMED',                // ช่างยืนยันสเปคแล้ว
  CHANGE_REQUESTED: 'CHANGE_REQUESTED',  // ขอให้แก้ไข
  REJECTED: 'REJECTED'                   // ไม่ตรงสเปค
};

/** สถานะฝั่งจัดซื้อ (การอนุมัติ/สั่งซื้อ) — แยกจากการยืนยันสเปคโดยเจตนา */
var P = {
  NEW: 'NEW',
  WAITING_TECH: 'WAITING_TECH',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  ORDERED: 'ORDERED',
  RECEIVED: 'RECEIVED',
  CLOSED: 'CLOSED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED'
};

/** สถานะที่ช่างแก้ไขอะไรไม่ได้แล้ว (ส่งเข้ากระบวนการจัดซื้อแล้ว) */
var LOCKED_FOR_TECH = [P.PENDING_APPROVAL, P.APPROVED, P.ORDERED, P.RECEIVED, P.CLOSED, P.REJECTED, P.CANCELLED];

var DEFAULT_CONFIG = [
  ['PURCHASING_EMAILS', '', 'อีเมลทีมจัดซื้อที่จะรับแจ้งเตือน คั่นด้วยเครื่องหมาย ,'],
  ['STAFF_PIN', '2468', 'รหัสผ่านเข้าหน้าจัดซื้อ (Purchasing PIN) — เปลี่ยนก่อนใช้งานจริง'],
  ['DRIVE_FOLDER_ID', '', 'โฟลเดอร์ Drive เก็บรูป/ใบเสร็จ (ระบบสร้างให้ตอน Setup)'],
  ['WEBAPP_URL', '', 'ลิงก์เว็บแอป (ระบบเติมให้อัตโนมัติหลัง Deploy)'],
  ['VAT_RATE', '7', 'อัตรา VAT เริ่มต้น (%)'],
  ['APPROVAL_LIMIT', '10000', 'ยอดรวมเกินจำนวนนี้ ให้ผู้จัดการเป็นผู้อนุมัติ (บาท)'],
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

/** ค่าที่ปลอดภัยจะส่งให้หน้าเว็บ (ไม่มี PIN / token) */
function publicCfg_() {
  return {
    vatRate: num_(cfg_('VAT_RATE', 7)) || 7,
    approvalLimit: num_(cfg_('APPROVAL_LIMIT', 10000)) || 0,
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
