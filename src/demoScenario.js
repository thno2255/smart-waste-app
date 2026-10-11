/**
 * demoScenario.js — Phase 5: the judging-panel walkthrough as data + pure checks.
 * ─────────────────────────────────────────────────────────────────────
 * Twelve steps from "the city" to "updated indicators". Some steps are
 * ACTIONS the panel performs (fire events, generate routes, approve); others
 * are OBSERVATIONS that complete automatically when live data shows them
 * (the driver started, bins were emptied, indicators changed). State lives in
 * Firestore (demo_sessions/current) so a page refresh never loses the place.
 * ─────────────────────────────────────────────────────────────────────
 */
import { routeProgress } from "./executionEngine";

export const DEMO_STEPS = [
  { key: "city",       title: "عرض مدينة بريدة وبلدياتها الست",             kind: "nav",     hint: "افتح صفحة البلديات والنطاقات" },
  { key: "pick",       title: "اختيار بلدية للعرض",                           kind: "choose",  hint: "اختر البلدية (الافتراضي: شرق بريدة)" },
  { key: "show",       title: "ظهور أحياء البلدية وحاوياتها على الخريطة",    kind: "observe", hint: "تظهر الأحياء المُسندة وحاوياتها المحاكاة" },
  { key: "fill",       title: "ارتفاع امتلاء عدة حاويات",                     kind: "action",  hint: "يولّد المحاكي 3 أحداث امتلاء حرج داخل البلدية" },
  { key: "detect",     title: "اكتشاف الحاويات الحرجة",                       kind: "observe", hint: "محرك الأولوية يصنّف الحاويات ≥85% حرجة" },
  { key: "route",      title: "اقتراح جولة محسوبة",                           kind: "action",  hint: "محرك القرار يقترح جولة للحي الأكثر احتياجًا ثم يُحسّن ترتيبها" },
  { key: "driver",     title: "ترشيح السائق المناسب",                         kind: "action",  hint: "محرك الإسناد يرشّح سائقًا بالنطاق والمناوبة والسعة وزمن الوصول" },
  { key: "approve",    title: "اعتماد المهمة من المدير",                      kind: "action",  hint: "يعتمد المدير الإسناد فتصل المهمة لحساب السائق" },
  { key: "inbox",      title: "ظهور المهمة في حساب السائق",                   kind: "observe", hint: "افتح بوابة السائق على جوال/نافذة ثانية — تظهر الجولة المعتمدة" },
  { key: "navigate",   title: "تشغيل المسار على الخريطة",                     kind: "observe", hint: "يبدأ السائق الجولة فيظهر المسار والملاحة ويُبث موقعه" },
  { key: "collect",    title: "تنفيذ التفريغ",                                kind: "observe", hint: "يؤكد السائق التفريغ؛ يسجَّل حدث تفريغ وتصدر قراءة محاكاة بالتفريغ" },
  { key: "indicators", title: "تحديث مؤشرات البلدية والمدينة",                kind: "observe", hint: "تنخفض الحاويات الحرجة وتتحدث لوحة المدير" },
];

export const DEFAULT_DEMO_MUNICIPALITY = "east";

/**
 * Pure evaluation of the observe-steps from live data.
 * @param {object} session  { municipalityId, routeId, driverId, criticalBefore }
 * @param {object} live     { bins, routes, profiles, events }
 */
export function evaluateDemo(session, live) {
  const mid = session?.municipalityId || null;
  const munBins = (live.bins || []).filter((b) => b.municipalityId === mid);
  const critical = munBins.filter((b) => Number(b.lastFillLevelPercent) >= 85 && Number(b.lastFillLevelPercent) <= 100).length;
  const route = (live.routes || []).find((r) => r.id === session?.routeId) || null;
  const driver = (live.profiles || []).find((p) => p.uid === session?.driverId) || null;
  const progress = route ? routeProgress(route) : null;
  const emptiedReadings = (live.readings || []).filter((r) => r.reason === "emptied").length;
  // Indicator check is per ROUTE (the bins the driver was sent to), so other bins filling up meanwhile never masks the effect.
  const routeBinIds = new Set(route?.binIds || []);
  const routeCritical = munBins.filter((b) => routeBinIds.has(b.id) && Number(b.lastFillLevelPercent) >= 85 && Number(b.lastFillLevelPercent) <= 100).length;
  const before = session?.routeCriticalBefore ?? session?.criticalBefore ?? null;
  const after = session?.routeCriticalBefore != null ? routeCritical : critical;
  // The indicator step is proven by the collected bins themselves: a confirmed stop whose simulated
  // sensor now reports an emptied level (<60%). Other bins filling up meanwhile cannot mask it.
  const collectedIds = new Set(route?.collectedBinIds || []);
  const emptiedCollected = munBins.filter((b) => collectedIds.has(b.id) && Number(b.lastFillLevelPercent) < 60).length;
  return {
    show:       { done: munBins.length > 0, detail: `${munBins.length} حاوية محاكاة في البلدية` },
    detect:     { done: critical > 0, detail: `${critical} حاوية حرجة الآن` },
    route:      { done: !!route, detail: route ? `${route.routeName} — ${route.binIds?.length || 0} حاوية${route.optimization ? " (مُحسّنة)" : ""}` : "لا جولة بعد" },
    driver:     { done: !!session?.recommendedDriverName, detail: session?.recommendedDriverName ? `المرشح: ${session.recommendedDriverName}` : "لم يُرشَّح بعد" },
    approve:    { done: !!route && ["approved", "in_progress", "completed"].includes(route.status), detail: route ? `حالة الجولة: ${route.status}` : "" },
    inbox:      { done: !!route && !!route.driverId && ["approved", "in_progress", "completed"].includes(route.status), detail: route?.driverName ? `مسندة إلى ${route.driverName}` : "" },
    navigate:   { done: !!route && ["in_progress", "completed"].includes(route.status), detail: route?.status === "in_progress" ? `السائق بدأ · ${driver?.lastLocation ? "موقع مباشر يُبث" : "بانتظار الموقع"}` : route?.status === "completed" ? "اكتملت" : "بانتظار بدء السائق" },
    collect:    { done: !!progress && progress.collected > 0, detail: progress ? `${progress.collected}/${progress.total} جُمعت` : "" },
    indicators: { done: emptiedCollected > 0 || (before != null && after < before), detail: before != null ? `حرجة في الجولة: ${before} ← ${after} · مُفرَّغة ومؤكدة بقراءة: ${emptiedCollected} · حرجة في البلدية الآن: ${critical}` : "" },
    critical, routeCritical, munBins: munBins.length, liveRoute: route, progress, emptiedReadings,
  };
}

/**
 * Index of the first step that is not yet complete. Completion is MONOTONIC:
 * once the panel has seen a step pass it records it in session.completedKeys,
 * so a later state change (e.g. critical count dropping after emptying) never
 * un-completes an earlier step.
 */
export function nextStepIndex(session, evaluation) {
  const passed = new Set(session?.completedKeys || []);
  const live = {
    city: !!session?.visitedCity, pick: !!session?.municipalityId, show: evaluation.show.done,
    fill: (session?.firedEvents || 0) >= 3, detect: evaluation.detect.done, route: evaluation.route.done, driver: evaluation.driver.done,
    approve: evaluation.approve.done, inbox: evaluation.inbox.done, navigate: evaluation.navigate.done, collect: evaluation.collect.done, indicators: evaluation.indicators.done,
  };
  const doneByKey = Object.fromEntries(Object.entries(live).map(([k, v]) => [k, v || passed.has(k)]));
  const i = DEMO_STEPS.findIndex((s) => !doneByKey[s.key]);
  const newlyPassed = Object.keys(live).filter((k) => live[k] && !passed.has(k));
  return { index: i < 0 ? DEMO_STEPS.length : i, doneByKey, newlyPassed };
}
