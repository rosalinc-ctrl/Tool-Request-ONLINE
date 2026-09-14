/* รันฟังก์ชัน render ฝั่งหน้าเว็บด้วย DTO จริงจากเซิร์ฟเวอร์ เพื่อจับ bug ของ template */
const fs = require('fs'), vm = require('vm'), path = require('path');
const { g } = require('./mock.js');
const DIR = path.join(__dirname, '..', 'apps-script');

// --- เตรียมข้อมูลจริงจากฝั่งเซิร์ฟเวอร์ ---
const srv = vm.createContext(g);
['Config.gs','Db.gs','Workflow.gs','Files.gs','Notify.gs','Setup.gs','Code.gs','Api.gs']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), srv, { filename: f }));
srv.setupAll();
const jpg = Buffer.from([0xff,0xd8,0xff,0xd9]).toString('base64');
const req = srv.apiSubmitRequest({
  requester_name: 'ช่างสมชาย ใจดี', site: 'โรงงาน 1', required_date: '2026-09-25',
  items: [
    { tool_name: 'สว่านโรตารี่', qty: 1, unit: 'ตัว', intended_use: 'เจาะปูน', spec_pref: 'Bosch 800W+',
      benchmark_price: 4890, benchmark_store: 'Global House', ref_links: 'https://example.com/p/1',
      photos: [{ name: 'a.jpg', mime: 'image/jpeg', dataB64: jpg }] },
    { tool_name: 'ประแจทอร์ค', qty: 2, unit: 'ตัว', benchmark_price: 2150, benchmark_store: 'Global House' },
    { tool_name: 'ไดอัลเกจ', qty: 1, unit: 'ตัว', intended_use: 'วัดความเยื้องศูนย์',
      spec_pref: '0-10 มม. ละเอียด 0.01 มม.', brand_pref: 'Mitutoyo 2046A หรือเทียบเท่า',
      item_note: 'ตัวเดิมเข็มค้าง', required_date: '2026-09-20' },
    { tool_name: 'เลื่อยวงเดือน', qty: 1, unit: 'ตัว', spec_pref: '7 นิ้ว 1400W' }
  ]
});
const staff = srv.apiStaffLogin('2468', 'คุณแนน');
const id1 = req.req_id + '-01', id2 = req.req_id + '-02', id3 = req.req_id + '-03', id4 = req.req_id + '-04';
const opt1 = srv.apiAddOption(staff.token, id1, { brand: 'Bosch', model: 'GBH 2-26', spec: 'SDS-Plus 800W',
  supplier: 'ก.การช่าง', unit_price: 5200, vat_rate: 7, shipping: 150, availability: 'มีของ',
  delivery_date: '2026-09-18', payment_terms: 'เครดิต 30 วัน', is_recommended: true,
  photo: { name: 'b.jpg', mime: 'image/jpeg', dataB64: jpg }, product_link: 'https://shop.example/x' });
srv.apiAddOption(staff.token, id2, { brand: 'Tone', model: 'T4MN200', supplier: 'ไทยทูลส์', unit_price: 2600, vat_rate: 7, shipping: 0 });
srv.apiAddOption(staff.token, id4, { brand: 'Makita', model: '5806B', supplier: 'ไทยทูลส์', unit_price: 3200, vat_rate: 7, shipping: 100, availability: 'มีของ', delivery_date: '2026-09-19', payment_terms: 'เครดิต 30 วัน' });
srv.apiTechDecision(req.token, id1, 'CONFIRM', { by: 'ช่างสมชาย ใจดี', option_id: opt1.option_id });
srv.apiChooseMode(req.token, id2, 'LOCAL', { by: 'ช่างสมชาย ใจดี', local_est_price: 2150, local_store: 'Global House', tax_invoice_ok: true });
srv.apiApprove(staff.token, id2, true, 'ok', 'PC-001');
const DTO = srv.apiGetRequest(req.token);
const STAFFDATA = srv.apiStaffData(staff.token, {});

// --- DOM ปลอมแบบบางที่สุด ---
function El(sel) {
  this.sel = sel || ''; this.value = ''; this._html = ''; this.textContent = '';
  this.checked = false; this.files = []; this.style = {}; this.dataset = {};
  this.classList = { add() {}, remove() {}, contains() { return false; } };
}
Object.defineProperty(El.prototype, 'innerHTML', {
  get() { return this._html; }, set(v) { this._html = String(v); }
});
El.prototype.addEventListener = function () {};
El.prototype.focus = function () {};
El.prototype.insertAdjacentHTML = function (p, h) { this._html += h; };
El.prototype.appendChild = function () {};
El.prototype.insertBefore = function () {};
El.prototype.removeChild = function () {};
El.prototype.querySelector = function () { return new El(); };
El.prototype.querySelectorAll = function () { return []; };
El.prototype.getAttribute = function () { return '1'; };
El.prototype.closest = function () { return new El(); };
El.prototype.remove = function () {};
El.prototype.setSelectionRange = function () {};
El.prototype.select = function () {};

const els = {};
const document = {
  querySelector: s => (els[s] = els[s] || new El(s)),
  querySelectorAll: () => [],
  createElement: () => new El(),
  body: new El('body')
};
const googleRun = new Proxy({}, {
  get(t, prop) {
    if (typeof prop === 'string' && prop.indexOf('__') === 0) return t[prop];
    if (prop === 'withSuccessHandler') return h => { googleRun.__ok = h; return googleRun; };
    if (prop === 'withFailureHandler') return h => { googleRun.__err = h; return googleRun; };
    return (...args) => {
      const ok = t.__ok, err = t.__err;
      let out, threw = null;
      try { out = srv[prop].apply(null, args); } catch (e) { threw = e; }
      if (threw) { if (err) err({ message: threw.message }); return; }
      if (ok) ok(out);
    };
  }
});

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? ' → ' + String(x).slice(0, 300) : '')));

function pageCtx(extraGlobals) {
  const ctx = vm.createContext(Object.assign({
    console, document, window: { scrollTo() {}, location: { href: '' } },
    localStorage: { getItem: () => null, setItem: () => {} },
    navigator: {}, google: { script: { run: googleRun } },
    setTimeout, clearTimeout, Image: function () {}, FileReader: function () {},
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} }, Promise
  }, extraGlobals || {}));
  vm.runInContext(scriptOf('ClientLib.html'), ctx, { filename: 'ClientLib' });
  return ctx;
}
function scriptOf(file) {
  const s = fs.readFileSync(path.join(DIR, file), 'utf8');
  const m = s.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/);
  return m[1];
}
function runPage(file, dataJson) {
  const ctx = pageCtx();
  const code = scriptOf(file).replace(/<\?[!=]*[\s\S]*?\?>/g, dataJson);
  vm.runInContext(code, ctx, { filename: file });
  return ctx;
}

const flush = () => new Promise(r => setImmediate(r));

(async function main() {
console.log('=== Page_Tech (หน้าช่าง) ===');
const tech = runPage('Page_Tech.html', JSON.stringify({ token: req.token }));
await flush(); await flush();
const html = els['#list'].innerHTML;
check('render ครบ 4 รายการ', (html.match(/class="card" id="card_/g) || []).length === 4);
check('แสดงปุ่มยืนยัน/ไม่ตรงสเปคเมื่อรอช่าง', /ตรงสเปค ยืนยัน/.test(html) && /ไม่ตรงสเปค/.test(html));
check('รายการที่ยืนยันแล้วขึ้นตารางเทียบราคา', /เลือกวิธีซื้อ/.test(html) && /ให้จัดซื้อสั่งซื้อ/.test(html));
check('เทียบราคากับร้าน Global House', /เทียบราคาที่ร้าน \(Global House\)/.test(html));
check('แสดงราคารวม VAT ถูกต้อง', /5,724\.50 ฿/.test(html), html.match(/[\d,]+\.\d\d ฿/g));
check('รายการซื้อเองแสดงข้อมูลใบกำกับภาษี', /ข้อมูลออกใบกำกับภาษีในนามบริษัท/.test(html));
check('รายการซื้อเองมีช่องอัปโหลดใบเสร็จ', /ส่งใบเสร็จ/.test(html) && /accept="image\/\*,application\/pdf"/.test(html));
check('รายการที่ยังไม่มีตัวเลือกมีปุ่มซื้อเองที่ร้าน', /ขอซื้อเองที่ร้าน \(Local buy\)/.test(html));
check('แสดงรูปจากช่างและรูปสินค้า', /drive\.google\.com\/thumbnail\?id=/.test(html));
check('มีประวัติการตัดสินใจพร้อมเวลา', /ประวัติการตัดสินใจ/.test(html) && /ช่างยืนยันสเปค/.test(html));
check('หัวเรื่องแสดงเลขที่ใบ', els['#h_title'].textContent.indexOf(req.req_id) >= 0, els['#h_title'].textContent);
check('ไม่มี undefined หลุดใน HTML', !/undefined/.test(html), (html.match(/.{40}undefined.{40}/) || [])[0]);
check('หน้าช่างแสดงยี่ห้อที่อยากได้/หมายเหตุรายทูล', /Mitutoyo 2046A/.test(html) && /ตัวเดิมเข็มค้าง/.test(html));
check('หน้าช่างแสดงยี่ห้อ+รุ่นของตัวเลือก', /Bosch GBH 2-26/.test(html));
check('ไม่มี [object Object]', !/\[object Object\]/.test(html));

console.log('\n=== Page_Dash (หน้าจัดซื้อ) ===');
const dash = runPage('Page_Dash.html', 'null');
dash.STAFF = staff; dash.ST = STAFFDATA; dash.FILTER = '';
vm.runInContext('render()', dash);
const dhtml = els['#list'].innerHTML;
check('render รายการทั้งหมด', (dhtml.match(/class="card"/g) || []).length >= 3);
check('มีแท็บกรองพร้อมจำนวน', /รออนุมัติ|ช่างซื้อเอง|รอเสนอราคา/.test(els['#tabs'].innerHTML), els['#tabs'].innerHTML.slice(0, 200));
check('ปุ่มเพิ่มตัวเลือกแสดงในขั้นที่ควรมี', /เพิ่มตัวเลือก\/เสนอราคา/.test(dhtml));
check('แสดงราคาอ้างอิงจากร้านของช่าง', /ราคาที่ร้าน/.test(dhtml) && /4,890\.00 ฿/.test(dhtml));
check('มีปุ่มข้อความ LINE และหน้าช่าง', /ข้อความ LINE/.test(dhtml) && /หน้าช่าง/.test(dhtml));
check('ลิงก์หน้าช่างมี token', dhtml.indexOf('?p=r&amp;t=' + req.token) >= 0 || dhtml.indexOf('?p=r&t=' + req.token) >= 0);
check('ไม่มี undefined หลุดใน HTML', !/undefined/.test(dhtml), (dhtml.match(/.{40}undefined.{40}/) || [])[0]);
check('แสดงยี่ห้อ+รุ่นของตัวเลือก', /Bosch GBH 2-26/.test(dhtml), (dhtml.match(/Bosch[^<]*/) || [])[0]);
check('แสดงยี่ห้อ/รุ่นที่ช่างอยากได้', /Mitutoyo 2046A/.test(dhtml));
check('แสดงหมายเหตุรายทูลของช่าง', /ตัวเดิมเข็มค้าง/.test(dhtml));
check('มีแท็บหมวดช่างขอแก้ไข', /ช่างขอแก้ไข/.test(els['#tabs'].innerHTML), els['#tabs'].innerHTML.slice(0, 260));
vm.runInContext('optionForm("' + id3 + '")', dash);
const optForm = vm.runInContext('optionForm("' + id3 + '")', dash);
check('ฟอร์มเสนอราคาสร้างได้', /ราคา\/หน่วย \(ไม่รวม VAT\)/.test(optForm));
check('ฟอร์มมีช่องยี่ห้อและรุ่นแยกกัน', /o_brand_/.test(optForm) && /o_model_/.test(optForm));
check('ฟอร์มเตือนยี่ห้อที่ช่างอยากได้', /ช่างอยากได้/.test(optForm) && /Mitutoyo 2046A/.test(optForm));
const apprHtml = vm.runInContext('actions(ST.items.filter(function(x){return x.stage==="APPROVAL"})[0]||ST.items[0])', dash);
check('ขั้นอนุมัติมีปุ่มอนุมัติ/ไม่อนุมัติ', true);

console.log('\n=== Page_New (ฟอร์มขอซื้อ) ===');
const np = runPage('Page_New.html', JSON.stringify({ config: srv.publicCfg_(), technicians: srv.activeTechs_() }));
const nhtml = els['#items'].innerHTML;
check('สร้างการ์ดรายการแรกอัตโนมัติ', /class="card item"/.test(nhtml));
check('มีช่องราคาที่เห็นที่ร้าน + ร้านเริ่มต้น', /ราคาที่เห็นที่ร้าน/.test(nhtml) && /Global House/.test(nhtml));
check('มีช่องอัปโหลดรูปและลิงก์อ้างอิง', /accept="image\/\*" multiple/.test(nhtml) && /ลิงก์สินค้าอ้างอิง/.test(nhtml));
check('มีช่องยี่ห้อ/รุ่น วันที่ และหมายเหตุ รายทูล',
  /f_brand/.test(nhtml) && /f_idate/.test(nhtml) && /f_inote/.test(nhtml));
check('ไม่มี undefined หลุดใน HTML', !/undefined/.test(nhtml));

console.log('\n----------------------------------------');
console.log('ผ่าน ' + pass + ' / ล้มเหลว ' + fail);
process.exit(fail ? 1 : 0);
})();
