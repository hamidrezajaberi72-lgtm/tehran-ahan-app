const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');

const html = fs.readFileSync('www/index.html', 'utf8');
const match = html.match(/<script>([\s\S]*)<\/script>/);
assert.ok(match, 'application script exists');
const script = match[1];
new Function(script);

const declarations = [...script.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(x => x[1]);
assert.equal(new Set(declarations).size, declarations.length, 'no duplicate function declarations');
for (const id of ['saleBasket','buyBasket','deliveryRecipient','deliveryDate','deliveryTime','productNames','saleCostExpense','saleCostStorage','saleCostScale','saleCostCut','saleCostFreight','buyCostExpense','buyCostStorage','buyCostScale','buyCostCut','buyCostFreight']) {
  assert.ok(html.includes('id="' + id + '"'), 'required element exists: ' + id);
}
assert.match(script, /async function lockApp\(\)\{await persistQueue;/, 'locking waits for pending encrypted writes');
assert.match(script, /products:Array\.isArray\(d\.products\)\?d\.products:\[\]/, 'restore includes product catalog');

function getFunction(name, nextName) {
  const start = script.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'function exists: ' + name);
  const end = script.indexOf('function ' + nextName + '(', start + 10);
  assert.ok(end > start, 'function boundary exists: ' + name);
  return script.slice(start, end);
}
{
  const c = harness();
  const start = script.indexOf('const jalaliFmt');
  const end = script.indexOf('function readDate', start);
  const dateCode = script.slice(start, end) + '\nthis.isoToJalali = isoToJalali; this.jalaliToIso = jalaliToIso;';
  vm.runInNewContext(dateCode, c);
  const iso = c.jalaliToIso('۱۴۰۵/۰۸/۲۶');
  assert.ok(iso, 'Persian digits convert to ISO date');
  assert.equal(c.isoToJalali(iso), '1405/08/26', 'Persian date round trip');
  assert.equal(c.jalaliToIso('1405/13/01'), '', 'invalid month rejected');
}
{
  const c = harness();
  const valid = runFunction('validBackup', 'readBackupFile', c);
  assert.equal(valid({ sales: [], buys: [], checks: [], people: [], cash: [], products: [], stockMovements: [] }), true);
  assert.equal(valid({ sales: [], buys: [], checks: [], people: [], cash: [], stockMovements: 'bad' }), false);
  assert.match(script, /\['sales','buys','checks','cash','products','stockMovements'\]\.forEach/);
  assert.match(script, /stockMovements:Array\.isArray\(d\.stockMovements\)\?d\.stockMovements:\[\]/);
}
function harness(extra = {}) {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', style: { display: 'none' }, readOnly: false });
    return elements.get(id);
  };
  const values = {};
  const ctx = {
    $, values,
    val: id => values[id] ?? '',
    num: id => Number(values[id] || 0),
    fmt: x => String(Number(x.toFixed ? x.toFixed(2) : x)),
    esc: x => String(x ?? ''),
    alert: msg => { ctx.alerts.push(String(msg)); },
    alerts: [],
    confirm: () => true,
    persist: () => { ctx.persistCalls++; },
    persistCalls: 0,
    readDate: () => '2026-11-17',
    showDate: x => String(x),
    db: { sales: [], buys: [], products: [], settings: { invoicePrefix: 'THA', invoiceStart: 1001, name: 'طهران آهن', tagline: '', phone: '', address: '' } },
    saleBasket: [], buyBasket: [],
    rememberProduct: name => { if (!ctx.db.products.some(p => p.name === name)) ctx.db.products.push({ id: 1, name }); },
    saleNumbers: () => {},
    buyCalc: () => {},
    invoiceCostFields: prefix => ['Expense','Storage','Scale','Cut','Freight'].map(k => ({ key: k[0].toLowerCase()+k.slice(1), label: ({Expense:'خرج',Storage:'انبارداری',Scale:'باسکول',Cut:'برش',Freight:'کرایه حمل'})[k], amount: Number(values[prefix+'Cost'+k] || 0) })),
    invoiceCostTotal: costs => costs.reduce((sum,x) => sum+x.amount,0),
    resetSale: () => { ctx.saleBasket = []; },
    window: { scrollTo: () => {} },
    document: { body: { scrollHeight: 1000 } },
    Date,
    Math,
    Set,
    ...extra
  };
  vm.runInNewContext(getFunction('allocateInvoiceCosts', 'saleNumbers') + '\nthis.allocateInvoiceCosts = allocateInvoiceCosts;', ctx);
  return ctx;
}
function runFunction(name, nextName, ctx) {
  const code = getFunction(name, nextName);
  vm.runInNewContext(code + '\nthis.__fn = ' + name + ';', ctx);
  return ctx.__fn;
}

{
  const c = harness();
  Object.assign(c.values, { sheet: 'ورق سیاه', weight: '2', saleUnit: 'کیلوگرم', sellPrice: '100', buyPrice: '80', costs: '10', commissionRate: '5', saleNote: 'تست' });
  const add = runFunction('addSaleLine', 'saveSale', c);
  add();
  assert.equal(c.saleBasket.length, 1);
  assert.equal(c.saleBasket[0].total, 200);
  assert.equal(c.saleBasket[0].profit, 30);
  assert.equal(c.saleBasket[0].commission, 1.5);
  assert.equal(c.db.products[0].name, 'ورق سیاه');
}

{
  const c = harness();
  c.values.customer = 'مشتری تست';
  c.values.received = '150';
  c.values.salesperson = 'فروشنده';
  c.values.deliveryRecipient = 'تحویل‌گیرنده';
  c.values.deliveryPhone = '09120000000';
  c.values.deliveryDate = '۱۴۰۵/۰۸/۲۶';
  c.values.deliveryTime = '۱۴:۳۰';
  c.saleBasket = [
    { sheet: 'ورق سیاه', weight: 1, unit: 'کیلوگرم', sell: 100, total: 100, profit: 10, commission: 1 },
    { sheet: 'نبشی', weight: 2, unit: 'شاخه', sell: 100, total: 200, profit: 20, commission: 2 }
  ];
  const save = runFunction('saveSale', 'resetSale', c);
  save();
  assert.equal(c.db.sales.length, 2);
  assert.equal(c.db.sales[0].invoiceNo, c.db.sales[1].invoiceNo);
  assert.deepEqual(c.db.sales.map(x => x.received), [100, 50]);
  assert.equal(c.db.sales.reduce((a, x) => a + x.received, 0), 150);
  assert.equal(c.db.sales.reduce((a, x) => a + x.total, 0), 300);
  assert.equal(c.db.sales[0].deliveryRecipient, 'تحویل‌گیرنده');
  assert.equal(c.db.sales[0].deliveryDate, '۱۴۰۵/۰۸/۲۶');
  assert.equal(c.db.settings.invoiceNextNumber, 1002);
}

{
  const c = harness();
  c.values.customer = 'مشتری تست';
  c.values.received = '301';
  c.saleBasket = [{ sheet: 'پروفیل', weight: 1, unit: 'شاخه', sell: 300, total: 300, profit: 0, commission: 0 }];
  runFunction('saveSale', 'resetSale', c)();
  assert.equal(c.db.sales.length, 0, 'overpayment rejected');
}

{
  const c = harness();
  Object.assign(c.values, { buySheet: 'ناودانی', buyWeight: '3', buyUnit: '20', buyExtra: '5', buyUnitType: 'شاخه', buyNote: 'تست' });
  runFunction('addBuyLine', 'removeBuyLine', c)();
  assert.equal(c.buyBasket.length, 1);
  assert.equal(c.buyBasket[0].total, 65);
}

{
  const c = harness();
  c.values.supplier = 'تأمین‌کننده تست';
  c.values.buyPaid = '150';
  c.buyBasket = [
    { sheet: 'ورق', weight: 1, unit: 'تن', unitPrice: 100, total: 100 },
    { sheet: 'میلگرد', weight: 2, unit: 'شاخه', unitPrice: 100, total: 200 }
  ];
  runFunction('saveBuy', 'saveCheck', c)();
  assert.equal(c.db.buys.length, 2);
  assert.deepEqual(c.db.buys.map(x => x.paid), [100, 50]);
  assert.equal(c.db.buys.reduce((a, x) => a + x.paid, 0), 150);
}

{
  const c = harness();
  c.db.sales = [
    { id: 1, invoiceNo: 'THA-1001', date: '2026-11-17', customer: 'الف', sheet: 'ورق', weight: 1, unit: 'تن', sell: 100, total: 100, received: 50, profit: 5 },
    { id: 2, invoiceNo: 'THA-1001', date: '2026-11-17', customer: 'الف', sheet: 'نبشی', weight: 2, unit: 'شاخه', sell: 20, total: 40, received: 0, profit: 4 }
  ];
  runFunction('makeInvoice', 'makeDeliveryReceipt', c)(1, false);
  assert.match(c.$('invoiceBody').innerHTML, /جمع کل با هزینه‌ها: 140/);
  assert.match(c.$('invoiceBody').innerHTML, /مبلغ دریافت‌شده: 50/);
  assert.equal((c.$('invoiceBody').innerHTML.match(/<tr>/g) || []).length, 3);
  c.db.sales[0].deliveryRecipient = 'تحویل‌گیرنده تست';
  c.db.sales[0].deliveryDate = '۱۴۰۵/۰۸/۲۶';
  c.db.sales[0].deliveryTime = '۱۴:۳۰';
  runFunction('makeDeliveryReceipt', 'printInvoice', c)(1);
  assert.match(c.$('invoiceBody').innerHTML, /تحویل‌گیرنده تست/);
  assert.match(c.$('invoiceBody').innerHTML, /۱۴۰۵\/۰۸\/۲۶/);
  assert.match(c.$('invoiceBody').innerHTML, /نام و امضای تحویل‌گیرنده/);
  assert.match(c.$('invoiceBody').innerHTML, /نام و امضای تحویل‌دهنده/);
}

{
  const c = harness();
  c.db.sales = [
    { id: 1, invoiceNo: 'THA-1' },
    { id: 2, invoiceNo: 'THA-1' },
    { id: 3, invoiceNo: 'THA-2' }
  ];
  runFunction('del', 'render', c)('sales', 1);
  assert.deepEqual(c.db.sales.map(x => x.id), [3], 'deleting a sales invoice removes all its lines');
}

{
  const c = harness();
  c.db.settings.invoiceNextNumber = 1042;
  c.values.customer = 'مشتری بعدی';
  c.values.received = '0';
  c.saleBasket = [{ sheet: 'پروفیل', weight: 1, unit: 'شاخه', sell: 10, total: 10, profit: 0, commission: 0 }];
  runFunction('saveSale', 'resetSale', c)();
  assert.equal(c.db.sales[0].invoiceNo, 'THA-01042', 'invoice sequence survives removal of old sales');
}
{
  const c = harness();
  c.db.buys = [{ sheet: 'ورق سیاه', unit: 'تن', weight: 1 }];
  c.db.sales = [{ sheet: 'ورق سیاه', unit: 'کیلوگرم', weight: 300 }, { sheet: 'ورق سیاه', unit: 'کیلوگرم', weight: 500, status: 'لغو شده' }];
  c.db.stockMovements = [
    { id: 1, name: 'ورق سیاه', unit: 'کیلوگرم', quantity: 200, type: 'in', date: '2026-11-17' },
    { id: 2, name: 'ورق سیاه', unit: 'کیلوگرم', quantity: 100, type: 'out', date: '2026-11-17' }
  ];
  runFunction('stockUnitInfo', 'renderInventory', c);
  runFunction('renderInventory', 'saveStockMovement', c)();
  assert.match(c.$('stockRows').innerHTML, /800/, 'ton and kg are combined in kg base units');
}

{
  const c = harness();
  Object.assign(c.values, { stockName: 'نبشی', stockQty: '25', stockUnit: 'شاخه', stockType: 'in', stockNote: 'موجودی اول دوره' });
  runFunction('saveStockMovement', 'saveCheck', c)();
  assert.equal(c.db.stockMovements.length, 1);
  assert.equal(c.db.stockMovements[0].quantity, 25);
  assert.equal(c.db.products[0].name, 'نبشی');
}
{
  const c = harness();
  c.values.customer = 'مشتری هزینه‌دار';
  c.values.received = '0';
  Object.assign(c.values, { saleCostExpense: '10', saleCostStorage: '20', saleCostScale: '30', saleCostCut: '40', saleCostFreight: '50' });
  c.saleBasket = [{ sheet: 'ورق', weight: 1, unit: 'تن', sell: 1000, total: 1000, goodsTotal: undefined, profit: 100, rate: 10, commission: 10 }];
  runFunction('saveSale', 'resetSale', c)();
  assert.equal(c.db.sales[0].total, 1150, 'sales invoice includes all itemized costs');
  assert.equal(c.db.sales[0].goodsTotal, 1000, 'goods subtotal remains separate');
  assert.equal(c.db.sales[0].profit, -50, 'invoice expenses reduce net profit');
  assert.deepEqual(c.db.sales[0].invoiceCosts.map(x => x.amount), [10, 20, 30, 40, 50]);
  assert.equal(c.db.sales[0].commission, 0, 'commission uses net profit after invoice expenses');
}
{
  const c = harness();
  c.values.supplier = 'تأمین‌کننده هزینه‌دار';
  c.values.buyPaid = '0';
  Object.assign(c.values, { buyCostExpense: '10', buyCostStorage: '20', buyCostScale: '30', buyCostCut: '40', buyCostFreight: '50' });
  c.buyBasket = [{ sheet: 'نبشی', weight: 1, unit: 'شاخه', unitPrice: 500, total: 500 }];
  runFunction('saveBuy', 'saveCheck', c)();
  assert.equal(c.db.buys[0].total, 650, 'purchase invoice includes all itemized costs');
  assert.equal(c.db.buys[0].goodsTotal, 500, 'purchase goods subtotal remains separate');
  assert.deepEqual(c.db.buys[0].invoiceCosts.map(x => x.amount), [10, 20, 30, 40, 50]);
}
{
  const c = harness();
  c.values.customer = 'مشتری';
  c.values.received = '999';
  c.values.saleCostFreight = '50';
  c.saleBasket = [{ sheet: 'ورق', weight: 1, unit: 'تن', sell: 100, total: 100, profit: 0, rate: 0 }];
  runFunction('saveSale', 'resetSale', c)();
  assert.equal(c.db.sales.length, 0, 'overpayment check includes invoice-level costs');
  assert.equal(c.saleBasket[0].total, 100, 'failed save does not apply invoice costs twice');
}

\n{\n  const c = harness();\n  c.values.customer = 'مشتری چندقلمی';\n  c.values.received = '0';\n  c.values.saleCostFreight = '100';\n  c.saleBasket = [\n    { sheet: 'ورق', weight: 1, unit: 'تن', sell: 100, total: 100, profit: 10, rate: 10, commission: 1 },\n    { sheet: 'نبشی', weight: 1, unit: 'شاخه', sell: 300, total: 300, profit: 30, rate: 10, commission: 3 }\n  ];\n  runFunction('saveSale', 'resetSale', c)();\n  assert.deepEqual(c.db.sales.map(x => x.total), [125, 375], 'sale invoice costs are allocated proportionally across lines');\n  assert.deepEqual(c.db.sales.map(x => x.goodsTotal), [100, 300], 'goods subtotals are preserved per line');\n  assert.deepEqual(c.db.sales.map(x => x.profit), [-15, -45], 'sale costs reduce each line profit proportionally');\n  assert.equal(c.db.sales.reduce((a,x) => a+x.total,0), 500, 'allocated sale invoice total is conserved');\n  assert.equal(c.db.sales[0].invoiceCosts[4].amount, 100, 'invoice fee detail remains available for printing');\n}\n{\n  const c = harness();\n  c.values.supplier = 'تأمین‌کننده چندقلمی';\n  c.values.buyPaid = '0';\n  c.values.buyCostFreight = '100';\n  c.buyBasket = [\n    { sheet: 'ورق', weight: 1, unit: 'تن', unitPrice: 100, total: 100 },\n    { sheet: 'نبشی', weight: 1, unit: 'شاخه', unitPrice: 300, total: 300 }\n  ];\n  runFunction('saveBuy', 'saveCheck', c)();\n  assert.deepEqual(c.db.buys.map(x => x.total), [125, 375], 'purchase costs are allocated proportionally across lines');\n  assert.deepEqual(c.db.buys.map(x => x.goodsTotal), [100, 300], 'purchase goods subtotals are preserved per line');\n  assert.equal(c.db.buys.reduce((a,x) => a+x.total,0), 500, 'allocated purchase invoice total is conserved');\n}\n\nconsole.log('Tehran Ahan smoke tests passed: syntax, schema, sale/purchase calculations, payment allocation, invoice print, delivery receipt, grouped deletion.');
