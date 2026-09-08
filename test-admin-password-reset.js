const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require(path.join(__dirname, 'diecut-schedule', 'node_modules', 'better-sqlite3'));

const root = path.join(__dirname, 'diecut-schedule');
const utilPath = path.join(root, 'scripts', 'reset-admin-password.js');
if (!fs.existsSync(utilPath)) throw new Error('admin password reset utility missing');

const { hashPassword, resetAdminPassword } = require(utilPath);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diecut-admin-reset-'));
const dbPath = path.join(tmpDir, 'test.db');

function verify(password, stored) {
  const raw = String(stored || '');
  if (!raw.startsWith('scrypt$')) return raw === password;
  const [, salt, hex] = raw.split('$');
  const actual = require('crypto').scryptSync(password, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return expected.length === actual.length && require('crypto').timingSafeEqual(expected, actual);
}

try {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT, created_at TEXT)`);
  db.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY, order_number TEXT)`);
  db.exec(`CREATE TABLE product_data (id INTEGER PRIMARY KEY, product_code TEXT)`);
  db.exec(`CREATE TABLE machines (id INTEGER PRIMARY KEY, name TEXT)`);
  db.exec(`CREATE TABLE schedules (id INTEGER PRIMARY KEY, order_id INTEGER)`);
  db.prepare('INSERT INTO users(username,password,role,created_at) VALUES (?,?,?,?)')
    .run('admin', hashPassword('OldPass123!'), 'admin', new Date().toISOString());
  db.prepare('INSERT INTO orders(order_number) VALUES (?)').run('KEEP-ORDER');
  db.prepare('INSERT INTO product_data(product_code) VALUES (?)').run('KEEP-PRODUCT');
  db.prepare('INSERT INTO machines(name) VALUES (?)').run('KEEP-MACHINE');
  db.prepare('INSERT INTO schedules(order_id) VALUES (1)').run();
  db.close();

  const result = resetAdminPassword(dbPath, 'NewAdmin123!');
  if (!result.updated || result.created) throw new Error('existing admin should be updated');

  const check = new Database(dbPath);
  const user = check.prepare('SELECT username,password,role FROM users WHERE username=?').get('admin');
  if (!user || !verify('NewAdmin123!', user.password)) throw new Error('new admin password verification failed');
  if (user.role !== 'admin') throw new Error('admin role changed unexpectedly');
  if (!check.prepare('SELECT id FROM orders WHERE order_number=?').get('KEEP-ORDER')) throw new Error('orders data was modified');
  if (!check.prepare('SELECT id FROM product_data WHERE product_code=?').get('KEEP-PRODUCT')) throw new Error('product data was modified');
  if (!check.prepare('SELECT id FROM machines WHERE name=?').get('KEEP-MACHINE')) throw new Error('machine data was modified');
  if (!check.prepare('SELECT id FROM schedules WHERE order_id=1').get()) throw new Error('schedule data was modified');
  check.close();

  console.log('ADMIN_PASSWORD_RESET_AND_DATA_PRESERVATION_OK');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
