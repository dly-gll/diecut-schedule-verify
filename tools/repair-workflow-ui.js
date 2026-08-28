const fs = require('fs');
const path = require('path');

const indexFile = path.join(__dirname, '..', 'diecut-schedule', 'public', 'index.html');
const serverFile = path.join(__dirname, '..', 'diecut-schedule', 'server.js');

function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 match, found ${count}`);
  return source.replace(from, to);
}

function patchIndex() {
  let source = fs.readFileSync(indexFile, 'utf8');
  const original = source;
  if (source.includes('V5.1.4-WORKFLOW-UI-VERIFIED')) {
    return false;
  }

  source = replaceOnce(
    source,
    '.workflow-muted{color:#64748b;font-size:12px}@media(max-width:900px){.workflow-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '.workflow-muted{color:#64748b;font-size:12px}@media(max-width:900px){.workflow-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}}\n.workflow-stage-count{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 6px;margin-left:5px;border-radius:10px;background:rgba(255,255,255,.22);font-size:11px;font-weight:800}.workflow-subnav-count{display:inline-flex;min-width:20px;height:18px;align-items:center;justify-content:center;padding:0 5px;margin-left:auto;border-radius:9px;background:#e8eef7;color:#334155;font-size:11px;font-weight:800}.workflow-board-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}.workflow-board-toolbar .form-control,.workflow-board-toolbar .form-select{min-width:170px}.workflow-board-table{width:100%!important}.workflow-board-table th{white-space:nowrap;cursor:pointer}',
    'workflow ui css'
  );

  source = replaceOnce(
    source,
    '<span>欠料</span>',
    '<span>欠料 <b class="workflow-subnav-count" id="workflow-count-shortage">0</b></span>',
    'shortage count badge'
  );
  source = replaceOnce(
    source,
    '<span>有料待发</span>',
    '<span>有料待发 <b class="workflow-subnav-count" id="workflow-count-available_to_issue">0</b></span>',
    'available count badge'
  );
  source = replaceOnce(
    source,
    '<span>车间待排</span>',
    '<span>车间待排 <b class="workflow-subnav-count" id="workflow-count-waiting_schedule">0</b></span>',
    'waiting count badge'
  );
  source = replaceOnce(
    source,
    '<span>车间在制</span>',
    '<span>车间在制 <b class="workflow-subnav-count" id="workflow-count-in_process">0</b></span>',
    'in process count badge'
  );

  const workflowVarAnchor = 'let workflowKpiData = null;';
  source = replaceOnce(source, workflowVarAnchor, `${workflowVarAnchor}\n    // V5.1.4-WORKFLOW-UI-VERIFIED\n    let workflowStageCounts = {shortage:0, available_to_issue:0, waiting_schedule:0, in_process:0};`, 'workflow stage counts variable');

  const dtAnchor = "    document.addEventListener('DOMContentLoaded', () => {";
  const dtDefaults = `    // 所有列表统一分页、排序、搜索；“当前最多”表示当前筛选结果全部显示。\n    if (window.jQuery && $.fn && $.fn.dataTable) {\n      $.extend(true, $.fn.dataTable.defaults, {\n        pageLength: 15,\n        lengthMenu: [[10,15,25,50,100,-1],[10,15,25,50,100,'当前最多']],\n        language: {\n          lengthMenu: '每页显示 _MENU_ 条记录',\n          search: '查找：',\n          zeroRecords: '没有找到记录',\n          info: '显示第 _START_ 至 _END_ 条，共 _TOTAL_ 条记录',\n          infoEmpty: '暂无记录',\n          infoFiltered: '(从 _MAX_ 条记录中筛选)'\n        }\n      });\n    }\n\n`;
  source = replaceOnce(source, dtAnchor, dtDefaults + dtAnchor, 'global DataTables defaults');

  const loadStart = source.indexOf("    async function loadWorkflowData(stage='shortage'){");
  const loadEnd = source.indexOf('    function switchWorkflowStage(stage)', loadStart);
  if (loadStart < 0 || loadEnd < 0) throw new Error('loadWorkflowData boundaries not found');
  const newLoad = `    async function loadWorkflowData(stage='shortage'){\n      try{\n        currentWorkflowStage=stage;\n        const stageKeys=['shortage','available_to_issue','waiting_schedule','in_process'];\n        const [boards,k]=await Promise.all([\n          Promise.all(stageKeys.map(s=>fetch(\`/api/workflow/board?stage=\${encodeURIComponent(s)}\`).then(r=>r.json()))),\n          fetch('/api/workflow/kpi').then(r=>r.json())\n        ]);\n        const byStage={};\n        stageKeys.forEach((s,i)=>{byStage[s]=boards[i]||{};});\n        workflowStageCounts={};\n        stageKeys.forEach(s=>{workflowStageCounts[s]=Number(byStage[s]?.count||0);});\n        stageKeys.forEach(s=>{const el=document.getElementById(\`workflow-count-\${s}\`);if(el)el.textContent=String(workflowStageCounts[s]||0);});\n        workflowBoardData=byStage[stage]||{rows:[],count:0}; workflowKpiData=k;\n        if(stageKeys.includes(currentWorkflowStage)) renderWorkflowBoard(stage);\n      }catch(e){ console.error(e); if(['shortage','available_to_issue','waiting_schedule','in_process'].includes(currentWorkflowStage)) showToast('四板块数据加载失败','danger'); }\n    }\n`;
  source = source.slice(0, loadStart) + newLoad + source.slice(loadEnd);

  const renderStart = source.indexOf('    function renderWorkflowBoard(stage){');
  const renderEnd = source.indexOf('    function renderScheduleView()', renderStart);
  if (renderStart < 0 || renderEnd < 0) throw new Error('renderWorkflowBoard boundaries not found');
  const newRender = `    function renderWorkflowBoard(stage){\n      const c=document.getElementById('contentArea');\n      const b=workflowBoardData||{};\n      const kpi=(workflowKpiData?.kpi||[]).reduce((m,x)=>(m[x.stage]=x,m),{});\n      const stageCount=Number(workflowStageCounts[stage]||b.count||0);\n      const cards=[['shortage','欠料'],['available_to_issue','有料待发'],['waiting_schedule','车间待排'],['in_process','车间在制']].map(([key,label])=>{\n        const x=kpi[key]||{};\n        return \`<div class="box"><div class="workflow-muted">\${label}·当前数量 <strong>\${Number(workflowStageCounts[key]||0)}</strong></div><div class="rate">\${Number.isFinite(Number(x.rate))?Number(x.rate).toFixed(1):'100.0'}%</div><div class="workflow-muted">实际 \${x.actual_count||0} / 应完成 \${x.expected_count||0} \${Number(x.alert_count||0)>0?\`· <span class="text-danger">预警 \${x.alert_count}</span>\`:''}</div></div>\`;\n      }).join('');\n      const rows=Array.isArray(b.rows)?b.rows:[];\n      const productionValues=[...new Set(rows.map(r=>String(r.workflow_status_text||r.production_progress||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh'));\n      const materialValues=[...new Set(rows.map(r=>String(r.material_status||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh'));\n      const tableRows=rows.map(r=>{\n        const status=String(r.workflow_status_text||r.production_progress||'-');\n        const material=String(r.material_status||'-');\n        const shortage=String(r.shortage_detail||'-');\n        return \`<tr>\n          <td data-order="\${escapeHtml(r.order_number||'')}">\${escapeHtml(r.order_number||'-')}</td>\n          <td>\${escapeHtml(r.product_code||'-')}</td>\n          <td>\${escapeHtml(r.product_name||'-')}</td>\n          <td data-order="\${Number(r.quantity||0)}">\${Number(r.quantity||0)}</td>\n          <td data-order="\${Number(r.shipping_quantity||0)}">\${Number(r.shipping_quantity||0)}</td>\n          <td data-order="\${escapeHtml(r.shipping_required_date||r.delivery_date||'')}">\${formatWorkflowDate(r.shipping_required_date||r.delivery_date)}</td>\n          <td data-order="\${escapeHtml(r.workflow_expected_date||'')}">\${formatWorkflowDate(r.workflow_expected_date)}</td>\n          <td>\${escapeHtml(status)}</td>\n          <td>\${escapeHtml(material)}</td>\n          <td>\${escapeHtml(shortage)}</td>\n        </tr>\`;\n      }).join('');\n      const alerts=(b.alerts||[]).map(a=>\`<div class="workflow-alert"><strong>\${escapeHtml(a.order_number||'-')}</strong>：\${escapeHtml(a.reason||'已到期未转段')}</div>\`).join('');\n      c.innerHTML=\`\n        <div class="workflow-tabs">\${workflowTabsHtml()}</div>\n        <div class="workflow-kpi">\${cards}</div>\n        <div class="card-custom">\n          <div class="card-header"><span>\${escapeHtml(b.label||workflowStageLabel(stage))} · 当前批次 <strong>\${stageCount}</strong> 条</span><span class="workflow-muted">导入日期：\${escapeHtml(b.latest_import_date||'-')}</span></div>\n          <div class="p-3">\n            <div class="workflow-board-toolbar">\n              <input id="workflow-board-search" class="form-control form-control-sm" placeholder="查找工单、品号、品名、状态、欠料明细">\n              <select id="workflow-production-filter" class="form-select form-select-sm"><option value="">全部生产状态</option>\${productionValues.map(v=>\`<option value="\${escapeHtml(v)}">\${escapeHtml(v)}</option>\`).join('')}</select>\n              <select id="workflow-material-filter" class="form-select form-select-sm"><option value="">全部物料状态</option>\${materialValues.map(v=>\`<option value="\${escapeHtml(v)}">\${escapeHtml(v)}</option>\`).join('')}</select>\n            </div>\n            <div class="table-responsive">\n              <table id="workflowBoardTable" class="table table-hover table-sm workflow-board-table">\n                <thead><tr><th>工单</th><th>品号</th><th>品名</th><th>数量</th><th>出货数量</th><th>要求出货/交货日期</th><th>板块预计日期</th><th>生产状态</th><th>物料状态</th><th>欠料明细</th></tr></thead>\n                <tbody>\${tableRows}</tbody>\n              </table>\n            </div>\n            \${alerts}\n          </div>\n        </div>\n      \`;\n      const table=$('#workflowBoardTable').DataTable({destroy:true,pageLength:15,order:[[5,'asc'],[0,'asc']]});\n      $('#workflow-board-search').on('input',function(){table.search(this.value).draw();});\n      $('#workflow-production-filter').on('change',function(){table.column(7).search(this.value).draw();});\n      $('#workflow-material-filter').on('change',function(){table.column(8).search(this.value).draw();});\n    }\n`;
  source = source.slice(0, renderStart) + newRender + source.slice(renderEnd);

  fs.writeFileSync(indexFile, source, 'utf8');
  return source !== original;
}

function patchServer() {
  let source = fs.readFileSync(serverFile, 'utf8');
  const original = source;
  if (source.includes('COALESCE(o.shipping_quantity,0) shipping_quantity')) return false;
  source = replaceOnce(
    source,
    'COALESCE(snap.quantity,o.quantity,0) quantity,o.status order_status,\n             snap.shipping_required_date,snap.delivery_date,',
    'COALESCE(snap.quantity,o.quantity,0) quantity,COALESCE(o.shipping_quantity,0) shipping_quantity,o.status order_status,\n             snap.shipping_required_date,snap.delivery_date,',
    'workflow board shipping quantity select'
  );
  fs.writeFileSync(serverFile, source, 'utf8');
  return source !== original;
}

const changedIndex=patchIndex();
const changedServer=patchServer();
console.log(JSON.stringify({changedIndex,changedServer}, null, 2));
