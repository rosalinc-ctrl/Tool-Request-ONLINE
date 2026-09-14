/**
 * Meiwa Tool Request — Files.gs
 * อัปโหลดรูป/ใบเสร็จลง Google Drive
 */

function rootFolder_() {
  var id = String(cfg_('DRIVE_FOLDER_ID', ''));
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* หา folder ไม่เจอ -> สร้างใหม่ */ }
  }
  var f = DriveApp.createFolder('Meiwa Tool Request - Files');
  setCfg_('DRIVE_FOLDER_ID', f.getId());
  return f;
}

function subFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function sanitizeName_(n) {
  return String(n || 'file').replace(/[\\\/:*?"<>|]/g, '_').substring(0, 80);
}

/**
 * file = { name, mime, dataB64 }
 * คืน { id, name, url }
 */
function saveUpload_(file, subName, prefix) {
  if (!file || !file.dataB64) throw new Error('ไฟล์ไม่ถูกต้อง / Invalid file');
  var mime = file.mime || 'image/jpeg';
  var allowed = /^(image\/|application\/pdf)/.test(mime);
  if (!allowed) throw new Error('รองรับเฉพาะรูปภาพและไฟล์ PDF / Images or PDF only');

  var bytes = Utilities.base64Decode(file.dataB64);
  if (bytes.length > 12 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 12MB / File too large');

  var name = sanitizeName_((prefix ? prefix + '_' : '') + (file.name || 'photo.jpg'));
  var blob = Utilities.newBlob(bytes, mime, name);
  var f = subFolder_(rootFolder_(), subName || 'general').createFile(blob);
  try {
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    // โดเมนอาจปิดการแชร์แบบลิงก์ — รูปจะดูได้เฉพาะคนที่มีสิทธิ์ Drive
  }
  return { id: f.getId(), name: f.getName(), url: 'https://drive.google.com/file/d/' + f.getId() + '/view' };
}

function driveIdFromUrl_(url) {
  var m = String(url || '').match(/[-\w]{25,}/);
  return m ? m[0] : '';
}
