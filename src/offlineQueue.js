/**
 * offlineQueue.js — Phase 6: field actions survive a lost connection.
 * ─────────────────────────────────────────────────────────────────────
 * A tiny persistent FIFO of operations (collection confirmations, incident
 * reports, location pings) keyed by an idempotency id. The driver portal
 * enqueues when offline or when a write fails, and flushes in order when
 * back online. Storage is injectable so the logic is unit-tested without a
 * browser; duplicates (same id) are collapsed.
 * ─────────────────────────────────────────────────────────────────────
 */
export function createOfflineQueue({ storage = null, key = "swm_offline_queue", maxItems = 500 } = {}) {
  let items = [];
  const load = () => { try { items = JSON.parse(storage?.getItem(key) || "[]"); } catch { items = []; } };
  const save = () => { try { storage?.setItem(key, JSON.stringify(items)); } catch { /* storage unavailable */ } };
  load();

  return {
    size: () => items.length,
    list: () => items.slice(),
    enqueue(op) {
      if (!op?.id || !op?.type) throw new Error("عملية بلا معرّف أو نوع");
      const idx = items.findIndex((i) => i.id === op.id);
      const entry = { ...op, queuedAt: op.queuedAt || new Date().toISOString(), attempts: 0 };
      if (idx >= 0) items[idx] = { ...items[idx], ...op }; else items.push(entry);
      if (items.length > maxItems) items = items.slice(-maxItems);
      save();
      return entry;
    },
    remove(id) { items = items.filter((i) => i.id !== id); save(); },
    /** Flush in order; stops at the first failure (keeps order guarantees). Returns counts. */
    async flush(handler) {
      let sent = 0, failed = 0;
      for (const op of items.slice()) {
        try { await handler(op); items = items.filter((i) => i.id !== op.id); sent += 1; save(); }
        catch (e) { op.attempts = (op.attempts || 0) + 1; op.lastError = String(e?.message || e); failed += 1; save(); break; }
      }
      return { sent, failed, pending: items.length };
    },
    clear() { items = []; save(); },
  };
}
