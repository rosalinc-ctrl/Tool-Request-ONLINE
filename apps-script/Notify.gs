/**
 * Meiwa Tool Request — Notify.gs
 * แจ้งเตือนจัดซื้อทางอีเมล และเตรียมข้อความ LINE ให้ช่าง (ช่างไม่มีอีเมล)
 */

function logNotify_(channel, to, ref, subject, message, link, status, error) {
  appendRow_(SHEET.NOTIFY, {
    ts: now_(), channel: channel, to: str_(to, 200), ref: ref || '',
    subject: str_(subject, 200), message: str_(message, 2000), link: link || '',
    status: status, error: str_(error, 300)
  });
}

/** แจ้งทีมจัดซื้อทางอีเมล */
function notifyPurchasing_(subject, message, link, ref) {
  var raw = String(cfg_('PURCHASING_EMAILS', ''));
  var emails = raw.split(/[,;\s]+/).filter(function (e) { return e.indexOf('@') > 0; });
  var body = message + (link ? ('\n\nเปิดรายการ: ' + link) : '') +
    (webappUrl_() ? ('\nหน้าจัดซื้อ: ' + webappUrl_() + '?p=dash') : '');
  var status = 'SENT', err = '';
  if (!emails.length) {
    status = 'PENDING';
    err = 'ยังไม่ได้ตั้งค่า PURCHASING_EMAILS ในชีต Config';
  } else {
    try {
      MailApp.sendEmail(emails.join(','), '[Tool Request] ' + subject, body);
    } catch (e) {
      status = 'FAILED'; err = String(e);
    }
  }
  logNotify_('EMAIL', emails.join(','), ref || '', subject, body, link || '', status, err);
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
    var tech = activeTechs_().filter(function (t) { return t.name === String(req.requester_name).trim(); })[0];
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

/** ข้อความ LINE สรุปทั้งใบ ให้จัดซื้อคัดลอกส่งช่าง */
function lineSummaryText_(req, items) {
  var lines = [];
  lines.push('🔧 ใบขอซื้อเครื่องมือ ' + req.req_id + ' (' + req.requester_name + ')');
  items.forEach(function (it) {
    var st = stageOf_(it);
    lines.push('• ' + it.seq + '. ' + it.tool_name + ' x' + it.qty + ' — ' + STAGE_LABEL[st]);
  });
  lines.push('');
  lines.push('👉 กดลิงก์เพื่อดูรูป/ราคา และกดยืนยันได้จากมือถือ:');
  lines.push(techLink_(req.token));
  return lines.join('\n');
}

/** ข้อความแจ้งช่างเมื่ออนุมัติให้ซื้อเองที่ร้าน (แนบข้อมูลใบกำกับภาษีบริษัท) */
function lineLocalBuyText_(req, item) {
  var c = publicCfg_().company;
  return [
    '✅ อนุมัติให้ซื้อเองที่ร้านแล้ว — ' + item.item_id,
    'รายการ: ' + item.tool_name + ' x' + item.qty + ' ' + item.unit,
    'ราคาประเมิน: ' + fmtBaht_(item.local_est_price) + ' (ร้าน ' + (item.local_store || '-') + ')',
    'เลขที่อ้างอิง PO/เบิก: ' + (item.po_ref || '-'),
    '',
    '🧾 ขอใบกำกับภาษี/ใบเสร็จในนาม:',
    c.name,
    'เลขผู้เสียภาษี: ' + c.taxId,
    'สาขา: ' + c.branch,
    'ที่อยู่: ' + c.address,
    '',
    '📷 ซื้อแล้วถ่ายรูปใบเสร็จอัปโหลดในลิงก์นี้ด้วยครับ:',
    techLink_(req.token)
  ].join('\n');
}

function fmtBaht_(v) {
  var n = num_(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' บาท';
}

/** สรุปงานค้างรายวัน ส่งอีเมลทีมจัดซื้อ (ติดตั้งทริกเกอร์จากเมนู) */
function dailyDigest() {
  var items = readAll_(SHEET.ITEMS);
  var reqs = {};
  readAll_(SHEET.REQUESTS).forEach(function (r) { reqs[r.req_id] = r; });

  var buckets = {};
  items.forEach(function (it) {
    var st = stageOf_(it);
    if (st === 'DONE' || st === 'CANCELLED' || st === 'PUR_REJECTED') return;
    (buckets[st] = buckets[st] || []).push(it);
  });

  var order = ['NEED_OPTION', 'TECH_SPEC', 'TECH_MODE', 'APPROVAL', 'TO_ORDER', 'ORDERED', 'LOCAL_BUY'];
  var lines = ['สรุปงานค้าง ระบบขอซื้อเครื่องมือ — ' + today_(), ''];
  var total = 0;
  order.forEach(function (st) {
    var list = buckets[st] || [];
    if (!list.length) return;
    total += list.length;
    lines.push('■ ' + STAGE_LABEL[st] + ' (' + list.length + ')');
    list.slice(0, 20).forEach(function (it) {
      var r = reqs[it.req_id] || {};
      lines.push('   - ' + it.item_id + ' ' + it.tool_name + ' x' + it.qty +
        ' | ช่าง: ' + (r.requester_name || '-') + ' | ต้องการใช้: ' + (r.required_date || '-'));
    });
    lines.push('');
  });
  if (!total) return;
  notifyPurchasing_('สรุปงานค้าง ' + total + ' รายการ', lines.join('\n'), webappUrl_() ? (webappUrl_() + '?p=dash') : '', '');
}
