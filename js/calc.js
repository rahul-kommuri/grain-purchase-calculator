(() => {
  "use strict";
  const MAX_WEIGHT_G = 100000000;
  const MAX_RATE_PAISE = 10000000;
  const GRAIN_TYPES = ["Paddy", "Maize", "Jowar"];
  const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const DIGITS = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

  function decimalToInteger(value, places, label) {
    const text = String(value ?? "").trim();
    const match = text.match(/^(\d+)(?:\.(\d+))?$/);
    if (!match || (match[2] || "").length > places) throw new Error(`${label} must be a number with up to ${places} decimal places`);
    const scale = 10 ** places;
    return Number(match[1]) * scale + Number((match[2] || "").padEnd(places, "0"));
  }

  function parseWeightKg(value, decimalPlaces = 3, allowZero = false) {
    if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 3) throw new Error("Weight precision must be between 0 and 3 decimal places");
    const enteredWeight = decimalToInteger(value, decimalPlaces, "Weight");
    const grams = enteredWeight * 1000 / (10 ** decimalPlaces);
    if ((!allowZero && grams < 1) || (allowZero && grams < 0) || grams > MAX_WEIGHT_G || !Number.isSafeInteger(grams)) {
      throw new Error(allowZero ? "Enter weight between 0 and 100,000 kg" : "Enter weight between 0.001 and 100,000 kg");
    }
    return grams;
  }

  function parseFullBags(value) {
    const text = String(value ?? "").trim();
    if (!/^\d+$/.test(text)) throw new Error("Full bags must be a whole number");
    const bags = Number(text);
    if (!Number.isSafeInteger(bags) || bags > MAX_WEIGHT_G) throw new Error("Enter a valid number of full bags");
    return bags;
  }

  function computePayableWeightG(fullBags, bagSizeG, remainingWeightG, bagTareG = 1000) {
    if (!Number.isSafeInteger(fullBags) || fullBags < 0 || !Number.isSafeInteger(bagSizeG) || bagSizeG <= bagTareG
      || !Number.isSafeInteger(remainingWeightG) || remainingWeightG < 0
      || !Number.isSafeInteger(bagTareG) || bagTareG < 0) throw new Error("Bag count and weights must be valid non-negative whole-number values");
    const additionalBags = remainingWeightG > 0 ? Math.ceil(remainingWeightG / bagSizeG) : 0;
    const totalBags = fullBags + additionalBags;
    const payableWeightG = fullBags * bagSizeG + remainingWeightG - totalBags * bagTareG;
    if (!Number.isSafeInteger(payableWeightG) || payableWeightG < 1 || payableWeightG > MAX_WEIGHT_G) throw new Error("Total payable weight must be between 0.001 and 100,000 kg");
    return payableWeightG;
  }

  function computeTotalNikaramsScaled(payableWeightG, nikaramWeightG) {
    if (!Number.isSafeInteger(payableWeightG) || payableWeightG < 0 || !Number.isSafeInteger(nikaramWeightG) || nikaramWeightG < 1) {
      throw new Error("Payable weight and Nikaram weight must be valid");
    }
    return Math.round(payableWeightG * 100000 / nikaramWeightG);
  }

  function computeTotalPaise(payableWeightG, ratePaise, roundingMode = "half-up", rateBasisWeightG = 100000) {
    if (!Number.isSafeInteger(payableWeightG) || !Number.isSafeInteger(ratePaise) || payableWeightG < 0 || ratePaise < 0
      || !Number.isSafeInteger(rateBasisWeightG) || rateBasisWeightG < 1) {
      throw new Error("Weight and rate must be non-negative whole-number values");
    }
    if (!["half-up", "down"].includes(roundingMode)) throw new Error("Rounding mode is not supported");
    const numerator = payableWeightG * ratePaise;
    return Math.floor((numerator + (roundingMode === "half-up" ? rateBasisWeightG / 2 : 0)) / rateBasisWeightG);
  }

  function parseRateRupees(value) {
    const paise = decimalToInteger(value, 2, "Rate");
    if (paise < 1 || paise > MAX_RATE_PAISE) throw new Error("Enter a rate between ₹0.01 and ₹1,00,000");
    return paise;
  }

  function parseMoneyRupees(value) {
    const paise = decimalToInteger(value, 2, "Amount");
    if (paise < 0 || !Number.isSafeInteger(paise)) throw new Error("Enter a valid amount");
    return paise;
  }

  function paidSoFar(payments, purchaseId) {
    return payments.filter((payment) => payment.purchaseId === purchaseId).reduce((sum, payment) => sum + payment.paidPaise, 0);
  }

  function calculateBalance(totalPaise, paidPaise) { return totalPaise - paidPaise; }

  function paymentStatus(totalPaise, paidPaise, purchaseStatus = "ACTIVE") {
    if (purchaseStatus === "VOID") return "Void";
    return paidPaise === 0 ? "Pending" : paidPaise >= totalPaise ? "Paid" : "Partial";
  }

  function summarizePurchases(purchases, payments) {
    const summary = { count: 0, weightG: 0, amountPaise: 0, paidPaise: 0, balancePaise: 0 };
    for (const purchase of purchases) {
      if (purchase.status === "VOID") continue;
      const paid = paidSoFar(payments, purchase.purchaseId);
      summary.count++;
      summary.weightG += purchase.payableWeightG;
      summary.amountPaise += purchase.totalPaise;
      summary.paidPaise += paid;
      summary.balancePaise += calculateBalance(purchase.totalPaise, paid);
    }
    return summary;
  }

  function weightedAverageRatePaise(amountPaise, payableWeightG) {
    if (!payableWeightG) return 0;
    return Math.floor((amountPaise * 100000 + payableWeightG / 2) / payableWeightG);
  }

  function weightedAverageNikaramRatePaise(amountPaise, nikaramsScaled) {
    if (!nikaramsScaled) return 0;
    return Math.floor((amountPaise * 100000 + nikaramsScaled / 2) / nikaramsScaled);
  }

  function formatRupeesInput(paise) { return (paise / 100).toFixed(2); }
  function paiseToRupees(paise) { return paise / 100; }
  function gramsToKg(grams) { return grams / 1000; }
  function gramsToNikarams(weightG, nikaramWeightG = 100000) { return weightG / nikaramWeightG; }
  function halfAmountPaise(paise) { return Math.floor(paise / 2); }

  function formatMoney(paise) {
    return INR.format(paise / 100);
  }

  function formatNikarams(weightG, nikaramWeightG = 100000, minimumFractionDigits = 2) {
    const nikarams = gramsToNikarams(weightG, nikaramWeightG);
    return new Intl.NumberFormat("en-IN", { minimumFractionDigits, maximumFractionDigits: 5 }).format(nikarams);
  }

  function formatWeightKg(weightG) {
    return `${DIGITS.format(gramsToKg(weightG))} kg`;
  }

  function formatRupees(paise) {
    return INR.format(paise / 100);
  }

  function amountInWords(paise) {
    const wholeRupees = Math.floor(paise / 100);
    const coins = paise % 100;
    const ones = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
    const teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    function underThousand(n) {
      const words = [];
      if (n >= 100) { words.push(`${ones[Math.floor(n / 100)]} Hundred`); n %= 100; }
      if (n >= 20) { words.push(tens[Math.floor(n / 10)]); n %= 10; }
      if (n >= 10) { words.push(teens[n - 10]); n = 0; }
      if (n > 0) words.push(ones[n]);
      return words.join(" ");
    }
    function indianNumber(n) {
      if (n === 0) return "Zero";
      const parts = [];
      const crore = Math.floor(n / 10000000); n %= 10000000;
      const lakh = Math.floor(n / 100000); n %= 100000;
      const thousand = Math.floor(n / 1000); n %= 1000;
      if (crore) parts.push(`${underThousand(crore)} Crore`);
      if (lakh) parts.push(`${underThousand(lakh)} Lakh`);
      if (thousand) parts.push(`${underThousand(thousand)} Thousand`);
      if (n) parts.push(underThousand(n));
      return parts.join(" ");
    }
    return `Rupees ${indianNumber(wholeRupees)}${coins ? ` and Paise ${underThousand(coins)}` : ""} Only`;
  }

  window.GrainCalc = {
    MAX_WEIGHT_G, MAX_RATE_PAISE, GRAIN_TYPES, parseWeightKg, parseFullBags, computePayableWeightG, computeTotalNikaramsScaled, parseRateRupees, parseMoneyRupees,
    computeTotalPaise, paidSoFar, calculateBalance, paymentStatus, summarizePurchases,
    weightedAverageRatePaise, weightedAverageNikaramRatePaise, formatMoney, formatRupees,
    formatRupeesInput, paiseToRupees, gramsToKg, gramsToNikarams, halfAmountPaise,
    formatNikarams, formatWeightKg, amountInWords
  };
})();
