/* Aroma — Седмичен отчет v1.0.0. All bookkeeping data stays in this browser. */
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
  let activeView = 'week', canWrite = true, installPrompt = null, toastTimer = null;

  function alertProblem(message) { window.alert(message); }
  function toast(message) {
    const element = $('toast');
    clearTimeout(toastTimer); element.textContent = message; element.hidden = false;
    toastTimer = setTimeout(() => { element.hidden = true; }, 3400);
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return C.emptyData();
      const restored = JSON.parse(raw);
      if (!C.validState(restored)) throw new Error('Неразпознат формат на съхранените записи');
      return restored;
    } catch (e) {
      canWrite = false;
      setTimeout(() => alertProblem('Не мога безопасно да заредя местните данни: ' + e.message + '\nНяма да ги презаписвам. Направи копие на данните от браузъра, преди да изчистваш хранилището.'), 100);
      return C.emptyData();
    }
  }
  function store() {
    if (!canWrite) { alertProblem('Запазването е блокирано, за да не се презапишат повредени или недостъпни данни.'); return false; }
    try { localStorage.setItem(KEY, JSON.stringify(data)); return true; }
    catch (error) { alertProblem('Записът не е успешен. Провери свободното място и настройките за данни в Chrome. Не затваряй страницата, преди да запазиш архив.\n' + error.message); return false; }
  }
  function commit(message) { if (store()) { renderAll(); if (message) toast(message); return true; } return false; }
  function weekTitle(date) { const ds = C.weekDates(date); return `${shortDate(ds[0])} – ${dateLabel(ds[6])}`; }
  function jumpWeek(n) { selectedWeek = C.addDays(selectedWeek, n * 7); renderAll(); }
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
      const note = day.card !== 0 ? `<small>Карта ${GBP(day.card)} · такса ~${GBP(day.cardFee)} · очаквано постъпление ${GBP(day.card - day.cardFee)} на ${shortDate(C.addDays(day.date, 1))}</small>` : '';
      return `<article class="day-row"><div class="day-line"><div><strong>${esc(dayName(day.date))}</strong><small>${shortDate(day.date)} · <span class="status ${kind}">${status}</span></small></div><div class="day-money">${GBP(day.income)}<small>Разходи ${GBP(day.expenses)}</small></div></div>${note}<div class="day-actions"><button type="button" data-action="zero-day" data-date="${date}">Без оборот</button><button type="button" data-action="closed-day" data-date="${date}">Затворено</button>${tags ? `<button type="button" data-action="clear-day" data-date="${date}">Изчисти статуса</button>` : ''}</div></article>`;
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
    const records = data.records.filter(r => r.date >= selectedWeek && r.date <= end).sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    $('recordsList').innerHTML = records.length ? records.map(r => `<article class="record"><div class="record-main"><div><strong>${esc(recordTitle(r))}</strong><small>${dateLabel(r.date)}${r.note ? ' · ' + esc(r.note) : ''}</small></div><span class="record-amount ${r.kind === 'income' ? 'income-text' : ''}">${r.kind === 'payment' ? '↗ ' : ((r.kind === 'income' ? r.amountPence : -r.amountPence) < 0 ? '−' : '+')}${GBP(Math.abs(r.amountPence))}${r.amountPence < 0 ? ' (корекция)' : ''}</span></div><div class="record-actions"><button data-action="edit-record" data-id="${esc(r.id)}" type="button">Редактирай</button><button class="danger-text" data-action="delete-record" data-id="${esc(r.id)}" type="button">Изтрий</button></div></article>`).join('') : '<div class="empty-state">Няма записи за тази седмица. Използвай „＋ Приход“ или „＋ Разход“.</div>';
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
  function renderReports() {
    const sw = C.periodSummary(data, C.weekDates(selectedWeek)), sm = C.periodSummary(data, C.monthDates(reportMonth));
    $('reportWeek').innerHTML = reportHTML(sw, weekTitle(selectedWeek));
    $('reportMonthSummary').innerHTML = reportHTML(sm, monthLabel(reportMonth));
    $('reportMonth').value = reportMonth;
  }
  function renderMore() {
    $('cardFee').value = (data.settings.feeBps / 100).toFixed(2);
    $('lastBackup').textContent = data.lastBackupAt ? 'Последен създаден архив: ' + new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.lastBackupAt)) : 'Все още няма създаден архив.';
  }
  function renderAll() { renderWeek(); renderRecords(); renderBills(); renderReports(); renderMore(); updateOnline(); }
  function updateOnline() { $('networkIndicator').textContent = navigator.onLine ? 'Само в телефона' : '● Офлайн'; }
  function editorDate() { const date = C.today(); return date >= selectedWeek && date <= C.addDays(selectedWeek, 6) ? date : C.addDays(selectedWeek, 1); }
  function openEntry(kind, record = null, billId = '') {
    const isPayment = kind === 'payment';
    if (isPayment && data.bills.length === 0) return toast('Добави първо месечна сметка.');
    $('entryId').value = record?.id || '';
    $('entryKind').value = kind;
    $('entryHeading').textContent = record ? 'Редактиране на запис' : kind === 'income' ? 'Добави приход' : kind === 'expense' ? 'Добави разход' : 'Отбележи плащане';
    $('entryDate').value = record?.date || (isPayment ? C.today() : editorDate());
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
    $('entryDialog').showModal();
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
    $('billDialog').showModal();
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
    $('actualDialog').showModal();
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
      const snapshot = structuredClone(data);
      snapshot.lastBackupAt = new Date().toISOString();
      const checksum = await digest(JSON.stringify(snapshot));
      const file = { format: 'aroma-weekly-backup', version: 1, exportedAt: snapshot.lastBackupAt, checksumSHA256: checksum, payload: snapshot };
      download(`aroma-archive-${C.today()}.json`, JSON.stringify(file, null, 2), 'application/json;charset=utf-8');
      data.lastBackupAt = snapshot.lastBackupAt; store(); renderMore(); toast('Архивът е създаден. Провери папката Downloads.');
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
    const view = event.target.closest('[data-view]'); if (view) return changeView(view.dataset.view);
    const suggestion = event.target.closest('[data-suggest]'); if (suggestion) { $('billTitle').value = suggestion.dataset.suggest; return; }
    const b = event.target.closest('[data-action]'); if (!b) return;
    const action = b.dataset.action, id = b.dataset.id, date = b.dataset.date;
    if (action === 'add-income') return openEntry('income');
    if (action === 'add-expense') return openEntry('expense');
    if (action === 'edit-record') { const record = data.records.find(r => r.id === id); if (record) openEntry(record.kind, record); return; }
    if (action === 'delete-record') return deleteRecord(id);
    if (action === 'edit-bill') return openBill(data.bills.find(b => b.id === id));
    if (action === 'delete-bill') return deleteBill(id);
    if (action === 'actual-bill') return openActual(id);
    if (action === 'payment-bill') return openEntry('payment', null, id);
    if (['zero-day','closed-day','clear-day'].includes(action)) return dayFlag(action, date);
    if (action === 'close-entry') $('entryDialog').close();
    if (action === 'close-bill') $('billDialog').close();
    if (action === 'close-actual') $('actualDialog').close();
  }
  function registerListeners() {
    document.addEventListener('click', actions);
    $('prevWeek').addEventListener('click', () => jumpWeek(-1));
    $('nextWeek').addEventListener('click', () => jumpWeek(1));
    $('recordsPrev').addEventListener('click', () => jumpWeek(-1));
    $('recordsNext').addEventListener('click', () => jumpWeek(1));
    $('goToday').addEventListener('click', () => { selectedWeek = C.weekStart(C.today()); renderAll(); });
    $('reviewToggle').addEventListener('click', toggleReview);
    $('entryForm').addEventListener('submit', saveEntry);
    $('billForm').addEventListener('submit', saveBill);
    $('actualForm').addEventListener('submit', saveActual);
    $('clearActual').addEventListener('click', clearActual);
    $('addBill').addEventListener('click', () => openBill());
    $('billMonth').addEventListener('change', e => { if (C.validMonth(e.target.value)) { billMonth = e.target.value; renderBills(); } });
    $('reportMonth').addEventListener('change', e => { if (C.validMonth(e.target.value)) { reportMonth = e.target.value; renderReports(); } });
    $('saveFee').addEventListener('click', saveFee);
    $('backup').addEventListener('click', backup);
    $('restoreFile').addEventListener('change', e => restore(e.target.files[0]));
    $('weekCSV').addEventListener('click', () => exportCSV(false));
    $('monthCSV').addEventListener('click', () => exportCSV(true));
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('installApp').hidden = false; });
    $('installApp').addEventListener('click', async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('installApp').hidden = true; });
  }
  data = load(); registerListeners(); renderAll();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker:', error));
})();
