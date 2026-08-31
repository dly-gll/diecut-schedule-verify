const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'diecut-schedule');
const serverFile = path.join(root, 'server.js');
const indexFile = path.join(root, 'public', 'index.html');
let server = fs.readFileSync(serverFile, 'utf8');
let index = fs.readFileSync(indexFile, 'utf8');
const marker = '// V5.2-EMPTY-BOARD-VIEW-FIX';
if (server.includes(marker)) {
  console.log('EMPTY_BOARD_VIEW_FIX_ALREADY_APPLIED');
  process.exit(0);
}

function must(ok, message) { if (!ok) throw new Error(message); }

// Override the board endpoint before the existing handler. When a stage has no rows in
// the newest batch, fall back to the newest batch that actually contains that stage.
const boardAnchor = "app.get('/api/workflow/board'";
const boardPos = server.indexOf(boardAnchor);
must(boardPos >= 0, 'workflow board route not found');
const boardRoute = `// V5.2: 保证当天未导入新数据时仍可查看最近一次有效批次。\napp.get('/api/workflow/board', requireAuth, (req, res) => {\n  try {\n    const stage = String(req.query.stage || 'shortage');\n    const allowed = new Set(['shortage','available_to_issue','waiting_schedule','in_process']);\n    if (!allowed.has(stage)) return res.status(400).json({success:false,message:'无效的看板板块'});\n\n    const batch = db.prepare(\n      \`SELECT b.id, b.snapshot_date, b.imported_at, b.filename\n       FROM workflow_import_batches b\n       JOIN workflow_snapshots s ON s.batch_id=b.id AND s.stage=?\n       WHERE s.work_order_number IS NOT NULL AND TRIM(s.work_order_number)<>''\n       GROUP BY b.id\n       ORDER BY b.id DESC\n       LIMIT 1\`\n    ).get(stage);\n\n    if (!batch) return res.json({success:true, stage, count:0, rows:[], alerts:[], latest_import_date:null, data_date:null});\n\n    const rows = db.prepare(\n      \`SELECT s.*,\n              o.id AS order_id, o.status AS order_status, o.quantity AS order_quantity,\n              o.shipping_quantity AS order_shipping_quantity,\n              o.shipping_required_date AS order_shipping_required_date,\n              o.delivery_date AS order_delivery_date,\n              o.workflow_expected_date AS order_workflow_expected_date,\n              o.workflow_production_progress AS order_production_progress,\n              o.workflow_material_status AS order_material_status,\n              o.workflow_shortage_detail AS order_shortage_detail,\n              o.product_code AS order_product_code, o.product_name AS order_product_name\n       FROM workflow_snapshots s\n       LEFT JOIN orders o ON o.order_number=s.work_order_number\n       WHERE s.batch_id=? AND s.stage=?\n         AND s.id IN (\n           SELECT MAX(s2.id) FROM workflow_snapshots s2\n           WHERE s2.batch_id=? AND s2.stage=?\n           GROUP BY s2.work_order_number\n         )\n       ORDER BY COALESCE(NULLIF(s.shipping_required_date,''), NULLIF(o.shipping_required_date,''), NULLIF(s.delivery_date,''), NULLIF(o.delivery_date,''), s.expected_date, o.workflow_expected_date, '9999-12-31'), s.id ASC\`\n    ).all(batch.id, stage, batch.id, stage);\n\n    const projected = rows.map(r => {\n      const quantity = Number(r.quantity) > 0 ? Number(r.quantity) : Number(r.order_quantity) || 0;\n      const shippingQuantity = Number(r.shipping_quantity) >= 0 ? Number(r.shipping_quantity) : (Number(r.order_shipping_quantity) || 0);\n      const shippingRequiredDate = r.shipping_required_date || r.order_shipping_required_date || r.delivery_date || r.order_delivery_date || '';\n      const expectedDate = r.expected_date || r.order_workflow_expected_date || '';\n      const productionProgress = r.production_progress || r.order_production_progress || '';\n      const materialStatus = r.material_status || r.order_material_status || '';\n      const shortageDetail = r.shortage_detail || r.order_shortage_detail || '';\n      return {\n        order_number:r.work_order_number,\n        product_code:r.product_code || r.order_product_code || '',\n        product_name:r.product_name || r.order_product_name || '',\n        quantity,\n        shipping_quantity:shippingQuantity,\n        shipping_required_date:shippingRequiredDate,\n        delivery_date:r.delivery_date || r.order_delivery_date || '',\n        workflow_expected_date:expectedDate,\n        production_progress:productionProgress,\n        material_status:materialStatus,\n        shortage_detail:shortageDetail,\n        workflow_production_progress:productionProgress,\n        workflow_material_status:materialStatus,\n        workflow_shortage_detail:shortageDetail,\n        order_status:r.order_status || '',\n        workflow_status_text:r.status_text || ''\n      };\n    });\n\n    res.json({success:true, stage, count:projected.length, rows:projected, alerts:[], latest_import_date:batch.snapshot_date, data_date:batch.snapshot_date, filename:batch.filename || ''});\n  } catch (err) {\n    console.error('读取排产看板失败:', err.stack || err.message);\n    res.status(500).json({success:false,message:'读取排产看板失败：'+err.message});\n  }\n});\n\n`;
server = server.slice(0, boardPos) + boardRoute + server.slice(boardPos);

// Override KPI endpoint so page refresh reads the last calculated KPI snapshot instead of
// inventing a 100% result for today's empty period. KPI is recalculated by the import flow.
const kpiAnchor = "app.get('/api/workflow/kpi'";
const kpiPos = server.indexOf(kpiAnchor);
must(kpiPos >= 0, 'workflow kpi route not found');
const kpiRoute = `// V5.2: KPI只读取最近一次已计算的快照；导入新数据时再刷新计算。\napp.get('/api/workflow/kpi', requireAuth, (req, res) => {\n  try {\n    const latest = db.prepare('SELECT kpi_date FROM workflow_daily_kpi ORDER BY kpi_date DESC LIMIT 1').get();\n    if (!latest) return res.json({success:true,kpi:[],kpi_date:null,has_data:false});\n    const kpi = db.prepare('SELECT * FROM workflow_daily_kpi WHERE kpi_date=? ORDER BY CASE stage WHEN \\'shortage\\' THEN 1 WHEN \\'available_to_issue\\' THEN 2 WHEN \\'waiting_schedule\\' THEN 3 WHEN \\'in_process\\' THEN 4 ELSE 5 END').all(latest.kpi_date);\n    res.json({success:true,kpi,kpi_date:latest.kpi_date,has_data:kpi.length>0});\n  } catch (err) {\n    console.error('读取KPI失败:', err.stack || err.message);\n    res.status(500).json({success:false,message:'读取KPI失败：'+err.message});\n  }\n});\n\n`;
server = server.slice(0, kpiPos) + kpiRoute + server.slice(kpiPos);

// Empty-board DataTables fix + display no-data KPI as “暂无数据”.
const oldEmpty = "${tableRows||'<tr><td colspan=\"10\" class=\"text-muted\">当前批次该板块暂无数据</td></tr>'}";
const newEmpty = "${tableRows||'<tr><td class=\"text-muted\">当前批次该板块暂无数据</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'}";
must(index.includes(oldEmpty), 'empty table row anchor not found');
index = index.replace(oldEmpty, newEmpty);

const oldRate = "${Number.isFinite(Number(x.rate))?Number(x.rate).toFixed(1):'100.0'}%";
const newRate = "${(workflowKpiData?.has_data && Number.isFinite(Number(x.rate)))?Number(x.rate).toFixed(1)+'%':'暂无数据'}";
must(index.includes(oldRate), 'KPI rate anchor not found');
index = index.replace(oldRate, newRate);

if (!index.includes(marker)) index += `\n${marker}\n`;
if (!server.includes(marker)) server += `\n${marker}\n`;
fs.writeFileSync(serverFile, server);
fs.writeFileSync(indexFile, index);
console.log('EMPTY_BOARD_VIEW_FIX_APPLIED');
