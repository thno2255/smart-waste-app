/**
 * demoScenario.js — the judging-panel walkthrough as data + pure checks.
 * ─────────────────────────────────────────────────────────────────────
 * Twenty-one steps from "the city" through the Amanah, operations, the driver,
 * a simulated shortage and an inter-municipality transfer to "updated city KPIs". Some steps are
 * ACTIONS the panel performs (fire events, generate routes, approve); others
 * are OBSERVATIONS that complete automatically when live data shows them
 * (the driver started, bins were emptied, indicators changed). State lives in
 * Firestore (demo_sessions/current) so a page refresh never loses the place.
 * ─────────────────────────────────────────────────────────────────────
 */
import { routeProgress } from "./executionEngine";

export const DEMO_STEPS = [
  { key: "city",            title: "عرض مدينة بريدة وبلدياتها الست",                 kind: "nav",     hint: "افتح صفحة البلديات والنطاقات" },
  { key: "amanah",          title: "لوحة الأمانة: مقارنة ضغط البلديات",              kind: "nav",     hint: "بوابة متخذي القرار → القيادة الاستراتيجية: الضغط التشغيلي لكل بلدية ومصدره" },
  { key: "pick",            title: "اختيار بلدية للعرض",                               kind: "choose",  hint: "اختر البلدية (الافتراضي: شرق بريدة)" },
  { key: "show",            title: "ظهور أحياء البلدية وحاوياتها على الخريطة",        kind: "observe", hint: "تظهر الأحياء المُسندة وحاوياتها المحاكاة" },
  { key: "fill",            title: "ارتفاع امتلاء عدة حاويات",                         kind: "action",  hint: "يولّد المحاكي 3 أحداث امتلاء حرج داخل البلدية" },
  { key: "detect",          title: "اكتشاف الحاويات الحرجة",                           kind: "observe", hint: "محرك الأولوية يصنّف الحاويات ≥85% حرجة" },
  { key: "predict",         title: "التنبؤ بالامتلاء من سلسلة القراءات",               kind: "observe", hint: "محرك التنبؤ يحتاج قراءتين فأكثر بعد آخر تفريغ؛ يظهر في «العقل التشغيلي → ماذا سيحدث؟»" },
  { key: "plan",            title: "إنشاء خطة الجمع الذكية للبلدية",                   kind: "action",  hint: "محرك التخطيط يبني جولات مُحسّنة لكل حي ويقارنها بخط أساس عادل" },
  { key: "route",           title: "اقتراح جولة محسوبة",                               kind: "action",  hint: "محرك القرار يقترح جولة للحي الأكثر احتياجًا ثم يُحسّن ترتيبها" },
  { key: "driver",          title: "ترشيح السائق المناسب",                             kind: "action",  hint: "محرك الإسناد يرشّح سائقًا بالنطاق والمناوبة والسعة وزمن الوصول" },
  { key: "approve",         title: "اعتماد المهمة من المدير",                          kind: "action",  hint: "يعتمد المدير الإسناد فتصل المهمة لحساب السائق" },
  { key: "inbox",           title: "ظهور المهمة في حساب السائق",                       kind: "observe", hint: "افتح بوابة السائق على جوال/نافذة ثانية — تظهر الجولة المعتمدة" },
  { key: "navigate",        title: "تشغيل المسار على الخريطة",                         kind: "observe", hint: "يبدأ السائق الجولة فيظهر المسار والملاحة ويُبث موقعه" },
  { key: "collect",         title: "تنفيذ التفريغ",                                    kind: "observe", hint: "يؤكد السائق التفريغ؛ يسجَّل حدث تفريغ وتصدر قراءة محاكاة بالتفريغ" },
  { key: "indicators",      title: "تحديث مؤشرات البلدية",                             kind: "observe", hint: "تنخفض الحاويات الحرجة وتتحدث لوحة المدير" },
  { key: "shortage",        title: "محاكاة نقص الموارد: تعطل مركبة",                   kind: "action",  hint: "مركز محاكاة القرارات يشغّل السيناريو على نسخة معزولة ويقارنها بخط الأساس" },
  { key: "support",         title: "طلب دعم من مدير البلدية إلى الأمانة",              kind: "observe", hint: "من حساب مدير البلدية: مؤشرات الأداء → «طلب دعم من الأمانة» (مع أدلة الضغط)" },
  { key: "recommend",       title: "توصية الأمانة بنقل مورد من بلدية أقل ضغطًا",       kind: "action",  hint: "محرك النقل بين البلديات يقترح الطاقم الأنسب ويحسب الأثر على الطرفين" },
  { key: "transferApprove", title: "اعتماد النقل من متخذ القرار",                      kind: "action",  hint: "لا يُنقل مورد دون اعتماد صريح من الأمانة" },
  { key: "transferExecute", title: "تنفيذ النقل وإعادة توطين المورد مؤقتًا",           kind: "action",  hint: "تعمل المركبة والسائق ضمن البلدية المستقبِلة حتى الإعادة" },
  { key: "kpis",            title: "تحديث مؤشرات المدينة وسجل القرارات",               kind: "observe", hint: "تظهر القرارات في سجل الأمانة ويتغير ضغط البلديتين" },
];

export const DEFAULT_DEMO_MUNICIPALITY = "east";

/**
 * Pure evaluation of the observe-steps from live data.
 * @param {object} session  { municipalityId, routeId, driverId, criticalBefore }
 * @param {object} live     { bins, routes, profiles, events }
 */
export function evaluateDemo(session, live) {
  const mid = session?.municipalityId || null;
  const since = session?.startedAt || "";
  const after = (x) => String(x || "") >= since;
  const munBins = (live.bins || []).filter((b) => b.municipalityId === mid);
  const critical = munBins.filter((b) => Number(b.lastFillLevelPercent) >= 85 && Number(b.lastFillLevelPercent) <= 100).length;
  const route = (live.routes || []).find((r) => r.id === session?.routeId) || null;
  const driver = (live.profiles || []).find((p) => p.uid === session?.driverId) || null;
  const progress = route ? routeProgress(route) : null;
  const emptiedReadings = (live.readings || []).filter((r) => r.reason === "emptied").length;
  // Prediction needs a series: bins of this municipality with ≥2 readings in the recent window.
  const munIds = new Set(munBins.map((b) => b.id));
  const perBin = {}; for (const r of live.readings || []) if (munIds.has(r.bin_id)) perBin[r.bin_id] = (perBin[r.bin_id] || 0) + 1;
  const predictable = Object.values(perBin).filter((n) => n >= 2).length;
  // Indicator check is per ROUTE (the bins the driver was sent to), so other bins filling up meanwhile never masks the effect.
  const routeBinIds = new Set(route?.binIds || []);
  const routeCritical = munBins.filter((b) => routeBinIds.has(b.id) && Number(b.lastFillLevelPercent) >= 85 && Number(b.lastFillLevelPercent) <= 100).length;
  const before = session?.routeCriticalBefore ?? session?.criticalBefore ?? null;
  const after_ = session?.routeCriticalBefore != null ? routeCritical : critical;
  // The indicator step is proven by the collected bins themselves: a confirmed stop whose simulated
  // sensor now reports an emptied level (<60%). Other bins filling up meanwhile cannot mask it.
  const collectedIds = new Set(route?.collectedBinIds || []);
  const emptiedCollected = munBins.filter((b) => collectedIds.has(b.id) && Number(b.lastFillLevelPercent) < 60).length;
  // Amanah-level artefacts created during THIS session for the chosen municipality.
  const run = (live.runs || []).filter((r) => r.municipalityId === mid && after(r.createdAt)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  const scenario = (live.scenarios || []).filter((x) => x.municipalityId === mid && after(x.createdAt)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  const support = (live.supportRequests || []).filter((x) => x.municipalityId === mid && after(x.createdAt)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  const transfer = (live.transfers || []).filter((t) => t.toMunicipalityId === mid && after(t.createdAt)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  const decisions = (live.audit || []).filter((a) => after(a.createdAt) && /^(transfer_|support_|plan_applied|route_assigned|decision_simulated)/.test(a.action || ""));
  const VERDICT = { better: "أفضل", worse: "أسوأ", neutral: "محايد" };
  const TSTATUS = { proposed: "مقترح", approved: "معتمد", executed: "منفَّذ", returned: "أُعيد", rejected: "مرفوض" };
  return {
    show:       { done: munBins.length > 0, detail: `${munBins.length} حاوية محاكاة في البلدية` },
    detect:     { done: critical > 0, detail: `${critical} حاوية حرجة الآن` },
    predict:    { done: predictable > 0, detail: predictable > 0 ? `${predictable} حاوية لديها سلسلة قراءات كافية للتنبؤ` : "بانتظار قراءتين فأكثر لحاوية واحدة على الأقل" },
    plan:       { done: !!run, detail: run ? `خطة: ${run.summary?.routes ?? "—"} جولة · ${run.summary?.served ?? "—"} حاوية مخدومة · ${run.summary?.unassignedRoutes ?? 0} بلا سائق · ثقة ${run.summary?.confidence || "—"}` : "لم تُنشأ خطة بعد" },
    route:      { done: !!route, detail: route ? `${route.routeName} — ${route.binIds?.length || 0} حاوية${route.optimization ? " (مُحسّنة)" : ""}` : "لا جولة بعد" },
    driver:     { done: !!session?.recommendedDriverName, detail: session?.recommendedDriverName ? `المرشح: ${session.recommendedDriverName}` : "لم يُرشَّح بعد" },
    approve:    { done: !!route && ["approved", "in_progress", "completed"].includes(route.status), detail: route ? `حالة الجولة: ${route.status}` : "" },
    inbox:      { done: !!route && !!route.driverId && ["approved", "in_progress", "completed"].includes(route.status), detail: route?.driverName ? `مسندة إلى ${route.driverName}` : "" },
    navigate:   { done: !!route && ["in_progress", "completed"].includes(route.status), detail: route?.status === "in_progress" ? `السائق بدأ · ${driver?.lastLocation ? "موقع مباشر يُبث" : "بانتظار الموقع"}` : route?.status === "completed" ? "اكتملت" : "بانتظار بدء السائق" },
    collect:    { done: !!progress && progress.collected > 0, detail: progress ? `${progress.collected}/${progress.total} جُمعت` : "" },
    indicators: { done: emptiedCollected > 0 || (before != null && after_ < before), detail: before != null ? `حرجة في الجولة: ${before} ← ${after_} · مُفرَّغة ومؤكدة بقراءة: ${emptiedCollected} · حرجة في البلدية الآن: ${critical}` : "" },
    shortage:   { done: !!scenario, detail: scenario ? `سيناريو ${scenario.scenario?.type || ""}: ${VERDICT[scenario.verdict] || scenario.verdict} · غير مخدومة ${scenario.baseline?.unserved ?? "—"} ← ${scenario.result?.unserved ?? "—"} · ضغط ${scenario.baseline?.pressure ?? "—"} ← ${scenario.result?.pressure ?? "—"}` : "لم يُشغَّل سيناريو بعد" },
    support:    { done: !!support, detail: support ? `طلب: ${support.need} · ضغط عند الطلب ${support.pressureIndex} · ${support.status === "open" ? "مفتوح" : support.status === "approved" ? "موافق عليه" : support.status}` : "لا طلب دعم في هذه الجلسة" },
    recommend:  { done: !!transfer, detail: transfer ? `اقتراح نقل ${transfer.resourceLabel || transfer.resourceId} من ${transfer.fromMunicipalityId} · ضغط المستقبِلة ${transfer.impact?.receiverBefore ?? "—"} ← ${transfer.impact?.receiverAfter ?? "—"}` : "لا اقتراح نقل بعد" },
    transferApprove: { done: !!transfer && ["approved", "executed", "returned"].includes(transfer.status), detail: transfer ? `حالة النقل: ${TSTATUS[transfer.status] || transfer.status}` : "" },
    transferExecute: { done: !!transfer && ["executed", "returned"].includes(transfer.status), detail: transfer?.status === "executed" ? "المورد يعمل ضمن البلدية المستقبِلة مؤقتًا" : transfer?.status === "returned" ? "نُفّذ ثم أُعيد المورد" : "" },
    kpis:       { done: decisions.length >= 4 && !!transfer && ["executed", "returned"].includes(transfer.status), detail: `${decisions.length} قرار مسجل في هذه الجلسة` },
    critical, routeCritical, munBins: munBins.length, liveRoute: route, progress, emptiedReadings, predictable, run, scenario, supportRequest: support, transfer, decisions: decisions.length,
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
    city: !!session?.visitedCity, amanah: !!session?.visitedAmanah, pick: !!session?.municipalityId, show: evaluation.show.done,
    fill: (session?.firedEvents || 0) >= 3, detect: evaluation.detect.done, predict: evaluation.predict.done, plan: evaluation.plan.done, route: evaluation.route.done, driver: evaluation.driver.done,
    approve: evaluation.approve.done, inbox: evaluation.inbox.done, navigate: evaluation.navigate.done, collect: evaluation.collect.done, indicators: evaluation.indicators.done,
    shortage: evaluation.shortage.done, support: evaluation.support.done, recommend: evaluation.recommend.done, transferApprove: evaluation.transferApprove.done, transferExecute: evaluation.transferExecute.done, kpis: evaluation.kpis.done,
  };
  const doneByKey = Object.fromEntries(Object.entries(live).map(([k, v]) => [k, v || passed.has(k)]));
  const i = DEMO_STEPS.findIndex((s) => !doneByKey[s.key]);
  const newlyPassed = Object.keys(live).filter((k) => live[k] && !passed.has(k));
  return { index: i < 0 ? DEMO_STEPS.length : i, doneByKey, newlyPassed };
}
