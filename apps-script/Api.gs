/**
 * Meiwa Tool Request — Api.gs
 * ฟังก์ชันทั้งหมดที่หน้าเว็บเรียกผ่าน google.script.run
 *
 * ช่าง      — เข้าด้วย token ในลิงก์ (ไม่มีอีเมล ไม่ต้องล็อกอิน) เห็นเฉพาะ "สเปค" ไม่เห็นราคาผู้ขาย
 * จัดซื้อ   — PIN (STAFF_PIN) แลก staffToken อายุ 6 ชั่วโมง
 * ผู้บริหาร — PIN (MGR_PIN) แลก mgrToken อายุ 6 ชั่วโมง เป็นคนเดียวที่กดอนุมัติได้
 */

/* ============================ ตัวช่วยภายใน ============================ */

function requestByToken_(token) {
  var req = findOne_(SHEET.REQUESTS, 'token', String(token || ''));
  if (!req) throw new Error('ไม่พบคำขอนี้ / Request not found');
  return req;
}

function itemOfRequest_(req, itemId) {
  var item = findOne_(SHEET.ITEMS, 'item_id', String(itemId || ''));
  if (!item || String(item.req_id) !== String(req.req_id)) throw new Error('ไม่พบรายการนี้ / Item not found');
  return item;
}

function itemById_(itemId) {
  var item = findOne_(SHEET.ITEMS, 'item_id', String(itemId || ''));
  if (!item) throw new Error('ไม่พบรายการนี้ / Item not found');
  return item;
}

function optionsOfItem_(itemId, includeWithdrawn) {
  return findBy_(SHEET.OPTIONS, 'item_id', itemId)
    .filter(function (o) { return includeWithdrawn || o.status !== 'WITHDRAWN'; })
    .sort(function (a, b) { return num_(a.total_cost) - num_(b.total_cost); });
}

function touchItem_(item, patch) {
  patch.updated_at = now_();
  updateRow_(SHEET.ITEMS, item._row, patch);
  var req = findOne_(SHEET.REQUESTS, 'req_id', item.req_id);
  if (req) updateRow_(SHEET.REQUESTS, req._row, { updated_at: patch.updated_at });
}

function toPhotoList_(csv) {
  return String(csv || '').split(',').map(function (s) { return s.trim(); }).filter(String);
}

/**
 * DTO สำหรับหน้าช่าง — ตั้งใจ "ไม่ส่งราคาผู้ขาย" ออกไป
 * ช่างเห็นได้เฉพาะ: สิ่งที่ตัวเองขอ, สเปคที่จัดซื้อร่างมาให้ตรวจ, ราคาที่ตัวเองไปดูมา
 * และเมื่อผู้บริหารอนุมัติให้ "ช่างซื้อเอง" จึงจะเห็นวงเงินที่อนุมัติของรายการนั้น
 */
/**
 * ประวัติที่ช่างเห็นได้ — ต้องไม่มีชื่อผู้ขายหรือราคาที่จัดซื้อไปเทียบมา
 *   full  = แสดงรายละเอียดได้ทั้งหมด (เป็นเรื่องของช่างเอง หรือเป็นสเปค)
 *   plain = แสดงแค่ว่าเกิดอะไรขึ้น ไม่แสดงรายละเอียด (มีราคา/ผู้ขายอยู่ข้างใน)
 *   ไม่อยู่ในรายการ = ไม่แสดงให้ช่างเห็นเลย
 */
var TECH_HISTORY = {
  SUBMIT: 'full', ADD_BENCHMARK: 'full', SEND_SPEC: 'full',
  CONFIRM_SPEC: 'full', REQUEST_SPEC_CHANGE: 'full', REJECT_SPEC: 'full',
  NOTE_TO_TECH: 'full', UPLOAD_RECEIPT: 'full',
  SUBMIT_APPROVAL: 'plain', APPROVE: 'plain', REJECT: 'plain', APPROVE_ALL: 'plain',
  ISSUE_PO: 'plain', STATUS_RECEIVED: 'plain', STATUS_CLOSED: 'plain', STATUS_CANCELLED: 'plain'
};

var TECH_HISTORY_LABEL = {
  SUBMIT: 'ช่างส่งคำขอ', ADD_BENCHMARK: 'ช่างแจ้งราคาที่ร้าน', SEND_SPEC: 'จัดซื้อส่งสเปคให้ตรวจ',
  CONFIRM_SPEC: 'ช่างยืนยันสเปค', REQUEST_SPEC_CHANGE: 'ช่างขอแก้สเปค', REJECT_SPEC: 'ช่างแจ้งว่าสเปคใช้ไม่ได้',
  NOTE_TO_TECH: 'ข้อความจากจัดซื้อ', UPLOAD_RECEIPT: 'ช่างส่งใบเสร็จ',
  SUBMIT_APPROVAL: 'จัดซื้อส่งเรื่องให้ผู้บริหารอนุมัติ', APPROVE: 'ผู้บริหารอนุมัติ',
  REJECT: 'ผู้บริหารไม่อนุมัติ', APPROVE_ALL: 'ผู้บริหารอนุมัติทั้งใบ',
  ISSUE_PO: 'จัดซื้อเปิด PO แล้ว', STATUS_RECEIVED: 'รับของแล้ว',
  STATUS_CLOSED: 'ปิดงาน', STATUS_CANCELLED: 'ยกเลิกรายการ'
};

function techHistory_(rows) {
  return rows.filter(function (h) { return TECH_HISTORY[h.action]; })
    .map(function (h) {
      var mode = TECH_HISTORY[h.action];
      return {
        ts: h.ts, actor: h.actor, role: h.role,
        action: TECH_HISTORY_LABEL[h.action] || h.action,
        detail: mode === 'full' ? h.detail : ''
      };
    });
}

function buildTechDto_(req) {
  var items = findBy_(SHEET.ITEMS, 'req_id', req.req_id)
    .sort(function (a, b) { return num_(a.seq) - num_(b.seq); });
  var allHistory = readAll_(SHEET.HISTORY);

  var safeItems = items.map(function (it) {
    var stage = stageOf_(it);
    var o = { };
    [ 'item_id', 'req_id', 'seq', 'tool_name', 'qty', 'unit', 'required_date',
      'intended_use', 'spec_pref', 'brand_pref', 'item_note', 'ref_links',
      'bench_price', 'bench_store', 'bench_note', 'bench_photo', 'bench_by', 'bench_at',
      'spec_brand', 'spec_model', 'spec_detail', 'spec_photo', 'spec_link', 'spec_at',
      'tech_status', 'tech_note', 'tech_by', 'tech_at', 'pur_note',
      'buy_mode', 'po_ref', 'tax_invoice_ok', 'actual_price', 'receipt_url', 'receipt_at'
    ].forEach(function (k) { o[k] = it[k]; });

    o.photos = toPhotoList_(it.ref_photos);
    o.stage = stage;
    o.stageLabel = stageLabel_(stage);
    o.hasSpec = hasSpec_(it);
    o.locked = LOCKED_FOR_TECH.indexOf(String(it.purchase_status)) >= 0;

    // วงเงินที่อนุมัติ — เปิดให้เห็นเฉพาะรายการที่ช่างต้องไปซื้อเอง
    o.approvedBudget = '';
    if (String(it.buy_mode) === MODE.LOCAL &&
        [P.APPROVED, P.RECEIVED, P.CLOSED].indexOf(String(it.purchase_status)) >= 0) {
      var opt = it.approved_option_id ? findOne_(SHEET.OPTIONS, 'option_id', it.approved_option_id) : null;
      o.approvedBudget = opt ? num_(opt.total_cost) : num_(it.bench_price) * num_(it.qty);
      o.approvedStore = opt ? opt.supplier : it.bench_store;
    }

    o.history = techHistory_(allHistory.filter(function (h) {
      return String(h.item_id) === String(it.item_id);
    }));
    return o;
  });

  return { request: req, items: safeItems, config: publicCfg_(), technicians: activeTechs_() };
}

/* ============================ ฝั่งช่าง ============================ */

function apiBootstrap() {
  return { technicians: activeTechs_(), config: publicCfg_() };
}

/**
 * ส่งคำขอใหม่ (หลายรายการในใบเดียว)
 * payload = { emp_code, requester_name, site, contact, required_date, note,
 *             items:[{tool_name, qty, unit, required_date, intended_use, spec_pref,
 *                     brand_pref, item_note, bench_price, bench_store, bench_note,
 *                     ref_links, photos:[{name,mime,dataB64}]}] }
 * รหัสพนักงานบังคับกรอก — ถ้าเลือกชื่อจากรายการ ระบบเติมรหัสให้เอง
 */
function apiSubmitRequest(payload) {
  payload = payload || {};
  var name = str_(payload.requester_name, 100);
  var code = str_(payload.emp_code, 30);
  if (!name) throw new Error('กรุณาระบุชื่อผู้ขอ / Requester name is required');

  var tech = findTech_(code) || findTech_(name);
  if (!code) code = tech ? tech.emp_code : '';
  if (!code) throw new Error('กรุณาระบุรหัสพนักงาน / Employee code is required');
  if (tech && tech.emp_code && String(tech.emp_code) !== String(code)) {
    throw new Error('รหัสพนักงานไม่ตรงกับชื่อที่เลือก / Employee code does not match the selected name');
  }

  var items = (payload.items || []).filter(function (it) { return str_(it.tool_name); });
  if (!items.length) throw new Error('กรุณาเพิ่มรายการเครื่องมืออย่างน้อย 1 รายการ');
  if (items.length > 20) throw new Error('ขอได้สูงสุด 20 รายการต่อ 1 ใบ');

  // อัปโหลดรูปก่อน (ช้า) แล้วค่อยจับ lock ตอนเขียนชีต
  var photoIds = items.map(function (it, i) {
    return (it.photos || []).slice(0, 4).map(function (f) {
      return saveUpload_(f, 'requests', 'req' + (i + 1)).id;
    });
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var reqId = nextReqId_();
    var token = newToken_();
    var ts = now_();

    appendRow_(SHEET.REQUESTS, {
      req_id: reqId, token: token, created_at: ts,
      emp_code: code, requester_name: name,
      site: str_(payload.site, 80) || (tech ? tech.site : ''),
      contact: str_(payload.contact, 120),
      required_date: str_(payload.required_date, 20), note: str_(payload.note, 500),
      status: 'OPEN', updated_at: ts
    });

    items.forEach(function (it, i) {
      var itemId = itemIdOf_(reqId, i + 1);
      var bench = num_(it.bench_price);
      appendRow_(SHEET.ITEMS, {
        item_id: itemId, req_id: reqId, seq: i + 1,
        tool_name: str_(it.tool_name, 150),
        qty: num_(it.qty) || 1,
        unit: str_(it.unit, 20) || 'ชิ้น',
        required_date: str_(it.required_date, 20) || str_(payload.required_date, 20),
        intended_use: str_(it.intended_use, 400),
        spec_pref: str_(it.spec_pref, 400),
        brand_pref: str_(it.brand_pref, 150),
        item_note: str_(it.item_note, 400),
        ref_links: str_(it.ref_links, 500),
        ref_photos: photoIds[i].join(','),
        bench_price: bench || '', bench_store: bench ? str_(it.bench_store, 100) : '',
        bench_note: bench ? str_(it.bench_note, 300) : '', bench_photo: '',
        bench_by: bench ? name : '', bench_at: bench ? ts : '',
        spec_brand: '', spec_model: '', spec_detail: '', spec_photo: '', spec_link: '', spec_by: '', spec_at: '',
        tech_status: T.NO_SPEC, tech_note: '', tech_by: '', tech_at: '',
        pur_note: '', recommend_option_id: '', recommend_reason: '', quoted_at: '',
        purchase_status: P.NEW,
        approved_option_id: '', buy_mode: '', mgr_by: '', mgr_at: '', mgr_note: '',
        po_ref: '', po_by: '', po_at: '', tax_invoice_ok: '', actual_price: '',
        receipt_url: '', receipt_at: '',
        updated_at: ts
      });
      logHistory_(reqId, itemId, '', name + ' (' + code + ')', 'TECH', 'SUBMIT',
        it.tool_name + ' x' + (num_(it.qty) || 1) +
        (bench ? (' | ราคาที่ร้าน ' + fmtBaht_(bench) + ' (' + (it.bench_store || '-') + ')') : ''));
    });

    var url = techLink_(token);
    notifyPurchasing_('ใบขอซื้อใหม่ ' + reqId + ' — ' + name + ' (' + code + ')',
      newRequestText_(reqId, code, name, payload, items), url, reqId);

    return { req_id: reqId, token: token, url: url, emp_code: code };
  } finally {
    lock.releaseLock();
  }
}

function apiGetRequest(token) {
  return buildTechDto_(requestByToken_(token));
}

/**
 * ช่างยืนยัน "สเปค" ของรายการหนึ่ง — ทีละรายการ ไม่เกี่ยวกับราคา
 * action: CONFIRM | CHANGE | REJECT
 */
function apiTechSpecDecision(token, itemId, action, payload) {
  payload = payload || {};
  var by = str_(payload.by, 100);
  if (!by) throw new Error('กรุณาเลือกชื่อของคุณก่อน / Please select your name first');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var req = requestByToken_(token);
    var item = itemOfRequest_(req, itemId);
    if (LOCKED_FOR_TECH.indexOf(String(item.purchase_status)) >= 0) {
      throw new Error('รายการนี้ส่งเข้ากระบวนการจัดซื้อแล้ว แก้เองไม่ได้ — กรุณาแจ้งฝ่ายจัดซื้อ');
    }
    if (!hasSpec_(item)) throw new Error('จัดซื้อยังไม่ได้ส่งสเปคมาให้ตรวจ / No spec to review yet');

    var ts = now_();
    var note = str_(payload.note, 400);
    var patch = { tech_by: by, tech_at: ts, tech_note: note };
    var detail = specTitle_(item);

    if (action === 'CONFIRM') {
      patch.tech_status = T.CONFIRMED;
      patch.purchase_status = P.QUOTING;
      touchItem_(item, patch);
      logHistory_(req.req_id, item.item_id, '', by, 'TECH', 'CONFIRM_SPEC',
        'สเปคถูกต้อง: ' + detail + (note ? (' | ' + note) : ''));
      notifyPurchasing_('ช่างยืนยันสเปคแล้ว ' + item.item_id,
        by + ' ยืนยันว่าสเปคของ ' + item.tool_name + ' ถูกต้อง (' + detail + ')' +
        (note ? ('\nหมายเหตุ: ' + note) : '') +
        '\n\nขั้นต่อไป: เทียบราคาอย่างน้อย ' + minQuotes_() + ' เจ้า แล้วส่งผู้บริหารอนุมัติ',
        techLink_(req.token), req.req_id);

    } else if (action === 'CHANGE' || action === 'REJECT') {
      if (!note) throw new Error('กรุณาระบุเหตุผล / Reason required');
      patch.tech_status = (action === 'CHANGE') ? T.CHANGE : T.REJECTED;
      patch.purchase_status = P.WAITING_TECH;
      touchItem_(item, patch);
      logHistory_(req.req_id, item.item_id, '', by, 'TECH',
        action === 'CHANGE' ? 'REQUEST_SPEC_CHANGE' : 'REJECT_SPEC', note);
      notifyPurchasing_((action === 'CHANGE' ? 'ช่างขอแก้สเปค ' : 'ช่างแจ้งสเปคไม่ถูกต้อง ') + item.item_id,
        by + ' แจ้งเรื่องสเปคของ ' + item.tool_name + '\nเหตุผล: ' + note +
        '\n\nกรุณาแก้สเปคแล้วส่งให้ช่างตรวจอีกครั้ง (ยังไม่ต้องเทียบราคา)',
        techLink_(req.token), req.req_id);

    } else {
      throw new Error('คำสั่งไม่ถูกต้อง / Unknown action');
    }

    return buildTechDto_(findOne_(SHEET.REQUESTS, 'req_id', req.req_id));
  } finally {
    lock.releaseLock();
  }
}

/**
 * ช่างใส่ราคาที่ไปดูมาจากร้านข้างนอก — ทำตอนขอ หรือตามมาทีหลังก็ได้
 * จัดซื้อจะเห็นราคานี้และกดดึงไปเป็น 1 ตัวเลือกในตารางเทียบได้
 */
function apiAddBenchmark(token, itemId, payload) {
  payload = payload || {};
  var by = str_(payload.by, 100);
  if (!by) throw new Error('กรุณาเลือกชื่อของคุณก่อน / Please select your name first');
  var price = num_(payload.bench_price);
  var store = str_(payload.bench_store, 100);
  if (!price) throw new Error('กรุณาระบุราคาที่เห็นที่ร้าน / Price is required');
  if (!store) throw new Error('กรุณาระบุชื่อร้าน / Store name is required');

  var req = requestByToken_(token);
  var item = itemOfRequest_(req, itemId);
  if ([P.APPROVED, P.PO_ISSUED, P.RECEIVED, P.CLOSED, P.CANCELLED].indexOf(String(item.purchase_status)) >= 0) {
    throw new Error('รายการนี้อนุมัติ/ปิดงานแล้ว เพิ่มราคาไม่ได้');
  }

  var photoId = str_(item.bench_photo);
  if (payload.photo && payload.photo.dataB64) {
    photoId = saveUpload_(payload.photo, 'benchmark', String(itemId)).id;
  }

  var ts = now_();
  touchItem_(item, {
    bench_price: price, bench_store: store, bench_note: str_(payload.bench_note, 300),
    bench_photo: photoId, bench_by: by, bench_at: ts
  });
  logHistory_(req.req_id, item.item_id, '', by, 'TECH', 'ADD_BENCHMARK',
    'ราคาที่ร้าน ' + fmtBaht_(price) + ' (' + store + ')' +
    (payload.bench_note ? (' | ' + str_(payload.bench_note, 200)) : ''));
  notifyPurchasing_('ช่างส่งราคาร้านข้างนอก ' + item.item_id,
    by + ' แจ้งราคาที่ไปดูมาสำหรับ ' + item.tool_name + '\n' +
    fmtBaht_(price) + ' ต่อ ' + item.unit + ' ที่ ' + store +
    '\n\nดึงไปเป็น 1 เจ้าในตารางเทียบราคาได้จากหน้าจัดซื้อ',
    techLink_(req.token), req.req_id);

  return buildTechDto_(findOne_(SHEET.REQUESTS, 'req_id', req.req_id));
}

/** ช่างอัปโหลดใบเสร็จ/ใบกำกับภาษี หลังผู้บริหารอนุมัติให้ซื้อเอง */
function apiUploadReceipt(token, itemId, file, by, actualPrice) {
  var who = str_(by, 100);
  if (!who) throw new Error('กรุณาเลือกชื่อของคุณก่อน / Please select your name first');
  var req = requestByToken_(token);
  var item = itemOfRequest_(req, itemId);
  if (String(item.buy_mode) !== MODE.LOCAL) throw new Error('อัปโหลดใบเสร็จได้เฉพาะรายการที่ผู้บริหารให้ช่างซื้อเอง');
  if ([P.APPROVED, P.RECEIVED].indexOf(String(item.purchase_status)) < 0) {
    throw new Error('ยังไม่ได้รับอนุมัติให้ซื้อ — กรุณารอผู้บริหารอนุมัติก่อน');
  }

  var saved = saveUpload_(file, 'receipts', item.item_id);
  var patch = { receipt_url: saved.url, receipt_at: now_(), purchase_status: P.RECEIVED };
  if (num_(actualPrice)) patch.actual_price = num_(actualPrice);
  touchItem_(item, patch);
  logHistory_(req.req_id, item.item_id, '', who, 'TECH', 'UPLOAD_RECEIPT',
    saved.url + (num_(actualPrice) ? (' | ราคาจริง ' + fmtBaht_(actualPrice)) : ''));
  notifyPurchasing_('ช่างส่งใบเสร็จแล้ว ' + item.item_id,
    who + ' อัปโหลดใบเสร็จของ ' + item.tool_name + '\n' + saved.url +
    (num_(actualPrice) ? ('\nราคาจริง: ' + fmtBaht_(actualPrice)) : ''),
    techLink_(req.token), req.req_id);

  return buildTechDto_(findOne_(SHEET.REQUESTS, 'req_id', req.req_id));
}

/** ค้นหาคำขอของตัวเอง ด้วยรหัสพนักงานหรือชื่อ (กรณีลิงก์หายไปใน LINE) */
function apiFindMyRequests(q) {
  var n = str_(q, 100).toLowerCase();
  if (n.length < 2) throw new Error('กรุณาระบุรหัสพนักงานหรือชื่อ / Enter your employee code or name');
  var reqs = readAll_(SHEET.REQUESTS)
    .filter(function (r) {
      return String(r.emp_code).toLowerCase() === n ||
        String(r.requester_name).toLowerCase().indexOf(n) >= 0;
    })
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); })
    .slice(0, 15);
  var items = readAll_(SHEET.ITEMS);
  return reqs.map(function (r) {
    var mine = items.filter(function (it) { return String(it.req_id) === String(r.req_id); });
    return {
      req_id: r.req_id, created_at: r.created_at, required_date: r.required_date,
      emp_code: r.emp_code, requester_name: r.requester_name, count: mine.length,
      tools: mine.map(function (i) { return i.tool_name; }).slice(0, 5).join(', '),
      url: techLink_(r.token)
    };
  });
}

/* ============================ เซสชันของพนักงานออฟฟิศ ============================ */

function login_(pinKey, prefix, pin, name, fallbackName) {
  var expected = String(cfg_(pinKey, ''));
  if (!expected) throw new Error('ยังไม่ได้ตั้งค่า ' + pinKey + ' ในชีต Config');
  Utilities.sleep(400); // กันการเดารหัสแบบรัวๆ
  if (String(pin || '').trim() !== expected) throw new Error('รหัสไม่ถูกต้อง / Wrong PIN');
  var who = str_(name, 60) || fallbackName;
  var t = Utilities.getUuid();
  CacheService.getScriptCache().put(prefix + t, who, 21600);
  return { token: t, name: who };
}

function requireSession_(prefix, t, roleName) {
  var cache = CacheService.getScriptCache();
  var who = t ? cache.get(prefix + t) : null;
  if (!who) throw new Error('เซสชัน' + roleName + 'หมดอายุ กรุณาใส่ PIN ใหม่ / Session expired');
  cache.put(prefix + t, who, 21600);
  return who;
}

function apiStaffLogin(pin, name) { return login_('STAFF_PIN', 'staff_', pin, name, 'จัดซื้อ'); }
function apiMgrLogin(pin, name) { return login_('MGR_PIN', 'mgr_', pin, name, 'ผู้บริหาร'); }
function requireStaff_(t) { return requireSession_('staff_', t, 'จัดซื้อ'); }
function requireMgr_(t) { return requireSession_('mgr_', t, 'ผู้บริหาร'); }

/** รวมข้อมูลรายการ + ตัวเลือก + ขั้นตอน ใช้ร่วมกันทั้งหน้าจัดซื้อและหน้าผู้บริหาร */
function officeItems_() {
  var reqs = {};
  readAll_(SHEET.REQUESTS).forEach(function (r) { reqs[r.req_id] = r; });
  var optionsByItem = {};
  readAll_(SHEET.OPTIONS).forEach(function (o) {
    if (o.status === 'WITHDRAWN') return;
    (optionsByItem[o.item_id] = optionsByItem[o.item_id] || []).push(o);
  });
  var notifyPending = {};
  readAll_(SHEET.NOTIFY).forEach(function (n) {
    if (n.channel === 'LINE' && n.status === 'PENDING' && n.ref) notifyPending[n.ref] = true;
  });

  return readAll_(SHEET.ITEMS).map(function (it) {
    var r = reqs[it.req_id] || {};
    var opts = (optionsByItem[it.item_id] || []).sort(function (a, b) {
      return num_(a.total_cost) - num_(b.total_cost);
    });
    it.options = opts;
    it.photos = toPhotoList_(it.ref_photos);
    it.stage = stageOf_(it);
    it.stageLabel = stageLabel_(it.stage);
    it.quote = quoteCheck_(it, opts);
    it.ready = readyForApproval_(it, opts);
    it.hasSpec = hasSpec_(it);
    it.emp_code = r.emp_code || '';
    it.requester_name = r.requester_name || '';
    it.site = r.site || '';
    it.contact = r.contact || '';
    it.required_date = it.required_date || r.required_date || '';
    it.req_created_at = r.created_at || '';
    it.req_note = r.note || '';
    it.tech_link = techLink_(r.token);
    it.line_pending = !!notifyPending[it.req_id];
    return it;
  });
}

function filterItems_(items, opts) {
  opts = opts || {};
  var out = items;
  if (opts.stage) out = out.filter(function (it) { return it.stage === opts.stage; });
  var q = str_(opts.q).toLowerCase();
  if (q) {
    out = out.filter(function (it) {
      return (it.item_id + ' ' + it.tool_name + ' ' + it.requester_name + ' ' + it.emp_code + ' ' +
        it.spec_pref + ' ' + it.brand_pref).toLowerCase().indexOf(q) >= 0;
    });
  }
  return out;
}

/* ============================ ฝั่งจัดซื้อ ============================ */

function apiStaffData(staffToken, opts) {
  requireStaff_(staffToken);
  var items = officeItems_();
  var counts = {};
  items.forEach(function (it) { counts[it.stage] = (counts[it.stage] || 0) + 1; });
  var list = filterItems_(items, opts)
    .sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); });
  return {
    items: list.slice(0, 300), counts: counts, stageLabels: STAGE_LABEL,
    config: publicCfg_(), total: list.length
  };
}

/**
 * จัดซื้อร่าง "สเปคอ้างอิง 1 ชิ้น" ส่งให้ช่างตรวจก่อนไปเทียบราคา
 * spec = { brand, model, detail, link, photo:{name,mime,dataB64} }
 */
function apiSetSpec(staffToken, itemId, spec) {
  var staff = requireStaff_(staffToken);
  spec = spec || {};
  if (!str_(spec.brand) && !str_(spec.model) && !str_(spec.detail)) {
    throw new Error('กรุณาระบุยี่ห้อ/รุ่น หรือรายละเอียดสเปคอย่างน้อยหนึ่งอย่าง');
  }
  var photo = str_(spec.photo_url, 400);
  if (spec.photo && spec.photo.dataB64) photo = saveUpload_(spec.photo, 'specs', String(itemId)).id;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var item = itemById_(itemId);
    if (LOCKED_FOR_TECH.indexOf(String(item.purchase_status)) >= 0) {
      throw new Error('รายการนี้ส่งอนุมัติ/ปิดงานแล้ว แก้สเปคไม่ได้');
    }
    var ts = now_();
    touchItem_(item, {
      spec_brand: str_(spec.brand, 100), spec_model: str_(spec.model, 100),
      spec_detail: str_(spec.detail, 800), spec_link: str_(spec.link, 500),
      spec_photo: photo, spec_by: staff, spec_at: ts,
      tech_status: T.WAITING, tech_note: '', tech_by: '', tech_at: '',
      purchase_status: P.WAITING_TECH
    });
    var merged = itemById_(itemId);
    logHistory_(item.req_id, item.item_id, '', staff, 'PURCHASING', 'SEND_SPEC',
      'ส่งสเปคให้ช่างตรวจ: ' + specTitle_(merged));

    var req = findOne_(SHEET.REQUESTS, 'req_id', item.req_id);
    if (req) {
      notifyTechnician_(req, 'ช่วยตรวจสเปคให้หน่อย — ' + item.tool_name,
        'จัดซื้อเลือกสเปคอ้างอิงไว้ 1 ชิ้น\n' + specTitle_(merged) +
        (spec.detail ? ('\n' + str_(spec.detail, 300)) : '') +
        '\n\nกดดูรูปและกดยืนยันว่า "สเปคถูกต้อง" หรือ "ขอแก้ไข" ได้เลย (ยังไม่ต้องดูราคา)');
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * เพิ่มตัวเลือกราคา 1 เจ้า
 * opt = { brand, model, spec, supplier, product_link, photo_url, photo:{...},
 *         unit_price, vat_rate, shipping, availability, delivery_date, payment_terms, note, source }
 */
function apiAddOption(staffToken, itemId, opt) {
  var staff = requireStaff_(staffToken);
  opt = opt || {};
  if (!str_(opt.supplier)) throw new Error('กรุณาระบุผู้ขาย/ร้าน / Supplier required');
  if (!num_(opt.unit_price)) throw new Error('กรุณาระบุราคาต่อหน่วย / Unit price required');

  var photo = str_(opt.photo_url, 400);
  if (opt.photo && opt.photo.dataB64) photo = saveUpload_(opt.photo, 'options', String(itemId)).id;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var item = itemById_(itemId);
    if ([P.APPROVED, P.PO_ISSUED, P.RECEIVED, P.CLOSED, P.CANCELLED].indexOf(String(item.purchase_status)) >= 0) {
      throw new Error('รายการนี้อนุมัติ/ปิดงานแล้ว ไม่สามารถเพิ่มตัวเลือกได้');
    }
    if (String(item.tech_status) !== T.CONFIRMED) {
      throw new Error('ต้องให้ช่างยืนยันสเปคก่อน จึงจะเทียบราคาได้ / Tech must confirm the spec first');
    }
    var existing = optionsOfItem_(item.item_id, true);
    var optionId = item.item_id + '-O' + (existing.length + 1);
    var vatRate = (opt.vat_rate === '' || opt.vat_rate === undefined || opt.vat_rate === null)
      ? num_(cfg_('VAT_RATE', 7)) : num_(opt.vat_rate);
    var calc = priceCalc_(opt.unit_price, item.qty, vatRate, opt.shipping);
    var ts = now_();

    appendRow_(SHEET.OPTIONS, {
      option_id: optionId, item_id: item.item_id, created_at: ts, created_by: staff,
      source: (String(opt.source) === SRC.TECH) ? SRC.TECH : SRC.SUPPLIER,
      brand: str_(opt.brand, 100), model: str_(opt.model, 100), spec: str_(opt.spec, 600),
      supplier: str_(opt.supplier, 150), product_link: str_(opt.product_link, 500),
      photo_url: photo,
      unit_price: num_(opt.unit_price), vat_rate: vatRate, vat_amount: calc.vat,
      shipping: calc.shipping, subtotal: calc.subtotal, total_cost: calc.total,
      availability: str_(opt.availability, 120), delivery_date: str_(opt.delivery_date, 40),
      payment_terms: str_(opt.payment_terms, 120), note: str_(opt.note, 400),
      status: 'QUOTED'
    });

    touchItem_(item, { purchase_status: P.QUOTING, quoted_at: ts });
    logHistory_(item.req_id, item.item_id, optionId, staff, 'PURCHASING', 'ADD_QUOTE',
      opt.supplier + ' | ' + brandModel_(opt) + ' | รวม ' + fmtBaht_(calc.total) +
      ' | ได้ของ ' + (opt.delivery_date || opt.availability || '-'));

    var after = quoteCheck_(itemById_(itemId), optionsOfItem_(item.item_id));
    return { ok: true, option_id: optionId, total: calc.total, quote: after };
  } finally {
    lock.releaseLock();
  }
}

/** ดึงราคาที่ช่างไปดูมาที่ร้านข้างนอก มาเป็น 1 เจ้าในตารางเทียบ */
function apiAddTechPriceAsOption(staffToken, itemId) {
  var staff = requireStaff_(staffToken);
  var item = itemById_(itemId);
  if (!num_(item.bench_price)) throw new Error('ช่างยังไม่ได้ใส่ราคาที่ร้านสำหรับรายการนี้');
  var dup = optionsOfItem_(item.item_id).filter(function (o) { return String(o.source) === SRC.TECH; });
  if (dup.length) throw new Error('ดึงราคาของช่างเข้าตารางเทียบไปแล้ว');

  return apiAddOption(staffToken, itemId, {
    source: SRC.TECH,
    brand: str_(item.spec_brand) || str_(item.brand_pref, 100),
    model: str_(item.spec_model),
    spec: 'ราคาที่ช่างไปดูมาเองที่ร้าน' + (item.bench_note ? (' — ' + item.bench_note) : ''),
    supplier: str_(item.bench_store, 150) || 'ร้านค้าปลีก',
    photo_url: str_(item.bench_photo),
    unit_price: num_(item.bench_price), vat_rate: 0, shipping: 0,
    availability: 'ซื้อได้ทันทีหน้าร้าน', delivery_date: 'วันเดียวกัน',
    payment_terms: 'ช่างสำรองจ่าย แล้วเบิกคืนตามใบกำกับภาษี',
    note: 'ช่าง ' + (item.bench_by || '-') + ' แจ้งราคาเมื่อ ' + (item.bench_at || '-')
  });
}

function apiWithdrawOption(staffToken, optionId) {
  var staff = requireStaff_(staffToken);
  var opt = findOne_(SHEET.OPTIONS, 'option_id', String(optionId));
  if (!opt) throw new Error('ไม่พบตัวเลือกนี้');
  var item = findOne_(SHEET.ITEMS, 'item_id', opt.item_id);
  if (item && String(item.purchase_status) === P.PENDING_APPROVAL) {
    throw new Error('รายการนี้ส่งผู้บริหารอนุมัติแล้ว ถอนตัวเลือกไม่ได้');
  }
  updateRow_(SHEET.OPTIONS, opt._row, { status: 'WITHDRAWN' });
  if (item && String(item.recommend_option_id) === String(optionId)) {
    touchItem_(item, { recommend_option_id: '', recommend_reason: '' });
  }
  logHistory_(item ? item.req_id : '', opt.item_id, optionId, staff, 'PURCHASING', 'WITHDRAW_QUOTE', brandModel_(opt));
  return { ok: true };
}

/** จัดซื้อชี้ว่าเจ้าไหนน่าซื้อที่สุด + เหตุผล (ผู้บริหารเห็นเป็นข้อเสนอแนะ) */
function apiRecommend(staffToken, itemId, optionId, reason) {
  var staff = requireStaff_(staffToken);
  var item = itemById_(itemId);
  var opt = findOne_(SHEET.OPTIONS, 'option_id', String(optionId));
  if (!opt || String(opt.item_id) !== String(item.item_id)) throw new Error('ไม่พบตัวเลือกนี้');
  if (String(item.purchase_status) === P.PENDING_APPROVAL) {
    throw new Error('ส่งอนุมัติไปแล้ว หากต้องการแก้ ให้ดึงกลับก่อน');
  }
  touchItem_(item, { recommend_option_id: opt.option_id, recommend_reason: str_(reason, 400) });
  logHistory_(item.req_id, item.item_id, opt.option_id, staff, 'PURCHASING', 'RECOMMEND',
    brandModel_(opt) + ' / ' + opt.supplier + ' รวม ' + fmtBaht_(opt.total_cost) +
    (reason ? (' | เหตุผล: ' + str_(reason, 300)) : ''));
  return { ok: true };
}

/** ส่งรายการเข้าคิวอนุมัติของผู้บริหาร (ตรวจกฎเทียบราคาก่อน) */
function apiSubmitForApproval(staffToken, itemId) {
  var staff = requireStaff_(staffToken);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var item = itemById_(itemId);
    var opts = optionsOfItem_(item.item_id);
    var chk = readyForApproval_(item, opts);
    if (!chk.ok) throw new Error(chk.why);
    if (String(item.purchase_status) === P.PENDING_APPROVAL) throw new Error('ส่งอนุมัติไปแล้ว');

    touchItem_(item, { purchase_status: P.PENDING_APPROVAL });
    var rec = findOne_(SHEET.OPTIONS, 'option_id', item.recommend_option_id);
    logHistory_(item.req_id, item.item_id, item.recommend_option_id, staff, 'PURCHASING', 'SUBMIT_APPROVAL',
      'เทียบ ' + opts.length + ' เจ้า | แนะนำ ' + brandModel_(rec) + ' / ' + (rec ? rec.supplier : '-') +
      ' รวม ' + fmtBaht_(rec ? rec.total_cost : 0));
    notifyManagement_('รออนุมัติ ' + item.item_id + ' — ' + item.tool_name,
      approvalRequestText_(item, opts, rec), mgrUrl_(), item.req_id);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** ดึงกลับมาแก้ก่อนผู้บริหารกด */
function apiWithdrawApproval(staffToken, itemId, reason) {
  var staff = requireStaff_(staffToken);
  var item = itemById_(itemId);
  if (String(item.purchase_status) !== P.PENDING_APPROVAL) throw new Error('รายการนี้ไม่ได้อยู่ในคิวอนุมัติ');
  touchItem_(item, { purchase_status: P.QUOTING });
  logHistory_(item.req_id, item.item_id, '', staff, 'PURCHASING', 'WITHDRAW_APPROVAL', str_(reason, 300));
  return { ok: true };
}

/** จัดซื้อเปิด PO — ทำได้เฉพาะรายการที่ผู้บริหารอนุมัติแล้วเท่านั้น */
function apiIssuePO(staffToken, itemId, poRef, note) {
  var staff = requireStaff_(staffToken);
  var item = itemById_(itemId);
  if (String(item.purchase_status) !== P.APPROVED) {
    throw new Error('เปิด PO ได้เฉพาะรายการที่ผู้บริหารอนุมัติแล้ว / Approval required first');
  }
  if (String(item.buy_mode) === MODE.LOCAL) {
    throw new Error('รายการนี้ผู้บริหารให้ช่างซื้อเอง ไม่ต้องเปิด PO');
  }
  if (!str_(poRef)) throw new Error('กรุณาระบุเลขที่ PO / PO number required');

  var ts = now_();
  touchItem_(item, { purchase_status: P.PO_ISSUED, po_ref: str_(poRef, 60), po_by: staff, po_at: ts });
  var opt = findOne_(SHEET.OPTIONS, 'option_id', item.approved_option_id);
  logHistory_(item.req_id, item.item_id, item.approved_option_id, staff, 'PURCHASING', 'ISSUE_PO',
    'PO ' + str_(poRef, 60) + ' | ' + brandModel_(opt) + ' / ' + (opt ? opt.supplier : '-') +
    (note ? (' | ' + str_(note, 200)) : ''));
  var req = findOne_(SHEET.REQUESTS, 'req_id', item.req_id);
  if (req) {
    notifyTechnician_(req, 'สั่งซื้อแล้ว — ' + item.tool_name,
      'จัดซื้อเปิด PO เรียบร้อย เลขที่ ' + str_(poRef, 60) +
      '\nได้ของประมาณ ' + (opt ? (opt.delivery_date || opt.availability || '-') : '-'));
  }
  return { ok: true };
}

/** รับของ / ปิดงาน / ยกเลิก */
function apiSetPurchaseStatus(staffToken, itemId, status, note) {
  var staff = requireStaff_(staffToken);
  var allowed = [P.RECEIVED, P.CLOSED, P.CANCELLED];
  if (allowed.indexOf(status) < 0) throw new Error('สถานะไม่ถูกต้อง / Invalid status');
  var item = itemById_(itemId);
  if (status === P.RECEIVED && [P.PO_ISSUED, P.APPROVED].indexOf(String(item.purchase_status)) < 0) {
    throw new Error('ต้องเปิด PO หรืออนุมัติให้ช่างซื้อเองก่อน');
  }
  touchItem_(item, { purchase_status: status });
  logHistory_(item.req_id, item.item_id, item.approved_option_id || '', staff, 'PURCHASING',
    'STATUS_' + status, str_(note, 400));
  var req = findOne_(SHEET.REQUESTS, 'req_id', item.req_id);
  if (req && status === P.RECEIVED) {
    notifyTechnician_(req, 'ของถึงแล้ว — ' + item.tool_name,
      'ของมาถึงแล้ว ติดต่อรับที่ฝ่ายจัดซื้อ' + (item.po_ref ? ('\nอ้างอิง: ' + item.po_ref) : ''));
  }
  return { ok: true };
}

/** ข้อความจากจัดซื้อถึงช่าง (ไม่มีราคา — ใช้คุยเรื่องสเปค/ของ) */
function apiSetPurNote(staffToken, itemId, note) {
  var staff = requireStaff_(staffToken);
  var item = itemById_(itemId);
  touchItem_(item, { pur_note: str_(note, 500) });
  logHistory_(item.req_id, item.item_id, '', staff, 'PURCHASING', 'NOTE_TO_TECH', str_(note, 500));
  var req = findOne_(SHEET.REQUESTS, 'req_id', item.req_id);
  if (req && str_(note)) notifyTechnician_(req, 'ข้อความจากจัดซื้อ — ' + item.tool_name, note);
  return { ok: true };
}

function apiLineText(staffToken, reqId) {
  requireStaff_(staffToken);
  var req = findOne_(SHEET.REQUESTS, 'req_id', String(reqId));
  if (!req) throw new Error('ไม่พบใบขอซื้อนี้');
  var items = findBy_(SHEET.ITEMS, 'req_id', req.req_id).sort(function (a, b) { return num_(a.seq) - num_(b.seq); });
  var pending = readAll_(SHEET.NOTIFY).filter(function (n) {
    return n.channel === 'LINE' && n.status === 'PENDING' && String(n.ref) === String(req.req_id);
  });
  return {
    summary: lineSummaryText_(req, items),
    pending: pending.map(function (n) { return { ts: n.ts, subject: n.subject, message: n.message }; })
  };
}

function apiMarkLineSent(staffToken, reqId) {
  var staff = requireStaff_(staffToken);
  var n = 0;
  readAll_(SHEET.NOTIFY).forEach(function (r) {
    if (r.channel === 'LINE' && r.status === 'PENDING' && String(r.ref) === String(reqId)) {
      updateRow_(SHEET.NOTIFY, r._row, { status: 'SENT', error: 'ส่งด้วยมือโดย ' + staff });
      n++;
    }
  });
  logHistory_(reqId, '', '', staff, 'PURCHASING', 'LINE_SENT', 'ส่งข้อความ LINE ให้ช่างแล้ว (' + n + ' ข้อความ)');
  return { ok: true, marked: n };
}

function apiItemHistory(sessionToken, itemId) {
  var who = null;
  try { who = requireStaff_(sessionToken); } catch (e) { who = requireMgr_(sessionToken); }
  return readAll_(SHEET.HISTORY)
    .filter(function (h) { return String(h.item_id) === String(itemId); })
    .map(function (h) { return { ts: h.ts, actor: h.actor, role: h.role, action: h.action, detail: h.detail }; });
}

/* ============================ ฝั่งผู้บริหาร ============================ */

/** ผู้บริหารเห็นเฉพาะคิวอนุมัติเป็นหลัก แต่ดูย้อนหลังได้ */
function apiMgrData(mgrToken, opts) {
  requireMgr_(mgrToken);
  opts = opts || {};
  var items = officeItems_();
  var counts = {};
  items.forEach(function (it) { counts[it.stage] = (counts[it.stage] || 0) + 1; });

  var stage = opts.stage || 'APPROVAL';
  var list = filterItems_(items, { stage: stage === 'ALL' ? '' : stage, q: opts.q });

  // จัดกลุ่มเป็นใบ เพื่อให้กด "อนุมัติทั้งใบ" ได้
  var groups = {};
  list.forEach(function (it) {
    var g = groups[it.req_id] || (groups[it.req_id] = {
      req_id: it.req_id, requester_name: it.requester_name, emp_code: it.emp_code,
      site: it.site, created_at: it.req_created_at, required_date: it.required_date,
      note: it.req_note, items: [], total: 0, approvable: 0
    });
    g.items.push(it);
    var rec = it.options.filter(function (o) { return String(o.option_id) === String(it.recommend_option_id); })[0];
    if (rec) g.total += num_(rec.total_cost);
    if (it.stage === 'APPROVAL') g.approvable++;
  });

  var list2 = Object.keys(groups).map(function (k) { return groups[k]; })
    .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });

  return {
    groups: list2, counts: counts, stageLabels: STAGE_LABEL,
    config: publicCfg_(), stage: stage,
    total: list.length
  };
}

/**
 * ผู้บริหารอนุมัติรายการเดียว — เลือกได้ว่าจะเอาเจ้าไหน (ไม่จำเป็นต้องตามที่จัดซื้อแนะนำ)
 * ถ้าเลือกตัวเลือกที่มาจากราคาที่ช่างไปดูมา ระบบจะตั้งเป็น "ให้ช่างซื้อเอง" อัตโนมัติ
 */
function apiMgrApprove(mgrToken, itemId, optionId, note) {
  var mgr = requireMgr_(mgrToken);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var item = itemById_(itemId);
    if (String(item.purchase_status) !== P.PENDING_APPROVAL) {
      throw new Error('อนุมัติได้เฉพาะรายการที่สถานะ "รออนุมัติ" เท่านั้น');
    }
    var chosenId = str_(optionId) || str_(item.recommend_option_id);
    var opt = findOne_(SHEET.OPTIONS, 'option_id', chosenId);
    if (!opt || String(opt.item_id) !== String(item.item_id)) throw new Error('กรุณาเลือกตัวเลือกที่อนุมัติ');

    var mode = (String(opt.source) === SRC.TECH) ? MODE.LOCAL : MODE.SUPPLIER;
    var ts = now_();
    touchItem_(item, {
      purchase_status: P.APPROVED, approved_option_id: opt.option_id, buy_mode: mode,
      mgr_by: mgr, mgr_at: ts, mgr_note: str_(note, 400),
      tax_invoice_ok: mode === MODE.LOCAL ? 'ต้องขอ' : ''
    });
    optionsOfItem_(item.item_id).forEach(function (o) {
      var st = (o.option_id === opt.option_id) ? 'APPROVED' : 'NOT_SELECTED';
      if (st !== o.status) updateRow_(SHEET.OPTIONS, o._row, { status: st });
    });
    logHistory_(item.req_id, item.item_id, opt.option_id, mgr, 'MANAGEMENT', 'APPROVE',
      'อนุมัติ ' + brandModel_(opt) + ' / ' + opt.supplier + ' รวม ' + fmtBaht_(opt.total_cost) +
      ' | วิธีได้ของ: ' + (mode === MODE.LOCAL ? 'ช่างซื้อเอง' : 'จัดซื้อเปิด PO') +
      (note ? (' | ' + str_(note, 200)) : ''));

    var req = findOne_(SHEET.REQUESTS, 'req_id', item.req_id);
    notifyPurchasing_('อนุมัติแล้ว ' + item.item_id + ' — ' + item.tool_name,
      mgr + ' อนุมัติ ' + brandModel_(opt) + ' / ' + opt.supplier + ' รวม ' + fmtBaht_(opt.total_cost) +
      '\n' + (mode === MODE.LOCAL
        ? 'ผู้บริหารเลือกราคาที่ช่างไปดูมา → ให้ช่างซื้อเองแล้วเบิกคืนตามใบกำกับภาษี'
        : 'ขั้นต่อไป: เปิด PO กับผู้ขายรายนี้') +
      (note ? ('\nหมายเหตุ: ' + note) : ''),
      webappUrl_() ? (webappUrl_() + '?p=dash') : '', item.req_id);

    if (req && mode === MODE.LOCAL) {
      logNotify_('LINE', req.requester_name, req.req_id, 'อนุมัติให้ซื้อเอง ' + item.item_id,
        lineLocalBuyText_(req, itemById_(itemId), opt), techLink_(req.token), 'PENDING',
        'รอจัดซื้อคัดลอกส่ง LINE');
    }
    return { ok: true, buy_mode: mode };
  } finally {
    lock.releaseLock();
  }
}

function apiMgrReject(mgrToken, itemId, note) {
  var mgr = requireMgr_(mgrToken);
  if (!str_(note)) throw new Error('กรุณาระบุเหตุผลที่ไม่อนุมัติ / Reason required');
  var item = itemById_(itemId);
  if (String(item.purchase_status) !== P.PENDING_APPROVAL) {
    throw new Error('ทำได้เฉพาะรายการที่สถานะ "รออนุมัติ" เท่านั้น');
  }
  touchItem_(item, {
    purchase_status: P.REJECTED, mgr_by: mgr, mgr_at: now_(), mgr_note: str_(note, 400)
  });
  logHistory_(item.req_id, item.item_id, '', mgr, 'MANAGEMENT', 'REJECT', str_(note, 400));
  notifyPurchasing_('ไม่อนุมัติ ' + item.item_id + ' — ' + item.tool_name,
    mgr + ' ไม่อนุมัติรายการนี้\nเหตุผล: ' + note,
    webappUrl_() ? (webappUrl_() + '?p=dash') : '', item.req_id);
  return { ok: true };
}

/** อนุมัติทั้งใบในคลิกเดียว — ใช้ตัวเลือกที่จัดซื้อแนะนำของแต่ละรายการ */
function apiMgrApproveAll(mgrToken, reqId, note) {
  var mgr = requireMgr_(mgrToken);
  var items = findBy_(SHEET.ITEMS, 'req_id', String(reqId))
    .filter(function (it) { return String(it.purchase_status) === P.PENDING_APPROVAL; })
    .sort(function (a, b) { return num_(a.seq) - num_(b.seq); });
  if (!items.length) throw new Error('ใบนี้ไม่มีรายการที่รออนุมัติ');

  var done = [], failed = [];
  items.forEach(function (it) {
    try {
      apiMgrApprove(mgrToken, it.item_id, it.recommend_option_id, note);
      done.push(it.item_id);
    } catch (e) {
      failed.push(it.item_id + ': ' + e.message);
    }
  });
  logHistory_(reqId, '', '', mgr, 'MANAGEMENT', 'APPROVE_ALL',
    'อนุมัติทั้งใบ ' + done.length + ' รายการ' + (failed.length ? (' | ไม่สำเร็จ ' + failed.join('; ')) : ''));
  return { ok: true, approved: done.length, failed: failed };
}
