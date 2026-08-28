const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'diecut-schedule');
const serverFile = path.join(root, 'server.js');
const indexFile = path.join(root, 'public', 'index.html');
let server = fs.readFileSync(serverFile, 'utf8');
let index = fs.readFileSync(indexFile, 'utf8');
const marker = '// V5.2-IMPORT-DATA-SCOPE-ISOLATION';
const must = (ok, msg) => { if (!ok) throw new Error(msg); };

// Orders/workflow Excel is allowed only from Orders page.
const workflowStart = server.indexOf("app.post('/api/workflow/import'");
const workflowEnd = server.indexOf("\napp.post('/api/", workflowStart + 20);
must(workflowStart >= 0 && workflowEnd > workflowStart, 'workflow import route not found');
let workflow = server.slice(workflowStart, workflowEnd);
if (!workflow.includes("req.body?.source_page !== 'orders'")) {
  const anchor = "    const filename=String(req.body?.filename || 'workflow.xlsx').slice(0,200);";
  const i = workflow.indexOf(anchor);
  must(i >= 0, 'workflow source-page anchor not found');
  workflow = workflow.slice(0, i + anchor.length) + "\n    if (req.body?.source_page !== 'orders') return res.status(403).json({success:false,message:'工作流Excel只能从订单管理页面导入'});" + workflow.slice(i + anchor.length);
}
// Make product master read-only during workflow import, but tolerate either old mergedMap or already-fixed productMap.
const readOnly = "    const productRows=db.prepare('SELECT * FROM product_data').all();\n    const productMap=new Map(productRows.map(p=>[normalizeProductCode(p.product_code),p]));\n    const normalized=workRows.map((r,i)=>extractWorkflowRow(r,i,productMap,excelContext));";
if (!workflow.includes(readOnly)) {
  const normalizedOld = "    const normalized=workRows.map((r,i)=>extractWorkflowRow(r,i,mergedMap,excelContext));";
  const n = workflow.indexOf(normalizedOld);
  if (n >= 0) {
    const p = workflow.indexOf("    const productRows=db.prepare('SELECT * FROM product_data').all();");
    must(p >= 0 && p < n, 'workflow product read anchor not found');
    workflow = workflow.slice(0, p) + readOnly + workflow.slice(n + normalizedOld.length);
  }
}
server = server.slice(0, workflowStart) + workflow + server.slice(workflowEnd);

// Orders normalize/batch Excel routes are Orders-owned.
const normStart = server.indexOf("app.post('/api/orders/import-normalize'");
const batchStart = server.indexOf("app.post('/api/orders/batch-import'");
must(normStart >= 0 && batchStart > normStart, 'orders import routes not found');
let normalize = server.slice(normStart, batchStart);
if (!normalize.includes("req.body?.source_page !== 'orders'")) {
  const rowsAnchor = "    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];";
  const i = normalize.indexOf(rowsAnchor);
  must(i >= 0, 'order normalize source-page anchor not found');
  normalize = normalize.slice(0, i + rowsAnchor.length) + "\n    if (req.body?.source_page !== 'orders') return res.status(403).json({success:false,message:'订单Excel只能从订单管理页面导入'});" + normalize.slice(i + rowsAnchor.length);
}
server = server.slice(0, normStart) + normalize + server.slice(batchStart);
const batchEnd = server.indexOf("app.get('/api/orders/export'", batchStart);
must(batchEnd > batchStart, 'orders batch end anchor not found');
let batch = server.slice(batchStart, batchEnd);
if (!batch.includes("req.body?.source_page !== 'orders'")) {
  const a = '    const { orders } = req.body;';
  const i = batch.indexOf(a);
  must(i >= 0, 'order batch source-page anchor not found');
  batch = batch.slice(0, i + a.length) + "\n    if (req.body?.source_page !== 'orders') return res.status(403).json({success:false,message:'订单Excel只能从订单管理页面导入'});" + batch.slice(i + a.length);
}
server = server.slice(0, batchStart) + batch + server.slice(batchEnd);

// Product Data Excel is owned by Products page.
const productStart = server.indexOf("app.post('/api/product-data/batch-import'");
const productEnd = server.indexOf('// ================== 设备管理', productStart);
must(productStart >= 0 && productEnd > productStart, 'product import route not found');
let productRoute = server.slice(productStart, productEnd);
if (!productRoute.includes("req.body?.source_page !== 'products'")) {
  const a = '  const { products } = req.body;';
  const i = productRoute.indexOf(a);
  must(i >= 0, 'product source-page anchor not found');
  productRoute = productRoute.slice(0, i + a.length) + "\n  if (req.body?.source_page !== 'products') return res.status(403).json({success:false,message:'产品数据Excel只能从产品数据页面导入'});" + productRoute.slice(i + a.length);
}
server = server.slice(0, productStart) + productRoute + server.slice(productEnd);

// Devices Excel is owned by Device Management page. Keep route separate from order imports.
if (!server.includes("app.post('/api/machines/batch-import'")) {
  const scheduleMarker = '// ================== 智能排程';
  const insertAt = server.indexOf(scheduleMarker);
  must(insertAt >= 0, 'schedule marker not found');
  const route = [
    '// V5.2: 设备Excel只能由“设备管理”页面写入 machines。',
    "app.post('/api/machines/batch-import', requireEdit, (req, res) => {",
    '  try {',
    "    if (req.body?.source_page !== 'machines') return res.status(403).json({success:false,message:'设备Excel只能从设备管理页面导入'});",
    '    const items = Array.isArray(req.body?.machines) ? req.body.machines : [];',
    "    if (!items.length) return res.status(400).json({success:false,message:'设备Excel没有可导入的数据'});",
    "    const findExisting = db.prepare('SELECT id FROM machines WHERE name=? ORDER BY id ASC LIMIT 1');",
    "    const insert = db.prepare('INSERT INTO machines(name,machine_type,status,remark) VALUES (?,?,?,?)');",
    "    const update = db.prepare('UPDATE machines SET machine_type=?, status=?, remark=? WHERE id=?');",
    '    let created = 0;',
    '    let updated = 0;',
    '    const tx = db.transaction(() => {',
    '      for (const m of items) {',
    '        const name = normalizeImportText(m.name);',
    '        if (!name) continue;',
    "        const type = normalizeImportText(m.machine_type) || '其他设备';",
    "        const statusText = normalizeImportText(m.status).toLowerCase();",
    "        const status = ['inactive','停用','禁用','关闭','停机'].includes(statusText) ? 'inactive' : 'active';",
    '        const remark = normalizeImportText(m.remark);',
    '        const existing = findExisting.get(name);',
    '        if (existing) { update.run(type,status,remark,existing.id); updated += 1; }',
    '        else { insert.run(name,type,status,remark); created += 1; }',
    '      }',
    '    });',
    '    tx();',
    "    audit(req,'import','machines','',{source:'excel-machine-page',created,updated,count:items.length});",
    "    io.emit('machine_update');",
    '    res.json({success:true,count:items.length,created,updated});',
    '  } catch (err) {',
    "    console.error('设备Excel导入失败:', err.stack || err.message);",
    "    res.status(500).json({success:false,message:'设备Excel导入失败：'+err.message});",
    '  }',
    '});',
    ''
  ].join('\n');
  server = server.slice(0, insertAt) + route + server.slice(insertAt);
}

// Existing stable rule: Excel 设备 is fallback for process; product_data.process can override it later.
const fnStart = server.indexOf('function autoNormalizeImportedOrder');
const fnEnd = server.indexOf("app.post('/api/orders/import-normalize'", fnStart);
must(fnStart >= 0 && fnEnd > fnStart, 'autoNormalizeImportedOrder not found');
let fn = server.slice(fnStart, fnEnd);
const pStart = fn.indexOf('  let process = normalizeImportText(findImportValue(row, [');
if (pStart >= 0) {
  const close = fn.indexOf('  ]));', pStart);
  must(close >= 0, 'process field close not found');
  const desired = "  let process = normalizeImportText(findImportValue(row, [\n    'process','工艺','制程','工序','设备','设备名称','设备编号','机台配置','机台','机台号','机器','机器编号','生产设备'\n  ]));";
  if (fn.slice(pStart, close + 6) !== desired) {
    fn = fn.slice(0, pStart) + desired + fn.slice(close + 6);
    server = server.slice(0, fnStart) + fn + server.slice(fnEnd);
  }
}

// Browser payload ownership: Orders, Products, Machines.
index = index.replace(/body: JSON\.stringify\(\{ filename:file\.name, rows:all, snapshot_date:new Date\(\)\.toISOString\(\)\.slice\(0,10\) \}\)/g,
  "body: JSON.stringify({ filename:file.name, rows:all, snapshot_date:new Date().toISOString().slice(0,10), source_page:'orders' })");
index = index.replace(/body:JSON\.stringify\(\{filename:file\.name,rows:all,snapshot_date:new Date\(\)\.toISOString\(\)\.slice\(0,10\)\}\)/g,
  "body:JSON.stringify({filename:file.name,rows:all,snapshot_date:new Date().toISOString().slice(0,10),source_page:'orders'})");
index = index.replace(/body: JSON\.stringify\(\{ products \}\)/g,
  "body: JSON.stringify({ products, source_page: 'products' })");
index = index.replace(/body: JSON\.stringify\(\{ orders: chunk \}\)/g,
  "body: JSON.stringify({ orders: chunk, source_page:'orders' })");

// Device page: add a dedicated Excel import button and handler without touching existing rendering logic.
if (!index.includes('onchange="importMachines(this)"')) {
  const headerRegex = /<div class="card-header">设备管理\s*\$\{currentUser\.role!==\\'viewer\\'\?\\'<button class="btn btn-sm btn-primary" onclick="showMachineModal\(\)\">新增设备<\/button>\\' : \'\'\}<\/div>/;
  if (headerRegex.test(index)) {
    index = index.replace(headerRegex, '<div class="card-header">设备管理 ${currentUser.role!==\'viewer\'?\'<div><label class="btn btn-sm btn-outline-info me-2"><input type="file" hidden accept=".xlsx,.xls" onchange="importMachines(this)">导入Excel</label><button class="btn btn-sm btn-primary" onclick="showMachineModal()">新增设备</button></div>\':\'\'}</div>');
  }
}
if (!index.includes('async function importMachines(input)')) {
  const anchor = '    // ========== 设备管理 ==========';
  if (index.includes(anchor)) {
    const fnUi = [
      '    // V5.2: 设备管理页面专属Excel导入。',
      '    async function importMachines(input) {',
      '      const file = input.files[0];',
      '      if (!file) return;',
      '      try {',
      '        showLoading();',
      '        const buffer = await file.arrayBuffer();',
      "        const wb = XLSX.read(buffer, {type:'array',cellDates:true});",
      "        if (!wb.SheetNames.length) throw new Error('Excel没有工作表');",
      '        const ws = wb.Sheets[wb.SheetNames[0]];',
      "        const rows = XLSX.utils.sheet_to_json(ws, {defval:'',raw:true});",
      '        const machines = rows.map(r => ({',
      "          name: r['设备名称'] || r['设备'] || r['机台'] || r['机器'] || r['name'] || r['machine_name'] || '',",
      "          machine_type: r['设备类型'] || r['类型'] || r['机器类型'] || r['machine_type'] || '',",
      "          status: r['状态'] || r['status'] || 'active',",
      "          remark: r['备注'] || r['说明'] || r['remark'] || ''",
      '        })).filter(x => String(x.name).trim());',
      "        if (!machines.length) throw new Error('未识别到有效设备数据，请检查Excel是否存在“设备名称/设备”列');",
      "        const result = await apiJson('/api/machines/batch-import', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({machines,source_page:'machines'})});",
      '        hideLoading();',
      "        showToast('设备Excel导入完成：'+(result.count||machines.length)+'条，新增'+(result.created||0)+'台，更新'+(result.updated||0)+'台','success');",
      '        loadMachines();',
      '      } catch (err) {',
      '        hideLoading();',
      "        showToast(err.message || '设备Excel导入失败','danger');",
      "      } finally { input.value=''; }",
      '    }',
      ''
    ].join('\n');
    index = index.replace(anchor, fnUi + anchor);
  }
}

if (!index.includes(marker)) index += `\n${marker}\n`;
fs.writeFileSync(serverFile, server);
fs.writeFileSync(indexFile, index);
console.log('PAGE_OWNED_IMPORT_ISOLATION_APPLIED');
