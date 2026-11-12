(() => {
  "use strict";
  function text(value, label, min, max, required = true) {
    const cleaned = String(value ?? "").trim();
    if (required && cleaned.length < min) throw new Error(`${label} is required`);
    if (cleaned.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
    if (/[\u0000-\u001f\u007f]/.test(cleaned)) throw new Error(`${label} contains unsupported characters`);
    return cleaned;
  }
  function farmerName(value) { return text(value, "Farmer name", 2, 60); }
  function village(value) { return text(value, "Village", 0, 60, false); }
  function mobile(value) {
    const cleaned = text(value, "Mobile number", 0, 10, false);
    if (cleaned && !/^\d{10}$/.test(cleaned)) throw new Error("Mobile number must be 10 digits");
    return cleaned;
  }
  function grainName(value) { return text(value, "Grain name", 2, 40); }
  function remarks(value) { return text(value, "Remarks", 0, 200, false); }
  function uniqueName(values, value, id, prop) {
    return !values.some((record) => record.id !== id && record[prop].toLocaleLowerCase() === value.toLocaleLowerCase());
  }
  function dateNotFuture(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date > new Date()) throw new Error("Date cannot be in the future");
    return date.toISOString();
  }
  window.GrainValidate = { text, farmerName, village, mobile, grainName, remarks, uniqueName, dateNotFuture };
})();
