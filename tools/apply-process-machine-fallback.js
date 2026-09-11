const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'diecut-schedule', 'server.js');
const source = fs.readFileSync(target, 'utf8');
if (source.includes('V5.1.10-PROCESS-MACHINE-FALLBACK')) {
  console.log('PROCESS_MACHINE_FALLBACK_ALREADY_APPLIED');
  process.exit(0);
}

const pattern = /function getOrderMachineTokens\(order, productMap = null\) \{[\s\S]*?\n\}\n\nfunction resolveOrderCapacity/;
if (!pattern.test(source)) throw new Error('getOrderMachineTokens block not found');

const replacement = `// V5.1.10-PROCESS-MACHINE-FALLBACK
function machineFamilyKey(value) {
  return normalizeMachineToken(value)
    .replace(/[\\(\\（][^\\)\\）]*[\\)\\）]/g, '')
    .replace(/\\d+$/g, '');
}

function splitProcessMachineHints(value) {
  const raw = normalizeImportText(value);
  if (!raw) return [];
  return [...new Set(raw.split(/[+＋,，、|;；]+/).map(v => normalizeImportText(v)).filter(Boolean))];
}

function deriveMachineTokensFromProcess(process, knownMachines) {
  const hints = splitProcessMachineHints(process);
  if (!hints.length) return [];

  const aliases = new Map([
    ['五金', '五金冲压']
  ]);
  const families = [];
  for (const machine of knownMachines) {
    for (const raw of [machine.name, machine.machine_type]) {
      const key = machineFamilyKey(raw);
      if (key && key.length >= 2) families.push(key);
    }
  }
  const uniqueFamilies = [...new Set(families)].sort((a, b) => b.length - a.length);
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

function getOrderMachineTokens(order, productMap = null) {
  // 设备优先级：产品数据明确设备 > Excel/订单设备 > 当前工艺与现有设备族的安全匹配。
  // 只读取现有设备主数据，不根据工艺名称自动创建新设备。
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

  const process = normalizeImportText(product?.process || order?.process);
  if (!process || /外购|委外|外发/.test(process)) return [];

  const known = db.prepare(\"SELECT name,machine_type FROM machines WHERE status='active'\").all();
  return deriveMachineTokensFromProcess(process, known);
}

function resolveOrderCapacity`;

fs.writeFileSync(target, source.replace(pattern, replacement), 'utf8');
console.log('PROCESS_MACHINE_FALLBACK_APPLIED');
