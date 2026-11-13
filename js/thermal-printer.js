const PRINTER_KEY = "grain_thermal_printer";

function ascii(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[₹]/g, "Rs. ")
    .replace(/[–—]/g, "-")
    .replace(/[^ -~]/g, "");
}

function money(valuePaise) {
  return `Rs. ${(Number(valuePaise || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateText(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return [String(date.getDate()).padStart(2, "0"), String(date.getMonth() + 1).padStart(2, "0"), date.getFullYear()].join("-");
}

function wrap(text, width) {
  const words = ascii(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word.slice(0, width);
      let rest = word.slice(width);
      while (rest) { lines.push(line); line = rest.slice(0, width); rest = rest.slice(width); }
    } else if (`${line} ${word}`.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word.slice(0, width);
      let rest = word.slice(width);
      while (rest) { lines.push(line); line = rest.slice(0, width); rest = rest.slice(width); }
    }
  }
  if (line) lines.push(line);
  return lines;
}

function pair(label, value, width) {
  const left = ascii(label);
  const right = ascii(value);
  if (left.length + right.length + 1 <= width) return `${left}${" ".repeat(width - left.length - right.length)}${right}`;
  return `${left}\n${right.padStart(Math.min(width, right.length + 2))}`;
}

function center(text, width) {
  const value = ascii(text).slice(0, width);
  return `${" ".repeat(Math.max(0, Math.floor((width - value.length) / 2)))}${value}`;
}

function encodeReceipt(purchase, payments, settings) {
  const width = settings.receiptPaper === "80mm" ? 48 : 32;
  const calc = window.GrainCalc;
  const paid = calc.paidSoFar(payments, purchase.purchaseId);
  const balance = calc.calculateBalance(purchase.totalPaise, paid);
  const nikaramWeightG = purchase.nikaramWeightG || 100000;
  const wholeNikarams = Math.floor(purchase.payableWeightG / nikaramWeightG);
  const remainingWeightG = purchase.payableWeightG % nikaramWeightG;
  const divider = "-".repeat(width);
  const lines = [];
  const add = (value = "") => lines.push(ascii(value));
  const addPair = (label, value) => add(pair(label, value, width));

  add(center("PURCHASE RECEIPT", width));
  add(divider);
  addPair("Receipt No", purchase.receiptNumber);
  addPair("Date", dateText(purchase.purchaseDate));
  addPair("Farmer Name", purchase.farmerName);
  if (purchase.farmerVillage) addPair("Village", purchase.farmerVillage);
  if (purchase.farmerMobile) addPair("Mobile", purchase.farmerMobile);
  add(divider);
  add("PURCHASE DETAILS");
  addPair("Grain", purchase.grainName);
  if (purchase.fullBags !== undefined) addPair(`${calc.formatWeightKg(purchase.bagSizeG || 0)} Bags`, `${purchase.fullBags} bags`);
  if (purchase.remainingWeightG !== undefined) addPair("Over KGs", calc.formatWeightKg(purchase.remainingWeightG));
  add(divider);
  add("NIKARAM DETAILS");
  addPair("Total Nikarams", calc.formatNikarams(purchase.payableWeightG, nikaramWeightG));
  addPair("  Whole Nikarams", wholeNikarams);
  addPair("  Remaining KGs", calc.formatWeightKg(remainingWeightG));
  addPair(purchase.rateBasisWeightG ? "Rate / Nikaram" : "Rate / 100 kg", money(purchase.ratePaise));
  add(divider);
  add(center("TOTAL AMOUNT PAYABLE", width));
  add(center(money(purchase.totalPaise), width));
  wrap(calc.amountInWords(purchase.totalPaise), width).forEach((line) => add(center(line, width)));
  if (payments.length || balance > 0) {
    add(divider);
    add("PAYMENT DETAILS");
    payments.forEach((item) => addPair(`${dateText(item.paymentDate)} ${item.paymentMode}`, money(item.paidPaise)));
    addPair("Total paid", money(paid));
    addPair("Balance due", money(balance));
  }
  add(divider);
  add(center("Computer generated receipt", width));
  add(center("*** Thank You ***", width));

  const text = `${lines.join("\n")}\n\n\n`;
  const body = new TextEncoder().encode(text);
  const prefix = new Uint8Array([0x1b, 0x40, 0x1b, 0x45, 0x01]);
  const suffix = new Uint8Array([0x1b, 0x45, 0x00, 0x1d, 0x56, 0x42, 0x00]);
  const result = new Uint8Array(prefix.length + body.length + suffix.length);
  result.set(prefix, 0); result.set(body, prefix.length); result.set(suffix, prefix.length + body.length);
  return result;
}

function toBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export function createThermalPrinter(nativePlugin, isNative) {
  let port = null;
  let nativePrinter = null;
  const listeners = new Set();
  const state = { supported: isNative || "serial" in navigator, connected: false, name: "", error: "" };

  try { nativePrinter = JSON.parse(localStorage.getItem(PRINTER_KEY) || "null"); } catch { nativePrinter = null; }
  if (nativePrinter?.name) state.name = nativePrinter.name;
  if (nativePrinter?.address) state.address = nativePrinter.address;
  const publish = () => listeners.forEach((listener) => listener({ ...state }));
  const setError = (error) => { state.error = error?.message || String(error); state.connected = false; publish(); };

  async function listPaired() {
    if (!isNative) return [];
    await nativePlugin.requestBluetoothPermission();
    const result = await nativePlugin.getPairedPrinters();
    return result.devices || [];
  }

  async function connect(address = "", name = "") {
    state.error = "";
    try {
      if (isNative) {
        if (!address) throw new Error("Select a paired Bluetooth printer first.");
        await nativePlugin.requestBluetoothPermission();
        await nativePlugin.connectBluetooth({ address });
        nativePrinter = { address, name: name || address };
        localStorage.setItem(PRINTER_KEY, JSON.stringify(nativePrinter));
        state.name = nativePrinter.name;
        state.address = nativePrinter.address;
      } else {
        if (!("serial" in navigator)) throw new Error("Direct Bluetooth printing needs a recent Chrome browser on Android.");
        if (port?.readable || port?.writable) await port.close().catch(() => {});
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600, bufferSize: 4096 });
        state.name = "Bluetooth serial printer";
      }
      state.connected = true;
      publish();
      return { ...state };
    } catch (error) { setError(error); throw error; }
  }

  async function reconnect() {
    if (isNative && nativePrinter?.address) return connect(nativePrinter.address, nativePrinter.name);
    if (!isNative && "serial" in navigator) {
      const ports = await navigator.serial.getPorts();
      if (ports.length === 1) {
        port = ports[0];
        await port.open({ baudRate: 9600, bufferSize: 4096 });
        state.connected = true; state.name = "Bluetooth serial printer"; state.error = ""; publish();
      }
    }
    return { ...state };
  }

  async function disconnect({ forget = false } = {}) {
    try {
      if (isNative) await nativePlugin.disconnectBluetooth();
      else if (port) {
        await port.close();
        if (forget && typeof port.forget === "function") await port.forget();
      }
    } finally {
      port = null; state.connected = false; state.error = "";
      if (forget) { nativePrinter = null; state.name = ""; state.address = ""; localStorage.removeItem(PRINTER_KEY); }
      publish();
    }
  }

  async function write(bytes) {
    if (isNative) {
      if (!nativePrinter?.address) throw new Error("Connect a Bluetooth printer in Settings first.");
      if (!state.connected) await reconnect();
      await nativePlugin.printEscPos({ data: toBase64(bytes) });
      return;
    }
    if (!port?.writable || !state.connected) throw new Error("Connect a Bluetooth printer in Settings first.");
    const writer = port.writable.getWriter();
    try {
      for (let offset = 0; offset < bytes.length; offset += 512) await writer.write(bytes.subarray(offset, offset + 512));
    } finally { writer.releaseLock(); }
  }

  async function printReceipt(purchase, payments, settings) { await write(encodeReceipt(purchase, payments, settings)); }
  async function test(settings) {
    const bytes = new TextEncoder().encode("\x1b@\x1bE\x01GRAINWISE PRINTER TEST\nConnection successful\n\n\n\x1dVB\x00");
    await write(bytes);
  }
  function onChange(listener) { listeners.add(listener); listener({ ...state }); return () => listeners.delete(listener); }
  function isConfigured() { return isNative ? Boolean(nativePrinter?.address) : Boolean(port && state.connected); }

  return { listPaired, connect, reconnect, disconnect, printReceipt, test, onChange, getState: () => ({ ...state }), isConfigured, isNative };
}
