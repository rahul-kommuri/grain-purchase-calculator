(() => {
  "use strict";
  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }
  function receiptDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return [String(date.getDate()).padStart(2, "0"), String(date.getMonth() + 1).padStart(2, "0"), date.getFullYear()].join("-");
  }
  function row(label, value, className = "") {
    return `<div class="receipt-row ${className}"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`;
  }
  async function print(purchase, payments, settings) {
    const paid = window.GrainCalc.paidSoFar(payments, purchase.purchaseId);
    const balance = window.GrainCalc.calculateBalance(purchase.totalPaise, paid);
    const nikaramWeightG = purchase.nikaramWeightG || 100000;
    const totalNikarams = window.GrainCalc.formatNikarams(purchase.payableWeightG, nikaramWeightG);
    const wholeNikarams = Math.floor(purchase.payableWeightG / nikaramWeightG);
    const remainingNikaramWeightG = purchase.payableWeightG % nikaramWeightG;
    const paper = ["58mm", "80mm", "A4", "A5"].includes(settings.receiptPaper) ? settings.receiptPaper : "A5";
    const paymentRows = payments.length
      ? payments.map((item) => row(`${receiptDate(item.paymentDate)} · ${item.paymentMode}`, window.GrainCalc.formatMoney(item.paidPaise), "receipt-payment-row")).join("")
      : "";
    const markup = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Receipt ${escapeHTML(purchase.receiptNumber)}</title><link rel="stylesheet" href="${window.GrainNativePrint.stylesheetHref()}"><style>@page{size:${paper === "58mm" || paper === "80mm" ? `${paper} auto` : paper};margin:${paper === "58mm" || paper === "80mm" ? "3mm" : "12mm"}}.receipt{width:${paper === "58mm" ? "52mm" : paper === "80mm" ? "74mm" : paper === "A5" ? "124mm" : "186mm"}}</style></head><body><main class="receipt paper-${paper.toLowerCase()} ${purchase.status === "VOID" ? "is-void" : ""}">
      <header class="receipt-header"><div class="receipt-heading">PURCHASE RECEIPT</div></header>
      ${purchase.status === "VOID" ? `<div class="void-mark">VOID</div>` : ""}
      <section class="receipt-section receipt-meta">${row("Receipt No", purchase.receiptNumber)}${row("Date", receiptDate(purchase.purchaseDate))}${row("Farmer Name", purchase.farmerName)}${purchase.farmerVillage ? row("Village", purchase.farmerVillage) : ""}${purchase.farmerMobile ? row("Mobile", purchase.farmerMobile) : ""}</section>
      <section class="receipt-section"><h2>PURCHASE DETAILS</h2>${row("Grain", purchase.grainName)}${purchase.fullBags === undefined ? "" : row(`${window.GrainCalc.formatWeightKg(purchase.bagSizeG || 0)} Bags`, `${purchase.fullBags} bags`)}${purchase.remainingWeightG === undefined ? "" : row("Over KGs", window.GrainCalc.formatWeightKg(purchase.remainingWeightG))}</section>
      <section class="receipt-section nikaram-section"><h2>NIKARAM DETAILS</h2>${row("Total Nikarams", totalNikarams, "receipt-primary-row")}${row("Whole Nikarams", String(wholeNikarams), "receipt-indent")}${row("Remaining KGs", window.GrainCalc.formatWeightKg(remainingNikaramWeightG), "receipt-indent")}${row(purchase.rateBasisWeightG ? "Rate / Nikaram" : "Rate / 100 kg", window.GrainCalc.formatMoney(purchase.ratePaise), "receipt-primary-row")}</section>
      <section class="receipt-total"><h2>TOTAL AMOUNT PAYABLE</h2><strong>${window.GrainCalc.formatMoney(purchase.totalPaise)}</strong><p>${escapeHTML(window.GrainCalc.amountInWords(purchase.totalPaise))}</p></section>
      ${(payments.length || balance > 0) ? `<section class="receipt-section payment-section"><h2>PAYMENT DETAILS</h2>${paymentRows}${row("Total paid", window.GrainCalc.formatMoney(paid))}${row("Balance due", window.GrainCalc.formatMoney(balance), "receipt-balance")}</section>` : ""}
      <footer><span>Computer generated receipt</span><strong>*** Thank You ***</strong></footer><button class="print-button" onclick="window.print()">Print receipt</button></main></body></html>`;
    if (window.GrainThermalPrinter?.isConfigured()) {
      await window.GrainThermalPrinter.printReceipt(purchase, payments, settings);
      return;
    }
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
