/* global process */
/**
 * Security regression suite for firestore.rules — every finding of docs/audit/SECURITY_AUDIT.md
 * (SEC-01..SEC-09, ISO-01) as an explicit DENY case, plus the legitimate operations that must keep
 * working as ALLOW cases. Six account kinds: Amanah (executive), municipality manager, operations
 * employee, driver, account WITHOUT municipality, account WITHOUT a valid role.
 *
 *   npm run test:security        (isolated emulator; no cloud access)
 *   SECURITY_REPORT=<file.json>  writes the per-case outcome table (used for the before/after evidence).
 *   SECURITY_MODE=record         never fails — records outcomes only (used to capture the BEFORE state).
 */
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync, writeFileSync } from "node:fs";
import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, query, where, addDoc } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "swm-security-test", firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: Number(process.env.FIRESTORE_EMULATOR_PORT || 8080) } });
await env.clearFirestore();

const U = {
  amanah:   { role: "executive", status: "active" },
  mgrE:     { role: "manager",  status: "active", municipalityId: "east" },
  mgrN:     { role: "manager",  status: "active", municipalityId: "north" },
  opsE:     { role: "employee", status: "active", municipalityId: "east" },
  opsN:     { role: "employee", status: "active", municipalityId: "north" },
  drvE:     { role: "driver",   status: "active", municipalityId: "east" },
  drvE2:    { role: "driver",   status: "active", municipalityId: "east" },
  drvN:     { role: "driver",   status: "active", municipalityId: "north" },
  noMunEmp: { role: "employee", status: "active" },
  noMunMgr: { role: "manager",  status: "active" },
  noMunDrv: { role: "driver",   status: "active" },
  badRole:  { role: "superuser", status: "active", municipalityId: "east" },
  noRole:   { status: "active", municipalityId: "east" },
  pending:  { role: "employee", status: "pending", municipalityId: "east" },
  citE:     { role: "citizen",  status: "active", phone: "0500000002", district: "حي الشروق" },
};
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  for (const [uid, d] of Object.entries(U)) await setDoc(doc(db, `users/${uid}`), { uid, fullName: uid, ...d });
  const put = (p, d) => setDoc(doc(db, p), d);
  await put("municipalities/east", { id: "east" });
  await put("neighborhoods/nE", { name: "حي الشروق", municipalityId: "east" });
  await put("neighborhoods/nN", { name: "حي الأفق", municipalityId: "north" });
  await put("bins/bE", { name: "bE", municipalityId: "east", neighborhoodId: "nE", lastFillLevelPercent: 50, simulated: true, demo: true });
  await put("bins/bE2", { name: "bE2", municipalityId: "east", neighborhoodId: "nE", lastFillLevelPercent: 50 });
  await put("bins/bN", { name: "bN", municipalityId: "north", neighborhoodId: "nN", lastFillLevelPercent: 50, simulated: true, demo: true });
  await put("resource_transfers/T0", { resourceType: "crew", fromMunicipalityId: "north", toMunicipalityId: "east", status: "proposed" });
  await put("rate_limits/k", { count: 1 });
  await put("collection_routes/RD", { routeName: "RD", municipalityId: "east", status: "completed", demo: true, binIds: ["bE"], collectedBinIds: ["bE"] });
  await put("collection_routes/RE", { routeName: "RE", municipalityId: "east", status: "approved", driverId: "drvE", vehicleId: "VE", binIds: ["bE"], collectedBinIds: [] });
  await put("collection_routes/RE2", { routeName: "RE2", municipalityId: "east", status: "in_progress", driverId: "drvE2", vehicleId: "VE2", binIds: ["bE2"], collectedBinIds: [] });
  await put("collection_routes/RN", { routeName: "RN", municipalityId: "north", status: "approved", driverId: "drvN", vehicleId: "VN", binIds: ["bN"], collectedBinIds: [] });
  await put("vehicles/VE", { vehicleNumber: "VE", municipalityId: "east", status: "available", driverId: "drvE" });
  await put("vehicles/VN", { vehicleNumber: "VN", municipalityId: "north", status: "available", driverId: "drvN" });
  await put("driver_profiles/drvE", { uid: "drvE", municipalityId: "east", shiftStatus: "off_shift", neighborhoodKeys: ["الشروق"], vehicleId: "VE" });
  await put("driver_profiles/drvN", { uid: "drvN", municipalityId: "north", shiftStatus: "off_shift", neighborhoodKeys: ["الأفق"], vehicleId: "VN" });
  await put("iot_devices/devE", { deviceId: "ESP-E", binId: "bE", municipalityId: "east", deviceKeyHash: "hashE" });
  await put("iot_devices/devN", { deviceId: "ESP-N", binId: "bN", municipalityId: "north", deviceKeyHash: "hashN" });
  await put("fire_sensors/F1", { district: "حي الأفق", riskLevel: "آمن" });
  await put("alerts/AE", { type: "bin_critical", sourceId: "bE", municipalityId: "east", resolved: false });
  await put("alerts/AN", { type: "bin_critical", sourceId: "bN", municipalityId: "north", resolved: false });
  await put("requests/reqE", { userId: "citE", municipalityId: "east", status: "جديد" });
  await put("requests/reqN", { userId: "someoneN", municipalityId: "north", status: "جديد" });
  await put("citizen_reports/repE", { userId: "citE", municipalityId: "east", status: "جديد" });
  await put("citizen_reports/repN", { userId: "someoneN", municipalityId: "north", status: "جديد" });
  await put("audit_log/logE", { action: "route_assigned", actorId: "opsE", municipalityId: "east", createdAt: "t" });
  await put("audit_log/logN", { action: "route_assigned", actorId: "opsN", municipalityId: "north", createdAt: "t" });
  await put("simulation_scenarios/scE", { municipalityId: "east", verdict: "worse" });
  await put("simulation_scenarios/scN", { municipalityId: "north", verdict: "worse" });
  await put("dispatch_decisions/escE", { municipalityId: "east", type: "escalate", status: "open" });
  await put("dispatch_settings/config", { mode: "observe", scope: "demo_only" });
});

const fs = (uid) => env.authenticatedContext(uid).firestore();
const D = (p) => p; // readability
const CASES = [
  // ── SEC-01 privilege escalation (users) ──
  ["SEC-01", "opsE", "عميل", "users", "تحديث", "موظف العمليات يغيّر دوره إلى executive", "deny", (f) => updateDoc(doc(f, "users/opsE"), { role: "executive" })],
  ["SEC-01", "opsE", "عميل", "users", "تحديث", "موظف العمليات يرقّي سائقًا إلى manager", "deny", (f) => updateDoc(doc(f, "users/drvE"), { role: "manager" })],
  ["SEC-01", "drvE", "عميل", "users", "تحديث", "السائق يغيّر دوره إلى executive", "deny", (f) => updateDoc(doc(f, "users/drvE"), { role: "executive" })],
  ["SEC-01", "drvE", "عميل", "users", "تحديث", "السائق يغيّر بلديته", "deny", (f) => updateDoc(doc(f, "users/drvE"), { municipalityId: "north" })],
  ["SEC-01", "pending", "عميل", "users", "تحديث", "حساب معلّق يفعّل نفسه", "deny", (f) => updateDoc(doc(f, "users/pending"), { status: "active" })],
  ["SEC-01", "mgrE", "عميل", "users", "تحديث", "مدير البلدية يغيّر دور مستخدم من العميل", "deny", (f) => updateDoc(doc(f, "users/drvE"), { role: "employee" })],
  ["SEC-01", "amanah", "عميل", "users", "تحديث", "الأمانة تغيّر دورًا من العميل (المسار الخادمي فقط)", "deny", (f) => updateDoc(doc(f, "users/opsE"), { role: "manager" })],
  ["SEC-01", "drvE", "عميل", "users", "تحديث", "السائق يعدّل homeMunicipalityId", "deny", (f) => updateDoc(doc(f, "users/drvE"), { homeMunicipalityId: "north" })],
  ["SEC-01", "intruder", "عميل", "users", "إنشاء", "تسجيل ذاتي بدور executive ومفعّل", "deny", (f) => setDoc(doc(f, "users/intruder"), { role: "executive", status: "active" })],
  ["SEC-01", "intruder2", "عميل", "users", "إنشاء", "تسجيل ذاتي بدور employee وبلدية مفعّل", "deny", (f) => setDoc(doc(f, "users/intruder2"), { role: "employee", status: "active", municipalityId: "east" })],
  ["ALLOW", "citE", "عميل", "users", "تحديث", "مستخدم يعدّل اسمه وجواله", "allow", (f) => updateDoc(doc(f, "users/citE"), { fullName: "مواطن", phone: "0500000003" })],
  ["ALLOW", "newCit", "عميل", "users", "إنشاء", "تسجيل مواطن جديد", "allow", (f) => setDoc(doc(f, "users/newCit"), { role: "citizen", status: "active" })],
  ["ALLOW", "newEmp", "عميل", "users", "إنشاء", "طلب حساب موظف (معلّق)", "allow", (f) => setDoc(doc(f, "users/newEmp"), { role: "employee", status: "pending" })],
  // ── SEC-02 users read scope ──
  ["SEC-02", "opsE", "عميل", "users", "قراءة", "موظف العمليات يقرأ مستند مواطن خارج نطاقه", "deny", (f) => getDoc(doc(f, "users/citE"))],
  ["SEC-02", "opsE", "عميل", "users", "سرد", "موظف العمليات يسرد كل المستخدمين", "deny", (f) => getDocs(collection(f, "users"))],
  ["SEC-02", "mgrE", "عميل", "users", "قراءة", "مدير الشرق يقرأ سائق الشمال", "deny", (f) => getDoc(doc(f, "users/drvN"))],
  ["SEC-02", "drvE", "عميل", "users", "قراءة", "السائق يقرأ سائقًا آخر", "deny", (f) => getDoc(doc(f, "users/drvE2"))],
  ["ALLOW", "mgrE", "عميل", "users", "قراءة", "مدير الشرق يقرأ سائق الشرق", "allow", (f) => getDoc(doc(f, "users/drvE"))],
  ["ALLOW", "mgrE", "عميل", "users", "سرد", "مدير الشرق يسرد مستخدمي بلديته (استعلام مقيّد)", "allow", (f) => getDocs(query(collection(f, "users"), where("municipalityId", "==", "east")))],
  ["ALLOW", "amanah", "عميل", "users", "سرد", "الأمانة تسرد كل المستخدمين", "allow", (f) => getDocs(collection(f, "users"))],
  ["ALLOW", "drvE", "عميل", "users", "قراءة", "المستخدم يقرأ مستنده", "allow", (f) => getDoc(doc(f, "users/drvE"))],
  // ── SEC-03 fail closed ──
  ["SEC-03", "noMunEmp", "عميل", "bins", "قراءة", "موظف بلا بلدية يقرأ حاوية", "deny", (f) => getDoc(doc(f, "bins/bN"))],
  ["SEC-03", "noMunEmp", "عميل", "bins", "سرد", "موظف بلا بلدية يسرد الحاويات", "deny", (f) => getDocs(collection(f, "bins"))],
  ["SEC-03", "noMunMgr", "عميل", "collection_routes", "قراءة", "مدير بلا بلدية يقرأ جولة", "deny", (f) => getDoc(doc(f, "collection_routes/RE"))],
  ["SEC-03", "noMunEmp", "عميل", "collection_routes", "إنشاء", "موظف بلا بلدية ينشئ جولة", "deny", (f) => setDoc(doc(f, "collection_routes/RX"), { routeName: "x", municipalityId: "east", status: "suggested" })],
  ["SEC-03", "noMunDrv", "عميل", "collection_routes", "سرد", "سائق بلا بلدية يسرد جولاته", "deny", (f) => getDocs(query(collection(f, "collection_routes"), where("driverId", "==", "noMunDrv")))],
  ["SEC-03", "badRole", "عميل", "bins", "قراءة", "دور غير صالح يقرأ حاوية", "deny", (f) => getDoc(doc(f, "bins/bE"))],
  ["SEC-03", "noRole", "عميل", "bins", "قراءة", "حساب بلا دور يقرأ حاوية", "deny", (f) => getDoc(doc(f, "bins/bE"))],
  ["SEC-03", "noRole", "عميل", "vehicles", "قراءة", "حساب بلا دور يقرأ مركبة", "deny", (f) => getDoc(doc(f, "vehicles/VE"))],
  ["SEC-03", "pending", "عميل", "bins", "قراءة", "حساب معلّق يقرأ حاوية", "deny", (f) => getDoc(doc(f, "bins/bE"))],
  ["ALLOW", "opsE", "عميل", "bins", "سرد", "موظف الشرق يسرد حاويات بلديته", "allow", (f) => getDocs(query(collection(f, "bins"), where("municipalityId", "==", "east")))],
  ["ALLOW", "amanah", "عميل", "bins", "سرد", "الأمانة تسرد كل الحاويات", "allow", (f) => getDocs(collection(f, "bins"))],
  // ── SEC-04 cross-municipality writes ──
  ["SEC-04", "opsE", "عميل", "neighborhoods", "حذف", "موظف الشرق يحذف حيًا في الشمال", "deny", (f) => deleteDoc(doc(f, "neighborhoods/nN"))],
  ["SEC-04", "opsE", "عميل", "neighborhoods", "تحديث", "موظف الشرق يعدّل حيًا في الشمال", "deny", (f) => updateDoc(doc(f, "neighborhoods/nN"), { note: "x" })],
  ["SEC-04", "opsE", "عميل", "neighborhoods", "إنشاء", "موظف الشرق ينشئ حيًا للشمال", "deny", (f) => setDoc(doc(f, "neighborhoods/nX"), { name: "x", municipalityId: "north" })],
  ["SEC-04", "opsE", "عميل", "neighborhoods", "تحديث", "موظف الشرق ينقل حيه لبلدية أخرى", "deny", (f) => updateDoc(doc(f, "neighborhoods/nE"), { municipalityId: "north" })],
  ["SEC-04", "opsE", "عميل", "fire_sensors", "تحديث", "موظف يرفع خطورة حساس حريق", "deny", (f) => updateDoc(doc(f, "fire_sensors/F1"), { riskLevel: "خطر عالي" })],
  ["SEC-04", "mgrE", "عميل", "fire_sensors", "إنشاء", "مدير ينشئ حساس حريق", "deny", (f) => setDoc(doc(f, "fire_sensors/F2"), { district: "حي الشروق", riskLevel: "خطر عالي" })],
  ["SEC-04", "opsE", "عميل", "alerts", "تحديث", "موظف الشرق يغلق تنبيهًا في الشمال", "deny", (f) => updateDoc(doc(f, "alerts/AN"), { resolved: true })],
  ["SEC-04", "opsE", "عميل", "alerts", "سرد", "موظف الشرق يسرد كل التنبيهات", "deny", (f) => getDocs(collection(f, "alerts"))],
  ["SEC-04", "opsE", "عميل", "analytics", "تحديث", "موظف يكتب مؤشرات تحليلية", "deny", (f) => setDoc(doc(f, "analytics/kpis"), { x: 1 })],
  ["SEC-04", "opsE", "عميل", "simulated_readings", "إنشاء", "موظف الشرق يكتب قراءة محاكاة لحاوية في الشمال", "deny", (f) => addDoc(collection(f, "simulated_readings"), { bin_id: "bN", municipalityId: "north", fill_level_percent: 99, source: "SIMULATED", demo: true, timestamp: "t" })],
  ["SEC-04", "opsE", "عميل", "simulated_readings", "إنشاء", "قراءة محاكاة بلا وسم المحاكاة", "deny", (f) => addDoc(collection(f, "simulated_readings"), { bin_id: "bE", municipalityId: "east", fill_level_percent: 99, timestamp: "t" })],
  ["ALLOW", "mgrE", "عميل", "neighborhoods", "تحديث", "مدير الشرق يعدّل ملاحظة حيه", "allow", (f) => updateDoc(doc(f, "neighborhoods/nE"), { note: "ok" })],
  ["ALLOW", "amanah", "عميل", "neighborhoods", "تحديث", "الأمانة تغيّر تبعية حي (المسار القائم)", "allow", (f) => updateDoc(doc(f, "neighborhoods/nN"), { municipalityId: "east", municipalityAssignment: { source: "admin_override" } })],
  ["ALLOW", "amanah", "عميل", "fire_sensors", "تحديث", "الأمانة تحدّث حساس حريق", "allow", (f) => updateDoc(doc(f, "fire_sensors/F1"), { riskLevel: "آمن" })],
  ["ALLOW", "opsE", "عميل", "alerts", "سرد", "موظف الشرق يسرد تنبيهات بلديته", "allow", (f) => getDocs(query(collection(f, "alerts"), where("municipalityId", "==", "east"), where("resolved", "==", false)))],
  ["ALLOW", "opsE", "عميل", "alerts", "إنشاء", "موظف الشرق ينشئ تنبيهًا لبلديته", "allow", (f) => addDoc(collection(f, "alerts"), { type: "bin_critical", sourceId: "bE", municipalityId: "east", resolved: false })],
  ["ALLOW", "mgrE", "عميل", "simulated_readings", "إنشاء", "مدير الشرق يكتب قراءة محاكاة موسومة لحاوية في الشرق", "allow", (f) => addDoc(collection(f, "simulated_readings"), { bin_id: "bE", municipalityId: "east", fill_level_percent: 92, source: "SIMULATED", demo: true, timestamp: "t" })],
  // ── SEC-06 IoT devices ──
  ["SEC-06", "opsE", "عميل", "iot_devices", "تحديث", "موظف الشرق يعيد ربط جهاز في الشمال", "deny", (f) => updateDoc(doc(f, "iot_devices/devN"), { binId: "bE" })],
  ["SEC-06", "drvE", "عميل", "iot_devices", "قراءة", "السائق يقرأ تجزئة مفتاح جهاز", "deny", (f) => getDoc(doc(f, "iot_devices/devE"))],
  ["SEC-06", "opsE", "عميل", "iot_devices", "قراءة", "موظف العمليات يقرأ سجل الأجهزة", "deny", (f) => getDoc(doc(f, "iot_devices/devE"))],
  ["SEC-06", "mgrE", "عميل", "iot_devices", "تحديث", "مدير الشرق يربط جهازه بحاوية في الشمال", "deny", (f) => updateDoc(doc(f, "iot_devices/devE"), { binId: "bN" })],
  ["SEC-06", "mgrE", "عميل", "iot_devices", "تحديث", "مدير الشرق ينقل جهازه لبلدية أخرى", "deny", (f) => updateDoc(doc(f, "iot_devices/devE"), { municipalityId: "north" })],
  ["SEC-06", "mgrE", "عميل", "iot_devices", "قراءة", "مدير الشرق يقرأ جهاز الشمال", "deny", (f) => getDoc(doc(f, "iot_devices/devN"))],
  ["ALLOW", "mgrE", "عميل", "iot_devices", "تحديث", "مدير الشرق يدوّر مفتاح جهازه", "allow", (f) => updateDoc(doc(f, "iot_devices/devE"), { deviceKeyHash: "new", keyRotatedAt: "t" })],
  ["ALLOW", "mgrE", "عميل", "iot_devices", "سرد", "مدير الشرق يسرد أجهزة بلديته", "allow", (f) => getDocs(query(collection(f, "iot_devices"), where("municipalityId", "==", "east")))],
  ["ALLOW", "amanah", "عميل", "iot_devices", "تحديث", "الأمانة تعطل جهازًا", "allow", (f) => updateDoc(doc(f, "iot_devices/devN"), { disabled: true })],
  // ── SEC-05 audit log ──
  ["SEC-05", "drvE", "عميل", "audit_log", "إنشاء", "السائق ينتحل محرك الإسناد التلقائي", "deny", (f) => addDoc(collection(f, "audit_log"), { action: "route_auto_assigned", actorId: "system:auto-dispatch", actorName: "الإسناد التلقائي", municipalityId: "east", createdAt: "t" })],
  ["SEC-05", "opsE", "عميل", "audit_log", "إنشاء", "موظف يكتب سجلًا باسم مستخدم آخر", "deny", (f) => addDoc(collection(f, "audit_log"), { action: "route_assigned", actorId: "mgrE", actorName: "mgrE", municipalityId: "east", createdAt: "t" })],
  ["SEC-05", "opsE", "عميل", "audit_log", "إنشاء", "موظف يكتب سجلًا باسم النظام مع هويته", "deny", (f) => addDoc(collection(f, "audit_log"), { action: "x", actorId: "opsE", actorName: "الإسناد التلقائي", municipalityId: "east", createdAt: "t" })],
  ["SEC-05", "opsE", "عميل", "audit_log", "إنشاء", "موظف الشرق يكتب سجلًا منسوبًا للشمال", "deny", (f) => addDoc(collection(f, "audit_log"), { action: "x", actorId: "opsE", actorName: "opsE", municipalityId: "north", createdAt: "t" })],
  ["SEC-05", "opsE", "عميل", "audit_log", "تحديث", "تعديل سجل سابق", "deny", (f) => updateDoc(doc(f, "audit_log/logE"), { action: "nothing" })],
  ["SEC-05", "amanah", "عميل", "audit_log", "حذف", "حذف سجل حقيقي (حتى من الأمانة)", "deny", (f) => deleteDoc(doc(f, "audit_log/logE"))],
  ["SEC-05", "mgrE", "عميل", "audit_log", "قراءة", "مدير الشرق يقرأ سجل الشمال", "deny", (f) => getDoc(doc(f, "audit_log/logN"))],
  ["SEC-05", "mgrE", "عميل", "audit_log", "سرد", "مدير الشرق يسرد كل السجل", "deny", (f) => getDocs(collection(f, "audit_log"))],
  ["ALLOW", "drvE", "عميل", "audit_log", "إنشاء", "السائق يسجل إجراءه هو (بدء مناوبة)", "allow", (f) => addDoc(collection(f, "audit_log"), { action: "driver_clocked_in", actorId: "drvE", actorName: "drvE", municipalityId: "east", createdAt: "t" })],
  ["ALLOW", "mgrE", "عميل", "audit_log", "سرد", "مدير الشرق يسرد سجل بلديته", "allow", (f) => getDocs(query(collection(f, "audit_log"), where("municipalityId", "==", "east")))],
  ["ALLOW", "amanah", "عميل", "audit_log", "سرد", "الأمانة تسرد كل السجل", "allow", (f) => getDocs(collection(f, "audit_log"))],
  // ── ISO-01 requests & citizen reports ──
  ["ISO-01", "opsE", "عميل", "requests", "قراءة", "موظف الشرق يقرأ طلبًا في الشمال", "deny", (f) => getDoc(doc(f, "requests/reqN"))],
  ["ISO-01", "opsE", "عميل", "requests", "سرد", "موظف الشرق يسرد كل الطلبات", "deny", (f) => getDocs(collection(f, "requests"))],
  ["ISO-01", "opsE", "عميل", "requests", "تحديث", "موظف الشرق يرد على طلب في الشمال", "deny", (f) => updateDoc(doc(f, "requests/reqN"), { status: "تم" })],
  ["ISO-01", "opsE", "عميل", "citizen_reports", "سرد", "موظف الشرق يسرد كل البلاغات", "deny", (f) => getDocs(collection(f, "citizen_reports"))],
  ["ISO-01", "opsE", "عميل", "citizen_reports", "حذف", "موظف الشرق يحذف بلاغًا في الشمال", "deny", (f) => deleteDoc(doc(f, "citizen_reports/repN"))],
  ["ISO-01", "drvE", "عميل", "citizen_reports", "قراءة", "السائق يقرأ بلاغ مواطن", "deny", (f) => getDoc(doc(f, "citizen_reports/repE"))],
  ["ISO-01", "citE", "عميل", "requests", "إنشاء", "مواطن ينشئ طلبًا باسم غيره", "deny", (f) => addDoc(collection(f, "requests"), { userId: "someoneN", municipalityId: "east" })],
  ["ALLOW", "opsE", "عميل", "requests", "سرد", "موظف الشرق يسرد طلبات بلديته", "allow", (f) => getDocs(query(collection(f, "requests"), where("municipalityId", "==", "east")))],
  ["ALLOW", "opsE", "عميل", "requests", "تحديث", "موظف الشرق يرد على طلب في بلديته", "allow", (f) => updateDoc(doc(f, "requests/reqE"), { status: "قيد التنفيذ", response: "ok" })],
  ["ALLOW", "opsE", "عميل", "citizen_reports", "سرد", "موظف الشرق يسرد بلاغات بلديته", "allow", (f) => getDocs(query(collection(f, "citizen_reports"), where("municipalityId", "==", "east")))],
  ["ALLOW", "citE", "عميل", "requests", "قراءة", "المواطن يقرأ طلبه", "allow", (f) => getDoc(doc(f, "requests/reqE"))],
  ["ALLOW", "citE", "عميل", "citizen_reports", "إنشاء", "المواطن يرفع بلاغًا", "allow", (f) => addDoc(collection(f, "citizen_reports"), { userId: "citE", municipalityId: "east", status: "جديد" })],
  ["ALLOW", "amanah", "عميل", "requests", "سرد", "الأمانة تسرد كل الطلبات", "allow", (f) => getDocs(collection(f, "requests"))],
  // ── SEC-09 critical field operations ──
  ["SEC-09", "drvE", "عميل", "collection_routes", "تحديث", "السائق ينهي جولة معتمدة دون بدئها", "deny", (f) => updateDoc(doc(f, "collection_routes/RE"), { status: "completed", completedAt: "t" })],
  ["SEC-09", "drvE", "عميل", "collection_events", "إنشاء", "السائق يؤكد تفريغ حاوية ليست في جولته", "deny", (f) => setDoc(doc(f, "collection_events/RE__bE2"), { routeId: "RE", binId: "bE2", driverId: "drvE", operatorId: "drvE", confirmedAt: "t" })],
  ["SEC-09", "drvE", "عميل", "bins", "تحديث", "السائق يختم جمع حاوية في بلدية أخرى", "deny", (f) => updateDoc(doc(f, "bins/bN"), { lastCollectionAt: "t" })],
  ["SEC-09", "drvE", "عميل", "route_incidents", "إنشاء", "السائق يرفع بلاغًا على جولة غيره", "deny", (f) => addDoc(collection(f, "route_incidents"), { routeId: "RN", driverId: "drvE", type: "obstacle", status: "open", municipalityId: "north" })],
  ["SEC-09", "drvE", "عميل", "vehicle_status_history", "إنشاء", "السائق يكتب سجل حالة لمركبة غيره", "deny", (f) => addDoc(collection(f, "vehicle_status_history"), { vehicleId: "VN", from: "available", to: "maintenance", actorId: "drvE", municipalityId: "north" })],
  ["SEC-09", "drvE", "عميل", "driver_profiles", "تحديث", "السائق يوسّع نطاق أحيائه", "deny", (f) => updateDoc(doc(f, "driver_profiles/drvE"), { neighborhoodKeys: ["الأفق"] })],
  ["SEC-09", "opsE", "عميل", "collection_routes", "إنشاء", "موظف الشرق ينشئ جولة في الشمال", "deny", (f) => setDoc(doc(f, "collection_routes/RXN"), { routeName: "x", municipalityId: "north", status: "suggested" })],
  ["SEC-09", "opsE", "عميل", "vehicles", "تحديث", "موظف الشرق يعدّل مركبة الشمال", "deny", (f) => updateDoc(doc(f, "vehicles/VN"), { status: "maintenance" })],
  ["SEC-09", "opsE", "عميل", "resource_transfers", "إنشاء", "موظف العمليات يقترح نقل مورد", "deny", (f) => setDoc(doc(f, "resource_transfers/T1"), { fromMunicipalityId: "north", toMunicipalityId: "east", status: "proposed" })],
  ["SEC-09", "mgrE", "عميل", "resource_transfers", "إنشاء", "مدير البلدية يعتمد نقل مورد", "deny", (f) => setDoc(doc(f, "resource_transfers/T2"), { fromMunicipalityId: "north", toMunicipalityId: "east", status: "approved" })],
  ["SEC-09", "opsE", "عميل", "dispatch_settings", "تحديث", "موظف العمليات يفعّل الإسناد على كل الحاويات", "deny", (f) => setDoc(doc(f, "dispatch_settings/config"), { mode: "auto", scope: "all" })],
  ["SEC-09", "opsE", "عميل", "simulation_scenarios", "قراءة", "موظف الشرق يقرأ سيناريو الشمال", "deny", (f) => getDoc(doc(f, "simulation_scenarios/scN"))],
  ["SEC-09", "mgrE", "عميل", "simulation_scenarios", "سرد", "مدير الشرق يسرد كل السيناريوهات", "deny", (f) => getDocs(collection(f, "simulation_scenarios"))],
  ["ALLOW", "drvE", "عميل", "collection_routes", "تحديث", "السائق يبدأ جولته المعتمدة", "allow", (f) => updateDoc(doc(f, "collection_routes/RE"), { status: "in_progress", startedAt: "t", updatedAt: "t" })],
  ["ALLOW", "drvE", "عميل", "route_incidents", "إنشاء", "السائق يرفع بلاغًا على جولته", "allow", (f) => addDoc(collection(f, "route_incidents"), { routeId: "RE", driverId: "drvE", type: "obstacle", status: "open", municipalityId: "east" })],
  ["ALLOW", "drvE", "عميل", "driver_profiles", "تحديث", "السائق يبدأ مناوبته", "allow", (f) => updateDoc(doc(f, "driver_profiles/drvE"), { shiftStatus: "on_shift", updatedAt: "t" })],
  ["ALLOW", "drvE", "عميل", "vehicle_status_history", "إنشاء", "السائق يسجل حالة مركبته", "allow", (f) => addDoc(collection(f, "vehicle_status_history"), { vehicleId: "VE", from: "available", to: "on_route", actorId: "drvE", municipalityId: "east" })],
  ["ALLOW", "opsE", "عميل", "collection_routes", "تحديث", "موظف الشرق يعتمد جولة في بلديته", "allow", (f) => updateDoc(doc(f, "collection_routes/RE"), { status: "approved", driverId: "drvE", vehicleId: "VE" })],
  ["ALLOW", "opsE", "عميل", "vehicles", "تحديث", "موظف الشرق يحدّث مركبة بلديته", "allow", (f) => updateDoc(doc(f, "vehicles/VE"), { status: "maintenance" })],
  ["ALLOW", "opsE", "عميل", "dispatch_decisions", "تحديث", "موظف الشرق يغلق استثناء بلديته", "allow", (f) => updateDoc(doc(f, "dispatch_decisions/escE"), { status: "resolved", resolvedBy: "opsE", resolvedAt: "t" })],
  ["ALLOW", "amanah", "عميل", "resource_transfers", "إنشاء", "الأمانة تقترح نقل مورد", "allow", (f) => setDoc(doc(f, "resource_transfers/T3"), { fromMunicipalityId: "north", toMunicipalityId: "east", status: "proposed" })],
  ["ALLOW", "amanah", "عميل", "dispatch_settings", "تحديث", "الأمانة تغيّر وضع الإسناد", "allow", (f) => setDoc(doc(f, "dispatch_settings/config"), { mode: "auto", scope: "demo_only" })],
  ["ALLOW", "mgrE", "عميل", "simulation_scenarios", "سرد", "مدير الشرق يسرد سيناريوهات بلديته", "allow", (f) => getDocs(query(collection(f, "simulation_scenarios"), where("municipalityId", "==", "east")))],
  ["ALLOW", "mgrE", "عميل", "simulation_scenarios", "إنشاء", "مدير الشرق يحفظ نتيجة محاكاة", "allow", (f) => addDoc(collection(f, "simulation_scenarios"), { municipalityId: "east", verdict: "better" })],
  // ── SEC-13 collection data is server-only (/api/field/confirm-collection); transfers execute only on the server ──
  ["SEC-13", "drvE2", "عميل", "collection_events", "إنشاء", "السائق يكتب تأكيد تفريغ مباشرة (حتى في جولته الجارية)", "deny", (f) => setDoc(doc(f, "collection_events/RE2__bE2"), { id: "RE2__bE2", routeId: "RE2", binId: "bE2", driverId: "drvE2", operatorId: "drvE2", confirmedAt: "t", municipalityId: "east" }, { merge: true })],
  ["SEC-13", "drvE2", "عميل", "collection_routes", "تحديث", "السائق يكتب تقدم الجولة مباشرة", "deny", (f) => updateDoc(doc(f, "collection_routes/RE2"), { collectedBinIds: ["bE2"], lastProgressAt: "t" })],
  ["SEC-13", "drvE2", "عميل", "bins", "تحديث", "السائق يختم جمع حاوية مباشرة (في بلديته)", "deny", (f) => updateDoc(doc(f, "bins/bE2"), { lastCollectionAt: "t" })],
  ["SEC-13", "opsE", "عميل", "collection_routes", "تحديث", "موظف العمليات يعدّل تقدم جولة في بلديته", "deny", (f) => updateDoc(doc(f, "collection_routes/RE2"), { collectedBinIds: ["bE2"] })],
  ["SEC-13", "opsE", "عميل", "bins", "تحديث", "موظف العمليات يختم جمع حاوية حقيقية (غير محاكاة)", "deny", (f) => updateDoc(doc(f, "bins/bE2"), { lastCollectionAt: "t" })],
  ["SEC-13", "amanah", "عميل", "resource_transfers", "تحديث", "الأمانة تجعل النقل منفذًا من العميل", "deny", (f) => updateDoc(doc(f, "resource_transfers/T0"), { status: "executed" })],
  ["SEC-13", "amanah", "عميل", "resource_transfers", "إنشاء", "الأمانة تنشئ نقلًا بحالة منفذ مباشرة", "deny", (f) => setDoc(doc(f, "resource_transfers/T4"), { fromMunicipalityId: "north", toMunicipalityId: "east", status: "executed" })],
  ["SEC-13", "amanah", "عميل", "rate_limits", "قراءة", "قراءة عدادات حدود الطلبات من العميل", "deny", (f) => getDoc(doc(f, "rate_limits/k"))],
  ["SEC-13", "drvE", "عميل", "rate_limits", "حذف", "تصفير حد الطلبات من العميل", "deny", (f) => deleteDoc(doc(f, "rate_limits/k"))],
  ["ALLOW", "drvE2", "عميل", "collection_routes", "تحديث", "السائق ينهي جولته الجارية (الحالة فقط)", "allow", (f) => updateDoc(doc(f, "collection_routes/RE2"), { status: "completed", completedAt: "t" })],
  ["ALLOW", "opsE", "عميل", "bins", "تحديث", "المحاكي يحدّث وقت جمع حاوية محاكاة", "allow", (f) => updateDoc(doc(f, "bins/bE"), { lastCollectionAt: "t" })],
  ["SEC-16", "amanah", "عميل", "resource_transfers", "تحديث", "اعتماد نقل من العميل دون حجز الموارد (الاعتماد خادمي)", "deny", (f) => updateDoc(doc(f, "resource_transfers/T0"), { status: "approved", decidedBy: "amanah", decidedAt: "t" })],
  ["ALLOW", "amanah", "عميل", "resource_transfers", "تحديث", "الأمانة ترفض نقلًا مقترحًا", "allow", (f) => updateDoc(doc(f, "resource_transfers/T0"), { status: "rejected", decidedBy: "amanah", decidedAt: "t" })],
  ["SEC-16", "amanah", "عميل", "resource_reservations", "إنشاء", "إنشاء حجز مورد من العميل", "deny", (f) => setDoc(doc(f, "resource_reservations/X"), { resourceId: "VE", status: "active" })],
  ["SEC-16", "amanah", "عميل", "resource_locks", "قراءة", "قراءة أقفال الموارد", "deny", (f) => getDoc(doc(f, "resource_locks/VE"))],
  // ── SEC-14 operational targets / impact factors are decision inputs: Amanah only, typed and bounded ──
  ["SEC-14", "opsE", "عميل", "dispatch_settings", "تحديث", "موظف العمليات يغيّر الأهداف التشغيلية", "deny", (f) => setDoc(doc(f, "dispatch_settings/config"), { mode: "observe", scope: "demo_only", targets: { criticalCollectionMin: 30 } })],
  ["SEC-14", "amanah", "عميل", "dispatch_settings", "تحديث", "هدف خارج المدى (0 دقيقة)", "deny", (f) => setDoc(doc(f, "dispatch_settings/config"), { mode: "observe", scope: "demo_only", targets: { criticalCollectionMin: 0 } })],
  ["SEC-14", "amanah", "عميل", "dispatch_settings", "تحديث", "مفتاح غير معروف داخل الأهداف", "deny", (f) => setDoc(doc(f, "dispatch_settings/config"), { mode: "observe", scope: "demo_only", targets: { anything: 1 } })],
  ["SEC-14", "amanah", "عميل", "dispatch_settings", "تحديث", "معامل انبعاث نصي", "deny", (f) => setDoc(doc(f, "dispatch_settings/config"), { mode: "observe", scope: "demo_only", impactFactors: { co2KgPerLiter: "2.68" } })],
  ["SEC-14", "drvE", "عميل", "dispatch_decisions", "قراءة", "السائق يقرأ سجل قرارات الإسناد", "deny", (f) => getDoc(doc(f, "dispatch_decisions/escE"))],
  ["ALLOW", "amanah", "عميل", "dispatch_settings", "تحديث", "الأمانة تضبط الأهداف ومعاملات الأثر (ومعامل غير متاح = null)", "allow", (f) => setDoc(doc(f, "dispatch_settings/config"), { mode: "auto", scope: "demo_only", targets: { criticalCollectionMin: 45, onTimePct: 90, maxRouteKm: 35, vehicleUtilizationPct: 70, maxLateBins: 2 }, impactFactors: { fuelLitersPerKm: null, co2KgPerLiter: 2.68, avgUrbanSpeedKmh: 30 } })],
  // ── SEC-15 demo-scene history is the only client-written collection data, and it cannot touch real routes ──
  ["SEC-15", "opsE", "عميل", "collection_events", "إنشاء", "حدث جمع غير موسوم كتجريبي على جولة تجريبية مكتملة", "deny", (f) => setDoc(doc(f, "collection_events/h1"), { routeId: "RD", binId: "bE", municipalityId: "east" })],
  ["SEC-15", "opsE", "عميل", "collection_events", "إنشاء", "حدث جمع تجريبي على جولة حقيقية جارية", "deny", (f) => setDoc(doc(f, "collection_events/h2"), { routeId: "RE2", binId: "bE2", municipalityId: "east", demo: true, _demoSeedVersion: "v1" })],
  ["SEC-15", "drvE", "عميل", "collection_events", "إنشاء", "السائق ينشئ حدث جمع تجريبيًا", "deny", (f) => setDoc(doc(f, "collection_events/h3"), { routeId: "RD", binId: "bE", municipalityId: "east", demo: true, _demoSeedVersion: "v1" })],
  ["SEC-15", "opsE", "عميل", "collection_routes", "إنشاء", "جولة حقيقية تُنشأ مكتملة بتقدم مزوّر", "deny", (f) => setDoc(doc(f, "collection_routes/RF"), { routeName: "RF", municipalityId: "east", status: "completed", binIds: ["bE2"], collectedBinIds: ["bE2"] })],
  ["ALLOW", "opsE", "عميل", "collection_events", "إنشاء", "سجل تاريخي تجريبي لمشهد المحاكاة على جولة تجريبية مكتملة", "allow", (f) => setDoc(doc(f, "collection_events/h4"), { routeId: "RD", binId: "bE", municipalityId: "east", demo: true, _demoSeedVersion: "v1" })],
  ["ALLOW", "opsE", "عميل", "collection_routes", "إنشاء", "جولة مقترحة جديدة بلا تقدم", "allow", (f) => setDoc(doc(f, "collection_routes/RN2"), { routeName: "RN2", municipalityId: "east", status: "suggested", binIds: ["bE2"], collectedBinIds: [] })],
  ["SEC-15", "opsE", "عميل", "sensor_readings", "إنشاء", "قراءة مستشعر موسومة تجريبية من العميل", "deny", (f) => setDoc(doc(f, "sensor_readings/x1"), { bin_id: "bE", municipalityId: "east", demo: true, _demoSeedVersion: "v1", routeId: "RD" })],
];
void D;

const rows = [];
for (const [id, uid, , col, op, desc, expected, fn] of CASES) {
  let outcome;
  try { await fn(fs(uid)); outcome = "allow"; } catch { outcome = "deny"; }
  rows.push({ id, uid, col, op, desc, expected, outcome, pass: outcome === expected });
}
await env.cleanup();

const failed = rows.filter((r) => !r.pass);
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
console.log(`\nSecurity rules — ${rows.length} cases`);
for (const r of rows) console.log(`  ${r.pass ? "✓" : "✗"} ${pad(r.id, 7)} ${pad(r.uid, 9)} ${pad(r.col, 22)} ${pad(r.op, 6)} متوقع=${r.expected} فعلي=${r.outcome} — ${r.desc}`);
console.log(`\nSecurity rules: ${rows.length - failed.length} passed, ${failed.length} failed`);
if (process.env.SECURITY_REPORT) writeFileSync(process.env.SECURITY_REPORT, JSON.stringify(rows, null, 2));
process.exit(failed.length && process.env.SECURITY_MODE !== "record" ? 1 : 0);
