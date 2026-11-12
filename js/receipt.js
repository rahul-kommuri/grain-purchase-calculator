(() => {
  "use strict";
  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }
  async function print(purchase, payments, settings) {
    const paid = window.GrainCalc.paidSoFar(payments, purchase.purchaseId);
    const balance = window.GrainCalc.calculateBalance(purchase.totalPaise, paid);
    const nikaramWeightG = purchase.nikaramWeightG || 100000;
    const paper = ["58mm", "80mm", "A4", "A5"].includes(settings.receiptPaper) ? settings.receiptPaper : "A5";
    const paymentRows = payments.length
      ? payments.map((item) => `<div class="line"><span>${escapeHTML(new Date(item.paymentDate).toLocaleDateString("en-IN"))} · ${escapeHTML(item.paymentMode)}</span><strong>${window.GrainCalc.formatMoney(item.paidPaise)}</strong></div>`).join("")
      : "";
    const markup = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Receipt ${escapeHTML(purchase.receiptNumber)}</title><link rel="stylesheet" href="${window.GrainNativePrint.stylesheetHref()}"><style>@page{size:${paper === "58mm" || paper === "80mm" ? `${paper} auto` : paper};margin:${paper === "58mm" || paper === "80mm" ? "3mm" : "12mm"}}.receipt{width:${paper === "58mm" ? "52mm" : paper === "80mm" ? "74mm" : paper === "A5" ? "124mm" : "186mm"}}</style></head><body><main class="receipt ${purchase.status === "VOID" ? "is-void" : ""}">
      <header class="receipt-header"><h1>${escapeHTML(purchase.shopName)}</h1>${purchase.shopAddress ? `<p>${escapeHTML(purchase.shopAddress)}</p>` : ""}${purchase.shopPhone ? `<p>Phone: ${escapeHTML(purchase.shopPhone)}</p>` : ""}</header>
      ${purchase.status === "VOID" ? `<div class="void-mark">VOID</div>` : ""}
      <div class="receipt-title">PURCHASE RECEIPT</div>
      <div class="line"><span>Receipt</span><strong>${escapeHTML(purchase.receiptNumber)}</strong></div>
      <div class="line"><span>Date</span><strong>${escapeHTML(new Date(purchase.purchaseDate).toLocaleString("en-IN"))}</strong></div>
      <hr><h2>FARMER</h2><p><strong>${escapeHTML(purchase.farmerName)}</strong></p><p>${escapeHTML(purchase.farmerVillage || "—")}${purchase.farmerMobile ? ` · ${escapeHTML(purchase.farmerMobile)}` : ""}</p>
      <hr><h2>PURCHASE</h2><div class="line"><span>Grain</span><strong>${escapeHTML(purchase.grainName)}</strong></div>${purchase.fullBags === undefined ? "" : `<div class="line"><span>Full bags</span><strong>${purchase.fullBags}</strong></div>`}${purchase.bagSizeG === undefined ? "" : `<div class="line"><span>Bag size</span><strong>${window.GrainCalc.formatWeightKg(purchase.bagSizeG)}</strong></div>`}${purchase.bagCount === undefined ? "" : `<div class="line"><span>Total bags / tare</span><strong>${purchase.bagCount} / ${window.GrainCalc.formatWeightKg(purchase.bagTareG * purchase.bagCount)}</strong></div>`}${purchase.remainingWeightG === undefined ? "" : `<div class="line"><span>Remaining KGs</span><strong>${window.GrainCalc.formatWeightKg(purchase.remainingWeightG)}</strong></div>`}<div class="line"><span>Payable weight</span><strong>${window.GrainCalc.formatWeightKg(purchase.payableWeightG)}</strong></div><div class="line"><span>Nikarams</span><strong>${window.GrainCalc.formatNikarams(purchase.payableWeightG, nikaramWeightG)}</strong></div><div class="line"><span>Nikaram weight</span><strong>${window.GrainCalc.formatWeightKg(nikaramWeightG)}</strong></div><div class="line"><span>${purchase.rateBasisWeightG ? "Rate / Nikaram" : "Rate / 100 kg"}</span><strong>${window.GrainCalc.formatMoney(purchase.ratePaise)}</strong></div>
      <hr><div class="line total"><span>Total amount</span><strong>${window.GrainCalc.formatMoney(purchase.totalPaise)}</strong></div><p class="words">${window.GrainCalc.amountInWords(purchase.totalPaise)}</p>
      <hr><h2>PAYMENTS</h2>${paymentRows}<div class="line"><span>Total paid</span><strong>${window.GrainCalc.formatMoney(paid)}</strong></div><div class="line balance"><span>Balance due</span><strong>${window.GrainCalc.formatMoney(balance)}</strong></div>
      <div class="signature-row"><span>Buyer signature</span><span>Farmer signature</span></div><footer>Thank you.</footer><button class="print-button" onclick="window.print()">Print receipt</button></main></body></html>`;
    if (await window.GrainNativePrint.print(markup, `Receipt ${purchase.receiptNumber}`, paper)) return;
    const popup = window.open("", "_blank");
    if (!popup) throw new Error("Allow pop-ups to print this receipt.");
    popup.document.open();
    popup.document.write(markup);
    popup.document.close();
    popup.focus();
    popup.addEventListener("load", () => popup.print(), { once: true });
  }
  window.GrainReceipt = { print, escapeHTML };
})();
