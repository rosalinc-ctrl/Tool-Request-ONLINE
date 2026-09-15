/**
 * Meiwa Tool Request — Workflow.gs
 * รวม tech_status + purchase_status ให้เหลือ "ขั้นตอนเดียวที่แสดงบนจอ" (stage)
 *
 * หลักการสำคัญ 2 ข้อ
 *   1) ช่างยืนยันแค่ "สเปค" — ไม่เห็นราคา ไม่ได้เลือกเจ้า
 *   2) คนที่กดอนุมัติให้ซื้อได้คือ "ผู้บริหาร" เท่านั้น จัดซื้อเปิด PO ได้หลังอนุมัติแล้ว
 */

var STAGE_LABEL = {
  NEED_SPEC: 'รอจัดซื้อร่างสเปค / Draft spec',
  TECH_SPEC: 'รอช่างยืนยันสเปค / Waiting tech spec check',
  SPEC_CHANGE: 'ช่างขอแก้สเปค / Spec change requested',
  QUOTING: 'จัดซื้อกำลังเทียบราคา / Collecting quotes',
  APPROVAL: 'รอผู้บริหารอนุมัติ / Waiting management approval',
  TO_PO: 'อนุมัติแล้ว รอเปิด PO / Approved - issue PO',
  ORDERED: 'เปิด PO แล้ว รอของ / PO issued',
  LOCAL_BUY: 'ให้ช่างซื้อเอง รอใบเสร็จ / Local buy - waiting receipt',
  DONE: 'เสร็จสิ้น / Done',
  MGR_REJECTED: 'ผู้บริหารไม่อนุมัติ / Not approved',
  CANCELLED: 'ยกเลิก / Cancelled'
};

/** ขั้นตอนที่รอฝ่ายไหนลงมือ — ใช้จัดลำดับงานบนแดชบอร์ด */
var TECH_ACTION_STAGES = ['TECH_SPEC', 'LOCAL_BUY'];
var PUR_ACTION_STAGES = ['NEED_SPEC', 'SPEC_CHANGE', 'QUOTING', 'TO_PO'];
var MGR_ACTION_STAGES = ['APPROVAL'];

/**
 * item ต้องมี tech_status, purchase_status, buy_mode, receipt_url
 * optionCount ส่งมาได้เพื่อเลี่ยงการอ่านชีตซ้ำ
 */
function stageOf_(item) {
  var ps = String(item.purchase_status || P.NEW);
  var ts = String(item.tech_status || T.NO_SPEC);
  var mode = String(item.buy_mode || '');

  if (ps === P.CANCELLED) return 'CANCELLED';
  if (ps === P.REJECTED) return 'MGR_REJECTED';
  if (ps === P.CLOSED || ps === P.RECEIVED) return 'DONE';
  if (ps === P.PO_ISSUED) return 'ORDERED';
  if (ps === P.APPROVED) {
    if (mode === MODE.LOCAL) return item.receipt_url ? 'DONE' : 'LOCAL_BUY';
    return 'TO_PO';
  }
  if (ps === P.PENDING_APPROVAL) return 'APPROVAL';
  if (ps === P.QUOTING) return 'QUOTING';

  // ยังอยู่ช่วงสเปค
  if (ts === T.CHANGE || ts === T.REJECTED) return 'SPEC_CHANGE';
  if (ts === T.WAITING) return 'TECH_SPEC';
  return 'NEED_SPEC';
}

function stageLabel_(stage) { return STAGE_LABEL[stage] || stage; }

/** ชื่อสินค้าที่ใช้แสดงผล = ยี่ห้อ + รุ่น */
function brandModel_(o) {
  if (!o) return '-';
  return [str_(o.brand), str_(o.model)].filter(String).join(' ') || '-';
}

/** สเปคอ้างอิงที่จัดซื้อร่างให้ช่างตรวจ — มีครบพอจะส่งช่างหรือยัง */
function hasSpec_(item) {
  return !!(str_(item.spec_brand) || str_(item.spec_model) || str_(item.spec_detail));
}

function specTitle_(item) {
  return [str_(item.spec_brand), str_(item.spec_model)].filter(String).join(' ') || str_(item.tool_name);
}

/** คำนวณราคาให้ครบทุกช่องจากราคาต่อหน่วย + VAT + ค่าส่ง */
function priceCalc_(unitPrice, qty, vatRate, shipping) {
  var u = num_(unitPrice), q = num_(qty) || 1, r = num_(vatRate), s = num_(shipping);
  var subtotal = round2_(u * q);
  var vat = round2_((subtotal + s) * r / 100);
  return { subtotal: subtotal, vat: vat, shipping: round2_(s), total: round2_(subtotal + s + vat) };
}

function round2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/**
 * ตรวจว่าเทียบราคาครบตามกฎหรือยัง
 * กฎ: ต้องมีตัวเลือกอย่างน้อย MIN_QUOTES เจ้า
 *     โดยนับ "ราคาที่ช่างไปดูมาจากร้านข้างนอก" เป็น 1 เจ้าได้
 */
function quoteCheck_(item, options) {
  var min = minQuotes_();
  var live = (options || []).filter(function (o) { return o.status !== 'WITHDRAWN'; });
  var suppliers = {};
  live.forEach(function (o) { suppliers[String(o.supplier || o.option_id).trim()] = true; });
  var n = Object.keys(suppliers).length;
  var hasTechPrice = live.some(function (o) { return String(o.source) === SRC.TECH; });
  return {
    count: n,
    min: min,
    hasTechPrice: hasTechPrice,
    ok: n >= min,
    missing: Math.max(0, min - n)
  };
}

/** พร้อมส่งให้ผู้บริหารอนุมัติหรือยัง */
function readyForApproval_(item, options) {
  if (String(item.tech_status) !== T.CONFIRMED) {
    return { ok: false, why: 'ช่างยังไม่ได้ยืนยันสเปค' };
  }
  var q = quoteCheck_(item, options);
  if (!q.ok) {
    return { ok: false, why: 'ต้องเทียบราคาอย่างน้อย ' + q.min + ' เจ้า (ตอนนี้ ' + q.count + ') — ราคาที่ช่างไปดูมาที่ร้านนับเป็น 1 เจ้าได้' };
  }
  if (!str_(item.recommend_option_id)) {
    return { ok: false, why: 'กรุณาเลือกตัวเลือกที่จัดซื้อแนะนำก่อนส่งอนุมัติ' };
  }
  return { ok: true, why: '' };
}
