/* Run locally with: node tests.js */
const assert = require('node:assert/strict');
const C = require('./logic.js');
const d = C.emptyData();
const add = (kind, date, amountPence, details={}) => d.records.push({id:'r'+(d.records.length+1),kind,date,amountPence,note:'',...details});
assert.equal(C.weekStart('2023-02-05'), '2023-01-30');
assert.deepEqual(C.weekDates('2023-01-30'), ['2023-01-30','2023-01-31','2023-02-01','2023-02-02','2023-02-03','2023-02-04','2023-02-05']);
assert.equal(C.monthDates('2024-02').length,29);
assert.equal(C.monthDates('2023-02').length,28);
assert.equal(C.parseMoney('22,40'),2240);
assert.equal(C.parseMoney('0.01'),1);
assert.equal(C.parseMoney('-11.45',true),-1145);
assert.throws(()=>C.parseMoney('12.345'));
add('expense','2023-01-30',10000,{category:'purchase'});
add('expense','2023-02-05',25000,{category:'purchase'});
add('income','2023-01-31',2240,{method:'cash'});
add('income','2023-01-31',20090,{method:'card'});
add('income','2023-02-01',1200,{method:'cash'});
add('income','2023-02-01',23470,{method:'card'});
// User examples: monthly fixed costs are distributed by calendar day, not duplicated on payment.
d.bills.push({id:'rent',title:'Наем',startMonth:'2023-01',estimatePence:95000,actuals:{'2023-02':90000}});
const week = C.periodSummary(d,C.weekDates('2023-02-01'));
assert.equal(week.purchases,35000,'Monday and Sunday expenses must belong to one week');
assert.equal(week.cash,3440);
assert.equal(week.card,43560);
assert.equal(week.cardFee, Math.round(20090*.0169)+Math.round(23470*.0169));
assert.equal(C.periodSummary(d,C.monthDates('2023-01')).purchases,10000,'Jan reports include Jan 30 only');
assert.equal(C.periodSummary(d,C.monthDates('2023-02')).purchases,25000,'Feb reports include Feb 5 only');
assert.equal(C.periodSummary(d,C.monthDates('2023-02')).monthly,90000,'Actual monthly cost overrides estimate once');
assert.equal(week.monthly, C.billDailyShare(d.bills[0],'2023-01-30') + C.billDailyShare(d.bills[0],'2023-01-31') + Array.from({length:5}, (_,i)=> C.billDailyShare(d.bills[0],`2023-02-0${i+1}`)).reduce((a,b)=>a+b,0));
assert.equal(C.monthDates('2023-01').reduce((s,x)=>s+C.billDailyShare(d.bills[0],x),0),95000,'Prorated days sum exactly to month cost');
assert.equal(C.monthDates('2023-02').reduce((s,x)=>s+C.billDailyShare(d.bills[0],x),0),90000,'Actual days sum exactly to month cost');
assert.equal(C.dateSummary(d,'2023-01-30').state,'closed','Monday defaults closed even if there is a purchase');
assert.equal(C.dateSummary(d,'2023-02-02').state,'missing');
d.days['2023-02-02']='zero'; assert.equal(C.dateSummary(d,'2023-02-02').state,'zero');
d.days['2023-02-03']='closed'; assert.equal(C.dateSummary(d,'2023-02-03').state,'closed');
const fingerprint = C.fingerprint(d, '2023-02-01');
d.records.push({id:'pay',kind:'payment',date:'2023-02-05',amountPence:95000,note:'',billId:'rent',forMonth:'2023-01'});
assert.equal(C.periodSummary(d,C.weekDates('2023-02-01')).expenses,week.expenses,'Payment must not be double-counted');
assert.equal(C.periodSummary(d,C.weekDates('2023-02-01')).payments,95000);
assert.notEqual(C.fingerprint(d,'2023-02-01'),fingerprint,'Changes invalidate reviewed status');
assert(C.validState(d));
assert(!C.validState({...d,records:[...d.records,{id:'bad',kind:'income',date:'2023-99-99',amountPence:100,method:'cash',note:''}]}));
assert(!C.validState({...d,records:[...d.records,{id:'r1',kind:'income',date:'2023-02-01',amountPence:100,method:'cash',note:''}]}));
console.log('✓ 23 checks passed: dates, cross-month weeks, money, daily status, fee, accrual, payment, review and restore validation.');

// Non-destructive UI contract checks for the optional day shortcuts (v1.2.0).
const fs = require('node:fs');
const html = fs.readFileSync(__dirname + '/index.html','utf8');
const app = fs.readFileSync(__dirname + '/app.js','utf8');
const sw = fs.readFileSync(__dirname + '/sw.js','utf8');
assert(html.includes('id="recordsDateFilter"'));
assert(html.includes('id="clearRecordsDate"'));
assert(app.includes('data-action="day-income"'));
assert(app.includes('data-action="day-expense"'));
assert(app.includes('data-action="day-records"'));
assert(app.includes("const KEY = 'aroma.weekly.v1'"));
assert(sw.includes("const CACHE = 'aroma-weekly-v1.5.0'"));
assert(html.includes('id="turnoverDialog"'));
assert(app.includes('data-action="day-turnover"'));
assert(html.includes('id="weekTurnover"'));
console.log('✓ 10 UI/static checks passed: day actions, Cash/Card form, filter, storage compatibility, cache update.');

// Day turnover tests: upsert, corrections, blank untouched, legacy records preserved.
const oldData = C.emptyData();
oldData.records.push({id:'old_cash', kind:'income', date:'2023-01-31', method:'cash', amountPence:3900, note:'стар отделен запис'});
const baseString = JSON.stringify(oldData);
let z = C.applyDailyTurnover(oldData, '2023-01-31', {cash:12560, card:20890});
assert.equal(JSON.stringify(oldData), baseString, 'Do not mutate the old state');
assert.equal(C.dailyZId('2023-01-31','cash'),'z_20230131_cash');
assert.equal(C.dailyZRecord(z,'2023-01-31','card').amountPence,20890);
assert.equal(z.records.length,3,'Manual legacy record is preserved');
assert.equal(C.dateSummary(z,'2023-01-31').cash,12560+3900);
const first = z.records.length;
z = C.applyDailyTurnover(z, '2023-01-31', {cash:11100});
assert.equal(z.records.length,first,'Correcting same date/method never adds records');
assert.equal(C.dailyZRecord(z,'2023-01-31','cash').amountPence,11100);
assert.equal(C.dailyZRecord(z,'2023-01-31','card').amountPence,20890,'Blank card unchanged');
assert.equal(C.dateSummary(z,'2023-01-31').cardFee, Math.round(20890*0.0169));
z = C.applyDailyTurnover(z, '2023-01-31', {card:0});
assert.equal(C.dailyZRecord(z,'2023-01-31','card').amountPence,0);
assert.equal(z.records.filter(x => x.id === 'old_cash').length,1);
assert(C.validState(z));
assert.throws(()=>C.applyDailyTurnover(z,'2023-01-31',{}));
assert.throws(()=>C.applyDailyTurnover(z,'2023-01-31',{cash:-1}));
assert.throws(()=>C.dailyZId('2023-01-31','other'));
const bad = structuredClone(z);
bad.records.find(x=>x.id==='z_20230131_cash').date='2023-02-01';
assert.throws(()=>C.applyDailyTurnover(bad,'2023-01-31',{cash:400}));
console.log('✓ 15 daily Z tests passed: legacy safety, upsert, correction, zero, validation, no duplicate.');

// v1.3.0: expected card transfers grouped by deposit day, not sale day.
assert.equal(C.cardSettlementDate('2026-11-09'), '2026-11-10'); // Mon -> Tue
assert.equal(C.cardSettlementDate('2026-11-10'), '2026-11-11'); // Tue -> Wed
assert.equal(C.cardSettlementDate('2026-11-11'), '2026-11-12'); // Wed -> Thu
assert.equal(C.cardSettlementDate('2026-11-12'), '2026-11-13'); // Thu -> Fri
assert.equal(C.cardSettlementDate('2026-11-13'), '2026-11-16'); // Fri -> Mon
assert.equal(C.cardSettlementDate('2026-11-14'), '2026-11-16'); // Sat -> Mon
assert.equal(C.cardSettlementDate('2026-11-15'), '2026-11-16'); // Sun -> Mon
assert.throws(()=>C.cardSettlementDate('2026-13-30'));
const bank = C.emptyData();
for (const [date,pence] of [
  ['2026-11-13',10000],['2026-11-14',20000],['2026-11-15',30000],
  ['2026-11-16',5000],['2026-11-17',6000]
]) {
  bank.records.push({id:'bank'+date.replaceAll('-',''),date,kind:'income',method:'card',amountPence:pence,note:''});
}
const untouched = JSON.stringify(bank);
const current = C.cardSettlementSchedule(bank, C.weekDates('2026-11-16'));
assert.equal(JSON.stringify(bank),untouched,'Settlement view must never mutate records');
assert.equal(current.days[0].date,'2026-11-16');
assert.deepEqual(current.days[0].sales.map(x=>x.saleDate),['2026-11-13','2026-11-14','2026-11-15']);
assert.equal(current.days[0].gross,60000);
assert.equal(current.days[0].fee,169+338+507);
assert.equal(current.days[0].net,58986);
assert.equal(current.days[1].date,'2026-11-17');
assert.equal(current.days[1].gross,5000);
assert.equal(current.days[1].net,4915);
assert.equal(current.days[2].date,'2026-11-18');
assert.equal(current.days[2].gross,6000);
assert.equal(current.net,58986+4915+(6000-Math.round(6000*.0169)));
// Bank transfers in current week may reflect revenue from the preceding week.
assert.equal(C.periodSummary(bank,C.weekDates('2026-11-16')).card,11000);
assert.equal(C.periodSummary(bank,C.weekDates('2026-11-09')).card,60000);
const monthCrossing = C.emptyData();
monthCrossing.records.push({id:'dec_last',date:'2026-12-31',kind:'income',method:'card',amountPence:12345,note:''});
monthCrossing.records.push({id:'jan_first',date:'2027-01-01',kind:'income',method:'card',amountPence:10000,note:''});
const januaryTransfers = C.cardSettlementSchedule(monthCrossing,C.monthDates('2027-01'));
assert.equal(januaryTransfers.days[0].date,'2027-01-01'); // Thu Dec31 settles Fri Jan1
assert.equal(januaryTransfers.days[0].sales[0].saleDate,'2026-12-31');
assert.equal(januaryTransfers.days[1].date,'2027-01-04'); // Fri Jan1 settles Mon Jan4
assert.equal(januaryTransfers.days[1].sales[0].saleDate,'2027-01-01');
assert.equal(C.periodSummary(monthCrossing,C.monthDates('2027-01')).card,10000);
assert.equal(C.cardSettlementSchedule(monthCrossing,C.weekDates('2027-02-08')).net,0,'Empty transfer week');
const reversed = JSON.stringify(C.cardSettlementSchedule(bank,C.weekDates('2026-11-16')));
assert.equal(JSON.stringify(C.cardSettlementSchedule(bank,C.weekDates('2026-11-16'))),reversed,'Deterministic settlement plan');
assert(html.includes('id="settlementWeek"'));
assert(html.includes('id="settlementMonth"'));
assert(html.includes('Aroma — версия 1.5.0'));
assert(app.includes('C.cardSettlementDate(day.date)'));
assert(app.includes('C.cardSettlementSchedule(data, dates)'));
console.log('✓ v1.3.0 card settlement checks passed: weekday rules, Friday–Sunday Monday merge, cross-week/month, charges and UI wiring.');

// v1.4.0: daily cash/card is now primary; individual income remains in Records.
assert.match(html, /<div class="quick-actions"><button id="weekTurnover" class="primary-button"[^>]+data-action="open-turnover"/);
const mainWeek = html.slice(html.indexOf('<section id="view-week"'), html.indexOf('</section>'));
const mainQuick = mainWeek.match(/<div class="quick-actions">([\s\S]*?)<\/div>/)[1];
assert.equal((mainQuick.match(/<button /g) || []).length, 2, 'Only two main action buttons');
assert(!mainQuick.includes('data-action="add-income"'), 'Manual income is not primary');
assert(mainQuick.includes('data-action="add-expense"'));
assert(html.includes('id="view-records"') && html.includes('data-action="add-income"'));
assert(html.includes('id="turnoverExisting" class="turnover-existing" aria-live="polite" hidden'));
assert(app.includes("$('turnoverExisting').hidden = !outside.length"));
assert(!app.includes('Без други Cash/Card записи'), 'Remove unnecessary neutral info');
assert(app.includes('Общо Cash + Card:'));
assert(app.includes('C.applyDailyTurnover(data, date, amounts)'));
console.log('✓ v1.4.0 simplification tests passed: two primary actions, preserved manual income and safety warnings.');

// v1.5.0: no extra primary buttons; form exit and multiple-tab protections live in app.js.
assert.equal((mainQuick.match(/<button /g) || []).length, 2);
assert(app.includes('function hasUnsavedEditor(id)'));
assert(app.includes('function dismissEditor(id)'));
assert(app.includes("addEventListener('cancel'"));
assert(app.includes("addEventListener('beforeunload'"));
assert(app.includes('function storageIsCurrent()'));
assert(app.includes("addEventListener('storage'"));
assert(app.includes('lastSavedRaw = serialized'));
console.log('✓ v1.5.0 safety checks: unsaved editors, tab conflict protection, unchanged primary buttons.');
