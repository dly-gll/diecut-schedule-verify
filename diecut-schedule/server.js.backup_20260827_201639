// ===== 生产环境启动校验 =====
if (process.env.NODE_ENV === "production") {
  const errors = [];
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    errors.push("SESSION_SECRET must be set and at least 32 characters in production");
  }
  if (!process.env.DEFAULT_ADMIN_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD.length < 8) {
    errors.push("DEFAULT_ADMIN_PASSWORD must be set and at least 8 characters in production");
  }
  if (errors.length) {
    console.error("Startup validation failed:");
    errors.forEach(e => console.error("  - " + e));
    process.exit(1);
  }
}

// V5.1.2-BUSINESS-LOGIC-VERIFIED
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('better-sqlite3');
const bodyParser = require('body-parser');
const session = require('express-session');
const XLSX = require('xlsx');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.disable('x-powered-by');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.SOCKET_ORIGIN || true,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

const db = new sqlite3('data.db');

// 初始化数据库
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  role TEXT DEFAULT 'viewer',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  machine_type TEXT,
  status TEXT DEFAULT 'active',
  remark TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT,
  product_code TEXT,
  product_name TEXT,
  quantity INTEGER,
  shipping_quantity INTEGER DEFAULT 0,
  delivery_time TEXT,
  capacity INTEGER DEFAULT 1000,
  mold TEXT,
  mold_change_time INTEGER DEFAULT 30,
  process TEXT,
  status TEXT DEFAULT 'pending',
  remark TEXT
);
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  machine_id INTEGER,
  start_time TEXT,
  end_time TEXT,
  mold_change_start TEXT,
  mold_change_end TEXT,
  planned_quantity INTEGER,
  status TEXT DEFAULT 'scheduled',
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  work_start TEXT DEFAULT '08:00',
  work_end TEXT DEFAULT '20:00',
  break_lunch_start TEXT DEFAULT '12:00',
  break_lunch_end TEXT DEFAULT '13:00',
  break_dinner_start TEXT DEFAULT '17:30',
  break_dinner_end TEXT DEFAULT '18:00'
);
CREATE TABLE IF NOT EXISTS product_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT UNIQUE NOT NULL,
  product_name TEXT,
  mold TEXT,
  process TEXT,
  capacity INTEGER DEFAULT 1000,
  mold_change_time INTEGER DEFAULT 30,
  remark TEXT
);
CREATE TABLE IF NOT EXISTS setup_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_family TEXT NOT NULL,
  to_family TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 30,
  UNIQUE(from_family, to_family)
);
`);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    details TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orders_status_delivery ON orders(status, delivery_time);
  CREATE INDEX IF NOT EXISTS idx_schedules_machine_start ON schedules(machine_id, start_time);
  CREATE INDEX IF NOT EXISTS idx_schedules_order_status ON schedules(order_id, status);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
  CREATE TABLE IF NOT EXISTS schedule_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    change_type TEXT NOT NULL,
    summary TEXT,
    before_json TEXT,
    after_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_schedule_changes_created_at ON schedule_changes(created_at);
`);

// 兼容旧数据库：按需补充 APS 字段。
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('orders', 'priority', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('orders', 'material_ready_at', 'TEXT');
ensureColumn('orders', 'shipping_required_date', 'TEXT');
ensureColumn('orders', 'delivery_date', 'TEXT');
ensureColumn('orders', 'workflow_stage', "TEXT DEFAULT 'unknown'");
ensureColumn('orders', 'workflow_status_text', 'TEXT');
ensureColumn('orders', 'workflow_expected_date', 'TEXT');
ensureColumn('orders', 'workflow_last_import_date', 'TEXT');
ensureColumn('orders', 'workflow_actual_ready_date', 'TEXT');
ensureColumn('orders', 'workflow_actual_issue_date', 'TEXT');
ensureColumn('orders', 'workflow_actual_start_date', 'TEXT');
ensureColumn('orders', 'workflow_actual_finish_date', 'TEXT');
ensureColumn('orders', 'workflow_production_progress', 'TEXT');
ensureColumn('orders', 'workflow_material_status', 'TEXT');
ensureColumn('orders', 'workflow_shortage_detail', 'TEXT');
ensureColumn('orders', 'machine_tokens', 'TEXT');
ensureColumn('product_data', 'machines', 'TEXT');
ensureColumn('product_data', 'mold_count', 'REAL');
ensureColumn('product_data', 'jump_distance', 'REAL');


// V5.1 生产四板块/每日快照
 db.exec(`
  CREATE TABLE IF NOT EXISTS workflow_import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    filename TEXT,
    row_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS workflow_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER,
    snapshot_date TEXT NOT NULL,
    work_order_number TEXT,
    product_code TEXT,
    product_name TEXT,
    stage TEXT NOT NULL,
    status_text TEXT,
    expected_date TEXT,
    quantity REAL DEFAULT 0,
    sheet_name TEXT,
    raw_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_workflow_snapshots_date_stage ON workflow_snapshots(snapshot_date, stage);
  CREATE INDEX IF NOT EXISTS idx_workflow_snapshots_work_order_date ON workflow_snapshots(work_order_number, snapshot_date);
  CREATE TABLE IF NOT EXISTS product_supply (
    product_code TEXT PRIMARY KEY,
    inventory_qty REAL DEFAULT 0,
    inspection_qty REAL DEFAULT 0,
    sales_qty REAL DEFAULT 0,
    delivery_qty REAL DEFAULT 0,
    shipping_gap REAL DEFAULT 0,
    shortage_qty REAL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_product_supply_shortage ON product_supply(shortage_qty);
  CREATE TABLE IF NOT EXISTS workflow_daily_kpi (
    kpi_date TEXT NOT NULL,
    stage TEXT NOT NULL,
    expected_count INTEGER DEFAULT 0,
    actual_count INTEGER DEFAULT 0,
    rate REAL DEFAULT 0,
    alert_count INTEGER DEFAULT 0,
    notes TEXT,
    PRIMARY KEY(kpi_date, stage)
  );
`);

// workflow_snapshots 表创建完成后再补充兼容字段。
ensureColumn('workflow_snapshots', 'shipping_required_date', 'TEXT');
ensureColumn('workflow_snapshots', 'delivery_date', 'TEXT');
ensureColumn('workflow_snapshots', 'expected_ready_date', 'TEXT');
ensureColumn('workflow_snapshots', 'expected_issue_date', 'TEXT');
ensureColumn('workflow_snapshots', 'expected_start_date', 'TEXT');
ensureColumn('workflow_snapshots', 'expected_finish_date', 'TEXT');
ensureColumn('workflow_snapshots', 'production_progress', 'TEXT');
ensureColumn('workflow_snapshots', 'material_status', 'TEXT');
ensureColumn('workflow_snapshots', 'shortage_detail', 'TEXT');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const raw = String(stored || '');
  if (!raw.startsWith('scrypt$')) return raw === String(password);
  const [, salt, hex] = raw.split('$');
  if (!salt || !hex) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function recordScheduleChange(req, changeType, summary, beforeValue = {}, afterValue = {}) {
  try {
    db.prepare(`
      INSERT INTO schedule_changes(user_id, change_type, summary, before_json, after_json, created_at)
      VALUES (?,?,?,?,?,?)
    `).run(
      req.session?.user?.id || null,
      changeType,
      String(summary || ''),
      JSON.stringify(beforeValue || {}),
      JSON.stringify(afterValue || {}),
      new Date().toISOString()
    );
  } catch (err) {
    console.error('schedule change log failed:', err.message);
  }
}

function audit(req, action, entity = '', entityId = '', details = {}) {
  try {
    db.prepare(`
      INSERT INTO audit_logs(user_id, action, entity, entity_id, details, ip, created_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      req.session?.user?.id || null,
      action,
      entity,
      entityId === null || entityId === undefined ? '' : String(entityId),
      JSON.stringify(details),
      req.ip || '',
      new Date().toISOString()
    );
  } catch (err) {
    console.error('audit log failed:', err.message);
  }
}

// 默认管理员：仅在不存在时创建；密码以 scrypt 存储
if (!db.prepare('SELECT id FROM users WHERE username = ?').get('admin')) {
  db.prepare('INSERT INTO users (username, password, role, created_at) VALUES (?,?,?,?)')
    .run('admin', hashPassword(process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex')), 'admin', new Date().toISOString());
} else {
  // 兼容旧数据库：首次登录时会自动把明文密码迁移为 scrypt。
}

// 默认设置
if (!db.prepare('SELECT id FROM settings').get()) {
  db.prepare('INSERT INTO settings (id) VALUES (1)').run();
}

// 默认示例设备
if (db.prepare('SELECT COUNT(*) as cnt FROM machines').get().cnt === 0) {
  db.prepare('INSERT INTO machines (name, machine_type, status) VALUES (?,?,?)').run('平压平1号', '平压平模切机', 'active');
  db.prepare('INSERT INTO machines (name, machine_type, status) VALUES (?,?,?)').run('激光切割A', '激光模切机', 'active');
}

// 中间件
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ limit: '20mb', extended: true, parameterLimit: 5000 }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));
app.use(express.static('public'));

const loginAttempts = new Map();
function checkLoginRateLimit(req, username) {
  const key = `${req.ip}|${String(username || '').toLowerCase()}`;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 12;
  const item = loginAttempts.get(key);
  if (!item || now - item.first > windowMs) {
    loginAttempts.set(key, { first: now, count: 1 });
    return true;
  }
  if (item.count >= maxAttempts) return false;
  item.count += 1;
  return true;
}
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, item] of loginAttempts.entries()) {
    if (item.first < cutoff) loginAttempts.delete(key);
  }
}, 10 * 60 * 1000).unref();

// 权限中间件
function requireCsrf(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const token = req.get('x-csrf-token');
  if (!req.session?.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ success: false, message: '安全校验失败，请刷新页面后重试' });
  }
  next();
}
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ success: false, message: '请先登录' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).json({ success: false, message: '仅管理员可操作' });
  next();
}
function requireAdminEdit(req, res, next) {
  requireAdmin(req, res, () => requireCsrf(req, res, next));
}
function requireEdit(req, res, next) {
  if (!req.session.user || req.session.user.role === 'viewer')
    return res.status(403).json({ success: false, message: '没有操作权限' });
  requireCsrf(req, res, () => next());
}

// ================== 认证 ==================
app.get('/api/auth/status', (req, res) => {
  if (req.session.user) {
    req.session.csrfToken ||= crypto.randomBytes(24).toString('hex');
    req.session.user.csrf_token = req.session.csrfToken;
    res.json({ logged_in: true, user: req.session.user });
  } else {
    res.json({ logged_in: false });
  }
});

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body?.username || '').trim().slice(0, 100);
  const password = String(req.body?.password || '');
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '请输入用户名和密码' });
  }
  if (!checkLoginRateLimit(req, username)) {
    return res.status(429).json({ success: false, message: '登录尝试过于频繁，请 15 分钟后再试' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ success: false, message: '用户名或密码错误' });
  }

  // 兼容旧库：登录成功后自动迁移明文密码。
  if (!String(user.password || '').startsWith('scrypt$')) {
    db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(password), user.id);
  }

  req.session.regenerate((err) => {
    if (err) {
      console.error('session regenerate failed:', err);
      return res.status(500).json({ success: false, message: '登录会话初始化失败' });
    }
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    req.session.user = { id: user.id, username: user.username, role: user.role, csrf_token: req.session.csrfToken };
    audit(req, 'login', 'user', user.id);
    res.json({ success: true, user: req.session.user });
  });
});

app.post('/api/auth/logout', requireCsrf, (req, res) => {
  audit(req, 'logout', 'user', req.session?.user?.id || '');
  req.session.destroy(() => res.json({ success: true }));
});

app.post('/api/auth/change-password', requireAuth, (req, res, next) => requireCsrf(req, res, next), (req, res) => {
  const oldPassword = String(req.body?.oldPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!oldPassword || !newPassword) {
    return res.json({ success: false, message: '原密码和新密码不能为空' });
  }
  if (newPassword.length < 6) {
    return res.json({ success: false, message: '新密码至少需要 6 位' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!user || !verifyPassword(oldPassword, user.password)) {
    return res.json({ success: false, message: '原密码错误' });
  }
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(newPassword), req.session.user.id);
  audit(req, 'change_password', 'user', req.session.user.id);
  res.json({ success: true, message: '密码修改成功' });
});

// ================== 用户管理（管理员） ==================
app.get('/api/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users').all();
  res.json({ users });
});

app.post('/api/users', requireAdminEdit, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.json({ success: false, message: '用户名和密码不能为空' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username))
    return res.json({ success: false, message: '用户名已存在' });
  const validRoles = ['admin', 'editor', 'viewer'];
  const userRole = validRoles.includes(role) ? role : 'viewer';
  db.prepare('INSERT INTO users (username, password, role, created_at) VALUES (?,?,?,?)')
    .run(username.trim().slice(0, 100), hashPassword(password), userRole, new Date().toISOString());
  audit(req, 'create', 'user', '', { username: username.trim(), role: userRole });
  res.json({ success: true });
});

app.delete('/api/users/:id', requireAdminEdit, (req, res) => {
  const { id } = req.params;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.json({ success: false, message: '用户不存在' });
  if (user.username === 'admin') return res.json({ success: false, message: '不能删除超级管理员' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  audit(req, 'delete', 'user', id, { username: user.username });
  res.json({ success: true });
});


// ================== V5.1 车间四板块工作流 ==================
const WORKFLOW_STAGES = {
  shortage: '欠料',
  available_to_issue: '有料待发',
  waiting_schedule: '车间待排',
  in_process: '车间在制',
  completed: '已完工',
  unknown: '未识别'
};
const WORKFLOW_STAGE_ORDER = ['shortage','available_to_issue','waiting_schedule','in_process','completed'];

function todayISO() { return new Date().toISOString().slice(0,10); }

function parseTextDateFromString(text, keywordList = []) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const direct = normalizeImportedDate(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const m = raw.match(/(\d{1,2})\s*[\/\-月]\s*(\d{1,2})\s*日?/);
  if (!m) return null;
  const y = new Date().getFullYear();
  const d = new Date(y, Number(m[1])-1, Number(m[2]));
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function detectWorkflowStage(row) {
  const progress = normalizeImportText(findImportValue(row, ['生产进度','生产状态','生产阶段','production progress','progress']));
  const material = normalizeImportText(findImportValue(row, ['是否齐料','齐料状态','物料状态','材料状态','material status']));
  const shortageDetail = normalizeImportText(findImportValue(row, ['欠料明细','欠料原因','缺料明细','缺料原因','shortage detail']));
  const statusCode = normalizeImportText(findImportValue(row, ['状态码','状态','工单状态','订单状态','status']));
  const p = progress.toLowerCase(), m = material.toLowerCase(), sd = shortageDetail.toLowerCase(), sc = statusCode.toLowerCase();
  if (/成品检验中|成品已完工|已完工|完工|结案/.test(p)) return 'completed';
  if (/欠料|缺料|缺材料|欠材|待采购回复|待厂商合同|待财务付款|待厂内.*回货|待通知交货|待回复|未齐|不齐|不全|不够|^(否|no)$/i.test(m) || /欠料|缺料|缺材料|欠材|待采购回复|待厂商合同|待财务付款|待厂内.*回货|待通知交货|待回复/.test(sd)) return 'shortage';
  if (/车间在制|在制|生产中|生产进行中|已开工|生产执行/.test(p)) return 'in_process';
  if (/车间待排|待排产|待排|等待排产|已发料|已排待制|待制/.test(p) || /已发料/.test(sc)) return 'waiting_schedule';
  if (/齐料|已齐料|物料齐套/.test(m) && !/车间在制|在制|生产中|已开工/.test(p)) return 'waiting_schedule';
  if (/仓库有料|有料待发|有料|待发料|待发|待分切|分切/.test(m) || /有料待发|待发料|待发/.test(p)) return 'available_to_issue';
  if (/外发|外购|众鑫源|江杉|美佳信|业健宏|五金冲压|正峰|恒基|泰尔森|英利悦|楚锋|众彩|创智捷/.test(p)) return 'in_process';
  return 'unknown';
}

function extractWorkflowRow(row, index, productMap, excelContext = {}) {
  const productCode = normalizeProductCode(findImportValue(row, [
    '品号','产品品号','料号','产品编号','产品代码','物料编码','物料号','product_code','item code','itemcode','part no'
  ]));
  const product = productMap.get(productCode) || null;
  const importSnapshotDate = excelContext.snapshotDate || todayISO();
  const orderNumber = normalizeImportText(findImportValue(row, [
    '工单编号','工单号','订单号','订单编号','制造单号','生产单号','work order','wo','wo no','生产工单'
  ]));
  const productName = normalizeImportText(findImportValue(row, [
    '品名','产品名称','物料名称','产品名','product_name','item name'
  ])) || normalizeImportText(product?.product_name) || normalizeImportText(excelContext.productNames?.get(productCode));
  const quantity = numberOr(findImportValue(row, [
    '工单数量','订单数量','需求数量','生产数量','计划数量','数量','qty','pcs','预计产量'
  ]), 0);
  const stage = detectWorkflowStage(row);
  const fullText = Object.values(row || {}).map(v => normalizeImportText(v)).join(' | ');
  const productionProgress = normalizeImportText(findImportValue(row, ['生产进度','生产状态','生产阶段','production progress','progress']));
  const materialStatus = normalizeImportText(findImportValue(row, ['是否齐料','齐料状态','物料状态','材料状态','material status']));
  const shortageDetail = normalizeImportText(findImportValue(row, ['欠料明细','欠料原因','缺料明细','缺料原因','shortage detail']));
  const statusCode = normalizeImportText(findImportValue(row, ['状态码','工单状态','订单状态','status']));

  // 工单看板的交期以“在制工单明细”本行的明确日期为准；只有本行完全没有日期时才回退到每日急件表。
  // 工单看板严格使用“在制工单明细”本行的日期；不再用品号级每日急件日期覆盖工单日期，避免出现与 Excel 不一致的日期。
  const shippingRequiredDate = normalizeImportedDate(findImportValue(row, [
    '要求出货时间','出货需求日期','出货需求时间','客户出货需求日期','客户要求出货日期','要求出货日期','ship date','requested ship date'
  ])) || null;
  const deliveryDate = normalizeImportedDate(findImportValue(row, [
    '交货日期','交货时间','客户交货日期','要求交货日期','要求交货时间','delivery_date','delivery date'
  ])) || null;

  const explicitExpected = normalizeImportedDate(findImportValue(row, [
    '预计日期','计划日期','应齐料日期','齐料日期','到料日期','发料日期','预计发料日期','预计开工日期','开工日期','计划开工日期','预计完工日期','应完工日期','expected date'
  ]));
  let expectedDate = explicitExpected || null;
  if (!expectedDate && /(齐料|到料|发料|开工|完工)/.test(fullText)) expectedDate = parseTextDateFromString(fullText);
  if (/待采购回复/.test(fullText) && !/8[\/月.-]\s*\d{1,2}/.test(fullText)) expectedDate = null;

  const materialText = `${materialStatus} ${shortageDetail}`.trim();
  // “欠料，8/26齐料”“欠料，8/24-25齐料”等日期必须从“是否齐料/欠料明细”专列解析，不能从整行第一个日期猜。
  const readyDate = normalizeImportedDate(findImportValue(row, [
    '齐料日期','应齐料日期','到料日期','预计齐料日期','预计到料日期'
  ])) || parseTextDateFromString(materialText);
  const startDate = normalizeImportedDate(findImportValue(row, [
    '预计开工','预计开工日期','开工日期','计划开工日期','预计上线日期'
  ])) || (stage === 'waiting_schedule' ? expectedDate : null);
  const issueDate = normalizeImportedDate(findImportValue(row, [
    '发料日期','预计发料日期','实发料日期','应发料日期'
  ])) || (stage === 'available_to_issue' ? importSnapshotDate : null);
  const finishDate = normalizeImportedDate(findImportValue(row, [
    '预计完工日期','完工日期','计划完工日期','应完工日期'
  ])) || (stage === 'in_process' ? expectedDate : null);

  const inventoryQty = excelContext.inventory?.get(productCode) ?? numberOr(findImportValue(row, ['库存数量','库存','在库数量','inventory']), NaN);
  const inspectionQty = excelContext.inspection?.get(productCode) ?? numberOr(findImportValue(row, ['待检数量','待检','检验中数量','inspection','pending inspection']), NaN);
  const salesQty = excelContext.sales?.get(productCode) ?? numberOr(findImportValue(row, ['销货数量','销售数量','已销货数量','sales quantity']), NaN);
  const deliveryQty = excelContext.delivery?.get(productCode) ?? numberOr(findImportValue(row, ['交货数量','已交货数量','出货数量','已出货数量','delivery quantity']), NaN);

  // 以“每日急件满足进度”的预计算出货欠数为准；只有该表无值时才回退公式。
  const precomputedGap = excelContext.urgentGap?.get(productCode);
  const computedGap = (Number.isFinite(inventoryQty) || Number.isFinite(inspectionQty) || Number.isFinite(salesQty) || Number.isFinite(deliveryQty))
    ? (Number.isFinite(inventoryQty)?inventoryQty:0) + (Number.isFinite(inspectionQty)?inspectionQty:0) + (Number.isFinite(salesQty)?salesQty:0) - (Number.isFinite(deliveryQty)?deliveryQty:0)
    : NaN;
  const shippingGap = Number.isFinite(precomputedGap) ? precomputedGap : (Number.isFinite(computedGap) ? computedGap : null);

  let mold = normalizeImportText(findImportValue(row, ['刀模','刀模号','刀模编号','模具','模具号','模具编号','mold','die']));
  let process = normalizeImportText(findImportValue(row, ['工艺','制程','工序','process']));
  let machineTokens = normalizeImportText(findImportValue(row, ['机台配置','设备','设备名称','设备编号','机台','机台号','机器','生产设备','machine','machine name']));
  let capacity = numberOr(findImportValue(row, ['产能','UPH','uph','PCS/H','pcs/h','每小时产能','标准产能']), 0);
  let moldChange = numberOr(findImportValue(row, ['换模时间','换刀模时间','换模分钟','setup time','setup minutes']), 0);

  const excelMaster = excelContext.products?.get(productCode) || null;
  if (product) {
    if (normalizeImportText(product.mold)) mold=normalizeImportText(product.mold); else if (!mold && normalizeImportText(excelMaster?.mold)) mold=normalizeImportText(excelMaster.mold);
    if (normalizeImportText(product.process)) process=normalizeImportText(product.process); else if (!process && normalizeImportText(excelMaster?.process)) process=normalizeImportText(excelMaster.process);
    if (normalizeImportText(product.machines)) machineTokens=normalizeImportText(product.machines); else if (!machineTokens && normalizeImportText(excelMaster?.machines)) machineTokens=normalizeImportText(excelMaster.machines);
    if (Number(product.capacity)>0) capacity=Number(product.capacity); else if (!(capacity>0) && Number(excelMaster?.capacity)>0) capacity=Number(excelMaster.capacity);
    if (Number.isFinite(Number(product.mold_change_time)) && Number(product.mold_change_time)>=0) moldChange=Number(product.mold_change_time); else if (Number.isFinite(Number(excelMaster?.mold_change_time)) && Number(excelMaster?.mold_change_time)>=0) moldChange=Number(excelMaster.mold_change_time);
  } else if (excelMaster) {
    if (!mold && normalizeImportText(excelMaster.mold)) mold=normalizeImportText(excelMaster.mold);
    if (!process && normalizeImportText(excelMaster.process)) process=normalizeImportText(excelMaster.process);
    if (!machineTokens && normalizeImportText(excelMaster.machines)) machineTokens=normalizeImportText(excelMaster.machines);
    if (!(capacity>0) && Number(excelMaster.capacity)>0) capacity=Number(excelMaster.capacity);
    if (!(moldChange>=0) && Number.isFinite(Number(excelMaster.mold_change_time))) moldChange=Number(excelMaster.mold_change_time);
  }
  if (!(capacity > 0)) capacity = 1000;
  if (!(moldChange >= 0)) moldChange = 30;

  // 外购/外发不要求设备。
  const external = /外购|委外|外发/.test(`${mold}|${process}|${machineTokens}`);
  // 看板/KPI 的阶段计划日期必须跟随当前板块：欠料=预计齐料，有料待发=预计发料，待排=预计开工，在制=预计完工。
  // 不再把整行泛化的“计划日期”带到所有板块，避免历史计划日期污染当前阶段。
  const stageExpectedDate = stage === 'shortage' ? (readyDate || null)
    : stage === 'available_to_issue' ? (issueDate || null)
    : stage === 'waiting_schedule' ? (startDate || null)
    : stage === 'in_process' ? (finishDate || null)
    : stage === 'completed' ? (finishDate || expectedDate || null)
    : (expectedDate || null);

  const note = normalizeImportText(findImportValue(row, ['备注','说明','原因','备注说明','comment','note'])) || fullText.slice(0,500);
  return {
    work_order_number: orderNumber || null,
    product_code: productCode,
    product_name: productName,
    quantity,
    stage,
    status_text: fullText.slice(0,1000),
    production_progress: productionProgress,
    material_status: materialStatus,
    shortage_detail: shortageDetail,
    expected_date: stageExpectedDate,
    expected_ready_date: readyDate,
    expected_issue_date: issueDate,
    expected_start_date: startDate,
    expected_finish_date: finishDate,
    shipping_required_date: shippingRequiredDate,
    delivery_date: deliveryDate,
    inventory_qty: Number.isFinite(inventoryQty) ? inventoryQty : 0,
    inspection_qty: Number.isFinite(inspectionQty) ? inspectionQty : 0,
    sales_qty: Number.isFinite(salesQty) ? salesQty : 0,
    delivery_qty: Number.isFinite(deliveryQty) ? deliveryQty : 0,
    shipping_gap: Number.isFinite(shippingGap) ? shippingGap : 0,
    mold,
    process,
    machine_tokens: machineTokens,
    capacity,
    mold_change_time: moldChange,
    external,
    note,
    sheet_name: normalizeImportText(row.__sheet_name || row.__sheet || '') || null,
    row_index: index + 2
  };
}
function workflowStageRank(stage) { return WORKFLOW_STAGE_ORDER.indexOf(stage) >= 0 ? WORKFLOW_STAGE_ORDER.indexOf(stage) : 0; }

function getWorkflowOrderRow(orderNumber, productCode) {
  // 有明确工单号时，只允许按工单号匹配；绝不能按品号兜底，否则同品号多工单会互相覆盖。
  if (orderNumber) {
    return db.prepare('SELECT * FROM orders WHERE order_number=? ORDER BY id DESC LIMIT 1').get(orderNumber) || null;
  }
  // 只有 Excel 没有工单号时，才允许按品号寻找可复用的未完工订单。
  if (productCode) {
    return db.prepare("SELECT * FROM orders WHERE product_code=? AND status IN ('pending','scheduled','running') ORDER BY CASE WHEN workflow_stage='waiting_schedule' THEN 0 WHEN workflow_stage='in_process' THEN 1 ELSE 2 END, id ASC LIMIT 1").get(productCode) || null;
  }
  return null;
}

function updateWorkflowTransition(order, stage, snapshotDate, expectedDate=null, statusText='') {
  if (!order) return;
  const prev = order.workflow_stage || 'unknown';
  // 每次导入都以“当前板块的计划日期”为准；当前没有计划日期就清空，避免旧的 04/30、05/31 等历史值残留。
  const patch = { stage, workflow_status_text: statusText || null, workflow_expected_date: expectedDate || null };
  if (stage !== prev) {
    const from = workflowStageRank(prev), to = workflowStageRank(stage);
    if (to >= workflowStageRank('available_to_issue') && !order.workflow_actual_ready_date) patch.workflow_actual_ready_date = snapshotDate;
    if (to >= workflowStageRank('waiting_schedule') && !order.workflow_actual_issue_date) patch.workflow_actual_issue_date = snapshotDate;
    if (to >= workflowStageRank('in_process') && !order.workflow_actual_start_date) patch.workflow_actual_start_date = snapshotDate;
    if (to >= workflowStageRank('completed') && !order.workflow_actual_finish_date) patch.workflow_actual_finish_date = snapshotDate;
  }
  db.prepare(`UPDATE orders SET workflow_stage=?, workflow_status_text=COALESCE(NULLIF(?,''),workflow_status_text), workflow_expected_date=?, workflow_last_import_date=?, workflow_actual_ready_date=COALESCE(?,workflow_actual_ready_date), workflow_actual_issue_date=COALESCE(?,workflow_actual_issue_date), workflow_actual_start_date=COALESCE(?,workflow_actual_start_date), workflow_actual_finish_date=COALESCE(?,workflow_actual_finish_date) WHERE id=?`).run(
    stage, patch.workflow_status_text, patch.workflow_expected_date, snapshotDate,
    patch.workflow_actual_ready_date || null, patch.workflow_actual_issue_date || null, patch.workflow_actual_start_date || null, patch.workflow_actual_finish_date || null,
    order.id
  );
}

function recalcWorkflowDailyKpi(kpiDate) {
  const target = String(kpiDate || todayISO()).slice(0,10);
  const prev = new Date(`${target}T00:00:00`); prev.setDate(prev.getDate()-1);
  const prevDate = prev.toISOString().slice(0,10);
  const expected = {shortage:0, available_to_issue:0, waiting_schedule:0, in_process:0};
  const actual = {shortage:0, available_to_issue:0, waiting_schedule:0, in_process:0};
  const alerts = {shortage:0, available_to_issue:0, waiting_schedule:0, in_process:0};

  const prevRows = db.prepare(`SELECT * FROM workflow_snapshots WHERE snapshot_date=?`).all(prevDate);
  for (const r of prevRows) {
    if (r.stage==='shortage' && r.expected_date && r.expected_date <= prevDate) expected.shortage++;
    if (r.stage==='available_to_issue' && r.expected_date && r.expected_date <= prevDate) expected.available_to_issue++;
    if (r.stage==='waiting_schedule' && r.expected_date && r.expected_date <= prevDate) expected.waiting_schedule++;
    if (r.stage==='in_process' && r.expected_date && r.expected_date <= prevDate) expected.in_process++;
  }
  const currentByWo = new Map(db.prepare(`SELECT work_order_number, MAX(id) id FROM workflow_snapshots WHERE snapshot_date=? GROUP BY work_order_number`).all(target).map(x=>[x.work_order_number,x.id]));
  const currentIds = [...currentByWo.values()];
  const currentRows = currentIds.length ? db.prepare(`SELECT * FROM workflow_snapshots WHERE id IN (${currentIds.map(()=>'?').join(',')})`).all(...currentIds) : [];
  const currentMap = new Map(currentRows.map(r=>[r.work_order_number,r]));

  for (const r of prevRows) {
    const cur = currentMap.get(r.work_order_number);
    if (r.stage==='shortage' && r.expected_date && r.expected_date <= prevDate) {
      if (cur && cur.stage !== 'shortage') actual.shortage++;
      else alerts.shortage++;
    }
    if (r.stage==='available_to_issue' && r.expected_date && r.expected_date <= prevDate) {
      if (cur && ['waiting_schedule','in_process','completed'].includes(cur.stage)) actual.available_to_issue++;
      else alerts.available_to_issue++;
    }
    if (r.stage==='waiting_schedule' && r.expected_date && r.expected_date <= prevDate) {
      if (cur && ['in_process','completed'].includes(cur.stage)) actual.waiting_schedule++;
      else alerts.waiting_schedule++;
    }
    if (r.stage==='in_process' && r.expected_date && r.expected_date <= prevDate) {
      if (cur && cur.stage==='completed') actual.in_process++;
      else alerts.in_process++;
    }
  }
  // 达成率：实际完成 / 应完成。兼容用户现场“实际/应”的习惯。
  const rows = ['shortage','available_to_issue','waiting_schedule','in_process'].map(stage=>({
    kpi_date:target, stage,
    expected_count:expected[stage], actual_count:actual[stage],
    rate:expected[stage] ? Number((actual[stage]/expected[stage]*100).toFixed(1)) : 100,
    alert_count:alerts[stage],
    notes: alerts[stage] ? `有${alerts[stage]}笔昨日应完成但今日仍未转段或数据未刷新` : ''
  }));
  const up = db.prepare(`INSERT INTO workflow_daily_kpi(kpi_date,stage,expected_count,actual_count,rate,alert_count,notes) VALUES (?,?,?,?,?,?,?) ON CONFLICT(kpi_date,stage) DO UPDATE SET expected_count=excluded.expected_count,actual_count=excluded.actual_count,rate=excluded.rate,alert_count=excluded.alert_count,notes=excluded.notes`);
  const tx=db.transaction(items=>{ for(const x of items) up.run(x.kpi_date,x.stage,x.expected_count,x.actual_count,x.rate,x.alert_count,x.notes); });
  tx(rows);
  return rows;
}


function isWorkOrderSheetName(name) {
  return /在制工单明细|生产工单明细|工单明细/i.test(String(name || ''));
}

function aggregateSheet(rows, sheetRe, codeAliases, qtyAliases) {
  const out = new Map();
  for (const r of rows) {
    const s = String(r.__sheet_name || '');
    if (!sheetRe.test(s)) continue;
    const code = normalizeProductCode(findImportValue(r, codeAliases));
    if (!code) continue;
    const qty = numberOr(findImportValue(r, qtyAliases), NaN);
    if (Number.isFinite(qty)) out.set(code, (out.get(code) || 0) + qty);
  }
  return out;
}

function buildWorkflowExcelContext(rows) {
  const inventory = aggregateSheet(rows, /库存明细/i, ['品号','product_code','料号'], ['汇总','库存数量','库存','在库数量']);
  const inspection = aggregateSheet(rows, /待检产品/i, ['品号','产品品号','product_code'], ['求和项:待检','待检','待检数量','检验中数量']);
  const sales = aggregateSheet(rows, /销货明细/i, ['品号','产品品号','product_code'], ['销货数量','求和项:销货数量','已销货数量']);
  const delivery = aggregateSheet(rows, /每日急件满足进度/i, ['品号','product_code'], ['交货数量','出货数量','已出货数量']);
  const urgentGap = new Map();
  const urgentShippingDate = new Map();
  const urgentDeliveryDate = new Map();
  const productNames = new Map();
  const products = new Map();

  for (const r of rows) {
    const sheet = String(r.__sheet_name || '');
    if (/每日急件满足进度/i.test(sheet)) {
      const code = normalizeProductCode(findImportValue(r, ['品号','product_code']));
      const gap = numberOr(findImportValue(r, ['出货欠数']), NaN);
      if (code && Number.isFinite(gap)) urgentGap.set(code, gap);
      const shipDate = normalizeImportedDate(findImportValue(r, ['要求出货时间','出货需求日期','出货日期']));
      const delDate = normalizeImportedDate(findImportValue(r, ['交货日期','要求交货日期']));
      if (code && shipDate && !urgentShippingDate.has(code)) urgentShippingDate.set(code, shipDate);
      if (code && delDate && !urgentDeliveryDate.has(code)) urgentDeliveryDate.set(code, delDate);
      const nm = normalizeImportText(findImportValue(r, ['品名','产品名称']));
      if (code && nm) productNames.set(code, nm);
    }

    if (/刀模基表/i.test(sheet)) {
      const codeA = normalizeProductCode(findImportValue(r, ['品号','product_code']));
      const moldA = normalizeImportText(findImportValue(r, ['刀模号','刀模','mold']));
      const codeF = normalizeProductCode(findImportValue(r, ['产品品号']));
      const nameF = normalizeImportText(findImportValue(r, ['品名']));
      const processF = normalizeImportText(findImportValue(r, ['工艺','制程']));
      if (codeA) {
        const old = products.get(codeA) || {};
        products.set(codeA, {...old, product_code:codeA, mold:moldA || old.mold || '', product_name:old.product_name || nameF || '', process:old.process || processF || ''});
      }
      if (codeF) {
        const old = products.get(codeF) || {};
        products.set(codeF, {...old, product_code:codeF, product_name:old.product_name || nameF || '', process:old.process || processF || ''});
      }
    }

    if (/模数跳距/i.test(sheet)) {
      const code = normalizeProductCode(findImportValue(r, ['内部料号','品号','product_code']));
      if (!code) continue;
      const moldCount = numberOr(findImportValue(r, ['模数']), NaN);
      const jump = numberOr(findImportValue(r, ['跳距']), NaN);
      const old = products.get(code) || {};
      if (Number.isFinite(moldCount)) old.mold_count = moldCount;
      if (Number.isFinite(jump)) old.jump_distance = jump;
      products.set(code, {...old, product_code:code});
    }
  }

  // 设备来自工单“机台配置”优先；同品号出现多个合法设备时合并去重。
  const machineByProduct = new Map();
  for (const r of rows) {
    if (!isWorkOrderSheetName(r.__sheet_name)) continue;
    const code = normalizeProductCode(findImportValue(r, ['品号','product_code']));
    const machine = normalizeImportText(findImportValue(r, ['机台配置','设备','设备名称','设备编号','机台','机台号','机器','生产设备']));
    if (!code || !machine) continue;
    const list = machineByProduct.get(code) || [];
    list.push(machine);
    machineByProduct.set(code, [...new Set(list)]);
  }
  for (const [code,list] of machineByProduct) {
    const old=products.get(code)||{product_code:code};
    products.set(code, {...old, machines:list.join(',')});
  }

  return {inventory,inspection,sales,delivery,urgentGap,urgentShippingDate,urgentDeliveryDate,products,productNames};
}

app.post('/api/workflow/import', requireEdit, (req,res)=>{
  try{
    const rows=Array.isArray(req.body?.rows)?req.body.rows:[];
    if(!rows.length) return res.status(400).json({success:false,message:'Excel没有可导入的数据'});
    const snapshotDate=String(req.body?.snapshot_date || todayISO()).slice(0,10);
    const filename=String(req.body?.filename || 'workflow.xlsx').slice(0,200);

    const excelContext=buildWorkflowExcelContext(rows);
    excelContext.snapshotDate = snapshotDate;
    // 关键修复：只有“在制工单明细”才产生四板块工单快照；销售/库存/待检/急件表只用于计算供应与出货欠数。
    const workRows=rows.filter(r=>isWorkOrderSheetName(r.__sheet_name));
    if(!workRows.length) return res.status(400).json({success:false,message:'未识别到“在制工单明细/生产工单明细”工作表，请检查Excel'});

    const productRows=db.prepare('SELECT * FROM product_data').all();
    const productMap=new Map(productRows.map(p=>[normalizeProductCode(p.product_code),p]));
    for (const [code,p] of excelContext.products) {
      const existing=productMap.get(code);
      productMap.set(code, {...existing,...p});
    }

    // 自动把刀模/工艺/模数跳距写回产品主数据，设备字段单独保存。
    const upsertProduct=db.prepare(`
      INSERT INTO product_data(product_code,product_name,mold,process,capacity,mold_change_time,remark,machines,mold_count,jump_distance)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(product_code) DO UPDATE SET
        product_name=CASE WHEN NULLIF(product_data.product_name,'') IS NULL AND excluded.product_name<>'' THEN excluded.product_name ELSE product_data.product_name END,
        mold=CASE WHEN NULLIF(product_data.mold,'') IS NULL AND excluded.mold<>'' THEN excluded.mold ELSE product_data.mold END,
        process=CASE WHEN NULLIF(product_data.process,'') IS NULL AND excluded.process<>'' THEN excluded.process ELSE product_data.process END,
        machines=CASE WHEN NULLIF(product_data.machines,'') IS NULL AND excluded.machines<>'' THEN excluded.machines ELSE product_data.machines END,
        mold_count=COALESCE(product_data.mold_count,excluded.mold_count),
        jump_distance=COALESCE(product_data.jump_distance,excluded.jump_distance)
    `);
    const productTx=db.transaction(()=>{
      for(const [code,p] of excelContext.products) {
        upsertProduct.run(code,p.product_name||'',p.mold||'',p.process||'',Number(p.capacity)>0?Number(p.capacity):1000,Number(p.mold_change_time)>=0?Number(p.mold_change_time):30,'Excel自动识别',p.machines||'',Number.isFinite(p.mold_count)?p.mold_count:null,Number.isFinite(p.jump_distance)?p.jump_distance:null);
      }
    });
    productTx();

    // 重新加载主数据，确保“品号→刀模/工艺/设备”匹配使用最新结果。
    const mergedRows=db.prepare('SELECT * FROM product_data').all();
    const mergedMap=new Map(mergedRows.map(p=>[normalizeProductCode(p.product_code),p]));
    const normalized=workRows.map((r,i)=>extractWorkflowRow(r,i,mergedMap,excelContext));

    const batch=db.prepare('INSERT INTO workflow_import_batches(snapshot_date,imported_at,filename,row_count) VALUES (?,?,?,?)').run(snapshotDate,new Date().toISOString(),filename,normalized.length);
    const insertSnap=db.prepare(`INSERT INTO workflow_snapshots(
      batch_id,snapshot_date,work_order_number,product_code,product_name,stage,status_text,expected_date,quantity,
      sheet_name,shipping_required_date,delivery_date,expected_ready_date,expected_issue_date,expected_start_date,expected_finish_date,
      production_progress,material_status,shortage_detail,raw_json,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

    const tx=db.transaction(items=>{
      for(const item of items){
        insertSnap.run(
          batch.lastInsertRowid,snapshotDate,item.work_order_number,item.product_code,item.product_name,item.stage,item.status_text,
          item.expected_date || item.expected_start_date || item.expected_ready_date,item.quantity,item.sheet_name,
          item.shipping_required_date||null,item.delivery_date||null,item.expected_ready_date||null,item.expected_issue_date||null,
          item.expected_start_date||null,item.expected_finish_date||null,item.production_progress||'',item.material_status||'',item.shortage_detail||'',
          JSON.stringify(item),new Date().toISOString()
        );

        let matchedOrders=[];
        if(item.work_order_number){
          const o=getWorkflowOrderRow(item.work_order_number,item.product_code); if(o) matchedOrders=[o];
        } else if(item.product_code){
          matchedOrders=db.prepare("SELECT * FROM orders WHERE product_code=? AND status IN ('pending','scheduled','running') ORDER BY id ASC").all(item.product_code);
        }

        // 自动建立/更新工单；同一工单号重复导入时更新而不重复插入。
        if(item.work_order_number && !matchedOrders.length && item.quantity > 0) {
          const existing=db.prepare('SELECT id FROM orders WHERE order_number=? ORDER BY id DESC LIMIT 1').get(item.work_order_number);
          const product=mergedMap.get(item.product_code);
          if(!existing) {
            const r=db.prepare(`
              INSERT INTO orders(order_number,product_code,product_name,quantity,shipping_quantity,shipping_required_date,delivery_date,delivery_time,capacity,mold,mold_change_time,process,machine_tokens,priority,material_ready_at,remark,workflow_stage,workflow_status_text,workflow_expected_date,workflow_last_import_date,workflow_production_progress,workflow_material_status,workflow_shortage_detail)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            `).run(
              item.work_order_number,item.product_code,item.product_name,item.quantity,0,item.shipping_required_date||null,item.delivery_date||null,null,
              Number(item.capacity)||1000,item.mold||'',Number(item.mold_change_time)||30,item.process||'',item.machine_tokens||'',item.shipping_gap>0?90:0,item.expected_ready_date||null,item.note||'Excel工作流自动导入',
              item.stage,item.status_text,item.expected_date||item.expected_start_date||item.expected_ready_date||null,snapshotDate,item.production_progress||'',item.material_status||'',item.shortage_detail||''
            );
            matchedOrders=[db.prepare('SELECT * FROM orders WHERE id=?').get(r.lastInsertRowid)];
          } else {
            matchedOrders=[db.prepare('SELECT * FROM orders WHERE id=?').get(existing.id)];
          }
        }

        for(const order of matchedOrders){
          const expectedStageDate=item.stage==='shortage'?item.expected_ready_date:(item.stage==='available_to_issue'?item.expected_issue_date:(item.stage==='waiting_schedule'?item.expected_start_date:item.expected_finish_date));
          updateWorkflowTransition(order,item.stage,snapshotDate,expectedStageDate,item.status_text);
          db.prepare(`UPDATE orders SET product_name=CASE WHEN ?<>'' THEN ? ELSE product_name END,quantity=CASE WHEN ? > 0 THEN ? ELSE quantity END,
            shipping_required_date=?,delivery_date=?,
            capacity=CASE WHEN ? > 0 THEN ? ELSE capacity END,mold=CASE WHEN ?<>'' THEN ? ELSE mold END,
            mold_change_time=CASE WHEN ? >= 0 THEN ? ELSE mold_change_time END,process=CASE WHEN ?<>'' THEN ? ELSE process END,
            machine_tokens=CASE WHEN ?<>'' THEN ? ELSE machine_tokens END,material_ready_at=?,
            workflow_status_text=?,workflow_expected_date=?,workflow_last_import_date=?,workflow_production_progress=?,workflow_material_status=?,workflow_shortage_detail=?,remark=CASE WHEN ?<>'' THEN ? ELSE remark END
            WHERE id=?`).run(
              item.product_name||'',item.product_name||'',Number(item.quantity)||0,Number(item.quantity)||0,item.shipping_required_date||null,item.delivery_date||null,
              Number(item.capacity)||0,Number(item.capacity)||0,item.mold||'',item.mold||'',Number.isFinite(Number(item.mold_change_time))?Number(item.mold_change_time):0,Number(item.mold_change_time)||0,
              item.process||'',item.process||'',item.machine_tokens||'',item.machine_tokens||'',item.expected_ready_date||null,item.status_text,item.expected_date||item.expected_start_date||item.expected_ready_date||null,snapshotDate,item.production_progress||'',item.material_status||'',item.shortage_detail||'',item.note||'',item.note||'',order.id
          );
          if(item.stage==='waiting_schedule') db.prepare("UPDATE orders SET status=CASE WHEN status='running' THEN status ELSE 'pending' END WHERE id=?").run(order.id);
        }
      }
    });
    tx(normalized);

    // 用供应表更新每个品号的“出货欠数”；优先使用每日急件满足进度中的预计算值。
    const supplyCodes=new Set([...excelContext.inventory.keys(),...excelContext.inspection.keys(),...excelContext.sales.keys(),...excelContext.urgentGap.keys()]);
    const upSupply=db.prepare(`INSERT INTO product_supply(product_code,inventory_qty,inspection_qty,sales_qty,delivery_qty,shipping_gap,shortage_qty,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(product_code) DO UPDATE SET inventory_qty=excluded.inventory_qty,inspection_qty=excluded.inspection_qty,sales_qty=excluded.sales_qty,delivery_qty=excluded.delivery_qty,shipping_gap=excluded.shipping_gap,shortage_qty=excluded.shortage_qty,updated_at=excluded.updated_at`);
    const txSupply=db.transaction(()=>{
      for(const code of supplyCodes){
        const inv=Number(excelContext.inventory.get(code)||0), insp=Number(excelContext.inspection.get(code)||0), sales=Number(excelContext.sales.get(code)||0), del=Number(excelContext.delivery.get(code)||0);
        const fallback=inv+insp+sales-del;
        const gap=excelContext.urgentGap.has(code)?Number(excelContext.urgentGap.get(code)||0):fallback;
        upSupply.run(code,inv,insp,sales,del,gap,Math.max(0,gap),new Date().toISOString());
      }
    });
    txSupply();

    const kpi=recalcWorkflowDailyKpi(snapshotDate);
    audit(req,'workflow_import','workflow',String(batch.lastInsertRowid),{filename,snapshot_date:snapshotDate,count:normalized.length,work_order_rows:workRows.length});
    io.emit('workflow_update',{message:`四板块Excel已导入 ${normalized.length} 条工单；供应数据按品号同步更新`});
    res.json({
      success:true,batch_id:batch.lastInsertRowid,count:normalized.length,kpi,
      stages:normalized.reduce((m,x)=>(m[x.stage]=(m[x.stage]||0)+1,m),{}),
      supply_products:supplyCodes.size,
      message:`已识别 ${normalized.length} 条在制工单；库存/待检/销货/出货欠数已按品号同步`
    });
  }catch(err){ console.error('工作流Excel导入失败:',err.stack||err.message); res.status(500).json({success:false,message:'工作流Excel导入失败：'+err.message}); }
});


app.get('/api/workflow/board', requireAuth, (req,res)=>{
  try{
    const stage=WORKFLOW_STAGE_ORDER.includes(String(req.query?.stage))?String(req.query.stage):'shortage';
    const latestBatch=db.prepare('SELECT id,snapshot_date FROM workflow_import_batches ORDER BY id DESC LIMIT 1').get();
    if(!latestBatch){
      return res.json({success:true,stage,label:WORKFLOW_STAGES[stage],count:0,latest_import_date:null,alerts:[],rows:[],product_shortages:[]});
    }
    // 当前看板只读“最近一次导入批次”，历史批次只用于 KPI；彻底隔离旧工单状态和旧预计日期。
    const rows=db.prepare(`
      SELECT o.id order_id,o.order_number,o.product_code,o.product_name,
             COALESCE(snap.quantity,o.quantity) quantity,o.status order_status,
             snap.shipping_required_date,snap.delivery_date,
             o.priority,o.mold,o.process,o.capacity,o.mold_change_time,
             snap.stage workflow_stage,snap.status_text workflow_status_text,snap.expected_date workflow_expected_date,
             snap.production_progress workflow_production_progress,snap.material_status workflow_material_status,snap.shortage_detail workflow_shortage_detail,
             s.start_time scheduled_start,s.end_time scheduled_end,s.status schedule_status
      FROM workflow_snapshots snap
      JOIN orders o ON o.order_number=snap.work_order_number
      LEFT JOIN schedules s ON s.order_id=o.id AND s.status IN ('scheduled','running')
      WHERE snap.batch_id=? AND snap.stage=?
        AND snap.id=(SELECT MAX(s2.id) FROM workflow_snapshots s2 WHERE s2.batch_id=snap.batch_id AND s2.work_order_number=snap.work_order_number)
      ORDER BY
        CASE WHEN NULLIF(TRIM(snap.shipping_required_date),'') IS NULL THEN 1 ELSE 0 END,
        CASE WHEN NULLIF(TRIM(snap.shipping_required_date),'') IS NULL THEN NULL ELSE date(snap.shipping_required_date) END,
        CASE WHEN NULLIF(TRIM(snap.delivery_date),'') IS NULL THEN 1 ELSE 0 END,
        CASE WHEN NULLIF(TRIM(snap.delivery_date),'') IS NULL THEN NULL ELSE date(snap.delivery_date) END,
        CASE WHEN NULLIF(TRIM(snap.expected_date),'') IS NULL THEN 1 ELSE 0 END,
        CASE WHEN NULLIF(TRIM(snap.expected_date),'') IS NULL THEN NULL ELSE date(snap.expected_date) END,
        o.id ASC`).all(latestBatch.id,stage);
    // “欠料”页面只展示工单级欠料；品号级出货欠数留给排程算法，不返回到看板。
    const alertDateLabel = stage === 'shortage' ? '预计齐料日期'
      : stage === 'available_to_issue' ? '预计发料日期'
      : stage === 'waiting_schedule' ? '预计开工日期'
      : stage === 'in_process' ? '预计完工日期'
      : '计划日期';
    const alerts=rows.filter(r=>r.workflow_expected_date && r.workflow_expected_date < todayISO() && !['completed'].includes(stage))
      .map(r=>({order_number:r.order_number,product_code:r.product_code,reason:`${alertDateLabel} ${r.workflow_expected_date} 已过，当前仍在${WORKFLOW_STAGES[stage]}`}));
    res.json({success:true,stage,label:WORKFLOW_STAGES[stage],count:rows.length,latest_import_date:latestBatch.snapshot_date,alerts,rows,product_shortages:[]});
  }catch(err){console.error('读取车间板块失败:',err.stack||err.message);res.status(500).json({success:false,message:'读取车间板块失败：'+err.message});}
});

app.get('/api/workflow/kpi', requireAuth, (req,res)=>{
  try{
    const date=String(req.query?.date || todayISO()).slice(0,10);
    const kpi=db.prepare('SELECT * FROM workflow_daily_kpi WHERE kpi_date=? ORDER BY stage').all(date);
    const latest=db.prepare('SELECT MAX(snapshot_date) snapshot_date FROM workflow_import_batches').get();
    res.json({success:true,date,kpi,latest_import_date:latest?.snapshot_date||null});
  }catch(err){res.status(500).json({success:false,message:'读取四板块KPI失败'});}
});

app.get('/api/workflow/import-history', requireAuth, (req,res)=>{
  try{
    const rows=db.prepare('SELECT * FROM workflow_import_batches ORDER BY imported_at DESC LIMIT 50').all();
    res.json({success:true,rows});
  }catch(err){res.status(500).json({success:false,message:'读取导入历史失败'});}
});

// ================== 订单管理 ==================
app.get('/api/orders', requireAuth, (req, res) => {
  const orders = db.prepare(`
    SELECT * FROM orders
    ORDER BY
      CASE WHEN NULLIF(TRIM(shipping_required_date), '') IS NULL THEN 1 ELSE 0 END,
      CASE WHEN NULLIF(TRIM(shipping_required_date), '') IS NULL THEN NULL ELSE datetime(shipping_required_date) END ASC,
      CASE WHEN NULLIF(TRIM(shipping_required_date), '') IS NULL AND NULLIF(TRIM(delivery_date), '') IS NULL AND NULLIF(TRIM(delivery_time), '') IS NULL THEN 1 ELSE 0 END,
      CASE WHEN NULLIF(TRIM(delivery_date), '') IS NULL THEN 1 ELSE 0 END,
      CASE WHEN NULLIF(TRIM(delivery_date), '') IS NULL THEN datetime(delivery_time) ELSE datetime(delivery_date) END ASC,
      id DESC
  `).all();
  res.json({ orders });
});

app.post('/api/orders', requireEdit, (req, res) => {
  const { order_number, product_code, product_name, quantity, shipping_quantity, shipping_required_date, delivery_date, delivery_time, capacity, mold, mold_change_time, process, remark, priority, material_ready_at } = req.body || {};
  const qty = Number(quantity);
  const shipQty = Number(shipping_quantity || 0);
  const cap = Number(capacity || 1000);
  const setup = Number(mold_change_time || 30);
  const pri = Math.max(0, Math.min(100, Number(priority) || 0));
  if (!order_number?.trim() || !product_code?.trim() || !product_name?.trim() || !mold?.trim()) {
    return res.status(400).json({ success: false, message: '请填写所有必填项' });
  }
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(cap) || cap <= 0 || !Number.isFinite(setup) || setup < 0) {
    return res.status(400).json({ success: false, message: '数量、产能、换模时间必须是有效数字' });
  }
  if (shipQty < 0) return res.status(400).json({ success: false, message: '已出货数量不能小于 0' });

  const stmt = db.prepare('INSERT INTO orders (order_number, product_code, product_name, quantity, shipping_quantity, shipping_required_date, delivery_date, delivery_time, capacity, mold, mold_change_time, process, remark, priority, material_ready_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const result = stmt.run(order_number.trim(), product_code.trim(), product_name.trim(), qty, shipQty, shipping_required_date || null, delivery_date || null, delivery_time || null, cap, mold.trim(), setup, String(process || '').trim(), String(remark || '').slice(0, 1000), pri, material_ready_at || null);
  audit(req, 'create', 'order', result.lastInsertRowid, { order_number: order_number.trim(), quantity: qty });
  io.emit('order_update', { message: '新订单已创建' });
  res.status(201).json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/orders/:id', requireEdit, (req, res) => {
  const { id } = req.params;
  const { order_number, product_code, product_name, quantity, shipping_quantity, shipping_required_date, delivery_date, delivery_time, capacity, mold, mold_change_time, process, remark, priority, material_ready_at } = req.body;
  db.prepare('UPDATE orders SET order_number=?, product_code=?, product_name=?, quantity=?, shipping_quantity=?, shipping_required_date=?, delivery_date=?, delivery_time=?, capacity=?, mold=?, mold_change_time=?, process=?, remark=?, priority=?, material_ready_at=? WHERE id=?')
    .run(order_number, product_code, product_name, quantity, shipping_quantity || 0, shipping_required_date || null, delivery_date || null, delivery_time, capacity || 1000, mold, mold_change_time || 30, process, remark || '', Number(priority) || 0, material_ready_at || null, id);
  io.emit('order_update', { message: '订单已更新' });
  res.json({ success: true });
});

app.delete('/api/orders/:id', requireEdit, (req, res) => {
  const removeOrder = db.transaction((orderId) => {
    db.prepare('DELETE FROM schedules WHERE order_id = ?').run(orderId);
    return db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  });
  const deleted = removeOrder(req.params.id);
  if (!deleted.changes) return res.status(404).json({ success: false, message: '订单不存在' });
  audit(req, 'delete', 'order', req.params.id);
  io.emit('order_update', { message: '订单已删除' });
  res.json({ success: true });
});

app.post('/api/orders/batch-delete', requireEdit, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.json({ success: false, message: '请先选择要删除的订单' });
  }
  const placeholders = ids.map(() => '?').join(',');
  const tx = db.transaction((orderIds) => {
    db.prepare(`DELETE FROM schedules WHERE order_id IN (${placeholders})`).run(...orderIds);
    db.prepare(`DELETE FROM orders WHERE id IN (${placeholders})`).run(...orderIds);
  });
  tx(ids);
  audit(req, 'delete', 'orders', ids.join(','), { count: ids.length });
  io.emit('order_update', { message: `已批量删除 ${ids.length} 条订单` });
  res.json({ success: true, count: ids.length });
});

// ================== Excel 智能导入 / V5 字段自动匹配 ==================
function normalizeImportHeader(value) {
  return String(value ?? '')
    .trim().toLowerCase()
    .replace(/[\s\u3000_\-\/\\()（）【】\[\]：:]+/g, '');
}

function normalizeImportText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

function normalizeProductCode(value) {
  return normalizeImportText(value).replace(/[\s\u3000]/g, '').toUpperCase();
}

function findImportValue(row, aliases) {
  const entries = Object.entries(row || {});
  const map = new Map(entries.map(([k,v]) => [normalizeImportHeader(k), v]));
  for (const alias of aliases) {
    const key = normalizeImportHeader(alias);
    if (map.has(key)) return map.get(key);
  }
  // 宽松包含匹配：兼容“客户订单号(工单)”、“预计出货日期”等现场字段。
  for (const [k,v] of entries) {
    const nk = normalizeImportHeader(k);
    if (aliases.some(a => nk.includes(normalizeImportHeader(a)))) return v;
  }
  return '';
}

function normalizeImportedDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth()+1).padStart(2,'0');
    const d = String(value.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  const raw = normalizeImportText(value);
  if (!raw || /^#?(n\/a|value!|ref!|name\?|div\/0!)$/i.test(raw)) return '';
  // Excel/浏览器序列化后的 ISO 日期，强制按日期部分处理，避免时区导致前一天。
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2,'0')}-${String(iso[3]).padStart(2,'0')}`;
  const ymd = raw.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${String(ymd[2]).padStart(2,'0')}-${String(ymd[3]).padStart(2,'0')}`;
  const mdy = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (mdy) return `${mdy[3]}-${String(mdy[1]).padStart(2,'0')}-${String(mdy[2]).padStart(2,'0')}`;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 20000 && n < 60000) {
    const base = new Date(Date.UTC(1899,11,30));
    base.setUTCDate(base.getUTCDate() + Math.floor(n));
    return `${base.getUTCFullYear()}-${String(base.getUTCMonth()+1).padStart(2,'0')}-${String(base.getUTCDate()).padStart(2,'0')}`;
  }
  return raw;
}

function numberOr(value, fallback=0) {
  const n = Number(String(value ?? '').replace(/,/g,''));
  return Number.isFinite(n) ? n : fallback;
}

function autoNormalizeImportedOrder(row, index, productMap) {
  const productCode = normalizeImportText(findImportValue(row, [
    'order_product_code','product_code','品号','料号','产品编号','产品代码','物料编码','物料号','item code','itemcode','part no'
  ]));
  const product = productMap.get(productCode) || null;

  const orderNumber = normalizeImportText(findImportValue(row, [
    'order_number','工单编号','工单号','订单号','订单编号','制造单号','生产单号','work order','wo','wo no'
  ])) || `AUTO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${index+1}`;

  const productName = normalizeImportText(findImportValue(row, [
    'product_name','品名','产品名称','物料名称','产品名','name','item name'
  ])) || normalizeImportText(product?.product_name);

  const quantity = numberOr(findImportValue(row, [
    'quantity','qty','工单数量','订单数量','需求数量','生产数量','计划数量','数量','pcs','总数量'
  ]), 0);

  const shippingQuantity = numberOr(findImportValue(row, [
    'shipping_quantity','出货数量','已出货数量','交货数量','发货数量'
  ]), 0);

  const shippingRequiredDate = normalizeImportedDate(findImportValue(row, [
    'shipping_required_date','shipping required date','出货需求日期','出货需求时间','客户出货需求日期','客户要求出货日期','要求出货日期','ship date','requested ship date'
  ]));
  const deliveryDate = normalizeImportedDate(findImportValue(row, [
    'delivery_date','delivery date','交货日期','交货时间','客户交货日期','要求交货日期'
  ]));
  let deliveryTime = normalizeImportedDate(findImportValue(row, [
    'delivery_time','due_date','delivery date','delivery','交期','交货日期','交货时间','出货日期','出货时间','要求日期','客户交期'
  ]));

  let machineTokens = normalizeImportText(findImportValue(row, [
    'machine_tokens','可用设备','设备','设备名称','设备编号','机台配置','机台','机台号','机器','机器编号','生产设备','machine','machine name'
  ]));
  let process = normalizeImportText(findImportValue(row, [
    'process','工艺','制程','工序','process'
  ]));
  let mold = normalizeImportText(findImportValue(row, [
    'mold','刀模','刀模号','刀模编号','模具','模具号','模具编号','die','diecut mold'
  ]));
  let capacity = numberOr(findImportValue(row, [
    'capacity','产能','UPH','uph','PCS/H','pcs/h','每小时产能','标准产能'
  ]), 0);
  let moldChange = numberOr(findImportValue(row, [
    'mold_change_time','换模时间','换刀模时间','换模分钟','setup time','setup minutes'
  ]), 0);
  const priority = Math.max(0, Math.min(100, numberOr(findImportValue(row, [
    'priority','优先级','订单优先级','急单等级','紧急度'
  ]), 0)));
  const materialReadyAt = normalizeImportedDate(findImportValue(row, [
    'material_ready_at','物料齐套时间','物料到位时间','材料齐套','备料完成时间','材料就绪时间'
  ])) || null;

  // V5 自动反查产品主数据补齐：设备、刀模、产能、换模时间、品名、工艺。
  if (product) {
    if (!process) process = normalizeImportText(product.process);
    if (!machineTokens) machineTokens = normalizeImportText(product.machines);
    if (!mold) mold = normalizeImportText(product.mold);
    if (!(capacity > 0)) capacity = numberOr(product.capacity, 1000);
    if (!(moldChange >= 0)) moldChange = numberOr(product.mold_change_time, 30);
  }
  if (!(capacity > 0)) capacity = 1000;
  if (!(moldChange >= 0)) moldChange = 30;

  const remark = normalizeImportText(findImportValue(row, ['remark','备注','说明','备注说明','comment','note']));
  const missing = [];
  if (!productCode) missing.push('品号');
  if (!productName) missing.push('品名');
  if (!(quantity > 0)) missing.push('数量');
  if (!mold) missing.push('刀模');
  if (!process) missing.push('设备');

  return {
    order_number: orderNumber,
    product_code: productCode,
    product_name: productName,
    quantity,
    shipping_quantity: shippingQuantity,
    shipping_required_date: shippingRequiredDate,
    delivery_date: deliveryDate,
    delivery_time: deliveryTime,
    capacity,
    mold,
    mold_change_time: moldChange,
    process,
    machine_tokens: machineTokens,
    priority,
    material_ready_at: materialReadyAt,
    remark,
    __import_index: index + 2,
    __matched_product: Boolean(product),
    __missing: missing
  };
}

app.post('/api/orders/import-normalize', requireEdit, (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({success:false,message:'Excel 没有可导入的数据'});
    const productRows = db.prepare('SELECT * FROM product_data').all();
    const productMap = new Map(productRows.map(p => [normalizeImportText(p.product_code), p]));
    const normalized = rows.map((row,i) => autoNormalizeImportedOrder(row,i,productMap));
    const matched = normalized.filter(x => x.__matched_product).length;
    const unresolved = normalized.filter(x => x.__missing.length);
    res.json({
      success:true,
      total:normalized.length,
      matched_product_count:matched,
      unresolved_count:unresolved.length,
      unresolved:unresolved.slice(0,100).map(x => ({row:x.__import_index, order_number:x.order_number, product_code:x.product_code, missing:x.__missing})),
      orders:normalized
    });
  } catch (err) {
    console.error('Excel 智能映射失败:', err.stack || err.message);
    res.status(500).json({success:false,message:'Excel 智能映射失败：'+err.message});
  }
});

app.post('/api/orders/batch-import', requireEdit, (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ success: false, message: '导入数据不能为空' });
    }
    const invalid = orders.filter(o => {
      const external = /外购|委外|外发/.test(`${o.mold||''}|${o.process||''}`);
      const noCore = !o.product_code || !o.product_name || !(Number(o.quantity) > 0) || !o.mold;
      const noMachine = !external && !String(o.machine_tokens || '').trim();
      return noCore || noMachine;
    });
    if (invalid.length) {
      return res.status(400).json({ success:false, message:`有 ${invalid.length} 条工单缺少 V5 必要字段：品号、品名、数量、刀模或可用设备；外购/委外不要求设备`, invalid_count:invalid.length });
    }
    const insert = db.prepare('INSERT INTO orders (order_number, product_code, product_name, quantity, shipping_quantity, shipping_required_date, delivery_date, delivery_time, capacity, mold, mold_change_time, process, machine_tokens, priority, material_ready_at, remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const transaction = db.transaction((items) => {
      for (const o of items) {
        insert.run(
          String(o.order_number || '').trim(), String(o.product_code || '').trim(), String(o.product_name || '').trim(),
          Number(o.quantity), Number(o.shipping_quantity) || 0, o.shipping_required_date || null, o.delivery_date || null, o.delivery_time || null, Number(o.capacity) > 0 ? Number(o.capacity) : 1000,
          String(o.mold || '').trim(), Number(o.mold_change_time) >= 0 ? Number(o.mold_change_time) : 30, String(o.process || '').trim(),
          String(o.machine_tokens || '').trim(), Math.max(0, Math.min(100, Number(o.priority) || 0)), o.material_ready_at || null, String(o.remark || '').trim()
        );
      }
    });
    transaction(orders);
    audit(req, 'import', 'orders', '', {count:orders.length, source:'excel-v5.1'});
    io.emit('order_update', { message: `已导入 ${orders.length} 条订单` });
    res.json({ success: true, count: orders.length });
  } catch (err) {
    console.error('订单批量导入失败:', err.stack || err.message);
    res.status(500).json({success:false,message:'订单导入失败：'+err.message});
  }
});

app.get('/api/orders/export', requireAuth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders').all();
  const ws = XLSX.utils.json_to_sheet(orders);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '订单');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename=orders.xlsx');
  res.send(buf);
});

// ================== 产品数据管理 ==================
app.get('/api/product-data', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM product_data ORDER BY product_code').all();
  res.json({ products: rows });
});

app.get('/api/product-data/by-code/:code', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM product_data WHERE product_code = ?').get(req.params.code);
  res.json({ product: row || null });
});

app.post('/api/product-data', requireEdit, (req, res) => {
  const { product_code, product_name, mold, process, capacity, mold_change_time, remark } = req.body;
  if (!product_code) return res.json({ success: false, message: '品号不能为空' });
  if (db.prepare('SELECT id FROM product_data WHERE product_code = ?').get(product_code))
    return res.json({ success: false, message: '该品号已存在' });
  db.prepare('INSERT INTO product_data (product_code, product_name, mold, process, capacity, mold_change_time, remark) VALUES (?,?,?,?,?,?,?)')
    .run(product_code, product_name || '', mold || '', process || '', capacity || 1000, mold_change_time || 30, remark || '');
  res.json({ success: true });
});

app.put('/api/product-data/:id', requireEdit, (req, res) => {
  const { id } = req.params;
  const { product_code, product_name, mold, process, capacity, mold_change_time, remark } = req.body;
  db.prepare('UPDATE product_data SET product_code=?, product_name=?, mold=?, process=?, capacity=?, mold_change_time=?, remark=? WHERE id=?')
    .run(product_code, product_name || '', mold || '', process || '', capacity || 1000, mold_change_time || 30, remark || '', id);
  res.json({ success: true });
});

app.delete('/api/product-data/:id', requireEdit, (req, res) => {
  db.prepare('DELETE FROM product_data WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 批量删除产品数据
app.post('/api/product-data/batch-delete', requireEdit, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.json({ success: false, message: '请先选择要删除的产品' });
  }
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM product_data WHERE id IN (${placeholders})`).run(...ids);
  res.json({ success: true, count: ids.length });
});

// 批量导入产品数据
app.post('/api/product-data/batch-import', requireEdit, (req, res) => {
  const { products } = req.body;
  if (!Array.isArray(products) || products.length === 0) {
    return res.json({ success: false, message: '导入数据不能为空' });
  }
  const insert = db.prepare(`INSERT INTO product_data (product_code, product_name, mold, process, capacity, mold_change_time, remark, machines)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(product_code) DO UPDATE SET
      product_name=CASE WHEN excluded.product_name<>'' THEN excluded.product_name ELSE product_data.product_name END,
      mold=CASE WHEN excluded.mold<>'' THEN excluded.mold ELSE product_data.mold END,
      process=CASE WHEN excluded.process<>'' THEN excluded.process ELSE product_data.process END,
      capacity=CASE WHEN excluded.capacity>0 THEN excluded.capacity ELSE product_data.capacity END,
      mold_change_time=CASE WHEN excluded.mold_change_time>=0 THEN excluded.mold_change_time ELSE product_data.mold_change_time END,
      machines=CASE WHEN excluded.machines<>'' THEN excluded.machines ELSE product_data.machines END,
      remark=CASE WHEN excluded.remark<>'' THEN excluded.remark ELSE product_data.remark END`);
  const transaction = db.transaction((items) => {
    for (const p of items) {
      if (!p.product_code) continue;
      insert.run(normalizeProductCode(p.product_code), p.product_name || '', p.mold || '', p.process || '', p.capacity || 1000, p.mold_change_time ?? 30, p.remark || '', p.machines || p.machine || p.equipment || '');
    }
  });
  transaction(products);
  io.emit('product_update');
  res.json({ success: true, count: products.length });
});

// ================== 设备管理 ==================
app.get('/api/machines', requireAuth, (req, res) => {
  const machines = db.prepare('SELECT * FROM machines').all();
  res.json({ machines });
});

app.post('/api/machines', requireEdit, (req, res) => {
  const { name, machine_type, status, remark } = req.body;
  if (!name || !machine_type) return res.json({ success: false, message: '请填写设备名称和类型' });
  const result = db.prepare('INSERT INTO machines (name, machine_type, status, remark) VALUES (?,?,?,?)').run(name, machine_type, status || 'active', remark || '');
  io.emit('machine_update');
  res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/machines/:id', requireEdit, (req, res) => {
  const { id } = req.params;
  const { name, machine_type, status, remark } = req.body;
  db.prepare('UPDATE machines SET name=?, machine_type=?, status=?, remark=? WHERE id=?').run(name, machine_type, status, remark, id);
  io.emit('machine_update');
  res.json({ success: true });
});

// 设备类型重命名（保留原逻辑，但可能需要调整）
app.put('/api/machines/rename-type', requireAdminEdit, (req, res) => {
  const { old_type, new_type } = req.body;
  if (!old_type || !new_type) return res.json({ success: false, message: '请提供旧类型和新类型' });
  if (old_type === new_type) return res.json({ success: true, message: '类型未改变' });
  db.prepare('UPDATE machines SET machine_type = ? WHERE machine_type = ?').run(new_type, old_type);
  db.prepare('UPDATE orders SET process = ? WHERE process = ?').run(new_type, old_type);
  db.prepare('UPDATE product_data SET process = ? WHERE process = ?').run(new_type, old_type);
  io.emit('machine_update');
  io.emit('order_update', { message: '设备类型已重命名，相关订单已同步' });
  res.json({ success: true, message: '设备类型已更新' });
});

app.delete('/api/machines/:id', requireEdit, (req, res) => {
  db.prepare('DELETE FROM machines WHERE id = ?').run(req.params.id);
  io.emit('machine_update');
  res.json({ success: true });
});

// ================== 智能排程（APS 增强版） ==================
// 设计原则：
// 1) 有限产能：一台设备同一时刻只允许一个任务。
// 2) 交期优先：EDD + 松弛度/关键比率，防止单纯追求设备利用率导致急单延期。
// 3) 换模优化：同刀模/同产品族优先连续生产，减少非增值换模时间。
// 4) 多设备兼容：订单 process 支持 M23、MY04、MF04+M09、设备类型等写法。
// 5) 稳定性：空交期、#N/A、非法产能、非法换模时间均有默认值，不阻断排程。
// 6) 已完工任务保护：自动排程只重排未完工任务。
//
// 这类“交期 + 并行设备 + family/setup time”的问题在制造排程研究中属于典型的复杂调度问题；
// 实务上通常采用启发式/有限产能 APS，而不是只按交期简单排序。换模族聚类与交期之间需要做权衡。
function normalizeMachineToken(value) {
  return String(value || '')
    .trim()
    .replace(/[\u3000\s]+/g, '')
    .replace(/[＿_]/g, '')
    .toUpperCase();
}

function splitMachineTokens(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  return [...new Set(raw.split(/[+＋,，、/\\|;；]+/).map(v => normalizeMachineToken(v)).filter(Boolean))];
}

function isNumericCapacity(value) {
  if (value === null || value === undefined || value === '') return false;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0;
}

function parseDueDate(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw || /^#(N\/A|VALUE!|REF!|NAME\?|DIV\/0!)/i.test(raw)) return null;

  // YYYY-MM-DD / YYYY/MM/DD
  let m = raw.match(/^(\d{4})[-\/]([0-1]?\d)[-\/]([0-3]?\d)/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // MM/DD/YYYY or MM-DD-YYYY
  m = raw.match(/^(\d{1,2})[-\/]([0-3]?\d)[-\/](\d{4})/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), 23, 59, 59, 999);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function getOrderMachineTokens(order, productMap = null) {
  // 设备必须来自“设备字段/产品可用设备”；工艺不再误当成设备。
  const code = normalizeProductCode(order?.product_code);
  const product = productMap ? productMap.get(code) : null;
  const candidates = [
    product?.machines,
    order?.machine_tokens,
    order?.machine,
    order?.equipment
  ];
  for (const raw of candidates) {
    const tokens = splitMachineTokens(raw);
    if (tokens.length) return tokens;
  }
  // 兼容旧数据：只有当 process 本身就是现有设备名称/设备类型时才使用。
  const process = normalizeImportText(order?.process);
  if (process) {
    const pn = normalizeMachineToken(process);
    const known = db.prepare('SELECT name,machine_type FROM machines').all();
    if (known.some(m => normalizeMachineToken(m.name) === pn || normalizeMachineToken(m.machine_type) === pn)) {
      return splitMachineTokens(process);
    }
  }
  return [];
}

function resolveOrderCapacity(order, productMap) {
  const p = productMap.get(String(order.product_code || '').trim());
  if (p && isNumericCapacity(p.capacity)) return Number(p.capacity);
  if (isNumericCapacity(order.capacity)) return Number(order.capacity);
  return 1000;
}

function resolveMoldChangeTime(order, productMap) {
  const p = productMap.get(String(order.product_code || '').trim());
  const pn = p ? Number(p.mold_change_time) : NaN;
  if (Number.isFinite(pn) && pn >= 0) return pn;
  const n = Number(order.mold_change_time);
  if (Number.isFinite(n) && n >= 0) return n;
  return 30;
}

function familyKey(order) {
  const mold = String(order.mold || '').trim();
  if (mold) return `MOLD:${normalizeMachineToken(mold)}`;
  const code = String(order.product_code || '').trim();
  if (code) return `PROD:${normalizeMachineToken(code)}`;
  return `ORDER:${order.id}`;
}

function calcWorkEndTime(startTime, addMinutes, settings) {
  const toMinutes = (value, fallback) => {
    const [h, m] = String(value || fallback).split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m)
      ? h * 60 + m
      : fallback.split(':').map(Number)[0] * 60 + fallback.split(':').map(Number)[1];
  };

  const workStartMin = toMinutes(settings.work_start, '08:00');
  const workEndMin = toMinutes(settings.work_end, '20:00');
  const lunchStartMin = toMinutes(settings.break_lunch_start, '12:00');
  const lunchEndMin = toMinutes(settings.break_lunch_end, '13:00');
  const dinnerStartMin = toMinutes(settings.break_dinner_start, '17:30');
  const dinnerEndMin = toMinutes(settings.break_dinner_end, '18:00');

  if (!(workStartMin < workEndMin)) throw new Error('系统设置错误：上班时间必须早于下班时间');

  let current = new Date(startTime);
  let remaining = Number(addMinutes);
  if (Number.isNaN(current.getTime())) throw new Error('排程时间无效');
  if (!Number.isFinite(remaining) || remaining < 0) remaining = 0;

  let guard = 0;
  while (remaining > 0 && guard++ < 20000) {
    const nowMin = current.getHours() * 60 + current.getMinutes() + current.getSeconds() / 60;

    if (nowMin < workStartMin) {
      current.setHours(Math.floor(workStartMin / 60), workStartMin % 60, 0, 0);
      continue;
    }
    if (nowMin >= workEndMin) {
      current.setDate(current.getDate() + 1);
      current.setHours(Math.floor(workStartMin / 60), workStartMin % 60, 0, 0);
      continue;
    }
    if (nowMin >= lunchStartMin && nowMin < lunchEndMin) {
      current.setHours(Math.floor(lunchEndMin / 60), lunchEndMin % 60, 0, 0);
      continue;
    }
    if (nowMin >= dinnerStartMin && nowMin < dinnerEndMin) {
      current.setHours(Math.floor(dinnerEndMin / 60), dinnerEndMin % 60, 0, 0);
      continue;
    }

    let segmentEnd = workEndMin;
    if (nowMin < lunchStartMin) segmentEnd = Math.min(segmentEnd, lunchStartMin);
    else if (nowMin < dinnerStartMin) segmentEnd = Math.min(segmentEnd, dinnerStartMin);

    const available = segmentEnd - nowMin;
    if (available <= 0) {
      current = new Date(current.getTime() + 60000);
      continue;
    }

    if (remaining <= available) {
      current = new Date(current.getTime() + remaining * 60000);
      remaining = 0;
    } else {
      remaining -= available;
      current.setHours(Math.floor(segmentEnd / 60), segmentEnd % 60, 0, 0);
    }
  }

  if (remaining > 0) throw new Error('排程时间计算超出安全范围');
  return current;
}

function ensureMachinesForOrders(orders) {
  // 只根据明确的 machine_tokens 创建设备；不会把“单斩/圆刀/对面冲压”等工艺创建成设备。
  const existing = db.prepare('SELECT * FROM machines').all();
  const byKey = new Map(existing.map(m => [normalizeMachineToken(m.name), m]));
  const insert = db.prepare('INSERT INTO machines (name, machine_type, status, remark) VALUES (?,?,?,?)');
  const created = [];
  for (const order of orders) {
    for (const token of getOrderMachineTokens(order)) {
      if (!token || byKey.has(token)) continue;
      const machine = insert.run(token, '自动导入设备', 'active', '根据订单可用设备字段自动创建');
      const row = db.prepare('SELECT * FROM machines WHERE id=?').get(machine.lastInsertRowid);
      byKey.set(token, row);
      created.push(row);
    }
  }
  return { machines: db.prepare("SELECT * FROM machines WHERE status='active'").all(), created };
}

function getEligibleMachines(order, machines, productMap = null) {
  const tokens = getOrderMachineTokens(order, productMap);
  if (!tokens.length) return [];

  const normalized = machines.map(m => ({ m, name: normalizeMachineToken(m.name), type: normalizeMachineToken(m.machine_type) }));
  const exact = normalized.filter(x => tokens.includes(x.name)).map(x => x.m);
  if (exact.length) return exact;

  const byType = normalized.filter(x => tokens.includes(x.type)).map(x => x.m);
  if (byType.length) return byType;

  // 组合工艺：MF04+M09 表示订单可在组合中的任一设备执行。
  const fuzzy = normalized.filter(x => tokens.some(t => x.name.includes(t) || t.includes(x.name))).map(x => x.m);
  return [...new Map(fuzzy.map(m => [m.id, m])).values()];
}

function getLatestMachineFamilyState(machineIds) {
  if (!machineIds.length) return new Map();
  const placeholders = machineIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT s.machine_id, o.mold, o.product_code, s.end_time
    FROM schedules s
    JOIN orders o ON o.id = s.order_id
    WHERE s.status='completed' AND s.machine_id IN (${placeholders})
    ORDER BY s.machine_id, s.end_time DESC
  `).all(...machineIds);
  const state = new Map();
  for (const row of rows) {
    if (!state.has(row.machine_id)) {
      state.set(row.machine_id, { family: familyKey(row), endTime: new Date(row.end_time) });
    }
  }
  return state;
}

function getSetupMinutes(fromFamily, toFamily, defaultMinutes) {
  if (!fromFamily || !toFamily || fromFamily === toFamily) return 0;
  const row = db.prepare('SELECT minutes FROM setup_rules WHERE from_family=? AND to_family=?').get(fromFamily, toFamily);
  if (row && Number.isFinite(Number(row.minutes))) return Math.max(0, Number(row.minutes));
  return Math.max(0, Number(defaultMinutes) || 0);
}

function orderPriority(order) {
  const p = Number(order.priority);
  return Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;
}

function materialReadyDate(order) {
  if (!order.material_ready_at) return null;
  const d = new Date(order.material_ready_at);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getWorkflowStagePriority(stage) {
  const s = String(stage || 'unknown');
  if (s === 'waiting_schedule') return 0;
  if (s === 'available_to_issue') return 1;
  if (s === 'shortage') return 2;
  if (s === 'in_process') return 3;
  if (s === 'completed') return 4;
  return 5;
}

function getProductShortageQty(productCode) {
  const code = String(productCode || '').trim();
  if (!code) return 0;
  const row = db.prepare('SELECT shortage_qty FROM product_supply WHERE product_code=?').get(code);
  return row ? Math.max(0, Number(row.shortage_qty) || 0) : 0;
}

function getWorkflowStageForOrder(order) {
  if (order?.workflow_stage) return String(order.workflow_stage);
  return 'unknown';
}

function getSchedulePriority(order) {
  const shipping = parseDueDate(order?.shipping_required_date);
  if (shipping) return { level: 0, label: '一级：要求出货时间', date: shipping, source: 'shipping_required_date' };
  const delivery = parseDueDate(order?.delivery_date);
  if (delivery) return { level: 0, label: '一级：交货日期', date: delivery, source: 'delivery_date' };
  const expectedStart = parseDueDate(order?.workflow_expected_date);
  if (expectedStart) return { level: 0, label: '一级：预计开工前一天交货', date: new Date(expectedStart.getTime() - 86400000), source: 'workflow_expected_date_minus_1_day' };
  return { level: 2, label: '三级：无交期后置', date: null, source: null };
}

function candidateScore(candidate) {
  // V5.1 多目标 APS：对所有数值/日期做防御式归一化，避免 Excel 脏数据把整次排程打崩。
  const safeEndTime = candidate.endTime instanceof Date && !Number.isNaN(candidate.endTime.getTime())
    ? candidate.endTime : new Date(8640000000000000 - 1);
  // V5 多目标 APS：交期绝对优先，同时兼顾急单、客户优先级、换模、负荷均衡、物料释放和完工时间。
  // 分数越低越优先。为避免“省换模”把急单拖迟，对延期采用非线性惩罚。
  const tardiness = Math.max(0, Number(candidate.tardinessHours) || 0);
  const slack = Number.isFinite(Number(candidate.slackHours)) ? Number(candidate.slackHours) : 999;
  const setup = Math.max(0, Number(candidate.setupMinutes) || 0);
  const loadHours = Math.max(0, Number(candidate.loadHours) || 0);
  const balance = Math.max(0, Number(candidate.balancePenalty) || 0);
  const releaseDelay = Math.max(0, Number(candidate.releaseDelayHours) || 0);
  const priority = Math.max(0, Math.min(100, Number(candidate.priority) || 0));
  const familySame = candidate.familySame ? 1 : 0;
  const materialPenalty = Math.max(0, Number(candidate.materialReadyPenalty) || 0);
  const processMinutes = Math.max(0, Number(candidate.productionMinutes) || 0);

  // 延期小时数采用平方/指数式放大，确保急单不会因为节省换模而被牺牲。
  const tardinessPenalty = tardiness > 0 ? (tardiness * tardiness * 180000) + tardiness * 100000 : 0;
  const urgencyPenalty = slack < 0 ? Math.abs(slack) * 8000 : (slack < 24 ? (24 - slack) * 900 : 0);
  const priorityBonus = priority * 6500;
  const setupPenalty = setup * (familySame ? 40 : 220);
  const loadPenalty = loadHours * 45 + balance * 120;
  const releasePenalty = releaseDelay * 500;
  const material = materialPenalty * 10000;
  const shortJobBonus = Math.min(processMinutes, 240) * 1.5;
  const shortageBonus = Math.max(0, Number(candidate.shortageQty) || 0) * 50;
  const finishTieBreaker = safeEndTime.getTime() / 1e10;

  return tardinessPenalty + urgencyPenalty + setupPenalty + loadPenalty + releasePenalty + material +
    shortJobBonus - shortageBonus - priorityBonus - familySame * 2500 + finishTieBreaker;
}

function compareScheduleCandidates(a, b) {
  if (a.priorityLevel !== b.priorityLevel) return a.priorityLevel - b.priorityLevel;
  if (a.priorityLevel < 2 && b.priorityLevel < 2) {
    const at = a.priorityDate ? a.priorityDate.getTime() : Number.POSITIVE_INFINITY;
    const bt = b.priorityDate ? b.priorityDate.getTime() : Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
  }
  const aUrgent = Math.max(0, Number(a.shortageQty) || 0), bUrgent = Math.max(0, Number(b.shortageQty) || 0);
  if (aUrgent !== bUrgent) return bUrgent - aUrgent;
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.workflowStagePriority !== b.workflowStagePriority) return a.workflowStagePriority - b.workflowStagePriority;
  if (a.score !== b.score) return a.score - b.score;
  return a.endTime.getTime() - b.endTime.getTime();
}

function buildSmartSchedule(orders, machines, settings, productMap, baseTime, lockedSchedules = []) {
  const machineTimers = new Map(machines.map(m => [m.id, new Date(baseTime)]));
  const familyState = getLatestMachineFamilyState(machines.map(m => m.id));
  for (const [id, st] of familyState.entries()) {
    const timer = machineTimers.get(id);
    if (st.endTime > timer) machineTimers.set(id, new Date(st.endTime));
  }

  // 已开工任务是硬锁：智能排程只能从其实际结束时间之后接排，不能覆盖或删除。
  for (const locked of lockedSchedules) {
    const end = new Date(locked.end_time || locked.start_time);
    if (Number.isNaN(end.getTime())) continue;
    const current = machineTimers.get(locked.machine_id) || new Date(baseTime);
    if (end > current) machineTimers.set(locked.machine_id, end);
    if (locked.machine_id && (locked.mold || locked.product_code)) {
      const fakeOrder = { id: locked.order_id, mold: locked.mold, product_code: locked.product_code };
      familyState.set(locked.machine_id, { family: familyKey(fakeOrder), endTime: end });
    }
  }

  const remaining = orders.slice();
  const result = [];
  const unscheduled = [];

  // 动态派工：每一步都从“订单 × 可用设备”所有候选里选综合代价最低的方案。
  // 这比固定 EDD 排序更适合多设备、换模、急单混排的车间。
  while (remaining.length) {
    let best = null;

    for (const order of remaining) {
      const qty = Math.max(0, Number(order.quantity) || 0);
      if (!qty) continue;
      const capacity = resolveOrderCapacity(order, productMap);
      const moldChange = resolveMoldChangeTime(order, productMap);
      const priorityInfo = getSchedulePriority(order);
      const dueDate = priorityInfo.date;
      const workflowStage = getWorkflowStageForOrder(order);
      const shortageQty = getProductShortageQty(order.product_code);
      const hasDueDate = priorityInfo.level < 2;
      const readyDate = materialReadyDate(order);
      const family = familyKey(order);
      const eligible = getEligibleMachines(order, machines, productMap);
      if (!eligible.length) continue;

      const productionMinutes = qty / capacity * 60;
      const orderTokens = getOrderMachineTokens(order, productMap);

      for (const machine of eligible) {
        let machineReady = machineTimers.get(machine.id) || new Date(baseTime);
        if (readyDate && readyDate > machineReady) machineReady = new Date(readyDate);
        if (workflowStage === 'waiting_schedule' && order.workflow_expected_date) {
          const expectedStart = parseDueDate(order.workflow_expected_date);
          if (expectedStart && expectedStart > machineReady) machineReady = new Date(expectedStart);
        }
        const last = familyState.get(machine.id);
        const setupMinutes = last ? getSetupMinutes(last.family, family, moldChange) : 0;
        const moldStart = new Date(machineReady);
        const moldEnd = calcWorkEndTime(moldStart, setupMinutes, settings);
        const prodEnd = calcWorkEndTime(moldEnd, productionMinutes, settings);
        const due = dueDate ? dueDate.getTime() : null;
        const tardinessHours = due === null ? 0 : Math.max(0, (prodEnd.getTime() - due) / 3600000);
        const slackHours = due === null ? 999 : (due - prodEnd.getTime()) / 3600000;
        const loadHours = Math.max(0, (machineReady.getTime() - baseTime.getTime()) / 3600000);
        const allLoads = machines.map(m => {
          const t = machineTimers.get(m.id) || baseTime;
          return Math.max(0, (t.getTime() - baseTime.getTime()) / 3600000);
        });
        const avgLoad = allLoads.length ? allLoads.reduce((a,b)=>a+b,0) / allLoads.length : loadHours;
        const maxLoad = allLoads.length ? Math.max(...allLoads) : loadHours;
        const projectedLoad = loadHours + setupMinutes / 60 + productionMinutes / 60;
        const balancePenalty = Math.max(0, projectedLoad - avgLoad) + Math.max(0, projectedLoad - maxLoad * 0.9);
        const familySame = Boolean(familyState.get(machine.id) && familyState.get(machine.id).family === family);
        const releaseDelayHours = Math.max(0, (machineReady.getTime() - baseTime.getTime()) / 3600000);
        const materialReadyPenalty = readyDate && readyDate > machineReady ? (readyDate.getTime() - machineReady.getTime()) / 3600000 : 0;

        const candidate = {
          order,
          machine,
          family,
          setupMinutes,
          moldStart,
          moldEnd,
          prodStart: moldEnd,
          prodEnd,
          endTime: prodEnd,
          dueDate,
          hasDueDate,
          priorityLevel: priorityInfo.level,
          priorityDate: priorityInfo.date,
          priorityLabel: priorityInfo.label,
          prioritySource: priorityInfo.source,
          workflowStage,
          workflowStagePriority: getWorkflowStagePriority(workflowStage),
          shortageQty,
          tardinessHours,
          slackHours,
          loadHours,
          balancePenalty,
          releaseDelayHours,
          productionMinutes,
          familySame,
          tokens: orderTokens,
          priority: orderPriority(order),
          materialReadyPenalty,
          score: candidateScore({
            tardinessHours,
            slackHours,
            setupMinutes,
            loadHours,
            balancePenalty,
            releaseDelayHours,
            dueDate,
            priority: orderPriority(order),
            materialReadyPenalty,
            productionMinutes,
            shortageQty,
            familySame,
            endTime: prodEnd
          })
        };

        // V5.1 关键业务规则：
        // 1) 有交货/出货需求日期的订单必须先于无日期订单；
        // 2) 有日期订单内部按交期先后；
        // 3) 同交期层级再使用 V5 多目标评分。
        if (!best || compareScheduleCandidates(candidate, best) < 0) best = candidate;
      }
    }

    if (!best) {
      for (const order of remaining) {
        unscheduled.push({
          id: order.id,
          order_number: order.order_number,
          process: order.process,
          reason: !getEligibleMachines(order, machines, productMap).length
            ? (/外购|委外|外发/.test(`${order.mold||''}|${order.process||''}`) ? '外购/委外工单无需设备' : '未匹配到可用设备：请检查产品主数据“可用设备”或工单“机台配置”')
            : '数据无效'
        });
      }
      break;
    }

    result.push(best);
    machineTimers.set(best.machine.id, new Date(best.endTime));
    familyState.set(best.machine.id, { family: best.family, endTime: new Date(best.endTime) });
    remaining.splice(remaining.indexOf(best.order), 1);
  }

  return { result, unscheduled };
}

app.post('/api/schedule/auto-run', requireEdit, (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM settings WHERE id=1').get();
    if (!settings) return res.status(500).json({ success: false, message: '系统设置不存在' });

    const allOpenOrders = db.prepare("SELECT * FROM orders WHERE status IN ('pending','scheduled') AND workflow_stage='waiting_schedule' ORDER BY id ASC").all();
    const lockedSchedules = db.prepare(`
      SELECT s.*, o.mold, o.product_code, o.status AS order_status
      FROM schedules s JOIN orders o ON o.id=s.order_id
      WHERE s.status='running' OR o.status='running'
      ORDER BY s.machine_id, s.end_time
    `).all();
    const orders = allOpenOrders.filter(o => String(o.workflow_stage || '') === 'waiting_schedule');
    if (!orders.length) return res.json({ success: false, message: '没有可排产的“车间待排”订单；欠料/待发/在制订单不会被提前排入计划' });

    const productRows = db.prepare('SELECT * FROM product_data').all();
    const productMap = new Map(productRows.map(p => [String(p.product_code || '').trim(), p]));
    const ensured = ensureMachinesForOrders(orders);
    const machines = ensured.machines;
    if (!machines.length) return res.status(409).json({ success: false, message: '没有可用设备，未修改现有排程' });

    const now = new Date();
    const startParts = String(settings.work_start || '08:00').split(':').map(Number);
    let baseTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startParts[0] || 8, startParts[1] || 0, 0, 0);
    if (now > baseTime) baseTime = now;

    const { result, unscheduled } = buildSmartSchedule(
      orders.filter(o => o.status !== 'completed'),
      machines,
      settings,
      productMap,
      baseTime,
      lockedSchedules
    );

    if (!result.length) {
      return res.status(409).json({
        success: false,
        message: `没有可执行的排程，现有排程保持不变。未排订单 ${unscheduled.length || orders.length} 个`,
        unscheduled
      });
    }

    const writeAll = db.transaction((items) => {
      db.prepare("DELETE FROM schedules WHERE status='scheduled'").run();
      db.prepare("UPDATE orders SET status='pending' WHERE status='scheduled'").run();

      const insertSchedule = db.prepare(`
        INSERT INTO schedules
        (order_id, machine_id, start_time, end_time, mold_change_start, mold_change_end, planned_quantity, status)
        VALUES (?,?,?,?,?,?,?,?)
      `);
      const updateOrderStatus = db.prepare("UPDATE orders SET status='scheduled', workflow_production_progress='已排待制' WHERE id=?");

      for (const item of items) {
        insertSchedule.run(
          item.order.id,
          item.machine.id,
          item.prodStart.toISOString(),
          item.prodEnd.toISOString(),
          item.moldStart.toISOString(),
          item.moldEnd.toISOString(),
          Number(item.order.quantity) || 0,
          'scheduled'
        );
        updateOrderStatus.run(item.order.id);
      }
    });
    writeAll(result);
    recordScheduleChange(req, 'auto-run', `智能排程：重排 ${result.length} 个订单，预计延期 ${result.filter(x => x.tardinessHours > 0).length} 个`,
      { mode:'rolling', preserved_running: lockedSchedules.length },
      { scheduled_count: result.length, unscheduled_count: unscheduled.length }
    );

    const scheduledCount = result.length;
    const completedCount = db.prepare("SELECT COUNT(*) AS cnt FROM schedules WHERE status='completed'").get().cnt;
    const lateCount = result.filter(x => x.tardinessHours > 0).length;
    const totalSetupMinutes = result.reduce((sum, x) => sum + x.setupMinutes, 0);
    const urgentCount = result.filter(x => x.slackHours < 12 || orderPriority(x.order) >= 80).length;
    const sameFamilyCount = result.filter(x => x.familySame).length;
    const shippingCount = result.filter(x => x.priorityLevel === 0).length;
    const deliveryCount = result.filter(x => x.priorityLevel === 1).length;
    const undatedCount = result.filter(x => x.priorityLevel === 2).length;
    const datedCount = shippingCount + deliveryCount;
    const maxFinish = result.length ? new Date(Math.max(...result.map(x => x.prodEnd.getTime()))) : null;

    const message = [
      `智能排程完成：${scheduledCount} 个订单`,
      `出货需求日期 ${shippingCount} 个，一级优先`,
      `交货日期 ${deliveryCount} 个，二级优先`,
      `无交期 ${undatedCount} 个，已后置`,
      `换模 ${Math.round(totalSetupMinutes)} 分钟`,
      `预计延期 ${lateCount} 个`,
      maxFinish ? `预计完工 ${maxFinish.toLocaleString('zh-CN')}` : ''
    ].filter(Boolean).join('；');

    audit(req, 'auto_schedule', 'schedule', '', {
      scheduledCount, lateCount, totalSetupMinutes: Math.round(totalSetupMinutes), urgentCount, sameFamilyCount, algorithm:'V5-MultiObjective'
    });
    io.emit('schedule_update', { message });
    res.json({
      success: true,
      schedule_count: scheduledCount,
      completed_count: completedCount,
      late_count: lateCount,
      total_setup_minutes: Math.round(totalSetupMinutes),
      urgent_count: urgentCount,
      same_family_count: sameFamilyCount,
      dated_count: datedCount,
      shipping_required_count: shippingCount,
      delivery_count: deliveryCount,
      undated_count: undatedCount,
      algorithm: 'V5-MultiObjective-DueDateFirst',
      created_machines: ensured.created.map(m => m.name),
      unscheduled,
      message
    });
  } catch (err) {
    console.error('智能排程出错:', err.stack || err.message);
    res.status(500).json({ success: false, message: '智能排程失败：' + String(err.message || '未知错误'), diagnostic: process.env.NODE_ENV !== 'production' ? (err.stack || '') : undefined });
  }
});

// 局部重新排程：以“实际完工时间”为新的设备释放时间，重排该机台所有尚未开始的任务。
// 关键保证：提前完工时，后续任务必须前移；延期完工时，后续任务必须后移。
function rescheduleMachine(machineId, fromTime, settings, anchorStartTime) {
  const machine = db.prepare("SELECT * FROM machines WHERE id = ?").get(machineId);
  if (!machine || machine.status !== 'active') return { count: 0, moved: [] };

  const release = new Date(fromTime);
  if (Number.isNaN(release.getTime())) throw new Error('实际完工时间无效，无法重新排程');

  // 只抓取该机台“尚未开始”的排程；完工任务和已经开始的任务不动。
  const futureSchedules = db.prepare(`
    SELECT s.*, o.priority, o.shipping_required_date, o.delivery_date, o.delivery_time, o.process, o.mold, o.quantity, o.capacity, o.mold_change_time, o.product_code
    FROM schedules s JOIN orders o ON o.id=s.order_id
    WHERE s.machine_id=? AND s.status='scheduled' AND s.start_time>=?
    ORDER BY s.start_time ASC, s.id ASC
  `).all(machineId, anchorStartTime || release.toISOString());

  const orderIds = futureSchedules.map(s => s.order_id);
  if (!orderIds.length) return { count: 0, moved: [] };

  // 拆掉原来的后续排程，恢复为待排产；然后从实际释放时间重新生成。
  const remove = db.transaction((ids) => {
    db.prepare("DELETE FROM schedules WHERE machine_id=? AND status='scheduled' AND id IN (" + ids.map(() => '?').join(',') + ")").run(machineId, ...ids);
    const setPending = db.prepare("UPDATE orders SET status='pending' WHERE id=?");
    for (const oid of orderIds) setPending.run(oid);
  });
  remove(futureSchedules.map(s => s.id));

  const productRows = db.prepare('SELECT * FROM product_data').all();
  const productMap = new Map(productRows.map(p => [String(p.product_code || '').trim(), p]));
  const pendingOrders = orderIds
    .map(id => db.prepare('SELECT * FROM orders WHERE id=?').get(id))
    .filter(Boolean);

  let timer = release;
  let lastFamily = null;
  const previous = db.prepare(`
    SELECT o.mold, o.product_code, s.end_time
    FROM schedules s JOIN orders o ON o.id=s.order_id
    WHERE s.machine_id=? AND s.status='completed'
    ORDER BY s.end_time DESC LIMIT 1
  `).get(machineId);
  if (previous) lastFamily = familyKey(previous);

  const remaining = pendingOrders.slice();
  const result = [];

  while (remaining.length) {
    let best = null;
    for (const order of remaining) {
      const eligible = getEligibleMachines(order, [machine], productMap);
      if (!eligible.length) continue;
      const qty = Math.max(0, Number(order.quantity) || 0);
      if (!qty) continue;
      const capacity = resolveOrderCapacity(order, productMap);
      const moldChange = resolveMoldChangeTime(order, productMap);
      const family = familyKey(order);
      let candidateStart = new Date(timer);
      const ready = materialReadyDate(order);
      if (ready && ready > candidateStart) candidateStart = new Date(ready);
      const setupMinutes = getSetupMinutes(lastFamily, family, moldChange);
      const moldStart = new Date(candidateStart);
      const moldEnd = calcWorkEndTime(moldStart, setupMinutes, settings);
      const prodEnd = calcWorkEndTime(moldEnd, qty / capacity * 60, settings);
      const priorityInfo = getSchedulePriority(order);
      const due = priorityInfo.date;
      const tardinessHours = due ? Math.max(0, (prodEnd-due)/3600000) : 0;
      const slackHours = due ? (due-prodEnd)/3600000 : 999;
      const score = candidateScore({
        tardinessHours, slackHours, setupMinutes,
        loadHours: Math.max(0, (candidateStart-release)/3600000),
        dueDate: due, endTime: prodEnd,
        priority: orderPriority(order), materialReadyPenalty: 0
      });
      const candidate = { order, family, setupMinutes, moldStart, moldEnd, prodStart:moldEnd, prodEnd, score, tardinessHours, priorityLevel:priorityInfo.level, priorityDate:priorityInfo.date, priorityLabel:priorityInfo.label, prioritySource:priorityInfo.source };
      if (!best || compareScheduleCandidates(candidate, best) < 0) best = candidate;
    }
    if (!best) break;
    result.push(best);
    timer = new Date(best.prodEnd);
    lastFamily = best.family;
    remaining.splice(remaining.indexOf(best.order), 1);
  }

  const insert = db.prepare(`
    INSERT INTO schedules
    (order_id, machine_id, start_time, end_time, mold_change_start, mold_change_end, planned_quantity, status)
    VALUES (?,?,?,?,?,?,?,?)
  `);
  const setScheduled = db.prepare("UPDATE orders SET status='scheduled' WHERE id=?");
  const write = db.transaction((items) => {
    for (const item of items) {
      insert.run(item.order.id, machineId, item.prodStart.toISOString(), item.prodEnd.toISOString(), item.moldStart.toISOString(), item.moldEnd.toISOString(), Number(item.order.quantity)||0, 'scheduled');
      setScheduled.run(item.order.id);
    }
  });
  write(result);

  return { count: result.length, moved: result.map(x => ({ order_id:x.order.id, order_number:x.order.order_number, end_time:x.prodEnd.toISOString() })) };
}

// 开工接口：将排程锁定为 running，后续自动排程不会覆盖该任务。
app.post('/api/schedules/:id/start', requireEdit, (req, res) => {
  try {
    const schedule = db.prepare(`SELECT s.*, o.status AS order_status FROM schedules s JOIN orders o ON o.id=s.order_id WHERE s.id=?`).get(req.params.id);
    if (!schedule) return res.status(404).json({ success:false, message:'排程不存在' });
    if (schedule.status === 'completed' || schedule.order_status === 'completed') {
      return res.status(409).json({ success:false, message:'已完工任务不能重复开工' });
    }
    const tx = db.transaction(() => {
      db.prepare("UPDATE schedules SET status='running' WHERE id=?").run(schedule.id);
      db.prepare("UPDATE orders SET status='running' WHERE id=?").run(schedule.order_id);
    });
    tx();
    audit(req, 'start', 'schedule', schedule.id, { order_id: schedule.order_id, machine_id: schedule.machine_id });
    io.emit('schedule_update', { message:'任务已开工，系统会锁定该任务避免自动排程覆盖' });
    res.json({ success:true, message:'已开工，任务已锁定' });
  } catch (err) {
    console.error('开工处理出错:', err.stack || err.message);
    res.status(500).json({ success:false, message:'服务器内部错误' });
  }
});

// 完工接口（支持修改时间）
app.post('/api/schedules/:id/complete', requireEdit, (req, res) => {
  try {
    const { id } = req.params;
    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
    if (!schedule) return res.status(404).json({ success: false, message: '排程不存在' });
    if (schedule.status === 'completed') return res.status(409).json({ success:false, message:'该任务已经完工，不能重复确认' });

    const { mold_change_start, mold_change_end, start_time, end_time, planned_quantity } = req.body;
    const completedAt = new Date().toISOString();
    const moldStart = mold_change_start ? new Date(mold_change_start) : new Date(schedule.mold_change_start);
    const moldEnd = mold_change_end ? new Date(mold_change_end) : new Date(schedule.mold_change_end);
    const prodStart = start_time ? new Date(start_time) : new Date(schedule.start_time);
    const prodEnd = end_time ? new Date(end_time) : new Date(schedule.end_time);
    const qty = planned_quantity !== undefined && planned_quantity !== '' ? Number(planned_quantity) : Number(schedule.planned_quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ success:false, message:'完工数量必须大于 0' });
    }
    if ([moldStart,moldEnd,prodStart,prodEnd].some(d => Number.isNaN(d.getTime()))) {
      return res.json({ success:false, message:'完工时间存在无效值，请检查时间填写' });
    }
    if (moldEnd < moldStart || prodStart < moldEnd || prodEnd < prodStart) {
      return res.json({ success:false, message:'完工时间顺序不正确，请检查换模/生产开始结束时间' });
    }

    const completeTx = db.transaction(() => {
      db.prepare('UPDATE schedules SET status=?, completed_at=?, mold_change_start=?, mold_change_end=?, start_time=?, end_time=?, planned_quantity=? WHERE id=?')
        .run('completed', completedAt, moldStart.toISOString(), moldEnd.toISOString(), prodStart.toISOString(), prodEnd.toISOString(), qty, id);
      db.prepare("UPDATE orders SET status=?, workflow_stage='completed', workflow_actual_finish_date=COALESCE(workflow_actual_finish_date, ?) WHERE id=?").run('completed', completedAt.slice(0,10), schedule.order_id);
    });
    completeTx();
    audit(req, 'complete', 'schedule', id, { order_id: schedule.order_id, quantity: qty, end_time: prodEnd.toISOString() });

    const settings = db.prepare('SELECT * FROM settings WHERE id=1').get();
    const replanned = rescheduleMachine(schedule.machine_id, prodEnd, settings, schedule.start_time);
    const message = replanned.count > 0
      ? `工单已完工，按实际完工时间重新排了 ${replanned.count} 个后续任务`
      : '工单已完工，该设备没有需要重新排程的后续任务';
    io.emit('schedule_update', { message });
    res.json({ success: true, completed_at: completedAt, rescheduled_count: replanned.count, moved: replanned.moved, message });
  } catch (err) {
    console.error('完工处理出错:', err);
    res.status(500).json({ success: false, message: '服务器内部错误，请查看服务器日志' });
  }
});


// 完工记录修订：已完工订单允许修改实际生产结束时间；修改后自动重排同机台尚未开始的后续任务。
app.put('/api/schedules/:id/complete', requireEdit, (req, res) => {
  try {
    const id = req.params.id;
    const schedule = db.prepare(`
      SELECT s.*, o.order_number, o.status AS order_status
      FROM schedules s JOIN orders o ON o.id=s.order_id
      WHERE s.id=?
    `).get(id);
    if (!schedule) return res.status(404).json({ success:false, message:'排程不存在' });
    if (schedule.status !== 'completed') return res.status(409).json({ success:false, message:'该任务尚未完工，请使用正常完工确认' });

    const { mold_change_start, mold_change_end, start_time, end_time, planned_quantity } = req.body || {};
    const moldStart = new Date(mold_change_start || schedule.mold_change_start);
    const moldEnd = new Date(mold_change_end || schedule.mold_change_end);
    const prodStart = new Date(start_time || schedule.start_time);
    const prodEnd = new Date(end_time || schedule.end_time);
    const qty = planned_quantity !== undefined && planned_quantity !== '' ? Number(planned_quantity) : Number(schedule.planned_quantity);

    if (![moldStart,moldEnd,prodStart,prodEnd].every(d => Number.isFinite(d.getTime()))) {
      return res.status(400).json({success:false, message:'完工时间存在无效值'});
    }
    if (moldEnd < moldStart || prodStart < moldEnd || prodEnd < prodStart) {
      return res.status(400).json({success:false, message:'完工时间顺序不正确'});
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({success:false, message:'完工数量必须大于 0'});
    }

    const before = {
      mold_change_start:schedule.mold_change_start,
      mold_change_end:schedule.mold_change_end,
      start_time:schedule.start_time,
      end_time:schedule.end_time,
      planned_quantity:schedule.planned_quantity
    };
    const settings = db.prepare('SELECT * FROM settings WHERE id=1').get();
    if (!settings) return res.status(500).json({success:false,message:'系统设置不存在'});

    const update = db.transaction(() => {
      db.prepare(`UPDATE schedules SET mold_change_start=?, mold_change_end=?, start_time=?, end_time=?, planned_quantity=?, completed_at=? WHERE id=?`)
        .run(moldStart.toISOString(), moldEnd.toISOString(), prodStart.toISOString(), prodEnd.toISOString(), qty, new Date().toISOString(), id);
    });
    update();

    let replanned = { count:0, moved:[] };
    try {
      replanned = rescheduleMachine(schedule.machine_id, prodEnd, settings, schedule.start_time);
    } catch (replanErr) {
      // 修改完工记录本身成功，但排程重算失败时立即返回明确告警，避免假装全部完成。
      recordScheduleChange(req, 'completion-revise-warning', `修订完工时间成功，但后续排程重算失败：${schedule.order_number}`, before, { end_time:prodEnd.toISOString(), replan_error:replanErr.message });
      audit(req, 'completion_revise', 'schedule', id, { before, after:{end_time:prodEnd.toISOString(), planned_quantity:qty}, replan_error:replanErr.message });
      io.emit('schedule_update', { message:`${schedule.order_number} 完工时间已修改，但后续任务未能自动重排，请检查设备排程` });
      return res.status(409).json({success:false, partial:true, message:`完工时间已修改，但后续排程重算失败：${replanErr.message}`});
    }

    const after = {
      mold_change_start:moldStart.toISOString(), mold_change_end:moldEnd.toISOString(),
      start_time:prodStart.toISOString(), end_time:prodEnd.toISOString(), planned_quantity:qty
    };
    recordScheduleChange(req, 'completion-revise', `修订已完工订单 ${schedule.order_number} 的实际完工时间`, before, after);
    audit(req, 'completion_revise', 'schedule', id, {order_id:schedule.order_id, before, after});
    const message = replanned.count
      ? `${schedule.order_number} 完工时间已调整，已按新的实际完工时间重排 ${replanned.count} 个后续任务`
      : `${schedule.order_number} 完工时间已调整，没有需要移动的后续任务`;
    io.emit('schedule_update', { message });
    res.json({success:true, message, rescheduled_count:replanned.count, moved:replanned.moved});
  } catch (err) {
    console.error('修订完工记录失败:', err.stack || err.message);
    res.status(500).json({success:false,message:'修订完工记录失败，请查看服务器日志'});
  }
});

function riskLevelForSchedule(schedule, order) {
  if (!schedule || schedule.status === 'completed') return { level:'done', label:'已完成', score:0 };
  const due = getSchedulePriority(order).date;
  if (!due) return { level:'normal', label:'无交期风险', score:10 };
  const end = new Date(schedule.end_time);
  if (Number.isNaN(end.getTime())) return { level:'high', label:'时间数据异常', score:95 };
  const hours = (due.getTime() - end.getTime()) / 3600000;
  if (hours < 0) return { level:'critical', label:'已预计延期', score:100 };
  if (hours <= 4) return { level:'high', label:'4小时内到期', score:90 };
  if (hours <= 12) return { level:'medium', label:'12小时内到期', score:70 };
  if (hours <= 24) return { level:'low', label:'24小时内到期', score:45 };
  return { level:'normal', label:'正常', score:10 };
}


app.get('/api/schedule/v5-stats', requireAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT s.*, o.order_number, o.shipping_required_date, o.delivery_date, o.delivery_time, o.priority, o.mold, o.process, o.quantity
      FROM schedules s JOIN orders o ON o.id=s.order_id
      WHERE s.status != 'completed'
      ORDER BY s.start_time
    `).all();
    const stats = rows.map(r => {
      const due = getSchedulePriority(r).date;
      const end = new Date(r.end_time);
      const slack = due && !Number.isNaN(end.getTime()) ? (due.getTime()-end.getTime())/3600000 : null;
      return {
        schedule_id:r.id, order_id:r.order_id, order_number:r.order_number,
        priority:Number(r.priority)||0, machine_id:r.machine_id, status:r.status,
        slack_hours: slack === null ? null : Number(slack.toFixed(1)),
        tardiness_hours: slack === null ? 0 : Number(Math.max(0,-slack).toFixed(1)),
        strategy: (Number(r.priority)>=80 || (slack!==null && slack<12)) ? '急单优先' : '综合优化'
      };
    });
    const urgent = stats.filter(x => x.strategy==='急单优先').length;
    res.json({success:true, algorithm:'V5-MultiObjective', total:stats.length, urgent_count:urgent, items:stats.slice(0,100)});
  } catch (err) {
    res.status(500).json({success:false,message:'读取 V5 排程统计失败'});
  }
});

app.get('/api/schedule/risk', requireAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT s.*, o.order_number, o.product_code, o.product_name, o.shipping_required_date, o.delivery_date, o.delivery_time, o.priority,
             o.quantity, o.process, o.mold
      FROM schedules s JOIN orders o ON o.id=s.order_id
      WHERE s.status != 'completed'
      ORDER BY s.end_time
    `).all();
    const items = rows.map(s => {
      const risk = riskLevelForSchedule(s, s);
      const due = getSchedulePriority(s).date;
      const end = new Date(s.end_time);
      return {
        schedule_id:s.id, order_id:s.order_id, order_number:s.order_number,
        product_code:s.product_code, product_name:s.product_name,
        machine_id:s.machine_id, process:s.process, mold:s.mold,
        status:s.status, delivery_time:s.delivery_time, end_time:s.end_time,
        priority:Number(s.priority)||0, planned_quantity:Number(s.planned_quantity)||0,
        risk_level:risk.level, risk_label:risk.label, risk_score:risk.score,
        hours_to_due:due && !Number.isNaN(end.getTime()) ? Number(((due.getTime()-end.getTime())/3600000).toFixed(1)) : null
      };
    }).sort((a,b)=>b.risk_score-a.risk_score || (a.hours_to_due??9999)-(b.hours_to_due??9999));
    const counts = items.reduce((m,x)=>{m[x.risk_level]=(m[x.risk_level]||0)+1; return m;},{});
    res.json({success:true, generated_at:new Date().toISOString(), counts, items:items.slice(0,50)});
  } catch (err) {
    console.error('排程风险分析失败:', err.stack || err.message);
    res.status(500).json({success:false,message:'读取交期风险失败'});
  }
});

app.get('/api/schedule/changes', requireAuth, (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const rows = db.prepare(`
      SELECT c.*, u.username FROM schedule_changes c
      LEFT JOIN users u ON u.id=c.user_id
      ORDER BY c.created_at DESC LIMIT ?
    `).all(limit);
    res.json({success:true, changes:rows});
  } catch (err) {
    res.status(500).json({success:false,message:'读取排程变更历史失败'});
  }
});

app.get('/api/schedule/summary', requireAuth, (req, res) => {
  try {
    const schedules = db.prepare(`
      SELECT s.*, o.order_number, o.shipping_required_date, o.delivery_date, o.delivery_time, o.priority, o.process, o.mold
      FROM schedules s JOIN orders o ON o.id=s.order_id
      ORDER BY s.start_time
    `).all();
    const now = Date.now();
    const summary = schedules.map(s => {
      const end = new Date(s.end_time).getTime();
      const due = getSchedulePriority(s).date;
      return {
        id:s.id, machine_id:s.machine_id, order_id:s.order_id, order_number:s.order_number,
        priority:Number(s.priority)||0, delivery_time:s.delivery_time, end_time:s.end_time,
        status:s.status, late:s.status!=='completed' && due ? end > due.getTime() : false,
        hours_to_due:due ? (due.getTime()-end)/3600000 : null,
        starts_in_hours:(new Date(s.start_time).getTime()-now)/3600000
      };
    });
    const active = summary.filter(x => x.status==='scheduled');
    res.json({
      success:true, total:schedules.length, scheduled:active.length,
      late_count:active.filter(x=>x.late).length,
      utilization_window_hours:active.length ? Math.max(0,(Math.max(...active.map(x=>new Date(x.end_time).getTime()))-Math.min(...active.map(x=>new Date(x.start_time).getTime())))/3600000) : 0,
      items:summary
    });
  } catch (err) {
    res.status(500).json({success:false,message:'读取排程分析失败：'+err.message});
  }
});

// ================== 排程分析（设备负荷 / 瓶颈 / 交期风险） ==================
app.get('/api/schedule/analysis', requireAuth, (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM settings WHERE id=1').get() || {};
    const machines = db.prepare("SELECT * FROM machines WHERE status='active' ORDER BY name").all();
    const rows = db.prepare(`
      SELECT s.id, s.machine_id, s.order_id, s.start_time, s.end_time,
             s.mold_change_start, s.mold_change_end, s.status,
             o.order_number, o.delivery_time, o.priority, o.quantity
      FROM schedules s
      JOIN orders o ON o.id=s.order_id
      ORDER BY s.machine_id, s.start_time
    `).all();

    const parseHm = (v, fallback) => {
      const m = String(v || fallback).match(/^(\d{1,2}):(\d{2})$/);
      return m ? Number(m[1]) * 60 + Number(m[2]) : fallback === '20:00' ? 1200 : 480;
    };
    const workMinutes = Math.max(1, parseHm(settings.work_end, '20:00') - parseHm(settings.work_start, '08:00'));
    const now = Date.now();
    const activeRows = rows.filter(r => r.status !== 'completed');
    const late = activeRows.filter(r => {
      const due = getSchedulePriority(r).date;
      return due && new Date(r.end_time).getTime() > due.getTime();
    });

    const machineStats = machines.map(machine => {
      const items = rows.filter(r => r.machine_id === machine.id);
      const running = items.filter(r => r.status === 'running');
      const productionMinutes = items.reduce((sum, r) => {
        const a = new Date(r.start_time).getTime();
        const b = new Date(r.end_time).getTime();
        return sum + Math.max(0, b - a) / 60000;
      }, 0);
      const setupMinutes = items.reduce((sum, r) => {
        const a = new Date(r.mold_change_start || r.start_time).getTime();
        const b = new Date(r.mold_change_end || r.start_time).getTime();
        return sum + Math.max(0, b - a) / 60000;
      }, 0);
      const first = items.length ? new Date(items[0].mold_change_start || items[0].start_time).getTime() : now;
      const last = items.length ? Math.max(...items.map(r => new Date(r.end_time).getTime())) : now;
      const windowMinutes = Math.max(workMinutes, (last - first) / 60000);
      const utilization = Math.min(100, (productionMinutes / windowMinutes) * 100);
      const setupRate = windowMinutes ? (setupMinutes / windowMinutes) * 100 : 0;
      const lateCount = items.filter(r => {
        const due = getSchedulePriority(r).date;
        return r.status !== 'completed' && due && new Date(r.end_time).getTime() > due.getTime();
      }).length;
      return {
        machine_id: machine.id,
        machine_name: machine.name,
        machine_type: machine.machine_type,
        task_count: items.length,
        running_count: running.length,
        production_minutes: Math.round(productionMinutes),
        setup_minutes: Math.round(setupMinutes),
        utilization: Number(utilization.toFixed(1)),
        setup_rate: Number(setupRate.toFixed(1)),
        late_count: lateCount,
        bottleneck_score: Number((utilization + lateCount * 15 + setupRate * 0.5).toFixed(1))
      };
    });

    machineStats.sort((a, b) => b.bottleneck_score - a.bottleneck_score);
    const totalProduction = machineStats.reduce((s, x) => s + x.production_minutes, 0);
    const totalSetup = machineStats.reduce((s, x) => s + x.setup_minutes, 0);
    const averageUtilization = machineStats.length
      ? Number((machineStats.reduce((s, x) => s + x.utilization, 0) / machineStats.length).toFixed(1))
      : 0;

    res.json({
      success: true,
      generated_at: new Date().toISOString(),
      kpi: {
        total_orders: rows.length,
        open_orders: activeRows.length,
        running_orders: rows.filter(r => r.status === 'running').length,
        late_orders: late.length,
        total_setup_minutes: Math.round(totalSetup),
        total_production_minutes: Math.round(totalProduction),
        average_utilization: averageUtilization,
        bottleneck_machine: machineStats[0]?.machine_name || null
      },
      machines: machineStats
    });
  } catch (err) {
    console.error('排程分析失败:', err.stack || err.message);
    res.status(500).json({ success:false, message:'读取设备负荷分析失败' });
  }
});

// 清空排程
app.post('/api/schedules/clear', requireEdit, (req, res) => {
  const running = db.prepare("SELECT COUNT(*) AS cnt FROM schedules WHERE status='running'").get().cnt;
  if (running > 0) return res.status(409).json({ success:false, message:`当前有 ${running} 个开工任务，不能清空排程` });
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM schedules WHERE status='scheduled'").run();
    db.prepare("UPDATE orders SET status='pending' WHERE status='scheduled'").run();
  });
  tx();
  audit(req, 'clear', 'schedule', '', {});
  recordScheduleChange(req, 'clear', '清空未开工排程', {}, { cleared_scheduled: true });
  io.emit('schedule_update', { message: '未开工排程已清空，已完工任务和开工任务保留' });
  res.json({ success: true });
});

app.get('/api/schedules/export', requireAuth, (req, res) => {
  const schedules = db.prepare('SELECT * FROM schedules').all();
  const ws = XLSX.utils.json_to_sheet(schedules);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '排程');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename=schedules.xlsx');
  res.send(buf);
});

app.get('/api/schedules', requireAuth, (req, res) => {
  const schedules = db.prepare('SELECT * FROM schedules ORDER BY start_time').all();
  res.json({ schedules });
});

// ================== 换模规则（APS） ==================
app.get('/api/setup-rules', requireAuth, (req, res) => {
  const rules = db.prepare('SELECT * FROM setup_rules ORDER BY from_family, to_family').all();
  res.json({ success:true, rules });
});

app.post('/api/setup-rules', requireEdit, (req, res) => {
  const from_family = String(req.body?.from_family || '').trim();
  const to_family = String(req.body?.to_family || '').trim();
  const minutes = Math.max(0, Number(req.body?.minutes) || 0);
  if (!from_family || !to_family) return res.json({success:false,message:'请填写前后刀模/产品族'});
  db.prepare(`
    INSERT INTO setup_rules (from_family,to_family,minutes) VALUES (?,?,?)
    ON CONFLICT(from_family,to_family) DO UPDATE SET minutes=excluded.minutes
  `).run(from_family, to_family, minutes);
  res.json({success:true});
});

app.delete('/api/setup-rules/:id', requireEdit, (req, res) => {
  db.prepare('DELETE FROM setup_rules WHERE id=?').run(req.params.id);
  res.json({success:true});
});

// ================== 设置 ==================
app.get('/api/settings', requireAuth, (req, res) => {
  const settings = db.prepare('SELECT * FROM settings WHERE id=1').get();
  res.json({ settings });
});

app.put('/api/settings', requireEdit, (req, res) => {
  const {
    work_start, work_end,
    break_lunch_start, break_lunch_end,
    break_dinner_start, break_dinner_end
  } = req.body || {};

  const values = [
    work_start, work_end,
    break_lunch_start, break_lunch_end,
    break_dinner_start, break_dinner_end
  ];

  if (values.some(v => !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')))) {
    return res.json({ success: false, message: '时间格式不正确，请使用 HH:mm' });
  }
  if (work_start >= work_end) {
    return res.json({ success: false, message: '上班时间必须早于下班时间' });
  }
  if (break_lunch_start >= break_lunch_end || break_dinner_start >= break_dinner_end) {
    return res.json({ success: false, message: '休息时间设置不正确' });
  }
  if (break_lunch_start < work_start || break_lunch_end > work_end ||
      break_dinner_start < work_start || break_dinner_end > work_end) {
    return res.json({ success: false, message: '休息时间必须位于工作时段内' });
  }
  if (!(break_lunch_end <= break_dinner_start || break_dinner_end <= break_lunch_start)) {
    return res.json({ success: false, message: '午休和晚休时间不能重叠' });
  }

  db.prepare('UPDATE settings SET work_start=?, work_end=?, break_lunch_start=?, break_lunch_end=?, break_dinner_start=?, break_dinner_end=? WHERE id=1')
    .run(work_start, work_end, break_lunch_start, break_lunch_end, break_dinner_start, break_dinner_end);
  audit(req, 'update', 'settings', 1, { work_start, work_end, break_lunch_start, break_lunch_end, break_dinner_start, break_dinner_end });
  io.emit('schedule_update', { message: '工作时间设置已更新' });
  res.json({ success: true });
});

// Socket.IO
io.use((socket, next) => {
  const sessionId = socket.request.headers.cookie || '';
  // Socket.IO 连接仅用于实时刷新；真正的写操作仍通过受保护的 HTTP API。
  if (!sessionId) return next(new Error('unauthorized'));
  next();
});
io.on('connection', (socket) => {
  socket.on('schedule_changed', (data) => {
    io.emit('schedule_update', {
      message: String(data?.message || '排程已更新').slice(0, 200)
    });
  });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('全局错误:', err.stack);
  res.status(500).json({ success: false, message: '服务器内部错误，请查看服务器日志' });
});

app.get('/api/schedule/precheck', requireAuth, (req,res)=>{
  try {
    const settings = db.prepare('SELECT * FROM settings WHERE id=1').get();
    const orders = db.prepare("SELECT * FROM orders WHERE status IN ('pending','scheduled','running')").all();
    const machines = db.prepare("SELECT * FROM machines WHERE status='active'").all();
    const products = db.prepare('SELECT * FROM product_data').all();
    const issues = [];
    if (!settings) issues.push('系统设置不存在');
    if (!machines.length) issues.push('没有启用的设备');
    let noCapacity=0, noProcess=0, noMold=0, noQty=0;
    for (const o of orders) {
      if (!(Number(o.quantity)>0)) noQty++;
      if (!o.process) noProcess++;
      if (!o.mold) noMold++;
      if (!(Number(o.capacity)>0)) noCapacity++;
    }
    if (noQty) issues.push(`有 ${noQty} 单数量无效`);
    if (noProcess) issues.push(`有 ${noProcess} 单未填写设备`);
    if (noMold) issues.push(`有 ${noMold} 单未填写刀模`);
    res.json({success:true, ready:issues.length===0, issues, counts:{orders:orders.length,machines:machines.length,products:products.length,noCapacity,noProcess,noMold,noQty}});
  } catch(err){
    console.error('排程预检失败:',err.stack||err.message);
    res.status(500).json({success:false,message:'排程预检失败：'+err.message});
  }
});

app.get('/api/health', (req, res) => {
  try {
    const check = db.prepare('SELECT 1 AS ok').get();
    res.json({ ok: check?.ok === 1, service: 'diecut-schedule', time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ ok: false });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 服务器已启动，访问地址: http://localhost:${PORT}`);
});