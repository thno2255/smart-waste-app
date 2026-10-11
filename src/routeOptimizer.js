/**
 * routeOptimizer.js — Phase 3: best visiting order for ONE vehicle's route.
 * ─────────────────────────────────────────────────────────────────────
 * A capacitated, priority-aware single-vehicle routing solver sized for this
 * system (≤ ~50 stops per route): construction heuristic + local search
 * (2-opt and Or-opt) over a TIME matrix. The matrix comes from OSRM's table
 * service when the caller supplies it (real roads, one-way streets, turn
 * costs); otherwise a Haversine/average-speed matrix is used and the result
 * says so through `confidence` and `constraints`.
 *
 * Objective (minimized):  total drive time
 *                        + Σ_stop  weight(priority) × arrival time at stop
 * so critical bins are pulled early without ignoring geometry — a plain
 * nearest-neighbor order is only the starting point, never the answer.
 *
 * Capacity: if the load exceeds the vehicle, stops are split into trips with
 * a return to the dump site WHEN one is defined; otherwise the lowest-priority
 * stops are deferred and the limitation is reported — never hidden.
 *
 * OR-Tools is deliberately not used: it cannot run in the browser, and for
 * this route size a deterministic local search is verifiable and fast. The
 * solver is isolated so a server-side OR-Tools solve could replace it later.
 * ─────────────────────────────────────────────────────────────────────
 */
import { haversineDistanceKm, estimateTravelMinutes } from "./decisionEngine";
import { ASSUMPTIONS } from "./impact";

/** Priority weight on arrival time (minutes of "lateness cost" per minute of arrival). */
export const PRIORITY_WEIGHTS = { critical: 0.35, high: 0.15, medium: 0.05, warning: 0.05, low: 0, normal: 0 };

/** Haversine-based fallback matrix: durations (min) and distances (km). */
export function haversineMatrix(points) {
  const n = points.length;
  const durations = Array.from({ length: n }, () => Array(n).fill(0));
  const distances = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const km = haversineDistanceKm(points[i].lat, points[i].lng, points[j].lat, points[j].lng) ?? 0;
    distances[i][j] = km;
    durations[i][j] = estimateTravelMinutes(km);
  }
  return { durations, distances, source: "haversine" };
}

/** Total cost of an order (indices into matrix; index 0 = start). */
function evaluate(order, m, stops, serviceMin, weights) {
  let t = 0, drive = 0, km = 0, lateness = 0, prev = 0;
  for (const idx of order) {
    t += m.durations[prev][idx]; drive += m.durations[prev][idx]; km += m.distances[prev][idx];
    lateness += (weights[stops[idx - 1].priorityTier] ?? 0) * t;
    t += serviceMin; prev = idx;
  }
  return { cost: drive + lateness, driveMin: drive, km, finishMin: t, lateness };
}

/** Priority-biased nearest-neighbor construction. */
function construct(stopCount, m, stops, weights) {
  const remaining = Array.from({ length: stopCount }, (_, i) => i + 1);
  const order = [];
  let prev = 0;
  while (remaining.length) {
    let best = 0, bestVal = Infinity;
    remaining.forEach((idx, k) => {
      const v = m.durations[prev][idx] * (1 - 0.6 * (weights[stops[idx - 1].priorityTier] ?? 0) / 0.35);
      if (v < bestVal) { bestVal = v; best = k; }
    });
    prev = remaining.splice(best, 1)[0];
    order.push(prev);
  }
  return order;
}

/** 2-opt + Or-opt local search on the full objective. Deterministic, bounded. */
function improve(order, m, stops, serviceMin, weights, maxPasses = 50) {
  let best = order.slice();
  let bestCost = evaluate(best, m, stops, serviceMin, weights).cost;
  let improved = true, passes = 0;
  while (improved && passes++ < maxPasses) {
    improved = false;
    const n = best.length;
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {           // 2-opt: reverse segment
      const cand = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
      const c = evaluate(cand, m, stops, serviceMin, weights).cost;
      if (c < bestCost - 1e-9) { best = cand; bestCost = c; improved = true; }
    }
    for (let len = 1; len <= 3; len++) for (let i = 0; i + len <= best.length; i++) {  // Or-opt: move a segment
      const seg = best.slice(i, i + len), rest = best.slice(0, i).concat(best.slice(i + len));
      for (let k = 0; k <= rest.length; k++) {
        if (k === i) continue;
        const cand = rest.slice(0, k).concat(seg, rest.slice(k));
        const c = evaluate(cand, m, stops, serviceMin, weights).cost;
        if (c < bestCost - 1e-9) { best = cand; bestCost = c; improved = true; }
      }
    }
  }
  return best;
}

/**
 * @param {object} input
 * @param {{lat:number,lng:number,label?:string}} input.start  vehicle/driver origin
 * @param {Array<{binId:string,binName:string,lat:number,lng:number,priorityTier:string,priorityScore?:number,wasteLiters?:number}>} input.stops
 * @param {number|null} [input.capacityLiters]
 * @param {{lat:number,lng:number,label?:string}|null} [input.dumpSite]
 * @param {{durations:number[][],distances:number[][],source:string}} [input.matrix]  index 0=start, 1..n=stops, n+1=dumpSite (if given)
 * @param {{startAt?:string|number, shiftEnd?:string|number}} [input.timeWindow]
 * @param {number} [input.serviceMinutesPerStop]
 */
export function optimizeRoute(input) {
  const { start, stops: rawStops = [], capacityLiters = null, dumpSite = null, timeWindow = {}, serviceMinutesPerStop = ASSUMPTIONS.minutesPerStop } = input;
  const constraints = [];
  const withCoords = rawStops.filter((s) => s.lat != null && s.lng != null);
  const noCoords = rawStops.filter((s) => s.lat == null || s.lng == null);
  if (noCoords.length) constraints.push(`${noCoords.length} حاوية بلا إحداثيات — أُلحقت في نهاية الترتيب بلا تحسين`);
  if (!start || start.lat == null) return { ok: false, constraints: ["لا توجد نقطة انطلاق (موقع سائق/مستودع)"], orderedStops: rawStops.map((s, i) => ({ ...s, order: i + 1 })) };
  if (withCoords.length === 0) return { ok: false, constraints: [...constraints, "لا توجد توقفات بإحداثيات"], orderedStops: rawStops.map((s, i) => ({ ...s, order: i + 1 })) };

  const points = [start, ...withCoords, ...(dumpSite ? [dumpSite] : [])];
  const matrix = input.matrix && input.matrix.durations?.length === points.length ? input.matrix : haversineMatrix(points);
  if (matrix.source !== "osrm") constraints.push("مصفوفة الأزمنة تقديرية (مسافة جوية ÷ " + ASSUMPTIONS.avgUrbanSpeedKmh + " كم/س) — لا بيانات طرق فعلية");
  const weights = PRIORITY_WEIGHTS;
  const n = withCoords.length;
  const dumpIdx = dumpSite ? n + 1 : null;

  // ── Capacity: which stops fit in one trip; the rest → second trip via dump site, or deferred.
  const totalWaste = withCoords.reduce((a, s) => a + (Number(s.wasteLiters) || 0), 0);
  let tripStops = withCoords, deferred = [];
  let trips = 1;
  if (capacityLiters == null || !(capacityLiters > 0)) constraints.push("سعة المركبة غير معروفة — لم يُطبَّق قيد الحمولة");
  else if (totalWaste > capacityLiters) {
    if (dumpSite) {
      trips = Math.ceil(totalWaste / capacityLiters);
      constraints.push(`الحمولة ${Math.round(totalWaste)} لتر تتجاوز السعة ${capacityLiters} لتر — تُقسَّم إلى ${trips} رحلات مع تفريغ في ${dumpSite.label || "نقطة التفريغ"}`);
    } else {
      // keep the highest-priority stops that fit; defer the rest, say so.
      const sorted = [...withCoords].sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
      let load = 0; tripStops = []; deferred = [];
      for (const s of sorted) { const w = Number(s.wasteLiters) || 0; if (load + w <= capacityLiters) { load += w; tripStops.push(s); } else deferred.push(s); }
      constraints.push(`الحمولة ${Math.round(totalWaste)} لتر تتجاوز السعة ${capacityLiters} لتر ولا توجد نقطة تفريغ معرفة — ${deferred.length} حاوية أُجّلت (الأقل أولوية)`);
    }
  }

  // ── Solve on the trip stops (indices refer to `points`).
  const idxOf = new Map(withCoords.map((s, i) => [s.binId, i + 1]));
  const sub = tripStops.map((s) => idxOf.get(s.binId));
  const subStops = withCoords; // evaluate() looks up stops[idx-1]
  const initial = construct(n, matrix, subStops, weights).filter((i) => sub.includes(i));
  const initialEval = evaluate(initial, matrix, subStops, serviceMinutesPerStop, weights);
  const improved = improve(initial, matrix, subStops, serviceMinutesPerStop, weights);
  const finalEval = evaluate(improved, matrix, subStops, serviceMinutesPerStop, weights);

  // ── Insert dump returns when the load crosses capacity (multi-trip).
  const legs = [];
  const ordered = [];
  let load = 0, prev = 0, t = 0, km = 0, returns = 0;
  for (const idx of improved) {
    const s = withCoords[idx - 1];
    const w = Number(s.wasteLiters) || 0;
    if (dumpIdx != null && capacityLiters > 0 && load + w > capacityLiters && load > 0) {
      t += matrix.durations[prev][dumpIdx]; km += matrix.distances[prev][dumpIdx];
      legs.push({ from: prev, to: dumpIdx, km: matrix.distances[prev][dumpIdx], min: matrix.durations[prev][dumpIdx], type: "dump" });
      ordered.push({ type: "dump", label: dumpSite.label || "تفريغ", lat: dumpSite.lat, lng: dumpSite.lng, arrivalMin: Math.round(t), order: ordered.length + 1 });
      load = 0; prev = dumpIdx; returns += 1;
    }
    t += matrix.durations[prev][idx]; km += matrix.distances[prev][idx];
    legs.push({ from: prev, to: idx, km: matrix.distances[prev][idx], min: matrix.durations[prev][idx], type: "stop" });
    load += w;
    ordered.push({ ...s, type: "stop", order: ordered.length + 1, arrivalMin: Math.round(t), loadAfterLiters: Math.round(load), hasCoords: true });
    t += serviceMinutesPerStop; prev = idx;
  }
  noCoords.forEach((s) => ordered.push({ ...s, type: "stop", order: ordered.length + 1, arrivalMin: null, hasCoords: false }));

  // ── Shift window check.
  let finishAt = null, overrunMin = 0;
  if (timeWindow.startAt) {
    finishAt = new Date(new Date(timeWindow.startAt).getTime() + t * 60000).toISOString();
    if (timeWindow.shiftEnd) {
      overrunMin = Math.round((new Date(finishAt).getTime() - new Date(timeWindow.shiftEnd).getTime()) / 60000);
      if (overrunMin > 0) constraints.push(`الانتهاء المتوقع يتجاوز نهاية المناوبة بـ ${overrunMin} دقيقة`);
      else overrunMin = 0;
    }
  }

  const realCoords = withCoords.every((s) => !s.approximate);
  const confidence = matrix.source === "osrm" && realCoords && capacityLiters > 0 ? "high" : matrix.source === "osrm" || realCoords ? "medium" : "low";
  const improvementPct = initialEval.cost > 0 ? Math.round((1 - finalEval.cost / initialEval.cost) * 100) : 0;

  return {
    ok: true,
    orderedStops: ordered,
    legs,
    totalDistanceKm: Math.round(km * 10) / 10,
    driveMin: Math.round(t - ordered.filter((o) => o.type === "stop" && o.hasCoords).length * serviceMinutesPerStop),
    totalDurationMin: Math.round(t),
    serviceMin: ordered.filter((o) => o.type === "stop" && o.hasCoords).length * serviceMinutesPerStop,
    estimatedWasteLiters: Math.round(tripStops.reduce((a, s) => a + (Number(s.wasteLiters) || 0), 0)),
    deferredStops: deferred.map((s, i) => ({ ...s, order: i + 1 })),
    trips: returns + 1,
    finishAt, overrunMin,
    confidence,
    constraints,
    matrixSource: matrix.source,
    objective: { initialCost: Math.round(initialEval.cost), finalCost: Math.round(finalEval.cost), improvementPct, latenessCost: Math.round(finalEval.lateness) },
    assumptions: { minutesPerStop: serviceMinutesPerStop, avgUrbanSpeedKmh: ASSUMPTIONS.avgUrbanSpeedKmh, priorityWeights: weights },
  };
}

/** Compare a stored order with the optimized one on the same matrix (for the "before/after" card). */
export function evaluateOrder(start, stops, matrix, serviceMinutesPerStop = ASSUMPTIONS.minutesPerStop) {
  const withCoords = stops.filter((s) => s.lat != null && s.lng != null);
  const points = [start, ...withCoords];
  const m = matrix && matrix.durations?.length >= points.length ? matrix : haversineMatrix(points);
  const order = withCoords.map((_, i) => i + 1);
  const e = evaluate(order, m, withCoords, serviceMinutesPerStop, PRIORITY_WEIGHTS);
  return { km: Math.round(e.km * 10) / 10, driveMin: Math.round(e.driveMin), totalMin: Math.round(e.finishMin), cost: Math.round(e.cost) };
}
