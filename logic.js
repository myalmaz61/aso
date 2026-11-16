/* Aroma — Седмичен отчет v1.0.0: pure date and accounting functions. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AromaCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
  const ymPattern = /^\d{4}-\d{2}$/;
  function validDate(str) {
    if (typeof str !== 'string' || !isoPattern.test(str)) return false;
    const d = new Date(str + 'T12:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
  }
  function validMonth(str) {
    return typeof str === 'string' && ymPattern.test(str) && validDate(str + '-01');
  }
  function epoch(iso) {
    if (!validDate(iso)) throw new Error('Невалидна дата: ' + iso);
    return Date.parse(iso + 'T00:00:00Z');
  }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function addDays(date, count) { return iso(epoch(date) + count * DAY); }
  function dayOfWeek(date) { return new Date(epoch(date)).getUTCDay(); } // 0 Sunday, 1 Monday
  function weekStart(date) { return addDays(date, -((dayOfWeek(date) + 6) % 7)); }
  function weekDates(date) { const s = weekStart(date); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
  function monthDates(month) {
    if (!validMonth(month)) throw new Error('Невалиден месец');
    const n = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  }
  function monthOf(date) { return date.slice(0, 7); }
  function money(pence) { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100); }
  function parseMoney(raw, allowNegative = false) {
    const v = String(raw).trim().replace(/\s/g, '').replace(',', '.');
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(v)) throw new Error('Сумата трябва да е например 22.40');
    const negative = v.startsWith('-');
    if (negative && !allowNegative) throw new Error('За тази операция е нужна положителна сума');
    const [pounds, pennies = ''] = v.replace('-', '').split('.');
    const result = Number(pounds) * 100 + Number(pennies.padEnd(2, '0'));
    if (!Number.isSafeInteger(result) || result > 10000000000) throw new Error('Твърде голяма сума');
    return negative ? -result : result;
  }
  function billAmount(bill, month) {
    if (month < bill.startMonth || (bill.endMonth && month > bill.endMonth)) return 0;
    if (Object.prototype.hasOwnProperty.call(bill.actuals || {}, month)) return bill.actuals[month];
    return bill.estimatePence;
  }
  function billDailyShare(bill, date) {
    const month = monthOf(date), amount = billAmount(bill, month);
    if (!amount) return 0;
    const day = Number(date.slice(8)), count = monthDates(month).length;
    const q = Math.floor(amount / count), rem = amount % count;
    return q + (day <= rem ? 1 : 0);
  }
  function dayState(data, date, incomeRecords) {
    const explicitly = data.days?.[date];
    if (incomeRecords.some(r => r.amountPence !== 0)) return 'recorded';
    if (explicitly === 'closed') return 'closed';
    if (explicitly === 'zero' || incomeRecords.length > 0) return 'zero';
    if (explicitly === 'open') return 'missing';
    return dayOfWeek(date) === 1 ? 'closed' : 'missing';
  }
  function dateSummary(data, date) {
    const records = data.records.filter(r => r.date === date);
    const incomes = records.filter(r => r.kind === 'income');
    const cash = incomes.filter(r => r.method === 'cash').reduce((s, r) => s + r.amountPence, 0);
    const card = incomes.filter(r => r.method === 'card').reduce((s, r) => s + r.amountPence, 0);
    const otherIncome = incomes.filter(r => r.method === 'other').reduce((s, r) => s + r.amountPence, 0);
    const purchases = records.filter(r => r.kind === 'expense' && r.category === 'purchase').reduce((s, r) => s + r.amountPence, 0);
    const otherExpense = records.filter(r => r.kind === 'expense' && r.category !== 'purchase').reduce((s, r) => s + r.amountPence, 0);
    const payments = records.filter(r => r.kind === 'payment').reduce((s, r) => s + r.amountPence, 0);
    const feeBps = Number.isInteger(data.settings?.feeBps) ? data.settings.feeBps : 169;
    const cardFee = Math.round(Math.max(0, card) * feeBps / 10000);
    const monthly = (data.bills || []).reduce((s, b) => s + billDailyShare(b, date), 0);
    const income = cash + card + otherIncome;
    const expenses = purchases + otherExpense + cardFee + monthly;
    return { date, cash, card, otherIncome, income, purchases, otherExpense, cardFee, monthly, expenses, payments, result: income - expenses, state: dayState(data, date, incomes) };
  }
  function periodSummary(data, dates) {
    const days = dates.map(d => dateSummary(data, d));
    const keys = ['cash', 'card', 'otherIncome', 'income', 'purchases', 'otherExpense', 'cardFee', 'monthly', 'expenses', 'payments', 'result'];
    const totals = Object.fromEntries(keys.map(k => [k, days.reduce((sum, d) => sum + d[k], 0)]));
    return { ...totals, days, missing: days.filter(d => d.state === 'missing').length };
  }
  function fingerprint(data, week) {
    const dates = weekDates(week), begin = dates[0], end = dates[6];
    const records = data.records.filter(r => r.date >= begin && r.date <= end).map(r => [r.id, r.kind, r.date, r.amountPence, r.method, r.category, r.note, r.billId, r.forMonth]).sort((a,b) => String(a[0]).localeCompare(String(b[0])));
    const bills = (data.bills || []).map(b => [b.id, ...dates.map(d => billDailyShare(b, d))]).sort((a,b) => String(a[0]).localeCompare(String(b[0])));
    return JSON.stringify({ records, bills, flags: dates.map(d => data.days?.[d] || ''), feeBps: data.settings?.feeBps ?? 169 });
  }
  function emptyData() {
    return { schema: 1, records: [], bills: [], days: {}, reviewedWeeks: {}, settings: { feeBps: 169 }, lastBackupAt: null };
  }
  function validState(data) {
    if (!data || data.schema !== 1 || !Array.isArray(data.records) || !Array.isArray(data.bills) || !data.settings || !Number.isInteger(data.settings.feeBps) || data.settings.feeBps < 0 || data.settings.feeBps > 5000) return false;
    if (data.records.length > 150000 || data.bills.length > 2000) return false;
    const idOk = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
    const amtOk = v => Number.isSafeInteger(v) && Math.abs(v) <= 10000000000;
    if (data.records.some(r => !idOk(r.id) || !validDate(r.date) || !['income','expense','payment'].includes(r.kind) || !amtOk(r.amountPence) || typeof r.note !== 'string' || r.note.length > 500 || (r.kind === 'income' && !['cash','card','other'].includes(r.method)) || (r.kind === 'expense' && !['purchase','other'].includes(r.category)) || (r.kind === 'payment' && (!idOk(r.billId) || !validMonth(r.forMonth))))) return false;
    if (data.bills.some(b => !idOk(b.id) || typeof b.title !== 'string' || b.title.length > 100 || !validMonth(b.startMonth) || (b.endMonth && !validMonth(b.endMonth)) || !amtOk(b.estimatePence) || b.estimatePence < 0 || !b.actuals || typeof b.actuals !== 'object' || Object.entries(b.actuals).some(([m,v]) => !validMonth(m) || !amtOk(v) || v < 0))) return false;
    if (!data.days || typeof data.days !== 'object' || Object.entries(data.days).some(([date, status]) => !validDate(date) || !['closed','zero','open'].includes(status))) return false;
    if (!data.reviewedWeeks || typeof data.reviewedWeeks !== 'object' || Object.entries(data.reviewedWeeks).some(([date, fp]) => !validDate(date) || typeof fp !== 'string' || fp.length > 500000)) return false;
    if (new Set(data.records.map(r => r.id)).size !== data.records.length || new Set(data.bills.map(b => b.id)).size !== data.bills.length) return false;
    return true;
  }
  return { validDate, validMonth, today, addDays, dayOfWeek, weekStart, weekDates, monthDates, monthOf, money, parseMoney, billAmount, billDailyShare, dateSummary, periodSummary, fingerprint, emptyData, validState };
});
