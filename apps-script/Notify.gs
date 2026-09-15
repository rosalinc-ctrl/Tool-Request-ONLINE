/**
 * Meiwa Tool Request — Notify.gs
 * อีเมลถึงจัดซื้อ/ผู้บริหาร และเตรียมข้อความ LINE ให้ช่าง (ช่างไม่มีอีเมล)
 */

function logNotify_(channel, to, ref, subject, message, link, status, error) {
  appendRow_(SHEET.NOTIFY, {
    ts: now_(), channel: channel, to: str_(to, 200), ref: ref || '',
    subject: str_(subject, 200), message: str_(message, 2000), link: link || '',
    status: status, error: str_(error, 300)
  });
}

function mgrUrl_() { return webappUrl_() ? (webappUrl_() + '?p=mgr') : ''; }
function dashUrl_() { return webappUrl_() ? (webappUrl_() + '?p=dash') : ''; }

function sendMail_(cfgKey, subject, message, link, ref, label) {
  var raw = String(cfg_(cfgKey, ''));
  var emails = raw.split(/[,;\s]+/).filter(function (e) { return e.indexOf('@') > 0; });
  var body = message + (link ? ('\n\nเปิดรายการ: ' + link) : '');
  var status = 'SENT', err = '';
  if (!emails.length) {
    status = 'PENDING';
    err = 'ยังไม่ได้ตั้งค่า ' + cfgKey + ' ในชีต Config';
  } else {
    try {
      MailApp.sendEmail(emails.join(','), '[Tool Request] ' + subject, body);
    } catch (e) {
      status = 'FAILED'; err = String(e);
    }
  }
  logNotify_(label, emails.join(','), ref || '', subject, body, link || '', status, err);
}

function notifyPurchasing_(subject, message, link, ref) {
  sendMail_('PURCHASING_EMAILS', subject, message, link || dashUrl_(), ref, 'EMAIL');
}

function notifyManagement_(subject, message, link, ref) {
  sendMail_('MANAGEMENT_EMAILS', subject, message, link || mgrUrl_(), ref, 'EMAIL_MGR');
}

/**
 * ช่างไม่มีอีเมล -> สร้างข้อความพร้อมส่ง LINE เก็บไว้ในชีต Notifications
 * ถ้าตั้งค่า LINE_CHANNEL_TOKEN และช่างมี line_id จะพยายามส่งอัตโนมัติ
 */
function notifyTechnician_(req, subject, message) {
  var link = techLink_(req.token);
  var text = '📌 ' + subject + '\n' + message + '\n\n👉 ' + link;
  var status = 'PENDING';
  var err = 'รอฝ่ายจัดซื้อกดคัดลอกแล้วส่งทาง LINE';

  var token = String(cfg_('LINE_CHANNEL_TOKEN', ''));
  var lineId = '';
  if (token) {
    var tech = findTech_(req.emp_code) || findTech_(req.requester_name);
    lineId = tech ? tech.line_id : '';
    if (lineId) {
      try {
        var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
          method: 'post',
          contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + token },
          payload: JSON.stringify({ to: lineId, messages: [{ type: 'text', text: text }] }),
          muteHttpExceptions: true
        });
        if (res.getResponseCode() === 200) { status = 'SENT'; err = ''; }
        else { status = 'FAILED'; err = res.getResponseCode() + ' ' + res.getContentText(); }
      } catch (e) {
        status = 'FAILED'; err = String(e);
      }
    }
  }
  logNotify_('LINE', req.requester_name + (lineId ? (' (' + lineId + ')') : ''), req.req_id, subject, text, link, status, err);
  return text;
}

/* ---------------------------- ตัวสร้างข้อความ ---------------------------- */

function newRequestText_(reqId, code, name, payload, items) {
  return [
    'มีใบขอซื้อเครื่องมือใหม่',
    'เลขที่: ' + reqId,
    'ผู้ขอ: ' + name + ' (รหัส ' + code + ')' + (payload.site ? (' — ' + payload.site) : ''),
    'ติดต่อ: ' + (payload.contact || '-'),
    'ต้องการใช้วันที่: ' + (payload.required_date || '-'),
    'จำนวน: ' + items.length + ' รายการ',
    '',
    items.map(function (it, i) {
      return (i + 1) + '. ' + it.tool_name + ' x' + (num_(it.qty) || 1) + ' ' + (it.unit || 'ชิ้น') +
        (it.required_date ? ('\n   ต้องการใช้: ' + it.required_date) : '') +
        (it.spec_pref ? ('\n   สเปคที่ขอ: ' + it.spec_pref) : '') +
        (it.brand_pref ? ('\n   ยี่ห้อ/รุ่นที่อยากได้: ' + it.brand_pref) : '') +
        (num_(it.bench_price) ? ('\n   ราคาที่ช่างไปดูมา: ' + fmtBaht_(it.bench_price) + ' (' + (it.bench_store || '-') + ')') : '');
    }).join('\n'),
    '',
    'ขั้นตอนถัดไป: ร่างสเปคอ้างอิง 1 ชิ้นให้ช่างตรวจก่อน แล้วค่อยเทียบราคา ' + minQuotes_() + ' เจ้า'
  ].join('\n');
}

/** อีเมลถึงผู้บริหาร — สรุปตารางเทียบราคาให้อ่านจบในอีเมลเดียว ไม่ต้องปริ้นท์ */
function approvalRequestText_(item, options, rec) {
  var lines = [];
  lines.push('รายการรออนุมัติ: ' + item.tool_name + ' x' + item.qty + ' ' + item.unit);
  lines.push('เลขที่: ' + item.item_id + ' | ผู้ขอ: ' + (item.requester_name || '-') +
    (item.emp_code ? (' (' + item.emp_code + ')') : ''));
  lines.push('ช่างยืนยันสเปคแล้ว: ' + specTitle_(item) + ' โดย ' + (item.tech_by || '-') + ' ' + (item.tech_at || '-'));
  lines.push('');
  lines.push('เทียบราคา ' + options.length + ' เจ้า:');
  options.forEach(function (o, i) {
    lines.push('  ' + (i + 1) + ') ' + (o.supplier || '-') + ' — ' + brandModel_(o) +
      (String(o.source) === SRC.TECH ? ' [ราคาที่ช่างไปดูมาเอง]' : '') +
      '\n     รวม ' + fmtBaht_(o.total_cost) + ' | ได้ของ ' + (o.delivery_date || o.availability || '-') +
      ' | ' + (o.payment_terms || '-') +
      (String(o.option_id) === String(item.recommend_option_id) ? '\n     ★ จัดซื้อแนะนำเจ้านี้' : ''));
  });
  if (item.recommend_reason) {
    lines.push('');
    lines.push('เหตุผลที่จัดซื้อแนะนำ: ' + item.recommend_reason);
  }
  lines.push('');
  lines.push('กรุณาเปิดหน้าอนุมัติเพื่อกดอนุมัติ (อนุมัติรายรายการ หรือทั้งใบก็ได้)');
  return lines.join('\n');
}

/** ข้อความ LINE สรุปทั้งใบ ให้จัดซื้อคัดลอกส่งช่าง — ไม่มีราคาผู้ขาย */
function lineSummaryText_(req, items) {
  var lines = [];
  lines.push('🔧 ใบขอซื้อเครื่องมือ ' + req.req_id + ' (' + req.requester_name + ' / ' + req.emp_code + ')');
  items.forEach(function (it) {
    lines.push('• ' + it.seq + '. ' + it.tool_name + ' x' + it.qty + ' — ' + STAGE_LABEL[stageOf_(it)]);
  });
  lines.push('');
  lines.push('👉 กดลิงก์เพื่อตรวจสเปคและติดตามสถานะจากมือถือ:');
  lines.push(techLink_(req.token));
  return lines.join('\n');
}

/** ข้อความแจ้งช่างเมื่อผู้บริหารอนุมัติให้ซื้อเองที่ร้าน (แนบข้อมูลใบกำกับภาษี) */
function lineLocalBuyText_(req, item, opt) {
  var c = publicCfg_().company;
  var budget = opt ? num_(opt.total_cost) : num_(item.bench_price) * num_(item.qty);
  return [
    '✅ ผู้บริหารอนุมัติให้ซื้อเองที่ร้านแล้ว — ' + item.item_id,
    'รายการ: ' + item.tool_name + ' x' + item.qty + ' ' + item.unit,
    'วงเงินที่อนุมัติ: ' + fmtBaht_(budget) + ' (ร้าน ' + (opt ? opt.supplier : item.bench_store) + ')',
    'ผู้อนุมัติ: ' + (item.mgr_by || '-') + ' ' + (item.mgr_at || ''),
    (item.po_ref ? ('เลขที่อ้างอิงเบิก: ' + item.po_ref) : ''),
    '',
    '🧾 ขอใบกำกับภาษี/ใบเสร็จในนาม:',
    c.name,
    'เลขผู้เสียภาษี: ' + c.taxId,
    'สาขา: ' + c.branch,
    'ที่อยู่: ' + c.address,
    '',
    '📷 ซื้อแล้วถ่ายรูปใบเสร็จอัปโหลดในลิงก์นี้ด้วยครับ:',
    techLink_(req.token)
  ].filter(String).join('\n');
}

function fmtBaht_(v) {
  var n = num_(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' บาท';
}

/** สรุปงานค้างรายวัน — แยกส่งจัดซื้อ และผู้บริหาร */
function dailyDigest() {
  var items = officeItems_();
  var buckets = {};
  items.forEach(function (it) {
    if (['DONE', 'CANCELLED', 'MGR_REJECTED'].indexOf(it.stage) >= 0) return;
    (buckets[it.stage] = buckets[it.stage] || []).push(it);
  });

  var order = ['NEED_SPEC', 'SPEC_CHANGE', 'TECH_SPEC', 'QUOTING', 'APPROVAL', 'TO_PO', 'ORDERED', 'LOCAL_BUY'];
  var lines = ['สรุปงานค้าง ระบบขอซื้อเครื่องมือ — ' + today_(), ''];
  var total = 0;
  order.forEach(function (st) {
    var list = buckets[st] || [];
    if (!list.length) return;
    total += list.length;
    lines.push('■ ' + STAGE_LABEL[st] + ' (' + list.length + ')');
    list.slice(0, 20).forEach(function (it) {
      lines.push('   - ' + it.item_id + ' ' + it.tool_name + ' x' + it.qty +
        ' | ช่าง: ' + (it.requester_name || '-') + ' | ต้องการใช้: ' + (it.required_date || '-'));
    });
    lines.push('');
  });
  if (total) notifyPurchasing_('สรุปงานค้าง ' + total + ' รายการ', lines.join('\n'), dashUrl_(), '');

  var waiting = buckets['APPROVAL'] || [];
  if (waiting.length) {
    var m = ['มีรายการรออนุมัติ ' + waiting.length + ' รายการ — ' + today_(), ''];
    waiting.forEach(function (it) {
      var rec = it.options.filter(function (o) { return String(o.option_id) === String(it.recommend_option_id); })[0];
      m.push('• ' + it.item_id + ' ' + it.tool_name + ' x' + it.qty +
        ' | ผู้ขอ ' + (it.requester_name || '-') +
        ' | จัดซื้อแนะนำ ' + brandModel_(rec) + ' รวม ' + fmtBaht_(rec ? rec.total_cost : 0) +
        ' (เทียบ ' + it.options.length + ' เจ้า)');
    });
    notifyManagement_('รออนุมัติ ' + waiting.length + ' รายการ', m.join('\n'), mgrUrl_(), '');
  }
}
