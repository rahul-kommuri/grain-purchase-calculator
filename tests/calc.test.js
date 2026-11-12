(() => {
  "use strict";
  const calc = window.GrainCalc;
  const failures = [];
  function check(condition, message) { if (!condition) failures.push(message); }
  function rejects(callback, message) {
    try { callback(); failures.push(message); }
    catch { /* Invalid input is expected. */ }
  }

  const weightG = calc.computePayableWeightG(10, 70000, 10000);
  check(weightG === 699000, "bag size, remaining kilograms, and bag tare did not produce the expected payable weight");
  check(calc.formatWeightKg(weightG) === "699 kg", "payable weight formatting was incorrect");
  check(calc.computeTotalNikaramsScaled(weightG, 76500) === 913725, "Nikarams did not use the configured unit weight");
  check(calc.formatNikarams(weightG, 76500) === "9.13725", "Nikarams display precision was incorrect");
  check(calc.computePayableWeightG(10, 70000, 0) === 690000, "full bags did not deduct one kilogram of tare per bag");
  check(calc.computePayableWeightG(1, 70000, 71000) === 138000, "multiple partial-weight bags did not each deduct tare");
  check(calc.parseWeightKg("1.234", 3) === 1234, "kilogram precision was not converted to grams");
  check(calc.parseWeightKg("0", 3, true) === 0, "zero remaining weight should be accepted");
  check(calc.parseFullBags("12") === 12, "whole bag count was not parsed");
  rejects(() => calc.parseFullBags("1.5"), "fractional full bags should be rejected");
  rejects(() => calc.parseFullBags("-1"), "negative full bags should be rejected");
  rejects(() => calc.parseWeightKg("-0.1", 3, true), "negative remaining weight should be rejected");
  rejects(() => calc.parseWeightKg("1.2345", 3, true), "remaining weight beyond configured precision should be rejected");
  rejects(() => calc.computePayableWeightG(0, 70000, 0), "zero total payable weight should be rejected");
  rejects(() => calc.computePayableWeightG(1, 1000, 0), "bag size at or below the tare should be rejected");
  check(window.GrainStorage.DEFAULTS.bagSizesG.Paddy === 70000 && window.GrainStorage.DEFAULTS.bagSizesG.Maize === 60000 && window.GrainStorage.DEFAULTS.bagSizesG.Jowar === 60000, "per-grain bag size defaults were incorrect");

  const halfRounding = calc.computeTotalPaise(38250, 101, "half-up", 76500);
  const downRounding = calc.computeTotalPaise(38250, 101, "down", 76500);
  check(halfRounding === 51 && downRounding === 50, "purchase totals did not respect configured rounding");
  const legacyTotal = calc.computeTotalPaise(500, 240100, "half-up", 100000);
  check(legacyTotal === 1201, "legacy 100 kg pricing basis no longer reproduces saved totals");

  const purchase = { purchaseId: "test-1", status: "ACTIVE", payableWeightG: 500, totalPaise: 1201 };
  const voidPurchase = { purchaseId: "test-2", status: "VOID", payableWeightG: 100000, totalPaise: 240000 };
  const payment = { purchaseId: "test-1", paidPaise: 500 };
  const summary = calc.summarizePurchases([purchase, voidPurchase], [payment]);
  check(summary.count === 1 && summary.weightG === 500 && summary.amountPaise === 1201 && summary.paidPaise === 500 && summary.balancePaise === 701, "purchase summary did not exclude void purchases or calculate balances");
  check(calc.paymentStatus(1201, 500) === "Partial", "partial payment status was not derived correctly");
  check(calc.amountInWords(3000000) === "Rupees Thirty Thousand Only", "Indian amount-in-words output did not match");

  document.querySelector("#results").textContent = failures.length
    ? `FAIL\n${failures.join("\n")}`
    : "PASS\nBag-size calculations, bag tare, validation, Nikaram conversion, configured rounding, historical totals, and payment summaries passed.";
  document.body.dataset.result = failures.length ? "fail" : "pass";
})();
