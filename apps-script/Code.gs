/**
 * Meiwa Tool Request — Code.gs
 * จุดเข้าเว็บแอป (routing)
 *
 *   ?              -> ฟอร์มขอซื้อ (ช่าง)
 *   ?p=r&t=TOKEN   -> หน้าติดตาม/ยืนยันของช่าง
 *   ?p=find        -> ค้นหาคำขอของฉัน (กรณีลิงก์หายใน LINE)
 *   ?p=dash        -> หน้าจัดซื้อ (ใส่ PIN)
 *   ?p=mgr         -> หน้าผู้บริหารอนุมัติ (ใส่ PIN คนละตัว)
 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var page = String(p.p || 'new').toLowerCase();
  try {
    if (page === 'r') {
      var token = String(p.t || '');
      if (!token) return render_('Page_Error', 'ลิงก์ไม่ถูกต้อง', { message: 'ลิงก์ไม่ถูกต้อง — ไม่มีรหัสคำขอ' });
      var req = findOne_(SHEET.REQUESTS, 'token', token);
      if (!req) return render_('Page_Error', 'ไม่พบคำขอ', { message: 'ไม่พบคำขอนี้ ลิงก์อาจหมดอายุหรือพิมพ์ผิด' });
      return render_('Page_Tech', 'ติดตามคำขอ ' + req.req_id, { token: token });
    }
    if (page === 'dash') return render_('Page_Dash', 'จัดซื้อ — Tool Request', {});
    if (page === 'mgr') return render_('Page_Mgr', 'อนุมัติสั่งซื้อ — Tool Request', {});
    if (page === 'find') return render_('Page_Find', 'ค้นหาคำขอของฉัน', {});
    return render_('Page_New', 'ขอซื้อเครื่องมือ — Meiwa', { config: publicCfg_(), technicians: activeTechs_() });
  } catch (err) {
    return render_('Page_Error', 'เกิดข้อผิดพลาด', { message: String(err && err.message ? err.message : err) });
  }
}

function render_(file, title, data) {
  var t = HtmlService.createTemplateFromFile(file);
  t.DATA = data || {};
  return t.evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function include(file) {
  return HtmlService.createHtmlOutputFromFile(file).getContent();
}

/** ใช้ในเทมเพลตเพื่อฝังข้อมูลเริ่มต้นอย่างปลอดภัย */
function jsonFor_(obj) {
  return JSON.stringify(obj === undefined ? null : obj)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
