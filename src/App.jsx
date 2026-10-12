// ============================================================
// نظام إدارة الحاويات الذكية - بريدة
// ملف واحد كامل مع Firebase Auth + Firestore + Role-based Routing
// ============================================================
//
// ⚠️ قبل التشغيل:
// 1. npm install firebase recharts
// 2. غيّر بيانات firebaseConfig بالأسفل ببيانات مشروعك
// 3. فعّل Email/Password في Firebase Auth
// 4. أنشئ Firestore Database
//
// ============================================================

import React, { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from "react";

import {
  BarChart2, DollarSign, TrendingUp, TrendingDown, Zap,
  Landmark, MapIcon, Target, Smile, PieChart as LucidePieChart,
  Banknote, Building, AlertTriangle, Trophy, Clock,
  Settings as SettingsIcon, LogOut, Lock, Flag, User,
  Users, Crown, CheckCircle, Timer, ChartNoAxesCombined,
  Factory, Recycle, Bell, Package, Calendar, Scale, Leaf,
  Globe, Truck, Sparkles, Thermometer, Flame, Wind, Gauge,
  Radio, Microscope, FlaskConical, FireExtinguisher, Droplets,
  Phone, Bot, Plug, Database, Trash2, FileText, MapPin,
  Bookmark, LayoutDashboard, Inbox, Sliders, ClipboardList,
  Home, HardHat, ShieldCheck, Eye, EyeOff, Mail, KeyRound,
  ChevronRight, X, BellRing, ShieldAlert,
  Wifi, WifiOff, Battery, Search, Filter, Navigation, Route as RouteIcon,
  Layers, Map as MapGlyph,
 Radar as RadarIcon, Waypoints, UserCheck, ArrowLeftRight, ChartColumn, Building2, ArrowLeft, LogIn,
} from "lucide-react";

import { MapContainer, TileLayer, GeoJSON, CircleMarker, Polyline, Polygon, Popup, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import buraidahNeighborhoodsGeo from "./buraidahNeighborhoods.geo.json";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ComposedChart,
} from "recharts";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential
} from "firebase/auth";

import {
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  onSnapshot,
  updateDoc,
  query,
  orderBy,
  where,
  deleteDoc
} from "firebase/firestore";

import { auth, db } from "./firebase";
import {
  useCollection,
  useCollectionWhere,
  useAnalyticsDoc,
  addRequest,
  addCitizenReport,
  updateRequestStatus,
  updateCitizenReport,
  deleteRequest,
  deleteCitizenReport,
  syncDistrictsPerfFromStations,
  recordDailyStationHistory,
  useNeighborhoods,
  useBins,
  useBinReadings,
  useRecentReadings,
  useVehicles,
  useCollectionRoutes,
  useCollectionEvents,
  useAuditLog,
  addVehicle,
  updateVehicleStatus,
  applyRouteReconciliation,
  updateRoute,
  approveRoute,
  rejectRoute,
  deferRoute,
  startRoute,
  completeRoute,
  writeAuditLog,
  syncAlertsFromCandidates,
  demoSetReading,
  demoSetOffline,
  demoSetFault,
  demoReset,
  useIotDevices,
  rotateDeviceKey,
  setDeviceDisabled,
  useDriverProfiles,
  useDriverVehicleAssignments,
  useDriverAssignmentHistory,
  useMyDriverProfile,
  useMyRoutes,
  ensureDriverProfile,
  updateDriverProfile,
  assignVehicleToDriver,
  endVehicleAssignment,
  setDriverShift,
  approveAndAssignRoute,
  confirmCollection,
  reportRouteIncident,
  reviewRouteIncident,
  reinstateRouteStop,
  persistDriverLocation,
  useRouteIncidents,
  useMunicipalities,
  useOptimizationRuns,
  saveOptimizationRun,
  useSimulationScenarios,
  saveSimulationScenario,
  setVehicleStatusWithHistory,
  withdrawOpenSupportRequests,
  useDispatchSettings,
  setAuditScope,
  adminUserAction,
  useScopedCollection,
  useDispatchDecisions,
  useDispatchRuns,
  useDriverNotifications,
  markDriverNotificationRead,
  saveDispatchSettings,
  resolveDispatchDecision,
  requestDispatchCycle,
  useSupportRequests,
  useResourceTransfers,
  createSupportRequest,
  reviewSupportRequest,
  proposeResourceTransfer,
  decideResourceTransfer,
  executeResourceTransfer,
  returnResourceTransfer,
  seedMunicipalitiesAndBackfill,
  setNeighborhoodMunicipality,
  setUserMunicipality,
  COLLECTIONS,
} from "./firestoreService";
import {
  getStatus,
  THRESHOLDS,
  STATUS_COLORS,
  STATE_LABELS,
  CONFIDENCE_LABELS,
  ROUTE_STATUS_LABELS,
  VEHICLE_STATUS_LABELS,
  getSensorConnectivity,
  getBinTier,
  getReadingAgeLabel,
  normalizeNeighborhoodName,
} from "./config";
import {
  getBinPriority,
  getNeighborhoodPriority,
  routePreCheck,
  haversineDistanceKm,
  polygonCentroid,
  orderStopsFrom,
  estimateTravelMinutes,
  groupNeighborhoodsByName,
  findOpenRouteForBin,
  rankNeighborhoodsForCollection,
  reconcileRecommendations,
} from "./decisionEngine";
import { predictFutureState, computeFillRate, predictFullTime } from "./prediction";
import { generateAlertCandidates, ALERT_TYPE_LABELS, ALERT_TYPE_ICONS } from "./alertsEngine";
import { useRoadRoute, useRoadLegs, fetchRoadMatrix, fetchRoadRoute } from "./roadRouting";
import { rankDriverCandidates, driverOrigin } from "./assignmentEngine";
import { optimizeRoute, evaluateOrder } from "./routeOptimizer";
import { MUNICIPALITIES, municipalityById, municipalityForNeighborhood, defaultAssignmentFor, scopeFor, isStaffRole, canonicalRole, ROLE_LABELS_AR, computeMunicipalityStats, operationalZones, DATA_PROVENANCE, NEIGHBORHOOD_ASSIGNMENT_PROVENANCE, OFFICIAL_NAMES_SOURCE, isOfficialNeighborhoodName } from "./municipalities";
import { parseSteps, projectOnRoute, nextManeuver, offRouteDecision, arrivedAtStop, fixQuality, formatDistanceAr, distanceM, shouldPersistLocation } from "./navigation";
import { INCIDENT_TYPES, canConfirmCollection, routeProgress, nextStopFor, reinstateSkippedStop, buildConfirmation } from "./executionEngine";
import { createOfflineQueue } from "./offlineQueue";
import { DEFAULT_SIM_CONFIG, SIM_EVENTS, generateScenario } from "./simulation/simulationEngine";
import { buildCollectionPlan, explainRoute, suggestAdditions } from "./collectionPlanner";
import { makeThermalAlertFor, makeBinContext } from "./binContext";
import { DEFAULT_DISPATCH_SETTINGS, DISPATCH_MODES, DISPATCH_SCOPES, ACTION_LABELS, ESCALATION_LABELS } from "./autoDispatchEngine";
import { simulateDecision, SCENARIO_TYPES } from "./decisionSimulator";
import { municipalityPressure, recommendTransfers, compareMunicipalities, CREW_BINS_PER_HOUR } from "./interMunicipalEngine";
import { installSimulation, subscribeSimState, tickSimulation, setSimulationStatus, fireSimulationEvent, realIntervalMs, resetSimulation } from "./simulation/simulationRunner";
import { DEMO_STEPS, DEFAULT_DEMO_MUNICIPALITY, evaluateDemo, nextStepIndex } from "./demoScenario";
import { can, validateDriverProfile, findVehicleAssignmentConflicts, findRouteAssignmentConflicts, activeAssignmentFor, vehicleHolderAt, coverageMatrix, driverCodeFor, locationFreshness, SHIFT_STATUS_LABELS, AVAILABILITY_LABELS } from "./fleetEngine";
import { getBinMapState, computeNeighborhoodMapStats, binMatchesFilter, neighborhoodMatchesFilter, polygonStyle, markerStyle, MAP_STATE_COLORS, MAP_STATE_LABELS } from "./mapVisual";
import { computeImpactMetrics, computeFleetPerformance } from "./impact";
import { seedAllCollections, migrateStationsToBinsAndNeighborhoods, seedCityDemoData } from "./seedFirestore";
import { exportAllDataToExcel } from "./exportAllDataToExcel";

// ── Theme tokens (Phase 2: government-style light identity by default; dark optional) ──
// The palette is resolved ONCE at load from localStorage (swm_theme) because the
// tokens are plain strings composed with alpha suffixes all over the UI
// (e.g. C.accent + "20"); switching reloads the page.
const THEMES = {
  light: {
    name: "light",
    bg: "#f3f6f4", card: "#ffffff", cardHover: "#eef4f0", border: "#dde5e0",
    accent: "#2f9e5f", warning: "#c77700", danger: "#d12f2f", info: "#1f5fbf", purple: "#6d4bd6",
    text: "#1e2b24", muted: "#55665d", dim: "#7e8c85",
    brand: "#0b3d2e", brandSoft: "#13553f", onBrand: "#ffffff", brandText: "#dbeee4",
    g1: "linear-gradient(135deg, #2f9e5f, #1c7a46)", g2: "linear-gradient(135deg, #1f5fbf, #174a93)",
    g3: "linear-gradient(135deg, #c77700, #9a5c00)", g4: "linear-gradient(135deg, #6d4bd6, #5235a8)",
  },
  dark: {
    name: "dark",
    bg: "#0a0e1a", card: "#111827", cardHover: "#1a2337", border: "#1e293b",
    accent: "#10b981", warning: "#f59e0b", danger: "#ef4444", info: "#3b82f6", purple: "#8b5cf6",
    text: "#f1f5f9", muted: "#94a3b8", dim: "#64748b",
    brand: "#0b3d2e", brandSoft: "#13553f", onBrand: "#ffffff", brandText: "#dbeee4",
    g1: "linear-gradient(135deg, #10b981, #059669)", g2: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
    g3: "linear-gradient(135deg, #f59e0b, #d97706)", g4: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
  },
};
const THEME_NAME = (() => { try { return localStorage.getItem("swm_theme") === "dark" ? "dark" : "light"; } catch { return "light"; } })();
const C = THEMES[THEME_NAME];
const setTheme = (name) => { try { localStorage.setItem("swm_theme", name); } catch { /* ignore */ } window.location.reload(); };
const BRAND = { ar: "منصة الإدارة الذكية للنفايات البلدية", en: "Smart Waste MIS", city: "بريدة — منطقة القصيم", engine: "العقل التشغيلي للمدينة", engineEn: "Smart Municipal Waste Intelligence Engine",
  description: "منصة ذكية لإدارة النفايات البلدية، تجمع بين التنبؤ الاستباقي بامتلاء الحاويات، والتحسين الآلي لجولات الجمع، والتوزيع الذكي للموارد بين البلديات، مع محاكاة أثر القرارات قبل تنفيذها وقياس نتائجها الفعلية." };
// ============================================================
// 🔐 AUTH CONTEXT
// ============================================================
const AuthContext = createContext(null);
const useAuth = () => useContext(AuthContext);

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            setUserRole(data.role);
            setUserData(data);
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
        }
      } else {
        setUser(null);
        setUserRole(null);
        setUserData(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const register = async ({ email, password, fullName, phone, district, role, municipalityId = null }) => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: fullName });
      // المواطن يدخل مباشرة، بقية الأدوار (موظف/سائق/إدارة عليا) تنتظر الموافقة
      const needsApproval = role === "employee" || role === "manager" || role === "executive" || role === "driver";
      const roleArMap = { executive: "إدارة عليا", manager: "مدير بلدية", employee: "موظف", driver: "سائق ميداني", citizen: "مواطن" };
      const userDocData = {
        uid: cred.user.uid, email, fullName, phone: phone || "", district: district || "",
        municipalityId: (role === "manager" || role === "employee" || role === "driver") ? (municipalityId || null) : null,
        role: role || "citizen",
        roleAr: roleArMap[role] || "مواطن",
        status: needsApproval ? "pending" : "active",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, "users", cred.user.uid), userDocData);
      setUserRole(userDocData.role);
      setUserData(userDocData);
      return { success: true, pending: needsApproval };
    } catch (error) {
      console.error("❌ خطأ:", error.code, error.message);
      const msgs = {
        "auth/email-already-in-use": "البريد الإلكتروني مستخدم بالفعل",
        "auth/weak-password": "كلمة المرور ضعيفة - 6 أحرف على الأقل",
        "auth/invalid-email": "البريد الإلكتروني غير صحيح",
      };
      return { success: false, error: msgs[error.code] || ("خطأ: " + error.code + " - " + error.message) };
    }
  };

  const login = async (email, password) => {
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const userDoc = await getDoc(doc(db, "users", cred.user.uid));
      if (userDoc.exists()) { const d = userDoc.data(); setUserRole(d.role); setUserData(d); }
      return { success: true };
    } catch (error) {
      const msgs = {
        "auth/user-not-found": "لا يوجد حساب بهذا البريد",
        "auth/wrong-password": "كلمة المرور غير صحيحة",
        "auth/invalid-credential": "بيانات الدخول غير صحيحة",
        "auth/too-many-requests": "محاولات كثيرة - حاول لاحقاً",
      };
      return { success: false, error: msgs[error.code] || "حدث خطأ أثناء تسجيل الدخول" };
    }
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null); setUserRole(null); setUserData(null);
  };

  const resetPassword = async (email) => {
    try {
      await sendPasswordResetEmail(auth, email);
      return { success: true };
    } catch (error) {
      const msgs = {
        "auth/user-not-found": "لا يوجد حساب بهذا البريد الإلكتروني",
        "auth/invalid-email": "البريد الإلكتروني غير صحيح",
        "auth/too-many-requests": "محاولات كثيرة - حاول لاحقاً",
      };
      return { success: false, error: msgs[error.code] || "حدث خطأ أثناء إرسال رابط الاستعادة" };
    }
  };

  const changePassword = async (currentPassword, newPassword) => {
  try {
    if (!user) {
      return { success: false, error: "يجب تسجيل الدخول أولاً" };
    }

    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);

    return { success: true };
  } catch (error) {
    const msgs = {
      "auth/wrong-password": "كلمة المرور الحالية غير صحيحة",
      "auth/weak-password": "كلمة المرور الجديدة ضعيفة - 6 أحرف على الأقل",
      "auth/requires-recent-login": "يرجى تسجيل الخروج والدخول مرة أخرى ثم المحاولة",
      "auth/invalid-credential": "كلمة المرور الحالية غير صحيحة",
    };

    return {
      success: false,
      error: msgs[error.code] || "حدث خطأ: " + error.message
    };
  }
};

  const updateUserProfile = async (updates) => {
    try {
      if (!user) return { success: false, error: "يجب تسجيل الدخول أولاً" };
      // Update Firestore
      await updateDoc(doc(db, "users", user.uid), { ...updates, updatedAt: new Date().toISOString() });
      // Update Firebase Auth display name if changed
      if (updates.fullName) await updateProfile(user, { displayName: updates.fullName });
      // Update local state
      setUserData(prev => ({ ...prev, ...updates }));
      return { success: true };
    } catch (error) {
      return { success: false, error: "حدث خطأ أثناء تحديث البيانات: " + error.message };
    }
  };

  return (
    <AuthContext.Provider value={{ user, userRole, userData, loading, register, login, logout, resetPassword, changePassword, updateUserProfile, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
};

// ============================================================
// 🔑 AUTH PAGE (LOGIN + REGISTER)
// ============================================================
const DISTRICTS = ["حي الخليج","حي الفايزية","حي الإسكان","حي الريان","حي السالمية","حي الحمر","حي المنتزه","حي الأفق","حي النقع","حي الضاحي","حي الهلالية","حي البصيرة"];
const ROLES_LIST = [
  { value: "citizen",   label: "الأفراد",    icon: <Home size={22} />,       desc: "طلب حاويات ومتابعة الخدمات", color: C.accent },
  { value: "employee",  label: "موظف",       icon: <HardHat size={22} />,    desc: "إدارة الأحياء والعمليات",    color: C.info },
  { value: "driver",    label: "سائق ميداني", icon: <Truck size={22} />,     desc: "تنفيذ جولات الجمع ميدانيًا",  color: C.purple },
  { value: "manager",   label: "مدير بلدية", icon: <Landmark size={22} />,   desc: "إدارة بلدية فرعية واحدة",     color: "#06b6d4" },
  { value: "executive", label: "إدارة عليا", icon: <Landmark size={22} />,   desc: "لوحة متخذي القرار",          color: C.warning },
];
const isMgmtRole = (r) => r === "employee" || r === "manager" || r === "executive";

const inputStyle = { width:"100%", padding:"12px 16px", borderRadius:10, border:"1px solid #1e3a5f", background:"#0a1628", color:"#e2e8f0", fontSize:14, fontFamily:"'Noto Kufi Arabic',sans-serif", outline:"none", boxSizing:"border-box", transition:"border-color 0.2s" };

// ── شعار النظام الموحد ──────────────────────────────────────────
const AppLogo = ({ size = 72 }) => (
  <div style={{ width:size, height:size, position:"relative", margin:"0 auto", flexShrink:0 }}>
    {/* الدائرة الخارجية */}
    <div style={{ position:"absolute", inset:0, borderRadius:"50%", background:"linear-gradient(135deg,#0d7a4e,#10b981)", boxShadow:"0 0 0 3px #10b98140, 0 12px 40px #10b98130" }} />
    {/* حلقة داخلية */}
    <div style={{ position:"absolute", inset:6, borderRadius:"50%", border:"1px solid #ffffff25", background:"linear-gradient(135deg,#065f3a,#0d7a4e)" }} />
    {/* أيقونة */}
    <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <Recycle size={size * 0.42} color="#ffffff" strokeWidth={1.8} />
    </div>
    {/* نقطة بريق */}
    <div style={{ position:"absolute", top:"14%", right:"18%", width:size*0.12, height:size*0.12, borderRadius:"50%", background:"#ffffff40" }} />
  </div>
);

const AuthPage = () => {
  const { login, register, resetPassword } = useAuth();
  const [mode, setMode] = useState("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [district, setDistrict] = useState("");
  const [role, setRole] = useState("citizen");
  const [municipalityId, setMunicipalityId] = useState("");
  const [isMobileAuth, setIsMobileAuth] = useState(window.innerWidth < 900);

  useEffect(() => {
    const fn = () => setIsMobileAuth(window.innerWidth < 900);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const resetForm = () => { setEmail(""); setPassword(""); setConfirmPassword(""); setFullName(""); setPhone(""); setDistrict(""); setRole("citizen"); setError(""); setSuccess(""); setShowPass(false); setShowConfirmPass(false); };

  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    if (!email || !password) { setError("يرجى تعبئة جميع الحقول"); return; }
    setLoading(true); setError("");
    const r = await login(email, password);
    if (!r.success) setError(r.error);
    setLoading(false);
  };

  const handleRegister = async (e) => {
    if (e) e.preventDefault();
    if (!email || !password || !fullName) { setError("يرجى تعبئة الحقول المطلوبة"); return; }
    if (password !== confirmPassword) { setError("كلمة المرور غير متطابقة"); return; }
    if (password.length < 6) { setError("كلمة المرور يجب أن تكون 6 أحرف على الأقل"); return; }
    setLoading(true); setError("");
    if ((role === "manager" || role === "employee" || role === "driver") && !municipalityId) { setError("اختر البلدية الفرعية التي تتبع لها"); return; }
    const r = await register({ email, password, fullName, phone, district, role, municipalityId: municipalityId || null });
    if (r.success) setSuccess("تم إنشاء الحساب بنجاح!");
    else setError(r.error);
    setLoading(false);
  };

  const handleResetPassword = async (e) => {
    if (e) e.preventDefault();
    if (!email) { setError("يرجى إدخال البريد الإلكتروني أولاً"); return; }
    setLoading(true); setError(""); setSuccess("");
    const r = await resetPassword(email);
    if (r.success) setSuccess("تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني");
    else setError(r.error);
    setLoading(false);
  };

  const F = "'Noto Kufi Arabic',sans-serif";
  const govGreen = C.accent;
  const govDark  = "#071628";
  const govCard  = "#0c1f35";
  const govBorder = "#1e3a5f";

  const fieldWrap = { position:"relative", display:"flex", flexDirection:"column", gap:6 };
  const labelSt   = { fontSize:12, color:C.muted, fontWeight:600 };
  const iconWrap   = { position:"absolute", left:14, bottom:13, color:C.dim, display:"flex", alignItems:"center" };

  return (
    <div dir="rtl" style={{ minHeight:"100vh", background:govDark, fontFamily:F, display:"flex", flexDirection:"column" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* ── شريط حكومي علوي ─────────────────────────────────────── */}
      <div style={{ background:"#051020", borderBottom:"2px solid #10b98130", padding:"8px 24px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:30, height:30, borderRadius:7, background:"linear-gradient(135deg,#10b981,#065f3a)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <ShieldCheck size={15} color="#fff" />
          </div>
          <span style={{ fontSize:12, fontWeight:800, color:C.text }}>المملكة العربية السعودية</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6, background:"#10b98115", border:"1px solid #10b98130", padding:"4px 10px", borderRadius:20 }}>
          <Lock size={10} color={govGreen} />
          <span style={{ fontSize:10, color:govGreen, fontWeight:700 }}>بوابة آمنة</span>
        </div>
      </div>

      {/* ── المحتوى الرئيسي ─────────────────────────────────────── */}
      <div style={{ flex:1, display:"flex", alignItems:"stretch", minHeight:0 }}>

        {/* عمود اليمين: الهوية والشرح — مخفي على الجوال */}
        {!isMobileAuth && (
          <div style={{ flex:"1 1 420px", background:"linear-gradient(160deg,#051020 0%,#0a1e38 60%,#071628 100%)", borderLeft:`1px solid ${govBorder}`, display:"flex", flexDirection:"column", justifyContent:"center", alignItems:"center", padding:"48px 40px", position:"relative", overflow:"hidden" }}>
            {/* زخارف خلفية */}
            <div style={{ position:"absolute", top:-80, right:-80, width:320, height:320, borderRadius:"50%", background:"radial-gradient(circle,#10b98112,transparent)" }} />
            <div style={{ position:"absolute", bottom:-60, left:-60, width:240, height:240, borderRadius:"50%", background:"radial-gradient(circle,#3b82f60a,transparent)" }} />
            {/* خط أفقي مزخرف */}
            <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:"linear-gradient(90deg,transparent,#10b98160,transparent)" }} />

            <div style={{ position:"relative", zIndex:1, textAlign:"center", maxWidth:360 }}>
              <AppLogo size={100} />
              <div style={{ marginTop:28, marginBottom:8 }}>
                <div style={{ fontSize:11, color:govGreen, fontWeight:700, letterSpacing:2, textTransform:"uppercase", marginBottom:10 }}>SMART WASTE MIS</div>
                <h2 style={{ fontSize:26, fontWeight:900, color:C.text, margin:"0 0 8px 0", lineHeight:1.3 }}>نظام إدارة النفايات الذكي</h2>
                <p style={{ fontSize:13, color:C.dim, fontWeight:600, margin:0 }}>مدينة بريدة • منطقة القصيم</p>
              </div>

              {/* فاصل */}
              <div style={{ display:"flex", alignItems:"center", gap:10, margin:"24px 0" }}>
                <div style={{ flex:1, height:1, background:"linear-gradient(90deg,transparent,#1e3a5f)" }} />
                <div style={{ width:6, height:6, borderRadius:"50%", background:govGreen }} />
                <div style={{ flex:1, height:1, background:"linear-gradient(90deg,#1e3a5f,transparent)" }} />
              </div>

              {/* شرح التطبيق */}
              <p style={{ fontSize:13, color:C.muted, lineHeight:1.9, marginBottom:24, textAlign:"right" }}>
                منصة رقمية ذكية لإدارة النفايات وتحسين جودة البيئة الحضرية، تُسهم في تحقيق أهداف رؤية المملكة 2030 نحو مدن مستدامة ونظيفة.
              </p>

              {/* مزايا */}
              {[
                { icon: <Recycle size={14} />,     text: "إدارة ذكية ومستدامة للنفايات" },
                { icon: <BellRing size={14} />,    text: "تنبيهات فورية واستجابة سريعة" },
                { icon: <BarChart2 size={14} />,   text: "تحليلات دقيقة لدعم القرار" },
                { icon: <ShieldCheck size={14} />, text: "بيئة آمنة وصلاحيات متدرجة" },
              ].map((f, i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, background:"#0a1e3820", border:"1px solid #1e3a5f40", borderRadius:8, padding:"8px 12px" }}>
                  <div style={{ color:govGreen, flexShrink:0 }}>{f.icon}</div>
                  <span style={{ fontSize:12, color:C.muted, textAlign:"right" }}>{f.text}</span>
                </div>
              ))}

              <div style={{ marginTop:24, fontSize:10, color:"#334155", display:"flex", justifyContent:"center", gap:16 }}>
                <span>الإصدار 2.0</span>
                <span>•</span>
                <span>1447/11/22 هـ</span>
                <span>•</span>
                <span>رؤية 2030</span>
              </div>
            </div>
          </div>
        )}

        {/* عمود اليسار: نموذج الدخول */}
        <div style={{ flex:"0 0 auto", width: isMobileAuth ? "100%" : 460, display:"flex", flexDirection:"column", justifyContent:"center", alignItems:"center", padding: isMobileAuth ? "24px 16px" : "40px 32px", background: isMobileAuth ? govDark : "#080f1e", overflowY:"auto" }}>

          {/* شعار للجوال فقط */}
          {isMobileAuth && (
            <div style={{ textAlign:"center", marginBottom:28 }}>
              <AppLogo size={80} />
              <div style={{ marginTop:14 }}>
                <div style={{ fontSize:11, color:govGreen, fontWeight:700, letterSpacing:1 }}>SMART WASTE MIS</div>
                <h2 style={{ fontSize:20, fontWeight:900, color:C.text, margin:"6px 0 4px" }}>نظام إدارة النفايات الذكي</h2>
                <p style={{ fontSize:12, color:C.dim, margin:0 }}>مدينة بريدة • منطقة القصيم</p>
              </div>
            </div>
          )}

          <div style={{ width:"100%", maxWidth: mode==="register" ? 420 : 380 }}>

            {/* عنوان الكارد */}
            {mode !== "forgot" && (
              <div style={{ marginBottom:24 }}>
                <h3 style={{ fontSize:18, fontWeight:800, color:C.text, margin:"0 0 4px" }}>
                  {mode === "login" ? "تسجيل الدخول" : "إنشاء حساب جديد"}
                </h3>
                <p style={{ fontSize:12, color:C.dim, margin:0 }}>
                  {mode === "login" ? "أدخل بياناتك للوصول إلى المنظومة" : "أنشئ حسابك للانضمام إلى المنظومة"}
                </p>
              </div>
            )}

            {/* تبويبات */}
            {mode !== "forgot" && (
              <div style={{ display:"flex", gap:0, marginBottom:24, background:"#051020", borderRadius:10, padding:4, border:`1px solid ${govBorder}` }}>
                {[{key:"login",label:"تسجيل دخول"},{key:"register",label:"إنشاء حساب"}].map(tab=>(
                  <button key={tab.key} onClick={()=>{setMode(tab.key);resetForm();}} style={{ flex:1, padding:"9px 0", borderRadius:8, border:"none", background:mode===tab.key?govGreen:"transparent", color:mode===tab.key?"#000":C.dim, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:F, transition:"all 0.25s" }}>{tab.label}</button>
                ))}
              </div>
            )}

            {/* استعادة كلمة المرور - رأس */}
            {mode === "forgot" && (
              <div style={{ textAlign:"center", marginBottom:24 }}>
                <div style={{ width:56, height:56, borderRadius:14, background:"linear-gradient(135deg,#10b981,#059669)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}><KeyRound size={26} color="#fff" /></div>
                <div style={{ fontSize:17, fontWeight:800, color:C.text, marginBottom:6 }}>استعادة كلمة المرور</div>
                <div style={{ fontSize:12, color:C.dim }}>أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين</div>
              </div>
            )}

            {/* رسائل */}
            {error && (
              <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, color:C.danger, background:"#ef444412", padding:"10px 14px", borderRadius:10, marginBottom:16, border:"1px solid #ef444430" }}>
                <ShieldAlert size={14} color={C.danger} style={{ flexShrink:0 }} />
                {error}
              </div>
            )}
            {success && (
              <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, color:C.accent, background:"#10b98112", padding:"10px 14px", borderRadius:10, marginBottom:16, border:"1px solid #10b98130" }}>
                <CheckCircle size={14} color={C.accent} style={{ flexShrink:0 }} />
                {success}
              </div>
            )}

            {/* ── نموذج الدخول ── */}
            {mode==="login" && (
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                <div style={fieldWrap}>
                  <label style={labelSt}>البريد الإلكتروني</label>
                  <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="example@email.com" style={{ ...inputStyle, paddingLeft:40 }} />
                  <span style={iconWrap}><Mail size={15} /></span>
                </div>
                <div style={fieldWrap}>
                  <label style={labelSt}>كلمة المرور</label>
                  <input type={showPass?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="أدخل كلمة المرور" style={{ ...inputStyle, paddingLeft:40 }} onKeyDown={e=>e.key==="Enter"&&handleLogin(e)} />
                  <span style={iconWrap}><KeyRound size={15} /></span>
                  <button onClick={()=>setShowPass(v=>!v)} style={{ position:"absolute", left:40, bottom:13, background:"none", border:"none", color:C.dim, cursor:"pointer", padding:0, display:"flex" }}>{showPass?<EyeOff size={15}/>:<Eye size={15}/>}</button>
                </div>
                <div style={{ textAlign:"left" }}>
                  <button onClick={()=>{setMode("forgot");resetForm();}} style={{ background:"none", border:"none", color:govGreen, fontSize:12, cursor:"pointer", fontFamily:F, padding:0, display:"inline-flex", alignItems:"center", gap:4 }}>
                    <KeyRound size={11} /> نسيت كلمة المرور؟
                  </button>
                </div>
                <button onClick={handleLogin} disabled={loading} style={{ padding:"13px 0", borderRadius:10, border:"none", background:loading?"#1e3a5f":"linear-gradient(135deg,#10b981,#059669)", color:loading?C.dim:"#fff", fontSize:14, fontWeight:800, cursor:loading?"not-allowed":"pointer", fontFamily:F, display:"flex", alignItems:"center", justifyContent:"center", gap:8, transition:"all 0.2s" }}>
                  {loading ? <><Clock size={15}/> جاري التحقق...</> : <><ChevronRight size={15}/> دخول إلى المنظومة</>}
                </button>
              </div>
            )}

            {/* ── نموذج الاستعادة ── */}
            {mode==="forgot" && (
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                <div style={fieldWrap}>
                  <label style={labelSt}>البريد الإلكتروني</label>
                  <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="example@email.com" style={{ ...inputStyle, paddingLeft:40 }} onKeyDown={e=>e.key==="Enter"&&handleResetPassword(e)} />
                  <span style={iconWrap}><Mail size={15} /></span>
                </div>
                <button onClick={handleResetPassword} disabled={loading} style={{ padding:"13px 0", borderRadius:10, border:"none", background:loading?"#1e3a5f":"linear-gradient(135deg,#10b981,#059669)", color:loading?C.dim:"#fff", fontSize:14, fontWeight:800, cursor:loading?"not-allowed":"pointer", fontFamily:F, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  {loading ? <><Clock size={15}/> جاري الإرسال...</> : <><Mail size={15}/> إرسال رابط الاستعادة</>}
                </button>
                <button onClick={()=>{setMode("login");resetForm();}} style={{ padding:"10px 0", borderRadius:10, border:`1px solid ${govBorder}`, background:"transparent", color:C.muted, fontSize:13, cursor:"pointer", fontFamily:F, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                  <ChevronRight size={13} style={{ transform:"rotate(180deg)" }} /> العودة لتسجيل الدخول
                </button>
              </div>
            )}

            {/* ── نموذج التسجيل ── */}
            {mode==="register" && (
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                {/* نوع الحساب */}
                <div>
                  <label style={{ ...labelSt, marginBottom:8, display:"block" }}>نوع الحساب</label>
                  <div style={{ display:"flex", gap:8 }}>
                    {ROLES_LIST.map(r=>(
                      <button key={r.value} onClick={()=>setRole(r.value)} style={{ flex:1, padding:"12px 6px", borderRadius:10, border:`2px solid ${role===r.value?r.color:govBorder}`, background:role===r.value?r.color+"15":"transparent", cursor:"pointer", textAlign:"center", transition:"all 0.2s" }}>
                        <div style={{ display:"flex", justifyContent:"center", marginBottom:6, color:role===r.value?r.color:C.dim }}>{r.icon}</div>
                        <div style={{ fontSize:11, fontWeight:700, color:role===r.value?r.color:C.muted, fontFamily:F }}>{r.label}</div>
                        <div style={{ fontSize:9, color:"#475569", marginTop:2, fontFamily:F }}>{r.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:12 }}>
                  <div style={{ gridColumn:"1/-1", ...fieldWrap }}>
                    <label style={labelSt}>الاسم الكامل *</label>
                    <input type="text" value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="الاسم الثلاثي" style={{ ...inputStyle, paddingLeft:40 }} />
                    <span style={iconWrap}><User size={15} /></span>
                  </div>
                  <div style={{ gridColumn:"1/-1", ...fieldWrap }}>
                    <label style={labelSt}>البريد الإلكتروني *</label>
                    <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="example@email.com" style={{ ...inputStyle, paddingLeft:40 }} />
                    <span style={iconWrap}><Mail size={15} /></span>
                  </div>
                  <div style={fieldWrap}>
                    <label style={labelSt}>كلمة المرور *</label>
                    <input type={showPass?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="6 أحرف على الأقل" style={{ ...inputStyle, paddingLeft:40 }} />
                    <span style={iconWrap}><KeyRound size={15} /></span>
                    <button onClick={()=>setShowPass(v=>!v)} style={{ position:"absolute", left:40, bottom:13, background:"none", border:"none", color:C.dim, cursor:"pointer", padding:0, display:"flex" }}>{showPass?<EyeOff size={15}/>:<Eye size={15}/>}</button>
                  </div>
                  <div style={fieldWrap}>
                    <label style={labelSt}>تأكيد كلمة المرور *</label>
                    <input type={showConfirmPass?"text":"password"} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="أعد كتابة كلمة المرور" style={{ ...inputStyle, paddingLeft:40 }} />
                    <span style={iconWrap}><KeyRound size={15} /></span>
                    <button onClick={()=>setShowConfirmPass(v=>!v)} style={{ position:"absolute", left:40, bottom:13, background:"none", border:"none", color:C.dim, cursor:"pointer", padding:0, display:"flex" }}>{showConfirmPass?<EyeOff size={15}/>:<Eye size={15}/>}</button>
                  </div>
                  <div style={fieldWrap}>
                    <label style={labelSt}>رقم الجوال</label>
                    <input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="05XXXXXXXX" style={{ ...inputStyle, direction:"ltr", textAlign:"right", paddingLeft:40 }} />
                    <span style={iconWrap}><Phone size={15} /></span>
                  </div>
                  <div style={fieldWrap}>
                    <label style={labelSt}>الحي</label>
                    <select value={district} onChange={e=>setDistrict(e.target.value)} style={{ ...inputStyle, appearance:"auto" }}>
                      <option value="">اختر الحي</option>
                      {DISTRICTS.map(d=><option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  {(role === "manager" || role === "employee" || role === "driver") && (
                    <div style={fieldWrap}>
                      <label style={labelSt}>البلدية الفرعية</label>
                      <select value={municipalityId} onChange={e=>setMunicipalityId(e.target.value)} style={{ ...inputStyle, appearance:"auto" }}>
                        <option value="">اختر البلدية</option>
                        {MUNICIPALITIES.map(m=><option key={m.id} value={m.id}>{m.nameAr}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <button onClick={handleRegister} disabled={loading} style={{ padding:"13px 0", borderRadius:10, border:"none", background:loading?"#1e3a5f":"linear-gradient(135deg,#10b981,#059669)", color:loading?C.dim:"#fff", fontSize:14, fontWeight:800, cursor:loading?"not-allowed":"pointer", fontFamily:F, marginTop:4, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  {loading ? <><Clock size={15}/> جاري إنشاء الحساب...</> : <><CheckCircle size={15}/> إنشاء الحساب</>}
                </button>
              </div>
            )}

            {/* تذييل الأمان */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginTop:20, padding:"10px 0", borderTop:`1px solid ${govBorder}` }}>
              <Lock size={11} color="#475569" />
              <span style={{ fontSize:11, color:"#475569" }}>جميع البيانات مشفرة بمعيار TLS 1.3</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── شريط سفلي ──────────────────────────────────────────── */}
      <div style={{ background:"#051020", borderTop:`1px solid ${govBorder}`, padding:"8px 24px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
        <span style={{ fontSize:10, color:"#334155" }}>© 1447 هـ - المملكة العربية السعودية. جميع الحقوق محفوظة.</span>
        <div style={{ display:"flex", gap:16 }}>
          {["سياسة الخصوصية","شروط الاستخدام","الدعم الفني"].map(t=>(
            <span key={t} style={{ fontSize:10, color:"#475569", cursor:"pointer" }}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// ⚙️ ACCOUNT SETTINGS MODAL (Profile + Password)
// ============================================================
const AccountSettingsModal = ({ onClose }) => {
  const { userData, changePassword, updateUserProfile, user } = useAuth();
  const [activeTab, setActiveTab] = useState("profile");
  const F = "'Noto Kufi Arabic',sans-serif";
  const inputSt = { width:"100%", padding:"12px 16px", borderRadius:12, border:"1px solid #1e293b", background:C.bg, color:C.text, fontSize:14, fontFamily:F, outline:"none", boxSizing:"border-box" };

  // Profile state
  const [fullName, setFullName] = useState(userData?.fullName || "");
  const [phone, setPhone] = useState(userData?.phone || "");
  const [district, setDistrict] = useState(userData?.district || "");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");
  const [profileError, setProfileError] = useState("");

  // Password state
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [passLoading, setPassLoading] = useState(false);
  const [passMsg, setPassMsg] = useState("");
  const [passError, setPassError] = useState("");

  const handleProfileSave = async () => {
    setProfileError(""); setProfileMsg("");
    if (!fullName.trim()) { setProfileError("الاسم مطلوب"); return; }
    setProfileLoading(true);
    const result = await updateUserProfile({ fullName: fullName.trim(), phone: phone.trim(), district });
    if (result.success) { setProfileMsg("✅ تم تحديث البيانات بنجاح"); setTimeout(() => setProfileMsg(""), 3000); }
    else setProfileError(result.error);
    setProfileLoading(false);
  };

  const handlePassChange = async () => {
    setPassError(""); setPassMsg("");
    if (!currentPass || !newPass || !confirmPass) { setPassError("يرجى تعبئة جميع الحقول"); return; }
    if (newPass !== confirmPass) { setPassError("كلمة المرور الجديدة غير متطابقة"); return; }
    if (newPass.length < 6) { setPassError("كلمة المرور يجب أن تكون 6 أحرف على الأقل"); return; }
    if (currentPass === newPass) { setPassError("كلمة المرور الجديدة يجب أن تكون مختلفة"); return; }
    setPassLoading(true);
    const result = await changePassword(currentPass, newPass);
    if (result.success) { setPassMsg("✅ تم تغيير كلمة المرور بنجاح"); setCurrentPass(""); setNewPass(""); setConfirmPass(""); setTimeout(() => setPassMsg(""), 3000); }
    else setPassError(result.error);
    setPassLoading(false);
  };

  const roleMap = { executive: { label: "إدارة عليا", color: C.warning, icon: "🏛️" }, employee: { label: "موظف", color: C.info, icon: "👷" }, citizen: { label: "مواطن", color: C.accent, icon: "🏠" } };
  const r = roleMap[userData?.role] || roleMap.citizen;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, direction:"rtl", fontFamily:F }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:500, maxHeight:"90vh", overflow:"auto", padding:"0", background:C.card, borderRadius:20, border:"1px solid #1e293b" }}>
        {/* Header */}
        <div style={{ padding:"24px 28px 0", textAlign:"center" }}>
          <div style={{ width:60, height:60, borderRadius:16, background:`${r.color}15`, border:`2px solid ${r.color}30`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, margin:"0 auto 12px" }}>{r.icon}</div>
          <h3 style={{ fontSize:18, fontWeight:900, color:C.text, margin:"0 0 4px" }}>إعدادات الحساب</h3>
          <p style={{ fontSize:12, color:C.dim, margin:0 }}>{userData?.email}</p>
          <span style={{ display:"inline-block", marginTop:8, padding:"3px 12px", borderRadius:20, fontSize:11, fontWeight:600, background:`${r.color}20`, color:r.color }}>{r.label}</span>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:0, margin:"20px 28px 0", background:C.bg, borderRadius:12, padding:4 }}>
          {[{ key:"profile", label:"👤 البيانات الشخصية" }, { key:"password", label:"🔐 كلمة المرور" }].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              flex:1, padding:"10px 0", borderRadius:10, border:"none",
              background: activeTab === tab.key ? C.accent : "transparent",
              color: activeTab === tab.key ? "#000" : C.muted,
              fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:F, transition:"all 0.3s",
            }}>{tab.label}</button>
          ))}
        </div>

        <div style={{ padding:"20px 28px 28px" }}>
          {/* ===== PROFILE TAB ===== */}
          {activeTab === "profile" && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              {profileMsg && <div style={{ fontSize:12, color:C.accent, background:"#10b98115", padding:"10px 14px", borderRadius:10, textAlign:"center", border:"1px solid #10b98130" }}>{profileMsg}</div>}
              {profileError && <div style={{ fontSize:12, color:C.danger, background:"#ef444415", padding:"10px 14px", borderRadius:10, textAlign:"center", border:"1px solid #ef444430" }}>⚠️ {profileError}</div>}

              <div>
                <label style={{ fontSize:12, color:C.muted, marginBottom:6, display:"block" }}>الاسم الكامل *</label>
                <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="الاسم الثلاثي" style={inputSt} />
              </div>

              <div>
                <label style={{ fontSize:12, color:C.muted, marginBottom:6, display:"block" }}>البريد الإلكتروني</label>
                <input type="email" value={userData?.email || ""} disabled style={{ ...inputSt, opacity:0.5, cursor:"not-allowed" }} />
                <span style={{ fontSize:10, color:C.dim, marginTop:4, display:"block" }}>لا يمكن تغيير البريد الإلكتروني</span>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:12 }}>
                <div>
                  <label style={{ fontSize:12, color:C.muted, marginBottom:6, display:"block" }}>رقم الجوال</label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="05XXXXXXXX" style={{ ...inputSt, direction:"ltr", textAlign:"right" }} />
                </div>
                <div>
                  <label style={{ fontSize:12, color:C.muted, marginBottom:6, display:"block" }}>الحي</label>
                  <select value={district} onChange={e => setDistrict(e.target.value)} style={{ ...inputSt, appearance:"auto" }}>
                    <option value="">اختر الحي</option>
                    {DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:12 }}>
                <div style={{ background:C.bg, borderRadius:10, padding:12 }}>
                  <div style={{ fontSize:10, color:C.dim }}>نوع الحساب</div>
                  <div style={{ fontSize:14, fontWeight:700, color:r.color, marginTop:4 }}>{r.icon} {r.label}</div>
                </div>
                <div style={{ background:C.bg, borderRadius:10, padding:12 }}>
                  <div style={{ fontSize:10, color:C.dim }}>تاريخ التسجيل</div>
                  <div style={{ fontSize:13, fontWeight:600, color:C.text, marginTop:4 }}>{userData?.createdAt?.split("T")[0] || "-"}</div>
                </div>
              </div>

              <div style={{ display:"flex", gap:10, marginTop:4 }}>
                <button onClick={handleProfileSave} disabled={profileLoading} style={{ flex:1, padding:12, borderRadius:10, border:"none", background:profileLoading?C.dim:"linear-gradient(135deg,#10b981,#059669)", color:"#fff", fontSize:14, fontWeight:700, cursor:profileLoading?"not-allowed":"pointer", fontFamily:F }}>{profileLoading ? "جاري الحفظ..." : "💾 حفظ التغييرات"}</button>
                <button onClick={onClose} style={{ padding:"12px 20px", borderRadius:10, border:"1px solid #1e293b", background:"transparent", color:C.muted, cursor:"pointer", fontSize:13, fontFamily:F }}>إغلاق</button>
              </div>
            </div>
          )}

          {/* ===== PASSWORD TAB ===== */}
          {activeTab === "password" && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              {passMsg && <div style={{ fontSize:12, color:C.accent, background:"#10b98115", padding:"10px 14px", borderRadius:10, textAlign:"center", border:"1px solid #10b98130" }}>{passMsg}</div>}
              {passError && <div style={{ fontSize:12, color:C.danger, background:"#ef444415", padding:"10px 14px", borderRadius:10, textAlign:"center", border:"1px solid #ef444430" }}>⚠️ {passError}</div>}

              <div>
                <label style={{ fontSize:12, color:C.muted, marginBottom:6, display:"block" }}>كلمة المرور الحالية</label>
                <input type="password" value={currentPass} onChange={e => setCurrentPass(e.target.value)} placeholder="أدخل كلمة المرور الحالية" style={inputSt} />
              </div>
              <div>
                <label style={{ fontSize:12, color:C.muted, marginBottom:6, display:"block" }}>كلمة المرور الجديدة</label>
                <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="6 أحرف على الأقل" style={inputSt} />
              </div>
              <div>
                <label style={{ fontSize:12, color:C.muted, marginBottom:6, display:"block" }}>تأكيد كلمة المرور الجديدة</label>
                <input type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="أعد كتابة كلمة المرور الجديدة" style={inputSt} onKeyDown={e => e.key === "Enter" && handlePassChange()} />
              </div>

              <div style={{ background:C.bg, borderRadius:10, padding:12, fontSize:11, color:C.dim, lineHeight:1.8 }}>
                💡 <strong style={{ color:C.muted }}>شروط كلمة المرور:</strong><br/>
                • يجب أن تكون 6 أحرف على الأقل<br/>
                • يجب أن تكون مختلفة عن الحالية
              </div>

              <div style={{ display:"flex", gap:10, marginTop:4 }}>
                <button onClick={handlePassChange} disabled={passLoading} style={{ flex:1, padding:12, borderRadius:10, border:"none", background:passLoading?C.dim:"linear-gradient(135deg,#f59e0b,#d97706)", color:"#000", fontSize:14, fontWeight:700, cursor:passLoading?"not-allowed":"pointer", fontFamily:F }}>{passLoading ? "جاري التغيير..." : "🔐 تغيير كلمة المرور"}</button>
                <button onClick={onClose} style={{ padding:"12px 20px", borderRadius:10, border:"1px solid #1e293b", background:"transparent", color:C.muted, cursor:"pointer", fontSize:13, fontFamily:F }}>إغلاق</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Keep old name as alias for backward compatibility
const ChangePasswordModal = AccountSettingsModal;

// ============================================================
// ⏳ LOADING SCREEN
// ============================================================
const LoadingScreen = () => (
  <div dir="rtl" style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:"'Noto Kufi Arabic',sans-serif", gap:20 }}>
    <style>{"@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}"}</style>
    <div style={{fontSize:48,animation:"spin 2s linear infinite"}}>♻️</div>
    <div style={{fontSize:16,fontWeight:700,color:C.text,animation:"pulse 1.5s ease infinite"}}>جاري التحميل...</div>
    <div style={{fontSize:12,color:C.dim}}>نظام إدارة النفايات الذكي - بريدة</div>
  </div>
);

// ============================================================
// 🏭 DASHBOARD + ALL PAGES (3000+ lines)
// ============================================================
const ARABIC_FONT = "'Noto Kufi Arabic', 'Segoe UI', Tahoma, sans-serif";

// --- Simulated Data ---
const generateStations = () => {
  const districts = [
    "حي الخليج", "حي الفايزية", "حي الإسكان", "حي الريان",
    "حي السالمية", "حي الحمر", "حي المنتزه", "حي الأفق",
    "حي النقع", "حي الضاحي", "حي الهلالية", "حي البصيرة"
  ];
  const types = ["عضوية", "بلاستيك", "ورق", "زجاج", "معادن", "مختلطة"];
  return Array.from({ length: 12 }, (_, i) => {
    const fillLevel = Math.random() * 100;
    const pressure = 0.5 + Math.random() * 4.5;
    const status = fillLevel > 85 ? "حرج" : fillLevel > 60 ? "تحذير" : "طبيعي";
    return {
      id: `ST-${String(i + 1).padStart(3, "0")}`,
      name: `محطة ${districts[i]}`,
      district: districts[i],
      fillLevel: Math.round(fillLevel),
      pressure: +pressure.toFixed(2),
      wasteType: types[Math.floor(Math.random() * types.length)],
      status,
      lastCollection: new Date(Date.now() - Math.random() * 172800000).toLocaleString("ar-SA"),
      temperature: Math.round(20 + Math.random() * 25),
      dailyAvg: Math.round(50 + Math.random() * 200),
      motorHealth: Math.round(70 + Math.random() * 30),
      suctionRate: Math.round(60 + Math.random() * 40),
      lat: 26.30 + Math.random() * 0.12,
      lng: 43.93 + Math.random() * 0.12,
    };
  });
};

const generateWeeklyData = () => {
  const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  return days.map((d) => ({
    day: d,
    عضوية: Math.round(100 + Math.random() * 300),
    بلاستيك: Math.round(50 + Math.random() * 150),
    ورق: Math.round(30 + Math.random() * 100),
    زجاج: Math.round(20 + Math.random() * 80),
    معادن: Math.round(10 + Math.random() * 60),
  }));
};

const generateMonthlyTrend = () =>
  Array.from({ length: 12 }, (_, i) => ({
    month: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"][i],
    عمليات_الجمع: Math.round(200 + Math.random() * 300 + i * 10),
    الكفاءة: Math.round(60 + Math.random() * 35),
    التكلفة: Math.round(5000 + Math.random() * 10000),
  }));

// --- Colors ---
const WASTE_COLORS = { عضوية: C.accent, بلاستيك: C.info, ورق: C.warning, زجاج: C.purple, معادن: C.danger };

// --- Custom Tooltip ---
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.border, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", fontFamily: ARABIC_FONT, direction: "rtl" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ fontSize: 11, color: p.color, display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, display: "inline-block" }} />
          {p.name}: <strong>{typeof p.value === "number" ? p.value.toLocaleString() : p.value}</strong>
        </div>
      ))}
    </div>
  );
};

// --- Reusable ---
const CircularGauge = ({ value, size = 80, strokeWidth = 6, color }) => {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={C.border} strokeWidth={strokeWidth} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={strokeWidth} fill="none"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size * 0.22, fontWeight: 700, color: C.text }}>{value}%</span>
      </div>
    </div>
  );
};

// Flat metric card (no decorative gradients): the icon sits on a neutral tile; `gradient` is kept for API compatibility only.
const StatCard = ({ title, value, unit, icon, trend }) => (
  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
      <div>
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.text }}>{value}{unit && <span style={{ fontSize: 13, color: C.muted }}> {unit}</span>}</div>
      </div>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: C.brand, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
    </div>
    {trend !== undefined && (
      <div style={{ fontSize: 12, color: trend > 0 ? C.accent : C.danger, marginTop: 8 }}>{trend > 0 ? "▲" : "▼"} {Math.abs(trend)}% عن الشهر الماضي</div>
    )}
  </div>
);

// getStatus is now imported from ./config — single source of truth,
// replacing this file's previous local copy (and firestoreService.js's
// separate copy, which now just re-exports the same function).

const StatusBadge = ({ status }) => {
  const m = {
    طبيعي:   { bg: "#065f4620", c: C.accent, b: "#10b98140" },
    تحذير:   { bg: "#92400e20", c: C.warning, b: "#f59e0b40" },
    حرج:     { bg: "#7f1d1d20", c: C.danger, b: "#ef444440" },
    offline: { bg: "#64748b20", c: C.dim, b: "#64748b40" }, // reserved for the bin/offline model, unused until bins carry live sensor data
  };
  const s = m[status] || m["طبيعي"];
  return <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: s.bg, color: s.c, border: `1px solid ${s.b}` }}>{status}</span>;
};

const Card = ({ children, title, icon, style: sx }) => (
  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, ...sx }}>
    {title && <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>{icon}{title}</div>}
    <div style={{ position: "relative", width: "100%" }}>{children}</div>
  </div>
);

// مكوّن يقيس العرض الفعلي بـ ResizeObserver ويمرّره للرسم — يحل مشكلة الجوال
const ChartBox = ({ height = 280, children }) => {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const measure = () => setW(ref.current.getBoundingClientRect().width || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: "100%", height, position: "relative" }}>
      {w > 0 && React.cloneElement(React.Children.only(children), { width: w, height })}
    </div>
  );
};

// ======================== SHARED: STATE BADGE / EMPTY STATE ========================
// Unified badge for the new 7-state vocabulary (normal/warning/high/critical/
// offline/fault/no_sensor) — separate from the legacy Arabic-keyed StatusBadge
// above, which existing station/container UI still relies on untouched.
const StateBadge = ({ state }) => {
  const color = STATUS_COLORS[state] || STATUS_COLORS.offline;
  const label = STATE_LABELS[state] || state;
  return (
    <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: color + "20", color, border: `1px solid ${color}40`, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
};

/** §33 — every demo-tagged bin/neighborhood/route must carry a visible "تجريبي" marker, never blended silently with live data. */
const DemoBadge = () => (
  <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: "#8b5cf620", color: C.purple, border: "1px solid #8b5cf640", whiteSpace: "nowrap" }}>
    تجريبي
  </span>
);

const EmptyState = ({ icon, title, desc }) => (
  <div style={{ textAlign: "center", padding: "40px 20px", color: C.dim }}>
    <div style={{ fontSize: 34, marginBottom: 10, opacity: 0.6 }}>{icon}</div>
    <div style={{ fontSize: 14, fontWeight: 700, color: C.muted, marginBottom: 4 }}>{title}</div>
    {desc && <div style={{ fontSize: 12, color: C.dim }}>{desc}</div>}
  </div>
);


/** Turns technical errors (Firebase codes, HTTP, network) into a short Arabic message the user can act on. */
const friendlyError = (e) => {
  const code = String(e?.code || ""), msg = String(e?.message || e || "");
  if (/permission-denied|Missing or insufficient permissions|PERMISSION_DENIED|HTTP 403|Not allowed|Outside your municipality/i.test(code + msg)) return "ليست لديك صلاحية لهذا الإجراء.";
  if (/unauthenticated|HTTP 401|Invalid token|Missing Authorization|غير مسجل الدخول/i.test(code + msg)) return "انتهت الجلسة — سجّل الدخول مجددًا ثم أعد المحاولة.";
  if (/unavailable|network|Failed to fetch|timeout|deadline-exceeded|HTTP 5\d\d/i.test(code + msg)) return "تعذر الاتصال بالخادم — تحقق من الاتصال ثم أعد المحاولة.";
  if (/not-found/i.test(code)) return "العنصر المطلوب غير موجود — ربما حُذف أو تغيّر.";
  if (/[\u0600-\u06FF]/.test(msg)) return msg; // already an Arabic, user-facing message from our own code
  console.error(e);
  return "حدث خطأ غير متوقع — أعد المحاولة، وإن تكرر أبلغ مسؤول النظام.";
};

// ======================== DESIGN SYSTEM (shared primitives) ========================
// One vocabulary for every page: spacing 4/8/12/16/24 · type 11.5 meta / 13 body / 15 section / 18 page / 22 numbers
// · radius 10–12 · status colours only for states (never decoration) · no gradients or motion.
const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
const FS = { meta: 11.5, body: 13, section: 15, page: 18, num: 22 };
const TONE = { danger: C.danger, warning: C.warning, info: C.info, ok: C.accent, neutral: C.muted, purple: C.purple };

const Btn = ({ variant = "secondary", tone, children, style: sx, ...rest }) => {
  const color = tone ? TONE[tone] || tone : C.brand;
  const base = { padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: rest.disabled ? "not-allowed" : "pointer", fontFamily: ARABIC_FONT, display: "inline-flex", alignItems: "center", gap: 6, opacity: rest.disabled ? 0.6 : 1, whiteSpace: "nowrap" };
  const v = variant === "primary" ? { background: color, color: "#fff", border: `1px solid ${color}` }
    : variant === "ghost" ? { background: "transparent", color: tone ? color : C.muted, border: "1px solid transparent" }
    : { background: C.card, color: tone ? color : C.text, border: `1px solid ${tone ? color + "66" : C.border}` };
  return <button {...rest} style={{ ...base, ...v, ...sx }}>{children}</button>;
};
const Badge = ({ tone = "neutral", children, solid = false }) => {
  const c = TONE[tone] || tone;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: solid ? c : c + "18", color: solid ? "#fff" : c, border: `1px solid ${c}40`, whiteSpace: "nowrap" }}>{children}</span>;
};
/** Every page answers: what is the situation? what needs my attention? what is the next action? */
const PageHeader = ({ title, status, attention, attentionTone = "warning", onAttention, actions, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: SP.sm, marginBottom: SP.xs }}>
    {(title || actions) && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: SP.md, flexWrap: "wrap" }}>
      {title ? <div style={{ fontSize: FS.page, fontWeight: 800, color: C.text }}>{title}</div> : <span />}
      {actions && <div style={{ display: "flex", gap: SP.sm, flexWrap: "wrap" }}>{actions}</div>}
    </div>}
    {(status || attention) && (
      <div style={{ display: "flex", gap: SP.sm, flexWrap: "wrap", fontSize: FS.body }}>
        {status && <span style={{ color: C.muted, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "6px 10px" }}><b style={{ color: C.text }}>الوضع:</b> {status}</span>}
        {attention && <span onClick={onAttention} role={onAttention ? "button" : undefined} style={{ color: TONE[attentionTone], background: TONE[attentionTone] + "12", border: `1px solid ${TONE[attentionTone]}40`, borderRadius: 10, padding: "6px 10px", cursor: onAttention ? "pointer" : "default", fontWeight: 700 }}>{attention}</span>}
      </div>
    )}
    {children}
  </div>
);
const Section = ({ title, count, actions, children, collapsible = false, defaultOpen = true, hint }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: open ? 16 : "12px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: SP.sm, marginBottom: open ? SP.md : 0, flexWrap: "wrap" }}>
        <button onClick={() => collapsible && setOpen((o) => !o)} aria-expanded={open} style={{ display: "flex", alignItems: "center", gap: SP.sm, background: "none", border: "none", padding: 0, cursor: collapsible ? "pointer" : "default", fontFamily: ARABIC_FONT, color: C.text, fontSize: FS.section, fontWeight: 700 }}>
          {collapsible && <span style={{ color: C.dim, fontSize: 12, width: 12 }}>{open ? "▾" : "◂"}</span>}
          {title}{count != null && <Badge tone="neutral">{count}</Badge>}
        </button>
        {actions && open && <div style={{ display: "flex", gap: SP.sm, flexWrap: "wrap" }}>{actions}</div>}
      </div>
      {open && hint && <div style={{ fontSize: FS.meta, color: C.dim, marginTop: -6, marginBottom: SP.md }}>{hint}</div>}
      {open && children}
    </section>
  );
};
const KpiTile = ({ label, value, unit, tone = "neutral", hint, onClick }) => (
  <div onClick={onClick} role={onClick ? "button" : undefined} style={{ background: C.card, border: `1px solid ${C.border}`, borderInlineStart: `3px solid ${TONE[tone] || tone}`, borderRadius: 10, padding: "10px 14px", cursor: onClick ? "pointer" : "default", minWidth: 0 }}>
    <div style={{ fontSize: FS.num, fontWeight: 800, color: tone === "neutral" ? C.text : TONE[tone] || tone }}>{value}{unit && <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}> {unit}</span>}</div>
    <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
    {hint && <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{hint}</div>}
  </div>
);
const KpiRow = ({ children }) => <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: SP.sm }}>{children}</div>;
/** Prioritised "needs attention" list: one line per item, an action button, details on demand. */
const AttentionList = ({ items = [], empty = "لا شيء يحتاج انتباهك الآن", max = 6 }) => {
  const [all, setAll] = useState(false);
  const [openId, setOpenId] = useState(null);
  if (items.length === 0) return <div style={{ fontSize: FS.body, color: C.accent, padding: "6px 2px" }}>✓ {empty}</div>;
  const shown = all ? items : items.slice(0, max);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {shown.map((it) => (
        <div key={it.id} style={{ border: `1px solid ${C.border}`, borderInlineStart: `3px solid ${TONE[it.tone] || C.border}`, borderRadius: 10, padding: "8px 12px", background: C.card }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: SP.sm, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: FS.body, fontWeight: 700, color: C.text }}>{it.title}</div>
              {it.meta && <div style={{ fontSize: FS.meta, color: C.muted }}>{it.meta}</div>}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {it.badge}
              {it.detail && <Btn variant="ghost" onClick={() => setOpenId(openId === it.id ? null : it.id)} aria-expanded={openId === it.id}>{openId === it.id ? "إخفاء" : "التفاصيل"}</Btn>}
              {it.actions}
              {it.actionLabel && <Btn variant="primary" tone={it.tone === "danger" ? "danger" : undefined} onClick={it.onAction}>{it.actionLabel}</Btn>}
            </div>
          </div>
          {openId === it.id && it.detail && <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.8, marginTop: 6, borderTop: `1px dashed ${C.border}`, paddingTop: 6 }}>{it.detail}</div>}
        </div>
      ))}
      {items.length > max && <Btn variant="ghost" onClick={() => setAll((a) => !a)} style={{ alignSelf: "flex-start" }}>{all ? "عرض أقل" : `عرض الكل (${items.length})`}</Btn>}
    </div>
  );
};
const Disclosure = ({ summary = "التفاصيل", children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ background: "none", border: "none", padding: 0, color: C.info, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: ARABIC_FONT }}>{open ? "▾" : "◂"} {summary}</button>
      {open && <div style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
};
/** A page that groups related views as tabs (replaces separate sidebar entries). */
const HubPage = ({ tabs, value, onChange, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: SP.md }}>
    <Tabs tabs={tabs} value={value} onChange={onChange} />
    {children}
  </div>
);
const Tabs = ({ tabs, value, onChange }) => (
  <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
    {tabs.map((t) => (
      <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)} style={{ padding: "8px 14px", border: "none", borderBottom: `2px solid ${value === t.key ? C.brand : "transparent"}`, background: "transparent", color: value === t.key ? C.brand : C.muted, fontWeight: value === t.key ? 800 : 600, fontSize: FS.body, cursor: "pointer", fontFamily: ARABIC_FONT, marginBottom: -1 }}>
        {t.label}{t.count ? <span style={{ marginInlineStart: 6 }}><Badge tone={t.tone || "neutral"}>{t.count}</Badge></span> : null}
      </button>
    ))}
  </div>
);

/**
 * decisionEngine's getNeighborhoodPriority() tier vocabulary is strictly
 * low/medium/high/critical (per spec) — it never classifies a neighborhood
 * as "offline". But the map/list UI still needs a 5th grey "no data / mostly
 * offline" display state (§9), so that's a presentation-layer rule applied
 * on top of the engine's output here, not baked into the engine itself.
 */
function neighborhoodDisplayTier(priorityResult) {
  if (!priorityResult || priorityResult.total === 0) return "offline";
  if (priorityResult.offlineCount / priorityResult.total >= 0.5) return "offline";
  return priorityResult.tier;
}

// ======================== OPERATIONAL MAP ========================
const BURAIDAH_CENTER = [26.3612, 43.9744]; // centroid of the 14 real neighborhood polygons in buraidahNeighborhoods.geo.json

function neighborhoodFeatureFor(neighborhood) {
  if (!neighborhood) return null;
  const base = normalizeNeighborhoodName(neighborhood.name);
  return buraidahNeighborhoodsGeo.features.find((f) => f.properties.baseName === base) || null;
}

// Demo-only fallback position for bins with no real lat/lng yet — deterministic
// (same bin always lands in the same spot) so markers don't jump between renders.
// Clearly flagged in the popup as approximate whenever used.
function demoPositionForBin(bin, feature) {
  if (bin.lat != null && bin.lng != null) return { pos: [bin.lat, bin.lng], demo: false };
  if (!feature) return null;
  const coords = feature.geometry.coordinates[0];
  const lats = coords.map((c) => c[1]), lngs = coords.map((c) => c[0]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const seed = String(bin.id || bin.name || "x").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const fracLat = ((seed * 9301 + 49297) % 233280) / 233280;
  const fracLng = ((seed * 4321 + 12345) % 233280) / 233280;
  return { pos: [minLat + fracLat * (maxLat - minLat), minLng + fracLng * (maxLng - minLng)], demo: true };
}

const MAP_FILTERS = [
  { key: "all", label: "عرض الكل" },
  { key: "critical", label: "الحاويات الحرجة" },
  { key: "offline", label: "مستشعرات غير متصلة" },
  { key: "thermal", label: "تنبيه حراري" },
  { key: "needsCollection", label: "تحتاج جمعًا" },
];

const MAP_LEGEND = [
  ["طبيعي (<60%)", "normal"], ["يحتاج متابعة (60–84%)", "warning"], ["حرج (≥85%)", "critical"],
  ["بلا بيانات كافية", "no_data"], ["غير متصل", "offline"], ["خلل بالمستشعر", "fault"],
];

/** GeoJSON feature per normalized neighborhood name — built once, not per render. */
const FEATURE_BY_KEY = new Map(buraidahNeighborhoodsGeo.features.map((f) => [f.properties.baseName, f]));

/** Small colored dot used in legends/panels. */
const Dot = ({ color, hollow = false, dashed = false }) => (
  <span style={{ width: 10, height: 10, borderRadius: "50%", display: "inline-block", background: hollow ? "transparent" : color, border: `2px ${dashed ? "dashed" : "solid"} ${color}`, boxSizing: "border-box" }} />
);

function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target.center, target.zoom ?? 14, { duration: 0.8 });
  }, [target, map]);
  return null;
}

/**
 * Reusable operational map — embedded (compact) in the Dashboard and shown
 * full-size on its own "الخريطة التشغيلية" page.
 * Neighborhood polygons come from buraidahNeighborhoods.geo.json — clearly
 * labeled in-UI as approximate/demo, not surveyed boundaries (see footnote).
 */
const HORIZONS = [
  { key: 0, label: "الآن" },
  { key: 1, label: "بعد ساعة" },
  { key: 3, label: "بعد 3 ساعات" },
  { key: 6, label: "بعد 6 ساعات" },
];

/** Map positions for a route's ordered stops (deterministic demo fallback for bins without coords). */
function routeStopPositions(route, bins, neighborhoods) {
  if (!route) return [];
  return (route.orderedStops || [])
    .map((s) => {
      const bin = bins.find((b) => b.id === s.binId);
      if (!bin) return null;
      const n = neighborhoods.find((n2) => n2.id === bin.neighborhoodId);
      const pos = demoPositionForBin(bin, neighborhoodFeatureFor(n));
      return pos ? { ...s, pos: pos.pos, approximate: pos.demo, bin } : null;
    })
    .filter(Boolean);
}

const OPEN_ROUTE_STATUSES_UI = ["suggested", "approved", "in_progress"];

/**
 * Reusable operational map — embedded (compact) in the Dashboard and shown
 * full-size on its own "الخريطة التشغيلية" page.
 *
 * Visual rules live in src/mapVisual.js (pure, unit-tested):
 *   bins     → green/yellow/red by actual fill; grey = no data; hollow ring = offline/fault
 *   polygons → computeNeighborhoodMapStats() over the neighborhood's bins (invalid readings excluded)
 *   horizons → predictFutureState(); predicted values drawn with a dashed ring and labelled
 *   filters  → the same predicate on markers AND polygons (non-matching polygons are dimmed)
 * Everything per-bin is computed in ONE pass per (bins, horizon, readings) — no nested lookups
 * — so thousands of markers stay cheap; Leaflet renders them on a canvas (preferCanvas).
 */
const MAP_LAYERS = [
  { key: "municipalities", label: "🏛️ البلديات" },
  { key: "neighborhoods", label: "🏘️ الأحياء" },
  { key: "bins", label: "🗑️ الحاويات" },
  { key: "routes", label: "🚛 الجولات والمركبات" },
];

const OperationalMap = ({ neighborhoods: neighborhoodsAll = [], bins: binsAll = [], fireSensors = [], recentReadings = [], routes: routesAll = [], citizenReports = [], profiles = [], municipalityFilter = null, initialLayer = "neighborhoods", height = 440, onViewBins, onAddToRoute, onOpenRoute, compact = false, initialSelectedKey = null }) => {
  const [filter, setFilter] = useState("all");
  const [layer, setLayer] = useState(initialLayer);
  // Optional municipality scope: only that municipality's neighborhoods, bins and routes are drawn.
  const neighborhoods = useMemo(() => (municipalityFilter ? neighborhoodsAll.filter((n) => municipalityForNeighborhood(n) === municipalityFilter) : neighborhoodsAll), [neighborhoodsAll, municipalityFilter]);
  const bins = useMemo(() => { if (!municipalityFilter) return binsAll; const ids = new Set(neighborhoods.map((n) => n.id)); return binsAll.filter((b) => ids.has(b.neighborhoodId)); }, [binsAll, neighborhoods, municipalityFilter]);
  const routes = useMemo(() => { if (!municipalityFilter) return routesAll; const ids = new Set(neighborhoods.map((n) => n.id)); return routesAll.filter((r) => r.municipalityId === municipalityFilter || (r.neighborhoodIds || []).some((id) => ids.has(id))); }, [routesAll, neighborhoods, municipalityFilter]);
  const [horizon, setHorizon] = useState(0);
  const [panelOpen, setPanelOpen] = useState(!compact);
  const [selectedKey, setSelectedKey] = useState(initialSelectedKey);
  const [flyTarget, setFlyTarget] = useState(null);

  const readingsByBin = useMemo(() => {
    const map = {};
    for (const r of recentReadings) { if (r.bin_id) (map[r.bin_id] ||= []).push(r); }
    return map;
  }, [recentReadings]);

  const neighborhoodById = useMemo(() => new Map(neighborhoods.map((n) => [n.id, n])), [neighborhoods]);
  const thermalFor = useMemo(() => makeThermalAlertFor(fireSensors), [fireSensors]);
  const openRoutes = useMemo(() => routes.filter((r) => OPEN_ROUTE_STATUSES_UI.includes(r.status)), [routes]);
  const binCtx = useMemo(() => makeBinContext(fireSensors, citizenReports, neighborhoods), [fireSensors, citizenReports, neighborhoods]);

  // ONE pass over all bins: position + visual state (actual or predicted) + neighborhood key.
  const binViews = useMemo(() => {
    const now = Date.now();
    const byNeighborhoodId = {};
    const views = bins.map((b) => {
      const n = neighborhoodById.get(b.neighborhoodId) || null;
      const nKey = n ? normalizeNeighborhoodName(n.name) : null;
      const posInfo = demoPositionForBin(b, nKey ? FEATURE_BY_KEY.get(nKey) || null : null);
      const vs = getBinMapState(b, { horizon, readings: horizon > 0 ? readingsByBin[b.id] || [] : [], now });
      const view = { bin: b, n, nKey, pos: posInfo?.pos || null, approx: !!posInfo?.demo, vs };
      (byNeighborhoodId[b.neighborhoodId || "__none"] ||= []).push(view);
      return view;
    });
    return { views, byNeighborhoodId };
  }, [bins, horizon, readingsByBin, neighborhoodById]);

  // ONE entry per real neighborhood (duplicate Firestore docs with the same name are merged).
  const neighborhoodStats = useMemo(() => {
    const groups = groupNeighborhoodsByName(neighborhoods, bins);
    return groups.map((g) => {
      const views = g.ids.flatMap((id) => binViews.byNeighborhoodId[id] || []);
      const thermalAlert = thermalFor(g.name);
      const stats = computeNeighborhoodMapStats(views.map((v) => v.vs), { thermalAlert });
      const citizenReportCount = binCtx.forNeighborhoodName(g.name).citizenReportCount + views.reduce((a, v) => a + binCtx.reportCountForBin(v.bin.id), 0);
      const route = openRoutes.find((r) => (r.neighborhoodIds || []).some((id) => g.ids.includes(id))) || null;
      return { key: g.key, id: g.primary.id, ids: g.ids, name: g.name, ...stats, feature: FEATURE_BY_KEY.get(g.key) || null, citizenReportCount, route, views };
    });
  }, [neighborhoods, bins, binViews, thermalFor, binCtx, openRoutes]);

  const statsByKey = useMemo(() => new Map(neighborhoodStats.map((n) => [n.key, n])), [neighborhoodStats]);

  // Municipality layer: DEMO operational zones (convex hull of member neighborhoods — not the administrative boundary) + per-municipality stats.
  const groupsAll = useMemo(() => groupNeighborhoodsByName(neighborhoodsAll, binsAll), [neighborhoodsAll, binsAll]);
  const zones = useMemo(() => operationalZones(FEATURE_BY_KEY, groupsAll, neighborhoodsAll), [groupsAll, neighborhoodsAll]);
  const munStats = useMemo(() => {
    const now = Date.now();
    const binStateById = Object.fromEntries(binsAll.map((b) => [b.id, getBinMapState(b, { now })]));
    return computeMunicipalityStats({ groups: groupsAll, neighborhoods: neighborhoodsAll, bins: binsAll, binStateById, profiles, routes: routesAll, thermalFor, now });
  }, [groupsAll, neighborhoodsAll, binsAll, profiles, routesAll, thermalFor]);
  const vehiclePositions = useMemo(() => profiles.filter((p) => p.shiftStatus === "on_shift" && p.locationSharing && p.lastLocation?.lat != null && (!municipalityFilter || p.municipalityId === municipalityFilter)).map((p) => ({ p, fresh: locationFreshness(p.lastLocation) })), [profiles, municipalityFilter]);
  const openRoutePaths = useMemo(() => (layer === "routes" ? openRoutes.map((r) => ({ r, pts: routeStopPositions(r, binsAll, neighborhoodsAll).map((x) => x.pos) })).filter((x) => x.pts.length > 1) : []), [layer, openRoutes, binsAll, neighborhoodsAll]);
  const polygonsFaint = layer !== "neighborhoods";
  const showBins = layer === "neighborhoods" || layer === "bins";

  const visibleBins = useMemo(
    () => binViews.views.filter((v) => v.pos && binMatchesFilter(filter, v.vs, { thermalAlert: v.nKey ? !!statsByKey.get(v.nKey)?.thermalAlert : false })),
    [binViews, filter, statsByKey]
  );

  const selectedStats = statsByKey.get(selectedKey);
  const hasAnyGeo = neighborhoodStats.some((n) => n.feature);
  const horizonLabel = HORIZONS.find((h) => h.key === horizon)?.label;
  const forecastSummary = useMemo(() => {
    if (horizon === 0) return null;
    let predicted = 0, missing = 0;
    for (const v of binViews.views) { if (v.vs.predicted) predicted += 1; else if (v.vs.state === "no_data") missing += 1; }
    return { predicted, missing };
  }, [binViews, horizon]);

  // Route overlay for the selected neighborhood (real roads via OSRM when available).
  const selectedRoutePoints = useMemo(
    () => (selectedStats?.route ? routeStopPositions(selectedStats.route, bins, neighborhoods) : []),
    [selectedStats, bins, neighborhoods]
  );
  const routeOrderByBinId = useMemo(() => {
    const m = {};
    for (const r of openRoutes) for (const s of r.orderedStops || []) m[s.binId] = { route: r, order: s.order };
    return m;
  }, [openRoutes]);
  const { route: selectedRoad, status: selectedRoadStatus } = useRoadRoute(selectedRoutePoints.map((p) => ({ lat: p.pos[0], lng: p.pos[1] })));

  const focusNeighborhood = (n) => {
    setSelectedKey(n.key);
    if (!n.feature) return;
    const c = polygonCentroid(n.feature.geometry);
    if (c) setFlyTarget({ center: [c.lat, c.lng], zoom: 14, _t: Date.now() });
  };

  // Deep link (dashboard banner → "عرض على الخريطة"): fly to the requested neighborhood once its data is in.
  const [consumedInitialKey, setConsumedInitialKey] = useState(null);
  if (initialSelectedKey && initialSelectedKey !== consumedInitialKey && neighborhoodStats.length > 0) {
    setConsumedInitialKey(initialSelectedKey);
    const n = statsByKey.get(initialSelectedKey);
    if (n) focusNeighborhood(n);
  }

  const routeStatusNote = (route) => route ? `${ROUTE_STATUS_LABELS[route.status] || route.status}` : null;

  return (
    <div>
      <div role="toolbar" aria-label="أدوات الخريطة" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8, alignItems: "center", fontSize: 12, color: C.muted }}>
        {[["الوقت", horizon, (v) => setHorizon(Number(v)), HORIZONS.map((h) => [h.key, h.label])], ["الطبقة", layer, setLayer, MAP_LAYERS.map((l) => [l.key, l.label.replace(/^\S+\s/, "")])], ["التصفية", filter, setFilter, MAP_FILTERS.map((f) => [f.key, f.label])]].map(([label, value, onChange, opts]) => (
          <label key={label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{label}
            <select value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 12.5, fontFamily: ARABIC_FONT }}>
              {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        ))}
        {forecastSummary && <Badge tone="info">متوقعة لـ {forecastSummary.predicted} حاوية · {forecastSummary.missing} بلا بيانات كافية</Badge>}
        {filter !== "all" && <Badge tone="neutral">{visibleBins.length} حاوية · {neighborhoodStats.filter((n) => neighborhoodMatchesFilter(filter, n)).length} حي</Badge>}
        <span style={{ marginInlineStart: "auto" }}><Btn variant="ghost" aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}>{panelOpen ? "إخفاء لوحة التفاصيل" : "لوحة التفاصيل"}</Btn></span>
      </div>
      {horizon > 0 && <div style={{ marginBottom: 8, fontSize: 11.5, color: C.info }}>الألوان تمثل الامتلاء المتوقع {horizonLabel} من محرك التنبؤ؛ الحاويات بلا بيانات كافية تظهر رمادية.</div>}

      {!hasAnyGeo && neighborhoods.length > 0 && (
        <div style={{ marginBottom: 10, fontSize: 12, color: C.warning, background: C.warning + "15", border: `1px solid ${C.warning}40`, borderRadius: 10, padding: "8px 12px" }}>
          ⚠️ لا تتطابق أسماء الأحياء الحالية مع حدود الأحياء المتوفرة — الخريطة ستظهر بلا تلوين للأحياء حتى تُحدَّث الأسماء.
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "999 1 420px", minWidth: 260, height, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}` }}>
          <MapContainer center={BURAIDAH_CENTER} zoom={12} style={{ width: "100%", height: "100%", background: C.bg }} scrollWheelZoom preferCanvas>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
            <FlyTo target={flyTarget} />
            {Object.values(zones).filter((z) => (layer === "municipalities" || municipalityFilter === z.municipalityId) && z.hull.length >= 3).map((z) => {
              const m = municipalityById(z.municipalityId); const st = munStats.byMunicipality[z.municipalityId];
              return (
                <Polygon key={`zone-${z.municipalityId}`} positions={z.hull} pathOptions={{ color: m?.color || C.info, weight: 3, dashArray: "10 6", fillColor: m?.color || C.info, fillOpacity: layer === "municipalities" ? 0.12 : 0.04, opacity: 0.9 }}>
                  <Popup>
                    <div style={{ fontFamily: ARABIC_FONT, direction: "rtl", fontSize: 13, minWidth: 220 }}>
                      <b>{m?.nameAr}</b><br />
                      <span style={{ color: "#b45309", fontSize: 11 }}>{z.label}</span><br />
                      {st && <>أحياء مُسندة: {st.neighborhoods.length} · حاويات: {st.bins} · حرجة: <b style={{ color: C.danger }}>{st.critical}</b> · متصلة بالمحاكي: {st.connectedPct != null ? `${st.connectedPct}%` : "—"}<br />سائقون متاحون: {st.driversAvailable} · جولات جارية: {st.routesActive}</>}
                    </div>
                  </Popup>
                </Polygon>
              );
            })}
            {neighborhoodStats.filter((n) => n.feature).map((n) => {
              const dimmed = !neighborhoodMatchesFilter(filter, n);
              return (
                <GeoJSON
                  key={`${n.key}-${n.state}-${dimmed}-${selectedKey === n.key}-${polygonsFaint}`}
                  data={n.feature}
                  style={() => polygonsFaint ? { ...polygonStyle(n, { selected: selectedKey === n.key, dimmed }), fillOpacity: 0.06, weight: 1, opacity: 0.5 } : polygonStyle(n, { selected: selectedKey === n.key, dimmed })}
                  eventHandlers={{ click: () => focusNeighborhood(n) }}
                >
                  <Popup>
                    <div style={{ fontFamily: ARABIC_FONT, direction: "rtl", fontSize: 13, minWidth: 200 }}>
                      <b>{n.name}</b> — <span style={{ color: n.color, fontWeight: 700 }}>{MAP_STATE_LABELS[n.state]}</span>{horizon > 0 && n.predictedCount > 0 && <span style={{ color: C.info, fontSize: 11 }}> (متوقع {horizonLabel})</span>}<br />
                      عدد الحاويات: {n.total}<br />
                      متوسط الامتلاء: {n.avgFill != null ? `${n.avgFill}%` : "—"}{n.invalidCount > 0 && <span style={{ color: "#999", fontSize: 11 }}> (مستبعد {n.invalidCount})</span>}<br />
                      حرجة: <b style={{ color: MAP_STATE_COLORS.critical }}>{n.criticalCount}</b> · تحتاج تفريغًا: <b>{n.needsEmptyingCount}</b> · متابعة: {n.warningCount}<br />
                      غير متصلة/خلل: {n.offlineCount + n.faultCount} · بلا بيانات: {n.noDataCount}<br />
                      {n.thermalAlert && <span style={{ color: C.danger }}>🔥 تنبيه حراري نشط<br /></span>}
                      {n.citizenReportCount > 0 && <span style={{ color: "#b45309" }}>📣 {n.citizenReportCount} بلاغ مواطن مفتوح<br /></span>}
                      {n.route ? (
                        <span>🧭 {n.route.routeName} ({routeStatusNote(n.route)}) — {n.route.binIds?.length || 0} حاوية<br /></span>
                      ) : n.needsEmptyingCount > 0 ? (
                        <span style={{ color: "#b45309" }}>لا توجد جولة مقترحة بعد لهذا الحي<br /></span>
                      ) : null}
                      {n.route && onOpenRoute && (
                        <button onClick={() => onOpenRoute(n.route.id)} style={{ marginTop: 6, padding: "4px 10px", borderRadius: 8, border: "1px solid #3b82f6", background: "#3b82f620", color: C.info, fontSize: 11, cursor: "pointer" }}>فتح الجولة</button>
                      )}
                    </div>
                  </Popup>
                </GeoJSON>
              );
            })}

            {selectedRoutePoints.length > 1 && (
              selectedRoad
                ? <Polyline positions={selectedRoad.coordinates} pathOptions={{ color: C.info, weight: 5, opacity: 0.9 }} />
                : <Polyline positions={selectedRoutePoints.map((p) => p.pos)} pathOptions={{ color: C.info, weight: 4, dashArray: "8 8", opacity: 0.9 }} />
            )}

            {openRoutePaths.map(({ r, pts }) => (
              <Polyline key={`rp-${r.id}`} positions={pts} pathOptions={{ color: r.status === "in_progress" ? C.accent : r.status === "approved" ? C.info : C.warning, weight: r.status === "in_progress" ? 5 : 3, dashArray: r.status === "suggested" ? "6 6" : null, opacity: 0.85 }}>
                <Popup><div style={{ fontFamily: ARABIC_FONT, direction: "rtl", fontSize: 12 }}><b>{r.routeName}</b><br />{ROUTE_STATUS_LABELS[r.status] || r.status} · {r.binIds?.length || 0} حاوية{r.driverName ? ` · ${r.driverName}` : ""}{onOpenRoute && <><br /><button onClick={() => onOpenRoute(r.id)} style={{ marginTop: 4, padding: "3px 8px", borderRadius: 6, border: "1px solid #3b82f6", background: "#3b82f620", color: C.info, fontSize: 11, cursor: "pointer" }}>فتح الجولة</button></>}</div></Popup>
              </Polyline>
            ))}
            {layer === "routes" && vehiclePositions.map(({ p, fresh }) => (
              <CircleMarker key={`veh-${p.uid}`} center={[p.lastLocation.lat, p.lastLocation.lng]} radius={11} pathOptions={{ color: "#fff", weight: 2, fillColor: fresh.state === "live" ? C.info : C.dim, fillOpacity: 0.95, dashArray: fresh.state === "live" ? null : "3 3" }}>
                <Popup><div style={{ fontFamily: ARABIC_FONT, direction: "rtl", fontSize: 12 }}><b>🚛 {p.fullName}</b><br />{fresh.state === "live" ? "موقع مباشر" : `آخر موقع قبل ${fresh.ageMin} د`}</div></Popup>
              </CircleMarker>
            ))}
            {showBins && visibleBins.map(({ bin: b, n, pos, approx, vs }) => {
              const inRoute = routeOrderByBinId[b.id];
              const highlighted = !!(inRoute && selectedStats?.route?.id === inRoute.route.id);
              const reports = binCtx.reportCountForBin(b.id);
              return (
                <CircleMarker key={b.id} center={pos} radius={highlighted ? 10 : vs.state === "critical" ? 8 : 7} pathOptions={markerStyle(vs, { highlighted })}>
                  <Popup>
                    <div style={{ fontFamily: ARABIC_FONT, direction: "rtl", fontSize: 13, minWidth: 190 }}>
                      <b>{b.name}</b>{approx && <span style={{ color: "#999", fontSize: 11 }}> (موقع تقريبي)</span>}<br />
                      الحي: {n?.name || "—"}<br />
                      الحالة: <span style={{ color: vs.color, fontWeight: 700 }}>{MAP_STATE_LABELS[vs.state]}</span>{vs.hot && <span style={{ color: C.danger }}> · 🔥 حرارة مرتفعة</span>}<br />
                      {vs.predicted ? (
                        <span>الامتلاء الآن: {vs.actualFill != null ? `${vs.actualFill}%` : "—"} ← <b style={{ color: C.info }}>متوقع {horizonLabel}: {vs.fill}%</b><br /></span>
                      ) : (
                        <span>الامتلاء: {vs.actualFill != null ? `${vs.actualFill}%` : "—"}{horizon > 0 && vs.state === "no_data" && <span style={{ color: "#999", fontSize: 11 }}> — {vs.forecastReason}</span>}<br /></span>
                      )}
                      الحرارة: {b.lastTemperatureCelsius != null ? `${b.lastTemperatureCelsius}°` : "—"}<br />
                      حالة المستشعر: {sensorStateLabel(b, vs.connectivity)}<br />
                      آخر قراءة: {getReadingAgeLabel(b.lastReadingAt)}<br />
                      {reports > 0 && <span style={{ color: "#b45309" }}>📣 {reports} بلاغ مواطن على هذه الحاوية<br /></span>}
                      الجولة: {inRoute ? `${inRoute.route.routeName} — التوقف #${inRoute.order} (${routeStatusNote(inRoute.route)})` : "خارج أي جولة حاليًا"}<br />
                      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                        {inRoute && onOpenRoute && (
                          <button onClick={() => onOpenRoute(inRoute.route.id)} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #3b82f6", background: "#3b82f620", color: C.info, fontSize: 11, cursor: "pointer" }}>فتح الجولة</button>
                        )}
                        {!inRoute && onAddToRoute && (
                          <button onClick={() => onAddToRoute(b)} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #10b981", background: "#10b98120", color: C.accent, fontSize: 11, cursor: "pointer" }}>إضافة للجولة</button>
                        )}
                      </div>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>

        {(panelOpen || selectedStats) && <div style={{ flex: "1 1 300px", maxWidth: "100%", minWidth: 260 }}>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 10, display: "flex", flexWrap: "wrap", gap: 10 }}>
            {layer === "municipalities" ? MUNICIPALITIES.map((m) => (
              <span key={m.id} style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 0, borderTop: `3px dashed ${m.color}`, display: "inline-block" }} />{m.shortAr}</span>
            )) : MAP_LEGEND.map(([label, key]) => (
              <span key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <Dot color={MAP_STATE_COLORS[key]} hollow={key === "offline" || key === "fault"} />{label}
              </span>
            ))}
            {layer === "routes" && <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Dot color={C.info} />مركبة (موقع مباشر)</span>}
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Dot color={C.info} hollow dashed />قيمة متوقعة</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 16, height: 0, borderTop: `3px dashed ${C.info}`, display: "inline-block" }} />مسار جولة
            </span>
          </div>

          {selectedStats ? (
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{selectedStats.name}</div>
                <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: selectedStats.color + "20", color: selectedStats.color, border: `1px solid ${selectedStats.color}40`, whiteSpace: "nowrap" }}>
                  {MAP_STATE_LABELS[selectedStats.state]}
                </span>
              </div>
              {horizon > 0 && (
                <div style={{ fontSize: 11, color: C.info, marginBottom: 6 }}>🔮 حالة متوقعة {horizonLabel} — {selectedStats.predictedCount} من {selectedStats.total} حاوية لها توقع موثوق</div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px", fontSize: 12, color: C.muted, lineHeight: 1.9 }}>
                <div>عدد الحاويات: <b style={{ color: C.text }}>{selectedStats.total}</b></div>
                <div>متوسط الامتلاء: <b style={{ color: C.text }}>{selectedStats.avgFill != null ? `${selectedStats.avgFill}%` : "—"}</b></div>
                <div>حرجة: <b style={{ color: MAP_STATE_COLORS.critical }}>{selectedStats.criticalCount}</b></div>
                <div>تحتاج تفريغًا: <b style={{ color: C.warning }}>{selectedStats.needsEmptyingCount}</b></div>
                <div>تحتاج متابعة: <b style={{ color: MAP_STATE_COLORS.warning }}>{selectedStats.warningCount}</b></div>
                <div>طبيعية: <b style={{ color: MAP_STATE_COLORS.normal }}>{selectedStats.normalCount}</b></div>
                <div>غير متصلة/خلل: <b style={{ color: C.dim }}>{selectedStats.offlineCount + selectedStats.faultCount}</b></div>
                <div>بلا بيانات: <b style={{ color: C.dim }}>{selectedStats.noDataCount}</b></div>
                <div>تنبيه حراري: <b style={{ color: selectedStats.thermalAlert ? C.danger : C.accent }}>{selectedStats.thermalAlert ? "نعم" : "لا"}</b></div>
                <div>بلاغات مفتوحة: <b style={{ color: selectedStats.citizenReportCount > 0 ? C.warning : C.text }}>{selectedStats.citizenReportCount || 0}</b></div>
              </div>
              {selectedStats.invalidCount > 0 && (
                <div style={{ fontSize: 10.5, color: C.dim, marginTop: 4 }}>المتوسط محسوب من {selectedStats.validCount} قراءة صالحة؛ استُبعدت {selectedStats.invalidCount}.</div>
              )}
              {selectedStats.reasons?.length > 0 && (
                <ul style={{ margin: "10px 0 0", paddingInlineStart: 18, fontSize: 12, color: C.muted }}>
                  {selectedStats.reasons.map((r, i) => (<li key={i}>{r}</li>))}
                </ul>
              )}

              <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: selectedStats.route ? C.info + "12" : C.card, border: `1px solid ${selectedStats.route ? C.info + "40" : C.border}` }}>
                {selectedStats.route ? (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.info, marginBottom: 4 }}>🧭 {selectedStats.route.routeName}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>
                      {ROUTE_STATUS_LABELS[selectedStats.route.status] || selectedStats.route.status} · {selectedStats.route.binIds?.length || 0} حاوية · {selectedRoad ? `${selectedRoad.distanceKm} كم طرق فعلية · ~${selectedRoad.durationMin} د` : `${selectedStats.route.estimatedDistanceKm} كم تقريبًا`}
                    </div>
                    {selectedRoutePoints.length > 1 && <RoadRouteNote road={selectedRoad} status={selectedRoadStatus} />}
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
                      {(selectedStats.route.orderedStops || []).slice(0, 4).map((s) => `#${s.order} ${s.binName}`).join(" ← ")}
                      {(selectedStats.route.orderedStops || []).length > 4 ? " …" : ""}
                    </div>
                    {onOpenRoute && (
                      <button onClick={() => onOpenRoute(selectedStats.route.id)} style={{ marginTop: 8, padding: "7px 14px", borderRadius: 8, border: "none", background: C.info, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>
                        فتح الجولة
                      </button>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 11.5, color: selectedStats.needsEmptyingCount > 0 ? C.warning : C.dim }}>
                    {selectedStats.needsEmptyingCount > 0
                      ? "⚠️ حاويات تحتاج تفريغًا بلا جولة مقترحة بعد — ولّد الجولات من صفحة إدارة الجولات."
                      : "لا توجد جولة مفتوحة لهذا الحي — الوضع ضمن المعدل الطبيعي."}
                  </div>
                )}
              </div>

              {onViewBins && (
                <button onClick={() => onViewBins(selectedStats.id)} style={{ marginTop: 10, padding: "8px 16px", borderRadius: 10, border: "none", background: C.accent, color: "#07231A", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>
                  عرض الحاويات
                </button>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.dim, padding: 16, border: `1px dashed ${C.border}`, borderRadius: 12, textAlign: "center" }}>
              اضغط على أي حي بالخريطة لعرض تفاصيله والجولة المرتبطة به
            </div>
          )}

          <div style={{ marginTop: 10 }}><Disclosure summary="كيف يُحسب لون الحي؟"><div style={{ fontSize: 11, color: C.dim, lineHeight: 1.8 }}>
            لون الحي يُحسب من حاوياته: نسبة وعدد الحاويات الحرجة ومتوسط الامتلاء (القراءات غير المتصلة/الخاطئة مستبعدة من المتوسط ومعدودة). حدود الأحياء من OpenStreetMap (حي السلامة موضع تقريبي)، والمواقع المعلَّمة "(موقع تقريبي)" لحاويات بلا إحداثيات مسجلة. خط الجولة على الطرق الفعلية عبر OSRM عند توفره.
          </div></Disclosure></div>
        </div>}
      </div>
    </div>
  );
};

// ======================== STANDALONE MAP PAGE ========================
// ======================== MUNICIPALITIES & OPERATIONAL ZONES (Phase 2) ========================
/** "متصل" for a real device; "متصل بالمحاكي" for a demo/simulated bin — never call a virtual sensor "متصل فعليًا". */
const sensorStateLabel = (bin, connectivity) => {
  const sim = !!(bin?.demo || bin?.simulated);
  if (connectivity === "online") return sim ? "متصل بالمحاكي" : "متصل";
  if (connectivity === "offline") return sim ? "غير متصل (محاكي)" : "غير متصل";
  if (connectivity === "fault") return sim ? "خلل بالمستشعر (محاكي)" : "خلل بالمستشعر";
  return "بدون مستشعر";
};

/** Wall-clock read used inside memos (kept out of the React-compiler purity check: the value is a snapshot, re-taken whenever inputs change). */
const currentTimeMs = () => Date.now();

const DemoEnvBanner = () => (
  <div title="بيئة عرض تجريبية — بيانات المستشعرات محاكاة (مصدر كل قراءة: SIMULATED)" style={{ background: "linear-gradient(90deg, #7c3aed, #4c1d95)", color: "#fff", fontSize: 12, fontWeight: 700, textAlign: "center", padding: "5px 12px", fontFamily: ARABIC_FONT, letterSpacing: 0.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", height: 26, boxSizing: "border-box", lineHeight: "16px" }}>
    🧪 بيئة عرض تجريبية — بيانات المستشعرات محاكاة (مصدر كل قراءة: SIMULATED) · التقسيم البلدي من مصادر رسمية، وحدود النطاقات تشغيلية تجريبية
  </div>
);

const MUN_STATUS_LABEL = { normal: ["تشغيل طبيعي", C.accent], warning: ["يحتاج متابعة", C.warning], critical: ["تدخل عاجل", C.danger], no_data: ["لا بيانات", C.dim] };

const MunicipalityCard = ({ s, onOpen }) => {
  const [label, color] = MUN_STATUS_LABEL[s.status] || MUN_STATUS_LABEL.no_data;
  const m = s.municipality;
  const cell = (v, l, c = C.text) => <div style={{ background: C.bg, borderRadius: 8, padding: "6px 8px", textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 10, color: C.muted }}>{l}</div></div>;
  return (
    <div onClick={() => onOpen(m.id)} style={{ background: C.card, border: `1px solid ${m.color}50`, borderTop: `4px solid ${m.color}`, borderRadius: 14, padding: 14, cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div><div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{m.nameAr}</div><div style={{ fontSize: 10.5, color: C.dim }}>{m.areaKm2} كم² (التقرير السنوي 2024) · {s.neighborhoods.length} حي مُسند</div></div>
        <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: color + "20", color, border: `1px solid ${color}40`, whiteSpace: "nowrap" }}>{label}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {cell(s.neighborhoods.length, "أحياء")}
        {cell(s.bins, "حاويات")}
        {cell(s.connectedPct != null ? `${s.connectedPct}%` : "—", "متصلة بالمحاكي", s.connectedPct == null ? C.dim : s.connectedPct >= 90 ? C.accent : C.warning)}
        {cell(s.critical, "حرجة", s.critical ? C.danger : C.text)}
        {cell(s.driversAvailable, "سائقون متاحون", s.driversAvailable ? C.accent : C.text)}
        {cell(s.vehiclesActive, "مركبات نشطة")}
        {cell(s.routesActive, "جولات جارية", s.routesActive ? C.info : C.text)}
        {cell(s.routesSuggested, "مقترحة", s.routesSuggested ? C.warning : C.text)}
      </div>
      {(s.thermal > 0 || s.incidentsOpen > 0) && <div style={{ fontSize: 11, color: C.warning, marginTop: 6 }}>{s.thermal > 0 ? `🔥 ${s.thermal} تنبيه حراري ` : ""}{s.incidentsOpen > 0 ? `🚧 ${s.incidentsOpen} بلاغ مفتوح` : ""}</div>}
    </div>
  );
};

const MunicipalityDashboard = ({ mid, stats, neighborhoods = [], bins = [], fireSensors = [], recentReadings = [], routes = [], citizenReports = [], profiles = [], vehicles = [], incidents = [], supportRequests = [], loggedInUser, onBack, onOpenRoute, onViewBins, onAddToRoute }) => {
  const [tab, setTab] = useState("map");
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportMsg, setSupportMsg] = useState("");
  const cityPressure = useCityPressure({ neighborhoods, bins, profiles, vehicles, routes, incidents, recentReadings });
  const myPressure = cityPressure.pressures.find((p) => p.municipalityId === mid) || null;
  const m = municipalityById(mid);
  const s = stats.byMunicipality[mid];
  const munNeighborhoods = useMemo(() => neighborhoods.filter((n) => municipalityForNeighborhood(n) === mid), [neighborhoods, mid]);
  const nIds = useMemo(() => new Set(munNeighborhoods.map((n) => n.id)), [munNeighborhoods]);
  const munBins = useMemo(() => bins.filter((b) => nIds.has(b.neighborhoodId)), [bins, nIds]);
  const munRoutes = useMemo(() => routes.filter((r) => r.municipalityId === mid || (r.neighborhoodIds || []).some((id) => nIds.has(id))), [routes, mid, nIds]);
  const munProfiles = profiles.filter((p) => p.municipalityId === mid);
  const munVehicles = vehicles.filter((v) => v.municipalityId === mid);
  const munIncidents = incidents.filter((i) => i.municipalityId === mid);
  const impact = useMemo(() => {
    const ctx = makeBinContext(fireSensors, citizenReports, munNeighborhoods);
    const scored = munBins.map((bin) => ({ bin, priority: getBinPriority(bin, null, [], ctx.forBin(bin)) }));
    return computeImpactMetrics(groupNeighborhoodsByName(munNeighborhoods, munBins), scored, munRoutes, { depot: DEFAULT_DEPOT });
  }, [munBins, munNeighborhoods, munRoutes, fireSensors, citizenReports]);
  const canOverride = can(loggedInUser?.role, "municipalities.manage");
  const [overrideBusy, setOverrideBusy] = useState("");
  const tabs = [["map", "🗺️ الخريطة"], ["neighborhoods", "🏘️ الأحياء"], ["bins", "🗑️ الحاويات والمستشعرات"], ["fleet", "🚛 السائقون والمركبات"], ["routes", "🧭 الجولات"], ["incidents", "🚧 البلاغات"], ["kpi", "📊 مؤشرات الأداء"]];
  const [label, color] = MUN_STATUS_LABEL[s?.status] || MUN_STATUS_LABEL.no_data;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          {onBack && <button onClick={onBack} style={{ background: "none", border: "none", color: C.info, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT, padding: 0 }}>← كل البلديات</button>}
          <div style={{ fontSize: 18, fontWeight: 900, color: C.text, display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 14, height: 14, borderRadius: 4, background: m.color, display: "inline-block" }} />{m.nameAr} <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: color + "20", color }}>{label}</span></div>
          <div style={{ fontSize: 11.5, color: C.dim }}>هاتف {m.phone} · {m.email} · المساحة {m.areaKm2} كم² · <a href={m.scopeMap.url} target="_blank" rel="noreferrer" style={{ color: C.info }}>خريطة النطاق الرسمية (PDF)</a> · النطاق المرسوم تشغيلي تجريبي</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={{ padding: "7px 12px", borderRadius: 10, border: `1px solid ${tab === k ? m.color : C.border}`, background: tab === k ? m.color + "25" : "transparent", color: tab === k ? C.text : C.muted, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: ARABIC_FONT }}>{l}</button>)}
        </div>
      </div>

      {tab === "map" && <OperationalMap neighborhoods={neighborhoods} bins={bins} fireSensors={fireSensors} recentReadings={recentReadings} routes={routes} citizenReports={citizenReports} profiles={profiles} municipalityFilter={mid} height={560} onViewBins={onViewBins} onAddToRoute={onAddToRoute} onOpenRoute={onOpenRoute} />}

      {tab === "neighborhoods" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(s?.neighborhoods || []).length === 0 && <EmptyState icon="🏘️" title="لا أحياء مُسندة لهذه البلدية بعد" />}
          {munNeighborhoods.map((n) => {
            const a = n.municipalityAssignment || defaultAssignmentFor(n.name) || {};
            const off = isOfficialNeighborhoodName(n.name);
            const nb = munBins.filter((b) => b.neighborhoodId === n.id);
            const crit = nb.filter((b) => getBinMapState(b).state === "critical").length;
            return (
              <div key={n.id} style={{ background: C.card, border: `1px solid ${crit ? C.danger + "60" : C.border}`, borderRadius: 12, padding: 12, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
                <div>
                  <b style={{ color: C.text, fontSize: 14 }}>{n.name}</b> <span style={{ fontSize: 10.5, color: off.official ? C.accent : C.warning }}>{off.official ? `✓ اسم رسمي (واس${off.kind === "variant" ? `: ${off.match}` : ""})` : "⚠️ الاسم غير موجود في القائمة الرسمية"}</span>
                  <div style={{ color: C.muted, marginTop: 2 }}>{nb.length} حاوية · {crit} حرجة · التبعية: <b style={{ color: a.source === "admin_override" ? C.info : C.warning }}>{a.source === "admin_override" ? "استثناء تشغيلي معتمد" : `قراءة بصرية للخريطة الرسمية — ثقة ${{ high: "عالية", medium: "متوسطة", low: "منخفضة" }[a.confidence] || "—"} (غير متحقق)`}</b></div>
                  {a.evidence && <div style={{ color: C.dim, fontSize: 11 }}>{a.evidence}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {canOverride && (
                    <select disabled={overrideBusy === n.id} value={municipalityForNeighborhood(n) || ""} onChange={async (e) => { const to = e.target.value; const reason = window.prompt("مبرر الاستثناء التشغيلي (يُسجَّل):", "") ?? ""; if (!to) return; setOverrideBusy(n.id); try { await setNeighborhoodMunicipality(n.id, to, { uid: loggedInUser?.uid, name: loggedInUser?.name }, reason); } finally { setOverrideBusy(""); } }} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 11.5, fontFamily: ARABIC_FONT }}>
                      {MUNICIPALITIES.map((mm) => <option key={mm.id} value={mm.id}>{mm.shortAr}</option>)}
                    </select>
                  )}
                  {onViewBins && <button onClick={() => onViewBins(n.id)} style={smallBtn(C.accent)}>الحاويات</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "bins" && <BinsPage neighborhoods={munNeighborhoods} bins={munBins} routes={munRoutes} fireSensors={fireSensors} citizenReports={citizenReports} loading={false} initialNeighborhoodId={null} onAddToRoute={onAddToRoute} onOpenRoute={onOpenRoute} />}

      {tab === "fleet" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Card title={`السائقون (${munProfiles.length})`} icon={<Users size={16} color={C.muted} />}>
            {munProfiles.length === 0 ? <EmptyState icon="🧑‍✈️" title="لا سائقين مرتبطين بهذه البلدية" desc="يُربط السائق ببلديته من إدارة المستخدمين، وبمركبته ونطاقه من صفحة السائقون والأسطول." /> : munProfiles.map((p) => (
              <div key={p.uid} style={{ padding: "8px 10px", background: C.bg, borderRadius: 8, marginBottom: 6, fontSize: 12 }}><b style={{ color: C.text }}>{p.fullName}</b> · {SHIFT_STATUS_LABELS[p.shiftStatus] || p.shiftStatus} · {AVAILABILITY_LABELS[p.availability] || "—"} · {munVehicles.find((v) => v.id === p.vehicleId)?.vehicleNumber || vehicles.find((v) => v.id === p.vehicleId)?.vehicleNumber || "بلا مركبة"}<div style={{ color: C.dim, fontSize: 11 }}>النطاق: {(p.neighborhoodKeys || []).map((k) => `حي ${k}`).join("، ") || "غير محدد"}</div></div>
            ))}
          </Card>
          <Card title={`المركبات (${munVehicles.length})`} icon={<Truck size={16} color={C.muted} />}>
            {munVehicles.length === 0 ? <EmptyState icon="🚛" title="لا مركبات مرتبطة بهذه البلدية" /> : munVehicles.map((v) => (
              <div key={v.id} style={{ padding: "8px 10px", background: C.bg, borderRadius: 8, marginBottom: 6, fontSize: 12 }}><b style={{ color: C.text }}>{v.vehicleNumber}</b> · {VEHICLE_STATUS_LABELS[v.status] || v.status} · {v.capacityLiters} لتر · {v.driverName || "بلا سائق"}</div>
            ))}
          </Card>
        </div>
      )}

      {tab === "routes" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {munRoutes.length === 0 && <EmptyState icon="🧭" title="لا جولات لهذه البلدية" />}
          {[...munRoutes].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 40).map((r) => (
            <div key={r.id} onClick={() => onOpenRoute && onOpenRoute(r.id)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, cursor: onOpenRoute ? "pointer" : "default", flexWrap: "wrap" }}>
              <span><b style={{ color: C.text }}>{r.routeName}</b> · {r.binIds?.length || 0} حاوية · {r.estimatedDistanceKm} كم</span>
              <span style={{ color: C.muted }}>{ROUTE_STATUS_LABELS[r.status] || r.status}{r.driverName ? ` · ${r.driverName}` : ""}{r.status === "in_progress" ? ` · ${routeProgress(r).collected}/${routeProgress(r).total}` : ""}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "incidents" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {munIncidents.length === 0 && <EmptyState icon="✅" title="لا بلاغات ميدانية لهذه البلدية" />}
          {munIncidents.map((inc) => { const t = INCIDENT_TYPES[inc.type] || { label: inc.type, icon: "❓" }; return (
            <div key={inc.id} style={{ background: C.bg, borderRadius: 8, padding: "8px 10px", fontSize: 12, borderRight: `3px solid ${inc.status === "open" ? C.danger : C.dim}` }}><b style={{ color: C.text }}>{t.icon} {t.label}</b> · {inc.driverName} · {inc.routeName} · {inc.status === "open" ? "مفتوح" : inc.status === "reviewed" ? "تمت المراجعة" : "محلول"}</div>
          ); })}
        </div>
      )}

      {tab === "kpi" && s && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {[["أحياء", s.neighborhoods.length, C.info], ["حاويات", s.bins, C.text], ["متصلة بالمحاكي", s.connectedPct != null ? `${s.connectedPct}%` : "—", C.accent], ["حرجة الآن", s.critical, C.danger], ["تحتاج متابعة", s.warning, C.warning], ["بلا بيانات", s.noData, C.dim], ["في المناوبة", s.driversOnShift, C.info], ["متاحون", s.driversAvailable, C.accent], ["مركبات نشطة", s.vehiclesActive, C.purple], ["جولات جارية", s.routesActive, C.info], ["مقترحة / معتمدة", `${s.routesSuggested} / ${s.routesApproved}`, C.warning], ["بلاغات مفتوحة", s.incidentsOpen, s.incidentsOpen ? C.danger : C.dim]].map(([l, v, c]) => (
              <div key={l} style={{ background: C.card, border: `1px solid ${c}30`, borderRadius: 12, padding: "12px 14px" }}><div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 11, color: C.muted }}>{l}</div></div>
            ))}
          </div>
          <ImpactCard impact={impact} compact accent={m.color} />
          {myPressure && (() => { const [lab, col] = PRESSURE_LABEL[myPressure.level]; const open = supportRequests.filter((r) => r.municipalityId === mid && r.status === "open"); return (
            <Card title="🆘 الضغط التشغيلي وطلب الدعم من الأمانة" icon={<AlertTriangle size={16} color={C.muted} />}>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.9 }}>مؤشر الضغط الآن: <b style={{ color: col }}>{myPressure.index} ({lab})</b> — {myPressure.reasons.join(" · ")}</div>
              {supportMsg && <div style={{ fontSize: 12, color: C.text, marginTop: 6 }}>{supportMsg}</div>}
              {open.length > 0 && <div style={{ fontSize: 12, color: C.info, marginTop: 6 }}>طلب دعم مفتوح لدى الأمانة: {open.map((r) => r.need).join("، ")}</div>}
              {can(loggedInUser?.role, "support.request") && open.length === 0 && (
                <button disabled={supportBusy} onClick={async () => { const need = window.prompt("ما المطلوب من الأمانة؟ (مثال: مركبة إضافية لمناوبة اليوم)", "مركبة إضافية مع سائق"); if (!need) return; setSupportBusy(true); try { await createSupportRequest({ municipalityId: mid, need, note: "", pressureIndex: myPressure.index, pressureLevel: myPressure.level, evidence: myPressure.reasons, critical: myPressure.critical, readyDrivers: myPressure.readyDrivers, usableVehicles: myPressure.usableVehicles }, { uid: loggedInUser?.uid, name: loggedInUser?.name }); await writeAuditLog("support_request_created", loggedInUser?.uid, loggedInUser?.name, { municipalityId: mid, need, pressureIndex: myPressure.index }); setSupportMsg("📨 أُرسل طلب الدعم إلى الأمانة مع أدلة الضغط التشغيلي"); } catch (e) { setSupportMsg("تعذر تنفيذ العملية: " + friendlyError(e)); } finally { setSupportBusy(false); } }} style={{ ...smallBtn(C.warning, true), color: "#fff", marginTop: 8 }}>📨 طلب دعم من الأمانة</button>
              )}
            </Card>
          ); })()}
        </div>
      )}
    </div>
  );
};

const MunicipalitiesPage = ({ neighborhoods = [], bins = [], fireSensors = [], recentReadings = [], routes = [], citizenReports = [], profiles = [], vehicles = [], incidents = [], supportRequests = [], loggedInUser, onOpenRoute, onViewBins, onAddToRoute, initialMunicipalityId = null }) => {
  const scope = scopeFor(loggedInUser);
  const [selected, setSelected] = useState(initialMunicipalityId || (scope.all ? null : scope.municipalityId));
  const thermalFor = useMemo(() => makeThermalAlertFor(fireSensors), [fireSensors]);
  const stats = useMemo(() => {
    const groups = groupNeighborhoodsByName(neighborhoods, bins);
    const now = currentTimeMs();
    const binStateById = Object.fromEntries(bins.map((b) => [b.id, getBinMapState(b, { now })]));
    return computeMunicipalityStats({ groups, neighborhoods, bins, binStateById, profiles, vehicles, routes, incidents, thermalFor, now });
  }, [neighborhoods, bins, profiles, vehicles, routes, incidents, thermalFor]);
  const common = { stats, neighborhoods, bins, fireSensors, recentReadings, routes, citizenReports, profiles, vehicles, incidents, supportRequests, loggedInUser, onOpenRoute, onViewBins, onAddToRoute };
  if (selected) return <MunicipalityDashboard mid={selected} {...common} onBack={scope.all ? () => setSelected(null) : null} />;
  const totals = Object.values(stats.byMunicipality).reduce((a, s) => ({ bins: a.bins + s.bins, critical: a.critical + s.critical, routesActive: a.routesActive + s.routesActive, assigned: a.assigned + s.neighborhoods.length }), { bins: 0, critical: 0, routesActive: 0, assigned: 0 });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 900, color: C.text }}>البلديات والنطاقات التشغيلية — أمانة منطقة القصيم ← بريدة</div>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>ست بلديات فرعية (المصدر: أمانة منطقة القصيم). {totals.assigned} حي مُسند · {totals.bins} حاوية · {totals.critical} حرجة · {totals.routesActive} جولة جارية{stats.unassigned.length ? ` · ${stats.unassigned.length} حي بلا تبعية: ${stats.unassigned.map((g) => g.name).join("، ")}` : ""}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 12 }}>
        {MUNICIPALITIES.map((m) => <MunicipalityCard key={m.id} s={stats.byMunicipality[m.id]} onOpen={setSelected} />)}
      </div>
      <div style={{ fontSize: 10.5, color: C.dim, lineHeight: 1.8 }}>
        الأسماء والهواتف والمساحات من صفحة البلديات الفرعية والتقرير السنوي 2024 لأمانة منطقة القصيم (رسمي). تبعية الأحياء قراءة بصرية لخرائط النطاق الرسمية (غير متحقق منها) قابلة للتعديل من مدير المنصة مع حفظ السجل. مؤشرات الحاويات من المحاكي التجريبي.
      </div>
    </div>
  );
};

const MapPage = ({ neighborhoods = [], bins = [], fireSensors = [], recentReadings = [], routes = [], citizenReports = [], profiles = [], loading, onViewBins, onAddToRoute, onOpenRoute, initialSelectedKey = null }) => {
  if (loading) return <EmptyState icon="⏳" title="جاري تحميل الخريطة…" />;
  if (neighborhoods.length === 0) {
    return <EmptyState icon="🗺️" title="لا توجد أحياء مسجلة بعد" desc="تُهيّأ الأحياء والحاويات من «الإعدادات ← البلديات والبيانات والتكامل»." />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 12.5, color: C.muted }}>اضغط على حي لعرض حالته والجولة المرتبطة به. أدوات التصفية في الشريط أعلى الخريطة، والتفاصيل في اللوحة الجانبية القابلة للإخفاء.</div>
      <OperationalMap neighborhoods={neighborhoods} bins={bins} fireSensors={fireSensors} recentReadings={recentReadings} routes={routes} citizenReports={citizenReports} profiles={profiles} height="max(480px, calc(100vh - 230px))" onViewBins={onViewBins} onAddToRoute={onAddToRoute} onOpenRoute={onOpenRoute} initialSelectedKey={initialSelectedKey} />
    </div>
  );
};

// ======================== BROWSER NOTIFICATIONS (shared) ========================
/**
 * Local browser notifications (Notification API) for NEW items only: the
 * first snapshot is treated as "already seen" so a login never fires a burst.
 * These are in-browser notifications — no push server — so they fire while the
 * app is open (even in a background tab); real Web Push needs a backend + VAPID.
 */
function useBrowserNotifications(items, makeNotification, enabled = true) {
  const seen = useRef(null);
  useEffect(() => {
    if (!enabled || typeof Notification === "undefined") return;
    if (seen.current === null) { seen.current = new Set(items.map((i) => i.key)); return; }
    for (const item of items) {
      if (seen.current.has(item.key)) continue;
      seen.current.add(item.key);
      if (Notification.permission !== "granted") continue;
      const n = makeNotification(item);
      if (!n) continue;
      try { new Notification(n.title, { body: n.body, tag: item.key, lang: "ar", dir: "rtl" }); } catch { /* unsupported context */ }
    }
  }, [items, makeNotification, enabled]);
}

const NotificationPermissionButton = ({ compact = false }) => {
  const [perm, setPerm] = useState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  if (perm === "unsupported") return null;
  if (perm === "granted") return <span style={{ fontSize: 11, color: C.accent }}>🔔 الإشعارات مفعّلة</span>;
  return (
    <button onClick={() => Notification.requestPermission().then(setPerm)} style={{ padding: compact ? "4px 10px" : "6px 12px", borderRadius: 8, border: `1px solid ${C.info}`, background: C.info + "15", color: C.info, fontSize: 11, cursor: "pointer", fontFamily: ARABIC_FONT, fontWeight: 700 }}>
      🔔 {perm === "denied" ? "الإشعارات محظورة من المتصفح" : "تفعيل إشعارات المتصفح"}
    </button>
  );
};

// ======================== "NEEDS COLLECTION NOW" BANNER (shared: dashboard + driver portal) ========================
/**
 * One ranked answer to "which neighborhoods need a collection run right now?"
 * (decisionEngine.rankNeighborhoodsForCollection) rendered the same way for
 * the supervisor's dashboard and the driver's portal, so both roles look at
 * the same list. Each row links straight to its neighborhood on the map and
 * to the open route that covers it — or says plainly that none exists yet.
 */
const NeedsCollectionBanner = ({ ranked = [], onShowOnMap, onOpenRoute, onGoToRoutes, onSelect, compact = false, noRouteLabel = "لا توجد جولة مقترحة بعد" }) => {
  if (ranked.length === 0) {
    return (
      <div style={{ background: C.accent + "12", border: `1px solid ${C.accent}40`, borderRadius: 14, padding: "12px 16px", fontSize: 13, color: C.accent, fontWeight: 600 }}>
        ✅ لا توجد أحياء تحتاج جمعًا الآن — جميع الحاويات ضمن المعدل الطبيعي.
      </div>
    );
  }
  const withoutRoute = ranked.filter((r) => !r.openRoute).length;
  return (
    <div style={{ background: C.danger + "10", border: `1px solid ${C.danger}50`, borderRadius: 14, padding: compact ? 12 : 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: compact ? 14 : 15, fontWeight: 800, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
          <BellRing size={16} color={C.danger} /> {ranked.length} {ranked.length === 1 ? "حي يحتاج" : "أحياء تحتاج"} جمعًا الآن
        </div>
        {withoutRoute > 0 && onGoToRoutes && (
          <button onClick={onGoToRoutes} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.warning}`, background: C.warning + "15", color: C.warning, fontWeight: 700, fontSize: 11.5, cursor: "pointer", fontFamily: ARABIC_FONT }}>
            {withoutRoute} بلا جولة مقترحة — ولّد الجولات
          </button>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(auto-fill, minmax(250px, 1fr))", gap: 8 }}>
        {ranked.map((r) => (
          <div key={r.group.key} onClick={onSelect ? () => onSelect(r) : undefined} style={{ background: C.card, border: `1px solid ${STATUS_COLORS[r.priority.tier] || C.border}50`, borderRadius: 12, padding: "10px 12px", cursor: onSelect ? "pointer" : "default" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{r.group.name}</div>
              <StateBadge state={r.priority.tier} />
            </div>
            <div style={{ fontSize: 11.5, color: C.muted }}>
              {r.criticalCount > 0 && <span style={{ color: C.danger, fontWeight: 700 }}>{r.criticalCount} حرجة · </span>}
              {r.highCount > 0 && <span style={{ color: STATUS_COLORS.high, fontWeight: 700 }}>{r.highCount} مرتفعة · </span>}
              {r.eligibleBins.length} مؤهلة للجمع من أصل {r.total}
              {r.thermalAlert && <span style={{ color: C.danger }}> · 🔥 تنبيه حراري</span>}
            </div>
            {r.distanceKm != null && (
              <div style={{ fontSize: 11, color: C.info, marginTop: 2 }}>📍 يبعد {r.distanceKm} كم · ~{r.etaMinutes} دقيقة</div>
            )}
            <div style={{ fontSize: 11, color: r.openRoute ? C.info : C.warning, marginTop: 4 }}>
              {r.openRoute ? `🧭 ${r.openRoute.routeName} — ${ROUTE_STATUS_LABELS[r.openRoute.status] || r.openRoute.status}` : noRouteLabel}
            </div>
            {(onShowOnMap || (r.openRoute && onOpenRoute)) && (
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {onShowOnMap && (
                  <button onClick={(e) => { e.stopPropagation(); onShowOnMap(r.group.key); }} style={{ padding: "5px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 11, cursor: "pointer", fontFamily: ARABIC_FONT }}>عرض على الخريطة</button>
                )}
                {r.openRoute && onOpenRoute && (
                  <button onClick={(e) => { e.stopPropagation(); onOpenRoute(r.openRoute.id); }} style={{ padding: "5px 10px", borderRadius: 8, border: "none", background: C.info, color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: ARABIC_FONT }}>فتح الجولة</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// makeThermalAlertFor / makeBinContext live in ./binContext (shared with the server-side dispatch runner).

/** Centroid of a neighborhood group's real polygon (null when the name has no polygon). */
const centroidForGroup = (group) => {
  const feature = buraidahNeighborhoodsGeo.features.find((f) => f.properties.baseName === group.key);
  return feature ? polygonCentroid(feature.geometry) : (group.primary?.centerLat != null ? { lat: group.primary.centerLat, lng: group.primary.centerLng } : null);
};

// ======================== IMPACT CARD (shared: dashboard, reports, executive) ========================
/** "What did data-driven collection save TODAY vs a fixed daily schedule?" — every figure traces to computeImpactMetrics() and its stated assumptions. */
const ImpactCard = ({ impact, compact = false, accent = C.accent }) => {
  const tiles = [
    { label: "زيارات غير ضرورية تم تجنبها اليوم", value: impact.stopsAvoided, unit: "حاوية", color: accent },
    { label: "أحياء لا تحتاج أي جولة اليوم", value: impact.neighborhoodsSkipped, unit: "حي", color: C.info },
    { label: "كيلومترات موفّرة", value: impact.kmSaved, unit: "كم", color: C.info, sub: `${impact.dataDrivenKm} بدل ${impact.baselineKm} كم (−${impact.reductionPct}%)` },
    { label: "وقود موفّر", value: impact.fuelSavedL, unit: "لتر", color: C.warning },
    { label: "انبعاثات CO₂ موفّرة", value: impact.co2SavedKg, unit: "كجم", color: accent },
    { label: "وقت تشغيل موفّر", value: impact.minutesSaved, unit: "دقيقة", color: C.purple },
    { label: "فيضانات مُنعت (حاويات حرجة مغطاة بجولة)", value: impact.overflowsPrevented, unit: "حاوية", color: C.danger },
  ];
  return (
    <Card title="💡 ماذا وفّرنا اليوم؟ — الجمع بالبيانات مقابل الجدول الثابت" icon={<Leaf size={16} color={C.muted} />}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${compact ? 150 : 180}px, 1fr))`, gap: 10 }}>
        {tiles.map((t) => (
          <div key={t.label} style={{ background: C.bg, border: `1px solid ${t.color}30`, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: compact ? 22 : 26, fontWeight: 800, color: t.color }}>{t.value} <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{t.unit}</span></div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{t.label}</div>
            {t.sub && <div style={{ fontSize: 10.5, color: C.dim, marginTop: 2 }}>{t.sub}</div>}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10.5, color: C.dim, marginTop: 10, lineHeight: 1.7 }}>
        الأساس المقارن: جدول ثابت يزور كل حاوية مرة يوميًا (مسار لكل حي يمر بكل حاوياته من المستودع). المنهج بالبيانات: فقط الحاويات المؤهلة الآن.
        الافتراضات: {impact.assumptions.truckFuelLitersPerKm} لتر/كم، {impact.assumptions.co2KgPerLiterDiesel} كجم CO₂/لتر ديزل، {impact.assumptions.minutesPerStop} دقائق لكل حاوية، {impact.assumptions.avgUrbanSpeedKmh} كم/س. المسافات جوية (Haversine) وليست مسافات طرق.
      </div>
    </Card>
  );
};

/** Compact dispatch status for the operations dashboard: summary first, details one click away. */
const DispatchSummary = ({ settings, decisions = [], routes = [], onOpen, onOpenRoute }) => {
  const { runs } = useDispatchRuns(true, 5);
  const s = { ...DEFAULT_DISPATCH_SETTINGS, ...(settings || {}) };
  const lastRun = runs[0];
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const autoToday = routes.filter((r) => r.dispatch?.auto && String(r.dispatch.at || r.createdAt || "") >= dayStart.toISOString());
  const by = (st) => autoToday.filter((r) => r.status === st).length;
  const pending = decisions.filter((d) => d.type === "escalate" && d.status === "open");
  const recent = decisions.filter((d) => d.status === "executed").slice(0, 3);
  return (
    <Section title="الإسناد التلقائي" actions={<><DispatchModeBadge settings={settings} />{onOpen && <Btn variant="ghost" onClick={onOpen}>التفاصيل</Btn>}</>}>
      <KpiRow>
        <KpiTile label="آخر تشغيل ناجح" value={lastRun ? getReadingAgeLabel(lastRun.finishedAt || lastRun.startedAt) : "—"} tone={lastRun ? "neutral" : "warning"} hint={`دوري كل ${s.periodMinutes} د · الحرجة فورًا`} />
        <KpiTile label="جولات أُسندت تلقائيًا اليوم" value={autoToday.length} tone="ok" hint={autoToday.length ? `معتمدة ${by("approved")} · جارية ${by("in_progress")} · مكتملة ${by("completed")}` : null} />
        <KpiTile label="تنتظر معالجة استثنائية" value={pending.length} tone={pending.length ? "danger" : "ok"} onClick={onOpen} />
      </KpiRow>
      {s.mode !== "auto" && <div style={{ fontSize: FS.meta, color: C.info, marginTop: SP.sm }}>{s.mode === "observe" ? "وضع المراقبة: يحسب المحرك القرارات ويسجلها دون تنفيذ." : "الإسناد التلقائي متوقف — الإسناد يدوي."}</div>}
      {recent.length > 0 && (
        <Disclosure summary="أسباب آخر الإسنادات">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {recent.map((d) => <div key={d.id} style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}><b style={{ color: C.text }}>{d.routeName}</b> ← {d.driverName} · {getReadingAgeLabel(d.executedAt)}{onOpenRoute && d.routeId ? <> · <button onClick={() => onOpenRoute(d.routeId)} style={{ background: "none", border: "none", color: C.info, cursor: "pointer", fontFamily: ARABIC_FONT, fontSize: 12, padding: 0 }}>فتح</button></> : null}<div>{d.reason}</div></div>)}
          </div>
        </Disclosure>
      )}
    </Section>
  );
};

// ======================== DASHBOARD (operations: attention → few KPIs → map → details on demand) ========================
const DashboardPage = ({ alerts = [], neighborhoods = [], bins = [], fireSensors = [], recentReadings = [], routes = [], citizenReports = [], profiles = [], incidents = [], loggedInUser, loadingBins, loadingNeighborhoods, onViewBins, onOpenRoute, onShowOnMap, onNavigate }) => {
  const scope = scopeFor(loggedInUser);
  const { decisions } = useDispatchDecisions(true, scope.all ? null : scope.municipalityId);
  const { settings: dispatchSettings } = useDispatchSettings(true);
  const dispatchAuto = dispatchSettings?.mode === "auto";
  const go = (page, extra) => onNavigate && onNavigate(page, extra);

  const readingsByBin = useMemo(() => { const map = {}; for (const r of recentReadings) { if (r.bin_id) (map[r.bin_id] ||= []).push(r); } return map; }, [recentReadings]);
  const ctx = useMemo(() => makeBinContext(fireSensors, citizenReports, neighborhoods), [fireSensors, citizenReports, neighborhoods]);
  const scoredBins = useMemo(() => bins.map((bin) => ({ bin, neighborhood: neighborhoods.find((n) => n.id === bin.neighborhoodId), priority: getBinPriority(bin, null, readingsByBin[bin.id] || [], ctx.forBin(bin)) })), [bins, neighborhoods, readingsByBin, ctx]);
  const totalBins = bins.length;
  const criticalBins = scoredBins.filter((x) => x.priority.tier === "critical");
  const offlineBins = bins.filter((b) => { const c = getSensorConnectivity(b); return c === "offline" || c === "fault"; });
  const rankedNeighborhoods = useMemo(() => rankNeighborhoodsForCollection(groupNeighborhoodsByName(neighborhoods, bins), scoredBins, routes, { thermalAlertFor: makeThermalAlertFor(fireSensors), centroidFor: centroidForGroup }), [neighborhoods, bins, scoredBins, routes, fireSensors]);
  const withoutRoute = rankedNeighborhoods.filter((r) => !r.openRoute);
  const suggested = routes.filter((r) => r.status === "suggested");
  const approved = routes.filter((r) => r.status === "approved");
  const running = routes.filter((r) => r.status === "in_progress");
  const busyDrivers = new Set([...approved, ...running].map((r) => r.driverId).filter(Boolean));
  const freeDrivers = profiles.filter((p) => p.shiftStatus === "on_shift" && p.availability !== "unavailable" && !busyDrivers.has(p.uid)).length;
  const openIncidents = incidents.filter((i) => i.status === "open");
  const openReports = citizenReports.filter((r) => r.status !== "تم الحل" && r.status !== "مرفوض" && r.status !== "مغلق");
  const thermal = rankedNeighborhoods.filter((r) => r.thermalAlert);
  const escalations = decisions.filter((d) => d.type === "escalate" && d.status === "open");
  const fillValues = bins.map((b) => b.lastFillLevelPercent).filter((v) => v != null && v <= 100);
  const avgFill = fillValues.length ? Math.round(fillValues.reduce((a, v) => a + v, 0) / fillValues.length) : null;
  const impact = useMemo(() => computeImpactMetrics(groupNeighborhoodsByName(neighborhoods, bins), scoredBins, routes, { depot: DEFAULT_DEPOT }), [neighborhoods, bins, scoredBins, routes]);
  const loading = loadingBins || loadingNeighborhoods;

  // ── What needs attention, ranked: dispatch exceptions → uncovered demand → safety → field → data quality → citizens.
  const attention = [];
  for (const d of escalations.slice(0, 6)) attention.push({ id: "esc_" + d.id, tone: ["thermal", "vehicle_down", "driver_unavailable"].includes(d.kind) ? "danger" : "warning", title: `${ESCALATION_LABELS[d.kind] || d.kind}${d.routeName ? ` — ${d.routeName}` : ""}`, meta: `رفعه الإسناد التلقائي · ${getReadingAgeLabel(d.createdAt)}`, detail: <>{d.reason}{d.suggestion && <div style={{ color: C.text }}><b>المقترح:</b> {d.suggestion}</div>}</>, actionLabel: "معالجة", onAction: () => go("control", { tab: "dispatch" }) });
  if (escalations.length > 6) attention.push({ id: "esc_more", tone: "warning", title: `${escalations.length - 6} حالة أخرى من الإسناد التلقائي`, actionLabel: "عرضها", onAction: () => go("control", { tab: "dispatch" }) });
  for (const r of thermal) attention.push({ id: "th_" + r.group.key, tone: "danger", title: `تنبيه حراري — ${r.group.name}`, meta: "لا تُجمع الحاويات الساخنة بمكبس قبل تقييم الخطر", actionLabel: "التنبيهات الحرارية", onAction: () => go("fire") });
  for (const r of withoutRoute.slice(0, 4)) attention.push({ id: "nr_" + r.group.key, tone: r.priority.tier === "critical" ? "danger" : "warning", title: `${r.group.name}: ${r.eligibleBins.length} حاوية تحتاج جمعًا بلا جولة`, meta: r.priority.reasons?.[0] || "", detail: r.eligibleBins.slice(0, 8).map((s) => `${s.bin.name} (${s.bin.lastFillLevelPercent ?? "—"}%)`).join("، "),
    actions: onShowOnMap ? <Btn variant="ghost" onClick={() => onShowOnMap(r.group.key)}>على الخريطة</Btn> : null, actionLabel: dispatchAuto ? "الإسناد التلقائي" : "إنشاء جولة", onAction: () => go("control", { tab: dispatchAuto ? "dispatch" : "routes" }) });
  if (withoutRoute.length > 4) attention.push({ id: "nr_more", tone: "warning", title: `${withoutRoute.length - 4} حي آخر يحتاج جمعًا بلا جولة`, actionLabel: "الجولات", onAction: () => go("control") });
  if (!dispatchAuto && suggested.length) attention.push({ id: "sugg", tone: "info", title: `${suggested.length} جولة مقترحة بانتظار الاعتماد والإسناد`, actionLabel: "مراجعة", onAction: () => go("control", { tab: "routes" }) });
  if (openIncidents.length) attention.push({ id: "inc", tone: "danger", title: `${openIncidents.length} بلاغ ميداني مفتوح من السائقين`, detail: openIncidents.slice(0, 6).map((i) => `${(INCIDENT_TYPES[i.type] || {}).label || i.type} — ${i.routeName || ""}`).join(" · "), actionLabel: "متابعة الأسطول", onAction: () => go("drivers", { tab: "live" }) });
  if (offlineBins.length) attention.push({ id: "off", tone: "warning", title: `${offlineBins.length} مستشعر غير متصل أو بقراءة غير موثوقة`, meta: "لا تُسند حاوياتها تلقائيًا", actionLabel: "الحاويات", onAction: () => go("bins") });
  if (openReports.length) attention.push({ id: "rep", tone: "info", title: `${openReports.length} بلاغ مواطن مفتوح`, actionLabel: "البلاغات", onAction: () => go("requests") });
  const rank = { danger: 0, warning: 1, info: 2 };
  attention.sort((a, b) => rank[a.tone] - rank[b.tone]);

  if (loading) return <EmptyState icon="⏳" title="جاري تحميل الوضع التشغيلي…" />;
  if (totalBins === 0) return <EmptyState icon="🗺️" title="لا توجد حاويات بعد" desc="هيّئ الأحياء والحاويات من الإعدادات." />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SP.lg }}>
      <PageHeader
        status={<><b style={{ color: C.text }}>{scope.all ? "المدينة" : municipalityById(scope.municipalityId)?.shortAr || ""}</b> · {criticalBins.length} حاوية حرجة · {running.length} جولة جارية · {approved.length} معتمدة · {freeDrivers} سائق متاح · <DispatchModeBadge settings={dispatchSettings} /></>}
        attention={attention.length ? `${attention.length} أمر يحتاج انتباهك` : "لا شيء عاجل"} attentionTone={attention.some((a) => a.tone === "danger") ? "danger" : attention.length ? "warning" : "ok"}
        actions={<><Btn variant="primary" onClick={() => go("control")}>الجولات والإسناد</Btn><Btn onClick={() => go("map")}>الخريطة</Btn></>} />

      <Section title="يحتاج انتباهك الآن" count={attention.length}>
        <AttentionList items={attention} max={6} />
      </Section>

      <KpiRow>
        <KpiTile label="حاويات حرجة الآن" value={criticalBins.length} tone={criticalBins.length ? "danger" : "ok"} onClick={() => go("bins")} />
        <KpiTile label="أحياء تحتاج جمعًا بلا جولة" value={withoutRoute.length} tone={withoutRoute.length ? "warning" : "ok"} onClick={() => go("control")} />
        <KpiTile label="جولات جارية / معتمدة" value={`${running.length} / ${approved.length}`} tone="info" onClick={() => go("control", { tab: "routes" })} />
        <KpiTile label="سائقون متاحون الآن" value={freeDrivers} tone={freeDrivers ? "ok" : "warning"} onClick={() => go("drivers", { tab: "live" })} />
        <KpiTile label="مستشعرات غير متصلة" value={offlineBins.length} tone={offlineBins.length ? "warning" : "ok"} hint={avgFill != null ? `متوسط الامتلاء ${avgFill}%` : null} />
      </KpiRow>

      <DispatchSummary settings={dispatchSettings} decisions={decisions} routes={routes} onOpen={() => go("control", { tab: "dispatch" })} onOpenRoute={onOpenRoute} />

      <Section title="الخريطة التشغيلية" actions={<Btn variant="ghost" onClick={() => go("map")}>فتح بالحجم الكامل</Btn>}>
        <OperationalMap neighborhoods={neighborhoods} bins={bins} fireSensors={fireSensors} recentReadings={recentReadings} routes={routes} citizenReports={citizenReports} profiles={profiles} height={360} compact onViewBins={onViewBins} onOpenRoute={onOpenRoute} />
      </Section>

      <Section title="أولويات الأحياء" count={rankedNeighborhoods.length} collapsible defaultOpen={rankedNeighborhoods.length > 0} hint="مرتبة حسب الأولوية المحسوبة من الامتلاء والتنبؤ والحرارة والبلاغات">
        {rankedNeighborhoods.length === 0 ? <div style={{ fontSize: FS.body, color: C.accent }}>✓ لا أحياء تحتاج جمعًا الآن</div> : (
          <AttentionList max={5} items={rankedNeighborhoods.map((r) => ({ id: "rk_" + r.group.key, tone: r.priority.tier === "critical" ? "danger" : r.priority.tier === "high" ? "warning" : "info",
            title: `${r.group.name} — ${r.eligibleBins.length} حاوية مؤهلة`, meta: r.openRoute ? `${ROUTE_STATUS_LABELS[r.openRoute.status] || r.openRoute.status}: ${r.openRoute.routeName}${r.openRoute.driverName ? ` ← ${r.openRoute.driverName}` : ""}` : "بلا جولة",
            badge: <StateBadge state={r.priority.tier} />, detail: (r.priority.reasons || []).join(" · "),
            actions: <>{onShowOnMap && <Btn variant="ghost" onClick={() => onShowOnMap(r.group.key)}>الخريطة</Btn>}{r.openRoute && onOpenRoute && <Btn onClick={() => onOpenRoute(r.openRoute.id)}>الجولة</Btn>}</> }))} />
        )}
      </Section>

      <Section title="المؤشرات والتحليلات" collapsible defaultOpen={false} hint="محسوبة من حالة الحاويات والجولات الحالية">
        <div style={{ display: "flex", flexDirection: "column", gap: SP.md }}>
          <ImpactCard impact={impact} compact />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: SP.md }}>
            <Card title="توزيع مستويات الامتلاء">
              <ChartBox height={220}><ResponsiveContainer>
                <PieChart>
                  <Pie data={[["0-30%", (v) => v <= 30, C.accent], ["31-60%", (v) => v > 30 && v <= 60, C.info], ["61-85%", (v) => v > 60 && v <= 85, C.warning], ["86-100%", (v) => v > 85 && v <= 100, C.danger]].map(([name, f, fill]) => ({ name, value: fillValues.filter(f).length, fill }))} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3} label={({ name, value }) => `${name}: ${value}`}>
                    {[C.accent, C.info, C.warning, C.danger].map((c, i) => <Cell key={i} fill={c} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer></ChartBox>
            </Card>
            <Card title="أعلى الأحياء امتلاءً (متوسط)">
              <ChartBox height={220}><ResponsiveContainer>
                <BarChart data={neighborhoods.map((n) => { const v = bins.filter((b) => b.neighborhoodId === n.id).map((b) => b.lastFillLevelPercent).filter((x) => x != null && x <= 100); return { name: normalizeNeighborhoodName(n.name), متوسط_الامتلاء: v.length ? Math.round(v.reduce((a, x) => a + x, 0) / v.length) : 0 }; }).sort((a, b) => b.متوسط_الامتلاء - a.متوسط_الامتلاء).slice(0, 8)} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: C.muted, fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="متوسط_الامتلاء" fill={C.brandSoft} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer></ChartBox>
            </Card>
          </div>
          <div style={{ fontSize: FS.meta, color: C.dim }}>رسوم الاتجاه الأسبوعي والشهري في «التقارير» (بيانات مرجعية من التهيئة، لا تُشتق من التشغيل).</div>
        </div>
      </Section>

      {alerts.length > 0 && (
        <Section title="سجل التنبيهات" count={alerts.length} collapsible defaultOpen={false}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {alerts.map((a) => <div key={a.id} style={{ fontSize: 12, color: C.muted, borderBottom: `1px solid ${C.border}`, padding: "6px 2px" }}><b style={{ color: C.text }}>{a.icon} {a.type}</b> · {a.time} — {a.message}</div>)}
          </div>
        </Section>
      )}
    </div>
  );
};

// ======================== NEIGHBORHOODS (replaces old STATIONS page) ========================
const NEIGHBORHOOD_FILTERS = [
  { key: "all",      label: "الكل" },
  { key: "low",      label: "طبيعي" },
  { key: "medium",   label: "يحتاج متابعة" },
  { key: "high",     label: "أولوية مرتفعة" },
  { key: "critical", label: "حرج" },
  { key: "offline",  label: "بلا بيانات / غير متصلة" },
];

const NeighborhoodsPage = ({ neighborhoods = [], bins = [], fireSensors = [], routes = [], citizenReports = [], loading, onViewBins, onOpenRoute, onShowOnMap }) => {
  const binCtx = useMemo(() => makeBinContext(fireSensors, citizenReports, neighborhoods), [fireSensors, citizenReports, neighborhoods]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const isThermalAlert = (name) =>
    fireSensors.some((s) =>
      normalizeNeighborhoodName(s.district) === normalizeNeighborhoodName(name) &&
      (s.riskLevel === "خطر عالي" || s.riskLevel === "خطر متوسط")
    );

  // One row per real neighborhood (duplicate docs with the same name are merged, bins summed).
  const rows = useMemo(() => groupNeighborhoodsByName(neighborhoods, bins).map((g) => {
    const n = g.primary;
    const idSet = new Set(g.ids);
    const nBins = bins.filter((b) => idSet.has(b.neighborhoodId));
    const thermalAlert = isThermalAlert(g.name);
    const scoredBins = nBins.map((bin) => ({ bin, priority: getBinPriority(bin, null, [], binCtx.forBin(bin)) }));
    const citizenReportCount = binCtx.forNeighborhoodName(g.name).citizenReportCount + nBins.reduce((a, b) => a + binCtx.reportCountForBin(b.id), 0);
    const result = getNeighborhoodPriority(scoredBins, { thermalAlert, citizenReportCount });
    const connected = nBins.filter((b) => getSensorConnectivity(b) === "online").length;
    const lastReadingAt = nBins.reduce((latest, b) => {
      if (!b.lastReadingAt) return latest;
      return !latest || new Date(b.lastReadingAt) > new Date(latest) ? b.lastReadingAt : latest;
    }, null);
    const openRoute = routes.find((r) => ["suggested", "approved", "in_progress"].includes(r.status) && (r.neighborhoodIds || []).some((id) => idSet.has(id))) || null;
    return { ...n, key: g.key, name: g.name, ...result, status: neighborhoodDisplayTier(result), connected, disconnected: nBins.length - connected, lastReadingAt, thermalAlert, openRoute, demo: nBins.length > 0 && nBins.every((b) => b.demo) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [neighborhoods, bins, fireSensors, routes, binCtx]);

  const filtered = rows.filter((n) => {
    if (search && !n.name.includes(search)) return false;
    if (filter === "all") return true;
    return n.status === filter;
  });

  if (loading) return <EmptyState icon="⏳" title="جاري تحميل الأحياء…" />;
  if (neighborhoods.length === 0) {
    return <EmptyState icon="🏘️" title="لا توجد أحياء مسجلة بعد" desc="تُهيّأ الأحياء والحاويات من «الإعدادات ← البلديات والبيانات والتكامل»." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <Search size={15} color={C.dim} style={{ position: "absolute", insetInlineStart: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث عن حي…"
            style={{ width: "100%", padding: "9px 36px 9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 13, fontFamily: ARABIC_FONT }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {NEIGHBORHOOD_FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: ARABIC_FONT,
              border: `1px solid ${filter === f.key ? C.accent : C.border}`,
              background: filter === f.key ? C.accent + "20" : "transparent",
              color: filter === f.key ? C.accent : C.muted,
            }}>{f.label}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? <EmptyState icon="🔎" title="لا توجد نتائج مطابقة" /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {filtered.map((n) => (
            <div key={n.key} style={{ background: C.card, border: `1px solid ${STATUS_COLORS[n.status]}40`, borderRadius: 16, padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 6 }}>{n.name} {n.demo && <DemoBadge />}</div>
                <StateBadge state={n.status} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, color: C.muted, marginBottom: 10 }}>
                <div>عدد الحاويات: <b style={{ color: C.text }}>{n.total}</b></div>
                <div>متوسط الامتلاء: <b style={{ color: C.text }}>{n.avgFill != null ? `${n.avgFill}%` : "—"}</b></div>
                <div>متصلة: <b style={{ color: C.accent }}>{n.connected}</b></div>
                <div>غير متصلة: <b style={{ color: C.dim }}>{n.disconnected}</b></div>
                <div>حرجة: <b style={{ color: C.danger }}>{n.criticalCount}</b></div>
                <div>تنبيه حراري: <b style={{ color: n.thermalAlert ? C.danger : C.accent }}>{n.thermalAlert ? "نعم" : "لا"}</b></div>
                <div style={{ gridColumn: "1 / -1" }}>بلاغات مواطنين مفتوحة: <b style={{ color: n.citizenReportCount > 0 ? C.warning : C.text }}>{n.citizenReportCount || 0}</b></div>
              </div>
              <div style={{ fontSize: 11, color: C.dim, marginBottom: 10 }}>آخر قراءة: {getReadingAgeLabel(n.lastReadingAt)}</div>
              {n.reasons?.length > 0 && (
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>{n.reasons[0]}</div>
              )}
              <div style={{ fontSize: 11, marginBottom: 10, padding: "6px 8px", borderRadius: 8, background: n.openRoute ? C.info + "12" : C.bg, color: n.openRoute ? C.info : ((n.criticalCount > 0 || n.highCount > 0) ? C.warning : C.dim), border: `1px solid ${n.openRoute ? C.info + "30" : C.border}` }}>
                {n.openRoute ? `🧭 ${n.openRoute.routeName} — ${ROUTE_STATUS_LABELS[n.openRoute.status] || n.openRoute.status} · ${n.openRoute.binIds?.length || 0} حاوية` : ((n.criticalCount > 0 || n.highCount > 0) ? "⚠️ يحتاج جمعًا — لا توجد جولة مقترحة بعد" : "لا توجد جولة مفتوحة")}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => onViewBins && onViewBins(n.id)} style={{
                  flex: 1, padding: "9px", borderRadius: 10, border: "none", background: C.emph || C.border,
                  color: C.text, fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT,
                }}>عرض الحاويات</button>
                {onShowOnMap && (
                  <button onClick={() => onShowOnMap(n.key)} style={{ padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>🗺️</button>
                )}
                {n.openRoute && onOpenRoute && (
                  <button onClick={() => onOpenRoute(n.openRoute.id)} style={{ padding: "9px 12px", borderRadius: 10, border: "none", background: C.info, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>الجولة</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ======================== SMART BINS (new page) ========================
const BIN_FILTERS = [
  { key: "all",      label: "الكل" },
  { key: "low",      label: "طبيعي" },
  { key: "medium",   label: "يحتاج متابعة" },
  { key: "high",     label: "مرتفع" },
  { key: "critical", label: "حرج" },
  { key: "offline",  label: "غير متصلة" },
  { key: "fault",    label: "خلل بالمستشعر" },
];

/**
 * Bin detail modal — the only place that fetches this ONE bin's bounded
 * reading history (useBinReadings), so the real priority score/reasons and
 * the §6/§7 predicted-full-time + future-state table are only ever computed
 * for a single open bin, never for the whole list (§39 performance).
 */
const BinDetailModal = ({ bin, neighborhood, onClose, onAddToRoute, openRoute = null, onOpenRoute }) => {
  const { readings, loading: loadingReadings } = useBinReadings(bin.id);
  const priority = useMemo(() => getBinPriority(bin, null, readings), [bin, readings]);
  const future = useMemo(
    () => [1, 3, 6].map((h) => ({ h, ...predictFutureState(bin, readings, h) })),
    [bin, readings]
  );
  const isStale = priority.sensorHealth.connectivity === "offline" || priority.sensorHealth.connectivity === "fault";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, maxWidth: 460, width: "100%", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>{bin.name} {bin.demo && <DemoBadge />}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.dim, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <StateBadge state={priority.tier} />
          <div style={{ fontSize: 22, fontWeight: 800, color: STATUS_COLORS[priority.tier] || C.text }}>{priority.score}</div>
          <div style={{ fontSize: 11, color: C.dim }}>/ 100 — الأولوية</div>
        </div>

        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>لماذا هذه الأولوية؟</div>
          <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12, color: C.muted, lineHeight: 1.9 }}>
            {priority.reasons.map((r, i) => (<li key={i}>{r}</li>))}
          </ul>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, color: C.muted }}>
          <div>Bin ID: <span style={{ color: C.text, fontFamily: "monospace" }}>{bin.id}</span></div>
          <div>الحي: <b style={{ color: C.text }}>{neighborhood?.name || "—"}</b></div>
          <div>نسبة الامتلاء: <b style={{ color: C.text }}>{bin.lastFillLevelPercent != null ? `${bin.lastFillLevelPercent}%` : "—"}</b></div>
          <div>درجة الحرارة: <b style={{ color: C.text }}>{bin.lastTemperatureCelsius != null ? `${bin.lastTemperatureCelsius}°` : "—"}</b></div>
          <div>حالة المستشعر: <StateBadge state={priority.sensorHealth.connectivity} /> {priority.sensorHealth.status !== "healthy" && <span style={{ fontSize: 11, color: C.dim }}>({STATE_LABELS[priority.sensorHealth.status] || priority.sensorHealth.status})</span>}</div>
          <div>Device ID: <span style={{ color: C.text }}>{bin.deviceId || "—"}</span></div>
          <div>البطارية: <span style={{ color: C.text }}>{bin.lastBatteryLevel != null ? `${bin.lastBatteryLevel}%` : "غير متوفرة"}</span></div>
          <div>الموقع: <span style={{ color: C.text }}>{bin.lat != null ? `${bin.lat.toFixed(4)}, ${bin.lng.toFixed(4)}` : "غير مُحدَّد بعد"}</span></div>
          <div>آخر قراءة: <span style={{ color: C.text }}>{getReadingAgeLabel(bin.lastReadingAt)}</span>{isStale && <span style={{ color: C.warning }}> — قراءة قديمة، لا تُعرض كقيمة حيّة</span>}</div>
        </div>

        <div style={{ marginTop: 14, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>توقع وقت الامتلاء</div>
          {loadingReadings ? (
            <div style={{ fontSize: 12, color: C.dim }}>جاري تحميل سجل القراءات…</div>
          ) : priority.prediction.predictionAvailable ? (
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.9 }}>
              خلال <b style={{ color: C.text }}>{priority.prediction.hoursToFull.toFixed(1)} ساعة</b> تقريبًا
              {" "}(ثقة التنبؤ: {CONFIDENCE_LABELS[priority.prediction.confidence] || priority.prediction.confidence})
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.dim }}>لا توجد بيانات كافية للتنبؤ{priority.prediction.reason ? ` — ${priority.prediction.reason}` : ""}</div>
          )}

          <div style={{ fontSize: 11, color: C.dim, marginTop: 10, marginBottom: 4 }}>الحالة المتوقعة مستقبلًا</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {future.map((f) => (
              <div key={f.h} style={{ flex: "1 1 80px", textAlign: "center", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 4px" }}>
                <div style={{ fontSize: 10, color: C.dim }}>بعد {f.h} {f.h === 1 ? "ساعة" : "ساعات"}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: f.predictionAvailable ? C.text : C.dim }}>
                  {f.predictionAvailable ? `${f.predictedFillLevel}%` : "—"}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: openRoute ? C.info + "12" : C.bg, border: `1px solid ${openRoute ? C.info + "40" : C.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: openRoute ? C.info : C.text, marginBottom: 4 }}>🧭 الجولة المرتبطة</div>
          {openRoute ? (
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.8 }}>
              {openRoute.routeName} — {ROUTE_STATUS_LABELS[openRoute.status] || openRoute.status}
              {(() => { const st = (openRoute.orderedStops || []).find((x) => x.binId === bin.id); return st ? ` · التوقف #${st.order} من ${openRoute.orderedStops.length}` : ""; })()}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: (priority.tier === "critical" || priority.tier === "high") ? C.warning : C.dim }}>
              {(priority.tier === "critical" || priority.tier === "high") ? "مؤهلة للجمع لكنها خارج أي جولة مفتوحة حاليًا." : "خارج أي جولة مفتوحة — الوضع ضمن المعدل الطبيعي."}
            </div>
          )}
        </div>

        {openRoute && onOpenRoute ? (
          <button
            onClick={() => onOpenRoute(openRoute.id)}
            style={{ marginTop: 12, width: "100%", padding: "10px", borderRadius: 10, border: "none", background: C.info, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: ARABIC_FONT }}
          >
            فتح الجولة
          </button>
        ) : (
          <button
            onClick={() => onAddToRoute && onAddToRoute(bin)}
            style={{ marginTop: 12, width: "100%", padding: "10px", borderRadius: 10, border: "none", background: C.accent, color: "#07231A", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: ARABIC_FONT }}
          >
            إضافة للجولة
          </button>
        )}
      </div>
    </div>
  );
};

const BinsPage = ({ neighborhoods = [], bins = [], routes = [], fireSensors = [], citizenReports = [], loading, initialNeighborhoodId, onAddToRoute, onOpenRoute }) => {
  const binCtx = useMemo(() => makeBinContext(fireSensors, citizenReports, neighborhoods), [fireSensors, citizenReports, neighborhoods]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [neighborhoodFilter, setNeighborhoodFilter] = useState(initialNeighborhoodId || "all");
  const [selectedBin, setSelectedBin] = useState(null);

  // Re-sync the filter when navigated here with a different neighborhood
  // (e.g. from the map's "عرض الحاويات" button) — adjusted during render per
  // React's guidance, instead of a useEffect, to avoid an extra render pass.
  const [prevInitialNeighborhoodId, setPrevInitialNeighborhoodId] = useState(initialNeighborhoodId);
  if (initialNeighborhoodId !== prevInitialNeighborhoodId) {
    setPrevInitialNeighborhoodId(initialNeighborhoodId);
    setNeighborhoodFilter(initialNeighborhoodId || "all");
  }

  const neighborhoodById = useMemo(() => {
    const m = {};
    neighborhoods.forEach((n) => { m[n.id] = n; });
    return m;
  }, [neighborhoods]);

  // List view: cheap scoring with no per-bin reading fetch (no N+1 reads) —
  // real decisionEngine output, just without the prediction boost, which
  // only the single-bin detail modal above computes on demand.
  const rows = bins.map((b) => {
    const priority = getBinPriority(b, null, [], binCtx.forBin(b));
    const connectivity = priority.sensorHealth.connectivity;
    const displayState = connectivity !== "online" ? connectivity : priority.tier;
    const openRoute = findOpenRouteForBin(b.id, routes);
    return { ...b, connectivity, tier: priority.tier, displayState, priority, neighborhood: neighborhoodById[b.neighborhoodId], openRoute, reportCount: binCtx.reportCountForBin(b.id) };
  });

  const filtered = rows.filter((b) => {
    if (neighborhoodFilter !== "all" && b.neighborhoodId !== neighborhoodFilter) return false;
    if (search && !b.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "all") return true;
    return b.displayState === filter;
  });

  if (loading) return <EmptyState icon="⏳" title="جاري تحميل الحاويات…" />;
  if (bins.length === 0) {
    return <EmptyState icon="📦" title="لا توجد حاويات مسجلة بعد" desc="تُهيّأ الأحياء والحاويات من «الإعدادات ← البلديات والبيانات والتكامل»." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 200px" }}>
          <Search size={15} color={C.dim} style={{ position: "absolute", insetInlineStart: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث باسم الحاوية…"
            style={{ width: "100%", padding: "9px 36px 9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 13, fontFamily: ARABIC_FONT }} />
        </div>
        <select value={neighborhoodFilter} onChange={(e) => setNeighborhoodFilter(e.target.value)} style={{
          padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 13, fontFamily: ARABIC_FONT,
        }}>
          <option value="all">كل الأحياء</option>
          {neighborhoods.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {BIN_FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: ARABIC_FONT,
              border: `1px solid ${filter === f.key ? C.accent : C.border}`,
              background: filter === f.key ? C.accent + "20" : "transparent",
              color: filter === f.key ? C.accent : C.muted,
            }}>{f.label}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? <EmptyState icon="🔎" title="لا توجد نتائج مطابقة" /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {filtered.map((b) => {
            const isStale = b.connectivity === "offline" || b.connectivity === "fault";
            return (
              <div key={b.id} onClick={() => setSelectedBin(b)} style={{
                background: C.card, border: `1px solid ${STATUS_COLORS[b.displayState] || C.border}40`, borderRadius: 14, padding: 16, cursor: "pointer",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 6 }}>{b.name} {b.demo && <DemoBadge />}</div>
                    <div style={{ fontSize: 10.5, color: C.dim }}>{b.neighborhood?.name || "—"}</div>
                  </div>
                  <StateBadge state={b.displayState} />
                </div>
                <div style={{ display: "flex", gap: 10, fontSize: 12, color: C.muted, marginBottom: 8 }}>
                  <span>الامتلاء: <b style={{ color: C.text }}>{b.lastFillLevelPercent != null ? `${b.lastFillLevelPercent}%` : "—"}</b></span>
                  <span>الحرارة: <b style={{ color: C.text }}>{b.lastTemperatureCelsius != null ? `${b.lastTemperatureCelsius}°` : "—"}</b></span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: isStale ? C.warning : C.muted, marginBottom: 4 }}>
                  {b.connectivity === "online" ? <Wifi size={12} /> : <WifiOff size={12} />}
                  {sensorStateLabel(b, b.connectivity)}
                  {isStale && <span>— {getReadingAgeLabel(b.lastReadingAt)} (قديمة)</span>}
                  {!isStale && <span>· {getReadingAgeLabel(b.lastReadingAt)}</span>}
                </div>
                <div style={{ fontSize: 11, color: C.dim }}>الأولوية: {STATE_LABELS[b.tier] || b.tier} ({b.priority.score}){b.reportCount > 0 && <span style={{ color: C.warning }}> · 📣 {b.reportCount} بلاغ مواطن</span>}</div>
                {b.openRoute ? (
                  <div style={{ marginTop: 8, fontSize: 11, color: C.info, background: C.info + "12", border: `1px solid ${C.info}30`, borderRadius: 8, padding: "4px 8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <span>🧭 {b.openRoute.routeName} — {ROUTE_STATUS_LABELS[b.openRoute.status] || b.openRoute.status}</span>
                    {onOpenRoute && <button onClick={(e) => { e.stopPropagation(); onOpenRoute(b.openRoute.id); }} style={{ background: "none", border: "none", color: C.info, fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: ARABIC_FONT }}>فتح</button>}
                  </div>
                ) : (b.tier === "critical" || b.tier === "high") && b.connectivity === "online" ? (
                  <div style={{ marginTop: 8, fontSize: 11, color: C.warning, background: C.warning + "12", border: `1px solid ${C.warning}30`, borderRadius: 8, padding: "4px 8px" }}>⚠️ مؤهلة للجمع — خارج أي جولة بعد</div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {selectedBin && (
        <BinDetailModal
          bin={selectedBin}
          neighborhood={neighborhoodById[selectedBin.neighborhoodId]}
          onClose={() => setSelectedBin(null)}
          onAddToRoute={onAddToRoute}
          openRoute={findOpenRouteForBin(selectedBin.id, routes)}
          onOpenRoute={onOpenRoute}
        />
      )}
    </div>
  );
};

// ======================== REPORTS ========================
const ASSUMED_SPEED_LABEL = "30 كم/س";
const PerfTable = ({ rows = [], firstCol }) => (
  <div style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: ARABIC_FONT }}>
      <thead><tr style={{ color: C.muted, textAlign: "right" }}>
        {[firstCol, "جولات", "كم", "جُمعت", "تخطي", "حوادث", "في الوقت", "فعلي/مخطط", "امتلاء عند الجمع", "اعتماد→بدء"].map((h) => <th key={h} style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{h}</th>)}
      </tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ color: C.text, opacity: r.routes ? 1 : 0.55 }}>
            <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{r.label}{r.status && <span style={{ color: C.dim, fontWeight: 400 }}> · {VEHICLE_STATUS_LABELS[r.status] || r.status}</span>}</td>
            <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{r.routes}</td>
            <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{r.km}</td>
            <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{r.collected}</td>
            <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, color: r.skipped ? C.warning : C.muted }}>{r.skipped}</td>
            <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, color: r.incidents ? C.danger : C.muted }}>{r.incidents}</td>
            <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, color: r.onTimePct == null ? C.dim : r.onTimePct >= 70 ? C.accent : C.warning, fontWeight: 700 }}>{r.onTimePct != null ? `${r.onTimePct}%` : "—"}</td>
            <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{r.avgActualVsPlannedPct != null ? `${r.avgActualVsPlannedPct}%` : "—"}</td>
            <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{r.avgFillAtCollection != null ? `${r.avgFillAtCollection}%` : "—"}</td>
            <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{r.avgApprovalToStartMin != null ? `${r.avgApprovalToStartMin} د` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const ReportsPage = ({ stations, monthlyTrend, weeklyData, bins = [], neighborhoods = [], routes = [], collectionEvents = [], vehicles = [], auditLog = [], fireSensors = [], citizenReports = [] }) => {
  const [tab, setTab] = useState("performance");
  const fleet = useMemo(() => computeFleetPerformance(routes, collectionEvents, auditLog, vehicles), [routes, collectionEvents, auditLog, vehicles]);
  const impact = useMemo(() => {
    const ctx = makeBinContext(fireSensors, citizenReports, neighborhoods);
    const scored = bins.map((bin) => ({ bin, priority: getBinPriority(bin, null, [], ctx.forBin(bin)) }));
    return computeImpactMetrics(groupNeighborhoodsByName(neighborhoods, bins), scored, routes, { depot: DEFAULT_DEPOT });
  }, [bins, neighborhoods, routes, fireSensors, citizenReports]);

  // ── Analytics من Firestore ────────────────────────────────────────
  const { data: kpisDoc } = useAnalyticsDoc("kpis");
  const { data: envDoc  } = useAnalyticsDoc("environment");

  const kpiItems = kpisDoc?.data || [
    { label: "متوسط وقت الاستجابة", value: "12 دقيقة", target: "15 دقيقة", ok: true },
    { label: "نسبة التشغيل",         value: "94.2%",    target: "90%",       ok: true },
    { label: "معدل الأعطال",         value: "2.1%",     target: "3%",        ok: true },
    { label: "رضا المستخدمين",       value: "87%",      target: "85%",       ok: true },
  ];

  const envColors  = [C.accent, C.info, C.warning, C.purple];
  const goalColors = [C.accent, C.info, C.purple, C.warning];

  const envMetrics = (envDoc?.metrics || [
    { label: "انبعاثات CO₂ الموفرة", value: "2.4 طن",   icon: <Globe size={36} />, desc: "مقارنة بالطرق التقليدية" },
    { label: "نسبة إعادة التدوير",   value: "68%",       icon: <Recycle size={36} />, desc: "من إجمالي النفايات"      },
    { label: "الطاقة الموفرة",       value: "1,200 kWh", icon: <Zap size={36} />, desc: "شهرياً"                  },
    { label: "تقليل الرحلات",        value: "45%",       icon: <Truck size={36} />, desc: "انخفاض في رحلات النقل"   },
  ]).map((m, i) => ({ ...m, color: envColors[i % envColors.length] }));

  const sustainGoals = (envDoc?.goals || [
    { goal: "تقليل النفايات المرسلة للمرادم 50%", progress: 72 },
    { goal: "رفع نسبة إعادة التدوير إلى 80%",     progress: 68 },
    { goal: "خفض انبعاثات الكربون 30%",            progress: 85 },
    { goal: "تحقيق صفر نفايات بحلول 2030",         progress: 42 },
  ]).map((g, i) => ({ ...g, color: goalColors[i % goalColors.length] }));

  const totalWaste = weeklyData.reduce((acc, d) => acc + d.عضوية + d.بلاستيك + d.ورق + d.زجاج + d.معادن, 0);
  const wasteByType = Object.entries(WASTE_COLORS).map(([type, color]) => ({
    name: type, value: weeklyData.reduce((a, d) => a + (d[type] || 0), 0), color,
  }));
  const stationFillData = stations.map(s => ({ name: s.district.replace("حي ", ""), الامتلاء: s.fillLevel })).sort((a, b) => b.الامتلاء - a.الامتلاء);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[{ key: "performance", label: "📊 تقرير الأداء" }, { key: "operations", label: "🧭 الجولات والتشغيل" }, { key: "fleet", label: "🚛 السائقون والمركبات" }, { key: "impact", label: "💡 الأثر والتوفير" }, { key: "waste", label: "♻️ تقرير النفايات · توضيحي" }, { key: "cost", label: "💰 تقرير التكاليف · توضيحي" }, { key: "environment", label: "🌱 التأثير البيئي · توضيحي" }].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "10px 20px", borderRadius: 10, border: `1px solid ${tab === t.key ? C.accent : C.border}`,
            background: tab === t.key ? C.accent + "15" : "transparent", color: tab === t.key ? C.accent : C.muted,
            cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: ARABIC_FONT,
          }}>{t.label}</button>
        ))}
      </div>

      {tab === "performance" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            {kpiItems.map((kpi, i) => (
              <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>{kpi.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: C.text, marginBottom: 4 }}>{kpi.value}</div>
                <div style={{ fontSize: 11, color: C.dim }}>الهدف: {kpi.target}</div>
                <div style={{ fontSize: 11, color: kpi.ok ? C.accent : C.danger, fontWeight: 600, marginTop: 4 }}>✓ أعلى من الهدف</div>
              </div>
            ))}
          </div>
          <Card title="مقارنة امتلاء الأحياء - بريدة" icon={<BarChart2 size={16} color={C.muted} />}>
            <ChartBox height={350}><ResponsiveContainer>
              <BarChart data={stationFillData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis type="number" tick={{ fill: C.muted, fontSize: 10 }} domain={[0, 100]} />
                <YAxis dataKey="name" type="category" width={70} tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="الامتلاء" radius={[0, 6, 6, 0]} name="الامتلاء %">
                  {stationFillData.map((entry, i) => (
                    <Cell key={i} fill={entry.الامتلاء > 85 ? C.danger : entry.الامتلاء > 60 ? C.warning : C.accent} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer></ChartBox>
          </Card>
        </div>
      )}

      {tab === "operations" && (() => {
        const suggestedCount = routes.filter((r) => r.status === "suggested").length;
        const approvedCount = routes.filter((r) => r.status === "approved").length;
        const activeCount = routes.filter((r) => r.status === "in_progress").length;
        const completedCount = routes.filter((r) => r.status === "completed").length;
        const avgRoutePriority = routes.length ? Math.round(routes.reduce((a, r) => a + (r.totalPriorityScore || 0) / Math.max(1, r.binIds?.length || 1), 0) / routes.length) : null;

        const criticalBinCount = bins.filter((b) => getBinTier(b) === "critical").length;
        const offlineBinCount = bins.filter((b) => { const c = getSensorConnectivity(b); return c === "offline" || c === "fault"; }).length;
        const onlinePct = bins.length ? Math.round(((bins.length - offlineBinCount) / bins.length) * 100) : null;

        const completedRoutes = routes.filter((r) => r.status === "completed" && r.approvedAt && r.completedAt);
        const avgResponseHours = completedRoutes.length
          ? (completedRoutes.reduce((a, r) => a + (new Date(r.completedAt) - new Date(r.approvedAt)) / 3600000, 0) / completedRoutes.length)
          : null;

        const avgFillAtCollection = collectionEvents.length
          ? Math.round(collectionEvents.reduce((a, e) => a + (e.fillBefore || 0), 0) / collectionEvents.length)
          : null;

        const demandByNeighborhood = neighborhoods.map((n) => ({
          name: normalizeNeighborhoodName(n.name),
          الجولات: routes.filter((r) => r.neighborhoodIds?.includes(n.id)).length,
        })).filter((d) => d.الجولات > 0).sort((a, b) => b.الجولات - a.الجولات).slice(0, 8);

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
              <StatCard title="جولات مقترحة" value={suggestedCount} icon={<RouteIcon size={20} color="#fff" />} gradient="linear-gradient(135deg, #3b82f6, #1d4ed8)" />
              <StatCard title="جولات معتمدة" value={approvedCount} icon={<CheckCircle size={20} color="#fff" />} gradient="linear-gradient(135deg, #f59e0b, #d97706)" />
              <StatCard title="جولات نشطة" value={activeCount} icon={<Truck size={20} color="#fff" />} gradient="linear-gradient(135deg, #8b5cf6, #6d28d9)" />
              <StatCard title="جولات مكتملة" value={completedCount} icon={<CheckCircle size={20} color="#fff" />} gradient="linear-gradient(135deg, #10b981, #059669)" />
              <StatCard title="حاويات حرجة الآن" value={criticalBinCount} icon={<AlertTriangle size={20} color="#fff" />} gradient="linear-gradient(135deg, #ef4444, #dc2626)" />
              <StatCard title="نسبة المستشعرات المتصلة" value={onlinePct ?? "—"} unit={onlinePct != null ? "%" : ""} icon={<Wifi size={20} color="#fff" />} gradient="linear-gradient(135deg, #06b6d4, #0891b2)" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
              <Card title="متوسط زمن الاستجابة (اعتماد → إنهاء)" icon={<Clock size={16} color={C.muted} />}>
                {avgResponseHours != null ? (
                  <div style={{ fontSize: 28, fontWeight: 800, color: C.text }}>{avgResponseHours.toFixed(1)} <span style={{ fontSize: 14, color: C.muted }}>ساعة</span></div>
                ) : <EmptyState icon="⏱️" title="لا توجد جولات مكتملة بعد لحساب المتوسط" />}
              </Card>
              <Card title="متوسط نسبة الامتلاء عند الجمع" icon={<Trash2 size={16} color={C.muted} />}>
                {avgFillAtCollection != null ? (
                  <div style={{ fontSize: 28, fontWeight: 800, color: C.text }}>{avgFillAtCollection}%</div>
                ) : <EmptyState icon="📦" title="لا توجد عمليات جمع مسجّلة بعد" />}
              </Card>
              <Card title="متوسط أولوية الجولات" icon={<Target size={16} color={C.muted} />}>
                {avgRoutePriority != null ? (
                  <div style={{ fontSize: 28, fontWeight: 800, color: C.text }}>{avgRoutePriority}<span style={{ fontSize: 14, color: C.muted }}> / 100</span></div>
                ) : <EmptyState icon="🧭" title="لا توجد جولات بعد" />}
              </Card>
            </div>

            <Card title="الأحياء الأعلى طلبًا للجمع" icon={<Home size={16} color={C.muted} />}>
              {demandByNeighborhood.length === 0 ? <EmptyState icon="🏘️" title="لا توجد بيانات جولات كافية بعد" /> : (
                <ChartBox height={260}><ResponsiveContainer>
                  <BarChart data={demandByNeighborhood} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis type="number" tick={{ fill: C.muted, fontSize: 10 }} allowDecimals={false} />
                    <YAxis dataKey="name" type="category" width={80} tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="الجولات" fill={C.info} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer></ChartBox>
              )}
            </Card>

            <Card title="المركبات" icon={<Truck size={16} color={C.muted} />}>
              {vehicles.length === 0 ? <EmptyState icon="🚛" title="لا توجد مركبات مسجّلة بعد" /> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {vehicles.map((v) => (
                    <div key={v.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: C.bg, borderRadius: 8, fontSize: 12 }}>
                      <span style={{ color: C.text }}>{v.vehicleNumber}</span>
                      <span style={{ color: C.muted }}>{VEHICLE_STATUS_LABELS[v.status] || v.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        );
      })()}

      {tab === "impact" && <ImpactCard impact={impact} />}

      {tab === "fleet" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            {[
              { label: "جولات مكتملة", value: fleet.totals.routes, color: C.accent },
              { label: "حاويات جُمعت", value: fleet.totals.collected, color: C.info },
              { label: "حاويات تُخطيت", value: fleet.totals.skipped, color: C.warning },
              { label: "التزام الوقت المخطط", value: fleet.totals.onTimePct != null ? `${fleet.totals.onTimePct}%` : "—", color: C.accent },
              { label: "الزمن الفعلي / المخطط", value: fleet.totals.avgActualVsPlannedPct != null ? `${fleet.totals.avgActualVsPlannedPct}%` : "—", color: C.purple },
              { label: "متوسط الامتلاء عند الجمع", value: fleet.totals.avgFillAtCollection != null ? `${fleet.totals.avgFillAtCollection}%` : "—", color: C.danger },
              { label: "من الاعتماد إلى البدء", value: fleet.totals.avgApprovalToStartMin != null ? `${fleet.totals.avgApprovalToStartMin} د` : "—", color: C.info },
              { label: "أعطال/عوائق مُبلَّغة", value: fleet.totals.incidents, color: C.warning },
            ].map((t) => (
              <div key={t.label} style={{ background: C.card, border: `1px solid ${t.color}30`, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: t.color }}>{t.value}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{t.label}</div>
              </div>
            ))}
          </div>

          {fleet.perRoute.length === 0 ? (
            <EmptyState icon="🚛" title="لا توجد جولات مكتملة بعد" desc="تُحسب هذه المؤشرات من الجولات التي بدأها السائق وأنهاها، وأحداث الجمع، وسجل التخطي/الأعطال." />
          ) : (
            <>
              <Card title="أداء المركبات" icon={<Truck size={16} color={C.muted} />}>
                <PerfTable rows={fleet.vehicles} firstCol="المركبة" />
              </Card>
              <Card title="أداء السائقين" icon={<Users size={16} color={C.muted} />}>
                <PerfTable rows={fleet.drivers} firstCol="السائق" />
              </Card>
              <Card title="آخر الجولات المكتملة" icon={<ClipboardList size={16} color={C.muted} />}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: ARABIC_FONT }}>
                    <thead><tr style={{ color: C.muted, textAlign: "right" }}>
                      {["الجولة", "السائق", "المخطط (د)", "الفعلي (د)", "جُمعت/المخطط", "تخطي", "امتلاء عند الجمع", "حوادث", "اكتملت"].map((h) => <th key={h} style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {fleet.perRoute.slice(0, 12).map((r) => (
                        <tr key={r.routeId} style={{ color: C.text }}>
                          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{r.routeName}</td>
                          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, color: C.muted }}>{r.driverName || "—"}</td>
                          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{r.plannedMin}</td>
                          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, color: r.onTime ? C.accent : C.warning, fontWeight: 700 }}>{r.actualMin}</td>
                          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{r.collected}/{r.planned} ({r.completionPct}%)</td>
                          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, color: r.skipped ? C.warning : C.muted }}>{r.skipped}</td>
                          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{r.avgFillAtCollection != null ? `${r.avgFillAtCollection}%` : "—"}</td>
                          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, color: r.incidents ? C.danger : C.muted }}>{r.incidents}</td>
                          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, color: C.dim }}>{getReadingAgeLabel(r.completedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
          <div style={{ fontSize: 10.5, color: C.dim }}>المخطط = مسافة الجولة ÷ {ASSUMED_SPEED_LABEL} + 4 دقائق لكل حاوية · "في الوقت" = الفعلي ≤ 120% من المخطط.</div>
        </div>
      )}

      {tab === "waste" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        <div role="note" style={{ fontSize: 12.5, color: C.warning, background: C.warning + "12", border: `1px solid ${C.warning}50`, borderRadius: 10, padding: "8px 12px" }}><b>بيانات توضيحية:</b> أوزان النفايات والتكاليف هنا من بيانات التهيئة (أو مولّدة عند غيابها)، وليست قياسًا تشغيليًا. التقارير المحسوبة من التشغيل: الأداء، الجولات، السائقون، الأثر.</div>
          <Card title="توزيع النفايات حسب النوع" icon={<Trash2 size={16} color={C.muted} />}>
            <ChartBox height={280}><ResponsiveContainer>
              <PieChart>
                <Pie data={wasteByType} cx="50%" cy="50%" outerRadius={100} innerRadius={55} dataKey="value" paddingAngle={3}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {wasteByType.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer></ChartBox>
            <div style={{ textAlign: "center", fontSize: 14, fontWeight: 700, color: C.text }}>الإجمالي: {totalWaste.toLocaleString()} كجم</div>
          </Card>
          <Card title="النفايات اليومية حسب النوع" icon={<TrendingUp size={16} color={C.muted} />}>
            <ChartBox height={300}><ResponsiveContainer>
              <AreaChart data={weeklyData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="day" tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                {Object.entries(WASTE_COLORS).map(([key, color]) => (
                  <Area key={key} type="monotone" dataKey={key} stackId="1" stroke={color} fill={color} fillOpacity={0.4} />
                ))}
              </AreaChart>
            </ResponsiveContainer></ChartBox>
          </Card>
        </div>
      )}

      {tab === "cost" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div role="note" style={{ fontSize: 12.5, color: C.warning, background: C.warning + "12", border: `1px solid ${C.warning}50`, borderRadius: 10, padding: "8px 12px" }}><b>بيانات توضيحية:</b> أوزان النفايات والتكاليف هنا من بيانات التهيئة (أو مولّدة عند غيابها)، وليست قياسًا تشغيليًا. التقارير المحسوبة من التشغيل: الأداء، الجولات، السائقون، الأثر.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
            <StatCard title="إجمالي التكلفة السنوية" value={monthlyTrend.reduce((a, m) => a + m.التكلفة, 0).toLocaleString()} unit="ر.س" icon={<DollarSign size={22} color="#fff" />} gradient={C.g3} />
            <StatCard title="متوسط التكلفة الشهرية" value={Math.round(monthlyTrend.reduce((a, m) => a + m.التكلفة, 0) / 12).toLocaleString()} unit="ر.س" icon={<Calendar size={22} color="#fff" />} gradient={C.g2} trend={-8.5} />
            <StatCard title="تكلفة الكيلوغرام" value={(monthlyTrend.reduce((a, m) => a + m.التكلفة, 0) / 12 / (totalWaste * 4.3)).toFixed(2)} unit="ر.س" icon={<Scale size={22} color="#fff" />} gradient={C.g1} />
          </div>
          <Card title="التكاليف الشهرية مقابل عمليات الجمع" icon={<Banknote size={16} color={C.muted} />}>
            <ChartBox height={300}><ResponsiveContainer>
              <ComposedChart data={monthlyTrend} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                <YAxis yAxisId="left" tick={{ fill: C.muted, fontSize: 10 }} />
                <YAxis yAxisId="right" orientation="left" tick={{ fill: C.muted, fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                <Bar yAxisId="left" dataKey="التكلفة" fill={C.warning} radius={[4, 4, 0, 0]} opacity={0.8} name="التكلفة (ر.س)" />
                <Line yAxisId="right" type="monotone" dataKey="عمليات_الجمع" stroke={C.accent} strokeWidth={3} dot={{ r: 3 }} name="عمليات الجمع" />
              </ComposedChart>
            </ResponsiveContainer></ChartBox>
          </Card>
        </div>
      )}

      {tab === "environment" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div role="note" style={{ fontSize: 12.5, color: C.warning, background: C.warning + "12", border: `1px solid ${C.warning}50`, borderRadius: 10, padding: "8px 12px" }}><b>بيانات توضيحية:</b> مؤشرات هذا التبويب من بيانات التهيئة وليست محسوبة من التشغيل. الأثر البيئي المحسوب فعليًا في تبويب «الأثر والتوفير».</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            {envMetrics.map((item, i) => (
              <div key={i} style={{ background: C.card, border: `1px solid ${item.color}30`, borderRadius: 16, padding: 20, textAlign: "center" }}>
                <div style={{ marginBottom: 8, display: "flex", justifyContent: "center", color: item.color }}>{item.icon}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: item.color }}>{item.value}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginTop: 4 }}>{item.label}</div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{item.desc}</div>
              </div>
            ))}
          </div>
          <Card title="أهداف الاستدامة - بريدة" icon={<Leaf size={16} color={C.muted} />}>
            {sustainGoals.map((item, i) => (
              <div key={i} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: C.text }}>{item.goal}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: item.color }}>{item.progress}%</span>
                </div>
                <div style={{ width: "100%", height: 10, background: C.bg, borderRadius: 5, overflow: "hidden" }}>
                  <div style={{ width: `${item.progress}%`, height: "100%", background: item.color, borderRadius: 5, transition: "width 1s ease" }} />
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
};

// ======================== PREDICTIONS ========================
const EVENTS_DB = [
  // --- المناسبات الدينية ---
  { id: "ramadan", name: "شهر رمضان", type: "دينية", icon: "🌙", month: 3, duration: 30, wasteMultiplier: 1.85, peakType: "عضوية", description: "زيادة كبيرة في النفايات الغذائية بسبب الإفطار والسحور والولائم", color: C.purple, seasonTag: "رمضان" },
  { id: "eid_fitr", name: "عيد الفطر", type: "دينية", icon: "🎉", month: 4, duration: 6, wasteMultiplier: 2.4, peakType: "مختلطة", description: "ذروة النفايات من الاحتفالات والهدايا والولائم العائلية", color: "#ec4899", seasonTag: "أعياد" },
  { id: "eid_adha", name: "عيد الأضحى", type: "دينية", icon: "🐑", month: 6, duration: 5, wasteMultiplier: 2.7, peakType: "عضوية", description: "أعلى ذروة سنوية بسبب الأضاحي والولائم الكبيرة", color: C.danger, seasonTag: "أعياد" },
  { id: "hajj", name: "موسم الحج", type: "دينية", icon: "🕋", month: 6, duration: 10, wasteMultiplier: 1.5, peakType: "مختلطة", description: "زيادة متوسطة من التجمعات والسفر", color: C.warning, seasonTag: "مواسم" },
  // --- الرواتب ---
  { id: "salary_gov", name: "رواتب القطاع الحكومي", type: "رواتب", icon: "💰", month: -1, duration: 5, wasteMultiplier: 1.45, peakType: "بلاستيك", description: "زيادة الاستهلاك والتسوق بعد صرف الرواتب مباشرة", color: C.accent, seasonTag: "رواتب", recurring: "monthly", dayOfMonth: 27 },
  { id: "salary_pvt", name: "رواتب القطاع الخاص", type: "رواتب", icon: "💳", month: -1, duration: 5, wasteMultiplier: 1.35, peakType: "بلاستيك", description: "زيادة في نفايات التغليف والمواد الاستهلاكية", color: C.info, seasonTag: "رواتب", recurring: "monthly", dayOfMonth: 1 },
  // --- المواسم ---
  { id: "summer", name: "الإجازة الصيفية", type: "موسمية", icon: "☀️", month: 6, duration: 75, wasteMultiplier: 1.6, peakType: "بلاستيك", description: "زيادة الاستهلاك والمشروبات والمواد البلاستيكية", color: "#f97316", seasonTag: "صيف" },
  { id: "back_school", name: "بداية العام الدراسي", type: "موسمية", icon: "📚", month: 8, duration: 14, wasteMultiplier: 1.3, peakType: "ورق", description: "نفايات ورقية ومواد تغليف من المستلزمات المدرسية", color: "#06b6d4", seasonTag: "مدارس" },
  { id: "national_day", name: "اليوم الوطني", type: "وطنية", icon: "🇸🇦", month: 9, duration: 4, wasteMultiplier: 2.1, peakType: "مختلطة", description: "احتفالات كبيرة وفعاليات مفتوحة في جميع الأحياء", color: "#22c55e", seasonTag: "وطني" },
  { id: "founding_day", name: "يوم التأسيس", type: "وطنية", icon: "🏰", month: 2, duration: 3, wasteMultiplier: 1.8, peakType: "مختلطة", description: "فعاليات احتفالية وتجمعات عائلية", color: "#a855f7", seasonTag: "وطني" },
  { id: "winter", name: "موسم الشتاء والأمطار", type: "موسمية", icon: "🌧️", month: 12, duration: 60, wasteMultiplier: 1.15, peakType: "عضوية", description: "زيادة طفيفة في النفايات الغذائية والتدفئة", color: C.dim, seasonTag: "شتاء" },
  { id: "sales", name: "التخفيضات الكبرى (وايت فرايدي)", type: "تجارية", icon: "🛒", month: 11, duration: 10, wasteMultiplier: 1.7, peakType: "بلاستيك", description: "نفايات تغليف ومواد شحن بكميات كبيرة", color: "#0ea5e9", seasonTag: "تسوق" },
  { id: "newyear", name: "نهاية السنة الميلادية", type: "تجارية", icon: "🎊", month: 12, duration: 7, wasteMultiplier: 1.55, peakType: "مختلطة", description: "احتفالات وتجمعات نهاية العام", color: "#d946ef", seasonTag: "أعياد" },
];

const generatePredictionData = (events, actualMonthlyData = {}) => {
  const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const baseDaily = 1800;
  return months.map((m, i) => {
    const monthEvents = events.filter(e => e.month === i + 1 || (e.recurring === "monthly"));
    const maxMultiplier = monthEvents.length > 0 ? Math.max(...monthEvents.map(e => e.wasteMultiplier)) : 1;
    const combined = monthEvents.reduce((acc, e) => acc + (e.wasteMultiplier - 1) * 0.6, 0);
    const effectiveMultiplier = 1 + Math.min(combined, maxMultiplier - 0.2);
    const predicted = Math.round(baseDaily * effectiveMultiplier);
    const storedActual = actualMonthlyData[m] ?? null;
    const actual = storedActual !== null ? storedActual
      : (i < new Date().getMonth() ? Math.round(predicted * 0.96) : null);
    return {
      month: m,
      المتوقع: predicted,
      الفعلي: actual,
      المعتاد: baseDaily,
      الأحداث: monthEvents.length,
      multiplier: effectiveMultiplier,
    };
  });
};

const generate30DayForecast = (events) => {
  const today = new Date();
  const baseDaily = 150;
  return Array.from({ length: 30 }, (_, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dayOfMonth = date.getDate();
    const monthNum = date.getMonth() + 1;
    const dayName = date.toLocaleDateString("ar-SA", { weekday: "short" });
    const isWeekend = date.getDay() === 5 || date.getDay() === 6;
    let multiplier = isWeekend ? 1.25 : 1;
    events.forEach(e => {
      if (e.recurring === "monthly" && Math.abs(dayOfMonth - e.dayOfMonth) <= 2) multiplier *= e.wasteMultiplier;
      if (e.month === monthNum) multiplier *= 1 + (e.wasteMultiplier - 1) * 0.3;
    });
    const predicted = Math.round(baseDaily * multiplier);
    return {
      label: `${dayOfMonth}/${monthNum}`,
      dayName,
      المتوقع: predicted,
      الحد_الأعلى: Math.round(predicted * 1.15),
      الحد_الأدنى: Math.round(predicted * 0.85),
      isWeekend,
      multiplier,
    };
  });
};

/** §35 — real per-bin prediction tab: fill rate, hours-to-full, confidence, neighborhood future risk, and the future-state map. */
const PredictionsLiveTab = ({ neighborhoods = [], bins = [], recentReadings = [], fireSensors = [] }) => {
  const readingsByBin = useMemo(() => {
    const map = {};
    for (const r of recentReadings) { if (!r.bin_id) continue; (map[r.bin_id] ||= []).push(r); }
    return map;
  }, [recentReadings]);

  const isThermalAlert = (name) =>
    fireSensors.some((s) => normalizeNeighborhoodName(s.district) === normalizeNeighborhoodName(name) && (s.riskLevel === "خطر عالي" || s.riskLevel === "خطر متوسط"));

  const soonList = useMemo(() => {
    return bins
      .map((bin) => {
        const n = neighborhoods.find((n2) => n2.id === bin.neighborhoodId);
        const readings = readingsByBin[bin.id] || [];
        const priority = getBinPriority(bin, null, readings, { thermalAlert: n ? isThermalAlert(n.name) : false });
        const rate = computeFillRate(readings);
        return { bin, neighborhood: n, priority, rate };
      })
      .filter((x) => x.priority.prediction.predictionAvailable)
      .sort((a, b) => a.priority.prediction.hoursToFull - b.priority.prediction.hoursToFull);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bins, neighborhoods, readingsByBin, fireSensors]);

  const noDataCount = bins.length - soonList.length;

  const neighborhoodFutureRisk = useMemo(() => {
    return neighborhoods.map((n) => {
      const nBins = bins.filter((b) => b.neighborhoodId === n.id);
      const scored = nBins.map((bin) => ({ bin, priority: getBinPriority(bin, null, readingsByBin[bin.id] || [], { thermalAlert: isThermalAlert(n.name) }) }));
      const soonCount = scored.filter((x) => x.priority.prediction.predictionAvailable && x.priority.prediction.hoursToFull <= THRESHOLDS.predictedFullSoonHours * 2).length;
      return { neighborhood: n, priority: getNeighborhoodPriority(scored, { thermalAlert: isThermalAlert(n.name) }), soonCount };
    }).sort((a, b) => b.priority.score - a.priority.score);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neighborhoods, bins, readingsByBin, fireSensors]);

  if (bins.length === 0) {
    return <EmptyState icon="📦" title="لا توجد حاويات بعد" desc="شغّل ترحيل البيانات أو إنشاء البيانات التجريبية من صفحة الإعدادات." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        <StatCard title="حاويات بتنبؤ متاح" value={soonList.length} icon={<TrendingUp size={22} color="#fff" />} gradient="linear-gradient(135deg, #3b82f6, #1d4ed8)" />
        <StatCard title="بلا بيانات كافية للتنبؤ" value={noDataCount} icon={<AlertTriangle size={22} color="#fff" />} gradient="linear-gradient(135deg, #64748b, #475569)" />
        <StatCard title="متوقع الامتلاء خلال 3 ساعات" value={soonList.filter((x) => x.priority.prediction.hoursToFull <= THRESHOLDS.predictedFullSoonHours).length} icon={<Clock size={22} color="#fff" />} gradient="linear-gradient(135deg, #ef4444, #dc2626)" />
      </div>

      <Card title="🗺️ الخريطة المستقبلية" icon={<MapGlyph size={16} color={C.muted} />}>
        <OperationalMap neighborhoods={neighborhoods} bins={bins} fireSensors={fireSensors} recentReadings={recentReadings} height={360} compact />
      </Card>

      <Card title="حاويات متوقع امتلاؤها قريبًا" icon={<Clock size={16} color={C.muted} />}>
        {soonList.length === 0 ? (
          <EmptyState icon="📊" title="لا توجد بيانات تاريخية كافية بعد لأي حاوية" desc="يحتاج التنبؤ عدة قراءات متتالية صاعدة لكل حاوية — ستظهر هنا تلقائيًا مع تراكم القراءات." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {soonList.slice(0, 10).map(({ bin, neighborhood: n, priority, rate }) => (
              <div key={bin.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, fontSize: 12, gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700, color: C.text }}>{bin.name} <span style={{ color: C.dim, fontWeight: 400 }}>· {n?.name || "—"}</span></div>
                  <div style={{ color: C.muted, marginTop: 2 }}>
                    متوقع الامتلاء خلال <b style={{ color: C.text }}>{priority.prediction.hoursToFull.toFixed(1)} ساعة</b>
                    {" "}· معدل الامتلاء: {rate.ratePerHour != null ? `${rate.ratePerHour.toFixed(1)}%/ساعة` : "—"}
                    {" "}· الثقة: {CONFIDENCE_LABELS[priority.prediction.confidence] || priority.prediction.confidence}
                  </div>
                </div>
                <StateBadge state={priority.tier} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="الحالة المستقبلية المتوقعة للأحياء" icon={<Home size={16} color={C.muted} />}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {neighborhoodFutureRisk.map(({ neighborhood: n, priority, soonCount }) => (
            <div key={n.id} style={{ background: C.bg, border: `1px solid ${STATUS_COLORS[priority.tier]}40`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <b style={{ fontSize: 13, color: C.text }}>{n.name}</b>
                <StateBadge state={priority.tier} />
              </div>
              <div style={{ fontSize: 11.5, color: C.muted }}>
                {soonCount > 0 ? `${soonCount} حاوية متوقع امتلاؤها قريبًا` : "لا توجد حاويات متوقع امتلاؤها قريبًا"}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

const PredictionsPage = ({ stations, neighborhoods = [], bins = [], recentReadings = [], fireSensors = [] }) => {
  const [view, setView] = useState("live");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedType, setSelectedType] = useState("الكل");

  const { data: _actualDoc } = useAnalyticsDoc("actual_monthly");
  const actualMonthlyData = _actualDoc?.data || {};

  const predictionData = useMemo(() => generatePredictionData(EVENTS_DB, actualMonthlyData), [actualMonthlyData]);
  const forecast30 = useMemo(() => generate30DayForecast(EVENTS_DB), []);

  const eventTypes = ["الكل", "دينية", "رواتب", "موسمية", "وطنية", "تجارية"];
  const filteredEvents = selectedType === "الكل" ? EVENTS_DB : EVENTS_DB.filter(e => e.type === selectedType);

  const upcomingEvents = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    return [...EVENTS_DB]
      .map(e => {
        const monthDiff = e.recurring === "monthly" ? 0 : ((e.month - currentMonth + 12) % 12);
        return { ...e, monthsAway: monthDiff };
      })
      .sort((a, b) => a.monthsAway - b.monthsAway)
      .slice(0, 6);
  }, []);

  const totalPredicted = predictionData.reduce((a, d) => a + d.المتوقع, 0);
  const totalActual = predictionData.filter(d => d.الفعلي).reduce((a, d) => a + d.الفعلي, 0);
  const peakMonth = predictionData.reduce((max, d) => d.المتوقع > max.المتوقع ? d : max, predictionData[0]);
  const avgAccuracy = (() => {
    const withActual = predictionData.filter(d => d.الفعلي);
    if (!withActual.length) return 0;
    return Math.round(withActual.reduce((a, d) => a + (1 - Math.abs(d.المتوقع - d.الفعلي) / d.المتوقع), 0) / withActual.length * 100);
  })();

  const impactByType = useMemo(() => {
    const types = {};
    EVENTS_DB.forEach(e => {
      if (!types[e.type]) types[e.type] = { name: e.type, avgMultiplier: 0, count: 0, totalImpact: 0 };
      types[e.type].avgMultiplier += e.wasteMultiplier;
      types[e.type].count += 1;
      types[e.type].totalImpact += (e.wasteMultiplier - 1) * e.duration;
    });
    return Object.values(types).map(t => ({
      ...t,
      avgMultiplier: +(t.avgMultiplier / t.count).toFixed(2),
      التأثير: Math.round(t.totalImpact * 10),
    }));
  }, []);

  const stationRisk = useMemo(() => {
    const nextEvent = upcomingEvents[0];
    return stations.map(s => ({
      name: s.district.replace("حي ", ""),
      الخطورة_الحالية: s.fillLevel,
      الخطورة_المتوقعة: Math.min(100, Math.round(s.fillLevel * (nextEvent?.wasteMultiplier || 1.2))),
      الفجوة: Math.min(100, Math.round(s.fillLevel * (nextEvent?.wasteMultiplier || 1.2))) - s.fillLevel,
    })).sort((a, b) => b.الخطورة_المتوقعة - a.الخطورة_المتوقعة);
  }, [stations, upcomingEvents]);

  const wasteTypeImpact = useMemo(() => {
    const types = ["عضوية", "بلاستيك", "ورق", "زجاج", "معادن"];
    return types.map(t => {
      const relevantEvents = EVENTS_DB.filter(e => e.peakType === t || e.peakType === "مختلطة");
      return {
        name: t,
        العادي: 100,
        المتوقع: Math.round(100 * (1 + relevantEvents.reduce((a, e) => a + (e.wasteMultiplier - 1) * 0.15, 0))),
      };
    });
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* View Tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[
          { key: "live", label: "🔴 تنبؤ الحاويات الحي" },
          { key: "overview", label: "🔮 نظرة عامة" },
          { key: "events", label: "📅 المناسبات والأحداث" },
          { key: "forecast", label: "📈 التنبؤ 30 يوم" },
          { key: "risk", label: "⚠️ تحليل المخاطر" },
        ].map(t => (
          <button key={t.key} onClick={() => setView(t.key)} style={{
            padding: "10px 20px", borderRadius: 10, border: `1px solid ${view === t.key ? C.warning : C.border}`,
            background: view === t.key ? "#f59e0b15" : "transparent", color: view === t.key ? C.warning : C.muted,
            cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: ARABIC_FONT,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ===== LIVE BIN PREDICTIONS (§35) — real decisionEngine/prediction output, not stations ===== */}
      {view === "live" && (
        <PredictionsLiveTab neighborhoods={neighborhoods} bins={bins} recentReadings={recentReadings} fireSensors={fireSensors} />
      )}
      {view !== "live" && (
        <div style={{ fontSize: 11, color: C.dim, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px" }}>
          ℹ️ التبويبات التالية (نظرة عامة/المناسبات/التنبؤ 30 يوم/تحليل المخاطر) تعرض توقعات موسمية إجمالية لحجم النفايات على مستوى المدينة بالكامل، وما زالت مبنية على بيانات المحطات القديمة — منفصلة عن تبويب "تنبؤ الحاويات الحي" أعلاه الذي يعتمد على بيانات الحاويات الذكية الفعلية.
        </div>
      )}

      {/* ===== OVERVIEW ===== */}
      {view === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <StatCard title="إجمالي التوقعات السنوية" value={Math.round(totalPredicted / 1000)} unit="طن" icon={<Sparkles size={22} color="#fff" />} gradient="linear-gradient(135deg, #f59e0b, #d97706)" />
            <StatCard title="دقة التنبؤ" value={avgAccuracy} unit="%" icon={<Target size={22} color="#fff" />} gradient="linear-gradient(135deg, #10b981, #059669)" />
            <StatCard title="ذروة متوقعة" value={peakMonth.month} icon={<BarChart2 size={22} color="#fff" />} gradient="linear-gradient(135deg, #ef4444, #dc2626)" />
            <StatCard title="أحداث مؤثرة" value={EVENTS_DB.length} icon={<Calendar size={22} color="#fff" />} gradient="linear-gradient(135deg, #8b5cf6, #7c3aed)" />
          </div>

          {/* Annual Prediction vs Actual */}
          <Card title="التنبؤ السنوي مقابل الفعلي (كجم/يوم)" icon={<BarChart2 size={16} color={C.muted} />}>
            <ChartBox height={300}><ResponsiveContainer>
              <ComposedChart data={predictionData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                <Area type="monotone" dataKey="المعتاد" fill="#64748b20" stroke={C.dim} strokeDasharray="5 5" strokeWidth={1} name="المعدل الطبيعي" />
                <Bar dataKey="المتوقع" fill={C.warning} opacity={0.7} radius={[4, 4, 0, 0]} name="المتوقع" />
                <Line type="monotone" dataKey="الفعلي" stroke={C.accent} strokeWidth={3} dot={{ r: 5, fill: C.accent }} name="الفعلي" connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer></ChartBox>
          </Card>

          {/* Upcoming Events + Impact by Type */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <Card title="الأحداث القادمة" icon={<Clock size={16} color={C.muted} />}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
                {upcomingEvents.map((e, i) => (
                  <div key={i} style={{ padding: "12px 14px", borderRadius: 12, background: C.bg, border: `1px solid ${e.color}30`, display: "flex", gap: 12, alignItems: "center" }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: `${e.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>{e.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{e.name}</span>
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 8, background: `${e.color}20`, color: e.color, fontWeight: 600 }}>{e.type}</span>
                      </div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>الزيادة المتوقعة: <span style={{ color: e.wasteMultiplier > 2 ? C.danger : C.warning, fontWeight: 700 }}>×{e.wasteMultiplier}</span></div>
                      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: C.dim }}>المدة: {e.duration} يوم</span>
                        <span style={{ fontSize: 10, color: C.dim }}>النوع الأكثر: {e.peakType}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="التأثير حسب نوع الحدث" icon={<BarChart2 size={16} color={C.muted} />}>
              <ChartBox height={280}><ResponsiveContainer>
                <BarChart data={impactByType} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis type="number" tick={{ fill: C.muted, fontSize: 10 }} />
                  <YAxis dataKey="name" type="category" width={60} tick={{ fill: C.muted, fontSize: 11, fontFamily: ARABIC_FONT }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="التأثير" radius={[0, 6, 6, 0]} name="مؤشر التأثير">
                    {impactByType.map((e, i) => <Cell key={i} fill={[C.purple, C.accent, C.warning, "#22c55e", "#0ea5e9"][i % 5]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer></ChartBox>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                {impactByType.map((t, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted, padding: "4px 8px", background: C.bg, borderRadius: 6 }}>
                    <span>{t.name} ({t.count} حدث)</span>
                    <span style={{ fontWeight: 600, color: C.text }}>متوسط ×{t.avgMultiplier}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ===== EVENTS ===== */}
      {view === "events" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Type Filters */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {eventTypes.map(t => (
              <button key={t} onClick={() => setSelectedType(t)} style={{
                padding: "7px 16px", borderRadius: 10, border: `1px solid ${selectedType === t ? C.warning : C.border}`,
                background: selectedType === t ? "#f59e0b20" : "transparent", color: selectedType === t ? C.warning : C.muted,
                cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: ARABIC_FONT,
              }}>{t}</button>
            ))}
          </div>

          {selectedEvent ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <button onClick={() => setSelectedEvent(null)} style={{ alignSelf: "flex-start", padding: "6px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.warning, cursor: "pointer", fontSize: 13, fontFamily: ARABIC_FONT }}>
                ← العودة للقائمة
              </button>
              <div style={{ background: C.card, border: `1px solid ${selectedEvent.color}40`, borderRadius: 16, padding: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
                  <div style={{ width: 64, height: 64, borderRadius: 16, background: `${selectedEvent.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36 }}>{selectedEvent.icon}</div>
                  <div>
                    <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: 0 }}>{selectedEvent.name}</h2>
                    <span style={{ fontSize: 13, color: selectedEvent.color, fontWeight: 600 }}>{selectedEvent.type} • {selectedEvent.seasonTag}</span>
                  </div>
                </div>
                <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.8, margin: "0 0 20px 0" }}>{selectedEvent.description}</p>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 24 }}>
                  {[
                    { label: "معامل الزيادة", val: `×${selectedEvent.wasteMultiplier}`, icon: <TrendingUp size={24} color={selectedEvent.wasteMultiplier > 2 ? C.danger : C.warning} />, color: selectedEvent.wasteMultiplier > 2 ? C.danger : C.warning },
                    { label: "مدة التأثير", val: `${selectedEvent.duration} يوم`, icon: <Clock size={24} color={C.info} />, color: C.info },
                    { label: "النفايات الأكثر", val: selectedEvent.peakType, icon: <Trash2 size={24} color={C.accent} />, color: C.accent },
                    { label: "الشهر", val: selectedEvent.recurring === "monthly" ? "شهري" : ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"][selectedEvent.month - 1], icon: <Calendar size={24} color={C.purple} />, color: C.purple },
                  ].map((item, i) => (
                    <div key={i} style={{ background: C.bg, borderRadius: 12, padding: 16, textAlign: "center" }}>
                      <div style={{ marginBottom: 6, display: "flex", justifyContent: "center" }}>{item.icon}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: item.color }}>{item.val}</div>
                      <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{item.label}</div>
                    </div>
                  ))}
                </div>

                {/* Simulated daily impact chart for this event */}
                <Card title={`التأثير اليومي المتوقع - ${selectedEvent.name}`} icon={<TrendingDown size={16} color={C.muted} />}>
                  <ChartBox height={220}><ResponsiveContainer>
                    <AreaChart data={Array.from({ length: Math.min(selectedEvent.duration, 30) }, (_, i) => {
                      const peak = selectedEvent.duration / 2;
                      const factor = 1 + (selectedEvent.wasteMultiplier - 1) * Math.exp(-0.5 * Math.pow((i - peak) / (selectedEvent.duration * 0.25), 2));
                      return { يوم: `يوم ${i + 1}`, الكمية: Math.round(150 * factor), الطبيعي: 150 };
                    })} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="gEvent" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={selectedEvent.color} stopOpacity={0.4} />
                          <stop offset="95%" stopColor={selectedEvent.color} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="يوم" tick={{ fill: C.muted, fontSize: 9, fontFamily: ARABIC_FONT }} />
                      <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                      <Area type="monotone" dataKey="الطبيعي" stroke={C.dim} fill="none" strokeDasharray="5 5" name="المعدل الطبيعي" />
                      <Area type="monotone" dataKey="الكمية" stroke={selectedEvent.color} fill="url(#gEvent)" strokeWidth={2} name="الكمية المتوقعة (كجم)" />
                    </AreaChart>
                  </ResponsiveContainer></ChartBox>
                </Card>

                {/* Recommendations */}
                <div style={{ marginTop: 16, background: `${selectedEvent.color}10`, border: `1px solid ${selectedEvent.color}30`, borderRadius: 12, padding: 18 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 12 }}>💡 التوصيات التشغيلية</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      `زيادة عدد جولات الجمع بنسبة ${Math.round((selectedEvent.wasteMultiplier - 1) * 100)}% خلال فترة ${selectedEvent.name}`,
                      `تخصيص حاويات إضافية لنفايات ${selectedEvent.peakType} في جميع أحياء بريدة`,
                      `جدولة جولات جمع إضافية قبل بداية الحدث بأسبوع`,
                      selectedEvent.wasteMultiplier > 2 ? "تفعيل خطة الطوارئ وتخصيص فرق عمل إضافية" : "مراقبة مستمرة لمستويات الامتلاء كل 4 ساعات",
                      `إرسال تنبيهات استباقية للأحياء الأكثر كثافة سكانية`,
                    ].map((rec, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
                        <span style={{ color: selectedEvent.color, fontWeight: 700, flexShrink: 0 }}>●</span>
                        {rec}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
              {filteredEvents.map((e) => (
                <div key={e.id} onClick={() => setSelectedEvent(e)} style={{
                  background: C.card, border: `1px solid ${e.color}30`, borderRadius: 14, padding: 18, cursor: "pointer",
                  transition: "all 0.2s", position: "relative", overflow: "hidden",
                }}
                  onMouseEnter={(ev) => { ev.currentTarget.style.borderColor = e.color + "80"; ev.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(ev) => { ev.currentTarget.style.borderColor = e.color + "30"; ev.currentTarget.style.transform = "translateY(0)"; }}
                >
                  <div style={{ position: "absolute", top: 0, left: 0, width: `${(e.wasteMultiplier / 3) * 100}%`, height: 3, background: e.color, borderRadius: "0 3px 3px 0" }} />
                  <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: `${e.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{e.icon}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{e.name}</div>
                      <div style={{ fontSize: 11, color: e.color, fontWeight: 600 }}>{e.type} • {e.seasonTag}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, marginBottom: 10, height: 33, overflow: "hidden" }}>{e.description}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 10 }}>
                      <span style={{ fontSize: 10, color: C.dim, background: C.bg, padding: "2px 8px", borderRadius: 6 }}>×{e.wasteMultiplier}</span>
                      <span style={{ fontSize: 10, color: C.dim, background: C.bg, padding: "2px 8px", borderRadius: 6 }}>{e.duration} يوم</span>
                    </div>
                    <span style={{ fontSize: 10, color: C.dim }}>{e.peakType}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== 30-DAY FORECAST ===== */}
      {view === "forecast" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="توقعات الـ 30 يوم القادمة (كجم/يوم لكل حي)" icon={<TrendingUp size={16} color={C.muted} />}>
            <ChartBox height={320}><ResponsiveContainer>
              <AreaChart data={forecast30} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="gForecast" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.warning} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={C.warning} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gBand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.info} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={C.info} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 9 }} interval={2} />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                <Area type="monotone" dataKey="الحد_الأعلى" stroke="none" fill="url(#gBand)" name="الحد الأعلى" />
                <Area type="monotone" dataKey="الحد_الأدنى" stroke="none" fill="transparent" name="الحد الأدنى" />
                <Line type="monotone" dataKey="المتوقع" stroke={C.warning} strokeWidth={3} dot={false} name="التوقع" />
              </AreaChart>
            </ResponsiveContainer></ChartBox>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <Card title="توقعات تأثير النفايات حسب النوع" icon={<Trash2 size={16} color={C.muted} />}>
              <ChartBox height={260}><ResponsiveContainer>
                <BarChart data={wasteTypeImpact} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="name" tick={{ fill: C.muted, fontSize: 11, fontFamily: ARABIC_FONT }} />
                  <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                  <Bar dataKey="العادي" fill={C.dim} opacity={0.5} radius={[4, 4, 0, 0]} name="المعدل العادي" />
                  <Bar dataKey="المتوقع" fill={C.warning} radius={[4, 4, 0, 0]} name="المتوقع القادم" />
                </BarChart>
              </ResponsiveContainer></ChartBox>
            </Card>

            <Card title="ملخص التوقعات" icon={<ClipboardList size={16} color={C.muted} />}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { label: "أعلى يوم متوقع", val: `${Math.max(...forecast30.map(d => d.المتوقع))} كجم`, icon: <TrendingUp size={20} color={C.danger} />, color: C.danger },
                  { label: "أقل يوم متوقع", val: `${Math.min(...forecast30.map(d => d.المتوقع))} كجم`, icon: <TrendingDown size={20} color={C.accent} />, color: C.accent },
                  { label: "المتوسط المتوقع", val: `${Math.round(forecast30.reduce((a, d) => a + d.المتوقع, 0) / 30)} كجم/يوم`, icon: <BarChart2 size={20} color={C.info} />, color: C.info },
                  { label: "أيام فوق المعدل", val: `${forecast30.filter(d => d.المتوقع > 150).length} يوم`, icon: <AlertTriangle size={20} color={C.warning} />, color: C.warning },
                  { label: "أيام عطلة نهاية أسبوع", val: `${forecast30.filter(d => d.isWeekend).length} يوم`, icon: <Calendar size={20} color={C.purple} />, color: C.purple },
                  { label: "أعلى معامل زيادة", val: `×${Math.max(...forecast30.map(d => d.multiplier)).toFixed(2)}`, icon: <Sparkles size={20} color="#ec4899" />, color: "#ec4899" },
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: C.bg, borderRadius: 10 }}>
                    <span style={{ display: "flex", alignItems: "center" }}>{item.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: C.dim }}>{item.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: item.color }}>{item.val}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ===== RISK ANALYSIS ===== */}
      {view === "risk" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: `${C.warning}10`, border: `1px solid ${C.warning}30`, borderRadius: 14, padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 24 }}>⚠️</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>تحليل المخاطر بناءً على الحدث القادم: <span style={{ color: C.warning }}>{upcomingEvents[0]?.name} {upcomingEvents[0]?.icon}</span></span>
            </div>
            <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.7 }}>
              يُتوقع زيادة بمعامل <strong style={{ color: C.warning }}>×{upcomingEvents[0]?.wasteMultiplier}</strong> في حجم النفايات خلال الفترة القادمة.
              التحليل التالي يوضح الأحياء الأكثر عرضة للخطر والتي تحتاج إلى تدخل استباقي.
            </p>
          </div>

          <Card title="مقارنة الخطورة الحالية مع المتوقعة لكل حي" icon={<BarChart2 size={16} color={C.muted} />}>
            <ChartBox height={380}><ResponsiveContainer>
              <BarChart data={stationRisk} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis type="number" domain={[0, 100]} tick={{ fill: C.muted, fontSize: 10 }} />
                <YAxis dataKey="name" type="category" width={65} tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                <Bar dataKey="الخطورة_الحالية" fill={C.info} opacity={0.7} radius={[0, 4, 4, 0]} name="الحالي %" />
                <Bar dataKey="الخطورة_المتوقعة" fill={C.danger} opacity={0.7} radius={[0, 4, 4, 0]} name="المتوقع %" />
              </BarChart>
            </ResponsiveContainer></ChartBox>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <Card title="الأحياء الأكثر خطورة" icon={<AlertTriangle size={16} color={C.muted} />}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {stationRisk.slice(0, 6).map((s, i) => {
                  const risk = s.الخطورة_المتوقعة;
                  const riskColor = risk > 90 ? C.danger : risk > 70 ? C.warning : C.accent;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: C.bg, borderRadius: 10, border: `1px solid ${riskColor}20` }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: `${riskColor}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: riskColor }}>
                        {i + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>حي {s.name}</div>
                        <div style={{ width: "100%", height: 6, background: C.border, borderRadius: 3, marginTop: 4, overflow: "hidden" }}>
                          <div style={{ width: `${risk}%`, height: "100%", background: riskColor, borderRadius: 3, transition: "width 1s ease" }} />
                        </div>
                      </div>
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: riskColor }}>{risk}%</div>
                        <div style={{ fontSize: 9, color: C.dim }}>+{s.الفجوة}%</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title="خطة الاستجابة المقترحة" icon={<FileText size={16} color={C.muted} />}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { priority: "عاجل", action: "زيادة دورات الجمع للأحياء الحرجة إلى كل 4 ساعات", color: C.danger, icon: <div style={{width:10,height:10,borderRadius:"50%",background:C.danger,flexShrink:0}} /> },
                  { priority: "عاجل", action: "تجهيز حاويات احتياطية في الأحياء ذات الكثافة العالية", color: C.danger, icon: <div style={{width:10,height:10,borderRadius:"50%",background:C.danger,flexShrink:0}} /> },
                  { priority: "مهم", action: "إرسال إشعارات للسكان بمواعيد الجمع الإضافية", color: C.warning, icon: <div style={{width:10,height:10,borderRadius:"50%",background:C.warning,flexShrink:0}} /> },
                  { priority: "مهم", action: "تخصيص فرق صيانة طوارئ على مدار الساعة", color: C.warning, icon: <div style={{width:10,height:10,borderRadius:"50%",background:C.warning,flexShrink:0}} /> },
                  { priority: "وقائي", action: "فحص شامل لجميع الأحياء قبل بدء الحدث", color: C.info, icon: <div style={{width:10,height:10,borderRadius:"50%",background:C.info,flexShrink:0}} /> },
                  { priority: "وقائي", action: "تحديث جداول النقل لتغطية ساعات الذروة المتوقعة", color: C.info, icon: <div style={{width:10,height:10,borderRadius:"50%",background:C.info,flexShrink:0}} /> },
                  { priority: "تنسيقي", action: "التنسيق مع البلدية لتوفير موارد إضافية مؤقتة", color: C.accent, icon: <div style={{width:10,height:10,borderRadius:"50%",background:C.accent,flexShrink:0}} /> },
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", background: C.bg, borderRadius: 10, border: `1px solid ${item.color}20` }}>
                    <div style={{ flexShrink: 0 }}>{item.icon}</div>
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: item.color, background: `${item.color}15`, padding: "1px 6px", borderRadius: 4 }}>{item.priority}</span>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>{item.action}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};

// ======================== FIRE ALERT SYSTEM ========================
const generateFireData = (stations) => {
  return stations.map((s, i) => {
    const internalTemp = Math.round(25 + Math.random() * 55);
    const ambientTemp = Math.round(35 + Math.random() * 15);
    const gasLevel = Math.round(Math.random() * 100);
    const humidity = Math.round(20 + Math.random() * 50);
    const hasFlammable = s.wasteType === "بلاستيك" || s.wasteType === "ورق" || s.wasteType === "مختلطة";
    const isFull = s.fillLevel > 75;
    const isHot = internalTemp > 55;
    const isGassy = gasLevel > 60;
    const isDry = humidity < 30;

    // Fire risk calculation
    let riskScore = 0;
    riskScore += Math.min(internalTemp / 80, 1) * 35;
    riskScore += (gasLevel / 100) * 25;
    riskScore += hasFlammable ? 15 : 0;
    riskScore += isFull ? 10 : 0;
    riskScore += isDry ? 10 : 0;
    riskScore += (ambientTemp > 45) ? 5 : 0;
    riskScore = Math.min(Math.round(riskScore), 100);

    const riskLevel = riskScore > 75 ? "خطر عالي" : riskScore > 50 ? "خطر متوسط" : riskScore > 30 ? "تحذير" : "آمن";

    return {
      ...s,
      internalTemp,
      ambientTemp,
      gasLevel,
      humidity,
      hasFlammable,
      riskScore,
      riskLevel,
      smokeDetected: riskScore > 70 && Math.random() > 0.5,
      sparkDetected: riskScore > 80 && Math.random() > 0.6,
      lastInspection: `${Math.floor(Math.random() * 30) + 1} يوم`,
      fireExtinguisher: Math.random() > 0.2,
      autoSuppression: Math.random() > 0.3,
    };
  });
};

const generateTempHistory = () =>
  Array.from({ length: 24 }, (_, i) => {
    const baseTemp = 30 + Math.sin((i - 6) * 0.3) * 15;
    return {
      hour: `${String(i).padStart(2, "0")}:00`,
      الحرارة_الداخلية: Math.round(baseTemp + Math.random() * 15),
      الحرارة_الخارجية: Math.round(35 + Math.sin((i - 14) * 0.4) * 8 + Math.random() * 3),
      حد_الإنذار: 60,
      حد_الخطر: 75,
    };
  });

const generateWeeklyFireIncidents = () => {
  const weeks = ["الأسبوع 1", "الأسبوع 2", "الأسبوع 3", "الأسبوع 4", "الأسبوع 5", "الأسبوع 6", "الأسبوع 7", "الأسبوع 8"];
  return weeks.map(w => ({
    week: w,
    إنذارات: Math.floor(Math.random() * 8),
    حوادث_فعلية: Math.floor(Math.random() * 2),
    إنذارات_كاذبة: Math.floor(Math.random() * 3),
  }));
};

const FireAlertPage = ({ stations, fireSensors = [], fireTempHistory, fireWeekly }) => {
  const [view, setView] = useState("monitor");
  const [selectedStation, setSelectedStation] = useState(null);
  const [simRunning, setSimRunning] = useState(false);
  const [simTemp, setSimTemp] = useState(25);

  const fireData = useMemo(() => {
    if (fireSensors.length > 0 && stations.length > 0) {
      return stations.map(station => {
        const sensor = fireSensors.find(s => s.district === station.district) || {};
        const internalTemp = sensor.internalTemp ?? 35;
        const gasLevel     = sensor.gasLevel     ?? 10;
        const riskScore    = sensor.riskScore     ?? 15;
        return {
          id:               station.id,
          stationId:        station.id,
          district:         station.district,
          wasteType:        station.wasteType,
          fillLevel:        station.fillLevel,
          internalTemp,
          ambientTemp:      sensor.ambientTemp      ?? 42,
          gasLevel,
          humidity:         sensor.humidity         ?? 35,
          smokeDetected:    sensor.smokeDetected     ?? false,
          sparkDetected:    sensor.sparkDetected     ?? false,
          riskScore:        Math.min(riskScore, 100),
          riskLevel:        sensor.riskLevel         ?? "آمن",
          fireExtinguisher: sensor.fireExtinguisher  ?? true,
          autoSuppression:  sensor.autoSuppression   ?? true,
          lastInspection:   sensor.lastInspection    ?? "10 أيام",
        };
      });
    }
    return generateFireData(stations);
  }, [stations, fireSensors]);

  const tempHistory     = fireTempHistory || generateTempHistory();
  const weeklyIncidents = fireWeekly      || generateWeeklyFireIncidents();

  const highRisk = fireData.filter(s => s.riskLevel === "خطر عالي");
  const medRisk = fireData.filter(s => s.riskLevel === "خطر متوسط");
  const warnings = fireData.filter(s => s.riskLevel === "تحذير");
  const safe = fireData.filter(s => s.riskLevel === "آمن");

  const avgTemp = fireData.length ? Math.round(fireData.reduce((a, s) => a + s.internalTemp, 0) / fireData.length) : 0;
  const avgGas  = fireData.length ? Math.round(fireData.reduce((a, s) => a + s.gasLevel,     0) / fireData.length) : 0;
  const smokeCount = fireData.filter(s => s.smokeDetected).length;

  const riskDistribution = [
    { name: "خطر عالي", value: highRisk.length, fill: C.danger },
    { name: "خطر متوسط", value: medRisk.length, fill: "#f97316" },
    { name: "تحذير", value: warnings.length, fill: C.warning },
    { name: "آمن", value: safe.length, fill: C.accent },
  ];

  const stationRiskChart = fireData.map(s => ({
    name: s.district.replace("حي ", ""),
    الخطورة: s.riskScore,
    الحرارة: s.internalTemp,
    الغاز: s.gasLevel,
  })).sort((a, b) => b.الخطورة - a.الخطورة);

  const gasVsTempData = fireData.map(s => ({
    name: s.district.replace("حي ", ""),
    الحرارة: s.internalTemp,
    الغاز: s.gasLevel,
    الرطوبة: s.humidity,
  }));

  const getRiskColor = (level) => {
    const map = { "خطر عالي": C.danger, "خطر متوسط": "#f97316", "تحذير": C.warning, "آمن": C.accent };
    return map[level] || C.dim;
  };

  const getRiskBadge = (level) => {
    const color = getRiskColor(level);
    return <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: `${color}20`, color, border: `1px solid ${color}40` }}>{level}</span>;
  };

  // Simulation
  const simRiskScore = useMemo(() => {
    let score = 0;
    score += Math.min(simTemp / 80, 1) * 40;
    score += simTemp > 60 ? 20 : simTemp > 45 ? 10 : 0;
    score += simTemp > 75 ? 25 : 0;
    score += simTemp > 50 ? 15 : 0;
    return Math.min(Math.round(score), 100);
  }, [simTemp]);

  const simLevel = simRiskScore > 75 ? "خطر عالي" : simRiskScore > 50 ? "خطر متوسط" : simRiskScore > 30 ? "تحذير" : "آمن";

  if (stations.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0", color: C.dim }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔥</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.muted, marginBottom: 6 }}>جاري تحميل بيانات الأحياء...</div>
        <div style={{ fontSize: 13 }}>سيظهر نظام التنبيهات الحرارية بعد تحميل بيانات الأحياء</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[
          { key: "monitor", label: "🔥 المراقبة الحية" },
          { key: "analysis", label: "📊 التحليل والإحصائيات" },
          { key: "detail", label: "🏘️ تفاصيل الأحياء" },
          { key: "simulation", label: "🧪 محاكاة الحريق" },
          { key: "protocols", label: "📋 بروتوكولات الطوارئ" },
        ].map(t => (
          <button key={t.key} onClick={() => setView(t.key)} style={{
            padding: "10px 20px", borderRadius: 10, border: `1px solid ${view === t.key ? C.danger : C.border}`,
            background: view === t.key ? "#ef444415" : "transparent", color: view === t.key ? C.danger : C.muted,
            cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: ARABIC_FONT,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ===== LIVE MONITORING ===== */}
      {view === "monitor" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Alert Banner */}
          {highRisk.length > 0 && (
            <div style={{
              background: "linear-gradient(135deg, #7f1d1d, #991b1b)", border: "1px solid #ef4444",
              borderRadius: 14, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14,
              animation: "pulse 2s infinite",
            }}>
              <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.85 } } @keyframes blink { 0%,100%{opacity:1}50%{opacity:0.3} }`}</style>
              <div style={{ width: 50, height: 50, borderRadius: 14, background: "#ef444440", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, animation: "blink 1s infinite" }}>🔥</div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#fca5a5" }}>⚠️ تنبيه حراري - {highRisk.length} حي في خطر عالٍ!</div>
                <div style={{ fontSize: 12, color: "#fecaca", marginTop: 4 }}>
                  {highRisk.map(s => s.district).join(" • ")} — يرجى اتخاذ إجراء فوري
                </div>
              </div>
            </div>
          )}

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <StatCard title="متوسط الحرارة الداخلية" value={avgTemp} unit="°C" icon={<Thermometer size={22} color="#fff" />} gradient="linear-gradient(135deg, #ef4444, #dc2626)" trend={avgTemp > 45 ? 8.3 : -2.1} />
            <StatCard title="أحياء عالية الخطورة" value={highRisk.length} icon={<Flame size={22} color="#fff" />} gradient="linear-gradient(135deg, #f97316, #ea580c)" />
            <StatCard title="كشف دخان" value={smokeCount} unit="حي" icon={<Wind size={22} color="#fff" />} gradient="linear-gradient(135deg, #64748b, #475569)" />
            <StatCard title="متوسط مستوى الغاز" value={avgGas} unit="%" icon={<Gauge size={22} color="#fff" />} gradient="linear-gradient(135deg, #f59e0b, #d97706)" />
          </div>

          {/* Temperature Timeline + Risk Pie */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
            <Card title="منحنى الحرارة الداخلية (24 ساعة)" icon={<Thermometer size={16} color={C.muted} />}>
              <ChartBox height={280}><ResponsiveContainer>
                <AreaChart data={tempHistory} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="gIntTemp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.danger} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={C.danger} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="hour" tick={{ fill: C.muted, fontSize: 9 }} interval={2} />
                  <YAxis tick={{ fill: C.muted, fontSize: 10 }} domain={[0, 90]} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                  <Area type="monotone" dataKey="الحرارة_الداخلية" stroke={C.danger} fill="url(#gIntTemp)" strokeWidth={2} name="الحرارة الداخلية °C" />
                  <Line type="monotone" dataKey="الحرارة_الخارجية" stroke={C.warning} strokeWidth={2} strokeDasharray="4 4" dot={false} name="الحرارة الخارجية °C" />
                  <Line type="monotone" dataKey="حد_الإنذار" stroke="#f97316" strokeWidth={1} strokeDasharray="8 4" dot={false} name="حد الإنذار (60°C)" />
                  <Line type="monotone" dataKey="حد_الخطر" stroke={C.danger} strokeWidth={1} strokeDasharray="8 4" dot={false} name="حد الخطر (75°C)" />
                </AreaChart>
              </ResponsiveContainer></ChartBox>
            </Card>

            <Card title="توزيع مستويات الخطورة" icon={<Target size={16} color={C.muted} />}>
              <ChartBox height={200}><ResponsiveContainer>
                <PieChart>
                  <Pie data={riskDistribution} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={4}
                    label={({ name, value }) => value > 0 ? `${value}` : ""}>
                    {riskDistribution.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer></ChartBox>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                {riskDistribution.map((d, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: C.muted }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 3, background: d.fill }} />
                      {d.name}
                    </div>
                    <span style={{ fontWeight: 700, color: d.fill }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Station Risk Cards */}
          <Card title="حالة الأحياء - المراقبة الحية" icon={<Radio size={16} color={C.muted} />}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
              {fireData.sort((a, b) => b.riskScore - a.riskScore).map((s, i) => {
                const rColor = getRiskColor(s.riskLevel);
                return (
                  <div key={i} style={{ background: C.bg, border: `1px solid ${rColor}30`, borderRadius: 12, padding: 14, position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, width: `${s.riskScore}%`, height: 3, background: rColor }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{s.district}</span>
                      {getRiskBadge(s.riskLevel)}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 6, fontSize: 11 }}>
                      <div style={{ color: C.dim }}>🌡️ داخلي: <span style={{ color: s.internalTemp > 55 ? C.danger : s.internalTemp > 40 ? C.warning : C.text, fontWeight: 600 }}>{s.internalTemp}°C</span></div>
                      <div style={{ color: C.dim }}>⛽ غاز: <span style={{ color: s.gasLevel > 60 ? C.danger : C.text, fontWeight: 600 }}>{s.gasLevel}%</span></div>
                      <div style={{ color: C.dim }}>💧 رطوبة: <span style={{ color: C.text, fontWeight: 600 }}>{s.humidity}%</span></div>
                      <div style={{ color: C.dim }}>🗑️ امتلاء: <span style={{ color: C.text, fontWeight: 600 }}>{s.fillLevel}%</span></div>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      {s.smokeDetected && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#ef444420", color: C.danger, fontWeight: 600 }}>💨 دخان</span>}
                      {s.sparkDetected && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#f9731620", color: "#f97316", fontWeight: 600 }}>⚡ شرارة</span>}
                      {s.hasFlammable && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#f59e0b20", color: C.warning, fontWeight: 600 }}>🔥 قابل للاشتعال</span>}
                    </div>
                    {/* Risk bar */}
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.dim, marginBottom: 3 }}>
                        <span>مؤشر الخطورة</span>
                        <span style={{ color: rColor, fontWeight: 700 }}>{s.riskScore}%</span>
                      </div>
                      <div style={{ width: "100%", height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${s.riskScore}%`, height: "100%", background: `linear-gradient(90deg, ${C.accent}, ${rColor})`, borderRadius: 3, transition: "width 1s" }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* ===== ANALYSIS ===== */}
      {view === "analysis" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <Card title="مؤشر الخطورة الحرارية لكل حي" icon={<BarChart2 size={16} color={C.muted} />}>
              <ChartBox height={350}><ResponsiveContainer>
                <BarChart data={stationRiskChart} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: C.muted, fontSize: 10 }} />
                  <YAxis dataKey="name" type="category" width={60} tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="الخطورة" radius={[0, 6, 6, 0]} name="مؤشر الخطورة %">
                    {stationRiskChart.map((e, i) => <Cell key={i} fill={e.الخطورة > 75 ? C.danger : e.الخطورة > 50 ? "#f97316" : e.الخطورة > 30 ? C.warning : C.accent} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer></ChartBox>
            </Card>

            <Card title="علاقة الحرارة بالغاز والرطوبة" icon={<Microscope size={16} color={C.muted} />}>
              <ChartBox height={350}><ResponsiveContainer>
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={gasVsTempData}>
                  <PolarGrid stroke={C.border} />
                  <PolarAngleAxis dataKey="name" tick={{ fill: C.muted, fontSize: 9, fontFamily: ARABIC_FONT }} />
                  <PolarRadiusAxis tick={{ fill: C.dim, fontSize: 8 }} />
                  <Radar name="الحرارة °C" dataKey="الحرارة" stroke={C.danger} fill={C.danger} fillOpacity={0.15} />
                  <Radar name="الغاز %" dataKey="الغاز" stroke={C.warning} fill={C.warning} fillOpacity={0.15} />
                  <Radar name="الرطوبة %" dataKey="الرطوبة" stroke={C.info} fill={C.info} fillOpacity={0.15} />
                  <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                </RadarChart>
              </ResponsiveContainer></ChartBox>
            </Card>
          </div>

          <Card title="سجل الإنذارات والحوادث (8 أسابيع)" icon={<TrendingUp size={16} color={C.muted} />}>
            <ChartBox height={280}><ResponsiveContainer>
              <ComposedChart data={weeklyIncidents} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="week" tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                <Bar dataKey="إنذارات" fill={C.warning} radius={[4, 4, 0, 0]} opacity={0.8} name="إنذارات حرارية" />
                <Bar dataKey="إنذارات_كاذبة" fill={C.dim} radius={[4, 4, 0, 0]} opacity={0.6} name="إنذارات كاذبة" />
                <Line type="monotone" dataKey="حوادث_فعلية" stroke={C.danger} strokeWidth={3} dot={{ r: 5, fill: C.danger }} name="حوادث فعلية" />
              </ComposedChart>
            </ResponsiveContainer></ChartBox>
          </Card>

          {/* Fire risk factors */}
          <Card title="عوامل خطر الحريق الرئيسية" icon={<Zap size={16} color={C.muted} />}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {[
                { factor: "ارتفاع الحرارة الداخلية", weight: 35, desc: "تجاوز 55°C يزيد الخطر بشكل كبير", icon: <Thermometer size={22} color={C.danger} />, color: C.danger, affected: fireData.filter(s => s.internalTemp > 55).length },
                { factor: "تسرب الغازات", weight: 25, desc: "غازات الميثان والهيدروجين القابلة للاشتعال", icon: <Gauge size={22} color="#f97316" />, color: "#f97316", affected: fireData.filter(s => s.gasLevel > 60).length },
                { factor: "مواد قابلة للاشتعال", weight: 15, desc: "بلاستيك، ورق، ومواد مختلطة", icon: <Package size={22} color={C.warning} />, color: C.warning, affected: fireData.filter(s => s.hasFlammable).length },
                { factor: "الامتلاء الزائد", weight: 10, desc: "الضغط والاحتكاك يولدان حرارة", icon: <BarChart2 size={22} color={C.purple} />, color: C.purple, affected: fireData.filter(s => s.fillLevel > 75).length },
                { factor: "انخفاض الرطوبة", weight: 10, desc: "الجفاف يسهّل الاشتعال", icon: <Droplets size={22} color={C.info} />, color: C.info, affected: fireData.filter(s => s.humidity < 30).length },
                { factor: "الحرارة الخارجية", weight: 5, desc: "درجات حرارة بريدة الصيفية العالية", icon: <Zap size={22} color="#06b6d4" />, color: "#06b6d4", affected: fireData.filter(s => s.ambientTemp > 45).length },
              ].map((f, i) => (
                <div key={i} style={{ background: C.bg, border: `1px solid ${f.color}25`, borderRadius: 12, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span>{f.icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: f.color, background: `${f.color}15`, padding: "2px 8px", borderRadius: 6 }}>وزن {f.weight}%</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>{f.factor}</div>
                  <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.5, marginBottom: 8 }}>{f.desc}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: C.muted }}>أحياء متأثرة</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: f.affected > 3 ? C.danger : f.affected > 1 ? C.warning : C.accent }}>{f.affected}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ===== STATION DETAIL ===== */}
      {view === "detail" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {selectedStation ? (
            <>
              <button onClick={() => setSelectedStation(null)} style={{ alignSelf: "flex-start", padding: "6px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.danger, cursor: "pointer", fontSize: 13, fontFamily: ARABIC_FONT }}>
                ← العودة
              </button>
              <div style={{ background: C.card, border: `1px solid ${getRiskColor(selectedStation.riskLevel)}40`, borderRadius: 16, padding: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <div>
                    <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: 0 }}>{selectedStation.name}</h2>
                    <span style={{ fontSize: 13, color: C.muted }}>{selectedStation.id} | نظام إنذار الحريق</span>
                  </div>
                  {getRiskBadge(selectedStation.riskLevel)}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14, marginBottom: 20 }}>
                  {[
                    { label: "الحرارة الداخلية", val: `${selectedStation.internalTemp}°C`, color: selectedStation.internalTemp > 55 ? C.danger : C.warning, icon: <Thermometer size={22} color={selectedStation.internalTemp > 55 ? C.danger : C.warning} /> },
                    { label: "الحرارة الخارجية", val: `${selectedStation.ambientTemp}°C`, color: C.warning, icon: <Zap size={22} color={C.warning} /> },
                    { label: "مستوى الغاز", val: `${selectedStation.gasLevel}%`, color: selectedStation.gasLevel > 60 ? C.danger : C.accent, icon: <Gauge size={22} color={selectedStation.gasLevel > 60 ? C.danger : C.accent} /> },
                    { label: "الرطوبة", val: `${selectedStation.humidity}%`, color: selectedStation.humidity < 30 ? C.warning : C.info, icon: <Droplets size={22} color={selectedStation.humidity < 30 ? C.warning : C.info} /> },
                    { label: "مؤشر الخطورة", val: `${selectedStation.riskScore}%`, color: getRiskColor(selectedStation.riskLevel), icon: <Flame size={22} color={getRiskColor(selectedStation.riskLevel)} /> },
                    { label: "آخر فحص", val: selectedStation.lastInspection, color: C.muted, icon: <Clock size={22} color={C.muted} /> },
                  ].map((item, i) => (
                    <div key={i} style={{ background: C.bg, borderRadius: 12, padding: 14, textAlign: "center" }}>
                      <div style={{ marginBottom: 4, display: "flex", justifyContent: "center" }}>{item.icon}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: item.color }}>{item.val}</div>
                      <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>{item.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 20 }}>
                  {[
                    { label: "كاشف الدخان", active: selectedStation.smokeDetected, activeText: "تم كشف دخان!", inactiveText: "لا يوجد دخان", icon: <Wind size={20} color={C.muted} /> },
                    { label: "كاشف الشرارة", active: selectedStation.sparkDetected, activeText: "تم كشف شرارة!", inactiveText: "لا توجد شرارة", icon: <Zap size={20} color={C.muted} /> },
                    { label: "طفاية حريق", active: selectedStation.fireExtinguisher, activeText: "متوفرة وصالحة", inactiveText: "غير متوفرة!", icon: <FireExtinguisher size={20} color={C.muted} /> },
                    { label: "نظام إطفاء تلقائي", active: selectedStation.autoSuppression, activeText: "مُفعّل", inactiveText: "غير مُفعّل", icon: <Droplets size={20} color={C.muted} /> },
                  ].map((item, i) => (
                    <div key={i} style={{ background: C.bg, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, border: `1px solid ${item.active && (i < 2) ? "#ef444440" : C.border}` }}>
                      <span>{item.icon}</span>
                      <div>
                        <div style={{ fontSize: 10, color: C.dim }}>{item.label}</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: item.active ? (i < 2 ? C.danger : C.accent) : (i < 2 ? C.accent : C.danger) }}>
                          {item.active ? item.activeText : item.inactiveText}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <Card title="سجل الحرارة الداخلية - 24 ساعة" icon={<TrendingUp size={16} color={C.muted} />}>
                  <ChartBox height={220}><ResponsiveContainer>
                    <AreaChart data={tempHistory} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="gFire" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={C.danger} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={C.danger} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="hour" tick={{ fill: C.muted, fontSize: 9 }} interval={2} />
                      <YAxis tick={{ fill: C.muted, fontSize: 10 }} domain={[0, 90]} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                      <Area type="monotone" dataKey="الحرارة_الداخلية" stroke={C.danger} fill="url(#gFire)" strokeWidth={2} name="الحرارة الداخلية" />
                      <Line type="monotone" dataKey="حد_الإنذار" stroke="#f97316" strokeDasharray="6 3" dot={false} name="حد الإنذار 60°C" />
                      <Line type="monotone" dataKey="حد_الخطر" stroke={C.danger} strokeDasharray="6 3" dot={false} name="حد الخطر 75°C" />
                    </AreaChart>
                  </ResponsiveContainer></ChartBox>
                </Card>
              </div>
            </>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
              {fireData.sort((a, b) => b.riskScore - a.riskScore).map((s, i) => {
                const rColor = getRiskColor(s.riskLevel);
                return (
                  <div key={i} onClick={() => setSelectedStation(s)} style={{
                    background: C.card, border: `1px solid ${rColor}30`, borderRadius: 14, padding: 18, cursor: "pointer", transition: "all 0.2s",
                  }}
                    onMouseEnter={ev => { ev.currentTarget.style.borderColor = rColor + "80"; ev.currentTarget.style.transform = "translateY(-2px)"; }}
                    onMouseLeave={ev => { ev.currentTarget.style.borderColor = rColor + "30"; ev.currentTarget.style.transform = "translateY(0)"; }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{s.district}</span>
                      {getRiskBadge(s.riskLevel)}
                    </div>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                      <CircularGauge value={s.riskScore} color={rColor} size={80} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 4, fontSize: 11 }}>
                      <div style={{ color: C.dim }}>🌡️ {s.internalTemp}°C</div>
                      <div style={{ color: C.dim }}>⛽ {s.gasLevel}%</div>
                      <div style={{ color: C.dim }}>💧 {s.humidity}%</div>
                      <div style={{ color: C.dim }}>🗑️ {s.fillLevel}%</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===== SIMULATION ===== */}
      {view === "simulation" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="محاكاة سيناريو الحريق" icon={<FlaskConical size={16} color={C.muted} />}>
            <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, margin: "0 0 20px 0" }}>
              حرّك شريط الحرارة لمحاكاة ارتفاع درجة حرارة الحاوية الداخلية ومشاهدة كيف يتغير مستوى الخطورة والإجراءات المطلوبة في الوقت الفعلي.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
              {/* Control Panel */}
              <div style={{ background: C.bg, borderRadius: 14, padding: 20 }}>
                <div style={{ textAlign: "center", marginBottom: 20 }}>
                  <div style={{ fontSize: 64, marginBottom: 8 }}>{simTemp > 75 ? "🔥" : simTemp > 55 ? "🟠" : simTemp > 40 ? "🟡" : "🟢"}</div>
                  <div style={{ fontSize: 48, fontWeight: 900, color: getRiskColor(simLevel) }}>{simTemp}°C</div>
                  <div style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>الحرارة الداخلية</div>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <input type="range" min={15} max={95} value={simTemp} onChange={(e) => setSimTemp(+e.target.value)}
                    style={{ width: "100%", accentColor: getRiskColor(simLevel), height: 8 }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.dim, marginTop: 6 }}>
                    <span>15°C طبيعي</span>
                    <span style={{ color: C.warning }}>45°C تحذير</span>
                    <span style={{ color: "#f97316" }}>60°C إنذار</span>
                    <span style={{ color: C.danger }}>75°C+ خطر</span>
                  </div>
                </div>

                <div style={{ textAlign: "center" }}>
                  {getRiskBadge(simLevel)}
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>مؤشر الخطورة: <span style={{ fontWeight: 800, color: getRiskColor(simLevel), fontSize: 18 }}>{simRiskScore}%</span></div>
                </div>
              </div>

              {/* Response Actions */}
              <div style={{ background: C.bg, borderRadius: 14, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 14 }}>📋 الإجراءات المُفعّلة</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { temp: 0, action: "المراقبة الروتينية", desc: "فحص دوري كل 6 ساعات", icon: "✅", color: C.accent },
                    { temp: 40, action: "تنبيه مبكر", desc: "إرسال إشعار لفريق المراقبة", icon: "📱", color: "#06b6d4" },
                    { temp: 50, action: "زيادة تردد القراءات", desc: "قراءة المستشعرات كل 5 دقائق", icon: "📡", color: C.info },
                    { temp: 55, action: "تنبيه تحذيري", desc: "إخطار المشرف المسؤول فوراً", icon: "⚠️", color: C.warning },
                    { temp: 60, action: "إنذار متوسط", desc: "تفعيل نظام التبريد التلقائي", icon: "❄️", color: "#f97316" },
                    { temp: 65, action: "تأجيل الجولات القريبة", desc: "تأجيل أي جولة جمع مجدولة قرب الموقع المتأثر حتى انخفاض الحرارة", icon: "🛑", color: "#f97316" },
                    { temp: 70, action: "استدعاء فريق الطوارئ", desc: "تجهيز فريق الإطفاء الداخلي", icon: "🚒", color: C.danger },
                    { temp: 75, action: "إنذار حريق!", desc: "تفعيل نظام الإطفاء التلقائي وإخلاء المنطقة", icon: "🔥", color: C.danger },
                    { temp: 80, action: "اتصال بالدفاع المدني", desc: "طلب دعم خارجي فوري - 998", icon: "📞", color: "#dc2626" },
                    { temp: 85, action: "إخلاء كامل", desc: "إخلاء المنطقة المحيطة بنطاق 200 متر", icon: "🏃", color: "#991b1b" },
                  ].map((step, i) => {
                    const active = simTemp >= step.temp;
                    return (
                      <div key={i} style={{
                        display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderRadius: 10,
                        background: active ? `${step.color}10` : "transparent",
                        border: `1px solid ${active ? step.color + "40" : C.border}`,
                        opacity: active ? 1 : 0.4, transition: "all 0.3s",
                      }}>
                        <span style={{ fontSize: 18, filter: active ? "none" : "grayscale(1)" }}>{step.icon}</span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: active ? step.color : C.dim }}>{step.action}</div>
                          <div style={{ fontSize: 10, color: active ? C.muted : C.dim }}>{step.desc}</div>
                        </div>
                        <span style={{ fontSize: 9, color: C.dim, marginRight: "auto" }}>{step.temp}°C</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>

          {/* Simulation Chart */}
          <Card title="منحنى المحاكاة - تصاعد الحرارة" icon={<TrendingUp size={16} color={C.muted} />}>
            <ChartBox height={240}><ResponsiveContainer>
              <AreaChart data={Array.from({ length: 60 }, (_, i) => {
                const t = 25 + (simTemp - 25) * (1 - Math.exp(-i / 20));
                return { دقيقة: `${i}`, الحرارة: Math.round(t), حد_الإنذار: 60, حد_الخطر: 75 };
              })} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="gSim" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={getRiskColor(simLevel)} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={getRiskColor(simLevel)} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="دقيقة" tick={{ fill: C.muted, fontSize: 9 }} interval={9} label={{ value: "دقيقة", fill: C.dim, fontSize: 10, position: "insideBottom", offset: -2 }} />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} domain={[0, 100]} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                <Area type="monotone" dataKey="الحرارة" stroke={getRiskColor(simLevel)} fill="url(#gSim)" strokeWidth={2} name="الحرارة °C" />
                <Line type="monotone" dataKey="حد_الإنذار" stroke="#f97316" strokeDasharray="6 3" dot={false} name="حد الإنذار" />
                <Line type="monotone" dataKey="حد_الخطر" stroke={C.danger} strokeDasharray="6 3" dot={false} name="حد الخطر" />
              </AreaChart>
            </ResponsiveContainer></ChartBox>
          </Card>
        </div>
      )}

      {/* ===== PROTOCOLS ===== */}
      {view === "protocols" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="بروتوكولات الاستجابة لحرائق الحاويات" icon={<ClipboardList size={16} color={C.muted} />}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                {
                  level: "المستوى 1 - مراقبة",
                  range: "أقل من 45°C",
                  color: C.accent,
                  icon: <div style={{width:10,height:10,borderRadius:"50%",background:C.accent,flexShrink:0}} />,
                  steps: ["فحص دوري للمستشعرات كل 6 ساعات", "تسجيل القراءات في السجل اليومي", "التأكد من عمل كواشف الدخان"],
                },
                {
                  level: "المستوى 2 - تحذير",
                  range: "45°C - 60°C",
                  color: C.warning,
                  icon: <div style={{width:10,height:10,borderRadius:"50%",background:C.warning,flexShrink:0}} />,
                  steps: ["إخطار المشرف المسؤول عبر الرسائل", "زيادة تردد القراءات إلى كل 15 دقيقة", "فحص مصدر الحرارة والتحقق من وجود مواد خطرة", "تجهيز معدات الإطفاء الأولية"],
                },
                {
                  level: "المستوى 3 - إنذار",
                  range: "60°C - 75°C",
                  color: "#f97316",
                  icon: <div style={{width:10,height:10,borderRadius:"50%",background:"#f97316",flexShrink:0}} />,
                  steps: ["تفعيل نظام التبريد التلقائي", "تأجيل أي جولة جمع مجدولة قرب الحي المتأثر", "إرسال فريق الفحص الميداني", "إعداد فريق الإطفاء الداخلي", "إبلاغ إدارة المنشأة"],
                },
                {
                  level: "المستوى 4 - خطر حريق",
                  range: "أعلى من 75°C",
                  color: C.danger,
                  icon: <div style={{width:10,height:10,borderRadius:"50%",background:C.danger,flexShrink:0}} />,
                  steps: ["تفعيل نظام الإطفاء التلقائي فوراً", "الاتصال بالدفاع المدني (998)", "إخلاء المنطقة المحيطة 200 متر", "قطع التيار الكهربائي عن الموقع المتأثر", "تفعيل خطة الطوارئ الشاملة", "توثيق الحادثة بالصور والفيديو"],
                },
              ].map((protocol, i) => (
                <div key={i} style={{ background: C.bg, border: `1px solid ${protocol.color}30`, borderRadius: 14, padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center" }}>{protocol.icon}</div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: protocol.color }}>{protocol.level}</div>
                        <div style={{ fontSize: 11, color: C.dim }}>النطاق: {protocol.range}</div>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {protocol.steps.map((step, j) => (
                      <div key={j} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
                        <span style={{ color: protocol.color, fontWeight: 700, fontSize: 14, flexShrink: 0, marginTop: -1 }}>{j + 1}</span>
                        {step}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Emergency Contacts */}
          <Card title="جهات الاتصال في حالات الطوارئ" icon={<Phone size={16} color={C.muted} />}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              {[
                { name: "الدفاع المدني", phone: "998", icon: "🚒", color: C.danger, desc: "الاستجابة الأولى للحرائق" },
                { name: "الإسعاف", phone: "997", icon: "🚑", color: C.info, desc: "الطوارئ الطبية" },
                { name: "الشرطة", phone: "999", icon: "🚔", color: C.purple, desc: "الأمن والسلامة" },
                { name: "مشرف المنطقة", phone: "055-XXX-XXXX", icon: "👷", color: C.warning, desc: "المسؤول المباشر" },
                { name: "فريق الصيانة", phone: "050-XXX-XXXX", icon: "🔧", color: C.accent, desc: "الدعم التقني" },
                { name: "إدارة البلدية", phone: "940", icon: "🏛️", color: "#06b6d4", desc: "التنسيق الحكومي" },
              ].map((contact, i) => (
                <div key={i} style={{ background: C.bg, border: `1px solid ${contact.color}25`, borderRadius: 12, padding: 16, display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: `${contact.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{contact.icon}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{contact.name}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: contact.color, direction: "ltr", textAlign: "right" }}>{contact.phone}</div>
                    <div style={{ fontSize: 10, color: C.dim }}>{contact.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Equipment Checklist */}
          <Card title="قائمة فحص معدات السلامة" icon={<FireExtinguisher size={16} color={C.muted} />}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
              {[
                { item: "طفاية حريق بودرة ABC", stations: fireData.filter(s => s.fireExtinguisher).length, total: 12, icon: <FireExtinguisher size={22} color={C.muted} /> },
                { item: "نظام إطفاء تلقائي", stations: fireData.filter(s => s.autoSuppression).length, total: 12, icon: <Droplets size={22} color={C.muted} /> },
                { item: "كاشف دخان فعّال", stations: 11, total: 12, icon: <Wind size={22} color={C.muted} /> },
                { item: "كاشف حرارة فعّال", stations: 12, total: 12, icon: <Thermometer size={22} color={C.muted} /> },
                { item: "كاشف غاز فعّال", stations: 10, total: 12, icon: <Gauge size={22} color={C.muted} /> },
                { item: "إضاءة طوارئ", stations: 9, total: 12, icon: <Zap size={22} color={C.muted} /> },
              ].map((eq, i) => {
                const pct = Math.round((eq.stations / eq.total) * 100);
                const eqColor = pct === 100 ? C.accent : pct > 75 ? C.warning : C.danger;
                return (
                  <div key={i} style={{ background: C.bg, borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                    <span>{eq.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: C.text, fontWeight: 600 }}>{eq.item}</span>
                        <span style={{ color: eqColor, fontWeight: 700 }}>{eq.stations}/{eq.total}</span>
                      </div>
                      <div style={{ width: "100%", height: 5, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: eqColor, borderRadius: 3 }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

// ======================== REQUESTS & REPORTS MANAGEMENT ========================
const RequestsManagementPage = ({ loggedInUser }) => {
  // Staff see the requests and reports of their municipality only (rules); the Amanah sees all.
  const reqScope = scopeFor(loggedInUser);
  const reqMid = reqScope.all ? null : reqScope.municipalityId || "__none__";
  // All requests & reports loaded directly via onSnapshot (no userId filter needed here)
  const [requests, setRequests] = useState([]);
  const [reports,  setReports]  = useState([]);
  const [loadingReqs, setLoadingReqs] = useState(true);
  const [loadingReps, setLoadingReps] = useState(true);
  const [tab, setTab] = useState("requests");
  const [responding, setResponding] = useState({}); // { [id]: true }
  const [responseText, setResponseText] = useState({}); // { [id]: string }

  useEffect(() => {
    const q = reqMid ? query(collection(db, COLLECTIONS.REQUESTS), where("municipalityId", "==", reqMid)) : query(collection(db, COLLECTIONS.REQUESTS), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingReqs(false);
    }, (e) => { console.error(e); setLoadingReqs(false); });
    return () => unsub();
  }, [reqMid]);

  useEffect(() => {
    const q = reqMid ? query(collection(db, COLLECTIONS.CITIZEN_REPORTS), where("municipalityId", "==", reqMid)) : query(collection(db, COLLECTIONS.CITIZEN_REPORTS), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setReports(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingReps(false);
    }, (e) => { console.error(e); setLoadingReps(false); });
    return () => unsub();
  }, [reqMid]);

  const pendingReqs = requests.filter(r => r.status === "قيد المراجعة").length;
  const pendingReps = reports.filter(r => r.status === "قيد المعالجة").length;

  const handleRequestAction = async (id, status) => {
    const resp = responseText[id]?.trim() || "";
    setResponding(p => ({ ...p, [id]: true }));
    try {
      await updateRequestStatus(id, status, resp);
    } catch (e) { console.error(e); }
    setResponding(p => ({ ...p, [id]: false }));
    setResponseText(p => ({ ...p, [id]: "" }));
  };

  const handleReportAction = async (id, status) => {
    const resp = responseText[id]?.trim() || "";
    setResponding(p => ({ ...p, [id]: true }));
    try {
      await updateCitizenReport(id, { status, response: resp });
    } catch (e) { console.error(e); }
    setResponding(p => ({ ...p, [id]: false }));
    setResponseText(p => ({ ...p, [id]: "" }));
  };

  const statusColor = (s) =>
    s === "مقبول" || s === "تم الحل"   ? C.accent  :
    s === "مرفوض"                       ? C.danger  :
    s === "قيد المراجعة" || s === "قيد المعالجة" ? C.warning : C.muted;

  const inputStyle = { width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 12, fontFamily: ARABIC_FONT, outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        {[
          { label: "إجمالي الطلبات",    val: requests.length,  icon: <FileText size={28} color={C.accent} />, color: C.accent },
          { label: "طلبات معلّقة",      val: pendingReqs,      icon: <Clock size={28} color={C.warning} />, color: C.warning },
          { label: "إجمالي البلاغات",   val: reports.length,   icon: <ClipboardList size={28} color={C.info} />, color: C.info },
          { label: "بلاغات معلّقة",     val: pendingReps,      icon: <AlertTriangle size={28} color={C.danger} />, color: C.danger },
        ].map((s, i) => (
          <div key={i} style={{ background: C.card, border: `1px solid ${s.color}30`, borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ display: "flex", alignItems: "center" }}>{s.icon}</span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8 }}>
        {[
          { key: "requests", label: `📝 طلبات الحاويات${pendingReqs > 0 ? ` (${pendingReqs} معلّق)` : ""}` },
          { key: "reports",  label: `⚠️ البلاغات${pendingReps > 0 ? ` (${pendingReps} معلّق)` : ""}` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "9px 18px", borderRadius: 10, border: `1px solid ${tab === t.key ? C.accent : C.border}`,
            background: tab === t.key ? C.accent + "18" : "transparent",
            color: tab === t.key ? C.accent : C.muted,
            cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: ARABIC_FONT,
          }}>{t.label}</button>
        ))}
      </div>

      {/* Requests */}
      {tab === "requests" && (
        loadingReqs ? <div style={{ color: C.muted, fontSize: 13 }}>جاري التحميل…</div> :
        requests.length === 0 ? <div style={{ background: C.card, borderRadius: 12, padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>لا توجد طلبات.</div> :
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {requests.map(r => {
            const sc = statusColor(r.status);
            const isOpen = r.status === "قيد المراجعة";
            return (
              <div key={r.id} style={{ background: C.card, border: `1px solid ${sc}30`, borderRadius: 14, padding: 18 }}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>📦 {r.binType}</span>
                      <span style={{ fontSize: 10, color: C.dim, background: C.bg, padding: "2px 8px", borderRadius: 6 }}>{r.id.slice(0, 8)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.muted }}>👤 {r.userName} &nbsp;•&nbsp; 📍 {r.district}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>🏠 {r.address}</div>
                    {r.notes && <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>📝 {r.notes}</div>}
                  </div>
                  <span style={{ padding: "4px 12px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: sc + "20", color: sc, whiteSpace: "nowrap" }}>{r.status}</span>
                </div>

                <div style={{ fontSize: 10, color: C.dim, marginBottom: isOpen ? 12 : 0 }}>
                  🕐 {r.createdAt ? new Date(r.createdAt).toLocaleString("ar-SA") : "—"}
                </div>

                {/* Response (already handled) */}
                {!isOpen && r.response && (
                  <div style={{ fontSize: 12, color: C.muted, background: C.bg, padding: "8px 12px", borderRadius: 8, marginTop: 8 }}>
                    💬 الرد: {r.response}
                  </div>
                )}

                {/* Action area (pending only) */}
                {isOpen && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea
                      value={responseText[r.id] || ""}
                      onChange={e => setResponseText(p => ({ ...p, [r.id]: e.target.value }))}
                      placeholder="اكتب رداً للمواطن (اختياري)…"
                      style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        disabled={responding[r.id]}
                        onClick={() => handleRequestAction(r.id, "مقبول")}
                        style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", background: C.accent, color: "#000", fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: ARABIC_FONT }}
                      >
                        {responding[r.id] ? "…" : "✅ قبول"}
                      </button>
                      <button
                        disabled={responding[r.id]}
                        onClick={() => handleRequestAction(r.id, "مرفوض")}
                        style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", background: C.danger, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: ARABIC_FONT }}
                      >
                        {responding[r.id] ? "…" : "❌ رفض"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reports */}
      {tab === "reports" && (
        loadingReps ? <div style={{ color: C.muted, fontSize: 13 }}>جاري التحميل…</div> :
        reports.length === 0 ? <div style={{ background: C.card, borderRadius: 12, padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>لا توجد بلاغات.</div> :
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {reports.map(r => {
            const sc = statusColor(r.status);
            const isOpen = r.status === "قيد المعالجة";
            return (
              <div key={r.id} style={{ background: C.card, border: `1px solid ${sc}30`, borderRadius: 14, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>⚠️ {r.type}</span>
                      <span style={{ fontSize: 10, color: C.dim, background: C.bg, padding: "2px 8px", borderRadius: 6 }}>{r.id.slice(0, 8)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.muted }}>👤 {r.userName} &nbsp;•&nbsp; 📍 {r.location || r.district}</div>
                    {r.description && <div style={{ fontSize: 12, color: C.muted, marginTop: 4, background: C.bg, padding: "6px 10px", borderRadius: 8 }}>{r.description}</div>}
                  </div>
                  <span style={{ padding: "4px 12px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: sc + "20", color: sc, whiteSpace: "nowrap" }}>{r.status}</span>
                </div>

                <div style={{ fontSize: 10, color: C.dim, marginBottom: isOpen ? 12 : 0 }}>
                  🕐 {r.createdAt ? new Date(r.createdAt).toLocaleString("ar-SA") : "—"}
                </div>

                {!isOpen && r.response && (
                  <div style={{ fontSize: 12, color: C.accent, background: C.accent + "10", padding: "8px 12px", borderRadius: 8, marginTop: 8 }}>
                    💬 الرد: {r.response}
                  </div>
                )}

                {isOpen && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea
                      value={responseText[r.id] || ""}
                      onChange={e => setResponseText(p => ({ ...p, [r.id]: e.target.value }))}
                      placeholder="اكتب رداً للمواطن (اختياري)…"
                      style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        disabled={responding[r.id]}
                        onClick={() => handleReportAction(r.id, "تم الحل")}
                        style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", background: C.accent, color: "#000", fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: ARABIC_FONT }}
                      >
                        {responding[r.id] ? "…" : "✅ تم الحل"}
                      </button>
                      <button
                        disabled={responding[r.id]}
                        onClick={() => handleReportAction(r.id, "قيد المعالجة - تحت المتابعة")}
                        style={{ flex: 1, padding: "9px", borderRadius: 8, border: `1px solid ${C.info}`, background: "transparent", color: C.info, fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: ARABIC_FONT }}
                      >
                        {responding[r.id] ? "…" : "🔄 تحت المتابعة"}
                      </button>
                      <button
                        disabled={responding[r.id]}
                        onClick={() => handleReportAction(r.id, "مرفوض")}
                        style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", background: C.danger, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: ARABIC_FONT }}
                      >
                        {responding[r.id] ? "…" : "❌ رفض"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ======================== SETTINGS ========================
// ── بطاقة مفتاح Claude API ──────────────────────────────────────────
const GROQ_MODEL = "llama-3.3-70b-versatile";

const ApiKeyCard = () => {
  const F = ARABIC_FONT;
  const [key, setKey]               = useState(() => localStorage.getItem("groq_api_key") || "");
  const [saved, setSaved]           = useState(false);
  const [visible, setVisible]       = useState(false);
  const [testStatus, setTestStatus] = useState(null);
  const [testMsg, setTestMsg]       = useState("");

  const save = () => {
    localStorage.setItem("groq_api_key", key.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };
  const clear = () => {
    localStorage.removeItem("groq_api_key");
    setKey(""); setTestStatus(null);
  };

  const testConnection = async () => {
    const k = key.trim();
    if (!k) { setTestMsg("أدخل المفتاح أولاً"); setTestStatus("error"); return; }
    setTestStatus("testing"); setTestMsg("");
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${k}` },
        body: JSON.stringify({
          model: GROQ_MODEL,
          max_tokens: 10,
          messages: [{ role: "user", content: "قل: متصل" }],
        }),
      });
      if (res.ok) {
        setTestStatus("ok"); setTestMsg(`✅ الاتصال يعمل — ${GROQ_MODEL}`);
      } else {
        const err = await res.json().catch(() => ({}));
        const msg = err?.error?.message || "";
        if (res.status === 401) { setTestStatus("error"); setTestMsg("مفتاح API غير صحيح ❌"); }
        else if (res.status === 429) { setTestStatus("error"); setTestMsg("تجاوز الحد — انتظر قليلاً"); }
        else { setTestStatus("error"); setTestMsg(`خطأ ${res.status}: ${msg}`); }
      }
    } catch (e) {
      setTestStatus("error"); setTestMsg("خطأ شبكة — تأكد من اتصال الإنترنت");
    }
  };

  const statusColor = testStatus === "ok" ? C.accent : testStatus === "error" ? C.danger : C.info;

  return (
    <Card title="المساعد الذكي — Groq AI (مجاني)" icon={<Bot size={16} color={C.muted} />}>
      <div style={{ padding: "8px 12px", borderRadius: 8, background: C.accent + "15", border: `1px solid ${C.accent}30`, fontSize: 11, color: C.accent, marginBottom: 14, fontFamily: F }}>
        ✅ مجاني تماماً — بدون بطاقة بنكية — يعمل في جميع المناطق
      </div>
      <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.9, marginBottom: 14 }}>
        احصل على مفتاح مجاني من <span style={{ color: "#f55036", fontWeight: 700 }}>console.groq.com</span> ← API Keys ← Create API Key.
        يُحفظ المفتاح في المتصفح فقط.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          type={visible ? "text" : "password"}
          value={key}
          onChange={e => { setKey(e.target.value); setTestStatus(null); }}
          placeholder="gsk_..."
          style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, fontFamily: F, outline: "none" }}
        />
        <button onClick={() => setVisible(v => !v)} style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer", fontSize: 14 }}>
          {visible ? "🙈" : "👁️"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={save} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: saved ? C.accent : "linear-gradient(135deg,#6d28d9,#4c1d95)", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: F }}>
          {saved ? "✅ تم الحفظ" : "💾 حفظ"}
        </button>
        <button onClick={testConnection} disabled={testStatus === "testing"} style={{ padding: "10px 18px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.info, fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: F }}>
          {testStatus === "testing" ? "⏳ جاري الاختبار..." : "🔗 اختبار الاتصال"}
        </button>
        {key && <button onClick={clear} style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.danger, cursor: "pointer", fontSize: 13, fontFamily: F }}>🗑️ حذف</button>}
      </div>
      {testMsg && (
        <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: statusColor + "15", border: `1px solid ${statusColor}40`, fontSize: 12, color: statusColor, fontFamily: F }}>
          {testMsg}
        </div>
      )}
    </Card>
  );
};

const SettingsPage = ({ bins = [], loggedInUser, autoSyncRoutes = true, onToggleAutoSync }) => {
  // System tools are for the municipality manager and the Amanah; an operations employee sees only their preferences (UI scope — server rules unchanged).
  const adminTools = loggedInUser?.role === "manager" || loggedInUser?.role === "executive";
  const [demoBinId, setDemoBinId] = useState("");
  const [munSeedBusy, setMunSeedBusy] = useState(false);
  const [munSeedMsg, setMunSeedMsg] = useState("");

  // ── Live ESP32 simulator: streams one reading every few seconds to a bin so
  // the panel watches fill rise → alert → suggestion → driver notice, live.
  const [simBinId, setSimBinId] = useState("");
  const [simTarget, setSimTarget] = useState(95);
  const [simStep, setSimStep] = useState(4);
  const [simIntervalSec, setSimIntervalSec] = useState(8);
  const [simRunning, setSimRunning] = useState(false);
  const [simLog, setSimLog] = useState([]);
  const simTimer = useRef(null);
  const simState = useRef({ fill: 0, temp: 27 });
  const simBin = bins.find((b) => b.id === simBinId);

  const stopSim = useCallback((reason = "stopped") => {
    if (simTimer.current) { clearInterval(simTimer.current); simTimer.current = null; }
    setSimRunning(false);
    if (reason !== "silent") writeAuditLog("demo_simulation_stopped", loggedInUser?.uid, loggedInUser?.name, { binId: simBinId, reason }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simBinId]);

  const startSim = async () => {
    if (!simBin || simRunning) return;
    simState.current = { fill: Number(simBin.lastFillLevelPercent) || 0, temp: Number(simBin.lastTemperatureCelsius) || 27 };
    setSimLog([]);
    setSimRunning(true);
    await writeAuditLog("demo_simulation_started", loggedInUser?.uid, loggedInUser?.name, { binId: simBin.id, binName: simBin.name, target: simTarget, stepPct: simStep, intervalSec: simIntervalSec });
    const tick = async () => {
      const next = Math.min(simTarget, simState.current.fill + simStep + Math.round(Math.random() * 2 - 1));
      const temp = Math.round((simState.current.temp + (Math.random() * 1.2 - 0.4)) * 10) / 10;
      simState.current = { fill: next, temp };
      try {
        await demoSetReading(simBin.id, next, temp);
        setSimLog((l) => [{ t: new Date().toLocaleTimeString("ar-SA"), fill: next, temp }, ...l].slice(0, 8));
      } catch (e) { console.error("[esp32-sim]", e); }
      if (next >= simTarget) stopSim("target_reached");
    };
    tick();
    simTimer.current = setInterval(tick, simIntervalSec * 1000);
  };
  useEffect(() => () => { if (simTimer.current) clearInterval(simTimer.current); }, []);

  // ── IoT device registry (keys shown once, only hashes stored) ──
  const iotScope = scopeFor(loggedInUser);
  const { devices: iotDevices } = useIotDevices(iotScope.all ? null : iotScope.municipalityId || "__none__", loggedInUser?.role === "executive" || loggedInUser?.role === "manager");
  const [revealedKey, setRevealedKey] = useState(null); // { deviceId, key }
  const [deviceBusy, setDeviceBusy] = useState("");
  const [demoFill, setDemoFill] = useState(50);
  const [demoTemp, setDemoTemp] = useState(27);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoMsg, setDemoMsg] = useState("");
  const demoSelectedBin = bins.find((b) => b.id === demoBinId);

  const runDemoAction = async (fn) => {
    if (!demoBinId) { setDemoMsg("اختر حاوية أولًا."); return; }
    setDemoBusy(true);
    setDemoMsg("");
    try {
      await fn();
      setDemoMsg("✅ تم تطبيق الإجراء — راقب التغيير في لوحة التحكم/الخريطة.");
    } catch (e) {
      console.error("[demo-action]", e);
      setDemoMsg("❌ حدث خطأ أثناء التنفيذ.");
    } finally {
      setDemoBusy(false);
    }
  };

  const [notif, setNotif] = useState(true);
  const [autoCollect, setAutoCollect] = useState(true);
  const [threshold, setThreshold] = useState(85);
  const [seedStatus, setSeedStatus] = useState(null);    // null | "running" | "done" | "error"
  const [exportStatus, setExportStatus] = useState(null); // null | "running" | "done" | "error"
  const [migrateStatus, setMigrateStatus] = useState(null); // null | "running" | "done" | "error"
  const [migrateResult, setMigrateResult] = useState(null);
  const [demoSeedStatus, setDemoSeedStatus] = useState(null); // null | "running" | "done" | "error"
  const [demoSeedResult, setDemoSeedResult] = useState(null);

  const Toggle = ({ value, onChange }) => (
    <div onClick={() => onChange(!value)} style={{ width: 48, height: 26, borderRadius: 13, background: value ? C.accent : C.border, cursor: "pointer", position: "relative", transition: "background 0.3s" }}>
      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, transition: "all 0.3s", ...(value ? { left: 25 } : { left: 3 }) }} />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <PageHeader status={adminTools ? "تفضيلاتك أولًا، ثم إعدادات الإسناد، ثم أدوات النظام عند الحاجة" : "تفضيلات حسابك وحالة الاتصال"} />
      <Section title="تفضيلاتي" collapsible defaultOpen>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card title="إعدادات النظام" icon={<SettingsIcon size={16} color={C.muted} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {[{ label: "التنبيهات الفورية", desc: "استقبال إشعارات عند تجاوز الحدود", val: notif, set: setNotif },
            { label: "التفريغ التلقائي", desc: "تشغيل الجمع تلقائياً عند الامتلاء", val: autoCollect, set: setAutoCollect }].map((item, i) => (
            <div key={i}>
              {i > 0 && <div style={{ borderTop: `1px solid ${C.border}`, marginBottom: 18 }} />}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: C.dim }}>{item.desc}</div>
                </div>
                <Toggle value={item.val} onChange={item.set} />
              </div>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${C.border}` }} />
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>حد التنبيه</span>
              <span style={{ fontSize: 14, color: C.accent, fontWeight: 700 }}>{threshold}%</span>
            </div>
            <input type="range" min={50} max={95} value={threshold} onChange={(e) => setThreshold(+e.target.value)} style={{ width: "100%", accentColor: C.accent }} />
          </div>
        </div>
      </Card>
      <Card title="حالة الاتصال" icon={<Plug size={16} color={C.muted} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[{ name: "خادم البيانات الرئيسي", ok: true }, { name: "شبكة المستشعرات - بريدة", ok: true }, { name: "نظام التنبيهات", ok: true }, { name: "خدمة الخرائط", ok: false }].map((item, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: C.bg, borderRadius: 10 }}>
              <span style={{ fontSize: 13, color: C.text }}>{item.name}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: item.ok ? C.accent : C.danger, display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: item.ok ? C.accent : C.danger, display: "inline-block" }} />
                {item.ok ? "متصل" : "غير متصل"}
              </span>
            </div>
          ))}
        </div>
      </Card>
        </div>
      </Section>
      {adminTools && <DispatchSettingsCard loggedInUser={loggedInUser} />}
      {adminTools && (
        <Section title="مزامنة الاقتراحات من المتصفح (النمط القديم)" collapsible defaultOpen={false} hint="تعمل فقط حين يكون الإسناد التلقائي متوقفًا">
      <Card title="🔄 مزامنة الجولات المقترحة تلقائيًا" icon={<RouteIcon size={16} color={C.muted} />}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
            عند التفعيل يعيد النظام حساب الجولات <b style={{ color: C.text }}>المقترحة</b> تلقائيًا كلما تغيرت حالة الحاويات (حاوية امتلأت → تُضاف للجولة، فُرّغت → تُسحب).
            لا يعتمد ولا يرسل أي مركبة تلقائيًا — الاعتماد يبقى قرارًا بشريًا.
          </div>
          <Toggle value={autoSyncRoutes} onChange={(v) => onToggleAutoSync && onToggleAutoSync(v)} />
        </div>
      </Card>
        </Section>
      )}
      {adminTools && (
        <Section title="البلديات والبيانات والتكامل" collapsible defaultOpen={false} hint="تهيئة وترحيل ومصادر البيانات وأجهزة IoT والتصدير">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {can(loggedInUser?.role, "municipalities.manage") && (
        <Card title="🏛️ البلديات الفرعية وتبعية الأحياء" icon={<Landmark size={16} color={C.muted} />}>
          <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.8, margin: "0 0 10px" }}>
            يكتب البلديات الست (الأسماء والهواتف والمساحات من المصادر الرسمية) ويسند كل حي بلا تبعية إلى بلديته وفق القراءة البصرية لخرائط النطاق الرسمية (موسومة «غير متحقق منها»)، ثم ينسخ معرّف البلدية على الحاويات والجولات والمركبات والسائقين والبلاغات لتفعيل عزل البيانات. لا يستبدل أي تبعية حُددت يدويًا.
          </p>
          <button disabled={munSeedBusy} onClick={async () => { setMunSeedBusy(true); try { const r = await seedMunicipalitiesAndBackfill({ municipalities: MUNICIPALITIES, defaultAssignmentFor, municipalityForNeighborhood, provenance: DATA_PROVENANCE }, { uid: loggedInUser?.uid, name: loggedInUser?.name }); setMunSeedMsg(`✅ ${r.municipalities} بلديات · ${r.neighborhoodsAssigned} حي أُسند · ${r.bins} حاوية · ${r.routes} جولة · ${r.vehicles} مركبة · ${r.profiles} سائق · ${r.incidents} بلاغ${r.unassignedNeighborhoods.length ? ` · بلا تبعية: ${r.unassignedNeighborhoods.join("، ")}` : ""}`); } catch (e) { setMunSeedMsg("تعذر تنفيذ العملية: " + friendlyError(e)); } finally { setMunSeedBusy(false); } }} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #06b6d4, #0e7490)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: ARABIC_FONT }}>{munSeedBusy ? "جاري التهيئة…" : "🏛️ تهيئة البلديات وتوزيع الأحياء"}</button>
          {munSeedMsg && <div style={{ fontSize: 12, color: C.text, marginTop: 8 }}>{munSeedMsg}</div>}
        </Card>
      )}
      <Card title="📚 مصادر البيانات وحالة كل مصدر" icon={<FileText size={16} color={C.muted} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          {[
            ["البلديات الفرعية (الأسماء، الهواتف، خرائط النطاق)", "أمانة منطقة القصيم — صفحة البلديات الفرعية", "رسمي", C.accent, DATA_PROVENANCE.sources[0].url],
            ["مساحات البلديات وإحصاءات النظافة 2024", "التقرير السنوي لأمانة منطقة القصيم 2024", "رسمي", C.accent, DATA_PROVENANCE.sources[2].url],
            ["أسماء أحياء بريدة (130 حيًا)", OFFICIAL_NAMES_SOURCE.source, "رسمي", C.accent, OFFICIAL_NAMES_SOURCE.url],
            ["حدود الأحياء (13 مضلعًا)", "OpenStreetMap", "مفتوح", C.info, "https://www.openstreetmap.org/"],
            ["حدود البلديات", "خرائط PDF مصوّرة فقط (UTM 38N) — لا ملفات متجهة؛ النطاقات المرسومة تشغيلية تجريبية", "غير متحقق", C.warning, null],
            ["تبعية الأحياء للبلديات", NEIGHBORHOOD_ASSIGNMENT_PROVENANCE.method, "غير متحقق", C.warning, null],
            ["بيانات الحاويات والقراءات", "مولّد/محاكي تجريبي — كل قراءة موسومة SIMULATED ومنفصلة عن sensor_readings", "تجريبي", C.purple, null],
          ].map(([what, src, status, color, url]) => (
            <div key={what} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", background: C.bg, borderRadius: 8, padding: "8px 12px", flexWrap: "wrap" }}>
              <div><b style={{ color: C.text }}>{what}</b><div style={{ color: C.muted, fontSize: 11 }}>{url ? <a href={url} target="_blank" rel="noreferrer" style={{ color: C.info }}>{src}</a> : src}</div></div>
              <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, background: color + "20", color }}>{status}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="🔐 أجهزة IoT ومفاتيح الدخول" icon={<KeyRound size={16} color={C.muted} />}>
        <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.8, margin: "0 0 12px" }}>
          كل جهاز ESP32 يحتاج مفتاحًا خاصًا به يُرسل في ترويسة <code>x-device-key</code> إلى <code>/api/iot/readings</code>.
          المفتاح يُعرض مرة واحدة فقط هنا ويُخزَّن تجزئته (SHA-256) فقط؛ الجهاز لا يستطيع الكتابة إلا لحاويته. المفتاح التجريبي للمولّد مرفوض من الخادم.
        </p>
        {revealedKey && (
          <div style={{ background: C.warning + "15", border: `1px solid ${C.warning}60`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.warning, marginBottom: 6 }}>⚠️ انسخ المفتاح الآن — لن يُعرض مرة أخرى ({revealedKey.deviceId})</div>
            <code style={{ display: "block", fontSize: 11, color: C.text, background: C.bg, padding: 8, borderRadius: 8, wordBreak: "break-all", direction: "ltr", textAlign: "left" }}>{revealedKey.key}</code>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => navigator.clipboard?.writeText(revealedKey.key)} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: C.accent, color: "#07231A", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: ARABIC_FONT }}>نسخ</button>
              <button onClick={() => setRevealedKey(null)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 11, cursor: "pointer", fontFamily: ARABIC_FONT }}>تم الحفظ — إخفاء</button>
            </div>
          </div>
        )}
        {(iotDevices || []).length === 0 ? <EmptyState icon="📟" title="لا توجد أجهزة مسجّلة بعد" /> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {(iotDevices || []).map((d) => {
              const bin = bins.find((b) => b.id === d.binId);
              return (
                <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 12px", background: C.bg, borderRadius: 8, fontSize: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ color: C.text, fontWeight: 600 }}>{d.deviceId || d.label} {d.demo && <DemoBadge />} {d.disabled && <span style={{ color: C.danger, fontSize: 10 }}>(معطّل)</span>}</div>
                    <div style={{ color: C.dim, fontSize: 11 }}>{bin?.name || "غير مرتبط بحاوية"} · {d.deviceKeyHash ? "🔑 مفتاح فعّال" : "⚠️ بلا مفتاح فعّال (مفتاح تجريبي فقط)"} · آخر اتصال: {getReadingAgeLabel(d.lastSeenAt)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button disabled={deviceBusy === d.id} onClick={async () => {
                      if (!window.confirm(`توليد مفتاح جديد لـ ${d.deviceId || d.label}؟ المفتاح القديم سيتوقف فورًا.`)) return;
                      setDeviceBusy(d.id);
                      try {
                        const key = await rotateDeviceKey(d.id);
                        setRevealedKey({ deviceId: d.deviceId || d.label, key });
                        await writeAuditLog("device_key_rotated", loggedInUser?.uid, loggedInUser?.name, { deviceDocId: d.id, deviceId: d.deviceId || d.label });
                      } finally { setDeviceBusy(""); }
                    }} style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: C.info, color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: ARABIC_FONT }}>توليد مفتاح</button>
                    <button onClick={async () => {
                      await setDeviceDisabled(d.id, !d.disabled);
                      await writeAuditLog(d.disabled ? "device_enabled" : "device_disabled", loggedInUser?.uid, loggedInUser?.name, { deviceDocId: d.id, deviceId: d.deviceId || d.label });
                    }} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${d.disabled ? C.accent : C.danger}`, background: "transparent", color: d.disabled ? C.accent : C.danger, fontSize: 11, cursor: "pointer", fontFamily: ARABIC_FONT }}>{d.disabled ? "تفعيل" : "تعطيل"}</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ fontSize: 11, color: C.dim, marginTop: 10, lineHeight: 1.7 }}>
          ما يلزم لتشغيل الربط الحقيقي: ضبط <code>FIREBASE_SERVICE_ACCOUNT_JSON</code> و<code>IOT_INGEST_ENABLED=true</code> في بيئة Vercel، نشر <code>firestore.rules</code>، ثم تحميل <code>firmware/esp32_smart_bin</code> على الجهاز بمفتاحه.
        </div>
      </Card>

      <ApiKeyCard />

      <Card title="تصدير قاعدة البيانات" icon={<BarChart2 size={16} color={C.muted} />}>
        <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.8, margin: "0 0 16px" }}>
          يُصدِّر جميع البيانات من Firestore (10 مجموعات) إلى ملف Excel واحد.
          كل مجموعة في Sheet منفصل — جاهز للتحليل في Power BI أو Excel.
        </p>
        {exportStatus === "done" && (
          <div style={{ background: C.accent + "15", border: `1px solid ${C.accent}40`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: C.accent }}>
            ✅ تم تحميل الملف بنجاح — تحقق من مجلد التنزيلات.
          </div>
        )}
        {exportStatus === "error" && (
          <div style={{ background: C.danger + "15", border: `1px solid ${C.danger}40`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: C.danger }}>
            ❌ حدث خطأ أثناء التصدير — تحقق من Console.
          </div>
        )}
        <button
          disabled={exportStatus === "running"}
          onClick={async () => {
            setExportStatus("running");
            try {
              await exportAllDataToExcel("full_database.xlsx");
              setExportStatus("done");
            } catch (e) {
              console.error("[export]", e);
              setExportStatus("error");
            }
          }}
          style={{
            padding: "11px 24px", borderRadius: 10, border: "none",
            background: exportStatus === "running" ? C.border : "linear-gradient(135deg, #10b981, #059669)",
            color: exportStatus === "running" ? C.dim : "#fff",
            fontWeight: 700, cursor: exportStatus === "running" ? "not-allowed" : "pointer",
            fontSize: 13, fontFamily: ARABIC_FONT,
          }}
        >
          {exportStatus === "running" ? "جاري التصدير…" : "⬇️ تحميل قاعدة البيانات Excel"}
        </button>
      </Card>
      <Card title="تهيئة قاعدة البيانات" icon={<Database size={16} color={C.muted} />}>
        <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.8, margin: "0 0 16px" }}>
          يُنشئ هذا الإجراء مستندًا تجريبيًا لكل مجموعة غير موجودة في Firestore
          (districts, sensors, alerts, fire_alerts, requests, citizen_reports).
          المجموعات الموجودة مسبقًا لن تُمس.
        </p>
        {seedStatus === "done" && (
          <div style={{ background: C.accent + "15", border: `1px solid ${C.accent}40`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: C.accent }}>
            ✅ تم إنشاء جميع المجموعات بنجاح — تحقق من Firebase Console.
          </div>
        )}
        {seedStatus === "error" && (
          <div style={{ background: C.danger + "15", border: `1px solid ${C.danger}40`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: C.danger }}>
            ❌ حدث خطأ أثناء التهيئة — تحقق من Console.
          </div>
        )}
        <button
          disabled={seedStatus === "running"}
          onClick={async () => {
            setSeedStatus("running");
            try {
              await seedAllCollections();
              setSeedStatus("done");
            } catch (e) {
              console.error("[seed]", e);
              setSeedStatus("error");
            }
          }}
          style={{
            padding: "11px 24px", borderRadius: 10, border: "none",
            background: seedStatus === "running" ? C.border : C.g1,
            color: seedStatus === "running" ? C.dim : "#fff",
            fontWeight: 700, cursor: seedStatus === "running" ? "not-allowed" : "pointer",
            fontSize: 13, fontFamily: ARABIC_FONT,
          }}
        >
          {seedStatus === "running" ? "جاري التهيئة…" : "🚀 تهيئة Collections الناقصة"}
        </button>
      </Card>

      <Card title="ترحيل البيانات إلى نموذج الحاويات الذكية" icon={<Database size={16} color={C.muted} />}>
        <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.8, margin: "0 0 16px" }}>
          ينشئ هذا الإجراء مستندات "neighborhoods" و"bins" من بيانات "stations" والحاويات
          المضمّنة بداخلها الموجودة حاليًا. إجراء إضافي بالكامل — لا يحذف ولا يعدّل
          أي بيانات موجودة في stations، ويمكن تشغيله أكثر من مرة بأمان.
        </p>
        {migrateStatus === "done" && (
          <div style={{ background: C.accent + "15", border: `1px solid ${C.accent}40`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: C.accent }}>
            ✅ تم الترحيل — {migrateResult?.neighborhoodsCreated ?? 0} حي جديد، {migrateResult?.binsCreated ?? 0} حاوية جديدة،
            {" "}{migrateResult?.binsSkipped ?? 0} حاوية تم تجاوزها (مرحّلة مسبقًا)، من أصل {migrateResult?.stationsRead ?? 0} محطة. تحقق من Firebase Console.
          </div>
        )}
        {migrateStatus === "error" && (
          <div style={{ background: C.danger + "15", border: `1px solid ${C.danger}40`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: C.danger }}>
            ❌ حدث خطأ أثناء الترحيل — تحقق من Console.
          </div>
        )}
        <button
          disabled={migrateStatus === "running"}
          onClick={async () => {
            const confirmed = window.confirm(
              "سيتم إنشاء مستندات neighborhoods وbins جديدة من بيانات stations الحالية. " +
              "لن يُحذف أو يُعدَّل أي شيء في stations، والتشغيل أكثر من مرة آمن (لن يكرر ما تم ترحيله). متابعة؟"
            );
            if (!confirmed) return;
            setMigrateStatus("running");
            try {
              const result = await migrateStationsToBinsAndNeighborhoods();
              setMigrateResult(result);
              setMigrateStatus("done");
            } catch (e) {
              console.error("[migrate]", e);
              setMigrateStatus("error");
            }
          }}
          style={{
            padding: "11px 24px", borderRadius: 10, border: "none",
            background: migrateStatus === "running" ? C.border : C.g2,
            color: migrateStatus === "running" ? C.dim : "#fff",
            fontWeight: 700, cursor: migrateStatus === "running" ? "not-allowed" : "pointer",
            fontSize: 13, fontFamily: ARABIC_FONT,
          }}
        >
          {migrateStatus === "running" ? "جاري الترحيل…" : "🔄 ترحيل المحطات إلى أحياء وحاويات ذكية"}
        </button>
      </Card>
          </div>
        </Section>
      )}
      {adminTools && (
        <Section title="بيئة العرض التجريبية" collapsible defaultOpen={false} hint="بيانات محاكاة فقط — لا تُستخدم في بيئة الإنتاج">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card title="بيانات تجريبية للعرض — محاكاة مدينة كاملة (Demo)" icon={<Sparkles size={16} color={C.muted} />}>
        <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.8, margin: "0 0 16px" }}>
          يبني مشهد مدينة كاملًا: ~100 حاوية ذكية موزّعة داخل الحدود الحقيقية لأحياء بريدة الـ14
          (3 أحياء حرجة بتجمّعات حاويات شبه ممتلئة، أحياء بأولوية مرتفعة، تنبيهات حرارية، حي بأغلبية
          مستشعرات غير متصلة، قراءات تاريخية تصاعدية للتنبؤ، مستشعر معطّل، حاويات بدون مستشعر)
          + 4 مركبات بموقع مستودع + جولات مقترحة مرتبطة مباشرة بالحاويات الممتلئة.
          يحذف البيانات التجريبية السابقة أولًا ويدمج الأحياء المكرّرة (السبب السابق في اختفاء ألوان الخريطة).
          كل العناصر تحمل الوسم demo:true ولا تُخلط بالبيانات الحقيقية أو الجولات المعتمدة بشريًا.
        </p>
        {demoSeedStatus === "done" && (
          <div style={{ background: C.accent + "15", border: `1px solid ${C.accent}40`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: C.accent }}>
            ✅ تم بناء المشهد — {demoSeedResult?.binsCreated ?? 0} حاوية، {demoSeedResult?.readingsCreated ?? 0} قراءة تاريخية، {demoSeedResult?.vehiclesCreated ?? 0} مركبات،
            {" "}{demoSeedResult?.routesCreated ?? 0} جولة مقترحة مرتبطة بالحاويات الممتلئة، دُمج {demoSeedResult?.neighborhoodsMerged ?? 0} حي مكرّر، وأُنشئ {demoSeedResult?.neighborhoodsCreated ?? 0} حي ناقص.
          </div>
        )}
        {demoSeedStatus === "error" && (
          <div style={{ background: C.danger + "15", border: `1px solid ${C.danger}40`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: C.danger }}>
            ❌ حدث خطأ أثناء الإنشاء — تحقق من Console.
          </div>
        )}
        <button
          disabled={demoSeedStatus === "running"}
          onClick={async () => {
            const ok = window.confirm("سيتم حذف البيانات التجريبية السابقة (الحاويات/القراءات/المركبات/الجولات المقترحة الموسومة demo) وإعادة بناء مشهد المدينة كاملًا. البيانات الحقيقية والجولات المعتمدة بشريًا لن تُمس. متابعة؟");
            if (!ok) return;
            setDemoSeedStatus("running");
            try {
              const result = await seedCityDemoData();
              setDemoSeedResult(result);
              setDemoSeedStatus("done");
            } catch (e) {
              console.error("[demo-seed]", e);
              setDemoSeedStatus("error");
            }
          }}
          style={{
            padding: "11px 24px", borderRadius: 10, border: "none",
            background: demoSeedStatus === "running" ? C.border : "linear-gradient(135deg, #8b5cf6, #6d28d9)",
            color: demoSeedStatus === "running" ? C.dim : "#fff",
            fontWeight: 700, cursor: demoSeedStatus === "running" ? "not-allowed" : "pointer",
            fontSize: 13, fontFamily: ARABIC_FONT,
          }}
        >
          {demoSeedStatus === "running" ? "جاري بناء مشهد المدينة…" : "✨ بناء / إعادة ضبط مشهد المدينة التجريبي"}
        </button>
      </Card>

      <Card title="🎮 وضع العرض التجريبي" icon={<Sparkles size={16} color={C.muted} />}>
        <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.8, margin: "0 0 14px" }}>
          تحكّم مباشر بحالة أي حاوية لأغراض العرض أمام اللجنة — التغيير ينعكس فورًا على الأولوية،
          التنبيهات، الخريطة، والجولات المقترحة. كل قراءة تجريبية تُوسم demo:true ولا تُخلط بقراءات حقيقية.
        </p>
        <select value={demoBinId} onChange={(e) => setDemoBinId(e.target.value)} style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, fontFamily: ARABIC_FONT, marginBottom: 12 }}>
          <option value="">اختر حاوية…</option>
          {bins.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        {demoSelectedBin && (
          <>
            <div style={{ fontSize: 11, color: C.dim, marginBottom: 10 }}>
              الحالة الحالية: {demoSelectedBin.lastFillLevelPercent ?? "—"}% · {demoSelectedBin.lastTemperatureCelsius ?? "—"}° · {getReadingAgeLabel(demoSelectedBin.lastReadingAt)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 4 }}>نسبة الامتلاء: {demoFill}%</label>
                <input type="range" min={0} max={100} value={demoFill} onChange={(e) => setDemoFill(+e.target.value)} style={{ width: "100%", accentColor: C.accent }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 4 }}>الحرارة: {demoTemp}°</label>
                <input type="range" min={15} max={90} value={demoTemp} onChange={(e) => setDemoTemp(+e.target.value)} style={{ width: "100%", accentColor: C.warning }} />
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button disabled={demoBusy} onClick={() => runDemoAction(() => demoSetReading(demoBinId, demoFill, demoTemp))} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: C.accent, color: "#07231A", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>📡 محاكاة قراءة جديدة</button>
              <button disabled={demoBusy} onClick={() => runDemoAction(() => demoSetOffline(demoBinId))} style={{ padding: "9px 16px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>📴 فصل المستشعر</button>
              <button disabled={demoBusy} onClick={() => runDemoAction(() => demoSetFault(demoBinId))} style={{ padding: "9px 16px", borderRadius: 10, border: `1px solid ${C.danger}`, background: C.danger + "15", color: C.danger, fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>⚠️ محاكاة خلل بالمستشعر</button>
              <button disabled={demoBusy} onClick={() => runDemoAction(() => demoReset(demoBinId))} style={{ padding: "9px 16px", borderRadius: 10, border: `1px solid ${C.info}`, background: C.info + "15", color: C.info, fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>🔄 إعادة ضبط</button>
            </div>
            {demoMsg && <div style={{ marginTop: 10, fontSize: 12, color: demoMsg.startsWith("✅") ? C.accent : demoMsg.startsWith("❌") ? C.danger : C.warning }}>{demoMsg}</div>}
          </>
        )}
      </Card>

      <Card title="📡 محاكي ESP32 حي — للعرض أمام اللجنة" icon={<Radio size={16} color={C.muted} />}>
        <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.8, margin: "0 0 12px" }}>
          يبث قراءة جديدة كل بضع ثوانٍ لحاوية واحدة فترتفع نسبة امتلائها تدريجيًا على الشاشة أمام اللجنة: شاهد اللون
          يتغير على الخريطة، التنبيه يظهر، الجولة المقترحة تتحدث تلقائيًا، والسائق يُنبَّه — كلها لحظيًا. كل قراءة تُوسم demo:true.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <select value={simBinId} disabled={simRunning} onChange={(e) => setSimBinId(e.target.value)} style={{ gridColumn: "1 / -1", padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, fontFamily: ARABIC_FONT }}>
            <option value="">اختر الحاوية التي ستُملأ أمام اللجنة…</option>
            {bins.filter((b) => b.deviceId).map((b) => <option key={b.id} value={b.id}>{b.name} — الآن {b.lastFillLevelPercent ?? "—"}%</option>)}
          </select>
          <label style={{ fontSize: 11, color: C.muted }}>الهدف: {simTarget}%<input type="range" min={60} max={100} value={simTarget} disabled={simRunning} onChange={(e) => setSimTarget(+e.target.value)} style={{ width: "100%", accentColor: C.danger }} /></label>
          <label style={{ fontSize: 11, color: C.muted }}>الزيادة لكل قراءة: {simStep}%<input type="range" min={1} max={10} value={simStep} disabled={simRunning} onChange={(e) => setSimStep(+e.target.value)} style={{ width: "100%", accentColor: C.accent }} /></label>
          <label style={{ fontSize: 11, color: C.muted, gridColumn: "1 / -1" }}>الفاصل بين القراءات: {simIntervalSec} ثانية<input type="range" min={3} max={30} value={simIntervalSec} disabled={simRunning} onChange={(e) => setSimIntervalSec(+e.target.value)} style={{ width: "100%", accentColor: C.info }} /></label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {!simRunning ? (
            <button disabled={!simBin} onClick={startSim} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: simBin ? "linear-gradient(135deg, #ef4444, #b91c1c)" : C.border, color: simBin ? "#fff" : C.dim, fontWeight: 700, fontSize: 13, cursor: simBin ? "pointer" : "not-allowed", fontFamily: ARABIC_FONT }}>▶️ ابدأ البث الحي</button>
          ) : (
            <button onClick={() => stopSim("manual")} style={{ padding: "10px 18px", borderRadius: 10, border: `1px solid ${C.danger}`, background: C.danger + "15", color: C.danger, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: ARABIC_FONT }}>⏹ إيقاف</button>
          )}
          {simRunning && <span style={{ fontSize: 12, color: C.accent }}>● يبث الآن — {simBin?.name}: {simState.current.fill}%</span>}
          {simBin && !simRunning && <button onClick={() => demoReset(simBin.id)} style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>🔄 إعادة الحاوية إلى 20%</button>}
        </div>
        {simLog.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 11, color: C.muted, fontFamily: "monospace", background: C.bg, borderRadius: 8, padding: 8, maxHeight: 120, overflowY: "auto" }}>
            {simLog.map((l, i) => <div key={i}>{l.t} — fill {l.fill}% · temp {l.temp}°</div>)}
          </div>
        )}
      </Card>
          </div>
        </Section>
      )}
    </div>
  );
};

// ======================== ROUTE MANAGEMENT (replaces old SUCTION CONTROL page) ========================
// Real engine wiring: suggestions come from decisionEngine.recommendRoutes(),
// persisted as status:"suggested" only — every later transition (approved/
// in_progress/completed/rejected/deferred) requires an explicit button click
// from a logged-in employee, never a side effect of a snapshot/listener.
const ROUTE_TABS = [
  { key: "suggested", label: "المقترحة" },
  { key: "approved",  label: "المعتمدة" },
  { key: "active",    label: "النشطة" },
  { key: "history",   label: "السجل" },
];

/** Small embedded map for one route's ordered stops — numbered markers + a polyline, clearly labeled as approximate. */
const RouteMap = ({ stops, bins, neighborhoods }) => {
  const points = stops
    .map((s) => {
      const bin = bins.find((b) => b.id === s.binId);
      if (!bin) return null;
      const n = neighborhoods.find((n2) => n2.id === bin.neighborhoodId);
      const pos = demoPositionForBin(bin, neighborhoodFeatureFor(n));
      return pos ? { ...s, pos: pos.pos, demo: pos.demo } : null;
    })
    .filter(Boolean);

  const { route: road, status: roadStatus } = useRoadRoute(points.map((p) => ({ lat: p.pos[0], lng: p.pos[1] })));
  if (points.length === 0) return <EmptyState icon="🗺️" title="لا توجد مواقع كافية لعرض المسار" />;
  const center = points[0].pos;

  return (
    <div>
      <div style={{ height: 260, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}` }}>
        <MapContainer center={center} zoom={13} style={{ width: "100%", height: "100%" }} scrollWheelZoom={false}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
          {road ? (
            <Polyline positions={road.coordinates} pathOptions={{ color: C.info, weight: 4, opacity: 0.9 }} />
          ) : (
            <Polyline positions={points.map((p) => p.pos)} pathOptions={{ color: C.info, weight: 3, dashArray: "6 6" }} />
          )}
          {points.map((p) => (
            <CircleMarker key={p.binId} center={p.pos} radius={11} pathOptions={{ color: "#fff", weight: 2, fillColor: STATUS_COLORS[p.priorityTier] || C.info, fillOpacity: 1 }}>
              <Popup><div style={{ fontFamily: ARABIC_FONT, direction: "rtl", fontSize: 12 }}><b>#{p.order} — {p.binName}</b></div></Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      <RoadRouteNote road={road} status={roadStatus} />
    </div>
  );
};

/** One-line provenance for a drawn path: real streets (OSRM) with distance/time, or the straight-line fallback. */
const RoadRouteNote = ({ road, status }) => (
  <div style={{ fontSize: 10.5, color: road ? C.accent : C.dim, marginTop: 6 }}>
    {road
      ? `🛣️ مسار طرق فعلي (OpenStreetMap/OSRM): ${road.distanceKm} كم · ~${road.durationMin} دقيقة قيادة`
      : status === "loading" ? "⏳ جاري حساب مسار الطرق الفعلي…" : "⚠️ خدمة التوجيه غير متاحة الآن — المسار المعروض خط مستقيم بين التوقفات (تقريبي)."}
  </div>
);

const RouteDetailModal = ({ route, bins, neighborhoods, vehicles, routes = [], driverProfiles = [], loggedInUser, onClose, onChanged, onShowOnMap }) => {
  const [vehicleId, setVehicleId] = useState(route.vehicleId || "");
  const [driverId, setDriverId] = useState(route.driverId || "");
  const [exceptionReason, setExceptionReason] = useState("");
  const routeNeighborhoodName = neighborhoods.find((n) => (route.neighborhoodIds || []).includes(n.id))?.name || "";
  // ── Phase 2: ranked recommendation. Real road legs (OSRM) from every eligible
  // driver's origin (live location if fresh, else vehicle depot — labelled) to the
  // first stop, plus the route's own road figures; Haversine fallback is labelled.
  const stopPositions = useMemo(() => routeStopPositions(route, bins, neighborhoods), [route, bins, neighborhoods]);
  const routeForEngine = useMemo(() => ({ ...route, orderedStops: stopPositions.map((p) => ({ ...p, lat: p.pos[0], lng: p.pos[1] })) }), [route, stopPositions]);
  const { route: routeRoad } = useRoadRoute(stopPositions.map((p) => ({ lat: p.pos[0], lng: p.pos[1] })));
  const legPairs = useMemo(() => {
    const firstStop = stopPositions[0] ? { lat: stopPositions[0].pos[0], lng: stopPositions[0].pos[1] } : null;
    return driverProfiles.map((p) => ({ key: p.uid, from: driverOrigin(p, vehicles.find((v) => v.id === p.vehicleId), { fallback: DEFAULT_DEPOT }), to: firstStop }));
  }, [driverProfiles, vehicles, stopPositions]);
  const { byKey: travelByDriver, status: legsStatus } = useRoadLegs(legPairs);
  const ranking = useMemo(() => rankDriverCandidates(routeForEngine, { profiles: driverProfiles, vehicles, routes, neighborhoodName: routeNeighborhoodName, travelByDriver, routeRoad: routeRoad ? { distanceKm: routeRoad.distanceKm, durationMin: routeRoad.durationMin } : null, defaultOrigin: DEFAULT_DEPOT }),
    [routeForEngine, driverProfiles, vehicles, routes, routeNeighborhoodName, travelByDriver, routeRoad]);
  const driverOptions = ranking.candidates.map((c) => ({ profile: c.profile, vehicle: c.vehicle, eligible: c.verdict.eligible && c.capacityOk !== false, reasons: c.verdict.eligible ? c.flags : c.verdict.reasons, cand: c }));
  const effectiveDriverId = driverId || ranking.recommended?.driverId || "";
  const chosen = driverOptions.find((d) => d.profile.uid === effectiveDriverId) || null;
  const routeConflicts = chosen ? findRouteAssignmentConflicts({ routeId: route.id, driverId: effectiveDriverId, vehicleId: chosen.profile.vehicleId }, routes) : [];
  useEffect(() => { if (chosen?.profile.vehicleId) setVehicleId(chosen.profile.vehicleId); }, [chosen]);
  const [busy, setBusy] = useState(false);
  const [addBinId, setAddBinId] = useState("");

  // ── Phase 3: route optimization (capacity + priority-aware local search over an OSRM time matrix).
  const [opt, setOpt] = useState(null);           // { result, before, origin, dumpSite }
  const [optBusy, setOptBusy] = useState(false);
  const runOptimizer = async () => {
    setOptBusy(true);
    try {
      // Vehicle for capacity: the chosen driver's, else the route's, else the best candidate's (so the real shortfall is shown, not "unknown").
      const vehicleForOpt = chosen?.vehicle || vehicles.find((v) => v.id === (route.vehicleId || vehicleId)) || driverOptions[0]?.vehicle || null;
      const origin = chosen?.cand?.origin || (vehicleForOpt?.depotLat != null ? { lat: vehicleForOpt.depotLat, lng: vehicleForOpt.depotLng, label: vehicleForOpt.depotLabel || "مستودع المركبة", source: "depot" } : { ...DEFAULT_DEPOT, source: "default" });
      const dumpSite = vehicleForOpt?.dumpLat != null ? { lat: vehicleForOpt.dumpLat, lng: vehicleForOpt.dumpLng, label: vehicleForOpt.dumpLabel || "نقطة التفريغ" } : null;
      const stops = stopPositions.map((p) => {
        const fill = Number(p.bin.lastFillLevelPercent) || 0;
        return { binId: p.binId, binName: p.binName, lat: p.pos[0], lng: p.pos[1], approximate: !!p.approximate, priorityTier: p.priorityTier, priorityScore: p.priorityScore, fillLevelPercent: p.bin.lastFillLevelPercent ?? null, wasteLiters: Math.round((Number(p.bin.capacityLiters) || 1100) * fill / 100) };
      });
      const points = [origin, ...stops, ...(dumpSite ? [dumpSite] : [])];
      const matrix = await fetchRoadMatrix(points);
      const shiftEnd = chosen?.profile?.shiftEnd ? (() => { const [h, m] = chosen.profile.shiftEnd.split(":").map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); })() : null;
      const result = optimizeRoute({ start: origin, stops, capacityLiters: Number(vehicleForOpt?.capacityLiters) || null, dumpSite, matrix: matrix || undefined, timeWindow: { startAt: new Date().toISOString(), shiftEnd } });
      const before = evaluateOrder(origin, stops, matrix || undefined);
      setOpt({ result, before, origin, dumpSite, matrixOk: !!matrix });
    } finally { setOptBusy(false); }
  };
  const applyOptimization = async () => {
    const r = opt?.result; if (!r?.ok) return;
    setBusy(true);
    try {
      const served = r.orderedStops.filter((o) => o.type === "stop");
      const deferred = r.deferredStops.map((d) => ({ ...d, deferred: true }));
      const orderedStops = [...served, ...deferred].map((o, i) => ({ order: i + 1, binId: o.binId, binName: o.binName, priorityTier: o.priorityTier, priorityScore: o.priorityScore ?? null, hasCoords: o.lat != null, lat: o.lat ?? null, lng: o.lng ?? null, fillLevelPercent: o.fillLevelPercent ?? null, arrivalMin: o.arrivalMin ?? null, deferred: !!o.deferred }));
      const dumpStops = r.orderedStops.filter((o) => o.type === "dump").map((o) => ({ afterOrder: o.order - 1, lat: o.lat, lng: o.lng, label: o.label, arrivalMin: o.arrivalMin }));
      await updateRoute(route.id, {
        orderedStops, binIds: orderedStops.map((o) => o.binId), estimatedDistanceKm: r.totalDistanceKm, estimatedWasteLiters: r.estimatedWasteLiters,
        optimization: { at: new Date().toISOString(), by: loggedInUser?.uid || "", matrixSource: r.matrixSource, confidence: r.confidence, improvementPct: r.objective.improvementPct, totalDurationMin: r.totalDurationMin, trips: r.trips, constraints: r.constraints, dumpStops, startLabel: opt.origin?.label || "", deferredBinIds: deferred.map((d) => d.binId) },
      });
      await writeAuditLog("route_optimized", loggedInUser?.uid, actorName, { routeId: route.id, routeName: route.routeName, beforeKm: opt.before.km, afterKm: r.totalDistanceKm, beforeMin: opt.before.totalMin, afterMin: r.totalDurationMin, matrixSource: r.matrixSource, confidence: r.confidence, constraints: r.constraints });
      setOpt(null); onChanged();
    } finally { setBusy(false); }
  };

  const routeBins = route.binIds.map((id) => bins.find((b) => b.id === id)).filter(Boolean);
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const preCheck = routePreCheck(route, routeBins, vehicle);

  const availableToAdd = bins.filter((b) => b.neighborhoodId === route.neighborhoodIds?.[0] && !route.binIds.includes(b.id));

  const actorName = loggedInUser?.name || loggedInUser?.email || "موظف";

  const handleApprove = async () => {
    if (driverProfiles.length > 0) {
      // Driver-based model: the vehicle comes from the driver's active assignment; the route is scoped to that driver.
      if (!chosen) { alert("اختر السائق المنفذ أولًا"); return; }
      if (routeConflicts.length) { alert(routeConflicts.map((c) => c.message).join("\n")); return; }
      if (!chosen.profile.vehicleId) { alert("السائق بلا مركبة مسندة — أسند له مركبة من صفحة السائقين."); return; }
      const exceptional = !chosen.eligible;
      if (exceptional && !exceptionReason.trim()) { alert("هذا إسناد استثنائي (السائق غير مؤهل حاليًا) — اكتب مبررًا."); return; }
      setBusy(true);
      try {
        await approveAndAssignRoute(route.id, loggedInUser?.uid, { driverId: effectiveDriverId, driverName: chosen.profile.fullName, vehicleId: chosen.profile.vehicleId }, exceptional ? { reason: exceptionReason.trim() } : null);
        await writeAuditLog("route_assigned", loggedInUser?.uid, actorName, { routeId: route.id, routeName: route.routeName, driverId: effectiveDriverId, vehicleId: chosen.profile.vehicleId, exceptional, reason: exceptionReason.trim(), ineligibleReasons: chosen.reasons, recommendedDriverId: ranking.recommended?.driverId || null, recommendationScore: chosen.cand?.score ?? null, travelSource: chosen.cand?.travelSource || null });
        onChanged(); onClose();
      } finally { setBusy(false); }
      return;
    }
    if (!vehicleId) { alert("اختر مركبة أولًا"); return; }
    setBusy(true);
    try {
      await approveRoute(route.id, loggedInUser?.uid, vehicleId);
      await writeAuditLog("route_approved", loggedInUser?.uid, actorName, { routeId: route.id, routeName: route.routeName, vehicleId });
      onChanged(); onClose();
    } finally { setBusy(false); }
  };
  const handleReject = async () => {
    const reason = window.prompt("سبب الرفض (اختياري):", "") || "";
    setBusy(true);
    try {
      await rejectRoute(route.id, loggedInUser?.uid, reason);
      await writeAuditLog("route_rejected", loggedInUser?.uid, actorName, { routeId: route.id, routeName: route.routeName, reason });
      onChanged(); onClose();
    } finally { setBusy(false); }
  };
  const handleDefer = async () => {
    setBusy(true);
    try {
      await deferRoute(route.id, loggedInUser?.uid);
      await writeAuditLog("route_deferred", loggedInUser?.uid, actorName, { routeId: route.id, routeName: route.routeName });
      onChanged(); onClose();
    } finally { setBusy(false); }
  };
  const handleStart = async () => {
    if (preCheck.issues.length > 0 && !window.confirm(`توجد ملاحظات في الفحص المسبق:\n${preCheck.issues.join("\n")}\n\nهل تريد المتابعة؟`)) return;
    setBusy(true);
    try {
      await startRoute(route.id, route.vehicleId);
      await writeAuditLog("route_started", loggedInUser?.uid, actorName, { routeId: route.id, routeName: route.routeName });
      onChanged(); onClose();
    } finally { setBusy(false); }
  };
  const handleComplete = async () => {
    setBusy(true);
    try {
      await completeRoute(route.id, route.vehicleId);
      await writeAuditLog("route_completed", loggedInUser?.uid, actorName, { routeId: route.id, routeName: route.routeName });
      onChanged(); onClose();
    } finally { setBusy(false); }
  };
  const handleRemoveBin = async (binId) => {
    const newBinIds = route.binIds.filter((id) => id !== binId);
    await updateRoute(route.id, { binIds: newBinIds, orderedStops: route.orderedStops.filter((s) => s.binId !== binId) });
    await writeAuditLog("route_bin_removed", loggedInUser?.uid, actorName, { routeId: route.id, binId });
    onChanged();
  };
  const handleAddBin = async () => {
    if (!addBinId) return;
    const bin = bins.find((b) => b.id === addBinId);
    const newOrder = route.orderedStops.length + 1;
    const priority = getBinPriority(bin, null, []);
    await updateRoute(route.id, {
      binIds: [...route.binIds, addBinId],
      orderedStops: [...route.orderedStops, { order: newOrder, binId: bin.id, binName: bin.name, priorityTier: priority.tier, priorityScore: priority.score, hasCoords: bin.lat != null, manual: true }],
      manualBinIds: [...(route.manualBinIds || []), addBinId], // survives the next engine refresh (reconcileRecommendations keeps manual bins)
    });
    await writeAuditLog("route_bin_added_manually", loggedInUser?.uid, actorName, { routeId: route.id, binId: addBinId });
    setAddBinId("");
    onChanged();
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 22, maxWidth: 560, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{route.routeName}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.dim, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {route.dispatch?.auto && (
          <div style={{ background: C.accent + "10", border: `1px solid ${C.accent}40`, borderRadius: 10, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: C.text, lineHeight: 1.8 }}>
            <b>🤖 أُسندت تلقائيًا</b> · {getReadingAgeLabel(route.dispatch.at)}{route.dispatch.urgent ? " · عاجلة" : ""}
            <Disclosure summary="سبب الاختيار والبدائل"><div style={{ color: C.muted }}>{route.dispatch.reason}{route.dispatch.nearestOverridden ? <div>{route.dispatch.nearestOverridden}</div> : null}{(route.dispatch.alternatives || []).length > 0 && <div>البدائل: {route.dispatch.alternatives.map((a) => `${a.driverName} (${a.why})`).join(" · ")}</div>}{(route.dispatch.insertions || []).length > 0 && <div>إضافات لاحقة: {route.dispatch.insertions.length} حاوية</div>}{(route.dispatch.reassignments || []).length > 0 && <div>إعادة إسناد: {route.dispatch.reassignments.map((x) => x.reason).join(" · ")}</div>}</div></Disclosure>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <StateBadge state={route.priorityTier} />
          <span style={{ fontSize: 12, color: C.muted }}>{route.estimatedDistanceKm} كم تقريبًا · تقدير حجمي {route.estimatedWasteLiters} لتر · {ROUTE_STATUS_LABELS[route.status] || route.status}</span>
          {onShowOnMap && route.neighborhoodIds?.[0] && (() => {
            const n = neighborhoods.find((x) => x.id === route.neighborhoodIds[0]);
            return n ? <button onClick={() => { onShowOnMap(normalizeNeighborhoodName(n.name)); onClose(); }} style={{ marginInlineStart: "auto", padding: "5px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 11, cursor: "pointer", fontFamily: ARABIC_FONT }}>🗺️ عرض على الخريطة التشغيلية</button> : null;
          })()}
        </div>

        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>لماذا اقتُرحت هذه الجولة؟</div>
          <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12, color: C.muted, lineHeight: 1.9 }}>
            {route.reasons.map((r, i) => (<li key={i}>{r}</li>))}
          </ul>
        </div>

        <RouteMap stops={route.orderedStops} bins={bins} neighborhoods={neighborhoods} />

        <div style={{ marginTop: 14 }}>
          {(route.status === "suggested" || route.status === "approved") && can(loggedInUser?.role, "routes.approve") && (
            <div style={{ marginBottom: 12, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>🧮 تحسين ترتيب الزيارات {route.optimization && <span style={{ color: C.accent, fontWeight: 400 }}>· محسّنة ({route.optimization.matrixSource === "osrm" ? "طرق فعلية" : "تقديري"}، ثقة {CONFIDENCE_LABELS[route.optimization.confidence] || route.optimization.confidence})</span>}</div>
                <button disabled={optBusy} onClick={runOptimizer} style={{ padding: "7px 12px", borderRadius: 8, border: "none", background: C.purple, color: "#fff", fontWeight: 700, fontSize: 11.5, cursor: "pointer", fontFamily: ARABIC_FONT }}>{optBusy ? "جاري الحساب…" : route.optimization ? "إعادة الحساب" : "احسب الترتيب الأمثل"}</button>
              </div>
              <div style={{ fontSize: 10.5, color: C.dim, marginTop: 4 }}>بحث محلي (2-opt/Or-opt) على مصفوفة أزمنة الطرق من OSRM، بقيود السعة والأولوية ونقطة التفريغ إن وُجدت. الانطلاق من {chosen?.cand?.origin?.label || "مستودع المركبة"}.</div>
              {opt && opt.result.ok && (() => { const r = opt.result; const conf = { high: ["عالية", C.accent], medium: ["متوسطة", C.warning], low: ["منخفضة", C.dim] }[r.confidence]; return (
                <div style={{ marginTop: 10, fontSize: 12, color: C.text, lineHeight: 1.9 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                    {[
                      ["المسافة", `${opt.before.km} ← ${r.totalDistanceKm} كم`, r.totalDistanceKm < opt.before.km ? C.accent : C.muted],
                      ["الزمن الكلي", `${opt.before.totalMin} ← ${r.totalDurationMin} د`, r.totalDurationMin < opt.before.totalMin ? C.accent : C.muted],
                      ["النفايات المتوقع جمعها", `${r.estimatedWasteLiters} لتر`, C.info],
                      ["الرحلات", r.trips > 1 ? `${r.trips} (مع تفريغ)` : "رحلة واحدة", C.text],
                      ["تحسّن عن الترتيب الحالي", `${opt.before.totalMin > 0 ? Math.max(0, Math.round((1 - r.totalDurationMin / opt.before.totalMin) * 100)) : 0}% زمنًا · ${opt.before.km > 0 ? Math.max(0, Math.round((1 - r.totalDistanceKm / opt.before.km) * 100)) : 0}% مسافة`, C.purple],
                      ["مستوى الثقة", conf[0], conf[1]],
                    ].map(([l, v, c]) => <div key={l} style={{ background: C.card, borderRadius: 8, padding: "6px 10px" }}><div style={{ fontSize: 10.5, color: C.muted }}>{l}</div><b style={{ color: c }}>{v}</b></div>)}
                  </div>
                  {r.constraints.length > 0 && (
                    <ul style={{ margin: "8px 0 0", paddingInlineStart: 18, color: C.warning, fontSize: 11.5 }}>{r.constraints.map((c, i) => <li key={i}>{c}</li>)}</ul>
                  )}
                  <div style={{ marginTop: 8, color: C.muted, fontSize: 11.5 }}>
                    الترتيب المقترح: {r.orderedStops.map((o) => o.type === "dump" ? `🔄 ${o.label}` : `#${o.order} ${o.binName}${o.arrivalMin != null ? ` (${o.arrivalMin} د)` : ""}`).join(" ← ")}
                    {r.deferredStops.length > 0 && <span style={{ color: C.warning }}> · مؤجَّلة: {r.deferredStops.map((d) => d.binName).join("، ")}</span>}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.dim }}>الزمن = قيادة ({r.driveMin} د) + خدمة ({r.serviceMin} د بواقع {r.assumptions.minutesPerStop} د/حاوية){r.finishAt ? ` · الانتهاء المتوقع ${new Date(r.finishAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}` : ""}</div>
                  <button disabled={busy} onClick={applyOptimization} style={{ marginTop: 8, padding: "8px 14px", borderRadius: 8, border: "none", background: C.accent, color: "#07231A", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>اعتماد هذا الترتيب</button>
                </div>
              ); })()}
              {opt && !opt.result.ok && <div style={{ marginTop: 8, color: C.danger, fontSize: 11.5 }}>{opt.result.constraints.join("، ")}</div>}
            </div>
          )}
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>التوقفات ({route.orderedStops.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {route.orderedStops.map((s) => (
              <div key={s.binId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: C.bg, borderRadius: 8, fontSize: 12 }}>
                <span>#{s.order} — {s.binName} {!s.hasCoords && <span style={{ color: C.warning }}>(بلا إحداثيات)</span>}{s.manual && <span style={{ color: C.dim }}> (أُضيفت يدويًا)</span>}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700, color: STATUS_COLORS[s.priorityTier] || C.text }}>{(() => { const b = bins.find((x) => x.id === s.binId); return b?.lastFillLevelPercent != null ? `${b.lastFillLevelPercent}%` : "—"; })()}</span>
                  <StateBadge state={s.priorityTier} />
                  {route.status === "suggested" && (
                    <button onClick={() => handleRemoveBin(s.binId)} style={{ background: "none", border: "none", color: C.danger, cursor: "pointer", fontSize: 11 }}>إزالة</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {route.status === "suggested" && availableToAdd.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <select value={addBinId} onChange={(e) => setAddBinId(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 12, fontFamily: ARABIC_FONT }}>
                <option value="">إضافة حاوية يدويًا من نفس الحي…</option>
                {availableToAdd.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button onClick={handleAddBin} disabled={!addBinId} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: C.accent, color: "#07231A", fontWeight: 700, fontSize: 12, cursor: addBinId ? "pointer" : "not-allowed" }}>إضافة</button>
            </div>
          )}
        </div>

        {(route.status === "suggested" || route.status === "approved") && driverProfiles.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.text, display: "block", marginBottom: 6 }}>🤖 توصية الإسناد — {routeNeighborhoodName || "الحي"} {legsStatus === "loading" && <span style={{ color: C.dim, fontWeight: 400 }}>· جاري حساب أزمنة الوصول عبر الطرق…</span>}</label>
            {ranking.warnings.map((w, i) => (
              <div key={i} style={{ fontSize: 11.5, color: C.warning, background: C.warning + "15", border: `1px solid ${C.warning}40`, borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}>⚠️ {w}</div>
            ))}
            {ranking.recommended && (() => { const r = ranking.recommended; const conf = { high: ["عالية", C.accent], medium: ["متوسطة", C.warning], low: ["منخفضة", C.dim] }[r.confidence]; return (
              <div style={{ background: C.accent + "10", border: `1px solid ${C.accent}50`, borderRadius: 10, padding: 12, marginBottom: 8, fontSize: 12, lineHeight: 1.9, color: C.text }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
                  <div>السائق المقترح: <b>{r.driverName}</b></div>
                  <div>المركبة: <b>{r.vehicleNumber || "—"}</b></div>
                  <div style={{ gridColumn: "1 / -1" }}>النطاق: <b>{r.scope || "—"}</b></div>
                  <div>عدد الحاويات: <b>{r.binsCount}</b></div>
                  <div>مستوى الثقة: <b style={{ color: conf[1] }}>{conf[0]}</b></div>
                  <div>المسافة التقديرية: <b>{r.totalKm != null ? `${r.totalKm} كم` : "غير محسوبة"}</b> <span style={{ color: C.dim, fontSize: 10.5 }}>({r.approachKm != null ? `${r.approachKm} وصول + ${Math.round((r.totalKm - r.approachKm) * 10) / 10} جولة` : "—"})</span></div>
                  <div>مدة الجولة: <b>{r.totalMin != null ? `~${r.totalMin} د` : "غير محسوبة"}</b> <span style={{ color: C.dim, fontSize: 10.5 }}>({r.travelSource === "osrm" ? "طرق فعلية" : "تقدير جوي"} + {ranking.assumptions.minutesPerStop} د/حاوية)</span></div>
                </div>
                <div style={{ color: C.accent, marginTop: 4 }}>سبب الترشيح: {r.reason}</div>
                {r.nearestOverridden && <div style={{ color: C.muted, fontSize: 11.5 }}>ℹ️ لماذا ليس الأقرب؟ {r.nearestOverridden}</div>}
              </div>
            ); })()}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {driverOptions.map((d) => {
                const c = d.cand; const active = effectiveDriverId === d.profile.uid;
                return (
                  <button key={d.profile.uid} type="button" onClick={() => setDriverId(d.profile.uid)} style={{ textAlign: "right", padding: "8px 12px", borderRadius: 8, border: `1px solid ${active ? C.info : C.border}`, background: active ? C.info + "15" : C.bg, color: C.text, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT, lineHeight: 1.7 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <span>{d.eligible ? "✅" : "⚠️"} <b>{d.profile.fullName}</b> — {d.vehicle?.vehicleNumber || "بلا مركبة"}{c.verdict.eligible ? ` · تقييم ${c.score}/100` : ""}</span>
                      <span style={{ color: C.muted }}>{c.approachMin != null ? `وصول ~${c.approachMin} د · ${c.approachKm} كم (${c.travelSource === "osrm" ? "طرق" : "جوي"})` : "زمن الوصول غير محسوب"}{c.remainingL != null ? ` · سعة متبقية ${c.remainingL} لتر` : ""}</span>
                    </div>
                    {!d.eligible && <div style={{ color: C.warning, fontSize: 11 }}>{d.reasons.join("، ")}</div>}
                    {d.eligible && c.flags.length > 0 && <div style={{ color: C.dim, fontSize: 11 }}>{c.flags.join("، ")}</div>}
                  </button>
                );
              })}
            </div>
            {chosen && (
              <div style={{ fontSize: 11.5, color: chosen.eligible ? C.accent : C.warning, marginTop: 6, lineHeight: 1.7 }}>
                {chosen.eligible ? (effectiveDriverId === ranking.recommended?.driverId ? "سيُسند إلى السائق المقترح." : "اخترت سائقًا مؤهلًا غير المقترح — يُسجَّل في سجل العمليات مع تقييم التوصية.") : `إسناد استثنائي: ${chosen.reasons.join("، ")}`}
                {routeConflicts.map((c, i) => <div key={i} style={{ color: C.danger }}>⛔ {c.message}</div>)}
                {!chosen.eligible && <input value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} placeholder="مبرر الإسناد الاستثنائي (إلزامي)" style={{ width: "100%", marginTop: 6, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.warning}`, background: C.bg, color: C.text, fontSize: 12, fontFamily: ARABIC_FONT, boxSizing: "border-box" }} />}
              </div>
            )}
          </div>
        )}
        {(route.status === "suggested" || route.status === "approved") && driverProfiles.length === 0 && (
          <div style={{ marginTop: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.text, display: "block", marginBottom: 6 }}>المركبة <span style={{ color: C.dim, fontWeight: 400 }}>(لا توجد ملفات سائقين بعد — أنشئها من صفحة السائقين)</span></label>
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, fontFamily: ARABIC_FONT }}>
              <option value="">اختر مركبة…</option>
              {vehicles.map((v) => <option key={v.id} value={v.id} disabled={v.status !== "available" && v.id !== route.vehicleId}>{v.vehicleNumber} — {VEHICLE_STATUS_LABELS[v.status] || v.status}</option>)}
            </select>
          </div>
        )}

        {vehicleId && (
          <div style={{ marginTop: 12, background: preCheck.ready ? C.accent + "15" : C.warning + "15", border: `1px solid ${preCheck.ready ? C.accent : C.warning}40`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: preCheck.ready ? C.accent : C.warning, marginBottom: 4 }}>
              {preCheck.ready ? "✅ جاهزة للتنفيذ" : "⚠️ تحتاج مراجعة"}
            </div>
            {preCheck.issues.length > 0 && (
              <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 11.5, color: C.muted }}>
                {preCheck.issues.map((i, idx) => (<li key={idx}>{i}</li>))}
              </ul>
            )}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
          {route.status === "suggested" && (
            <>
              <button disabled={busy} onClick={handleApprove} style={{ flex: "1 1 120px", padding: "10px", borderRadius: 10, border: "none", background: C.accent, color: "#07231A", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: ARABIC_FONT }}>اعتماد الجولة</button>
              <button disabled={busy} onClick={handleDefer} style={{ flex: "1 1 100px", padding: "10px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: ARABIC_FONT }}>تأجيل</button>
              <button disabled={busy} onClick={handleReject} style={{ flex: "1 1 100px", padding: "10px", borderRadius: 10, border: `1px solid ${C.danger}`, background: C.danger + "15", color: C.danger, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: ARABIC_FONT }}>رفض</button>
            </>
          )}
          {route.status === "approved" && (
            <button disabled={busy} onClick={handleStart} style={{ flex: "1 1 160px", padding: "10px", borderRadius: 10, border: "none", background: C.info, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: ARABIC_FONT }}>بدء الجولة (إرسال مركبة جمع)</button>
          )}
          {route.status === "in_progress" && (
            <button disabled={busy} onClick={handleComplete} style={{ flex: "1 1 160px", padding: "10px", borderRadius: 10, border: "none", background: C.accent, color: "#07231A", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: ARABIC_FONT }}>إنهاء الجولة</button>
          )}
        </div>
      </div>
    </div>
  );
};

// ======================== AUDIT LOG ========================
const AUDIT_ACTION_LABELS = {
  routes_generated: "توليد جولات مقترحة",
  route_approved: "اعتماد جولة",
  route_rejected: "رفض جولة",
  route_deferred: "تأجيل جولة",
  route_started: "بدء جولة",
  route_completed: "إنهاء جولة",
  route_bin_removed: "إزالة حاوية من جولة",
  route_bin_added_manually: "إضافة حاوية يدويًا لجولة",
  routes_auto_synced: "مزامنة تلقائية للجولات المقترحة",
  route_stop_skipped: "تخطي حاوية في جولة",
  route_fault_reported: "بلاغ عطل أثناء جولة",
  route_obstacle_reported: "بلاغ عائق أثناء جولة",
  vehicle_added: "إضافة مركبة",
  device_key_rotated: "توليد مفتاح جهاز IoT",
  driver_profile_updated: "تعديل ملف سائق",
  driver_vehicle_assigned: "إسناد مركبة لسائق",
  driver_vehicle_unassigned: "إنهاء إسناد مركبة",
  driver_clocked_in: "بدء مناوبة سائق",
  driver_clocked_out: "إنهاء مناوبة سائق",
  driver_break: "استراحة سائق",
  route_assigned: "إسناد جولة لسائق",
  route_optimized: "تحسين ترتيب جولة",
  plan_applied: "اعتماد خطة جمع ذكية كجولات مقترحة",
  decision_simulated: "تشغيل سيناريو قرار (محاكاة معزولة)",
  transfer_proposed: "اقتراح نقل مورد بين بلديتين",
  transfer_approved: "اعتماد نقل مورد",
  transfer_rejected: "رفض نقل مورد",
  transfer_executed: "تنفيذ نقل مورد",
  transfer_returned: "إعادة مورد إلى بلديته",
  support_request_created: "طلب دعم من الأمانة",
  support_request_approved: "موافقة على طلب دعم",
  support_request_rejected: "رفض طلب دعم",
  route_unreachable_reported: "بلاغ تعذر الوصول لحاوية",
  incident_reviewed: "مراجعة بلاغ ميداني",
  route_stop_reinstated: "إعادة إدراج حاوية في جولة",
  device_disabled: "تعطيل جهاز IoT",
  device_enabled: "تفعيل جهاز IoT",
  demo_simulation_started: "بدء محاكاة ESP32 حية",
  demo_simulation_stopped: "إيقاف محاكاة ESP32",
  demo_action: "إجراء تجريبي (Demo)",
};

// ======================== FLEET MONITOR (Phase 5) ========================
const FleetMonitorPage = ({ profiles = [], vehicles = [], routes = [], incidents = [], bins = [], neighborhoods = [], loggedInUser }) => {
  const [selectedUid, setSelectedUid] = useState(null);
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  const active = routes.filter((r) => r.status === "in_progress");
  const approved = routes.filter((r) => r.status === "approved");
  const todayStr = new Date().toDateString();
  const completedToday = routes.filter((r) => r.status === "completed" && r.completedAt && new Date(r.completedAt).toDateString() === todayStr);
  const onShift = profiles.filter((p) => p.shiftStatus === "on_shift");
  const available = onShift.filter((p) => p.availability === "available" && !routes.some((r) => r.status === "in_progress" && r.driverId === p.uid));
  const openIncidents = incidents.filter((i) => i.status === "open");
  const remainingBins = active.reduce((a, r) => a + routeProgress(r).remaining, 0);
  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const routeFor = (uid) => routes.find((r) => r.driverId === uid && (r.status === "in_progress" || r.status === "approved")) || null;
  // Only drivers on shift who share a location are shown on the map; freshness is labelled.
  const tracked = onShift.filter((p) => p.locationSharing && p.lastLocation?.lat != null).map((p) => ({ p, fresh: locationFreshness(p.lastLocation, { now }), route: routeFor(p.uid), vehicle: vehicleById.get(p.vehicleId) }));
  const sel = tracked.find((t) => t.p.uid === selectedUid) || null;
  const selProgress = sel?.route ? routeProgress(sel.route) : null;
  const selNext = sel?.route ? nextStopFor(sel.route) : null;
  const selEta = sel && selNext?.lat != null ? estimateTravelMinutes((haversineDistanceKm(sel.p.lastLocation.lat, sel.p.lastLocation.lng, selNext.lat, selNext.lng) ?? 0)) : null;
  const actor = { uid: loggedInUser?.uid, name: loggedInUser?.name || "" };

  if (!can(loggedInUser?.role, "fleet.monitor")) return <EmptyState icon="🔒" title="غير مصرح" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        {[["في المناوبة", onShift.length, C.accent], ["متاحون", available.length, C.info], ["مركبات نشطة", vehicles.filter((v) => v.status === "on_route").length, C.purple], ["جولات نشطة", active.length, C.info], ["معتمدة بانتظار البدء", approved.length, C.warning], ["حاويات متبقية", remainingBins, C.danger], ["مكتملة اليوم", completedToday.length, C.accent], ["بلاغات مفتوحة", openIncidents.length, openIncidents.length ? C.danger : C.dim]].map(([l, v, c]) => (
          <div key={l} style={{ background: C.card, border: `1px solid ${c}30`, borderRadius: 12, padding: "12px 14px" }}><div style={{ fontSize: 24, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 11, color: C.muted }}>{l}</div></div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 1.5fr) minmax(260px, 1fr)", gap: 16 }}>
        <Card title="🗺️ مواقع المركبات (أثناء المناوبة فقط، بإذن السائق)" icon={<Truck size={16} color={C.muted} />}>
          <div style={{ height: 460, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}` }}>
            <MapContainer center={BURAIDAH_CENTER} zoom={12} style={{ width: "100%", height: "100%" }} preferCanvas>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
              {tracked.map(({ p, fresh, route, vehicle }) => (
                <CircleMarker key={p.uid} center={[p.lastLocation.lat, p.lastLocation.lng]} radius={selectedUid === p.uid ? 13 : 10}
                  pathOptions={{ color: "#fff", weight: 2, fillColor: fresh.state === "live" ? C.info : C.dim, fillOpacity: 0.95, dashArray: fresh.state === "live" ? null : "3 3" }}
                  eventHandlers={{ click: () => setSelectedUid(p.uid) }}>
                  <Popup><div style={{ fontFamily: ARABIC_FONT, direction: "rtl", fontSize: 12 }}><b>{p.fullName}</b> · {vehicle?.vehicleNumber || "بلا مركبة"}<br />{route ? `${route.routeName} (${ROUTE_STATUS_LABELS[route.status]})` : "بلا جولة"}<br />{fresh.state === "live" ? "موقع مباشر" : `آخر موقع قبل ${fresh.ageMin} د`}</div></Popup>
                </CircleMarker>
              ))}
              {sel?.route && (sel.route.orderedStops || []).filter((s) => s.lat != null).map((s) => (
                <CircleMarker key={s.binId} center={[s.lat, s.lng]} radius={6} pathOptions={{ color: "#fff", weight: 1, fillColor: (sel.route.collectedBinIds || []).includes(s.binId) ? C.dim : STATUS_COLORS[s.priorityTier] || C.info, fillOpacity: 0.9 }} />
              ))}
            </MapContainer>
          </div>
          <div style={{ fontSize: 10.5, color: C.dim, marginTop: 6 }}>{tracked.length === 0 ? "لا توجد مركبات تشارك موقعها الآن (يبدأ التتبع ببدء المناوبة من بوابة السائق)." : `${tracked.length} مركبة · النقطة المتقطعة = موقع قديم (أكثر من 5 دقائق). التتبع يتوقف تلقائيًا عند إغلاق الشاشة على بعض الجوالات.`}</div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title={sel ? `🚛 ${sel.p.fullName}` : "اختر مركبة من الخريطة"} icon={<Users size={16} color={C.muted} />}>
            {!sel ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {onShift.length === 0 && <EmptyState icon="🛌" title="لا سائقين في المناوبة" />}
                {onShift.map((p) => { const r = routeFor(p.uid); const f = locationFreshness(p.lastLocation, { now }); return (
                  <div key={p.uid} onClick={() => p.lastLocation && setSelectedUid(p.uid)} style={{ padding: "8px 10px", borderRadius: 8, background: C.bg, fontSize: 12, cursor: p.lastLocation ? "pointer" : "default" }}>
                    <b style={{ color: C.text }}>{p.fullName}</b> · {vehicleById.get(p.vehicleId)?.vehicleNumber || "بلا مركبة"} · {r ? `${r.routeName} (${ROUTE_STATUS_LABELS[r.status]})` : "بلا جولة"}
                    <div style={{ color: f.state === "live" ? C.accent : f.state === "stale" ? C.warning : C.dim, fontSize: 11 }}>{f.state === "live" ? "📍 موقع مباشر" : f.state === "stale" ? `📍 آخر موقع قبل ${f.ageMin} د` : "📍 لا يشارك موقعه"}</div>
                  </div>
                ); })}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 2 }}>
                المركبة: <b style={{ color: C.text }}>{sel.vehicle?.vehicleNumber || "—"}</b> ({VEHICLE_STATUS_LABELS[sel.vehicle?.status] || "—"})<br />
                الحي: <b style={{ color: C.text }}>{sel.route ? neighborhoods.find((n) => (sel.route.neighborhoodIds || []).includes(n.id))?.name || "—" : (sel.p.neighborhoodKeys || []).map((k) => `حي ${k}`).join("، ") || "—"}</b><br />
                الجولة الحالية: <b style={{ color: C.text }}>{sel.route ? `${sel.route.routeName} — ${ROUTE_STATUS_LABELS[sel.route.status]}` : "لا توجد"}</b><br />
                {selProgress && <>التقدم: <b style={{ color: C.accent }}>{selProgress.collected}/{selProgress.total}</b> جُمعت · {selProgress.skipped} تخطٍ · {selProgress.remaining} متبقية<br /></>}
                آخر موقع: <b style={{ color: sel.fresh.state === "live" ? C.accent : C.warning }}>{sel.fresh.state === "live" ? "مباشر" : `قبل ${sel.fresh.ageMin} د`}</b> · {getReadingAgeLabel(sel.p.lastLocation.at)}{sel.p.lastLocation.accuracyM != null ? ` · دقة ${Math.round(sel.p.lastLocation.accuracyM)} م` : ""}<br />
                {selNext && <>الوجهة التالية: <b style={{ color: C.text }}>{selNext.binName}</b>{selEta != null ? ` · وصول تقديري ~${selEta} د (مسافة جوية)` : ""}<br /></>}
                <button onClick={() => setSelectedUid(null)} style={{ marginTop: 6, padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 11, cursor: "pointer", fontFamily: ARABIC_FONT }}>← كل السائقين</button>
              </div>
            )}
          </Card>

          <Card title={`🚧 البلاغات والعوائق (${openIncidents.length} مفتوح)`} icon={<AlertTriangle size={16} color={C.muted} />}>
            {incidents.length === 0 ? <EmptyState icon="✅" title="لا بلاغات" /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                {[...incidents].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 30).map((inc) => {
                  const t = INCIDENT_TYPES[inc.type] || { label: inc.type, icon: "❓" };
                  const r = routes.find((x) => x.id === inc.routeId);
                  const bin = bins.find((b) => b.id === inc.binId);
                  const stillSkipped = r && (r.skippedStops || []).some((s) => s.binId === inc.binId);
                  return (
                    <div key={inc.id} style={{ background: C.bg, borderRadius: 8, padding: "8px 10px", fontSize: 12, borderRight: `3px solid ${inc.status === "open" ? C.danger : C.dim}` }}>
                      <div><b style={{ color: C.text }}>{t.icon} {t.label}</b> · {inc.driverName} · {getReadingAgeLabel(inc.createdAt)}</div>
                      <div style={{ color: C.muted, fontSize: 11 }}>{inc.routeName}{bin ? ` · ${bin.name}` : ""}{inc.note ? ` · ${inc.note}` : ""} · {inc.status === "open" ? "مفتوح" : inc.status === "reviewed" ? "تمت المراجعة" : "محلول"}{inc.resolution ? ` — ${inc.resolution}` : ""}</div>
                      {inc.status === "open" && (
                        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                          <button disabled={busy} onClick={async () => { const res = window.prompt("ملاحظة المراجعة (اختياري):", "") ?? ""; setBusy(true); try { await reviewRouteIncident(inc.id, actor.uid, "reviewed", res); await writeAuditLog("incident_reviewed", actor.uid, actor.name, { incidentId: inc.id, routeId: inc.routeId, resolution: res }); } finally { setBusy(false); } }} style={smallBtn(C.info)}>تمت المراجعة</button>
                          {stillSkipped && inc.binId && (
                            <button disabled={busy} onClick={async () => { setBusy(true); try { await reinstateRouteStop(r.id, reinstateSkippedStop(r, inc.binId).skippedStops); await reviewRouteIncident(inc.id, actor.uid, "resolved", "أُعيد إدراج الحاوية في الجولة"); await writeAuditLog("route_stop_reinstated", actor.uid, actor.name, { routeId: r.id, binId: inc.binId, incidentId: inc.id }); } finally { setBusy(false); } }} style={smallBtn(C.accent)}>إعادة إدراج الحاوية</button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ fontSize: 10.5, color: C.dim, marginTop: 8 }}>بلاغ العائق يخص هذه الجولة فقط ولا يغيّر شبكة الطرق لبقية المركبات إلا بعد مراجعة.</div>
          </Card>
        </div>
      </div>
    </div>
  );
};

// ======================== DEMO SIMULATION CONTROL (Phase 3/4) ========================
const SIM_TAB_ID = (() => { try { let id = sessionStorage.getItem("swm_sim_tab"); if (!id) { id = "tab-" + Math.random().toString(36).slice(2, 10); sessionStorage.setItem("swm_sim_tab", id); } return id; } catch { return "tab-" + Math.random().toString(36).slice(2, 10); } })();

const SimulationPage = ({ neighborhoods = [], bins = [], vehicles = [], loggedInUser }) => {
  const [sim, setSim] = useState(undefined); // undefined = loading, null = not installed
  const [cfg, setCfg] = useState({ ...DEFAULT_SIM_CONFIG });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [evMun, setEvMun] = useState("");
  const [evBin, setEvBin] = useState("");
  const [tickLog, setTickLog] = useState([]);
  const canInstall = can(loggedInUser?.role, "municipalities.manage"); // platform admin: install/reset/start/stop
  const canControl = can(loggedInUser?.role, "simulation.control");
  const scope = scopeFor(loggedInUser);
  const actor = { uid: loggedInUser?.uid, name: loggedInUser?.name };
  const simBins = bins.filter((b) => b.simulated && (!evMun || b.municipalityId === evMun));

  useEffect(() => subscribeSimState((s) => { setSim(s); if (s?.config) setCfg((c) => ({ ...c, ...s.config })); }), []);

  // Leader tick loop: the tab that pressed start ticks; another tab takes over when the leader is stale.
  const tickingRef = useRef(false);
  useEffect(() => {
    if (!sim || sim.status !== "running" || !canControl) return;
    const interval = realIntervalMs(sim.config, sim.speed);
    const id = setInterval(async () => {
      if (tickingRef.current) return;
      const stale = !sim.lastTickAt || Date.now() - new Date(sim.lastTickAt).getTime() > 3 * interval;
      if (sim.leader !== SIM_TAB_ID && !stale) return;
      if (sim.leader !== SIM_TAB_ID) await setSimulationStatus("running", { leader: SIM_TAB_ID });
      tickingRef.current = true;
      try { const r = await tickSimulation(); if (r) setTickLog((l) => [{ at: new Date().toLocaleTimeString("ar-SA"), ...r }, ...l].slice(0, 12)); }
      catch (e) { console.error("[sim-tick]", e); setMsg("تعذر تنفيذ العملية: " + friendlyError(e)); }
      finally { tickingRef.current = false; }
    }, interval);
    return () => clearInterval(id);
  }, [sim, canControl]);

  const run = async (label, fn) => { setBusy(label); setMsg(""); try { const r = await fn(); if (r) setMsg(r); } catch (e) { setMsg("تعذر تنفيذ العملية: " + friendlyError(e)); } finally { setBusy(""); } };
  const install = () => run("install", async () => {
    if (!window.confirm("سيُحذف المشهد التجريبي السابق (الصفوف الموسومة demo فقط) ويُبنى مشهد المحاكاة بنفس الـseed. البيانات الحقيقية لا تُمس. متابعة؟")) return "";
    const r = await installSimulation(cfg, { neighborhoods, featuresByKey: FEATURE_BY_KEY, actor, withHistory: true, vehicleIds: vehicles.filter((v) => v.demo).map((v) => v.id) });
    return `✅ ثُبّت المشهد: ${r.bins} حاوية (${r.summary.online} متصلة بالمحاكي · ${r.summary.offline} منقطعة · ${r.summary.fault} معطلة · ${r.summary.critical} حرجة · ${r.summary.thermal} تنبيه حراري) · حُذف ${r.cleaned} صف تجريبي سابق · ${r.historyRoutes} جولة تاريخية${r.warnings.length ? " · " + r.warnings.join("، ") : ""}`;
  });
  const fire = (type) => run(type, async () => {
    const r = await fireSimulationEvent(type, evBin ? { binId: evBin } : { municipalityId: evMun || scope.municipalityId || null }, actor);
    // Urgent event → the server runs a dispatch cycle for that municipality (no-op when dispatch is off).
    let dispatchNote = "";
    const evMid = r.bin?.municipalityId || evMun || scope.municipalityId || null;
    if (["critical_fill", "heat_spike"].includes(type) && evMid) {
      try { const d = await requestDispatchCycle({ municipalityId: evMid, trigger: "simulator_event" }); const t = d.municipalities?.[evMid]; dispatchNote = d.skipped ? "" : t ? ` · الإسناد التلقائي: ${d.mode === "auto" ? `${t.executed} قرار نُفّذ` : `${t.observed} توصية (مراقبة)`}${t.escalated ? `، ${t.escalated} مرفوعة` : ""}` : ""; } catch { dispatchNote = " · تعذر الاتصال بخادم الإسناد"; }
    }
    return `${SIM_EVENTS[type].icon} ${SIM_EVENTS[type].label} → ${r.bin.name}${dispatchNote}`;
  });
  const summary = sim?.summary;
  const num = (k, label, min, max) => (
    <label style={{ fontSize: 11, color: C.muted }}>{label}<input type="number" min={min} max={max} value={cfg[k]} disabled={!canInstall} onChange={(e) => setCfg({ ...cfg, [k]: Number(e.target.value) })} style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 12, fontFamily: ARABIC_FONT, boxSizing: "border-box" }} /></label>
  );
  const btn = (label, onClick, color, disabled = false) => <button disabled={disabled || !!busy} onClick={onClick} style={{ padding: "9px 14px", borderRadius: 10, border: `1px solid ${color}`, background: color + "20", color, fontWeight: 700, fontSize: 12, cursor: disabled ? "not-allowed" : "pointer", fontFamily: ARABIC_FONT, opacity: disabled ? 0.5 : 1 }}>{busy === label ? "…" : label}</button>;

  if (!canControl) return <EmptyState icon="🔒" title="غير مصرح" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 900, color: C.text }}>🧪 محاكي مستشعرات IoT — بيئة العرض</div>
        <div style={{ fontSize: 12, color: C.dim }}>سيناريو حتمي (seed ثابت): إعادة الضبط تعيد المشهد نفسه. كل قراءة تُكتب في simulated_readings بمصدر SIMULATED ولا تلمس قراءات الأجهزة الحقيقية، ولا يعمل المحرك إلا على حاويات موسومة simulated.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(320px, 1.3fr)", gap: 14 }}>
        <Card title="⚙️ إعدادات السيناريو (تجريبية، قابلة للتعديل)" icon={<SettingsIcon size={16} color={C.muted} />}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ fontSize: 11, color: C.muted, gridColumn: "1 / -1" }}>بذرة التوليد (تعيد المشهد نفسه)<input value={cfg.seed} disabled={!canInstall} onChange={(e) => setCfg({ ...cfg, seed: e.target.value })} style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 12, fontFamily: "monospace", direction: "ltr", boxSizing: "border-box" }} /></label>
            {num("totalBins", "عدد الحاويات", 10, 1000)}
            {num("offlineSensors", "مستشعرات منقطعة", 0, 200)}
            {num("faultSensors", "مستشعرات معطلة", 0, 200)}
            {num("thermalAlerts", "تنبيهات حرارية", 0, 50)}
            {num("tickMinutes", "دقائق محاكاة لكل نبضة", 1, 120)}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {btn(sim ? "🔁 إعادة ضبط (نفس الـseed)" : "📦 تثبيت المشهد", install, C.purple, !canInstall)}
          </div>
          {!canInstall && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>تثبيت/إعادة ضبط المشهد من صلاحية مدير المنصة؛ يمكنك توليد الأحداث داخل بلديتك.</div>}
          {msg && <div style={{ fontSize: 12, color: C.text, marginTop: 8, lineHeight: 1.7 }}>{msg}</div>}
        </Card>

        <Card title="🎛️ التحكم في التشغيل" icon={<Gauge size={16} color={C.muted} />}>
          {sim === undefined ? <div style={{ color: C.dim, fontSize: 12 }}>جاري التحميل…</div> : !sim ? <EmptyState icon="📦" title="لم يُثبَّت مشهد المحاكاة بعد" desc="اضغط «تثبيت المشهد» لتوليد الحاويات والمستشعرات الافتراضية داخل مضلعات الأحياء." /> : (
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.9 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginBottom: 8 }}>
                {[["الحالة", sim.status === "running" ? "▶️ يعمل" : "⏸ متوقف", sim.status === "running" ? C.accent : C.warning], ["الساعة المحاكاة", new Date(sim.clock).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }), C.text], ["النبضات", sim.tick, C.text], ["السرعة", `${sim.speed}×`, C.info],
                  ["حاويات", summary?.total ?? "—", C.text], ["متصلة بالمحاكي", summary?.online ?? "—", C.accent], ["منقطعة / معطلة", `${summary?.offline ?? 0} / ${summary?.fault ?? 0}`, C.dim], ["حرجة / متابعة", `${summary?.critical ?? 0} / ${summary?.warning ?? 0}`, C.danger], ["تنبيه حراري", summary?.thermal ?? 0, C.warning]].map(([l, v, c]) => (
                  <div key={l} style={{ background: C.bg, borderRadius: 8, padding: "6px 10px" }}><div style={{ fontSize: 15, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 10.5 }}>{l}</div></div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {sim.status !== "running" ? btn("▶️ بدء", () => run("▶️ بدء", async () => { await setSimulationStatus("running", { speed: sim.speed, leader: SIM_TAB_ID }); return "▶️ بدأ التشغيل — هذه النافذة تقود النبضات"; }), C.accent, !canInstall)
                  : btn("⏹ إيقاف", () => run("⏹ إيقاف", async () => { await setSimulationStatus("stopped"); return "⏹ أُوقف التشغيل"; }), C.danger, !canInstall)}
                <span>تسريع الزمن:</span>
                {[1, 5, 20, 60].map((sp) => <button key={sp} disabled={!canInstall} onClick={() => setSimulationStatus(sim.status, { speed: sp, leader: sim.leader })} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${sim.speed === sp ? C.info : C.border}`, background: sim.speed === sp ? C.info + "25" : "transparent", color: sim.speed === sp ? C.info : C.muted, fontSize: 11.5, cursor: "pointer", fontFamily: ARABIC_FONT }}>{sp}×</button>)}
                <span style={{ fontSize: 10.5, color: C.dim }}>نبضة كل {Math.round(realIntervalMs(sim.config, sim.speed) / 1000)} ث حقيقية = {sim.config.tickMinutes} دقيقة محاكاة{sim.leader === SIM_TAB_ID ? " · هذه النافذة القائدة" : sim.leader ? " · نافذة أخرى تقود" : ""}</span>
              </div>
              {tickLog.length > 0 && <div style={{ marginTop: 8, fontSize: 11, fontFamily: "monospace", background: C.bg, borderRadius: 8, padding: 8, maxHeight: 110, overflowY: "auto", direction: "ltr", textAlign: "left" }}>{tickLog.map((t, i) => <div key={i}>{t.at} tick#{t.tick} clock={new Date(t.clock).toISOString().slice(11, 16)} critical={t.summary.critical} warning={t.summary.warning} emptied={t.emptied}</div>)}</div>}
            </div>
          )}
        </Card>
      </div>

      {sim && (
        <Card title="⚡ توليد أحداث للعرض" icon={<Sparkles size={16} color={C.muted} />}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10, fontSize: 12 }}>
            <span style={{ color: C.muted }}>النطاق:</span>
            <select value={evMun} disabled={!scope.all} onChange={(e) => { setEvMun(e.target.value); setEvBin(""); }} style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 12, fontFamily: ARABIC_FONT }}>
              <option value="">{scope.all ? "كل المدينة (اختيار حتمي)" : municipalityById(scope.municipalityId)?.shortAr || "بلديتي"}</option>
              {scope.all && MUNICIPALITIES.map((m) => <option key={m.id} value={m.id}>{m.shortAr}</option>)}
            </select>
            <select value={evBin} onChange={(e) => setEvBin(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 12, fontFamily: ARABIC_FONT, maxWidth: 320 }}>
              <option value="">حاوية محددة (اختياري)…</option>
              {simBins.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.lastFillLevelPercent}% · {sensorStateLabel(b, b.sensorConnectivity || "online")}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(SIM_EVENTS).map(([k, e]) => <span key={k}>{btn(`${e.icon} ${e.label}`, () => fire(k), k === "critical_fill" ? C.danger : k === "heat_spike" ? C.warning : k === "emptied" ? C.accent : C.info)}</span>)}
          </div>
          {(sim.events || []).length > 0 && (
            <div style={{ marginTop: 10, maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {[...sim.events].reverse().slice(0, 20).map((e, i) => <div key={i} style={{ fontSize: 11.5, color: C.muted, background: C.bg, borderRadius: 6, padding: "5px 10px" }}>{SIM_EVENTS[e.type]?.icon} {e.label} — <b style={{ color: C.text }}>{e.binName}</b> · {new Date(e.at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })} (زمن المحاكاة)</div>)}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: C.dim, marginTop: 8, lineHeight: 1.7 }}>كل حدث يكتب قراءة SIMULATED جديدة فتتحدث الحاوية فورًا في لوحة التحكم والخريطة ومحرك الأولوية والتنبؤ واقتراح الجولات. تأكيد السائق تفريغَ حاوية محاكاة يولّد قراءة تفريغ في النبضة التالية — حدث التفريغ (collection_events) وقراءة المستشعر صفان منفصلان.</div>
        </Card>
      )}
    </div>
  );
};

// ======================== DEMONSTRATION MODE (Phase 5) ========================
COLLECTIONS.DEMO_SESSIONS = "demo_sessions";
const DEMO_SESSION_REF = () => doc(db, COLLECTIONS.DEMO_SESSIONS, "current");

const DemoScenarioPage = ({ neighborhoods = [], bins = [], routes = [], profiles = [], vehicles = [], incidents = [], recentReadings = [], fireSensors = [], citizenReports = [], supportRequests = [], transfers = [], auditLog = [], loggedInUser, onNavigate }) => {
  const [session, setSession] = useState(undefined);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [pickMid, setPickMid] = useState(DEFAULT_DEMO_MUNICIPALITY);
  const actor = { uid: loggedInUser?.uid, name: loggedInUser?.name };
  const canRun = can(loggedInUser?.role, "simulation.control");
  const isAmanah = can(loggedInUser?.role, "transfers.approve");
  useEffect(() => onSnapshot(DEMO_SESSION_REF(), (snap) => setSession(snap.exists() ? snap.data() : null), () => setSession(null)), []);
  const { runs } = useOptimizationRuns(true, scopeFor(loggedInUser).all ? null : scopeFor(loggedInUser).municipalityId);
  const { scenarios } = useSimulationScenarios(true, scopeFor(loggedInUser).all ? null : scopeFor(loggedInUser).municipalityId || "__none__");
  const city = useCityPressure({ neighborhoods, bins, profiles, vehicles, routes, incidents, recentReadings });
  const evaluation = useMemo(() => evaluateDemo(session, { bins, routes, profiles, readings: recentReadings, runs, scenarios, supportRequests, transfers, audit: auditLog }), [session, bins, routes, profiles, recentReadings, runs, scenarios, supportRequests, transfers, auditLog]);
  const { index, doneByKey, newlyPassed } = useMemo(() => nextStepIndex(session, evaluation), [session, evaluation]);
  // Persist newly passed observe-steps so completion survives later data changes and page refreshes.
  useEffect(() => {
    if (!session || newlyPassed.length === 0) return;
    setDoc(DEMO_SESSION_REF(), { completedKeys: [...new Set([...(session.completedKeys || []), ...newlyPassed])], updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
  }, [newlyPassed.join("|"), session]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (data) => setDoc(DEMO_SESSION_REF(), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
  const run = (label, fn) => async () => { setBusy(label); setMsg(""); try { const r = await fn(); if (r) setMsg(r); } catch (e) { setMsg("تعذر تنفيذ العملية: " + friendlyError(e)); } finally { setBusy(""); } };
  const mid = session?.municipalityId || null;
  const munNeighborhoods = neighborhoods.filter((n) => municipalityForNeighborhood(n) === mid);
  const munKeys = munNeighborhoods.map((n) => normalizeNeighborhoodName(n.name));

  const actions = {
    start: run("start", async () => { await setDoc(DEMO_SESSION_REF(), { startedAt: new Date().toISOString(), startedBy: actor.uid, completedKeys: [], firedEvents: 0 }); return "بدأت الجلسة"; }),
    city: run("city", async () => { await patch({ visitedCity: true }); onNavigate && onNavigate("municipalities"); return ""; }),
    amanah: run("amanah", async () => { await patch({ visitedAmanah: true }); onNavigate && onNavigate(loggedInUser?.role === "executive" ? "exec" : "brain"); return ""; }),
    plan: run("plan", async () => {
      const ctx = makeBinContext(fireSensors, citizenReports, munNeighborhoods);
      const readingsByBin = {}; for (const r of recentReadings) { if (r.bin_id) (readingsByBin[r.bin_id] ||= []).push(r); }
      const munBins = bins.filter((b) => b.municipalityId === mid);
      const veh = vehicles.find((v) => v.municipalityId === mid && v.depotLat != null);
      const depot = veh ? { lat: veh.depotLat, lng: veh.depotLng } : DEFAULT_DEPOT;
      const plan = buildCollectionPlan({ municipalityId: mid, neighborhoods: munNeighborhoods, bins: munBins, profiles: profiles.filter((p) => p.municipalityId === mid), vehicles: vehicles.filter((v) => v.municipalityId === mid), routes: routes.filter((r) => r.municipalityId === mid), readingsByBin, contextFor: ctx.forBin, depot });
      const id = await saveOptimizationRun({ municipalityId: mid, summary: plan.summary, routes: plan.routes.map((r) => ({ neighborhoodId: r.neighborhoodId, routeName: r.routeName, stops: r.stops.length, deferred: r.deferredStops.length, distanceKm: r.distanceKm, durationMin: r.durationMin, matrixSource: r.matrixSource, driver: r.driver ? { driverId: r.driver.driverId, driverName: r.driver.driverName } : null })), constraints: plan.constraints, assumptions: plan.assumptions, applied: false, demoScenario: true, demo: munBins.some((b) => b.demo) }, actor);
      await patch({ planRunId: id });
      return `🧠 خُطّطت ${plan.summary.routes} جولة لـ ${plan.summary.needCollection} حاوية · ${plan.summary.unassignedRoutes} بلا سائق · ${plan.summary.reductionPct != null ? `خفض مسافة ${plan.summary.reductionPct}% مقابل خط الأساس` : "لا مقارنة بخط الأساس"} (مسافات جوية — للطرق الفعلية: صفحة خطة الجمع الذكية)`;
    }),
    shortage: run("shortage", async () => {
      const munVehicles = vehicles.filter((v) => v.municipalityId === mid);
      const target = munVehicles.find((v) => v.id === session?.recommendedVehicleId) || munVehicles.find((v) => v.status === "available" || v.status === "on_route") || munVehicles[0];
      if (!target) throw new Error("لا مركبة في هذه البلدية لمحاكاة تعطلها");
      const state = { municipalityId: mid, municipalityName: municipalityById(mid)?.shortAr, neighborhoods: munNeighborhoods, bins: bins.filter((b) => b.municipalityId === mid), profiles: profiles.filter((p) => p.municipalityId === mid), vehicles: munVehicles, routes: routes.filter((r) => r.municipalityId === mid), incidents: incidents.filter((i) => i.municipalityId === mid) };
      const sc = { type: "vehicle_down", vehicleId: target.id };
      const r = simulateDecision(state, sc, { depot: DEFAULT_DEPOT });
      await saveSimulationScenario({ municipalityId: mid, scenario: sc, verdict: r.verdict, recommendation: r.recommendation, baseline: r.baseline, result: r.result, delta: r.delta, notes: r.notes, explanation: r.explanation, assumptions: r.assumptions, demoScenario: true, demo: state.bins.some((b) => b.demo) }, actor);
      await writeAuditLog("decision_simulated", actor.uid, actor.name, { municipalityId: mid, type: sc.type, verdict: r.verdict, demoScenario: true });
      // In the demo scene the breakdown also happens "for real" — but only to a demo vehicle, never to a real fleet row.
      let liveNote = "لم يُغيَّر وضع المركبة الفعلية (ليست صفًا تجريبيًا)";
      if (target.demo && target.status !== "maintenance") { await setVehicleStatusWithHistory(target.id, target.status, "maintenance", actor, "سيناريو العرض: تعطل محاكى"); await patch({ brokenVehicleId: target.id }); liveNote = `وأُخرجت ${target.vehicleNumber} (تجريبية) من الخدمة في المشهد فارتفع ضغط البلدية فعليًا`; }
      return `🧪 تعطل ${target.vehicleNumber}: ${r.recommendation} — غير مخدومة ${r.baseline.unserved} ← ${r.result.unserved} · ضغط ${r.baseline.pressure} ← ${r.result.pressure} (المحاكاة على نسخة معزولة؛ ${liveNote})`;
    }),
    recommend: run("recommend", async () => {
      const rec = city.transfersRec.recommendations.find((x) => x.toMunicipalityId === mid);
      if (!rec) { const p = city.pressures.find((x) => x.municipalityId === mid); const w = city.transfersRec.warnings.find((x) => x.startsWith(p?.name || "—")); throw new Error(w ? `لا نقل ممكن ضمن القيود: ${w}` : `ضغط ${p?.name || mid} الآن ${p?.index ?? "—"} (دون حد الدعم ${city.transfersRec.thresholds.shortageThreshold}) — ولّد أحداث امتلاء إضافية أو شغّل سيناريو النقص أولًا`); }
      const id = await proposeResourceTransfer(transferFromRecommendation(rec), actor);
      await writeAuditLog("transfer_proposed", actor.uid, actor.name, { transferId: id, from: rec.fromMunicipalityId, to: rec.toMunicipalityId, resource: rec.resourceLabel, demoScenario: true });
      return `🤝 ${rec.reason}`;
    }),
    transferApprove: run("transferApprove", async () => { const t = evaluation.transfer; if (!t || t.status !== "proposed") throw new Error("لا اقتراح نقل بانتظار الاعتماد"); await decideResourceTransfer(t, actor, "approved", "سيناريو العرض"); return `✅ اعتُمد نقل ${t.resourceLabel} — نفّذه لإعادة توطين المورد مؤقتًا`; }),
    transferExecute: run("transferExecute", async () => { const t = evaluation.transfer; if (!t || t.status !== "approved") throw new Error("لا نقل معتمد بانتظار التنفيذ"); await executeResourceTransfer(t, actor); return `🚚 نُفّذ النقل: ${t.resourceLabel} يعمل الآن ضمن ${municipalityById(t.toMunicipalityId)?.shortAr} مؤقتًا (يُعاد من بوابة متخذي القرار)`; }),
    pick: run("pick", async () => { await patch({ municipalityId: pickMid }); onNavigate && onNavigate("municipalities", { municipalityId: pickMid }); return `اختيرت ${municipalityById(pickMid)?.nameAr}`; }),
    fill: run("fill", async () => {
      const names = [];
      for (let i = 0; i < 3; i++) { const r = await fireSimulationEvent("critical_fill", { municipalityId: mid }, actor); names.push(r.bin.name); }
      requestDispatchCycle({ municipalityId: mid, trigger: "simulator_event" }).catch(() => {}); // server-side; a no-op while dispatch is off
      await patch({ firedEvents: (session?.firedEvents || 0) + 3 });
      return `🔴 امتلاء حرج: ${names.join("، ")}`;
    }),
    route: run("route", async () => {
      const ctx = makeBinContext(fireSensors, citizenReports, neighborhoods);
      const scored = bins.map((bin) => ({ bin, priority: getBinPriority(bin, null, [], ctx.forBin(bin)) }));
      const open = routes.filter((r) => ["suggested", "approved", "in_progress"].includes(r.status));
      const plan = reconcileRecommendations(neighborhoods, scored, open);
      await applyRouteReconciliation(plan, { municipalityIdFor: (nid) => municipalityForNeighborhood(neighborhoods.find((n) => n.id === nid)) });
      // pick the municipality's strongest suggestion (fresh read: the listener may lag a tick)
      const snap = await getDocs(query(collection(db, COLLECTIONS.COLLECTION_ROUTES), where("municipalityId", "==", mid)));
      const cands = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => r.status === "suggested").sort((a, b) => (b.totalPriorityScore || 0) - (a.totalPriorityScore || 0));
      if (!cands.length) throw new Error("لم تُقترح جولة في هذه البلدية — ولّد أحداث امتلاء أولًا");
      const r = cands[0];
      // optimize order (haversine matrix; OSRM table when reachable)
      const stopsPos = routeStopPositions(r, bins, neighborhoods).map((p) => ({ binId: p.binId, binName: p.binName, lat: p.pos[0], lng: p.pos[1], priorityTier: p.priorityTier, priorityScore: p.priorityScore, fillLevelPercent: p.bin.lastFillLevelPercent ?? null, wasteLiters: Math.round((Number(p.bin.capacityLiters) || 1100) * (Number(p.bin.lastFillLevelPercent) || 0) / 100) }));
      const veh = vehicles.find((v) => v.municipalityId === mid && v.status === "available") || vehicles.find((v) => v.status === "available") || null;
      const start = veh?.depotLat != null ? { lat: veh.depotLat, lng: veh.depotLng } : DEFAULT_DEPOT;
      const matrix = await fetchRoadMatrix([start, ...stopsPos]).catch(() => null);
      const opt = optimizeRoute({ start, stops: stopsPos, capacityLiters: Number(veh?.capacityLiters) || null, matrix: matrix || undefined });
      if (opt.ok) {
        const served = opt.orderedStops.filter((o) => o.type === "stop").map((o, i) => ({ order: i + 1, binId: o.binId, binName: o.binName, priorityTier: o.priorityTier, priorityScore: o.priorityScore ?? null, hasCoords: true, lat: o.lat, lng: o.lng, fillLevelPercent: o.fillLevelPercent ?? null, arrivalMin: o.arrivalMin ?? null, deferred: false }));
        const deferred = opt.deferredStops.map((d, i) => ({ order: served.length + i + 1, binId: d.binId, binName: d.binName, priorityTier: d.priorityTier, priorityScore: d.priorityScore ?? null, hasCoords: true, lat: d.lat, lng: d.lng, fillLevelPercent: d.fillLevelPercent ?? null, deferred: true }));
        await updateRoute(r.id, { orderedStops: [...served, ...deferred], binIds: [...served, ...deferred].map((o) => o.binId), estimatedDistanceKm: opt.totalDistanceKm, estimatedWasteLiters: opt.estimatedWasteLiters, optimization: { at: new Date().toISOString(), by: actor.uid, matrixSource: opt.matrixSource, confidence: opt.confidence, improvementPct: opt.objective.improvementPct, totalDurationMin: opt.totalDurationMin, trips: opt.trips, constraints: opt.constraints, deferredBinIds: deferred.map((d) => d.binId) } });
      }
      await patch({ routeId: r.id, routeName: r.routeName });
      return `🧭 ${r.routeName} — ${r.binIds?.length || 0} حاوية${opt.ok ? ` · مُحسّنة (${opt.matrixSource === "osrm" ? "طرق فعلية" : "تقدير"}, ${opt.totalDistanceKm} كم, ~${opt.totalDurationMin} د)` : ""}`;
    }),
    driver: run("driver", async () => {
      const route = routes.find((r) => r.id === session?.routeId); if (!route) throw new Error("لا جولة مختارة");
      // Make sure a demo driver of this municipality is ready: vehicle, coverage, on shift.
      let prof = profiles.find((p) => p.municipalityId === mid && p.demo) || profiles.find((p) => p.municipalityId === mid) || profiles[0];
      if (!prof) throw new Error("لا يوجد ملف سائق — أنشئ حسابات العرض (scripts/createDemoAccounts.mjs) وهيّئ ملف السائق");
      const veh = vehicles.find((v) => v.id === prof.vehicleId) || vehicles.find((v) => v.municipalityId === mid && v.status === "available") || vehicles.find((v) => v.status === "available");
      if (!prof.vehicleId && veh) await assignVehicleToDriver({ driverId: prof.uid, driverName: prof.fullName, vehicleId: veh.id, vehicleNumber: veh.vehicleNumber, start: new Date().toISOString(), end: null }, actor, "تهيئة سيناريو العرض");
      await updateDriverProfile(prof.uid, { neighborhoodKeys: munKeys, shiftStatus: "on_shift", availability: "available", locationSharing: true, accountStatus: "active" }, prof, actor, "تهيئة سيناريو العرض");
      const fresh = { ...prof, vehicleId: prof.vehicleId || veh?.id || null, neighborhoodKeys: munKeys, shiftStatus: "on_shift", availability: "available", accountStatus: "active" };
      const nName = neighborhoods.find((n) => (route.neighborhoodIds || []).includes(n.id))?.name || "";
      const stopsPos = routeStopPositions(route, bins, neighborhoods).map((p) => ({ ...p, lat: p.pos[0], lng: p.pos[1] }));
      const rec = rankDriverCandidates({ ...route, orderedStops: stopsPos }, { profiles: [fresh, ...profiles.filter((p) => p.uid !== fresh.uid)], vehicles, routes, neighborhoodName: nName, defaultOrigin: DEFAULT_DEPOT });
      if (!rec.recommended) throw new Error("لم يُرشَّح سائق: " + rec.warnings.join("، "));
      await patch({ driverId: rec.recommended.driverId, recommendedDriverName: rec.recommended.driverName, recommendedVehicleId: rec.recommended.vehicleId, recommendation: { reason: rec.recommended.reason, totalKm: rec.recommended.totalKm, totalMin: rec.recommended.totalMin, confidence: rec.recommended.confidence } });
      return `🧑‍✈️ المرشح: ${rec.recommended.driverName} — ${rec.recommended.vehicleNumber} · ${rec.recommended.reason}`;
    }),
    approve: run("approve", async () => {
      const route = routes.find((r) => r.id === session?.routeId); if (!route || !session?.driverId) throw new Error("أكمل الخطوتين السابقتين");
      await approveAndAssignRoute(route.id, actor.uid, { driverId: session.driverId, driverName: session.recommendedDriverName, vehicleId: session.recommendedVehicleId }, null);
      await writeAuditLog("route_assigned", actor.uid, actor.name, { routeId: route.id, routeName: route.routeName, driverId: session.driverId, vehicleId: session.recommendedVehicleId, demoScenario: true });
      await patch({ criticalBefore: evaluation.critical, routeCriticalBefore: bins.filter((b) => (route.binIds || []).includes(b.id) && Number(b.lastFillLevelPercent) >= 85 && Number(b.lastFillLevelPercent) <= 100).length, approvedAt: new Date().toISOString() });
      return `✅ اعتُمدت ${route.routeName} وأُسندت إلى ${session.recommendedDriverName} — تظهر الآن في حساب السائق`;
    }),
    reset: run("reset", async () => {
      if (!window.confirm("إعادة السيناريو من البداية: تُحذف الجلسة ويُعاد تثبيت مشهد المحاكاة بنفس الـseed (الصفوف التجريبية فقط). متابعة؟")) return "";
      const r = await resetSimulation({ neighborhoods, featuresByKey: FEATURE_BY_KEY, actor, withHistory: true, vehicleIds: vehicles.filter((v) => v.demo).map((v) => v.id) });
      const closed = await withdrawOpenSupportRequests(actor, "أُغلق عند إعادة سيناريو العرض");
      await setDoc(DEMO_SESSION_REF(), { startedAt: new Date().toISOString(), startedBy: actor.uid, completedKeys: [], firedEvents: 0, resetAt: new Date().toISOString() });
      return `🔁 أُعيد المشهد (${r.bins} حاوية)${closed ? ` · أُغلق ${closed} طلب دعم مفتوح` : ""} وبدأت جلسة جديدة`;
    }),
  };
  const actionFor = (key) => ({ city: actions.city, amanah: actions.amanah, pick: actions.pick, fill: actions.fill, plan: actions.plan, route: actions.route, driver: actions.driver, approve: actions.approve, shortage: actions.shortage, ...(isAmanah ? { recommend: actions.recommend, transferApprove: actions.transferApprove, transferExecute: actions.transferExecute } : {}) })[key];

  if (!canRun) return <EmptyState icon="🔒" title="غير مصرح" />;
  if (session === undefined) return <EmptyState icon="⏳" title="جاري التحميل…" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: C.text }}>🎬 وضع العرض — سيناريو لجنة التحكيم</div>
          <div style={{ fontSize: 12, color: C.dim }}>{DEMO_STEPS.length} خطوة: الأمانة ← البلدية ← الموظف ← السائق ← نقص الموارد ← النقل بين البلديات ← مؤشرات المدينة. الخطوات الإجرائية تُنفَّذ بزر؛ خطوات السائق ومتخذ القرار بالبلدية تُكتشف تلقائيًا من البيانات الحية. الحالة محفوظة في قاعدة البيانات فلا تضيع عند تحديث الصفحة.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!session && <button disabled={!!busy} onClick={actions.start} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: C.accent, color: "#07231A", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>▶️ بدء الجلسة</button>}
          {session && can(loggedInUser?.role, "municipalities.manage") && <button disabled={!!busy} onClick={actions.reset} style={{ padding: "9px 16px", borderRadius: 10, border: `1px solid ${C.danger}`, background: C.danger + "15", color: C.danger, fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>🔁 إعادة من البداية</button>}
        </div>
      </div>
      {msg && <div style={{ fontSize: 12, color: C.text, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px" }}>{msg}</div>}
      {session && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {DEMO_STEPS.map((st, i) => {
            const done = doneByKey[st.key]; const current = i === index;
            const ev = evaluation[st.key];
            const act = actionFor(st.key);
            return (
              <div key={st.key} style={{ display: "flex", gap: 12, alignItems: "center", background: current ? C.info + "12" : C.card, border: `1px solid ${done ? C.accent + "60" : current ? C.info : C.border}`, borderRadius: 12, padding: "10px 14px", flexWrap: "wrap" }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: done ? C.accent : current ? C.info : C.bg, color: done || current ? "#07231A" : C.dim, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }}>{done ? "✓" : i + 1}</div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{st.title}</div>
                  <div style={{ fontSize: 11.5, color: C.muted }}>{ev?.detail || st.hint}{st.kind === "observe" && !done ? " · يُكتشف تلقائيًا" : ""}</div>
                </div>
                {st.key === "pick" && !done && (
                  <select value={pickMid} onChange={(e) => setPickMid(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 12, fontFamily: ARABIC_FONT }}>{MUNICIPALITIES.map((m) => <option key={m.id} value={m.id}>{m.nameAr}</option>)}</select>
                )}
                {act && (current || (done && st.key === "city")) && <button disabled={!!busy || (!current && !done)} onClick={act} style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: C.info, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>{busy === st.key ? "…" : st.kind === "nav" ? "افتح" : "نفّذ"}</button>}
                {st.key === "support" && current && <span style={{ fontSize: 11.5, color: C.warning }}>🏛️ من حساب متخذ القرار بالبلدية ({mid ? `manager.${mid}@…` : ""}) في نافذة ثانية: البلديات والنطاقات → مؤشرات الأداء → «طلب دعم من الأمانة».</span>}
                {["recommend", "transferApprove", "transferExecute"].includes(st.key) && current && !isAmanah && <span style={{ fontSize: 11.5, color: C.warning }}>🏛️ من حساب متخذ القرار بالأمانة: بوابة متخذي القرار → القيادة الاستراتيجية.</span>}
                {st.key === "inbox" && current && <span style={{ fontSize: 11.5, color: C.warning }}>📱 سجّل دخول السائق ({profiles.find((p) => p.uid === session.driverId)?.email || "حساب السائق"}) على جهاز ثانٍ، ابدأ المناوبة ثم الجولة.</span>}
              </div>
            );
          })}
          {index >= DEMO_STEPS.length && <div style={{ background: C.accent + "15", border: `1px solid ${C.accent}60`, borderRadius: 12, padding: 14, fontSize: 13, color: C.accent, fontWeight: 700 }}>🎉 اكتمل السيناريو — {evaluation.indicators.detail}. يمكنك الإعادة من البداية.</div>}
        </div>
      )}
    </div>
  );
};

// ======================== SMART COLLECTION PLAN (Phase 4 — Municipal Collection Optimization Engine) ========================
const SmartPlanPage = ({ neighborhoods = [], bins = [], profiles = [], vehicles = [], routes = [], recentReadings = [], fireSensors = [], citizenReports = [], loggedInUser, onOpenRoute }) => {
  const scope = scopeFor(loggedInUser);
  const [mid, setMid] = useState(scope.all ? "east" : scope.municipalityId);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const { runs } = useOptimizationRuns(true, scope.all ? null : scope.municipalityId);
  const actor = { uid: loggedInUser?.uid, name: loggedInUser?.name };
  const munNeighborhoods = useMemo(() => neighborhoods.filter((n) => municipalityForNeighborhood(n) === mid), [neighborhoods, mid]);
  const nIds = useMemo(() => new Set(munNeighborhoods.map((n) => n.id)), [munNeighborhoods]);
  const munBins = useMemo(() => bins.filter((b) => nIds.has(b.neighborhoodId)), [bins, nIds]);
  const munProfiles = profiles.filter((p) => p.municipalityId === mid);
  const munVehicles = vehicles.filter((v) => v.municipalityId === mid);
  const munRoutes = routes.filter((r) => r.municipalityId === mid);
  const depot = useMemo(() => { const v = munVehicles.find((x) => x.depotLat != null); return v ? { lat: v.depotLat, lng: v.depotLng, label: v.depotLabel || "مستودع المركبة" } : DEFAULT_DEPOT; }, [munVehicles]);

  const build = async () => {
    setBusy("build"); setMsg("");
    try {
      const readingsByBin = {}; for (const r of recentReadings) { if (r.bin_id) (readingsByBin[r.bin_id] ||= []).push(r); }
      const ctx = makeBinContext(fireSensors, citizenReports, munNeighborhoods);
      const base = { municipalityId: mid, neighborhoods: munNeighborhoods, bins: munBins, profiles: munProfiles, vehicles: munVehicles, routes: munRoutes, readingsByBin, contextFor: ctx.forBin, depot };
      // Pass 1 (Haversine) decides the stop sets; pass 2 re-optimizes each route on a real OSRM time matrix when reachable.
      const first = buildCollectionPlan(base);
      const matrixByNeighborhood = {};
      await Promise.all(first.routes.map(async (r) => {
        const pts = [depot, ...r.stops.filter((s) => s.lat != null).map((s) => ({ lat: s.lat, lng: s.lng }))];
        const m = await fetchRoadMatrix(pts).catch(() => null);
        if (m) matrixByNeighborhood[r.neighborhoodId] = m;
      }));
      const p = buildCollectionPlan({ ...base, matrixByNeighborhood });
      setPlan(p);
      await saveOptimizationRun({ municipalityId: mid, summary: p.summary, constraints: p.constraints, routes: p.routes.map((r) => ({ neighborhoodId: r.neighborhoodId, neighborhoodName: r.neighborhoodName, stops: r.stops.length, deferred: r.deferredStops.length, distanceKm: r.distanceKm, durationMin: r.durationMin, matrixSource: r.matrixSource, driver: r.driver ? { driverId: r.driver.driverId, driverName: r.driver.driverName, vehicleNumber: r.driver.vehicleNumber } : null })), assumptions: p.assumptions, demo: munBins.some((b) => b.demo) }, actor);
      setMsg(`✅ خُطّطت ${p.routes.length} جولة لـ ${p.summary.served} حاوية${p.summary.unassignedRoutes ? ` · ${p.summary.unassignedRoutes} بلا سائق` : ""}${p.summary.deferred ? ` · ${p.summary.deferred} مؤجلة` : ""}`);
    } catch (e) { setMsg("تعذر تنفيذ العملية: " + friendlyError(e)); } finally { setBusy(""); }
  };

  /** Writes the plan as SUGGESTED routes (withdrawing older suggestions of the same neighborhoods) — nothing is dispatched until approval. */
  const apply = async () => {
    if (!plan) return;
    setBusy("apply"); setMsg("");
    try {
      const toWithdraw = munRoutes.filter((r) => r.status === "suggested" && plan.routes.some((pr) => pr.neighborhoodId === (r.neighborhoodIds || [])[0])).map((r) => r.id);
      const toCreate = plan.routes.map((r) => {
        const stops = [...r.stops.map((s, i) => ({ order: i + 1, binId: s.binId, binName: s.binName, priorityTier: s.priorityTier, priorityScore: s.priorityScore ?? null, hasCoords: s.lat != null, lat: s.lat ?? null, lng: s.lng ?? null, fillLevelPercent: s.fillLevelPercent ?? null, arrivalMin: s.arrivalMin ?? null, deferred: false })), ...r.deferredStops.map((s, i) => ({ order: r.stops.length + i + 1, binId: s.binId, binName: s.binName, priorityTier: s.priorityTier, priorityScore: s.priorityScore ?? null, hasCoords: s.lat != null, lat: s.lat ?? null, lng: s.lng ?? null, fillLevelPercent: s.fillLevelPercent ?? null, deferred: true }))];
        return { routeName: `خطة ذكية — ${r.neighborhoodName}`, neighborhoodIds: [r.neighborhoodId], binIds: stops.map((s) => s.binId), orderedStops: stops, priorityTier: r.priorityTier, totalPriorityScore: r.totalPriorityScore, estimatedDistanceKm: r.distanceKm, estimatedWasteLiters: r.wasteLiters, reasons: r.reasons, status: "suggested", manualBinIds: [], municipalityId: mid,
          optimization: { at: plan.generatedAt, by: actor.uid, matrixSource: r.matrixSource, confidence: r.confidence, totalDurationMin: r.durationMin, trips: r.trips, constraints: r.constraints, deferredBinIds: r.deferredStops.map((d) => d.binId), planner: true },
          recommendedDriver: r.driver ? { driverId: r.driver.driverId, driverName: r.driver.driverName, vehicleId: r.driver.vehicleId, vehicleNumber: r.driver.vehicleNumber, reason: r.driver.reason, capacityShortfall: r.driver.capacityShortfall } : null, createdAt: new Date().toISOString() };
      });
      const res = await applyRouteReconciliation({ toCreate, toUpdate: [], toWithdraw }, { planner: true });
      await writeAuditLog("plan_applied", actor.uid, actor.name, { municipalityId: mid, created: res.created, withdrawn: res.withdrawn, served: plan.summary.served });
      setMsg(`✅ أُنشئت ${res.created} جولة مقترحة من الخطة (سُحب ${res.withdrawn} اقتراح قديم) — اعتمد الإسناد المقترح لكل جولة`);
    } catch (e) { setMsg("تعذر تنفيذ العملية: " + friendlyError(e)); } finally { setBusy(""); }
  };

  const approveSuggested = async (route) => {
    const rec = route.recommendedDriver; if (!rec) return;
    const conflicts = findRouteAssignmentConflicts({ routeId: route.id, driverId: rec.driverId, vehicleId: rec.vehicleId }, routes);
    if (conflicts.length) { alert(conflicts.map((c) => c.message).join("\n")); return; }
    setBusy(route.id);
    try {
      await approveAndAssignRoute(route.id, actor.uid, { driverId: rec.driverId, driverName: rec.driverName, vehicleId: rec.vehicleId }, rec.capacityShortfall ? { reason: "إسناد مع تحذير سعة من الخطة الذكية" } : null);
      await writeAuditLog("route_assigned", actor.uid, actor.name, { routeId: route.id, routeName: route.routeName, driverId: rec.driverId, vehicleId: rec.vehicleId, source: "smart_plan" });
    } finally { setBusy(""); }
  };

  const plannedSuggested = munRoutes.filter((r) => r.status === "suggested" && r.optimization?.planner);
  const conf = { high: ["عالية", C.accent], medium: ["متوسطة", C.warning], low: ["منخفضة", C.dim], none: ["—", C.dim] };
  if (!can(loggedInUser?.role, "plan.create")) return <EmptyState icon="🔒" title="غير مصرح" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: C.text }}>🧠 خطة الجمع الذكية — {municipalityById(mid)?.nameAr || "—"}</div>
          <div style={{ fontSize: 12, color: C.dim }}>محرك تخطيط الجمع البلدي: الحاويات المؤهلة (امتلاء + تنبؤ + بلاغات) → جولات لكل حي → ترتيب محسَّن بقيود السعة على أزمنة الطرق → السائق المرشح → مؤشرات وقيود.</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {scope.all && <select value={mid} onChange={(e) => { setMid(e.target.value); setPlan(null); }} style={{ padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 12, fontFamily: ARABIC_FONT }}>{MUNICIPALITIES.map((m) => <option key={m.id} value={m.id}>{m.nameAr}</option>)}</select>}
          <button disabled={!!busy} onClick={build} style={{ padding: "11px 20px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: ARABIC_FONT }}>{busy === "build" ? "جاري الحساب…" : "⚡ إنشاء خطة الجمع الذكية"}</button>
        </div>
      </div>
      {msg && <div style={{ fontSize: 12, color: C.text, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px" }}>{msg}</div>}

      {!plan ? (
        <Card title="بانتظار إنشاء الخطة" icon={<Target size={16} color={C.muted} />}>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.9 }}>{munBins.length} حاوية · {munNeighborhoods.length} حي · {munProfiles.filter((p) => p.shiftStatus === "on_shift").length} سائق في المناوبة · {munVehicles.filter((v) => v.status === "available").length} مركبة متاحة · {munRoutes.filter((r) => ["approved", "in_progress"].includes(r.status)).length} جولة معتمدة/نشطة.</div>
          {plannedSuggested.length > 0 && <div style={{ fontSize: 12, color: C.info, marginTop: 6 }}>توجد {plannedSuggested.length} جولة مقترحة من خطة سابقة بانتظار الاعتماد (أدناه).</div>}
        </Card>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            {[["تحتاج جمعًا", plan.summary.needCollection, C.danger], ["جولات", plan.summary.routes, C.info], ["حاويات مخدومة", plan.summary.served, C.accent], ["مؤجلة (سعة)", plan.summary.deferred, plan.summary.deferred ? C.warning : C.dim], ["بلا سائق", plan.summary.unassignedRoutes, plan.summary.unassignedRoutes ? C.danger : C.dim], ["مستبعدة (مستشعر)", plan.summary.excluded, plan.summary.excluded ? C.warning : C.dim], ["المسافة", `${plan.summary.totalKm} كم`, C.text], ["الزمن", `${plan.summary.totalMin} د`, C.text], ["النفايات المتوقعة", `${plan.summary.totalWasteLiters} لتر`, C.purple], ["الثقة", conf[plan.summary.confidence][0], conf[plan.summary.confidence][1]]].map(([l, v, c]) => (
              <div key={l} style={{ background: C.card, border: `1px solid ${c}30`, borderRadius: 12, padding: "10px 12px" }}><div style={{ fontSize: 20, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 11, color: C.muted }}>{l}</div></div>
            ))}
          </div>
          {plan.summary.reductionPct != null ? (
            <div style={{ fontSize: 12, color: C.muted, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px" }}>مقارنة عادلة بخط الأساس (جولة لكل حي من نفس المستودع تزور كل حاوياته، مسافات جوية للطرفين): {plan.summary.baselineKm} كم ← {plan.summary.totalKm} كم (توفير {plan.summary.kmSaved} كم ≈ {plan.summary.reductionPct}% · وقود تقديري {plan.summary.fuelSavedL} لتر بافتراض {plan.assumptions.truckFuelLitersPerKm} لتر/كم).</div>
          ) : <div style={{ fontSize: 12, color: C.dim }}>لا تُعرض نسبة توفير: البيانات غير كافية للمقارنة.</div>}
          {plan.constraints.length > 0 && <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12, color: C.warning, lineHeight: 1.9 }}>{plan.constraints.map((c, i) => <li key={i}>{c}</li>)}</ul>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {plan.routes.map((r) => (
              <div key={r.neighborhoodId} style={{ background: C.card, border: `1px solid ${r.driver ? C.border : C.danger + "60"}`, borderRadius: 12, padding: 12, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><b style={{ color: C.text, fontSize: 14 }}>{r.routeName}</b><span style={{ color: conf[r.confidence][1] }}>ثقة {conf[r.confidence][0]} · {r.matrixSource === "osrm" ? "طرق فعلية" : "تقدير جوي"}</span></div>
                <div style={{ color: C.muted, marginTop: 4, lineHeight: 1.8 }}>{explainRoute(r)}</div>
                <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>{r.stops.map((s) => `#${s.order} ${s.binName}${s.arrivalMin != null ? ` (${s.arrivalMin} د)` : ""}`).join(" ← ")}{r.deferredStops.length ? ` · مؤجلة: ${r.deferredStops.map((d) => d.binName).join("، ")}` : ""}</div>
                {r.constraints.length > 0 && <div style={{ color: C.warning, fontSize: 11, marginTop: 4 }}>{r.constraints.join(" · ")}</div>}
              </div>
            ))}
          </div>
          {plan.excluded.length > 0 && <Card title={`حاويات حرجة/مرتفعة مستبعدة من الجمع التلقائي (${plan.excluded.length})`} icon={<AlertTriangle size={16} color={C.muted} />}><div style={{ fontSize: 12, color: C.muted, lineHeight: 1.9 }}>{plan.excluded.map((e) => `${e.binName}: ${e.reason}`).join(" · ")}</div></Card>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={!!busy || plan.routes.length === 0} onClick={apply} style={{ padding: "11px 20px", borderRadius: 10, border: "none", background: C.info, color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: ARABIC_FONT }}>{busy === "apply" ? "…" : "📋 اعتماد الخطة كجولات مقترحة"}</button>
            <span style={{ fontSize: 11, color: C.dim, alignSelf: "center" }}>لا تُرسل أي مركبة تلقائيًا: الاعتماد والإسناد قرار بشري لكل جولة.</span>
          </div>
        </>
      )}

      {plannedSuggested.length > 0 && (
        <Card title={`جولات مقترحة من الخطة بانتظار الإسناد (${plannedSuggested.length})`} icon={<RouteIcon size={16} color={C.muted} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {plannedSuggested.map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", background: C.bg, borderRadius: 10, padding: "10px 12px", fontSize: 12, flexWrap: "wrap" }}>
                <div><b style={{ color: C.text }}>{r.routeName}</b> · {r.binIds?.length || 0} حاوية · {r.estimatedDistanceKm} كم{r.optimization?.totalDurationMin ? ` · ~${r.optimization.totalDurationMin} د` : ""}<div style={{ color: C.muted }}>{r.recommendedDriver ? `السائق المقترح: ${r.recommendedDriver.driverName} — ${r.recommendedDriver.vehicleNumber} · ${r.recommendedDriver.reason}` : "لا سائق مؤهل — افتح الجولة للإسناد الاستثنائي"}</div></div>
                <div style={{ display: "flex", gap: 6 }}>
                  {r.recommendedDriver && <button disabled={busy === r.id} onClick={() => approveSuggested(r)} style={smallBtn(C.accent, true)}>اعتماد الإسناد المقترح</button>}
                  {onOpenRoute && <button onClick={() => onOpenRoute(r.id)} style={smallBtn(C.info)}>فتح الجولة</button>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(runs || []).length > 0 && (
        <Card title="سجل عمليات التخطيط" icon={<ClipboardList size={16} color={C.muted} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
            {(runs || []).filter((x) => x.municipalityId === mid).slice(0, 10).map((x) => <div key={x.id} style={{ fontSize: 11.5, color: C.muted, background: C.bg, borderRadius: 6, padding: "6px 10px" }}>{getReadingAgeLabel(x.createdAt)} · {x.createdByName || "—"} · {x.summary?.routes} جولة · {x.summary?.served} حاوية · {x.summary?.totalKm} كم · ثقة {conf[x.summary?.confidence || "none"][0]}</div>)}
          </div>
        </Card>
      )}
    </div>
  );
};

// ======================== DRIVERS & FLEET (Phase 1) ========================
const NEIGHBORHOOD_KEYS = buraidahNeighborhoodsGeo.features.map((f) => f.properties.baseName);
const inputSt = { width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, fontFamily: ARABIC_FONT, boxSizing: "border-box" };
const smallBtn = (color, filled = false) => ({ padding: "6px 12px", borderRadius: 8, border: filled ? "none" : `1px solid ${color}`, background: filled ? color : color + "15", color: filled ? "#07231A" : color, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: ARABIC_FONT });

const DriversPage = ({ profiles = [], assignments = [], vehicles = [], loggedInUser }) => {
  const usersScope = scopeFor(loggedInUser);
  const { data: scopedUsers } = useScopedCollection(COLLECTIONS.USERS, { municipalityId: usersScope.all ? null : usersScope.municipalityId || "__none__" });
  const driverUsers = useMemo(() => (scopedUsers || []).filter((u) => u.role === "driver"), [scopedUsers]);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({ vehicleId: "", start: new Date().toISOString().slice(0, 16), end: "" });
  const { data: history } = useDriverAssignmentHistory(selectedId);
  const actor = { uid: loggedInUser?.uid, name: loggedInUser?.name || loggedInUser?.email || "موظف" };
  const canManage = can(loggedInUser?.role, "drivers.manage");

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.uid || p.id, p])), [profiles]);
  const rows = useMemo(() => (driverUsers || []).map((u) => ({ user: u, profile: profileById.get(u.uid || u.id) || null })), [driverUsers, profileById]);
  const selected = rows.find((r) => (r.user.uid || r.user.id) === selectedId) || null;
  const selectedProfile = selected?.profile || null;
  const activeAssignment = selectedProfile ? activeAssignmentFor(selectedProfile.uid, assignments) : null;
  const matrix = useMemo(() => coverageMatrix(NEIGHBORHOOD_KEYS, profiles), [profiles]);
  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);

  // Reset the form when the selected driver changes (derived state during render — no effect cascade).
  const [formFor, setFormFor] = useState(null);
  const formKey = selectedProfile ? `${selectedProfile.uid}:${selectedProfile.updatedAt || ""}` : null;
  if (formKey !== formFor) {
    setFormFor(formKey);
    setForm(selectedProfile ? { fullName: selectedProfile.fullName || "", phone: selectedProfile.phone || "", neighborhoodKeys: selectedProfile.neighborhoodKeys || [], shiftStart: selectedProfile.shiftStart || "", shiftEnd: selectedProfile.shiftEnd || "" } : null);
    setErrors([]);
    if (selectedProfile) setVehicleForm((f) => ({ ...f, vehicleId: selectedProfile.vehicleId || "" }));
  }

  const kpis = {
    total: rows.length,
    onShift: profiles.filter((p) => p.shiftStatus === "on_shift").length,
    available: profiles.filter((p) => p.shiftStatus === "on_shift" && p.availability === "available").length,
    activeVehicles: vehicles.filter((v) => v.status === "on_route").length,
    uncovered: NEIGHBORHOOD_KEYS.filter((k) => (matrix[k] || []).length === 0).length,
  };

  const createProfile = async (u) => { setBusy(true); try { await ensureDriverProfile({ ...u, uid: u.uid || u.id }); setSelectedId(u.uid || u.id); } finally { setBusy(false); } };

  const saveProfile = async () => {
    const v = validateDriverProfile(form, { knownNeighborhoodKeys: NEIGHBORHOOD_KEYS });
    setErrors(v.errors);
    if (!v.ok) return;
    const reason = window.prompt("سبب التعديل (يُحفظ في سجل التغييرات):", "") ?? "";
    setBusy(true);
    try {
      await updateDriverProfile(selectedProfile.uid, { ...v.value, driverCode: selectedProfile.driverCode || driverCodeFor(selectedProfile.uid), accountStatus: selected.user.status || selectedProfile.accountStatus }, selectedProfile, actor, reason);
    } finally { setBusy(false); }
  };

  const vehicleConflicts = vehicleForm.vehicleId && selectedProfile
    ? findVehicleAssignmentConflicts({ driverId: selectedProfile.uid, vehicleId: vehicleForm.vehicleId, start: vehicleForm.start, end: vehicleForm.end || null }, assignments)
    : [];
  const assignVehicle = async () => {
    if (!vehicleForm.vehicleId || vehicleConflicts.length) return;
    const reason = window.prompt("سبب الإسناد (اختياري):", "") ?? "";
    setBusy(true);
    try {
      if (activeAssignment) await endVehicleAssignment(activeAssignment, actor, "استبدال بمركبة أخرى");
      const v = vehicleById.get(vehicleForm.vehicleId);
      await assignVehicleToDriver({ driverId: selectedProfile.uid, driverName: selectedProfile.fullName, vehicleId: v.id, vehicleNumber: v.vehicleNumber, start: new Date(vehicleForm.start).toISOString(), end: vehicleForm.end ? new Date(vehicleForm.end).toISOString() : null }, actor, reason);
    } finally { setBusy(false); }
  };

  if (!canManage) return <EmptyState icon="🔒" title="غير مصرح" desc="إدارة السائقين متاحة للموظفين والإدارة فقط." />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {[["السائقون", kpis.total, C.info], ["في المناوبة", kpis.onShift, C.accent], ["متاحون الآن", kpis.available, C.accent], ["مركبات في جولة", kpis.activeVehicles, C.purple], ["أحياء بلا تغطية", kpis.uncovered, kpis.uncovered ? C.warning : C.dim]].map(([l, v, c]) => (
          <div key={l} style={{ background: C.card, border: `1px solid ${c}30`, borderRadius: 12, padding: "12px 14px" }}><div style={{ fontSize: 24, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 11, color: C.muted }}>{l}</div></div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(320px, 1.4fr)", gap: 16 }}>
        <Card title="السائقون" icon={<Users size={16} color={C.muted} />}>
          {rows.length === 0 ? <EmptyState icon="🚛" title="لا توجد حسابات بدور سائق بعد" desc="يسجل السائق حسابه من شاشة التسجيل بدور «سائق ميداني»، ثم يُفعَّل من إدارة المستخدمين ويُهيأ ملفه هنا." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {rows.map(({ user: u, profile: p }) => {
                const uid = u.uid || u.id;
                const v = p?.vehicleId ? vehicleById.get(p.vehicleId) : null;
                const fresh = locationFreshness(p?.lastLocation);
                return (
                  <div key={uid} onClick={() => p && setSelectedId(uid)} style={{ padding: "10px 12px", borderRadius: 10, background: selectedId === uid ? C.info + "15" : C.bg, border: `1px solid ${selectedId === uid ? C.info : C.border}`, cursor: p ? "pointer" : "default", fontSize: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div>
                        <b style={{ color: C.text }}>{p?.fullName || u.fullName}</b> <span style={{ color: C.dim, fontSize: 10.5 }}>{p?.driverCode || ""}</span>
                        <div style={{ color: C.muted, fontSize: 11 }}>{u.email} · حساب: {u.status === "active" ? "مفعّل" : u.status === "pending" ? "بانتظار التفعيل" : u.status}</div>
                      </div>
                      {p ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, background: (p.shiftStatus === "on_shift" ? C.accent : C.dim) + "20", color: p.shiftStatus === "on_shift" ? C.accent : C.dim }}>{SHIFT_STATUS_LABELS[p.shiftStatus] || p.shiftStatus}</span>
                          <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, background: C.info + "20", color: C.info }}>{v ? v.vehicleNumber : "بلا مركبة"}</span>
                          {fresh.state !== "none" && <span style={{ fontSize: 10.5, color: fresh.state === "live" ? C.accent : C.warning }}>📍 {fresh.state === "live" ? "موقع مباشر" : `آخر موقع قبل ${fresh.ageMin} د`}</span>}
                        </div>
                      ) : (
                        <button disabled={busy} onClick={(e) => { e.stopPropagation(); createProfile(u); }} style={smallBtn(C.accent, true)}>تهيئة ملف السائق</button>
                      )}
                    </div>
                    {p && <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>النطاق: {(p.neighborhoodKeys || []).length ? p.neighborhoodKeys.map((k) => `حي ${k}`).join("، ") : "غير محدد"}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title={selectedProfile ? `ملف السائق — ${selectedProfile.fullName}` : "اختر سائقًا"} icon={<HardHat size={16} color={C.muted} />}>
          {!selectedProfile || !form ? <EmptyState icon="👈" title="اختر سائقًا من القائمة لتعديل مركبته ونطاقه" /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label>الاسم<input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} style={inputSt} /></label>
                <label>الهاتف<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={inputSt} dir="ltr" /></label>
                <label>بداية المناوبة اليومية<input type="time" value={form.shiftStart} onChange={(e) => setForm({ ...form, shiftStart: e.target.value })} style={inputSt} /></label>
                <label>نهاية المناوبة<input type="time" value={form.shiftEnd} onChange={(e) => setForm({ ...form, shiftEnd: e.target.value })} style={inputSt} /></label>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>نطاق الأحياء المصرح بتغطيتها (من حدود بريدة)</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {NEIGHBORHOOD_KEYS.map((k) => {
                    const on = form.neighborhoodKeys.includes(k);
                    return <button key={k} type="button" onClick={() => setForm({ ...form, neighborhoodKeys: on ? form.neighborhoodKeys.filter((x) => x !== k) : [...form.neighborhoodKeys, k] })} style={{ ...smallBtn(on ? C.accent : C.dim), background: on ? C.accent + "25" : "transparent" }}>{on ? "✓ " : ""}حي {k}</button>;
                  })}
                </div>
              </div>
              {errors.length > 0 && <div style={{ color: C.danger, fontSize: 11.5 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div>}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button disabled={busy} onClick={saveProfile} style={smallBtn(C.accent, true)}>حفظ الملف</button>
                <span style={{ color: C.dim, fontSize: 11 }}>الحالة: {SHIFT_STATUS_LABELS[selectedProfile.shiftStatus]} · {AVAILABILITY_LABELS[selectedProfile.availability] || "—"} · الحساب: {selected.user.status === "active" ? "مفعّل" : "غير مفعّل (فعّله من إدارة المستخدمين)"}</span>
              </div>

              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>🚛 المركبة المسندة</div>
                {activeAssignment ? (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: C.bg, borderRadius: 8, padding: "8px 12px", marginBottom: 8, flexWrap: "wrap" }}>
                    <span><b style={{ color: C.text }}>{activeAssignment.vehicleNumber || vehicleById.get(activeAssignment.vehicleId)?.vehicleNumber}</b> <span style={{ color: C.dim }}>· منذ {new Date(activeAssignment.start).toLocaleString("ar-SA")} {activeAssignment.end ? `حتى ${new Date(activeAssignment.end).toLocaleString("ar-SA")}` : "(مفتوح)"}</span></span>
                    <button disabled={busy} onClick={async () => { const r = window.prompt("سبب إنهاء الإسناد:", "") ?? ""; setBusy(true); try { await endVehicleAssignment(activeAssignment, actor, r); } finally { setBusy(false); } }} style={smallBtn(C.danger)}>إنهاء الإسناد</button>
                  </div>
                ) : <div style={{ color: C.warning, marginBottom: 8 }}>لا توجد مركبة مسندة حاليًا.</div>}
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 8 }}>
                  <select value={vehicleForm.vehicleId} onChange={(e) => setVehicleForm({ ...vehicleForm, vehicleId: e.target.value })} style={inputSt}>
                    <option value="">اختر مركبة…</option>
                    {vehicles.map((v) => { const holder = vehicleHolderAt(v.id, assignments); return <option key={v.id} value={v.id}>{v.vehicleNumber} — {VEHICLE_STATUS_LABELS[v.status] || v.status}{holder && holder.driverId !== selectedProfile.uid ? ` (مع ${holder.driverName || "سائق آخر"})` : ""}</option>; })}
                  </select>
                  <input type="datetime-local" value={vehicleForm.start} onChange={(e) => setVehicleForm({ ...vehicleForm, start: e.target.value })} style={inputSt} title="بداية نافذة الإسناد" />
                  <input type="datetime-local" value={vehicleForm.end} onChange={(e) => setVehicleForm({ ...vehicleForm, end: e.target.value })} style={inputSt} title="نهاية النافذة (اتركها فارغة للإسناد المفتوح)" />
                </div>
                {vehicleConflicts.length > 0 && <div style={{ color: C.danger, fontSize: 11.5, marginTop: 6 }}>{vehicleConflicts.map((c, i) => <div key={i}>⛔ {c.message}</div>)}</div>}
                <button disabled={busy || !vehicleForm.vehicleId || vehicleConflicts.length > 0} onClick={assignVehicle} style={{ ...smallBtn(C.info, true), color: "#fff", marginTop: 8, opacity: !vehicleForm.vehicleId || vehicleConflicts.length ? 0.5 : 1 }}>إسناد المركبة</button>
              </div>

              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>📜 سجل التغييرات</div>
                {(history || []).length === 0 ? <div style={{ color: C.dim }}>لا تغييرات مسجلة بعد.</div> : (
                  <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                    {[...history].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).map((h) => (
                      <div key={h.id} style={{ fontSize: 11, color: C.muted, background: C.bg, borderRadius: 6, padding: "6px 10px" }}>
                        <b style={{ color: C.text }}>{h.actorName || "—"}</b> · {getReadingAgeLabel(h.createdAt)} · عدّل: {(h.fields || []).join("، ")}{h.reason ? ` · السبب: ${h.reason}` : ""}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title="🗺️ تغطية الأحياء — من يغطي كل حي؟" icon={<MapGlyph size={16} color={C.muted} />}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
          {NEIGHBORHOOD_KEYS.map((k) => {
            const ds = matrix[k] || [];
            const ready = ds.filter((p) => p.shiftStatus === "on_shift" && p.availability === "available" && p.vehicleId);
            return (
              <div key={k} style={{ background: C.bg, border: `1px solid ${ds.length === 0 ? C.warning + "60" : ready.length ? C.accent + "40" : C.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><b style={{ color: C.text }}>حي {k}</b><span style={{ color: ds.length === 0 ? C.warning : ready.length ? C.accent : C.muted, fontSize: 11 }}>{ds.length === 0 ? "بلا تغطية" : `${ready.length} جاهز / ${ds.length}`}</span></div>
                <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{ds.length ? ds.map((p) => `${p.fullName}${p.vehicleId ? ` (${vehicleById.get(p.vehicleId)?.vehicleNumber || "مركبة"})` : ""}`).join("، ") : "—"}</div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

const AuditLogPage = ({ auditLog = [] }) => {
  const [search, setSearch] = useState("");
  const rows = [...auditLog].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const filtered = search
    ? rows.filter((r) => (AUDIT_ACTION_LABELS[r.action] || r.action).includes(search) || (r.actorName || "").includes(search))
    : rows;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, color: C.muted }}>سجل بكل العمليات المهمة على الجولات والمركبات — من فعل ماذا ومتى (§37).</div>
      <div style={{ position: "relative", maxWidth: 320 }}>
        <Search size={15} color={C.dim} style={{ position: "absolute", insetInlineStart: 12, top: "50%", transform: "translateY(-50%)" }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بنوع العملية أو اسم المنفّذ…"
          style={{ width: "100%", padding: "9px 36px 9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 13, fontFamily: ARABIC_FONT }} />
      </div>
      {filtered.length === 0 ? <EmptyState icon="📜" title="لا توجد عمليات مسجّلة بعد" /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map((r) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12 }}>
              <div>
                <b style={{ color: C.text }}>{AUDIT_ACTION_LABELS[r.action] || r.action}</b>
                <span style={{ color: C.dim }}> — {r.actorName || "غير معروف"}</span>
                {r.details?.routeName && <span style={{ color: C.muted }}> · {r.details.routeName}</span>}
              </div>
              <span style={{ color: C.dim, fontSize: 11 }}>{getReadingAgeLabel(r.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ======================== AUTONOMOUS DISPATCH — operations center + Amanah settings ========================
const DISPATCH_STATUS = {
  executed: ["نُفّذ تلقائيًا", "ok"], observed: ["توصية — لم تُنفَّذ (مراقبة)", "info"], open: ["يحتاج قرارك", "danger"],
  resolved: ["عولج", "ok"], dismissed: ["تُجوهل", "neutral"], rejected_at_commit: ["رُفض عند التنفيذ", "warning"],
};
const DispatchModeBadge = ({ settings }) => {
  const s = { ...DEFAULT_DISPATCH_SETTINGS, ...(settings || {}) };
  const tone = s.mode === "auto" ? "ok" : s.mode === "observe" ? "info" : "neutral";
  return <Badge tone={tone} solid={s.mode === "auto"}>{s.mode === "auto" ? "🤖 " : ""}{DISPATCH_MODES[s.mode] || s.mode}{s.mode !== "off" ? ` · ${s.scope === "all" ? "كل الحاويات" : "بيئة العرض فقط"}` : ""}</Badge>;
};

const DispatchCenter = ({ loggedInUser, onOpenRoute }) => {
  const scope = scopeFor(loggedInUser);
  const mid = scope.all ? null : scope.municipalityId;
  const { settings } = useDispatchSettings(true);
  const { decisions } = useDispatchDecisions(true, mid);
  const { runs } = useDispatchRuns(true, 10);
  const [tab, setTab] = useState("attention");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const actor = { uid: loggedInUser?.uid, name: loggedInUser?.name };
  const s = { ...DEFAULT_DISPATCH_SETTINGS, ...(settings || {}) };
  const escalations = decisions.filter((d) => d.type === "escalate" && (d.status === "open" || d.status === "observed"));
  const log = decisions.filter((d) => d.type !== "escalate").slice(0, 40);
  const runNow = async () => {
    setBusy("run"); setMsg("");
    try {
      const r = await requestDispatchCycle({ municipalityId: mid, trigger: "manual" });
      if (r.skipped) setMsg(r.skipped === "off" ? "الإسناد التلقائي متوقف من الإعدادات." : "لم يحن موعد الدورة.");
      else { const t = Object.values(r.municipalities || {}).reduce((a, x) => ({ c: a.c + x.created, i: a.i + x.inserted, e: a.e + x.escalated, x: a.x + x.executed, o: a.o + x.observed }), { c: 0, i: 0, e: 0, x: 0, o: 0 });
        setMsg(r.mode === "auto" ? `اكتملت الدورة: ${t.x} قرار نُفّذ (${t.c} جولة جديدة، ${t.i} إضافة)، ${t.e} حالة رُفعت لك.` : `اكتملت دورة المراقبة: ${t.o} توصية سُجلت دون تنفيذ، ${t.e} حالة استثنائية.`); }
    } catch (e) { setMsg("تعذر تشغيل الدورة: " + friendlyError(e)); } finally { setBusy(""); }
  };
  const close = (d, status) => async () => {
    const note = window.prompt(status === "resolved" ? "كيف عولجت الحالة؟" : "سبب التجاهل:", "") ?? null; if (note === null) return;
    setBusy(d.id); try { await resolveDispatchDecision(d.id, actor, status, note); await writeAuditLog("dispatch_escalation_closed", actor.uid, actor.name, { decisionId: d.id, status, kind: d.kind }); } finally { setBusy(""); }
  };
  const items = escalations.map((d) => ({
    id: d.id, tone: d.status === "open" ? (["thermal", "vehicle_down", "driver_unavailable"].includes(d.kind) ? "danger" : "warning") : "info",
    title: `${ESCALATION_LABELS[d.kind] || d.kind}${d.routeName ? ` — ${d.routeName}` : ""}`,
    meta: `${(d.binIds || []).length} حاوية · ${getReadingAgeLabel(d.createdAt)}${d.status === "observed" ? " · وضع المراقبة: كان سيُرفع لك" : ""}`,
    badge: d.status === "observed" ? <Badge tone="info">مراقبة</Badge> : null,
    detail: <div><div>{d.reason}</div>{d.suggestion && <div style={{ color: C.text, marginTop: 4 }}><b>المقترح:</b> {d.suggestion}</div>}{(d.alternatives || []).length > 0 && <div style={{ marginTop: 4 }}>البدائل: {d.alternatives.map((a) => `${a.driverName} (${a.why})`).join(" · ")}</div>}</div>,
    actions: d.status === "open" ? <>{d.routeId && onOpenRoute && <Btn onClick={() => onOpenRoute(d.routeId)}>فتح الجولة</Btn>}<Btn tone="ok" disabled={busy === d.id} onClick={close(d, "resolved")}>تم التعامل</Btn><Btn variant="ghost" disabled={busy === d.id} onClick={close(d, "dismissed")}>تجاهل</Btn></> : null,
  }));
  const lastRun = runs[0];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SP.md }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: SP.sm, flexWrap: "wrap", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 14px" }}>
        <div style={{ display: "flex", gap: SP.sm, alignItems: "center", flexWrap: "wrap", fontSize: FS.body, color: C.muted }}>
          <b style={{ color: C.text }}>الإسناد التلقائي:</b> <DispatchModeBadge settings={settings} />
          <span>آخر دورة: {lastRun ? `${getReadingAgeLabel(lastRun.startedAt)} (${({ cron: "دورية", heartbeat: "دورية", critical_reading: "قراءة حرجة", simulator_event: "حدث محاكاة", manual: "يدوية" })[lastRun.trigger] || lastRun.trigger})` : "لم تعمل بعد"}</span>
          <span>· كل {s.periodMinutes} د، والحالات الحرجة فورًا</span>
        </div>
        <Btn variant="primary" disabled={busy === "run" || s.mode === "off"} onClick={runNow}>{busy === "run" ? "جارٍ التشغيل…" : "تشغيل دورة الآن"}</Btn>
      </div>
      {msg && <div style={{ fontSize: FS.body, color: C.text, background: C.info + "10", border: `1px solid ${C.info}30`, borderRadius: 10, padding: "8px 12px" }}>{msg}</div>}
      {s.mode === "observe" && <div style={{ fontSize: FS.meta, color: C.info }}>وضع المراقبة: المحرك يحسب ويسجل ما كان سيفعله فقط. لا تُسند أي جولة ولا يتغير شيء حتى تفعّل الأمانة التنفيذ التلقائي.</div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "attention", label: "تحتاج قرارك", count: escalations.filter((d) => d.status === "open").length, tone: "danger" }, { key: "log", label: "سجل قرارات الإسناد", count: log.length }, { key: "runs", label: "الدورات", count: runs.length }]} />
      {tab === "attention" && <AttentionList items={items} empty="لا حالات استثنائية — الإسناد يسير ضمن القيود" max={8} />}
      {tab === "log" && (log.length === 0 ? <EmptyState icon="🤖" title="لا قرارات بعد" desc="تظهر هنا قرارات المحرك وأسبابها بعد أول دورة." /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {log.map((d) => { const [lab, tone] = DISPATCH_STATUS[d.status] || [d.status, "neutral"]; return (
            <div key={d.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px", background: C.card }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: SP.sm, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ fontSize: FS.body, color: C.text, fontWeight: 700 }}>{ACTION_LABELS[d.type] || d.type}{d.routeName ? ` — ${d.routeName}` : ""}{d.driverName ? ` ← ${d.driverName}` : ""}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}><Badge tone={tone}>{lab}</Badge>{d.demo && <DemoBadge />}<span style={{ fontSize: FS.meta, color: C.dim }}>{getReadingAgeLabel(d.executedAt || d.updatedAt)}</span>{d.routeId && d.status === "executed" && onOpenRoute && <Btn variant="ghost" onClick={() => onOpenRoute(d.routeId)}>فتح</Btn>}</div>
              </div>
              <Disclosure summary="لماذا؟"><div style={{ fontSize: 12, color: C.muted, lineHeight: 1.8 }}>{d.reason}{d.rejectReason ? <div style={{ color: C.warning }}>سبب الرفض عند التنفيذ: {d.rejectReason}</div> : null}{(d.alternatives || []).length > 0 && <div>البدائل التي لم تُختر: {d.alternatives.map((a) => `${a.driverName} (${a.why})`).join(" · ")}</div>}{d.note ? <div style={{ color: C.dim }}>{d.note}</div> : null}</div></Disclosure>
            </div>
          ); })}
        </div>
      ))}
      {tab === "runs" && (runs.length === 0 ? <EmptyState icon="⏱️" title="لا دورات بعد" /> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: ARABIC_FONT }}>
            <thead><tr style={{ color: C.muted, textAlign: "right" }}>{["الوقت", "المشغّل", "الوضع", "جديدة", "إضافة", "إعادة إسناد", "مرفوعة", "نُفذ", "مراقبة", "مرفوض"].map((h) => <th key={h} style={{ padding: "6px", borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody>{runs.map((r) => { const t = Object.values(r.municipalities || {}).reduce((a, x) => ({ c: a.c + (x.created || 0), i: a.i + (x.inserted || 0), ra: a.ra + (x.reassigned || 0), e: a.e + (x.escalated || 0), x: a.x + (x.executed || 0), o: a.o + (x.observed || 0), rj: a.rj + (x.rejected || 0) }), { c: 0, i: 0, ra: 0, e: 0, x: 0, o: 0, rj: 0 }); return (
              <tr key={r.id} style={{ color: C.text }}>{[getReadingAgeLabel(r.startedAt), r.trigger, DISPATCH_MODES[r.mode] || r.mode, t.c, t.i, t.ra, t.e, t.x, t.o, t.rj].map((v, i) => <td key={i} style={{ padding: "6px", borderBottom: `1px solid ${C.border}` }}>{v}</td>)}</tr>
            ); })}</tbody>
          </table>
        </div>
      ))}
    </div>
  );
};

/** Amanah-only: switch the autonomous dispatch mode, scope and operating thresholds. */
const DispatchSettingsCard = ({ loggedInUser }) => {
  const { settings } = useDispatchSettings(true);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const s = draft || { ...DEFAULT_DISPATCH_SETTINGS, ...(settings || {}) };
  const canEdit = can(loggedInUser?.role, "transfers.approve"); // the Amanah decision maker
  const set = (k, v) => setDraft({ ...s, [k]: v });
  const num = (k, label, unit) => <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: FS.meta, color: C.muted }}>{label}<span style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="number" disabled={!canEdit} value={s[k]} onChange={(e) => set(k, Number(e.target.value))} style={{ width: 90, padding: "6px 8px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontFamily: ARABIC_FONT }} />{unit}</span></label>;
  const save = async () => {
    if (s.mode === "auto" && s.scope === "all" && !window.confirm("التنفيذ التلقائي على كل الحاويات يعني إسناد جولات حقيقية لسائقين دون اعتماد بشري لكل جولة. هل اجتازت الاختبارات وتريد المتابعة؟")) return;
    setBusy(true); setMsg("");
    try { const { lastRunAt, lastRunId, lastTrigger, lastUrgentRunAt, lastUrgentRunId, updatedAt, updatedBy, updatedByName, ...clean } = s; void lastRunAt; void lastRunId; void lastTrigger; void lastUrgentRunAt; void lastUrgentRunId; void updatedAt; void updatedBy; void updatedByName; await saveDispatchSettings(clean, { uid: loggedInUser?.uid, name: loggedInUser?.name }); setDraft(null); setMsg("حُفظت إعدادات الإسناد التلقائي"); }
    catch (e) { setMsg("تعذر الحفظ: " + friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Section title="🤖 الإسناد التشغيلي الذاتي" hint="يحلل المستشعرات والتنبؤات والبلاغات دوريًا على الخادم، ويضيف الحاويات لجولات قائمة أو ينشئ جولات مجمعة ويسندها للسائق الأنسب. نقل الموارد بين البلديات يبقى باعتماد الأمانة." actions={<DispatchModeBadge settings={settings} />}>
      {!canEdit && <div style={{ fontSize: FS.meta, color: C.dim, marginBottom: SP.sm }}>تغيير الوضع من صلاحية متخذ القرار في الأمانة فقط.</div>}
      <div style={{ display: "flex", gap: SP.sm, flexWrap: "wrap", marginBottom: SP.md }}>
        {Object.entries(DISPATCH_MODES).map(([k, l]) => <Btn key={k} variant={s.mode === k ? "primary" : "secondary"} disabled={!canEdit} onClick={() => set("mode", k)}>{l}</Btn>)}
        <span style={{ width: 1, background: C.border, margin: "0 4px" }} />
        {Object.entries(DISPATCH_SCOPES).map(([k, l]) => <Btn key={k} variant={s.scope === k ? "primary" : "secondary"} tone={k === "all" ? "warning" : undefined} disabled={!canEdit} onClick={() => set("scope", k)}>{l}</Btn>)}
      </div>
      <Disclosure summary="قيود التشغيل (قابلة للضبط)">
        <div style={{ display: "flex", gap: SP.md, flexWrap: "wrap" }}>
          {num("periodMinutes", "فاصل الدورة الدورية", "د")}{num("minBinsPerRoute", "أقل عدد حاويات للجولة الاعتيادية", "")}{num("urgentFillPct", "امتلاء عاجل يتجاوز التجميع", "%")}{num("maxApproachMin", "أقصى زمن وصول للسائق", "د")}
          {num("maxStopsPerRoute", "أقصى توقفات للجولة", "")}{num("insertMaxKm", "أقصى بعد للإضافة لجولة قائمة", "كم")}{num("insertMaxAddedMin", "أقصى زمن يضاف للجولة", "د")}{num("notStartedEscalateMin", "تصعيد جولة لم تبدأ بعد", "د")}
        </div>
      </Disclosure>
      {canEdit && <div style={{ display: "flex", gap: SP.sm, alignItems: "center", marginTop: SP.md }}><Btn variant="primary" disabled={busy || !draft} onClick={save}>{busy ? "جارٍ الحفظ…" : "حفظ"}</Btn>{draft && <Btn variant="ghost" onClick={() => setDraft(null)}>إلغاء</Btn>}{msg && <span style={{ fontSize: FS.meta, color: C.muted }}>{msg}</span>}</div>}
      <div style={{ fontSize: FS.meta, color: C.dim, marginTop: SP.sm }}>التشغيل: فوري عند قراءة حرجة، ودوري من الخادم، ويدوي من «تشغيل دورة الآن». عند تفعيل الإسناد التلقائي تتوقف مزامنة الاقتراحات من المتصفح.</div>
    </Section>
  );
};

/** Driver portal: tasks pushed by the dispatcher (new route, added stop, reassignment). */
const DriverNotifications = ({ driverId }) => {
  const { notifications } = useDriverNotifications(driverId);
  const unread = notifications.filter((n) => !n.read).slice(0, 3);
  if (unread.length === 0) return null;
  return (
    <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
      {unread.map((n) => (
        <div key={n.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: n.type === "route_removed" ? C.warning + "18" : C.accent + "18", border: `1px solid ${n.type === "route_removed" ? C.warning : C.accent}60`, borderRadius: 12, padding: "10px 12px" }}>
          <div><div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>🔔 {n.title}</div><div style={{ fontSize: 12.5, color: C.muted }}>{n.body}</div></div>
          <Btn onClick={() => markDriverNotificationRead(n.id).catch(() => {})}>تم</Btn>
        </div>
      ))}
    </div>
  );
};

const RouteManagementPage = ({ neighborhoods = [], bins = [], recentReadings = [], fireSensors = [], citizenReports = [], vehicles = [], routes = [], driverProfiles = [], loadingVehicles, loadingRoutes, loggedInUser, draftBinId, onConsumeDraftBin, initialRouteId = null, onConsumeInitialRoute, onShowOnMap , dispatchSettings = null, onOpenDispatch}) => {
  const [tab, setTab] = useState(dispatchSettings?.mode === "auto" ? "approved" : "suggested");
  const [selectedRouteId, setSelectedRouteId] = useState(null);

  // Deep link from a bin/neighborhood/dashboard card: open that route (and its tab) once routes are loaded.
  const [consumedInitialRouteId, setConsumedInitialRouteId] = useState(null);
  if (initialRouteId && initialRouteId !== consumedInitialRouteId && routes.length > 0) {
    setConsumedInitialRouteId(initialRouteId);
    const target = routes.find((r) => r.id === initialRouteId);
    if (target) {
      setSelectedRouteId(target.id);
      setTab(target.status === "suggested" ? "suggested" : target.status === "approved" ? "approved" : target.status === "in_progress" ? "active" : "history");
    }
    if (onConsumeInitialRoute) onConsumeInitialRoute();
  }
  const [generating, setGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState("");
  const [showVehicles, setShowVehicles] = useState(false);
  const [newVehicleNumber, setNewVehicleNumber] = useState("");

  const readingsByBin = useMemo(() => {
    const map = {};
    for (const r of recentReadings) { if (!r.bin_id) continue; (map[r.bin_id] ||= []).push(r); }
    return map;
  }, [recentReadings]);

  const binCtx = useMemo(() => makeBinContext(fireSensors, citizenReports, neighborhoods), [fireSensors, citizenReports, neighborhoods]);
  const scoredBinsLive = useMemo(() => bins.map((bin) => ({ bin, priority: getBinPriority(bin, null, readingsByBin[bin.id] || [], binCtx.forBin(bin)) })), [bins, readingsByBin, binCtx]);

  // Live "are the suggestions still in sync with the bins?" check — the same
  // reconciliation the button applies, computed read-only so the page can say
  // exactly what pressing it would change.
  const pendingPlan = useMemo(() => {
    const open = routes.filter((r) => ["suggested", "approved", "in_progress"].includes(r.status));
    return reconcileRecommendations(neighborhoods, scoredBinsLive, open);
  }, [neighborhoods, scoredBinsLive, routes]);
  const pendingChanges = pendingPlan.toCreate.length + pendingPlan.toUpdate.length + pendingPlan.toWithdraw.length;
  const binById = useMemo(() => Object.fromEntries(bins.map((b) => [b.id, b])), [bins]);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateMsg("");
    try {
      const open = routes.filter((r) => ["suggested", "approved", "in_progress"].includes(r.status));
      const plan = reconcileRecommendations(neighborhoods, scoredBinsLive, open);
      const result = await applyRouteReconciliation(plan, { municipalityIdFor: (nid) => municipalityForNeighborhood(neighborhoods.find((n) => n.id === nid)) });
      await writeAuditLog("routes_generated", loggedInUser?.uid, loggedInUser?.name, { created: result.created, updated: result.updated, withdrawn: result.withdrawn, unchanged: plan.unchanged.length });
      if (result.created + result.updated + result.withdrawn === 0) {
        setGenerateMsg(plan.unchanged.length > 0 ? "الجولات المقترحة محدّثة بالفعل — لا تغييرات." : "لا توجد حاويات مؤهلة للجمع حاليًا — لا جولات مقترحة.");
      } else {
        setGenerateMsg(`تم: ${result.created} جولة جديدة، ${result.updated} جولة محدّثة بحاويات جديدة، ${result.withdrawn} اقتراح سُحب (لم تعد حاوياته مؤهلة).`);
      }
    } catch (e) {
      console.error("[generate-routes]", e);
      setGenerateMsg("تعذر توليد الجولات: " + friendlyError(e));
    } finally {
      setGenerating(false);
    }
  };

  const grouped = {
    suggested: routes.filter((r) => r.status === "suggested"),
    approved: routes.filter((r) => r.status === "approved"),
    active: routes.filter((r) => r.status === "in_progress"),
    history: routes.filter((r) => ["completed", "rejected", "deferred", "withdrawn"].includes(r.status)),
  };

  const selectedRoute = routes.find((r) => r.id === selectedRouteId);
  const loading = loadingVehicles || loadingRoutes;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5, color: C.muted, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
        <span>
          {dispatchSettings?.mode === "auto"
            ? <><b style={{ color: C.text }}>الإسناد التلقائي مفعّل{dispatchSettings.scope === "all" ? "" : " (بيئة العرض)"}:</b> الجولات الاعتيادية تُجمّع وتُسند للسائق الأنسب تلقائيًا، وتصلك الاستثناءات فقط.</>
            : dispatchSettings?.mode === "observe"
              ? <><b style={{ color: C.text }}>الإسناد التلقائي في وضع المراقبة:</b> يحسب ما كان سيفعله دون تنفيذ — الاعتماد والإسناد هنا يدويان.</>
              : <><b style={{ color: C.text }}>الإسناد يدوي:</b> الجولة المقترحة لا تصل للسائق إلا باعتماد موظف واختيار سائق ومركبة.</>}
        </span>
        {onOpenDispatch && <Btn variant="ghost" onClick={onOpenDispatch}>الإسناد التلقائي ←</Btn>}
      </div>

      {draftBinId && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: C.info, background: C.info + "15", border: `1px solid ${C.info}40`, borderRadius: 10, padding: "10px 14px" }}>
          <span>تمت الإشارة إلى حاوية "{bins.find((b) => b.id === draftBinId)?.name || draftBinId}" من صفحة أخرى — افتح جولة مقترحة لنفس حيها لإضافتها يدويًا، أو ولّد جولات جديدة.</span>
          <button onClick={onConsumeDraftBin} style={{ background: "none", border: "none", color: C.info, cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button disabled={generating || loading} onClick={handleGenerate} style={{
          padding: "9px 16px", borderRadius: 10, border: "none",
          background: generating ? C.border : C.brand,
          color: generating ? C.dim : "#fff", fontWeight: 700, fontSize: 13, cursor: generating ? "not-allowed" : "pointer", fontFamily: ARABIC_FONT,
        }}>
          {generating ? "جاري التوليد…" : pendingChanges > 0 ? `🧭 توليد/تحديث الجولات المقترحة (${pendingChanges} تغيير)` : "🧭 توليد جولات مقترحة الآن"}
        </button>
        {generateMsg && <span style={{ fontSize: 12, color: C.muted }}>{generateMsg}</span>}
        {!generateMsg && pendingChanges > 0 && (
          <span style={{ fontSize: 12, color: C.warning }}>
            ⚠️ الاقتراحات غير متزامنة مع حالة الحاويات: {pendingPlan.toCreate.length} حي بلا جولة، {pendingPlan.toUpdate.length} جولة تحتاج تحديثًا، {pendingPlan.toWithdraw.length} اقتراح لم يعد مطلوبًا.
          </span>
        )}
        <button onClick={() => setShowVehicles((s) => !s)} style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>
          🚛 إدارة المركبات ({vehicles.length})
        </button>
      </div>

      {showVehicles && (
        <Card title="المركبات" icon={<Truck size={16} color={C.muted} />}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input value={newVehicleNumber} onChange={(e) => setNewVehicleNumber(e.target.value)} placeholder="رقم/اسم المركبة الجديدة…"
              style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 12, fontFamily: ARABIC_FONT }} />
            <button
              disabled={!newVehicleNumber.trim()}
              onClick={async () => {
                await addVehicle({ vehicleNumber: newVehicleNumber.trim(), capacityLiters: 6000, municipalityId: scopeFor(loggedInUser).municipalityId || null });
                await writeAuditLog("vehicle_added", loggedInUser?.uid, loggedInUser?.name, { vehicleNumber: newVehicleNumber.trim() });
                setNewVehicleNumber("");
              }}
              style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: C.accent, color: "#07231A", fontWeight: 700, fontSize: 12, cursor: newVehicleNumber.trim() ? "pointer" : "not-allowed" }}
            >إضافة</button>
          </div>
          {vehicles.length === 0 ? <EmptyState icon="🚛" title="لا توجد مركبات مسجّلة بعد" /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {vehicles.map((v) => (
                <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: C.bg, borderRadius: 8, fontSize: 12 }}>
                  <span style={{ color: C.text }}>{v.vehicleNumber} <span style={{ color: C.dim }}>({v.capacityLiters} لتر)</span></span>
                  <select value={v.status} onChange={(e) => updateVehicleStatus(v.id, e.target.value, v.currentRouteId)} style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 11, fontFamily: ARABIC_FONT }}>
                    {Object.entries(VEHICLE_STATUS_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <div style={{ display: "flex", gap: 8, borderBottom: `1px solid ${C.border}`, paddingBottom: 2, flexWrap: "wrap" }}>
        {ROUTE_TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "9px 16px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: ARABIC_FONT,
            background: tab === t.key ? C.card : "transparent",
            color: tab === t.key ? C.accent : C.muted,
            borderBottom: tab === t.key ? `2px solid ${C.accent}` : "2px solid transparent",
          }}>{t.label} {grouped[t.key]?.length > 0 ? `(${grouped[t.key].length})` : ""}</button>
        ))}
      </div>

      {loading ? <EmptyState icon="⏳" title="جاري تحميل الجولات والمركبات…" /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {grouped[tab].length === 0 ? (
            <div style={{ gridColumn: "1 / -1" }}>
              {tab === "suggested" && <EmptyState icon="🧭" title="لا توجد جولات مقترحة حاليًا" desc="اضغط «توليد جولات مقترحة الآن» لتحليل الحاويات المؤهلة للجمع." />}
              {tab === "approved" && <EmptyState icon="🚦" title="لا توجد جولات معتمدة بانتظار البدء" />}
              {tab === "active" && <EmptyState icon="🚛" title="لا توجد جولات نشطة حاليًا" />}
              {tab === "history" && <EmptyState icon="📜" title="لا يوجد سجل جولات بعد" />}
            </div>
          ) : grouped[tab].map((r) => (
            <div key={r.id} onClick={() => setSelectedRouteId(r.id)} style={{ background: C.card, border: `1px solid ${STATUS_COLORS[r.priorityTier] || C.border}40`, borderRadius: 14, padding: 16, cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{r.routeName} {r.demo && <DemoBadge />}{r.dispatch?.auto && <Badge tone="ok">🤖 تلقائي</Badge>}{r.driverName && <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 600 }}>← {r.driverName}</span>}</div>
                <StateBadge state={r.priorityTier} />
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>{r.binIds?.length || 0} حاوية · {r.estimatedDistanceKm} كم تقريبًا · تقدير {r.estimatedWasteLiters} لتر</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 6 }}>
                {(r.orderedStops || []).slice(0, 4).map((st) => {
                  const b = binById[st.binId];
                  return (
                    <div key={st.binId} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: C.muted }}>
                      <span>#{st.order} {st.binName}{st.manual && <span style={{ color: C.dim }}> (يدوي)</span>}</span>
                      <span style={{ color: STATUS_COLORS[st.priorityTier] || C.text, fontWeight: 700 }}>{b?.lastFillLevelPercent != null ? `${b.lastFillLevelPercent}%` : "—"}</span>
                    </div>
                  );
                })}
                {(r.orderedStops || []).length > 4 && <div style={{ fontSize: 11, color: C.dim }}>+{r.orderedStops.length - 4} حاوية أخرى</div>}
              </div>
              {r.status === "withdrawn" && r.withdrawReason && <div style={{ fontSize: 11, color: C.dim }}>{r.withdrawReason}</div>}
              {r.status === "rejected" && r.rejectReason && <div style={{ fontSize: 11, color: C.danger }}>سبب الرفض: {r.rejectReason}</div>}
              {r.status === "completed" && r.completedAt && <div style={{ fontSize: 11, color: C.dim }}>اكتملت: {getReadingAgeLabel(r.completedAt)}</div>}
              <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{ROUTE_STATUS_LABELS[r.status] || r.status}</div>
            </div>
          ))}
        </div>
      )}

      {selectedRoute && (
        <RouteDetailModal
          route={selectedRoute} bins={bins} neighborhoods={neighborhoods} vehicles={vehicles} routes={routes} driverProfiles={driverProfiles} loggedInUser={loggedInUser}
          onClose={() => setSelectedRouteId(null)}
          onChanged={() => {}}
          onShowOnMap={onShowOnMap}
        />
      )}
    </div>
  );
};

// NOTE: the following generator functions are used by ExecDashboard below
// (executive portal) — intentionally untouched/out of scope for this phase,
// left exactly as before including their pre-existing "شفط"/station wording.
const generateQuarterlyData = () => [
  { quarter: "Q1", الإيرادات: 450000, التكاليف: 320000, الأرباح: 130000, الكفاءة: 78 },
  { quarter: "Q2", الإيرادات: 520000, التكاليف: 295000, الأرباح: 225000, الكفاءة: 84 },
  { quarter: "Q3", الإيرادات: 480000, التكاليف: 310000, الأرباح: 170000, الكفاءة: 81 },
  { quarter: "Q4", الإيرادات: 610000, التكاليف: 280000, الأرباح: 330000, الكفاءة: 91 },
];

const generateDistrictPerformance = () => [
  { district: "الخليج", الأداء: 92, التكلفة: 28000, الرضا: 88, الحوادث: 1 },
  { district: "الفايزية", الأداء: 85, التكلفة: 32000, الرضا: 82, الحوادث: 3 },
  { district: "الإسكان", الأداء: 78, التكلفة: 35000, الرضا: 75, الحوادث: 5 },
  { district: "الريان", الأداء: 95, التكلفة: 25000, الرضا: 91, الحوادث: 0 },
  { district: "السالمية", الأداء: 71, التكلفة: 38000, الرضا: 68, الحوادث: 7 },
  { district: "الحمر", الأداء: 88, التكلفة: 29000, الرضا: 85, الحوادث: 2 },
  { district: "المنتزه", الأداء: 82, التكلفة: 31000, الرضا: 79, الحوادث: 4 },
  { district: "الأفق", الأداء: 90, التكلفة: 27000, الرضا: 87, الحوادث: 1 },
  { district: "النقع", الأداء: 75, التكلفة: 36000, الرضا: 72, الحوادث: 6 },
  { district: "الضاحي", الأداء: 68, التكلفة: 42000, الرضا: 65, الحوادث: 8 },
  { district: "الهلالية", الأداء: 87, التكلفة: 30000, الرضا: 84, الحوادث: 2 },
  { district: "البصيرة", الأداء: 93, التكلفة: 26000, الرضا: 90, الحوادث: 1 },
];

const generateROIData = () =>
  Array.from({ length: 12 }, (_, i) => ({
    month: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"][i],
    العائد: Math.round(80000 + Math.random() * 60000 + i * 5000),
    الاستثمار: Math.round(50000 + Math.random() * 20000 - i * 1000),
    التوفير: Math.round(20000 + Math.random() * 40000 + i * 3000),
  }));

const generateBenchmarkData = () => [
  { metric: "كفاءة التشغيل", بريدة: 87, المعيار_الوطني: 72, أفضل_ممارسة: 95 },
  { metric: "إعادة التدوير", بريدة: 68, المعيار_الوطني: 45, أفضل_ممارسة: 85 },
  { metric: "رضا المستخدمين", بريدة: 82, المعيار_الوطني: 65, أفضل_ممارسة: 92 },
  { metric: "تقليل الانبعاثات", بريدة: 75, المعيار_الوطني: 50, أفضل_ممارسة: 90 },
  { metric: "التكلفة/الطن", بريدة: 80, المعيار_الوطني: 60, أفضل_ممارسة: 88 },
  { metric: "زمن الاستجابة", بريدة: 91, المعيار_الوطني: 70, أفضل_ممارسة: 96 },
];

const generateScenarios = () => [
  {
    id: 1, name: "توسعة 5 نقاط جمع جديدة", type: "توسعة",
    investment: 2500000, annualSaving: 850000, roi: 34, payback: "2.9 سنة",
    risk: "متوسط", impact: "زيادة التغطية 40%", recommendation: "موصى به",
    details: "إضافة 5 نقاط جمع ذكية في الأحياء الجديدة لتغطية النمو العمراني المتوقع",
    pros: ["تغطية أحياء جديدة", "خفض تكاليف النقل", "رفع رضا المواطنين"],
    cons: ["استثمار أولي عالي", "يحتاج 6 أشهر للتنفيذ"],
  },
  {
    id: 2, name: "ترقية المستشعرات إلى IoT 5G", type: "تقنية",
    investment: 800000, annualSaving: 320000, roi: 40, payback: "2.5 سنة",
    risk: "منخفض", impact: "دقة بيانات 99.5%", recommendation: "موصى به بشدة",
    details: "ترقية جميع المستشعرات إلى تقنية IoT على شبكة 5G لبيانات لحظية أدق",
    pros: ["بيانات لحظية دقيقة", "صيانة تنبؤية", "تكامل مع الأنظمة الذكية"],
    cons: ["يحتاج تدريب الفريق", "تبعية لتغطية 5G"],
  },
  {
    id: 3, name: "نظام إعادة تدوير متكامل", type: "بيئية",
    investment: 1800000, annualSaving: 600000, roi: 33, payback: "3 سنوات",
    risk: "متوسط", impact: "رفع إعادة التدوير إلى 85%", recommendation: "موصى به",
    details: "إنشاء مركز فرز وإعادة تدوير متكامل مرتبط بالحاويات الذكية",
    pros: ["إيرادات من المواد المعاد تدويرها", "تقليل النفايات 60%", "دعم رؤية 2030"],
    cons: ["يحتاج مساحة كبيرة", "تراخيص بيئية"],
  },
  {
    id: 4, name: "الطاقة الشمسية لنقاط الجمع", type: "استدامة",
    investment: 600000, annualSaving: 180000, roi: 30, payback: "3.3 سنة",
    risk: "منخفض", impact: "تقليل استهلاك الكهرباء 70%", recommendation: "اختياري",
    details: "تركيب ألواح شمسية على مواقع نقاط الجمع لتشغيلها بالطاقة المتجددة",
    pros: ["خفض فاتورة الكهرباء", "استدامة بيئية", "صورة إيجابية"],
    cons: ["تأثر بالغبار والرمال", "صيانة الألواح"],
  },
];

// ── Isolated clock — لمنع re-render الكامل كل ثانية ──────────
const ExecHeaderClock = () => {
  const [t, setT] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  return <span>{t.toLocaleDateString("ar-SA")} • {t.toLocaleTimeString("ar-SA")}</span>;
};

// ── Session Timeout — انتهاء الجلسة التلقائي ──────────────────
const SessionTimeout = ({ onLogout, timeoutMin = 30, countdownSec = 10 }) => {
  const [warning, setWarning] = useState(false);
  const [countdown, setCountdown] = useState(countdownSec);
  const timerRef    = useRef(null);
  const countRef    = useRef(null);
  const F = ARABIC_FONT;

  const resetTimer = () => {
    setWarning(false);
    setCountdown(countdownSec);
    clearTimeout(timerRef.current);
    clearInterval(countRef.current);
    timerRef.current = setTimeout(() => {
      setWarning(true);
      let left = countdownSec;
      countRef.current = setInterval(() => {
        left -= 1;
        setCountdown(left);
        if (left <= 0) { clearInterval(countRef.current); onLogout(); }
      }, 1000);
    }, timeoutMin * 60 * 1000);
  };

  useEffect(() => {
    const events = ["mousemove","keydown","click","touchstart","scroll"];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      clearTimeout(timerRef.current);
      clearInterval(countRef.current);
    };
  }, []);

  if (!warning) return null;
  return (
    <div style={{ position:"fixed", inset:0, background:"#000c", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:C.card, border:`2px solid ${C.warning}`, borderRadius:20, padding:"36px 40px", width:"95vw", maxWidth:400, textAlign:"center", direction:"rtl", fontFamily:F }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:12 }}><Timer size={48} color={C.warning} /></div>
        <div style={{ fontSize:18, fontWeight:800, color:C.warning, marginBottom:8 }}>انتهت مدة الجلسة قريباً</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:20, lineHeight:1.7 }}>
          مضى {timeoutMin} دقيقة بدون نشاط.<br/>
          سيتم تسجيل الخروج تلقائياً خلال
        </div>
        <div style={{ fontSize:52, fontWeight:900, color: countdown <= 5 ? C.danger : C.warning, marginBottom:20 }}>{countdown}</div>
        <div style={{ height:6, background:C.bg, borderRadius:3, marginBottom:24, overflow:"hidden" }}>
          <div style={{ height:"100%", background: countdown <= 5 ? C.danger : C.warning, borderRadius:3,
            width:`${(countdown/countdownSec)*100}%`, transition:"width 1s linear" }} />
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={resetTimer} style={{ flex:1, padding:13, borderRadius:10, border:"none",
            background:"linear-gradient(135deg,#10b981,#059669)", color:"#000", fontWeight:800, fontSize:14, cursor:"pointer", fontFamily:F, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
            <CheckCircle size={16} /> تمديد الجلسة
          </button>
          <button onClick={onLogout} style={{ padding:"13px 20px", borderRadius:10, border:`1px solid ${C.danger}`,
            background:C.danger+"15", color:C.danger, fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:F }}>
            خروج
          </button>
        </div>
      </div>
    </div>
  );
};

// ======================== AMANAH STRATEGIC COMMAND (Phase 5 — Inter-Municipality Resource Optimization) ========================
const PRESSURE_LABEL = { critical: ["حرج", C.danger], high: ["مرتفع", C.warning], moderate: ["متوسط", C.info], low: ["منخفض", C.accent] };
const TRANSFER_STATUS = { proposed: ["مقترح", C.warning], approved: ["معتمد", C.info], executed: ["منفَّذ", C.accent], returned: ["أُعيد", C.dim], rejected: ["مرفوض", C.danger] };

/** Pure-ish helper shared by the Amanah panel and the municipality dashboard: live subsets + pressure per municipality. */
const useCityPressure = ({ neighborhoods, bins, profiles, vehicles, routes, incidents, recentReadings }) => useMemo(() => {
  const groups = groupNeighborhoodsByName(neighborhoods, bins);
  const zones = operationalZones(FEATURE_BY_KEY, groups, neighborhoods);
  const centroids = Object.fromEntries(Object.values(zones).map((z) => [z.municipalityId, { lat: z.hull.reduce((a, p) => a + p[0], 0) / z.hull.length, lng: z.hull.reduce((a, p) => a + p[1], 0) / z.hull.length }]));
  const readingsByBin = {}; for (const r of recentReadings) { if (r.bin_id) (readingsByBin[r.bin_id] ||= []).push(r); }
  const predictedSoonIds = new Set(bins.filter((b) => { const p = predictFullTime(b, readingsByBin[b.id] || []); return p.predictionAvailable && p.hoursToFull != null && p.hoursToFull <= THRESHOLDS.predictedFullSoonHours; }).map((b) => b.id));
  const nMid = Object.fromEntries(neighborhoods.map((n) => [n.id, municipalityForNeighborhood(n)]));
  const live = Object.fromEntries(MUNICIPALITIES.map((m) => [m.id, {
    bins: bins.filter((b) => (b.municipalityId || nMid[b.neighborhoodId]) === m.id),
    profiles: profiles.filter((p) => p.municipalityId === m.id), vehicles: vehicles.filter((v) => v.municipalityId === m.id),
    routes: routes.filter((r) => r.municipalityId === m.id), incidents: incidents.filter((i) => i.municipalityId === m.id), predictedSoonIds,
  }]));
  const pressures = MUNICIPALITIES.map((m) => municipalityPressure(m, live[m.id]));
  const transfersRec = recommendTransfers(pressures, { centroids });
  return { pressures, comparison: compareMunicipalities(pressures), transfersRec, centroids, live, predictedSoon: predictedSoonIds.size };
}, [neighborhoods, bins, profiles, vehicles, routes, incidents, recentReadings]);

/** Transfer record built from an interMunicipalEngine recommendation (used by the Amanah panel and the demo scenario). */
const transferFromRecommendation = (rec) => ({ resourceType: rec.resourceType, resourceId: rec.resourceType === "driver" ? rec.driverId : rec.vehicleId, resourceLabel: rec.resourceLabel, driverId: rec.driverId, driverName: rec.driverName, vehicleId: rec.vehicleId, vehicleNumber: rec.vehicleNumber, fromMunicipalityId: rec.fromMunicipalityId, toMunicipalityId: rec.toMunicipalityId, impact: rec.impact, travelMin: rec.travelMin, travelKm: rec.travelKm, travelSource: rec.travelSource, benefit: rec.benefit, cost: rec.cost, net: rec.net, reason: rec.reason, until: new Date(Date.now() + 8 * 3600000).toISOString() });
const AmanahStrategicPanel = ({ neighborhoods = [], bins = [], profiles = [], vehicles = [], routes = [], incidents = [], recentReadings = [], fireSensors = [], citizenReports = [], supportRequests = [], transfers = [], auditLog = [], loggedInUser, onOpenMunicipality }) => {
  const city = useCityPressure({ neighborhoods, bins, profiles, vehicles, routes, incidents, recentReadings });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const actor = { uid: loggedInUser?.uid, name: loggedInUser?.name };
  const isAmanah = can(loggedInUser?.role, "transfers.approve");
  const run = (label, fn) => async () => { setBusy(label); setMsg(""); try { const r = await fn(); if (r) setMsg(r); } catch (e) { setMsg("تعذر تنفيذ العملية: " + friendlyError(e)); } finally { setBusy(""); } };
  const totals = city.pressures.reduce((a, p) => ({ critical: a.critical + p.critical, warning: a.warning + p.warning, ready: a.ready + p.readyDrivers, vehicles: a.vehicles + p.usableVehicles, active: a.active + p.activeRoutes, incidents: a.incidents + p.openIncidents }), { critical: 0, warning: 0, ready: 0, vehicles: 0, active: 0, incidents: 0 });
  const decisions = auditLog.filter((a) => /^(transfer_|support_|plan_applied|route_assigned)/.test(a.action)).slice(0, 12);
  const propose = (rec) => run(rec.resourceId, async () => {
    const id = await proposeResourceTransfer(transferFromRecommendation(rec), actor);
    await writeAuditLog("transfer_proposed", actor.uid, actor.name, { transferId: id, from: rec.fromMunicipalityId, to: rec.toMunicipalityId, resource: rec.resourceLabel });
    return `📝 سُجّل اقتراح نقل ${rec.resourceLabel} من ${rec.fromName} إلى ${rec.toName} — بانتظار الاعتماد`;
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {msg && <div style={{ fontSize: 12, color: C.text, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px" }}>{msg}</div>}
      {/* 2. مؤشرات المدينة */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        {[["بلديات تحت ضغط", city.transfersRec.shortages.length, city.transfersRec.shortages.length ? C.danger : C.accent], ["حاويات حرجة", totals.critical, C.danger], ["تحتاج متابعة", totals.warning, C.warning], ["متوقع امتلاؤها قريبًا", city.predictedSoon, C.purple], ["سائقون جاهزون", totals.ready, C.accent], ["مركبات متاحة", totals.vehicles, C.info], ["جولات نشطة", totals.active, C.info], ["بلاغات مفتوحة", totals.incidents, totals.incidents ? C.danger : C.dim]].map(([l, v, c]) => (
          <div key={l} style={{ background: C.card, border: `1px solid ${c}30`, borderRadius: 12, padding: "12px 14px" }}><div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 11, color: C.muted }}>{l}</div></div>
        ))}
      </div>
      {/* 1. خريطة البلديات */}
      <Card title="🗺️ خريطة البلديات — النطاقات التشغيلية والضغط" icon={<MapGlyph size={16} color={C.muted} />}>
        <OperationalMap neighborhoods={neighborhoods} bins={bins} fireSensors={fireSensors} recentReadings={recentReadings} routes={routes} citizenReports={citizenReports} profiles={profiles} initialLayer="municipalities" height={420} compact />
      </Card>
      {/* 3+4. مقارنة البلديات والضغط التشغيلي */}
      <Card title="📊 مقارنة أداء البلديات والضغط التشغيلي" icon={<BarChart2 size={16} color={C.muted} />}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: ARABIC_FONT }}>
            <thead><tr style={{ color: C.muted, textAlign: "right" }}>{["#", "البلدية", "الضغط", "حرجة", "متابعة", "متوقعة قريبًا", "بلاغات", "سائقون جاهزون", "مركبات متاحة", "جولات نشطة", "الطاقة (حاوية/مناوبة)", ""].map((h) => <th key={h} style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody>{city.comparison.map((p) => { const [lab, col] = PRESSURE_LABEL[p.level]; return (
              <tr key={p.municipalityId} style={{ color: C.text }}>
                <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{p.rank}</td>
                <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, fontWeight: 700 }}>{p.name}</td>
                <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, minWidth: 140 }}><div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ flex: 1, height: 8, background: C.bg, borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${p.index}%`, height: "100%", background: col }} /></div><b style={{ color: col }}>{p.index}</b> <span style={{ fontSize: 10.5, color: col }}>{lab}</span></div></td>
                <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, color: p.critical ? C.danger : C.muted }}>{p.critical}</td>
                <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{p.warning}</td>
                <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{p.predictedSoon}</td>
                <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{p.openIncidents}</td>
                <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{p.readyDrivers}</td>
                <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{p.usableVehicles}</td>
                <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{p.activeRoutes}</td>
                <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, color: C.muted }}>{p.capacityUnits} / طلب {p.demandUnits}</td>
                <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{onOpenMunicipality && <button onClick={() => onOpenMunicipality(p.municipalityId)} style={smallBtn(C.info)}>التفاصيل</button>}</td>
              </tr>
            ); })}</tbody>
          </table>
        </div>
        <div style={{ fontSize: 10.5, color: C.dim, marginTop: 8 }}>الضغط = الطلب (حرجة ×1 + متابعة/متوقعة ×0.5 + بلاغات ×0.5) ÷ الطاقة (الطواقم الجاهزة × {Math.round(CREW_BINS_PER_HOUR * 10) / 10} حاوية/ساعة × {city.pressures[0]?.remainingShiftHours || 4} ساعات متبقية) × 100 — إشرافي بلا الدخول إلى حساب متخذ القرار بالبلدية.</div>
      </Card>
      {/* 6+7. التنبؤات والتوصيات الاستراتيجية */}
      <Card title="🤝 التوصيات الاستراتيجية — دعم البلديات ونقل الموارد" icon={<Target size={16} color={C.muted} />}>
        {city.transfersRec.recommendations.length === 0 && city.transfersRec.warnings.length === 0 && <div style={{ fontSize: 12, color: C.accent }}>✅ لا توجد بلدية تحت ضغط يستدعي دعمًا الآن.</div>}
        {city.transfersRec.warnings.map((w, i) => <div key={i} style={{ fontSize: 12, color: C.warning, marginBottom: 6 }}>⚠️ {w}</div>)}
        {city.transfersRec.recommendations.map((rec) => (
          <div key={rec.toMunicipalityId + rec.resourceId} style={{ background: C.bg, border: `1px solid ${C.info}50`, borderRadius: 12, padding: 12, marginBottom: 8, fontSize: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>نقل {rec.resourceType === "crew" ? "طاقم" : rec.resourceType === "vehicle" ? "مركبة" : "سائق"} {rec.resourceLabel}{rec.driverName && rec.resourceType === "crew" ? ` (${rec.driverName})` : ""}: {rec.fromName} ← {rec.toName}</div>
            <div style={{ color: C.muted, lineHeight: 1.8, marginTop: 4 }}>{rec.reason}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 6, marginTop: 8 }}>
              {[["ضغط المستقبِلة", `${rec.impact.receiverBefore} ← ${rec.impact.receiverAfter}`, C.accent], ["ضغط المرسِلة", `${rec.impact.donorBefore} ← ${rec.impact.donorAfter}`, C.warning], ["الانتقال", rec.travelMin != null ? `~${rec.travelMin} د · ${rec.travelKm} كم` : "—", C.info], ["الفائدة − التكلفة", rec.net, rec.net > 0 ? C.accent : C.danger]].map(([l, v, c]) => <div key={l} style={{ background: C.card, borderRadius: 8, padding: "6px 10px" }}><div style={{ fontSize: 10.5, color: C.muted }}>{l}</div><b style={{ color: c }}>{v}</b></div>)}
            </div>
            {rec.rejected.length > 0 && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>بدائل مرفوضة: {rec.rejected.map((o) => `${o.fromName} (${o.constraintsViolated[0]})`).join(" · ")}</div>}
            {isAmanah && <button disabled={!!busy} onClick={propose(rec)} style={{ ...smallBtn(C.info, true), color: "#fff", marginTop: 8 }}>📝 تسجيل اقتراح النقل للاعتماد</button>}
          </div>
        ))}
        <div style={{ fontSize: 10.5, color: C.dim }}>لا يُنقل أي مورد فعليًا دون اعتماد متخذ القرار بالأمانة؛ التوصية تحسب أثر النقل على الطرفين وتستبعد ما يخالف القيود (سقف ضغط المرسِلة {city.transfersRec.thresholds.donorCeiling}، زمن انتقال ≤ {city.transfersRec.thresholds.maxTransferMin} د).</div>
      </Card>
      {/* طلبات الدعم */}
      <Card title={`📨 طلبات الدعم من البلديات (${supportRequests.filter((s) => s.status === "open").length} مفتوح)`} icon={<Inbox size={16} color={C.muted} />}>
        {supportRequests.length === 0 ? <div style={{ fontSize: 12, color: C.dim }}>لا طلبات دعم.</div> : supportRequests.slice(0, 20).map((s) => (
          <div key={s.id} style={{ background: C.bg, borderRadius: 8, padding: "8px 10px", marginBottom: 6, fontSize: 12, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div><b style={{ color: C.text }}>{municipalityById(s.municipalityId)?.shortAr}</b> · {s.requestedByName} · {s.need}{s.note ? ` — ${s.note}` : ""}<div style={{ color: C.dim, fontSize: 11 }}>ضغط عند الطلب: {s.pressureIndex} · {getReadingAgeLabel(s.createdAt)} · {s.status === "open" ? "مفتوح" : s.status === "approved" ? "موافق عليه" : s.status === "rejected" ? "مرفوض" : s.status}{s.resolution ? ` — ${s.resolution}` : ""}</div></div>
            {isAmanah && s.status === "open" && <div style={{ display: "flex", gap: 6 }}><button disabled={!!busy} onClick={run(s.id, async () => { const res = window.prompt("قرار الأمانة (ملاحظة):", "") ?? ""; await reviewSupportRequest(s.id, actor, "approved", res); await writeAuditLog("support_request_approved", actor.uid, actor.name, { requestId: s.id, municipalityId: s.municipalityId }); return "✅ تمت الموافقة على طلب الدعم — اقترح النقل المناسب أعلاه"; })} style={smallBtn(C.accent)}>موافقة</button><button disabled={!!busy} onClick={run(s.id + "r", async () => { const res = window.prompt("سبب الرفض:", "") ?? ""; await reviewSupportRequest(s.id, actor, "rejected", res); await writeAuditLog("support_request_rejected", actor.uid, actor.name, { requestId: s.id }); return "تم رفض الطلب"; })} style={smallBtn(C.danger)}>رفض</button></div>}
          </div>
        ))}
      </Card>
      {/* النقل المعتمد */}
      <Card title={`🔁 عمليات نقل الموارد (${transfers.length})`} icon={<Truck size={16} color={C.muted} />}>
        {transfers.length === 0 ? <div style={{ fontSize: 12, color: C.dim }}>لا عمليات نقل.</div> : [...transfers].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 20).map((t) => { const [lab, col] = TRANSFER_STATUS[t.status] || ["—", C.dim]; return (
          <div key={t.id} style={{ background: C.bg, borderRadius: 8, padding: "8px 10px", marginBottom: 6, fontSize: 12, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div><b style={{ color: C.text }}>{t.resourceLabel}</b> ({t.resourceType === "crew" ? `طاقم: مركبة + سائق ${t.driverName || ""}` : t.resourceType === "vehicle" ? "مركبة" : "سائق"}): {municipalityById(t.fromMunicipalityId)?.shortAr} ← {municipalityById(t.toMunicipalityId)?.shortAr} · <span style={{ color: col, fontWeight: 700 }}>{lab}</span><div style={{ color: C.dim, fontSize: 11 }}>الأثر: {t.impact?.receiverBefore} ← {t.impact?.receiverAfter} للمستقبِلة · {t.impact?.donorBefore} ← {t.impact?.donorAfter} للمرسِلة · {getReadingAgeLabel(t.createdAt)}{t.decisionNote ? ` · ${t.decisionNote}` : ""}</div></div>
            {isAmanah && <div style={{ display: "flex", gap: 6 }}>
              {t.status === "proposed" && <><button disabled={!!busy} onClick={run(t.id, async () => { await decideResourceTransfer(t, actor, "approved", window.prompt("ملاحظة الاعتماد:", "") ?? ""); return "✅ اعتُمد النقل — نفّذه لإعادة توطين المورد مؤقتًا"; })} style={smallBtn(C.accent)}>اعتماد</button><button disabled={!!busy} onClick={run(t.id + "x", async () => { await decideResourceTransfer(t, actor, "rejected", window.prompt("سبب الرفض:", "") ?? ""); return "رُفض النقل"; })} style={smallBtn(C.danger)}>رفض</button></>}
              {t.status === "approved" && <button disabled={!!busy} onClick={run(t.id + "e", async () => { await executeResourceTransfer(t, actor); return "🚚 نُفّذ النقل: المورد يعمل الآن ضمن البلدية المستقبِلة مؤقتًا"; })} style={smallBtn(C.info)}>تنفيذ النقل</button>}
              {t.status === "executed" && <button disabled={!!busy} onClick={run(t.id + "b", async () => { await returnResourceTransfer(t, actor); return "↩️ أُعيد المورد إلى بلديته"; })} style={smallBtn(C.dim)}>إعادة المورد</button>}
            </div>}
          </div>
        ); })}
      </Card>
      {/* 9. سجل القرارات */}
      <Card title="📜 سجل القرارات" icon={<ClipboardList size={16} color={C.muted} />}>
        {decisions.length === 0 ? <div style={{ fontSize: 12, color: C.dim }}>لا قرارات مسجلة بعد.</div> : decisions.map((a) => <div key={a.id} style={{ fontSize: 11.5, color: C.muted, background: C.bg, borderRadius: 6, padding: "6px 10px", marginBottom: 4 }}><b style={{ color: C.text }}>{AUDIT_ACTION_LABELS[a.action] || a.action}</b> · {a.actorName || "—"} · {getReadingAgeLabel(a.createdAt)}{a.details?.resource ? ` · ${a.details.resource}` : ""}{a.details?.routeName ? ` · ${a.details.routeName}` : ""}</div>)}
      </Card>
    </div>
  );
};

// ======================== CITY OPERATIONAL INTELLIGENCE + DECISION SIMULATION CENTER (Phase 6) ========================
const VERDICT_LABEL = { better: ["أفضل", C.accent], worse: ["أسوأ", C.danger], neutral: ["محايد", C.warning] };

const IntelligencePage = ({ neighborhoods = [], bins = [], profiles = [], vehicles = [], routes = [], incidents = [], recentReadings = [], fireSensors = [], citizenReports = [], loggedInUser, initialSection = null, onNavigate, modelsDetail = null }) => {
  const scope = scopeFor(loggedInUser);
  const [mid, setMid] = useState(scope.all ? "east" : scope.municipalityId);
  const [section, setSection] = useState(initialSection || "predict");
  const { settings: dispatchSettings } = useDispatchSettings(true);
  const [scenario, setScenario] = useState({ type: "vehicle_down", vehicleId: "", driverId: "", factor: 1.5, count: 3, delayMin: 20, delta: -1, fromMunicipalityId: "east", routeId: "" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const { scenarios } = useSimulationScenarios(true, scopeFor(loggedInUser).all ? null : scopeFor(loggedInUser).municipalityId || "__none__");
  const actor = { uid: loggedInUser?.uid, name: loggedInUser?.name };
  const city = useCityPressure({ neighborhoods, bins, profiles, vehicles, routes, incidents, recentReadings });
  const live = useMemo(() => city.live[mid] || { bins: [], profiles: [], vehicles: [], routes: [], incidents: [] }, [city.live, mid]);
  const munNeighborhoods = useMemo(() => neighborhoods.filter((n) => municipalityForNeighborhood(n) === mid), [neighborhoods, mid]);
  const depot = useMemo(() => { const v = live.vehicles.find((x) => x.depotLat != null); return v ? { lat: v.depotLat, lng: v.depotLng } : DEFAULT_DEPOT; }, [live.vehicles]);
  // 1. What will happen — predictions per bin in scope.
  const forecast = useMemo(() => {
    const readingsByBin = {}; for (const r of recentReadings) { if (r.bin_id) (readingsByBin[r.bin_id] ||= []).push(r); }
    const rows = live.bins.map((b) => ({ bin: b, p: predictFullTime(b, readingsByBin[b.id] || []), conn: getSensorConnectivity(b) }));
    const soon = rows.filter((r) => r.p.predictionAvailable && r.p.hoursToFull != null && r.p.hoursToFull <= 6).sort((a, b) => a.p.hoursToFull - b.p.hoursToFull);
    const insufficient = rows.filter((r) => r.conn === "online" && !r.p.predictionAvailable).length;
    const silent = rows.filter((r) => r.conn === "offline" || r.conn === "fault").length;
    return { soon, insufficient, silent, readingsByBin };
  }, [live.bins, recentReadings]);
  // 2. Best action — quick plan (Haversine) for the scope + near-route additions + transfers.
  const quickPlan = useMemo(() => {
    const ctx = makeBinContext(fireSensors, citizenReports, munNeighborhoods);
    const plan = buildCollectionPlan({ municipalityId: mid, neighborhoods: munNeighborhoods, bins: live.bins, profiles: live.profiles, vehicles: live.vehicles, routes: live.routes, readingsByBin: forecast.readingsByBin, contextFor: ctx.forBin, depot });
    const additions = suggestAdditions(plan, live.bins, new Set(forecast.soon.map((r) => r.bin.id)));
    return { plan, additions };
  }, [mid, munNeighborhoods, live, forecast, fireSensors, citizenReports, depot]);
  const pressure = city.pressures.find((p) => p.municipalityId === mid);
  const myTransfers = city.transfersRec.recommendations.filter((r) => r.toMunicipalityId === mid || r.fromMunicipalityId === mid);

  const runSim = async () => {
    setBusy("sim"); setMsg("");
    try {
      const state = { municipalityId: mid, municipalityName: municipalityById(mid)?.shortAr, neighborhoods: munNeighborhoods, bins: live.bins, profiles: live.profiles, vehicles: live.vehicles, routes: live.routes, incidents: live.incidents,
        extraVehicles: vehicles.filter((v) => v.municipalityId === scenario.fromMunicipalityId && v.status === "available"), extraProfiles: profiles.filter((p) => p.municipalityId === scenario.fromMunicipalityId && p.shiftStatus === "on_shift") };
      const sc = { ...scenario };
      if (sc.type === "transfer_vehicle") { const d = state.extraProfiles.find((p) => p.vehicleId === sc.vehicleId); sc.withDriver = !!d; sc.driver = d || null; }
      const r = simulateDecision(state, sc, { depot });
      setResult(r);
      await saveSimulationScenario({ municipalityId: mid, scenario: sc, verdict: r.verdict, recommendation: r.recommendation, baseline: r.baseline, result: r.result, delta: r.delta, notes: r.notes, explanation: r.explanation, assumptions: r.assumptions, demo: live.bins.some((b) => b.demo) }, actor);
      await writeAuditLog("decision_simulated", actor.uid, actor.name, { municipalityId: mid, type: sc.type, verdict: r.verdict });
    } catch (e) { setMsg("تعذر تنفيذ العملية: " + friendlyError(e)); } finally { setBusy(""); }
  };
  const field = (label, el) => <label style={{ fontSize: 11, color: C.muted, display: "flex", flexDirection: "column", gap: 4 }}>{label}{el}</label>;
  const sel = (value, onChange, options) => <select value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 12, fontFamily: ARABIC_FONT }}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  const num = (value, onChange) => <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 12, fontFamily: ARABIC_FONT, width: 110 }} />;
  const metric = (l, b, r, unit = "", invert = false) => { const d = r != null && b != null ? r - b : null; const good = d == null || d === 0 ? C.muted : (invert ? d < 0 : d > 0) ? C.accent : C.danger; return <div key={l} style={{ background: C.bg, borderRadius: 8, padding: "8px 10px" }}><div style={{ fontSize: 10.5, color: C.muted }}>{l}</div><div style={{ fontSize: 13, color: C.text }}>{b ?? "—"}{unit} ← <b style={{ color: good }}>{r ?? "—"}{unit}</b></div></div>; };
  if (!can(loggedInUser?.role, "intelligence.view")) return <EmptyState icon="🔒" title="غير مصرح" />;
  const [plab, pcol] = PRESSURE_LABEL[pressure?.level || "low"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: C.muted }}>كل نتيجة هنا محسوبة من المحركات (التنبؤ، التخطيط، الضغط، المحاكاة) — لا نصوص مولَّدة.</div>
        {scope.all && <label style={{ fontSize: 12, color: C.muted, display: "inline-flex", gap: 6, alignItems: "center" }}>البلدية {sel(mid, (v) => { setMid(v); setResult(null); }, MUNICIPALITIES.map((m) => [m.id, m.nameAr]))}</label>}
      </div>
      <Tabs value={section} onChange={setSection} tabs={[
        { key: "predict", label: "التنبؤات — ماذا سيحدث؟", count: forecast.soon.length || null, tone: "warning" },
        { key: "act", label: "التوصيات — ما أفضل إجراء؟", count: (quickPlan.additions.suggestions.length + myTransfers.length + quickPlan.plan.routes.length) || null, tone: "info" },
        { key: "impact", label: "المحاكاة — ما أثر القرار؟" },
        ...(modelsDetail ? [{ key: "models", label: "تفاصيل نماذج التنبؤ" }] : []),
      ]} />

      {section === "predict" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {[["الضغط التشغيلي", `${pressure?.index ?? "—"} (${plab})`, pcol], ["حرجة الآن", pressure?.critical ?? 0, C.danger], ["متوقع امتلاؤها ≤ 6 س", forecast.soon.length, C.purple], ["بيانات غير كافية للتنبؤ", forecast.insufficient, C.dim], ["مستشعرات صامتة/معطلة", forecast.silent, C.warning], ["سائقون جاهزون / مركبات", `${pressure?.readyDrivers ?? 0} / ${pressure?.usableVehicles ?? 0}`, C.info]].map(([l, v, c]) => (
              <div key={l} style={{ background: C.card, border: `1px solid ${c}30`, borderRadius: 12, padding: "12px 14px" }}><div style={{ fontSize: 20, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 11, color: C.muted }}>{l}</div></div>
            ))}
          </div>
          <Card title="🔮 التنبؤات والمخاطر القادمة" icon={<Sparkles size={16} color={C.muted} />}>
            {forecast.soon.length === 0 ? <div style={{ fontSize: 12, color: C.muted }}>لا حاويات متوقع وصولها للمستوى الحرج خلال 6 ساعات وفق القراءات الحالية.{forecast.insufficient ? ` (${forecast.insufficient} حاوية بيانات غير كافية للتنبؤ)` : ""}</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 320, overflowY: "auto" }}>
                {forecast.soon.slice(0, 30).map(({ bin: b, p }) => <div key={b.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, background: C.bg, borderRadius: 8, padding: "7px 10px", flexWrap: "wrap" }}><span><b style={{ color: C.text }}>{b.name}</b> · الآن {b.lastFillLevelPercent}%</span><span style={{ color: p.hoursToFull <= 2 ? C.danger : C.warning }}>حرجة خلال ~{Math.round(p.hoursToFull * 10) / 10} س · ثقة {CONFIDENCE_LABELS[p.confidence] || p.confidence}</span></div>)}
              </div>
            )}
            <div style={{ fontSize: 10.5, color: C.dim, marginTop: 8 }}>التنبؤ: انحدار خطي على القراءات بعد آخر تفريغ مع كشف الشذوذ؛ لا تنبؤ من قراءة واحدة، والمستشعرات الصامتة تُعرض مخاطر بلا توقع.</div>
          </Card>
          {pressure && <Card title="⚖️ لماذا هذا الضغط؟" icon={<Gauge size={16} color={C.muted} />}><div style={{ fontSize: 12, color: C.muted, lineHeight: 1.9 }}>{pressure.reasons.join(" · ")} — الطلب {pressure.demandUnits} وحدة مقابل طاقة {pressure.capacityUnits} حاوية في {pressure.remainingShiftHours} ساعات متبقية.</div></Card>}
        </div>
      )}

      {section === "act" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Section title="الجولات المقترحة الآن" count={quickPlan.plan.routes.length} hint="خطة سريعة بالمسافات الجوية؛ الخطة الكاملة على الطرق الفعلية في «خطة الجمع الذكية»"
            actions={<>{onNavigate && <Btn variant="primary" onClick={() => onNavigate("control", { tab: "plan" })}>فتح خطة الجمع الذكية</Btn>}{onNavigate && dispatchSettings?.mode === "auto" && <Btn onClick={() => onNavigate("control", { tab: "dispatch" })}>الإسناد التلقائي</Btn>}</>}>
            <AttentionList max={5} empty="لا حاويات مؤهلة للجمع الآن في هذه البلدية" items={quickPlan.plan.routes.map((r) => ({ id: "qp_" + r.neighborhoodId, tone: r.driver ? "info" : "warning",
              title: `${r.routeName}: ${r.stops.length} حاوية · ${r.distanceKm} كم`, meta: r.driver ? `السائق المقترح: ${r.driver.driverName} (${r.driver.vehicleNumber})` : "لا سائق مؤهل — يحتاج إسنادًا يدويًا أو دعمًا",
              detail: explainRoute(r) }))} />
            {quickPlan.plan.constraints.length > 0 && <Disclosure summary={`القيود (${quickPlan.plan.constraints.length})`}><ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12, color: C.warning }}>{quickPlan.plan.constraints.map((c, i) => <li key={i}>{c}</li>)}</ul></Disclosure>}
          </Section>
          <Section title="توصيات قابلة للتنفيذ" count={quickPlan.additions.suggestions.length + myTransfers.length}>
            <AttentionList max={6} empty="لا توصيات إضافية الآن" items={[
              ...quickPlan.additions.suggestions.map((a) => ({ id: "add_" + a.binId, tone: "info", title: `أضف ${a.binName} إلى ${a.routeName}`, meta: `متوقع امتلاؤها قريبًا · ${a.km} كم من ${a.near}`,
                actionLabel: dispatchSettings?.mode === "auto" ? "دع الإسناد التلقائي يضيفها" : "فتح الجولات", onAction: () => onNavigate && onNavigate("control", { tab: dispatchSettings?.mode === "auto" ? "dispatch" : "routes" }) })),
              ...myTransfers.map((t, i) => ({ id: "tr_" + i, tone: "warning", title: `نقل ${t.resourceType === "crew" ? "طاقم" : t.resourceType === "vehicle" ? "مركبة" : "سائق"} ${t.resourceLabel}: ${t.fromName} ← ${t.toName}`,
                meta: `ضغط المستقبِلة ${t.impact.receiverBefore} ← ${t.impact.receiverAfter} · المرسِلة ${t.impact.donorBefore} ← ${t.impact.donorAfter} · ~${t.travelMin ?? "?"} د`, detail: t.reason,
                actionLabel: can(loggedInUser?.role, "transfers.propose") ? "القيادة الاستراتيجية" : "جرّب أثره في المحاكاة", onAction: () => can(loggedInUser?.role, "transfers.propose") ? onNavigate && onNavigate("exec") : setSection("impact") })),
            ]} />
            <div style={{ fontSize: FS.meta, color: C.dim, marginTop: 8 }}>نقل الموارد بين البلديات يتطلب اعتماد الأمانة؛ متخذ القرار بالبلدية يطلب الدعم من «بلديتي ← مؤشرات الأداء».</div>
          </Section>
        </div>
      )}

      {section === "models" && modelsDetail}
      {section === "impact" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card title="🧪 مركز محاكاة القرارات — ماذا لو؟" icon={<Gauge size={16} color={C.muted} />}>
            {!can(loggedInUser?.role, "decisions.simulate") && <div style={{ fontSize: 12, color: C.warning, marginBottom: 8 }}>تشغيل السيناريوهات متاح لمتخذي القرار (الأمانة/متخذ القرار بالبلدية)؛ يمكنك الاطلاع على النتائج المحفوظة.</div>}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              {field("السيناريو", sel(scenario.type, (v) => setScenario({ ...scenario, type: v }), Object.entries(SCENARIO_TYPES).map(([k, s]) => [k, s.label])))}
              {["vehicle_down"].includes(scenario.type) && field("المركبة", sel(scenario.vehicleId, (v) => setScenario({ ...scenario, vehicleId: v }), [["", "اختر…"], ...live.vehicles.map((v) => [v.id, `${v.vehicleNumber} (${VEHICLE_STATUS_LABELS[v.status] || v.status})`])]))}
              {["driver_absent"].includes(scenario.type) && field("السائق", sel(scenario.driverId, (v) => setScenario({ ...scenario, driverId: v }), [["", "اختر…"], ...live.profiles.map((p) => [p.uid, `${p.fullName} (${SHIFT_STATUS_LABELS[p.shiftStatus]})`])]))}
              {["transfer_vehicle", "transfer_driver"].includes(scenario.type) && field("من بلدية", sel(scenario.fromMunicipalityId, (v) => setScenario({ ...scenario, fromMunicipalityId: v, vehicleId: "", driverId: "" }), MUNICIPALITIES.filter((m) => m.id !== mid).map((m) => [m.id, m.shortAr])))}
              {scenario.type === "transfer_vehicle" && field("المركبة المنقولة", sel(scenario.vehicleId, (v) => setScenario({ ...scenario, vehicleId: v }), [["", "اختر…"], ...vehicles.filter((v) => v.municipalityId === scenario.fromMunicipalityId && v.status === "available").map((v) => [v.id, v.vehicleNumber])]))}
              {scenario.type === "transfer_driver" && field("السائق المنقول", sel(scenario.driverId, (v) => setScenario({ ...scenario, driverId: v }), [["", "اختر…"], ...profiles.filter((p) => p.municipalityId === scenario.fromMunicipalityId && p.shiftStatus === "on_shift").map((p) => [p.uid, p.fullName])]))}
              {scenario.type === "waste_rate_up" && field("المعامل", num(scenario.factor, (v) => setScenario({ ...scenario, factor: v })))}
              {scenario.type === "more_critical" && field("عدد الحاويات", num(scenario.count, (v) => setScenario({ ...scenario, count: v })))}
              {["road_closed", "route_delayed"].includes(scenario.type) && field("التأخير (د)", num(scenario.delayMin, (v) => setScenario({ ...scenario, delayMin: v })))}
              {scenario.type === "route_delayed" && field("الجولة", sel(scenario.routeId, (v) => setScenario({ ...scenario, routeId: v }), [["", "اختر…"], ...live.routes.filter((r) => ["approved", "in_progress"].includes(r.status)).map((r) => [r.id, r.routeName])]))}
              {scenario.type === "vehicles_count" && field("التغير (±)", num(scenario.delta, (v) => setScenario({ ...scenario, delta: v })))}
              <button disabled={!!busy || !can(loggedInUser?.role, "decisions.simulate")} onClick={runSim} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: C.purple, color: "#fff", fontWeight: 800, fontSize: 12.5, cursor: "pointer", fontFamily: ARABIC_FONT }}>{busy === "sim" ? "جاري المحاكاة…" : "▶️ تشغيل السيناريو على نسخة معزولة"}</button>
            </div>
            {msg && <div style={{ fontSize: 12, color: C.danger, marginTop: 8 }}>{msg}</div>}
            {result && (() => { const [vl, vc] = VERDICT_LABEL[result.verdict]; return (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}><div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>النتيجة مقابل خط الأساس</div><span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: vc + "20", color: vc }}>{vl}</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginTop: 8 }}>
                  {metric("حاويات مخدومة", result.baseline.served, result.result.served)}
                  {metric("غير مخدومة", result.baseline.unserved, result.result.unserved, "", true)}
                  {metric("جولات بلا سائق", result.baseline.unassignedRoutes, result.result.unassignedRoutes, "", true)}
                  {metric("زمن الاستجابة", result.baseline.avgResponseMin, result.result.avgResponseMin, " د", true)}
                  {metric("المسافة", result.baseline.km, result.result.km, " كم", true)}
                  {metric("مدة التشغيل", result.baseline.minutes, result.result.minutes, " د", true)}
                  {metric("استغلال المركبات", result.baseline.utilization, result.result.utilization, "%")}
                  {metric("التكلفة التقديرية", result.baseline.cost, result.result.cost, " ر.س", true)}
                  {metric("الضغط التشغيلي", result.baseline.pressure, result.result.pressure, "", true)}
                </div>
                <div style={{ fontSize: 12.5, color: C.text, background: vc + "12", border: `1px solid ${vc}40`, borderRadius: 10, padding: "8px 12px", marginTop: 8, fontWeight: 700 }}>{result.recommendation}</div>
                <ul style={{ margin: "8px 0 0", paddingInlineStart: 18, fontSize: 12, color: C.muted, lineHeight: 1.9 }}>{result.explanation.map((t, i) => <li key={i}>{t}</li>)}</ul>
                <div style={{ fontSize: 10.5, color: C.dim, marginTop: 6 }}>{result.assumptions.note} · وقود {result.assumptions.fuelPricePerLiter} ر.س/لتر · طاقم {result.assumptions.crewCostPerHour} ر.س/ساعة · لا تغيير على البيانات الفعلية.</div>
              </div>
            ); })()}
          </Card>
          <Card title={`سجل السيناريوهات (${(scenarios || []).length})`} icon={<ClipboardList size={16} color={C.muted} />}>
            {(scenarios || []).length === 0 ? <div style={{ fontSize: 12, color: C.dim }}>لا سيناريوهات محفوظة.</div> : [...(scenarios || [])].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 12).map((s) => { const [vl, vc] = VERDICT_LABEL[s.verdict] || VERDICT_LABEL.neutral; return <div key={s.id} style={{ fontSize: 11.5, color: C.muted, background: C.bg, borderRadius: 6, padding: "6px 10px", marginBottom: 4 }}><b style={{ color: C.text }}>{municipalityById(s.municipalityId)?.shortAr}</b> · {SCENARIO_TYPES[s.scenario?.type]?.label} · <span style={{ color: vc }}>{vl}</span> · غير مخدومة {s.baseline?.unserved} ← {s.result?.unserved} · ضغط {s.baseline?.pressure} ← {s.result?.pressure} · {s.createdByName || "—"} · {getReadingAgeLabel(s.createdAt)}</div>; })}
          </Card>
        </div>
      )}
    </div>
  );
};

/** Executive tabs whose figures are generated / seeded (illustrative), not derived from live operations. */
const EXEC_ILLUSTRATIVE_TABS = [["overview", "نظرة تنفيذية"], ["financial", "التحليل المالي"], ["districts", "أداء الأحياء"], ["benchmark", "المقارنة المعيارية"], ["scenarios", "سيناريوهات القرار"], ["strategic", "الأهداف الاستراتيجية"]];
const ExecDashboard = ({ user, onLogout, stations, monthlyTrend, weeklyData, neighborhoods = [], bins = [], routes = [], fireSensors = [], citizenReports = [], collectionEvents = [], auditLog = [], vehicles = [], recentReadings = [], profiles = [], incidents = [], supportRequests = [], transfers = [], loggedInUser = null, onOpenMunicipality , embedded = false}) => {
  const [tab, setTab] = useState("amanah");

  // ── "ملخص اليوم" — the city on one page, from live smart-bin data ──
  const today = useMemo(() => {
    const ctx = makeBinContext(fireSensors, citizenReports, neighborhoods);
    const readingsByBin = {};
    for (const r of recentReadings) { if (r.bin_id) (readingsByBin[r.bin_id] ||= []).push(r); }
    const scored = bins.map((bin) => ({ bin, priority: getBinPriority(bin, null, readingsByBin[bin.id] || [], ctx.forBin(bin)) }));
    const groups = groupNeighborhoodsByName(neighborhoods, bins);
    const ranked = rankNeighborhoodsForCollection(groups, scored, routes, { thermalAlertFor: makeThermalAlertFor(fireSensors), centroidFor: centroidForGroup });
    const impact = computeImpactMetrics(groups, scored, routes, { depot: DEFAULT_DEPOT });
    const fleet = computeFleetPerformance(routes, collectionEvents, auditLog, vehicles);
    const offline = bins.filter((b) => { const c = getSensorConnectivity(b); return c === "offline" || c === "fault"; });
    const offlineHeavy = groups.map((g) => { const idSet = new Set(g.ids); const nb = bins.filter((b) => idSet.has(b.neighborhoodId)); const off = nb.filter((b) => { const c = getSensorConnectivity(b); return c === "offline" || c === "fault"; }); return { g, nb, off }; }).filter((x) => x.nb.length > 0 && x.off.length / x.nb.length >= 0.5);
    const thermal = groups.filter((g) => makeThermalAlertFor(fireSensors)(g.name));
    const decisions = [];
    ranked.slice(0, 3).forEach((r) => decisions.push({
      icon: r.criticalCount > 0 ? "🔴" : "🟠", title: `${r.openRoute ? "اعتمد" : "ولّد واعتمد"} جولة ${r.group.name}`,
      why: `${r.criticalCount} حرجة · ${r.highCount} مرتفعة من أصل ${r.total}${r.thermalAlert ? " · تنبيه حراري" : ""}`,
      state: r.openRoute ? `${ROUTE_STATUS_LABELS[r.openRoute.status]} — ${r.openRoute.binIds?.length || 0} حاوية` : "لا توجد جولة بعد",
    }));
    offlineHeavy.forEach((x) => decisions.push({ icon: "⚫", title: `صيانة مستشعرات ${x.g.name}`, why: `${x.off.length} من ${x.nb.length} حاوية بلا بيانات موثوقة — القرارات هناك تعتمد على آخر قراءة قديمة`, state: "طلب فريق الصيانة" }));
    thermal.forEach((g) => decisions.push({ icon: "🔥", title: `متابعة التنبيه الحراري في ${g.name}`, why: "مستشعر حرارة/غاز فوق حد الإنذار", state: "إشعار الدفاع المدني عند استمرار الارتفاع" }));
    if (ctx.openCount > 0) decisions.push({ icon: "📣", title: `${ctx.openCount} بلاغ مواطن مفتوح`, why: "مرفوعة ضمن أولوية الحاويات المعنية تلقائيًا", state: "رد على المواطنين بعد الجمع" });
    return { scored, ranked, impact, fleet, offline, decisions: decisions.slice(0, 6), groupsCount: groups.length,
      critical: scored.filter((s) => s.priority.tier === "critical").length,
      suggested: routes.filter((r) => r.status === "suggested").length, approved: routes.filter((r) => r.status === "approved").length, active: routes.filter((r) => r.status === "in_progress").length,
      avgFill: (() => { const v = bins.map((b) => b.lastFillLevelPercent).filter((x) => x != null && x <= 100); return v.length ? Math.round(v.reduce((a, x) => a + x, 0) / v.length) : null; })(),
    };
  }, [neighborhoods, bins, routes, fireSensors, citizenReports, collectionEvents, auditLog, vehicles, recentReadings]);
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [showPassModal, setShowPassModal] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  // ── Analytics من Firestore (مع fallback للقيم الافتراضية) ────────
  const { data: _qdoc  } = useAnalyticsDoc("quarterly");
  const { data: _dpdoc } = useAnalyticsDoc("districts_perf");
  const { data: _roidoc } = useAnalyticsDoc("roi");
  const { data: _satdoc } = useAnalyticsDoc("satisfaction");

  const quarterlyData = _qdoc?.data  || generateQuarterlyData();
  const districtPerf  = _dpdoc?.data || generateDistrictPerformance();
  const roiData       = _roidoc?.data || generateROIData();
  const benchmarkData = useMemo(() => generateBenchmarkData(), []);
  const scenarios     = useMemo(() => generateScenarios(), []);

  const totalRevenue = quarterlyData.reduce((a, q) => a + q.الإيرادات, 0);
  const totalCost = quarterlyData.reduce((a, q) => a + q.التكاليف, 0);
  const totalProfit = quarterlyData.reduce((a, q) => a + q.الأرباح, 0);
  const avgEfficiency = Math.round(quarterlyData.reduce((a, q) => a + q.الكفاءة, 0) / 4);
  const bestDistrict = districtPerf.reduce((max, d) => d.الأداء > max.الأداء ? d : max, districtPerf[0]);
  const worstDistrict = districtPerf.reduce((min, d) => d.الأداء < min.الأداء ? d : min, districtPerf[0]);

  const costBreakdown = [
    { name: "التشغيل", value: 40, color: C.info },
    { name: "الصيانة", value: 20, color: C.warning },
    { name: "الموظفون", value: 25, color: C.purple },
    { name: "الوقود", value: 10, color: C.danger },
    { name: "أخرى", value: 5, color: C.dim },
  ];

  const satisfactionTrend = _satdoc?.data || [
    { month:"يناير",   الرضا:70, الشكاوى:28 }, { month:"فبراير",  الرضا:72, الشكاوى:26 },
    { month:"مارس",    الرضا:73, الشكاوى:25 }, { month:"أبريل",   الرضا:75, الشكاوى:23 },
    { month:"مايو",    الرضا:76, الشكاوى:21 }, { month:"يونيو",   الرضا:78, الشكاوى:20 },
    { month:"يوليو",   الرضا:79, الشكاوى:18 }, { month:"أغسطس",  الرضا:80, الشكاوى:17 },
    { month:"سبتمبر", الرضا:82, الشكاوى:15 }, { month:"أكتوبر", الرضا:83, الشكاوى:14 },
    { month:"نوفمبر", الرضا:85, الشكاوى:12 }, { month:"ديسمبر", الرضا:87, الشكاوى:10 },
  ];

  const strategicGoals = [
    { goal: "رفع كفاءة التشغيل إلى 95%", current: avgEfficiency, target: 95, color: C.accent },
    { goal: "خفض التكاليف التشغيلية 25%", current: 72, target: 100, color: C.info },
    { goal: "تغطية 100% من أحياء بريدة", current: 85, target: 100, color: C.warning },
    { goal: "الوصول لصفر نفايات 2030", current: 42, target: 100, color: C.purple },
    { goal: "رضا المواطنين 90%+", current: 82, target: 90, color: "#ec4899" },
    { goal: "إعادة تدوير 80% من النفايات", current: 68, target: 80, color: "#06b6d4" },
  ];

  return (
    <div dir="rtl" style={{ fontFamily: ARABIC_FONT, background: C.bg, color: C.text, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* Executive Header (hidden when embedded in the main shell, which already provides header, password and session timeout) */}
      {!embedded && <header style={{ padding: isMobile ? "10px 14px" : "12px 28px", background: C.brand, borderBottom: `1px solid ${C.brandSoft}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "nowrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div style={{ flexShrink: 0 }}><AppLogo size={38} /></div>
          {!isMobile && <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: C.warning }}>بوابة متخذي القرار</div>
            <div style={{ fontSize: 10, color: C.muted }}>نظام إدارة النفايات - بريدة • <ExecHeaderClock /></div>
          </div>}
          {isMobile && <div style={{ fontSize: 14, fontWeight: 800, color: C.warning, whiteSpace: "nowrap" }}>بوابة القرار</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 10, flexShrink: 0 }}>
          {!isMobile && <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{user.name}</div>
            <div style={{ fontSize: 10, color: C.warning }}>{user.roleTitle}</div>
          </div>}
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#f59e0b20", display: "flex", alignItems: "center", justifyContent: "center" }}><User size={18} color={C.warning} /></div>
          {!isMobile && <button onClick={() => window.__showAdminPanel && window.__showAdminPanel()} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #8b5cf640", background: "#8b5cf615", color: C.purple, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: ARABIC_FONT, display: "flex", alignItems: "center", gap: 5 }}><Crown size={13} /> إدارة المستخدمين</button>}
          <button onClick={() => setShowPassModal(true)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #10b98140", background: "#10b98115", color: C.accent, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: ARABIC_FONT, display: "flex", alignItems: "center", gap: 5 }}><SettingsIcon size={13} />{!isMobile && " إعدادات"}</button>
          <button onClick={onLogout} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ef444440", background: "#ef444415", color: C.danger, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: ARABIC_FONT, display: "flex", alignItems: "center", gap: 5 }}><LogOut size={13} />{!isMobile && " خروج"}</button>
        </div>
      </header>}
      {showPassModal && <ChangePasswordModal onClose={() => setShowPassModal(false)} />}
      {!embedded && <SessionTimeout onLogout={onLogout} timeoutMin={30} countdownSec={10} />}

      {/* Tabs: live operations first; tabs built on generated/seeded figures are labelled «توضيحي» */}
      <div style={{ padding: embedded ? 0 : isMobile ? "10px 12px 0" : "12px 28px 0", display: "flex", flexDirection: "column", gap: 8 }}>
        <Tabs value={tab} onChange={setTab} tabs={[
          { key: "amanah", label: "القيادة الاستراتيجية" },
          { key: "today", label: "ملخص اليوم" },
          ...(embedded ? [] : [{ key: "brain", label: "العقل التشغيلي للمدينة" }]),
          ...EXEC_ILLUSTRATIVE_TABS.map(([key, label]) => ({ key, label: `${label} · توضيحي` })),
        ]} />
        {embedded && <div style={{ display: "flex", justifyContent: "flex-end" }}><Btn variant="ghost" onClick={() => window.__showAdminPanel && window.__showAdminPanel()}>إدارة المستخدمين</Btn></div>}
        {EXEC_ILLUSTRATIVE_TABS.some(([k]) => k === tab) && (
          <div role="note" style={{ fontSize: 12.5, color: C.warning, background: C.warning + "12", border: `1px solid ${C.warning}50`, borderRadius: 10, padding: "8px 12px" }}>
            <b>بيانات توضيحية:</b> أرقام هذا التبويب مولّدة أو من بيانات التهيئة لعرض شكل التحليل، ولا تُشتق من التشغيل الفعلي. لا تُستخدم لاتخاذ قرار.
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: embedded ? "14px 0 0" : "20px 28px" }}>

        {/* ===== TODAY — one page for the decision maker, exportable to PDF ===== */}
        {tab === "brain" && <IntelligencePage neighborhoods={neighborhoods} bins={bins} profiles={profiles} vehicles={vehicles} routes={routes} incidents={incidents} recentReadings={recentReadings} fireSensors={fireSensors} citizenReports={citizenReports} loggedInUser={loggedInUser || user} />}
        {tab === "amanah" && <AmanahStrategicPanel neighborhoods={neighborhoods} bins={bins} profiles={profiles} vehicles={vehicles} routes={routes} incidents={incidents} recentReadings={recentReadings} fireSensors={fireSensors} citizenReports={citizenReports} supportRequests={supportRequests} transfers={transfers} auditLog={auditLog} loggedInUser={loggedInUser || user} onOpenMunicipality={onOpenMunicipality} />}
        {tab === "today" && (
          <div id="exec-today" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <style>{`@media print { body * { visibility: hidden !important; } #exec-today, #exec-today * { visibility: visible !important; } #exec-today { position: absolute; inset: 0; padding: 16px; background: #fff; color: #111; } .no-print { display: none !important; } }`}</style>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, color: C.warning }}>ملخص المدينة اليوم — {new Date().toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
                <div style={{ fontSize: 12, color: C.muted }}>أرقام حية من الحاويات الذكية والجولات — جاهزة للتصدير كتقرير PDF أسبوعي.</div>
              </div>
              <button className="no-print" onClick={() => window.print()} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#000", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>🖨️ تصدير PDF</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
              {[
                { label: "أحياء مغطاة", value: today.groupsCount, color: C.warning },
                { label: "حاويات ذكية", value: bins.length, color: C.info },
                { label: "حاويات حرجة الآن", value: today.critical, color: C.danger },
                { label: "أحياء تحتاج جمعًا الآن", value: today.ranked.length, color: C.danger },
                { label: "متوسط الامتلاء", value: today.avgFill != null ? `${today.avgFill}%` : "—", color: C.purple },
                { label: "جولات مقترحة / معتمدة / نشطة", value: `${today.suggested} / ${today.approved} / ${today.active}`, color: C.accent },
                { label: "مستشعرات بلا بيانات موثوقة", value: today.offline.length, color: C.dim },
                { label: "جولات مكتملة (7 أيام)", value: today.fleet.totals.routes, color: C.accent },
              ].map((t) => (
                <div key={t.label} style={{ background: C.card, border: `1px solid ${t.color}30`, borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: t.color }}>{t.value}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{t.label}</div>
                </div>
              ))}
            </div>

            <Card title="📌 القرارات المقترحة اليوم" icon={<Target size={16} color={C.muted} />}>
              {today.decisions.length === 0 ? <EmptyState icon="✅" title="لا توجد قرارات عاجلة اليوم" /> : (
                <ol style={{ margin: 0, paddingInlineStart: 20, display: "flex", flexDirection: "column", gap: 10 }}>
                  {today.decisions.map((d, i) => (
                    <li key={i} style={{ fontSize: 13, color: C.text, lineHeight: 1.7 }}>
                      <b>{d.icon} {d.title}</b><br />
                      <span style={{ color: C.muted, fontSize: 12 }}>لماذا: {d.why}</span> · <span style={{ color: C.info, fontSize: 12 }}>الحالة: {d.state}</span>
                    </li>
                  ))}
                </ol>
              )}
              <div style={{ fontSize: 10.5, color: C.dim, marginTop: 8 }}>القرارات مقترحة من محرك القرار بمبرراتها — اعتمادها يبقى قرار الإدارة/المشرف.</div>
            </Card>

            <ImpactCard impact={today.impact} compact accent={C.warning} />

            <Card title="🚛 الأسطول خلال 7 أيام" icon={<Truck size={16} color={C.muted} />}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                {[
                  { label: "جولات مكتملة", value: today.fleet.totals.routes },
                  { label: "حاويات جُمعت", value: today.fleet.totals.collected },
                  { label: "التزام الوقت", value: today.fleet.totals.onTimePct != null ? `${today.fleet.totals.onTimePct}%` : "—" },
                  { label: "امتلاء عند الجمع", value: today.fleet.totals.avgFillAtCollection != null ? `${today.fleet.totals.avgFillAtCollection}%` : "—" },
                  { label: "اعتماد → بدء", value: today.fleet.totals.avgApprovalToStartMin != null ? `${today.fleet.totals.avgApprovalToStartMin} د` : "—" },
                  { label: "أعطال/عوائق", value: today.fleet.totals.incidents },
                ].map((t) => (
                  <div key={t.label} style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.warning }}>{t.value}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{t.label}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* ===== EXECUTIVE OVERVIEW ===== */}
        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
              <StatCard title="إجمالي الإيرادات" value={(totalRevenue / 1000000).toFixed(2)} unit="مليون ر.س" icon={<DollarSign size={22} color="#fff" />} gradient="linear-gradient(135deg, #f59e0b, #d97706)" />
              <StatCard title="إجمالي التكاليف" value={(totalCost / 1000000).toFixed(2)} unit="مليون ر.س" icon={<TrendingDown size={22} color="#fff" />} gradient="linear-gradient(135deg, #ef4444, #dc2626)" />
              <StatCard title="صافي الأرباح" value={(totalProfit / 1000000).toFixed(2)} unit="مليون ر.س" icon={<TrendingUp size={22} color="#fff" />} gradient="linear-gradient(135deg, #10b981, #059669)" trend={18.5} />
              <StatCard title="كفاءة التشغيل" value={avgEfficiency} unit="%" icon={<Zap size={22} color="#fff" />} gradient="linear-gradient(135deg, #3b82f6, #1d4ed8)" trend={5.2} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
              <Card title="الأداء الربعي (ر.س)" icon={<BarChart2 size={16} color={C.muted} />}>
                <ChartBox height={280}><ResponsiveContainer>
                  <ComposedChart data={quarterlyData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="quarter" tick={{ fill: C.muted, fontSize: 12 }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                    <Bar dataKey="الإيرادات" fill={C.warning} radius={[4, 4, 0, 0]} opacity={0.8} />
                    <Bar dataKey="التكاليف" fill={C.danger} radius={[4, 4, 0, 0]} opacity={0.6} />
                    <Line type="monotone" dataKey="الأرباح" stroke={C.accent} strokeWidth={3} dot={{ r: 5 }} />
                  </ComposedChart>
                </ResponsiveContainer></ChartBox>
              </Card>

              <Card title="رضا المواطنين والشكاوى" icon={<Smile size={16} color={C.muted} />}>
                <ChartBox height={280}><ResponsiveContainer>
                  <AreaChart data={satisfactionTrend} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="gSat" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.accent} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={C.accent} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 9, fontFamily: ARABIC_FONT }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                    <Area type="monotone" dataKey="الرضا" stroke={C.accent} fill="url(#gSat)" strokeWidth={2} name="نسبة الرضا %" />
                    <Line type="monotone" dataKey="الشكاوى" stroke={C.danger} strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} name="الشكاوى" />
                  </AreaChart>
                </ResponsiveContainer></ChartBox>
              </Card>
            </div>

            {/* Quick Insights */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 14 }}>
              {[
                { title: "أفضل حي أداءً", value: bestDistrict.district, sub: `${bestDistrict.الأداء}% كفاءة`, icon: <Trophy size={26} color={C.accent} />, color: C.accent },
                { title: "حي يحتاج تحسين", value: worstDistrict.district, sub: `${worstDistrict.الأداء}% كفاءة`, icon: <AlertTriangle size={26} color={C.danger} />, color: C.danger },
                { title: "هامش الربح", value: `${Math.round((totalProfit / totalRevenue) * 100)}%`, sub: "نسبة مئوية سنوية", icon: <TrendingUp size={26} color={C.warning} />, color: C.warning },
                { title: "العائد على الاستثمار", value: "340%", sub: "منذ بداية المشروع", icon: <Target size={26} color={C.purple} />, color: C.purple },
              ].map((insight, i) => (
                <div key={i} style={{ background: C.card, border: `1px solid ${insight.color}30`, borderRadius: 14, padding: 18, display: "flex", gap: 14, alignItems: "center" }}>
                  <div style={{ width: 50, height: 50, borderRadius: 14, background: `${insight.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>{insight.icon}</div>
                  <div>
                    <div style={{ fontSize: 11, color: C.dim }}>{insight.title}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: insight.color }}>{insight.value}</div>
                    <div style={{ fontSize: 10, color: C.muted }}>{insight.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== FINANCIAL ANALYSIS ===== */}
        {tab === "financial" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
              <Card title="العائد على الاستثمار الشهري (ر.س)" icon={<TrendingUp size={16} color={C.muted} />}>
                <ChartBox height={300}><ResponsiveContainer>
                  <AreaChart data={roiData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="gROI" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.warning} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={C.warning} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 9, fontFamily: ARABIC_FONT }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                    <Area type="monotone" dataKey="العائد" stroke={C.warning} fill="url(#gROI)" strokeWidth={2} />
                    <Line type="monotone" dataKey="الاستثمار" stroke={C.danger} strokeWidth={2} strokeDasharray="4 4" dot={false} />
                    <Line type="monotone" dataKey="التوفير" stroke={C.accent} strokeWidth={2} dot={{ r: 3 }} />
                  </AreaChart>
                </ResponsiveContainer></ChartBox>
              </Card>

              <Card title="توزيع التكاليف التشغيلية" icon={<LucidePieChart size={16} color={C.muted} />}>
                <ChartBox height={240}><ResponsiveContainer>
                  <PieChart>
                    <Pie data={costBreakdown} cx="50%" cy="50%" outerRadius={90} innerRadius={50} dataKey="value" paddingAngle={3}
                      label={({ name, value }) => `${name} ${value}%`}>
                      {costBreakdown.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer></ChartBox>
              </Card>
            </div>

            <Card title="مقارنة التكلفة لكل حي (ر.س/شهر)" icon={<Banknote size={16} color={C.muted} />}>
              <ChartBox height={300}><ResponsiveContainer>
                <BarChart data={districtPerf} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="district" tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                  <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="التكلفة" radius={[6, 6, 0, 0]} name="التكلفة الشهرية (ر.س)">
                    {districtPerf.map((e, i) => <Cell key={i} fill={e.التكلفة > 35000 ? C.danger : e.التكلفة > 30000 ? C.warning : C.accent} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer></ChartBox>
            </Card>
          </div>
        )}

        {/* ===== DISTRICTS ===== */}
        {tab === "districts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Card title="أداء الأحياء الشامل" icon={<Building size={16} color={C.muted} />}>
              <ChartBox height={350}><ResponsiveContainer>
                <BarChart data={districtPerf} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: C.muted, fontSize: 10 }} />
                  <YAxis dataKey="district" type="category" width={60} tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                  <Bar dataKey="الأداء" fill={C.info} radius={[0, 4, 4, 0]} opacity={0.8} name="الأداء %" />
                  <Bar dataKey="الرضا" fill={C.accent} radius={[0, 4, 4, 0]} opacity={0.8} name="الرضا %" />
                </BarChart>
              </ResponsiveContainer></ChartBox>
            </Card>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
              <Card title="الأداء مقابل الرضا" icon={<Target size={16} color={C.muted} />}>
                <ChartBox height={280}><ResponsiveContainer>
                  <RadarChart cx="50%" cy="50%" outerRadius="70%" data={districtPerf.slice(0, 8)}>
                    <PolarGrid stroke={C.border} />
                    <PolarAngleAxis dataKey="district" tick={{ fill: C.muted, fontSize: 9, fontFamily: ARABIC_FONT }} />
                    <PolarRadiusAxis tick={{ fill: C.dim, fontSize: 8 }} />
                    <Radar name="الأداء" dataKey="الأداء" stroke={C.info} fill={C.info} fillOpacity={0.2} />
                    <Radar name="الرضا" dataKey="الرضا" stroke={C.accent} fill={C.accent} fillOpacity={0.2} />
                    <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                  </RadarChart>
                </ResponsiveContainer></ChartBox>
              </Card>

              <Card title="عدد الحوادث لكل حي" icon={<AlertTriangle size={16} color={C.muted} />}>
                <ChartBox height={280}><ResponsiveContainer>
                  <BarChart data={[...districtPerf].sort((a, b) => b.الحوادث - a.الحوادث)} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="district" tick={{ fill: C.muted, fontSize: 9, fontFamily: ARABIC_FONT }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="الحوادث" radius={[6, 6, 0, 0]} name="عدد الحوادث">
                      {districtPerf.map((e, i) => <Cell key={i} fill={e.الحوادث > 5 ? C.danger : e.الحوادث > 2 ? C.warning : C.accent} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer></ChartBox>
              </Card>
            </div>
          </div>
        )}

        {/* ===== BENCHMARK ===== */}
        {tab === "benchmark" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Card title="المقارنة المعيارية - بريدة مقابل المعايير الوطنية" icon={<TrendingUp size={16} color={C.muted} />}>
              <ChartBox height={350}><ResponsiveContainer>
                <BarChart data={benchmarkData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="metric" tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                  <YAxis tick={{ fill: C.muted, fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                  <Bar dataKey="بريدة" fill={C.warning} radius={[4, 4, 0, 0]} name="بريدة" />
                  <Bar dataKey="المعيار_الوطني" fill={C.dim} radius={[4, 4, 0, 0]} opacity={0.6} name="المعيار الوطني" />
                  <Bar dataKey="أفضل_ممارسة" fill={C.accent} radius={[4, 4, 0, 0]} opacity={0.5} name="أفضل ممارسة عالمية" />
                </BarChart>
              </ResponsiveContainer></ChartBox>
            </Card>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
              {benchmarkData.map((b, i) => {
                const gap = b.أفضل_ممارسة - b.بريدة;
                return (
                  <div key={i} style={{ background: C.card, border: `1px solid #1e293b`, borderRadius: 14, padding: 18 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 10 }}>{b.metric}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 32, fontWeight: 900, color: C.warning }}>{b.بريدة}%</span>
                      <span style={{ fontSize: 12, color: gap <= 5 ? C.accent : gap <= 15 ? C.warning : C.danger }}>
                        {gap <= 5 ? "✓ ممتاز" : gap <= 15 ? "↗ جيد" : "↑ يحتاج تحسين"} (فجوة {gap}%)
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 10, fontSize: 11 }}>
                      <span style={{ color: C.dim }}>الوطني: {b.المعيار_الوطني}%</span>
                      <span style={{ color: C.accent }}>الأفضل: {b.أفضل_ممارسة}%</span>
                    </div>
                    <div style={{ width: "100%", height: 8, background: C.bg, borderRadius: 4, marginTop: 8, overflow: "hidden", position: "relative" }}>
                      <div style={{ position: "absolute", width: `${b.المعيار_الوطني}%`, height: "100%", background: "#64748b40", borderRadius: 4 }} />
                      <div style={{ position: "absolute", width: `${b.بريدة}%`, height: "100%", background: C.warning, borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== SCENARIOS ===== */}
        {tab === "scenarios" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: C.card, border: "1px solid #f59e0b30", borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.warning, marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}><Target size={16} color={C.warning} /> أداة دعم القرار</div>
              <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.7 }}>
                استعرض السيناريوهات المختلفة مع تحليل العائد والمخاطر لكل خيار. اضغط على أي سيناريو لعرض التفاصيل الكاملة والتوصيات.
              </p>
            </div>

            {selectedScenario ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <button onClick={() => setSelectedScenario(null)} style={{ alignSelf: "flex-start", padding: "6px 16px", borderRadius: 8, border: "1px solid #1e293b", background: "transparent", color: C.warning, cursor: "pointer", fontSize: 13, fontFamily: ARABIC_FONT }}>
                  ← العودة
                </button>
                <div style={{ background: C.card, border: "1px solid #f59e0b30", borderRadius: 16, padding: 28 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <div>
                      <h2 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: "0 0 4px 0" }}>{selectedScenario.name}</h2>
                      <span style={{ fontSize: 12, color: C.warning }}>{selectedScenario.type}</span>
                    </div>
                    <span style={{ padding: "6px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                      background: selectedScenario.recommendation === "موصى به بشدة" ? "#10b98120" : selectedScenario.recommendation === "موصى به" ? "#f59e0b20" : "#64748b20",
                      color: selectedScenario.recommendation === "موصى به بشدة" ? C.accent : selectedScenario.recommendation === "موصى به" ? C.warning : C.muted,
                      border: `1px solid ${selectedScenario.recommendation === "موصى به بشدة" ? "#10b98140" : "#f59e0b40"}`
                    }}>{selectedScenario.recommendation}</span>
                  </div>

                  <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.8, margin: "0 0 24px 0" }}>{selectedScenario.details}</p>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14, marginBottom: 24 }}>
                    {[
                      { label: "الاستثمار المطلوب", val: `${(selectedScenario.investment / 1000000).toFixed(1)}M ر.س`, color: C.danger, icon: <DollarSign size={22} color={C.danger} /> },
                      { label: "التوفير السنوي", val: `${(selectedScenario.annualSaving / 1000).toFixed(0)}K ر.س`, color: C.accent, icon: <TrendingUp size={22} color={C.accent} /> },
                      { label: "العائد ROI", val: `${selectedScenario.roi}%`, color: C.warning, icon: <TrendingUp size={22} color={C.warning} /> },
                      { label: "فترة الاسترداد", val: selectedScenario.payback, color: C.info, icon: <Clock size={22} color={C.info} /> },
                      { label: "مستوى المخاطرة", val: selectedScenario.risk, color: selectedScenario.risk === "منخفض" ? C.accent : C.warning, icon: <Zap size={22} color={selectedScenario.risk === "منخفض" ? C.accent : C.warning} /> },
                      { label: "الأثر المتوقع", val: selectedScenario.impact, color: C.purple, icon: <Target size={22} color={C.purple} /> },
                    ].map((item, i) => (
                      <div key={i} style={{ background: "#070b14", borderRadius: 12, padding: 16, textAlign: "center" }}>
                        <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>{item.icon}</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: item.color }}>{item.val}</div>
                        <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>{item.label}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
                    <div style={{ background: "#10b98110", border: "1px solid #10b98130", borderRadius: 12, padding: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.accent, marginBottom: 10 }}>✅ المميزات</div>
                      {selectedScenario.pros.map((p, i) => (
                        <div key={i} style={{ fontSize: 12, color: C.muted, marginBottom: 6, display: "flex", gap: 6 }}>
                          <span style={{ color: C.accent }}>●</span> {p}
                        </div>
                      ))}
                    </div>
                    <div style={{ background: "#ef444410", border: "1px solid #ef444430", borderRadius: 12, padding: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.danger, marginBottom: 10 }}>⚠️ التحديات</div>
                      {selectedScenario.cons.map((c, i) => (
                        <div key={i} style={{ fontSize: 12, color: C.muted, marginBottom: 6, display: "flex", gap: 6 }}>
                          <span style={{ color: C.danger }}>●</span> {c}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
                {scenarios.map(s => (
                  <div key={s.id} onClick={() => setSelectedScenario(s)} style={{
                    background: C.card, border: "1px solid #1e293b", borderRadius: 14, padding: 20, cursor: "pointer", transition: "all 0.2s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#f59e0b60"; e.currentTarget.style.transform = "translateY(-3px)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = "translateY(0)"; }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 11, color: C.warning, background: "#f59e0b15", padding: "3px 10px", borderRadius: 6, fontWeight: 600 }}>{s.type}</span>
                      <span style={{ fontSize: 11, color: s.recommendation.includes("بشدة") ? C.accent : C.warning, fontWeight: 600 }}>{s.recommendation}</span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 8 }}>{s.name}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8, fontSize: 11 }}>
                      <div style={{ color: C.dim, display: "flex", alignItems: "center", gap: 4 }}><DollarSign size={11} /> استثمار: <span style={{ color: C.text }}>{(s.investment / 1000000).toFixed(1)}M</span></div>
                      <div style={{ color: C.dim, display: "flex", alignItems: "center", gap: 4 }}><TrendingUp size={11} /> ROI: <span style={{ color: C.warning, fontWeight: 700 }}>{s.roi}%</span></div>
                      <div style={{ color: C.dim, display: "flex", alignItems: "center", gap: 4 }}><Clock size={11} /> استرداد: <span style={{ color: C.text }}>{s.payback}</span></div>
                      <div style={{ color: C.dim, display: "flex", alignItems: "center", gap: 4 }}><Zap size={11} /> خطر: <span style={{ color: s.risk === "منخفض" ? C.accent : C.warning }}>{s.risk}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== STRATEGIC GOALS ===== */}
        {tab === "strategic" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: C.warning, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><MapIcon size={20} color={C.warning} /> الخطة الاستراتيجية - رؤية 2030</div>
              <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.8 }}>
                متابعة التقدم نحو الأهداف الاستراتيجية لنظام إدارة النفايات الذكي في مدينة بريدة، 
                بما يتوافق مع أهداف رؤية المملكة 2030 في الاستدامة البيئية وجودة الحياة.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
              {strategicGoals.map((g, i) => {
                const pct = Math.round((g.current / g.target) * 100);
                const status = pct >= 90 ? "على المسار" : pct >= 70 ? "تقدم جيد" : "يحتاج تسريع";
                const statusColor = pct >= 90 ? C.accent : pct >= 70 ? C.warning : C.danger;
                return (
                  <div key={i} style={{ background: C.card, border: `1px solid ${g.color}25`, borderRadius: 16, padding: 20 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{g.goal}</span>
                      <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: `${statusColor}15`, color: statusColor, fontWeight: 600 }}>{status}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 10 }}>
                      <span style={{ fontSize: 36, fontWeight: 900, color: g.color }}>{g.current}</span>
                      <span style={{ fontSize: 14, color: C.dim }}>/ {g.target}</span>
                    </div>
                    <div style={{ width: "100%", height: 12, background: "#070b14", borderRadius: 6, overflow: "hidden", marginBottom: 8 }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${g.color}80, ${g.color})`, borderRadius: 6, transition: "width 1.5s ease" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.dim }}>
                      <span>التقدم: {pct}%</span>
                      <span>المتبقي: {g.target - g.current}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Vision 2030 Alignment */}
            <Card title="التوافق مع رؤية 2030" icon={<Flag size={16} color={C.muted} />}>
              <ChartBox height={300}><ResponsiveContainer>
                <RadarChart cx="50%" cy="50%" outerRadius="75%" data={[
                  { axis: "الاستدامة البيئية", الحالي: 75, المستهدف: 95 },
                  { axis: "جودة الحياة", الحالي: 82, المستهدف: 95 },
                  { axis: "الاقتصاد الدائري", الحالي: 60, المستهدف: 90 },
                  { axis: "التحول الرقمي", الحالي: 88, المستهدف: 95 },
                  { axis: "كفاءة الإنفاق", الحالي: 80, المستهدف: 90 },
                  { axis: "المشاركة المجتمعية", الحالي: 65, المستهدف: 85 },
                ]}>
                  <PolarGrid stroke={C.border} />
                  <PolarAngleAxis dataKey="axis" tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                  <PolarRadiusAxis tick={{ fill: C.dim, fontSize: 8 }} domain={[0, 100]} />
                  <Radar name="الوضع الحالي" dataKey="الحالي" stroke={C.warning} fill={C.warning} fillOpacity={0.25} strokeWidth={2} />
                  <Radar name="المستهدف 2030" dataKey="المستهدف" stroke={C.accent} fill={C.accent} fillOpacity={0.1} strokeWidth={2} strokeDasharray="6 3" />
                  <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                </RadarChart>
              </ResponsiveContainer></ChartBox>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

// ======================== AI ASSISTANT ========================
const AIAssistant = ({ role, stations = [], alerts = [], userData = {}, myRequests = [], myReports = [], suctionJobs = [] }) => {
  const F = ARABIC_FONT;
  const [open, setOpen]       = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  const apiKey = typeof window !== "undefined" ? localStorage.getItem("groq_api_key") || "" : "";

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  // Build system context from real data
  const buildSystemPrompt = () => {
    const now = new Date().toLocaleString("ar-SA");
    if (isMgmtRole(role)) {
      const critical  = stations.filter(s => getStatus(s.fillLevel) === "حرج");
      const warning   = stations.filter(s => getStatus(s.fillLevel) === "تحذير");
      const normal    = stations.filter(s => getStatus(s.fillLevel) === "طبيعي");
      const activeJobs = suctionJobs.filter(j => j.status === "نشط" || j.status === "جاري");
      return `أنت مساعد ذكي لنظام إدارة النفايات الذكي في مدينة بريدة، منطقة القصيم.
وقت الآن: ${now}
دورك: تساعد الموظفين والمدراء على فهم البيانات واتخاذ القرارات.

=== البيانات الحالية للنظام ===
إجمالي الأحياء: ${stations.length}
• حرجة (≥85%): ${critical.length} حي ${critical.length > 0 ? "— " + critical.map(s => `${s.name} (${s.fillLevel}%)`).join("، ") : ""}
• تحذير (60-84%): ${warning.length} حي ${warning.length > 0 ? "— " + warning.map(s => `${s.name} (${s.fillLevel}%)`).join("، ") : ""}
• طبيعية (<60%): ${normal.length} حي

التنبيهات النشطة: ${alerts.filter(a => a.type === "حرج").length} حرجة، ${alerts.filter(a => a.type === "تحذير").length} تحذير
أوامر الجولات النشطة: ${activeJobs.length}

قواعد الإجابة:
- أجب بالعربية دائماً
- اجعل إجاباتك مختصرة وعملية
- استند فقط على البيانات المعطاة
- إذا سُئلت عن شيء خارج نطاق بياناتك، قل ذلك بوضوح`;
    }
    // citizen
    const pendingReqs  = myRequests.filter(r => r.status === "قيد المراجعة").length;
    const acceptedReqs = myRequests.filter(r => r.status === "مقبول").length;
    const pendingReps  = myReports.filter(r => r.status === "قيد المعالجة").length;
    const myDistrict   = userData.district || "غير محدد";
    const distStation  = stations.find(s => s.district === myDistrict);
    return `أنت مساعد ذكي لبوابة الأفراد في نظام إدارة النفايات ببريدة.
وقت الآن: ${now}
دورك: تساعد المواطن على متابعة طلباته وبلاغاته والحصول على معلومات عن حيّه.

=== بيانات المواطن ===
الاسم: ${userData.name || "مواطن"}
الحي: ${myDistrict}
طلبات الحاويات: ${myRequests.length} إجمالي (${pendingReqs} قيد المراجعة، ${acceptedReqs} مقبول)
البلاغات: ${myReports.length} إجمالي (${pendingReps} قيد المعالجة)
${distStation ? `محطة الحي: ${distStation.name} — امتلاء ${distStation.fillLevel}% (${getStatus(distStation.fillLevel)})` : "لا توجد محطة مرتبطة بحيك"}

قواعد الإجابة:
- أجب بالعربية دائماً
- كن ودوداً وبسيطاً في لغتك
- اجعل إجاباتك مختصرة ومفيدة
- لا تشارك بيانات مواطنين آخرين`;
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    if (!apiKey) {
      setMessages(p => [...p, { role: "user", content: text }, { role: "assistant", content: "⚠️ يرجى إدخال مفتاح Gemini API في صفحة الإعدادات أولاً." }]);
      setInput(""); return;
    }
    const newMessages = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          max_tokens: 600,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            ...newMessages.map(m => ({ role: m.role, content: m.content })),
          ],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err?.error?.message || `HTTP ${res.status}`;
        if (res.status === 401) throw new Error("مفتاح API غير صحيح — تحقق منه في الإعدادات");
        if (res.status === 429) throw new Error("تجاوزت حد الاستخدام — انتظر قليلاً ثم حاول مجدداً");
        throw new Error(msg);
      }
      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content || "لم أتمكن من الإجابة.";
      setMessages(p => [...p, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages(p => [...p, { role: "assistant", content: `❌ ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const greeting = isMgmtRole(role)
    ? "مرحباً! أنا مساعدك الذكي. اسألني عن حالة الأحياء، التنبيهات، أوامر الجولات، أو أي شيء آخر."
    : "أهلاً! أنا مساعدك في بوابة الأفراد. اسألني عن طلباتك أو وضع حيّك.";

  const suggestions = isMgmtRole(role)
    ? ["أي حي يحتاج جمعًا الآن؟", "لخص التنبيهات النشطة", "ما وضع الأحياء الحرجة؟"]
    : ["وش حالة طلباتي؟", "متى تُجمع حاويات حينا؟", "كيف أرفع بلاغ؟"];

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(p => !p)}
        title="المساعد الذكي"
        style={{
          position: "fixed", bottom: 24, left: 24, zIndex: 1200,
          width: 56, height: 56, borderRadius: "50%", border: "none",
          background: "linear-gradient(135deg, #6d28d9, #4c1d95)",
          color: "#fff", fontSize: 26, cursor: "pointer",
          boxShadow: "0 4px 20px rgba(109,40,217,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "transform 0.2s",
        }}
        onMouseEnter={e => e.currentTarget.style.transform = "scale(1.1)"}
        onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
      >
        {open ? "✕" : "🤖"}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: "fixed", bottom: 92, left: 24, zIndex: 1200,
          width: "min(380px, calc(100vw - 48px))",
          height: "min(520px, calc(100vh - 120px))",
          background: C.card, border: `1px solid #6d28d930`,
          borderRadius: 20, display: "flex", flexDirection: "column",
          boxShadow: "0 8px 40px rgba(109,40,217,0.25)",
          fontFamily: F, overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{ padding: "14px 18px", background: "linear-gradient(135deg,#6d28d9,#4c1d95)", borderRadius: "20px 20px 0 0" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>🤖 المساعد الذكي</div>
            <div style={{ fontSize: 11, color: "#c4b5fd", marginTop: 2 }}>
              {isMgmtRole(role) ? "مساعد الموظف — يقرأ بيانات النظام" : "مساعد الأفراد — بوابة بريدة"}
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Greeting */}
            <div style={{ alignSelf: "flex-start", maxWidth: "85%", background: C.border, borderRadius: "12px 12px 12px 0", padding: "10px 14px", fontSize: 12, color: C.text, lineHeight: 1.6 }}>
              {greeting}
            </div>

            {/* Suggestion chips */}
            {messages.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                {suggestions.map((s, i) => (
                  <button key={i} onClick={() => { setInput(s); }} style={{
                    alignSelf: "flex-start", padding: "6px 12px", borderRadius: 20,
                    border: "1px solid #6d28d940", background: "#6d28d910",
                    color: "#a78bfa", fontSize: 11, cursor: "pointer", fontFamily: F, textAlign: "right",
                  }}>{s}</button>
                ))}
              </div>
            )}

            {/* Conversation */}
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                background: m.role === "user" ? "linear-gradient(135deg,#6d28d9,#4c1d95)" : C.border,
                borderRadius: m.role === "user" ? "12px 12px 0 12px" : "12px 12px 12px 0",
                padding: "10px 14px", fontSize: 12, color: C.text, lineHeight: 1.7,
                whiteSpace: "pre-wrap",
              }}>
                {m.content}
              </div>
            ))}

            {loading && (
              <div style={{ alignSelf: "flex-start", background: C.border, borderRadius: "12px 12px 12px 0", padding: "10px 14px", fontSize: 12, color: "#a78bfa" }}>
                <span style={{ animation: "pulse 1s infinite" }}>● </span>جاري التفكير...
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder="اكتب سؤالك..."
              style={{
                flex: 1, padding: "10px 14px", borderRadius: 12,
                border: `1px solid ${C.border}`, background: C.bg,
                color: C.text, fontSize: 12, fontFamily: F, outline: "none",
              }}
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              style={{
                padding: "10px 14px", borderRadius: 12, border: "none",
                background: loading || !input.trim() ? C.border : "linear-gradient(135deg,#6d28d9,#4c1d95)",
                color: loading || !input.trim() ? C.dim : "#fff",
                cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                fontSize: 16, fontFamily: F,
              }}
            >➤</button>
          </div>
        </div>
      )}
    </>
  );
};

// ======================== CITIZEN PORTAL ========================
// CITIZEN_BINS و CITIZEN_REPORTS أُزيلت — البيانات تأتي من Firestore الآن

// ── Isolated date display for CitizenPortal ──────────────────────────
const CitizenDateDisplay = () => {
  const [d, setD] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setD(new Date()), 60000); return () => clearInterval(i); }, []);
  return <span>{d.toLocaleDateString("ar-SA")}</span>;
};

// ======================== DRIVER / FIELD PORTAL (§24/§25) ========================
// Scoped to the driver's currently selected route only — never the full
// operational dashboard. Driver→vehicle→route is a per-session choice, not
// a permanent binding (§25): the driver picks which approved/active route
// they're running each time, rather than being pre-assigned one for good.
// ======================== DRIVER / FIELD PORTAL ========================
const DEFAULT_DEPOT = { lat: 26.3340, lng: 43.9720, label: "المستودع الرئيسي — بريدة (موقع افتراضي)" };

/**
 * Where the driver is right now: browser GPS when granted, else the assigned
 * vehicle's depot, else the city depot. The source is always shown in the UI
 * so a demo never passes a fallback off as a real fix.
 */
// ======================== DRIVER NAVIGATION (Phase 4) ========================
/** watchPosition-based driver location. `watch=false` → single fix (planning); `watch=true` → continuous while on shift. */
function useDriverPosition(vehicle, { watch = false } = {}) {
  const fallback = useMemo(
    () => (vehicle?.depotLat != null ? { lat: vehicle.depotLat, lng: vehicle.depotLng, source: "depot", label: vehicle.depotLabel || "مستودع المركبة" } : { ...DEFAULT_DEPOT, source: "default" }),
    [vehicle]
  );
  const [pos, setPos] = useState(null);
  const [status, setStatus] = useState(() => (typeof navigator !== "undefined" && navigator.geolocation ? "locating" : "denied")); // locating | gps | denied | error
  const [error, setError] = useState("");
  const onFix = useCallback((p) => {
    setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null, heading: p.coords.heading != null && !Number.isNaN(p.coords.heading) ? p.coords.heading : null, speed: p.coords.speed ?? null, at: new Date(p.timestamp || Date.now()).toISOString(), source: "gps", label: "موقعك الحالي (GPS)" });
    setStatus("gps"); setError("");
  }, []);
  const onErr = useCallback((e) => {
    setStatus(e?.code === 1 ? "denied" : "error");
    setError(e?.code === 1 ? "لم يُمنح إذن الموقع" : e?.code === 3 ? "انتهت مهلة تحديد الموقع" : "تعذر تحديد الموقع");
  }, []);
  const requestFix = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(onFix, onErr, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }, [onFix, onErr]);
  useEffect(() => { requestFix(); }, [requestFix]);
  useEffect(() => {
    if (!watch || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [watch, onFix, onErr]);
  const locate = () => { if (!navigator.geolocation) { setStatus("denied"); return; } setStatus("locating"); requestFix(); };
  return { position: pos || fallback, status, error, locate, watching: watch && status === "gps" };
}

/** Keeps the map centered on the driver while `follow` is on; dragging the map switches follow off (parent owns the flag). */
function FollowMe({ position, follow, zoom = 16, onUserDrag }) {
  const map = useMap();
  useEffect(() => { if (follow && position) map.setView([position.lat, position.lng], Math.max(map.getZoom(), zoom), { animate: true }); }, [position, follow, map, zoom]);
  useEffect(() => { const h = () => onUserDrag && onUserDrag(); map.on("dragstart", h); return () => map.off("dragstart", h); }, [map, onUserDrag]);
  return null;
}

const vehicleIcon = (headingDeg, live) => L.divIcon({
  className: "",
  html: `<div style="width:30px;height:30px;border-radius:50%;background:${live ? C.info : C.dim};border:3px solid #fff;box-shadow:0 0 0 4px ${live ? "#3b82f655" : "#64748b55"};display:flex;align-items:center;justify-content:center;transform:rotate(${headingDeg ?? 0}deg)"><div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:12px solid #fff;margin-top:-4px"></div></div>`,
  iconSize: [30, 30], iconAnchor: [15, 15],
});

/** Voice guidance via Web Speech API (Arabic voice when the device has one). Never the only channel. */
function useVoiceGuidance(enabled) {
  const lastRef = useRef("");
  const speak = useCallback((text) => {
    if (!enabled || typeof window === "undefined" || !window.speechSynthesis || !text || text === lastRef.current) return;
    lastRef.current = text;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const ar = window.speechSynthesis.getVoices().find((v) => /^ar/i.test(v.lang));
      if (ar) u.voice = ar; u.lang = ar?.lang || "ar-SA"; u.rate = 0.95;
      window.speechSynthesis.speak(u);
    } catch { /* unsupported */ }
  }, [enabled]);
  useEffect(() => { if (!enabled && window.speechSynthesis) window.speechSynthesis.cancel(); }, [enabled]);
  const supported = typeof window !== "undefined" && !!window.speechSynthesis;
  const hasArabic = supported && window.speechSynthesis.getVoices().some((v) => /^ar/i.test(v.lang));
  return { speak, supported, hasArabic };
}

/**
 * Turn-by-turn view for the active route: road path from the live position
 * through the REMAINING stops (OSRM with steps), maneuver banner, next-stop
 * card, off-route detection → recompute, follow-me / recenter / fullscreen,
 * heading rotation when the fix carries a reliable heading.
 */
const NavigationView = ({ position, posStatus, remainingStops = [], nextStop, allStops = [], onArrivedChange, voiceOn, onToggleVoice, recomputeKey = 0 }) => {
  const [follow, setFollow] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [headingMode, setHeadingMode] = useState(false);
  const [recompute, setRecompute] = useState(0);
  const [road, setRoad] = useState({ route: null, status: "idle", at: null });
  const samplesRef = useRef([]);
  const { speak, supported: voiceSupported, hasArabic } = useVoiceGuidance(voiceOn);

  const stopsKey = remainingStops.map((s) => s.binId).join("|");
  // Fetch the road path when the stop list changes, when an off-route recompute fires, or when the parent asks (after an incident).
  useEffect(() => {
    if (!position || remainingStops.length === 0) return;
    const pts = [{ lat: position.lat, lng: position.lng }, ...remainingStops.filter((s) => s.lat != null).map((s) => ({ lat: s.lat, lng: s.lng }))];
    if (pts.length < 2) return;
    let cancelled = false;
    setRoad((r) => ({ ...r, status: "loading" }));
    fetchRoadRoute(pts, { steps: true }).then((r) => { if (!cancelled) { setRoad({ route: r, status: r ? "ok" : "unavailable", at: Date.now() }); samplesRef.current = []; } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey, recompute, recomputeKey]);

  const coords = useMemo(() => road.route?.coordinates || [], [road.route]);
  const steps = useMemo(() => (road.route?.raw ? parseSteps(road.route.raw) : []), [road.route]);
  const proj = useMemo(() => projectOnRoute(position, coords), [position, coords]);
  const maneuver = useMemo(() => nextManeuver(position, steps, coords), [position, steps, coords]);
  const quality = fixQuality(position?.accuracy);
  const liveFix = posStatus === "gps";
  const headingReliable = liveFix && position?.heading != null && (position?.speed ?? 0) > 1.5;

  // Off-route: window of recent fixes vs the path; recompute from the current position, keeping the remaining stops.
  useEffect(() => {
    if (!liveFix || coords.length < 2 || road.status !== "ok") return;
    samplesRef.current = [...samplesRef.current.slice(-4), { distanceM: proj.distanceM, accuracyM: position.accuracy || 0 }];
    const d = offRouteDecision(samplesRef.current);
    if (d.offRoute && Date.now() - (road.at || 0) > 15000) { setRecompute((n) => n + 1); speak("خرجت عن المسار، تتم إعادة حساب المسار"); }
  }, [position, liveFix, coords.length, road.status, road.at, proj.distanceM, speak]);

  // Distance/ETA to the next stop along the road (first leg) — falls back to straight line when no road.
  const toNext = useMemo(() => {
    if (!nextStop || nextStop.lat == null) return null;
    if (coords.length >= 2) {
      const stopProj = projectOnRoute({ lat: nextStop.lat, lng: nextStop.lng }, coords);
      const m = Math.max(0, (stopProj.traveledM ?? 0) - (proj.traveledM ?? 0));
      const leg = road.route?.legs?.[0];
      const min = leg && leg.distanceKm > 0 ? Math.round((m / 1000) / leg.distanceKm * leg.durationMin) : estimateTravelMinutes(m / 1000);
      return { m, min, source: "osrm" };
    }
    const m = distanceM(position, nextStop);
    return { m, min: estimateTravelMinutes(m / 1000), source: "straight" };
  }, [nextStop, coords, proj, road.route, position]);

  const arrived = !!(nextStop && liveFix && arrivedAtStop(position, nextStop, { accuracyM: position.accuracy || 0 }));
  useEffect(() => { onArrivedChange && onArrivedChange(arrived); }, [arrived, onArrivedChange]);
  // Speak the maneuver when it changes or when it gets close.
  useEffect(() => {
    if (!maneuver) return;
    if (maneuver.distanceToM <= 220) speak(`${maneuver.text} بعد ${formatDistanceAr(maneuver.distanceToM)}`);
  }, [maneuver?.index, Math.round((maneuver?.distanceToM || 0) / 100), speak]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (arrived) speak("وصلت إلى الحاوية"); }, [arrived, speak]);

  const wrap = fullscreen ? { position: "fixed", inset: 0, zIndex: 9999, background: C.bg, display: "flex", flexDirection: "column" } : { position: "relative" };
  const mapH = fullscreen ? "100%" : 320;
  const iconBtn = (active) => ({ width: 40, height: 40, borderRadius: 10, border: `1px solid ${active ? C.info : C.border}`, background: active ? C.info + "25" : C.card, color: active ? C.info : C.text, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" });

  return (
    <div style={wrap}>
      {/* Maneuver banner */}
      <div style={{ background: maneuver ? C.info : C.card, color: maneuver ? "#fff" : C.muted, borderRadius: fullscreen ? 0 : 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, minHeight: 64 }}>
        <div style={{ fontSize: 28 }}>{maneuver ? ({ left: "⬅️", right: "➡️", "slight left": "↖️", "slight right": "↗️", uturn: "↩️" }[maneuver.modifier] || (maneuver.type === "arrive" ? "📍" : "⬆️")) : road.status === "loading" ? "⏳" : "🧭"}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{maneuver ? maneuver.text : road.status === "loading" ? "جاري حساب المسار…" : road.status === "unavailable" ? "خدمة التوجيه غير متاحة — اتبع الخريطة والخط المستقيم" : "لا توجد توقفات متبقية"}</div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>{maneuver ? `بعد ${formatDistanceAr(maneuver.distanceToM)}` : ""}{!liveFix ? " · الموقع غير مباشر" : ""}</div>
        </div>
      </div>

      <div style={{ height: mapH, flex: fullscreen ? 1 : undefined, position: "relative", borderRadius: fullscreen ? 0 : 14, overflow: "hidden", border: fullscreen ? "none" : `1px solid ${C.border}`, marginTop: fullscreen ? 0 : 10 }}>
        <MapContainer center={[position.lat, position.lng]} zoom={15} style={{ width: "100%", height: "100%" }} zoomControl={false}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
          <FollowMe position={position} follow={follow} onUserDrag={() => setFollow(false)} />
          {coords.length > 1 ? <Polyline positions={coords} pathOptions={{ color: C.info, weight: 6, opacity: 0.85 }} />
            : remainingStops.length > 0 && <Polyline positions={[[position.lat, position.lng], ...remainingStops.filter((s) => s.lat != null).map((s) => [s.lat, s.lng])]} pathOptions={{ color: C.info, weight: 4, dashArray: "8 8" }} />}
          {allStops.filter((s) => s.lat != null).map((s) => (
            <CircleMarker key={s.binId} center={[s.lat, s.lng]} radius={s.binId === nextStop?.binId ? 11 : 7}
              pathOptions={{ color: "#fff", weight: 2, fillColor: s.done ? C.dim : s.skipped ? C.warning : (STATUS_COLORS[s.priorityTier] || C.info), fillOpacity: s.done ? 0.5 : 1 }}>
              <Popup><div style={{ fontFamily: ARABIC_FONT, direction: "rtl", fontSize: 12 }}>#{s.order} {s.binName}{s.done ? " ✅" : s.skipped ? " 🚧" : ""}</div></Popup>
            </CircleMarker>
          ))}
          <Marker position={[position.lat, position.lng]} icon={vehicleIcon(headingMode && headingReliable ? position.heading : 0, liveFix)} />
        </MapContainer>
        <div style={{ position: "absolute", top: 10, left: 10, display: "flex", flexDirection: "column", gap: 8, zIndex: 1000 }}>
          <button title="إعادة التمركز" onClick={() => setFollow(true)} style={iconBtn(follow)}>🎯</button>
          <button title="ملء الشاشة" onClick={() => setFullscreen((f) => !f)} style={iconBtn(fullscreen)}>{fullscreen ? "✕" : "⛶"}</button>
          <button title={headingReliable ? "متابعة اتجاه الحركة" : "اتجاه الحركة غير موثوق (سرعة منخفضة أو لا بيانات اتجاه)"} disabled={!headingReliable} onClick={() => setHeadingMode((h) => !h)} style={{ ...iconBtn(headingMode && headingReliable), opacity: headingReliable ? 1 : 0.4 }}>🧭</button>
          {voiceSupported && <button title={voiceOn ? "إيقاف الصوت" : "تشغيل الإرشاد الصوتي"} onClick={onToggleVoice} style={iconBtn(voiceOn)}>{voiceOn ? "🔊" : "🔇"}</button>}
        </div>
        <div style={{ position: "absolute", bottom: 10, right: 10, left: 10, zIndex: 1000, background: C.card + "f2", border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", fontSize: 12, color: C.text }}>
          {nextStop ? (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span>📍 التالي: <b>{nextStop.binName}</b></span>
              <span>{toNext ? `${formatDistanceAr(toNext.m)} · ~${toNext.min} د${toNext.source === "straight" ? " (تقدير مستقيم)" : ""}` : "—"}</span>
              <span>🗑️ متبقٍ: <b>{remainingStops.length}</b></span>
            </div>
          ) : <span>🎉 لا توجد توقفات متبقية</span>}
          <div style={{ fontSize: 10.5, color: quality.level === "poor" ? C.warning : C.dim, marginTop: 2 }}>
            {liveFix ? quality.label : "الموقع غير مباشر — اضغط «تحديث موقعي» أو امنح الإذن"}{road.status === "ok" ? " · مسار على الطرق (OSRM)" : road.status === "unavailable" ? " · بلا خدمة توجيه: خط مستقيم" : ""}{voiceOn && voiceSupported && !hasArabic ? " · لا يوجد صوت عربي على هذا الجهاز" : ""}
          </div>
        </div>
      </div>
    </div>
  );
};

/** Field map: driver position, the neighborhood polygon, its bins, and the dashed preview path through the priority stops. */
const FieldRouteMap = ({ position, feature, stops = [], allBins = [], neighborhoodIds = [], height = 300, onRoad }) => {
  const points = stops.filter((s) => s.lat != null && s.lng != null).map((s) => [s.lat, s.lng]);
  const path = position ? [[position.lat, position.lng], ...points] : points;
  const { route: road, status: roadStatus } = useRoadRoute(path.map(([lat, lng]) => ({ lat, lng })));
  useEffect(() => { if (onRoad) onRoad(road, roadStatus); }, [road, roadStatus, onRoad]);
  const idSet = new Set(neighborhoodIds);
  const others = allBins.filter((b) => idSet.has(b.neighborhoodId) && b.lat != null && !stops.some((s) => s.binId === b.id));
  const center = feature ? polygonCentroid(feature.geometry) : (position || DEFAULT_DEPOT);
  const flyTarget = useMemo(() => ({ center: [center.lat, center.lng], zoom: 14, _t: feature?.properties?.baseName }), [center.lat, center.lng, feature]);
  return (
    <div style={{ height, borderRadius: 14, overflow: "hidden", border: `1px solid ${C.border}` }}>
      <MapContainer center={[center.lat, center.lng]} zoom={13} style={{ width: "100%", height: "100%" }} scrollWheelZoom={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
        <FlyTo target={flyTarget} />
        {feature && <GeoJSON key={feature.properties.baseName} data={feature} style={() => ({ color: C.info, weight: 2.5, fillColor: C.info, fillOpacity: 0.12 })} />}
        {path.length > 1 && (road
          ? <Polyline positions={road.coordinates} pathOptions={{ color: C.info, weight: 5, opacity: 0.9 }} />
          : <Polyline positions={path} pathOptions={{ color: C.info, weight: 4, dashArray: "8 8", opacity: 0.9 }} />)}
        {position && (
          <CircleMarker center={[position.lat, position.lng]} radius={10} pathOptions={{ color: "#fff", weight: 2, fillColor: "#0ea5e9", fillOpacity: 1 }}>
            <Popup><div style={{ fontFamily: ARABIC_FONT, direction: "rtl", fontSize: 12 }}>🚛 {position.label}</div></Popup>
          </CircleMarker>
        )}
        {others.map((b) => (
          <CircleMarker key={b.id} center={[b.lat, b.lng]} radius={5} pathOptions={{ color: "#fff", weight: 1, fillColor: STATUS_COLORS[getBinPriority(b, null, []).tier] || C.dim, fillOpacity: 0.7 }}>
            <Popup><div style={{ fontFamily: ARABIC_FONT, direction: "rtl", fontSize: 12 }}>{b.name} — {b.lastFillLevelPercent ?? "—"}% (خارج المسار)</div></Popup>
          </CircleMarker>
        ))}
        {stops.filter((s) => s.lat != null).map((s) => (
          <CircleMarker key={s.binId} center={[s.lat, s.lng]} radius={11} pathOptions={{ color: "#fff", weight: 2, fillColor: STATUS_COLORS[s.priorityTier] || C.info, fillOpacity: 1 }}>
            <Popup><div style={{ fontFamily: ARABIC_FONT, direction: "rtl", fontSize: 12 }}><b>#{s.order} — {s.binName}</b><br />الامتلاء: {s.fillLevelPercent ?? "—"}%</div></Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
};

/**
 * Driver / field portal (§24/§25). On login the driver sees the same
 * "needs collection now" ranking the supervisor sees; tapping a neighborhood
 * shows where it is, how far, the fastest preview path through its priority
 * bins, and the status of the route that covers it. Execution (start /
 * collected / finish) is only possible on a route a supervisor approved.
 */
const DriverPortal = ({ user, onLogout, vehicles = [], bins = [], neighborhoods = [], fireSensors = [], recentReadings = [], citizenReports = [] }) => {
  const [activeRouteId, setActiveRouteId] = useState(null);
  const [focusKey, setFocusKey] = useState(null);
  const [busy, setBusy] = useState(false);

  // Phase 1: the driver sees ONLY their profile and the routes assigned to them (driverId == uid) — enforced by firestore.rules too.
  const { profile, loading: loadingProfile } = useMyDriverProfile(user?.uid);
  const { data: myRoutes } = useMyRoutes(user?.uid);
  const routes = useMemo(() => myRoutes || [], [myRoutes]);
  const myVehicle = vehicles.find((v) => v.id === profile?.vehicleId) || null;
  const onShift = profile?.shiftStatus === "on_shift";
  const toggleShift = async () => {
    if (!profile) return;
    setBusy(true);
    try { await setDriverShift(user.uid, onShift ? "off_shift" : "on_shift", user.name); } finally { setBusy(false); }
  };
  const { position, status: posStatus, error: posError, locate } = useDriverPosition(myVehicle, { watch: onShift });
  const [voiceOn, setVoiceOn] = useState(() => { try { return localStorage.getItem("swm_voice") !== "off"; } catch { return true; } });
  const [arrived, setArrived] = useState(false);
  const [recomputeKey, setRecomputeKey] = useState(0);
  const queueRef = useRef(null);
  if (!queueRef.current) queueRef.current = createOfflineQueue({ storage: typeof localStorage !== "undefined" ? localStorage : null });
  const [pendingOffline, setPendingOffline] = useState(() => queueRef.current.size());

  // Same scoring inputs as the supervisor dashboard (incl. recent readings for
  // the "soon full" prediction) so both roles see the same ranked list.
  const scoredBins = useMemo(() => {
    const ctx = makeBinContext(fireSensors, citizenReports, neighborhoods);
    const readingsByBin = {};
    for (const r of recentReadings) { if (r.bin_id) (readingsByBin[r.bin_id] ||= []).push(r); }
    return bins.map((bin) => ({ bin, priority: getBinPriority(bin, null, readingsByBin[bin.id] || [], ctx.forBin(bin)) }));
  }, [bins, neighborhoods, fireSensors, recentReadings, citizenReports]);

  // Only the driver's coverage scope is ranked (no scope defined yet → everything, so the portal stays usable before setup).
  const scopeKeys = profile?.neighborhoodKeys || [];
  const ranked = useMemo(() => {
    const groups = groupNeighborhoodsByName(neighborhoods, bins).filter((g) => scopeKeys.length === 0 || scopeKeys.includes(g.key));
    return rankNeighborhoodsForCollection(groups, scoredBins, routes, {
      thermalAlertFor: makeThermalAlertFor(fireSensors),
      from: position ? { lat: position.lat, lng: position.lng } : null,
      centroidFor: centroidForGroup,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neighborhoods, bins, scoredBins, routes, fireSensors, position, scopeKeys.join("|")]);

  const runnableRoutes = routes.filter((r) => r.status === "approved" || r.status === "in_progress");
  const route = routes.find((r) => r.id === activeRouteId);
  const vehicle = vehicles.find((v) => v.id === route?.vehicleId);
  const collectedBinIds = useMemo(() => route?.collectedBinIds || [], [route]);
  const skippedIds = useMemo(() => new Set((route?.skippedStops || []).map((s) => s.binId)), [route]);
  const stops = (route?.orderedStops || []).filter((s) => s.binId);
  const progress = routeProgress(route);
  const nextStop = route ? nextStopFor(route) : null;
  const stopsWithCoords = useMemo(() => routeStopPositions(route, bins, neighborhoods).map((p) => ({ ...p, lat: p.pos[0], lng: p.pos[1], done: collectedBinIds.includes(p.binId), skipped: skippedIds.has(p.binId) })), [route, bins, neighborhoods, collectedBinIds, skippedIds]);
  const remainingStopsPos = stopsWithCoords.filter((p) => !p.done && !p.skipped && !p.deferred);
  const nextStopPos = nextStop ? stopsWithCoords.find((p) => p.binId === nextStop.binId) || null : null;

  // Live location → Firestore while on shift and sharing (throttled by time/distance). Wiped at clock-out by setDriverShift.
  const lastPersistRef = useRef(null);
  useEffect(() => {
    if (!onShift || !profile?.locationSharing || posStatus !== "gps" || !position?.at) return;
    if (!shouldPersistLocation(lastPersistRef.current, position)) return;
    lastPersistRef.current = position;
    persistDriverLocation(user.uid, position, route?.status === "in_progress" ? route.id : null).catch((e) => console.warn("[driver-location]", e?.message));
  }, [position, onShift, profile?.locationSharing, posStatus, user?.uid, route?.id, route?.status]);

  // Offline queue: flush when the connection returns.
  const flushQueue = useCallback(async () => {
    const q = queueRef.current;
    if (q.size() === 0) return;
    const r = await q.flush(async (op) => {
      if (op.type === "collect") await confirmCollection(op.payload);
      else if (op.type === "incident") await reportRouteIncident(op.payload);
    });
    setPendingOffline(r.pending);
  }, []);
  useEffect(() => {
    const onOnline = () => flushQueue();
    window.addEventListener("online", onOnline);
    flushQueue();
    return () => window.removeEventListener("online", onOnline);
  }, [flushQueue]);

  const focused = ranked.find((r) => r.group.key === focusKey) || null;
  const focusedFeature = focused ? buraidahNeighborhoodsGeo.features.find((f) => f.properties.baseName === focused.group.key) || null : null;
  // Preview path from the driver's position through the neighborhood's priority bins —
  // a planning aid only; nothing here is dispatched.
  const preview = useMemo(() => (focused ? orderStopsFrom(position, focused.eligibleBins) : null), [focused, position]);
  const [road, setRoad] = useState({ route: null, status: "idle" });
  const onRoad = useCallback((route, status) => setRoad({ route, status }), []);
  // Road figures (OSRM) win when available; otherwise the straight-line estimate.
  const previewEta = road.route ? road.route.durationMin + (preview?.orderedStops.length || 0) * 4 : (preview ? estimateTravelMinutes((focused?.distanceKm || 0) + preview.totalDistanceKm) : null);
  const approachKm = road.route?.legs?.[0]?.distanceKm ?? focused?.distanceKm ?? null;
  const approachMin = road.route?.legs?.[0]?.durationMin ?? focused?.etaMinutes ?? null;

  const handleStart = async () => {
    if (!can("driver", "routes.execute", { assignedToMe: route.driverId === user.uid })) { alert("هذه الجولة غير مسندة لك."); return; }
    if (!onShift) { alert("ابدأ مناوبتك أولًا قبل بدء الجولة."); return; }
    setBusy(true);
    try {
      await startRoute(route.id, route.vehicleId);
      await updateRoute(route.id, { driverName: user.name });
      await writeAuditLog("route_started", user.uid, user.name, { routeId: route.id, routeName: route.routeName, by: "driver" });
    } finally { setBusy(false); }
  };
  // ── Phase 5: field execution. Confirmations are idempotent (event id = routeId__binId),
  // authorized (assigned driver, active route, bin in route, not already confirmed), carry
  // the confirmation location+accuracy, and NEVER rewrite the sensor's fill reading.
  const confirmingRef = useRef(new Set());
  const handleCollected = async (stop) => {
    const check = canConfirmCollection({ user: { ...user, role: "driver" }, route, binId: stop.binId });
    if (!check.ok) { alert(check.reason); return; }
    if (confirmingRef.current.has(stop.binId)) return; // double-tap guard
    confirmingRef.current.add(stop.binId);
    setBusy(true);
    try {
      const bin = bins.find((b) => b.id === stop.binId) || { id: stop.binId };
      const confirmation = buildConfirmation({ route, bin, user, position: posStatus === "gps" ? position : null });
      if (!navigator.onLine) { queueRef.current.enqueue({ id: confirmation.id, type: "collect", payload: confirmation }); setPendingOffline(queueRef.current.size()); return; }
      try { await confirmCollection(confirmation); }
      catch (e) { queueRef.current.enqueue({ id: confirmation.id, type: "collect", payload: confirmation }); setPendingOffline(queueRef.current.size()); console.warn("[confirm] queued offline:", e?.message); }
    } finally { confirmingRef.current.delete(stop.binId); setBusy(false); }
  };
  const handleIncident = async (type, stop) => {
    const t = INCIDENT_TYPES[type];
    const note = window.prompt(`${t.icon} ${t.label} — ملاحظة (اختياري):`, "") ?? "";
    setBusy(true);
    try {
      const payload = { route, binId: stop?.binId || null, type, note, user: { uid: user.uid, name: user.name }, position: posStatus === "gps" ? position : null };
      if (!navigator.onLine) { queueRef.current.enqueue({ id: `inc:${route.id}:${stop?.binId || "route"}:${Date.now()}`, type: "incident", payload }); setPendingOffline(queueRef.current.size()); }
      else await reportRouteIncident(payload);
      if (t.recompute) setRecomputeKey((k) => k + 1);
      alert(`تم تسجيل البلاغ وإبلاغ المشرف.${stop ? " الحاوية لم تُعتبر مكتملة ويمكن إعادة إدراجها." : ""}${t.recompute ? " سيُعاد حساب المسار." : ""}`);
    } finally { setBusy(false); }
  };
  const handleFinish = async () => {
    setBusy(true);
    try {
      await completeRoute(route.id, route.vehicleId);
      await writeAuditLog("route_completed", user.uid, user.name, { routeId: route.id, routeName: route.routeName, by: "driver" });
      setActiveRouteId(null);
    } finally { setBusy(false); }
  };

  const driverNotifItems = useMemo(() => [
    ...routes.filter((r) => r.status === "approved").map((r) => ({ key: `approved:${r.id}`, kind: "approved", route: r })),
    ...ranked.filter((r) => r.criticalCount > 0).map((r) => ({ key: `critical:${r.group.key}:${r.criticalCount}`, kind: "critical", r })),
  ], [routes, ranked]);
  useBrowserNotifications(driverNotifItems, useCallback((item) => item.kind === "approved"
    ? { title: "🚦 جولة معتمدة جاهزة للبدء", body: `${item.route.routeName} — ${item.route.orderedStops?.length || 0} توقف` }
    : { title: "🔴 حي يحتاج جمعًا الآن", body: `${item.r.group.name}: ${item.r.criticalCount} حاوية حرجة${item.r.distanceKm != null ? ` · يبعد ${item.r.distanceKm} كم` : ""}` }, []));

  const positionNote = posStatus === "gps" ? `📍 موقعك الحالي عبر GPS${onShift ? " (تتبع مستمر أثناء المناوبة)" : ""}` : posStatus === "locating" ? "⏳ جاري تحديد موقعك…" : `📍 ${position.label} — ${posError || "لم يُمنح إذن الموقع"}`;
  const btn = (extra) => ({ padding: 11, borderRadius: 10, border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: ARABIC_FONT, ...extra });

  return (
    <div dir="rtl" style={{ fontFamily: ARABIC_FONT, background: C.bg, color: C.text, minHeight: "100vh", padding: 16 }}>
      <div style={{ margin: "-16px -16px 12px", borderRadius: "0 0 12px 12px", overflow: "hidden" }}><DemoEnvBanner /></div>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>🚛 بوابة التشغيل الميداني</div>
            <div style={{ fontSize: 12, color: C.muted }}>{profile?.fullName || user.name}{profile?.driverCode ? ` · ${profile.driverCode}` : ""}{myVehicle ? ` · ${myVehicle.vehicleNumber}` : " · بلا مركبة مسندة"}</div>
          </div>
          <button onClick={onLogout} style={{ padding: "8px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>خروج</button>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 11.5, color: posStatus === "gps" ? C.accent : C.muted, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px", marginBottom: 8, flexWrap: "wrap" }}>
          <span>{positionNote}</span>
          <button onClick={locate} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, color: C.info, fontSize: 11, cursor: "pointer", padding: "4px 10px", fontFamily: ARABIC_FONT }}>تحديث موقعي</button>
        </div>
        {!loadingProfile && !profile && (
          <div style={{ marginBottom: 12, fontSize: 12, color: C.warning, background: C.warning + "15", border: `1px solid ${C.warning}40`, borderRadius: 10, padding: "10px 12px" }}>
            ⚠️ لم يُهيأ ملفك كسائق بعد — اطلب من المشرف تهيئته من صفحة «السائقون والأسطول» (المركبة ونطاق الأحياء).
          </div>
        )}
        {profile && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: C.card, border: `1px solid ${onShift ? C.accent + "60" : C.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8, flexWrap: "wrap", fontSize: 12 }}>
            <div style={{ color: C.muted, lineHeight: 1.8 }}>
              <b style={{ color: onShift ? C.accent : C.text }}>{SHIFT_STATUS_LABELS[profile.shiftStatus] || profile.shiftStatus}</b> · {AVAILABILITY_LABELS[profile.availability] || "—"}<br />
              النطاق: {(profile.neighborhoodKeys || []).length ? profile.neighborhoodKeys.map((k) => `حي ${k}`).join("، ") : "غير محدد"}{profile.shiftStart ? ` · المناوبة ${profile.shiftStart}–${profile.shiftEnd}` : ""}
            </div>
            <button disabled={busy} onClick={toggleShift} style={btn({ padding: "8px 14px", background: onShift ? C.danger + "20" : C.accent, color: onShift ? C.danger : "#07231A", border: onShift ? `1px solid ${C.danger}` : "none", fontSize: 12 })}>{onShift ? "⏹ إنهاء المناوبة" : "▶️ بدء المناوبة"}</button>
          </div>
        )}
        <DriverNotifications driverId={user.uid} />
        <div style={{ marginBottom: 14 }}><NotificationPermissionButton compact /></div>

        {route ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <button onClick={() => setActiveRouteId(null)} style={{ alignSelf: "flex-start", background: "none", border: "none", color: C.info, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>← الرجوع للقائمة</button>

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{route.routeName}</div>
              <div style={{ fontSize: 12, color: C.muted }}>المركبة: {vehicle?.vehicleNumber || "—"} · الحالة: {ROUTE_STATUS_LABELS[route.status] || route.status} · {stops.length} توقف · {route.estimatedDistanceKm} كم تقريبًا</div>
              {route.status === "approved" && (
                <button disabled={busy} onClick={handleStart} style={btn({ marginTop: 10, width: "100%", background: C.accent, color: "#07231A" })}>بدء الجولة</button>
              )}
            </div>

            {route.status !== "in_progress" && (
              <FieldRouteMap position={position} feature={null} stops={stopsWithCoords.map((p) => ({ ...p, fillLevelPercent: p.bin.lastFillLevelPercent }))} allBins={[]} height={260} />
            )}

            {route.status === "in_progress" && (
              <>
                {pendingOffline > 0 && <div style={{ fontSize: 12, color: C.warning, background: C.warning + "15", border: `1px solid ${C.warning}40`, borderRadius: 10, padding: "8px 12px" }}>📶 {pendingOffline} عملية محفوظة دون اتصال — ستُرسل تلقائيًا عند عودة الشبكة.</div>}
                <NavigationView position={position} posStatus={posStatus} remainingStops={remainingStopsPos} nextStop={nextStopPos} allStops={stopsWithCoords} onArrivedChange={setArrived} voiceOn={voiceOn} onToggleVoice={() => setVoiceOn((v) => { try { localStorage.setItem("swm_voice", v ? "off" : "on"); } catch { /* ignore */ } return !v; })} recomputeKey={recomputeKey} />

                {nextStop ? (
                  <div style={{ background: C.card, border: `2px solid ${arrived ? C.accent : C.info}`, borderRadius: 14, padding: 16 }}>
                    <div style={{ fontSize: 11, color: arrived ? C.accent : C.info, marginBottom: 4 }}>{arrived ? "✅ وصلت — " : ""}التوقف التالي — #{nextStop.order} من {stops.length}{nextStop.deferred ? " · مؤجَّل (تجاوز السعة)" : ""}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>{nextStop.binName}</div>
                    {(() => {
                      const bin = bins.find((b) => b.id === nextStop.binId);
                      const n = neighborhoods.find((n2) => n2.id === bin?.neighborhoodId);
                      const d = nextStopPos && posStatus === "gps" ? distanceM(position, nextStopPos) : null;
                      return (
                        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
                          الحي: {n?.name || "—"} · الامتلاء (آخر قراءة): {bin?.lastFillLevelPercent != null ? `${bin.lastFillLevelPercent}%` : "—"} · الأولوية: {STATE_LABELS[nextStop.priorityTier] || nextStop.priorityTier}
                          {d != null && <span> · المسافة المتبقية {formatDistanceAr(d)}</span>}
                        </div>
                      );
                    })()}
                    <button disabled={busy} onClick={() => handleCollected(nextStop)} style={btn({ width: "100%", padding: 14, fontSize: 15, background: C.accent, color: "#07231A" })}>✅ تم التفريغ</button>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 8 }}>
                      {Object.entries(INCIDENT_TYPES).map(([k, t]) => (
                        <button key={k} disabled={busy} onClick={() => handleIncident(k, nextStop)} style={btn({ padding: 9, border: `1px solid ${C.warning}`, background: C.warning + "15", color: C.warning, fontSize: 11.5, fontWeight: 600 })}>{t.icon} {t.label.split(" (")[0]}</button>
                      ))}
                    </div>
                    <div style={{ fontSize: 10.5, color: C.dim, marginTop: 6 }}>تأكيد التفريغ يسجّل الوقت وموقعك ودقته، ولا يغيّر قراءة المستشعر — تتحدث عند وصول قراءة جديدة من الجهاز.</div>
                  </div>
                ) : (
                  <EmptyState icon="🎉" title={progress.skipped > 0 ? `اكتملت التوقفات المتاحة — ${progress.skipped} متخطاة ببلاغ` : "تم الوصول لجميع التوقفات"} desc="يمكنك الآن إنهاء الجولة." />
                )}
                <div>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>التقدم: {progress.collected} / {progress.total} جُمعت{progress.skipped > 0 ? ` · ${progress.skipped} متخطاة` : ""} · {progress.remaining} متبقية</div>
                  <div style={{ height: 8, background: C.card, borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${progress.pct}%`, background: C.accent, transition: "width .3s" }} />
                  </div>
                </div>
                <button disabled={busy} onClick={handleFinish} style={btn({ padding: 12, background: C.info, color: "#fff" })}>إنهاء الجولة</button>
              </>
            )}

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>التوقفات بالترتيب</div>
              {stops.map((s) => {
                const bin = bins.find((b) => b.id === s.binId);
                const done = collectedBinIds.includes(s.binId);
                const skipped = skippedIds.has(s.binId);
                return (
                  <div key={s.binId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12, opacity: done ? 0.5 : 1 }}>
                    <span>{done ? "✅" : skipped ? "🚧" : `#${s.order}`} {s.binName}{skipped && <span style={{ color: C.warning, fontSize: 10.5 }}> (متخطاة — بلاغ)</span>}{s.deferred && !done && <span style={{ color: C.dim, fontSize: 10.5 }}> (مؤجَّل)</span>}</span>
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <b style={{ color: STATUS_COLORS[s.priorityTier] || C.text }}>{bin?.lastFillLevelPercent != null ? `${bin.lastFillLevelPercent}%` : "—"}</b>
                      <StateBadge state={s.priorityTier} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : focused ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <button onClick={() => setFocusKey(null)} style={{ alignSelf: "flex-start", background: "none", border: "none", color: C.info, fontSize: 12, cursor: "pointer", fontFamily: ARABIC_FONT }}>← كل الأحياء</button>

            <div style={{ background: C.card, border: `1px solid ${STATUS_COLORS[focused.priority.tier] || C.border}60`, borderRadius: 14, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{focused.group.name}</div>
                <StateBadge state={focused.priority.tier} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginTop: 10 }}>
                {[
                  { label: road.route ? "المسافة إليه (طرق)" : "المسافة إليه", value: approachKm != null ? `${approachKm} كم` : "—", color: C.info },
                  { label: "الوصول تقريبًا", value: approachMin != null ? `~${approachMin} د` : "—", color: C.info },
                  { label: "حاويات للجمع", value: focused.eligibleBins.length, color: C.danger },
                  { label: road.route ? "المسار كاملًا (طرق)" : "طول المسار", value: road.route ? `${road.route.distanceKm} كم` : (preview ? `${preview.totalDistanceKm} كم` : "—"), color: C.muted },
                ].map((k) => (
                  <div key={k.label} style={{ background: C.bg, borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 17, fontWeight: 800, color: k.color }}>{k.value}</div>
                    <div style={{ fontSize: 10.5, color: C.dim }}>{k.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 10 }}>
                {focused.criticalCount} حرجة · {focused.highCount} مرتفعة · {focused.total} حاوية إجمالًا{focused.thermalAlert && <span style={{ color: C.danger }}> · 🔥 تنبيه حراري نشط</span>}
                {previewEta != null && <span> · الزمن الكلي للوصول والمسار ~{previewEta} دقيقة</span>}
              </div>
            </div>

            <FieldRouteMap position={position} feature={focusedFeature} stops={preview?.orderedStops || []} allBins={bins} neighborhoodIds={focused.group.ids} height={300} onRoad={onRoad} />
            <RoadRouteNote road={road.route} status={road.status} />
            <div style={{ fontSize: 10.5, color: C.dim }}>ترتيب التوقفات: أقرب-جار من موقعك مع وزن لأولوية الامتلاء. المسار يُرسم على الطرق الفعلية عبر OSRM عند توفره.</div>

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>الحاويات ذات الأولوية — بترتيب المسار</div>
              {(preview?.orderedStops || []).map((s) => (
                <div key={s.binId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                  <span>#{s.order} {s.binName}</span>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <b style={{ color: STATUS_COLORS[s.priorityTier] || C.text }}>{s.fillLevelPercent != null ? `${s.fillLevelPercent}%` : "—"}</b>
                    <StateBadge state={s.priorityTier} />
                  </span>
                </div>
              ))}
            </div>

            <div style={{ background: focused.openRoute ? C.info + "12" : C.warning + "12", border: `1px solid ${focused.openRoute ? C.info : C.warning}50`, borderRadius: 14, padding: 14 }}>
              {focused.openRoute ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.info, marginBottom: 4 }}>🧭 {focused.openRoute.routeName} — {ROUTE_STATUS_LABELS[focused.openRoute.status] || focused.openRoute.status}</div>
                  {focused.openRoute.status === "suggested" && <div style={{ fontSize: 12, color: C.muted }}>بانتظار اعتماد المشرف واختيار مركبة — لا يمكن البدء قبل الاعتماد.</div>}
                  {(focused.openRoute.status === "approved" || focused.openRoute.status === "in_progress") && (
                    <button onClick={() => setActiveRouteId(focused.openRoute.id)} style={btn({ marginTop: 8, width: "100%", background: C.accent, color: "#07231A" })}>
                      {focused.openRoute.status === "approved" ? "فتح الجولة المعتمدة وبدؤها" : "متابعة الجولة النشطة"}
                    </button>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 12, color: C.warning }}>⚠️ لا توجد جولة مقترحة أو معتمدة لهذا الحي بعد — أبلغ المشرف ليولّد الجولات ويعتمدها.</div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <NeedsCollectionBanner ranked={ranked} compact onSelect={(r) => setFocusKey(r.group.key)} noRouteLabel="بانتظار إسناد من المشرف" />

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🚦 جولاتي المعتمدة / النشطة</div>
              {runnableRoutes.length === 0 ? (
                <EmptyState icon="🧭" title="لا توجد جولة معتمدة لك حاليًا" desc="انتظر اعتماد جولة من قبل المشرف، أو اضغط على أي حي أعلاه لمعاينة المسار." />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {runnableRoutes.map((r) => (
                    <div key={r.id} onClick={() => setActiveRouteId(r.id)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, cursor: "pointer" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <b>{r.routeName}</b>
                        <StateBadge state={r.priorityTier} />
                      </div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{r.orderedStops?.length || 0} توقف · {r.estimatedDistanceKm} كم · {ROUTE_STATUS_LABELS[r.status] || r.status}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const CitizenPortal = ({ user, onLogout, stations, bins = [], neighborhoods = [] }) => {
  const [reportBinId, setReportBinId] = useState("");
  const myNeighborhoodIds = useMemo(() => new Set(neighborhoods.filter((n) => normalizeNeighborhoodName(n.name) === normalizeNeighborhoodName(user.district)).map((n) => n.id)), [neighborhoods, user.district]);
  const myBins = useMemo(() => bins.filter((b) => myNeighborhoodIds.has(b.neighborhoodId)), [bins, myNeighborhoodIds]);
  const [tab, setTab]               = useState("home");
  const [showPassModal, setShowPassModal] = useState(false);

  // ─── طلب حاوية ────────────────────────────────────────────────────
  const [reqAddress, setReqAddress] = useState("");
  const [reqBinType, setReqBinType] = useState("عضوية");
  const [reqNotes, setReqNotes]     = useState("");
  const [reqLoading, setReqLoading] = useState(false);
  const [reqDone, setReqDone]       = useState(null); // null | { id }

  // ─── بلاغ مشكلة ───────────────────────────────────────────────────
  const [reportType, setReportType]   = useState("");
  const [reportDesc, setReportDesc]   = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportDone, setReportDone]   = useState(null); // null | { id }

  // ─── بيانات Firestore الحية ────────────────────────────────────────
  const { data: myRequests, loading: reqsLoading } =
    useCollectionWhere(COLLECTIONS.REQUESTS, "userId", user.uid);
  const { data: myReports, loading: repsLoading } =
    useCollectionWhere(COLLECTIONS.CITIZEN_REPORTS, "userId", user.uid);

  const myStation = stations.find(s => s.district === user.district) || stations[0] || null;
  const myContainers = myStation?.containers || [];

  const inputStyle = { width: "100%", padding: "12px 16px", borderRadius: 12, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, fontFamily: ARABIC_FONT, outline: "none", boxSizing: "border-box" };

  const handleSendRequest = async () => {
    if (!reqAddress.trim()) return;
    setReqLoading(true);
    try {
      await addRequest({
        userId:   user.uid,
        userName: user.name,
        district: user.district,
        address:  reqAddress.trim(),
        binType:  reqBinType,
        notes:    reqNotes.trim(),
      });
      setReqDone("success");
      setReqAddress(""); setReqNotes("");
    } catch (e) {
      console.error("[addRequest]", e);
      setReqDone({ error: e?.code || e?.message || "unknown" });
    } finally {
      setReqLoading(false);
    }
  };

  const handleSendReport = async () => {
    if (!reportType || !reportDesc.trim()) return;
    setReportLoading(true);
    try {
      const chosenBin = myBins.find((b) => b.id === reportBinId);
      await addCitizenReport({
        userId:      user.uid,
        userName:    user.name,
        district:    user.district,
        type:        reportType,
        description: reportDesc.trim(),
        location:    chosenBin ? `${chosenBin.name} — ${user.district} - بريدة` : `${user.district} - بريدة`,
        binId:       chosenBin?.id || null,
        binName:     chosenBin?.name || null,
      });
      setReportBinId("");
      setReportDone("success");
      setReportType(""); setReportDesc("");
    } catch (e) {
      console.error("[addCitizenReport]", e);
      setReportDone({ error: e?.code || e?.message || "unknown" });
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div dir="rtl" style={{ fontFamily: ARABIC_FONT, background: C.bg, color: C.text, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <DemoEnvBanner />
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      {showPassModal && <ChangePasswordModal onClose={() => setShowPassModal(false)} />}

      {/* Header */}
      <header style={{ padding: "12px 24px", background: C.card, borderBottom: `1px solid ${C.accent}30`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <AppLogo size={42} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>بوابة الأفراد</div>
            <div style={{ fontSize: 10, color: C.accent }}>نظام إدارة النفايات الذكي - بريدة • <CitizenDateDisplay /></div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{user.name}</div>
            <div style={{ fontSize: 10, color: C.accent }}>{user.district}</div>
          </div>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: C.accent + "20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>👤</div>
          <button onClick={() => setShowPassModal(true)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid #10b98140`, background: `#10b98115`, color: C.accent, cursor: "pointer", fontSize: 11, fontFamily: ARABIC_FONT, fontWeight: 600 }}>⚙️ إعدادات الحساب</button>
          <button onClick={onLogout} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.danger}40`, background: `${C.danger}15`, color: C.danger, cursor: "pointer", fontSize: 11, fontFamily: ARABIC_FONT, fontWeight: 600 }}>خروج</button>
        </div>
      </header>

      {/* Tabs */}
      <div style={{ padding: "12px 24px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[
          { key: "home",    label: "🏠 الرئيسية" },
          { key: "bins",    label: "🗑️ حاوياتي" },
          { key: "station", label: "🏭 محطة الحي" },
          { key: "request", label: "📝 طلب حاوية" },
          { key: "report",  label: "⚠️ إبلاغ عن مشكلة" },
          { key: "history", label: "📋 سجل الطلبات والبلاغات" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "9px 16px", borderRadius: 10, border: `1px solid ${tab === t.key ? C.accent : C.border}`,
            background: tab === t.key ? C.accent + "15" : "transparent", color: tab === t.key ? C.accent : C.muted,
            cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: ARABIC_FONT,
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>

        {/* HOME */}
        {tab === "home" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: `linear-gradient(135deg, ${C.accent}15, ${C.card})`, border: `1px solid ${C.accent}30`, borderRadius: 16, padding: 24 }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: C.text, marginBottom: 6 }}>مرحباً {user.name} 👋</div>
              <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.8 }}>
                مرحباً بك في بوابة الأفراد لنظام إدارة النفايات الذكي. يمكنك متابعة حاوياتك، طلب حاوية جديدة، الإبلاغ عن مشاكل، ومتابعة أداء محطة حيك.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
              <StatCard title="حاوياتي" value={reqsLoading ? "…" : myRequests.filter(r => r.status === "مقبول").length} icon={<Trash2 size={22} color="#fff" />} gradient={C.g1} />
              <StatCard title="بلاغاتي" value={repsLoading ? "…" : myReports.length} icon={<ClipboardList size={22} color="#fff" />} gradient={C.g2} />
              <StatCard title="طلباتي" value={reqsLoading ? "…" : myRequests.length} icon={<FileText size={22} color="#fff" />} gradient={C.g3} />
              <StatCard title="امتلاء المحطة" value={myStation ? myStation.fillLevel : "—"} unit={myStation ? "%" : ""} icon={<Factory size={22} color="#fff" />} gradient={C.g4} />
            </div>

            {/* Quick Actions */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              {[
                { label: "طلب حاوية جديدة",    desc: "اطلب حاوية لمنزلك أو مبناك",          icon: <FileText size={32} color={C.accent} />, color: C.accent,   action: () => { setTab("request"); setReqDone(null); } },
                { label: "إبلاغ عن مشكلة",     desc: "بلّغ عن حاوية تالفة أو ممتلئة",       icon: <AlertTriangle size={32} color={C.warning} />, color: C.warning,  action: () => { setTab("report"); setReportDone(null); } },
                { label: "متابعة محطة الحي",    desc: "شاهد الحالة العامة لحاويات حيك",         icon: <BarChart2 size={32} color={C.info} />, color: C.info,    action: () => setTab("station") },
                { label: "عرض حاويات الحي",    desc: "تابع حالة الحاويات في محطة حيك",       icon: <Trash2 size={32} color={C.purple} />, color: C.purple, action: () => setTab("bins") },
              ].map((item, i) => (
                <div key={i} onClick={item.action} style={{ background: C.card, border: `1px solid ${item.color}30`, borderRadius: 14, padding: 18, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = item.color + "70"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = item.color + "30"; e.currentTarget.style.transform = "translateY(0)"; }}>
                  <div style={{ marginBottom: 8, display: "flex" }}>{item.icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: C.dim }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MY BINS — approved requests from Firestore */}
        {tab === "bins" && (() => {
          const approvedBins = myRequests.filter(r => r.status === "مقبول");
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {reqsLoading ? (
                <div style={{ color: C.muted, fontSize: 13, padding: 16 }}>جاري التحميل…</div>
              ) : approvedBins.length === 0 ? (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 32, textAlign: "center" }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>🗑️</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 6 }}>لا توجد حاويات مسجلة بعد</div>
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.8 }}>
                    يمكنك طلب حاوية جديدة وستظهر هنا بعد موافقة الموظف.
                  </div>
                  <button onClick={() => { setTab("request"); setReqDone(null); }} style={{
                    marginTop: 14, padding: "9px 22px", borderRadius: 10, border: "none",
                    background: C.g1, color: "#fff", fontWeight: 700, cursor: "pointer",
                    fontSize: 12, fontFamily: ARABIC_FONT,
                  }}><FileText size={14}/> طلب حاوية الآن</button>
                </div>
              ) : (
                approvedBins.map((bin) => {
                  const typeIcon = bin.binType === "عضوية" ? "🟢" : bin.binType === "بلاستيك" ? "🔵" : bin.binType === "ورق" ? "📄" : "🗑️";
                  const approvedAt = bin.updatedAt || bin.createdAt;
                  return (
                    <div key={bin.id} style={{ background: C.card, border: `1px solid ${C.accent}30`, borderRadius: 14, padding: 20 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{typeIcon} حاوية {bin.binType}</div>
                          <div style={{ fontSize: 12, color: C.muted }}>📍 {bin.address}</div>
                          {bin.notes && <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>📝 {bin.notes}</div>}
                        </div>
                        <span style={{ padding: "4px 12px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: C.accent + "20", color: C.accent }}>✅ نشطة</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                        {[
                          { label: "نوع الحاوية",   val: bin.binType,                                             icon: <Recycle size={18} color={C.muted} /> },
                          { label: "الحي",          val: bin.district,                                            icon: <MapPin size={18} color={C.muted} /> },
                          { label: "تاريخ الموافقة", val: approvedAt ? new Date(approvedAt).toLocaleDateString("ar-SA") : "—", icon: <Calendar size={18} color={C.muted} /> },
                          { label: "رقم الطلب",     val: bin.id.slice(0, 8),                                      icon: <Bookmark size={18} color={C.muted} /> },
                        ].map((item, j) => (
                          <div key={j} style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ display: "flex", alignItems: "center" }}>{item.icon}</span>
                            <div>
                              <div style={{ fontSize: 10, color: C.dim }}>{item.label}</div>
                              <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{item.val}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {bin.response && (
                        <div style={{ marginTop: 12, fontSize: 12, color: C.accent, background: C.accent + "10", padding: "8px 12px", borderRadius: 8 }}>
                          💬 ملاحظة الموظف: {bin.response}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          );
        })()}

        {/* STATION */}
        {tab === "station" && (
          myStation ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Card>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: 0 }}>{myStation.name}</h2>
                    <span style={{ fontSize: 12, color: C.muted }}>{myStation.district} • {myStation.wasteType || "مختلط"}</span>
                  </div>
                  <StatusBadge status={getStatus(myStation.fillLevel)} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14, marginBottom: 16 }}>
                  {[
                    { label: "مستوى الامتلاء", val: myStation.fillLevel || 0, color: (myStation.fillLevel || 0) >= 85 ? C.danger : (myStation.fillLevel || 0) >= 60 ? C.warning : C.accent },
                    { label: "الضغط", val: myStation.pressure || 0, color: C.info },
                    { label: "النفايات اليومية (كجم)", val: myStation.dailyWaste || 0, color: C.accent, unit: "" },
                  ].map((item, i) => (
                    <div key={i} style={{ background: C.bg, borderRadius: 12, padding: 14, textAlign: "center" }}>
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>{item.label}</div>
                      {i < 2
                        ? <div style={{ display: "flex", justifyContent: "center" }}><CircularGauge value={item.val} color={item.color} size={80} /></div>
                        : <div style={{ fontSize: 26, fontWeight: 800, color: item.color }}>{item.val}</div>
                      }
                    </div>
                  ))}
                </div>
              </Card>

              {/* Containers summary */}
              {myContainers.length > 0 && (
                <Card title={`حاويات المحطة (${myContainers.length})`} icon={<Trash2 size={16} color={C.muted} />}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {myContainers.map((c, i) => {
                      const fl = Number(c.fillLevel) || 0;
                      const sc = getStatus(fl);
                      const cc = sc === "حرج" ? C.danger : sc === "تحذير" ? C.warning : C.accent;
                      return (
                        <div key={c.id || i} style={{ display: "flex", alignItems: "center", gap: 12, background: C.bg, borderRadius: 10, padding: "10px 14px" }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: C.text, flex: 1 }}>{c.name || `حاوية ${i + 1}`}</span>
                          <div style={{ flex: 2, height: 8, background: C.border, borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ width: `${fl}%`, height: "100%", background: cc, borderRadius: 4 }} />
                          </div>
                          <span style={{ fontSize: 12, color: cc, fontWeight: 700, minWidth: 36, textAlign: "left" }}>{fl}%</span>
                          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: cc + "20", color: cc }}>{sc}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}
            </div>
          ) : (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 32, textAlign: "center", color: C.muted, fontSize: 13 }}>
              لا توجد محطة مرتبطة بحيك ({user.district}).
            </div>
          )
        )}

        {/* REQUEST BIN */}
        {tab === "request" && (
          <div style={{ maxWidth: 550 }}>
            {reqDone === "success" ? (
              <div style={{ background: C.card, border: `1px solid ${C.accent}40`, borderRadius: 16, padding: 32, textAlign: "center" }}>
                <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.accent, marginBottom: 8 }}>تم إرسال الطلب بنجاح!</div>
                <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.8, marginBottom: 16 }}>
                  سيتم مراجعة طلبك والرد عليك خلال 3-5 أيام عمل. يمكنك متابعة الطلب في تبويب «سجل الطلبات والبلاغات».
                </div>
                <button onClick={() => setReqDone(null)} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: C.accent, color: "#000", fontWeight: 700, cursor: "pointer", fontFamily: ARABIC_FONT, fontSize: 13 }}>تقديم طلب آخر</button>
              </div>
            ) : (
              <Card title="طلب حاوية جديدة" icon={<FileText size={16} color={C.muted} />}>
                {reqDone?.error && (
                  <div style={{ background: C.danger + "20", border: `1px solid ${C.danger}40`, borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: C.danger }}>
                    ❌ خطأ: <strong>{reqDone.error}</strong>
                  </div>
                )}
                <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.7, margin: "0 0 20px" }}>
                  يمكنك طلب حاوية نفايات جديدة لمنزلك أو مبناك. سيتم مراجعة الطلب من قبل الجهة المختصة.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 12, color: C.muted, marginBottom: 6, display: "block" }}>الاسم الكامل</label>
                    <input value={user.name} readOnly style={{ ...inputStyle, opacity: 0.7 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: C.muted, marginBottom: 6, display: "block" }}>الحي</label>
                    <input value={user.district} readOnly style={{ ...inputStyle, opacity: 0.7 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: C.muted, marginBottom: 6, display: "block" }}>العنوان التفصيلي *</label>
                    <input value={reqAddress} onChange={e => setReqAddress(e.target.value)} placeholder="مثال: شارع الملك فهد، بجوار مسجد النور" style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: C.muted, marginBottom: 6, display: "block" }}>نوع الحاوية المطلوبة</label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {["عضوية", "بلاستيك", "ورق", "مختلطة"].map(t => (
                        <button key={t} onClick={() => setReqBinType(t)} style={{
                          padding: "8px 16px", borderRadius: 8, border: `1px solid ${reqBinType === t ? C.accent : C.border}`,
                          background: reqBinType === t ? C.accent + "20" : "transparent", color: reqBinType === t ? C.accent : C.muted,
                          cursor: "pointer", fontSize: 12, fontFamily: ARABIC_FONT,
                        }}>{t}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: C.muted, marginBottom: 6, display: "block" }}>ملاحظات إضافية</label>
                    <textarea value={reqNotes} onChange={e => setReqNotes(e.target.value)} placeholder="أي تفاصيل إضافية..." style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} />
                  </div>
                  <button onClick={handleSendRequest} disabled={reqLoading || !reqAddress.trim()} style={{
                    padding: "14px", borderRadius: 12, border: "none",
                    background: reqAddress.trim() && !reqLoading ? C.g1 : C.border,
                    color: reqAddress.trim() && !reqLoading ? "#fff" : C.dim,
                    fontWeight: 800, cursor: reqAddress.trim() && !reqLoading ? "pointer" : "not-allowed",
                    fontFamily: ARABIC_FONT, fontSize: 14, marginTop: 8,
                  }}>{reqLoading ? "جاري الإرسال…" : "إرسال الطلب"}</button>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* REPORT PROBLEM */}
        {tab === "report" && (
          <div style={{ maxWidth: 550 }}>
            {reportDone === "success" ? (
              <div style={{ background: C.card, border: `1px solid ${C.accent}40`, borderRadius: 16, padding: 32, textAlign: "center" }}>
                <div style={{ fontSize: 56, marginBottom: 12 }}>📨</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.accent, marginBottom: 8 }}>تم إرسال البلاغ بنجاح!</div>
                <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.8, marginBottom: 16 }}>
                  سيتم التعامل مع البلاغ خلال 24 ساعة كحد أقصى. يمكنك متابعة حالته في تبويب «سجل الطلبات والبلاغات».
                </div>
                <button onClick={() => setReportDone(null)} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: C.accent, color: "#000", fontWeight: 700, cursor: "pointer", fontFamily: ARABIC_FONT, fontSize: 13 }}>تقديم بلاغ آخر</button>
              </div>
            ) : (
              <Card title="إبلاغ عن مشكلة" icon={<AlertTriangle size={16} color={C.muted} />}>
                {reportDone?.error && (
                  <div style={{ background: C.danger + "20", border: `1px solid ${C.danger}40`, borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: C.danger }}>
                    ❌ خطأ: <strong>{reportDone.error}</strong>
                  </div>
                )}
                <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.7, margin: "0 0 20px" }}>
                  أبلغ عن أي مشكلة في حاويات حيك، وسيتابعها موظف العمليات.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 12, color: C.muted, marginBottom: 6, display: "block" }}>نوع المشكلة *</label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {["حاوية ممتلئة", "حاوية تالفة", "رائحة كريهة", "حشرات", "تسرب سوائل", "عطل في المستشعر", "أخرى"].map(t => (
                        <button key={t} onClick={() => setReportType(t)} style={{
                          padding: "8px 14px", borderRadius: 8, border: `1px solid ${reportType === t ? C.warning : C.border}`,
                          background: reportType === t ? C.warning + "20" : "transparent", color: reportType === t ? C.warning : C.muted,
                          cursor: "pointer", fontSize: 11, fontFamily: ARABIC_FONT,
                        }}>{t}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: C.muted, marginBottom: 6, display: "block" }}>وصف المشكلة *</label>
                    <textarea value={reportDesc} onChange={e => setReportDesc(e.target.value)} placeholder="اشرح المشكلة بالتفصيل..."
                      style={{ ...inputStyle, minHeight: 100, resize: "vertical" }} />
                  </div>
                  {myBins.length > 0 && (
                    <div>
                      <label style={{ fontSize: 12, color: C.muted, marginBottom: 6, display: "block" }}>الحاوية المقصودة (اختياري — يرفع أولويتها مباشرة لدى فريق الجمع)</label>
                      <select value={reportBinId} onChange={(e) => setReportBinId(e.target.value)} style={inputStyle}>
                        <option value="">حاوية غير محددة — البلاغ على مستوى الحي</option>
                        {myBins.map((b) => <option key={b.id} value={b.id}>{b.name}{b.lastFillLevelPercent != null ? ` — الامتلاء الآن ${b.lastFillLevelPercent}%` : ""}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: 12, color: C.muted, marginBottom: 6, display: "block" }}>الموقع</label>
                    <input value={`${user.district} - بريدة`} readOnly style={{ ...inputStyle, opacity: 0.7 }} />
                  </div>
                  <button onClick={handleSendReport} disabled={reportLoading || !reportType || !reportDesc.trim()} style={{
                    padding: "14px", borderRadius: 12, border: "none",
                    background: (reportType && reportDesc.trim() && !reportLoading) ? "linear-gradient(135deg, #f59e0b, #d97706)" : C.border,
                    color: (reportType && reportDesc.trim() && !reportLoading) ? "#000" : C.dim,
                    fontWeight: 800, cursor: (reportType && reportDesc.trim() && !reportLoading) ? "pointer" : "not-allowed",
                    fontFamily: ARABIC_FONT, fontSize: 14, marginTop: 8,
                  }}>{reportLoading ? "جاري الإرسال…" : "إرسال البلاغ"}</button>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* HISTORY — requests + citizen_reports from Firestore */}
        {tab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Requests */}
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 10 }}>📝 طلبات الحاويات ({myRequests.length})</div>
              {reqsLoading ? (
                <div style={{ color: C.muted, fontSize: 13 }}>جاري التحميل…</div>
              ) : myRequests.length === 0 ? (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, color: C.muted, fontSize: 13, textAlign: "center" }}>لا توجد طلبات بعد.</div>
              ) : myRequests.map((r) => {
                const statusColor = r.status === "مقبول" ? C.accent : r.status === "مرفوض" ? C.danger : C.warning;
                return (
                  <div key={r.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>📦 {r.binType}</span>
                        <span style={{ fontSize: 11, color: C.dim, background: C.bg, padding: "2px 8px", borderRadius: 6 }}>{r.id.slice(0, 8)}</span>
                      </div>
                      <span style={{ padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: statusColor + "20", color: statusColor }}>{r.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>📍 {r.address}</div>
                    {r.notes && <div style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>📝 {r.notes}</div>}
                    {r.response && <div style={{ fontSize: 12, color: C.muted, background: C.bg, padding: "8px 12px", borderRadius: 8, marginTop: 6 }}>💬 الرد: {r.response}</div>}
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 6 }}>🕐 {r.createdAt ? new Date(r.createdAt).toLocaleString("ar-SA") : "—"}</div>
                  </div>
                );
              })}
            </div>

            {/* Citizen Reports */}
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 10 }}>📋 البلاغات ({myReports.length})</div>
              {repsLoading ? (
                <div style={{ color: C.muted, fontSize: 13 }}>جاري التحميل…</div>
              ) : myReports.length === 0 ? (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, color: C.muted, fontSize: 13, textAlign: "center" }}>لا توجد بلاغات بعد.</div>
              ) : myReports.map((r) => {
                const statusColor = r.status === "تم الحل" ? C.accent : r.status === "مرفوض" ? C.danger : C.warning;
                return (
                  <div key={r.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>⚠️ {r.type}</span>
                        <span style={{ fontSize: 11, color: C.dim, background: C.bg, padding: "2px 8px", borderRadius: 6 }}>{r.id.slice(0, 8)}</span>
                      </div>
                      <span style={{ padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: statusColor + "20", color: statusColor }}>{r.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>📍 {r.location || r.district}</div>
                    {r.description && <div style={{ fontSize: 12, color: C.muted, background: C.bg, padding: "8px 12px", borderRadius: 8, marginTop: 6 }}>{r.description}</div>}
                    {r.response && <div style={{ fontSize: 12, color: C.accent, background: C.accent + "10", padding: "8px 12px", borderRadius: 8, marginTop: 6 }}>💬 الرد: {r.response}</div>}
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 6 }}>🕐 {r.createdAt ? new Date(r.createdAt).toLocaleString("ar-SA") : "—"}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* المساعد الذكي — للمواطن */}
      <AIAssistant
        role="citizen"
        stations={stations}
        userData={user}
        myRequests={myRequests}
        myReports={myReports}
      />
    </div>
  );
};

// ======================== UNIFIED LOGIN ========================
const ALL_USERS = [
  // Employees
  { username: "emp1", password: "emp123", name: "أحمد السليمان", role: "employee", roleTitle: "فني تشغيل", avatar: "👷" },
  { username: "emp2", password: "emp123", name: "خالد الدوسري", role: "employee", roleTitle: "مشرف عمليات", avatar: "🔧" },
  // Executives
  { username: "admin", password: "admin123", name: "م. عبدالله الراشد", role: "executive", roleTitle: "المدير التنفيذي", avatar: "👔" },
  { username: "manager", password: "manager123", name: "م. سارة القحطاني", role: "executive", roleTitle: "مدير العمليات", avatar: "👩‍💼" },
  { username: "cfo", password: "cfo123", name: "أ. فهد المطيري", role: "executive", roleTitle: "المدير المالي", avatar: "💼" },
  // Citizens
  { username: "citizen", password: "citizen123", name: "محمد العتيبي", role: "citizen", roleTitle: "مواطن", avatar: "🏠", district: "حي الخليج" },
  { username: "citizen2", password: "citizen123", name: "نورة الحربي", role: "citizen", roleTitle: "مواطنة", avatar: "🏠", district: "حي الفايزية" },
];

const UnifiedLoginPage = ({ onLogin }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);

  const handleLogin = () => {
    const user = ALL_USERS.find(u => u.username === username && u.password === password);
    if (user) { onLogin(user); setError(""); }
    else setError("اسم المستخدم أو كلمة المرور غير صحيحة");
  };

  const roleCards = [
    { key: "employee", label: "الموظفين", icon: "👷", desc: "لوحة تحكم التشغيل والمراقبة", color: C.accent, gradient: "linear-gradient(135deg, #10b981, #059669)" },
    { key: "executive", label: "الإدارة العليا", icon: "🏛️", desc: "بوابة متخذي القرار والتقارير التنفيذية", color: C.warning, gradient: "linear-gradient(135deg, #f59e0b, #d97706)" },
    { key: "citizen", label: "الأفراد", icon: "🏠", desc: "طلب حاويات، إبلاغ عن مشاكل، متابعة الحي", color: C.info, gradient: "linear-gradient(135deg, #3b82f6, #1d4ed8)" },
  ];

  const filteredHints = selectedRole ? ALL_USERS.filter(u => u.role === selectedRole) : ALL_USERS;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0e1a 0%, #0f172a 50%, #0a0e1a 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: ARABIC_FONT, direction: "rtl", padding: "16px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <div style={{ width: "100%", maxWidth: 480, padding: "clamp(20px, 5vw, 36px)", background: C.card, borderRadius: 24, border: "1px solid #1e293b", position: "relative", overflow: "hidden" }}>
        {/* Decorative */}
        <div style={{ position: "absolute", top: -80, left: "50%", transform: "translateX(-50%)", width: 250, height: 250, background: "radial-gradient(circle, #10b98115, transparent)", borderRadius: "50%" }} />

        <div style={{ textAlign: "center", marginBottom: 28, position: "relative" }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, background: "linear-gradient(135deg, #10b981, #059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 14px" }}>♻️</div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: "0 0 4px" }}>نظام إدارة النفايات الذكي</h1>
          <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>مدينة بريدة - منطقة القصيم</p>
        </div>

        {/* Role Selection */}
        {!selectedRole ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "relative" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.muted, textAlign: "center", marginBottom: 4 }}>اختر نوع الحساب</div>
            {roleCards.map(r => (
              <button key={r.key} onClick={() => setSelectedRole(r.key)} style={{
                display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: 14,
                border: `1px solid ${r.color}30`, background: `${r.color}08`, cursor: "pointer", transition: "all 0.2s",
                textAlign: "right", fontFamily: ARABIC_FONT,
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = r.color + "70"; e.currentTarget.style.background = r.color + "15"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = r.color + "30"; e.currentTarget.style.background = r.color + "08"; e.currentTarget.style.transform = "translateY(0)"; }}
              >
                <div style={{ width: 50, height: 50, borderRadius: 14, background: r.gradient, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, flexShrink: 0 }}>{r.icon}</div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>دخول {r.label}</div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{r.desc}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "relative" }}>
            <button onClick={() => { setSelectedRole(null); setError(""); setUsername(""); setPassword(""); }} style={{ alignSelf: "flex-start", background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12, fontFamily: ARABIC_FONT, padding: 0 }}>
              ← العودة لاختيار الحساب
            </button>

            <div style={{ textAlign: "center", marginBottom: 4 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: roleCards.find(r => r.key === selectedRole)?.gradient, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, margin: "0 auto 8px" }}>
                {roleCards.find(r => r.key === selectedRole)?.icon}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: roleCards.find(r => r.key === selectedRole)?.color }}>
                دخول {roleCards.find(r => r.key === selectedRole)?.label}
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, color: C.muted, marginBottom: 6, display: "block" }}>اسم المستخدم</label>
              <input value={username} onChange={e => setUsername(e.target.value)} placeholder="أدخل اسم المستخدم"
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: "1px solid #334155", background: C.bg, color: C.text, fontSize: 14, fontFamily: ARABIC_FONT, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.muted, marginBottom: 6, display: "block" }}>كلمة المرور</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="أدخل كلمة المرور"
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: "1px solid #334155", background: C.bg, color: C.text, fontSize: 14, fontFamily: ARABIC_FONT, outline: "none", boxSizing: "border-box" }} />
            </div>

            {error && <div style={{ fontSize: 12, color: C.danger, background: "#ef444415", padding: "8px 12px", borderRadius: 8, textAlign: "center" }}>⚠️ {error}</div>}

            <button onClick={handleLogin} style={{
              padding: "14px", borderRadius: 12, border: "none",
              background: roleCards.find(r => r.key === selectedRole)?.gradient,
              color: "#000", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: ARABIC_FONT,
            }}>تسجيل الدخول</button>

            <button onClick={() => setShowHint(!showHint)} style={{ background: "none", border: "none", color: C.dim, fontSize: 11, cursor: "pointer", fontFamily: ARABIC_FONT }}>
              {showHint ? "إخفاء بيانات الدخول" : "عرض بيانات الدخول التجريبية"}
            </button>
            {showHint && (
              <div style={{ background: C.bg, borderRadius: 10, padding: 12, fontSize: 11, color: C.muted, border: "1px solid #1e293b" }}>
                {filteredHints.map((u, i) => (
                  <div key={i} style={{ marginBottom: i < filteredHints.length - 1 ? 6 : 0, display: "flex", justifyContent: "space-between" }}>
                    <span>{u.avatar} {u.roleTitle}</span>
                    <span style={{ direction: "ltr", color: roleCards.find(r => r.key === selectedRole)?.color }}>{u.username} / {u.password}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ======================== MAIN ========================
function SmartWasteManagement() {
  const { user: authUser, userData, userRole, logout } = useAuth();
  // The Amanah decision maker lands on the strategic portal; everyone else on the operations dashboard.
  const [pageRaw, setPage] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [time, setTime] = useState(new Date());
  const [showPassModal, setShowPassModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(true);
      else setSidebarOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 📦 البيانات من Firebase
  const [stations, setStations] = useState([]);
  const [loadingStations, setLoadingStations] = useState(true);

  // 🏘️ الأحياء والحاويات الذكية — المصدر الرئيسي الجديد للواجهة التشغيلية
  // (stations/containers أعلاه يبقى مؤقتًا كمصدر fallback داخلي لحين اكتمال
  // نقل كل الصفحات إليها؛ لا يُحذف من Firestore في هذه المرحلة)
  // Data scope (mirrors firestore.rules): platform admin → everything; manager/employee/driver with a
  // municipality → only that municipality's docs (server-side where-filter + rules).
  const scope = useMemo(() => scopeFor(userData), [userData]);
  const scopeMid = scope.all ? null : scope.municipalityId;
  const isDriverAccount = userData?.role === "driver";
  const isStaffAccount = !!userData && isStaffRole(userData.role);
  const page = pageRaw || (userData?.role === "executive" ? "exec" : "dashboard");
  const { neighborhoods, loading: loadingNeighborhoods } = useNeighborhoods({ municipalityId: scopeMid });
  const { bins, loading: loadingBins } = useBins({ municipalityId: scopeMid });
  const { readings: recentReadings } = useRecentReadings();
  const { vehicles, loading: loadingVehicles } = useVehicles({ municipalityId: scopeMid });
  const { routes, loading: loadingRoutes } = useCollectionRoutes(!isDriverAccount, scopeMid);
  const { events: collectionEvents } = useCollectionEvents({ municipalityId: scopeMid });
  // Audit entries are written with the real actor and, for scoped accounts, their municipality (rules).
  useEffect(() => { setAuditScope(scope.all ? null : scope.municipalityId); }, [scope.all, scope.municipalityId]);
  const { auditLog } = useAuditLog(isStaffAccount, scopeMid);
  const { profiles: driverProfiles } = useDriverProfiles(isStaffAccount, scopeMid);
  const { incidents: routeIncidents } = useRouteIncidents(isStaffAccount, scopeMid);
  const { assignments: vehicleAssignments } = useDriverVehicleAssignments(isStaffAccount, scopeMid);
  const { supportRequests } = useSupportRequests(isStaffAccount, scopeMid);
  const { transfers: resourceTransfers } = useResourceTransfers(isStaffAccount && (scope.all || userData?.role === "manager" || userData?.role === "employee"), scope.all ? null : scopeMid);
  const { municipalities: municipalityDocs } = useMunicipalities(); // eslint-disable-line no-unused-vars -- used by the municipalities page (Phase 2)
  const municipalityIdFor = useCallback((nid) => municipalityForNeighborhood(neighborhoods.find((n) => n.id === nid)), [neighborhoods]);
  // Citizen reports are visible to back-office staff of the municipality (rules); drivers do not read them.
  const { data: _citizenReportsCol } = useScopedCollection(COLLECTIONS.CITIZEN_REPORTS, { enabled: isStaffAccount, municipalityId: scopeMid });
  const citizenReports = useMemo(() => _citizenReportsCol || [], [_citizenReportsCol]);

  // Auto-sync of SUGGESTED routes (never approvals/dispatch): when the bins'
  // state drifts from the open suggestions, re-run the same reconciliation the
  // "توليد الجولات" button applies. Debounced, re-entrancy guarded, audited.
  const [autoSyncRoutes, setAutoSyncRoutes] = useState(() => { try { return localStorage.getItem("swm_autoSyncRoutes") !== "off"; } catch { return true; } });
  const toggleAutoSync = (v) => { setAutoSyncRoutes(v); try { localStorage.setItem("swm_autoSyncRoutes", v ? "on" : "off"); } catch { /* ignore */ } };
  const syncingRef = useRef(false);
  const [binsNeighborhoodFilter, setBinsNeighborhoodFilter] = useState(null);
  const goToBins = (neighborhoodId) => {
    setBinsNeighborhoodFilter(neighborhoodId || null);
    setPage("bins");
  };
  const [routeDraftBinId, setRouteDraftBinId] = useState(null);
  const goToRouteWithBin = (bin) => {
    setRouteDraftBinId(bin.id);
    setPage("control");
  };
  // Cross-page links that keep bins ↔ neighborhoods ↔ routes one click apart.
  const [routeInitialId, setRouteInitialId] = useState(null);
  const goToRoute = (routeId) => { setRouteInitialId(routeId); setPageTabs({ control: "routes" }); setPage("control"); };
  // Hub pages (routes / fleet / intelligence) keep the old pages as tabs; aliases keep old links working.
  const [pageTabs, setPageTabs] = useState({});
  const [collapsedGroupsSaved, setCollapsedGroupsSaved] = useState(() => { try { return JSON.parse(localStorage.getItem("swm_nav_collapsed") || "null"); } catch { return null; } });
  const tabOf = (target, def) => pageTabs[target] || ({ plan: ["control", "plan"], fleet: ["drivers", "live"], predictions: ["brain", "models"] }[page]?.[0] === target ? { plan: "plan", fleet: "live", predictions: "models" }[page] : def);
  const navigate = (pg, extra = {}) => {
    const alias = { plan: ["control", "plan"], fleet: ["drivers", "live"], predictions: ["brain", "models"] }[pg];
    const target = alias ? alias[0] : pg;
    const tab = extra.tab || (alias ? alias[1] : null);
    if (extra.municipalityId) setMunicipalityInitialId(extra.municipalityId);
    setPageTabs(tab ? { [target]: tab } : {});
    setPage(target);
  };
  const [mapInitialKey, setMapInitialKey] = useState(null);
  const [municipalityInitialId, setMunicipalityInitialId] = useState(null);
  const goToMapNeighborhood = (key) => { setMapInitialKey(key); setPage("map"); };

  // ── Analytics من Firestore (مع fallback للبيانات الافتراضية) ──────
  // ملاحظة: analytics/hourly (نشاط الشفط سابقًا) لم تعد تُقرأ هنا — الرسم الذي
  // كان يعرضها في الداشبورد استُبدل بـ Empty State بدل اختلاق بيانات جمع غير
  // حقيقية؛ المستند نفسه في Firestore لم يُحذف.
  const { data: _wDoc  } = useAnalyticsDoc("weekly");
  const { data: _mDoc  } = useAnalyticsDoc("monthly");
  const { data: _ftDoc } = useAnalyticsDoc("fire_temp");
  const { data: _fwDoc } = useAnalyticsDoc("fire_weekly");
  const { data: _fsCol } = useCollection("fire_sensors", null);

  const weeklyData               = _wDoc?.data   || generateWeeklyData();
  const monthlyTrend             = _mDoc?.data   || generateMonthlyTrend();
  const fireTempHistory          = _ftDoc?.data  || generateTempHistory();
  const fireWeeklyData           = _fwDoc?.data  || generateWeeklyFireIncidents();
  const fireSensors              = useMemo(() => _fsCol || [], [_fsCol]);
  // analytics/station_history is still written (below, via recordDailyStationHistory)
  // but no longer read here — StationsPage (its only reader) was replaced by
  // NeighborhoodsPage/BinsPage in this phase. Tracked as part of the existing
  // "Analytics Tech Debt" note in firestoreService.js.

  // أوامر الشفط (للمساعد الذكي)
  const { data: suctionJobs } = useCollection(COLLECTIONS.SUCTION_JOBS);

  // ✅ التنبيهات الحقيقية (§28/§29) — مشتقة من bins/neighborhoods الحية عبر
  // decisionEngine + alertsEngine، ومُزامَنة إلى Firestore (alerts) بمنطق
  // dedup يمنع تكرارها عند كل تحديث. استبدلت القائمة السابقة المشتقة من
  // stations فقط للعرض في الواجهة (generateAlerts تبقى معرّفة لتوافق الأماكن
  // الأخرى التي ما زالت تقرأ stations، لكن لوحة التحكم لم تعد تستهلكها).
  const { data: scopedAlerts } = useScopedCollection(COLLECTIONS.ALERTS, { enabled: isStaffAccount, municipalityId: scopeMid });
  const realAlerts = useMemo(() => (scopedAlerts || []).filter((a) => a.resolved === false), [scopedAlerts]);
  const alerts = useMemo(() => (realAlerts || []).map((a) => ({
    id: a.id,
    type: ALERT_TYPE_LABELS[a.type] || a.type,
    icon: ALERT_TYPE_ICONS[a.type] || "🔔",
    message: a.message,
    time: getReadingAgeLabel(a.createdAt),
  })), [realAlerts]);

  // When the server-side autonomous dispatcher is on (observe or auto), it owns route planning — the
  // browser-side suggestion sync stands down so two writers never touch the same routes.
  const { settings: dispatchSettings } = useDispatchSettings(isStaffAccount);
  const serverDispatchOn = !!dispatchSettings && (dispatchSettings.mode === "observe" || dispatchSettings.mode === "auto");
  const { decisions: dispatchDecisions } = useDispatchDecisions(isStaffAccount, scopeMid);
  const openEscalations = dispatchDecisions.filter((d) => d.type === "escalate" && d.status === "open").length;
  useEffect(() => {
    if (serverDispatchOn) return;
    if (!autoSyncRoutes || loadingRoutes || loadingBins || bins.length === 0 || !userData || !isStaffRole(userData.role)) return; // never from driver/citizen accounts
    const t = setTimeout(async () => {
      if (syncingRef.current) return;
      const ctx = makeBinContext(fireSensors, citizenReports, neighborhoods);
      const readingsByBin = {};
      for (const r of recentReadings) { if (r.bin_id) (readingsByBin[r.bin_id] ||= []).push(r); }
      const scored = bins.map((bin) => ({ bin, priority: getBinPriority(bin, null, readingsByBin[bin.id] || [], ctx.forBin(bin)) }));
      const open = routes.filter((r) => ["suggested", "approved", "in_progress"].includes(r.status));
      const plan = reconcileRecommendations(neighborhoods, scored, open);
      if (plan.toCreate.length + plan.toUpdate.length + plan.toWithdraw.length === 0) return;
      syncingRef.current = true;
      try {
        const result = await applyRouteReconciliation(plan, { municipalityIdFor });
        await writeAuditLog("routes_auto_synced", userData.uid, `${userData.fullName || ""} (مزامنة تلقائية من المتصفح)`, { ...result, triggeredBy: userData.fullName || "" });
      } catch (e) { console.error("[routes-auto-sync]", e); }
      finally { syncingRef.current = false; }
    }, 6000);
    return () => clearTimeout(t);
  }, [serverDispatchOn, autoSyncRoutes, bins, neighborhoods, routes, recentReadings, fireSensors, citizenReports, loadingRoutes, loadingBins, userData, municipalityIdFor]);

  const lastAlertSyncRef = useRef(0);
  useEffect(() => {
    if (bins.length === 0 && neighborhoods.length === 0) return;
    if (!userData || !isStaffRole(userData.role)) return; // alerts are written by staff sessions only (rules deny drivers/citizens)
    // Light client-side throttle — avoid re-syncing on every snapshot tick
    // when several collections update within the same second.
    const now = Date.now();
    if (now - lastAlertSyncRef.current < 5000) return;
    lastAlertSyncRef.current = now;

    const ctx = makeBinContext(fireSensors, citizenReports, neighborhoods);
    const scored = bins.map((bin) => ({ bin, priority: getBinPriority(bin, null, [], ctx.forBin(bin)) }));
    const scoredNeighborhoods = neighborhoods.map((n) => ({
      neighborhood: n,
      priority: getNeighborhoodPriority(scored.filter((x) => x.bin.neighborhoodId === n.id), ctx.forNeighborhoodName(n.name)),
    }));
    // Every alert carries the municipality of its source bin/neighborhood (rules scope alerts by municipality).
    const munOf = (id) => bins.find((b) => b.id === id)?.municipalityId || municipalityForNeighborhood(neighborhoods.find((n) => n.id === id)) || null;
    const candidates = generateAlertCandidates(scored, scoredNeighborhoods).map((c) => ({ ...c, municipalityId: munOf(c.sourceId) }));
    syncAlertsFromCandidates(candidates, userData.role === "executive" ? null : userData.municipalityId || null).catch((e) => console.error("[alerts-sync]", e));
  }, [bins, neighborhoods, fireSensors, citizenReports, userData]);

  // Browser notifications for the operations staff: new critical alerts + new suggested routes.
  const staffNotifItems = useMemo(() => [
    ...(realAlerts || []).filter((a) => a.severity === "high" || a.severity === "critical").map((a) => ({ key: `alert:${a.id}`, kind: "alert", alert: a })),
    ...routes.filter((r) => r.status === "suggested").map((r) => ({ key: `suggested:${r.id}`, kind: "route", route: r })),
    ...(routeIncidents || []).filter((i) => i.status === "open").map((i) => ({ key: `incident:${i.id}`, kind: "incident", inc: i })),
  ], [realAlerts, routes, routeIncidents]);
  useBrowserNotifications(staffNotifItems, useCallback((item) => item.kind === "alert"
    ? { title: `🔴 ${ALERT_TYPE_LABELS[item.alert.type] || "تنبيه حرج"}`, body: item.alert.message }
    : item.kind === "incident"
    ? { title: `🚧 بلاغ من السائق ${item.inc.driverName || ""}`, body: `${INCIDENT_TYPES[item.inc.type]?.label || item.inc.type} — ${item.inc.routeName || ""}` }
    : { title: "🧭 جولة مقترحة جديدة بانتظار اعتمادك", body: `${item.route.routeName} — ${item.route.binIds?.length || 0} حاوية` }, []),
    !!userData && userData.role !== "citizen" && userData.role !== "driver");

  // 🔄 الاستماع المباشر للمحطات من Firestore (Realtime)
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "stations"),
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setStations(data);
        setLoadingStations(false);
        // Keep districts_perf analytics in sync with real station data
        syncDistrictsPerfFromStations(data).catch(() => {});
        // Record one daily snapshot for the station history charts
        recordDailyStationHistory(data).catch(() => {});
      },
      (error) => {
        console.error("خطأ في الاستماع لبيانات المحطات:", error);
        setLoadingStations(false);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => { const i = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(i); }, []);

  // Build user object for child components from Firebase data
  const ROLE_TITLES = { executive: "إدارة عليا", employee: "موظف", driver: "سائق ميداني", citizen: "مواطن" };
  const ROLE_AVATARS = { executive: "🏛️", employee: "👷", driver: "🚛", citizen: "🏠" };
  const loggedInUser = userData ? {
    uid: authUser?.uid || "",
    name: userData.fullName,
    email: userData.email,
    role: userData.role,
    roleTitle: userData.roleAr || ROLE_TITLES[userData.role] || "مواطن",
    district: userData.district || "حي الخليج",
    avatar: ROLE_AVATARS[userData.role] || "🏠",
    municipalityId: userData.municipalityId || null,
  } : null;

  if (!loggedInUser) return null;

  const handleLogout = () => { logout(); };

  if (loadingStations) return <LoadingScreen />;

  // Citizen portal
  if (loggedInUser.role === "citizen") {
    return <CitizenPortal user={loggedInUser} onLogout={handleLogout} stations={stations} bins={bins} neighborhoods={neighborhoods} />;
  }

  // Executive portal
  // PLATFORM_ADMIN (executive) uses the full operations shell; the decision-maker portal is a page inside it ("بوابة متخذي القرار").


  // Driver / field portal (§24/§25) — scoped to the driver's currently
  // assigned route only, never the full operational dashboard.
  if (loggedInUser.role === "driver") {
    return (
      <DriverPortal
        user={loggedInUser} onLogout={handleLogout}
        vehicles={vehicles} bins={bins} neighborhoods={neighborhoods} fireSensors={fireSensors} recentReadings={recentReadings} citizenReports={citizenReports}
      />
    );
  }

  // Employee portal (default operational dashboard)
  // ── Navigation: grouped, role-specific (docs/UX_AUDIT_AND_DISPATCH.md §4). Merged pages stay reachable as tabs.
  const role = loggedInUser.role;
  const I = (key, label, icon) => ({ key, label, icon });
  const navGroups = role === "executive" ? [
    { id: "amanah", label: "الأمانة", items: [I("exec", "القيادة الاستراتيجية", <Crown size={18} />), I("brain", "العقل التشغيلي للمدينة", <Sparkles size={18} />), I("map", "الخريطة التشغيلية", <MapGlyph size={18} />), I("municipalities", "البلديات والنطاقات", <Landmark size={18} />), I("neighborhoods", "الأحياء", <Home size={18} />)] },
    { id: "ops", label: "التشغيل", items: [I("dashboard", "لوحة العمليات", <LayoutDashboard size={18} />), I("control", "الجولات والإسناد", <RouteIcon size={18} />), I("drivers", "الأسطول والسائقون", <Truck size={18} />), I("requests", "البلاغات والطلبات", <Inbox size={18} />), I("fire", "التنبيهات الحرارية", <Flame size={18} />), I("bins", "الحاويات الذكية", <Trash2 size={18} />)] },
    { id: "analysis", label: "التحليل", items: [I("reports", "التقارير", <ClipboardList size={18} />)] },
    { id: "admin", label: "الإدارة", items: [I("audit", "سجل العمليات", <FileText size={18} />), I("settings", "الإعدادات", <SettingsIcon size={18} />)] },
    { id: "demo", label: "بيئة العرض", items: [I("simulation", "المحاكاة", <Gauge size={18} />), I("demo", "سيناريو العرض", <Sparkles size={18} />)] },
  ] : [
    { id: "now", label: "الآن", items: [I("dashboard", "لوحة العمليات", <LayoutDashboard size={18} />), I("map", "الخريطة التشغيلية", <MapGlyph size={18} />)] },
    { id: "ops", label: "التشغيل", items: [I("control", "الجولات والإسناد", <RouteIcon size={18} />), I("drivers", "الأسطول والسائقون", <Truck size={18} />), I("requests", "البلاغات والطلبات", <Inbox size={18} />), I("fire", "التنبيهات الحرارية", <Flame size={18} />)] },
    { id: "assets", label: "الأصول", items: [I("bins", "الحاويات الذكية", <Trash2 size={18} />), I("municipalities", role === "manager" ? "بلديتي" : "البلدية والأحياء", <Landmark size={18} />)] },
    { id: "analysis", label: "التحليل والقرار", items: [I("brain", "العقل التشغيلي للمدينة", <Sparkles size={18} />), I("reports", "التقارير", <ClipboardList size={18} />)] },
    { id: "admin", label: "الإدارة", items: [...(role === "manager" ? [I("audit", "سجل العمليات", <FileText size={18} />)] : []), I("settings", role === "manager" ? "الإعدادات" : "تفضيلاتي", <SettingsIcon size={18} />)] },
    ...(role === "manager" ? [{ id: "demo", label: "بيئة العرض", items: [I("simulation", "المحاكاة", <Gauge size={18} />), I("demo", "سيناريو العرض", <Sparkles size={18} />)] }] : []),
  ];
  const navItems = navGroups.flatMap((g) => g.items);
  // Old page keys that became tabs of a hub page.
  const PAGE_ALIASES = { plan: ["control", "plan"], fleet: ["drivers", "live"], predictions: ["brain", "models"] };
  const resolvedPage = PAGE_ALIASES[page] ? PAGE_ALIASES[page][0] : page;
  const activeGroup = navGroups.find((g) => g.items.some((it) => it.key === resolvedPage))?.id;
  const collapsedGroups = collapsedGroupsSaved || (role === "executive" ? { ops: true, admin: true, demo: true } : { admin: true, demo: true });
  const toggleGroup = (id) => { const n = { ...collapsedGroups, [id]: !collapsedGroups[id] }; setCollapsedGroupsSaved(n); try { localStorage.setItem("swm_nav_collapsed", JSON.stringify(n)); } catch { /* per-viewer convenience only */ } };

  return (
    <div dir="rtl" style={{ fontFamily: ARABIC_FONT, background: C.bg, color: C.text, minHeight: "100vh", display: "flex", overflow: "hidden", paddingTop: 26 }}>
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 10000 }}><DemoEnvBanner /></div>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <SessionTimeout onLogout={handleLogout} timeoutMin={30} countdownSec={10} />

      {/* ── Mobile backdrop ─────────────────────────────── */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 40 }}
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside style={{
        width: 240,
        background: C.brand,
        borderLeft: `1px solid ${C.brandSoft}`,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        transition: "transform 0.3s ease",
        // Desktop: shrink to 64px when closed; Mobile: slide off-screen (fixed overlay)
        ...(isMobile ? {
          position: "fixed", top: 26, right: 0, bottom: 0, zIndex: 50,
          transform: sidebarOpen ? "translateX(0)" : "translateX(100%)",
          boxShadow: sidebarOpen ? "-8px 0 32px #0008" : "none",
        } : {
          width: sidebarOpen ? 240 : 64,
          position: "relative",
          transform: "none",
          overflow: "hidden",
        }),
      }}>
        <div style={{ padding: "20px 18px", borderBottom: `1px solid #ffffff22`, display: "flex", alignItems: "center", gap: 12, minHeight: 70 }}>
          <div style={{ flexShrink: 0 }}><AppLogo size={40} /></div>
          {(sidebarOpen || isMobile) && <div style={{ overflow: "hidden" }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "#ffffff", whiteSpace: "nowrap" }}>{BRAND.ar}</div>
            <div style={{ fontSize: 10, color: C.brandText, fontWeight: 600 }}>{BRAND.en} · {BRAND.city}</div>
          </div>}
          {isMobile && (
            <button onClick={() => setSidebarOpen(false)} style={{ marginRight: "auto", background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer", padding: 4 }}>✕</button>
          )}
        </div>

        <nav aria-label="القائمة الرئيسية" style={{ flex: 1, padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
          {navGroups.map((g) => {
            const expanded = (sidebarOpen || isMobile);
            const open = !collapsedGroups[g.id] || activeGroup === g.id || !expanded;
            return (
              <div key={g.id} style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: expanded ? 6 : 2 }}>
                {expanded && (
                  <button onClick={() => toggleGroup(g.id)} aria-expanded={open} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", padding: "6px 10px 4px", color: activeGroup === g.id ? "#ffffff" : C.brandText, opacity: activeGroup === g.id ? 1 : 0.75, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.3, cursor: "pointer", fontFamily: ARABIC_FONT }}>
                    <span>{g.label}</span><span style={{ fontSize: 10 }}>{open ? "▾" : "◂"}</span>
                  </button>
                )}
                {open && g.items.map((item) => {
                  const active = resolvedPage === item.key;
                  return (
                    <button key={item.key} aria-current={active ? "page" : undefined} title={item.label} onClick={() => { setPage(item.key); setPageTabs({}); setMapInitialKey(null); setRouteInitialId(null); if (isMobile) setSidebarOpen(false); }} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: expanded ? "9px 12px" : "10px 0",
                      justifyContent: expanded ? "flex-start" : "center",
                      borderRadius: 10, border: "none", borderInlineStart: active ? "3px solid #ffffff" : "3px solid transparent",
                      background: active ? "#ffffff24" : "transparent",
                      color: active ? "#ffffff" : C.brandText,
                      cursor: "pointer", fontSize: 13.5, fontWeight: active ? 800 : 500,
                      fontFamily: ARABIC_FONT, whiteSpace: "nowrap", width: "100%",
                    }}>
                      <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>{item.icon}</span>
                      {expanded && item.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* User info + logout */}
        <div style={{ padding: "12px 8px", borderTop: `1px solid ${C.border}` }}>
          {(sidebarOpen || isMobile) && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginBottom: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: C.accent + "20", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><User size={16} color={C.accent} /></div>
              <div style={{ overflow: "hidden" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#ffffff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{loggedInUser.name}</div>
                <div style={{ fontSize: 10, color: C.brandText }}>{ROLE_LABELS_AR[canonicalRole(loggedInUser.role)] || loggedInUser.roleTitle}</div>
              </div>
            </div>
          )}
          <button onClick={() => setTheme(THEME_NAME === "dark" ? "light" : "dark")} title="تبديل الوضع الفاتح/الداكن" style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%",
            padding: (sidebarOpen || isMobile) ? "10px 14px" : "10px 0",
            justifyContent: (sidebarOpen || isMobile) ? "flex-start" : "center",
            borderRadius: 10, marginBottom: 6, border: "1px solid #ffffff30", background: "#ffffff10", color: C.brandText,
            cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: ARABIC_FONT,
          }}>
            <span style={{ fontSize: 14 }}>{THEME_NAME === "dark" ? "☀️" : "🌙"}</span>
            {(sidebarOpen || isMobile) && (THEME_NAME === "dark" ? "الوضع الفاتح" : "الوضع الداكن")}
          </button>
          <button onClick={() => { setShowPassModal(true); if (isMobile) setSidebarOpen(false); }} style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%",
            padding: (sidebarOpen || isMobile) ? "10px 14px" : "10px 0",
            justifyContent: (sidebarOpen || isMobile) ? "flex-start" : "center",
            borderRadius: 10, marginBottom: 6,
            border: `1px solid #10b98130`, background: `#10b98110`, color: C.accent,
            cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: ARABIC_FONT,
          }}>
            <SettingsIcon size={16} color={C.accent} />
            {(sidebarOpen || isMobile) && "إعدادات الحساب"}
          </button>
          <button onClick={handleLogout} style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%",
            padding: (sidebarOpen || isMobile) ? "10px 14px" : "10px 0",
            justifyContent: (sidebarOpen || isMobile) ? "flex-start" : "center",
            borderRadius: 10,
            border: `1px solid ${C.danger}30`, background: `${C.danger}10`, color: C.danger,
            cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: ARABIC_FONT,
          }}>
            <LogOut size={16} color={C.danger} />
            {(sidebarOpen || isMobile) && "تسجيل خروج"}
          </button>
        </div>
      </aside>

      {showPassModal && <ChangePasswordModal onClose={() => setShowPassModal(false)} />}

      <main style={{ flex: 1, width: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* ── Header ──────────────────────────────────────── */}
        <header style={{
          padding: isMobile ? "10px 14px" : "14px 24px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: C.card, flexShrink: 0, gap: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {/* Hamburger (mobile) or collapse toggle (desktop) */}
            <button
              onClick={() => setSidebarOpen(v => !v)}
              style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 18, cursor: "pointer", padding: "4px 8px", flexShrink: 0 }}
            >☰</button>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: isMobile ? 15 : 20, fontWeight: 800, margin: 0, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {navItems.find((n) => n.key === resolvedPage)?.label}
              </h1>
              {!isMobile && (
                <span style={{ fontSize: 11, color: C.dim }}>
                  مدينة بريدة • {time.toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} • {time.toLocaleTimeString("ar-SA")}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 14, flexShrink: 0 }}>
            {/* زر التنبيهات */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowNotifications(v => !v)}
                style={{ position:"relative", width: 36, height: 36, borderRadius: 10, background: showNotifications ? C.accent+"18" : C.bg, border: `1px solid ${showNotifications ? C.accent+"60" : C.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition:"all 0.2s" }}
              >
                <Bell size={17} color={showNotifications ? C.accent : C.muted} />
                {alerts.filter((a) => a.type === "حرج").length > 0 && (
                  <span style={{ position: "absolute", top: -3, right: -3, width: 16, height: 16, borderRadius: "50%", background: C.danger, fontSize: 9, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, border:`2px solid ${C.card}` }}>
                    {alerts.filter((a) => a.type === "حرج").length}
                  </span>
                )}
              </button>
              {/* Dropdown التنبيهات */}
              {showNotifications && (
                <div style={{ position:"fixed", top:70, left: isMobile ? 12 : "auto", right: isMobile ? 12 : 24, width: isMobile ? "auto" : 340, background: C.card, border:`1px solid ${C.border}`, borderRadius:14, boxShadow:"0 12px 40px #0009", zIndex:999, overflow:"hidden" }}>
                  <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <BellRing size={15} color={C.accent} />
                      <span style={{ fontSize:14, fontWeight:700, color:C.text }}>التنبيهات</span>
                      {alerts.filter(a=>!a.resolved).length > 0 && (
                        <span style={{ background:C.danger, color:"#fff", fontSize:10, fontWeight:800, padding:"1px 7px", borderRadius:20 }}>{alerts.filter(a=>!a.resolved).length}</span>
                      )}
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <NotificationPermissionButton compact />
                      <button onClick={() => setShowNotifications(false)} style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", display:"flex", padding:2 }}><X size={15}/></button>
                    </div>
                  </div>
                  <div style={{ maxHeight:360, overflowY:"auto" }}>
                    {alerts.length === 0 ? (
                      <div style={{ padding:32, textAlign:"center" }}>
                        <CheckCircle size={32} color={C.accent} style={{ margin:"0 auto 10px", display:"block" }} />
                        <div style={{ fontSize:13, color:C.muted }}>لا توجد تنبيهات حالياً</div>
                      </div>
                    ) : (
                      alerts.slice(0, 12).map((alert, i) => {
                        const isHigh = alert.type === "حرج";
                        const isMid  = alert.type === "تحذير";
                        const clr    = isHigh ? C.danger : isMid ? C.warning : C.accent;
                        return (
                          <div key={alert.id || i} style={{ padding:"12px 16px", borderBottom:`1px solid ${C.border}30`, display:"flex", gap:10, alignItems:"flex-start", background: i % 2 === 0 ? "transparent" : "#ffffff04" }}>
                            <div style={{ width:8, height:8, borderRadius:"50%", background:clr, flexShrink:0, marginTop:5 }} />
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:12, color:C.text, fontWeight:600, marginBottom:2 }}>{alert.message}</div>
                              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                <span style={{ fontSize:10, color:clr, background:`${clr}15`, padding:"1px 8px", borderRadius:20, fontWeight:700 }}>{alert.type}</span>
                                <span style={{ fontSize:10, color:C.muted }}>{alert.time}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div style={{ padding:"10px 16px", borderTop:`1px solid ${C.border}`, display:"flex", justifyContent:"center" }}>
                    <button onClick={() => { setPage("dashboard"); setShowNotifications(false); }} style={{ background:"none", border:"none", color:C.accent, fontSize:12, cursor:"pointer", fontFamily:ARABIC_FONT, fontWeight:600, display:"flex", alignItems:"center", gap:5 }}>
                      <LayoutDashboard size={12} /> عرض لوحة التحكم
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: C.g1, display: "flex", alignItems: "center", justifyContent: "center" }}><User size={18} color="#fff" /></div>
          </div>
        </header>

        <div style={{ flex: 1, overflow: "auto", padding: isMobile ? 12 : 24 }}>
          {resolvedPage === "dashboard"  && <DashboardPage alerts={alerts} neighborhoods={neighborhoods} bins={bins} fireSensors={fireSensors} recentReadings={recentReadings} routes={routes} citizenReports={citizenReports} profiles={driverProfiles} incidents={routeIncidents} loggedInUser={loggedInUser} loadingNeighborhoods={loadingNeighborhoods} loadingBins={loadingBins} onViewBins={goToBins} onOpenRoute={goToRoute} onShowOnMap={goToMapNeighborhood} onNavigate={navigate} />}
          {resolvedPage === "map"         && <MapPage neighborhoods={neighborhoods} bins={bins} fireSensors={fireSensors} recentReadings={recentReadings} routes={routes} citizenReports={citizenReports} profiles={driverProfiles} loading={loadingNeighborhoods || loadingBins} onViewBins={goToBins} onAddToRoute={goToRouteWithBin} onOpenRoute={goToRoute} initialSelectedKey={mapInitialKey} />}
          {resolvedPage === "municipalities" && <MunicipalitiesPage key={municipalityInitialId || "all"} initialMunicipalityId={municipalityInitialId} neighborhoods={neighborhoods} bins={bins} fireSensors={fireSensors} recentReadings={recentReadings} routes={routes} citizenReports={citizenReports} profiles={driverProfiles} vehicles={vehicles} incidents={routeIncidents} supportRequests={supportRequests} loggedInUser={loggedInUser} onOpenRoute={(id) => { setRouteInitialId(id); setPage("control"); }} onViewBins={(nid) => { setBinsNeighborhoodFilter(nid); setPage("bins"); }} onAddToRoute={(b) => { setRouteDraftBinId(b.id); setPage("control"); }} />}
          {resolvedPage === "neighborhoods" && <NeighborhoodsPage neighborhoods={neighborhoods} bins={bins} fireSensors={fireSensors} routes={routes} citizenReports={citizenReports} loading={loadingNeighborhoods} onViewBins={goToBins} onOpenRoute={goToRoute} onShowOnMap={goToMapNeighborhood} />}
          {resolvedPage === "bins"        && <BinsPage neighborhoods={neighborhoods} bins={bins} routes={routes} fireSensors={fireSensors} citizenReports={citizenReports} loading={loadingBins} initialNeighborhoodId={binsNeighborhoodFilter} onAddToRoute={goToRouteWithBin} onOpenRoute={goToRoute} />}
          {resolvedPage === "requests"   && <RequestsManagementPage loggedInUser={loggedInUser} />}
          {resolvedPage === "fire"       && <FireAlertPage stations={stations} fireSensors={fireSensors} fireTempHistory={fireTempHistory} fireWeekly={fireWeeklyData} />}
          {resolvedPage === "reports"    && <ReportsPage stations={stations} monthlyTrend={monthlyTrend} weeklyData={weeklyData} bins={bins} neighborhoods={neighborhoods} routes={routes} collectionEvents={collectionEvents} vehicles={vehicles} auditLog={auditLog} fireSensors={fireSensors} citizenReports={citizenReports} />}
          {resolvedPage === "demo"       && <DemoScenarioPage neighborhoods={neighborhoods} bins={bins} routes={routes} profiles={driverProfiles} vehicles={vehicles} incidents={routeIncidents} supportRequests={supportRequests} transfers={resourceTransfers} auditLog={auditLog} recentReadings={recentReadings} fireSensors={fireSensors} citizenReports={citizenReports} loggedInUser={loggedInUser} onNavigate={(pg, extra) => { if (extra?.municipalityId) setMunicipalityInitialId(extra.municipalityId); setPage(pg); }} />}
          {resolvedPage === "simulation" && <SimulationPage neighborhoods={neighborhoods} bins={bins} vehicles={vehicles} loggedInUser={loggedInUser} />}
          {resolvedPage === "exec"       && <ExecDashboard embedded user={loggedInUser} onLogout={handleLogout} stations={stations} monthlyTrend={monthlyTrend} weeklyData={weeklyData}
            neighborhoods={neighborhoods} bins={bins} routes={routes} fireSensors={fireSensors} citizenReports={citizenReports} collectionEvents={collectionEvents} auditLog={auditLog} vehicles={vehicles} recentReadings={recentReadings}
            profiles={driverProfiles} incidents={routeIncidents} supportRequests={supportRequests} transfers={resourceTransfers} loggedInUser={loggedInUser} onOpenMunicipality={(mid) => { setMunicipalityInitialId(mid); setPage("municipalities"); }} />}
          {resolvedPage === "settings"   && <SettingsPage bins={bins} loggedInUser={loggedInUser} autoSyncRoutes={autoSyncRoutes} onToggleAutoSync={toggleAutoSync} />}
          {resolvedPage === "audit"      && <AuditLogPage auditLog={auditLog} />}
          {resolvedPage === "control" && (() => { const t = tabOf("control", "routes"); return (
            <HubPage value={t} onChange={(k) => setPageTabs({ control: k })} tabs={[{ key: "routes", label: "الجولات" }, { key: "dispatch", label: "الإسناد التلقائي", count: openEscalations, tone: "danger" }, { key: "plan", label: "خطة الجمع الذكية" }]}>
              {t === "routes" && <RouteManagementPage neighborhoods={neighborhoods} bins={bins} recentReadings={recentReadings} fireSensors={fireSensors} citizenReports={citizenReports} vehicles={vehicles} routes={routes} driverProfiles={driverProfiles} loadingVehicles={loadingVehicles} loadingRoutes={loadingRoutes} loggedInUser={loggedInUser} dispatchSettings={dispatchSettings} draftBinId={routeDraftBinId} onConsumeDraftBin={() => setRouteDraftBinId(null)} initialRouteId={routeInitialId} onConsumeInitialRoute={() => setRouteInitialId(null)} onShowOnMap={goToMapNeighborhood} onOpenDispatch={() => setPageTabs({ control: "dispatch" })} />}
              {t === "dispatch" && <DispatchCenter loggedInUser={loggedInUser} onOpenRoute={goToRoute} />}
              {t === "plan" && <SmartPlanPage neighborhoods={neighborhoods} bins={bins} profiles={driverProfiles} vehicles={vehicles} routes={routes} recentReadings={recentReadings} fireSensors={fireSensors} citizenReports={citizenReports} loggedInUser={loggedInUser} onOpenRoute={goToRoute} />}
            </HubPage>
          ); })()}
          {resolvedPage === "drivers" && (() => { const t = tabOf("drivers", "live"); return (
            <HubPage value={t} onChange={(k) => setPageTabs({ drivers: k })} tabs={[{ key: "live", label: "المتابعة الحية", count: routeIncidents.filter((i) => i.status === "open").length, tone: "danger" }, { key: "profiles", label: "السائقون والمركبات" }]}>
              {t === "live" && <FleetMonitorPage profiles={driverProfiles} vehicles={vehicles} routes={routes} incidents={routeIncidents} bins={bins} neighborhoods={neighborhoods} loggedInUser={loggedInUser} />}
              {t === "profiles" && <DriversPage profiles={driverProfiles} assignments={vehicleAssignments} vehicles={vehicles} loggedInUser={loggedInUser} />}
            </HubPage>
          ); })()}
          {resolvedPage === "brain" && <IntelligencePage neighborhoods={neighborhoods} bins={bins} profiles={driverProfiles} vehicles={vehicles} routes={routes} incidents={routeIncidents} recentReadings={recentReadings} fireSensors={fireSensors} citizenReports={citizenReports} loggedInUser={loggedInUser} initialSection={tabOf("brain", null)} onNavigate={navigate}
            modelsDetail={<PredictionsPage stations={stations} neighborhoods={neighborhoods} bins={bins} recentReadings={recentReadings} fireSensors={fireSensors} />} />}
        </div>
      </main>

      {/* المساعد الذكي — للموظف والإدارة العليا */}
      <AIAssistant
        role={userRole}
        stations={stations}
        alerts={alerts}
        userData={loggedInUser}
        suctionJobs={suctionJobs || []}
      />
    </div>
  );
}


// ============================================================
// ⏳ PENDING APPROVAL SCREEN
// ============================================================
const PendingApprovalScreen = () => {
  const { logout, userData } = useAuth();
  const F = "'Noto Kufi Arabic',sans-serif";
  return (
    <div dir="rtl" style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:F }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <div style={{ width:"100%", maxWidth:460, padding:"clamp(20px,5vw,40px)", background:C.card, borderRadius:24, border:"1px solid #f59e0b30", textAlign:"center" }}>
        <div style={{ width:80, height:80, borderRadius:20, background:"#f59e0b15", display:"flex", alignItems:"center", justifyContent:"center", fontSize:42, margin:"0 auto 20px", border:"2px solid #f59e0b30" }}>⏳</div>
        <h2 style={{ fontSize:22, fontWeight:900, color:C.text, margin:"0 0 10px" }}>بانتظار الموافقة</h2>
        <p style={{ fontSize:14, color:C.muted, lineHeight:1.8, margin:"0 0 20px" }}>
          تم إنشاء حسابك بنجاح كـ <span style={{ color:C.warning, fontWeight:700 }}>{userData?.roleAr}</span>
          <br />حسابك قيد المراجعة من الإدارة. ستتمكن من الدخول بعد الموافقة.
        </p>
        <div style={{ background:C.bg, borderRadius:12, padding:16, marginBottom:20, textAlign:"right" }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8, fontSize:13 }}>
            <span style={{ color:C.dim }}>الاسم:</span>
            <span style={{ color:C.text, fontWeight:600 }}>{userData?.fullName}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8, fontSize:13 }}>
            <span style={{ color:C.dim }}>البريد:</span>
            <span style={{ color:C.text, fontWeight:600 }}>{userData?.email}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8, fontSize:13 }}>
            <span style={{ color:C.dim }}>الدور المطلوب:</span>
            <span style={{ color:C.warning, fontWeight:600 }}>{userData?.roleAr}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:13 }}>
            <span style={{ color:C.dim }}>الحالة:</span>
            <span style={{ color:C.warning, fontWeight:600 }}>⏳ بانتظار الموافقة</span>
          </div>
        </div>
        <button onClick={logout} style={{ padding:"12px 30px", borderRadius:10, border:"1px solid #ef444440", background:"#ef444415", color:C.danger, cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:F }}>
          تسجيل خروج
        </button>
      </div>
    </div>
  );
};

// ============================================================
// 👑 ADMIN PANEL — إدارة المستخدمين والصلاحيات
// ============================================================
const AdminPanel = ({ onBack }) => {
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [filter, setFilter] = useState("الكل");
  const [search, setSearch] = useState("");
  const [actionMsg, setActionMsg] = useState("");
  const F = "'Noto Kufi Arabic',sans-serif";

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
    setLoadingUsers(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const updateUserRole = async (uid, newRole) => {
    const roleArMap = { executive: "متخذ القرار بالأمانة", manager: "متخذ القرار بالبلدية", employee: "موظف العمليات", driver: "فرد ميداني (سائق)", citizen: "مواطن" };
    const roleAr = roleArMap[newRole] || "مواطن";
    void roleAr;
    try { await adminUserAction({ action: "setRole", uid, role: newRole }); setActionMsg("✅ تم تغيير الدور بنجاح"); }
    catch (e) { setActionMsg("تعذر تغيير الدور: " + friendlyError(e)); }
    setTimeout(() => setActionMsg(""), 3000);
    fetchUsers();
  };

  const updateUserStatus = async (uid, newStatus) => {
    try { await adminUserAction({ action: "setStatus", uid, status: newStatus }); setActionMsg(newStatus === "active" ? "✅ تم تفعيل الحساب" : "⛔ تم تعطيل الحساب"); }
    catch (e) { setActionMsg("تعذر تغيير الحالة: " + friendlyError(e)); }
    setTimeout(() => setActionMsg(""), 3000);
    fetchUsers();
  };

  const approveUser = async (uid) => {
    try { await adminUserAction({ action: "setStatus", uid, status: "active" }); setActionMsg("✅ تم قبول المستخدم"); }
    catch (e) { setActionMsg("تعذر قبول المستخدم: " + friendlyError(e)); }
    setTimeout(() => setActionMsg(""), 3000);
    fetchUsers();
  };

  const rejectUser = async (uid) => {
    try { await adminUserAction({ action: "setStatus", uid, status: "rejected" }); setActionMsg("❌ تم رفض المستخدم"); }
    catch (e) { setActionMsg("تعذر رفض المستخدم: " + friendlyError(e)); }
    setTimeout(() => setActionMsg(""), 3000);
    fetchUsers();
  };

  const pendingUsers = users.filter(u => u.status === "pending");
  const filteredUsers = users.filter(u => {
    if (filter !== "الكل") {
      const roleMap = { "إدارة عليا": "executive", "موظف": "employee", "مواطن": "citizen", "بانتظار": "pending" };
      if (filter === "بانتظار") return u.status === "pending";
      if (roleMap[filter] && u.role !== roleMap[filter]) return false;
    }
    if (search && !u.fullName?.includes(search) && !u.email?.includes(search)) return false;
    return true;
  });

  const stats = {
    total: users.length,
    active: users.filter(u => u.status === "active").length,
    pending: pendingUsers.length,
    executives: users.filter(u => u.role === "executive").length,
    employees: users.filter(u => u.role === "employee").length,
    citizens: users.filter(u => u.role === "citizen").length,
  };

  const statusBadge = (status) => {
    const map = { active: { label: "نشط", bg: "#10b98120", color: C.accent }, pending: { label: "بانتظار", bg: "#f59e0b20", color: C.warning }, suspended: { label: "معطّل", bg: "#ef444420", color: C.danger }, rejected: { label: "مرفوض", bg: "#64748b20", color: C.dim } };
    const s = map[status] || map.suspended;
    return <span style={{ padding:"3px 10px", borderRadius:20, fontSize:10, fontWeight:600, background:s.bg, color:s.color }}>{s.label}</span>;
  };

  const roleBadge = (role) => {
    const map = { executive: { label: "إدارة عليا", bg: "#f59e0b20", color: C.warning }, employee: { label: "موظف", bg: "#3b82f620", color: C.info }, citizen: { label: "مواطن", bg: "#10b98120", color: C.accent } };
    const r = map[role] || map.citizen;
    return <span style={{ padding:"3px 10px", borderRadius:20, fontSize:10, fontWeight:600, background:r.bg, color:r.color }}>{r.label}</span>;
  };

  return (
    <div dir="rtl" style={{ minHeight:"100vh", background:"#070b14", fontFamily:F, color:C.text }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* Header */}
      <header style={{ padding:"14px 28px", background:C.brand, borderBottom:`1px solid ${C.brandSoft}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ width:42, height:42, borderRadius:12, background:"linear-gradient(135deg,#8b5cf6,#6d28d9)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>👑</div>
          <div>
            <div style={{ fontSize:16, fontWeight:900, color:C.purple }}>لوحة إدارة النظام</div>
            <div style={{ fontSize:10, color:C.muted }}>إدارة المستخدمين والصلاحيات</div>
          </div>
        </div>
        <button onClick={onBack} style={{ padding:"8px 18px", borderRadius:8, border:"1px solid #1e293b", background:"transparent", color:C.muted, cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:F }}>← العودة للوحة الرئيسية</button>
      </header>

      <div style={{ padding:"20px 28px" }}>
        {/* Action Message */}
        {actionMsg && <div style={{ padding:"12px 18px", borderRadius:10, background:"#10b98115", border:"1px solid #10b98130", color:C.accent, fontSize:13, fontWeight:600, marginBottom:16, textAlign:"center" }}>{actionMsg}</div>}

        {/* Stats */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))", gap:12, marginBottom:20 }}>
          {[
            { label: "إجمالي المستخدمين", val: stats.total, icon: "👥", color: C.purple },
            { label: "نشط", val: stats.active, icon: "✅", color: C.accent },
            { label: "بانتظار الموافقة", val: stats.pending, icon: "⏳", color: C.warning },
            { label: "إدارة عليا", val: stats.executives, icon: "🏛️", color: C.warning },
            { label: "موظفون", val: stats.employees, icon: "👷", color: C.info },
            { label: "مواطنون", val: stats.citizens, icon: "🏠", color: C.accent },
          ].map((s, i) => (
            <div key={i} style={{ background:C.card, border:`1px solid ${s.color}25`, borderRadius:14, padding:16, textAlign:"center" }}>
              <div style={{ fontSize:24, marginBottom:4 }}>{s.icon}</div>
              <div style={{ fontSize:24, fontWeight:900, color:s.color }}>{s.val}</div>
              <div style={{ fontSize:11, color:C.dim }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Pending Approvals */}
        {pendingUsers.length > 0 && (
          <div style={{ background:C.card, border:"1px solid #f59e0b30", borderRadius:16, padding:20, marginBottom:20 }}>
            <div style={{ fontSize:15, fontWeight:700, color:C.warning, marginBottom:14 }}>⏳ طلبات بانتظار الموافقة ({pendingUsers.length})</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {pendingUsers.map(u => (
                <div key={u.id} style={{ background:C.bg, borderRadius:12, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", border:"1px solid #1e293b" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ width:40, height:40, borderRadius:10, background:"#f59e0b15", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>
                      {u.role === "executive" ? "🏛️" : "👷"}
                    </div>
                    <div>
                      <div style={{ fontSize:14, fontWeight:700, color:C.text }}>{u.fullName}</div>
                      <div style={{ fontSize:11, color:C.dim }}>{u.email} • يطلب: <span style={{ color:C.warning }}>{u.roleAr}</span> • {u.district || "بدون حي"}</div>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={() => approveUser(u.id)} style={{ padding:"8px 18px", borderRadius:8, border:"none", background:C.accent, color:"#fff", cursor:"pointer", fontSize:12, fontWeight:700, fontFamily:F }}>✅ قبول</button>
                    <button onClick={() => rejectUser(u.id)} style={{ padding:"8px 18px", borderRadius:8, border:"none", background:C.danger, color:"#fff", cursor:"pointer", fontSize:12, fontWeight:700, fontFamily:F }}>❌ رفض</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters & Search */}
        <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
          {["الكل", "إدارة عليا", "موظف", "مواطن", "بانتظار"].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding:"7px 16px", borderRadius:10, border:`1px solid ${filter===f ? C.purple : C.border}`,
              background: filter===f ? "#8b5cf620" : "transparent", color: filter===f ? C.purple : C.muted,
              cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:F,
            }}>{f}{f==="بانتظار" && stats.pending > 0 ? ` (${stats.pending})` : ""}</button>
          ))}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 بحث بالاسم أو البريد..." style={{ flex:1, minWidth:200, padding:"8px 14px", borderRadius:10, border:"1px solid #1e293b", background:C.bg, color:C.text, fontSize:12, fontFamily:F, outline:"none" }} />
        </div>

        {/* Users Table */}
        <div style={{ background:C.card, borderRadius:16, border:"1px solid #1e293b", overflow:"hidden" }}>
          {loadingUsers ? (
            <div style={{ padding:40, textAlign:"center", color:C.dim }}>جاري التحميل...</div>
          ) : (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead>
                  <tr>
                    {["الاسم", "البريد", "الدور", "الحي", "الحالة", "تاريخ التسجيل", "الإجراءات"].map(h => (
                      <th key={h} style={{ padding:"12px 14px", textAlign:"right", color:C.muted, borderBottom:"1px solid #1e293b", fontWeight:600, fontSize:11, whiteSpace:"nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => (
                    <tr key={u.id} style={{ borderBottom:"1px solid #1e293b10" }}>
                      <td style={{ padding:"12px 14px", fontWeight:600 }}>{u.fullName}</td>
                      <td style={{ padding:"12px 14px", color:C.muted, direction:"ltr", textAlign:"right" }}>{u.email}</td>
                      <td style={{ padding:"12px 14px" }}>{roleBadge(u.role)}</td>
                      <td style={{ padding:"12px 14px", color:C.muted }}>{u.district || "-"}</td>
                      <td style={{ padding:"12px 14px" }}>{statusBadge(u.status)}</td>
                      <td style={{ padding:"12px 14px", color:C.dim, fontSize:11 }}>{u.createdAt?.split("T")[0]}</td>
                      <td style={{ padding:"12px 14px" }}>
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                          {u.status === "pending" && <>
                            <button onClick={() => approveUser(u.id)} style={{ padding:"4px 10px", borderRadius:6, border:"none", background:C.accent, color:"#fff", cursor:"pointer", fontSize:10, fontWeight:600, fontFamily:F }}>قبول</button>
                            <button onClick={() => rejectUser(u.id)} style={{ padding:"4px 10px", borderRadius:6, border:"none", background:C.danger, color:"#fff", cursor:"pointer", fontSize:10, fontWeight:600, fontFamily:F }}>رفض</button>
                          </>}
                          <select value={u.role} onChange={e => updateUserRole(u.id, e.target.value)} style={{ padding:"4px 8px", borderRadius:6, border:"1px solid #1e293b", background:C.bg, color:C.text, fontSize:10, fontFamily:F, cursor:"pointer" }}>
                            <option value="citizen">مواطن</option>
                            <option value="employee">موظف</option>
                            <option value="driver">سائق ميداني</option>
                            <option value="manager">متخذ القرار بالبلدية</option>
                            <option value="executive">إدارة عليا</option>
                          </select>
                          {(u.role === "manager" || u.role === "employee" || u.role === "driver") && (
                            <select value={u.municipalityId || ""} onChange={async (e) => { try { await setUserMunicipality(u.id, e.target.value || null); } catch (err) { setActionMsg("تعذر تعديل البلدية: " + friendlyError(err)); return; } setActionMsg("✅ تم تحديث البلدية"); setTimeout(() => setActionMsg(""), 3000); fetchUsers(); }} title="البلدية الفرعية (نطاق البيانات)" style={{ padding:"4px 8px", borderRadius:6, border:`1px solid ${u.municipalityId ? C.border : C.warning}`, background:C.bg, color:C.text, fontSize:10, fontFamily:F, cursor:"pointer" }}>
                              <option value="">بلا بلدية (غير منطاق)</option>
                              {MUNICIPALITIES.map((m) => <option key={m.id} value={m.id}>{m.shortAr}</option>)}
                            </select>
                          )}
                          {u.status === "active" ? (
                            <button onClick={() => updateUserStatus(u.id, "suspended")} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #ef444440", background:"#ef444415", color:C.danger, cursor:"pointer", fontSize:10, fontWeight:600, fontFamily:F }}>تعطيل</button>
                          ) : u.status !== "pending" && (
                            <button onClick={() => updateUserStatus(u.id, "active")} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #10b98140", background:"#10b98115", color:C.accent, cursor:"pointer", fontSize:10, fontWeight:600, fontFamily:F }}>تفعيل</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredUsers.length === 0 && <div style={{ padding:30, textAlign:"center", color:C.dim }}>لا يوجد نتائج</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// 🚀 ROOT APP — ENTRY POINT
// ============================================================
// ======================== PUBLIC LANDING PAGE ========================
/**
 * Lightweight preview of Buraidah (no map tiles, no network): the neighborhood boundaries the platform
 * already uses (OpenStreetMap) + the demo simulator's deterministic bins and one example route.
 * Always labelled as a demo — never presented as live operations.
 */
const BuraidahPreview = () => {
  const data = useMemo(() => {
    const feats = buraidahNeighborhoodsGeo.features;
    const scen = generateScenario({}, { neighborhoods: feats.map((f) => ({ id: f.properties.baseName, name: f.properties.name })), featuresByKey: FEATURE_BY_KEY, keyFor: normalizeNeighborhoodName });
    const rings = feats.map((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p) => p[0])));
    const all = rings.flat(2);
    const lngs = all.map((c) => c[0]), lats = all.map((c) => c[1]);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs), minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const W = 600, H = 460, pad = 18;
    const sx = (W - 2 * pad) / ((maxLng - minLng) * k), sy = (H - 2 * pad) / (maxLat - minLat), s = Math.min(sx, sy);
    const ox = (W - (maxLng - minLng) * k * s) / 2, oy = (H - (maxLat - minLat) * s) / 2;
    const P = (lng, lat) => [ox + (lng - minLng) * k * s, oy + (maxLat - lat) * s];
    const paths = rings.map((rs) => rs.map((ring) => "M" + ring.map(([lng, lat]) => P(lng, lat).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join(" "));
    const bins = scen.bins.filter((b) => b.lat != null).map((b) => ({ ...b, xy: P(b.lng, b.lat) }));
    // Example route: the neighborhood with the most critical bins, nearest-neighbour order.
    const byN = {}; for (const b of bins) if (b.fill >= 85 && b.connectivity === "online") (byN[b.neighborhoodId] ||= []).push(b);
    const pick = Object.values(byN).sort((a, b) => b.length - a.length)[0] || [];
    const order = []; const rest = [...pick];
    let cur = rest.shift(); while (cur) { order.push(cur); rest.sort((a, b) => Math.hypot(a.xy[0] - cur.xy[0], a.xy[1] - cur.xy[1]) - Math.hypot(b.xy[0] - cur.xy[0], b.xy[1] - cur.xy[1])); cur = rest.shift(); }
    return { W, H, paths, bins, route: order.slice(0, 7), neighborhoods: feats.length };
  }, []);
  const color = (b) => (b.connectivity !== "online" ? "#9aa5a0" : b.fill >= 85 ? C.danger : b.fill >= 60 ? C.warning : C.accent);
  return (
    <figure style={{ margin: 0, background: "#ffffff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 12, boxShadow: "0 1px 2px #0b3d2e0d" }}>
      <svg viewBox={`0 0 ${data.W} ${data.H}`} role="img" aria-label="معاينة توضيحية لأحياء بريدة والحاويات وجولة نموذجية" style={{ width: "100%", height: "auto", display: "block", background: "#f6faf7", borderRadius: 10 }}>
        {data.paths.map((d, i) => <path key={i} d={d} fill="#e3efe8" stroke="#9cc3ad" strokeWidth="1.2" />)}
        {data.route.length > 1 && <polyline points={data.route.map((b) => b.xy.join(",")).join(" ")} fill="none" stroke={C.brand} strokeWidth="2.4" strokeDasharray="6 4" strokeLinejoin="round" />}
        {data.bins.map((b) => <circle key={b.simId} cx={b.xy[0]} cy={b.xy[1]} r={b.fill >= 85 ? 4.2 : 3.2} fill={color(b)} stroke="#fff" strokeWidth="1" />)}
        {data.route[0] && <g transform={`translate(${data.route[0].xy[0] - 9},${data.route[0].xy[1] - 22})`}><rect width="18" height="14" rx="3" fill={C.brand} /><path d="M4 7h10M9 3v8" stroke="#fff" strokeWidth="1.6" /></g>}
      </svg>
      <figcaption style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, marginTop: 10, fontSize: 12, color: C.muted }}>
        <span style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[[C.accent, "طبيعية"], [C.warning, "تحتاج متابعة"], [C.danger, "حرجة"], ["#9aa5a0", "مستشعر غير متصل"]].map(([c, l]) => <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: c, display: "inline-block" }} />{l}</span>)}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 16, borderTop: `2px dashed ${C.brand}`, display: "inline-block" }} />جولة نموذجية</span>
        </span>
        <span style={{ color: C.dim }}>معاينة توضيحية من محاكي العرض ({data.bins.length} حاوية · {data.neighborhoods} حيًا) — حدود الأحياء من OpenStreetMap</span>
      </figcaption>
    </figure>
  );
};

const LANDING_FEATURES = [
  [<RadarIcon size={20} color={C.brand} strokeWidth={1.8} />, "التنبؤ الاستباقي", "يقدّر متى تبلغ كل حاوية المستوى الحرج من قراءات المستشعرات، مع درجة الثقة."],
  [<Waypoints size={20} color={C.brand} strokeWidth={1.8} />, "تخطيط الجولات الذكية", "يجمع الحاويات التي تحتاج خدمة في جولات مرتبة تقلل المسافة وزمن التشغيل."],
  [<UserCheck size={20} color={C.brand} strokeWidth={1.8} />, "الإسناد التلقائي للسائقين", "يسند الجولات الاعتيادية للسائق المؤهل حسب المناوبة والنطاق والمركبة وزمن الوصول."],
  [<ArrowLeftRight size={20} color={C.brand} strokeWidth={1.8} />, "توزيع الموارد بين البلديات", "يقارن الضغط التشغيلي بين البلديات ويقترح نقل الموارد، والاعتماد للأمانة."],
  [<FlaskConical size={20} color={C.brand} strokeWidth={1.8} />, "محاكاة القرارات", "يختبر أثر القرار على نسخة معزولة من البيانات قبل تنفيذه."],
  [<ChartColumn size={20} color={C.brand} strokeWidth={1.8} />, "قياس الكفاءة التشغيلية", "يقيس المسافات والأزمنة والحاويات المخدومة مقارنة بخط أساس معلن."],
];
const LANDING_ENGINE = [
  ["ماذا سيحدث؟", "التنبؤ بالمخاطر والاحتياجات التشغيلية", "الحاويات التي ستمتلئ قريبًا، والأحياء والبلديات المرشحة لضغط تشغيلي."],
  ["ما أفضل إجراء؟", "تخطيط الجولات وتوزيع الموارد تلقائيًا", "جولات مسندة للسائقين، واستثناءات واضحة لموظف العمليات، وتوصيات نقل موارد."],
  ["ما أثر القرار؟", "محاكاة النتائج ومقارنة البدائل", "مقارنة كل بديل بالوضع الحالي قبل التنفيذ، ثم قياس النتيجة الفعلية بعده."],
];
const LANDING_PORTALS = [
  [<Landmark size={22} color={C.brand} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 2 }} />, "متخذو القرار بالأمانة", "متابعة البلديات ومقارنة الضغط التشغيلي واعتماد نقل الموارد."],
  [<Building2 size={22} color={C.brand} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 2 }} />, "متخذو القرار بالبلدية", "متابعة أداء البلدية وطلب الدعم واختبار القرارات قبل تنفيذها."],
  [<Users size={22} color={C.brand} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 2 }} />, "موظفو العمليات", "متابعة الجولات والإسناد التلقائي ومعالجة الحالات الاستثنائية."],
  [<HardHat size={22} color={C.brand} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 2 }} />, "الأفراد الميدانيون", "استلام الجولات والملاحة وتأكيد التفريغ والإبلاغ عن المشكلات."],
];

const LandingPage = ({ onEnter }) => {
  const [isNarrow, setIsNarrow] = useState(window.innerWidth < 860);
  useEffect(() => { const fn = () => setIsNarrow(window.innerWidth < 860); window.addEventListener("resize", fn); return () => window.removeEventListener("resize", fn); }, []);
  const BODY = "'IBM Plex Sans Arabic', " + ARABIC_FONT;
  const wrap = { maxWidth: 1160, margin: "0 auto", padding: isNarrow ? "0 16px" : "0 32px" };
  const sec = (bg) => ({ background: bg, padding: isNarrow ? "40px 0" : "72px 0" });
  const eyebrow = { fontSize: 12.5, fontWeight: 700, color: C.brandSoft, letterSpacing: 0.2, marginBottom: 8 };
  const h2 = { fontFamily: ARABIC_FONT, fontSize: isNarrow ? 22 : 28, fontWeight: 800, color: C.brand, margin: "0 0 10px", lineHeight: 1.4 };
  const lead = { fontSize: isNarrow ? 14.5 : 15.5, color: C.muted, lineHeight: 1.9, margin: 0, maxWidth: 680 };
  const primary = { display: "inline-flex", alignItems: "center", gap: 8, padding: "13px 24px", borderRadius: 10, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: BODY, textDecoration: "none" };
  const secondary = { ...primary, background: "#fff", color: C.brand, border: `1px solid ${C.brand}55` };
  return (
    <div dir="rtl" lang="ar" style={{ fontFamily: BODY, background: "#ffffff", color: C.text, minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Noto+Kufi+Arabic:wght@600;700;800&display=swap" rel="stylesheet" />
      <div style={{ background: C.brand, color: C.brandText, fontSize: 12 }}>
        <div style={{ ...wrap, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: isNarrow ? "6px 16px" : "7px 32px" }}>
          <span>مشروع مستقل لإدارة عمليات النفايات البلدية — ليس منصة حكومية رسمية</span>
          {!isNarrow && <span>نطاق العرض: {BRAND.city} · بيانات المستشعرات في بيئة العرض محاكاة</span>}
        </div>
      </div>
      <header style={{ background: "#ffffff", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 68 }}>
          <a href="#top" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <AppLogo size={40} />
            <span><span style={{ display: "block", fontFamily: ARABIC_FONT, fontSize: isNarrow ? 13.5 : 16, fontWeight: 800, color: C.brand }}>{BRAND.ar}</span><span style={{ display: "block", fontSize: 11.5, color: C.muted }}>{BRAND.en}</span></span>
          </a>
          {!isNarrow && <nav aria-label="أقسام الصفحة" style={{ display: "flex", gap: 24, fontSize: 14 }}>{[["#how", "آلية العمل"], ["#features", "المزايا"], ["#portals", "البوابات"]].map(([h, l]) => <a key={h} href={h} style={{ color: C.text, textDecoration: "none", fontWeight: 500 }}>{l}</a>)}</nav>}
          <button onClick={onEnter} style={{ ...primary, padding: isNarrow ? "9px 14px" : "10px 18px", fontSize: 13.5 }}><LogIn size={16} />الدخول</button>
        </div>
      </header>

      <main id="top">
        {/* Hero */}
        <section style={{ ...sec("linear-gradient(180deg, #f3f8f5 0%, #ffffff 100%)"), paddingTop: isNarrow ? 32 : 64 }}>
          <div style={{ ...wrap, display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1.05fr 1fr", gap: isNarrow ? 28 : 48, alignItems: "center" }}>
            <div>
              <div style={eyebrow}>{BRAND.engine}</div>
              <h1 style={{ fontFamily: ARABIC_FONT, fontSize: isNarrow ? 28 : 40, fontWeight: 800, color: C.brand, lineHeight: 1.45, margin: "0 0 18px" }}>إدارة ذكية للنفايات... وقرارات أكثر كفاءة</h1>
              <p style={{ ...lead, color: "#3a4a42", fontSize: isNarrow ? 15 : 16.5, lineHeight: 2 }}>
                منصة ذكية لإدارة النفايات البلدية، تجمع بين <b style={{ color: C.brand }}>التنبؤ الاستباقي بامتلاء الحاويات</b>، و<b style={{ color: C.brand }}>التحسين الآلي لجولات الجمع</b>، و<b style={{ color: C.brand }}>التوزيع الذكي للموارد بين البلديات</b>، مع <b style={{ color: C.brand }}>محاكاة أثر القرارات قبل تنفيذها</b> وقياس نتائجها الفعلية.
              </p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 26 }}>
                <button onClick={onEnter} style={primary}>الدخول إلى المنصة <ArrowLeft size={17} /></button>
                <a href="#how" style={secondary}>استكشف آلية العمل</a>
              </div>
            </div>
            <BuraidahPreview />
          </div>
        </section>

        {/* How it works = the city's operational brain */}
        <section id="how" style={sec("#ffffff")}>
          <div style={wrap}>
            <div style={eyebrow}>آلية العمل</div>
            <h2 style={h2}>{BRAND.engine}: ثلاثة أسئلة قبل كل قرار</h2>
            <p style={lead}>تصل قراءات المستشعرات وبلاغات الميدان باستمرار، ويجيب المحرك عن ثلاثة أسئلة بالترتيب، ولكل إجابة أثر في التشغيل.</p>
            <ol style={{ listStyle: "none", padding: 0, margin: "32px 0 0", display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "repeat(3, 1fr)", gap: isNarrow ? 20 : 0 }}>
              {LANDING_ENGINE.map(([q, a, out], i) => (
                <li key={q} style={{ position: "relative", padding: isNarrow ? "0 0 0 0" : i === 0 ? "0 0 0 28px" : i === 2 ? "0 28px 0 0" : "0 28px", borderInlineStart: !isNarrow && i > 0 ? `1px solid ${C.border}` : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <span style={{ width: 32, height: 32, borderRadius: "50%", background: C.brand, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontFamily: ARABIC_FONT, fontSize: 19, fontWeight: 800, color: C.brand }}>{q}</span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 6 }}>{a}</div>
                  <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.85 }}>{out}</div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features — one list, no card grid */}
        <section id="features" style={sec("#f6faf7")}>
          <div style={wrap}>
            <div style={eyebrow}>المزايا</div>
            <h2 style={h2}>ما تقدمه المنصة</h2>
            <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "repeat(3, 1fr)", columnGap: 40, rowGap: 28, marginTop: 28 }}>
              {LANDING_FEATURES.map(([icon, t, d]) => (
                <div key={t} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <span style={{ width: 40, height: 40, borderRadius: 10, background: "#ffffff", border: `1px solid ${C.border}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</span>
                  <div><div style={{ fontSize: 15.5, fontWeight: 700, color: C.text, marginBottom: 4 }}>{t}</div><div style={{ fontSize: 14, color: C.muted, lineHeight: 1.85 }}>{d}</div></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Portals */}
        <section id="portals" style={sec("#ffffff")}>
          <div style={wrap}>
            <div style={eyebrow}>البوابات</div>
            <h2 style={h2}>بوابة لكل دور</h2>
            <p style={lead}>يرى كل مستخدم ما يحتاجه لدوره فقط، من القرار في الأمانة إلى التنفيذ في الميدان.</p>
            <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "repeat(2, 1fr)", marginTop: 24, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
              {LANDING_PORTALS.map(([icon, t, d], i) => (
                <div key={t} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: isNarrow ? 18 : 24, borderTop: (isNarrow ? i > 0 : i > 1) ? `1px solid ${C.border}` : "none", borderInlineStart: !isNarrow && i % 2 === 1 ? `1px solid ${C.border}` : "none" }}>
                  {icon}
                  <div><div style={{ fontSize: 15.5, fontWeight: 700, color: C.text, marginBottom: 4 }}>{t}</div><div style={{ fontSize: 14, color: C.muted, lineHeight: 1.85 }}>{d}</div></div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 36 }}><button onClick={onEnter} style={primary}>الدخول إلى المنصة <ArrowLeft size={17} /></button></div>
          </div>
        </section>
      </main>

      <footer style={{ background: C.brand, color: C.brandText, fontSize: 12.5 }}>
        <div style={{ ...wrap, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: isNarrow ? "20px 16px" : "22px 32px", lineHeight: 1.8 }}>
          <span>{BRAND.ar} — هوية مستقلة للمشروع، ولا تمثل جهة حكومية.</span>
          <span>حدود الأحياء من OpenStreetMap · التقسيم البلدي من مصادر منشورة · بيانات المستشعرات في بيئة العرض محاكاة.</span>
        </div>
      </footer>
    </div>
  );
};

function AppRouter() {
  const [showAuth, setShowAuth] = useState(false);
  const { isAuthenticated, userData, userRole, loading } = useAuth();
  const [showAdmin, setShowAdmin] = useState(false);

  if (loading) return <LoadingScreen />;
  if (!isAuthenticated) {
    if (!showAuth) return <LandingPage onEnter={() => setShowAuth(true)} />;
    return (
      <div style={{ position: "relative" }}>
        <button onClick={() => setShowAuth(false)} style={{ position: "fixed", top: 12, right: 16, zIndex: 30, background: C.card, border: `1px solid ${C.border}`, color: C.brand, borderRadius: 10, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: ARABIC_FONT }}>← الصفحة الرئيسية</button>
        <AuthPage />
      </div>
    );
  }

  // حساب بانتظار الموافقة
  if (userData?.status === "pending") return <PendingApprovalScreen />;

  // حساب مرفوض أو معطّل
  if (userData?.status === "suspended" || userData?.status === "rejected") {
    const SuspendedScreen = () => {
      const { logout: doLogout } = useAuth();
      return (
        <div dir="rtl" style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Noto Kufi Arabic',sans-serif" }}>
          <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
          <div style={{ width:"100%", maxWidth:400, padding:"clamp(20px,5vw,40px)", background:C.card, borderRadius:24, textAlign:"center", border:"1px solid #ef444430" }}>
            <div style={{ fontSize:48, marginBottom:16 }}>⛔</div>
            <h2 style={{ fontSize:20, fontWeight:900, color:C.danger, margin:"0 0 10px" }}>الحساب {userData?.status === "rejected" ? "مرفوض" : "معطّل"}</h2>
            <p style={{ fontSize:13, color:C.muted, lineHeight:1.7 }}>تواصل مع إدارة النظام لمزيد من المعلومات</p>
            <button onClick={doLogout} style={{ marginTop:20, padding:"10px 24px", borderRadius:10, border:"1px solid #ef444440", background:"#ef444415", color:C.danger, cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:"'Noto Kufi Arabic',sans-serif" }}>تسجيل خروج</button>
          </div>
        </div>
      );
    };
    return <SuspendedScreen />;
  }

  // صفحة الأدمن (فقط للإدارة العليا)
  if (showAdmin && userRole === "executive") return <AdminPanel onBack={() => setShowAdmin(false)} />;

  // حقن زر الأدمن في window عشان SmartWasteManagement يقدر يستخدمه
  window.__showAdminPanel = () => setShowAdmin(true);

  return <SmartWasteManagement />;
}

// ══════════════════════════════════════════════════════════════════════
// Error Boundary — يمنع الشاشة البيضاء عند أي خطأ غير متوقع
// ══════════════════════════════════════════════════════════════════════
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div dir="rtl" style={{
          minHeight: "100vh", background: C.bg, display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "center",
          fontFamily: "'Noto Kufi Arabic', sans-serif", color: C.text, padding: 24, textAlign: "center",
        }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.danger, marginBottom: 8 }}>
            حدث خطأ غير متوقع
          </div>
          <div style={{ fontSize: 14, color: C.muted, marginBottom: 28, maxWidth: 400 }}>
            {this.state.error?.message || "خطأ غير معروف"}
          </div>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              padding: "12px 28px", borderRadius: 12, border: "none",
              background: "linear-gradient(135deg,#10b981,#059669)",
              color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer",
              fontFamily: "'Noto Kufi Arabic', sans-serif",
            }}
          >
            🔄 إعادة تحميل التطبيق
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </ErrorBoundary>
  );
}
