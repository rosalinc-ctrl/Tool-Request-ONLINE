/**
 * Meiwa Tool Request — Api.gs
 * ฟังก์ชันทั้งหมดที่หน้าเว็บเรียกผ่าน google.script.run
 *
 * ฝั่งช่าง: เข้าถึงด้วย token ในลิงก์ (ช่างไม่มีอีเมล จึงไม่ต้องล็อกอิน)
 * ฝั่งจัดซื้อ: เข้าถึงด้วย PIN แลก staffToken อายุ 6 ชั่วโมง
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

function optionsOfItem_(itemId, includeWithdrawn) {
  return findBy_(SHEET.OPTIONS, 'item_id', itemId)
    .filter(function (o) { return includeWithdrawn || o.status !== 'WITHDRAWN'; })
    .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
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

function buildRequestDto_(req) {
  var items = findBy_(SHEET.ITEMS, 'req_id', req.req_id)
    .sort(function (a, b) { return num_(a.seq) - num_(b.seq); });
  var allOptions = readAll_(SHEET.OPTIONS);
  var allHistory = readAll_(SHEET.HISTORY);

  items.forEach(function (it) {
    it.options = allOptions
      .filter(function (o) { return String(o.item_id) === String(it.item_id) && o.status !== 'WITHDRAWN'; })
      .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
    it.photos = toPhotoList_(it.ref_photos);
    it.stage = stageOf_(it, it.options.length);
    it.stageLabel = stageLabel_(it.stage);
    it.history = allHistory
      .filter(function (h) { return String(h.item_id) === String(it.item_id); })
      .map(function (h) { return { ts: h.ts, actor: h.actor, role: h.role, action: h.action, detail: h.detail }; });
  });

  return { request: req, items: items, config: publicCfg_(), technicians: activeTechs_() };
}

/* ============================ ฝั่งช่าง ============================ */

function apiBootstrap() {
  return { technicians: activeTechs_(), config: publicCfg_() };
}

/**
 * ส่งคำขอใหม่ (หลายรายการในใบเดียว)
 * payload = { requester_name, site, contact, required_date, note,
 *             items:[{tool_name, qty, unit, intended_use, spec_pref,
 *                     benchmark_price, benchmark_store, ref_links,
 *                     photos:[{name,mime,dataB64}]}] }
 */
function apiSubmitRequest(payload) {
  payload = payload || {};
  var name = str_(payload.requester_name, 100);
  if (!name) throw new Error('กรุณาระบุชื่อผู้ขอ / Requester name is required');

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
      requester_name: name, site: str_(payload.site, 80), contact: str_(payload.contact, 120),
      required_date: str_(payload.required_date, 20), note: str_(payload.note, 500),
      status: 'OPEN', updated_at: ts
    });

    items.forEach(function (it, i) {
      var itemId = reqId + '-' + (i + 1);
      appendRow_(SHEET.ITEMS, {
        item_id: itemId, req_id: reqId, seq: i + 1,
        tool_name: str_(it.tool_name, 150),
        qty: num_(it.qty) || 1,
        unit: str_(it.unit, 20) || 'ชิ้น',
        intended_use: str_(it.intended_use, 400),
        spec_pref: str_(it.spec_pref, 400),
        benchmark_price: num_(it.benchmark_price) || '',
        benchmark_store: str_(it.benchmark_store, 100),
        ref_links: str_(it.ref_links, 500),
        ref_photos: photoIds[i].join(','),
        tech_status: T.WAITING_OPTION, tech_note: '', decided_by: '', decided_at: '',
        chosen_option_id: '', pur_note: '',
        fulfil_mode: '', local_est_price: '', local_store: '', tax_invoice_ok: '',
        receipt_url: '', receipt_at: '',
        purchase_status: P.NEW, approved_by: '', approved_at: '', approval_note: '', po_ref: '',
        updated_at: ts
      });
      logHistory_(reqId, itemId, '', name, 'TECH', 'SUBMIT',
        it.tool_name + ' x' + (num_(it.qty) || 1) +
        (num_(it.benchmark_price) ? (' | ราคาที่ร้าน ' + fmtBaht_(it.benchmark_price)) : ''));
    });

    var url = techLink_(token);
    var body = [
      'มีใบขอซื้อเครื่องมือใหม่',
      'เลขที่: ' + reqId,
      'ผู้ขอ: ' + name + (payload.site ? (' (' + payload.site + ')') : ''),
      'ติดต่อ: ' + (payload.contact || '-'),
      'ต้องการใช้วันที่: ' + (payload.required_date || '-'),
      'จำนวน: ' + items.length + ' รายการ',
      '',
      items.map(function (it, i) {
        return (i + 1) + '. ' + it.tool_name + ' x' + (num_(it.qty) || 1) + ' ' + (it.unit || 'ชิ้น') +
          (it.spec_pref ? ('\n   สเปค: ' + it.spec_pref) : '') +
          (num_(it.benchmark_price) ? ('\n   ราคาที่ช่างเห็นที่ร้าน: ' + fmtBaht_(it.benchmark_price) + ' (' + (it.benchmark_store || '-') + ')') : '');
      }).join('\n')
    ].join('\n');
    notifyPurchasing_('ใบขอซื้อใหม่ ' + reqId + ' — ' + name, body, url, reqId);

    return { req_id: reqId, token: token, url: url };
  } finally {
    lock.releaseLock();
  }
}

function apiGetRequest(token) {
  return buildRequestDto_(requestByToken_(token));
}

/**
 * ช่างตัดสินใจเรื่องสเปค (ทีละรายการ)
 * action: CONFIRM | REJECT | CHANGE
 */
function apiTechDecision(token, itemId, action, payload) {
  payload = payload || {};
  var by = str_(payload.by, 100);
  if (!by) throw new Error('กรุณาเลือกชื่อผู้ตัดสินใจก่อน / Please select your name first');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var req = requestByToken_(token);
    var item = itemOfRequest_(req, itemId);
    if (LOCKED_FOR_TECH.indexOf(String(item.purchase_status)) >= 0) {
      throw new Error('รายการนี้ส่งให้จัดซื้อดำเนินการแล้ว เปลี่ยนเองไม่ได้ — กรุณาแจ้งฝ่ายจัดซื้อ');
    }

    var ts = now_();
    var note = str_(payload.note, 400);
    var opt = null;
    if (payload.option_id) {
      opt = findOne_(SHEET.OPTIONS, 'option_id', String(payload.option_id));
      if (!opt || String(opt.item_id) !== String(item.item_id)) throw new Error('ไม่พบตัวเลือกนี้ / Option not found');
    }

    if (action === 'CONFIRM') {
      if (!opt) throw new Error('กรุณาเลือกตัวเลือกที่ต้องการยืนยัน');
      optionsOfItem_(item.item_id).forEach(function (o) {
        var st = (o.option_id === opt.option_id) ? 'CONFIRMED' : (o.status === 'CONFIRMED' ? 'PROPOSED' : o.status);
        if (st !== o.status) updateRow_(SHEET.OPTIONS, o._row, { status: st });
      });
      touchItem_(item, {
        tech_status: T.CONFIRMED, tech_note: note, decided_by: by, decided_at: ts,
        chosen_option_id: opt.option_id, purchase_status: P.WAITING_TECH
      });
      logHistory_(req.req_id, item.item_id, opt.option_id, by, 'TECH', 'CONFIRM_SPEC',
        'ยืนยันสเปค: ' + opt.brand_model + ' / ' + opt.supplier + ' รวม ' + fmtBaht_(opt.total_cost) + (note ? (' | ' + note) : ''));
      notifyPurchasing_('ช่างยืนยันสเปคแล้ว ' + item.item_id,
        by + ' ยืนยันสเปคของ ' + item.tool_name + '\nตัวเลือก: ' + opt.brand_model + ' (' + opt.supplier + ') รวม ' + fmtBaht_(opt.total_cost) +
        '\n\nหมายเหตุ: การยืนยันสเปคยังไม่ใช่การอนุมัติสั่งซื้อ — รอช่างเลือกวิธีซื้อ แล้วจัดซื้อจึงอนุมัติ',
        techLink_(req.token), req.req_id);

    } else if (action === 'REJECT') {
      if (!note) throw new Error('กรุณาระบุเหตุผลที่ไม่ตรงสเปค / Reason required');
      if (opt) updateRow_(SHEET.OPTIONS, opt._row, { status: 'REJECTED' });
      touchItem_(item, {
        tech_status: T.REJECTED, tech_note: note, decided_by: by, decided_at: ts,
        chosen_option_id: '', purchase_status: P.WAITING_TECH
      });
      logHistory_(req.req_id, item.item_id, opt ? opt.option_id : '', by, 'TECH', 'REJECT_SPEC', note);
      notifyPurchasing_('ช่างปฏิเสธสเปค ' + item.item_id,
        by + ' แจ้งว่าไม่ตรงสเปคสำหรับ ' + item.tool_name + '\nเหตุผล: ' + note + '\n\nกรุณาเสนอตัวเลือกใหม่',
        techLink_(req.token), req.req_id);

    } else if (action === 'CHANGE') {
      if (!note) throw new Error('กรุณาระบุสิ่งที่ต้องการให้แก้ไข / Please describe the change');
      if (opt) updateRow_(SHEET.OPTIONS, opt._row, { status: 'CHANGE_REQUESTED' });
      touchItem_(item, {
        tech_status: T.CHANGE_REQUESTED, tech_note: note, decided_by: by, decided_at: ts,
        purchase_status: P.WAITING_TECH
      });
      logHistory_(req.req_id, item.item_id, opt ? opt.option_id : '', by, 'TECH', 'REQUEST_CHANGE', note);
      notifyPurchasing_('ช่างขอให้แก้ไข ' + item.item_id,
        by + ' ขอให้แก้ไขตัวเลือกของ ' + item.tool_name + '\nรายละเอียด: ' + note,
        techLink_(req.token), req.req_id);

    } else {
      throw new Error('คำสั่งไม่ถูกต้อง / Unknown action');
    }

    return buildRequestDto_(findOne_(SHEET.REQUESTS, 'req_id', req.req_id));
  } finally {
    lock.releaseLock();
  }
}

/**
 * ช่างเลือกวิธีซื้อ: SUPPLIER (จัดซื้อสั่งซื้อ) | LOCAL (ช่างซื้อเองที่ร้าน)
 * ทั้งสองแบบยังต้องรอจัดซื้ออนุมัติก่อนเสมอ
 */
function apiChooseMode(token, itemId, mode, payload) {
  payload = payload || {};
  var by = str_(payload.by, 100);
  if (!by) throw new Error('กรุณาเลือกชื่อผู้ตัดสินใจก่อน / Please select your name first');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var req = requestByToken_(token);
    var item = itemOfRequest_(req, itemId);
    if (LOCKED_FOR_TECH.indexOf(String(item.purchase_status)) >= 0) {
      throw new Error('รายการนี้ส่งให้จัดซื้อดำเนินการแล้ว เปลี่ยนเองไม่ได้ — กรุณาแจ้งฝ่ายจัดซื้อ');
    }

    var ts = now_();
    var patch = { decided_by: by, decided_at: ts, purchase_status: P.PENDING_APPROVAL };
    var detail = '';

    if (mode === 'SUPPLIER') {
      if (String(item.tech_status) !== T.CONFIRMED || !item.chosen_option_id) {
        throw new Error('กรุณายืนยันสเปคตัวเลือกที่ต้องการก่อน / Confirm a spec first');
      }
      var opt = findOne_(SHEET.OPTIONS, 'option_id', item.chosen_option_id);
      patch.fulfil_mode = 'SUPPLIER';
      patch.local_est_price = ''; patch.local_store = ''; patch.tax_invoice_ok = '';
      detail = 'ให้จัดซื้อสั่งซื้อจาก ' + (opt ? opt.supplier : '-') + ' รวม ' + fmtBaht_(opt ? opt.total_cost : 0);

    } else if (mode === 'LOCAL') {
      var est = num_(payload.local_est_price);
      var store = str_(payload.local_store, 100);
      if (!est) throw new Error('กรุณาระบุราคาประเมินที่ร้าน / Estimated price required');
      if (!store) throw new Error('กรุณาระบุชื่อร้านที่จะไปซื้อ / Store name required');
      if (payload.tax_invoice_ok !== true) {
        throw new Error('ต้องยืนยันว่าขอใบกำกับภาษี/ใบเสร็จในนามบริษัทได้ / Tax invoice confirmation required');
      }
      patch.fulfil_mode = 'LOCAL';
      patch.local_est_price = est;
      patch.local_store = store;
      patch.tax_invoice_ok = 'Y';
      detail = 'ช่างซื้อเองที่ ' + store + ' ราคาประเมิน ' + fmtBaht_(est) + ' | ยืนยันขอใบกำกับภาษีในนามบริษัทได้';

    } else {
      throw new Error('วิธีซื้อไม่ถูกต้อง / Unknown mode');
    }

    touchItem_(item, patch);
    logHistory_(req.req_id, item.item_id, item.chosen_option_id || '', by, 'TECH', 'CHOOSE_' + mode, detail);
    notifyPurchasing_('รออนุมัติ ' + item.item_id + ' — ' + (mode === 'LOCAL' ? 'ช่างซื้อเอง' : 'จัดซื้อสั่งซื้อ'),
      by + ' เลือกวิธีซื้อสำหรับ ' + item.tool_name + ' x' + item.qty + '\n' + detail +
      '\n\nสถานะ: รอฝ่ายจัดซื้ออนุมัติ (ยังไม่ถือว่าอนุมัติสั่งซื้อ)',
      techLink_(req.token), req.req_id);

    return buildRequestDto_(findOne_(SHEET.REQUESTS, 'req_id', req.req_id));
  } finally {
    lock.releaseLock();
  }
}

/** ช่างอัปโหลดใบเสร็จ/ใบกำกับภาษี หลังซื้อเองที่ร้าน */
function apiUploadReceipt(token, itemId, file, by, actualPrice) {
  var who = str_(by, 100);
  if (!who) throw new Error('กรุณาเลือกชื่อผู้ตัดสินใจก่อน / Please select your name first');
  var req = requestByToken_(token);
  var item = itemOfRequest_(req, itemId);
  if (String(item.fulfil_mode) !== 'LOCAL') throw new Error('อัปโหลดใบเสร็จได้เฉพาะรายการที่ช่างซื้อเอง');
  if ([P.APPROVED, P.ORDERED, P.RECEIVED].indexOf(String(item.purchase_status)) < 0) {
    throw new Error('ยังไม่ได้รับอนุมัติให้ซื้อ — กรุณารอจัดซื้ออนุมัติก่อน');
  }

  var saved = saveUpload_(file, 'receipts', item.item_id);
  var patch = { receipt_url: saved.url, receipt_at: now_(), purchase_status: P.RECEIVED };
  if (num_(actualPrice)) patch.local_est_price = num_(actualPrice);
  touchItem_(item, patch);
  logHistory_(req.req_id, item.item_id, '', who, 'TECH', 'UPLOAD_RECEIPT',
    saved.url + (num_(actualPrice) ? (' | ราคาจริง ' + fmtBaht_(actualPrice)) : ''));
  notifyPurchasing_('ช่างส่งใบเสร็จแล้ว ' + item.item_id,
    who + ' อัปโหลดใบเสร็จของ ' + item.tool_name + '\n' + saved.url +
    (num_(actualPrice) ? ('\nราคาจริง: ' + fmtBaht_(actualPrice)) : ''),
    techLink_(req.token), req.req_id);

  return buildRequestDto_(findOne_(SHEET.REQUESTS, 'req_id', req.req_id));
}

/** ค้นหาคำขอของตัวเอง กรณีลิงก์หายไปใน LINE */
function apiFindMyRequests(name) {
  var n = str_(name, 100).toLowerCase();
  if (n.length < 2) throw new Error('กรุณาระบุชื่อ / Please enter your name');
  var reqs = readAll_(SHEET.REQUESTS)
    .filter(function (r) { return String(r.requester_name).toLowerCase().indexOf(n) >= 0; })
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); })
    .slice(0, 15);
  var items = readAll_(SHEET.ITEMS);
  return reqs.map(function (r) {
    var mine = items.filter(function (it) { return String(it.req_id) === String(r.req_id); });
    return {
      req_id: r.req_id, created_at: r.created_at, required_date: r.required_date,
      requester_name: r.requester_name, count: mine.length,
      tools: mine.map(function (i) { return i.tool_name; }).slice(0, 5).join(', '),
      url: techLink_(r.token)
    };
  });
}

/* ============================ ฝั่งจัดซื้อ ============================ */

function apiStaffLogin(pin, name) {
  var expected = String(cfg_('STAFF_PIN', ''));
  if (!expected) throw new Error('ยังไม่ได้ตั้งค่า STAFF_PIN ในชีต Config');
  Utilities.sleep(400); // กันการเดารหัสแบบรัวๆ
  if (String(pin || '').trim() !== expected) throw new Error('รหัสไม่ถูกต้อง / Wrong PIN');
  var who = str_(name, 60) || 'จัดซื้อ';
  var t = Utilities.getUuid();
  CacheService.getScriptCache().put('staff_' + t, who, 21600);
  return { token: t, name: who };
}

function requireStaff_(t) {
  var cache = CacheService.getScriptCache();
  var who = t ? cache.get('staff_' + t) : null;
  if (!who) throw new Error('เซสชันหมดอายุ กรุณาใส่ PIN ใหม่ / Session expired');
  cache.put('staff_' + t, who, 21600);
  return who;
}

/** ข้อมูลทั้งหมดสำหรับหน้าจัดซื้อ */
function apiStaffData(staffToken, opts) {
  requireStaff_(staffToken);
  opts = opts || {};

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

  var counts = {};
  var items = readAll_(SHEET.ITEMS).map(function (it) {
    var r = reqs[it.req_id] || {};
    var opts2 = (optionsByItem[it.item_id] || []).sort(function (a, b) {
      return String(a.created_at).localeCompare(String(b.created_at));
    });
    it.options = opts2;
    it.photos = toPhotoList_(it.ref_photos);
    it.stage = stageOf_(it, opts2.length);
    it.stageLabel = stageLabel_(it.stage);
    it.requester_name = r.requester_name || '';
    it.site = r.site || '';
    it.contact = r.contact || '';
    it.required_date = r.required_date || '';
    it.req_created_at = r.created_at || '';
    it.tech_link = techLink_(r.token);
    it.line_pending = !!notifyPending[it.req_id];
    counts[it.stage] = (counts[it.stage] || 0) + 1;
    return it;
  });

  if (opts.stage) items = items.filter(function (it) { return it.stage === opts.stage; });
  var q = str_(opts.q).toLowerCase();
  if (q) {
    items = items.filter(function (it) {
      return (it.item_id + ' ' + it.tool_name + ' ' + it.requester_name + ' ' + it.spec_pref)
        .toLowerCase().indexOf(q) >= 0;
    });
  }

  items.sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); });

  return {
    items: items.slice(0, 300),
    counts: counts,
    stageLabels: STAGE_LABEL,
    config: publicCfg_(),
    total: items.length
  };
}

/**
 * จัดซื้อเพิ่มตัวเลือกให้รายการหนึ่ง
 * opt = { brand_model, spec, supplier, product_link, photo_url, photo:{...},
 *         unit_price, vat_rate, shipping, availability, delivery_date, payment_terms, note, is_recommended }
 */
function apiAddOption(staffToken, itemId, opt) {
  var staff = requireStaff_(staffToken);
  opt = opt || {};
  if (!str_(opt.brand_model)) throw new Error('กรุณาระบุยี่ห้อ/รุ่น / Brand-model required');
  if (!str_(opt.supplier)) throw new Error('กรุณาระบุผู้ขาย / Supplier required');
  if (!num_(opt.unit_price)) throw new Error('กรุณาระบุราคาต่อหน่วย / Unit price required');

  var photo = str_(opt.photo_url, 400);
  if (opt.photo && opt.photo.dataB64) photo = saveUpload_(opt.photo, 'options', String(itemId)).id;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var item = findOne_(SHEET.ITEMS, 'item_id', String(itemId));
    if (!item) throw new Error('ไม่พบรายการนี้ / Item not found');
    if ([P.APPROVED, P.ORDERED, P.RECEIVED, P.CLOSED, P.CANCELLED].indexOf(String(item.purchase_status)) >= 0) {
      throw new Error('รายการนี้อนุมัติ/ปิดงานแล้ว ไม่สามารถเพิ่มตัวเลือกได้');
    }
    var req = findOne_(SHEET.REQUESTS, 'req_id', item.req_id);
    var existing = optionsOfItem_(item.item_id, true);
    var optionId = item.item_id + '-O' + (existing.length + 1);
    var vatRate = (opt.vat_rate === '' || opt.vat_rate === undefined || opt.vat_rate === null)
      ? num_(cfg_('VAT_RATE', 7)) : num_(opt.vat_rate);
    var calc = priceCalc_(opt.unit_price, item.qty, vatRate, opt.shipping);
    var ts = now_();

    appendRow_(SHEET.OPTIONS, {
      option_id: optionId, item_id: item.item_id, created_at: ts, created_by: staff,
      brand_model: str_(opt.brand_model, 150), spec: str_(opt.spec, 600),
      supplier: str_(opt.supplier, 150), product_link: str_(opt.product_link, 500),
      photo_url: photo,
      unit_price: num_(opt.unit_price), vat_rate: vatRate, vat_amount: calc.vat,
      shipping: calc.shipping, subtotal: calc.subtotal, total_cost: calc.total,
      availability: str_(opt.availability, 120), delivery_date: str_(opt.delivery_date, 40),
      payment_terms: str_(opt.payment_terms, 120), note: str_(opt.note, 400),
      is_recommended: opt.is_recommended ? 'Y' : '', status: 'PROPOSED'
    });

    touchItem_(item, { tech_status: T.WAITING_TECH, purchase_status: P.WAITING_TECH });
    logHistory_(item.req_id, item.item_id, optionId, staff, 'PURCHASING', 'ADD_OPTION',
      opt.brand_model + ' / ' + opt.supplier + ' | รวม ' + fmtBaht_(calc.total) +
      ' | ส่ง ' + (opt.delivery_date || opt.availability || '-'));

    if (req) {
      notifyTechnician_(req, 'มีตัวเลือกใหม่ให้ยืนยัน — ' + item.tool_name,
        'จัดซื้อเสนอ: ' + opt.brand_model + ' (' + opt.supplier + ')\n' +
        'ราคารวม ' + fmtBaht_(calc.total) + ' | ได้ของ ' + (opt.delivery_date || opt.availability || '-') + '\n' +
        'กรุณาตรวจสอบรูปและสเปค แล้วกดยืนยัน/ไม่ตรงสเปค');
    }
    return { ok: true, option_id: optionId, total: calc.total };
  } finally {
    lock.releaseLock();
  }
}

function apiWithdrawOption(staffToken, optionId) {
  var staff = requireStaff_(staffToken);
  var opt = findOne_(SHEET.OPTIONS, 'option_id', String(optionId));
  if (!opt) throw new Error('ไม่พบตัวเลือกนี้');
  updateRow_(SHEET.OPTIONS, opt._row, { status: 'WITHDRAWN' });
  var item = findOne_(SHEET.ITEMS, 'item_id', opt.item_id);
  if (item && String(item.chosen_option_id) === String(optionId)) {
    touchItem_(item, { chosen_option_id: '', tech_status: T.WAITING_TECH });
  }
  logHistory_(item ? item.req_id : '', opt.item_id, optionId, staff, 'PURCHASING', 'WITHDRAW_OPTION', opt.brand_model);
  return { ok: true };
}

/** ขั้นตอนอนุมัติของจัดซื้อ — แยกจากการยืนยันสเปคของช่างโดยสิ้นเชิง */
function apiApprove(staffToken, itemId, approve, note, poRef) {
  var staff = requireStaff_(staffToken);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var item = findOne_(SHEET.ITEMS, 'item_id', String(itemId));
    if (!item) throw new Error('ไม่พบรายการนี้');
    if (String(item.purchase_status) !== P.PENDING_APPROVAL) {
      throw new Error('อนุมัติได้เฉพาะรายการที่สถานะ "รออนุมัติ" เท่านั้น');
    }
    var req = findOne_(SHEET.REQUESTS, 'req_id', item.req_id);
    var ts = now_();
    var patch = {
      purchase_status: approve ? P.APPROVED : P.REJECTED,
      approved_by: staff, approved_at: ts, approval_note: str_(note, 400)
    };
    if (approve && str_(poRef)) patch.po_ref = str_(poRef, 60);
    touchItem_(item, patch);
    logHistory_(item.req_id, item.item_id, item.chosen_option_id || '', staff, 'PURCHASING',
      approve ? 'APPROVE_PURCHASE' : 'REJECT_PURCHASE', str_(note, 400));

    if (req) {
      var merged = findOne_(SHEET.ITEMS, 'item_id', item.item_id);
      if (approve && String(item.fulfil_mode) === 'LOCAL') {
        var txt = lineLocalBuyText_(req, merged);
        logNotify_('LINE', req.requester_name, req.req_id, 'อนุมัติให้ซื้อเอง ' + item.item_id, txt, techLink_(req.token), 'PENDING', 'รอจัดซื้อคัดลอกส่ง LINE');
      } else {
        notifyTechnician_(req, (approve ? 'จัดซื้ออนุมัติแล้ว — ' : 'จัดซื้อไม่อนุมัติ — ') + item.tool_name,
          (approve ? 'จัดซื้ออนุมัติและกำลังดำเนินการสั่งซื้อ' : 'ไม่อนุมัติ เหตุผล: ' + (note || '-')) +
          (patch.po_ref ? ('\nเลขที่อ้างอิง: ' + patch.po_ref) : ''));
      }
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** เปลี่ยนสถานะการซื้อ เช่น สั่งซื้อแล้ว / รับของแล้ว / ปิดงาน / ยกเลิก */
function apiSetPurchaseStatus(staffToken, itemId, status, note, poRef) {
  var staff = requireStaff_(staffToken);
  var allowed = [P.ORDERED, P.RECEIVED, P.CLOSED, P.CANCELLED];
  if (allowed.indexOf(status) < 0) throw new Error('สถานะไม่ถูกต้อง / Invalid status');
  var item = findOne_(SHEET.ITEMS, 'item_id', String(itemId));
  if (!item) throw new Error('ไม่พบรายการนี้');
  if (status === P.ORDERED && String(item.purchase_status) !== P.APPROVED) {
    throw new Error('ต้องอนุมัติก่อนจึงจะบันทึกว่าสั่งซื้อแล้วได้');
  }
  var patch = { purchase_status: status };
  if (str_(poRef)) patch.po_ref = str_(poRef, 60);
  touchItem_(item, patch);
  logHistory_(item.req_id, item.item_id, item.chosen_option_id || '', staff, 'PURCHASING', 'STATUS_' + status, str_(note, 400));

  var req = findOne_(SHEET.REQUESTS, 'req_id', item.req_id);
  if (req && (status === P.ORDERED || status === P.RECEIVED)) {
    notifyTechnician_(req, (status === P.ORDERED ? 'สั่งซื้อแล้ว — ' : 'ของถึงแล้ว — ') + item.tool_name,
      (status === P.ORDERED ? 'จัดซื้อสั่งซื้อเรียบร้อย' : 'ของมาถึงแล้ว ติดต่อรับที่ฝ่ายจัดซื้อ') +
      (item.po_ref ? ('\nอ้างอิง: ' + item.po_ref) : ''));
  }
  return { ok: true };
}

/** ข้อความจากจัดซื้อถึงช่าง เช่น "แนะนำให้ซื้อเองที่ร้าน ถูกกว่า/ได้เร็วกว่า" */
function apiSetPurNote(staffToken, itemId, note) {
  var staff = requireStaff_(staffToken);
  var item = findOne_(SHEET.ITEMS, 'item_id', String(itemId));
  if (!item) throw new Error('ไม่พบรายการนี้');
  touchItem_(item, { pur_note: str_(note, 500) });
  logHistory_(item.req_id, item.item_id, '', staff, 'PURCHASING', 'NOTE_TO_TECH', str_(note, 500));
  var req = findOne_(SHEET.REQUESTS, 'req_id', item.req_id);
  if (req && str_(note)) notifyTechnician_(req, 'ข้อความจากจัดซื้อ — ' + item.tool_name, note);
  return { ok: true };
}

/** ข้อความ LINE พร้อมคัดลอกส่งช่าง */
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
  var rows = readAll_(SHEET.NOTIFY);
  var n = 0;
  rows.forEach(function (r) {
    if (r.channel === 'LINE' && r.status === 'PENDING' && String(r.ref) === String(reqId)) {
      updateRow_(SHEET.NOTIFY, r._row, { status: 'SENT', error: 'ส่งด้วยมือโดย ' + staff });
      n++;
    }
  });
  logHistory_(reqId, '', '', staff, 'PURCHASING', 'LINE_SENT', 'ส่งข้อความ LINE ให้ช่างแล้ว (' + n + ' ข้อความ)');
  return { ok: true, marked: n };
}

function apiItemHistory(staffToken, itemId) {
  requireStaff_(staffToken);
  return readAll_(SHEET.HISTORY)
    .filter(function (h) { return String(h.item_id) === String(itemId); })
    .map(function (h) { return { ts: h.ts, actor: h.actor, role: h.role, action: h.action, detail: h.detail }; });
}
