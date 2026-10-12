/**
 * resourceGapEngine.js — proactive operational recommendations.
 * ─────────────────────────────────────────────────────────────────────
 * When the dispatch engine cannot serve a need (escalation) or can only serve
 * it later than the operational target, this module answers "what would fix
 * it?" — in a fixed order, cheapest measure first:
 *
 *   1. OPTIMIZE_EXISTING_ROUTES   wider insertion into running routes
 *   2. REDISTRIBUTE_TASKS         serve this before a lower-priority queued route
 *   3. DRIVER_FINISHING_SOON      reserve a driver who finishes a little later
 *   4. SHIFT_TIMING               a covering driver whose shift starts soon
 *   5. VEHICLE_REDISTRIBUTION     give an idle vehicle to a driver blocked by theirs
 *   6. INTER_MUNICIPALITY_SUPPORT referral to the Amanah (cross-municipality data)
 *   7. ADD_RESOURCES              one extra crew — only after 1–6
 *
 * Every "after" figure comes from re-running the real dispatch engine on an
 * isolated copy of the state with that single change; nothing is extrapolated.
 * Pure: no Firestore, no clock other than `now`.
 * ─────────────────────────────────────────────────────────────────────
 */
import { planDispatch, targetsOf, DEFAULT_DISPATCH_SETTINGS } from "./autoDispatchEngine.js";
import { driverOperationalState, DRIVER_STATES } from "./driverState.js";
import { haversineDistanceKm, estimateTravelMinutes } from "./decisionEngine.js";
import { normalizeNeighborhoodName } from "./config.js";
import { ASSUMPTIONS } from "./impact.js";

export const GAP_KINDS = ["no_driver", "too_far", "capacity", "no_vehicle", "out_of_scope"];

export const LADDER = [
  { code: "OPTIMIZE_EXISTING_ROUTES", title: "تحسين الجولات الحالية", authority: "موظف العمليات" },
  { code: "REDISTRIBUTE_TASKS", title: "إعادة توزيع المهام بين السائقين", authority: "موظف العمليات" },
  { code: "DRIVER_FINISHING_SOON", title: "الاستفادة من سائق ينهي جولته قريبًا", authority: "موظف العمليات" },
  { code: "SHIFT_TIMING", title: "تعديل التوقيت ضمن المناوبات", authority: "مدير البلدية" },
  { code: "VEHICLE_REDISTRIBUTION", title: "إعادة توزيع مركبة متاحة", authority: "مدير البلدية" },
  { code: "INTER_MUNICIPALITY_SUPPORT", title: "طلب دعم من بلدية أخرى", authority: "الأمانة" },
  { code: "ADD_RESOURCES", title: "زيادة الموارد", authority: "الأمانة" },
];

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Run the engine on a modified copy and read the outcome for the need's bins. */
function outcomeFor(state, settings, binIds, now) {
  const plan = planDispatch(state, { ...settings, mode: "auto" }, { now });
  const ids = new Set(binIds);
  const hits = plan.actions.filter((a) => (a.type === "create_assign" || a.type === "insert") && (a.binIds || []).some((id) => ids.has(id)));
  if (!hits.length) return null;
  const served = new Set(hits.flatMap((a) => a.binIds).filter((id) => ids.has(id)));
  const timeOf = (a) => {
    const c = (a.explanation?.constraints || []).find((x) => x.code === "CRITICAL_TARGET_MIN");
    if (c) return c.value;
    return a.type === "insert" ? a.explanation?.timing?.etaMin ?? null : a.etaMin ?? null;
  };
  const times = hits.map(timeOf).filter((x) => x != null);
  return { servedBins: served.size, allServed: served.size === ids.size, worstMin: times.length ? Math.max(...times) : null,
    driverNames: [...new Set(hits.map((a) => a.driverName).filter(Boolean))], confidence: hits[0].explanation?.selection?.confidence || "low" };
}

const firstStopOf = (bins, ids) => bins.find((b) => ids.includes(b.id) && b.lat != null) || null;

/**
 * @param {object} state     the municipality snapshot planDispatch used
 * @param {object} plan      planDispatch output
 * @param {object} settings  dispatch settings
 * @returns {{gaps: Array, extraActions: Array}}  gaps keyed by action key; extraActions = target-gap escalations to persist
 */
export function analyzeResourceGaps(state, plan, settings = {}, { now = Date.now() } = {}) {
  const S = { ...DEFAULT_DISPATCH_SETTINGS, ...settings };
  const T = targetsOf(S);
  const gaps = [];
  const extraActions = [];
  const nName = (nid) => state.neighborhoods?.find((n) => n.id === nid)?.name || "";
  const binById = new Map((state.bins || []).map((b) => [b.id, b]));

  const subjects = [
    ...plan.actions.filter((a) => a.type === "escalate" && GAP_KINDS.includes(a.kind)).map((a) => ({ action: a, kind: a.kind, beforeMin: null })),
    ...plan.actions.filter((a) => a.type === "create_assign" && a.targetMissed).map((a) => ({ action: a, kind: "target_gap", beforeMin: (a.explanation.constraints.find((c) => c.code === "CRITICAL_TARGET_MIN") || {}).value ?? a.etaMin })),
  ];

  for (const { action: a, kind, beforeMin } of subjects) {
    const nid = a.neighborhoodId;
    const key = normalizeNeighborhoodName(nName(nid));
    const binIds = a.binIds || [];
    const needBins = binIds.map((id) => binById.get(id)).filter(Boolean);
    const first = firstStopOf(state.bins || [], binIds);
    const wasteL = needBins.reduce((x, b) => x + Math.round((Number(b.capacityLiters) || 1100) * Math.min(100, Number(b.lastFillLevelPercent) || 0) / 100), 0);
    // Workload: straight-line path through the bins + service time.
    let km = 0; let prev = null;
    for (const b of needBins.filter((x) => x.lat != null)) { if (prev) km += haversineDistanceKm(prev.lat, prev.lng, b.lat, b.lng) ?? 0; prev = b; }
    const workloadMin = Math.round(estimateTravelMinutes(km || 0.0001) + needBins.length * ASSUMPTIONS.minutesPerStop);

    // Capacity snapshot from the real driver states.
    const states = (state.profiles || []).map((p) => ({ p, st: driverOperationalState(p, { vehicle: state.vehicles.find((v) => v.id === p.vehicleId), routes: state.routes, incidents: state.incidents, now, tzOffsetMin: S.tzOffsetMin }) }));
    const covering = states.filter((x) => (x.p.neighborhoodKeys || []).includes(key));
    const approachFrom = (pt) => (pt && first ? estimateTravelMinutes(haversineDistanceKm(pt.lat, pt.lng, first.lat, first.lng)) : null);
    const depot = state.depot || null;
    const byState = Object.fromEntries(Object.values(DRIVER_STATES).map((k) => [k, covering.filter((x) => x.st.state === k).length]));
    const availableVehicles = (state.vehicles || []).filter((v) => v.status === "available" && !state.routes.some((r) => ["approved", "in_progress"].includes(r.status) && r.vehicleId === v.id)).length;
    // Capacity that can act within the target: each covering working driver contributes target − (time until free + approach).
    let capacityWithinTargetMin = 0;
    for (const x of covering) {
      if (![DRIVER_STATES.AVAILABLE, DRIVER_STATES.ON_ROUTE].includes(x.st.state)) continue;
      const freeIn = x.st.state === DRIVER_STATES.ON_ROUTE ? x.st.finishInMin ?? T.criticalCollectionMin : 0;
      const origin = x.st.state === DRIVER_STATES.ON_ROUTE ? x.st.endPoint : (state.vehicles.find((v) => v.id === x.p.vehicleId)?.depotLat != null ? { lat: state.vehicles.find((v) => v.id === x.p.vehicleId).depotLat, lng: state.vehicles.find((v) => v.id === x.p.vehicleId).depotLng } : depot);
      const usable = T.criticalCollectionMin - freeIn - (approachFrom(origin) ?? T.criticalCollectionMin);
      capacityWithinTargetMin += Math.max(0, Math.min(usable, x.st.shift.known ? x.st.shift.minutesLeft : usable));
    }
    const gapMin = Math.max(0, workloadMin - capacityWithinTargetMin);

    const options = [];
    // afterMin undefined = not computable here (referral); null = computed, but the measure cannot serve the need.
    const push = (i, { afterMin, ...o }) => options.push({ step: i + 1, code: LADDER[i].code, title: LADDER[i].title, authority: LADDER[i].authority, ...o,
      expected: afterMin !== undefined ? { beforeMin, afterMin, targetMin: T.criticalCollectionMin, meetsTarget: afterMin != null && afterMin <= T.criticalCollectionMin } : null });
    const simulate = (mutate, extraSettings = {}) => { const st = clone({ ...state, contextFor: undefined }); st.contextFor = state.contextFor; mutate(st); return outcomeFor(st, { ...S, ...extraSettings }, binIds, now); };

    // 1. wider insertion into existing routes
    {
      const out = simulate(() => {}, { insertMaxAddedMin: S.insertMaxAddedMin * 2, insertMaxKm: S.insertMaxKm * 2 });
      const studied = (a.explanation?.alternatives || []).find((x) => x.option === "INSERT_EXISTING_ROUTE");
      push(0, out?.allServed
        ? { feasible: true, afterMin: out.worstMin, action: `السماح بانحراف حتى ${S.insertMaxAddedMin * 2} د لإدراج الحاويات في جولة ${out.driverNames.join("، ")}`, cause: `الإدراج الحالي محدود بـ ${S.insertMaxAddedMin} د انحراف`, confidence: out.confidence, constraints: ["يطيل الجولة القائمة", "يتطلب موافقة موظف العمليات"] }
        : { feasible: false, afterMin: null, cause: studied?.codes?.length ? `دُرست الجولات القائمة: ${studied.codes.join("، ")}` : "لا جولات قائمة قابلة للإدراج", action: null, confidence: null, constraints: [] });
    }
    // 2. serve this before a lower-priority queued (approved, not started) route of a covering driver
    {
      const needScore = needBins.reduce((x, b) => x + (Number(b.lastFillLevelPercent) || 0), 0) / Math.max(1, needBins.length);
      const queued = (state.routes || []).filter((r) => r.status === "approved" && covering.some((c) => c.p.uid === r.driverId) && !r.dispatch?.reservedAfterRouteId)
        .map((r) => ({ r, fill: (r.binIds || []).map((id) => Number(binById.get(id)?.lastFillLevelPercent) || 0).reduce((x, y) => x + y, 0) / Math.max(1, (r.binIds || []).length) }))
        .filter((x) => x.fill < needScore).sort((x, y) => x.fill - y.fill)[0];
      if (queued) {
        const out = simulate((st) => { st.routes = st.routes.filter((r) => r.id !== queued.r.id); });
        push(1, { feasible: !!out?.allServed, afterMin: out?.worstMin ?? null, action: `تقديم هذه الحاويات على ${queued.r.routeName} (متوسط امتلائها ${Math.round(queued.fill)}%) لدى ${queued.r.driverName || "السائق"}، ثم استكمالها بعدها`,
          cause: "سائق مغطٍّ للحي محجوز لجولة أقل أولوية لم تبدأ", confidence: out?.confidence || null, constraints: ["تتأخر الجولة الأقل أولوية"] });
      } else push(1, { feasible: false, afterMin: null, cause: "لا جولة معتمدة أقل أولوية لدى سائق يغطي الحي", action: null, confidence: null, constraints: [] });
    }
    // 3. a driver finishing a bit later than the reservation window
    {
      const onRoute = covering.filter((x) => x.st.state === DRIVER_STATES.ON_ROUTE && x.st.currentRoute && x.st.finishInMin != null).sort((x, y) => x.st.finishInMin - y.st.finishInMin)[0];
      if (onRoute) {
        const out = simulate(() => {}, { allowNextRouteReservation: true, reserveNextWithinMin: onRoute.st.finishInMin + 1 });
        push(2, { feasible: !!out?.allServed, afterMin: out?.worstMin ?? null, action: `حجز الجولة التالية لـ${onRoute.p.fullName} بعد إنهاء جولته الحالية (متوقع خلال ${onRoute.st.finishInMin} د)`,
          cause: `أقرب سائق في جولة ينهيها بعد ${onRoute.st.finishInMin} د، وحد الحجز التلقائي ${S.reserveNextWithinMin} د`, confidence: out?.confidence || null, constraints: ["تقدير زمن الإنهاء من التوقفات المتبقية"] });
      } else push(2, { feasible: false, afterMin: null, cause: "لا سائق يغطي الحي في جولة جارية", action: null, confidence: null, constraints: [] });
    }
    // 4. shift timing: a covering driver whose shift starts soon
    {
      const soon = covering.filter((x) => x.st.state === DRIVER_STATES.OFF_SHIFT && x.st.shift.known && x.st.shift.startsInMin > 0 && x.st.shift.startsInMin <= T.criticalCollectionMin * 2)
        .sort((x, y) => x.st.shift.startsInMin - y.st.shift.startsInMin)[0];
      if (soon) {
        const v = state.vehicles.find((x) => x.id === soon.p.vehicleId);
        const ap = approachFrom(v?.depotLat != null ? { lat: v.depotLat, lng: v.depotLng } : depot);
        const after = ap != null ? soon.st.shift.startsInMin + ap + workloadMin : null;
        push(3, { feasible: after != null, afterMin: after != null ? soon.st.shift.startsInMin + ap : null, action: `تقديم بداية مناوبة ${soon.p.fullName} أو إسناد الجولة له عند بدايتها (تبدأ خلال ${soon.st.shift.startsInMin} د)`,
          cause: "سائق يغطي الحي خارج المناوبة الآن", confidence: "medium", constraints: ["يتطلب موافقة السائق والمشرف على تعديل المناوبة"] });
      } else push(3, { feasible: false, afterMin: null, cause: "لا مناوبة لسائق مغطٍّ تبدأ قريبًا", action: null, confidence: null, constraints: [] });
    }
    // 5. vehicle redistribution: a working covering driver blocked only by their vehicle + an idle vehicle
    {
      const blocked = covering.find((x) => x.st.state === DRIVER_STATES.VEHICLE_FAULT && !x.st.codes.some((c) => ["OFF_SHIFT", "SHIFT_ENDED", "ACCOUNT_INACTIVE", "DRIVER_UNAVAILABLE"].includes(c)));
      const idle = (state.vehicles || []).find((v) => v.status === "available" && !state.profiles.some((p) => p.vehicleId === v.id && p.shiftStatus === "on_shift" && p.uid !== blocked?.p.uid) && !state.routes.some((r) => ["approved", "in_progress"].includes(r.status) && r.vehicleId === v.id));
      if (blocked && idle) {
        const out = simulate((st) => { const p = st.profiles.find((x) => x.uid === blocked.p.uid); p.vehicleId = idle.id; });
        push(4, { feasible: !!out?.allServed, afterMin: out?.worstMin ?? null, action: `ربط المركبة ${idle.vehicleNumber || idle.id} بالسائق ${blocked.p.fullName}`,
          cause: `${blocked.p.fullName} في المناوبة لكن ${blocked.st.codes.includes("NO_VEHICLE") ? "بلا مركبة" : "مركبته متعطلة"}`, confidence: out?.confidence || null, constraints: ["يتحقق من خلو المركبة من إسناد آخر"] });
      } else push(4, { feasible: false, afterMin: null, cause: blocked ? "لا مركبة متاحة غير مسندة" : "لا سائق مغطٍّ معطّل بسبب المركبة فقط", action: null, confidence: null, constraints: [] });
    }
    // 6. other municipalities — the decision and the data are the Amanah's
    push(5, { feasible: null, afterMin: undefined, action: "عرض الحالة على الأمانة لدراسة نقل طاقم أو مركبة (تُحسب الأولوية والأثر على البلديتين في بوابة الأمانة)", cause: "القدرة داخل البلدية لا تكفي ضمن القيود", confidence: null, constraints: ["النقل بين البلديات يتطلب اعتماد الأمانة"], referral: true });
    // 7. one extra crew — simulated with the same engine and constraints
    {
      const caps = (state.vehicles || []).map((v) => Number(v.capacityLiters)).filter(Boolean).sort((x, y) => x - y);
      const medianCap = caps.length ? caps[Math.floor(caps.length / 2)] : 6000;
      // A virtual crew starts from a real depot only — never from the bins themselves (that would understate the time).
      const vd = (state.vehicles || []).find((v) => v.depotLat != null);
      const start = depot || (vd ? { lat: vd.depotLat, lng: vd.depotLng } : null);
      const out = start ? simulate((st) => {
        st.vehicles.push({ id: "sim-crew-vehicle", vehicleNumber: "مركبة إضافية (محاكاة)", status: "available", capacityLiters: medianCap, depotLat: start.lat, depotLng: start.lng, municipalityId: state.municipalityId, simulated: true });
        st.profiles.push({ uid: "sim-crew-driver", fullName: "سائق إضافي (محاكاة)", accountStatus: "active", shiftStatus: "on_shift", availability: "available", vehicleId: "sim-crew-vehicle", neighborhoodKeys: [key], municipalityId: state.municipalityId, simulated: true });
      }) : null;
      push(6, { feasible: !!out?.allServed, afterMin: out?.worstMin ?? null, action: `إضافة طاقم واحد (سائق + مركبة بسعة ${medianCap} لتر) يغطي ${nName(nid)} خلال فترة الذروة`,
        cause: gapMin > 0 ? `حجم العمل ${workloadMin} د يتجاوز القدرة المتاحة ضمن الهدف (${capacityWithinTargetMin} د)` : "لا قدرة مؤهلة متاحة الآن", confidence: out ? "medium" : null,
        constraints: ["محاكاة: انطلاق من مستودع البلدية وتقدير المسافة جويًا", "قرار تكلفة يتطلب اعتماد الأمانة"], simulated: true });
    }

    const meets = options.filter((o) => o.feasible && o.expected?.meetsTarget);
    const improving = options.filter((o) => o.feasible && o.expected?.afterMin != null).sort((x, y) => x.expected.afterMin - y.expected.afterMin);
    const recommended = meets[0] || improving[0] || options.find((o) => o.referral) || null;

    const gap = {
      v: 1, kind, neighborhoodId: nid, neighborhoodName: nName(nid), decidedAt: new Date(now).toISOString(),
      problem: kind === "target_gap" ? `الجمع المتوقع للحاويات الحرجة في ${nName(nid)} بعد ${beforeMin} د، والهدف ${T.criticalCollectionMin} د` : `${binIds.length} حاوية في ${nName(nid)} تحتاج جمعًا ولا يوجد إسناد ممكن ضمن القيود`,
      demand: { binsCount: binIds.length, wasteL, workloadMin },
      capacity: { coveringDrivers: covering.length, byState, availableVehicles, capacityWithinTargetMin },
      targetMin: T.criticalCollectionMin, beforeMin, gapMin, missingCrews: gapMin > 0 ? Math.ceil(gapMin / T.criticalCollectionMin) : 0,
      options, recommendedStep: recommended?.step ?? null,
      basis: "محاكاة بمحرك الإسناد نفسه على نسخة معزولة من الحالة؛ الأزمنة تقديرية بالمسافة الجوية ما لم يُذكر غير ذلك",
    };
    gaps.push({ key: a.key, gap });
    if (kind === "target_gap") extraActions.push({ type: "escalate", kind: "target_gap", key: `esc_target_gap_${a.key}`, neighborhoodId: nid, binIds, routeId: null, gap,
      reason: gap.problem, suggestion: recommended ? `${recommended.title}: ${recommended.action}` : "راجع الموارد المتاحة",
      explanation: { ...a.explanation, decisionType: "ESCALATION", escalationKind: "target_gap" } });
  }
  return { gaps, extraActions };
}
