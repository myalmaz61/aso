/* Aroma — Седмичен отчет v1.8.0: pure date, accounting and price comparison functions. */
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
  // Expected settlement rule supplied by Aroma: Mon–Thu sales settle next day;
  // Friday, Saturday and Sunday sales settle on Monday. Not bank confirmation.
  function cardSettlementDate(saleDate) {
    const dow = dayOfWeek(saleDate);
    return addDays(saleDate, dow === 5 ? 3 : dow === 6 ? 2 : 1);
  }
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
  // Expected incoming bank transfers *by settlement date*. The selected reporting
  // period can contain deposits from sales in a previous week/month. No records
  // are created: sales and POS fees stay dated to the original Z report.
  function cardSettlementSchedule(data, dates) {
    if (!Array.isArray(dates) || !dates.length || dates.some(d => !validDate(d))) {
      throw new Error('Избери валидни дати за банковите постъпления.');
    }
    const wanted = new Set(dates);
    const byDate = new Map([...wanted].sort().map(date => [date, { date, sales: [], gross: 0, fee: 0, net: 0 }]));
    const first = [...wanted].sort()[0];
    const last = [...wanted].sort().at(-1);
    for (let sale = addDays(first, -3); sale <= last; sale = addDays(sale, 1)) {
      const payout = cardSettlementDate(sale);
      if (!wanted.has(payout)) continue;
      const summary = dateSummary(data, sale);
      if (summary.card === 0) continue;
      const row = byDate.get(payout);
      const detail = { saleDate: sale, gross: summary.card, fee: summary.cardFee, net: summary.card - summary.cardFee };
      row.sales.push(detail);
      row.gross += detail.gross;
      row.fee += detail.fee;
      row.net += detail.net;
    }
    const days = [...byDate.values()].filter(row => row.sales.length);
    return {
      days,
      gross: days.reduce((sum, day) => sum + day.gross, 0),
      fee: days.reduce((sum, day) => sum + day.fee, 0),
      net: days.reduce((sum, day) => sum + day.net, 0)
    };
  }
  function fingerprint(data, week) {
    const dates = weekDates(week), begin = dates[0], end = dates[6];
    const records = data.records.filter(r => r.date >= begin && r.date <= end).map(r => [r.id, r.kind, r.date, r.amountPence, r.method, r.category, r.note, r.billId, r.forMonth]).sort((a,b) => String(a[0]).localeCompare(String(b[0])));
    const bills = (data.bills || []).map(b => [b.id, ...dates.map(d => billDailyShare(b, d))]).sort((a,b) => String(a[0]).localeCompare(String(b[0])));
    return JSON.stringify({ records, bills, flags: dates.map(d => data.days?.[d] || ''), feeBps: data.settings?.feeBps ?? 169 });
  }
  // These entries reuse the ordinary v1 income record shape. Re-saving the same
  // date/method updates the dedicated daily Z record instead of duplicating it.
  function dailyZId(date, method) {
    if (!validDate(date) || !['cash', 'card'].includes(method)) throw new Error('Невалидна дата или вид оборот.');
    return `z_${date.replace(/-/g, '')}_${method}`;
  }
  function dailyZRecord(data, date, method) {
    const id = dailyZId(date, method);
    const record = data.records.find(r => r.id === id);
    if (record && (record.date !== date || record.kind !== 'income' || record.method !== method)) {
      throw new Error('Има несъответствие в дневния Z отчет. Провери записа в „Записи“.');
    }
    return record || null;
  }
  function applyDailyTurnover(data, date, amounts) {
    if (!validDate(date) || !amounts || typeof amounts !== 'object') throw new Error('Невалидни данни за дневен оборот.');
    const records = data.records.slice();
    let entered = false;
    for (const method of ['cash', 'card']) {
      const amountPence = amounts[method];
      if (amountPence === undefined || amountPence === null) continue; // blank means unchanged
      if (!Number.isSafeInteger(amountPence) || amountPence < 0 || amountPence > 10000000000) {
        throw new Error('Въведи положителна или нулева сума за Cash и Card.');
      }
      const existing = dailyZRecord(data, date, method);
      const record = { id: dailyZId(date, method), kind: 'income', date, method, amountPence, note: 'Дневен Z отчет' };
      if (existing) records[records.indexOf(existing)] = record;
      else records.push(record);
      entered = true;
    }
    if (!entered) throw new Error('Попълни поне едно поле — Cash или Card.');
    return { ...data, records };
  }
  // v1.6.0 — independent price comparisons, stored only as optional offers.
  // Quantity is normalized into pieces, ml or g. Results show £ per 1 piece/litre/kg.
  const PRICE_UNITS = { pc: ['count', 1], ml: ['volume', 1], l: ['volume', 1000], g: ['weight', 1], kg: ['weight', 1000] };
  function priceMeasure(raw, unit) {
    if (!Object.prototype.hasOwnProperty.call(PRICE_UNITS, unit)) throw new Error('Избери правилна мярка.');
    const s = String(raw).trim().replace(',', '.');
    if (!/^\d+(?:\.\d{1,3})?$/.test(s)) throw new Error('Въведи положително количество, например 8, 750 или 1.5.');
    const quantity = Number(s);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) throw new Error('Количеството е извън допустимите граници.');
    if (unit === 'pc' && !Number.isInteger(quantity)) throw new Error('За бройка използвай цяло число.');
    const baseQty = Math.round(quantity * PRICE_UNITS[unit][1] * 1000) / 1000;
    if (baseQty <= 0 || baseQty > 1000000000) throw new Error('Количеството е твърде голямо или малко.');
    return { quantity, unit, baseQty, group: PRICE_UNITS[unit][0] };
  }
  function priceRate(offer) {
    const m = priceMeasure(String(offer.quantity), offer.unit);
    return offer.totalPence * (m.group === 'count' ? 1 : 1000) / m.baseQty; // pence per pc/L/kg
  }
  function priceGroup(unit) { return PRICE_UNITS[unit]?.[0] || ''; }
  function priceKey(name) { return String(name).trim().replace(/\s+/g, ' ').toLocaleLowerCase('bg'); }
  function validPriceOffer(o) {
    if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(o.id) ||
        typeof o.product !== 'string' || !o.product.trim() || o.product.length > 80 ||
        typeof o.shop !== 'string' || o.shop.length > 80 ||
        !Number.isSafeInteger(o.totalPence) || o.totalPence < 1 || o.totalPence > 10000000000 || !validDate(o.date)) return false;
    try { return priceMeasure(String(o.quantity), o.unit).quantity === o.quantity; }
    catch (_) { return false; }
  }
  function emptyData() {
    return { schema: 1, records: [], bills: [], days: {}, reviewedWeeks: {}, settings: { feeBps: 169 }, priceOffers: [], lastBackupAt: null };
  }
  function validState(data) {
    if (!data || data.schema !== 1 || !Array.isArray(data.records) || !Array.isArray(data.bills) || !data.settings || !Number.isInteger(data.settings.feeBps) || data.settings.feeBps < 0 || data.settings.feeBps > 5000) return false;
    if (data.records.length > 150000 || data.bills.length > 2000) return false;
    if (data.priceOffers !== undefined && (!Array.isArray(data.priceOffers) || data.priceOffers.length > 3000 || data.priceOffers.some(o => !validPriceOffer(o)) || new Set(data.priceOffers.map(o=>o.id)).size !== data.priceOffers.length)) return false;
    const idOk = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
    const amtOk = v => Number.isSafeInteger(v) && Math.abs(v) <= 10000000000;
    if (data.records.some(r => !idOk(r.id) || !validDate(r.date) || !['income','expense','payment'].includes(r.kind) || !amtOk(r.amountPence) || typeof r.note !== 'string' || r.note.length > 500 || (r.kind === 'income' && !['cash','card','other'].includes(r.method)) || (r.kind === 'expense' && !['purchase','other'].includes(r.category)) || (r.kind === 'payment' && (!idOk(r.billId) || !validMonth(r.forMonth))))) return false;
    if (data.bills.some(b => !idOk(b.id) || typeof b.title !== 'string' || b.title.length > 100 || !validMonth(b.startMonth) || (b.endMonth && !validMonth(b.endMonth)) || !amtOk(b.estimatePence) || b.estimatePence < 0 || !b.actuals || typeof b.actuals !== 'object' || Object.entries(b.actuals).some(([m,v]) => !validMonth(m) || !amtOk(v) || v < 0))) return false;
    if (!data.days || typeof data.days !== 'object' || Object.entries(data.days).some(([date, status]) => !validDate(date) || !['closed','zero','open'].includes(status))) return false;
    if (!data.reviewedWeeks || typeof data.reviewedWeeks !== 'object' || Object.entries(data.reviewedWeeks).some(([date, fp]) => !validDate(date) || typeof fp !== 'string' || fp.length > 500000)) return false;
    if (new Set(data.records.map(r => r.id)).size !== data.records.length || new Set(data.bills.map(b => b.id)).size !== data.bills.length) return false;
    return true;
  }
  return { validDate, validMonth, today, addDays, dayOfWeek, weekStart, weekDates, monthDates, monthOf, money, parseMoney, billAmount, billDailyShare, dateSummary, periodSummary, cardSettlementDate, cardSettlementSchedule, fingerprint, dailyZId, dailyZRecord, applyDailyTurnover, emptyData, validState, priceMeasure, priceRate, priceGroup, priceKey, validPriceOffer };
});
