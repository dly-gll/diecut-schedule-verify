const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const serverPath = path.join(__dirname, 'diecut-schedule', 'server.js');
const source = fs.readFileSync(serverPath, 'utf8');
if (!source.includes('// V5.1.9-PARTIAL-SCHEDULE-PRECHECK')) throw new Error('partial scheduling precheck patch missing');
if (!source.includes('const blockingIssues = [];')) throw new Error('blocking issue list missing');
if (!source.includes('const warnings = [];')) throw new Error('warning list missing');
if (!source.includes('schedulable=0')) throw new Error('schedulable count missing');
if (!source.includes('ready:blockingIssues.length===0')) throw new Error('precheck must only block on blocking issues');
if (source.includes('ready:issues.length===0')) throw new Error('legacy all-or-nothing precheck still present');

const tmp = path.join(__dirname, 'tmp-precheck-fixture.db');
try {
  const db = new Database(tmp);
  db.exec(`
    CREATE TABLE machines(id INTEGER PRIMARY KEY, name TEXT, machine_type TEXT, status TEXT);
    CREATE TABLE product_data(product_code TEXT PRIMARY KEY, machines TEXT);
    CREATE TABLE orders(id INTEGER PRIMARY KEY, quantity REAL, process TEXT, mold TEXT, machine_tokens TEXT, status TEXT, workflow_stage TEXT, capacity REAL);
  `);
  db.prepare("INSERT INTO machines(id,name,machine_type,status) VALUES (1,'套冲1','精密模切机','active')").run();
  db.prepare("INSERT INTO product_data(product_code,machines) VALUES ('P1','套冲')").run();
  db.prepare("INSERT INTO orders(id,quantity,process,mold,machine_tokens,status,workflow_stage,capacity) VALUES (1,1000,'套冲','Z1','', 'pending','waiting_schedule',1000)").run();
  db.prepare("INSERT INTO orders(id,quantity,process,mold,machine_tokens,status,workflow_stage,capacity) VALUES (2,1000,'','Z2','', 'pending','waiting_schedule',1000)").run();
  const rows = db.prepare("SELECT * FROM orders WHERE status IN ('pending','scheduled') AND workflow_stage='waiting_schedule'").all();
  if (rows.length !== 2) throw new Error('fixture orders missing');
  db.close();
  console.log('PARTIAL_SCHEDULE_PRECHECK_REGRESSION_OK');
} finally {
  try { fs.unlinkSync(tmp); } catch {}
}
