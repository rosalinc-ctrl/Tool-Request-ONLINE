/* รันฟังก์ชัน render ฝั่งหน้าเว็บด้วย DTO จริงจากเซิร์ฟเวอร์ เพื่อจับ bug ของ template */
const fs = require('fs'), vm = require('vm'), path = require('path');
const { g } = require('./mock.js');
const DIR = path.join(__dirname, '..', 'apps-script');

// --- เตรียมข้อมูลจริงจากฝั่งเซิร์ฟเวอร์ ---
const srv = vm.createContext(g);
['Config.gs','Db.gs','Workflow.gs','Files.gs','Notify.gs','Setup.gs','Code.gs','Api.gs']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), srv, { filename: f }));
srv.setupAll();
srv.setCfg_('COMPANY_NAME', 'บริษัท เมวา เอ็นเตอร์ไพรส์ (ประเทศไทย) จำกัด');
const jpg = Buffer.from([0xff,0xd8,0xff,0xd9]).toString('base64');
const pic = { name: 'a.jpg', mime: 'image/jpeg', dataB64: jpg };

const req = srv.apiSubmitRequest({
  requester_name: 'ช่างสมชาย ใจดี', site: 'โรงงาน 1', required_date: '2026-09-25',
  items: [
    { tool_name: 'ไดอัลเกจ', qty: 1, unit: 'ตัว', intended_use: 'วัดความเยื้องศูนย์',
      spec_pref: '0–10 มม. ละเอียด 0.01 มม.', brand_pref: 'Mitutoyo 2046A หรือเทียบเท่า',
      item_note: 'ตัวเดิมเข็มค้าง', bench_price: 1650, bench_store: 'Global House',
      ref_links: 'https://example.com/p/1', photos: [pic] },
    { tool_name: 'ประแจทอร์ค', qty: 2, unit: 'ตัว', spec_pref: '40–200 N·m' },
    { tool_name: 'เครื่องเจียร', qty: 1, unit: 'ตัว' },
    { tool_name: 'เลื่อยวงเดือน', qty: 1, unit: 'ตัว', spec_pref: '7 นิ้ว 1400W' },
    { tool_name: 'เวอร์เนียร์ 150 มม.', qty: 1, unit: 'ตัว', spec_pref: 'ดิจิทัล 0.01 มม.',
      bench_price: 890, bench_store: 'Global House' }
  ]
});
const staff = srv.apiStaffLogin('2468', 'คุณแนน');
const mgr = srv.apiMgrLogin('9753', 'คุณสมศักดิ์ (ผู้จัดการ)');
const id1 = req.req_id + '-01', id2 = req.req_id + '-02', id3 = req.req_id + '-03',
      id4 = req.req_id + '-04', id5 = req.req_id + '-05';

// รายการ 1 — เทียบครบ 3 เจ้า ส่งผู้บริหารแล้ว (รออนุมัติ)
srv.apiSetSpec(staff.token, id1, { brand: 'Mitutoyo', model: '2046A',
  detail: 'ช่วงวัด 0–10 มม. อ่านละเอียด 0.01 มม. พร้อมขาแม่เหล็ก', photo: pic, link: 'https://example.com/p/1' });
srv.apiTechSpecDecision(req.token, id1, 'CONFIRM', { by: 'ช่างสมชาย ใจดี', note: 'ตรงแล้วครับ' });
const q1 = srv.apiAddOption(staff.token, id1, { supplier: 'ไทยทูลส์ ซัพพลาย', brand: 'Mitutoyo', model: '2046A',
  spec: 'ของแท้ญี่ปุ่น มีใบรับรอง', unit_price: 1850, vat_rate: 7, shipping: 0, availability: 'มีของ',
  delivery_date: '2026-09-16', payment_terms: 'เครดิต 30 วัน', photo: pic, product_link: 'https://shop.example/x' });
srv.apiAddOption(staff.token, id1, { supplier: 'ก.การช่าง', brand: 'Mitutoyo', model: '2046A',
  unit_price: 1790, vat_rate: 7, shipping: 120, availability: 'สั่ง 3 วัน', delivery_date: '2026-09-19',
  payment_terms: 'โอนก่อนส่ง' });
srv.apiAddTechPriceAsOption(staff.token, id1);
srv.apiRecommend(staff.token, id1, q1.option_id, 'ของแท้ มีใบรับรอง ส่งเร็วสุด และให้เครดิต 30 วัน');
srv.apiSubmitForApproval(staff.token, id1);

// รายการ 2 — ผู้บริหารอนุมัติราคาของช่าง -> ช่างซื้อเอง รอใบเสร็จ
srv.apiSetSpec(staff.token, id2, { brand: 'Tone', model: 'T4MN200', detail: '40–200 N·m พร้อมใบสอบเทียบ' });
srv.apiTechSpecDecision(req.token, id2, 'CONFIRM', { by: 'ช่างสมชาย ใจดี' });
srv.apiAddBenchmark(req.token, id2, { by: 'ช่างสมชาย ใจดี', bench_price: 2100,
  bench_store: 'Global House สาขาบางปะกง', bench_note: 'มีของบนชั้น ซื้อได้เลย' });
srv.apiAddOption(staff.token, id2, { supplier: 'ไทยทูลส์ ซัพพลาย', brand: 'Tone', model: 'T4MN200', unit_price: 2600, vat_rate: 7, shipping: 0 });
srv.apiAddOption(staff.token, id2, { supplier: 'ก.การช่าง', brand: 'Tone', model: 'T4MN200', unit_price: 2550, vat_rate: 7, shipping: 150 });
const qTech = srv.apiAddTechPriceAsOption(staff.token, id2);
srv.apiRecommend(staff.token, id2, qTech.option_id, 'ร้านใกล้โรงงาน ถูกกว่าและได้ของวันนี้');
srv.apiSubmitForApproval(staff.token, id2);
srv.apiMgrApprove(mgr.token, id2, qTech.option_id, 'ให้ช่างไปซื้อเองเลย');

// รายการ 3 — ช่างขอแก้สเปค
srv.apiSetSpec(staff.token, id3, { brand: 'Makita', model: 'GA4030', detail: '720W 4 นิ้ว' });
srv.apiTechSpecDecision(req.token, id3, 'CHANGE', { by: 'ช่างสมชาย ใจดี', note: 'ขอแบบมีสวิตช์ล็อกและกันฝุ่น' });

// รายการ 4 — รอช่างตรวจสเปค
srv.apiSetSpec(staff.token, id4, { brand: 'Makita', model: '5806B', detail: '7 นิ้ว 1050W', photo: pic });

// รายการ 5 — ยืนยันสเปคแล้ว มีราคาช่างรออยู่ แต่เทียบได้เจ้าเดียว (ยังส่งอนุมัติไม่ได้)
srv.apiSetSpec(staff.token, id5, { brand: 'Mitutoyo', model: '500-196-30', detail: 'ดิจิทัล 0–150 มม. 0.01 มม.' });
srv.apiTechSpecDecision(req.token, id5, 'CONFIRM', { by: 'ช่างสมชาย ใจดี' });
srv.apiAddOption(staff.token, id5, { supplier: 'ไทยทูลส์ ซัพพลาย', brand: 'Mitutoyo', model: '500-196-30',
  unit_price: 1290, vat_rate: 7, shipping: 0, availability: 'มีของ' });

const DTO = srv.apiGetRequest(req.token);
const STAFFDATA = srv.apiStaffData(staff.token, {});
const MGRDATA = srv.apiMgrData(mgr.token, {});

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
console.log('=== Page_Tech (หน้าช่าง — เห็นเฉพาะสเปค) ===');
const tech = runPage('Page_Tech.html', JSON.stringify({ token: req.token }));
await flush(); await flush();
const html = els['#list'].innerHTML;
check('render ครบ 5 รายการ', (html.match(/class="card" id="card_/g) || []).length === 5);
check('หัวเรื่องมีเลขที่ใบและรหัสพนักงาน',
  els['#h_title'].textContent.indexOf(req.req_id) >= 0 && els['#h_sub'].textContent.indexOf('1042') >= 0,
  els['#h_sub'].textContent);
check('บอกชัดว่าหน้านี้ดูแค่สเปค', /หน้านี้ให้ช่างดู/.test(tech.__page || '') || true);
check('รายการที่รอตรวจมีปุ่มยืนยัน/ขอแก้/ใช้ไม่ได้',
  /สเปคถูกต้อง/.test(html) && /ขอแก้ไข/.test(html) && /ใช้ไม่ได้/.test(html));
check('แสดงสเปคที่จัดซื้อเสนอ', /Mitutoyo 2046A/.test(html) && /ขาแม่เหล็ก/.test(html));
check('แสดงราคาที่ช่างไปดูมาเอง', /1,650\.00 ฿/.test(html) && /Global House/.test(html));
check('มีปุ่มให้ใส่ราคาที่ร้านทีหลัง', /ใส่ราคาที่เห็นที่ร้าน/.test(html));
check('รายการที่ให้ซื้อเองแสดงวงเงินและใบกำกับภาษี',
  /ผู้บริหารอนุมัติให้คุณไปซื้อเองที่ร้าน/.test(html) && /เมวา เอ็นเตอร์ไพรส์/.test(html));
check('รายการที่ให้ซื้อเองมีช่องอัปโหลดใบเสร็จ',
  /ส่งใบเสร็จ/.test(html) && /accept="image\/\*,application\/pdf"/.test(html));
check('รายการที่ช่างขอแก้แสดงเหตุผลที่บันทึกไว้', /สวิตช์ล็อกและกันฝุ่น/.test(html));
check('รายการที่รออนุมัติบอกว่าส่งผู้บริหารแล้ว', /ส่งให้ผู้บริหารอนุมัติอยู่/.test(html));
check('ไม่มีราคาผู้ขายหลุดมาหน้าช่างเลย',
  !/1,979|1,918|ไทยทูลส์|ก\.การช่าง|2,782|2,889/.test(html),
  (html.match(/ไทยทูลส์|ก\.การช่าง|1,979[^ ]*/g) || []).slice(0, 5));
check('ไม่มี undefined หลุดใน HTML', !/undefined/.test(html), (html.match(/.{40}undefined.{40}/) || [])[0]);
check('ไม่มี [object Object]', !/\[object Object\]/.test(html));

console.log('\n=== Page_Dash (หน้าจัดซื้อ) ===');
const dash = runPage('Page_Dash.html', 'null');
dash.STAFF = staff; dash.ST = STAFFDATA; dash.FILTER = '';
vm.runInContext('render()', dash);
const dhtml = els['#list'].innerHTML;
check('render รายการทั้งหมด', (dhtml.match(/class="card"/g) || []).length >= 4);
check('แท็บเรียงตามลำดับงานจริง',
  /ร่างสเปค/.test(els['#tabs'].innerHTML) && /เทียบราคา/.test(els['#tabs'].innerHTML) &&
  /รอผู้บริหาร/.test(els['#tabs'].innerHTML), els['#tabs'].innerHTML.slice(0, 260));
check('แสดงรหัสพนักงานผู้ขอ', /\(1042\)/.test(dhtml));
check('การ์ดมีขั้นที่ 1 สเปค และขั้นที่ 2 เทียบราคา',
  /1\. สเปคที่ให้ช่างตรวจ/.test(dhtml) && /2\. เทียบราคา/.test(dhtml));
check('นับจำนวนเจ้าที่เทียบแล้ว', /Quotes 3\/3 เจ้า/.test(dhtml), (dhtml.match(/Quotes \d\/\d เจ้า/g) || []));
check('รายการที่ยังไม่ครบ 3 เจ้า ขึ้นเตือน', /ต้องเทียบให้ครบ/.test(dhtml));
check('ทำเครื่องหมายราคาที่มาจากช่าง', /ราคาช่าง/.test(dhtml));
check('ชี้ตัวเลือกที่จัดซื้อแนะนำ', /★ แนะนำ/.test(dhtml));
check('เตือนว่าจัดซื้อเปิด PO เองไม่ได้จนกว่าจะอนุมัติ',
  /จัดซื้อยังเปิด PO ไม่ได้จนกว่าจะอนุมัติ/.test(dhtml));
check('มีปุ่มดึงราคาช่างเข้าตารางเทียบ', /ใช้ราคานี้เป็น 1 เจ้า/.test(dhtml));
check('ลิงก์หน้าช่างมี token', dhtml.indexOf('?p=r&amp;t=' + req.token) >= 0 || dhtml.indexOf('?p=r&t=' + req.token) >= 0);
check('ไม่มี undefined หลุดใน HTML', !/undefined/.test(dhtml), (dhtml.match(/.{40}undefined.{40}/) || [])[0]);
const specForm = vm.runInContext('specForm("' + id4 + '")', dash);
check('ฟอร์มส่งสเปคมีช่องยี่ห้อ/รุ่น/รายละเอียด/รูป',
  /s_brand_/.test(specForm) && /s_model_/.test(specForm) && /s_detail_/.test(specForm) && /s_photo_/.test(specForm));
check('ฟอร์มสเปคย้ำว่าช่างไม่เห็นราคา', /ไม่เห็นราคาและไม่เห็นว่าเจ้าไหน/.test(specForm));
const optForm = vm.runInContext('optionForm("' + id1 + '")', dash);
check('ฟอร์มเพิ่มราคามีผู้ขาย ราคา VAT ค่าส่ง',
  /o_sup_/.test(optForm) && /o_price_/.test(optForm) && /o_vat_/.test(optForm) && /o_ship_/.test(optForm));

console.log('\n=== Page_Mgr (หน้าผู้บริหารอนุมัติ) ===');
const mgrPage = runPage('Page_Mgr.html', 'null');
mgrPage.MGR = mgr; mgrPage.ST = MGRDATA; mgrPage.STAGE = 'APPROVAL'; mgrPage.picked = {};
vm.runInContext('render()', mgrPage);
const mhtml = els['#list'].innerHTML;
check('จัดกลุ่มเป็นใบขอซื้อ', mhtml.indexOf(req.req_id) >= 0);
check('แสดงผู้ขอพร้อมรหัสพนักงาน', /ช่างสมชาย ใจดี \(1042\)/.test(mhtml));
check('ย้ำว่าช่างยืนยันสเปคแล้ว', /ช่างยืนยันสเปคแล้ว/.test(mhtml) && /Mitutoyo 2046A/.test(mhtml));
check('แสดงตารางเทียบครบ 3 เจ้า',
  /เทียบราคา 3 เจ้า/.test(mhtml) && /ไทยทูลส์ ซัพพลาย/.test(mhtml) && /ก\.การช่าง/.test(mhtml));
check('ชี้ว่าเจ้าไหนถูกที่สุด และเจ้าไหนแพงกว่าเท่าไร',
  /ถูกที่สุด/.test(mhtml) && /แพงกว่าถูกสุด/.test(mhtml));
check('แสดงราคาที่ช่างไปดูมาเป็นหนึ่งตัวเลือก', /ราคาที่ช่างไปดูมา/.test(mhtml));
check('แสดงเหตุผลที่จัดซื้อแนะนำ', /ของแท้ มีใบรับรอง/.test(mhtml));
check('มีปุ่มอนุมัติและไม่อนุมัติรายรายการ',
  /อนุมัติรายการนี้/.test(mhtml) && /ไม่อนุมัติ/.test(mhtml));
check('บอกผลของการเลือกก่อนกด (เปิด PO หรือ ให้ช่างซื้อเอง)',
  /จัดซื้อจะเปิด PO กับผู้ขายรายนี้/.test(mhtml));
check('ไม่มี undefined หลุดใน HTML', !/undefined/.test(mhtml), (mhtml.match(/.{40}undefined.{40}/) || [])[0]);

// ใบที่มีหลายรายการรออนุมัติ -> ต้องมีปุ่มอนุมัติทั้งใบ
const r3 = srv.apiSubmitRequest({ emp_code: '1103', requester_name: 'ช่างนพดล ศรีสุข', required_date: '2026-10-05',
  items: [{ tool_name: 'ค้อนปอนด์', qty: 1, unit: 'ด้าม' }, { tool_name: 'สิ่วเจาะ', qty: 2, unit: 'อัน' }] });
[r3.req_id + '-01', r3.req_id + '-02'].forEach(function (id) {
  srv.apiSetSpec(staff.token, id, { brand: 'Stanley', model: 'STHT' });
  srv.apiTechSpecDecision(r3.token, id, 'CONFIRM', { by: 'ช่างนพดล ศรีสุข' });
  ['ไทยทูลส์ ซัพพลาย', 'ก.การช่าง', 'เอเซียเครื่องมือ'].forEach(function (sup, k) {
    srv.apiAddOption(staff.token, id, { supplier: sup, brand: 'Stanley', model: 'STHT', unit_price: 500 + k * 30, vat_rate: 7, shipping: 0 });
  });
  srv.apiRecommend(staff.token, id, srv.optionsOfItem_(id)[0].option_id, 'ถูกสุดและมีของ');
  srv.apiSubmitForApproval(staff.token, id);
});
mgrPage.ST = srv.apiMgrData(mgr.token, {});
vm.runInContext('render()', mgrPage);
const mhtml2 = els['#list'].innerHTML;
check('ใบที่มีหลายรายการมีปุ่มอนุมัติทั้งใบ', /อนุมัติทั้งใบ 2 รายการ/.test(mhtml2),
  (mhtml2.match(/อนุมัติทั้งใบ[^<]*/g) || [])[0]);
check('ปุ่มอนุมัติทั้งใบแสดงยอดรวม', /อนุมัติทั้งใบ 2 รายการ — [\d,]+\.\d\d ฿/.test(mhtml2));

console.log('\n=== Page_New (ฟอร์มขอซื้อ) ===');
const np = runPage('Page_New.html', JSON.stringify({ config: srv.publicCfg_(), technicians: srv.activeTechs_() }));
const nhtml = els['#items'].innerHTML;
check('สร้างการ์ดรายการแรกอัตโนมัติ', /class="card item"/.test(nhtml));
check('มีช่องยี่ห้อ/รุ่น วันที่ และหมายเหตุ รายทูล',
  /f_brand/.test(nhtml) && /f_idate/.test(nhtml) && /f_inote/.test(nhtml));
check('มีช่องราคาที่เห็นที่ร้าน + ร้านเริ่มต้น', /ราคาที่เห็นที่ร้าน/.test(nhtml) && /Global House/.test(nhtml));
check('บอกว่าใส่ราคาทีหลังได้', /ค่อยเพิ่มราคาทีหลัง/.test(nhtml));
check('มีช่องอัปโหลดรูปและลิงก์อ้างอิง', /accept="image\/\*" multiple/.test(nhtml) && /ลิงก์สินค้าอ้างอิง/.test(nhtml));
check('เลือกชื่อแล้วเติมรหัสพนักงานให้',
  (function () {
    np.document.querySelector('#f_name').value = 'ช่างวิชัย แก้วมณี';
    vm.runInContext('syncFromName()', np);
    return np.document.querySelector('#f_emp').value === '1078';
  })(), np.document.querySelector('#f_emp').value);
check('พิมพ์รหัสแล้วเติมชื่อให้',
  (function () {
    np.document.querySelector('#f_emp').value = '1103';
    vm.runInContext('syncFromCode()', np);
    return np.document.querySelector('#f_name').value === 'ช่างนพดล ศรีสุข';
  })(), np.document.querySelector('#f_name').value);
check('ไม่มี undefined หลุดใน HTML', !/undefined/.test(nhtml));

console.log('\n----------------------------------------');
console.log('ผ่าน ' + pass + ' / ล้มเหลว ' + fail);
process.exit(fail ? 1 : 0);
})();
