/**
 * Meiwa Tool Request — Workflow.gs
 * คำนวณ "ขั้นตอนปัจจุบัน" ของแต่ละรายการ จาก tech_status + purchase_status
 * หลักการสำคัญ: ช่างยืนยันสเปค != อนุมัติให้สั่งซื้อ (แยกกันคนละสถานะ)
 */

var STAGE_LABEL = {
  NEED_OPTION: 'รอจัดซื้อเสนอตัวเลือก / Waiting options',
  TECH_SPEC: 'รอช่างยืนยันสเปค / Waiting tech confirm',
  TECH_MODE: 'รอช่างเลือกวิธีซื้อ / Waiting buy method',
  APPROVAL: 'รออนุมัติจากจัดซื้อ / Waiting approval',
  TO_ORDER: 'อนุมัติแล้ว รอสั่งซื้อ / Approved - to order',
  ORDERED: 'สั่งซื้อแล้ว รอของ / Ordered',
  LOCAL_BUY: 'ช่างซื้อเอง รอใบเสร็จ / Local buy - waiting receipt',
  DONE: 'เสร็จสิ้น / Done',
  PUR_REJECTED: 'จัดซื้อไม่อนุมัติ / Not approved',
  CANCELLED: 'ยกเลิก / Cancelled'
};

/** ขั้นตอนไหน "ต้องให้ช่างทำอะไรบางอย่าง" */
var TECH_ACTION_STAGES = ['TECH_SPEC', 'TECH_MODE', 'LOCAL_BUY'];

/**
 * item ต้องมี field: tech_status, purchase_status, fulfil_mode, receipt_url, _optionCount
 * ถ้าไม่ได้ส่ง _optionCount มา จะนับจากชีต Options ให้ (ช้ากว่า)
 */
function stageOf_(item, optionCount) {
  var ps = String(item.purchase_status || P.NEW);
  var ts = String(item.tech_status || T.WAITING_OPTION);
  var mode = String(item.fulfil_mode || '');
  var n = (optionCount !== undefined) ? optionCount
    : (item._optionCount !== undefined ? item._optionCount
      : findBy_(SHEET.OPTIONS, 'item_id', item.item_id).filter(function (o) { return o.status !== 'WITHDRAWN'; }).length);

  if (ps === P.CANCELLED) return 'CANCELLED';
  if (ps === P.REJECTED) return 'PUR_REJECTED';
  if (ps === P.CLOSED || ps === P.RECEIVED) return 'DONE';
  if (ps === P.ORDERED) return 'ORDERED';
  if (ps === P.APPROVED) {
    if (mode === 'LOCAL') return item.receipt_url ? 'DONE' : 'LOCAL_BUY';
    return 'TO_ORDER';
  }
  if (ps === P.PENDING_APPROVAL) return 'APPROVAL';

  // ยังอยู่ฝั่งช่าง
  if (mode) return 'APPROVAL';
  if (!n || ts === T.REJECTED || ts === T.CHANGE_REQUESTED) return 'NEED_OPTION';
  if (ts === T.CONFIRMED) return 'TECH_MODE';
  return 'TECH_SPEC';
}

function stageLabel_(stage) { return STAGE_LABEL[stage] || stage; }

/** คำนวณราคาให้ครบทุกช่องจากราคาต่อหน่วย + VAT + ค่าส่ง */
function priceCalc_(unitPrice, qty, vatRate, shipping) {
  var u = num_(unitPrice), q = num_(qty) || 1, r = num_(vatRate), s = num_(shipping);
  var subtotal = round2_(u * q);
  var vat = round2_((subtotal + s) * r / 100);
  return { subtotal: subtotal, vat: vat, shipping: round2_(s), total: round2_(subtotal + s + vat) };
}

function round2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
