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

const tinyJpgB64 = Buffer.from([0xff,0xd8,0xff,0xdb,0x00,0x43,0x00,0xff,0xd9]).toString('base64');

section('Setup');
g.setupAll = ctx.setupAll;
run('setupAll()');
check('สร้างครบ 7 ชีต', SS.getSheets().length === 7, SS.getSheets().map(s => s.name));
check('Config มีค่าเริ่มต้น', ctx.cfg_('STAFF_PIN') === '2468');
check('มีรายชื่อช่างตัวอย่าง', ctx.activeTechs_().length === 3);
ctx.setCfg_('PURCHASING_EMAILS', 'purchasing@meiwa.example');
ctx.setCfg_('COMPANY_NAME', 'บริษัท เมวา (ประเทศไทย) จำกัด');

section('1) ช่างส่งคำขอ 2 รายการ + รูป');
const res = ctx.apiSubmitRequest({
  requester_name: 'ช่างสมชาย ใจดี', site: 'โรงงาน 1', contact: 'LINE: somchai',
  required_date: '2026-09-25', note: 'งานด่วน',
  items: [
    { tool_name: 'สว่านโรตารี่ 26 มม.', qty: 1, unit: 'ตัว', intended_use: 'เจาะปูน',
      spec_pref: 'Bosch/Makita SDS-Plus 800W+', benchmark_price: 4890, benchmark_store: 'Global House',
      photos: [{ name: 'old.jpg', mime: 'image/jpeg', dataB64: tinyJpgB64 }] },
    { tool_name: 'ประแจทอร์ค 1/2"', qty: 2, unit: 'ตัว', intended_use: 'ขันโบลต์',
      spec_pref: '40-200 N·m', benchmark_price: 2150, benchmark_store: 'Global House' }
  ]
});
check('ได้เลขที่คำขอ', /^TR-\d{4}-0001$/.test(res.req_id), res.req_id);
check('ได้ลิงก์ token', /\?p=r&t=[0-9a-f]{16}$/.test(res.url), res.url);
check('อัปโหลดรูปเข้า Drive 1 ไฟล์', Object.keys(FILES).length === 1);
check('ส่งอีเมลแจ้งจัดซื้อ', MAIL.length === 1 && /ใบขอซื้อใหม่/.test(MAIL[0].subject));
check('อีเมลมีราคาที่ช่างเห็นที่ร้าน', /4,890\.00 บาท/.test(MAIL[0].body));

let dto = ctx.apiGetRequest(res.token);
check('DTO มี 2 รายการ', dto.items.length === 2);
check('สถานะเริ่มต้น = รอเสนอราคา', dto.items[0].stage === 'NEED_OPTION', dto.items[0].stage);
check('item_id อ่านง่าย', dto.items[1].item_id === res.req_id + '-2', dto.items[1].item_id);

section('2) จัดซื้อเข้าระบบและเสนอตัวเลือก');
let bad = null; try { ctx.apiStaffData('ปลอม', {}); } catch (e) { bad = e.message; }
check('token ปลอมเข้าไม่ได้', /เซสชันหมดอายุ/.test(bad || ''), bad);
let badpin = null; try { ctx.apiStaffLogin('0000', 'x'); } catch (e) { badpin = e.message; }
check('PIN ผิดเข้าไม่ได้', /รหัสไม่ถูกต้อง/.test(badpin || ''));
const staff = ctx.apiStaffLogin('2468', 'คุณแนน (จัดซื้อ)');
check('เข้าสู่ระบบได้', !!staff.token);

const it1 = res.req_id + '-1', it2 = res.req_id + '-2';
const o1 = ctx.apiAddOption(staff.token, it1, {
  brand_model: 'Bosch GBH 2-26 DRE', spec: 'SDS-Plus 800W 2.7J พร้อมกล่อง', supplier: 'ร้านเครื่องมือ ก.การช่าง',
  unit_price: 5200, vat_rate: 7, shipping: 150, availability: 'มีของ', delivery_date: '2026-09-18',
  payment_terms: 'เครดิต 30 วัน', is_recommended: true,
  photo: { name: 'bosch.jpg', mime: 'image/jpeg', dataB64: tinyJpgB64 }
});
check('คำนวณราคารวมถูกต้อง (5200+150)*1.07', Math.abs(o1.total - 5724.5) < 0.001, o1.total);
ctx.apiAddOption(staff.token, it2, {
  brand_model: 'Tone T4MN200', spec: '40-200 N·m มีใบสอบเทียบ', supplier: 'ไทยทูลส์',
  unit_price: 2600, vat_rate: 7, shipping: 0, availability: 'สั่งผลิต 7 วัน',
  delivery_date: '2026-09-24', payment_terms: 'โอนก่อนส่ง'
});
dto = ctx.apiGetRequest(res.token);
check('รายการที่ 1 -> รอช่างยืนยัน', dto.items[0].stage === 'TECH_SPEC', dto.items[0].stage);
check('ตัวเลือกที่ 2 คิด VAT ตามจำนวน 2 ชิ้น', Math.abs(ctx.num_(dto.items[1].options[0].total_cost) - 5564) < 0.001, dto.items[1].options[0].total_cost);
check('มีข้อความ LINE รอส่งให้ช่าง', ctx.readAll_('Notifications').filter(n => n.channel === 'LINE' && n.status === 'PENDING').length === 2);

section('3) ช่างตัดสินใจรายรายการ');
let noName = null; try { ctx.apiTechDecision(res.token, it1, 'CONFIRM', { by: '', option_id: o1.option_id }); } catch (e) { noName = e.message; }
check('ต้องระบุชื่อผู้ตัดสินใจ', /เลือกชื่อ/.test(noName || ''));

dto = ctx.apiTechDecision(res.token, it1, 'CONFIRM', { by: 'ช่างสมชาย ใจดี', option_id: o1.option_id });
check('ยืนยันแล้ว -> รอเลือกวิธีซื้อ', dto.items[0].stage === 'TECH_MODE', dto.items[0].stage);
check('บันทึกชื่อ+เวลาที่ตัดสินใจ', dto.items[0].decided_by === 'ช่างสมชาย ใจดี' && /\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/.test(dto.items[0].decided_at));
check('ยืนยันสเปคยังไม่ใช่การอนุมัติ', dto.items[0].purchase_status === 'WAITING_TECH', dto.items[0].purchase_status);
check('แจ้งจัดซื้อว่าช่างยืนยัน', /ช่างยืนยันสเปคแล้ว/.test(MAIL[MAIL.length - 1].subject));

let noReason = null;
try { ctx.apiTechDecision(res.token, it2, 'REJECT', { by: 'ช่างสมชาย ใจดี', note: '' }); } catch (e) { noReason = e.message; }
check('ปฏิเสธต้องมีเหตุผล', /เหตุผล/.test(noReason || ''));
dto = ctx.apiTechDecision(res.token, it2, 'REJECT', { by: 'ช่างวิชัย แก้วมณี', option_id: dto.items[1].options[0].option_id, note: 'ช่วงทอร์คไม่พอ ต้องการถึง 300 N·m' });
check('ปฏิเสธแล้วกลับไปรอเสนอใหม่', dto.items[1].stage === 'NEED_OPTION', dto.items[1].stage);
check('ตัวเลือกถูกตีกลับ', dto.items[1].options[0].status === 'REJECTED');

section('4) เลือกวิธีซื้อ + ขั้นอนุมัติแยกต่างหาก');
dto = ctx.apiChooseMode(res.token, it1, 'SUPPLIER', { by: 'ช่างสมชาย ใจดี' });
check('เลือกให้จัดซื้อสั่ง -> รออนุมัติ', dto.items[0].stage === 'APPROVAL', dto.items[0].stage);

let lockErr = null;
try { ctx.apiTechDecision(res.token, it1, 'CONFIRM', { by: 'ช่างสมชาย ใจดี', option_id: o1.option_id }); } catch (e) { lockErr = e.message; }
check('ส่งอนุมัติแล้วช่างแก้เองไม่ได้', /ส่งให้จัดซื้อดำเนินการแล้ว/.test(lockErr || ''), lockErr);

const o2b = ctx.apiAddOption(staff.token, it2, {
  brand_model: 'Tohnichi QL280N', spec: '60-280 N·m', supplier: 'ไทยทูลส์',
  unit_price: 3400, vat_rate: 7, shipping: 0, availability: 'มีของ', delivery_date: '2026-09-20', payment_terms: 'เครดิต 30 วัน'
});
let needConfirm = null;
try { ctx.apiChooseMode(res.token, it2, 'SUPPLIER', { by: 'ช่างวิชัย แก้วมณี' }); } catch (e) { needConfirm = e.message; }
check('ยังไม่ยืนยันสเปค เลือก SUPPLIER ไม่ได้', /ยืนยันสเปค/.test(needConfirm || ''), needConfirm);

let noTax = null;
try { ctx.apiChooseMode(res.token, it2, 'LOCAL', { by: 'ช่างวิชัย แก้วมณี', local_est_price: 2150, local_store: 'Global House', tax_invoice_ok: false }); } catch (e) { noTax = e.message; }
check('ซื้อเองต้องยืนยันใบกำกับภาษี', /ใบกำกับภาษี/.test(noTax || ''), noTax);
let noPrice = null;
try { ctx.apiChooseMode(res.token, it2, 'LOCAL', { by: 'ช่างวิชัย แก้วมณี', local_store: 'Global House', tax_invoice_ok: true }); } catch (e) { noPrice = e.message; }
check('ซื้อเองต้องมีราคาประเมิน', /ราคาประเมิน/.test(noPrice || ''), noPrice);

dto = ctx.apiChooseMode(res.token, it2, 'LOCAL', { by: 'ช่างวิชัย แก้วมณี', local_est_price: 2150, local_store: 'Global House', tax_invoice_ok: true });
check('ซื้อเองที่ร้าน -> รออนุมัติ (ไม่ใช่ซื้อได้เลย)', dto.items[1].stage === 'APPROVAL' && dto.items[1].purchase_status === 'PENDING_APPROVAL');

section('5) จัดซื้ออนุมัติ / สั่งซื้อ / รับของ');
let earlyReceipt = null;
try { ctx.apiUploadReceipt(res.token, it2, { name: 'r.jpg', mime: 'image/jpeg', dataB64: tinyJpgB64 }, 'ช่างวิชัย แก้วมณี', 2100); } catch (e) { earlyReceipt = e.message; }
check('ยังไม่อนุมัติ อัปโหลดใบเสร็จไม่ได้', /ยังไม่ได้รับอนุมัติ/.test(earlyReceipt || ''), earlyReceipt);

ctx.apiApprove(staff.token, it1, true, 'ราคาเหมาะสม', 'PO-2026-0142');
ctx.apiApprove(staff.token, it2, true, 'ให้ช่างซื้อเอง ได้ของวันนี้', 'PC-2026-0088');
let st = ctx.apiStaffData(staff.token, {});
const itemsById = {}; st.items.forEach(i => itemsById[i.item_id] = i);
check('รายการ 1 -> รอสั่งซื้อ', itemsById[it1].stage === 'TO_ORDER', itemsById[it1].stage);
check('รายการ 2 -> ช่างซื้อเอง รอใบเสร็จ', itemsById[it2].stage === 'LOCAL_BUY', itemsById[it2].stage);
check('บันทึกผู้อนุมัติ', itemsById[it1].approved_by === 'คุณแนน (จัดซื้อ)' && !!itemsById[it1].approved_at);
const lineLocal = ctx.readAll_('Notifications').filter(n => /อนุมัติให้ซื้อเอง/.test(n.subject))[0];
check('ข้อความ LINE ซื้อเองแนบข้อมูลใบกำกับภาษี', !!lineLocal && /บริษัท เมวา/.test(lineLocal.message));
check('ข้อความ LINE แนบเลขที่อ้างอิง', !!lineLocal && /PC-2026-0088/.test(lineLocal.message));

ctx.apiSetPurchaseStatus(staff.token, it1, 'ORDERED', '', '');
dto = ctx.apiUploadReceipt(res.token, it2, { name: 'receipt.jpg', mime: 'image/jpeg', dataB64: tinyJpgB64 }, 'ช่างวิชัย แก้วมณี', 2090);
check('ส่งใบเสร็จแล้ว -> เสร็จสิ้น', dto.items[1].stage === 'DONE', dto.items[1].stage);
check('เก็บลิงก์ใบเสร็จ', /drive\.google\.com\/file\/d\//.test(dto.items[1].receipt_url));
check('บันทึกราคาจริงทับราคาประเมิน', ctx.num_(dto.items[1].local_est_price) === 2090);
ctx.apiSetPurchaseStatus(staff.token, it1, 'RECEIVED', '', '');
st = ctx.apiStaffData(staff.token, {});
check('ทั้งสองรายการเสร็จสิ้น', st.counts.DONE === 2, st.counts);

section('6) ประวัติ / แดชบอร์ด / แจ้งเตือน');
const h1 = ctx.apiItemHistory(staff.token, it1);
check('ประวัติรายการที่ 1 ครบทุกขั้น',
  JSON.stringify(h1.map(x => x.action)) === JSON.stringify(
    ['SUBMIT','ADD_OPTION','CONFIRM_SPEC','CHOOSE_SUPPLIER','APPROVE_PURCHASE','STATUS_ORDERED','STATUS_RECEIVED']),
  h1.map(x => x.action));
check('ประวัติเรียงตามเวลาและมีผู้ทำ', h1.every(x => x.ts && x.actor && x.role));
check('มีทั้งบทบาทช่างและจัดซื้อ', h1.some(x => x.role === 'TECH') && h1.some(x => x.role === 'PURCHASING'));
const filtered = ctx.apiStaffData(staff.token, { q: 'ทอร์ค' });
check('ค้นหาด้วยคำภาษาไทยได้', filtered.items.length === 1 && filtered.items[0].item_id === it2);
const found = ctx.apiFindMyRequests('สมชาย');
check('ค้นหาคำขอจากชื่อช่างได้', found.length === 1 && found[0].req_id === res.req_id);
ctx.apiMarkLineSent(staff.token, res.req_id);
check('ทำเครื่องหมายส่ง LINE แล้ว', ctx.readAll_('Notifications').filter(n => n.channel === 'LINE' && n.status === 'PENDING').length === 0);
const before = MAIL.length;
ctx.dailyDigest();
check('งานค้าง 0 รายการ -> ไม่ส่งสรุป', MAIL.length === before);

section('7) ใบที่ 2 + สรุปงานค้าง');
const r2 = ctx.apiSubmitRequest({ requester_name: 'ช่างนพดล ศรีสุข', required_date: '2026-10-01',
  items: [{ tool_name: 'เครื่องเจียร 4 นิ้ว', qty: 3, unit: 'ตัว', benchmark_price: 1290, benchmark_store: 'Global House' }] });
check('เลขที่ใบเรียงต่อเนื่อง', r2.req_id.endsWith('-0002'), r2.req_id);
ctx.dailyDigest();
check('มีงานค้าง -> ส่งสรุปรายวัน', MAIL.length === before + 2 && /สรุปงานค้าง/.test(MAIL[MAIL.length - 1].subject));
check('สรุปมีชื่อขั้นตอนภาษาไทย', /รอจัดซื้อเสนอตัวเลือก/.test(MAIL[MAIL.length - 1].body));

section('8) กรณีพิเศษ');
const it3 = r2.req_id + '-1';
const o3 = ctx.apiAddOption(staff.token, it3, { brand_model: 'Makita GA4030', supplier: 'ไทยทูลส์', unit_price: 1450, vat_rate: 7, shipping: 200 });
check('ค่าส่งถูกคิด VAT ด้วย ((1450*3)+200)*1.07', Math.abs(o3.total - 4868.5) < 0.001, o3.total);
ctx.apiSetPurNote(staff.token, it3, 'ที่ Global House ถูกกว่า แนะนำให้ช่างซื้อเองแล้วเบิกคืน');
let d2 = ctx.apiGetRequest(r2.token);
check('ข้อความจากจัดซื้อแสดงบนหน้าช่าง', /Global House ถูกกว่า/.test(d2.items[0].pur_note));

ctx.apiWithdrawOption(staff.token, o3.option_id);
d2 = ctx.apiGetRequest(r2.token);
check('ถอนตัวเลือกแล้วกลับไปรอเสนอราคา', d2.items[0].options.length === 0 && d2.items[0].stage === 'NEED_OPTION', d2.items[0].stage);

d2 = ctx.apiChooseMode(r2.token, it3, 'LOCAL', { by: 'ช่างนพดล ศรีสุข', local_est_price: 1290, local_store: 'Global House', tax_invoice_ok: true });
let notApproved = null;
try { ctx.apiSetPurchaseStatus(staff.token, it3, 'ORDERED', '', ''); } catch (e) { notApproved = e.message; }
check('ยังไม่อนุมัติ บันทึกว่าสั่งซื้อแล้วไม่ได้', /ต้องอนุมัติก่อน/.test(notApproved || ''), notApproved);

ctx.apiApprove(staff.token, it3, false, 'งบปีนี้เต็มแล้ว ให้รอไตรมาสหน้า', '');
d2 = ctx.apiGetRequest(r2.token);
check('ไม่อนุมัติ -> สถานะไม่อนุมัติ', d2.items[0].stage === 'PUR_REJECTED', d2.items[0].stage);
check('เก็บเหตุผลที่ไม่อนุมัติ', /งบปีนี้เต็ม/.test(d2.items[0].approval_note));
let twice = null;
try { ctx.apiApprove(staff.token, it3, true, '', ''); } catch (e) { twice = e.message; }
check('อนุมัติซ้ำไม่ได้', /รออนุมัติ/.test(twice || ''), twice);
let afterApprove = null;
try { ctx.apiAddOption(staff.token, it1, { brand_model: 'x', supplier: 'y', unit_price: 1 }); } catch (e) { afterApprove = e.message; }
check('ปิดงานแล้วเพิ่มตัวเลือกไม่ได้', /อนุมัติ\/ปิดงานแล้ว/.test(afterApprove || ''), afterApprove);
let badToken = null;
try { ctx.apiGetRequest('0000000000000000'); } catch (e) { badToken = e.message; }
check('token มั่วเปิดไม่ได้', /ไม่พบคำขอ/.test(badToken || ''));
let crossReq = null;
try { ctx.apiTechDecision(r2.token, it1, 'CONFIRM', { by: 'ช่างนพดล ศรีสุข', option_id: o1.option_id }); } catch (e) { crossReq = e.message; }
check('ใช้ token ใบหนึ่งไปแก้อีกใบไม่ได้', /ไม่พบรายการ/.test(crossReq || ''), crossReq);
let badFile = null;
try { ctx.saveUpload_({ name: 'x.exe', mime: 'application/x-msdownload', dataB64: tinyJpgB64 }, 'x'); } catch (e) { badFile = e.message; }
check('อัปโหลดไฟล์นอกเหนือรูป/PDF ไม่ได้', /รูปภาพและไฟล์ PDF/.test(badFile || ''));
check('ข้อมูลในชีต Items ครบทุกคอลัมน์', ctx.readAll_('Items')[0] && Object.keys(ctx.readAll_('Items')[0]).length === 31);

console.log('\n----------------------------------------');
console.log('ผ่าน ' + pass + ' / ล้มเหลว ' + fail);
process.exit(fail ? 1 : 0);
