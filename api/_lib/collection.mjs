// Server-side collection confirmation. The ONLY path that records an emptying: rules deny drivers any direct
// write to collection_events, bins.lastCollectionAt and collection_routes.collectedBinIds.
// Everything is re-validated inside ONE Firestore transaction; the event id is routeId__binId, so a retry
// (double tap, offline replay) returns the existing confirmation without writing again.
import { FieldValue } from "firebase-admin/firestore";
import { iso } from "./http.mjs";

// httpStatus, not `code`: the Firestore SDK reads error.code as a gRPC status when deciding transaction retries.
export class ConfirmError extends Error { constructor(httpStatus, message) { super(message); this.httpStatus = httpStatus; } }
const STEPS = ["validated", "event", "route", "bin", "audit"];

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ driver: {uid,name,role,municipalityId}, routeId: string, binId: string, clientConfirmedAt?: string, position?: {lat,lng,accuracy} }} input
 * @param {{ failAt?: string, now?: number }} [opts]  failAt is a TEST hook (never reachable from HTTP)
 */
export async function confirmCollectionServer(db, input, { failAt = null, now = Date.now() } = {}) {
  const { driver, routeId, binId } = input;
  const eventId = `${routeId}__${binId}`;
  const routeRef = db.collection("collection_routes").doc(routeId);
  const eventRef = db.collection("collection_events").doc(eventId);
  const binRef = db.collection("bins").doc(binId);
  const step = (name) => { if (failAt === name) throw new Error(`INJECTED_FAILURE:${name}`); };
  return db.runTransaction(async (t) => {
    const [routeSnap, eventSnap, binSnap] = await t.getAll(routeRef, eventRef, binRef);
    if (!routeSnap.exists) throw new ConfirmError(404, "الجولة غير موجودة");
    const route = routeSnap.data();
    if (route.driverId !== driver.uid) throw new ConfirmError(403, "هذه الجولة غير مسندة لك");
    // Idempotent replay: the same driver, the same stop → return the existing confirmation untouched.
    if (eventSnap.exists) {
      if (eventSnap.get("driverId") !== driver.uid) throw new ConfirmError(409, "سُجّل تفريغ هذه الحاوية من سائق آخر");
      return { duplicate: true, eventId, confirmedAt: eventSnap.get("confirmedAt") };
    }
    if (route.status !== "in_progress") throw new ConfirmError(409, route.status === "approved" ? "ابدأ الجولة قبل تأكيد التفريغ" : "الجولة ليست جارية");
    const onRoute = (route.binIds || []).includes(binId) || (route.orderedStops || []).some((s) => s.binId === binId);
    if (!onRoute) throw new ConfirmError(409, "الحاوية ليست ضمن جولتك");
    if ((route.collectedBinIds || []).includes(binId)) return { duplicate: true, eventId };
    if ((route.skippedStops || []).some((s) => s.binId === binId)) throw new ConfirmError(409, "هذا التوقف متخطى ببلاغ — أعده للجولة أولًا");
    if (!binSnap.exists) throw new ConfirmError(404, "الحاوية غير موجودة");
    const bin = binSnap.data();
    if (route.municipalityId && bin.municipalityId && bin.municipalityId !== route.municipalityId) throw new ConfirmError(409, "الحاوية خارج بلدية الجولة");
    // Vehicle and driver are still valid for this route.
    if (!route.vehicleId) throw new ConfirmError(409, "لا مركبة مسندة للجولة");
    const [vehSnap, profSnap] = await Promise.all([t.get(db.collection("vehicles").doc(route.vehicleId)), t.get(db.collection("driver_profiles").doc(driver.uid))]);
    if (!vehSnap.exists) throw new ConfirmError(409, "مركبة الجولة غير موجودة");
    const veh = vehSnap.data();
    if (veh.status === "maintenance" || veh.status === "offline") throw new ConfirmError(409, `مركبة الجولة ${veh.status === "maintenance" ? "في الصيانة" : "غير متصلة"}`);
    const holds = veh.driverId === driver.uid || (profSnap.exists && profSnap.get("vehicleId") === route.vehicleId);
    if (!holds) throw new ConfirmError(409, "المركبة غير مرتبطة بك");
    step("validated");

    // Client time only if plausible (offline replay): not in the future, not before the route started, within 24h.
    const started = route.startedAt ? new Date(route.startedAt).getTime() : 0;
    const c = input.clientConfirmedAt ? new Date(input.clientConfirmedAt).getTime() : NaN;
    const confirmedAt = Number.isFinite(c) && c <= now + 60000 && c >= started && now - c < 86400000 ? iso(c) : iso(now);
    const pos = input.position && Number.isFinite(input.position.lat) && Number.isFinite(input.position.lng) ? { lat: input.position.lat, lng: input.position.lng, accuracyM: Number.isFinite(input.position.accuracy) ? input.position.accuracy : null } : null;
    const distanceToBinM = pos && bin.lat != null ? Math.round(Math.hypot((pos.lat - bin.lat) * 111320, (pos.lng - bin.lng) * 111320 * Math.cos((bin.lat * Math.PI) / 180))) : null;

    t.create(eventRef, { id: eventId, routeId, binId, municipalityId: route.municipalityId || bin.municipalityId || null, vehicleId: route.vehicleId, driverId: driver.uid, operatorId: driver.uid, driverName: driver.name || "",
      fillBefore: Number(bin.lastFillLevelPercent) || 0, fillAfter: null, source: "route", confirmedAt, collectedAt: confirmedAt, receivedAt: iso(now), confirmLocation: pos, distanceToBinM,
      demo: !!(bin.demo || bin.simulated), verifiedBy: "server", createdAt: iso(now) });
    step("event");
    t.update(routeRef, { collectedBinIds: FieldValue.arrayUnion(binId), lastProgressAt: iso(now), updatedAt: iso(now) });
    step("route");
    // An emptying restarts the heat-hygiene clock of the bin.
    t.update(binRef, { lastCollectionAt: confirmedAt, thermalExposureDD: 0, thermalExposureAt: confirmedAt });
    step("bin");
    t.set(db.collection("audit_log").doc(), { action: "bin_collected", actorId: driver.uid, actorName: driver.name || "", municipalityId: route.municipalityId || null, details: { routeId, binId, distanceToBinM }, source: "server", createdAt: iso(now) });
    step("audit");
    return { duplicate: false, eventId, confirmedAt };
  });
}
export { STEPS as CONFIRM_STEPS };
