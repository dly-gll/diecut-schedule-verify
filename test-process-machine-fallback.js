const machines = [
  { name:'五金冲压', machine_type:'激光模切机' },
  { name:'对面冲压（350/H）', machine_type:'平压平模切机' },
  { name:'裁切', machine_type:'裁切机' },
  { name:'冲压（350/H）', machine_type:'平压平模切机' },
  { name:'业健宏', machine_type:'多功能模切机' },
  { name:'众鑫源', machine_type:'多功能模切机' },
  { name:'江杉', machine_type:'多功能模切机' },
  { name:'美佳信', machine_type:'多功能模切机' },
  { name:'激光（3600/H）', machine_type:'激光模切机' },
  { name:'圆刀1', machine_type:'圆压圆模切机' },
  { name:'圆刀2', machine_type:'圆压圆模切机' },
  { name:'圆刀3', machine_type:'圆压圆模切机' },
  { name:'单斩1', machine_type:'平压平模切机' },
  { name:'单斩2', machine_type:'平压平模切机' },
  { name:'单斩3', machine_type:'平压平模切机' },
  { name:'套冲1', machine_type:'精密模切机' },
  { name:'套冲2', machine_type:'精密模切机' }
];

function normalizeMachineToken(value) {
  return String(value || '').trim().replace(/[\u3000\s]+/g, '').replace(/[＿_]/g, '').toUpperCase();
}
function normalizeImportText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}
function machineFamilyKey(value) {
  return normalizeMachineToken(value).replace(/[\(\（][^\)\）]*[\)\）]/g, '').replace(/\d+$/g, '');
}
function splitProcessMachineHints(value) {
  const raw = normalizeImportText(value);
  if (!raw) return [];
  return [...new Set(raw.split(/[+＋,，、|;；]+/).map(v => normalizeImportText(v)).filter(Boolean))];
}
function deriveMachineTokensFromProcess(process, knownMachines) {
  const hints = splitProcessMachineHints(process);
  if (!hints.length) return [];
  const aliases = new Map([['五金', '五金冲压']]);
  const families = [];
  for (const machine of knownMachines) {
    for (const raw of [machine.name, machine.machine_type]) {
      const key = machineFamilyKey(raw);
      if (key && key.length >= 2) families.push(key);
    }
  }
  const uniqueFamilies = [...new Set(families)].sort((a,b) => b.length-a.length);
  const result = [];
  for (const hint of hints) {
    let key = normalizeMachineToken(hint);
    if (aliases.has(key)) key = normalizeMachineToken(aliases.get(key));
    const core = machineFamilyKey(key);
    const matched = uniqueFamilies.find(family => core === family || core.includes(family));
    if (matched) result.push(matched);
  }
  return [...new Set(result)];
}

const realProcessDistribution = {
  '':40,'套冲':30,'单斩':17,'外发':13,'圆刀':13,'众鑫源':12,
  '五金冲压（1200/H）':5,'广易':4,'裁切':3,'对面冲压（350/H）':3,
  '五金冲压（2000/H）':3,'贴合+外发正锋':2,'激光（3600/H）':2,'圆刀+裁切':2,
  '印+单斩':2,'静止52H+单斩随检':1,'美佳信':1,'圆刀+委外楚峰':1,'五金+外发（600/H）':1,'业健宏':1
};
let mapped = 0, external = 0, blank = 0, unmatchedNonExternal = 0;
for (const [process, count] of Object.entries(realProcessDistribution)) {
  const isExternal = /外购|委外|外发/.test(process);
  const tokens = (!isExternal && process) ? deriveMachineTokensFromProcess(process, machines) : [];
  if (tokens.length) mapped += count;
  else if (isExternal) external += count;
  else if (!process) blank += count;
  else unmatchedNonExternal += count;
}

if (mapped !== 95) throw new Error(`real-data process fallback expected 95 mapped, got ${mapped}`);
if (external !== 17) throw new Error(`expected 17 external, got ${external}`);
if (blank !== 40) throw new Error(`expected 40 blank process, got ${blank}`);
if (unmatchedNonExternal !== 4) throw new Error(`expected 4 unmatched non-external (广易), got ${unmatchedNonExternal}`);

const cases = [
  ['套冲','套冲'],['单斩','单斩'],['圆刀','圆刀'],['五金冲压（1200/H）','五金冲压'],
  ['五金冲压（2000/H）','五金冲压'],['对面冲压（350/H）','对面冲压'],['激光（3600/H）','激光'],
  ['圆刀+裁切','圆刀,裁切'],['印+单斩','单斩'],['静止52H+单斩随检','单斩'],['五金+外发（600/H）','五金冲压']
];
for (const [process, expectedText] of cases) {
  const got = deriveMachineTokensFromProcess(process, machines).join(',');
  const expectedParts = expectedText.split(',');
  for (const part of expectedParts) if (!got.includes(part)) throw new Error(`${process} did not resolve ${part}; got ${got}`);
}
console.log(JSON.stringify({REAL_WAITING_ORDERS:156,PROCESS_MACHINE_FALLBACK_MAPPED:95,EXTERNAL_NO_MACHINE:17,BLANK_PROCESS:40,UNMATCHED_NON_EXTERNAL:4}, null, 2));
console.log('REAL_DATA_PROCESS_MACHINE_FALLBACK_REGRESSION_OK');
