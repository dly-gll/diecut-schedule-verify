const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const repoRoot = path.join(__dirname, '..');
const indexFile = path.join(repoRoot, 'diecut-schedule', 'public', 'index.html');
const baseRef = '54717448ec5e4767df85bd1ef7de0534775a2b69';

function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 match, found ${count}`);
  return source.replace(from, to);
}

// Always rebuild the workflow page from the last known-good UI commit.
// This prevents a bad experimental UI patch from accumulating on top of itself.
let source = childProcess.execFileSync('git', ['show', `${baseRef}:diecut-schedule/public/index.html`], {cwd: repoRoot, encoding: 'utf8'});

source = replaceOnce(
  source,
  '.workflow-muted{color:#64748b;font-size:12px}@media(max-width:900px){.workflow-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}}',
  '.workflow-muted{color:#64748b;font-size:12px}@media(max-width:900px){.workflow-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}}\n.workflow-subnav-count{display:inline-flex;min-width:20px;height:18px;align-items:center;justify-content:center;padding:0 5px;margin-left:auto;border-radius:9px;background:#e8eef7;color:#334155;font-size:11px;font-weight:800}.workflow-board-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}.workflow-board-toolbar .form-control,.workflow-board-toolbar .form-select{min-width:170px}.workflow-board-table{width:100%!important}.workflow-board-table th{white-space:nowrap;cursor:pointer}.workflow-alerts{margin-top:10px}',
  'workflow UI CSS'
);

const badges = [
  ['欠料','workflow-count-shortage'],
  ['有料待发','workflow-count-available_to_issue'],
  ['车间待排','workflow-count-waiting_schedule'],
  ['车间在制','workflow-count-in_process']
];
for (const [label,id] of badges) {
  source = replaceOnce(source, `<span>${label}</span>`, `<span>${label} <b class="workflow-subnav-count" id="${id}">0</b></span>`, `${label} badge`);
}

source = replaceOnce(
  source,
  'let workflowKpiData = null;',
  'let workflowKpiData = null;\n    // V5.1.4-WORKFLOW-UI-VERIFIED\n    let workflowStageCounts = {shortage:0, available_to_issue:0, waiting_schedule:0, in_process:0};',
  'workflow stage counts'
);

const dtAnchor = "    document.addEventListener('DOMContentLoaded', () => {";
source = replaceOnce(
  source,
  dtAnchor,
  `    // 所有列表统一分页、排序、搜索；“当前最多”显示当前筛选结果全部记录。\n    if (window.jQuery && $.fn && $.fn.dataTable) {\n      $.extend(true, $.fn.dataTable.defaults, {\n        pageLength: 15,\n        lengthMenu: [[10,15,25,50,100,-1],[10,15,25,50,100,'当前最多']]\n      });\n    }\n\n${dtAnchor}`,
  'global DataTables defaults'
);

const loadStart = source.indexOf("    async function loadWorkflowData(stage='shortage'){");
const loadEnd = source.indexOf('    function switchWorkflowStage(stage)', loadStart);
if (loadStart < 0 || loadEnd < 0) throw new Error('loadWorkflowData boundaries not found');
const loadFn = `    async function loadWorkflowData(stage='shortage'){\n      try{\n        currentWorkflowStage=stage;\n        const stageKeys=['shortage','available_to_issue','waiting_schedule','in_process'];\n        const [boards,k]=await Promise.all([\n          Promise.all(stageKeys.map(s=>fetch(\`/api/workflow/board?stage=\${encodeURIComponent(s)}\`).then(r=>r.json()))),\n          fetch('/api/workflow/kpi').then(r=>r.json())\n        ]);\n        const byStage={};\n        stageKeys.forEach((s,i)=>{byStage[s]=boards[i]||{};});\n        workflowStageCounts={};\n        stageKeys.forEach(s=>{workflowStageCounts[s]=Number(byStage[s]?.count||0);const el=document.getElementById(\`workflow-count-\${s}\`);if(el)el.textContent=String(workflowStageCounts[s]||0);});\n        workflowBoardData=byStage[stage]||{rows:[],count:0}; workflowKpiData=k;\n        if(stageKeys.includes(currentWorkflowStage))renderWorkflowBoard(stage);\n      }catch(e){console.error(e);if(['shortage','available_to_issue','waiting_schedule','in_process'].includes(currentWorkflowStage))showToast('四板块数据加载失败','danger');}\n    }\n`;
source = source.slice(0, loadStart) + loadFn + source.slice(loadEnd);

const renderStart = source.indexOf('    function renderWorkflowBoard(stage){');
const renderEnd = source.indexOf('    function renderScheduleView()', renderStart);
if (renderStart < 0 || renderEnd < 0) throw new Error('renderWorkflowBoard boundaries not found');
const renderFn = `    function renderWorkflowBoard(stage){\n      const c=document.getElementById('contentArea');const b=workflowBoardData||{};const kpi=(workflowKpiData?.kpi||[]).reduce((m,x)=>(m[x.stage]=x,m),{});const stageCount=Number(workflowStageCounts[stage]||b.count||0);\n      const cards=[['shortage','欠料'],['available_to_issue','有料待发'],['waiting_schedule','车间待排'],['in_process','车间在制']].map(([key,label])=>{const x=kpi[key]||{};return \`<div class="box"><div class="workflow-muted">\${label}·当前数量 <strong>\${Number(workflowStageCounts[key]||0)}</strong></div><div class="rate">\${Number.isFinite(Number(x.rate))?Number(x.rate).toFixed(1):'100.0'}%</div><div class="workflow-muted">实际 \${x.actual_count||0} / 应完成 \${x.expected_count||0} \${Number(x.alert_count||0)>0?\`· <span class="text-danger">预警 \${x.alert_count}</span>\`:''}</div></div>\`;}).join('');\n      const rows=Array.isArray(b.rows)?b.rows:[];\n      const productionValues=[...new Set(rows.map(r=>String(r.order_status==='scheduled'?'已排待制':(r.workflow_production_progress||'')).trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh'));\n      const materialValues=[...new Set(rows.map(r=>String(r.workflow_material_status||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh'));\n      const tableRows=rows.map(r=>{const production=String(r.order_status==='scheduled'?'已排待制':(r.workflow_production_progress||'-'));const material=String(r.workflow_material_status||'-');const shortage=String(r.workflow_shortage_detail||'-');const ship=Number(r.shipping_quantity||0);return \`<tr><td data-order="\${escapeHtml(r.order_number||'')}">\${escapeHtml(r.order_number||'-')}</td><td>\${escapeHtml(r.product_code||'-')}</td><td>\${escapeHtml(r.product_name||'-')}</td><td data-order="\${Number(r.quantity||0)}">\${Number(r.quantity||0)}</td><td data-order="\${ship}">\${ship}</td><td data-order="\${escapeHtml(r.shipping_required_date||r.delivery_date||'')}">\${formatWorkflowDate(r.shipping_required_date||r.delivery_date)}</td><td data-order="\${escapeHtml(r.workflow_expected_date||'')}">\${formatWorkflowDate(r.workflow_expected_date)}</td><td>\${escapeHtml(production)}</td><td>\${escapeHtml(material)}</td><td>\${escapeHtml(shortage)}</td></tr>\`;}).join('');\n      const alerts=(b.alerts||[]).map(a=>\`<div class="workflow-alert"><strong>⚠ \${escapeHtml(a.order_number||a.product_code||'')}</strong>：\${escapeHtml(a.reason||'')}</div>\`).join('');\n      const importBtn=currentUser.role!=='viewer'?\`<label class="btn btn-sm btn-primary"><input type="file" hidden accept=".xlsx,.xls,.csv" onchange="importWorkflowExcel(this)">导入Excel并自动识别</label>\`:'';\n      const latest=b.latest_import_date?\`<span class="workflow-muted ms-2">当前批次：\${escapeHtml(b.latest_import_date)}</span>\`:'';const stageTitle=workflowStageLabel(stage);\n      c.innerHTML=\`<div class="card-custom"><div class="card-header d-flex justify-content-between align-items-center"><div class="d-flex align-items-center gap-2"><span class="fw-semibold">\${escapeHtml(stageTitle)}</span>\${workflowTabsHtml()}\${latest}</div><div>\${importBtn} \${currentUser.role!=='viewer'?\`<button class="btn btn-sm btn-outline-success ms-1" onclick="runAutoSchedule()">对待排工单排程</button>\`:''}</div></div><div class="card-body"><div class="workflow-kpi">\${cards}</div><div class="workflow-board-toolbar"><input id="workflow-board-search" class="form-control form-control-sm" placeholder="查找工单、品号、品名、生产状态、物料状态、欠料明细"><select id="workflow-production-filter" class="form-select form-select-sm"><option value="">全部生产状态</option>\${productionValues.map(v=>\`<option value="\${escapeHtml(v)}">\${escapeHtml(v)}</option>\`).join('')}</select><select id="workflow-material-filter" class="form-select form-select-sm"><option value="">全部物料状态</option>\${materialValues.map(v=>\`<option value="\${escapeHtml(v)}">\${escapeHtml(v)}</option>\`).join('')}</select></div>\${alerts?\`<div class="workflow-alerts">\${alerts}</div>\`:''}<div class="table-responsive"><table id="workflowBoardTable" class="table table-sm table-hover workflow-board-table"><thead><tr><th>工单</th><th>品号</th><th>品名</th><th>数量</th><th>出货数量</th><th>要求出货/交货日期</th><th>板块预计日期</th><th>生产状态</th><th>物料状态</th><th>欠料明细</th></tr></thead><tbody>\${tableRows||'<tr><td colspan="10" class="text-muted">当前批次该板块暂无数据</td></tr>'}</tbody></table></div></div></div>\`;\n      const table=$('#workflowBoardTable').DataTable({destroy:true,pageLength:15,order:[[5,'asc'],[0,'asc']]});$('#workflow-board-search').on('input',function(){table.search(this.value).draw();});$('#workflow-production-filter').on('change',function(){table.column(7).search(this.value).draw();});$('#workflow-material-filter').on('change',function(){table.column(8).search(this.value).draw();});\n    }\n`;
source = source.slice(0, renderStart) + renderFn + source.slice(renderEnd);

fs.writeFileSync(indexFile, source, 'utf8');
console.log('WORKFLOW_UI_REPAIRED_FROM_KNOWN_GOOD_BASE');
