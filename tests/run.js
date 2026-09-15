/* ทดสอบ workflow ฝั่งเซิร์ฟเวอร์ทั้งหมด โดยไม่ต้อง deploy */
const fs = require('fs'), vm = require('vm'), path = require('path');
const { g, SS, MAIL, FILES } = require('./mock.js');

const DIR = path.join(__dirname, '..', 'apps-script');
const ctx = vm.createContext(g);
['Config.gs','Db.gs','Workflow.gs','Files.gs','Notify.gs','Setup.gs','Code.gs','Api.gs'].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f });
});
const run = code => vm.runInContext(code, ctx);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ('  → ' + JSON.stringify(extra)) : '')); }
}
function section(s) { console.log('\n=== ' + s + ' ==='); }
function err(fn) { try { fn(); return null; } catch (e) { return e.message; } }

const tinyJpgB64 = Buffer.from([0xff,0xd8,0xff,0xdb,0x00,0x43,0x00,0xff,0xd9]).toString('base64');
const jpg = { name: 'p.jpg', mime: 'image/jpeg', dataB64: tinyJpgB64 };

section('Setup');
g.setupAll = ctx.setupAll;
run('setupAll()');
check('สร้างครบ 7 ชีต', SS.getSheets().length === 7, SS.getSheets().map(s => s.name));
check('มี PIN แยกของจัดซื้อและผู้บริหาร',
  ctx.cfg_('STAFF_PIN') === '2468' && ctx.cfg_('MGR_PIN') === '9753');
check('ค่าเริ่มต้นเทียบราคา 3 เจ้า', ctx.minQuotes_() === 3);
check('รายชื่อช่างมีรหัสพนักงาน', ctx.activeTechs_()[0].emp_code === '1042', ctx.activeTechs_()[0]);
check('ค้นหาช่างจากรหัสได้', (ctx.findTech_('1078') || {}).name === 'ช่างวิชัย แก้วมณี');
ctx.setCfg_('PURCHASING_EMAILS', 'purchasing@meiwa.example');
ctx.setCfg_('MANAGEMENT_EMAILS', 'boss@meiwa.example');
ctx.setCfg_('COMPANY_NAME', 'บริษัท เมวา เอ็นเตอร์ไพรส์ (ประเทศไทย) จำกัด');

section('1) ช่างส่งคำขอ — ต้องมีรหัสพนักงาน');
const noCode = err(() => ctx.apiSubmitRequest({ requester_name: 'คนนอก ไม่มีในระบบ', items: [{ tool_name: 'x' }] }));
check('ไม่มีรหัสพนักงาน + ไม่อยู่ในรายชื่อ -> ส่งไม่ได้', /รหัสพนักงาน/.test(noCode || ''), noCode);
const wrongCode = err(() => ctx.apiSubmitRequest({
  emp_code: '9999', requester_name: 'ช่างสมชาย ใจดี', items: [{ tool_name: 'x' }] }));
check('รหัสไม่ตรงกับชื่อ -> ส่งไม่ได้', /ไม่ตรง/.test(wrongCode || ''), wrongCode);

const res = ctx.apiSubmitRequest({
  requester_name: 'ช่างสมชาย ใจดี',   // ไม่ใส่รหัส -> ระบบเติมให้จากรายชื่อ
  contact: 'LINE: somchai', required_date: '2026-09-25', note: 'งานด่วน',
  items: [
    { tool_name: 'ไดอัลเกจ', qty: 1, unit: 'ตัว', intended_use: 'วัดความเยื้องศูนย์',
      spec_pref: '0–10 มม. ละเอียด 0.01 มม.', brand_pref: 'Mitutoyo 2046A หรือเทียบเท่า',
      item_note: 'ตัวเดิมเข็มค้าง', bench_price: 1650, bench_store: 'Global House',
      photos: [jpg] },
    { tool_name: 'ประแจทอร์ค 1/2"', qty: 2, unit: 'ตัว', spec_pref: '40–200 N·m มีใบสอบเทียบ' }
  ]
});
check('ได้เลขที่คำขอ', /^REQ-\d{4}-0001$/.test(res.req_id), res.req_id);
check('ระบบเติมรหัสพนักงานให้', res.emp_code === '1042', res.emp_code);
check('อัปโหลดรูปเข้า Drive', Object.keys(FILES).length === 1);
check('อีเมลแจ้งจัดซื้อ', MAIL.length === 1 && /ใบขอซื้อใหม่/.test(MAIL[0].subject));
check('อีเมลมีรหัสพนักงาน', /1042/.test(MAIL[0].body));
check('อีเมลมีราคาที่ช่างไปดูมา', /1,650\.00 บาท/.test(MAIL[0].body));
check('อีเมลบอกขั้นตอนถัดไป (ร่างสเปคก่อนเทียบราคา)', /ร่างสเปคอ้างอิง 1 ชิ้น/.test(MAIL[0].body));

const I1 = res.req_id + '-01', I2 = res.req_id + '-02';
let dto = ctx.apiGetRequest(res.token);
check('เริ่มที่ขั้นรอจัดซื้อร่างสเปค', dto.items[0].stage === 'NEED_SPEC', dto.items[0].stage);
check('ช่างเห็นราคาที่ตัวเองไปดูมา', ctx.num_(dto.items[0].bench_price) === 1650);

section('2) หน้าช่างต้องไม่มีราคาผู้ขายหลุดออกไป');
const staff = ctx.apiStaffLogin('2468', 'คุณแนน (จัดซื้อ)');
const mgr = ctx.apiMgrLogin('9753', 'คุณสมศักดิ์ (ผู้จัดการ)');
check('จัดซื้อและผู้บริหารใช้ PIN คนละตัว', !!staff.token && !!mgr.token);
check('PIN จัดซื้อเข้าหน้าผู้บริหารไม่ได้', /เซสชันผู้บริหารหมดอายุ/.test(err(() => ctx.apiMgrData(staff.token, {})) || ''));
check('PIN ผู้บริหารเข้าหน้าจัดซื้อไม่ได้', /เซสชันจัดซื้อหมดอายุ/.test(err(() => ctx.apiStaffData(mgr.token, {})) || ''));

section('3) จัดซื้อร่างสเปค 1 ชิ้นให้ช่างตรวจ');
const tooEarly = err(() => ctx.apiAddOption(staff.token, I1, { supplier: 'x', unit_price: 100 }));
check('ยังไม่ได้ให้ช่างยืนยันสเปค -> เทียบราคาไม่ได้', /ยืนยันสเปคก่อน/.test(tooEarly || ''), tooEarly);

ctx.apiSetSpec(staff.token, I1, {
  brand: 'Mitutoyo', model: '2046A',
  detail: 'ช่วงวัด 0–10 มม. อ่านละเอียด 0.01 มม. พร้อมขาแม่เหล็ก', photo: jpg
});
dto = ctx.apiGetRequest(res.token);
check('ส่งสเปคแล้ว -> รอช่างตรวจ', dto.items[0].stage === 'TECH_SPEC', dto.items[0].stage);
check('ช่างเห็นยี่ห้อ/รุ่นที่เสนอ', dto.items[0].spec_brand === 'Mitutoyo' && dto.items[0].spec_model === '2046A');
check('ช่างไม่ได้รับ field ราคาผู้ขายเลย',
  !('options' in dto.items[0]) && !('recommend_option_id' in dto.items[0]),
  Object.keys(dto.items[0]).filter(k => /option|recommend/.test(k)));

section('4) ช่างยืนยันสเปค (ไม่เห็นราคา)');
const noReason = err(() => ctx.apiTechSpecDecision(res.token, I1, 'CHANGE', { by: 'ช่างสมชาย ใจดี' }));
check('ขอแก้สเปคต้องมีเหตุผล', /เหตุผล/.test(noReason || ''), noReason);
ctx.apiTechSpecDecision(res.token, I1, 'CHANGE', { by: 'ช่างสมชาย ใจดี', note: 'ต้องมีขาแม่เหล็กแบบหมุนได้' });
dto = ctx.apiGetRequest(res.token);
check('ช่างขอแก้ -> เข้าหมวด SPEC_CHANGE', dto.items[0].stage === 'SPEC_CHANGE', dto.items[0].stage);

ctx.apiSetSpec(staff.token, I1, {
  brand: 'Mitutoyo', model: '2046A',
  detail: 'ช่วงวัด 0–10 มม. อ่านละเอียด 0.01 มม. + ขาแม่เหล็กแบบข้อต่อหมุนได้', photo: jpg
});
ctx.apiTechSpecDecision(res.token, I1, 'CONFIRM', { by: 'ช่างสมชาย ใจดี', note: 'ตรงแล้วครับ' });
dto = ctx.apiGetRequest(res.token);
check('ช่างยืนยันสเปค -> เข้าขั้นเทียบราคา', dto.items[0].stage === 'QUOTING', dto.items[0].stage);
check('บันทึกชื่อและเวลาที่ช่างกด', dto.items[0].tech_by === 'ช่างสมชาย ใจดี' && !!dto.items[0].tech_at);

section('5) จัดซื้อเทียบราคา 3 เจ้า');
const o1 = ctx.apiAddOption(staff.token, I1, {
  supplier: 'ไทยทูลส์ ซัพพลาย', brand: 'Mitutoyo', model: '2046A',
  unit_price: 1850, vat_rate: 7, shipping: 0, delivery_date: '2026-09-16', payment_terms: 'เครดิต 30 วัน'
});
check('เทียบ 1 เจ้า ยังไม่ครบ', o1.quote.count === 1 && !o1.quote.ok, o1.quote);
const notReady = err(() => ctx.apiSubmitForApproval(staff.token, I1));
check('ยังไม่ครบ 3 เจ้า -> ส่งอนุมัติไม่ได้', /อย่างน้อย 3 เจ้า/.test(notReady || ''), notReady);

const o2 = ctx.apiAddOption(staff.token, I1, {
  supplier: 'ก.การช่าง', brand: 'Mitutoyo', model: '2046A',
  unit_price: 1790, vat_rate: 7, shipping: 120, delivery_date: '2026-09-19', payment_terms: 'โอนก่อนส่ง'
});
const o3 = ctx.apiAddTechPriceAsOption(staff.token, I1);
check('ดึงราคาที่ช่างไปดูมาเป็น 1 เจ้าได้', o3.quote.count === 3 && o3.quote.ok, o3.quote);
check('ราคาของช่างถูกทำเครื่องหมายว่ามาจากช่าง',
  ctx.findOne_('Options', 'option_id', o3.option_id).source === 'TECH');
check('ดึงซ้ำไม่ได้', /ไปแล้ว/.test(err(() => ctx.apiAddTechPriceAsOption(staff.token, I1)) || ''));
check('ราคาช่าง 1,650 ถูกที่สุดในสามเจ้า',
  ctx.optionsOfItem_(I1)[0].option_id === o3.option_id, ctx.optionsOfItem_(I1).map(o => o.total_cost));

const noRec = err(() => ctx.apiSubmitForApproval(staff.token, I1));
check('ยังไม่ได้เลือกตัวที่แนะนำ -> ส่งอนุมัติไม่ได้', /แนะนำ/.test(noRec || ''), noRec);
ctx.apiRecommend(staff.token, I1, o1.option_id, 'ของแท้ มีใบรับรอง ส่งเร็วสุด และให้เครดิต 30 วัน');
ctx.apiSubmitForApproval(staff.token, I1);
let board = ctx.apiStaffData(staff.token, {});
let it1 = board.items.filter(i => i.item_id === I1)[0];
check('ส่งอนุมัติแล้ว -> รอผู้บริหาร', it1.stage === 'APPROVAL', it1.stage);
check('อีเมลถึงผู้บริหารมีตารางเทียบครบ 3 เจ้า',
  /เทียบราคา 3 เจ้า/.test(MAIL[MAIL.length - 1].body) && /boss@meiwa.example/.test(MAIL[MAIL.length - 1].to));
check('อีเมลผู้บริหารมีเหตุผลที่จัดซื้อแนะนำ', /ของแท้ มีใบรับรอง/.test(MAIL[MAIL.length - 1].body));

section('6) เฉพาะผู้บริหารเท่านั้นที่อนุมัติได้');
check('จัดซื้ออนุมัติเองไม่ได้ (ไม่มี API ให้จัดซื้อกด)', typeof ctx.apiApprove === 'undefined');
const poEarly = err(() => ctx.apiIssuePO(staff.token, I1, 'PO-001'));
check('ยังไม่อนุมัติ -> เปิด PO ไม่ได้', /อนุมัติแล้ว/.test(poEarly || ''), poEarly);

const mgrView = ctx.apiMgrData(mgr.token, {});
check('หน้าผู้บริหารจัดกลุ่มเป็นใบ', mgrView.groups.length === 1 && mgrView.groups[0].req_id === res.req_id);
check('ยอดรวมของใบใช้ตัวที่จัดซื้อแนะนำ',
  Math.abs(mgrView.groups[0].total - 1979.5) < 0.01, mgrView.groups[0].total);

ctx.apiMgrApprove(mgr.token, I1, o1.option_id, 'อนุมัติตามที่จัดซื้อเสนอ');
board = ctx.apiStaffData(staff.token, {});
it1 = board.items.filter(i => i.item_id === I1)[0];
check('อนุมัติแล้ว -> รอเปิด PO', it1.stage === 'TO_PO', it1.stage);
check('บันทึกชื่อผู้อนุมัติและเวลา', it1.mgr_by === 'คุณสมศักดิ์ (ผู้จัดการ)' && !!it1.mgr_at);
check('ตัวเลือกที่ไม่ถูกเลือกถูกทำเครื่องหมายไว้',
  ctx.findOne_('Options', 'option_id', o2.option_id).status === 'NOT_SELECTED');
check('อนุมัติซ้ำไม่ได้', /รออนุมัติ/.test(err(() => ctx.apiMgrApprove(mgr.token, I1, o1.option_id)) || ''));

ctx.apiIssuePO(staff.token, I1, 'PO-2026-0148');
board = ctx.apiStaffData(staff.token, {});
it1 = board.items.filter(i => i.item_id === I1)[0];
check('เปิด PO แล้ว', it1.stage === 'ORDERED' && it1.po_ref === 'PO-2026-0148', it1.stage);
ctx.apiSetPurchaseStatus(staff.token, I1, 'RECEIVED', 'ของถึงแล้ว');
check('รับของแล้ว -> เสร็จสิ้น', ctx.apiStaffData(staff.token, {}).items.filter(i => i.item_id === I1)[0].stage === 'DONE');

section('7) ผู้บริหารเลือกราคาของช่าง -> ช่างไปซื้อเอง');
ctx.apiSetSpec(staff.token, I2, { brand: 'Tone', model: 'T4MN200', detail: '40–200 N·m พร้อมใบสอบเทียบ' });
ctx.apiTechSpecDecision(res.token, I2, 'CONFIRM', { by: 'ช่างสมชาย ใจดี' });
dto = ctx.apiGetRequest(res.token);
check('ช่างเพิ่มราคาร้านทีหลังได้ (ตอนขอไม่ได้ใส่)', ctx.num_(dto.items[1].bench_price) === 0);
ctx.apiAddBenchmark(res.token, I2, {
  by: 'ช่างสมชาย ใจดี', bench_price: 2100, bench_store: 'Global House สาขาบางปะกง',
  bench_note: 'มีของบนชั้น ซื้อได้เลย', photo: jpg
});
dto = ctx.apiGetRequest(res.token);
check('บันทึกราคาที่ช่างส่งตามมาทีหลัง', ctx.num_(dto.items[1].bench_price) === 2100);
check('จัดซื้อได้รับอีเมลแจ้งราคาที่ช่างส่งมา', /ช่างส่งราคาร้านข้างนอก/.test(MAIL[MAIL.length - 1].subject));

ctx.apiAddOption(staff.token, I2, { supplier: 'ไทยทูลส์ ซัพพลาย', brand: 'Tone', model: 'T4MN200', unit_price: 2600, vat_rate: 7, shipping: 0 });
ctx.apiAddOption(staff.token, I2, { supplier: 'ก.การช่าง', brand: 'Tone', model: 'T4MN200', unit_price: 2550, vat_rate: 7, shipping: 150 });
const oTech2 = ctx.apiAddTechPriceAsOption(staff.token, I2);
ctx.apiRecommend(staff.token, I2, oTech2.option_id, 'ร้านใกล้โรงงาน ถูกกว่าและได้ของวันนี้');
ctx.apiSubmitForApproval(staff.token, I2);
ctx.apiMgrApprove(mgr.token, I2, oTech2.option_id, 'ให้ช่างไปซื้อเองเลย');

board = ctx.apiStaffData(staff.token, {});
const it2 = board.items.filter(i => i.item_id === I2)[0];
check('เลือกราคาของช่าง -> ตั้งเป็นช่างซื้อเองอัตโนมัติ', it2.buy_mode === 'LOCAL', it2.buy_mode);
check('สถานะเป็นรอใบเสร็จ', it2.stage === 'LOCAL_BUY', it2.stage);
check('รายการที่ให้ช่างซื้อเอง เปิด PO ไม่ได้',
  /ไม่ต้องเปิด PO/.test(err(() => ctx.apiIssuePO(staff.token, I2, 'PO-x')) || ''));

dto = ctx.apiGetRequest(res.token);
check('ช่างเห็นวงเงินที่อนุมัติของรายการที่ต้องไปซื้อเอง',
  ctx.num_(dto.items[1].approvedBudget) === 4200, dto.items[1].approvedBudget);
const lineRows = ctx.readAll_('Notifications').filter(n => /อนุมัติให้ซื้อเอง/.test(n.subject));
check('เตรียมข้อความ LINE พร้อมข้อมูลใบกำกับภาษี',
  lineRows.length === 1 && /เมวา เอ็นเตอร์ไพรส์/.test(lineRows[0].message));

const earlyReceipt = err(() => ctx.apiUploadReceipt(res.token, I1, jpg, 'ช่างสมชาย ใจดี', 100));
check('อัปโหลดใบเสร็จได้เฉพาะรายการที่ช่างซื้อเอง', /ช่างซื้อเอง/.test(earlyReceipt || ''), earlyReceipt);
ctx.apiUploadReceipt(res.token, I2, jpg, 'ช่างสมชาย ใจดี', 4180);
dto = ctx.apiGetRequest(res.token);
check('ส่งใบเสร็จแล้ว -> เสร็จสิ้น', dto.items[1].stage === 'DONE', dto.items[1].stage);
check('เก็บราคาจริงที่จ่าย', ctx.num_(dto.items[1].actual_price) === 4180);

section('8) อนุมัติทั้งใบในคลิกเดียว');
const r2 = ctx.apiSubmitRequest({
  emp_code: '1078', requester_name: 'ช่างวิชัย แก้วมณี', required_date: '2026-10-01',
  items: [
    { tool_name: 'เครื่องเจียร 4 นิ้ว', qty: 1, unit: 'ตัว', bench_price: 1290, bench_store: 'Global House' },
    { tool_name: 'ตลับเมตร 5 ม.', qty: 3, unit: 'อัน' }
  ]
});
const J1 = r2.req_id + '-01', J2 = r2.req_id + '-02';
[J1, J2].forEach((id, i) => {
  ctx.apiSetSpec(staff.token, id, { brand: i ? 'Stanley' : 'Makita', model: i ? 'PowerLock' : 'GA4030' });
  ctx.apiTechSpecDecision(r2.token, id, 'CONFIRM', { by: 'ช่างวิชัย แก้วมณี' });
  ['ไทยทูลส์ ซัพพลาย', 'ก.การช่าง', 'เอเซียเครื่องมือ'].forEach((sup, k) => {
    ctx.apiAddOption(staff.token, id, { supplier: sup, brand: 'X', model: 'Y', unit_price: 1000 + k * 50 + i * 100, vat_rate: 7, shipping: 0 });
  });
  const opts = ctx.optionsOfItem_(id);
  ctx.apiRecommend(staff.token, id, opts[0].option_id, 'ถูกที่สุดและมีของ');
  ctx.apiSubmitForApproval(staff.token, id);
});
const before = ctx.apiMgrData(mgr.token, {});
check('ใบที่ 2 รออนุมัติ 2 รายการ',
  before.groups.filter(x => x.req_id === r2.req_id)[0].approvable === 2);
const all = ctx.apiMgrApproveAll(mgr.token, r2.req_id, 'อนุมัติทั้งใบ');
check('กดครั้งเดียวอนุมัติครบ 2 รายการ', all.approved === 2 && all.failed.length === 0, all);
board = ctx.apiStaffData(staff.token, {});
check('ทั้งสองรายการรอเปิด PO',
  board.items.filter(i => i.req_id === r2.req_id).every(i => i.stage === 'TO_PO'));
check('อนุมัติทั้งใบใช้ตัวที่จัดซื้อแนะนำ',
  board.items.filter(i => i.item_id === J1)[0].approved_option_id === ctx.optionsOfItem_(J1)[0].option_id);

section('9) ประวัติ ค้นหา และกฎอื่น ๆ');
const hist = ctx.apiItemHistory(staff.token, I1);
check('ประวัติเก็บครบทุกขั้น', hist.length >= 7, hist.length);
check('ประวัติมีครบ 3 บทบาท',
  ['TECH', 'PURCHASING', 'MANAGEMENT'].every(r => hist.some(h => h.role === r)),
  hist.map(h => h.role));
check('ประวัติบันทึกคนกดอนุมัติ',
  hist.some(h => h.action === 'APPROVE' && h.actor === 'คุณสมศักดิ์ (ผู้จัดการ)'));
check('ผู้บริหารเปิดประวัติได้ด้วย', ctx.apiItemHistory(mgr.token, I1).length === hist.length);

const techHist = ctx.apiGetRequest(res.token).items[0].history;
const techHistText = JSON.stringify(techHist);
check('ประวัติฝั่งช่างไม่มีชื่อผู้ขายหลุดออกไป',
  !/ไทยทูลส์|ก\.การช่าง/.test(techHistText), (techHistText.match(/ไทยทูลส์[^"]*/g) || [])[0]);
check('ประวัติฝั่งช่างไม่มีราคาผู้ขายหลุดออกไป',
  !/1,979|1,918|1,850|1,790/.test(techHistText), (techHistText.match(/[\d,]+\.\d\d บาท/g) || []));
check('ประวัติฝั่งช่างยังบอกเหตุการณ์สำคัญเป็นภาษาไทย',
  techHist.some(h => h.action === 'ผู้บริหารอนุมัติ') && techHist.some(h => h.action === 'ช่างยืนยันสเปค'),
  techHist.map(h => h.action));
check('ประวัติฝั่งช่างยังเห็นรายละเอียดของตัวเอง',
  techHist.some(h => h.action === 'ช่างแจ้งราคาที่ร้าน' && /1,650/.test(h.detail)) ||
  techHist.some(h => h.action === 'ช่างส่งคำขอ' && /1,650/.test(h.detail)),
  techHist.filter(h => /ช่าง/.test(h.action)).map(h => h.action + ':' + h.detail));

check('ค้นหาด้วยรหัสพนักงานได้', ctx.apiFindMyRequests('1042').length === 1);
check('ค้นหาด้วยชื่อได้', ctx.apiFindMyRequests('วิชัย').length === 1);
check('ค้นหาบนแดชบอร์ดด้วยรหัสพนักงานได้',
  ctx.apiStaffData(staff.token, { q: '1078' }).items.length === 2);

check('ไม่อนุมัติต้องมีเหตุผล', /เหตุผล/.test(err(() => ctx.apiMgrReject(mgr.token, J1, '')) || ''));
check('token มั่วเปิดไม่ได้', /ไม่พบคำขอ/.test(err(() => ctx.apiGetRequest('0000000000000000')) || ''));
check('ใช้ token ใบหนึ่งไปแก้อีกใบไม่ได้',
  /ไม่พบรายการ/.test(err(() => ctx.apiTechSpecDecision(r2.token, I1, 'CONFIRM', { by: 'ช่างวิชัย แก้วมณี' })) || ''));
check('อัปโหลดไฟล์นอกเหนือรูป/PDF ไม่ได้',
  /รูปภาพและไฟล์ PDF/.test(err(() => ctx.saveUpload_({ name: 'x.exe', mime: 'application/x-msdownload', dataB64: tinyJpgB64 }, 'x')) || ''));
check('ค่าส่งถูกคิด VAT ด้วย', Math.abs(ctx.priceCalc_(1000, 2, 7, 200).total - 2354) < 0.01, ctx.priceCalc_(1000, 2, 7, 200));
check('ข้อมูลในชีต Items ครบทุกคอลัมน์',
  ctx.readAll_('Items')[0] && Object.keys(ctx.readAll_('Items')[0]).length === ctx.HEADERS.Items.length + 1);

section('10) สรุปงานค้างรายวัน');
const before2 = MAIL.length;
ctx.dailyDigest();
check('ส่งสรุปให้จัดซื้อ', MAIL.slice(before2).some(m => /สรุปงานค้าง/.test(m.subject)));
const pend = ctx.apiMgrData(mgr.token, {}).counts.APPROVAL || 0;
check('ไม่มีรายการค้างอนุมัติแล้ว ไม่ต้องส่งเมลผู้บริหาร',
  pend === 0 && !MAIL.slice(before2).some(m => /^รออนุมัติ/.test(m.subject)), pend);

console.log('\n----------------------------------------');
console.log('ผ่าน ' + pass + ' / ล้มเหลว ' + fail);
process.exit(fail ? 1 : 0);
