(() => {
  "use strict";

  const app = document.querySelector("#app");
  const dialogRoot = document.querySelector("#dialog-root");
  const toast = document.querySelector("#toast");
  const pageSize = 50;
  let data;
  let toastTimer;
  let historyPage = 0;
  let historySearch = "";
  let historyFiltersOpen = false;
  let farmerSearch = "";
  let purchaseFormDirty = false;
  let syncStateUnsubscribe;
  let historyFilters = { status: "ACTIVE", payment: "all", farmer: "all", grain: "all", from: "", to: "" };
  let historyPreset = "all";
  let currentRoute = {};
  const calc = () => window.GrainCalc;
  const validate = () => window.GrainValidate;
  const escapeHTML = (value) => window.GrainReceipt.escapeHTML(value);

  function amountPaid(purchaseId) {
    return calc().paidSoFar(data.payments, purchaseId);
  }
  function balance(purchase) { return calc().calculateBalance(purchase.totalPaise, amountPaid(purchase.purchaseId)); }
  function payStatus(purchase) { return calc().paymentStatus(purchase.totalPaise, amountPaid(purchase.purchaseId), purchase.status); }
  function purchaseNikaramWeightG(purchase) { return purchase.nikaramWeightG || 100000; }
  function purchaseNikaramsScaled(purchase) {
    return purchase.nikaramsScaled ?? calc().computeTotalNikaramsScaled(purchase.payableWeightG, purchaseNikaramWeightG(purchase));
  }
  function formatPurchaseNikarams(purchase) {
    return calc().formatNikarams(purchase.payableWeightG, purchaseNikaramWeightG(purchase));
  }
  function formatNikaramsTotal(purchases) {
    const scaled = purchases.reduce((sum, purchase) => sum + purchaseNikaramsScaled(purchase), 0);
    return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 5 }).format(scaled / 100000);
  }
  function activePurchases() { return data.purchases.filter((purchase) => purchase.status !== "VOID"); }
  function fmtDate(date, withTime = false) {
    const value = new Date(date);
    if (Number.isNaN(value.getTime())) return "—";
    return value.toLocaleString("en-IN", withTime
      ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short", year: "numeric" });
  }
  function localDateTimeValue(value = new Date()) {
    const date = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return date.toISOString().slice(0, 16);
  }
  function localDateKey(value) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  function datePreset(preset, now = new Date()) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    if (preset === "yesterday") start.setDate(start.getDate() - 1);
    if (preset === "yesterday") end.setDate(end.getDate() - 1);
    if (preset === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    if (preset === "month") start.setDate(1);
    if (preset === "all" || preset === "custom") return { from: "", to: "" };
    return { from: localDateKey(start), to: localDateKey(end) };
  }
  function toastMessage(message, isError = false) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle("is-error", isError);
    toast.classList.add("is-visible");
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3400);
  }
  function runSave(callback, successMessage) {
    try {
      callback();
      refresh();
      toastMessage(successMessage);
      return true;
    } catch (error) {
      toastMessage(error.message || "Could not save. Check that browser storage is available.", true);
      return false;
    }
  }
  function refresh() {
    try { data = window.GrainStorage.getData(); }
    catch (error) { renderFatal(error); return; }
    render();
  }
  function renderFatal(error) {
    app.innerHTML = `<section class="page-heading"><div><p class="eyebrow">CAN'T OPEN SAVED DATA</p><h1>Data needs attention</h1><p class="page-subtitle">${escapeHTML(error.message)}</p></div></section><section class="panel"><h2>Your saved records have not been overwritten.</h2><p>Check that browser storage is available before trying again.</p></section>`;
  }
  function routeFromHash() {
    const segments = location.hash.split("?")[0].replace(/^#\/?/, "").split("/").filter(Boolean);
    const route = segments[0] || "dashboard";
    const known = ["dashboard", "purchase", "purchases", "farmers", "grains", "reports", "settings"];
    if (!known.includes(route)) return { name: "dashboard" };
    if (route === "purchase" && segments[1] && segments[1] !== "new") return { name: "purchase-detail", id: segments[1] };
    if (route === "purchase") return { name: "purchase" };
    if (route === "purchases" && segments[1]) return { name: "purchase-detail", id: segments[1] };
    if (route === "farmers" && segments[1]) return { name: "farmers-detail", id: decodeURIComponent(segments[1]) };
    return { name: route };
  }
  function statusBadge(status) {
    return `<span class="status-badge status-${status.toLowerCase()}">${escapeHTML(status)}</span>`;
  }
  function emptyBlock(title, text, action = "") {
    return `<div class="empty-block"><span class="empty-symbol" aria-hidden="true">✦</span><strong>${escapeHTML(title)}</strong><span>${escapeHTML(text)}</span>${action}</div>`;
  }
  function pageHeading(eyebrow, title, subtitle, action = "") {
    return `<section class="page-heading"><div><p class="eyebrow">${escapeHTML(eyebrow)}</p><h1>${escapeHTML(title)}</h1>${subtitle ? `<p class="page-subtitle">${escapeHTML(subtitle)}</p>` : ""}</div>${action}</section>`;
  }
  function metric(label, value, note = "") {
    return `<article class="metric-card"><span class="metric-label">${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong>${note ? `<small>${escapeHTML(note)}</small>` : ""}</article>`;
  }
  function formField(label, control, hint = "") {
    return `<label class="form-field">${escapeHTML(label)}${control}${hint ? `<small>${escapeHTML(hint)}</small>` : ""}</label>`;
  }
  function renderDashboard() {
    const active = activePurchases();
    const now = new Date();
    const todayKey = localDateKey(now);
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const today = calc().summarizePurchases(active.filter((purchase) => purchase.purchaseDate.slice(0, 10) === todayKey), data.payments);
    const month = calc().summarizePurchases(active.filter((purchase) => purchase.purchaseDate.slice(0, 7) === monthKey), data.payments);
    const outstanding = calc().summarizePurchases(active, data.payments).balancePaise;
    const recent = [...data.purchases].sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate)).slice(0, 10);
    const firstUse = data.purchases.length === 0 && data.farmers.length === 0;
    app.innerHTML = `${pageHeading("PROCUREMENT OVERVIEW", "Dashboard", "")}
      ${!data.settings.shopName ? `<div class="notice notice-warm"><span aria-hidden="true">✦</span><div><strong>Shop name needed</strong><span>Add a name to print on receipts.</span></div><a class="button button-outline" href="#/settings">Settings</a></div>` : ""}
      ${firstUse ? `<section class="panel welcome-panel"><div class="welcome-copy"><p class="eyebrow">WELCOME TO GRAINWISE</p><h2>Ready for your first purchase?</h2><div class="welcome-actions"><a class="button button-primary" href="#/purchase/new">New purchase</a><button type="button" class="text-button" data-action="load-demo">Load sample data</button></div></div></section>` : ""}
      <section class="section-block"><div class="section-title"><div><h2>Today</h2></div></div><div class="metric-grid four">${metric("Purchases", String(today.count))}${metric("Total amount", calc().formatMoney(today.amountPaise))}${metric("Paid", calc().formatMoney(today.paidPaise))}${metric("Balance", calc().formatMoney(today.balancePaise))}</div></section>
      <section class="section-block"><div class="section-title"><div><h2>This month</h2></div></div><div class="metric-grid four">${metric("Purchases", String(month.count))}${metric("Total amount", calc().formatMoney(month.amountPaise))}${metric("Paid", calc().formatMoney(month.paidPaise))}${metric("Balance", calc().formatMoney(month.balancePaise))}</div></section>
      <section class="pending-card"><div><span class="pending-kicker">OUTSTANDING PAYMENTS</span><strong>${calc().formatMoney(outstanding)}</strong></div><a class="button button-outline" href="#/reports?type=pending">View payments <span aria-hidden="true">→</span></a></section>
      <section class="panel"><div class="panel-heading"><div><h2>Recent purchases</h2></div><a class="text-link" href="#/purchases">View history →</a></div>
      ${recent.length ? `<div class="table-wrap"><table><thead><tr><th>RECEIPT</th><th>DATE</th><th>FARMER</th><th>GRAIN</th><th>PAYABLE WEIGHT</th><th>NIKARAMS</th><th>AMOUNT</th><th>PAYMENT</th></tr></thead><tbody>${recent.map((purchase) => `<tr data-href="#/purchases/${encodeURIComponent(purchase.purchaseId)}"><td><a class="receipt-link" href="#/purchases/${encodeURIComponent(purchase.purchaseId)}">${escapeHTML(purchase.receiptNumber)}</a></td><td>${escapeHTML(fmtDate(purchase.purchaseDate, true))}</td><td>${escapeHTML(purchase.farmerName)}</td><td>${escapeHTML(purchase.grainName)}</td><td>${calc().formatWeightKg(purchase.payableWeightG)}</td><td>${formatPurchaseNikarams(purchase)}</td><td class="money-cell">${calc().formatMoney(purchase.totalPaise)}</td><td>${statusBadge(payStatus(purchase))}</td></tr>`).join("")}</tbody></table></div>` : emptyBlock("No purchases yet", "New purchases will appear here after you record them.", `<a class="button button-outline" href="#/purchase/new">Record first purchase</a>`)}</section>`;
  }

  function renderPurchase() {
    purchaseFormDirty = false;
    const grains = calc().GRAIN_TYPES.map((name) => data.grains.find((grain) => grain.grainName.toLocaleLowerCase() === name.toLocaleLowerCase())).filter(Boolean);
    const shopMissing = !data.settings.shopName.trim();
    const grainOptions = grains.map((grain) => `<option value="${escapeHTML(grain.grainId)}" data-rate="${grain.defaultRatePaise}">${escapeHTML(grain.grainName)}</option>`).join("");
    const weightStep = (10 ** -data.settings.weightDecimalPlaces).toFixed(data.settings.weightDecimalPlaces);
    const defaultPaymentMode = ["CASH", "UPI", "BANK"].includes(data.settings.defaultPaymentMode) ? data.settings.defaultPaymentMode : "";
    const paddy = grains.find((grain) => grain.grainName === "Paddy") || grains[0];
    app.innerHTML = `${pageHeading("PURCHASE ENTRY", "New purchase", "")}
      ${shopMissing ? `<div class="notice notice-warm"><span>!</span><div><strong>Set the shop name first</strong><span>A shop name is required on receipts.</span></div><a class="button button-outline" href="#/settings">Open settings</a></div>` : ""}
      <form class="panel purchase-form" id="purchase-entry-form">
        <div class="panel-heading"><div><h2>Purchase details</h2><p>Fields marked with * are required.</p></div><span class="required-note">* Required</span></div>
        <div class="form-grid">
          ${formField("Purchase date & time *", `<input name="purchaseDate" type="datetime-local" value="${localDateTimeValue()}" required max="${localDateTimeValue()}" />`)}
          ${formField("Farmer name *", `<input name="farmerName" required minlength="2" maxlength="60" autocomplete="name">`)}
          ${formField("Grain *", `<select name="grainId" required>${grainOptions}</select>`)}
          ${formField("Bag size (KG) *", `<input name="bagSizeKg" type="number" inputmode="decimal" min="1.001" max="100000" step="0.001" required value="${(data.settings.bagSizesG[paddy?.grainName] || 70000) / 1000}">`, "1 kg tare is deducted for each bag used.")}
          <div class="purchase-weight-row">
            ${formField("Full bags *", `<input name="fullBags" type="number" inputmode="numeric" min="0" step="1" value="0" required>`)}
            ${formField("Remaining KGs *", `<input name="remainingKg" type="number" inputmode="decimal" min="0" step="${weightStep}" value="0" required>`)}
          </div>
          ${formField("Rate per Nikaram (₹) *", `<input name="rate" inputmode="decimal" autocomplete="off" placeholder="e.g. 2400.00" required />`)}
          <div class="calculation-card" id="purchase-calculation">
            <div class="calculation-row"><span>PAYABLE WEIGHT</span><strong id="calc-weight">—</strong></div>
            <div class="calculation-row"><span>NIKARAMS</span><strong id="calc-nikarams">—</strong></div>
            <div class="calculation-row calculation-total"><span>TOTAL PAYABLE</span><strong id="calc-total">—</strong></div>
          </div>
          ${formField("Remarks", `<textarea name="remarks" rows="2" maxlength="200" placeholder="Optional notes for this purchase"></textarea>`)}
        </div>
        <details class="payment-entry" ${data.settings.paymentEntryOpen ? "open" : ""}><summary>Record a payment now <span>Optional</span></summary>
          <div class="form-grid payment-grid">
            ${formField("Amount paid (₹)", `<input name="paymentAmount" inputmode="decimal" />`)}
            ${formField("Payment mode", `<select name="paymentMode"><option value="">Select mode</option><option value="CASH" ${defaultPaymentMode === "CASH" ? "selected" : ""}>Cash</option><option value="UPI" ${defaultPaymentMode === "UPI" ? "selected" : ""}>UPI</option><option value="BANK" ${defaultPaymentMode === "BANK" ? "selected" : ""}>Bank</option></select>`)}
            ${formField("Reference", `<input name="paymentReference" maxlength="40" placeholder="Optional reference" />`)}
          </div><button class="text-button" type="button" data-action="pay-full">Pay full amount</button>
        </details>
        <div class="form-actions"><a class="button button-outline" href="#/dashboard">Cancel</a><button class="button button-primary" type="submit" ${shopMissing || !grains.length ? "disabled" : ""}>Save purchase</button></div>
      </form>`;
    const grainSelect = app.querySelector('[name="grainId"]');
    const bagSizeInput = app.querySelector('[name="bagSizeKg"]');
    const fullBagsInput = app.querySelector('[name="fullBags"]');
    const remainingKgInput = app.querySelector('[name="remainingKg"]');
    const rateInput = app.querySelector('[name="rate"]');
    grainSelect.value = paddy?.grainId || "";
    rateInput.value = paddy?.defaultRatePaise ? calc().formatRupeesInput(paddy.defaultRatePaise) : "";
    function updateCalc() {
      try {
        const selected = grains.find((grain) => grain.grainId === grainSelect.value);
        const nikaramWeightG = data.settings.nikaramWeightsG[selected?.grainName] || 0;
        const bagSizeG = calc().parseWeightKg(bagSizeInput.value, 3);
        const fullBags = calc().parseFullBags(fullBagsInput.value);
        const remainingWeightG = calc().parseWeightKg(remainingKgInput.value, data.settings.weightDecimalPlaces, true);
        const weightG = calc().computePayableWeightG(fullBags, bagSizeG, remainingWeightG);
        const ratePaise = calc().parseRateRupees(rateInput.value);
        const total = calc().computeTotalPaise(weightG, ratePaise, data.settings.roundingMode, nikaramWeightG);
        app.querySelector("#calc-weight").textContent = calc().formatWeightKg(weightG);
        app.querySelector("#calc-nikarams").textContent = calc().formatNikarams(weightG, nikaramWeightG);
        app.querySelector("#calc-total").textContent = calc().formatMoney(total);
      } catch {
        app.querySelector("#calc-weight").textContent = "—";
        app.querySelector("#calc-nikarams").textContent = "—";
        app.querySelector("#calc-total").textContent = "—";
      }
    }
    grainSelect.addEventListener("change", () => {
      const selected = grains.find((grain) => grain.grainId === grainSelect.value);
      bagSizeInput.value = ((data.settings.bagSizesG[selected?.grainName] || 70000) / 1000).toString();
      rateInput.value = selected?.defaultRatePaise ? calc().formatRupeesInput(selected.defaultRatePaise) : "";
      updateCalc();
    });
    [bagSizeInput, fullBagsInput, remainingKgInput, rateInput].forEach((input) => input.addEventListener("input", updateCalc));
    updateCalc();
    app.querySelector('[data-action="pay-full"]').addEventListener("click", () => {
      try {
        const selected = grains.find((grain) => grain.grainId === grainSelect.value);
        const nikaramWeightG = data.settings.nikaramWeightsG[selected?.grainName] || 0;
        const bagSizeG = calc().parseWeightKg(bagSizeInput.value, 3);
        const weightG = calc().computePayableWeightG(calc().parseFullBags(fullBagsInput.value), bagSizeG, calc().parseWeightKg(remainingKgInput.value, data.settings.weightDecimalPlaces, true));
        const total = calc().computeTotalPaise(weightG, calc().parseRateRupees(rateInput.value), data.settings.roundingMode, nikaramWeightG);
        app.querySelector('[name="paymentAmount"]').value = calc().formatRupeesInput(total);
      } catch { toastMessage("Enter a valid weight and rate first.", true); }
    });
    app.querySelector("#purchase-entry-form").addEventListener("submit", saveNewPurchase);
    app.querySelector("#purchase-entry-form").addEventListener("input", () => { purchaseFormDirty = true; });
    app.querySelector("#purchase-entry-form").addEventListener("change", () => { purchaseFormDirty = true; });
  }

  async function saveNewPurchase(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const saveButton = form.querySelector('button[type="submit"]');
    saveButton.disabled = true;
    const fields = new FormData(form);
    try {
      if (!data.settings.shopName.trim()) throw new Error("Set the shop name in Settings first");
      const grain = data.grains.find((item) => item.grainId === fields.get("grainId"));
      if (!grain) throw new Error("Select an active grain");
      const purchaseDate = validate().dateNotFuture(fields.get("purchaseDate"));
      const farmerName = validate().farmerName(fields.get("farmerName"));
      if (!calc().GRAIN_TYPES.includes(grain.grainName)) throw new Error("Select Paddy, Maize, or Jowar");
      const fullBags = calc().parseFullBags(fields.get("fullBags"));
      const bagSizeG = calc().parseWeightKg(fields.get("bagSizeKg"), 3);
      const remainingWeightG = calc().parseWeightKg(fields.get("remainingKg"), data.settings.weightDecimalPlaces, true);
      const nikaramWeightG = data.settings.nikaramWeightsG[grain.grainName];
      const payableWeightG = calc().computePayableWeightG(fullBags, bagSizeG, remainingWeightG);
      const bagCount = fullBags + (remainingWeightG > 0 ? Math.ceil(remainingWeightG / bagSizeG) : 0);
      const ratePaise = calc().parseRateRupees(fields.get("rate"));
      const totalPaise = calc().computeTotalPaise(payableWeightG, ratePaise, data.settings.roundingMode, nikaramWeightG);
      if (totalPaise < 1) throw new Error("Amount is too small to save");
      const remarks = validate().remarks(fields.get("remarks"));
      const paymentValue = String(fields.get("paymentAmount") || "").trim();
      const paymentMode = String(fields.get("paymentMode") || "");
      let payment = null;
      if (paymentValue) {
        const paidPaise = calc().parseMoneyRupees(paymentValue);
        if (paidPaise <= 0 || paidPaise > totalPaise) throw new Error(`Payment cannot exceed the balance of ${calc().formatMoney(totalPaise)}`);
        if (!paymentMode) throw new Error("Select a payment mode");
        payment = { paidPaise, paymentMode, reference: validate().text(fields.get("paymentReference"), "Reference", 0, 40, false), paymentDate: new Date().toISOString() };
      }
      const duplicate = data.purchases.find((item) => item.status !== "VOID" && item.farmerName.toLocaleLowerCase() === farmerName.toLocaleLowerCase() && item.grainId === grain.grainId && item.payableWeightG === payableWeightG && item.ratePaise === ratePaise && Date.now() - new Date(item.createdAt).getTime() < 120000);
      if (duplicate && !window.confirm(`This looks like a duplicate of receipt ${duplicate.receiptNumber}. Save anyway?`)) return;
      const purchase = {
        purchaseDate,
        farmerName,
        farmerVillage: "",
        farmerMobile: "",
        grainId: grain.grainId,
        grainName: grain.grainName,
        fullBags,
        bagSizeG,
        remainingWeightG,
        bagTareG: 1000,
        bagCount,
        payableWeightG,
        nikaramWeightG,
        nikaramsScaled: calc().computeTotalNikaramsScaled(payableWeightG, nikaramWeightG),
        ratePaise,
        rateBasisWeightG: nikaramWeightG,
        totalPaise,
        roundingMode: data.settings.roundingMode,
        remarks,
        shopName: data.settings.shopName,
        shopAddress: data.settings.shopAddress,
        shopPhone: data.settings.shopPhone,
        status: "ACTIVE"
      };
      const saved = await window.GrainStorage.savePurchase(purchase, payment);
      purchaseFormDirty = false;
      location.hash = `#/purchases/${encodeURIComponent(saved.purchaseId)}`;
      toastMessage(`Purchase ${saved.receiptNumber} saved.`);
    } catch (error) {
      toastMessage(error.message || "Could not save. Check that browser storage is available.", true);
    } finally {
      saveButton.disabled = false;
    }
  }

  function purchaseRows(records, includeActions = false) {
    return records.map((purchase) => {
      const paid = amountPaid(purchase.purchaseId);
      const due = balance(purchase);
      return `<tr>
        <td data-label="Receipt"><a class="receipt-link" href="#/purchases/${encodeURIComponent(purchase.purchaseId)}">${escapeHTML(purchase.receiptNumber)}</a></td>
        <td data-label="Date">${escapeHTML(fmtDate(purchase.purchaseDate, true))}</td>
        <td data-label="Farmer">${escapeHTML(purchase.farmerName)}<small class="cell-subtitle">${escapeHTML(purchase.farmerVillage || "")}</small></td>
        <td data-label="Grain">${escapeHTML(purchase.grainName)}</td>
        <td data-label="Payable weight">${calc().formatWeightKg(purchase.payableWeightG)}</td>
        <td data-label="Nikarams">${formatPurchaseNikarams(purchase)}</td>
        <td data-label="Rate">${calc().formatMoney(purchase.ratePaise)}<small class="cell-subtitle">${purchase.rateBasisWeightG ? "per Nikaram" : "per 100 kg"}</small></td>
        <td data-label="Total" class="money-cell">${calc().formatMoney(purchase.totalPaise)}</td>
        <td data-label="Paid">${calc().formatMoney(paid)}</td><td data-label="Balance">${calc().formatMoney(due)}</td>
        <td data-label="Status">${purchase.status === "VOID" ? statusBadge("Void") : statusBadge(payStatus(purchase))}</td>
        ${includeActions ? `<td data-label="Actions"><div class="row-actions"><button class="button button-small button-outline" data-action="print" data-id="${escapeHTML(purchase.purchaseId)}">Print</button>${purchase.status === "ACTIVE" && due > 0 ? `<button class="button button-small button-outline" data-action="add-payment" data-id="${escapeHTML(purchase.purchaseId)}">Add payment</button>` : ""}</div></td>` : ""}
      </tr>`;
    }).join("");
  }

  function renderHistory() {
    const search = historySearch.trim().toLocaleLowerCase();
    let records = [...data.purchases].sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));
    records = records.filter((purchase) => {
      const matchesSearch = !search || `${purchase.receiptNumber} ${purchase.farmerName} ${purchase.farmerVillage} ${purchase.farmerMobile}`.toLocaleLowerCase().includes(search);
      const matchesStatus = historyFilters.status === "ALL" || purchase.status === historyFilters.status;
      const matchesFarmer = historyFilters.farmer === "all" || purchase.farmerName === historyFilters.farmer;
      const matchesGrain = historyFilters.grain === "all" || purchase.grainId === historyFilters.grain;
      const status = payStatus(purchase).toLocaleLowerCase();
      const matchesPayment = historyFilters.payment === "all" || status === historyFilters.payment;
      const day = purchase.purchaseDate.slice(0, 10);
      return matchesSearch && matchesStatus && matchesFarmer && matchesGrain && matchesPayment && (!historyFilters.from || day >= historyFilters.from) && (!historyFilters.to || day <= historyFilters.to);
    });
    const activeFiltered = records.filter((purchase) => purchase.status === "ACTIVE");
    const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
    historyPage = Math.min(historyPage, pageCount - 1);
    const pageRecords = records.slice(historyPage * pageSize, (historyPage + 1) * pageSize);
    const summary = calc().summarizePurchases(activeFiltered, data.payments);
    const extraFilterCount = [historyFilters.payment !== "all", historyFilters.farmer !== "all", historyFilters.grain !== "all", Boolean(historyFilters.from), Boolean(historyFilters.to)].filter(Boolean).length;
    app.innerHTML = `${pageHeading("PURCHASE RECORDS", "Purchase history", "Search, filter, print, and review purchases.")}
      <section class="panel filter-panel history-filter-panel">
        <div class="history-filter-toolbar">
          <label class="search-control"><span aria-hidden="true">⌕</span><input id="history-search" type="search" value="${escapeHTML(historySearch)}" placeholder="Search receipt, farmer, village, mobile..." aria-label="Search purchases"></label>
          <button class="button button-outline filter-toggle" type="button" data-action="toggle-history-filters" aria-controls="history-filter-options" aria-expanded="${historyFiltersOpen}">Filters${extraFilterCount ? ` <span class="filter-count">${extraFilterCount}</span>` : ""}</button>
        </div>
        <div class="filter-grid" id="history-filter-options" ${historyFiltersOpen ? "" : "hidden"}>
          <label class="compact-field">Date range<select id="filter-range"><option value="all" ${historyPreset === "all" ? "selected" : ""}>All dates</option><option value="today" ${historyPreset === "today" ? "selected" : ""}>Today</option><option value="yesterday" ${historyPreset === "yesterday" ? "selected" : ""}>Yesterday</option><option value="week" ${historyPreset === "week" ? "selected" : ""}>This week</option><option value="month" ${historyPreset === "month" ? "selected" : ""}>This month</option><option value="custom" ${historyPreset === "custom" ? "selected" : ""}>Custom</option></select></label>
          <label class="compact-field">Purchase status<select id="filter-status"><option value="ACTIVE" ${historyFilters.status === "ACTIVE" ? "selected" : ""}>Active</option><option value="VOID" ${historyFilters.status === "VOID" ? "selected" : ""}>Void</option><option value="ALL" ${historyFilters.status === "ALL" ? "selected" : ""}>All</option></select></label>
          <label class="compact-field">Payment<select id="filter-payment"><option value="all">All payments</option><option value="pending" ${historyFilters.payment === "pending" ? "selected" : ""}>Pending</option><option value="partial" ${historyFilters.payment === "partial" ? "selected" : ""}>Partial</option><option value="paid" ${historyFilters.payment === "paid" ? "selected" : ""}>Paid</option></select></label>
          <label class="compact-field">Farmer<select id="filter-farmer"><option value="all">All farmers</option>${[...new Set(data.purchases.map((purchase) => purchase.farmerName))].sort((a, b) => a.localeCompare(b)).map((farmerName) => `<option value="${escapeHTML(farmerName)}" ${historyFilters.farmer === farmerName ? "selected" : ""}>${escapeHTML(farmerName)}</option>`).join("")}</select></label>
          <label class="compact-field">Grain<select id="filter-grain"><option value="all">All grains</option>${data.grains.map((grain) => `<option value="${escapeHTML(grain.grainId)}" ${historyFilters.grain === grain.grainId ? "selected" : ""}>${escapeHTML(grain.grainName)}</option>`).join("")}</select></label>
          <label class="compact-field">From<input id="filter-from" type="date" value="${escapeHTML(historyFilters.from)}"></label>
          <label class="compact-field">To<input id="filter-to" type="date" value="${escapeHTML(historyFilters.to)}"></label>
        </div>
      </section>
      <section class="panel"><div class="panel-heading"><div><h2>Filtered purchases</h2><p>${records.length} result${records.length === 1 ? "" : "s"} · ${summary.count} active</p></div><button class="text-button" data-action="clear-history">Clear filters</button></div>
        <div class="metric-strip"><span>${summary.count} purchases</span><span>${formatNikaramsTotal(activeFiltered)} Nikarams</span><span>Total ${calc().formatMoney(summary.amountPaise)}</span><span>Paid ${calc().formatMoney(summary.paidPaise)}</span><span>Balance ${calc().formatMoney(summary.balancePaise)}</span></div>
        ${pageRecords.length ? `<div class="table-wrap"><table class="history-table"><thead><tr><th>RECEIPT</th><th>DATE</th><th>FARMER / VILLAGE</th><th>GRAIN</th><th>WEIGHT</th><th>NIKARAMS</th><th>RATE</th><th>TOTAL</th><th>PAID</th><th>BALANCE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${purchaseRows(pageRecords, true)}</tbody></table></div>` : emptyBlock("No purchases match these filters", "Clear a filter or search for a different record.")}
        <div class="pagination"><span>Page ${historyPage + 1} of ${pageCount}</span><div><button class="button button-outline button-small" data-action="previous-page" ${historyPage === 0 ? "disabled" : ""}>Previous</button><button class="button button-outline button-small" data-action="next-page" ${historyPage >= pageCount - 1 ? "disabled" : ""}>Next</button></div></div>
      </section>`;
    app.querySelector("#history-search").addEventListener("input", (event) => {
      historySearch = event.target.value;
      historyPage = 0;
      const start = event.target.selectionStart;
      renderHistory();
      const input = app.querySelector("#history-search");
      input.focus();
      input.setSelectionRange(start, start);
    });
    app.querySelector("#filter-range").addEventListener("change", (event) => {
      historyPreset = event.target.value;
      if (historyPreset !== "custom") Object.assign(historyFilters, datePreset(historyPreset));
      historyPage = 0;
      renderHistory();
    });
    [["filter-status", "status"], ["filter-payment", "payment"], ["filter-farmer", "farmer"], ["filter-grain", "grain"], ["filter-from", "from"], ["filter-to", "to"]].forEach(([id, key]) => {
      app.querySelector(`#${id}`).addEventListener("change", (event) => { historyFilters[key] = event.target.value; if (key === "from" || key === "to") historyPreset = "custom"; historyPage = 0; renderHistory(); });
    });
  }

  function renderPurchaseDetail(id) {
    const purchase = data.purchases.find((item) => item.purchaseId === id);
    if (!purchase) { app.innerHTML = `${pageHeading("PURCHASE", "Purchase not found", "This record may have been removed from this device.")}<a class="button button-outline" href="#/purchases">Back to history</a>`; return; }
    const payments = data.payments.filter((item) => item.purchaseId === id).sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));
    const paid = amountPaid(id);
    const isVoid = purchase.status === "VOID";
    app.innerHTML = `${pageHeading("PURCHASE DETAIL", purchase.receiptNumber, `${fmtDate(purchase.purchaseDate, true)} · ${purchase.farmerName}`, `<button class="button button-outline" data-action="print" data-id="${escapeHTML(id)}">Print receipt</button>`)}
      <div class="detail-grid"><section class="panel"><div class="panel-heading"><div><h2>Purchase details</h2><p>Saved values are kept as a receipt snapshot.</p></div>${isVoid ? statusBadge("Void") : statusBadge(payStatus(purchase))}</div>
        <dl class="detail-list">
          ${detail("Farmer", purchase.farmerName)}${detail("Village", purchase.farmerVillage || "—")}${detail("Mobile", purchase.farmerMobile || "—")}${detail("Grain", purchase.grainName)}${purchase.fullBags === undefined ? "" : detail("Full bags", String(purchase.fullBags))}${purchase.bagSizeG === undefined ? "" : detail("Bag size", calc().formatWeightKg(purchase.bagSizeG))}${purchase.bagCount === undefined ? "" : detail("Total bags", String(purchase.bagCount))}${purchase.bagTareG === undefined ? "" : detail("Bag deduction", calc().formatWeightKg(purchase.bagTareG * purchase.bagCount))}${purchase.remainingWeightG === undefined ? "" : detail("Remaining KGs", calc().formatWeightKg(purchase.remainingWeightG))}${detail("Payable weight", calc().formatWeightKg(purchase.payableWeightG))}${detail("Nikarams", formatPurchaseNikarams(purchase))}${detail("Nikaram weight", calc().formatWeightKg(purchaseNikaramWeightG(purchase)))}${detail(purchase.rateBasisWeightG ? "Rate per Nikaram" : "Rate per 100 kg", calc().formatMoney(purchase.ratePaise))}${detail("Total amount", calc().formatMoney(purchase.totalPaise))}${detail("Shop snapshot", purchase.shopName)}${detail("Remarks", purchase.remarks || "—")}
          ${isVoid ? detail("Void reason", purchase.voidReason) : ""}
        </dl><div class="form-actions left-actions">${!isVoid ? `<button class="button button-outline" data-action="edit-remarks" data-id="${escapeHTML(id)}">Edit remarks</button><button class="button button-outline" data-action="add-payment" data-id="${escapeHTML(id)}" ${balance(purchase) <= 0 ? "disabled" : ""}>Add payment</button><button class="button button-danger" data-action="void-purchase" data-id="${escapeHTML(id)}" ${payments.length ? "disabled" : ""}>Void purchase</button>` : ""}</div>
      </section><section class="panel"><div class="panel-heading"><div><h2>Payments</h2><p>${payments.length} payment${payments.length === 1 ? "" : "s"} recorded</p></div></div>
        ${payments.length ? `<div class="payment-list">${payments.map((payment) => `<div class="payment-row"><div><strong>${calc().formatMoney(payment.paidPaise)}</strong><span>${escapeHTML(payment.paymentMode)} · ${escapeHTML(fmtDate(payment.paymentDate, true))}${payment.reference ? ` · ${escapeHTML(payment.reference)}` : ""}</span></div><button class="text-button danger-text" data-action="delete-payment" data-id="${escapeHTML(payment.paymentId)}">Delete</button></div>`).join("")}</div>` : emptyBlock("No payments recorded", "Payments you add will appear here.")}
        <div class="balance-summary"><span>Total paid</span><strong>${calc().formatMoney(paid)}</strong><span>Balance due</span><strong>${calc().formatMoney(balance(purchase))}</strong></div>
      </section></div>`;
  }
  function detail(label, value) {
    return `<div class="detail-item"><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value ?? "—")}</dd></div>`;
  }

  function renderFarmers() {
    const search = farmerSearch.toLocaleLowerCase();
    const farmers = [...data.farmers];
    for (const farmerName of new Set(data.purchases.map((purchase) => purchase.farmerName))) {
      if (!farmers.some((farmer) => farmer.farmerName.toLocaleLowerCase() === farmerName.toLocaleLowerCase())) {
        farmers.push({ farmerId: `name:${farmerName}`, farmerName, village: "", mobileNumber: "", isActive: true, isVirtual: true });
      }
    }
    const visibleFarmers = farmers.sort((a, b) => a.farmerName.localeCompare(b.farmerName))
      .filter((farmer) => `${farmer.farmerName} ${farmer.mobileNumber} ${farmer.village}`.toLocaleLowerCase().includes(search));
    app.innerHTML = `${pageHeading("YOUR PEOPLE", "Farmers", "Profiles from existing records. Enter names directly on new purchases.")}
      <section class="panel"><div class="panel-toolbar"><label class="search-control"><span aria-hidden="true">⌕</span><input id="farmer-search" type="search" value="${escapeHTML(farmerSearch)}" placeholder="Search name, mobile, or village..." aria-label="Search farmers"></label><span class="muted">${visibleFarmers.length} farmer${visibleFarmers.length === 1 ? "" : "s"}</span></div>
      ${visibleFarmers.length ? `<div class="table-wrap"><table><thead><tr><th>FARMER</th><th>VILLAGE</th><th>MOBILE</th><th>STATUS</th><th>TOTAL PURCHASED</th><th>BALANCE</th><th>ACTIONS</th></tr></thead><tbody>${visibleFarmers.map((farmer) => {
        const records = data.purchases.filter((purchase) => (purchase.farmerId === farmer.farmerId || purchase.farmerName.toLocaleLowerCase() === farmer.farmerName.toLocaleLowerCase()) && purchase.status === "ACTIVE");
        const summary = calc().summarizePurchases(records, data.payments);
        const total = summary.amountPaise;
        const due = summary.balancePaise;
        return `<tr><td data-label="Farmer"><a class="receipt-link" href="#/farmers/${encodeURIComponent(farmer.farmerId)}">${escapeHTML(farmer.farmerName)}</a></td><td data-label="Village">${escapeHTML(farmer.village || "—")}</td><td data-label="Mobile">${escapeHTML(farmer.mobileNumber || "—")}</td><td data-label="Status">${farmer.isVirtual ? "Purchase records" : statusBadge(farmer.isActive ? "Active" : "Inactive")}</td><td data-label="Total purchased">${calc().formatMoney(total)}</td><td data-label="Balance">${calc().formatMoney(due)}</td><td data-label="Actions">${farmer.isVirtual ? "—" : `<button class="button button-small button-outline" data-action="edit-farmer" data-id="${escapeHTML(farmer.farmerId)}">Edit</button> <button class="button button-small button-outline" data-action="toggle-farmer" data-id="${escapeHTML(farmer.farmerId)}">${farmer.isActive ? "Deactivate" : "Reactivate"}</button>`}</td></tr>`;
      }).join("")}</tbody></table></div>` : emptyBlock("No farmers found", "Farmer names appear here after purchases are recorded.")}</section>`;
    app.querySelector("#farmer-search").addEventListener("input", (event) => {
      farmerSearch = event.target.value;
      const start = event.target.selectionStart;
      renderFarmers();
      const input = app.querySelector("#farmer-search");
      input.focus();
      input.setSelectionRange(start, start);
    });
  }

  function renderGrains() {
    const grains = calc().GRAIN_TYPES.map((name) => data.grains.find((grain) => grain.grainName.toLocaleLowerCase() === name.toLocaleLowerCase())).filter(Boolean);
    app.innerHTML = `${pageHeading("GRAIN CATALOG", "Grains", "")}
      <section class="panel"><div class="table-wrap"><table><thead><tr><th>GRAIN</th><th>DEFAULT RATE / NIKARAM</th><th>RATE</th></tr></thead><tbody>${grains.map((grain) => `<tr><td data-label="Grain"><strong>${escapeHTML(grain.grainName)}</strong></td><td data-label="Default rate">${grain.defaultRatePaise ? calc().formatMoney(grain.defaultRatePaise) : "Not set"}</td><td data-label="Rate"><button class="button button-small button-outline" data-action="edit-grain" data-id="${escapeHTML(grain.grainId)}">Edit rate</button></td></tr>`).join("")}</tbody></table></div></section>`;
  }

  function renderFarmerDetail(id) {
    const profile = data.farmers.find((item) => item.farmerId === id);
    const farmerName = profile?.farmerName || (id.startsWith("name:") ? id.slice(5) : "");
    const farmer = profile || (farmerName ? { farmerName, village: "", mobileNumber: "", isVirtual: true } : null);
    if (!farmer) {
      app.innerHTML = `${pageHeading("FARMER", "Farmer not found", "This record may have been removed from this device.")}<a class="button button-outline" href="#/farmers">Back to farmers</a>`;
      return;
    }
    const records = data.purchases.filter((purchase) => purchase.farmerId === id || purchase.farmerName.toLocaleLowerCase() === farmerName.toLocaleLowerCase()).sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));
    const active = records.filter((purchase) => purchase.status === "ACTIVE");
    const summary = calc().summarizePurchases(active, data.payments);
    app.innerHTML = `${pageHeading("FARMER STATEMENT", farmer.farmerName, [farmer.village, farmer.mobileNumber].filter(Boolean).join(" · ") || "No contact details", `<button class="button button-outline" data-action="print-farmer" data-id="${escapeHTML(id)}">Print statement</button>`)}
      <div class="metric-grid">${metric("Purchases", String(summary.count))}${metric("Total purchased", calc().formatMoney(summary.amountPaise))}${metric("Paid", calc().formatMoney(summary.paidPaise))}${metric("Balance", calc().formatMoney(summary.balancePaise))}</div>
      <section class="panel"><div class="panel-heading"><div><h2>Purchase history</h2></div>${farmer.isVirtual ? "" : `<button class="button button-outline" data-action="edit-farmer" data-id="${escapeHTML(id)}">Edit farmer</button>`}</div>
        ${records.length ? `<div class="table-wrap"><table><thead><tr><th>RECEIPT</th><th>DATE</th><th>FARMER / VILLAGE</th><th>GRAIN</th><th>PAYABLE WEIGHT</th><th>NIKARAMS</th><th>RATE</th><th>TOTAL</th><th>PAID</th><th>BALANCE</th><th>STATUS</th></tr></thead><tbody>${purchaseRows(records)}</tbody></table></div>` : emptyBlock("No purchases for this farmer", "Purchases will appear here after you record them.")}</section>`;
  }

  function renderReports() {
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    const from = params.get("from") || "";
    const to = params.get("to") || "";
    const range = params.get("range") || (from || to ? "custom" : "all");
    const type = params.get("type") || "daily";
    const records = activePurchases().filter((purchase) => (!from || purchase.purchaseDate.slice(0, 10) >= from) && (!to || purchase.purchaseDate.slice(0, 10) <= to));
    const grouped = new Map();
    for (const purchase of records) {
      const key = type === "daily" ? purchase.purchaseDate.slice(0, 10) : type === "grain" ? purchase.grainName : purchase.farmerName;
      if (!grouped.has(key)) grouped.set(key, { name: key, purchases: [] });
      grouped.get(key).purchases.push(purchase);
    }
    let reportRows;
    if (type === "pending") {
      reportRows = records.filter((purchase) => balance(purchase) > 0).sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate)).map((purchase) => `<tr><td data-label="Receipt">${escapeHTML(purchase.receiptNumber)}</td><td data-label="Date">${escapeHTML(fmtDate(purchase.purchaseDate))}</td><td data-label="Farmer">${escapeHTML(purchase.farmerName)}</td><td data-label="Total">${calc().formatMoney(purchase.totalPaise)}</td><td data-label="Paid">${calc().formatMoney(amountPaid(purchase.purchaseId))}</td><td data-label="Balance">${calc().formatMoney(balance(purchase))}</td></tr>`).join("");
    } else {
      reportRows = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name)).map((group) => {
        const summary = calc().summarizePurchases(group.purchases, data.payments);
        const averageRate = calc().weightedAverageNikaramRatePaise(summary.amountPaise, group.purchases.reduce((sum, purchase) => sum + purchaseNikaramsScaled(purchase), 0));
        return `<tr><td data-label="${type === "daily" ? "Date" : type === "grain" ? "Grain" : "Farmer"}">${escapeHTML(type === "daily" ? fmtDate(group.name) : group.name)}</td><td data-label="Purchases">${summary.count}</td><td data-label="Payable weight">${calc().formatWeightKg(summary.weightG)}</td><td data-label="Nikarams">${formatNikaramsTotal(group.purchases)}</td><td data-label="Total amount">${calc().formatMoney(summary.amountPaise)}</td>${type !== "daily" ? `<td data-label="Paid">${calc().formatMoney(summary.paidPaise)}</td><td data-label="Balance">${calc().formatMoney(summary.balancePaise)}</td>` : ""}${type === "grain" ? `<td data-label="Weighted average rate">${calc().formatMoney(averageRate)}</td>` : ""}</tr>`;
      }).join("");
    }
    const reportTotal = calc().summarizePurchases(records, data.payments);
    const grandTotalRow = type === "daily" && reportRows
      ? `<tr class="grand-total"><td data-label="Date">Grand total</td><td data-label="Purchases">${reportTotal.count}</td><td data-label="Payable weight">${calc().formatWeightKg(reportTotal.weightG)}</td><td data-label="Nikarams">${formatNikaramsTotal(records)}</td><td data-label="Total amount">${calc().formatMoney(reportTotal.amountPaise)}</td></tr>`
      : "";
    const title = { daily: "Daily summary", grain: "Grain-wise summary", farmer: "Farmer-wise statement", pending: "Pending payments" }[type] || "Daily summary";
    app.innerHTML = `${pageHeading("ANALYSIS", "Reports", "Review procurement performance and balances.", `<button class="button button-outline" data-action="print-report">Print report</button>`)}
      <section class="panel filter-panel report-filters"><label class="compact-field">Report<select id="report-type"><option value="daily" ${type === "daily" ? "selected" : ""}>Daily summary</option><option value="grain" ${type === "grain" ? "selected" : ""}>Grain-wise summary</option><option value="farmer" ${type === "farmer" ? "selected" : ""}>Farmer-wise statement</option><option value="pending" ${type === "pending" ? "selected" : ""}>Pending payments</option></select></label><label class="compact-field">Date range<select id="report-range"><option value="all" ${range === "all" ? "selected" : ""}>All dates</option><option value="today" ${range === "today" ? "selected" : ""}>Today</option><option value="yesterday" ${range === "yesterday" ? "selected" : ""}>Yesterday</option><option value="week" ${range === "week" ? "selected" : ""}>This week</option><option value="month" ${range === "month" ? "selected" : ""}>This month</option><option value="custom" ${range === "custom" ? "selected" : ""}>Custom</option></select></label><label class="compact-field">From<input id="report-from" type="date" value="${escapeHTML(from)}"></label><label class="compact-field">To<input id="report-to" type="date" value="${escapeHTML(to)}"></label></section>
      <section class="panel report-output"><div class="panel-heading"><div><h2>${title}</h2><p>${records.length} active purchase${records.length === 1 ? "" : "s"} in this date range</p></div></div>
        ${reportRows ? `<div class="table-wrap"><table><thead><tr>${type === "pending" ? "<th>RECEIPT</th><th>DATE</th><th>FARMER</th><th>TOTAL</th><th>PAID</th><th>BALANCE</th>" : `<th>${type === "daily" ? "DATE" : type === "grain" ? "GRAIN" : "FARMER"}</th><th>PURCHASES</th><th>PAYABLE WEIGHT</th><th>NIKARAMS</th><th>TOTAL AMOUNT</th>${type !== "daily" ? "<th>PAID</th><th>BALANCE</th>" : ""}${type === "grain" ? "<th>WEIGHTED AVG. RATE / NIKARAM</th>" : ""}`}</tr></thead><tbody>${reportRows}${grandTotalRow}</tbody></table></div>` : emptyBlock("No records in this range", "Choose another date range.")}</section>`;
    ["report-type", "report-from", "report-to", "report-range"].forEach((id) => app.querySelector(`#${id}`).addEventListener("change", () => {
      const next = new URLSearchParams();
      next.set("type", app.querySelector("#report-type").value);
      if (id === "report-from" || id === "report-to") app.querySelector("#report-range").value = "custom";
      const selectedRange = app.querySelector("#report-range").value;
      next.set("range", selectedRange);
      if (selectedRange !== "custom") {
        const preset = datePreset(selectedRange);
        if (preset.from) next.set("from", preset.from);
        if (preset.to) next.set("to", preset.to);
      } else {
        if (app.querySelector("#report-from").value) next.set("from", app.querySelector("#report-from").value);
        if (app.querySelector("#report-to").value) next.set("to", app.querySelector("#report-to").value);
      }
      location.hash = `#/reports?${next.toString()}`;
    }));
  }

  function renderSettings() {
    const s = data.settings;
    syncStateUnsubscribe?.();
    const decimalOptions = (selected, maximum) => Array.from({ length: maximum + 1 }, (_, places) => `<option value="${places}" ${Number(selected) === places ? "selected" : ""}>${places} ${places === 1 ? "decimal place" : "decimal places"}</option>`).join("");
    app.innerHTML = `${pageHeading("PREFERENCES", "Settings", "")}
      <form class="panel settings-form" id="settings-form">
        <section class="settings-section"><h2>Shop & receipts</h2><div class="form-grid">
          ${formField("Shop name *", `<input name="shopName" required minlength="2" maxlength="80" value="${escapeHTML(s.shopName)}">`)}
          ${formField("Phone", `<input name="shopPhone" inputmode="numeric" maxlength="10" value="${escapeHTML(s.shopPhone)}" placeholder="10-digit number">`)}
          ${formField("Address", `<textarea name="shopAddress" rows="2" maxlength="160">${escapeHTML(s.shopAddress)}</textarea>`)}
          ${formField("Receipt prefix", `<input name="receiptPrefix" required pattern="[A-Za-z0-9]{1,6}" maxlength="6" value="${escapeHTML(s.receiptPrefix)}">`)}
          ${formField("Next receipt number", `<input name="nextReceiptNumber" required type="number" min="1" step="1" value="${s.nextReceiptNumber}">`)}
          ${formField("Receipt paper", `<select name="receiptPaper">${["58mm", "80mm", "A5", "A4"].map((size) => `<option value="${size}" ${s.receiptPaper === size ? "selected" : ""}>${size === "58mm" ? "58 mm thermal" : size === "80mm" ? "80 mm thermal" : size}</option>`).join("")}</select>`)}
        </div></section>
        <section class="settings-section"><h2>Purchase defaults</h2><div class="form-grid">
          ${formField("Default payment mode", `<select name="defaultPaymentMode"><option value="" ${!s.defaultPaymentMode ? "selected" : ""}>None</option><option value="CASH" ${s.defaultPaymentMode === "CASH" ? "selected" : ""}>Cash</option><option value="UPI" ${s.defaultPaymentMode === "UPI" ? "selected" : ""}>UPI</option><option value="BANK" ${s.defaultPaymentMode === "BANK" ? "selected" : ""}>Bank</option></select>`)}
          ${formField("Payment section", `<select name="paymentEntryOpen"><option value="false" ${!s.paymentEntryOpen ? "selected" : ""}>Collapsed</option><option value="true" ${s.paymentEntryOpen ? "selected" : ""}>Open</option></select>`)}
        </div></section>
        <section class="settings-section"><h2>Bag size defaults (KG)</h2><div class="form-grid">
          ${calc().GRAIN_TYPES.map((grainName) => formField(`${grainName} — default bag size *`, `<input name="bagSize-${grainName.toLowerCase()}" type="number" inputmode="decimal" min="1.001" max="100000" step="0.001" required value="${(s.bagSizesG[grainName] / 1000).toFixed(3)}">`)).join("")}
        </div></section>
        <section class="settings-section"><h2>Nikaram weights (KG)</h2><div class="form-grid">
          ${calc().GRAIN_TYPES.map((grainName) => formField(`${grainName} — KG per Nikaram *`, `<input name="nikaramWeight-${grainName.toLowerCase()}" type="number" inputmode="decimal" min="0.001" max="100000" step="0.001" required value="${(s.nikaramWeightsG[grainName] / 1000).toFixed(3)}">`)).join("")}
        </div></section>
        <section class="settings-section"><h2>Calculation</h2><div class="form-grid">
          ${formField("Weight decimal places", `<select name="weightDecimalPlaces">${decimalOptions(s.weightDecimalPlaces, 3)}</select>`)}
          ${formField("Total rounding", `<select name="roundingMode"><option value="half-up" ${s.roundingMode === "half-up" ? "selected" : ""}>Half up</option><option value="down" ${s.roundingMode === "down" ? "selected" : ""}>Down</option></select>`, "Applies to new purchases only.")}
        </div></section>
        <div class="form-actions"><button class="button button-primary" type="submit">Save settings</button></div></form>
      <section class="panel cloud-sync-panel" id="cloud-sync-settings">
        <div class="panel-heading"><div><h2>Cloud sync</h2><p>Keep this device's records available on your other signed-in devices.</p></div></div>
        <p class="sync-status" id="sync-status" role="status" aria-live="polite"></p>
        ${window.GrainSync.configured ? `
          <div id="cloud-auth-form-wrap"><form class="cloud-auth-form" id="cloud-auth-form">
            ${formField("Email", `<input name="email" type="email" autocomplete="email" required>`)}
            ${formField("Password", `<input name="password" type="password" minlength="6" autocomplete="current-password" required>`)}
            <div class="cloud-auth-actions"><button class="button button-primary" type="submit" name="authAction" value="sign-in">Sign in</button><button class="button button-outline" type="submit" name="authAction" value="sign-up">Create account</button></div>
          </form></div>
          <div id="cloud-account" hidden><div class="cloud-account-email" id="cloud-account-email"></div><div class="cloud-auth-actions"><button class="button button-outline" id="sync-now" type="button">Sync now</button><button class="button button-outline" id="cloud-sign-out" type="button">Sign out</button></div></div>
        ` : `<p class="sync-setup-note">To enable cloud sync, add your Supabase project URL and publishable key to <code>.env</code>, then restart the app. Setup instructions are in <code>SUPABASE_SETUP.md</code>.</p>`}
      </section>
      <section class="panel danger-panel"><div><h2>Erase all data</h2><p>This permanently removes records stored in this browser.</p></div><button class="button button-danger" data-action="erase-data">Erase all data</button></section>`;
    syncStateUnsubscribe = window.GrainSync.onChange((state) => {
      const status = app.querySelector("#sync-status");
      if (!status) return;
      status.classList.toggle("is-error", Boolean(state.error));
      status.textContent = state.error
        ? `Sync issue: ${state.error}`
        : !state.configured
          ? "Local-only mode. Supabase is not configured."
          : state.syncing
            ? "Syncing local changes…"
            : state.user
              ? state.lastSyncedAt
                ? `Synced ${fmtDate(state.lastSyncedAt, true)}`
                : "Signed in. First sync is pending."
              : "Sign in to sync this device with your cloud data.";
      app.querySelector("#cloud-auth-form-wrap")?.toggleAttribute("hidden", Boolean(state.user));
      app.querySelector("#cloud-account")?.toggleAttribute("hidden", !state.user);
      const email = app.querySelector("#cloud-account-email");
      if (email) email.textContent = state.user?.email || "";
    });
    app.querySelector("#cloud-auth-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const submitButtons = [...form.querySelectorAll('button[type="submit"]')];
      submitButtons.forEach((button) => { button.disabled = true; });
      const fields = new FormData(form);
      try {
        const email = String(fields.get("email")).trim();
        const password = String(fields.get("password"));
        if (event.submitter?.value === "sign-up") {
          toastMessage(await window.GrainSync.signUp(email, password));
          refresh();
        } else {
          await window.GrainSync.signIn(email, password);
          toastMessage("Signed in and synced.");
          refresh();
        }
      } catch (error) {
        toastMessage(error.message || "Could not connect to Supabase.", true);
      } finally {
        submitButtons.forEach((button) => { button.disabled = false; });
      }
    });
    app.querySelector("#sync-now")?.addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      try {
        await window.GrainSync.syncNow();
        toastMessage("Cloud sync complete.");
        refresh();
      } catch (error) {
        toastMessage(error.message || "Could not sync with Supabase.", true);
      } finally {
        event.currentTarget.disabled = false;
      }
    });
    app.querySelector("#cloud-sign-out")?.addEventListener("click", async () => {
      try {
        await window.GrainSync.signOut();
        toastMessage("Signed out. Local data remains on this device.");
      } catch (error) { toastMessage(error.message || "Could not sign out.", true); }
    });
    app.querySelector("#settings-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const fields = new FormData(form);
      try {
        const prefix = String(fields.get("receiptPrefix")).trim().toUpperCase();
        const nextNumber = Number(fields.get("nextReceiptNumber"));
        const weightDecimalPlaces = Number(fields.get("weightDecimalPlaces"));
        const defaultPaymentMode = String(fields.get("defaultPaymentMode"));
        const paymentEntryOpen = fields.get("paymentEntryOpen") === "true";
        const roundingMode = String(fields.get("roundingMode"));
        if (!/^[A-Z0-9]{1,6}$/.test(prefix)) throw new Error("Receipt prefix must contain 1 to 6 letters or digits.");
        if (!Number.isSafeInteger(nextNumber) || nextNumber < 1) throw new Error("Next receipt number must be a positive whole number.");
        if (!Number.isInteger(weightDecimalPlaces) || weightDecimalPlaces < 0 || weightDecimalPlaces > 3) throw new Error("Weight precision must be between 0 and 3 decimal places.");
        if (!["", "CASH", "UPI", "BANK"].includes(defaultPaymentMode)) throw new Error("Select a supported default payment mode.");
        if (!["half-up", "down"].includes(roundingMode)) throw new Error("Select a supported rounding method.");
        const usedNumbers = data.purchases.filter((purchase) => purchase.receiptNumber.startsWith(`${prefix}-`)).map((purchase) => Number(purchase.receiptNumber.slice(prefix.length + 1))).filter(Number.isFinite);
        if (usedNumbers.length && nextNumber <= Math.max(...usedNumbers)) throw new Error("Next receipt number must be greater than every number already used with this prefix.");
        const phone = validate().mobile(fields.get("shopPhone"));
        const nikaramWeightsG = Object.fromEntries(calc().GRAIN_TYPES.map((grainName) => {
          const value = calc().parseWeightKg(fields.get(`nikaramWeight-${grainName.toLowerCase()}`), 3);
          return [grainName, value];
        }));
        const bagSizesG = Object.fromEntries(calc().GRAIN_TYPES.map((grainName) => {
          const value = calc().parseWeightKg(fields.get(`bagSize-${grainName.toLowerCase()}`), 3);
          if (value <= 1000) throw new Error(`${grainName} bag size must be greater than the 1 kg bag tare.`);
          return [grainName, value];
        }));
        window.GrainStorage.saveSettings({
          shopName: validate().text(fields.get("shopName"), "Shop name", 2, 80),
          shopAddress: validate().text(fields.get("shopAddress"), "Address", 0, 160, false),
          shopPhone: phone,
          receiptPrefix: prefix,
          nextReceiptNumber: nextNumber,
          receiptPaper: String(fields.get("receiptPaper")),
          weightDecimalPlaces,
          defaultPaymentMode,
          paymentEntryOpen,
          roundingMode,
          nikaramWeightsG,
          bagSizesG
        });
        toastMessage("Settings saved.");
        refresh();
      } catch (error) { toastMessage(error.message, true); }
    });
  }

  function render() {
    currentRoute = routeFromHash();
    const names = { dashboard: "Dashboard", purchase: "New purchase", "purchase-detail": "Purchase detail", purchases: "Purchase history", farmers: "Farmers", "farmers-detail": "Farmer statement", grains: "Grains", reports: "Reports", settings: "Settings" };
    document.querySelector("#route-title").textContent = names[currentRoute.name] || "Dashboard";
    document.querySelectorAll("[data-route]").forEach((link) => {
      const selected = link.dataset.route === currentRoute.name || (currentRoute.name === "purchase-detail" && link.dataset.route === "purchases") || (currentRoute.name === "farmers-detail" && link.dataset.route === "farmers");
      link.classList.toggle("is-active", selected);
      if (selected) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    });
    const moreRoutes = ["farmers", "farmers-detail", "grains", "reports", "settings"];
    const moreActive = moreRoutes.includes(currentRoute.name);
    document.querySelector("#more-button").classList.toggle("is-active", moreActive);
    if (moreActive) document.querySelector("#more-button").setAttribute("aria-current", "page");
    else document.querySelector("#more-button").removeAttribute("aria-current");
    document.querySelector("#more-menu").hidden = true;
    document.querySelector("#more-button").setAttribute("aria-expanded", "false");
    switch (currentRoute.name) {
      case "purchase": renderPurchase(); break;
      case "purchases": renderHistory(); break;
      case "purchase-detail": renderPurchaseDetail(currentRoute.id); break;
      case "farmers": renderFarmers(); break;
      case "farmers-detail": renderFarmerDetail(currentRoute.id); break;
      case "grains": renderGrains(); break;
      case "reports": renderReports(); break;
      case "settings": renderSettings(); break;
      default: renderDashboard();
    }
  }

  function openDialog(title, body, submitText = "Save") {
    dialogRoot.innerHTML = `<dialog class="app-dialog"><form method="dialog" class="dialog-form"><div class="dialog-heading"><div><p class="eyebrow">GRAINWISE</p><h2>${escapeHTML(title)}</h2></div><button class="icon-button" value="cancel" aria-label="Close dialog">×</button></div>${body}<div class="dialog-actions"><button class="button button-outline" value="cancel">Cancel</button><button class="button button-primary" value="default">${escapeHTML(submitText)}</button></div></form></dialog>`;
    const dialog = dialogRoot.querySelector("dialog");
    dialog.showModal();
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    return dialog;
  }
  function farmerDialog(id = "") {
    const farmer = data.farmers.find((item) => item.farmerId === id);
    if (!farmer) return;
    const dialog = openDialog("Edit farmer", `<div class="form-grid dialog-fields">${formField("Farmer name *", `<input name="name" required minlength="2" maxlength="60" value="${escapeHTML(farmer.farmerName)}" autofocus>`)}${formField("Village", `<input name="village" maxlength="60" value="${escapeHTML(farmer.village || "")}">`)}${formField("Mobile", `<input name="mobile" inputmode="numeric" maxlength="10" value="${escapeHTML(farmer.mobileNumber || "")}">`)}</div>`);
    dialog.querySelector("form").addEventListener("submit", (event) => {
      if (event.submitter?.value !== "default") return;
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      try {
        const name = validate().farmerName(fields.get("name"));
        const place = validate().village(fields.get("village"));
        const mobile = validate().mobile(fields.get("mobile"));
        if (data.farmers.some((item) => item.farmerId !== id && item.farmerName.toLowerCase() === name.toLowerCase() && (item.village || "").toLowerCase() === place.toLowerCase()) && !window.confirm("A farmer with this name and village already exists. Save anyway?")) return;
        const record = { ...farmer, farmerName: name, village: place, mobileNumber: mobile, updatedAt: window.GrainStorage.timestamp() };
        window.GrainStorage.save("farmers", (fresh) => fresh.map((item) => item.farmerId === id ? record : item));
        dialog.close(); refresh(); toastMessage("Farmer updated.");
      } catch (error) { toastMessage(error.message, true); }
    });
    dialog.querySelector('input[name="name"]').focus();
  }
  function grainDialog(id = "") {
    const grain = data.grains.find((item) => item.grainId === id);
    if (!grain || !calc().GRAIN_TYPES.includes(grain.grainName)) return;
    const dialog = openDialog(`Default rate · ${grain.grainName}`, formField("Rate per Nikaram (₹)", `<input name="rate" inputmode="decimal" value="${grain.defaultRatePaise ? calc().formatRupeesInput(grain.defaultRatePaise) : ""}">`));
    dialog.querySelector("form").addEventListener("submit", (event) => {
      if (event.submitter?.value !== "default") return;
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      try {
        const rateText = String(fields.get("rate") || "").trim();
        const defaultRatePaise = rateText ? calc().parseRateRupees(rateText) : 0;
        const record = { ...grain, defaultRatePaise, rateBasisWeightG: data.settings.nikaramWeightsG[grain.grainName], isActive: true, updatedAt: window.GrainStorage.timestamp() };
        window.GrainStorage.save("grains", (fresh) => fresh.map((item) => item.grainId === id ? record : item));
        dialog.close(); refresh(); toastMessage("Grain rate updated.");
      } catch (error) { toastMessage(error.message, true); }
    });
    dialog.querySelector('input[name="rate"]').focus();
  }

  function action(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const id = target.dataset.id;
    switch (target.dataset.action) {
      case "edit-farmer": farmerDialog(id); break;
      case "edit-grain": grainDialog(id); break;
      case "toggle-farmer": {
        const name = "farmers";
        const key = name === "farmers" ? "farmerId" : "grainId";
        const record = data[name].find((item) => item[key] === id);
        if (record && window.confirm(`${record.isActive ? "Deactivate" : "Reactivate"} ${name === "farmers" ? record.farmerName : record.grainName}?`)) {
          runSave(() => window.GrainStorage.save(name, (fresh) => fresh.map((item) => item[key] === id ? { ...item, isActive: !item.isActive, updatedAt: window.GrainStorage.timestamp() } : item)), "Farmer status updated.");
        }
        break;
      }
      case "print": {
        const purchase = data.purchases.find((item) => item.purchaseId === id);
        if (purchase) {
          window.GrainReceipt.print(purchase, data.payments.filter((item) => item.purchaseId === id), data.settings)
            .catch((error) => toastMessage(error.message || "Could not print receipt.", true));
        }
        break;
      }
      case "add-payment": paymentDialog(id); break;
      case "delete-payment": {
        const payment = data.payments.find((item) => item.paymentId === id);
        if (payment && window.confirm(`Delete this ${calc().formatMoney(payment.paidPaise)} payment?`)) {
          runSave(() => window.GrainStorage.save("payments", (fresh) => fresh.filter((item) => item.paymentId !== id)), "Payment deleted.");
        }
        break;
      }
      case "void-purchase": voidPurchase(id); break;
      case "edit-remarks": remarksDialog(id); break;
      case "toggle-history-filters": historyFiltersOpen = !historyFiltersOpen; renderHistory(); break;
      case "clear-history": historySearch = ""; historyPreset = "all"; historyFilters = { status: "ACTIVE", payment: "all", farmer: "all", grain: "all", from: "", to: "" }; historyFiltersOpen = false; historyPage = 0; renderHistory(); break;
      case "previous-page": historyPage = Math.max(0, historyPage - 1); renderHistory(); break;
      case "next-page": historyPage++; renderHistory(); break;
      case "erase-data": eraseData(); break;
      case "load-demo": loadDemo(); break;
      case "pay-full": break;
      case "print-report": printReport().catch((error) => toastMessage(error.message || "Could not print report.", true)); break;
      case "print-farmer": printFarmerStatement(id).catch((error) => toastMessage(error.message || "Could not print farmer statement.", true)); break;
    }
  }
  function paymentDialog(id) {
    const purchase = data.purchases.find((item) => item.purchaseId === id);
    if (!purchase || purchase.status === "VOID") return;
    const due = balance(purchase);
    const dialog = openDialog("Add payment", `<p class="dialog-help">Balance due: <strong>${calc().formatMoney(due)}</strong></p><div class="form-grid dialog-fields">${formField("Amount (₹) *", `<input name="amount" inputmode="decimal" required placeholder="e.g. 5000.00">`)}${formField("Payment mode *", `<select name="mode" required><option value="">Select mode</option><option value="CASH">Cash</option><option value="UPI">UPI</option><option value="BANK">Bank</option></select>`)}${formField("Payment date *", `<input name="date" type="datetime-local" value="${localDateTimeValue()}" required max="${localDateTimeValue()}">`)}${formField("Reference", `<input name="reference" maxlength="40" placeholder="Optional">`)}</div>`);
    dialog.querySelector("form").addEventListener("submit", (event) => {
      if (event.submitter?.value !== "default") return;
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      try {
        const paidPaise = calc().parseMoneyRupees(values.get("amount"));
        if (paidPaise <= 0 || paidPaise > due) throw new Error(`Payment cannot exceed the balance of ${calc().formatMoney(due)}`);
        const paymentDate = validate().dateNotFuture(values.get("date"));
        const item = { paymentId: window.GrainStorage.uuid(), purchaseId: id, paidPaise, paymentMode: String(values.get("mode")), reference: validate().text(values.get("reference"), "Reference", 0, 40, false), paymentDate, createdAt: window.GrainStorage.timestamp() };
        window.GrainStorage.save("payments", (fresh) => [item, ...fresh]);
        dialog.close(); refresh(); toastMessage("Payment recorded.");
      } catch (error) { toastMessage(error.message, true); }
    });
  }
  function remarksDialog(id) {
    const purchase = data.purchases.find((item) => item.purchaseId === id);
    if (!purchase || purchase.status === "VOID") return;
    const dialog = openDialog("Edit remarks", formField("Remarks", `<textarea name="remarks" rows="4" maxlength="200">${escapeHTML(purchase.remarks)}</textarea>`));
    dialog.querySelector("form").addEventListener("submit", (event) => {
      if (event.submitter?.value !== "default") return;
      event.preventDefault();
      try {
        const remarks = validate().remarks(new FormData(event.currentTarget).get("remarks"));
        window.GrainStorage.save("purchases", (fresh) => fresh.map((item) => item.purchaseId === id ? { ...item, remarks, updatedAt: window.GrainStorage.timestamp() } : item));
        dialog.close(); refresh(); toastMessage("Remarks updated.");
      } catch (error) { toastMessage(error.message, true); }
    });
  }
  function voidPurchase(id) {
    const purchase = data.purchases.find((item) => item.purchaseId === id);
    if (!purchase || purchase.status === "VOID") return;
    if (data.payments.some((payment) => payment.purchaseId === id)) { toastMessage("Delete this purchase's payments before voiding it.", true); return; }
    const dialog = openDialog("Void purchase", `<p class="dialog-help">Receipt ${escapeHTML(purchase.receiptNumber)} will remain in history but be excluded from totals. This cannot be undone.</p>${formField("Reason (at least 3 characters) *", `<textarea name="reason" required minlength="3" maxlength="200"></textarea>`)}`, "Void purchase");
    dialog.querySelector("form").addEventListener("submit", (event) => {
      if (event.submitter?.value !== "default") return;
      event.preventDefault();
      const reason = String(new FormData(event.currentTarget).get("reason") || "").trim();
      if (reason.length < 3) { toastMessage("Enter a reason of at least 3 characters.", true); return; }
      if (!window.confirm(`Confirm voiding ${purchase.receiptNumber}?`)) return;
      try {
        window.GrainStorage.save("purchases", (fresh) => fresh.map((item) => item.purchaseId === id ? { ...item, status: "VOID", voidReason: reason, voidedAt: window.GrainStorage.timestamp() } : item));
        dialog.close(); refresh(); toastMessage("Purchase voided.");
      } catch (error) { toastMessage(error.message, true); }
    });
  }
  function eraseData() {
    if (!window.confirm("This will delete all farmers, grains, purchases, payments, and settings from this browser.")) return;
    if (window.prompt('Type ERASE to confirm. This cannot be undone.') !== "ERASE") return;
    try { window.GrainStorage.reset(); data = window.GrainStorage.getData(); location.hash = "#/settings"; toastMessage("All data erased."); render(); }
    catch (error) { toastMessage(error.message, true); }
  }
  function loadDemo() {
    if (data.purchases.length || data.farmers.length) {
      toastMessage("Sample data can only be loaded into an empty workspace.", true);
      return;
    }
    if (!window.confirm("Load illustrative sample farmers and purchases?")) return;
    try {
      const demo = window.GRAINWISE_SAMPLE_PURCHASES || [];
      const farmerRecords = new Map();
      const grainRecords = new Map();
      const farmerList = [];
      const grainList = calc().GRAIN_TYPES.map((grainName) => {
        const grainId = window.GrainStorage.uuid();
        grainRecords.set(grainName, grainId);
        const sample = demo.find((item) => item.grain === grainName);
        return { grainId, grainName, defaultRatePaise: sample ? calc().parseRateRupees(String(sample.price)) : 0, rateBasisWeightG: data.settings.nikaramWeightsG[grainName], isActive: true, createdAt: window.GrainStorage.timestamp(), updatedAt: window.GrainStorage.timestamp() };
      });
      const purchaseList = [];
      const paymentList = [];
      demo.forEach((sample, index) => {
        if (!farmerRecords.has(sample.farmer)) {
          const farmerId = window.GrainStorage.uuid();
          farmerRecords.set(sample.farmer, farmerId);
          farmerList.push({ farmerId, farmerName: sample.farmer, village: sample.village.split(",")[0], mobileNumber: "", isActive: true, createdAt: window.GrainStorage.timestamp(), updatedAt: window.GrainStorage.timestamp() });
        }
        const purchaseId = window.GrainStorage.uuid();
        const nikaramWeightG = data.settings.nikaramWeightsG[sample.grain];
        const bagSizeG = data.settings.bagSizesG[sample.grain];
        const fullBags = calc().parseFullBags(String(sample.fullBags));
        const remainingWeightG = calc().parseWeightKg(String(sample.remainingKg), 3, true);
        const payableWeightG = calc().computePayableWeightG(fullBags, bagSizeG, remainingWeightG);
        const bagCount = fullBags + (remainingWeightG > 0 ? Math.ceil(remainingWeightG / bagSizeG) : 0);
        const ratePaise = calc().parseRateRupees(String(sample.price));
        const totalPaise = calc().computeTotalPaise(payableWeightG, ratePaise, "half-up", nikaramWeightG);
        const purchaseDate = new Date(`${sample.date}T10:00:00`).toISOString();
        purchaseList.push({ purchaseId, receiptNumber: `GP-${String(index + 1).padStart(6, "0")}`, purchaseDate, farmerId: farmerRecords.get(sample.farmer), farmerName: sample.farmer, farmerVillage: sample.village.split(",")[0], farmerMobile: "", grainId: grainRecords.get(sample.grain), grainName: sample.grain, fullBags, bagSizeG, remainingWeightG, bagTareG: 1000, bagCount, payableWeightG, nikaramWeightG, nikaramsScaled: calc().computeTotalNikaramsScaled(payableWeightG, nikaramWeightG), ratePaise, rateBasisWeightG: nikaramWeightG, totalPaise, roundingMode: "half-up", remarks: "Sample record", shopName: "Grainwise Demo Shop", shopAddress: "Sample data", shopPhone: "", status: "ACTIVE", createdAt: purchaseDate });
        if (sample.status === "Paid") paymentList.push({ paymentId: window.GrainStorage.uuid(), purchaseId, paidPaise: totalPaise, paymentMode: "BANK", reference: "Sample", paymentDate: purchaseDate, createdAt: purchaseDate });
        if (sample.status === "Processing") paymentList.push({ paymentId: window.GrainStorage.uuid(), purchaseId, paidPaise: calc().halfAmountPaise(totalPaise), paymentMode: "UPI", reference: "Sample", paymentDate: purchaseDate, createdAt: purchaseDate });
      });
      window.GrainStorage.replaceAll({ farmers: farmerList, grains: grainList, purchases: purchaseList, payments: paymentList, settings: { ...data.settings, shopName: data.settings.shopName || "Grainwise Demo Shop", shopAddress: data.settings.shopAddress || "Sample data", receiptPrefix: data.settings.receiptPrefix || "GP", nextReceiptNumber: purchaseList.length + 1, receiptPaper: data.settings.receiptPaper || "80mm" } });
      refresh(); toastMessage("Sample records loaded.");
    } catch (error) { toastMessage(error.message, true); }
  }
  async function printReport() {
    if (window.GrainNativePrint.isNative()) {
      const report = app.querySelector(".report-output");
      const markup = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Grainwise report</title><link rel="stylesheet" href="${window.GrainNativePrint.appStylesheetHref()}"><link rel="stylesheet" href="${window.GrainNativePrint.stylesheetHref()}"></head><body class="report-printing"><div class="app-shell"><main class="main-content"><div id="app"><section class="panel report-output">${report.innerHTML}</section></div></main></div></body></html>`;
      await window.GrainNativePrint.print(markup, "Grainwise report", "A4");
      return;
    }
    const cleanup = () => document.body.classList.remove("report-printing");
    document.body.classList.add("report-printing");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  }
  async function printFarmerStatement(id) {
    const profile = data.farmers.find((item) => item.farmerId === id);
    const farmerName = profile?.farmerName || (id.startsWith("name:") ? id.slice(5) : "");
    if (!farmerName) return;
    const records = data.purchases.filter((purchase) => (purchase.farmerId === id || purchase.farmerName.toLocaleLowerCase() === farmerName.toLocaleLowerCase()) && purchase.status === "ACTIVE");
    const rows = records.map((purchase) => `<tr><td>${escapeHTML(purchase.receiptNumber)}</td><td>${escapeHTML(fmtDate(purchase.purchaseDate))}</td><td>${escapeHTML(purchase.grainName)}</td><td>${escapeHTML(calc().formatWeightKg(purchase.payableWeightG))}</td><td>${escapeHTML(formatPurchaseNikarams(purchase))}</td><td>${escapeHTML(calc().formatMoney(purchase.totalPaise))}</td><td>${escapeHTML(calc().formatMoney(amountPaid(purchase.purchaseId)))}</td><td>${escapeHTML(calc().formatMoney(balance(purchase)))}</td></tr>`).join("");
    const markup = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Farmer statement</title><link rel="stylesheet" href="${window.GrainNativePrint.stylesheetHref()}"></head><body><main class="receipt"><header class="receipt-header"><h1>${escapeHTML(data.settings.shopName || "Grainwise")}</h1><p>Farmer statement</p></header><h2>${escapeHTML(farmerName)}</h2><p>${escapeHTML(profile?.village || "")} ${profile?.mobileNumber ? `· ${escapeHTML(profile.mobileNumber)}` : ""}</p><table><thead><tr><th>Receipt</th><th>Date</th><th>Grain</th><th>Payable weight</th><th>Nikarams</th><th>Total</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${rows}</tbody></table><footer>Printed ${escapeHTML(fmtDate(new Date(), true))}</footer></main></body></html>`;
    if (await window.GrainNativePrint.print(markup, `Farmer statement · ${farmerName}`, "A4")) return;
    const popup = window.open("", "_blank");
    if (!popup) { toastMessage("Allow pop-ups to print this statement.", true); return; }
    popup.document.open();
    popup.document.write(markup);
    popup.document.close();
    popup.focus();
    popup.addEventListener("load", () => popup.print(), { once: true });
  }

  document.addEventListener("click", (event) => {
    const navigationLink = event.target.closest('a[href^="#/"]');
    if (purchaseFormDirty && currentRoute.name === "purchase" && navigationLink
      && !window.confirm("You have unsaved purchase details. Leave this page?")) {
      event.preventDefault();
      return;
    }
    if (navigationLink && purchaseFormDirty && currentRoute.name === "purchase") purchaseFormDirty = false;
    const routeLink = event.target.closest("[data-href]");
    if (routeLink) location.hash = routeLink.dataset.href;
    const rowLink = event.target.closest("tr[data-href]");
    if (rowLink && !event.target.closest("a, button")) location.hash = rowLink.dataset.href;
    action(event);
    if (event.target.closest("#more-button")) {
      const menu = document.querySelector("#more-menu");
      const open = menu.hidden;
      menu.hidden = !open;
      document.querySelector("#more-button").setAttribute("aria-expanded", String(open));
    } else if (!event.target.closest("#more-menu")) {
      document.querySelector("#more-menu").hidden = true;
      document.querySelector("#more-button").setAttribute("aria-expanded", "false");
    }
  });
  window.addEventListener("hashchange", () => { refresh(); window.scrollTo(0, 0); });
  window.addEventListener("storage", (event) => {
    if (Object.values(window.GrainStorage.KEYS).includes(event.key)) refresh();
  });
  window.addEventListener("grain-data-synced", () => {
    if (currentRoute.name === "purchase" && purchaseFormDirty) {
      toastMessage("Cloud data synced. Your current purchase draft was left unchanged.");
      return;
    }
    refresh();
  });
  window.addEventListener("error", (event) => {
    if (event.error && !event.defaultPrevented) toastMessage(`Something went wrong: ${event.message}`, true);
  });

  try {
    data = window.GrainStorage.initialize();
    render();
  } catch (error) {
    renderFatal(error);
  }
})();
