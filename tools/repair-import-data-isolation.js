const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'diecut-schedule');
const serverFile = path.join(root, 'server.js');
const indexFile = path.join(root, 'public', 'index.html');

let server = fs.readFileSync(serverFile, 'utf8');
let index = fs.readFileSync(indexFile, 'utf8');

const marker = '// V5.2-IMPORT-DATA-SCOPE-ISOLATION';

function fail(message) { throw new Error(message); }
function mustReplace(source, regex, replacement, label) {
  if (!regex.test(source)) fail(`Patch target not found: ${label}`);
  return source.replace(regex, replacement);
}

// 1) Workflow/production workbook import is owned by Orders page, but reads master data only.
const workflowStart = server.indexOf("app.post('/api/workflow/import'");
const workflowEndMarker = "// V5.1.4-WORKFLOW-FIELDS-VERIFIED";
const workflowEnd = server.indexOf(workflowEndMarker, workflowStart);
if (workflowStart < 0 || workflowEnd < 0) fail('Workflow import route boundary not found');
let workflow = server.slice(workflowStart, workflowEnd);

if (!workflow.includes("req.body?.source_page !== 'orders'")) {
  workflow = mustReplace(
    workflow,
    /(const filename=String\(req\.body\?\.filename \|\| 'workflow\.xlsx'\)\.slice\(0,200\);)/,
    "$1\n    if (req.body?.source_page !== 'orders') return res.status(403).json({success:false,message:'工作流Excel只能从订单管理页面导入'});",
    'workflow source ownership guard'
  );
}

// Delete old Excel -> product_data write-back. The order/workflow import only reads master data.
workflow = workflow.replace(/\n    \/\/ 自动把刀模\/工艺\/模数跳距写回产品主数据，设备字段单独保存\。[\s\S]*?\n    productTx\(\);\n\n    \/\/ 重新加载主数据，确保“品号→刀模\/工艺\/设备”匹配使用最新结果。\n    const mergedRows=db\.prepare\('SELECT \* FROM product_data'\)\.all\(\);\n    const mergedMap=new Map\(mergedRows\.map\(p=>\[normalizeProductCode\(p\.product_code\),p\]\)\);\n    const normalized=workRows\.map\(\(r,i\)=>extractWorkflowRow\(r,i,mergedMap,excelContext\)\);/, "\n    // V5.2: 订单工作簿只读取产品主数据，绝不反向写入 product_data。\n    const productRows=db.prepare('SELECT * FROM product_data').all();\n    const productMap=new Map(productRows.map(p=>[normalizeProductCode(p.product_code),p]));\n    const normalized=workRows.map((r,i)=>extractWorkflowRow(r,i,productMap,excelContext));");
if (/INSERT INTO product_data|UPDATE product_data|upsertProduct|productTx\(\)/i.test(workflow)) fail('Workflow import still contains product_data write-back code');
server = server.slice(0, workflowStart) + workflow + server.slice(workflowEnd);

// 2) Orders batch import is owned by Orders page only.
const orderBatchStart = server.indexOf("app.post('/api/orders/batch-import'");
const orderBatchEnd = server.indexOf("app.get('/api/orders/export'", orderBatchStart);
if (orderBatchStart < 0 || orderBatchEnd < 0) fail('Order batch import route not found');
let orderBatch = server.slice(orderBatchStart, orderBatchEnd);
if (!orderBatch.includes("req.body?.source_page !== 'orders'")) {
  orderBatch = mustReplace(orderBatch, /(const \{ orders \} = req\.body;)/, "$1\n    if (req.body?.source_page !== 'orders') return res.status(403).json({ success:false, message:'订单Excel只能从订单管理页面导入' });", 'order batch source guard');
}
if (/INSERT INTO product_data|UPDATE product_data|INSERT INTO machines|UPDATE machines/i.test(orderBatch)) fail('Order batch import writes master data');
server = server.slice(0, orderBatchStart) + orderBatch + server.slice(orderBatchEnd);

// 3) Normalize route is also owned by Orders page.
const normalizeStart = server.indexOf("app.post('/api/orders/import-normalize'");
const normalizeEnd = server.indexOf("app.post('/api/orders/batch-import'", normalizeStart);
if (normalizeStart < 0 || normalizeEnd < 0) fail('Order normalize route not found');
let normalizeRoute = server.slice(normalizeStart, normalizeEnd);
if (!normalizeRoute.includes("req.body?.source_page !== 'orders'")) {
  normalizeRoute = mustReplace(normalizeRoute, /(const rows = Array\.isArray\(req\.body\?\.rows\) \? req\.body\.rows : \[\];)/, "$1\n    if (req.body?.source_page !== 'orders') return res.status(403).json({ success:false, message:'订单Excel只能从订单管理页面导入' });", 'order normalize source guard');
}
server = server.slice(0, normalizeStart) + normalizeRoute + server.slice(normalizeEnd);

// 4) Product-data import endpoint is owned by Products page only.
const productImportStart = server.indexOf("app.post('/api/product-data/batch-import'");
const productImportEnd = server.indexOf("// ================== 设备管理", productImportStart);
if (productImportStart < 0 || productImportEnd < 0) fail('Product import route not found');
let productImport = server.slice(productImportStart, productImportEnd);
if (!productImport.includes("req.body?.source_page !== 'products'")) {
  productImport = mustReplace(productImport, /(const \{ products \} = req\.body;)/, "$1\n  if (req.body?.source_page !== 'products') return res.status(403).json({ success:false, message:'产品数据Excel只能从产品数据页面导入' });", 'product source guard');
}
server = server.slice(0, productImportStart) + productImport + server.slice(productImportEnd);

// 5) Add a dedicated machine Excel endpoint owned by Machines page only.
if (!server.includes("app.post('/api/machines/batch-import'")) {
  const machineSection = server.indexOf('// ================== 设备管理');
  const machineDeleteStart = server.indexOf("app.delete('/api/machines/:id'", machineSection);
  const scheduleSection = server.indexOf('// ================== 智能排程', machineDeleteStart);
  if (machineSection < 0 || machineDeleteStart < 0 || scheduleSection < 0) fail('Machine route insertion anchor not found');
  const machineImportRoute = `
// V5.2: 设备Excel只能由“设备管理”页面写入 machines。
app.post('/api/machines/batch-import', requireEdit, (req, res) => {
  try {
    if (req.body?.source_page !== 'machines') return res.status(403).json({ success:false, message:'设备Excel只能从设备管理页面导入' });
    const items = Array.isArray(req.body?.machines) ? req.body.machines : [];
    if (!items.length) return res.status(400).json({ success:false, message:'设备Excel没有可导入的数据' });
    const findExisting = db.prepare('SELECT id FROM machines WHERE name=? ORDER BY id ASC LIMIT 1');
    const insert = db.prepare('INSERT INTO machines(name,machine_type,status,remark) VALUES (?,?,?,?)');
    const update = db.prepare('UPDATE machines SET machine_type=?, status=?, remark=? WHERE id=?');
    let created = 0;
    let updated = 0;
    const tx = db.transaction(() => {
      for (const m of items) {
        const name = normalizeImportText(m.name);
        if (!name) continue;
        const type = normalizeImportText(m.machine_type) || '其他设备';
        const rawStatus = String(m.status || '').trim().toLowerCase();
        const status = ['inactive','停用','禁用','关闭','停机'].includes(rawStatus) ? 'inactive' : 'active';
        const remark = normalizeImportText(m.remark);
        const existing = findExisting.get(name);
        if (existing) { update.run(type, status, remark, existing.id); updated += 1; }
        else { insert.run(name, type, status, remark); created += 1; }
      }
    });
    tx();
    audit(req, 'import', 'machines', '', {source:'excel-machine-page', created, updated, count:items.length});
    io.emit('machine_update');
    res.json({success:true,count:items.length,created,updated});
  } catch (err) {
    console.error('设备Excel导入失败:', err.stack || err.message);
    res.status(500).json({success:false,message:'设备Excel导入失败：' + err.message});
  }
});

`;
  server = server.slice(0, scheduleSection) + machineImportRoute + server.slice(scheduleSection);
}

// 6) Order imports must never auto-create equipment in machines.
const ensureStart = server.indexOf('function ensureMachinesForOrders');
if (ensureStart >= 0) {
  const ensureEnd = server.indexOf('\nfunction ', ensureStart + 10);
  if (ensureEnd > ensureStart) {
    const replacement = `function ensureMachinesForOrders(orders) {
  // V5.2 数据归属隔离：订单/工作流导入得到的设备只保存在订单字段；绝不自动写入 machines。
  const existing = db.prepare('SELECT * FROM machines').all();
  return { machines: existing, created: [] };
}`;
    const existingBlock = server.slice(ensureStart, ensureEnd);
    if (!existingBlock.includes('V5.2 数据归属隔离')) server = server.slice(0, ensureStart) + replacement + server.slice(ensureEnd);
  }
}

if (!server.includes(marker)) server += `\n${marker}\n`;
fs.writeFileSync(serverFile, server);

// ---- index.html: explicit page ownership for each Excel upload ----
if (!index.includes("source_page: 'products'")) {
  index = mustReplace(index, /body: JSON\.stringify\(\{ products \}\)/, "body: JSON.stringify({ products, source_page: 'products' })", 'product payload owner');
}
if (!index.includes("source_page:'orders'")) {
  index = mustReplace(index, /body: JSON\.stringify\(\{ filename:file\.name, rows:all, snapshot_date:new Date\(\)\.toISOString\(\)\.slice\(0,10\) \}\)/, "body: JSON.stringify({ filename:file.name, rows:all, snapshot_date:new Date().toISOString().slice(0,10), source_page:'orders' })", 'workflow payload owner');
}
if (!index.includes('orders: chunk, source_page')) {
  index = mustReplace(index, /body: JSON\.stringify\(\{ orders: chunk \}\)/, "body: JSON.stringify({ orders: chunk, source_page:'orders' })", 'order batch payload owner');
}
if (!index.includes("async function importMachines(input)")) {
  const machineFunction = `
    // V5.2: 设备管理页面专属Excel导入；不会由订单/工作流页面触发。
    async function importMachines(input) {
      const file = input.files[0];
      if (!file) return;
      try {
        showLoading();
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type:'array', cellDates:true });
        if (!wb.SheetNames.length) throw new Error('Excel 没有工作表');
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval:'', raw:true });
        if (!rows.length) throw new Error('Excel 没有数据');
        const machines = rows.map(row => ({
          name: row['设备名称'] || row['设备'] || row['机台'] || row['机器'] || row['name'] || row['machine_name'] || '',
          machine_type: row['设备类型'] || row['类型'] || row['机器类型'] || row['machine_type'] || '',
          status: row['状态'] || row['status'] || 'active',
          remark: row['备注'] || row['说明'] || row['remark'] || ''
        })).filter(x => String(x.name).trim());
        if (!machines.length) throw new Error('未识别到有效设备数据，请使用“设备名称/设备”列');
        const result = await apiJson('/api/machines/batch-import', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({machines,source_page:'machines'}) });
        hideLoading();
        showToast('设备Excel导入完成：' + (result.count || machines.length) + ' 条，新增 ' + (result.created || 0) + ' 台，更新 ' + (result.updated || 0) + ' 台', 'success');
        loadMachines();
      } catch (err) {
        hideLoading();
        console.error('设备Excel导入失败', err);
        showToast(err.message || '设备Excel导入失败','danger');
      } finally { input.value=''; }
    }

`;
  index = mustReplace(index, /\n    \/\/ ========== 排产看板 ==========/, `\n${machineFunction}    // ========== 排产看板 ==========`, 'machine import function anchor');
}

if (!index.includes('onchange="importMachines(this)"')) {
  const label = '<label class="btn btn-sm btn-outline-info"><input type="file" hidden accept=".xlsx,.xls" onchange="importMachines(this)">导入Excel</label>';
  const machineHeader = /<div class="card-header">设备管理[\s\S]*?<\/div>\n\s*<div class="card-body"><table class="table" id="machinesTable">/;
  if (machineHeader.test(index)) {
    index = index.replace(machineHeader, m => {
      if (m.includes('导入Excel')) return m;
      return m.replace(/设备管理\s*([^<]*<\/div>)/, `设备管理 ${currentUser.role!=='viewer'?'<div><button class="btn btn-sm btn-primary me-1" onclick="showMachineModal()">新增设备</button>${label}</div>':''}</div>`);
    });
  }
}

if (!index.includes(marker)) index += `\n${marker}\n`;
fs.writeFileSync(indexFile, index);

console.log('IMPORT_DATA_SCOPE_ISOLATION_APPLIED');
