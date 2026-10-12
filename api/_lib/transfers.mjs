// Inter-municipality resource transfer — execute and return as ONE Firestore transaction.
// All resource documents (vehicle, driver profile, user account) and the transfer record change together or not
// at all: any validation failure or error aborts the whole transaction, so no partial state can exist.
// No external system is involved, so no compensation step is needed; repeated calls are idempotent by status.
import { iso } from "./http.mjs";

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
    step("transfer");
    t.set(db.collection("audit_log").doc(), { action: action === "execute" ? "transfer_executed" : "transfer_returned", actorId: actor.uid, actorName: actor.name || "", municipalityId: null,
      details: { transferId, resourceType: tr.resourceType, vehicleId: r.vehicleId, driverId: r.driverId, from: tr.fromMunicipalityId, to: tr.toMunicipalityId }, source: "server", createdAt: iso(now) });
    step("audit");
    return { already: false, status: statusPatch.status };
  });
}
export const TRANSFER_STEPS = ["vehicle", "profile", "user", "transfer", "audit"];
