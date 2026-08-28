const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'diecut-schedule');
const serverFile = path.join(root, 'server.js');
const indexFile = path.join(root, 'public', 'index.html');

let server = fs.readFileSync(serverFile, 'utf8');
let index = fs.readFileSync(indexFile, 'utf8');
const marker = '// V5.2-IMPORT-DATA-SCOPE-ISOLATION';

function must(ok, message) {
  if (!ok) throw new Error(message);
}

// ----- server: workflow Excel belongs to Orders and only reads product master -----
const workflowStart = server.indexOf("app.post('/api/workflow/import'");
const workflowEnd = server.indexOf("\napp.post('/api/", workflowStart + 20);
must(workflowStart >= 0 && workflowEnd > workflowStart, 'workflow import route not found');
let workflow = server.slice(workflowStart, workflowEnd);

if (!workflow.includes("req.body?.source_page !== 'orders'")) {
  const filenameLine = "    const filename=String(req.body?.filename || 'workflow.xlsx').slice(0,200);";
  const fi = workflow.indexOf(filenameLine);
  must(fi >= 0, 'workflow filename anchor not found');
  workflow = workflow.slice(0, fi + filenameLine.length)
    + "\n    if (req.body?.source_page !== 'orders') return res.status(403).json({success:false,message:'工作流Excel只能从订单管理页面导入'});"
    + workflow.slice(fi + filenameLine.length);
}

const productStart = workflow.indexOf("    const productRows=db.prepare('SELECT * FROM product_data').all();");
const normalizedMarker = "    const normalized=workRows.map((r,i)=>extractWorkflowRow(r,i,mergedMap,excelContext));";
must(productStart >= 0, 'workflow product-data read anchor not found');
const normalizedPos = workflow.indexOf(normalizedMarker, productStart);
must(normalizedPos >= 0, 'workflow normalized anchor not found');
const readOnlyBlock = "    const productRows=db.prepare('SELECT * FROM product_data').all();\n    const productMap=new Map(productRows.map(p=>[normalizeProductCode(p.product_code),p]));\n    const normalized=workRows.map((r,i)=>extractWorkflowRow(r,i,productMap,excelContext));";
workflow = workflow.slice(0, productStart) + readOnlyBlock + workflow.slice(normalizedPos + normalizedMarker.length);
server = server.slice(0, workflowStart) + workflow + server.slice(workflowEnd);

// ----- server: Orders batch/normalize are order-owned -----
const normalizeStart = server.indexOf("app.post('/api/orders/import-normalize'");
const batchStart = server.indexOf("app.post('/api/orders/batch-import'");
must(normalizeStart >= 0 && batchStart > normalizeStart, 'order import routes not found');
let normalizeRoute = server.slice(normalizeStart, batchStart);
if (!normalizeRoute.includes("req.body?.source_page !== 'orders'")) {
  const rowsLine = "    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];";
  const ri = normalizeRoute.indexOf(rowsLine);
  must(ri >= 0, 'order normalize rows anchor not found');
  normalizeRoute = normalizeRoute.slice(0, ri + rowsLine.length)
    + "\n    if (req.body?.source_page !== 'orders') return res.status(403).json({success:false,message:'订单Excel只能从订单管理页面导入'});"
    + normalizeRoute.slice(ri + rowsLine.length);
}
server = server.slice(0, normalizeStart) + normalizeRoute + server.slice(batchStart);

const batchEnd = server.indexOf("app.get('/api/orders/export'", batchStart);
must(batchEnd > batchStart, 'order batch end anchor not found');
let batch = server.slice(batchStart, batchEnd);
if (!batch.includes("req.body?.source_page !== 'orders'")) {
  const ordersLine = '    const { orders } = req.body;';
  const oi = batch.indexOf(ordersLine);
  must(oi >= 0, 'order batch orders anchor not found');
  batch = batch.slice(0, oi + ordersLine.length)
    + "\n    if (req.body?.source_page !== 'orders') return res.status(403).json({success:false,message:'订单Excel只能从订单管理页面导入'});"
    + batch.slice(oi + ordersLine.length);
}
server = server.slice(0, batchStart) + batch + server.slice(batchEnd);

// ----- server: Product Data import is products-owned -----
const productImportStart = server.indexOf("app.post('/api/product-data/batch-import'");
const productImportEnd = server.indexOf('// ================== 设备管理', productImportStart);
must(productImportStart >= 0 && productImportEnd > productImportStart, 'product import route not found');
let productImport = server.slice(productImportStart, productImportEnd);
if (!productImport.includes("req.body?.source_page !== 'products'")) {
  const productsLine = '  const { products } = req.body;';
  const pi = productImport.indexOf(productsLine);
  must(pi >= 0, 'product import products anchor not found');
  productImport = productImport.slice(0, pi + productsLine.length)
    + "\n  if (req.body?.source_page !== 'products') return res.status(403).json({success:false,message:'产品数据Excel只能从产品数据页面导入'});"
    + productImport.slice(pi + productsLine.length);
}
server = server.slice(0, productImportStart) + productImport + server.slice(productImportEnd);

// ----- server: dedicated Devices Excel endpoint; no other import route writes machines -----
if (!server.includes("app.post('/api/machines/batch-import'")) {
  const scheduleMarker = '// ================== 智能排程';
  const insertAt = server.indexOf(scheduleMarker);
  must(insertAt >= 0, 'schedule marker not found');
  const machineRoute = `// V5.2: 设备Excel只能由“设备管理”页面写入 machines。\napp.post('/api/machines/batch-import', requireEdit, (req, res) => {\n  try {\n    if (req.body?.source_page !== 'machines') return res.status(403).json({success:false,message:'设备Excel只能从设备管理页面导入'});\n    const items = Array.isArray(req.body?.machines) ? req.body.machines : [];\n    if (!items.length) return res.status(400).json({success:false,message:'设备Excel没有可导入的数据'});\n    const findExisting = db.prepare('SELECT id FROM machines WHERE name=? ORDER BY id ASC LIMIT 1');\n    const insert = db.prepare('INSERT INTO machines(name,machine_type,status,remark) VALUES (?,?,?,?)');\n    const update = db.prepare('UPDATE machines SET machine_type=?, status=?, remark=? WHERE id=?');\n    let created = 0;\n    let updated = 0;\n    const tx = db.transaction(() => {\n      for (const m of items) {\n        const name = normalizeImportText(m.name);\n        if (!name) continue;\n        const type = normalizeImportText(m.machine_type) || '其他设备';\n        const statusText = normalizeImportText(m.status).toLowerCase();\n        const status = ['inactive','停用','禁用','关闭','停机'].includes(statusText) ? 'inactive' : 'active';\n        const remark = normalizeImportText(m.remark);\n        const existing = findExisting.get(name);\n        if (existing) { update.run(type,status,remark,existing.id); updated += 1; }\n        else { insert.run(name,type,status,remark); created += 1; }\n      }\n    });\n    tx();\n    audit(req,'import','machines','',{source:'excel-machine-page',created,updated,count:items.length});\n    io.emit('machine_update');\n    res.json({success:true,count:items.length,created,updated});\n  } catch (err) {\n    console.error('设备Excel导入失败:', err.stack || err.message);\n    res.status(500).json({success:false,message:'设备Excel导入失败：'+err.message});\n  }\n});\n\n`;
  server = server.slice(0, insertAt) + machineRoute + server.slice(insertAt);
}

if (!server.includes(marker)) server += `\n${marker}\n`;
fs.writeFileSync(serverFile, server);

// ----- index: attach owner to upload requests -----
index = index.replace(/body: JSON\.stringify\(\{ filename:file\.name, rows:all, snapshot_date:new Date\(\)\.toISOString\(\)\.slice\(0,10\) \}\)/g,
  "body: JSON.stringify({ filename:file.name, rows:all, snapshot_date:new Date().toISOString().slice(0,10), source_page:'orders' })");
index = index.replace(/body:JSON\.stringify\(\{filename:file\.name,rows:all,snapshot_date:new Date\(\)\.toISOString\(\)\.slice\(0,10\)\}\)/g,
  "body:JSON.stringify({filename:file.name,rows:all,snapshot_date:new Date().toISOString().slice(0,10),source_page:'orders'})");
index = index.replace(/body: JSON\.stringify\(\{ products \}\)/g,
  "body: JSON.stringify({ products, source_page: 'products' })");
index = index.replace(/body: JSON\.stringify\(\{ orders: chunk \}\)/g,
  "body: JSON.stringify({ orders: chunk, source_page:'orders' })");

// Add a dedicated import button beside the existing “新增设备” button.
if (!index.includes('onchange="importMachines(this)"')) {
  const oldHeader = `<div class="card-header">设备管理 ${currentUser.role!=='viewer'?'<button class="btn btn-sm btn-primary" onclick="showMachineModal()">新增设备</button>':''}</div>`;
  const newHeader = `<div class="card-header">设备管理 ${currentUser.role!=='viewer'?'<div><label class="btn btn-sm btn-outline-info me-2"><input type="file" hidden accept=".xlsx,.xls" onchange="importMachines(this)">导入Excel</label><button class="btn btn-sm btn-primary" onclick="showMachineModal()">新增设备</button></div>':''}</div>`;
  must(index.includes(oldHeader), 'machine page header anchor not found');
  index = index.replace(oldHeader, newHeader);
}

if (!index.includes('async function importMachines(input)')) {
  const anchor = '    // ========== 设备管理 ==========';
  const fn = `    // V5.2: 设备管理页面专属Excel导入。\n    async function importMachines(input) {\n      const file = input.files[0];\n      if (!file) return;\n      try {\n        showLoading();\n        const buffer = await file.arrayBuffer();\n        const wb = XLSX.read(buffer, {type:'array',cellDates:true});\n        if (!wb.SheetNames.length) throw new Error('Excel没有工作表');\n        const ws = wb.Sheets[wb.SheetNames[0]];\n        const rows = XLSX.utils.sheet_to_json(ws, {defval:'',raw:true});\n        const machines = rows.map(r => ({\n          name: r['设备名称'] || r['设备'] || r['机台'] || r['机器'] || r['name'] || r['machine_name'] || '',\n          machine_type: r['设备类型'] || r['类型'] || r['机器类型'] || r['machine_type'] || '',\n          status: r['状态'] || r['status'] || 'active',\n          remark: r['备注'] || r['说明'] || r['remark'] || ''\n        })).filter(x => String(x.name).trim());\n        if (!machines.length) throw new Error('未识别到有效设备数据，请检查Excel是否存在“设备名称/设备”列');\n        const result = await apiJson('/api/machines/batch-import', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({machines,source_page:'machines'})});\n        hideLoading();\n        showToast('设备Excel导入完成：'+(result.count||machines.length)+'条，新增'+(result.created||0)+'台，更新'+(result.updated||0)+'台','success');\n        loadMachines();\n      } catch (err) {\n        hideLoading();\n        showToast(err.message || '设备Excel导入失败','danger');\n      } finally { input.value=''; }\n    }\n\n`;
  must(index.includes(anchor), 'machine function anchor not found');
  index = index.replace(anchor, fn + anchor);
}

if (!index.includes(marker)) index += `\n${marker}\n`;
fs.writeFileSync(indexFile, index);

console.log('PAGE_OWNED_IMPORT_ISOLATION_APPLIED');
