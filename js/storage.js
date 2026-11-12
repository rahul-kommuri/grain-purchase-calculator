(() => {
  "use strict";
  const KEYS = {
    farmers: "grain_farmers",
    grains: "grain_master",
    purchases: "grain_purchases",
    payments: "grain_payments",
    settings: "grain_settings",
    version: "grain_app_version"
  };
  const SCHEMA_VERSION = 2;
  const SYNC_TOMBSTONES_KEY = "grain_sync_tombstones";
  const GRAIN_TYPES = ["Paddy", "Maize", "Jowar"];
  const DEFAULTS = {
    shopName: "", shopAddress: "", shopPhone: "", receiptPrefix: "GP", nextReceiptNumber: 1,
    receiptPaper: "A5", weightDecimalPlaces: 3, defaultPaymentMode: "",
    paymentEntryOpen: false, roundingMode: "half-up",
    nikaramWeightsG: { Paddy: 76500, Maize: 76500, Jowar: 76500 },
    bagSizesG: { Paddy: 70000, Maize: 60000, Jowar: 60000 },
    lastBackupAt: ""
  };

  function uuid() {
    if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
  function timestamp() { return new Date().toISOString(); }
  function storageError(error) {
    if (error?.name === "QuotaExceededError" || error?.name === "NS_ERROR_DOM_QUOTA_REACHED" || error?.name === "SecurityError") {
      return new Error("Could not save. Browser storage is full or blocked.");
    }
    return error;
  }
  function read(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    try { return JSON.parse(raw); }
    catch { throw new Error(`Saved ${key.replace("grain_", "")} data is damaged. Stop using the app and contact support before clearing browser data.`); }
  }
  function normalizeGrainRates(grains, settings) {
    let changed = false;
    for (const grain of grains) {
      const grainName = GRAIN_TYPES.find((name) => name.toLocaleLowerCase() === grain.grainName.toLocaleLowerCase());
      if (!grainName) continue;
      if (grain.grainName !== grainName) {
        grain.grainName = grainName;
        changed = true;
      }
      if (grain.rateBasisWeightG) continue;
      const nikaramWeightG = settings.nikaramWeightsG[grainName];
      if (grain.defaultRatePaise > 0) {
        grain.defaultRatePaise = Math.floor((grain.defaultRatePaise * nikaramWeightG + 50000) / 100000);
      }
      grain.rateBasisWeightG = nikaramWeightG;
      changed = true;
    }
    return changed;
  }
  function initialize() {
    let version = read(KEYS.version, 0);
    if (version > SCHEMA_VERSION) throw new Error("This data was created by a newer version of the app. Update the app before continuing.");
    if (version < SCHEMA_VERSION) {
      for (const key of [KEYS.farmers, KEYS.grains, KEYS.purchases, KEYS.payments]) {
        const value = read(key, []);
        if (!Array.isArray(value)) throw new Error(`Saved ${key.replace("grain_", "")} data is not valid.`);
      }
      const oldSettings = read(KEYS.settings, DEFAULTS);
      const settings = {
        ...DEFAULTS,
        ...oldSettings,
        nikaramWeightsG: { ...DEFAULTS.nikaramWeightsG, ...(oldSettings.nikaramWeightsG || {}) },
        bagSizesG: { ...DEFAULTS.bagSizesG, ...(oldSettings.bagSizesG || {}) }
      };
      const grains = read(KEYS.grains, []);
      if (normalizeGrainRates(grains, settings)) {
        try { localStorage.setItem(KEYS.grains, JSON.stringify(grains)); }
        catch (error) { throw storageError(error); }
      }
      version = SCHEMA_VERSION;
      try { localStorage.setItem(KEYS.version, JSON.stringify(version)); }
      catch (error) { throw storageError(error); }
    }
    const data = getData();
    const grainRecords = [...data.grains];
    let changed = false;
    for (const grainName of GRAIN_TYPES) {
      const existing = grainRecords.find((grain) => grain.grainName.toLocaleLowerCase() === grainName.toLocaleLowerCase());
      if (!existing) {
        grainRecords.push({
          grainId: uuid(), grainName, defaultRatePaise: 0, rateBasisWeightG: data.settings.nikaramWeightsG[grainName], isActive: true,
          createdAt: timestamp(), updatedAt: timestamp()
        });
        changed = true;
      } else if (!existing.isActive) {
        existing.isActive = true;
        changed = true;
      }
      if (existing && existing.grainName !== grainName) {
        existing.grainName = grainName;
        changed = true;
      }
    }
    if (changed) save("grains", grainRecords);
    return getData();
  }
  function getData() {
    const savedSettings = read(KEYS.settings, DEFAULTS);
    if (!savedSettings || typeof savedSettings !== "object" || Array.isArray(savedSettings)) throw new Error("Saved settings data is not valid.");
    const data = {
      farmers: read(KEYS.farmers, []),
      grains: read(KEYS.grains, []),
      purchases: read(KEYS.purchases, []),
      payments: read(KEYS.payments, []),
      settings: {
        ...DEFAULTS,
        ...savedSettings,
        nikaramWeightsG: { ...DEFAULTS.nikaramWeightsG, ...(savedSettings.nikaramWeightsG || {}) },
        bagSizesG: { ...DEFAULTS.bagSizesG, ...(savedSettings.bagSizesG || {}) }
      }
    };
    for (const name of ["farmers", "grains", "purchases", "payments"]) {
      if (!Array.isArray(data[name])) throw new Error(`Saved ${name} data is not valid.`);
    }
    if (!data.settings || typeof data.settings !== "object" || Array.isArray(data.settings)) throw new Error("Saved settings data is not valid.");
    return data;
  }
  function save(keyName, value) {
    const key = KEYS[keyName];
    if (!key || keyName === "version") throw new Error("Unknown storage collection.");
    const fresh = read(key, keyName === "settings" ? DEFAULTS : []);
    let next = typeof value === "function" ? value(fresh) : value;
    const idField = { farmers: "farmerId", grains: "grainId", purchases: "purchaseId", payments: "paymentId" }[keyName];
    let tombstones = [];
    if (idField && Array.isArray(fresh) && Array.isArray(next)) {
      const oldRecords = new Map(fresh.map((record) => [record[idField], record]));
      const nextIds = new Set(next.map((record) => record[idField]));
      const now = timestamp();
      next = next.map((record) => {
        const oldRecord = oldRecords.get(record[idField]);
        if (oldRecord && JSON.stringify(oldRecord) === JSON.stringify(record)) return record;
        return { ...record, updatedAt: now };
      });
      tombstones = fresh.filter((record) => !nextIds.has(record[idField])).map((record) => ({
        entity: keyName,
        id: record[idField],
        deletedAt: now
      }));
    } else if (keyName === "settings" && next && typeof next === "object" && !next.updatedAt) {
      next = { ...next, updatedAt: timestamp() };
    }
    try {
      localStorage.setItem(key, JSON.stringify(next));
      if (tombstones.length) {
        const pending = read(SYNC_TOMBSTONES_KEY, []);
        localStorage.setItem(SYNC_TOMBSTONES_KEY, JSON.stringify([...pending, ...tombstones]));
      }
    }
    catch (error) { throw storageError(error); }
    if (keyName !== "version") window.GrainSync?.scheduleSync();
    return next;
  }
  function saveSettings(patch) {
    return save("settings", (fresh) => ({
      ...DEFAULTS,
      ...fresh,
      ...patch,
      nikaramWeightsG: { ...DEFAULTS.nikaramWeightsG, ...(fresh.nikaramWeightsG || {}), ...(patch.nikaramWeightsG || {}) },
      bagSizesG: { ...DEFAULTS.bagSizesG, ...(fresh.bagSizesG || {}), ...(patch.bagSizesG || {}) },
      updatedAt: timestamp()
    }));
  }
  function savePurchaseSync(purchase, payment) {
    const oldPurchases = localStorage.getItem(KEYS.purchases);
    const oldPayments = localStorage.getItem(KEYS.payments);
    const oldSettings = localStorage.getItem(KEYS.settings);
    try {
      const settings = { ...DEFAULTS, ...read(KEYS.settings, {}) };
      if (!Number.isSafeInteger(settings.nextReceiptNumber) || settings.nextReceiptNumber < 1 || !/^[A-Za-z0-9]{1,6}$/.test(settings.receiptPrefix)) throw new Error("Receipt numbering settings are invalid. Review Settings before saving a purchase.");
      const currentPurchases = read(KEYS.purchases, []);
      const currentPayments = read(KEYS.payments, []);
      const receiptNumber = `${settings.receiptPrefix}-${String(settings.nextReceiptNumber).padStart(6, "0")}`;
      if (currentPurchases.some((item) => item.receiptNumber === receiptNumber)) throw new Error("Receipt number already exists. Update the next receipt number in Settings.");
      const storedPurchase = { ...purchase, purchaseId: uuid(), receiptNumber, createdAt: timestamp() };
      const storedPayment = payment ? { ...payment, paymentId: uuid(), purchaseId: storedPurchase.purchaseId, createdAt: timestamp() } : null;
      localStorage.setItem(KEYS.purchases, JSON.stringify([storedPurchase, ...currentPurchases]));
      if (storedPayment) localStorage.setItem(KEYS.payments, JSON.stringify([storedPayment, ...currentPayments]));
      localStorage.setItem(KEYS.settings, JSON.stringify({ ...settings, nextReceiptNumber: settings.nextReceiptNumber + 1, updatedAt: timestamp() }));
      window.GrainSync?.scheduleSync();
      return storedPurchase;
    } catch (error) {
      let rollbackFailed = false;
      for (const [key, oldValue] of [[KEYS.purchases, oldPurchases], [KEYS.payments, oldPayments], [KEYS.settings, oldSettings]]) {
        try { restore(key, oldValue); } catch { rollbackFailed = true; }
      }
      const failure = storageError(error);
      if (rollbackFailed) throw new Error(`${failure.message} A previous save could not be fully restored; stop using the app and contact support.`);
      throw failure;
    }
  }
  function savePurchase(purchase, payment) {
    if (navigator.locks && typeof navigator.locks.request === "function") {
      return navigator.locks.request("grain-purchase-receipt-number", { mode: "exclusive" }, () => savePurchaseSync(purchase, payment));
    }
    return Promise.resolve(savePurchaseSync(purchase, payment));
  }
  function restore(key, value) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
  function replaceAll(data) {
    const before = Object.values(KEYS).map((key) => [key, localStorage.getItem(key)]);
    try {
      const settings = {
        ...DEFAULTS,
        ...data.settings,
        nikaramWeightsG: { ...DEFAULTS.nikaramWeightsG, ...(data.settings?.nikaramWeightsG || {}) },
        bagSizesG: { ...DEFAULTS.bagSizesG, ...(data.settings?.bagSizesG || {}) }
      };
      const grains = [...data.grains];
      normalizeGrainRates(grains, settings);
      for (const grainName of GRAIN_TYPES) {
        const existing = grains.find((grain) => grain.grainName.toLocaleLowerCase() === grainName.toLocaleLowerCase());
        if (!existing) {
          grains.push({ grainId: uuid(), grainName, defaultRatePaise: 0, rateBasisWeightG: settings.nikaramWeightsG[grainName], isActive: true, createdAt: timestamp(), updatedAt: timestamp() });
        } else {
          existing.isActive = true;
        }
      }
      for (const name of ["farmers", "purchases", "payments"]) localStorage.setItem(KEYS[name], JSON.stringify(data[name]));
      localStorage.setItem(KEYS.grains, JSON.stringify(grains));
      localStorage.setItem(KEYS.settings, JSON.stringify(settings));
      localStorage.setItem(KEYS.version, JSON.stringify(SCHEMA_VERSION));
    } catch (error) {
      let rollbackFailed = false;
      for (const [key, value] of before) {
        try { restore(key, value); } catch { rollbackFailed = true; }
      }
      const failure = storageError(error);
      if (rollbackFailed) throw new Error(`${failure.message} Previous data could not be fully restored; stop using the app and contact support.`);
      throw failure;
    }
    window.GrainSync?.scheduleSync();
  }
  function applySyncedData(data, tombstones) {
    const before = [...Object.values(KEYS), SYNC_TOMBSTONES_KEY].map((key) => [key, localStorage.getItem(key)]);
    try {
      for (const name of ["farmers", "grains", "purchases", "payments"]) {
        const key = KEYS[name];
        localStorage.setItem(key, JSON.stringify(data[name]));
      }
      localStorage.setItem(KEYS.settings, JSON.stringify(data.settings));
      localStorage.setItem(KEYS.version, JSON.stringify(SCHEMA_VERSION));
      localStorage.setItem(SYNC_TOMBSTONES_KEY, JSON.stringify(tombstones));
    } catch (error) {
      let rollbackFailed = false;
      for (const [key, value] of before) {
        try { restore(key, value); } catch { rollbackFailed = true; }
      }
      const failure = storageError(error);
      if (rollbackFailed) throw new Error(`${failure.message} Local data could not be fully restored after sync; stop using the app and contact support.`);
      throw failure;
    }
  }
  function reset() {
    const now = timestamp();
    const deleted = [];
    for (const [name, idField] of [["farmers", "farmerId"], ["grains", "grainId"], ["purchases", "purchaseId"], ["payments", "paymentId"]]) {
      deleted.push(...read(KEYS[name], []).map((record) => ({ entity: name, id: record[idField], deletedAt: now })));
    }
    deleted.push({ entity: "settings", id: "primary", deletedAt: now });
    const previousTombstones = read(SYNC_TOMBSTONES_KEY, []);
    localStorage.setItem(SYNC_TOMBSTONES_KEY, JSON.stringify([...previousTombstones, ...deleted]));
    for (const key of Object.values(KEYS)) localStorage.removeItem(key);
    initialize();
    window.GrainSync?.scheduleSync();
  }
  window.GrainStorage = { KEYS, SCHEMA_VERSION, GRAIN_TYPES, DEFAULTS, uuid, timestamp, read, initialize, getData, save, saveSettings, savePurchase, replaceAll, applySyncedData, reset };
})();
