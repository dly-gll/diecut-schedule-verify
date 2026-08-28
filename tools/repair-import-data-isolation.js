const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'diecut-schedule');
const serverFile = path.join(root, 'server.js');
const indexFile = path.join(root, 'public', 'index.html');

let server = fs.readFileSync(serverFile, 'utf8');
let index = fs.readFileSync(indexFile, 'utf8');

const marker = '// V5.2-IMPORT-DATA-SCOPE-ISOLATION';

function replaceOnce(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Patch target not found: ${label}`);
  return source.replace(pattern, replacement);
}

// ---- server.js: order/workflow import must never write master-data tables ----
if (!server.includes(marker)) {
  const workflowRouteRegex = /app\.post\('\/api\/workflow\/import',[\s\S]*?\n\}\);\n\n\n\/\/ V5\.1\.4-WORKFLOW-FIELDS-VERIFIED/;
  const workflowMatch = server.match(workflowRouteRegex);
  if (!workflowMatch) throw new Error('Workflow import route not found');
  let workflowRoute = workflowMatch[0];

  workflowRoute = replaceOnce(
    workflowRoute,
    /(const filename=String\(req\.body\?\.filename \|\| 'workflow\.xlsx'\)\.slice\(0,200\);)/,
    "$1\n    if (req.body?.source_page !== 'orders') return res.status(403).json({success:false,message:'工作流Excel只能从订单管理页面导入'});",
    'workflow source_page guard'
  );

  workflowRoute = replaceOnce(
    workflowRoute,
    /\n    const excelContext=buildWorkflowExcelContext\(rows\);/,
    "\n    const excelContext=buildWorkflowExcelContext(rows);\n    // V5.2 数据归属隔离：订单/工作流导入只读取产品主数据，不得把Excel反向写入 product_data。",
    'workflow isolation comment'
  );

  // Remove the old Excel -> product_data write-back block.
  workflowRoute = replaceOnce(
    workflowRoute,
    /\n    const productRows=db\.prepare\('SELECT \* FROM product_data'\)\.all\(\);\n    const productMap=new Map\(productRows\.map\(p=>\[normalizeProductCode\(p\.product_code\),p\]\)\);\n    for \(const \[code,p\] of excelContext\.products\) \{[\s\S]*?\n    productTx\(\);\n\n    \/\/ 重新加载主数据，确保“品号→刀模\/工艺\/设备”匹配使用最新结果。\n    const mergedRows=db\.prepare\('SELECT \* FROM product_data'\)\.all\(\);\n    const mergedMap=new Map\(mergedRows\.map\(p=>\[normalizeProductCode\(p\.product_code\),p\]\)\);\n    const normalized=workRows\.map\(\(r,i\)=>extractWorkflowRow\(r,i,mergedMap,excelContext\)\);/,
    "\n    // 订单/工作流导入只能读取当前产品主数据；Excel中的刀模基表、设备、模数跳距等字段不得回写主数据。\n    const productRows=db.prepare('SELECT * FROM product_data').all();\n    const productMap=new Map(productRows.map(p=>[normalizeProductCode(p.product_code),p]));\n    const normalized=workRows.map((r,i)=>extractWorkflowRow(r,i,productMap,excelContext));",
    'workflow product-data write-back removal'
  );

  server = server.replace(workflowRouteRegex, workflowRoute);

  // Only the products page may call the product-data import endpoint.
  server = replaceOnce(
    server,
    /(app\.post\('\/api\/product-data\/batch-import', requireEdit, \(req, res\) => \{\n  try \{\n    const \{ products \} = req\.body;)/,
    "$1\n    if (req.body?.source_page !== 'products') return res.status(403).json({ success:false, message:'产品数据Excel只能从产品数据页面导入' });",
    'product import source_page guard'
  );

  // Only the orders page may call the order batch import endpoint.
  server = replaceOnce(
    server,
    /(app\.post\('\/api\/orders\/batch-import', requireEdit, \(req, res\) => \{\n  try \{\n    const \{ orders \} = req\.body;)/,
    "$1\n    if (req.body?.source_page !== 'orders') return res.status(403).json({ success:false, message:'订单Excel只能从订单管理页面导入' });",
    'order import source_page guard'
  );

  // Device Excel import is a dedicated endpoint owned by the device-management page.
  const machineAnchor = /app\.delete\('\/api\/machines\/:id',[\s\S]*?\n\}\);\n\n\/\/ ================== 智能排程/;
  const machineMatch = server.match(machineAnchor);
  if (!machineMatch) throw new Error('Machine route insertion anchor not found');
  const machineImportRoute = `

// V5.2 设备管理Excel导入：只有设备管理页面允许写入 machines。
app.post('/api/machines/batch-import', requireEdit, (req, res) => {
  try {
    if (req.body?.source_page !== 'machines') {
      return res.status(403).json({ success:false, message:'设备Excel只能从设备管理页面导入' });
    }
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
        const status = ['inactive','停用','禁用','关闭','停机'].includes(String(m.status || '').trim().toLowerCase()) ? 'inactive' : 'active';
        const remark = normalizeImportText(m.remark);
        const existing = findExisting.get(name);
        if (existing) {
          update.run(type, status, remark, existing.id);
          updated += 1;
        } else {
          insert.run(name, type, status, remark);
          created += 1;
        }
      }
    });
    tx();
    audit(req, 'import', 'machines', '', { source:'excel-machine-page', created, updated, count:items.length });
    io.emit('machine_update');
    res.json({ success:true, count:items.length, created, updated });
  } catch (err) {
    console.error('设备Excel导入失败:', err.stack || err.message);
    res.status(500).json({ success:false, message:'设备Excel导入失败：' + err.message });
  }
});
`;
  server = server.replace(machineAnchor, machineMatch[0].replace("\n\n// ================== 智能排程", machineImportRoute + "\n// ================== 智能排程"));

  server = server.replace("// V5.2-IMPORT-DATA-SCOPE-ISOLATION", marker);
  fs.writeFileSync(serverFile, server);
}

// ---- index.html: each management page owns its own Excel import ----
if (!index.includes(marker)) {
  // Product page import explicitly declares its owner.
  index = replaceOnce(
    index,
    /(body: JSON\.stringify\(\{ products \}\))/,
    "body: JSON.stringify({ products, source_page: 'products' })",
    'product import source_page payload'
  );

  // Standard production workbook imported from order management declares orders ownership.
  index = replaceOnce(
    index,
    /(body: JSON\.stringify\(\{ filename:file\.name, rows:all, snapshot_date:new Date\(\)\.toISOString\(\)\.slice\(0,10\) \}\))/,
    "body: JSON.stringify({ filename:file.name, rows:all, snapshot_date:new Date().toISOString().slice(0,10), source_page:'orders' })",
    'workflow import source_page payload'
  );

  // Normal order import declares orders ownership.
  index = replaceOnce(
    index,
    /(body: JSON\.stringify\(\{ rows \}\))/,
    "body: JSON.stringify({ rows, source_page: 'orders' })",
    'order normalize source_page payload'
  );

  // Normal order batch import declares orders ownership.
  index = replaceOnce(
    index,
    /(body: JSON\.stringify\(\{ orders: chunk \}\))/,
    "body: JSON.stringify({ orders: chunk, source_page:'orders' })",
    'order batch import source_page payload'
  );

  // Add device Excel button to the device-management page.
  index = replaceOnce(
    index,
    /(<div class="card-header">设备管理 \$\{currentUser\.role!='viewer'\?'\<button class="btn btn-sm btn-primary" onclick="showMachineModal\(\)"\>新增设备<\/button>':''\}<\/div>)/,
    "<div class=\"card-header\">设备管理 ${currentUser.role!=='viewer'?'<div><button class=\"btn btn-sm btn-primary me-1\" onclick=\"showMachineModal()\">新增设备</button><label class=\"btn btn-sm btn-outline-info\"><input type=\"file\" hidden accept=\".xlsx,.xls\" onchange=\"importMachines(this)\">导入Excel</label></div>':''}</div>",
    'machine page import button'
  );

  // Add the dedicated machine import function immediately before the schedule-board section.
  const machineFunction = `
    // 设备管理Excel导入：只有当前“设备管理”页面可以写入 machines。
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
        const result = await apiJson('/api/machines/batch-import', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ machines, source_page:'machines' })
        });
        hideLoading();
        showToast(
          `设备Excel导入完成：${result.count || machines.length} 条，新增 ${result.created || 0} 台，更新 ${result.updated || 0} 台`,
          'success'
        );
        loadMachines();
      } catch (err) {
        hideLoading();
        console.error('设备Excel导入失败', err);
        showToast(err.message || '设备Excel导入失败', 'danger');
      } finally {
        input.value='';
      }
    }

`;
  index = replaceOnce(index, /\n    \/\/ ========== 排产看板 ==========/, `\n${machineFunction}    // ========== 排产看板 ==========`, 'machine import function anchor');

  index = index.replace("// V5.2-IMPORT-DATA-SCOPE-ISOLATION", marker);
  fs.writeFileSync(indexFile, index);
}

console.log('IMPORT_DATA_SCOPE_ISOLATION_APPLIED');
