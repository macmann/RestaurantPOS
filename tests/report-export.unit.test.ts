import assert from 'node:assert/strict';
import { reportCsv, reportPrintDocument } from '../frontend/reports/export';

const columns = [{ key: 'name', label: 'Name', type: 'string' as const }, { key: 'amount', label: 'Amount', type: 'currency' as const }];
const rows = [{ name: 'Tea, "special"\nလက်ဖက်ရည်', amount: 12.5 }];
const csv = reportCsv({ columns, rows });
assert.equal(csv, '\uFEFF"Name","Amount"\r\n"Tea, ""special""\nလက်ဖက်ရည်","12.5"');

const document = reportPrintDocument({ columns, rows, print: { title: 'နေ့စဉ် <Sales>', subtitle: 'Range', orientation: 'landscape', locale: 'en', fontFamily: 'sans-serif', unicodeSample: 'မြန်မာ' } }, 'Asia/Yangon');
assert.match(document, /နေ့စဉ် &lt;Sales&gt;/);
assert.match(document, /Timezone: Asia\/Yangon/);
assert.match(document, /လက်ဖက်ရည်/);
assert.match(document, /@page\{size:landscape\}/);

const manyRows = Array.from({ length: 20_000 }, (_, index) => ({ name: `Row ${index}`, amount: index }));
assert.equal(reportCsv({ columns, rows: manyRows }).split('\r\n').length, 20_001);
console.log('report export unit tests passed');
