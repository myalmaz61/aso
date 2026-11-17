/* Aroma — Седмичен отчет v1.6.0. All bookkeeping data stays in this browser. */
(() => {
  'use strict';
  const C = window.AromaCore;
  const KEY = 'aroma.weekly.v1';
  const $ = id => document.getElementById(id);
  const GBP = C.money;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID().replaceAll('-', '_') : 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2));
  const dateLabel = d => new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
  const shortDate = d => new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
  const dayName = d => new Intl.DateTimeFormat('bg-BG', { weekday: 'long', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
  const monthLabel = ym => new Intl.DateTimeFormat('bg-BG', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(ym + '-01T12:00:00Z'));
  const textMoney = p => (p / 100).toFixed(2);
  const formatSigned = p => GBP(p);
  let data, selectedWeek = C.weekStart(C.today()), billMonth = C.monthOf(C.today()), reportMonth = billMonth;
  let activeView = 'week', recordsDateFilter = null, canWrite = true, installPrompt = null, toastTimer = null, lastSavedState = null;
  // v1.5.0: never overwrite a newer saved version from another open tab/PWA window.
  let lastSavedRaw = null, storageConflict = false;
  const editorDialogs = ['turnoverDialog', 'entryDialog', 'billDialog', 'actualDialog'];
  const editorSnapshots = new Map();
  function editorSnapshot(id) {
    return JSON.stringify([...$(id).querySelectorAll('input, select, textarea')]
      .filter(field => !['button', 'submit', 'file'].includes(field.type))
      .map(field => [field.id, field.value, field.type === 'checkbox' ? field.checked : null]));
  }
  function showEditor(id) {
    $(id).showModal();
    editorSnapshots.set(id, editorSnapshot(id));
  }
  function hasUnsavedEditor(id) {
    return $(id).open && editorSnapshots.has(id) && editorSnapshots.get(id) !== editorSnapshot(id);
  }
  function dismissEditor(id) {
    if (hasUnsavedEditor(id) && !window.confirm('Има незаписани промени. Да затворя ли без запис?')) return false;
    $(id).close();
    return true;
  }
  function storageChanged() {
    if (storageConflict) return;
    storageConflict = true;
    canWrite = false;
    updateOnline();
    alertProblem('Записите са променени в друг отворен прозорец на Aroma. За да не изтрия новите данни, запазването тук е спряно. Ако имаш незаписани суми, запиши ги отделно и презареди приложението.');
  }
  function storageIsCurrent() {
    if (!canWrite) return false;
    try {
      if (localStorage.getItem(KEY) !== lastSavedRaw) { storageChanged(); return false; }
      return true;
    } catch (e) {
      canWrite = false;
      alertProblem('Не мога да проверя локалното хранилище. Запазването е спряно: ' + e.message);
      return false;
    }
  }

  function alertProblem(message) { window.alert(message); }
  function toast(message) {
    const element = $('toast');
    clearTimeout(toastTimer); element.textContent = message; element.hidden = false;
    toastTimer = setTimeout(() => { element.hidden = true; }, 3400);
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === null) { lastSavedRaw = null; return C.emptyData(); }
      const restored = JSON.parse(raw);
      if (!C.validState(restored)) throw new Error('Неразпознат формат на съхранените записи');
      lastSavedRaw = raw;
      return restored;
    } catch (e) {
      canWrite = false;
      setTimeout(() => alertProblem('Не мога безопасно да заредя местните данни: ' + e.message + '\nНяма да ги презаписвам. Направи копие на данните от браузъра, преди да изчистваш хранилището.'), 100);
      return C.emptyData();
    }
  }
  function store() {
    if (!canWrite) { alertProblem('Запазването е блокирано, за да не се презапишат повредени или недостъпни данни.'); return false; }
    try {
      if (!storageIsCurrent()) return false;
      const serialized = JSON.stringify(data);
      localStorage.setItem(KEY, serialized);
      lastSavedRaw = serialized;
      lastSavedState = structuredClone(data);
      return true;
    } catch (error) {
      alertProblem('Записът не е успешен. Провери свободното място и настройките за данни в Chrome. Не затваряй страницата, преди да запазиш архив.\n' + error.message);
      return false;
    }
  }
  function commit(message) {
    // If a write fails, return to the last successfully saved snapshot in memory.
    if (!C.validState(data)) {
      if (lastSavedState) data = structuredClone(lastSavedState);
      alertProblem('Данните не преминават проверката. Промяната не е запазена.');
      renderAll(); return false;
    }
    if (store()) { renderAll(); if (message) toast(message); return true; }
    if (lastSavedState) data = structuredClone(lastSavedState);
    renderAll(); return false;
  }
  function weekTitle(date) { const ds = C.weekDates(date); return `${shortDate(ds[0])} – ${dateLabel(ds[6])}`; }
  function jumpWeek(n) { selectedWeek = C.addDays(selectedWeek, n * 7); recordsDateFilter = null; renderAll(); }
  function changeView(next) {
    if (!['week','records','bills','reports','more'].includes(next)) return;
    activeView = next;
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + next; });
    document.querySelectorAll('.nav-item').forEach(b => {
      const selected = b.dataset.view === next;
      b.classList.toggle('active', selected);
      if (selected) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    renderAll(); window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function amountRow(label, amount, cls = '') {
    return `<div class="amount-row"><span>${esc(label)}</span><strong class="${cls}">${GBP(amount)}</strong></div>`;
  }
  function renderWeek() {
    const days = C.weekDates(selectedWeek), s = C.periodSummary(data, days);
    $('weekPeriod').textContent = weekTitle(selectedWeek);
    $('weekIncome').textContent = GBP(s.income);
    $('weekExpenses').textContent = GBP(s.expenses);
    $('weekResult').textContent = formatSigned(s.result);
    $('weekResult').classList.toggle('negative', s.result < 0);
    $('weeklyBreakdown').innerHTML = [
      '<h2 class="subheading">Разбивка</h2>',
      amountRow('Продажби в брой (Cash)', s.cash),
      amountRow('Продажби с карта (Card)', s.card),
      amountRow('Други приходи', s.otherIncome),
      '<div class="rule"></div>',
      amountRow('Покупки / стока', s.purchases),
      amountRow('Други дневни разходи', s.otherExpense),
      amountRow('Картови такси (прогноза)', s.cardFee),
      amountRow('Дял от месечните сметки', s.monthly),
      '<div class="rule"></div>',
      amountRow('Отбелязани плащания по сметки (не са втори разход)', s.payments, 'muted-amount')
    ].join('');
    $('weekDays').innerHTML = s.days.map(day => {
      const status = day.state === 'closed' ? 'Затворено' : day.state === 'zero' ? 'Без оборот · £0' : day.state === 'recorded' ? 'Въведено' : 'Няма данни';
      const kind = day.state === 'missing' ? 'missing' : day.state === 'closed' ? 'closed' : 'done';
      const tags = data.days[day.date];
      const date = esc(day.date);
      const note = day.card !== 0 ? `<small>Карта ${GBP(day.card)} · такса ~${GBP(day.cardFee)} · очакван превод ${GBP(day.card - day.cardFee)} на ${shortDate(C.cardSettlementDate(day.date))}</small>` : '';
      return `<article class="day-row"><div class="day-line"><div><strong>${esc(dayName(day.date))}</strong><small>${shortDate(day.date)} · <span class="status ${kind}">${status}</span></small></div><div class="day-money">${GBP(day.income)}<small>Разходи ${GBP(day.expenses)}</small></div></div>${note}<div class="day-quick-actions"><button type="button" data-action="day-turnover" data-date="${date}">Cash + Card</button><button type="button" data-action="day-income" data-date="${date}">＋ Приход</button><button type="button" data-action="day-expense" data-date="${date}">＋ Разход</button><button type="button" data-action="day-records" data-date="${date}">Записи</button></div><div class="day-actions"><button type="button" data-action="zero-day" data-date="${date}">Без оборот</button><button type="button" data-action="closed-day" data-date="${date}">Затворено</button>${tags ? `<button type="button" data-action="clear-day" data-date="${date}">Изчисти статуса</button>` : ''}</div></article>`;
    }).join('');
    const pastMissing = s.days.filter(d => d.date <= C.today() && d.state === 'missing').length;
    $('weekWarnings').innerHTML = pastMissing ? `<p class="warning-line">◌ ${pastMissing} ${pastMissing === 1 ? 'ден е' : 'дни са'} без отбелязан оборот или затваряне до днес.</p>` : '';
    const fp = C.fingerprint(data, selectedWeek), previous = data.reviewedWeeks[selectedWeek];
    const reviewed = previous === fp;
    $('reviewInfo').innerHTML = reviewed ? '<strong>✓ Седмицата е проверена</strong><p>Записите и сумите не са променени след проверката.</p>' : previous ? '<strong>Нужна е нова проверка</strong><p>Има промени след последното отбелязване.</p>' : '<strong>Проверка на седмицата</strong><p>Отбележи след преглед на записите.</p>';
    $('reviewToggle').textContent = reviewed ? 'Премахни проверката' : 'Седмицата е проверена';
  }
  function recordTitle(r) {
    if (r.kind === 'payment') { const bill = data.bills.find(b => b.id === r.billId); return `Платена сметка: ${bill?.title || 'премахната сметка'} (${r.forMonth})`; }
    if (r.kind === 'income') return r.method === 'cash' ? 'Приход · В брой' : r.method === 'card' ? 'Приход · Карта' : 'Друг приход';
    return r.category === 'purchase' ? 'Покупка / стока' : 'Друг разход';
  }
  function renderRecords() {
    $('recordsWeekLabel').textContent = weekTitle(selectedWeek);
    const end = C.addDays(selectedWeek, 6);
    if (recordsDateFilter && (recordsDateFilter < selectedWeek || recordsDateFilter > end)) recordsDateFilter = null;
    $('recordsDateFilter').hidden = !recordsDateFilter;
    $('recordsDateLabel').textContent = recordsDateFilter ? 'Записи за ' + dateLabel(recordsDateFilter) : '';
    const records = data.records.filter(r => r.date >= selectedWeek && r.date <= end && (!recordsDateFilter || r.date === recordsDateFilter)).sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    $('recordsList').innerHTML = records.length ? records.map(r => `<article class="record"><div class="record-main"><div><strong>${esc(recordTitle(r))}</strong><small>${dateLabel(r.date)}${r.note ? ' · ' + esc(r.note) : ''}</small></div><span class="record-amount ${r.kind === 'income' ? 'income-text' : ''}">${r.kind === 'payment' ? '↗ ' : ((r.kind === 'income' ? r.amountPence : -r.amountPence) < 0 ? '−' : '+')}${GBP(Math.abs(r.amountPence))}${r.amountPence < 0 ? ' (корекция)' : ''}</span></div><div class="record-actions"><button data-action="edit-record" data-id="${esc(r.id)}" type="button">Редактирай</button><button class="danger-text" data-action="delete-record" data-id="${esc(r.id)}" type="button">Изтрий</button></div></article>`).join('') : `<div class="empty-state">${recordsDateFilter ? 'Няма записи за този ден.' : 'Няма записи за тази седмица.'} Използвай „＋ Приход“ или „＋ Разход“.</div>`;
  }
  function renderBills() {
    $('billMonth').value = billMonth;
    const sum = data.bills.reduce((s,b) => s + C.billAmount(b, billMonth), 0);
    $('billsList').innerHTML = data.bills.length ? `<div class="bill-total">Общо за ${esc(monthLabel(billMonth))}<strong>${GBP(sum)}</strong></div>` + data.bills.map(b => {
      const amount = C.billAmount(b, billMonth);
      const actual = Object.prototype.hasOwnProperty.call(b.actuals, billMonth);
      const active = billMonth >= b.startMonth && (!b.endMonth || billMonth <= b.endMonth);
      const payments = data.records.filter(r => r.kind === 'payment' && r.billId === b.id && r.forMonth === billMonth).reduce((s,r) => s + r.amountPence, 0);
      return `<article class="bill-card"><div class="bill-card-top"><div><strong>${esc(b.title)}</strong><small>${actual ? 'Реална сума' : active ? 'Прогноза' : 'Извън периода'} · от ${esc(b.startMonth)}</small></div><strong>${GBP(amount)}</strong></div><small>Отбелязани плащания за този месец: ${GBP(payments)}</small><div class="bill-actions"><button type="button" data-action="actual-bill" data-id="${esc(b.id)}">Реална сума</button><button type="button" data-action="payment-bill" data-id="${esc(b.id)}">Плащане</button><button type="button" data-action="edit-bill" data-id="${esc(b.id)}">Редакция</button><button type="button" class="danger-text" data-action="delete-bill" data-id="${esc(b.id)}">Изтрий</button></div></article>`;
    }).join('') : '<div class="empty-state">Няма добавени месечни сметки. Добави ги само когато разполагаш със суми — примерни стойности не се записват автоматично.</div>';
  }
  function reportHTML(s, title) {
    return `<strong class="report-period">${esc(title)}</strong><div class="report-main"><div><small>Приходи</small><strong>${GBP(s.income)}</strong></div><div><small>Разходи</small><strong>${GBP(s.expenses)}</strong></div></div><div class="report-result"><span>Резултат</span><strong class="${s.result < 0 ? 'negative' : ''}">${GBP(s.result)}</strong></div><details class="report-extra"><summary>Разбивка</summary>${amountRow('Брой (Cash)', s.cash)}${amountRow('Карта (Card)', s.card)}${amountRow('Друг приход', s.otherIncome)}${amountRow('Покупки', s.purchases)}${amountRow('Други разходи', s.otherExpense)}${amountRow('POS такси', s.cardFee)}${amountRow('Месечни начисления', s.monthly)}${amountRow('Отбелязани плащания (само информация)', s.payments)}</details>`;
  }
  function settlementHTML(dates) {
    const plan = C.cardSettlementSchedule(data, dates);
    if (!plan.days.length) return '<p class="settlement-empty">Няма очаквани картови постъпления за този период според въведените продажби.</p>';
    const rows = plan.days.map(day => {
      const sources = day.sales.map(sale => `${shortDate(sale.saleDate)} (${GBP(sale.gross)})`).join(' · ');
      return `<article class="settlement-item"><div class="settlement-line"><strong>${esc(dayName(day.date))}, ${shortDate(day.date)}</strong><strong>${GBP(day.net)}</strong></div><small>Продажби от: ${esc(sources)}</small><small>Бруто ${GBP(day.gross)} · прогнозна такса ${GBP(day.fee)}</small></article>`;
    }).join('');
    return `<div class="settlement-total"><span>Очаквано по банката за периода</span><strong>${GBP(plan.net)}</strong><small>Бруто ${GBP(plan.gross)} − такси ~${GBP(plan.fee)}</small></div>${rows}`;
  }
  function renderReports() {
    const sw = C.periodSummary(data, C.weekDates(selectedWeek)), sm = C.periodSummary(data, C.monthDates(reportMonth));
    $('reportWeek').innerHTML = reportHTML(sw, weekTitle(selectedWeek));
    $('reportMonthSummary').innerHTML = reportHTML(sm, monthLabel(reportMonth));
    $('settlementWeek').innerHTML = settlementHTML(C.weekDates(selectedWeek));
    $('settlementMonth').innerHTML = settlementHTML(C.monthDates(reportMonth));
    $('reportMonth').value = reportMonth;
  }
  // v1.6.0. Price offers are separate from the accounting records but part of
  // the same protected JSON state/backup; old v1.5.0 state/backups remain valid.
  const priceOffers = () => data.priceOffers || [];
  const priceMoney = pence => '£' + (pence / 100).toFixed(3);
  const priceBaseLabel = group => group === 'count' ? 'брой' : group === 'volume' ? 'литър' : 'кг';
  function selectedPriceProduct() { return $('priceProduct').value.trim().replace(/\s+/g, ' '); }
  function enteredPriceOffer() {
    const name = selectedPriceProduct();
    if (!name || name.length > 80) throw new Error('Въведи име на продукт.');
    const measure = C.priceMeasure($('priceQuantity').value, $('priceUnit').value);
    const totalPence = C.parseMoney($('priceTotal').value);
    if (totalPence <= 0) throw new Error('Цената трябва да е по-голяма от £0.');
    const offer = { id: $('priceOfferId').value || uid(), product: name,
      shop: $('priceShop').value.trim().replace(/\s+/g, ' '),
      quantity: measure.quantity, unit: measure.unit, totalPence,
      date: ($('priceOfferId').value && priceOffers().find(x => x.id === $('priceOfferId').value)?.date) || C.today() };
    if (!C.validPriceOffer(offer)) throw new Error('Провери данните: продуктът или магазинът може да са твърде дълги.');
    return offer;
  }
  function clearPriceEditor(keepProduct = true) {
    const product = keepProduct ? selectedPriceProduct() : '';
    $('priceOfferId').value = '';
    $('priceProduct').value = product;
    $('priceQuantity').value = '';
    $('priceTotal').value = '';
    $('priceShop').value = '';
    $('priceSave').textContent = 'Запази офертата';
    $('priceCancelEdit').hidden = true;
    renderPriceTool();
  }
  function renderPriceTool() {
    const offers = priceOffers();
    const names = [...new Map(offers.map(o => [C.priceKey(o.product), o.product])).values()].sort((a,b) => a.localeCompare(b,'bg'));
    $('priceProductOptions').innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join('');
    $('priceSavedCount').textContent = offers.length ? `${offers.length} оферти` : 'Няма оферти';
    $('priceProducts').innerHTML = names.map(name => `<button type="button" class="price-product-button" data-action="price-select" data-product="${esc(name)}">${esc(name)}</button>`).join('') || '<span class="hint-text">Още няма запазени продукти.</span>';
    const product = selectedPriceProduct(), key = C.priceKey(product);
    const group = C.priceGroup($('priceUnit').value);
    const matches = offers.filter(o => C.priceKey(o.product) === key && C.priceGroup(o.unit) === group);
    let candidate = null;
    const some = Boolean($('priceQuantity').value.trim() || $('priceTotal').value.trim());
    if (some && product && $('priceQuantity').value.trim() && $('priceTotal').value.trim()) {
      try { candidate = enteredPriceOffer(); }
      catch (e) { $('pricePreview').textContent = e.message; }
    }
    if (candidate) {
      const rate = C.priceRate(candidate), unitName = priceBaseLabel(group);
      const candidates = matches.filter(x => x.id !== $('priceOfferId').value);
      const best = candidates.length ? Math.min(...candidates.map(C.priceRate)) : null;
      $('pricePreview').innerHTML = `<strong>${priceMoney(rate)} за ${unitName}</strong>${best !== null ? `<small>${rate < best - 1e-9 ? '✓ По-евтино от запазените оферти.' : Math.abs(rate-best)<1e-9 ? 'Същата единична цена като най-евтината оферта.' : 'Има по-евтина запазена оферта.'}</small>` : '<small>Натисни „Запази офертата“, ако искаш да я сравниш и друг ден.</small>'}`;
    } else if (!some) $('pricePreview').textContent = 'Въведи количество и цена, за да видиш цената за единица.';
    else if (!$('priceQuantity').value.trim() || !$('priceTotal').value.trim()) $('pricePreview').textContent = 'Попълни количество и обща цена.';
    if (!product) {
      $('priceComparison').innerHTML = '<p class="hint-text">Избери запазен продукт или напиши нов, за да видиш офертите.</p>';
      return;
    }
    const sorted = matches.slice().sort((a,b) => C.priceRate(a) - C.priceRate(b) || a.date.localeCompare(b.date));
    if (!sorted.length) {
      $('priceComparison').innerHTML = `<p class="hint-text">Няма запазени сравнения за „${esc(product)}“ с тази мярка. Можеш да добавиш първата оферта.</p>`;
      return;
    }
    const unitName = priceBaseLabel(group);
    $('priceComparison').innerHTML = `<h3>Оферти за ${esc(product)} · за ${unitName}</h3>` + sorted.map((o,i) => {
      const measureText = o.unit === 'pc' ? `${o.quantity} бр.` : `${o.quantity} ${o.unit}`;
      const bestLabel = i === 0 ? '<span class="price-best">Най-изгодно</span>' : '';
      return `<article class="price-offer ${i === 0 ? 'price-offer-best' : ''}"><div><strong>${priceMoney(C.priceRate(o))} / ${unitName}</strong>${bestLabel}<small>${esc(measureText)} · общо ${GBP(o.totalPence)}${o.shop ? ' · '+esc(o.shop) : ''} · ${shortDate(o.date)}</small></div><div class="price-offer-actions"><button type="button" data-action="price-edit" data-id="${esc(o.id)}">Редакция</button><button type="button" data-action="price-delete" data-id="${esc(o.id)}">Изтрий</button></div></article>`;
    }).join('');
  }
  function savePriceOffer(event) {
    event.preventDefault();
    try {
      const offer = enteredPriceOffer();
      const offers = priceOffers().slice();
      const index = offers.findIndex(o => o.id === offer.id);
      if (index >= 0) offers[index] = offer;
      else {
        if (offers.length >= 3000) throw new Error('Достигнат е лимитът от 3000 сравнения.');
        offers.push(offer);
      }
      data = { ...data, priceOffers: offers };
      if (commit('Офертата е запазена.')) {
        clearPriceEditor();
      }
    } catch (error) { alertProblem('Неуспешно запазване на офертата: ' + error.message); }
  }
  function editPriceOffer(id) {
    const offer = priceOffers().find(o => o.id === id);
    if (!offer) return;
    $('priceOfferId').value = offer.id;
    $('priceProduct').value = offer.product;
    $('priceQuantity').value = String(offer.quantity);
    $('priceUnit').value = offer.unit;
    $('priceTotal').value = textMoney(offer.totalPence);
    $('priceShop').value = offer.shop;
    $('priceSave').textContent = 'Запази поправката';
    $('priceCancelEdit').hidden = false;
    renderPriceTool();
    $('priceForm').scrollIntoView({block:'start', behavior:'smooth'});
  }
  function deletePriceOffer(id) {
    const offer = priceOffers().find(o => o.id === id);
    if (!offer || !confirm(`Да изтрия ли офертата за „${offer.product}“ (${GBP(offer.totalPence)})?`)) return;
    data = { ...data, priceOffers: priceOffers().filter(o => o.id !== id) };
    if (commit('Офертата е изтрита.') && $('priceOfferId').value === id) clearPriceEditor();
  }
  function selectPriceProduct(name) {
    $('priceProduct').value = name;
    const last = priceOffers().filter(o => C.priceKey(o.product) === C.priceKey(name)).at(-1);
    if (last) $('priceUnit').value = last.unit;
    $('priceOfferId').value = '';
    $('priceSave').textContent = 'Запази офертата';
    $('priceCancelEdit').hidden = true;
    $('priceQuantity').value = '';
    $('priceTotal').value = '';
    renderPriceTool();
  }
  function renderMore() {
    renderPriceTool();
    $('cardFee').value = (data.settings.feeBps / 100).toFixed(2);
    $('lastBackup').textContent = data.lastBackupAt ? 'Последен създаден архив: ' + new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.lastBackupAt)) : 'Все още няма създаден архив.';
  }
  function renderAll() { renderWeek(); renderRecords(); renderBills(); renderReports(); renderMore(); updateOnline(); }
  function updateOnline() { $('networkIndicator').textContent = storageConflict ? '⚠ Презареди' : navigator.onLine ? 'Само в телефона' : '● Офлайн'; }
  function editorDate() { const date = C.today(); return date >= selectedWeek && date <= C.addDays(selectedWeek, 6) ? date : C.addDays(selectedWeek, 1); }
  function turnoverDate() {
    return activeView === 'records' && recordsDateFilter ? recordsDateFilter : editorDate();
  }
  function refreshTurnoverForm(resetValues = false) {
    const date = $('turnoverDate').value;
    if (!C.validDate(date)) {
      $('turnoverExisting').hidden = true;
      $('turnoverPreview').textContent = '';
      return;
    }
    try {
      const cashRecord = C.dailyZRecord(data, date, 'cash');
      const cardRecord = C.dailyZRecord(data, date, 'card');
      if (resetValues) {
        $('turnoverCash').value = cashRecord ? textMoney(cashRecord.amountPence) : '';
        $('turnoverCard').value = cardRecord ? textMoney(cardRecord.amountPence) : '';
      }
      const outside = data.records.filter(r => r.date === date && r.kind === 'income' && (r.method === 'cash' || r.method === 'card') && r.id !== C.dailyZId(date, r.method));
      const outsideCash = outside.filter(r => r.method === 'cash').reduce((s,r) => s+r.amountPence,0);
      const outsideCard = outside.filter(r => r.method === 'card').reduce((s,r) => s+r.amountPence,0);
      $('turnoverExisting').hidden = !outside.length;
      $('turnoverExisting').classList.toggle('warning', outside.length > 0);
      $('turnoverExisting').innerHTML = outside.length
        ? `<strong>Внимание: други Cash/Card записи</strong>Има ${outside.length} отделни записа за този ден (Cash ${GBP(outsideCash)}, Card ${GBP(outsideCard)}). Ако са част от същия Z отчет, първо ги провери в „Записи“, за да няма двойно отчитане.`
        : '';
      const amounts = {};
      let any = false;
      for (const method of ['cash', 'card']) {
        const raw = $(method === 'cash' ? 'turnoverCash' : 'turnoverCard').value.trim();
        if (!raw) continue;
        amounts[method] = C.parseMoney(raw);
        any = true;
      }
      if (!any) {
        $('turnoverPreview').classList.remove('error');
        $('turnoverPreview').textContent = 'Въведи поне една сума, за да видиш дневния сбор.';
        return;
      }
      const candidate = C.applyDailyTurnover(data, date, amounts);
      const s = C.dateSummary(candidate, date);
      $('turnoverPreview').classList.remove('error');
      $('turnoverPreview').innerHTML = `<strong>Общо Cash + Card: ${GBP(s.cash + s.card)}</strong>В брой ${GBP(s.cash)} · Карта ${GBP(s.card)}${outside.length ? '<br><small>Включва и отделните Cash/Card записи.</small>' : ''}`;
    } catch (error) {
      $('turnoverPreview').classList.add('error');
      $('turnoverPreview').textContent = error.message;
    }
  }
  function openTurnover(selectedDate = '') {
    const date = C.validDate(selectedDate) ? selectedDate : turnoverDate();
    $('turnoverDate').value = date;
    refreshTurnoverForm(true);
    showEditor('turnoverDialog');
  }
  function saveTurnover(event) {
    event.preventDefault();
    try {
      const date = $('turnoverDate').value;
      if (!C.validDate(date)) throw new Error('Избери валидна дата.');
      const amounts = {}, methods = [];
      for (const method of ['cash', 'card']) {
        const raw = $(method === 'cash' ? 'turnoverCash' : 'turnoverCard').value.trim();
        if (!raw) continue;
        amounts[method] = C.parseMoney(raw);
        methods.push(method);
      }
      if (!methods.length) throw new Error('Попълни Cash, Card или и двете.');
      // Existing separate records may represent the same sales as the Z report;
      // never silently replace or double-count them without a clear warning.
      const otherRecords = data.records.filter(r => r.date === date && r.kind === 'income' && methods.includes(r.method) && r.id !== C.dailyZId(date, r.method));
      if (otherRecords.length && !confirm(`Внимание: за ${dateLabel(date)} вече има ${otherRecords.length} отделни Cash/Card записа.\n\nНовият Z отчет ще бъде ДОБАВЕН към тях при пресмятането. Ако сумите са за същите продажби, натисни „Отказ“ и първо редактирай старите записи.\n\nСигурен ли си, че продажбите са различни?`)) return;
      const candidate = C.applyDailyTurnover(data, date, amounts);
      if (!C.validState(candidate)) throw new Error('Данните не преминаха проверката за валидност.');
      data = candidate;
      if (commit('Дневният оборот е запазен.')) $('turnoverDialog').close();
    } catch (error) { alertProblem(error.message); }
  }
  function openEntry(kind, record = null, billId = '', selectedDate = '') {
    const isPayment = kind === 'payment';
    if (isPayment && data.bills.length === 0) return toast('Добави първо месечна сметка.');
    $('entryId').value = record?.id || '';
    $('entryKind').value = kind;
    $('entryHeading').textContent = record ? 'Редактиране на запис' : kind === 'income' ? 'Добави приход' : kind === 'expense' ? 'Добави разход' : 'Отбележи плащане';
    $('entryDate').value = record?.date || (C.validDate(selectedDate) ? selectedDate : isPayment ? C.today() : recordsDateFilter && activeView === 'records' ? recordsDateFilter : editorDate());
    $('entryAmount').value = record ? textMoney(record.amountPence) : '';
    $('entryMethod').value = record?.method || 'cash';
    $('entryCategory').value = record?.category || 'purchase';
    $('entryNote').value = record?.note || '';
    $('incomeFields').hidden = kind !== 'income';
    $('expenseFields').hidden = kind !== 'expense';
    $('paymentFields').hidden = !isPayment;
    if (isPayment) {
      $('entryBill').innerHTML = data.bills.map(b => `<option value="${esc(b.id)}">${esc(b.title)}</option>`).join('');
      $('entryBill').value = record?.billId || billId || data.bills[0].id;
      $('entryForMonth').value = record?.forMonth || billMonth;
      if (!record) {
        const bill = data.bills.find(b => b.id === $('entryBill').value);
        if (bill) $('entryAmount').value = textMoney(C.billAmount(bill, $('entryForMonth').value));
      }
    }
    showEditor('entryDialog');
  }
  function saveEntry(event) {
    event.preventDefault();
    try {
      const id = $('entryId').value, kind = $('entryKind').value, date = $('entryDate').value;
      if (!C.validDate(date)) throw new Error('Избери валидна дата.');
      const amountPence = C.parseMoney($('entryAmount').value, true);
      const newRecord = { id: id || uid(), kind, date, amountPence, note: $('entryNote').value.trim() };
      if (kind === 'income') newRecord.method = $('entryMethod').value;
      else if (kind === 'expense') newRecord.category = $('entryCategory').value;
      else if (kind === 'payment') {
        newRecord.billId = $('entryBill').value;
        newRecord.forMonth = $('entryForMonth').value;
        if (!C.validMonth(newRecord.forMonth) || !data.bills.some(b => b.id === newRecord.billId)) throw new Error('Избери сметка и месец.');
        if (amountPence < 0) throw new Error('Плащането не може да е отрицателно.');
      } else throw new Error('Непознат вид операция.');
      if (newRecord.note.length > 500) throw new Error('Твърде дълга бележка.');
      const old = id && data.records.findIndex(r => r.id === id);
      if (id && old === -1) throw new Error('Записът не е намерен.');
      if (id) data.records[old] = newRecord; else data.records.push(newRecord);
      if (!C.validState(data)) throw new Error('Невалидни данни.');
      if (commit('Записът е запазен.')) $('entryDialog').close();
    } catch (e) { alertProblem(e.message); }
  }
  function deleteRecord(id) {
    const r = data.records.find(x => x.id === id);
    if (!r || !confirm(`Да изтрия ли записа от ${dateLabel(r.date)} (${GBP(r.amountPence)})?`)) return;
    data.records = data.records.filter(x => x.id !== id); commit('Записът е изтрит.');
  }
  function openBill(bill = null) {
    $('billId').value = bill?.id || '';
    $('billHeading').textContent = bill ? 'Редакция на месечна сметка' : 'Добави месечна сметка';
    $('billTitle').value = bill?.title || '';
    $('billEstimate').value = bill ? textMoney(bill.estimatePence) : '';
    $('billStart').value = bill?.startMonth || billMonth;
    showEditor('billDialog');
  }
  function saveBill(event) {
    event.preventDefault();
    try {
      const id = $('billId').value, title = $('billTitle').value.trim();
      const startMonth = $('billStart').value, estimatePence = C.parseMoney($('billEstimate').value);
      if (!title || title.length > 100 || !C.validMonth(startMonth)) throw new Error('Попълни име и валиден начален месец.');
      const old = data.bills.find(b => b.id === id);
      const bill = { id: id || uid(), title, estimatePence, startMonth, actuals: old?.actuals || {} };
      if (old) data.bills[data.bills.indexOf(old)] = bill; else data.bills.push(bill);
      if (!C.validState(data)) throw new Error('Невалидни данни.');
      if (commit('Месечната сметка е запазена.')) $('billDialog').close();
    } catch (e) { alertProblem(e.message); }
  }
  function deleteBill(id) {
    const b = data.bills.find(x => x.id === id); if (!b) return;
    if (!confirm(`Да изтрия ли „${b.title}“? Това ще премахне начисленията ѝ и от старите седмични отчети. Записаните плащания остават в историята.`)) return;
    data.bills = data.bills.filter(x => x.id !== id);
    commit('Сметката е премахната.');
  }
  function openActual(id) {
    const bill = data.bills.find(b => b.id === id); if (!bill) return;
    $('actualBillId').value = id;
    $('actualHeading').textContent = bill.title + ' — реална сума';
    $('actualMonthLabel').textContent = 'За ' + monthLabel(billMonth);
    $('actualAmount').value = textMoney(C.billAmount(bill, billMonth));
    $('clearActual').disabled = !Object.prototype.hasOwnProperty.call(bill.actuals, billMonth);
    showEditor('actualDialog');
  }
  function saveActual(event) {
    event.preventDefault();
    try {
      const bill = data.bills.find(b => b.id === $('actualBillId').value);
      if (!bill) throw new Error('Сметката не е намерена.');
      if (billMonth < bill.startMonth) throw new Error('Месецът е преди началото на тази сметка.');
      bill.actuals[billMonth] = C.parseMoney($('actualAmount').value);
      if (commit('Реалната сума замени прогнозата.')) $('actualDialog').close();
    } catch (e) { alertProblem(e.message); }
  }
  function clearActual() {
    const bill = data.bills.find(b => b.id === $('actualBillId').value);
    if (!bill) return;
    delete bill.actuals[billMonth];
    if (commit('Върната е прогнозната сума.')) $('actualDialog').close();
  }
  function dayFlag(action, date) {
    if (!C.validDate(date)) return;
    if (action === 'clear-day') delete data.days[date];
    else data.days[date] = action === 'closed-day' ? 'closed' : 'zero';
    commit('Статусът за деня е запазен.');
  }
  function toggleReview() {
    const fp = C.fingerprint(data, selectedWeek);
    if (data.reviewedWeeks[selectedWeek] === fp) { delete data.reviewedWeeks[selectedWeek]; commit('Проверката е премахната.'); }
    else { data.reviewedWeeks[selectedWeek] = fp; commit('Седмицата е отбелязана като проверена.'); }
  }
  function saveFee() {
    const raw = $('cardFee').value.trim().replace(',', '.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || Number(raw) > 50) return alertProblem('Въведи процент от 0 до 50 с до две цифри след точката.');
    data.settings.feeBps = Math.round(Number(raw) * 100);
    commit('Картовата такса е обновена.');
  }
  function download(filename, contents, type) {
    const blob = new Blob([contents], { type }), url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function digest(text) {
    if (!globalThis.crypto?.subtle) throw new Error('Липсва защитена среда за проверка на архива.');
    const buffer = new TextEncoder().encode(text), hash = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function backup() {
    try {
      if (!storageIsCurrent()) return;
      const snapshot = structuredClone(data);
      snapshot.lastBackupAt = new Date().toISOString();
      const checksum = await digest(JSON.stringify(snapshot));
      // digest is asynchronous: another tab may have saved while we calculated it.
      if (!storageIsCurrent()) return;
      const file = { format: 'aroma-weekly-backup', version: 1, exportedAt: snapshot.lastBackupAt, checksumSHA256: checksum, payload: snapshot };
      download(`aroma-archive-${C.today()}.json`, JSON.stringify(file, null, 2), 'application/json;charset=utf-8');
      const previous = data;
      data = snapshot;
      if (!store()) {
        data = previous;
        alertProblem('Провери дали JSON файлът е в Downloads. Датата на архива не можа да се запише в приложението.');
        return;
      }
      renderMore();
      toast('Провери дали JSON архивът е изтеглен в Downloads.');
    } catch (e) { alertProblem('Неуспешен архив: ' + e.message); }
  }
  async function restore(file) {
    if (!file) return;
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('Файлът е над допустимите 12 MB.');
      const json = JSON.parse(await file.text());
      if (json.format !== 'aroma-weekly-backup' || json.version !== 1 || !json.payload || typeof json.checksumSHA256 !== 'string') throw new Error('Това не е архив на Aroma v1.');
      if (await digest(JSON.stringify(json.payload)) !== json.checksumSHA256) throw new Error('Контролната сума не съвпада. Файлът може да е повреден.');
      if (!C.validState(json.payload)) throw new Error('Невалидни или несъвместими записи.');
      if (!confirm(`Архивът съдържа ${json.payload.records.length} записа и ${json.payload.bills.length} месечни сметки.\n\nДа ЗАМЕНЯ ли всички текущи данни на този телефон? Това действие не може да се отмени.`)) return;
      const previous = data;
      data = json.payload;
      if (!canWrite || !store()) { data = previous; throw new Error('Новите данни не могат да се съхранят.'); }
      renderAll(); toast('Архивът е възстановен успешно.');
    } catch (e) { alertProblem('Възстановяването е прекъснато: ' + e.message); }
    finally { $('restoreFile').value = ''; }
  }
  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }
  function exportCSV(monthly) {
    const dates = monthly ? C.monthDates(reportMonth) : C.weekDates(selectedWeek);
    const s = C.periodSummary(data, dates);
    const header = ['Дата','Статус','Брой','Карта','Друг приход','Всички приходи','Покупки','Други разходи','Такса карта','Месечни разходи (дял)','Всички разходи','Резултат','Платени месечни сметки (информация)'];
    const statusBg = { closed: 'Затворено', zero: 'Без оборот', recorded: 'Въведено', missing: 'Няма данни' };
    const amounts = d => ['cash','card','otherIncome','income','purchases','otherExpense','cardFee','monthly','expenses','result','payments'].map(k => textMoney(d[k]));
    const rows = [header, ...s.days.map(d => [d.date, statusBg[d.state], ...amounts(d)]), ['ОБЩО', '', ...amounts(s)]];
    const content = '\ufeff' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
    download(monthly ? `aroma-month-${reportMonth}.csv` : `aroma-week-${selectedWeek}.csv`, content, 'text/csv;charset=utf-8');
    toast('CSV отчетът е изтеглен.');
  }
  function actions(event) {
    const view = event.target.closest('[data-view]');
    if (view) { if (view.dataset.view === 'records') recordsDateFilter = null; return changeView(view.dataset.view); }
    const suggestion = event.target.closest('[data-suggest]'); if (suggestion) { $('billTitle').value = suggestion.dataset.suggest; return; }
    const b = event.target.closest('[data-action]'); if (!b) return;
    const action = b.dataset.action, id = b.dataset.id, date = b.dataset.date;
    if (action === 'price-select') return selectPriceProduct(b.dataset.product);
    if (action === 'price-edit') return editPriceOffer(id);
    if (action === 'price-delete') return deletePriceOffer(id);
    if (action === 'open-turnover') return openTurnover();
    if (action === 'day-turnover' && C.validDate(date)) return openTurnover(date);
    if (action === 'close-turnover') return dismissEditor('turnoverDialog');
    if (action === 'add-income') return openEntry('income');
    if (action === 'add-expense') return openEntry('expense');
    if (action === 'day-income' && C.validDate(date)) return openEntry('income', null, '', date);
    if (action === 'day-expense' && C.validDate(date)) return openEntry('expense', null, '', date);
    if (action === 'day-records' && C.validDate(date)) {
      recordsDateFilter = date;
      return changeView('records');
    }
    if (action === 'edit-record') {
      const record = data.records.find(r => r.id === id);
      if (record && record.kind === 'income' && ['cash', 'card'].includes(record.method) && record.id === C.dailyZId(record.date, record.method)) return openTurnover(record.date);
      if (record) openEntry(record.kind, record);
      return;
    }
    if (action === 'delete-record') return deleteRecord(id);
    if (action === 'edit-bill') return openBill(data.bills.find(b => b.id === id));
    if (action === 'delete-bill') return deleteBill(id);
    if (action === 'actual-bill') return openActual(id);
    if (action === 'payment-bill') return openEntry('payment', null, id);
    if (['zero-day','closed-day','clear-day'].includes(action)) return dayFlag(action, date);
    if (action === 'close-entry') dismissEditor('entryDialog');
    if (action === 'close-bill') dismissEditor('billDialog');
    if (action === 'close-actual') dismissEditor('actualDialog');
  }
  function registerListeners() {
    document.addEventListener('click', actions);
    $('prevWeek').addEventListener('click', () => jumpWeek(-1));
    $('nextWeek').addEventListener('click', () => jumpWeek(1));
    $('recordsPrev').addEventListener('click', () => jumpWeek(-1));
    $('recordsNext').addEventListener('click', () => jumpWeek(1));
    $('goToday').addEventListener('click', () => { selectedWeek = C.weekStart(C.today()); recordsDateFilter = null; renderAll(); });
    $('reviewToggle').addEventListener('click', toggleReview);
    $('clearRecordsDate').addEventListener('click', () => { recordsDateFilter = null; renderRecords(); });
    $('turnoverForm').addEventListener('submit', saveTurnover);
    $('turnoverDate').addEventListener('change', () => refreshTurnoverForm(true));
    $('turnoverCash').addEventListener('input', () => refreshTurnoverForm());
    $('turnoverCard').addEventListener('input', () => refreshTurnoverForm());
    $('entryForm').addEventListener('submit', saveEntry);
    $('billForm').addEventListener('submit', saveBill);
    $('actualForm').addEventListener('submit', saveActual);
    $('clearActual').addEventListener('click', clearActual);
    $('addBill').addEventListener('click', () => openBill());
    $('billMonth').addEventListener('change', e => { if (C.validMonth(e.target.value)) { billMonth = e.target.value; renderBills(); } });
    $('reportMonth').addEventListener('change', e => { if (C.validMonth(e.target.value)) { reportMonth = e.target.value; renderReports(); } });
    $('priceForm').addEventListener('submit', savePriceOffer);
    ['priceProduct','priceQuantity','priceUnit','priceTotal','priceShop'].forEach(id => $(id).addEventListener('input', renderPriceTool));
    $('priceCancelEdit').addEventListener('click', () => clearPriceEditor());
    $('saveFee').addEventListener('click', saveFee);
    $('backup').addEventListener('click', backup);
    $('restoreFile').addEventListener('change', e => restore(e.target.files[0]));
    $('weekCSV').addEventListener('click', () => exportCSV(false));
    $('monthCSV').addEventListener('click', () => exportCSV(true));
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    // Android back/Escape triggers 'cancel'; deliberate X/Отказ uses dismissEditor.
    for (const id of editorDialogs) {
      $(id).addEventListener('cancel', event => { event.preventDefault(); dismissEditor(id); });
    }
    window.addEventListener('beforeunload', event => {
      if (!editorDialogs.some(hasUnsavedEditor)) return;
      event.preventDefault();
      event.returnValue = ''; // Browser may show its own generic warning (Android-dependent).
    });
    window.addEventListener('storage', event => {
      if (event.key === KEY && event.newValue !== lastSavedRaw) storageChanged();
    });
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('installApp').hidden = false; });
    $('installApp').addEventListener('click', async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('installApp').hidden = true; });
  }
  data = load(); lastSavedState = structuredClone(data); registerListeners(); renderAll();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker:', error));
})();
