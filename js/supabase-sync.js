import { createClient } from "@supabase/supabase-js";

const TABLES = {
  farmers: { table: "grain_farmers", id: "farmerId" },
  grains: { table: "grain_master", id: "grainId" },
  purchases: { table: "grain_purchases", id: "purchaseId" },
  payments: { table: "grain_payments", id: "paymentId" },
  settings: { table: "grain_settings", id: "settingsId" }
};
const DELETIONS_TABLE = "grain_sync_deletions";
const LOCAL_OWNER_KEY = "grain_sync_owner";

export function createSupabaseSync(url, anonKey) {
  const hasCredentials = Boolean(url && anonKey && !url.includes("your-project-id") && !anonKey.startsWith("your-"));
  let client = null;
  let configurationError = "";
  if (hasCredentials) {
    try {
      client = createClient(url, anonKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
      });
    } catch (error) {
      configurationError = `Supabase configuration is invalid: ${error.message}`;
    }
  }
  const configured = Boolean(client);
  const listeners = new Set();
  const state = {
    configured,
    user: null,
    syncing: false,
    error: configurationError,
    lastSyncedAt: ""
  };
  let syncPromise = null;
  let syncQueued = false;
  let debounceTimer;

  function snapshot() { return { ...state }; }
  function publish() {
    const current = snapshot();
    listeners.forEach((listener) => listener(current));
    window.dispatchEvent(new CustomEvent("grain-sync-state", { detail: current }));
  }
  function setError(error) {
    state.error = error?.message || String(error);
    state.syncing = false;
    publish();
  }
  function entityUpdatedAt(record) {
    const date = record.updatedAt || record.createdAt || record.purchaseDate || record.paymentDate;
    const time = date ? Date.parse(date) : 0;
    return Number.isFinite(time) ? new Date(time).toISOString() : new Date(0).toISOString();
  }
  function localRecords(data, entity) {
    if (entity === "settings") return [{ settingsId: "primary", ...data.settings }];
    return data[entity];
  }
  function getLocalTombstones() {
    try { return JSON.parse(localStorage.getItem("grain_sync_tombstones") || "[]"); }
    catch { throw new Error("Local sync queue data is damaged. Stop syncing and contact support."); }
  }
  function mapRows(rows) {
    return new Map((rows || []).map((row) => [row.id, {
      record: row.payload,
      updatedAt: row.updated_at || entityUpdatedAt(row.payload)
    }]));
  }
  function resolveDuplicateGrains(local, remote) {
    const localGrains = local.grains || [];
    const remoteGrains = remote.grains || [];
    const cloudNames = new Map(remoteGrains.map((grain) => [String(grain.grainName).toLocaleLowerCase(), grain.grainId]));
    const remap = new Map();
    for (const grain of localGrains) {
      const cloudId = cloudNames.get(String(grain.grainName).toLocaleLowerCase());
      if (cloudId && cloudId !== grain.grainId) remap.set(grain.grainId, cloudId);
    }
    if (!remap.size) return local;
    return {
      ...local,
      grains: localGrains.map((grain) => remap.has(grain.grainId) ? { ...grain, grainId: remap.get(grain.grainId) } : grain),
      purchases: (local.purchases || []).map((purchase) => remap.has(purchase.grainId) ? { ...purchase, grainId: remap.get(purchase.grainId) } : purchase)
    };
  }
  function mergeData(local, remote, remoteRows, tombstones) {
    const normalizedLocal = resolveDuplicateGrains(local, remote);
    const result = {};
    for (const [entity, config] of Object.entries(TABLES)) {
      const localMap = new Map(localRecords(normalizedLocal, entity).map((record) => [
        record[config.id],
        { record, updatedAt: entityUpdatedAt(record) }
      ]));
      const cloudMap = mapRows(remoteRows[entity]);
      const merged = new Map(cloudMap);
      for (const [id, localEntry] of localMap) {
        const cloudEntry = cloudMap.get(id);
        if (!cloudEntry || Date.parse(localEntry.updatedAt) > Date.parse(cloudEntry.updatedAt)) merged.set(id, localEntry);
      }
      const active = [];
      for (const [id, entry] of merged) {
        const deletedAt = tombstones.get(`${entity}:${id}`);
        if (deletedAt && Date.parse(deletedAt) >= Date.parse(entry.updatedAt)) continue;
        active.push(entry.record);
      }
      if (entity === "settings") {
        result.settings = active.sort((a, b) => Date.parse(entityUpdatedAt(b)) - Date.parse(entityUpdatedAt(a)))[0] || window.GrainStorage.DEFAULTS;
      } else {
        result[entity] = active;
      }
    }

    const receipts = new Map();
    for (const purchase of result.purchases) {
      const prior = receipts.get(purchase.receiptNumber);
      if (prior && prior !== purchase.purchaseId) {
        throw new Error(`Receipt number ${purchase.receiptNumber} exists on multiple devices. Resolve the duplicate before syncing.`);
      }
      receipts.set(purchase.receiptNumber, purchase.purchaseId);
    }
    return result;
  }
  async function fetchRemote(userId) {
    const remoteRows = {};
    for (const [entity, config] of Object.entries(TABLES)) {
      const { data, error } = await client.from(config.table).select("id,payload,updated_at").eq("user_id", userId);
      if (error) throw error;
      remoteRows[entity] = data || [];
    }
    const { data, error } = await client.from(DELETIONS_TABLE).select("entity,record_id,deleted_at").eq("user_id", userId);
    if (error) throw error;
    return { remoteRows, remoteDeletions: data || [] };
  }
  async function pushRemote(userId, merged, tombstones) {
    for (const [entity, config] of Object.entries(TABLES)) {
      const records = localRecords(merged, entity);
      if (!records.length) continue;
      const rows = records.map((record) => ({
        user_id: userId,
        id: record[config.id],
        payload: record,
        updated_at: entityUpdatedAt(record)
      }));
      const { error } = await client.from(config.table).upsert(rows, { onConflict: "user_id,id" });
      if (error) throw error;
    }
    if (tombstones.length) {
      const rows = tombstones.map((item) => ({
        user_id: userId,
        entity: item.entity,
        record_id: item.id,
        deleted_at: item.deletedAt
      }));
      const { error } = await client.from(DELETIONS_TABLE).upsert(rows, { onConflict: "user_id,entity,record_id" });
      if (error) throw error;
    }
  }
  async function syncOnce() {
    if (!client || !state.user) return;
    const localOwnerId = localStorage.getItem(LOCAL_OWNER_KEY);
    if (localOwnerId && localOwnerId !== state.user.id) {
      throw new Error("This browser's local records are linked to another Supabase account. Sign in with that account or use a separate browser profile.");
    }
    state.syncing = true;
    state.error = "";
    publish();
    const local = window.GrainStorage.getData();
    const localTombstones = getLocalTombstones();
    const { remoteRows, remoteDeletions } = await fetchRemote(state.user.id);
    const tombstoneMap = new Map();
    for (const item of [...remoteDeletions, ...localTombstones]) {
      const key = `${item.entity}:${item.record_id || item.id}`;
      const deletedAt = item.deleted_at || item.deletedAt;
      if (!tombstoneMap.has(key) || Date.parse(deletedAt) > Date.parse(tombstoneMap.get(key))) tombstoneMap.set(key, deletedAt);
    }
    const merged = mergeData(local, Object.fromEntries(Object.entries(remoteRows).map(([entity, rows]) => [
      entity,
      rows.map((row) => row.payload)
    ])), remoteRows, tombstoneMap);
    const tombstones = [...tombstoneMap].map(([key, deletedAt]) => {
      const split = key.indexOf(":");
      return { entity: key.slice(0, split), id: key.slice(split + 1), deletedAt };
    });
    await pushRemote(state.user.id, merged, tombstones);
    window.GrainStorage.applySyncedData(merged, tombstones);
    localStorage.setItem(LOCAL_OWNER_KEY, state.user.id);
    state.lastSyncedAt = new Date().toISOString();
    state.syncing = false;
    publish();
    window.dispatchEvent(new CustomEvent("grain-data-synced"));
  }
  async function syncNow() {
    if (!configured) throw new Error("Add your Supabase project URL and publishable key to .env first.");
    if (!state.user) throw new Error("Sign in to Supabase before syncing.");
    if (syncPromise) {
      syncQueued = true;
      return syncPromise;
    }
    syncPromise = (async () => {
      do {
        syncQueued = false;
        await syncOnce();
      } while (syncQueued);
    })().catch((error) => {
      setError(error);
      throw error;
    }).finally(() => { syncPromise = null; });
    return syncPromise;
  }
  function scheduleSync() {
    if (!configured || !state.user || !navigator.onLine) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { syncNow().catch(() => {}); }, 800);
  }
  function requireClient() {
    if (!client) throw new Error(configurationError || "Supabase is not configured. Add the project URL and publishable key to .env.");
    return client;
  }
  async function initialize() {
    if (!client) return;
    const { data, error } = await client.auth.getSession();
    if (error) {
      setError(error);
      return;
    }
    state.user = data.session?.user || null;
    publish();
    if (state.user && navigator.onLine) syncNow().catch(() => {});
    client.auth.onAuthStateChange((_event, session) => {
      state.user = session?.user || null;
      state.error = "";
      publish();
      if (state.user) scheduleSync();
    });
  }
  async function signIn(email, password) {
    const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    state.user = data.user;
    state.error = "";
    publish();
    await syncNow();
  }
  async function signUp(email, password) {
    const { data, error } = await requireClient().auth.signUp({ email, password });
    if (error) throw error;
    if (data.session) {
      state.user = data.user;
      publish();
      await syncNow();
      return "Account created and signed in.";
    }
    return "Account created. Confirm your email, then sign in.";
  }
  async function signOut() {
    const { error } = await requireClient().auth.signOut();
    if (error) throw error;
    state.user = null;
    state.syncing = false;
    state.error = "";
    publish();
  }
  function onChange(listener) {
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }
  window.addEventListener("online", scheduleSync);
  window.addEventListener("focus", scheduleSync);

  return {
    configured,
    initialize,
    signIn,
    signUp,
    signOut,
    syncNow,
    scheduleSync,
    onChange,
    getState: snapshot
  };
}
