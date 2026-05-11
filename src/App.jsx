// ============================================================
// نظام إدارة شفط النفايات الذكي - بريدة
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

import React, { useState, useEffect, useMemo, useRef, createContext, useContext } from "react";

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
} from "lucide-react";

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
  addDoc,
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
  COLLECTIONS,
} from "./firestoreService";
import { seedAllCollections } from "./seedFirestore";
import { exportAllDataToExcel } from "./exportAllDataToExcel";
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

  const register = async ({ email, password, fullName, phone, district, role }) => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: fullName });
      // المواطن يدخل مباشرة، الموظف والإدارة العليا ينتظرون الموافقة
      const needsApproval = role === "employee" || role === "executive";
      const userDocData = {
        uid: cred.user.uid, email, fullName, phone: phone || "", district: district || "",
        role: role || "citizen",
        roleAr: role === "executive" ? "إدارة عليا" : role === "employee" ? "موظف" : "مواطن",
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
  { value: "citizen",   label: "مواطن",      icon: <Home size={22} />,       desc: "طلب حاويات ومتابعة الخدمات", color: "#10b981" },
  { value: "employee",  label: "موظف",       icon: <HardHat size={22} />,    desc: "إدارة المحطات والعمليات",    color: "#3b82f6" },
  { value: "executive", label: "إدارة عليا", icon: <Landmark size={22} />,   desc: "لوحة متخذي القرار",          color: "#f59e0b" },
];

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
    const r = await register({ email, password, fullName, phone, district, role });
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
  const govGreen = "#10b981";
  const govDark  = "#071628";
  const govCard  = "#0c1f35";
  const govBorder = "#1e3a5f";

  const fieldWrap = { position:"relative", display:"flex", flexDirection:"column", gap:6 };
  const labelSt   = { fontSize:12, color:"#94a3b8", fontWeight:600 };
  const iconWrap   = { position:"absolute", left:14, bottom:13, color:"#64748b", display:"flex", alignItems:"center" };

  return (
    <div dir="rtl" style={{ minHeight:"100vh", background:govDark, fontFamily:F, display:"flex", flexDirection:"column" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* ── شريط حكومي علوي ─────────────────────────────────────── */}
      <div style={{ background:"#051020", borderBottom:"2px solid #10b98130", padding:"8px 24px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:30, height:30, borderRadius:7, background:"linear-gradient(135deg,#10b981,#065f3a)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <ShieldCheck size={15} color="#fff" />
          </div>
          <span style={{ fontSize:12, fontWeight:800, color:"#f1f5f9" }}>المملكة العربية السعودية</span>
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
                <h2 style={{ fontSize:26, fontWeight:900, color:"#f1f5f9", margin:"0 0 8px 0", lineHeight:1.3 }}>نظام إدارة النفايات الذكي</h2>
                <p style={{ fontSize:13, color:"#64748b", fontWeight:600, margin:0 }}>مدينة بريدة • منطقة القصيم</p>
              </div>

              {/* فاصل */}
              <div style={{ display:"flex", alignItems:"center", gap:10, margin:"24px 0" }}>
                <div style={{ flex:1, height:1, background:"linear-gradient(90deg,transparent,#1e3a5f)" }} />
                <div style={{ width:6, height:6, borderRadius:"50%", background:govGreen }} />
                <div style={{ flex:1, height:1, background:"linear-gradient(90deg,#1e3a5f,transparent)" }} />
              </div>

              {/* شرح التطبيق */}
              <p style={{ fontSize:13, color:"#94a3b8", lineHeight:1.9, marginBottom:24, textAlign:"right" }}>
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
                  <span style={{ fontSize:12, color:"#94a3b8", textAlign:"right" }}>{f.text}</span>
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
                <h2 style={{ fontSize:20, fontWeight:900, color:"#f1f5f9", margin:"6px 0 4px" }}>نظام إدارة النفايات الذكي</h2>
                <p style={{ fontSize:12, color:"#64748b", margin:0 }}>مدينة بريدة • منطقة القصيم</p>
              </div>
            </div>
          )}

          <div style={{ width:"100%", maxWidth: mode==="register" ? 420 : 380 }}>

            {/* عنوان الكارد */}
            {mode !== "forgot" && (
              <div style={{ marginBottom:24 }}>
                <h3 style={{ fontSize:18, fontWeight:800, color:"#f1f5f9", margin:"0 0 4px" }}>
                  {mode === "login" ? "تسجيل الدخول" : "إنشاء حساب جديد"}
                </h3>
                <p style={{ fontSize:12, color:"#64748b", margin:0 }}>
                  {mode === "login" ? "أدخل بياناتك للوصول إلى المنظومة" : "أنشئ حسابك للانضمام إلى المنظومة"}
                </p>
              </div>
            )}

            {/* تبويبات */}
            {mode !== "forgot" && (
              <div style={{ display:"flex", gap:0, marginBottom:24, background:"#051020", borderRadius:10, padding:4, border:`1px solid ${govBorder}` }}>
                {[{key:"login",label:"تسجيل دخول"},{key:"register",label:"إنشاء حساب"}].map(tab=>(
                  <button key={tab.key} onClick={()=>{setMode(tab.key);resetForm();}} style={{ flex:1, padding:"9px 0", borderRadius:8, border:"none", background:mode===tab.key?govGreen:"transparent", color:mode===tab.key?"#000":"#64748b", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:F, transition:"all 0.25s" }}>{tab.label}</button>
                ))}
              </div>
            )}

            {/* استعادة كلمة المرور - رأس */}
            {mode === "forgot" && (
              <div style={{ textAlign:"center", marginBottom:24 }}>
                <div style={{ width:56, height:56, borderRadius:14, background:"linear-gradient(135deg,#10b981,#059669)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}><KeyRound size={26} color="#fff" /></div>
                <div style={{ fontSize:17, fontWeight:800, color:"#f1f5f9", marginBottom:6 }}>استعادة كلمة المرور</div>
                <div style={{ fontSize:12, color:"#64748b" }}>أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين</div>
              </div>
            )}

            {/* رسائل */}
            {error && (
              <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, color:"#ef4444", background:"#ef444412", padding:"10px 14px", borderRadius:10, marginBottom:16, border:"1px solid #ef444430" }}>
                <ShieldAlert size={14} color="#ef4444" style={{ flexShrink:0 }} />
                {error}
              </div>
            )}
            {success && (
              <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, color:"#10b981", background:"#10b98112", padding:"10px 14px", borderRadius:10, marginBottom:16, border:"1px solid #10b98130" }}>
                <CheckCircle size={14} color="#10b981" style={{ flexShrink:0 }} />
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
                  <button onClick={()=>setShowPass(v=>!v)} style={{ position:"absolute", left:40, bottom:13, background:"none", border:"none", color:"#64748b", cursor:"pointer", padding:0, display:"flex" }}>{showPass?<EyeOff size={15}/>:<Eye size={15}/>}</button>
                </div>
                <div style={{ textAlign:"left" }}>
                  <button onClick={()=>{setMode("forgot");resetForm();}} style={{ background:"none", border:"none", color:govGreen, fontSize:12, cursor:"pointer", fontFamily:F, padding:0, display:"inline-flex", alignItems:"center", gap:4 }}>
                    <KeyRound size={11} /> نسيت كلمة المرور؟
                  </button>
                </div>
                <button onClick={handleLogin} disabled={loading} style={{ padding:"13px 0", borderRadius:10, border:"none", background:loading?"#1e3a5f":"linear-gradient(135deg,#10b981,#059669)", color:loading?"#64748b":"#fff", fontSize:14, fontWeight:800, cursor:loading?"not-allowed":"pointer", fontFamily:F, display:"flex", alignItems:"center", justifyContent:"center", gap:8, transition:"all 0.2s" }}>
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
                <button onClick={handleResetPassword} disabled={loading} style={{ padding:"13px 0", borderRadius:10, border:"none", background:loading?"#1e3a5f":"linear-gradient(135deg,#10b981,#059669)", color:loading?"#64748b":"#fff", fontSize:14, fontWeight:800, cursor:loading?"not-allowed":"pointer", fontFamily:F, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  {loading ? <><Clock size={15}/> جاري الإرسال...</> : <><Mail size={15}/> إرسال رابط الاستعادة</>}
                </button>
                <button onClick={()=>{setMode("login");resetForm();}} style={{ padding:"10px 0", borderRadius:10, border:`1px solid ${govBorder}`, background:"transparent", color:"#94a3b8", fontSize:13, cursor:"pointer", fontFamily:F, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
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
                        <div style={{ display:"flex", justifyContent:"center", marginBottom:6, color:role===r.value?r.color:"#64748b" }}>{r.icon}</div>
                        <div style={{ fontSize:11, fontWeight:700, color:role===r.value?r.color:"#94a3b8", fontFamily:F }}>{r.label}</div>
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
                    <button onClick={()=>setShowPass(v=>!v)} style={{ position:"absolute", left:40, bottom:13, background:"none", border:"none", color:"#64748b", cursor:"pointer", padding:0, display:"flex" }}>{showPass?<EyeOff size={15}/>:<Eye size={15}/>}</button>
                  </div>
                  <div style={fieldWrap}>
                    <label style={labelSt}>تأكيد كلمة المرور *</label>
                    <input type={showConfirmPass?"text":"password"} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="أعد كتابة كلمة المرور" style={{ ...inputStyle, paddingLeft:40 }} />
                    <span style={iconWrap}><KeyRound size={15} /></span>
                    <button onClick={()=>setShowConfirmPass(v=>!v)} style={{ position:"absolute", left:40, bottom:13, background:"none", border:"none", color:"#64748b", cursor:"pointer", padding:0, display:"flex" }}>{showConfirmPass?<EyeOff size={15}/>:<Eye size={15}/>}</button>
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
                </div>
                <button onClick={handleRegister} disabled={loading} style={{ padding:"13px 0", borderRadius:10, border:"none", background:loading?"#1e3a5f":"linear-gradient(135deg,#10b981,#059669)", color:loading?"#64748b":"#fff", fontSize:14, fontWeight:800, cursor:loading?"not-allowed":"pointer", fontFamily:F, marginTop:4, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
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
  const inputSt = { width:"100%", padding:"12px 16px", borderRadius:12, border:"1px solid #1e293b", background:"#0a0e1a", color:"#f1f5f9", fontSize:14, fontFamily:F, outline:"none", boxSizing:"border-box" };

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

  const roleMap = { executive: { label: "إدارة عليا", color: "#f59e0b", icon: "🏛️" }, employee: { label: "موظف", color: "#3b82f6", icon: "👷" }, citizen: { label: "مواطن", color: "#10b981", icon: "🏠" } };
  const r = roleMap[userData?.role] || roleMap.citizen;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, direction:"rtl", fontFamily:F }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:500, maxHeight:"90vh", overflow:"auto", padding:"0", background:"#111827", borderRadius:20, border:"1px solid #1e293b" }}>
        {/* Header */}
        <div style={{ padding:"24px 28px 0", textAlign:"center" }}>
          <div style={{ width:60, height:60, borderRadius:16, background:`${r.color}15`, border:`2px solid ${r.color}30`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, margin:"0 auto 12px" }}>{r.icon}</div>
          <h3 style={{ fontSize:18, fontWeight:900, color:"#f1f5f9", margin:"0 0 4px" }}>إعدادات الحساب</h3>
          <p style={{ fontSize:12, color:"#64748b", margin:0 }}>{userData?.email}</p>
          <span style={{ display:"inline-block", marginTop:8, padding:"3px 12px", borderRadius:20, fontSize:11, fontWeight:600, background:`${r.color}20`, color:r.color }}>{r.label}</span>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:0, margin:"20px 28px 0", background:"#0a0e1a", borderRadius:12, padding:4 }}>
          {[{ key:"profile", label:"👤 البيانات الشخصية" }, { key:"password", label:"🔐 كلمة المرور" }].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              flex:1, padding:"10px 0", borderRadius:10, border:"none",
              background: activeTab === tab.key ? "#10b981" : "transparent",
              color: activeTab === tab.key ? "#000" : "#94a3b8",
              fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:F, transition:"all 0.3s",
            }}>{tab.label}</button>
          ))}
        </div>

        <div style={{ padding:"20px 28px 28px" }}>
          {/* ===== PROFILE TAB ===== */}
          {activeTab === "profile" && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              {profileMsg && <div style={{ fontSize:12, color:"#10b981", background:"#10b98115", padding:"10px 14px", borderRadius:10, textAlign:"center", border:"1px solid #10b98130" }}>{profileMsg}</div>}
              {profileError && <div style={{ fontSize:12, color:"#ef4444", background:"#ef444415", padding:"10px 14px", borderRadius:10, textAlign:"center", border:"1px solid #ef444430" }}>⚠️ {profileError}</div>}

              <div>
                <label style={{ fontSize:12, color:"#94a3b8", marginBottom:6, display:"block" }}>الاسم الكامل *</label>
                <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="الاسم الثلاثي" style={inputSt} />
              </div>

              <div>
                <label style={{ fontSize:12, color:"#94a3b8", marginBottom:6, display:"block" }}>البريد الإلكتروني</label>
                <input type="email" value={userData?.email || ""} disabled style={{ ...inputSt, opacity:0.5, cursor:"not-allowed" }} />
                <span style={{ fontSize:10, color:"#64748b", marginTop:4, display:"block" }}>لا يمكن تغيير البريد الإلكتروني</span>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:12 }}>
                <div>
                  <label style={{ fontSize:12, color:"#94a3b8", marginBottom:6, display:"block" }}>رقم الجوال</label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="05XXXXXXXX" style={{ ...inputSt, direction:"ltr", textAlign:"right" }} />
                </div>
                <div>
                  <label style={{ fontSize:12, color:"#94a3b8", marginBottom:6, display:"block" }}>الحي</label>
                  <select value={district} onChange={e => setDistrict(e.target.value)} style={{ ...inputSt, appearance:"auto" }}>
                    <option value="">اختر الحي</option>
                    {DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:12 }}>
                <div style={{ background:"#0a0e1a", borderRadius:10, padding:12 }}>
                  <div style={{ fontSize:10, color:"#64748b" }}>نوع الحساب</div>
                  <div style={{ fontSize:14, fontWeight:700, color:r.color, marginTop:4 }}>{r.icon} {r.label}</div>
                </div>
                <div style={{ background:"#0a0e1a", borderRadius:10, padding:12 }}>
                  <div style={{ fontSize:10, color:"#64748b" }}>تاريخ التسجيل</div>
                  <div style={{ fontSize:13, fontWeight:600, color:"#f1f5f9", marginTop:4 }}>{userData?.createdAt?.split("T")[0] || "-"}</div>
                </div>
              </div>

              <div style={{ display:"flex", gap:10, marginTop:4 }}>
                <button onClick={handleProfileSave} disabled={profileLoading} style={{ flex:1, padding:12, borderRadius:10, border:"none", background:profileLoading?"#64748b":"linear-gradient(135deg,#10b981,#059669)", color:"#fff", fontSize:14, fontWeight:700, cursor:profileLoading?"not-allowed":"pointer", fontFamily:F }}>{profileLoading ? "جاري الحفظ..." : "💾 حفظ التغييرات"}</button>
                <button onClick={onClose} style={{ padding:"12px 20px", borderRadius:10, border:"1px solid #1e293b", background:"transparent", color:"#94a3b8", cursor:"pointer", fontSize:13, fontFamily:F }}>إغلاق</button>
              </div>
            </div>
          )}

          {/* ===== PASSWORD TAB ===== */}
          {activeTab === "password" && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              {passMsg && <div style={{ fontSize:12, color:"#10b981", background:"#10b98115", padding:"10px 14px", borderRadius:10, textAlign:"center", border:"1px solid #10b98130" }}>{passMsg}</div>}
              {passError && <div style={{ fontSize:12, color:"#ef4444", background:"#ef444415", padding:"10px 14px", borderRadius:10, textAlign:"center", border:"1px solid #ef444430" }}>⚠️ {passError}</div>}

              <div>
                <label style={{ fontSize:12, color:"#94a3b8", marginBottom:6, display:"block" }}>كلمة المرور الحالية</label>
                <input type="password" value={currentPass} onChange={e => setCurrentPass(e.target.value)} placeholder="أدخل كلمة المرور الحالية" style={inputSt} />
              </div>
              <div>
                <label style={{ fontSize:12, color:"#94a3b8", marginBottom:6, display:"block" }}>كلمة المرور الجديدة</label>
                <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="6 أحرف على الأقل" style={inputSt} />
              </div>
              <div>
                <label style={{ fontSize:12, color:"#94a3b8", marginBottom:6, display:"block" }}>تأكيد كلمة المرور الجديدة</label>
                <input type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="أعد كتابة كلمة المرور الجديدة" style={inputSt} onKeyDown={e => e.key === "Enter" && handlePassChange()} />
              </div>

              <div style={{ background:"#0a0e1a", borderRadius:10, padding:12, fontSize:11, color:"#64748b", lineHeight:1.8 }}>
                💡 <strong style={{ color:"#94a3b8" }}>شروط كلمة المرور:</strong><br/>
                • يجب أن تكون 6 أحرف على الأقل<br/>
                • يجب أن تكون مختلفة عن الحالية
              </div>

              <div style={{ display:"flex", gap:10, marginTop:4 }}>
                <button onClick={handlePassChange} disabled={passLoading} style={{ flex:1, padding:12, borderRadius:10, border:"none", background:passLoading?"#64748b":"linear-gradient(135deg,#f59e0b,#d97706)", color:"#000", fontSize:14, fontWeight:700, cursor:passLoading?"not-allowed":"pointer", fontFamily:F }}>{passLoading ? "جاري التغيير..." : "🔐 تغيير كلمة المرور"}</button>
                <button onClick={onClose} style={{ padding:"12px 20px", borderRadius:10, border:"1px solid #1e293b", background:"transparent", color:"#94a3b8", cursor:"pointer", fontSize:13, fontFamily:F }}>إغلاق</button>
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
  <div dir="rtl" style={{ minHeight:"100vh", background:"#0a0e1a", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:"'Noto Kufi Arabic',sans-serif", gap:20 }}>
    <style>{"@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}"}</style>
    <div style={{fontSize:48,animation:"spin 2s linear infinite"}}>♻️</div>
    <div style={{fontSize:16,fontWeight:700,color:"#f1f5f9",animation:"pulse 1.5s ease infinite"}}>جاري التحميل...</div>
    <div style={{fontSize:12,color:"#64748b"}}>نظام إدارة النفايات الذكي - بريدة</div>
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

const generateHourlyData = () =>
  Array.from({ length: 24 }, (_, i) => ({
    hour: `${String(i).padStart(2, "0")}:00`,
    الشفط: Math.round(Math.sin((i - 6) * 0.3) * 40 + 50 + Math.random() * 20),
    الضغط: +(1 + Math.sin((i - 8) * 0.25) * 2 + Math.random() * 0.5).toFixed(1),
  }));

const generateAlerts = (stations = []) => {
  const alerts = [];
  stations.forEach((s) => {
    const status = getStatus(s.fillLevel);
    if (status === "حرج") {
      alerts.push({ id: `${s.id}_c`, type: "حرج", message: `${s.name} - مستوى الامتلاء وصل ${s.fillLevel}%`, time: "الآن", icon: <div style={{width:10,height:10,borderRadius:"50%",background:"#ef4444",flexShrink:0}} /> });
    } else if (status === "تحذير") {
      alerts.push({ id: `${s.id}_w`, type: "تحذير", message: `${s.name} - مستوى الامتلاء ${s.fillLevel}%`, time: "الآن", icon: <div style={{width:10,height:10,borderRadius:"50%",background:"#f59e0b",flexShrink:0}} /> });
    }
  });
  if (alerts.length === 0) {
    alerts.push({ id: "ok", type: "معلومة", message: "جميع المحطات تعمل بشكل طبيعي ✅", time: "الآن", icon: <div style={{width:10,height:10,borderRadius:"50%",background:"#10b981",flexShrink:0}} /> });
  }
  return alerts;
};

// --- Colors ---
const C = {
  bg: "#0a0e1a", card: "#111827", cardHover: "#1a2337", border: "#1e293b",
  accent: "#10b981", warning: "#f59e0b", danger: "#ef4444", info: "#3b82f6", purple: "#8b5cf6",
  text: "#f1f5f9", muted: "#94a3b8", dim: "#64748b",
  g1: "linear-gradient(135deg, #10b981, #059669)", g2: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
  g3: "linear-gradient(135deg, #f59e0b, #d97706)", g4: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
};
const WASTE_COLORS = { عضوية: "#10b981", بلاستيك: "#3b82f6", ورق: "#f59e0b", زجاج: "#8b5cf6", معادن: "#ef4444" };

// --- Custom Tooltip ---
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1e293b", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", fontFamily: ARABIC_FONT, direction: "rtl" }}>
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

const StatCard = ({ title, value, unit, icon, gradient, trend }) => (
  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 22px", position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: 0, right: 0, width: 80, height: 80, background: gradient, opacity: 0.1, borderRadius: "0 16px 0 80px" }} />
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: C.text }}>{value}{unit && <span style={{ fontSize: 14, color: C.muted }}> {unit}</span>}</div>
      </div>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: gradient, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{icon}</div>
    </div>
    {trend !== undefined && (
      <div style={{ fontSize: 12, color: trend > 0 ? C.accent : C.danger, marginTop: 8 }}>{trend > 0 ? "▲" : "▼"} {Math.abs(trend)}% عن الشهر الماضي</div>
    )}
  </div>
);

// ✅ دالة موحدة لحساب الحالة بناءً على نسبة الامتلاء فقط
const getStatus = (fillLevel) => {
  if (fillLevel >= 85) return "حرج";
  if (fillLevel >= 60) return "تحذير";
  return "طبيعي";
};

const StatusBadge = ({ status }) => {
  const m = { طبيعي: { bg: "#065f4620", c: "#10b981", b: "#10b98140" }, تحذير: { bg: "#92400e20", c: "#f59e0b", b: "#f59e0b40" }, حرج: { bg: "#7f1d1d20", c: "#ef4444", b: "#ef444440" } };
  const s = m[status] || m["طبيعي"];
  return <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: s.bg, color: s.c, border: `1px solid ${s.b}` }}>{status}</span>;
};

const Card = ({ children, title, icon, style: sx }) => (
  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 22, ...sx }}>
    {title && <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>{icon}{title}</div>}
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

// ======================== DASHBOARD ========================
const DashboardPage = ({ stations, weeklyData, monthlyTrend, alerts, hourlyData }) => {
  const criticalCount = stations.filter((s) => getStatus(s.fillLevel) === "حرج").length;
  const avgFill = stations.length ? Math.round(stations.reduce((a, s) => a + (s.fillLevel || 0), 0) / stations.length) : 0;
  const totalDaily = stations.reduce((a, s) => a + (s.dailyWaste || 0), 0);
  const avgEff = monthlyTrend.length ? Math.round(monthlyTrend.reduce((a, m) => a + m.الكفاءة, 0) / monthlyTrend.length) : 0;

  const fillDistribution = [
    { name: "0-30%", value: stations.filter(s => s.fillLevel <= 30).length, fill: C.accent },
    { name: "31-60%", value: stations.filter(s => s.fillLevel > 30 && s.fillLevel <= 60).length, fill: C.info },
    { name: "61-85%", value: stations.filter(s => s.fillLevel > 60 && s.fillLevel <= 85).length, fill: C.warning },
    { name: "86-100%", value: stations.filter(s => s.fillLevel > 85).length, fill: C.danger },
  ];

  // suctionRate / motorHealth: إذا غير موجودَين في Firestore نشتقهما من بيانات حقيقية
  const stationPerformance = stations.map(s => ({
    name: s.district.replace("حي ", ""),
    الامتلاء: s.fillLevel,
    الشفط:    s.suctionRate  ?? Math.max(60, 100 - Math.round(s.fillLevel * 0.35)),
    المحرك:   s.motorHealth  ?? Math.max(70, 95  - Math.round(((s.pressure || 2) - 1) * 5)),
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <StatCard title="إجمالي المحطات" value={stations.length} icon={<Factory size={22} color="#fff" />} gradient={C.g1} />
        <StatCard title="متوسط الامتلاء" value={avgFill} unit="%" icon={<BarChart2 size={22} color="#fff" />} gradient={C.g2} trend={-5.2} />
        <StatCard title="الكمية اليومية" value={totalDaily} unit="كجم" icon={<Recycle size={22} color="#fff" />} gradient={C.g3} trend={12.8} />
        <StatCard title="كفاءة التشغيل" value={avgEff} unit="%" icon={<Zap size={22} color="#fff" />} gradient={C.g4} trend={3.1} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <Card title="توزيع النفايات الأسبوعي (كجم)" icon={<BarChart2 size={16} color="#94a3b8" />}>
          <ChartBox height={280}><ResponsiveContainer>
            <BarChart data={weeklyData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="day" tick={{ fill: C.muted, fontSize: 11, fontFamily: ARABIC_FONT }} />
              <YAxis tick={{ fill: C.muted, fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11, color: C.muted }} />
              {Object.entries(WASTE_COLORS).map(([key, color]) => (
                <Bar key={key} dataKey={key} stackId="a" fill={color} radius={key === "معادن" ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer></ChartBox>
        </Card>

        <Card title="توزيع مستويات الامتلاء" icon={<Target size={16} color="#94a3b8" />}>
          <ChartBox height={220}><ResponsiveContainer>
            <PieChart>
              <Pie data={fillDistribution} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={4}
                label={({ name, value }) => `${name}: ${value}`}>
                {fillDistribution.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer></ChartBox>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
            {fillDistribution.map((d, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: C.muted }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: d.fill }} /> {d.name}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        <Card title="الاتجاه الشهري - الجمع والكفاءة" icon={<TrendingUp size={16} color="#94a3b8" />}>
          <ChartBox height={260}><ResponsiveContainer>
            <ComposedChart data={monthlyTrend} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
              <YAxis yAxisId="left" tick={{ fill: C.muted, fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="left" tick={{ fill: C.muted, fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="عمليات_الجمع" fill={C.accent} radius={[4, 4, 0, 0]} opacity={0.8} name="عمليات الجمع" />
              <Line yAxisId="right" type="monotone" dataKey="الكفاءة" stroke={C.info} strokeWidth={3} dot={{ r: 4, fill: C.info }} name="الكفاءة %" />
            </ComposedChart>
          </ResponsiveContainer></ChartBox>
        </Card>

        <Card title="نشاط الشفط على مدار الساعة" icon={<Clock size={16} color="#94a3b8" />}>
          <ChartBox height={260}><ResponsiveContainer>
            <AreaChart data={hourlyData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="gS" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C.accent} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={C.accent} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gP" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C.warning} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={C.warning} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="hour" tick={{ fill: C.muted, fontSize: 9 }} interval={2} />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
              <Area type="monotone" dataKey="الشفط" stroke={C.accent} fill="url(#gS)" strokeWidth={2} name="معدل الشفط" />
              <Area type="monotone" dataKey="الضغط" stroke={C.warning} fill="url(#gP)" strokeWidth={2} name="الضغط (بار)" />
            </AreaChart>
          </ResponsiveContainer></ChartBox>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        <Card title="أداء المحطات - بريدة" icon={<Target size={16} color="#94a3b8" />}>
          <ChartBox height={300}><ResponsiveContainer>
            <RadarChart cx="50%" cy="50%" outerRadius="70%" data={stationPerformance}>
              <PolarGrid stroke={C.border} />
              <PolarAngleAxis dataKey="name" tick={{ fill: C.muted, fontSize: 9, fontFamily: ARABIC_FONT }} />
              <PolarRadiusAxis tick={{ fill: C.dim, fontSize: 9 }} />
              <Radar name="الامتلاء" dataKey="الامتلاء" stroke={C.danger} fill={C.danger} fillOpacity={0.2} />
              <Radar name="الشفط" dataKey="الشفط" stroke={C.accent} fill={C.accent} fillOpacity={0.2} />
              <Radar name="المحرك" dataKey="المحرك" stroke={C.info} fill={C.info} fillOpacity={0.2} />
              <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
            </RadarChart>
          </ResponsiveContainer></ChartBox>
        </Card>

        <Card title="التنبيهات" icon={<Bell size={16} color="#94a3b8" />}>
          {criticalCount > 0 && (
            <span style={{ background: C.danger + "30", color: C.danger, fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 600, marginBottom: 12, display: "inline-block" }}>
              {criticalCount} حرج
            </span>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 280, overflowY: "auto" }}>
            {alerts.map((a) => (
              <div key={a.id} style={{ padding: "10px 12px", borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: C.text }}>{a.icon} {a.type}</span>
                  <span style={{ color: C.dim, fontSize: 10 }}>{a.time}</span>
                </div>
                <div style={{ color: C.muted, lineHeight: 1.5 }}>{a.message}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
        {[
          { label: "محطات طبيعية", count: stations.filter((s) => getStatus(s.fillLevel) === "طبيعي").length, color: C.accent, icon: <CheckCircle size={32} color={C.accent} /> },
          { label: "محطات تحت التحذير", count: stations.filter((s) => getStatus(s.fillLevel) === "تحذير").length, color: C.warning, icon: <AlertTriangle size={32} color={C.warning} /> },
          { label: "محطات حرجة", count: criticalCount, color: C.danger, icon: <AlertTriangle size={32} color={C.danger} /> },
        ].map((item, i) => (
          <div key={i} style={{ background: C.card, border: `1px solid ${item.color}30`, borderRadius: 16, padding: 20, textAlign: "center" }}>
            <div style={{ marginBottom: 6, display: "flex", justifyContent: "center" }}>{item.icon}</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: item.color }}>{item.count}</div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ======================== STATIONS ========================
const StationsPage = ({ stations, stationHistoryByDistrict = {} }) => {
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState("الكل");
  const [sort, setSort]   = useState("fillDesc"); // fillDesc | fillAsc | containers

  // ─── Add Station ───────────────────────────────────────────
  const [showAddStation, setShowAddStation] = useState(false);
  const emptyStation = { name: "", district: "", fillLevel: "", pressure: "", wasteType: "عضوية", dailyWaste: "" };
  const [stationForm, setStationForm] = useState(emptyStation);
  const [stationLoading, setStationLoading] = useState(false);
  const [stationError, setStationError] = useState("");

  // ─── Container Modal ───────────────────────────────────────
  const [showContainerModal, setShowContainerModal] = useState(false);
  const [editingContainer, setEditingContainer] = useState(null);
  const [containerForm, setContainerForm] = useState({ name: "", fillLevel: "" });
  const [containerLoading, setContainerLoading] = useState(false);
  const [containerError, setContainerError] = useState("");
  const [deletingContainerId, setDeletingContainerId] = useState(null);

  // Keep selected station live from onSnapshot feed
  const currentSelected = selectedId ? (stations.find(s => s.id === selectedId) || null) : null;

  const filtered = useMemo(() => {
    const base = filter === "الكل" ? [...stations] : stations.filter(s => getStatus(s.fillLevel) === filter);
    if (sort === "fillDesc")    return base.sort((a,b) => b.fillLevel - a.fillLevel);
    if (sort === "fillAsc")     return base.sort((a,b) => a.fillLevel - b.fillLevel);
    if (sort === "containers")  return base.sort((a,b) => (b.containers?.length||0) - (a.containers?.length||0));
    return base;
  }, [stations, filter, sort]);

  // سجل تاريخي ثابت يُستخدم كـ fallback إذا لم يكن الحي في analytics
  const defaultHistory = useMemo(() => [
    { day:"الأحد",    الامتلاء:40, الضغط:1.8, الكمية:120 },
    { day:"الإثنين",  الامتلاء:48, الضغط:2.0, الكمية:135 },
    { day:"الثلاثاء", الامتلاء:55, الضغط:2.2, الكمية:148 },
    { day:"الأربعاء", الامتلاء:62, الضغط:2.4, الكمية:160 },
    { day:"الخميس",   الامتلاء:70, الضغط:2.6, الكمية:175 },
    { day:"الجمعة",   الامتلاء:38, الضغط:1.6, الكمية:95  },
    { day:"السبت",    الامتلاء:44, الضغط:1.9, الكمية:115 },
  ], []);

  // السجل الأسبوعي الحقيقي من Firestore (أو الافتراضي)
  const stationHistory = (currentSelected && stationHistoryByDistrict[currentSelected.district])
    || defaultHistory;

  // ─── Handlers: Station ────────────────────────────────────
  const handleAddStation = async () => {
    const { name, district, fillLevel, pressure, wasteType, dailyWaste } = stationForm;
    const fl = Number(fillLevel);
    const pr = Number(pressure);
    const dw = Number(dailyWaste);
    if (!name.trim())    { setStationError("يرجى إدخال اسم المحطة"); return; }
    if (!district.trim()){ setStationError("يرجى إدخال اسم الحي"); return; }
    if (fillLevel === "" || isNaN(fl) || fl < 0 || fl > 100) { setStationError("مستوى الامتلاء يجب أن يكون بين 0 و 100"); return; }
    if (pressure === "" || isNaN(pr) || pr < 0 || pr > 20)   { setStationError("الضغط يجب أن يكون بين 0 و 20 بار"); return; }
    if (dailyWaste === "" || isNaN(dw) || dw <= 0)            { setStationError("الكمية اليومية يجب أن تكون أكبر من صفر"); return; }
    setStationLoading(true); setStationError("");
    try {
      await addDoc(collection(db, "stations"), {
        name: name.trim(),
        district: district.trim(),
        fillLevel: Number(fillLevel),
        pressure: Number(pressure),
        wasteType,
        dailyWaste: Number(dailyWaste),
        containers: [],
        createdAt: new Date().toISOString(),
      });
      setShowAddStation(false);
      setStationForm(emptyStation);
    } catch (e) {
      setStationError("حدث خطأ: " + e.message);
    } finally {
      setStationLoading(false);
    }
  };

  // ─── Handlers: Containers ─────────────────────────────────
  const handleSaveContainer = async () => {
    const fl = Number(containerForm.fillLevel);
    if (!containerForm.name.trim()) { setContainerError("يرجى إدخال اسم الحاوية"); return; }
    if (containerForm.fillLevel === "" || isNaN(fl) || fl < 0 || fl > 100) { setContainerError("مستوى الامتلاء يجب أن يكون بين 0 و 100"); return; }
    if (!currentSelected) return;
    setContainerError("");
    setContainerLoading(true);
    try {
      const containers = [...(currentSelected.containers || [])];
      if (editingContainer) {
        const idx = containers.findIndex(c => c.id === editingContainer.id);
        if (idx !== -1) containers[idx] = { ...containers[idx], name: containerForm.name, fillLevel: Number(containerForm.fillLevel) };
      } else {
        containers.push({ id: `C${Date.now()}`, name: containerForm.name, fillLevel: Number(containerForm.fillLevel) });
      }
      await updateDoc(doc(db, "stations", currentSelected.id), { containers });
      setShowContainerModal(false);
      setEditingContainer(null);
      setContainerForm({ name: "", fillLevel: "" });
      setContainerError("");
    } catch (e) {
      setContainerError("حدث خطأ: " + e.message);
    } finally {
      setContainerLoading(false);
    }
  };

  const handleDeleteContainer = async (containerId) => {
    if (!currentSelected) return;
    const containers = (currentSelected.containers || []).filter(c => c.id !== containerId);
    try {
      await updateDoc(doc(db, "stations", currentSelected.id), { containers });
    } catch (e) {
      console.error("خطأ في حذف الحاوية:", e);
    }
    setDeletingContainerId(null);
  };

  const openAddContainer = () => {
    setEditingContainer(null);
    setContainerForm({ name: "", fillLevel: "" });
    setContainerError("");
    setShowContainerModal(true);
  };

  const openEditContainer = (c) => {
    setEditingContainer(c);
    setContainerForm({ name: c.name, fillLevel: String(c.fillLevel) });
    setContainerError("");
    setShowContainerModal(true);
  };

  const F = ARABIC_FONT;
  const inp = { width: "100%", padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, fontFamily: F, outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ─── Toolbar ─────────────────────────────────────── */}
      {!currentSelected && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {/* Row 1: Filter + Add */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {[
                { key:"الكل",    color:C.accent },
                { key:"طبيعي",  color:C.accent },
                { key:"تحذير",  color:C.warning },
                { key:"حرج",    color:C.danger  },
              ].map(({key,color}) => (
                <button key={key} onClick={() => setFilter(key)} style={{
                  padding:"8px 18px", borderRadius:10,
                  border:`1px solid ${filter===key ? color : C.border}`,
                  background: filter===key ? color+"20" : "transparent",
                  color: filter===key ? color : C.muted,
                  cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:F,
                }}>{key}</button>
              ))}
            </div>
            <button onClick={() => { setShowAddStation(true); setStationError(""); setStationForm(emptyStation); }} style={{
              padding:"10px 20px", borderRadius:10, border:"none",
              background:"linear-gradient(135deg,#10b981,#059669)", color:"#000",
              fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:F,
            }}>➕ إضافة محطة</button>
          </div>

          {/* Row 2: Sort */}
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <span style={{ fontSize:12, color:C.dim, fontFamily:F }}>ترتيب:</span>
            {[
              { key:"fillDesc",   label:"⬇ الأعلى امتلاءً" },
              { key:"fillAsc",    label:"⬆ الأقل امتلاءً"  },
              { key:"containers", label:"📦 عدد الحاويات"   },
            ].map(({key,label}) => (
              <button key={key} onClick={() => setSort(key)} style={{
                padding:"6px 14px", borderRadius:8,
                border:`1px solid ${sort===key ? C.info : C.border}`,
                background: sort===key ? C.info+"20" : "transparent",
                color: sort===key ? C.info : C.muted,
                cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:F,
              }}>{label}</button>
            ))}
          </div>
        </div>
      )}

      {/* ─── Add Station Modal ───────────────────────────── */}
      {showAddStation && (
        <div style={{ position:"fixed", inset:0, background:"#000b", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={() => setShowAddStation(false)}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:20, padding:28, width:500, maxWidth:"95vw", direction:"rtl" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:18, fontWeight:800, color:C.text, marginBottom:20, fontFamily:F }}>🏭 إضافة محطة جديدة</div>
            {stationError && <div style={{ fontSize:12, color:C.danger, background:C.danger+"15", padding:"8px 12px", borderRadius:8, marginBottom:14, border:`1px solid ${C.danger}30` }}>⚠️ {stationError}</div>}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:12 }}>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={{ fontSize:11, color:C.muted, marginBottom:5, display:"block" }}>اسم المحطة *</label>
                <input value={stationForm.name} onChange={e => setStationForm(p=>({...p,name:e.target.value}))} placeholder="مثال: محطة حي الخليج" style={inp} />
              </div>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={{ fontSize:11, color:C.muted, marginBottom:5, display:"block" }}>الحي *</label>
                <input value={stationForm.district} onChange={e => setStationForm(p=>({...p,district:e.target.value}))} placeholder="اكتب اسم الحي" style={inp} />
              </div>
              <div>
                <label style={{ fontSize:11, color:C.muted, marginBottom:5, display:"block" }}>مستوى الامتلاء (%) *</label>
                <input type="number" min="0" max="100" value={stationForm.fillLevel} onChange={e => setStationForm(p=>({...p,fillLevel:e.target.value}))} placeholder="0–100" style={inp} />
              </div>
              <div>
                <label style={{ fontSize:11, color:C.muted, marginBottom:5, display:"block" }}>الضغط (بار) *</label>
                <input type="number" step="0.1" min="0" value={stationForm.pressure} onChange={e => setStationForm(p=>({...p,pressure:e.target.value}))} placeholder="مثال: 2.5" style={inp} />
              </div>
              <div>
                <label style={{ fontSize:11, color:C.muted, marginBottom:5, display:"block" }}>نوع النفايات *</label>
                <select value={stationForm.wasteType} onChange={e => setStationForm(p=>({...p,wasteType:e.target.value}))} style={{...inp,appearance:"auto"}}>
                  {["عضوية","بلاستيك","ورق","زجاج","معادن","مختلط"].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:11, color:C.muted, marginBottom:5, display:"block" }}>الكمية اليومية (كجم) *</label>
                <input type="number" min="0" value={stationForm.dailyWaste} onChange={e => setStationForm(p=>({...p,dailyWaste:e.target.value}))} placeholder="مثال: 150" style={inp} />
              </div>
            </div>
            <div style={{ display:"flex", gap:10, marginTop:20 }}>
              <button onClick={handleAddStation} disabled={stationLoading} style={{ flex:1, padding:12, borderRadius:10, border:"none", background:stationLoading?"#334155":"linear-gradient(135deg,#10b981,#059669)", color:"#000", fontWeight:700, cursor:stationLoading?"not-allowed":"pointer", fontFamily:F, fontSize:13 }}>
                {stationLoading ? "جاري الحفظ..." : "💾 حفظ المحطة"}
              </button>
              <button onClick={() => setShowAddStation(false)} style={{ padding:"12px 20px", borderRadius:10, border:`1px solid ${C.border}`, background:"transparent", color:C.muted, cursor:"pointer", fontFamily:F, fontSize:13 }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Container Add/Edit Modal ────────────────────── */}
      {showContainerModal && (
        <div style={{ position:"fixed", inset:0, background:"#000b", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={() => setShowContainerModal(false)}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:20, padding:28, width:380, maxWidth:"95vw", direction:"rtl" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:800, color:C.text, marginBottom:20, fontFamily:F }}>
              {editingContainer ? "✏️ تعديل الحاوية" : "➕ إضافة حاوية جديدة"}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <label style={{ fontSize:11, color:C.muted, marginBottom:5, display:"block" }}>اسم الحاوية *</label>
                <input value={containerForm.name} onChange={e => setContainerForm(p=>({...p,name:e.target.value}))} placeholder="مثال: حاوية منزل 5" style={inp} />
              </div>
              <div>
                <label style={{ fontSize:11, color:C.muted, marginBottom:5, display:"block" }}>مستوى الامتلاء (%) *</label>
                <input type="number" min="0" max="100" value={containerForm.fillLevel} onChange={e => setContainerForm(p=>({...p,fillLevel:e.target.value}))} placeholder="0–100" style={inp} />
              </div>
            </div>
            {containerError && (
              <div style={{ marginTop:10, padding:"8px 12px", borderRadius:8, background:C.danger+"20", border:`1px solid ${C.danger}40`, color:C.danger, fontSize:12, fontFamily:F }}>
                ⚠️ {containerError}
              </div>
            )}
            <div style={{ display:"flex", gap:10, marginTop:14 }}>
              <button onClick={handleSaveContainer} disabled={containerLoading} style={{ flex:1, padding:12, borderRadius:10, border:"none", background:containerLoading?"#334155":"linear-gradient(135deg,#10b981,#059669)", color:"#000", fontWeight:700, cursor:containerLoading?"not-allowed":"pointer", fontFamily:F, fontSize:13 }}>
                {containerLoading ? "جاري الحفظ..." : "💾 حفظ"}
              </button>
              <button onClick={() => { setShowContainerModal(false); setEditingContainer(null); setContainerError(""); }} style={{ padding:"12px 20px", borderRadius:10, border:`1px solid ${C.border}`, background:"transparent", color:C.muted, cursor:"pointer", fontFamily:F, fontSize:13 }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Station Detail View ─────────────────────────── */}
      {currentSelected ? (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <button onClick={() => { setSelectedId(null); setDeletingContainerId(null); }} style={{ alignSelf:"flex-start", padding:"6px 16px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.accent, cursor:"pointer", fontSize:13, fontFamily:F }}>
            ← العودة للقائمة
          </button>

          {/* Station Info */}
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div>
                <h2 style={{ fontSize:22, fontWeight:800, color:C.text, margin:0 }}>{currentSelected.name}</h2>
                <span style={{ fontSize:13, color:C.muted }}>{currentSelected.district} | بريدة</span>
              </div>
              <StatusBadge status={getStatus(currentSelected.fillLevel)} />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(160px,1fr))", gap:16, marginBottom:24 }}>
              <div style={{ background:C.bg, borderRadius:12, padding:16, textAlign:"center" }}>
                <div style={{ fontSize:12, color:C.muted, marginBottom:10 }}>مستوى الامتلاء</div>
                <div style={{ display:"flex", justifyContent:"center" }}>
                  <CircularGauge value={currentSelected.fillLevel} color={currentSelected.fillLevel>=85?C.danger:currentSelected.fillLevel>=60?C.warning:C.accent} size={90} />
                </div>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px,1fr))", gap:12 }}>
              {[
                { label:"نوع النفايات", val:currentSelected.wasteType, icon:"🗑️" },
                { label:"الضغط", val:`${currentSelected.pressure} بار`, icon:"🔧" },
                { label:"الكمية اليومية", val:`${currentSelected.dailyWaste||0} كجم`, icon:"📦" },
                { label:"الحي", val:currentSelected.district||"—", icon:"📍" },
              ].map((item,i) => (
                <div key={i} style={{ background:C.bg, borderRadius:10, padding:"12px 14px", display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:20 }}>{item.icon}</span>
                  <div>
                    <div style={{ fontSize:10, color:C.dim }}>{item.label}</div>
                    <div style={{ fontSize:13, color:C.text, fontWeight:600 }}>{item.val}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* ─── Containers Section ──────────────────────── */}
          {(() => {
            const ctrs      = currentSelected.containers || [];
            const cCrit     = ctrs.filter(c => getStatus(c.fillLevel) === "حرج");
            const cWarn     = ctrs.filter(c => getStatus(c.fillLevel) === "تحذير");
            const cNorm     = ctrs.filter(c => getStatus(c.fillLevel) === "طبيعي");
            // مرتبة: حرج → تحذير → طبيعي
            const sorted    = [...cCrit, ...cWarn, ...cNorm];
            const avgFill   = ctrs.length ? Math.round(ctrs.reduce((a,c)=>a+c.fillLevel,0)/ctrs.length) : 0;

            return (
              <Card title="حاويات المنازل" icon={<Package size={16} color="#94a3b8" />}>
                {/* ── مؤشرات الملخص ─────────────────────── */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:10, marginBottom:18 }}>
                  {[
                    { label:"إجمالي الحاويات", val:ctrs.length,   color:C.info,    icon:<Package size={20} color={C.info} /> },
                    { label:"حرج",             val:cCrit.length,  color:C.danger,  icon:<div style={{width:12,height:12,borderRadius:"50%",background:"#ef4444"}} /> },
                    { label:"تحذير",           val:cWarn.length,  color:C.warning, icon:<div style={{width:12,height:12,borderRadius:"50%",background:"#f59e0b"}} /> },
                    { label:"متوسط الامتلاء",  val:`${avgFill}%`, color:avgFill>=85?C.danger:avgFill>=60?C.warning:C.accent, icon:<BarChart2 size={20} color={avgFill>=85?C.danger:avgFill>=60?C.warning:C.accent} /> },
                  ].map((m,i) => (
                    <div key={i} style={{ background:C.bg, borderRadius:12, padding:"12px 14px", textAlign:"center", border:`1px solid ${m.color}25` }}>
                      <div style={{ marginBottom:4, display:"flex", justifyContent:"center", alignItems:"center" }}>{m.icon}</div>
                      <div style={{ fontSize:22, fontWeight:800, color:m.color }}>{m.val}</div>
                      <div style={{ fontSize:10, color:C.dim, marginTop:2 }}>{m.label}</div>
                    </div>
                  ))}
                </div>

                {/* ── تنبيه الخطر ─────────────────────────── */}
                {cCrit.length > 0 && (
                  <div style={{ background:C.danger+"12", border:`1px solid ${C.danger}40`, borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:12, color:C.danger, fontWeight:600, display:"flex", alignItems:"center", gap:8 }}>
                    ⚠️ {cCrit.length} حاوية بحالة حرج — تحتاج تفريغاً فورياً:&nbsp;
                    {cCrit.map(c=><span key={c.id} style={{ background:C.danger+"20", borderRadius:6, padding:"2px 7px", marginLeft:4 }}>{c.name}</span>)}
                  </div>
                )}

                {/* ── شريط الترتيب + زر الإضافة ─────────── */}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                  <div style={{ fontSize:11, color:C.dim, fontFamily:F }}>
                    مرتبة: حرج أولاً ← تحذير ← طبيعي
                  </div>
                  <button onClick={openAddContainer} style={{ padding:"8px 16px", borderRadius:8, border:"none", background:"linear-gradient(135deg,#10b981,#059669)", color:"#000", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:F }}>
                    ➕ إضافة حاوية
                  </button>
                </div>

                {ctrs.length === 0 ? (
                  <div style={{ textAlign:"center", padding:"40px 0", color:C.dim, fontSize:13 }}>
                    <div style={{ fontSize:36, marginBottom:10 }}>📭</div>
                    لا توجد حاويات — اضغط "إضافة حاوية" للبدء
                  </div>
                ) : (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(210px,1fr))", gap:12 }}>
                    {sorted.map((c, idx) => {
                      const st      = getStatus(c.fillLevel);
                      const stColor = st==="حرج" ? C.danger : st==="تحذير" ? C.warning : C.accent;

                      return (
                        <div key={c.id} style={{ background:C.bg, borderRadius:12, padding:14, border:`1px solid ${stColor}50`, position:"relative", overflow:"hidden" }}>
                          {/* شريط الامتلاء العلوي */}
                          <div style={{ position:"absolute", top:0, left:0, right:0, height:4, background:C.border }}>
                            <div style={{ width:`${c.fillLevel}%`, height:"100%", background:stColor, transition:"width 0.6s" }} />
                          </div>

                          {/* رقم الترتيب */}
                          <div style={{ position:"absolute", top:8, right:10, fontSize:9, color:C.dim }}>#{idx+1}</div>

                          {/* اسم + أزرار */}
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10, marginTop:6 }}>
                            <div style={{ fontSize:13, fontWeight:700, color:C.text, flex:1, marginLeft:6, lineHeight:1.3 }}>{c.name}</div>
                            <div style={{ display:"flex", gap:2, flexShrink:0 }}>
                              <button onClick={e=>{e.stopPropagation();openEditContainer(c);}} title="تعديل" style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, padding:"2px 4px", color:C.info }}>✏️</button>
                              {deletingContainerId === c.id ? (
                                <>
                                  <button onClick={e=>{e.stopPropagation();handleDeleteContainer(c.id);}} style={{ background:C.danger, border:"none", color:"#fff", fontSize:10, fontWeight:700, cursor:"pointer", borderRadius:5, padding:"2px 7px", fontFamily:F }}>تأكيد</button>
                                  <button onClick={e=>{e.stopPropagation();setDeletingContainerId(null);}} style={{ background:"#334155", border:"none", color:C.muted, fontSize:10, cursor:"pointer", borderRadius:5, padding:"2px 7px", fontFamily:F }}>إلغاء</button>
                                </>
                              ) : (
                                <button onClick={e=>{e.stopPropagation();setDeletingContainerId(c.id);}} title="حذف" style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, padding:"2px 4px" }}>🗑️</button>
                              )}
                            </div>
                          </div>

                          {/* نسبة + badge */}
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                            <div style={{ fontSize:28, fontWeight:900, color:stColor, lineHeight:1 }}>{c.fillLevel}%</div>
                            <StatusBadge status={st} />
                          </div>

                          {/* شريط التقدم */}
                          <div style={{ height:8, background:C.card, borderRadius:4, overflow:"hidden" }}>
                            <div style={{ width:`${c.fillLevel}%`, height:"100%", background:stColor, borderRadius:4, transition:"width 0.6s ease",
                              boxShadow: st==="حرج" ? `0 0 8px ${C.danger}80` : "none"
                            }} />
                          </div>

                          {/* تنبيه حرج */}
                          {st === "حرج" && (
                            <div style={{ marginTop:8, fontSize:10, color:C.danger, fontWeight:700, textAlign:"center",
                              background:C.danger+"15", borderRadius:6, padding:"3px 0" }}>
                              ⚠️ يحتاج تفريغاً فورياً
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })()}

          {/* Charts */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:16 }}>
            <Card title="سجل الامتلاء والضغط" icon={<TrendingUp size={16} color="#94a3b8" />}>
              <ChartBox height={220}><ResponsiveContainer>
                <LineChart data={stationHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="day" tick={{ fill:C.muted, fontSize:10, fontFamily:F }} />
                  <YAxis tick={{ fill:C.muted, fontSize:10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontFamily:F, fontSize:11 }} />
                  <Line type="monotone" dataKey="الامتلاء" stroke={C.warning} strokeWidth={2} dot={{ r:3 }} name="الامتلاء %" />
                  <Line type="monotone" dataKey="الضغط" stroke={C.info} strokeWidth={2} dot={{ r:3 }} name="الضغط (بار)" />
                </LineChart>
              </ResponsiveContainer></ChartBox>
            </Card>
            <Card title="كمية النفايات اليومية" icon={<Package size={16} color="#94a3b8" />}>
              <ChartBox height={220}><ResponsiveContainer>
                <BarChart data={stationHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="day" tick={{ fill:C.muted, fontSize:10, fontFamily:F }} />
                  <YAxis tick={{ fill:C.muted, fontSize:10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="الكمية" fill={C.accent} radius={[6,6,0,0]} name="الكمية (كجم)" />
                </BarChart>
              </ResponsiveContainer></ChartBox>
            </Card>
          </div>
        </div>

      ) : (
        /* ─── Stations Grid ────────────────────────────── */
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(300px,1fr))", gap:16 }}>
          {filtered.map(s => {
            const st        = getStatus(s.fillLevel);
            const stColor   = st==="حرج" ? C.danger : st==="تحذير" ? C.warning : C.accent;
            const ctrs      = s.containers || [];
            const ctrCrit   = ctrs.filter(c => getStatus(c.fillLevel)==="حرج").length;
            const ctrWarn   = ctrs.filter(c => getStatus(c.fillLevel)==="تحذير").length;

            return (
              <div key={s.id} onClick={() => setSelectedId(s.id)} style={{
                background:C.card, border:`1px solid ${C.border}`, borderRadius:16,
                cursor:"pointer", transition:"all 0.2s", position:"relative", overflow:"hidden",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor=stColor+"70"; e.currentTarget.style.background=C.cardHover; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor=C.border;     e.currentTarget.style.background=C.card; }}
              >
                {/* Top fill bar */}
                <div style={{ position:"absolute", top:0, left:0, width:`${s.fillLevel}%`, height:3, background:stColor, transition:"width 0.6s" }} />

                <div style={{ padding:18 }}>
                  {/* Header */}
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                    <div>
                      <div style={{ fontSize:14, fontWeight:700, color:C.text }}>{s.name}</div>
                      <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>📍 {s.district||"—"} | بريدة</div>
                    </div>
                    <StatusBadge status={st} />
                  </div>

                  {/* Stats row */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:6, marginBottom:12 }}>
                    {[
                      { l:"الامتلاء",  v:`${s.fillLevel}%`,         vc:stColor },
                      { l:"الضغط",     v:`${s.pressure||0} بار`,    vc:C.text  },
                      { l:"النوع",     v:s.wasteType||"—",           vc:C.text  },
                      { l:"يومياً",   v:`${s.dailyWaste||0} كجم`,   vc:C.text  },
                    ].map((x,i) => (
                      <div key={i} style={{ background:C.bg, borderRadius:8, padding:"7px 10px" }}>
                        <div style={{ fontSize:10, color:C.dim, marginBottom:2 }}>{x.l}</div>
                        <div style={{ fontSize:12, fontWeight:700, color:x.vc }}>{x.v}</div>
                      </div>
                    ))}
                  </div>

                  {/* Containers summary */}
                  <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:10 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: ctrs.length ? 8 : 0 }}>
                      <span style={{ fontSize:12, fontWeight:700, color:C.muted }}>📦 عدد الحاويات: <span style={{ color:C.text }}>{ctrs.length}</span></span>
                      <div style={{ display:"flex", gap:6 }}>
                        {ctrCrit > 0 && <span style={{ fontSize:10, fontWeight:700, color:C.danger, background:C.danger+"15", padding:"2px 7px", borderRadius:6 }}>🔴 {ctrCrit} حرج</span>}
                        {ctrWarn > 0 && <span style={{ fontSize:10, fontWeight:700, color:C.warning, background:C.warning+"15", padding:"2px 7px", borderRadius:6 }}>🟡 {ctrWarn} تحذير</span>}
                      </div>
                    </div>

                    {/* Container mini-list (max 3 shown) */}
                    {ctrs.length > 0 && (
                      <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                        {ctrs.slice(0,3).map(c => {
                          const cSt    = getStatus(c.fillLevel);
                          const cColor = cSt==="حرج" ? C.danger : cSt==="تحذير" ? C.warning : C.accent;
                          return (
                            <div key={c.id} style={{ display:"flex", alignItems:"center", gap:8, background:C.bg, borderRadius:8, padding:"6px 10px" }}>
                              <div style={{ flex:1, fontSize:11, color:C.text, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.name}</div>
                              <div style={{ fontSize:11, fontWeight:700, color:cColor, whiteSpace:"nowrap" }}>{c.fillLevel}%</div>
                              <div style={{ width:50, height:5, background:C.border, borderRadius:3, overflow:"hidden" }}>
                                <div style={{ width:`${c.fillLevel}%`, height:"100%", background:cColor, borderRadius:3 }} />
                              </div>
                            </div>
                          );
                        })}
                        {ctrs.length > 3 && (
                          <div style={{ fontSize:11, color:C.dim, textAlign:"center", paddingTop:2 }}>+ {ctrs.length-3} حاويات أخرى — اضغط للتفاصيل</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"60px 0", color:C.dim, fontSize:14 }}>
              <div style={{ fontSize:40, marginBottom:10 }}>🔍</div>
              لا توجد محطات في هذه الفئة
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ======================== REPORTS ========================
const ReportsPage = ({ stations, monthlyTrend, weeklyData }) => {
  const [tab, setTab] = useState("performance");

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
        {[{ key: "performance", label: "📊 تقرير الأداء" }, { key: "waste", label: "♻️ تقرير النفايات" }, { key: "cost", label: "💰 تقرير التكاليف" }, { key: "environment", label: "🌱 التأثير البيئي" }].map((t) => (
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
          <Card title="مقارنة امتلاء المحطات - بريدة" icon={<BarChart2 size={16} color="#94a3b8" />}>
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

      {tab === "waste" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          <Card title="توزيع النفايات حسب النوع" icon={<Trash2 size={16} color="#94a3b8" />}>
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
          <Card title="النفايات اليومية حسب النوع" icon={<TrendingUp size={16} color="#94a3b8" />}>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
            <StatCard title="إجمالي التكلفة السنوية" value={monthlyTrend.reduce((a, m) => a + m.التكلفة, 0).toLocaleString()} unit="ر.س" icon={<DollarSign size={22} color="#fff" />} gradient={C.g3} />
            <StatCard title="متوسط التكلفة الشهرية" value={Math.round(monthlyTrend.reduce((a, m) => a + m.التكلفة, 0) / 12).toLocaleString()} unit="ر.س" icon={<Calendar size={22} color="#fff" />} gradient={C.g2} trend={-8.5} />
            <StatCard title="تكلفة الكيلوغرام" value={(monthlyTrend.reduce((a, m) => a + m.التكلفة, 0) / 12 / (totalWaste * 4.3)).toFixed(2)} unit="ر.س" icon={<Scale size={22} color="#fff" />} gradient={C.g1} />
          </div>
          <Card title="التكاليف الشهرية مقابل عمليات الجمع" icon={<Banknote size={16} color="#94a3b8" />}>
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
          <Card title="أهداف الاستدامة - بريدة" icon={<Leaf size={16} color="#94a3b8" />}>
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
  { id: "ramadan", name: "شهر رمضان", type: "دينية", icon: "🌙", month: 3, duration: 30, wasteMultiplier: 1.85, peakType: "عضوية", description: "زيادة كبيرة في النفايات الغذائية بسبب الإفطار والسحور والولائم", color: "#8b5cf6", seasonTag: "رمضان" },
  { id: "eid_fitr", name: "عيد الفطر", type: "دينية", icon: "🎉", month: 4, duration: 6, wasteMultiplier: 2.4, peakType: "مختلطة", description: "ذروة النفايات من الاحتفالات والهدايا والولائم العائلية", color: "#ec4899", seasonTag: "أعياد" },
  { id: "eid_adha", name: "عيد الأضحى", type: "دينية", icon: "🐑", month: 6, duration: 5, wasteMultiplier: 2.7, peakType: "عضوية", description: "أعلى ذروة سنوية بسبب الأضاحي والولائم الكبيرة", color: "#ef4444", seasonTag: "أعياد" },
  { id: "hajj", name: "موسم الحج", type: "دينية", icon: "🕋", month: 6, duration: 10, wasteMultiplier: 1.5, peakType: "مختلطة", description: "زيادة متوسطة من التجمعات والسفر", color: "#f59e0b", seasonTag: "مواسم" },
  // --- الرواتب ---
  { id: "salary_gov", name: "رواتب القطاع الحكومي", type: "رواتب", icon: "💰", month: -1, duration: 5, wasteMultiplier: 1.45, peakType: "بلاستيك", description: "زيادة الاستهلاك والتسوق بعد صرف الرواتب مباشرة", color: "#10b981", seasonTag: "رواتب", recurring: "monthly", dayOfMonth: 27 },
  { id: "salary_pvt", name: "رواتب القطاع الخاص", type: "رواتب", icon: "💳", month: -1, duration: 5, wasteMultiplier: 1.35, peakType: "بلاستيك", description: "زيادة في نفايات التغليف والمواد الاستهلاكية", color: "#3b82f6", seasonTag: "رواتب", recurring: "monthly", dayOfMonth: 1 },
  // --- المواسم ---
  { id: "summer", name: "الإجازة الصيفية", type: "موسمية", icon: "☀️", month: 6, duration: 75, wasteMultiplier: 1.6, peakType: "بلاستيك", description: "زيادة الاستهلاك والمشروبات والمواد البلاستيكية", color: "#f97316", seasonTag: "صيف" },
  { id: "back_school", name: "بداية العام الدراسي", type: "موسمية", icon: "📚", month: 8, duration: 14, wasteMultiplier: 1.3, peakType: "ورق", description: "نفايات ورقية ومواد تغليف من المستلزمات المدرسية", color: "#06b6d4", seasonTag: "مدارس" },
  { id: "national_day", name: "اليوم الوطني", type: "وطنية", icon: "🇸🇦", month: 9, duration: 4, wasteMultiplier: 2.1, peakType: "مختلطة", description: "احتفالات كبيرة وفعاليات مفتوحة في جميع الأحياء", color: "#22c55e", seasonTag: "وطني" },
  { id: "founding_day", name: "يوم التأسيس", type: "وطنية", icon: "🏰", month: 2, duration: 3, wasteMultiplier: 1.8, peakType: "مختلطة", description: "فعاليات احتفالية وتجمعات عائلية", color: "#a855f7", seasonTag: "وطني" },
  { id: "winter", name: "موسم الشتاء والأمطار", type: "موسمية", icon: "🌧️", month: 12, duration: 60, wasteMultiplier: 1.15, peakType: "عضوية", description: "زيادة طفيفة في النفايات الغذائية والتدفئة", color: "#64748b", seasonTag: "شتاء" },
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

const PredictionsPage = ({ stations }) => {
  const [view, setView] = useState("overview");
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
          { key: "overview", label: "🔮 نظرة عامة" },
          { key: "events", label: "📅 المناسبات والأحداث" },
          { key: "forecast", label: "📈 التنبؤ 30 يوم" },
          { key: "risk", label: "⚠️ تحليل المخاطر" },
        ].map(t => (
          <button key={t.key} onClick={() => setView(t.key)} style={{
            padding: "10px 20px", borderRadius: 10, border: `1px solid ${view === t.key ? "#f59e0b" : C.border}`,
            background: view === t.key ? "#f59e0b15" : "transparent", color: view === t.key ? "#f59e0b" : C.muted,
            cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: ARABIC_FONT,
          }}>{t.label}</button>
        ))}
      </div>

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
          <Card title="التنبؤ السنوي مقابل الفعلي (كجم/يوم)" icon={<BarChart2 size={16} color="#94a3b8" />}>
            <ChartBox height={300}><ResponsiveContainer>
              <ComposedChart data={predictionData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                <Area type="monotone" dataKey="المعتاد" fill="#64748b20" stroke="#64748b" strokeDasharray="5 5" strokeWidth={1} name="المعدل الطبيعي" />
                <Bar dataKey="المتوقع" fill="#f59e0b" opacity={0.7} radius={[4, 4, 0, 0]} name="المتوقع" />
                <Line type="monotone" dataKey="الفعلي" stroke="#10b981" strokeWidth={3} dot={{ r: 5, fill: "#10b981" }} name="الفعلي" connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer></ChartBox>
          </Card>

          {/* Upcoming Events + Impact by Type */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <Card title="الأحداث القادمة" icon={<Clock size={16} color="#94a3b8" />}>
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

            <Card title="التأثير حسب نوع الحدث" icon={<BarChart2 size={16} color="#94a3b8" />}>
              <ChartBox height={280}><ResponsiveContainer>
                <BarChart data={impactByType} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis type="number" tick={{ fill: C.muted, fontSize: 10 }} />
                  <YAxis dataKey="name" type="category" width={60} tick={{ fill: C.muted, fontSize: 11, fontFamily: ARABIC_FONT }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="التأثير" radius={[0, 6, 6, 0]} name="مؤشر التأثير">
                    {impactByType.map((e, i) => <Cell key={i} fill={["#8b5cf6", "#10b981", "#f59e0b", "#22c55e", "#0ea5e9"][i % 5]} />)}
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
                padding: "7px 16px", borderRadius: 10, border: `1px solid ${selectedType === t ? "#f59e0b" : C.border}`,
                background: selectedType === t ? "#f59e0b20" : "transparent", color: selectedType === t ? "#f59e0b" : C.muted,
                cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: ARABIC_FONT,
              }}>{t}</button>
            ))}
          </div>

          {selectedEvent ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <button onClick={() => setSelectedEvent(null)} style={{ alignSelf: "flex-start", padding: "6px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: "#f59e0b", cursor: "pointer", fontSize: 13, fontFamily: ARABIC_FONT }}>
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
                <Card title={`التأثير اليومي المتوقع - ${selectedEvent.name}`} icon={<TrendingDown size={16} color="#94a3b8" />}>
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
                      <Area type="monotone" dataKey="الطبيعي" stroke="#64748b" fill="none" strokeDasharray="5 5" name="المعدل الطبيعي" />
                      <Area type="monotone" dataKey="الكمية" stroke={selectedEvent.color} fill="url(#gEvent)" strokeWidth={2} name="الكمية المتوقعة (كجم)" />
                    </AreaChart>
                  </ResponsiveContainer></ChartBox>
                </Card>

                {/* Recommendations */}
                <div style={{ marginTop: 16, background: `${selectedEvent.color}10`, border: `1px solid ${selectedEvent.color}30`, borderRadius: 12, padding: 18 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 12 }}>💡 التوصيات التشغيلية</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      `زيادة عدد عمليات الشفط بنسبة ${Math.round((selectedEvent.wasteMultiplier - 1) * 100)}% خلال فترة ${selectedEvent.name}`,
                      `تخصيص حاويات إضافية لنفايات ${selectedEvent.peakType} في جميع أحياء بريدة`,
                      `جدولة صيانة وقائية للمحطات قبل بداية الحدث بأسبوع`,
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
          <Card title="توقعات الـ 30 يوم القادمة (كجم/يوم لكل محطة)" icon={<TrendingUp size={16} color="#94a3b8" />}>
            <ChartBox height={320}><ResponsiveContainer>
              <AreaChart data={forecast30} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="gForecast" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gBand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 9 }} interval={2} />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                <Area type="monotone" dataKey="الحد_الأعلى" stroke="none" fill="url(#gBand)" name="الحد الأعلى" />
                <Area type="monotone" dataKey="الحد_الأدنى" stroke="none" fill="transparent" name="الحد الأدنى" />
                <Line type="monotone" dataKey="المتوقع" stroke="#f59e0b" strokeWidth={3} dot={false} name="التوقع" />
              </AreaChart>
            </ResponsiveContainer></ChartBox>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <Card title="توقعات تأثير النفايات حسب النوع" icon={<Trash2 size={16} color="#94a3b8" />}>
              <ChartBox height={260}><ResponsiveContainer>
                <BarChart data={wasteTypeImpact} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="name" tick={{ fill: C.muted, fontSize: 11, fontFamily: ARABIC_FONT }} />
                  <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                  <Bar dataKey="العادي" fill="#64748b" opacity={0.5} radius={[4, 4, 0, 0]} name="المعدل العادي" />
                  <Bar dataKey="المتوقع" fill="#f59e0b" radius={[4, 4, 0, 0]} name="المتوقع القادم" />
                </BarChart>
              </ResponsiveContainer></ChartBox>
            </Card>

            <Card title="ملخص التوقعات" icon={<ClipboardList size={16} color="#94a3b8" />}>
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
              <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>تحليل المخاطر بناءً على الحدث القادم: <span style={{ color: "#f59e0b" }}>{upcomingEvents[0]?.name} {upcomingEvents[0]?.icon}</span></span>
            </div>
            <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.7 }}>
              يُتوقع زيادة بمعامل <strong style={{ color: C.warning }}>×{upcomingEvents[0]?.wasteMultiplier}</strong> في حجم النفايات خلال الفترة القادمة.
              التحليل التالي يوضح المحطات الأكثر عرضة للخطر والتي تحتاج إلى تدخل استباقي.
            </p>
          </div>

          <Card title="مقارنة الخطورة الحالية مع المتوقعة لكل محطة" icon={<BarChart2 size={16} color="#94a3b8" />}>
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
            <Card title="المحطات الأكثر خطورة" icon={<AlertTriangle size={16} color="#94a3b8" />}>
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

            <Card title="خطة الاستجابة المقترحة" icon={<FileText size={16} color="#94a3b8" />}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { priority: "عاجل", action: "زيادة دورات الشفط للمحطات الحرجة إلى كل 4 ساعات", color: C.danger, icon: <div style={{width:10,height:10,borderRadius:"50%",background:"#ef4444",flexShrink:0}} /> },
                  { priority: "عاجل", action: "تجهيز حاويات احتياطية في الأحياء ذات الكثافة العالية", color: C.danger, icon: <div style={{width:10,height:10,borderRadius:"50%",background:"#ef4444",flexShrink:0}} /> },
                  { priority: "مهم", action: "إرسال إشعارات للسكان بمواعيد الجمع الإضافية", color: C.warning, icon: <div style={{width:10,height:10,borderRadius:"50%",background:"#f59e0b",flexShrink:0}} /> },
                  { priority: "مهم", action: "تخصيص فرق صيانة طوارئ على مدار الساعة", color: C.warning, icon: <div style={{width:10,height:10,borderRadius:"50%",background:"#f59e0b",flexShrink:0}} /> },
                  { priority: "وقائي", action: "فحص شامل لجميع المحطات قبل بدء الحدث", color: C.info, icon: <div style={{width:10,height:10,borderRadius:"50%",background:"#3b82f6",flexShrink:0}} /> },
                  { priority: "وقائي", action: "تحديث جداول النقل لتغطية ساعات الذروة المتوقعة", color: C.info, icon: <div style={{width:10,height:10,borderRadius:"50%",background:"#3b82f6",flexShrink:0}} /> },
                  { priority: "تنسيقي", action: "التنسيق مع البلدية لتوفير موارد إضافية مؤقتة", color: C.accent, icon: <div style={{width:10,height:10,borderRadius:"50%",background:"#10b981",flexShrink:0}} /> },
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
    { name: "خطر عالي", value: highRisk.length, fill: "#ef4444" },
    { name: "خطر متوسط", value: medRisk.length, fill: "#f97316" },
    { name: "تحذير", value: warnings.length, fill: "#f59e0b" },
    { name: "آمن", value: safe.length, fill: "#10b981" },
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
    const map = { "خطر عالي": "#ef4444", "خطر متوسط": "#f97316", "تحذير": "#f59e0b", "آمن": "#10b981" };
    return map[level] || "#64748b";
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
        <div style={{ fontSize: 16, fontWeight: 700, color: C.muted, marginBottom: 6 }}>جاري تحميل بيانات المحطات...</div>
        <div style={{ fontSize: 13 }}>سيظهر نظام مراقبة الحريق بعد تحميل بيانات المحطات</div>
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
          { key: "detail", label: "🏭 تفاصيل المحطات" },
          { key: "simulation", label: "🧪 محاكاة الحريق" },
          { key: "protocols", label: "📋 بروتوكولات الطوارئ" },
        ].map(t => (
          <button key={t.key} onClick={() => setView(t.key)} style={{
            padding: "10px 20px", borderRadius: 10, border: `1px solid ${view === t.key ? "#ef4444" : C.border}`,
            background: view === t.key ? "#ef444415" : "transparent", color: view === t.key ? "#ef4444" : C.muted,
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
                <div style={{ fontSize: 16, fontWeight: 800, color: "#fca5a5" }}>⚠️ تنبيه حريق - {highRisk.length} محطة في خطر عالي!</div>
                <div style={{ fontSize: 12, color: "#fecaca", marginTop: 4 }}>
                  {highRisk.map(s => s.district).join(" • ")} — يرجى اتخاذ إجراء فوري
                </div>
              </div>
            </div>
          )}

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <StatCard title="متوسط الحرارة الداخلية" value={avgTemp} unit="°C" icon={<Thermometer size={22} color="#fff" />} gradient="linear-gradient(135deg, #ef4444, #dc2626)" trend={avgTemp > 45 ? 8.3 : -2.1} />
            <StatCard title="محطات عالية الخطورة" value={highRisk.length} icon={<Flame size={22} color="#fff" />} gradient="linear-gradient(135deg, #f97316, #ea580c)" />
            <StatCard title="كشف دخان" value={smokeCount} unit="محطة" icon={<Wind size={22} color="#fff" />} gradient="linear-gradient(135deg, #64748b, #475569)" />
            <StatCard title="متوسط مستوى الغاز" value={avgGas} unit="%" icon={<Gauge size={22} color="#fff" />} gradient="linear-gradient(135deg, #f59e0b, #d97706)" />
          </div>

          {/* Temperature Timeline + Risk Pie */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
            <Card title="منحنى الحرارة الداخلية (24 ساعة)" icon={<Thermometer size={16} color="#94a3b8" />}>
              <ChartBox height={280}><ResponsiveContainer>
                <AreaChart data={tempHistory} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="gIntTemp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="hour" tick={{ fill: C.muted, fontSize: 9 }} interval={2} />
                  <YAxis tick={{ fill: C.muted, fontSize: 10 }} domain={[0, 90]} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                  <Area type="monotone" dataKey="الحرارة_الداخلية" stroke="#ef4444" fill="url(#gIntTemp)" strokeWidth={2} name="الحرارة الداخلية °C" />
                  <Line type="monotone" dataKey="الحرارة_الخارجية" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 4" dot={false} name="الحرارة الخارجية °C" />
                  <Line type="monotone" dataKey="حد_الإنذار" stroke="#f97316" strokeWidth={1} strokeDasharray="8 4" dot={false} name="حد الإنذار (60°C)" />
                  <Line type="monotone" dataKey="حد_الخطر" stroke="#ef4444" strokeWidth={1} strokeDasharray="8 4" dot={false} name="حد الخطر (75°C)" />
                </AreaChart>
              </ResponsiveContainer></ChartBox>
            </Card>

            <Card title="توزيع مستويات الخطورة" icon={<Target size={16} color="#94a3b8" />}>
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
          <Card title="حالة المحطات - المراقبة الحية" icon={<Radio size={16} color="#94a3b8" />}>
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
                      <div style={{ color: C.dim }}>🌡️ داخلي: <span style={{ color: s.internalTemp > 55 ? "#ef4444" : s.internalTemp > 40 ? "#f59e0b" : C.text, fontWeight: 600 }}>{s.internalTemp}°C</span></div>
                      <div style={{ color: C.dim }}>⛽ غاز: <span style={{ color: s.gasLevel > 60 ? "#ef4444" : C.text, fontWeight: 600 }}>{s.gasLevel}%</span></div>
                      <div style={{ color: C.dim }}>💧 رطوبة: <span style={{ color: C.text, fontWeight: 600 }}>{s.humidity}%</span></div>
                      <div style={{ color: C.dim }}>🗑️ امتلاء: <span style={{ color: C.text, fontWeight: 600 }}>{s.fillLevel}%</span></div>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      {s.smokeDetected && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#ef444420", color: "#ef4444", fontWeight: 600 }}>💨 دخان</span>}
                      {s.sparkDetected && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#f9731620", color: "#f97316", fontWeight: 600 }}>⚡ شرارة</span>}
                      {s.hasFlammable && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#f59e0b20", color: "#f59e0b", fontWeight: 600 }}>🔥 قابل للاشتعال</span>}
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
            <Card title="مؤشر خطورة الحريق لكل محطة" icon={<BarChart2 size={16} color="#94a3b8" />}>
              <ChartBox height={350}><ResponsiveContainer>
                <BarChart data={stationRiskChart} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: C.muted, fontSize: 10 }} />
                  <YAxis dataKey="name" type="category" width={60} tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="الخطورة" radius={[0, 6, 6, 0]} name="مؤشر الخطورة %">
                    {stationRiskChart.map((e, i) => <Cell key={i} fill={e.الخطورة > 75 ? "#ef4444" : e.الخطورة > 50 ? "#f97316" : e.الخطورة > 30 ? "#f59e0b" : "#10b981"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer></ChartBox>
            </Card>

            <Card title="علاقة الحرارة بالغاز والرطوبة" icon={<Microscope size={16} color="#94a3b8" />}>
              <ChartBox height={350}><ResponsiveContainer>
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={gasVsTempData}>
                  <PolarGrid stroke={C.border} />
                  <PolarAngleAxis dataKey="name" tick={{ fill: C.muted, fontSize: 9, fontFamily: ARABIC_FONT }} />
                  <PolarRadiusAxis tick={{ fill: C.dim, fontSize: 8 }} />
                  <Radar name="الحرارة °C" dataKey="الحرارة" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} />
                  <Radar name="الغاز %" dataKey="الغاز" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} />
                  <Radar name="الرطوبة %" dataKey="الرطوبة" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} />
                  <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                </RadarChart>
              </ResponsiveContainer></ChartBox>
            </Card>
          </div>

          <Card title="سجل الإنذارات والحوادث (8 أسابيع)" icon={<TrendingUp size={16} color="#94a3b8" />}>
            <ChartBox height={280}><ResponsiveContainer>
              <ComposedChart data={weeklyIncidents} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="week" tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                <Bar dataKey="إنذارات" fill="#f59e0b" radius={[4, 4, 0, 0]} opacity={0.8} name="إنذارات حرارية" />
                <Bar dataKey="إنذارات_كاذبة" fill="#64748b" radius={[4, 4, 0, 0]} opacity={0.6} name="إنذارات كاذبة" />
                <Line type="monotone" dataKey="حوادث_فعلية" stroke="#ef4444" strokeWidth={3} dot={{ r: 5, fill: "#ef4444" }} name="حوادث فعلية" />
              </ComposedChart>
            </ResponsiveContainer></ChartBox>
          </Card>

          {/* Fire risk factors */}
          <Card title="عوامل خطر الحريق الرئيسية" icon={<Zap size={16} color="#94a3b8" />}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {[
                { factor: "ارتفاع الحرارة الداخلية", weight: 35, desc: "تجاوز 55°C يزيد الخطر بشكل كبير", icon: <Thermometer size={22} color="#ef4444" />, color: "#ef4444", affected: fireData.filter(s => s.internalTemp > 55).length },
                { factor: "تسرب الغازات", weight: 25, desc: "غازات الميثان والهيدروجين القابلة للاشتعال", icon: <Gauge size={22} color="#f97316" />, color: "#f97316", affected: fireData.filter(s => s.gasLevel > 60).length },
                { factor: "مواد قابلة للاشتعال", weight: 15, desc: "بلاستيك، ورق، ومواد مختلطة", icon: <Package size={22} color="#f59e0b" />, color: "#f59e0b", affected: fireData.filter(s => s.hasFlammable).length },
                { factor: "الامتلاء الزائد", weight: 10, desc: "الضغط والاحتكاك يولدان حرارة", icon: <BarChart2 size={22} color="#8b5cf6" />, color: "#8b5cf6", affected: fireData.filter(s => s.fillLevel > 75).length },
                { factor: "انخفاض الرطوبة", weight: 10, desc: "الجفاف يسهّل الاشتعال", icon: <Droplets size={22} color="#3b82f6" />, color: "#3b82f6", affected: fireData.filter(s => s.humidity < 30).length },
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
                    <span style={{ fontSize: 11, color: C.muted }}>محطات متأثرة</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: f.affected > 3 ? "#ef4444" : f.affected > 1 ? "#f59e0b" : C.accent }}>{f.affected}</span>
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
              <button onClick={() => setSelectedStation(null)} style={{ alignSelf: "flex-start", padding: "6px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: "#ef4444", cursor: "pointer", fontSize: 13, fontFamily: ARABIC_FONT }}>
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
                    { label: "الحرارة الداخلية", val: `${selectedStation.internalTemp}°C`, color: selectedStation.internalTemp > 55 ? "#ef4444" : "#f59e0b", icon: <Thermometer size={22} color={selectedStation.internalTemp > 55 ? "#ef4444" : "#f59e0b"} /> },
                    { label: "الحرارة الخارجية", val: `${selectedStation.ambientTemp}°C`, color: "#f59e0b", icon: <Zap size={22} color="#f59e0b" /> },
                    { label: "مستوى الغاز", val: `${selectedStation.gasLevel}%`, color: selectedStation.gasLevel > 60 ? "#ef4444" : C.accent, icon: <Gauge size={22} color={selectedStation.gasLevel > 60 ? "#ef4444" : C.accent} /> },
                    { label: "الرطوبة", val: `${selectedStation.humidity}%`, color: selectedStation.humidity < 30 ? "#f59e0b" : C.info, icon: <Droplets size={22} color={selectedStation.humidity < 30 ? "#f59e0b" : C.info} /> },
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
                    { label: "كاشف الدخان", active: selectedStation.smokeDetected, activeText: "تم كشف دخان!", inactiveText: "لا يوجد دخان", icon: <Wind size={20} color="#94a3b8" /> },
                    { label: "كاشف الشرارة", active: selectedStation.sparkDetected, activeText: "تم كشف شرارة!", inactiveText: "لا توجد شرارة", icon: <Zap size={20} color="#94a3b8" /> },
                    { label: "طفاية حريق", active: selectedStation.fireExtinguisher, activeText: "متوفرة وصالحة", inactiveText: "غير متوفرة!", icon: <FireExtinguisher size={20} color="#94a3b8" /> },
                    { label: "نظام إطفاء تلقائي", active: selectedStation.autoSuppression, activeText: "مُفعّل", inactiveText: "غير مُفعّل", icon: <Droplets size={20} color="#94a3b8" /> },
                  ].map((item, i) => (
                    <div key={i} style={{ background: C.bg, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, border: `1px solid ${item.active && (i < 2) ? "#ef444440" : C.border}` }}>
                      <span>{item.icon}</span>
                      <div>
                        <div style={{ fontSize: 10, color: C.dim }}>{item.label}</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: item.active ? (i < 2 ? "#ef4444" : C.accent) : (i < 2 ? C.accent : "#ef4444") }}>
                          {item.active ? item.activeText : item.inactiveText}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <Card title="سجل الحرارة الداخلية - 24 ساعة" icon={<TrendingUp size={16} color="#94a3b8" />}>
                  <ChartBox height={220}><ResponsiveContainer>
                    <AreaChart data={tempHistory} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="gFire" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="hour" tick={{ fill: C.muted, fontSize: 9 }} interval={2} />
                      <YAxis tick={{ fill: C.muted, fontSize: 10 }} domain={[0, 90]} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                      <Area type="monotone" dataKey="الحرارة_الداخلية" stroke="#ef4444" fill="url(#gFire)" strokeWidth={2} name="الحرارة الداخلية" />
                      <Line type="monotone" dataKey="حد_الإنذار" stroke="#f97316" strokeDasharray="6 3" dot={false} name="حد الإنذار 60°C" />
                      <Line type="monotone" dataKey="حد_الخطر" stroke="#ef4444" strokeDasharray="6 3" dot={false} name="حد الخطر 75°C" />
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
          <Card title="محاكاة سيناريو الحريق" icon={<FlaskConical size={16} color="#94a3b8" />}>
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
                    <span style={{ color: "#f59e0b" }}>45°C تحذير</span>
                    <span style={{ color: "#f97316" }}>60°C إنذار</span>
                    <span style={{ color: "#ef4444" }}>75°C+ خطر</span>
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
                    { temp: 55, action: "تنبيه تحذيري", desc: "إخطار مشرف المحطة فوراً", icon: "⚠️", color: "#f59e0b" },
                    { temp: 60, action: "إنذار متوسط", desc: "تفعيل نظام التبريد التلقائي", icon: "❄️", color: "#f97316" },
                    { temp: 65, action: "وقف الشفط", desc: "إيقاف عمليات الشفط لتقليل الاحتكاك", icon: "🛑", color: "#f97316" },
                    { temp: 70, action: "استدعاء فريق الطوارئ", desc: "تجهيز فريق الإطفاء الداخلي", icon: "🚒", color: "#ef4444" },
                    { temp: 75, action: "إنذار حريق!", desc: "تفعيل نظام الإطفاء التلقائي وإخلاء المنطقة", icon: "🔥", color: "#ef4444" },
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
          <Card title="منحنى المحاكاة - تصاعد الحرارة" icon={<TrendingUp size={16} color="#94a3b8" />}>
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
                <Line type="monotone" dataKey="حد_الخطر" stroke="#ef4444" strokeDasharray="6 3" dot={false} name="حد الخطر" />
              </AreaChart>
            </ResponsiveContainer></ChartBox>
          </Card>
        </div>
      )}

      {/* ===== PROTOCOLS ===== */}
      {view === "protocols" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="بروتوكولات الاستجابة لحرائق الحاويات" icon={<ClipboardList size={16} color="#94a3b8" />}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                {
                  level: "المستوى 1 - مراقبة",
                  range: "أقل من 45°C",
                  color: C.accent,
                  icon: <div style={{width:10,height:10,borderRadius:"50%",background:"#10b981",flexShrink:0}} />,
                  steps: ["فحص دوري للمستشعرات كل 6 ساعات", "تسجيل القراءات في السجل اليومي", "التأكد من عمل كواشف الدخان"],
                },
                {
                  level: "المستوى 2 - تحذير",
                  range: "45°C - 60°C",
                  color: "#f59e0b",
                  icon: <div style={{width:10,height:10,borderRadius:"50%",background:"#f59e0b",flexShrink:0}} />,
                  steps: ["إخطار مشرف المحطة عبر الرسائل", "زيادة تردد القراءات إلى كل 15 دقيقة", "فحص مصدر الحرارة والتحقق من وجود مواد خطرة", "تجهيز معدات الإطفاء الأولية"],
                },
                {
                  level: "المستوى 3 - إنذار",
                  range: "60°C - 75°C",
                  color: "#f97316",
                  icon: <div style={{width:10,height:10,borderRadius:"50%",background:"#f97316",flexShrink:0}} />,
                  steps: ["تفعيل نظام التبريد التلقائي", "إيقاف عمليات الشفط في المحطة المتأثرة", "إرسال فريق الفحص الميداني", "إعداد فريق الإطفاء الداخلي", "إبلاغ إدارة المنشأة"],
                },
                {
                  level: "المستوى 4 - خطر حريق",
                  range: "أعلى من 75°C",
                  color: "#ef4444",
                  icon: <div style={{width:10,height:10,borderRadius:"50%",background:"#ef4444",flexShrink:0}} />,
                  steps: ["تفعيل نظام الإطفاء التلقائي فوراً", "الاتصال بالدفاع المدني (998)", "إخلاء المنطقة المحيطة 200 متر", "قطع التيار الكهربائي عن المحطة", "تفعيل خطة الطوارئ الشاملة", "توثيق الحادثة بالصور والفيديو"],
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
          <Card title="جهات الاتصال في حالات الطوارئ" icon={<Phone size={16} color="#94a3b8" />}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              {[
                { name: "الدفاع المدني", phone: "998", icon: "🚒", color: "#ef4444", desc: "الاستجابة الأولى للحرائق" },
                { name: "الإسعاف", phone: "997", icon: "🚑", color: "#3b82f6", desc: "الطوارئ الطبية" },
                { name: "الشرطة", phone: "999", icon: "🚔", color: "#8b5cf6", desc: "الأمن والسلامة" },
                { name: "مدير المحطة", phone: "055-XXX-XXXX", icon: "👷", color: "#f59e0b", desc: "المسؤول المباشر" },
                { name: "فريق الصيانة", phone: "050-XXX-XXXX", icon: "🔧", color: "#10b981", desc: "الدعم التقني" },
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
          <Card title="قائمة فحص معدات السلامة" icon={<FireExtinguisher size={16} color="#94a3b8" />}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
              {[
                { item: "طفاية حريق بودرة ABC", stations: fireData.filter(s => s.fireExtinguisher).length, total: 12, icon: <FireExtinguisher size={22} color="#94a3b8" /> },
                { item: "نظام إطفاء تلقائي", stations: fireData.filter(s => s.autoSuppression).length, total: 12, icon: <Droplets size={22} color="#94a3b8" /> },
                { item: "كاشف دخان فعّال", stations: 11, total: 12, icon: <Wind size={22} color="#94a3b8" /> },
                { item: "كاشف حرارة فعّال", stations: 12, total: 12, icon: <Thermometer size={22} color="#94a3b8" /> },
                { item: "كاشف غاز فعّال", stations: 10, total: 12, icon: <Gauge size={22} color="#94a3b8" /> },
                { item: "إضاءة طوارئ", stations: 9, total: 12, icon: <Zap size={22} color="#94a3b8" /> },
              ].map((eq, i) => {
                const pct = Math.round((eq.stations / eq.total) * 100);
                const eqColor = pct === 100 ? C.accent : pct > 75 ? "#f59e0b" : "#ef4444";
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
const RequestsManagementPage = () => {
  // All requests & reports loaded directly via onSnapshot (no userId filter needed here)
  const [requests, setRequests] = useState([]);
  const [reports,  setReports]  = useState([]);
  const [loadingReqs, setLoadingReqs] = useState(true);
  const [loadingReps, setLoadingReps] = useState(true);
  const [tab, setTab] = useState("requests");
  const [responding, setResponding] = useState({}); // { [id]: true }
  const [responseText, setResponseText] = useState({}); // { [id]: string }

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.REQUESTS), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingReqs(false);
    }, (e) => { console.error(e); setLoadingReqs(false); });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.CITIZEN_REPORTS), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setReports(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingReps(false);
    }, (e) => { console.error(e); setLoadingReps(false); });
    return () => unsub();
  }, []);

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
    <Card title="المساعد الذكي — Groq AI (مجاني)" icon={<Bot size={16} color="#94a3b8" />}>
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

const SettingsPage = () => {
  const [notif, setNotif] = useState(true);
  const [autoCollect, setAutoCollect] = useState(true);
  const [threshold, setThreshold] = useState(85);
  const [seedStatus, setSeedStatus] = useState(null);    // null | "running" | "done" | "error"
  const [exportStatus, setExportStatus] = useState(null); // null | "running" | "done" | "error"

  const Toggle = ({ value, onChange }) => (
    <div onClick={() => onChange(!value)} style={{ width: 48, height: 26, borderRadius: 13, background: value ? C.accent : C.border, cursor: "pointer", position: "relative", transition: "background 0.3s" }}>
      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, transition: "all 0.3s", ...(value ? { left: 25 } : { left: 3 }) }} />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 600 }}>
      <Card title="إعدادات النظام" icon={<SettingsIcon size={16} color="#94a3b8" />}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {[{ label: "التنبيهات الفورية", desc: "استقبال إشعارات عند تجاوز الحدود", val: notif, set: setNotif },
            { label: "التفريغ التلقائي", desc: "تشغيل الشفط تلقائياً عند الامتلاء", val: autoCollect, set: setAutoCollect }].map((item, i) => (
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
      <Card title="حالة الاتصال" icon={<Plug size={16} color="#94a3b8" />}>
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

      <Card title="تهيئة قاعدة البيانات" icon={<Database size={16} color="#94a3b8" />}>
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

      <ApiKeyCard />

      <Card title="تصدير قاعدة البيانات" icon={<BarChart2 size={16} color="#94a3b8" />}>
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
    </div>
  );
};

// ======================== SUCTION CONTROL PAGE ========================
const SuctionControlPage = ({ stations, user }) => {
  const F = ARABIC_FONT;
  const inp = { width:"100%", padding:"10px 14px", borderRadius:10, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:13, fontFamily:F, outline:"none", boxSizing:"border-box" };

  // ─── form state ────────────────────────────────────────────
  const [cmdType, setCmdType]         = useState("container_to_station"); // | station_to_central
  const [selStation, setSelStation]   = useState("");
  const [selContainer, setSelContainer] = useState("");
  const [mode, setMode]               = useState("immediate");            // | scheduled | recurring
  const [schedDate, setSchedDate]     = useState("");
  const [schedTime, setSchedTime]     = useState("06:00");
  const [saving, setSaving]           = useState(false);
  const [saveMsg, setSaveMsg]         = useState("");

  // ─── live jobs from Firestore ──────────────────────────────
  const [jobs, setJobs] = useState([]);
  useEffect(() => {
    const q = query(collection(db, "suctionJobs"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, snap => {
      setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => console.error("suctionJobs snapshot:", err));
    return () => unsub();
  }, []);

  // ─── derived helpers ───────────────────────────────────────
  const station     = stations.find(s => s.id === selStation);
  const containers  = station?.containers || [];

  const buildJob = () => {
    const now = new Date().toISOString();
    const base = {
      type: cmdType,
      createdAt: now,
      createdBy: user?.name || "موظف",
      status: mode === "immediate" ? "pending" : "scheduled",
      mode,
    };
    if (cmdType === "container_to_station") {
      const ctr = containers.find(c => c.id === selContainer);
      return { ...base,
        sourceName: ctr?.name || selContainer,
        sourceId:   selContainer,
        targetName: station?.name || selStation,
        targetId:   selStation,
      };
    } else {
      return { ...base,
        sourceName: station?.name || selStation,
        sourceId:   selStation,
        targetName: "المحطة المركزية",
        targetId:   "central",
      };
    }
  };

  const handleIssue = async () => {
    if (!selStation) { setSaveMsg("⚠️ اختر المحطة أولاً"); return; }
    if (cmdType === "container_to_station" && !selContainer) { setSaveMsg("⚠️ اختر الحاوية"); return; }
    if (mode === "scheduled" && (!schedDate || !schedTime)) { setSaveMsg("⚠️ حدد التاريخ والوقت"); return; }
    if (mode === "recurring" && !schedTime) { setSaveMsg("⚠️ حدد وقت التكرار اليومي"); return; }

    setSaving(true); setSaveMsg("");
    try {
      const job = buildJob();
      if (mode === "scheduled")  job.scheduledAt   = `${schedDate}T${schedTime}:00`;
      if (mode === "recurring")  job.recurringTime  = schedTime;
      await addDoc(collection(db, "suctionJobs"), job);
      setSaveMsg("✅ تم إصدار الأمر بنجاح");
      setSelStation(""); setSelContainer(""); setSchedDate("");
    } catch (e) {
      setSaveMsg("❌ خطأ: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (jobId) => {
    try { await updateDoc(doc(db, "suctionJobs", jobId), { status: "cancelled" }); }
    catch (e) { console.error(e); }
  };

  const handleComplete = async (jobId) => {
    try { await updateDoc(doc(db, "suctionJobs", jobId), { status: "completed", completedAt: new Date().toISOString() }); }
    catch (e) { console.error(e); }
  };

  const statusStyle = (s) => ({
    pending:   { bg:"#3b82f615", color:C.info,    label:"⏳ في الانتظار"  },
    scheduled: { bg:"#8b5cf615", color:C.purple,  label:"🕐 مجدول"       },
    active:    { bg:"#10b98115", color:C.accent,  label:"▶ جاري الشفط"   },
    completed: { bg:"#10b98115", color:C.accent,  label:"✅ مكتمل"        },
    cancelled: { bg:"#ef444415", color:C.danger,  label:"✖ ملغي"         },
  }[s] || { bg:C.border, color:C.muted, label:s });

  const pendingJobs   = jobs.filter(j => ["pending","scheduled","active"].includes(j.status));
  const historyJobs   = jobs.filter(j => ["completed","cancelled"].includes(j.status)).slice(0,10);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18, direction:"rtl", fontFamily:F }}>

      {/* ─── Stats bar ───────────────────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:12 }}>
        {[
          { label:"أوامر نشطة",   val:jobs.filter(j=>j.status==="pending"||j.status==="active").length,  color:C.info,   icon:<Zap size={22} color={C.info} /> },
          { label:"مجدولة",       val:jobs.filter(j=>j.status==="scheduled").length,                     color:C.purple, icon:<Clock size={22} color={C.purple} /> },
          { label:"مكتملة اليوم", val:jobs.filter(j=>j.status==="completed"&&j.completedAt?.startsWith(new Date().toISOString().slice(0,10))).length, color:C.accent, icon:<CheckCircle size={22} color={C.accent} /> },
          { label:"إجمالي الأوامر",val:jobs.length,                                                      color:C.muted,  icon:<ClipboardList size={22} color={C.muted} /> },
        ].map((m,i)=>(
          <div key={i} style={{ background:C.card, border:`1px solid ${m.color}25`, borderRadius:14, padding:"14px 18px", textAlign:"center" }}>
            <div style={{ marginBottom:4, display:"flex", justifyContent:"center" }}>{m.icon}</div>
            <div style={{ fontSize:26, fontWeight:900, color:m.color }}>{m.val}</div>
            <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{m.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:16 }}>

        {/* ─── Issue Command ───────────────────────────── */}
        <Card title="إصدار أمر شفط" icon={<Sliders size={16} color="#94a3b8" />}>

          {/* نوع العملية */}
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:11, color:C.muted, marginBottom:8, display:"block" }}>نوع عملية الشفط</label>
            <div style={{ display:"flex", gap:8 }}>
              {[
                { key:"container_to_station", label:"🗑️ حاوية → محطة الحي"       },
                { key:"station_to_central",   label:"🏭 محطة الحي → المركزية" },
              ].map(t=>(
                <button key={t.key} onClick={()=>{ setCmdType(t.key); setSelContainer(""); }} style={{
                  flex:1, padding:"10px 8px", borderRadius:10,
                  border:`2px solid ${cmdType===t.key?C.accent:C.border}`,
                  background: cmdType===t.key ? C.accent+"15" : "transparent",
                  color: cmdType===t.key ? C.accent : C.muted,
                  cursor:"pointer", fontSize:12, fontWeight:700, fontFamily:F, textAlign:"center",
                }}>{t.label}</button>
              ))}
            </div>
          </div>

          {/* اختيار المحطة */}
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:11, color:C.muted, marginBottom:5, display:"block" }}>
              {cmdType==="container_to_station" ? "محطة الحي (الوجهة)" : "محطة الحي (المصدر)"}
            </label>
            <select value={selStation} onChange={e=>{setSelStation(e.target.value);setSelContainer("");}}
              style={{...inp,appearance:"auto"}}>
              <option value="">— اختر المحطة —</option>
              {stations.map(s=>(
                <option key={s.id} value={s.id}>{s.name} ({getStatus(s.fillLevel)} — {s.fillLevel}%)</option>
              ))}
            </select>
          </div>

          {/* اختيار الحاوية (فقط لنوع container_to_station) */}
          {cmdType==="container_to_station" && (
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:11, color:C.muted, marginBottom:5, display:"block" }}>الحاوية (المصدر)</label>
              <select value={selContainer} onChange={e=>setSelContainer(e.target.value)}
                disabled={!selStation} style={{...inp,appearance:"auto",opacity:selStation?1:0.5}}>
                <option value="">— اختر الحاوية —</option>
                {[...containers]
                  .sort((a,b)=>b.fillLevel-a.fillLevel)
                  .map(c=>(
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.fillLevel}% ({getStatus(c.fillLevel)})
                  </option>
                ))}
              </select>
              {selStation && containers.length===0 && (
                <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>لا توجد حاويات في هذه المحطة</div>
              )}
            </div>
          )}

          {/* معاينة الرحلة */}
          {selStation && (cmdType==="station_to_central" || selContainer) && (
            <div style={{ background:`${C.accent}10`, border:`1px solid ${C.accent}30`, borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:12, color:C.accent }}>
              🚿 <strong>مسار الشفط:</strong>&nbsp;
              {cmdType==="container_to_station"
                ? `${containers.find(c=>c.id===selContainer)?.name || ""} → ${station?.name || ""}`
                : `${station?.name || ""} → المحطة المركزية`}
            </div>
          )}

          {/* ─── وقت التنفيذ ─── */}
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:11, color:C.muted, marginBottom:8, display:"block" }}>وقت التنفيذ</label>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {[
                { key:"immediate", label:"⚡ فوري"       },
                { key:"scheduled", label:"📅 وقت محدد"   },
                { key:"recurring", label:"🔁 يومي تلقائي" },
              ].map(m=>(
                <button key={m.key} onClick={()=>setMode(m.key)} style={{
                  flex:1, minWidth:80, padding:"8px 6px", borderRadius:9,
                  border:`1px solid ${mode===m.key?C.info:C.border}`,
                  background: mode===m.key ? C.info+"18" : "transparent",
                  color: mode===m.key ? C.info : C.muted,
                  cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:F, textAlign:"center",
                }}>{m.label}</button>
              ))}
            </div>
          </div>

          {/* حقول الوقت */}
          {mode==="scheduled" && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:10, marginBottom:12 }}>
              <div>
                <label style={{ fontSize:11, color:C.muted, marginBottom:5, display:"block" }}>التاريخ</label>
                <input type="date" value={schedDate} onChange={e=>setSchedDate(e.target.value)} style={inp} min={new Date().toISOString().slice(0,10)} />
              </div>
              <div>
                <label style={{ fontSize:11, color:C.muted, marginBottom:5, display:"block" }}>الوقت</label>
                <input type="time" value={schedTime} onChange={e=>setSchedTime(e.target.value)} style={inp} />
              </div>
            </div>
          )}
          {mode==="recurring" && (
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:11, color:C.muted, marginBottom:5, display:"block" }}>وقت التنفيذ اليومي</label>
              <input type="time" value={schedTime} onChange={e=>setSchedTime(e.target.value)} style={inp} />
              <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>🔁 سيتكرر كل يوم في هذا الوقت</div>
            </div>
          )}

          {saveMsg && (
            <div style={{ fontSize:12, padding:"8px 12px", borderRadius:8, marginBottom:12,
              background: saveMsg.startsWith("✅") ? C.accent+"15" : C.danger+"15",
              color:       saveMsg.startsWith("✅") ? C.accent       : C.danger,
              border:`1px solid ${saveMsg.startsWith("✅")?C.accent:C.danger}30`
            }}>{saveMsg}</div>
          )}

          <button onClick={handleIssue} disabled={saving} style={{
            width:"100%", padding:13, borderRadius:10, border:"none",
            background: saving ? "#334155" : "linear-gradient(135deg,#10b981,#059669)",
            color:"#000", fontWeight:800, fontSize:14, cursor:saving?"not-allowed":"pointer", fontFamily:F,
          }}>
            {saving ? "جاري الإرسال..." : mode==="immediate" ? "⚡ تنفيذ الشفط الآن" : mode==="scheduled" ? "📅 جدولة الأمر" : "🔁 تفعيل الجدول اليومي"}
          </button>
        </Card>

        {/* ─── Active + Scheduled Jobs ─────────────────── */}
        <Card title="الأوامر النشطة والمجدولة" icon={<ClipboardList size={16} color="#94a3b8" />}>
          {pendingJobs.length===0 ? (
            <div style={{ textAlign:"center", padding:"50px 0", color:C.dim, fontSize:13 }}>
              <div style={{ fontSize:36, marginBottom:8 }}>📭</div>لا توجد أوامر نشطة
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10, maxHeight:380, overflowY:"auto" }}>
              {pendingJobs.map(job => {
                const ss = statusStyle(job.status);
                return (
                  <div key={job.id} style={{ background:C.bg, borderRadius:12, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:C.text }}>
                        {job.type==="container_to_station" ? "🗑️ → 🏭" : "🏭 → 🏛️"}&nbsp;
                        <span style={{ fontSize:12, fontWeight:600 }}>{job.sourceName}</span>
                        <span style={{ color:C.dim }}> → </span>
                        <span style={{ fontSize:12, fontWeight:600 }}>{job.targetName}</span>
                      </div>
                      <span style={{ fontSize:11, fontWeight:700, color:ss.color, background:ss.bg, padding:"3px 9px", borderRadius:6 }}>{ss.label}</span>
                    </div>
                    <div style={{ fontSize:11, color:C.dim, marginBottom:8 }}>
                      {job.mode==="immediate"  && `⚡ فوري — ${new Date(job.createdAt).toLocaleString("ar-SA")}`}
                      {job.mode==="scheduled"  && `📅 مجدول: ${new Date(job.scheduledAt).toLocaleString("ar-SA")}`}
                      {job.mode==="recurring"  && `🔁 يومي في ${job.recurringTime} — بواسطة ${job.createdBy}`}
                    </div>
                    <div style={{ display:"flex", gap:6 }}>
                      {job.status!=="active" && (
                        <button onClick={()=>handleComplete(job.id)} style={{ padding:"5px 12px", borderRadius:7, border:"none", background:C.accent+"20", color:C.accent, cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:F }}>✅ إتمام</button>
                      )}
                      <button onClick={()=>handleCancel(job.id)} style={{ padding:"5px 12px", borderRadius:7, border:"none", background:C.danger+"15", color:C.danger, cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:F }}>✖ إلغاء</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ─── History ─────────────────────────────────────── */}
      {historyJobs.length > 0 && (
        <Card title="سجل العمليات" icon={<Clock size={16} color="#94a3b8" />}>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {historyJobs.map(job => {
              const ss = statusStyle(job.status);
              return (
                <div key={job.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", background:C.bg, borderRadius:10, fontSize:12 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <span>{job.type==="container_to_station"?"🗑️ → 🏭":"🏭 → 🏛️"}</span>
                    <span style={{ color:C.text, fontWeight:600 }}>{job.sourceName}</span>
                    <span style={{ color:C.dim }}>→</span>
                    <span style={{ color:C.text, fontWeight:600 }}>{job.targetName}</span>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <span style={{ color:C.dim }}>{job.completedAt ? new Date(job.completedAt).toLocaleString("ar-SA") : new Date(job.createdAt).toLocaleString("ar-SA")}</span>
                    <span style={{ fontSize:11, fontWeight:700, color:ss.color, background:ss.bg, padding:"2px 8px", borderRadius:6 }}>{ss.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
};

// ======================== EXECUTIVE DECISION PORTAL ========================
const EXEC_USERS = [
  { username: "admin", password: "admin123", name: "م. عبدالله الراشد", role: "المدير التنفيذي", initials: "عر" },
  { username: "manager", password: "manager123", name: "م. سارة القحطاني", role: "مدير العمليات", initials: "سق" },
  { username: "cfo", password: "cfo123", name: "أ. فهد المطيري", role: "المدير المالي", initials: "فم" },
];

const ExecLoginPage = ({ onLogin }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showHint, setShowHint] = useState(false);

  const handleLogin = () => {
    const user = EXEC_USERS.find(u => u.username === username && u.password === password);
    if (user) { onLogin(user); setError(""); }
    else setError("اسم المستخدم أو كلمة المرور غير صحيحة");
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0e1a 0%, #1a1040 50%, #0a0e1a 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: ARABIC_FONT, direction: "rtl" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <div style={{ width:"100%", maxWidth: 420, padding: "clamp(20px,5vw,40px)", background: "#111827", borderRadius: 24, border: "1px solid #1e293b", position: "relative", overflow: "hidden" }}>
        {/* Decorative glow */}
        <div style={{ position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)", width: 200, height: 200, background: "radial-gradient(circle, #f59e0b20, transparent)", borderRadius: "50%" }} />
        <div style={{ position: "absolute", bottom: -40, right: -40, width: 150, height: 150, background: "radial-gradient(circle, #8b5cf620, transparent)", borderRadius: "50%" }} />
        
        <div style={{ textAlign: "center", marginBottom: 32, position: "relative" }}>
          <AppLogo size={72} />
          <h1 style={{ fontSize: 22, fontWeight: 900, color: "#f1f5f9", margin: "16px 0 6px 0" }}>بوابة متخذي القرار</h1>
          <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>نظام إدارة النفايات الذكي - بريدة</p>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 8, background: "#0a0e1a", padding: "4px 12px", borderRadius: 8, display: "inline-flex", alignItems: "center", gap: 5 }}><Lock size={11} /> وصول مقيّد - للإدارة العليا فقط</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "relative" }}>
          <div>
            <label style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6, display: "block" }}>اسم المستخدم</label>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="أدخل اسم المستخدم"
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: "1px solid #334155", background: "#0a0e1a", color: "#f1f5f9", fontSize: 14, fontFamily: ARABIC_FONT, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6, display: "block" }}>كلمة المرور</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="أدخل كلمة المرور"
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: "1px solid #334155", background: "#0a0e1a", color: "#f1f5f9", fontSize: 14, fontFamily: ARABIC_FONT, outline: "none", boxSizing: "border-box" }} />
          </div>
          
          {error && <div style={{ fontSize: 12, color: "#ef4444", background: "#ef444415", padding: "8px 12px", borderRadius: 8, textAlign: "center" }}>⚠️ {error}</div>}

          <button onClick={handleLogin} style={{
            padding: "14px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #f59e0b, #d97706)",
            color: "#000", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: ARABIC_FONT, marginTop: 4,
            transition: "transform 0.2s, box-shadow 0.2s",
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 25px #f59e0b40"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
          >دخول إلى البوابة</button>

          <button onClick={() => setShowHint(!showHint)} style={{ background: "none", border: "none", color: "#64748b", fontSize: 11, cursor: "pointer", fontFamily: ARABIC_FONT, marginTop: 4 }}>
            {showHint ? "إخفاء بيانات الدخول" : "عرض بيانات الدخول التجريبية"}
          </button>
          {showHint && (
            <div style={{ background: "#0a0e1a", borderRadius: 10, padding: 12, fontSize: 11, color: "#94a3b8", border: "1px solid #1e293b" }}>
              {EXEC_USERS.map((u, i) => (
                <div key={i} style={{ marginBottom: i < EXEC_USERS.length - 1 ? 8 : 0, display: "flex", justifyContent: "space-between" }}>
                  <span><User size={11} style={{ display: "inline", verticalAlign: "middle", marginLeft: 4 }} /> {u.role}</span>
                  <span style={{ direction: "ltr", color: "#f59e0b" }}>{u.username} / {u.password}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

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
    id: 1, name: "توسعة 5 محطات جديدة", type: "توسعة",
    investment: 2500000, annualSaving: 850000, roi: 34, payback: "2.9 سنة",
    risk: "متوسط", impact: "زيادة التغطية 40%", recommendation: "موصى به",
    details: "إضافة 5 محطات شفط ذكية في الأحياء الجديدة لتغطية النمو العمراني المتوقع",
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
    details: "إنشاء مركز فرز وإعادة تدوير متكامل مرتبط بمحطات الشفط الذكية",
    pros: ["إيرادات من المواد المعاد تدويرها", "تقليل النفايات 60%", "دعم رؤية 2030"],
    cons: ["يحتاج مساحة كبيرة", "تراخيص بيئية"],
  },
  {
    id: 4, name: "الطاقة الشمسية للمحطات", type: "استدامة",
    investment: 600000, annualSaving: 180000, roi: 30, payback: "3.3 سنة",
    risk: "منخفض", impact: "تقليل استهلاك الكهرباء 70%", recommendation: "اختياري",
    details: "تركيب ألواح شمسية على أسطح المحطات لتشغيلها بالطاقة المتجددة",
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

const ExecDashboard = ({ user, onLogout, stations, monthlyTrend, weeklyData }) => {
  const [tab, setTab] = useState("overview");
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
    { name: "التشغيل", value: 40, color: "#3b82f6" },
    { name: "الصيانة", value: 20, color: "#f59e0b" },
    { name: "الموظفون", value: 25, color: "#8b5cf6" },
    { name: "الوقود", value: 10, color: "#ef4444" },
    { name: "أخرى", value: 5, color: "#64748b" },
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
    { goal: "تغطية 100% من أحياء بريدة", current: 85, target: 100, color: "#f59e0b" },
    { goal: "الوصول لصفر نفايات 2030", current: 42, target: 100, color: "#8b5cf6" },
    { goal: "رضا المواطنين 90%+", current: 82, target: 90, color: "#ec4899" },
    { goal: "إعادة تدوير 80% من النفايات", current: 68, target: 80, color: "#06b6d4" },
  ];

  return (
    <div dir="rtl" style={{ fontFamily: ARABIC_FONT, background: "#070b14", color: C.text, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* Executive Header */}
      <header style={{ padding: isMobile ? "10px 14px" : "12px 28px", background: "linear-gradient(90deg, #111827, #1a1040)", borderBottom: "1px solid #f59e0b30", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "nowrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div style={{ flexShrink: 0 }}><AppLogo size={38} /></div>
          {!isMobile && <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: "#f59e0b" }}>بوابة متخذي القرار</div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>نظام إدارة النفايات - بريدة • <ExecHeaderClock /></div>
          </div>}
          {isMobile && <div style={{ fontSize: 14, fontWeight: 800, color: "#f59e0b", whiteSpace: "nowrap" }}>بوابة القرار</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 10, flexShrink: 0 }}>
          {!isMobile && <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{user.name}</div>
            <div style={{ fontSize: 10, color: "#f59e0b" }}>{user.roleTitle}</div>
          </div>}
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#f59e0b20", display: "flex", alignItems: "center", justifyContent: "center" }}><User size={18} color="#f59e0b" /></div>
          {!isMobile && <button onClick={() => window.__showAdminPanel && window.__showAdminPanel()} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #8b5cf640", background: "#8b5cf615", color: "#8b5cf6", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: ARABIC_FONT, display: "flex", alignItems: "center", gap: 5 }}><Crown size={13} /> إدارة المستخدمين</button>}
          <button onClick={() => setShowPassModal(true)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #10b98140", background: "#10b98115", color: "#10b981", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: ARABIC_FONT, display: "flex", alignItems: "center", gap: 5 }}><SettingsIcon size={13} />{!isMobile && " إعدادات"}</button>
          <button onClick={onLogout} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ef444440", background: "#ef444415", color: "#ef4444", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: ARABIC_FONT, display: "flex", alignItems: "center", gap: 5 }}><LogOut size={13} />{!isMobile && " خروج"}</button>
        </div>
      </header>
      {showPassModal && <ChangePasswordModal onClose={() => setShowPassModal(false)} />}
      <SessionTimeout onLogout={onLogout} timeoutMin={30} countdownSec={10} />

      {/* Tabs */}
      <div style={{ padding: isMobile ? "10px 12px 0" : "12px 28px 0", display: "flex", gap: 6, flexWrap: "wrap", overflowX: "auto" }}>
        {[
          { key: "overview",  label: "نظرة تنفيذية",         icon: <ChartNoAxesCombined size={14} /> },
          { key: "financial", label: "التحليل المالي",        icon: <DollarSign size={14} /> },
          { key: "districts", label: "أداء الأحياء",          icon: <Building size={14} /> },
          { key: "benchmark", label: "المقارنة المعيارية",    icon: <TrendingUp size={14} /> },
          { key: "scenarios", label: "سيناريوهات القرار",    icon: <Target size={14} /> },
          { key: "strategic", label: "الأهداف الاستراتيجية", icon: <MapIcon size={14} /> },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "9px 18px", borderRadius: 10, border: `1px solid ${tab === t.key ? "#f59e0b" : "#1e293b"}`,
            background: tab === t.key ? "#f59e0b18" : "transparent", color: tab === t.key ? "#f59e0b" : "#94a3b8",
            cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: ARABIC_FONT,
            display: "flex", alignItems: "center", gap: 6,
          }}>{t.icon}{t.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px" }}>

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
              <Card title="الأداء الربعي (ر.س)" icon={<BarChart2 size={16} color="#94a3b8" />}>
                <ChartBox height={280}><ResponsiveContainer>
                  <ComposedChart data={quarterlyData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="quarter" tick={{ fill: C.muted, fontSize: 12 }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                    <Bar dataKey="الإيرادات" fill="#f59e0b" radius={[4, 4, 0, 0]} opacity={0.8} />
                    <Bar dataKey="التكاليف" fill="#ef4444" radius={[4, 4, 0, 0]} opacity={0.6} />
                    <Line type="monotone" dataKey="الأرباح" stroke="#10b981" strokeWidth={3} dot={{ r: 5 }} />
                  </ComposedChart>
                </ResponsiveContainer></ChartBox>
              </Card>

              <Card title="رضا المواطنين والشكاوى" icon={<Smile size={16} color="#94a3b8" />}>
                <ChartBox height={280}><ResponsiveContainer>
                  <AreaChart data={satisfactionTrend} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="gSat" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 9, fontFamily: ARABIC_FONT }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                    <Area type="monotone" dataKey="الرضا" stroke="#10b981" fill="url(#gSat)" strokeWidth={2} name="نسبة الرضا %" />
                    <Line type="monotone" dataKey="الشكاوى" stroke="#ef4444" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} name="الشكاوى" />
                  </AreaChart>
                </ResponsiveContainer></ChartBox>
              </Card>
            </div>

            {/* Quick Insights */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 14 }}>
              {[
                { title: "أفضل حي أداءً", value: bestDistrict.district, sub: `${bestDistrict.الأداء}% كفاءة`, icon: <Trophy size={26} color="#10b981" />, color: "#10b981" },
                { title: "حي يحتاج تحسين", value: worstDistrict.district, sub: `${worstDistrict.الأداء}% كفاءة`, icon: <AlertTriangle size={26} color="#ef4444" />, color: "#ef4444" },
                { title: "هامش الربح", value: `${Math.round((totalProfit / totalRevenue) * 100)}%`, sub: "نسبة مئوية سنوية", icon: <TrendingUp size={26} color="#f59e0b" />, color: "#f59e0b" },
                { title: "العائد على الاستثمار", value: "340%", sub: "منذ بداية المشروع", icon: <Target size={26} color="#8b5cf6" />, color: "#8b5cf6" },
              ].map((insight, i) => (
                <div key={i} style={{ background: "#111827", border: `1px solid ${insight.color}30`, borderRadius: 14, padding: 18, display: "flex", gap: 14, alignItems: "center" }}>
                  <div style={{ width: 50, height: 50, borderRadius: 14, background: `${insight.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>{insight.icon}</div>
                  <div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{insight.title}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: insight.color }}>{insight.value}</div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>{insight.sub}</div>
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
              <Card title="العائد على الاستثمار الشهري (ر.س)" icon={<TrendingUp size={16} color="#94a3b8" />}>
                <ChartBox height={300}><ResponsiveContainer>
                  <AreaChart data={roiData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="gROI" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 9, fontFamily: ARABIC_FONT }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                    <Area type="monotone" dataKey="العائد" stroke="#f59e0b" fill="url(#gROI)" strokeWidth={2} />
                    <Line type="monotone" dataKey="الاستثمار" stroke="#ef4444" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                    <Line type="monotone" dataKey="التوفير" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                  </AreaChart>
                </ResponsiveContainer></ChartBox>
              </Card>

              <Card title="توزيع التكاليف التشغيلية" icon={<LucidePieChart size={16} color="#94a3b8" />}>
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

            <Card title="مقارنة التكلفة لكل حي (ر.س/شهر)" icon={<Banknote size={16} color="#94a3b8" />}>
              <ChartBox height={300}><ResponsiveContainer>
                <BarChart data={districtPerf} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="district" tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                  <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="التكلفة" radius={[6, 6, 0, 0]} name="التكلفة الشهرية (ر.س)">
                    {districtPerf.map((e, i) => <Cell key={i} fill={e.التكلفة > 35000 ? "#ef4444" : e.التكلفة > 30000 ? "#f59e0b" : "#10b981"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer></ChartBox>
            </Card>
          </div>
        )}

        {/* ===== DISTRICTS ===== */}
        {tab === "districts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Card title="أداء الأحياء الشامل" icon={<Building size={16} color="#94a3b8" />}>
              <ChartBox height={350}><ResponsiveContainer>
                <BarChart data={districtPerf} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: C.muted, fontSize: 10 }} />
                  <YAxis dataKey="district" type="category" width={60} tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                  <Bar dataKey="الأداء" fill="#3b82f6" radius={[0, 4, 4, 0]} opacity={0.8} name="الأداء %" />
                  <Bar dataKey="الرضا" fill="#10b981" radius={[0, 4, 4, 0]} opacity={0.8} name="الرضا %" />
                </BarChart>
              </ResponsiveContainer></ChartBox>
            </Card>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
              <Card title="الأداء مقابل الرضا" icon={<Target size={16} color="#94a3b8" />}>
                <ChartBox height={280}><ResponsiveContainer>
                  <RadarChart cx="50%" cy="50%" outerRadius="70%" data={districtPerf.slice(0, 8)}>
                    <PolarGrid stroke={C.border} />
                    <PolarAngleAxis dataKey="district" tick={{ fill: C.muted, fontSize: 9, fontFamily: ARABIC_FONT }} />
                    <PolarRadiusAxis tick={{ fill: "#64748b", fontSize: 8 }} />
                    <Radar name="الأداء" dataKey="الأداء" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
                    <Radar name="الرضا" dataKey="الرضا" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
                    <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                  </RadarChart>
                </ResponsiveContainer></ChartBox>
              </Card>

              <Card title="عدد الحوادث لكل حي" icon={<AlertTriangle size={16} color="#94a3b8" />}>
                <ChartBox height={280}><ResponsiveContainer>
                  <BarChart data={[...districtPerf].sort((a, b) => b.الحوادث - a.الحوادث)} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="district" tick={{ fill: C.muted, fontSize: 9, fontFamily: ARABIC_FONT }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="الحوادث" radius={[6, 6, 0, 0]} name="عدد الحوادث">
                      {districtPerf.map((e, i) => <Cell key={i} fill={e.الحوادث > 5 ? "#ef4444" : e.الحوادث > 2 ? "#f59e0b" : "#10b981"} />)}
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
            <Card title="المقارنة المعيارية - بريدة مقابل المعايير الوطنية" icon={<TrendingUp size={16} color="#94a3b8" />}>
              <ChartBox height={350}><ResponsiveContainer>
                <BarChart data={benchmarkData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="metric" tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                  <YAxis tick={{ fill: C.muted, fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                  <Bar dataKey="بريدة" fill="#f59e0b" radius={[4, 4, 0, 0]} name="بريدة" />
                  <Bar dataKey="المعيار_الوطني" fill="#64748b" radius={[4, 4, 0, 0]} opacity={0.6} name="المعيار الوطني" />
                  <Bar dataKey="أفضل_ممارسة" fill="#10b981" radius={[4, 4, 0, 0]} opacity={0.5} name="أفضل ممارسة عالمية" />
                </BarChart>
              </ResponsiveContainer></ChartBox>
            </Card>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
              {benchmarkData.map((b, i) => {
                const gap = b.أفضل_ممارسة - b.بريدة;
                return (
                  <div key={i} style={{ background: "#111827", border: `1px solid #1e293b`, borderRadius: 14, padding: 18 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 10 }}>{b.metric}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 32, fontWeight: 900, color: "#f59e0b" }}>{b.بريدة}%</span>
                      <span style={{ fontSize: 12, color: gap <= 5 ? "#10b981" : gap <= 15 ? "#f59e0b" : "#ef4444" }}>
                        {gap <= 5 ? "✓ ممتاز" : gap <= 15 ? "↗ جيد" : "↑ يحتاج تحسين"} (فجوة {gap}%)
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 10, fontSize: 11 }}>
                      <span style={{ color: "#64748b" }}>الوطني: {b.المعيار_الوطني}%</span>
                      <span style={{ color: "#10b981" }}>الأفضل: {b.أفضل_ممارسة}%</span>
                    </div>
                    <div style={{ width: "100%", height: 8, background: "#0a0e1a", borderRadius: 4, marginTop: 8, overflow: "hidden", position: "relative" }}>
                      <div style={{ position: "absolute", width: `${b.المعيار_الوطني}%`, height: "100%", background: "#64748b40", borderRadius: 4 }} />
                      <div style={{ position: "absolute", width: `${b.بريدة}%`, height: "100%", background: "#f59e0b", borderRadius: 4 }} />
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
            <div style={{ background: "#111827", border: "1px solid #f59e0b30", borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f59e0b", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}><Target size={16} color="#f59e0b" /> أداة دعم القرار</div>
              <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, lineHeight: 1.7 }}>
                استعرض السيناريوهات المختلفة مع تحليل العائد والمخاطر لكل خيار. اضغط على أي سيناريو لعرض التفاصيل الكاملة والتوصيات.
              </p>
            </div>

            {selectedScenario ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <button onClick={() => setSelectedScenario(null)} style={{ alignSelf: "flex-start", padding: "6px 16px", borderRadius: 8, border: "1px solid #1e293b", background: "transparent", color: "#f59e0b", cursor: "pointer", fontSize: 13, fontFamily: ARABIC_FONT }}>
                  ← العودة
                </button>
                <div style={{ background: "#111827", border: "1px solid #f59e0b30", borderRadius: 16, padding: 28 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <div>
                      <h2 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: "0 0 4px 0" }}>{selectedScenario.name}</h2>
                      <span style={{ fontSize: 12, color: "#f59e0b" }}>{selectedScenario.type}</span>
                    </div>
                    <span style={{ padding: "6px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                      background: selectedScenario.recommendation === "موصى به بشدة" ? "#10b98120" : selectedScenario.recommendation === "موصى به" ? "#f59e0b20" : "#64748b20",
                      color: selectedScenario.recommendation === "موصى به بشدة" ? "#10b981" : selectedScenario.recommendation === "موصى به" ? "#f59e0b" : "#94a3b8",
                      border: `1px solid ${selectedScenario.recommendation === "موصى به بشدة" ? "#10b98140" : "#f59e0b40"}`
                    }}>{selectedScenario.recommendation}</span>
                  </div>

                  <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.8, margin: "0 0 24px 0" }}>{selectedScenario.details}</p>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14, marginBottom: 24 }}>
                    {[
                      { label: "الاستثمار المطلوب", val: `${(selectedScenario.investment / 1000000).toFixed(1)}M ر.س`, color: "#ef4444", icon: <DollarSign size={22} color="#ef4444" /> },
                      { label: "التوفير السنوي", val: `${(selectedScenario.annualSaving / 1000).toFixed(0)}K ر.س`, color: "#10b981", icon: <TrendingUp size={22} color="#10b981" /> },
                      { label: "العائد ROI", val: `${selectedScenario.roi}%`, color: "#f59e0b", icon: <TrendingUp size={22} color="#f59e0b" /> },
                      { label: "فترة الاسترداد", val: selectedScenario.payback, color: "#3b82f6", icon: <Clock size={22} color="#3b82f6" /> },
                      { label: "مستوى المخاطرة", val: selectedScenario.risk, color: selectedScenario.risk === "منخفض" ? "#10b981" : "#f59e0b", icon: <Zap size={22} color={selectedScenario.risk === "منخفض" ? "#10b981" : "#f59e0b"} /> },
                      { label: "الأثر المتوقع", val: selectedScenario.impact, color: "#8b5cf6", icon: <Target size={22} color="#8b5cf6" /> },
                    ].map((item, i) => (
                      <div key={i} style={{ background: "#070b14", borderRadius: 12, padding: 16, textAlign: "center" }}>
                        <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>{item.icon}</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: item.color }}>{item.val}</div>
                        <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>{item.label}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
                    <div style={{ background: "#10b98110", border: "1px solid #10b98130", borderRadius: 12, padding: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#10b981", marginBottom: 10 }}>✅ المميزات</div>
                      {selectedScenario.pros.map((p, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6, display: "flex", gap: 6 }}>
                          <span style={{ color: "#10b981" }}>●</span> {p}
                        </div>
                      ))}
                    </div>
                    <div style={{ background: "#ef444410", border: "1px solid #ef444430", borderRadius: 12, padding: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#ef4444", marginBottom: 10 }}>⚠️ التحديات</div>
                      {selectedScenario.cons.map((c, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6, display: "flex", gap: 6 }}>
                          <span style={{ color: "#ef4444" }}>●</span> {c}
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
                    background: "#111827", border: "1px solid #1e293b", borderRadius: 14, padding: 20, cursor: "pointer", transition: "all 0.2s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#f59e0b60"; e.currentTarget.style.transform = "translateY(-3px)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.transform = "translateY(0)"; }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 11, color: "#f59e0b", background: "#f59e0b15", padding: "3px 10px", borderRadius: 6, fontWeight: 600 }}>{s.type}</span>
                      <span style={{ fontSize: 11, color: s.recommendation.includes("بشدة") ? "#10b981" : "#f59e0b", fontWeight: 600 }}>{s.recommendation}</span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 8 }}>{s.name}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8, fontSize: 11 }}>
                      <div style={{ color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}><DollarSign size={11} /> استثمار: <span style={{ color: C.text }}>{(s.investment / 1000000).toFixed(1)}M</span></div>
                      <div style={{ color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}><TrendingUp size={11} /> ROI: <span style={{ color: "#f59e0b", fontWeight: 700 }}>{s.roi}%</span></div>
                      <div style={{ color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}><Clock size={11} /> استرداد: <span style={{ color: C.text }}>{s.payback}</span></div>
                      <div style={{ color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}><Zap size={11} /> خطر: <span style={{ color: s.risk === "منخفض" ? "#10b981" : "#f59e0b" }}>{s.risk}</span></div>
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
            <div style={{ background: "linear-gradient(135deg, #111827, #1a1040)", border: "1px solid #f59e0b20", borderRadius: 16, padding: 24 }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#f59e0b", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><MapIcon size={20} color="#f59e0b" /> الخطة الاستراتيجية - رؤية 2030</div>
              <p style={{ fontSize: 13, color: "#94a3b8", margin: 0, lineHeight: 1.8 }}>
                متابعة التقدم نحو الأهداف الاستراتيجية لنظام إدارة النفايات الذكي في مدينة بريدة، 
                بما يتوافق مع أهداف رؤية المملكة 2030 في الاستدامة البيئية وجودة الحياة.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
              {strategicGoals.map((g, i) => {
                const pct = Math.round((g.current / g.target) * 100);
                const status = pct >= 90 ? "على المسار" : pct >= 70 ? "تقدم جيد" : "يحتاج تسريع";
                const statusColor = pct >= 90 ? "#10b981" : pct >= 70 ? "#f59e0b" : "#ef4444";
                return (
                  <div key={i} style={{ background: "#111827", border: `1px solid ${g.color}25`, borderRadius: 16, padding: 20 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{g.goal}</span>
                      <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: `${statusColor}15`, color: statusColor, fontWeight: 600 }}>{status}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 10 }}>
                      <span style={{ fontSize: 36, fontWeight: 900, color: g.color }}>{g.current}</span>
                      <span style={{ fontSize: 14, color: "#64748b" }}>/ {g.target}</span>
                    </div>
                    <div style={{ width: "100%", height: 12, background: "#070b14", borderRadius: 6, overflow: "hidden", marginBottom: 8 }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${g.color}80, ${g.color})`, borderRadius: 6, transition: "width 1.5s ease" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b" }}>
                      <span>التقدم: {pct}%</span>
                      <span>المتبقي: {g.target - g.current}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Vision 2030 Alignment */}
            <Card title="التوافق مع رؤية 2030" icon={<Flag size={16} color="#94a3b8" />}>
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
                  <PolarRadiusAxis tick={{ fill: "#64748b", fontSize: 8 }} domain={[0, 100]} />
                  <Radar name="الوضع الحالي" dataKey="الحالي" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.25} strokeWidth={2} />
                  <Radar name="المستهدف 2030" dataKey="المستهدف" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} strokeDasharray="6 3" />
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
    if (role === "employee" || role === "executive") {
      const critical  = stations.filter(s => getStatus(s.fillLevel) === "حرج");
      const warning   = stations.filter(s => getStatus(s.fillLevel) === "تحذير");
      const normal    = stations.filter(s => getStatus(s.fillLevel) === "طبيعي");
      const activeJobs = suctionJobs.filter(j => j.status === "نشط" || j.status === "جاري");
      return `أنت مساعد ذكي لنظام إدارة النفايات الذكي في مدينة بريدة، منطقة القصيم.
وقت الآن: ${now}
دورك: تساعد الموظفين والمدراء على فهم البيانات واتخاذ القرارات.

=== البيانات الحالية للنظام ===
إجمالي المحطات: ${stations.length}
• حرجة (≥85%): ${critical.length} محطة ${critical.length > 0 ? "— " + critical.map(s => `${s.name} (${s.fillLevel}%)`).join("، ") : ""}
• تحذير (60-84%): ${warning.length} محطة ${warning.length > 0 ? "— " + warning.map(s => `${s.name} (${s.fillLevel}%)`).join("، ") : ""}
• طبيعية (<60%): ${normal.length} محطة

التنبيهات النشطة: ${alerts.filter(a => a.type === "حرج").length} حرجة، ${alerts.filter(a => a.type === "تحذير").length} تحذير
أوامر الشفط النشطة: ${activeJobs.length}

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

  const greeting = role === "employee" || role === "executive"
    ? "مرحباً! أنا مساعدك الذكي. اسألني عن حالة المحطات، التنبيهات، أوامر الشفط، أو أي شيء آخر."
    : "أهلاً! أنا مساعدك في بوابة الأفراد. اسألني عن طلباتك أو وضع حيّك.";

  const suggestions = role === "employee" || role === "executive"
    ? ["أي محطة تحتاج شفط الآن؟", "لخص التنبيهات النشطة", "ما وضع المحطات الحرجة؟"]
    : ["وش حالة طلباتي؟", "متى يجي الشفط لحينا؟", "كيف أرفع بلاغ؟"];

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
              {role === "employee" || role === "executive" ? "مساعد الموظف — يقرأ بيانات النظام" : "مساعد الأفراد — بوابة بريدة"}
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Greeting */}
            <div style={{ alignSelf: "flex-start", maxWidth: "85%", background: "#1e293b", borderRadius: "12px 12px 12px 0", padding: "10px 14px", fontSize: 12, color: C.text, lineHeight: 1.6 }}>
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
                background: m.role === "user" ? "linear-gradient(135deg,#6d28d9,#4c1d95)" : "#1e293b",
                borderRadius: m.role === "user" ? "12px 12px 0 12px" : "12px 12px 12px 0",
                padding: "10px 14px", fontSize: 12, color: "#f1f5f9", lineHeight: 1.7,
                whiteSpace: "pre-wrap",
              }}>
                {m.content}
              </div>
            ))}

            {loading && (
              <div style={{ alignSelf: "flex-start", background: "#1e293b", borderRadius: "12px 12px 12px 0", padding: "10px 14px", fontSize: 12, color: "#a78bfa" }}>
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

const CitizenPortal = ({ user, onLogout, stations }) => {
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
      await addCitizenReport({
        userId:      user.uid,
        userName:    user.name,
        district:    user.district,
        type:        reportType,
        description: reportDesc.trim(),
        location:    `${user.district} - بريدة`,
      });
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
          <button onClick={() => setShowPassModal(true)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid #10b98140`, background: `#10b98115`, color: "#10b981", cursor: "pointer", fontSize: 11, fontFamily: ARABIC_FONT, fontWeight: 600 }}>⚙️ إعدادات الحساب</button>
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
                { label: "متابعة محطة الحي",    desc: "شاهد حالة محطة الشفط في حيك",         icon: <BarChart2 size={32} color={C.info} />, color: C.info,    action: () => setTab("station") },
                { label: "عرض حاويات الحي",    desc: "تابع حالة الحاويات في محطة حيك",       icon: <Trash2 size={32} color="#8b5cf6" />, color: "#8b5cf6", action: () => setTab("bins") },
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
                          { label: "نوع الحاوية",   val: bin.binType,                                             icon: <Recycle size={18} color="#94a3b8" /> },
                          { label: "الحي",          val: bin.district,                                            icon: <MapPin size={18} color="#94a3b8" /> },
                          { label: "تاريخ الموافقة", val: approvedAt ? new Date(approvedAt).toLocaleDateString("ar-SA") : "—", icon: <Calendar size={18} color="#94a3b8" /> },
                          { label: "رقم الطلب",     val: bin.id.slice(0, 8),                                      icon: <Bookmark size={18} color="#94a3b8" /> },
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
                <Card title={`حاويات المحطة (${myContainers.length})`} icon={<Trash2 size={16} color="#94a3b8" />}>
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
              <Card title="طلب حاوية جديدة" icon={<FileText size={16} color="#94a3b8" />}>
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
              <Card title="إبلاغ عن مشكلة" icon={<AlertTriangle size={16} color="#94a3b8" />}>
                {reportDone?.error && (
                  <div style={{ background: C.danger + "20", border: `1px solid ${C.danger}40`, borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: C.danger }}>
                    ❌ خطأ: <strong>{reportDone.error}</strong>
                  </div>
                )}
                <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.7, margin: "0 0 20px" }}>
                  أبلغ عن أي مشكلة متعلقة بالحاويات أو محطة الشفط في حيك وسيتم التعامل معها بأسرع وقت.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 12, color: C.muted, marginBottom: 6, display: "block" }}>نوع المشكلة *</label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {["حاوية ممتلئة", "حاوية تالفة", "رائحة كريهة", "حشرات", "تسرب سوائل", "عطل في المحطة", "أخرى"].map(t => (
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
  { username: "emp2", password: "emp123", name: "خالد الدوسري", role: "employee", roleTitle: "مشرف محطات", avatar: "🔧" },
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
    { key: "employee", label: "الموظفين", icon: "👷", desc: "لوحة تحكم التشغيل والمراقبة", color: "#10b981", gradient: "linear-gradient(135deg, #10b981, #059669)" },
    { key: "executive", label: "الإدارة العليا", icon: "🏛️", desc: "بوابة متخذي القرار والتقارير التنفيذية", color: "#f59e0b", gradient: "linear-gradient(135deg, #f59e0b, #d97706)" },
    { key: "citizen", label: "الأفراد", icon: "🏠", desc: "طلب حاويات، إبلاغ عن مشاكل، متابعة الحي", color: "#3b82f6", gradient: "linear-gradient(135deg, #3b82f6, #1d4ed8)" },
  ];

  const filteredHints = selectedRole ? ALL_USERS.filter(u => u.role === selectedRole) : ALL_USERS;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0e1a 0%, #0f172a 50%, #0a0e1a 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: ARABIC_FONT, direction: "rtl", padding: "16px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <div style={{ width: "100%", maxWidth: 480, padding: "clamp(20px, 5vw, 36px)", background: "#111827", borderRadius: 24, border: "1px solid #1e293b", position: "relative", overflow: "hidden" }}>
        {/* Decorative */}
        <div style={{ position: "absolute", top: -80, left: "50%", transform: "translateX(-50%)", width: 250, height: 250, background: "radial-gradient(circle, #10b98115, transparent)", borderRadius: "50%" }} />

        <div style={{ textAlign: "center", marginBottom: 28, position: "relative" }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, background: "linear-gradient(135deg, #10b981, #059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 14px" }}>♻️</div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: "#f1f5f9", margin: "0 0 4px" }}>نظام إدارة النفايات الذكي</h1>
          <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>مدينة بريدة - منطقة القصيم</p>
        </div>

        {/* Role Selection */}
        {!selectedRole ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "relative" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8", textAlign: "center", marginBottom: 4 }}>اختر نوع الحساب</div>
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
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9" }}>دخول {r.label}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{r.desc}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "relative" }}>
            <button onClick={() => { setSelectedRole(null); setError(""); setUsername(""); setPassword(""); }} style={{ alignSelf: "flex-start", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 12, fontFamily: ARABIC_FONT, padding: 0 }}>
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
              <label style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6, display: "block" }}>اسم المستخدم</label>
              <input value={username} onChange={e => setUsername(e.target.value)} placeholder="أدخل اسم المستخدم"
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: "1px solid #334155", background: "#0a0e1a", color: "#f1f5f9", fontSize: 14, fontFamily: ARABIC_FONT, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6, display: "block" }}>كلمة المرور</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="أدخل كلمة المرور"
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: "1px solid #334155", background: "#0a0e1a", color: "#f1f5f9", fontSize: 14, fontFamily: ARABIC_FONT, outline: "none", boxSizing: "border-box" }} />
            </div>

            {error && <div style={{ fontSize: 12, color: "#ef4444", background: "#ef444415", padding: "8px 12px", borderRadius: 8, textAlign: "center" }}>⚠️ {error}</div>}

            <button onClick={handleLogin} style={{
              padding: "14px", borderRadius: 12, border: "none",
              background: roleCards.find(r => r.key === selectedRole)?.gradient,
              color: "#000", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: ARABIC_FONT,
            }}>تسجيل الدخول</button>

            <button onClick={() => setShowHint(!showHint)} style={{ background: "none", border: "none", color: "#64748b", fontSize: 11, cursor: "pointer", fontFamily: ARABIC_FONT }}>
              {showHint ? "إخفاء بيانات الدخول" : "عرض بيانات الدخول التجريبية"}
            </button>
            {showHint && (
              <div style={{ background: "#0a0e1a", borderRadius: 10, padding: 12, fontSize: 11, color: "#94a3b8", border: "1px solid #1e293b" }}>
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
  const [page, setPage] = useState("dashboard");
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

  // ── Analytics من Firestore (مع fallback للبيانات الافتراضية) ──────
  const { data: _wDoc  } = useAnalyticsDoc("weekly");
  const { data: _mDoc  } = useAnalyticsDoc("monthly");
  const { data: _hDoc  } = useAnalyticsDoc("hourly");
  const { data: _ftDoc } = useAnalyticsDoc("fire_temp");
  const { data: _fwDoc } = useAnalyticsDoc("fire_weekly");
  const { data: _shDoc } = useAnalyticsDoc("station_history");
  const { data: _fsCol } = useCollection("fire_sensors", null);

  const weeklyData               = _wDoc?.data   || generateWeeklyData();
  const monthlyTrend             = _mDoc?.data   || generateMonthlyTrend();
  const hourlyData               = _hDoc?.data   || generateHourlyData();
  const fireTempHistory          = _ftDoc?.data  || generateTempHistory();
  const fireWeeklyData           = _fwDoc?.data  || generateWeeklyFireIncidents();
  const stationHistoryByDistrict = _shDoc?.data  || {};
  const fireSensors              = _fsCol        || [];

  // أوامر الشفط (للمساعد الذكي)
  const { data: suctionJobs } = useCollection(COLLECTIONS.SUCTION_JOBS);

  // ✅ التنبيهات مشتقة من بيانات المحطات الحقيقية
  const alerts = useMemo(() => generateAlerts(stations), [stations]);

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
  const loggedInUser = userData ? {
    uid: authUser?.uid || "",
    name: userData.fullName,
    email: userData.email,
    role: userData.role,
    roleTitle: userData.roleAr || (userData.role === "executive" ? "إدارة عليا" : userData.role === "employee" ? "موظف" : "مواطن"),
    district: userData.district || "حي الخليج",
    avatar: userData.role === "executive" ? "🏛️" : userData.role === "employee" ? "👷" : "🏠",
  } : null;

  if (!loggedInUser) return null;

  const handleLogout = () => { logout(); };

  if (loadingStations) return <LoadingScreen />;

  // Citizen portal
  if (loggedInUser.role === "citizen") {
    return <CitizenPortal user={loggedInUser} onLogout={handleLogout} stations={stations} />;
  }

  // Executive portal
  if (loggedInUser.role === "executive") {
    return <ExecDashboard user={loggedInUser} onLogout={handleLogout} stations={stations} monthlyTrend={monthlyTrend} weeklyData={weeklyData} />;
  }

  // Employee portal (default operational dashboard)
  const navItems = [
    { key: "dashboard", label: "لوحة التحكم",       icon: <LayoutDashboard size={20} /> },
    { key: "stations",  label: "المحطات",             icon: <Factory size={20} /> },
    { key: "control",   label: "وحدة التحكم",         icon: <Sliders size={20} /> },
    { key: "requests",  label: "الطلبات والبلاغات",   icon: <Inbox size={20} /> },
    { key: "fire",      label: "إنذار الحرائق",       icon: <Flame size={20} /> },
    { key: "predictions", label: "التنبؤات",          icon: <Sparkles size={20} /> },
    { key: "reports",   label: "التقارير",             icon: <ClipboardList size={20} /> },
    { key: "settings",  label: "الإعدادات",            icon: <SettingsIcon size={20} /> },
  ];

  return (
    <div dir="rtl" style={{ fontFamily: ARABIC_FONT, background: C.bg, color: C.text, minHeight: "100vh", display: "flex", overflow: "hidden" }}>
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
        background: C.card,
        borderLeft: `1px solid ${C.border}`,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        transition: "transform 0.3s ease",
        // Desktop: shrink to 64px when closed; Mobile: slide off-screen (fixed overlay)
        ...(isMobile ? {
          position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 50,
          transform: sidebarOpen ? "translateX(0)" : "translateX(100%)",
          boxShadow: sidebarOpen ? "-8px 0 32px #0008" : "none",
        } : {
          width: sidebarOpen ? 240 : 64,
          position: "relative",
          transform: "none",
          overflow: "hidden",
        }),
      }}>
        <div style={{ padding: "20px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, minHeight: 70 }}>
          <div style={{ flexShrink: 0 }}><AppLogo size={40} /></div>
          {(sidebarOpen || isMobile) && <div style={{ overflow: "hidden" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.text, whiteSpace: "nowrap" }}>إدارة النفايات - بريدة</div>
            <div style={{ fontSize: 10, color: C.accent, fontWeight: 600 }}>Smart Waste MIS</div>
          </div>}
          {isMobile && (
            <button onClick={() => setSidebarOpen(false)} style={{ marginRight: "auto", background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer", padding: 4 }}>✕</button>
          )}
        </div>

        <nav style={{ flex: 1, padding: "12px 8px", display: "flex", flexDirection: "column", gap: 4, overflowY: "auto" }}>
          {navItems.map((item) => (
            <button key={item.key} onClick={() => { setPage(item.key); if (isMobile) setSidebarOpen(false); }} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: (sidebarOpen || isMobile) ? "12px 14px" : "12px 0",
              justifyContent: (sidebarOpen || isMobile) ? "flex-start" : "center",
              borderRadius: 10, border: "none",
              background: page === item.key ? C.accent + "18" : "transparent",
              color: page === item.key ? C.accent : C.muted,
              cursor: "pointer", fontSize: 14, fontWeight: page === item.key ? 700 : 500,
              fontFamily: ARABIC_FONT, whiteSpace: "nowrap", width: "100%",
            }}>
              <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>{item.icon}</span>
              {(sidebarOpen || isMobile) && item.label}
            </button>
          ))}
        </nav>

        {/* User info + logout */}
        <div style={{ padding: "12px 8px", borderTop: `1px solid ${C.border}` }}>
          {(sidebarOpen || isMobile) && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginBottom: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: C.accent + "20", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><User size={16} color={C.accent} /></div>
              <div style={{ overflow: "hidden" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{loggedInUser.name}</div>
                <div style={{ fontSize: 10, color: C.accent }}>{loggedInUser.roleTitle}</div>
              </div>
            </div>
          )}
          <button onClick={() => { setShowPassModal(true); if (isMobile) setSidebarOpen(false); }} style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%",
            padding: (sidebarOpen || isMobile) ? "10px 14px" : "10px 0",
            justifyContent: (sidebarOpen || isMobile) ? "flex-start" : "center",
            borderRadius: 10, marginBottom: 6,
            border: `1px solid #10b98130`, background: `#10b98110`, color: "#10b981",
            cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: ARABIC_FONT,
          }}>
            <SettingsIcon size={16} color="#10b981" />
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
                {navItems.find((n) => n.key === page)?.label}
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
                    <button onClick={() => setShowNotifications(false)} style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", display:"flex", padding:2 }}><X size={15}/></button>
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
          {page === "dashboard"  && <DashboardPage stations={stations} weeklyData={weeklyData} monthlyTrend={monthlyTrend} alerts={alerts} hourlyData={hourlyData} />}
          {page === "stations"   && <StationsPage stations={stations} stationHistoryByDistrict={stationHistoryByDistrict} />}
          {page === "control"    && <SuctionControlPage stations={stations} user={loggedInUser} />}
          {page === "requests"   && <RequestsManagementPage />}
          {page === "fire"       && <FireAlertPage stations={stations} fireSensors={fireSensors} fireTempHistory={fireTempHistory} fireWeekly={fireWeeklyData} />}
          {page === "predictions" && <PredictionsPage stations={stations} />}
          {page === "reports"    && <ReportsPage stations={stations} monthlyTrend={monthlyTrend} weeklyData={weeklyData} />}
          {page === "settings"   && <SettingsPage />}
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
    <div dir="rtl" style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0a0e1a,#1a1040,#0a0e1a)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:F }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <div style={{ width:"100%", maxWidth:460, padding:"clamp(20px,5vw,40px)", background:"#111827", borderRadius:24, border:"1px solid #f59e0b30", textAlign:"center" }}>
        <div style={{ width:80, height:80, borderRadius:20, background:"#f59e0b15", display:"flex", alignItems:"center", justifyContent:"center", fontSize:42, margin:"0 auto 20px", border:"2px solid #f59e0b30" }}>⏳</div>
        <h2 style={{ fontSize:22, fontWeight:900, color:"#f1f5f9", margin:"0 0 10px" }}>بانتظار الموافقة</h2>
        <p style={{ fontSize:14, color:"#94a3b8", lineHeight:1.8, margin:"0 0 20px" }}>
          تم إنشاء حسابك بنجاح كـ <span style={{ color:"#f59e0b", fontWeight:700 }}>{userData?.roleAr}</span>
          <br />حسابك قيد المراجعة من الإدارة. ستتمكن من الدخول بعد الموافقة.
        </p>
        <div style={{ background:"#0a0e1a", borderRadius:12, padding:16, marginBottom:20, textAlign:"right" }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8, fontSize:13 }}>
            <span style={{ color:"#64748b" }}>الاسم:</span>
            <span style={{ color:"#f1f5f9", fontWeight:600 }}>{userData?.fullName}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8, fontSize:13 }}>
            <span style={{ color:"#64748b" }}>البريد:</span>
            <span style={{ color:"#f1f5f9", fontWeight:600 }}>{userData?.email}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8, fontSize:13 }}>
            <span style={{ color:"#64748b" }}>الدور المطلوب:</span>
            <span style={{ color:"#f59e0b", fontWeight:600 }}>{userData?.roleAr}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:13 }}>
            <span style={{ color:"#64748b" }}>الحالة:</span>
            <span style={{ color:"#f59e0b", fontWeight:600 }}>⏳ بانتظار الموافقة</span>
          </div>
        </div>
        <button onClick={logout} style={{ padding:"12px 30px", borderRadius:10, border:"1px solid #ef444440", background:"#ef444415", color:"#ef4444", cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:F }}>
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
    const roleAr = newRole === "executive" ? "إدارة عليا" : newRole === "employee" ? "موظف" : "مواطن";
    await updateDoc(doc(db, "users", uid), { role: newRole, roleAr, updatedAt: new Date().toISOString() });
    setActionMsg("✅ تم تغيير الدور بنجاح");
    setTimeout(() => setActionMsg(""), 3000);
    fetchUsers();
  };

  const updateUserStatus = async (uid, newStatus) => {
    await updateDoc(doc(db, "users", uid), { status: newStatus, updatedAt: new Date().toISOString() });
    setActionMsg(newStatus === "active" ? "✅ تم تفعيل الحساب" : "⛔ تم تعطيل الحساب");
    setTimeout(() => setActionMsg(""), 3000);
    fetchUsers();
  };

  const approveUser = async (uid) => {
    await updateDoc(doc(db, "users", uid), { status: "active", updatedAt: new Date().toISOString() });
    setActionMsg("✅ تم قبول المستخدم");
    setTimeout(() => setActionMsg(""), 3000);
    fetchUsers();
  };

  const rejectUser = async (uid) => {
    await updateDoc(doc(db, "users", uid), { status: "rejected", updatedAt: new Date().toISOString() });
    setActionMsg("❌ تم رفض المستخدم");
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
    const map = { active: { label: "نشط", bg: "#10b98120", color: "#10b981" }, pending: { label: "بانتظار", bg: "#f59e0b20", color: "#f59e0b" }, suspended: { label: "معطّل", bg: "#ef444420", color: "#ef4444" }, rejected: { label: "مرفوض", bg: "#64748b20", color: "#64748b" } };
    const s = map[status] || map.suspended;
    return <span style={{ padding:"3px 10px", borderRadius:20, fontSize:10, fontWeight:600, background:s.bg, color:s.color }}>{s.label}</span>;
  };

  const roleBadge = (role) => {
    const map = { executive: { label: "إدارة عليا", bg: "#f59e0b20", color: "#f59e0b" }, employee: { label: "موظف", bg: "#3b82f620", color: "#3b82f6" }, citizen: { label: "مواطن", bg: "#10b98120", color: "#10b981" } };
    const r = map[role] || map.citizen;
    return <span style={{ padding:"3px 10px", borderRadius:20, fontSize:10, fontWeight:600, background:r.bg, color:r.color }}>{r.label}</span>;
  };

  return (
    <div dir="rtl" style={{ minHeight:"100vh", background:"#070b14", fontFamily:F, color:"#f1f5f9" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* Header */}
      <header style={{ padding:"14px 28px", background:"linear-gradient(90deg,#111827,#1a1040)", borderBottom:"1px solid #8b5cf630", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ width:42, height:42, borderRadius:12, background:"linear-gradient(135deg,#8b5cf6,#6d28d9)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>👑</div>
          <div>
            <div style={{ fontSize:16, fontWeight:900, color:"#8b5cf6" }}>لوحة إدارة النظام</div>
            <div style={{ fontSize:10, color:"#94a3b8" }}>إدارة المستخدمين والصلاحيات</div>
          </div>
        </div>
        <button onClick={onBack} style={{ padding:"8px 18px", borderRadius:8, border:"1px solid #1e293b", background:"transparent", color:"#94a3b8", cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:F }}>← العودة للوحة الرئيسية</button>
      </header>

      <div style={{ padding:"20px 28px" }}>
        {/* Action Message */}
        {actionMsg && <div style={{ padding:"12px 18px", borderRadius:10, background:"#10b98115", border:"1px solid #10b98130", color:"#10b981", fontSize:13, fontWeight:600, marginBottom:16, textAlign:"center" }}>{actionMsg}</div>}

        {/* Stats */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))", gap:12, marginBottom:20 }}>
          {[
            { label: "إجمالي المستخدمين", val: stats.total, icon: "👥", color: "#8b5cf6" },
            { label: "نشط", val: stats.active, icon: "✅", color: "#10b981" },
            { label: "بانتظار الموافقة", val: stats.pending, icon: "⏳", color: "#f59e0b" },
            { label: "إدارة عليا", val: stats.executives, icon: "🏛️", color: "#f59e0b" },
            { label: "موظفون", val: stats.employees, icon: "👷", color: "#3b82f6" },
            { label: "مواطنون", val: stats.citizens, icon: "🏠", color: "#10b981" },
          ].map((s, i) => (
            <div key={i} style={{ background:"#111827", border:`1px solid ${s.color}25`, borderRadius:14, padding:16, textAlign:"center" }}>
              <div style={{ fontSize:24, marginBottom:4 }}>{s.icon}</div>
              <div style={{ fontSize:24, fontWeight:900, color:s.color }}>{s.val}</div>
              <div style={{ fontSize:11, color:"#64748b" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Pending Approvals */}
        {pendingUsers.length > 0 && (
          <div style={{ background:"#111827", border:"1px solid #f59e0b30", borderRadius:16, padding:20, marginBottom:20 }}>
            <div style={{ fontSize:15, fontWeight:700, color:"#f59e0b", marginBottom:14 }}>⏳ طلبات بانتظار الموافقة ({pendingUsers.length})</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {pendingUsers.map(u => (
                <div key={u.id} style={{ background:"#0a0e1a", borderRadius:12, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", border:"1px solid #1e293b" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ width:40, height:40, borderRadius:10, background:"#f59e0b15", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>
                      {u.role === "executive" ? "🏛️" : "👷"}
                    </div>
                    <div>
                      <div style={{ fontSize:14, fontWeight:700, color:"#f1f5f9" }}>{u.fullName}</div>
                      <div style={{ fontSize:11, color:"#64748b" }}>{u.email} • يطلب: <span style={{ color:"#f59e0b" }}>{u.roleAr}</span> • {u.district || "بدون حي"}</div>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={() => approveUser(u.id)} style={{ padding:"8px 18px", borderRadius:8, border:"none", background:"#10b981", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:700, fontFamily:F }}>✅ قبول</button>
                    <button onClick={() => rejectUser(u.id)} style={{ padding:"8px 18px", borderRadius:8, border:"none", background:"#ef4444", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:700, fontFamily:F }}>❌ رفض</button>
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
              padding:"7px 16px", borderRadius:10, border:`1px solid ${filter===f ? "#8b5cf6" : "#1e293b"}`,
              background: filter===f ? "#8b5cf620" : "transparent", color: filter===f ? "#8b5cf6" : "#94a3b8",
              cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:F,
            }}>{f}{f==="بانتظار" && stats.pending > 0 ? ` (${stats.pending})` : ""}</button>
          ))}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 بحث بالاسم أو البريد..." style={{ flex:1, minWidth:200, padding:"8px 14px", borderRadius:10, border:"1px solid #1e293b", background:"#0a0e1a", color:"#f1f5f9", fontSize:12, fontFamily:F, outline:"none" }} />
        </div>

        {/* Users Table */}
        <div style={{ background:"#111827", borderRadius:16, border:"1px solid #1e293b", overflow:"hidden" }}>
          {loadingUsers ? (
            <div style={{ padding:40, textAlign:"center", color:"#64748b" }}>جاري التحميل...</div>
          ) : (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead>
                  <tr>
                    {["الاسم", "البريد", "الدور", "الحي", "الحالة", "تاريخ التسجيل", "الإجراءات"].map(h => (
                      <th key={h} style={{ padding:"12px 14px", textAlign:"right", color:"#94a3b8", borderBottom:"1px solid #1e293b", fontWeight:600, fontSize:11, whiteSpace:"nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => (
                    <tr key={u.id} style={{ borderBottom:"1px solid #1e293b10" }}>
                      <td style={{ padding:"12px 14px", fontWeight:600 }}>{u.fullName}</td>
                      <td style={{ padding:"12px 14px", color:"#94a3b8", direction:"ltr", textAlign:"right" }}>{u.email}</td>
                      <td style={{ padding:"12px 14px" }}>{roleBadge(u.role)}</td>
                      <td style={{ padding:"12px 14px", color:"#94a3b8" }}>{u.district || "-"}</td>
                      <td style={{ padding:"12px 14px" }}>{statusBadge(u.status)}</td>
                      <td style={{ padding:"12px 14px", color:"#64748b", fontSize:11 }}>{u.createdAt?.split("T")[0]}</td>
                      <td style={{ padding:"12px 14px" }}>
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                          {u.status === "pending" && <>
                            <button onClick={() => approveUser(u.id)} style={{ padding:"4px 10px", borderRadius:6, border:"none", background:"#10b981", color:"#fff", cursor:"pointer", fontSize:10, fontWeight:600, fontFamily:F }}>قبول</button>
                            <button onClick={() => rejectUser(u.id)} style={{ padding:"4px 10px", borderRadius:6, border:"none", background:"#ef4444", color:"#fff", cursor:"pointer", fontSize:10, fontWeight:600, fontFamily:F }}>رفض</button>
                          </>}
                          <select value={u.role} onChange={e => updateUserRole(u.id, e.target.value)} style={{ padding:"4px 8px", borderRadius:6, border:"1px solid #1e293b", background:"#0a0e1a", color:"#f1f5f9", fontSize:10, fontFamily:F, cursor:"pointer" }}>
                            <option value="citizen">مواطن</option>
                            <option value="employee">موظف</option>
                            <option value="executive">إدارة عليا</option>
                          </select>
                          {u.status === "active" ? (
                            <button onClick={() => updateUserStatus(u.id, "suspended")} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #ef444440", background:"#ef444415", color:"#ef4444", cursor:"pointer", fontSize:10, fontWeight:600, fontFamily:F }}>تعطيل</button>
                          ) : u.status !== "pending" && (
                            <button onClick={() => updateUserStatus(u.id, "active")} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #10b98140", background:"#10b98115", color:"#10b981", cursor:"pointer", fontSize:10, fontWeight:600, fontFamily:F }}>تفعيل</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredUsers.length === 0 && <div style={{ padding:30, textAlign:"center", color:"#64748b" }}>لا يوجد نتائج</div>}
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
function AppRouter() {
  const { isAuthenticated, userData, userRole, loading } = useAuth();
  const [showAdmin, setShowAdmin] = useState(false);

  if (loading) return <LoadingScreen />;
  if (!isAuthenticated) return <AuthPage />;

  // حساب بانتظار الموافقة
  if (userData?.status === "pending") return <PendingApprovalScreen />;

  // حساب مرفوض أو معطّل
  if (userData?.status === "suspended" || userData?.status === "rejected") {
    const SuspendedScreen = () => {
      const { logout: doLogout } = useAuth();
      return (
        <div dir="rtl" style={{ minHeight:"100vh", background:"#0a0e1a", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Noto Kufi Arabic',sans-serif" }}>
          <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
          <div style={{ width:"100%", maxWidth:400, padding:"clamp(20px,5vw,40px)", background:"#111827", borderRadius:24, textAlign:"center", border:"1px solid #ef444430" }}>
            <div style={{ fontSize:48, marginBottom:16 }}>⛔</div>
            <h2 style={{ fontSize:20, fontWeight:900, color:"#ef4444", margin:"0 0 10px" }}>الحساب {userData?.status === "rejected" ? "مرفوض" : "معطّل"}</h2>
            <p style={{ fontSize:13, color:"#94a3b8", lineHeight:1.7 }}>تواصل مع إدارة النظام لمزيد من المعلومات</p>
            <button onClick={doLogout} style={{ marginTop:20, padding:"10px 24px", borderRadius:10, border:"1px solid #ef444440", background:"#ef444415", color:"#ef4444", cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:"'Noto Kufi Arabic',sans-serif" }}>تسجيل خروج</button>
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
          minHeight: "100vh", background: "#0a0e1a", display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "center",
          fontFamily: "'Noto Kufi Arabic', sans-serif", color: "#f1f5f9", padding: 24, textAlign: "center",
        }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#ef4444", marginBottom: 8 }}>
            حدث خطأ غير متوقع
          </div>
          <div style={{ fontSize: 14, color: "#94a3b8", marginBottom: 28, maxWidth: 400 }}>
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
