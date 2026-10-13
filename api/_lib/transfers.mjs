// Inter-municipality resource transfer — execute and return as ONE Firestore transaction.
// All resource documents (vehicle, driver profile, user account) and the transfer record change together or not
// at all: any validation failure or error aborts the whole transaction, so no partial state can exist.
// No external system is involved, so no compensation step is needed; repeated calls are idempotent by status.
import { iso } from "./http.mjs";
import { windowsOverlap } from "../../src/resourceReservations.js";

/** Default loan window when an older proposal carries none: now → now + this (minutes). */
export const DEFAULT_TRANSFER_WINDOW_MIN = 8 * 60;

// httpStatus, not `code`: the Firestore SDK reads error.code as a gRPC status when deciding transaction retries.
export class TransferError extends Error { constructor(httpStatus, message) { super(message); this.httpStatus = httpStatus; } }
const ACTIVE = ["approved", "in_progress"];

/** Resource refs for a transfer (vehicle / driver / crew). */
function refsFor(db, tr) {
  const vehicleId = tr.resourceType === "vehicle" ? tr.resourceId : tr.resourceType === "crew" ? tr.vehicleId : null;
  const driverId = tr.resourceType === "driver" ? tr.resourceId : tr.resourceType === "crew" ? tr.driverId : null;
  return {
    vehicle: vehicleId ? db.collection("vehicles").doc(vehicleId) : null,
    profile: driverId ? db.collection("driver_profiles").doc(driverId) : null,
    user: driverId ? db.collection("users").doc(driverId) : null,
    vehicleId, driverId,
  };
}

/**
 * @param {"execute"|"return"} action
 * @param {{ failAt?: string }} [opts]  TEST hook: throw after a given write is staged (vehicle|profile|user|transfer|audit)
 */
export async function runTransfer(db, { action, transferId, actor }, { failAt = null, now = Date.now() } = {}) {
  const tRef = db.collection("resource_transfers").doc(transferId);
  const step = (name) => { if (failAt === name) throw new Error(`INJECTED_FAILURE:${name}`); };
  return db.runTransaction(async (t) => {
    const tSnap = await t.get(tRef);
    if (!tSnap.exists) throw new TransferError(404, "النقل غير موجود");
    const tr = tSnap.data();
    if (!["vehicle", "driver", "crew"].includes(tr.resourceType)) throw new TransferError(409, "نوع مورد غير صالح");
    if (action === "execute" && tr.status === "executed") return { already: true, status: "executed" };
    if (action === "return" && tr.status === "returned") return { already: true, status: "returned" };
    if (action === "execute" && tr.status !== "approved") throw new TransferError(409, "النقل غير معتمد");
    if (action === "return" && tr.status !== "executed") throw new TransferError(409, "النقل غير منفَّذ");
    const from = action === "execute" ? tr.fromMunicipalityId : tr.toMunicipalityId;   // where the resource must be now
    const to = action === "execute" ? tr.toMunicipalityId : tr.fromMunicipalityId;
    const r = refsFor(db, tr);
    if (!r.vehicle && !r.profile) throw new TransferError(409, "لا مورد محدد في النقل");

    // ── reads (all before writes) ──
    const [vSnap, pSnap, uSnap] = await Promise.all([r.vehicle ? t.get(r.vehicle) : null, r.profile ? t.get(r.profile) : null, r.user ? t.get(r.user) : null]);
    const busy = [];
    if (r.vehicleId) busy.push(t.get(db.collection("collection_routes").where("vehicleId", "==", r.vehicleId).where("status", "in", ACTIVE)));
    if (r.driverId) busy.push(t.get(db.collection("collection_routes").where("driverId", "==", r.driverId).where("status", "in", ACTIVE)));
    const busySnaps = await Promise.all(busy);
    const release = action === "return" ? await releaseReservations(t, db, transferId, now) : null;
    if (r.vehicle && !vSnap.exists) throw new TransferError(409, "المركبة غير موجودة");
    if (r.profile && !pSnap.exists) throw new TransferError(409, "ملف السائق غير موجود");
    if (r.vehicle && vSnap.get("municipalityId") !== from) throw new TransferError(409, "المركبة ليست في البلدية المتوقعة");
    if (r.profile && pSnap.get("municipalityId") !== from) throw new TransferError(409, "السائق ليس في البلدية المتوقعة");
    if (r.user && uSnap.exists && uSnap.get("municipalityId") !== from) throw new TransferError(409, "حساب السائق ليس في البلدية المتوقعة");
    if (busySnaps.some((s) => !s.empty)) throw new TransferError(409, "المورد مرتبط بجولة معتمدة أو جارية — أنهها أو أعد إسنادها أولًا");

    // ── writes ──
    const moved = (snap) => action === "execute"
      ? { municipalityId: to, homeMunicipalityId: snap.get("homeMunicipalityId") || snap.get("municipalityId") || tr.fromMunicipalityId, transferId, transferUntil: tr.until || null, updatedAt: iso(now) }
      : { municipalityId: snap.get("homeMunicipalityId") || to, transferId: null, transferUntil: null, updatedAt: iso(now) };
    if (r.vehicle) { t.update(r.vehicle, moved(vSnap)); step("vehicle"); }
    if (r.profile) { t.update(r.profile, moved(pSnap)); step("profile"); }
    if (r.user && uSnap.exists) { t.update(r.user, moved(uSnap)); step("user"); }
    const statusPatch = action === "execute" ? { status: "executed", executedBy: actor.uid, executedByName: actor.name || "", executedAt: iso(now), updatedAt: iso(now) } : { status: "returned", returnedBy: actor.uid, returnedByName: actor.name || "", returnedAt: iso(now), updatedAt: iso(now) };
    t.update(tRef, statusPatch);
    if (release) release();
    step("transfer");
    t.set(db.collection("audit_log").doc(), { action: action === "execute" ? "transfer_executed" : "transfer_returned", actorId: actor.uid, actorName: actor.name || "", municipalityId: null,
      details: { transferId, resourceType: tr.resourceType, vehicleId: r.vehicleId, driverId: r.driverId, from: tr.fromMunicipalityId, to: tr.toMunicipalityId }, source: "server", createdAt: iso(now) });
    step("audit");
    return { already: false, status: statusPatch.status };
  });
}
export const TRANSFER_STEPS = ["vehicle", "profile", "user", "transfer", "audit"];

const resourceIdsOf = (tr) => [...new Set([tr.driverId, tr.vehicleId, tr.resourceId].filter(Boolean))];
export const transferWindow = (tr, now = Date.now()) => ({
  startAt: tr.window?.startAt || iso(now),
  endAt: tr.window?.endAt || tr.until || iso(now + DEFAULT_TRANSFER_WINDOW_MIN * 60000),
});

/**
 * Approve a PROPOSED transfer and reserve its resources for the loan window — atomically.
 * One lock document per resource (resource_locks/{id}) is read and written in the same transaction, so two
 * concurrent approvals of overlapping windows on the same driver / vehicle are serialised: the second one
 * re-reads, sees the first reservation and is refused (409). Re-approving the same transfer is idempotent.
 */
export async function approveTransfer(db, { transferId, actor, note = "" }, { now = Date.now() } = {}) {
  const tRef = db.collection("resource_transfers").doc(transferId);
  return db.runTransaction(async (t) => {
    const tSnap = await t.get(tRef);
    if (!tSnap.exists) throw new TransferError(404, "النقل غير موجود");
    const tr = tSnap.data();
    if (["approved", "executed"].includes(tr.status) && tr.decidedBy) return { already: true, status: tr.status };
    if (tr.status !== "proposed") throw new TransferError(409, "النقل ليس مقترحًا");
    const ids = resourceIdsOf(tr);
    if (ids.length === 0) throw new TransferError(409, "لا مورد محدد في النقل");
    const win = transferWindow(tr, now);
    if (new Date(win.endAt).getTime() <= new Date(win.startAt).getTime()) throw new TransferError(409, "نافذة الإعارة غير صالحة");
    const lockRefs = ids.map((id) => db.collection("resource_locks").doc(id));
    await t.getAll(...lockRefs);
    const held = (await t.get(db.collection("resource_reservations").where("resourceId", "in", ids).where("status", "==", "active"))).docs.map((d) => ({ id: d.id, ...d.data() }));
    const clash = held.find((r) => r.transferId !== transferId && windowsOverlap(win, r));
    if (clash) throw new TransferError(409, `المورد محجوز في نافذة متداخلة (${clash.purpose === "adjustment" ? "تعديل تشغيلي" : "إعارة أخرى"}) — لا يُعتمد المورد نفسه لمهمتين`);
    for (const id of ids) {
      t.set(db.collection("resource_reservations").doc(`${transferId}__${id}`), { resourceId: id, transferId, purpose: "transfer", status: "active", startAt: win.startAt, endAt: win.endAt,
        fromMunicipalityId: tr.fromMunicipalityId, toMunicipalityId: tr.toMunicipalityId, municipalityIds: [tr.fromMunicipalityId, tr.toMunicipalityId], createdBy: actor.uid, createdAt: iso(now) });
    }
    for (const r of lockRefs) t.set(r, { updatedAt: iso(now), lastTransferId: transferId }, { merge: true });
    t.update(tRef, { status: "approved", decidedBy: actor.uid, decidedByName: actor.name || "", decidedAt: iso(now), decisionNote: note, window: win, updatedAt: iso(now) });
    t.set(db.collection("audit_log").doc(), { action: "transfer_approved", actorId: actor.uid, actorName: actor.name || "", municipalityId: null,
      details: { transferId, resourceIds: ids, from: tr.fromMunicipalityId, to: tr.toMunicipalityId, window: win, note }, source: "server", createdAt: iso(now) });
    return { already: false, status: "approved", window: win };
  });
}

/** Release a transfer's reservations (on return). Called inside the return transaction. */
async function releaseReservations(t, db, transferId, now) {
  const snap = await t.get(db.collection("resource_reservations").where("transferId", "==", transferId).where("status", "==", "active"));
  return () => snap.docs.forEach((d) => t.update(d.ref, { status: "released", releasedAt: iso(now) }));
}
export { releaseReservations };
