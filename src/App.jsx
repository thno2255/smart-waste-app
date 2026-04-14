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

import { useState, useEffect, useMemo, useRef, createContext, useContext } from "react";

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
  { value: "citizen", label: "مواطن", icon: "🏠", desc: "طلب حاويات ومتابعة الخدمات", color: "#10b981" },
  { value: "employee", label: "موظف", icon: "👷", desc: "إدارة المحطات والعمليات", color: "#3b82f6" },
  { value: "executive", label: "إدارة عليا", icon: "🏛️", desc: "لوحة متخذي القرار", color: "#f59e0b" },
];

const inputStyle = { width:"100%", padding:"12px 16px", borderRadius:12, border:"1px solid #1e293b", background:"#0a0e1a", color:"#f1f5f9", fontSize:14, fontFamily:"'Noto Kufi Arabic',sans-serif", outline:"none", boxSizing:"border-box" };

const AuthPage = () => {
  const { login, register, resetPassword } = useAuth();
  const [mode, setMode] = useState("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [district, setDistrict] = useState("");
  const [role, setRole] = useState("citizen");

  const resetForm = () => { setEmail(""); setPassword(""); setConfirmPassword(""); setFullName(""); setPhone(""); setDistrict(""); setRole("citizen"); setError(""); setSuccess(""); };

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
    if (r.success) setSuccess("تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني ✉️");
    else setError(r.error);
    setLoading(false);
  };

  const F = "'Noto Kufi Arabic',sans-serif";

  return (
    <div dir="rtl" style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0a0e1a 0%,#1a1040 50%,#0a0e1a 100%)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:F, padding:20 }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <div style={{ width: mode==="register"?520:440, padding:"36px 40px", background:"#111827", borderRadius:24, border:"1px solid #1e293b", position:"relative", overflow:"hidden", transition:"width 0.3s" }}>
        <div style={{ position:"absolute", top:-60, left:"50%", transform:"translateX(-50%)", width:200, height:200, background:"radial-gradient(circle,#10b98120,transparent)", borderRadius:"50%" }} />

        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:28, position:"relative" }}>
          <div style={{ width:68, height:68, borderRadius:18, background:"linear-gradient(135deg,#10b981,#059669)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:34, margin:"0 auto 14px", boxShadow:"0 8px 30px #10b98130" }}>♻️</div>
          <h1 style={{ fontSize:22, fontWeight:900, color:"#f1f5f9", margin:"0 0 6px 0" }}>نظام إدارة النفايات الذكي</h1>
          <p style={{ fontSize:13, color:"#94a3b8", margin:0 }}>مدينة بريدة - منطقة القصيم</p>
        </div>

        {/* Tabs — تظهر فقط في login و register */}
        {mode !== "forgot" && (
          <div style={{ display:"flex", gap:0, marginBottom:24, background:"#0a0e1a", borderRadius:12, padding:4 }}>
            {[{key:"login",label:"تسجيل دخول"},{key:"register",label:"إنشاء حساب"}].map(tab=>(
              <button key={tab.key} onClick={()=>{setMode(tab.key);resetForm();}} style={{ flex:1, padding:"10px 0", borderRadius:10, border:"none", background:mode===tab.key?"#10b981":"transparent", color:mode===tab.key?"#000":"#94a3b8", fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:F, transition:"all 0.3s" }}>{tab.label}</button>
            ))}
          </div>
        )}

        {/* عنوان صفحة نسيت كلمة المرور */}
        {mode === "forgot" && (
          <div style={{ textAlign:"center", marginBottom:24 }}>
            <div style={{ fontSize:16, fontWeight:700, color:"#f1f5f9", marginBottom:6 }}>🔑 استعادة كلمة المرور</div>
            <div style={{ fontSize:12, color:"#94a3b8" }}>أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين</div>
          </div>
        )}

        {error && <div style={{ fontSize:12, color:"#ef4444", background:"#ef444415", padding:"10px 14px", borderRadius:10, marginBottom:16, textAlign:"center", border:"1px solid #ef444430" }}>⚠️ {error}</div>}
        {success && <div style={{ fontSize:12, color:"#10b981", background:"#10b98115", padding:"10px 14px", borderRadius:10, marginBottom:16, textAlign:"center", border:"1px solid #10b98130" }}>✅ {success}</div>}

        {mode==="login" && (
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            <div><label style={{fontSize:12,color:"#94a3b8",marginBottom:6,display:"block"}}>البريد الإلكتروني</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="example@email.com" style={inputStyle} /></div>
            <div><label style={{fontSize:12,color:"#94a3b8",marginBottom:6,display:"block"}}>كلمة المرور</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="أدخل كلمة المرور" style={inputStyle} onKeyDown={e=>e.key==="Enter"&&handleLogin(e)} /></div>
            <div style={{ textAlign:"left" }}>
              <button onClick={()=>{setMode("forgot");resetForm();}} style={{ background:"none", border:"none", color:"#10b981", fontSize:12, cursor:"pointer", fontFamily:F, padding:0 }}>نسيت كلمة المرور؟</button>
            </div>
            <button onClick={handleLogin} disabled={loading} style={{ padding:14, borderRadius:12, border:"none", background:loading?"#64748b":"linear-gradient(135deg,#10b981,#059669)", color:"#fff", fontSize:15, fontWeight:800, cursor:loading?"not-allowed":"pointer", fontFamily:F }}>{loading?"جاري تسجيل الدخول...":"تسجيل الدخول"}</button>
          </div>
        )}

        {mode==="forgot" && (
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            <div><label style={{fontSize:12,color:"#94a3b8",marginBottom:6,display:"block"}}>البريد الإلكتروني</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="example@email.com" style={inputStyle} onKeyDown={e=>e.key==="Enter"&&handleResetPassword(e)} /></div>
            <button onClick={handleResetPassword} disabled={loading} style={{ padding:14, borderRadius:12, border:"none", background:loading?"#64748b":"linear-gradient(135deg,#10b981,#059669)", color:"#fff", fontSize:15, fontWeight:800, cursor:loading?"not-allowed":"pointer", fontFamily:F }}>{loading?"جاري الإرسال...":"إرسال رابط الاستعادة"}</button>
            <button onClick={()=>{setMode("login");resetForm();}} style={{ padding:10, borderRadius:12, border:"1px solid #1e293b", background:"transparent", color:"#94a3b8", fontSize:13, cursor:"pointer", fontFamily:F }}>← العودة لتسجيل الدخول</button>
          </div>
        )}

        {mode==="register" && (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div>
              <label style={{fontSize:12,color:"#94a3b8",marginBottom:8,display:"block"}}>نوع الحساب</label>
              <div style={{display:"flex",gap:8}}>
                {ROLES_LIST.map(r=>(
                  <button key={r.value} onClick={()=>setRole(r.value)} style={{ flex:1, padding:"12px 8px", borderRadius:12, border:`2px solid ${role===r.value?r.color:"#1e293b"}`, background:role===r.value?r.color+"15":"transparent", cursor:"pointer", textAlign:"center" }}>
                    <div style={{fontSize:24,marginBottom:4}}>{r.icon}</div>
                    <div style={{fontSize:12,fontWeight:700,color:role===r.value?r.color:"#94a3b8",fontFamily:F}}>{r.label}</div>
                    <div style={{fontSize:9,color:"#64748b",marginTop:2,fontFamily:F}}>{r.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={{gridColumn:"1/-1"}}><label style={{fontSize:12,color:"#94a3b8",marginBottom:6,display:"block"}}>الاسم الكامل *</label><input type="text" value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="الاسم الثلاثي" style={inputStyle} /></div>
              <div style={{gridColumn:"1/-1"}}><label style={{fontSize:12,color:"#94a3b8",marginBottom:6,display:"block"}}>البريد الإلكتروني *</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="example@email.com" style={inputStyle} /></div>
              <div><label style={{fontSize:12,color:"#94a3b8",marginBottom:6,display:"block"}}>كلمة المرور *</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="6 أحرف على الأقل" style={inputStyle} /></div>
              <div><label style={{fontSize:12,color:"#94a3b8",marginBottom:6,display:"block"}}>تأكيد كلمة المرور *</label><input type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="أعد كتابة كلمة المرور" style={inputStyle} /></div>
              <div><label style={{fontSize:12,color:"#94a3b8",marginBottom:6,display:"block"}}>رقم الجوال</label><input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="05XXXXXXXX" style={{...inputStyle,direction:"ltr",textAlign:"right"}} /></div>
              <div><label style={{fontSize:12,color:"#94a3b8",marginBottom:6,display:"block"}}>الحي</label><select value={district} onChange={e=>setDistrict(e.target.value)} style={{...inputStyle,appearance:"auto"}}><option value="">اختر الحي</option>{DISTRICTS.map(d=><option key={d} value={d}>{d}</option>)}</select></div>
            </div>
            <button onClick={handleRegister} disabled={loading} style={{ padding:14, borderRadius:12, border:"none", background:loading?"#64748b":"linear-gradient(135deg,#10b981,#059669)", color:"#fff", fontSize:15, fontWeight:800, cursor:loading?"not-allowed":"pointer", fontFamily:F, marginTop:4 }}>{loading?"جاري إنشاء الحساب...":"إنشاء حساب جديد"}</button>
          </div>
        )}
        <div style={{textAlign:"center",marginTop:20,fontSize:11,color:"#64748b"}}>🔒 جميع البيانات مشفرة ومحمية</div>
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
      <div onClick={e => e.stopPropagation()} style={{ width:500, maxHeight:"90vh", overflow:"auto", padding:"0", background:"#111827", borderRadius:20, border:"1px solid #1e293b" }}>
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

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
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

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
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
      alerts.push({ id: `${s.id}_c`, type: "حرج", message: `${s.name} - مستوى الامتلاء وصل ${s.fillLevel}%`, time: "الآن", icon: "🔴" });
    } else if (status === "تحذير") {
      alerts.push({ id: `${s.id}_w`, type: "تحذير", message: `${s.name} - مستوى الامتلاء ${s.fillLevel}%`, time: "الآن", icon: "🟡" });
    }
  });
  if (alerts.length === 0) {
    alerts.push({ id: "ok", type: "معلومة", message: "جميع المحطات تعمل بشكل طبيعي ✅", time: "الآن", icon: "🟢" });
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
    {title && <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 16 }}>{icon} {title}</div>}
    {children}
  </div>
);

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

  const stationPerformance = stations.map(s => ({
    name: s.district.replace("حي ", ""),
    الامتلاء: s.fillLevel,
    الشفط: s.suctionRate,
    المحرك: s.motorHealth,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <StatCard title="إجمالي المحطات" value={stations.length} icon="🏭" gradient={C.g1} />
        <StatCard title="متوسط الامتلاء" value={avgFill} unit="%" icon="📊" gradient={C.g2} trend={-5.2} />
        <StatCard title="الكمية اليومية" value={totalDaily} unit="كجم" icon="♻️" gradient={C.g3} trend={12.8} />
        <StatCard title="كفاءة التشغيل" value={avgEff} unit="%" icon="⚡" gradient={C.g4} trend={3.1} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <Card title="توزيع النفايات الأسبوعي (كجم)" icon="📊">
          <ResponsiveContainer width="100%" height={280}>
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
          </ResponsiveContainer>
        </Card>

        <Card title="توزيع مستويات الامتلاء" icon="🎯">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={fillDistribution} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={4}
                label={({ name, value }) => `${name}: ${value}`}>
                {fillDistribution.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
            {fillDistribution.map((d, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: C.muted }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: d.fill }} /> {d.name}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card title="الاتجاه الشهري - الجمع والكفاءة" icon="📈">
          <ResponsiveContainer width="100%" height={260}>
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
          </ResponsiveContainer>
        </Card>

        <Card title="نشاط الشفط على مدار الساعة" icon="⏰">
          <ResponsiveContainer width="100%" height={260}>
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
          </ResponsiveContainer>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card title="أداء المحطات - بريدة" icon="🎯">
          <ResponsiveContainer width="100%" height={300}>
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
          </ResponsiveContainer>
        </Card>

        <Card title="التنبيهات" icon="🔔">
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {[
          { label: "محطات طبيعية", count: stations.filter((s) => getStatus(s.fillLevel) === "طبيعي").length, color: C.accent, icon: "✅" },
          { label: "محطات تحت التحذير", count: stations.filter((s) => getStatus(s.fillLevel) === "تحذير").length, color: C.warning, icon: "⚠️" },
          { label: "محطات حرجة", count: criticalCount, color: C.danger, icon: "🚨" },
        ].map((item, i) => (
          <div key={i} style={{ background: C.card, border: `1px solid ${item.color}30`, borderRadius: 16, padding: 20, textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>{item.icon}</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: item.color }}>{item.count}</div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ======================== STATIONS ========================
const StationsPage = ({ stations }) => {
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

  const fakeHistory = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => ({
      day: ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"][i],
      الامتلاء: Math.round(30 + Math.random() * 60),
      الضغط: +(1 + Math.random() * 3).toFixed(1),
      الكمية: Math.round(50 + Math.random() * 200),
    })), [selectedId]);

  // ─── Handlers: Station ────────────────────────────────────
  const handleAddStation = async () => {
    const { name, district, fillLevel, pressure, wasteType, dailyWaste } = stationForm;
    if (!name || !district || fillLevel === "" || pressure === "" || !dailyWaste) {
      setStationError("يرجى تعبئة جميع الحقول"); return;
    }
    setStationLoading(true); setStationError("");
    try {
      await addDoc(collection(db, "stations"), {
        name, district,
        fillLevel: Number(fillLevel),
        pressure: Number(pressure),
        wasteType,
        dailyWaste: Number(dailyWaste),
        containers: [],
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
    if (!containerForm.name || containerForm.fillLevel === "" || !currentSelected) return;
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
    } catch (e) {
      console.error("خطأ في حفظ الحاوية:", e);
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
    setShowContainerModal(true);
  };

  const openEditContainer = (c) => {
    setEditingContainer(c);
    setContainerForm({ name: c.name, fillLevel: String(c.fillLevel) });
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
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
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
            <div style={{ display:"flex", gap:10, marginTop:20 }}>
              <button onClick={handleSaveContainer} disabled={containerLoading} style={{ flex:1, padding:12, borderRadius:10, border:"none", background:containerLoading?"#334155":"linear-gradient(135deg,#10b981,#059669)", color:"#000", fontWeight:700, cursor:containerLoading?"not-allowed":"pointer", fontFamily:F, fontSize:13 }}>
                {containerLoading ? "جاري الحفظ..." : "💾 حفظ"}
              </button>
              <button onClick={() => { setShowContainerModal(false); setEditingContainer(null); }} style={{ padding:"12px 20px", borderRadius:10, border:`1px solid ${C.border}`, background:"transparent", color:C.muted, cursor:"pointer", fontFamily:F, fontSize:13 }}>إلغاء</button>
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
              <Card title="حاويات المنازل" icon="📦">
                {/* ── مؤشرات الملخص ─────────────────────── */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:18 }}>
                  {[
                    { label:"إجمالي الحاويات", val:ctrs.length,   color:C.info,    icon:"📦" },
                    { label:"حرج",             val:cCrit.length,  color:C.danger,  icon:"🔴" },
                    { label:"تحذير",           val:cWarn.length,  color:C.warning, icon:"🟡" },
                    { label:"متوسط الامتلاء",  val:`${avgFill}%`, color:avgFill>=85?C.danger:avgFill>=60?C.warning:C.accent, icon:"📊" },
                  ].map((m,i) => (
                    <div key={i} style={{ background:C.bg, borderRadius:12, padding:"12px 14px", textAlign:"center", border:`1px solid ${m.color}25` }}>
                      <div style={{ fontSize:20, marginBottom:4 }}>{m.icon}</div>
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
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
            <Card title="سجل الامتلاء والضغط" icon="📈">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={fakeHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="day" tick={{ fill:C.muted, fontSize:10, fontFamily:F }} />
                  <YAxis tick={{ fill:C.muted, fontSize:10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontFamily:F, fontSize:11 }} />
                  <Line type="monotone" dataKey="الامتلاء" stroke={C.warning} strokeWidth={2} dot={{ r:3 }} name="الامتلاء %" />
                  <Line type="monotone" dataKey="الضغط" stroke={C.info} strokeWidth={2} dot={{ r:3 }} name="الضغط (بار)" />
                </LineChart>
              </ResponsiveContainer>
            </Card>
            <Card title="كمية النفايات اليومية" icon="📦">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={fakeHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="day" tick={{ fill:C.muted, fontSize:10, fontFamily:F }} />
                  <YAxis tick={{ fill:C.muted, fontSize:10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="الكمية" fill={C.accent} radius={[6,6,0,0]} name="الكمية (كجم)" />
                </BarChart>
              </ResponsiveContainer>
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
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:12 }}>
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
            {[
              { label: "متوسط وقت الاستجابة", value: "12 دقيقة", target: "15 دقيقة", ok: true },
              { label: "نسبة التشغيل", value: "94.2%", target: "90%", ok: true },
              { label: "معدل الأعطال", value: "2.1%", target: "3%", ok: true },
              { label: "رضا المستخدمين", value: "87%", target: "85%", ok: true },
            ].map((kpi, i) => (
              <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>{kpi.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: C.text, marginBottom: 4 }}>{kpi.value}</div>
                <div style={{ fontSize: 11, color: C.dim }}>الهدف: {kpi.target}</div>
                <div style={{ fontSize: 11, color: kpi.ok ? C.accent : C.danger, fontWeight: 600, marginTop: 4 }}>✓ أعلى من الهدف</div>
              </div>
            ))}
          </div>
          <Card title="مقارنة امتلاء المحطات - بريدة" icon="📊">
            <ResponsiveContainer width="100%" height={350}>
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
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {tab === "waste" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Card title="توزيع النفايات حسب النوع" icon="🗑️">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={wasteByType} cx="50%" cy="50%" outerRadius={100} innerRadius={55} dataKey="value" paddingAngle={3}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {wasteByType.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ textAlign: "center", fontSize: 14, fontWeight: 700, color: C.text }}>الإجمالي: {totalWaste.toLocaleString()} كجم</div>
          </Card>
          <Card title="النفايات اليومية حسب النوع" icon="📈">
            <ResponsiveContainer width="100%" height={300}>
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
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {tab === "cost" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            <StatCard title="إجمالي التكلفة السنوية" value={monthlyTrend.reduce((a, m) => a + m.التكلفة, 0).toLocaleString()} unit="ر.س" icon="💰" gradient={C.g3} />
            <StatCard title="متوسط التكلفة الشهرية" value={Math.round(monthlyTrend.reduce((a, m) => a + m.التكلفة, 0) / 12).toLocaleString()} unit="ر.س" icon="📅" gradient={C.g2} trend={-8.5} />
            <StatCard title="تكلفة الكيلوغرام" value={(monthlyTrend.reduce((a, m) => a + m.التكلفة, 0) / 12 / (totalWaste * 4.3)).toFixed(2)} unit="ر.س" icon="⚖️" gradient={C.g1} />
          </div>
          <Card title="التكاليف الشهرية مقابل عمليات الجمع" icon="💵">
            <ResponsiveContainer width="100%" height={300}>
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
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {tab === "environment" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            {[
              { label: "انبعاثات CO₂ الموفرة", value: "2.4 طن", icon: "🌍", color: C.accent, desc: "مقارنة بالطرق التقليدية" },
              { label: "نسبة إعادة التدوير", value: "68%", icon: "♻️", color: C.info, desc: "من إجمالي النفايات" },
              { label: "الطاقة الموفرة", value: "1,200 kWh", icon: "⚡", color: C.warning, desc: "شهرياً" },
              { label: "تقليل الرحلات", value: "45%", icon: "🚛", color: C.purple, desc: "انخفاض في رحلات النقل" },
            ].map((item, i) => (
              <div key={i} style={{ background: C.card, border: `1px solid ${item.color}30`, borderRadius: 16, padding: 20, textAlign: "center" }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>{item.icon}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: item.color }}>{item.value}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginTop: 4 }}>{item.label}</div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{item.desc}</div>
              </div>
            ))}
          </div>
          <Card title="أهداف الاستدامة - بريدة" icon="🌱">
            {[
              { goal: "تقليل النفايات المرسلة للمرادم 50%", progress: 72, color: C.accent },
              { goal: "رفع نسبة إعادة التدوير إلى 80%", progress: 68, color: C.info },
              { goal: "خفض انبعاثات الكربون 30%", progress: 85, color: C.purple },
              { goal: "تحقيق صفر نفايات بحلول 2030", progress: 42, color: C.warning },
            ].map((item, i) => (
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

const generatePredictionData = (events) => {
  const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const baseDaily = 1800;
  return months.map((m, i) => {
    const monthEvents = events.filter(e => e.month === i + 1 || (e.recurring === "monthly"));
    const maxMultiplier = monthEvents.length > 0 ? Math.max(...monthEvents.map(e => e.wasteMultiplier)) : 1;
    const combined = monthEvents.reduce((acc, e) => acc + (e.wasteMultiplier - 1) * 0.6, 0);
    const effectiveMultiplier = 1 + Math.min(combined, maxMultiplier - 0.2);
    const predicted = Math.round(baseDaily * effectiveMultiplier);
    const actual = i < new Date().getMonth() ? Math.round(predicted * (0.85 + Math.random() * 0.3)) : null;
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

  const predictionData = useMemo(() => generatePredictionData(EVENTS_DB), []);
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
            <StatCard title="إجمالي التوقعات السنوية" value={Math.round(totalPredicted / 1000)} unit="طن" icon="🔮" gradient="linear-gradient(135deg, #f59e0b, #d97706)" />
            <StatCard title="دقة التنبؤ" value={avgAccuracy} unit="%" icon="🎯" gradient="linear-gradient(135deg, #10b981, #059669)" />
            <StatCard title="ذروة متوقعة" value={peakMonth.month} icon="📊" gradient="linear-gradient(135deg, #ef4444, #dc2626)" />
            <StatCard title="أحداث مؤثرة" value={EVENTS_DB.length} icon="📅" gradient="linear-gradient(135deg, #8b5cf6, #7c3aed)" />
          </div>

          {/* Annual Prediction vs Actual */}
          <Card title="التنبؤ السنوي مقابل الفعلي (كجم/يوم)" icon="📊">
            <ResponsiveContainer width="100%" height={300}>
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
            </ResponsiveContainer>
          </Card>

          {/* Upcoming Events + Impact by Type */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Card title="الأحداث القادمة" icon="⏰">
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

            <Card title="التأثير حسب نوع الحدث" icon="📊">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={impactByType} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis type="number" tick={{ fill: C.muted, fontSize: 10 }} />
                  <YAxis dataKey="name" type="category" width={60} tick={{ fill: C.muted, fontSize: 11, fontFamily: ARABIC_FONT }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="التأثير" radius={[0, 6, 6, 0]} name="مؤشر التأثير">
                    {impactByType.map((e, i) => <Cell key={i} fill={["#8b5cf6", "#10b981", "#f59e0b", "#22c55e", "#0ea5e9"][i % 5]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
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
                    { label: "معامل الزيادة", val: `×${selectedEvent.wasteMultiplier}`, icon: "📈", color: selectedEvent.wasteMultiplier > 2 ? C.danger : C.warning },
                    { label: "مدة التأثير", val: `${selectedEvent.duration} يوم`, icon: "⏱️", color: C.info },
                    { label: "النفايات الأكثر", val: selectedEvent.peakType, icon: "🗑️", color: C.accent },
                    { label: "الشهر", val: selectedEvent.recurring === "monthly" ? "شهري" : ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"][selectedEvent.month - 1], icon: "📅", color: C.purple },
                  ].map((item, i) => (
                    <div key={i} style={{ background: C.bg, borderRadius: 12, padding: 16, textAlign: "center" }}>
                      <div style={{ fontSize: 24, marginBottom: 6 }}>{item.icon}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: item.color }}>{item.val}</div>
                      <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{item.label}</div>
                    </div>
                  ))}
                </div>

                {/* Simulated daily impact chart for this event */}
                <Card title={`التأثير اليومي المتوقع - ${selectedEvent.name}`} icon="📉">
                  <ResponsiveContainer width="100%" height={220}>
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
                  </ResponsiveContainer>
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
          <Card title="توقعات الـ 30 يوم القادمة (كجم/يوم لكل محطة)" icon="📈">
            <ResponsiveContainer width="100%" height={320}>
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
            </ResponsiveContainer>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Card title="توقعات تأثير النفايات حسب النوع" icon="🗑️">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={wasteTypeImpact} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="name" tick={{ fill: C.muted, fontSize: 11, fontFamily: ARABIC_FONT }} />
                  <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                  <Bar dataKey="العادي" fill="#64748b" opacity={0.5} radius={[4, 4, 0, 0]} name="المعدل العادي" />
                  <Bar dataKey="المتوقع" fill="#f59e0b" radius={[4, 4, 0, 0]} name="المتوقع القادم" />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card title="ملخص التوقعات" icon="📋">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { label: "أعلى يوم متوقع", val: `${Math.max(...forecast30.map(d => d.المتوقع))} كجم`, icon: "🔝", color: C.danger },
                  { label: "أقل يوم متوقع", val: `${Math.min(...forecast30.map(d => d.المتوقع))} كجم`, icon: "🔻", color: C.accent },
                  { label: "المتوسط المتوقع", val: `${Math.round(forecast30.reduce((a, d) => a + d.المتوقع, 0) / 30)} كجم/يوم`, icon: "📊", color: C.info },
                  { label: "أيام فوق المعدل", val: `${forecast30.filter(d => d.المتوقع > 150).length} يوم`, icon: "⚠️", color: C.warning },
                  { label: "أيام عطلة نهاية أسبوع", val: `${forecast30.filter(d => d.isWeekend).length} يوم`, icon: "📅", color: C.purple },
                  { label: "أعلى معامل زيادة", val: `×${Math.max(...forecast30.map(d => d.multiplier)).toFixed(2)}`, icon: "💹", color: "#ec4899" },
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: C.bg, borderRadius: 10 }}>
                    <span style={{ fontSize: 20 }}>{item.icon}</span>
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

          <Card title="مقارنة الخطورة الحالية مع المتوقعة لكل محطة" icon="📊">
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={stationRisk} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis type="number" domain={[0, 100]} tick={{ fill: C.muted, fontSize: 10 }} />
                <YAxis dataKey="name" type="category" width={65} tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                <Bar dataKey="الخطورة_الحالية" fill={C.info} opacity={0.7} radius={[0, 4, 4, 0]} name="الحالي %" />
                <Bar dataKey="الخطورة_المتوقعة" fill={C.danger} opacity={0.7} radius={[0, 4, 4, 0]} name="المتوقع %" />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Card title="المحطات الأكثر خطورة" icon="🚨">
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

            <Card title="خطة الاستجابة المقترحة" icon="📝">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { priority: "عاجل", action: "زيادة دورات الشفط للمحطات الحرجة إلى كل 4 ساعات", color: C.danger, icon: "🔴" },
                  { priority: "عاجل", action: "تجهيز حاويات احتياطية في الأحياء ذات الكثافة العالية", color: C.danger, icon: "🔴" },
                  { priority: "مهم", action: "إرسال إشعارات للسكان بمواعيد الجمع الإضافية", color: C.warning, icon: "🟡" },
                  { priority: "مهم", action: "تخصيص فرق صيانة طوارئ على مدار الساعة", color: C.warning, icon: "🟡" },
                  { priority: "وقائي", action: "فحص شامل لجميع المحطات قبل بدء الحدث", color: C.info, icon: "🔵" },
                  { priority: "وقائي", action: "تحديث جداول النقل لتغطية ساعات الذروة المتوقعة", color: C.info, icon: "🔵" },
                  { priority: "تنسيقي", action: "التنسيق مع البلدية لتوفير موارد إضافية مؤقتة", color: C.accent, icon: "🟢" },
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", background: C.bg, borderRadius: 10, border: `1px solid ${item.color}20` }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
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

const FireAlertPage = ({ stations }) => {
  const [view, setView] = useState("monitor");
  const [selectedStation, setSelectedStation] = useState(null);
  const [simRunning, setSimRunning] = useState(false);
  const [simTemp, setSimTemp] = useState(25);

  const fireData = useMemo(() => generateFireData(stations), [stations]);
  const tempHistory = useMemo(() => generateTempHistory(), []);
  const weeklyIncidents = useMemo(() => generateWeeklyFireIncidents(), []);

  const highRisk = fireData.filter(s => s.riskLevel === "خطر عالي");
  const medRisk = fireData.filter(s => s.riskLevel === "خطر متوسط");
  const warnings = fireData.filter(s => s.riskLevel === "تحذير");
  const safe = fireData.filter(s => s.riskLevel === "آمن");

  const avgTemp = Math.round(fireData.reduce((a, s) => a + s.internalTemp, 0) / fireData.length);
  const avgGas = Math.round(fireData.reduce((a, s) => a + s.gasLevel, 0) / fireData.length);
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
            <StatCard title="متوسط الحرارة الداخلية" value={avgTemp} unit="°C" icon="🌡️" gradient="linear-gradient(135deg, #ef4444, #dc2626)" trend={avgTemp > 45 ? 8.3 : -2.1} />
            <StatCard title="محطات عالية الخطورة" value={highRisk.length} icon="🔥" gradient="linear-gradient(135deg, #f97316, #ea580c)" />
            <StatCard title="كشف دخان" value={smokeCount} unit="محطة" icon="💨" gradient="linear-gradient(135deg, #64748b, #475569)" />
            <StatCard title="متوسط مستوى الغاز" value={avgGas} unit="%" icon="⛽" gradient="linear-gradient(135deg, #f59e0b, #d97706)" />
          </div>

          {/* Temperature Timeline + Risk Pie */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
            <Card title="منحنى الحرارة الداخلية (24 ساعة)" icon="🌡️">
              <ResponsiveContainer width="100%" height={280}>
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
              </ResponsiveContainer>
            </Card>

            <Card title="توزيع مستويات الخطورة" icon="🎯">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={riskDistribution} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={4}
                    label={({ name, value }) => value > 0 ? `${value}` : ""}>
                    {riskDistribution.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
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
          <Card title="حالة المحطات - المراقبة الحية" icon="📡">
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
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11 }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Card title="مؤشر خطورة الحريق لكل محطة" icon="📊">
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={stationRiskChart} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: C.muted, fontSize: 10 }} />
                  <YAxis dataKey="name" type="category" width={60} tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="الخطورة" radius={[0, 6, 6, 0]} name="مؤشر الخطورة %">
                    {stationRiskChart.map((e, i) => <Cell key={i} fill={e.الخطورة > 75 ? "#ef4444" : e.الخطورة > 50 ? "#f97316" : e.الخطورة > 30 ? "#f59e0b" : "#10b981"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card title="علاقة الحرارة بالغاز والرطوبة" icon="🔬">
              <ResponsiveContainer width="100%" height={350}>
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
              </ResponsiveContainer>
            </Card>
          </div>

          <Card title="سجل الإنذارات والحوادث (8 أسابيع)" icon="📈">
            <ResponsiveContainer width="100%" height={280}>
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
            </ResponsiveContainer>
          </Card>

          {/* Fire risk factors */}
          <Card title="عوامل خطر الحريق الرئيسية" icon="⚡">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {[
                { factor: "ارتفاع الحرارة الداخلية", weight: 35, desc: "تجاوز 55°C يزيد الخطر بشكل كبير", icon: "🌡️", color: "#ef4444", affected: fireData.filter(s => s.internalTemp > 55).length },
                { factor: "تسرب الغازات", weight: 25, desc: "غازات الميثان والهيدروجين القابلة للاشتعال", icon: "⛽", color: "#f97316", affected: fireData.filter(s => s.gasLevel > 60).length },
                { factor: "مواد قابلة للاشتعال", weight: 15, desc: "بلاستيك، ورق، ومواد مختلطة", icon: "📦", color: "#f59e0b", affected: fireData.filter(s => s.hasFlammable).length },
                { factor: "الامتلاء الزائد", weight: 10, desc: "الضغط والاحتكاك يولدان حرارة", icon: "📊", color: "#8b5cf6", affected: fireData.filter(s => s.fillLevel > 75).length },
                { factor: "انخفاض الرطوبة", weight: 10, desc: "الجفاف يسهّل الاشتعال", icon: "💧", color: "#3b82f6", affected: fireData.filter(s => s.humidity < 30).length },
                { factor: "الحرارة الخارجية", weight: 5, desc: "درجات حرارة بريدة الصيفية العالية", icon: "☀️", color: "#06b6d4", affected: fireData.filter(s => s.ambientTemp > 45).length },
              ].map((f, i) => (
                <div key={i} style={{ background: C.bg, border: `1px solid ${f.color}25`, borderRadius: 12, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 22 }}>{f.icon}</span>
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
                    { label: "الحرارة الداخلية", val: `${selectedStation.internalTemp}°C`, color: selectedStation.internalTemp > 55 ? "#ef4444" : "#f59e0b", icon: "🌡️" },
                    { label: "الحرارة الخارجية", val: `${selectedStation.ambientTemp}°C`, color: "#f59e0b", icon: "☀️" },
                    { label: "مستوى الغاز", val: `${selectedStation.gasLevel}%`, color: selectedStation.gasLevel > 60 ? "#ef4444" : C.accent, icon: "⛽" },
                    { label: "الرطوبة", val: `${selectedStation.humidity}%`, color: selectedStation.humidity < 30 ? "#f59e0b" : C.info, icon: "💧" },
                    { label: "مؤشر الخطورة", val: `${selectedStation.riskScore}%`, color: getRiskColor(selectedStation.riskLevel), icon: "🔥" },
                    { label: "آخر فحص", val: selectedStation.lastInspection, color: C.muted, icon: "🔍" },
                  ].map((item, i) => (
                    <div key={i} style={{ background: C.bg, borderRadius: 12, padding: 14, textAlign: "center" }}>
                      <div style={{ fontSize: 22, marginBottom: 4 }}>{item.icon}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: item.color }}>{item.val}</div>
                      <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>{item.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                  {[
                    { label: "كاشف الدخان", active: selectedStation.smokeDetected, activeText: "تم كشف دخان!", inactiveText: "لا يوجد دخان", icon: "💨" },
                    { label: "كاشف الشرارة", active: selectedStation.sparkDetected, activeText: "تم كشف شرارة!", inactiveText: "لا توجد شرارة", icon: "⚡" },
                    { label: "طفاية حريق", active: selectedStation.fireExtinguisher, activeText: "متوفرة وصالحة", inactiveText: "غير متوفرة!", icon: "🧯" },
                    { label: "نظام إطفاء تلقائي", active: selectedStation.autoSuppression, activeText: "مُفعّل", inactiveText: "غير مُفعّل", icon: "🚿" },
                  ].map((item, i) => (
                    <div key={i} style={{ background: C.bg, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, border: `1px solid ${item.active && (i < 2) ? "#ef444440" : C.border}` }}>
                      <span style={{ fontSize: 20 }}>{item.icon}</span>
                      <div>
                        <div style={{ fontSize: 10, color: C.dim }}>{item.label}</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: item.active ? (i < 2 ? "#ef4444" : C.accent) : (i < 2 ? C.accent : "#ef4444") }}>
                          {item.active ? item.activeText : item.inactiveText}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <Card title="سجل الحرارة الداخلية - 24 ساعة" icon="📈">
                  <ResponsiveContainer width="100%" height={220}>
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
                  </ResponsiveContainer>
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
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 11 }}>
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
          <Card title="محاكاة سيناريو الحريق" icon="🧪">
            <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, margin: "0 0 20px 0" }}>
              حرّك شريط الحرارة لمحاكاة ارتفاع درجة حرارة الحاوية الداخلية ومشاهدة كيف يتغير مستوى الخطورة والإجراءات المطلوبة في الوقت الفعلي.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
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
          <Card title="منحنى المحاكاة - تصاعد الحرارة" icon="📈">
            <ResponsiveContainer width="100%" height={240}>
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
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {/* ===== PROTOCOLS ===== */}
      {view === "protocols" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="بروتوكولات الاستجابة لحرائق الحاويات" icon="📋">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                {
                  level: "المستوى 1 - مراقبة",
                  range: "أقل من 45°C",
                  color: C.accent,
                  icon: "🟢",
                  steps: ["فحص دوري للمستشعرات كل 6 ساعات", "تسجيل القراءات في السجل اليومي", "التأكد من عمل كواشف الدخان"],
                },
                {
                  level: "المستوى 2 - تحذير",
                  range: "45°C - 60°C",
                  color: "#f59e0b",
                  icon: "🟡",
                  steps: ["إخطار مشرف المحطة عبر الرسائل", "زيادة تردد القراءات إلى كل 15 دقيقة", "فحص مصدر الحرارة والتحقق من وجود مواد خطرة", "تجهيز معدات الإطفاء الأولية"],
                },
                {
                  level: "المستوى 3 - إنذار",
                  range: "60°C - 75°C",
                  color: "#f97316",
                  icon: "🟠",
                  steps: ["تفعيل نظام التبريد التلقائي", "إيقاف عمليات الشفط في المحطة المتأثرة", "إرسال فريق الفحص الميداني", "إعداد فريق الإطفاء الداخلي", "إبلاغ إدارة المنشأة"],
                },
                {
                  level: "المستوى 4 - خطر حريق",
                  range: "أعلى من 75°C",
                  color: "#ef4444",
                  icon: "🔴",
                  steps: ["تفعيل نظام الإطفاء التلقائي فوراً", "الاتصال بالدفاع المدني (998)", "إخلاء المنطقة المحيطة 200 متر", "قطع التيار الكهربائي عن المحطة", "تفعيل خطة الطوارئ الشاملة", "توثيق الحادثة بالصور والفيديو"],
                },
              ].map((protocol, i) => (
                <div key={i} style={{ background: C.bg, border: `1px solid ${protocol.color}30`, borderRadius: 14, padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 22 }}>{protocol.icon}</span>
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
          <Card title="جهات الاتصال في حالات الطوارئ" icon="📞">
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
          <Card title="قائمة فحص معدات السلامة" icon="🧯">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
              {[
                { item: "طفاية حريق بودرة ABC", stations: fireData.filter(s => s.fireExtinguisher).length, total: 12, icon: "🧯" },
                { item: "نظام إطفاء تلقائي", stations: fireData.filter(s => s.autoSuppression).length, total: 12, icon: "🚿" },
                { item: "كاشف دخان فعّال", stations: 11, total: 12, icon: "💨" },
                { item: "كاشف حرارة فعّال", stations: 12, total: 12, icon: "🌡️" },
                { item: "كاشف غاز فعّال", stations: 10, total: 12, icon: "⛽" },
                { item: "إضاءة طوارئ", stations: 9, total: 12, icon: "💡" },
              ].map((eq, i) => {
                const pct = Math.round((eq.stations / eq.total) * 100);
                const eqColor = pct === 100 ? C.accent : pct > 75 ? "#f59e0b" : "#ef4444";
                return (
                  <div key={i} style={{ background: C.bg, borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 22 }}>{eq.icon}</span>
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

// ======================== SETTINGS ========================
const SettingsPage = () => {
  const [notif, setNotif] = useState(true);
  const [autoCollect, setAutoCollect] = useState(true);
  const [threshold, setThreshold] = useState(85);

  const Toggle = ({ value, onChange }) => (
    <div onClick={() => onChange(!value)} style={{ width: 48, height: 26, borderRadius: 13, background: value ? C.accent : C.border, cursor: "pointer", position: "relative", transition: "background 0.3s" }}>
      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, transition: "all 0.3s", ...(value ? { left: 25 } : { left: 3 }) }} />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 600 }}>
      <Card title="إعدادات النظام" icon="⚙️">
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
      <Card title="حالة الاتصال" icon="🔌">
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
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
        {[
          { label:"أوامر نشطة",   val:jobs.filter(j=>j.status==="pending"||j.status==="active").length,  color:C.info,   icon:"⚡" },
          { label:"مجدولة",       val:jobs.filter(j=>j.status==="scheduled").length,                     color:C.purple, icon:"🕐" },
          { label:"مكتملة اليوم", val:jobs.filter(j=>j.status==="completed"&&j.completedAt?.startsWith(new Date().toISOString().slice(0,10))).length, color:C.accent, icon:"✅" },
          { label:"إجمالي الأوامر",val:jobs.length,                                                      color:C.muted,  icon:"📋" },
        ].map((m,i)=>(
          <div key={i} style={{ background:C.card, border:`1px solid ${m.color}25`, borderRadius:14, padding:"14px 18px", textAlign:"center" }}>
            <div style={{ fontSize:22, marginBottom:4 }}>{m.icon}</div>
            <div style={{ fontSize:26, fontWeight:900, color:m.color }}>{m.val}</div>
            <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{m.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>

        {/* ─── Issue Command ───────────────────────────── */}
        <Card title="إصدار أمر شفط" icon="🚿">

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
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
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
        <Card title="الأوامر النشطة والمجدولة" icon="📋">
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
        <Card title="سجل العمليات" icon="🕓">
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
  { username: "admin", password: "admin123", name: "م. عبدالله الراشد", role: "المدير التنفيذي", avatar: "👔" },
  { username: "manager", password: "manager123", name: "م. سارة القحطاني", role: "مدير العمليات", avatar: "👩‍💼" },
  { username: "cfo", password: "cfo123", name: "أ. فهد المطيري", role: "المدير المالي", avatar: "💼" },
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
      <div style={{ width: 420, padding: 40, background: "#111827", borderRadius: 24, border: "1px solid #1e293b", position: "relative", overflow: "hidden" }}>
        {/* Decorative glow */}
        <div style={{ position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)", width: 200, height: 200, background: "radial-gradient(circle, #f59e0b20, transparent)", borderRadius: "50%" }} />
        <div style={{ position: "absolute", bottom: -40, right: -40, width: 150, height: 150, background: "radial-gradient(circle, #8b5cf620, transparent)", borderRadius: "50%" }} />
        
        <div style={{ textAlign: "center", marginBottom: 32, position: "relative" }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, background: "linear-gradient(135deg, #f59e0b, #d97706)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 16px" }}>🏛️</div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: "#f1f5f9", margin: "0 0 6px 0" }}>بوابة متخذي القرار</h1>
          <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>نظام إدارة شفط النفايات الذكي - بريدة</p>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 8, background: "#0a0e1a", padding: "4px 12px", borderRadius: 8, display: "inline-block" }}>🔒 وصول مقيّد - للإدارة العليا فقط</div>
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
                  <span>{u.avatar} {u.role}</span>
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
      <div style={{ background:C.card, border:`2px solid ${C.warning}`, borderRadius:20, padding:"36px 40px", width:400, maxWidth:"95vw", textAlign:"center", direction:"rtl", fontFamily:F }}>
        <div style={{ fontSize:48, marginBottom:12 }}>⏰</div>
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
            background:"linear-gradient(135deg,#10b981,#059669)", color:"#000", fontWeight:800, fontSize:14, cursor:"pointer", fontFamily:F }}>
            ✅ تمديد الجلسة
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

  const quarterlyData = useMemo(() => generateQuarterlyData(), []);
  const districtPerf = useMemo(() => generateDistrictPerformance(), []);
  const roiData = useMemo(() => generateROIData(), []);
  const benchmarkData = useMemo(() => generateBenchmarkData(), []);
  const scenarios = useMemo(() => generateScenarios(), []);

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

  const satisfactionTrend = Array.from({ length: 12 }, (_, i) => ({
    month: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"][i],
    الرضا: Math.round(70 + Math.random() * 15 + i * 1.2),
    الشكاوى: Math.round(30 - Math.random() * 10 - i * 1.5),
  }));

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
      <header style={{ padding: "12px 28px", background: "linear-gradient(90deg, #111827, #1a1040)", borderBottom: "1px solid #f59e0b30", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: "linear-gradient(135deg, #f59e0b, #d97706)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🏛️</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: "#f59e0b" }}>بوابة متخذي القرار</div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>نظام إدارة النفايات الذكي - بريدة • <ExecHeaderClock /></div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{user.name}</div>
            <div style={{ fontSize: 10, color: "#f59e0b" }}>{user.role}</div>
          </div>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "#f59e0b20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{user.avatar}</div>
          <button onClick={() => window.__showAdminPanel && window.__showAdminPanel()} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #8b5cf640", background: "#8b5cf615", color: "#8b5cf6", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: ARABIC_FONT }}>👑 إدارة المستخدمين</button>
          <button onClick={() => setShowPassModal(true)} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #10b98140", background: "#10b98115", color: "#10b981", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: ARABIC_FONT }}>⚙️ إعدادات الحساب</button>
          <button onClick={onLogout} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #ef444440", background: "#ef444415", color: "#ef4444", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: ARABIC_FONT }}>تسجيل خروج</button>
        </div>
      </header>
      {showPassModal && <ChangePasswordModal onClose={() => setShowPassModal(false)} />}
      <SessionTimeout onLogout={onLogout} timeoutMin={30} countdownSec={10} />

      {/* Tabs */}
      <div style={{ padding: "12px 28px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[
          { key: "overview", label: "📊 نظرة تنفيذية" },
          { key: "financial", label: "💰 التحليل المالي" },
          { key: "districts", label: "🏘️ أداء الأحياء" },
          { key: "benchmark", label: "📈 المقارنة المعيارية" },
          { key: "scenarios", label: "🎯 سيناريوهات القرار" },
          { key: "strategic", label: "🗺️ الأهداف الاستراتيجية" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "9px 18px", borderRadius: 10, border: `1px solid ${tab === t.key ? "#f59e0b" : "#1e293b"}`,
            background: tab === t.key ? "#f59e0b18" : "transparent", color: tab === t.key ? "#f59e0b" : "#94a3b8",
            cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: ARABIC_FONT,
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px" }}>

        {/* ===== EXECUTIVE OVERVIEW ===== */}
        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
              <StatCard title="إجمالي الإيرادات" value={(totalRevenue / 1000000).toFixed(2)} unit="مليون ر.س" icon="💰" gradient="linear-gradient(135deg, #f59e0b, #d97706)" />
              <StatCard title="إجمالي التكاليف" value={(totalCost / 1000000).toFixed(2)} unit="مليون ر.س" icon="📉" gradient="linear-gradient(135deg, #ef4444, #dc2626)" />
              <StatCard title="صافي الأرباح" value={(totalProfit / 1000000).toFixed(2)} unit="مليون ر.س" icon="📈" gradient="linear-gradient(135deg, #10b981, #059669)" trend={18.5} />
              <StatCard title="كفاءة التشغيل" value={avgEfficiency} unit="%" icon="⚡" gradient="linear-gradient(135deg, #3b82f6, #1d4ed8)" trend={5.2} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Card title="الأداء الربعي (ر.س)" icon="📊">
                <ResponsiveContainer width="100%" height={280}>
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
                </ResponsiveContainer>
              </Card>

              <Card title="رضا المواطنين والشكاوى" icon="😊">
                <ResponsiveContainer width="100%" height={280}>
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
                </ResponsiveContainer>
              </Card>
            </div>

            {/* Quick Insights */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 14 }}>
              {[
                { title: "أفضل حي أداءً", value: bestDistrict.district, sub: `${bestDistrict.الأداء}% كفاءة`, icon: "🏆", color: "#10b981" },
                { title: "حي يحتاج تحسين", value: worstDistrict.district, sub: `${worstDistrict.الأداء}% كفاءة`, icon: "⚠️", color: "#ef4444" },
                { title: "هامش الربح", value: `${Math.round((totalProfit / totalRevenue) * 100)}%`, sub: "نسبة مئوية سنوية", icon: "💹", color: "#f59e0b" },
                { title: "العائد على الاستثمار", value: "340%", sub: "منذ بداية المشروع", icon: "🎯", color: "#8b5cf6" },
              ].map((insight, i) => (
                <div key={i} style={{ background: "#111827", border: `1px solid ${insight.color}30`, borderRadius: 14, padding: 18, display: "flex", gap: 14, alignItems: "center" }}>
                  <div style={{ width: 50, height: 50, borderRadius: 14, background: `${insight.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>{insight.icon}</div>
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
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
              <Card title="العائد على الاستثمار الشهري (ر.س)" icon="📈">
                <ResponsiveContainer width="100%" height={300}>
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
                </ResponsiveContainer>
              </Card>

              <Card title="توزيع التكاليف التشغيلية" icon="🍕">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={costBreakdown} cx="50%" cy="50%" outerRadius={90} innerRadius={50} dataKey="value" paddingAngle={3}
                      label={({ name, value }) => `${name} ${value}%`}>
                      {costBreakdown.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </Card>
            </div>

            <Card title="مقارنة التكلفة لكل حي (ر.س/شهر)" icon="💵">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={districtPerf} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="district" tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                  <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="التكلفة" radius={[6, 6, 0, 0]} name="التكلفة الشهرية (ر.س)">
                    {districtPerf.map((e, i) => <Cell key={i} fill={e.التكلفة > 35000 ? "#ef4444" : e.التكلفة > 30000 ? "#f59e0b" : "#10b981"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        )}

        {/* ===== DISTRICTS ===== */}
        {tab === "districts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Card title="أداء الأحياء الشامل" icon="🏘️">
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={districtPerf} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: C.muted, fontSize: 10 }} />
                  <YAxis dataKey="district" type="category" width={60} tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                  <Bar dataKey="الأداء" fill="#3b82f6" radius={[0, 4, 4, 0]} opacity={0.8} name="الأداء %" />
                  <Bar dataKey="الرضا" fill="#10b981" radius={[0, 4, 4, 0]} opacity={0.8} name="الرضا %" />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Card title="الأداء مقابل الرضا" icon="🎯">
                <ResponsiveContainer width="100%" height={280}>
                  <RadarChart cx="50%" cy="50%" outerRadius="70%" data={districtPerf.slice(0, 8)}>
                    <PolarGrid stroke={C.border} />
                    <PolarAngleAxis dataKey="district" tick={{ fill: C.muted, fontSize: 9, fontFamily: ARABIC_FONT }} />
                    <PolarRadiusAxis tick={{ fill: "#64748b", fontSize: 8 }} />
                    <Radar name="الأداء" dataKey="الأداء" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
                    <Radar name="الرضا" dataKey="الرضا" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
                    <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                  </RadarChart>
                </ResponsiveContainer>
              </Card>

              <Card title="عدد الحوادث لكل حي" icon="🚨">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={[...districtPerf].sort((a, b) => b.الحوادث - a.الحوادث)} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="district" tick={{ fill: C.muted, fontSize: 9, fontFamily: ARABIC_FONT }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="الحوادث" radius={[6, 6, 0, 0]} name="عدد الحوادث">
                      {districtPerf.map((e, i) => <Cell key={i} fill={e.الحوادث > 5 ? "#ef4444" : e.الحوادث > 2 ? "#f59e0b" : "#10b981"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
          </div>
        )}

        {/* ===== BENCHMARK ===== */}
        {tab === "benchmark" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Card title="المقارنة المعيارية - بريدة مقابل المعايير الوطنية" icon="📈">
              <ResponsiveContainer width="100%" height={350}>
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
              </ResponsiveContainer>
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
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f59e0b", marginBottom: 6 }}>🎯 أداة دعم القرار</div>
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
                      { label: "الاستثمار المطلوب", val: `${(selectedScenario.investment / 1000000).toFixed(1)}M ر.س`, color: "#ef4444", icon: "💰" },
                      { label: "التوفير السنوي", val: `${(selectedScenario.annualSaving / 1000).toFixed(0)}K ر.س`, color: "#10b981", icon: "💹" },
                      { label: "العائد ROI", val: `${selectedScenario.roi}%`, color: "#f59e0b", icon: "📈" },
                      { label: "فترة الاسترداد", val: selectedScenario.payback, color: "#3b82f6", icon: "⏱️" },
                      { label: "مستوى المخاطرة", val: selectedScenario.risk, color: selectedScenario.risk === "منخفض" ? "#10b981" : "#f59e0b", icon: "⚡" },
                      { label: "الأثر المتوقع", val: selectedScenario.impact, color: "#8b5cf6", icon: "🎯" },
                    ].map((item, i) => (
                      <div key={i} style={{ background: "#070b14", borderRadius: 12, padding: 16, textAlign: "center" }}>
                        <div style={{ fontSize: 22, marginBottom: 4 }}>{item.icon}</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: item.color }}>{item.val}</div>
                        <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>{item.label}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11 }}>
                      <div style={{ color: "#64748b" }}>💰 استثمار: <span style={{ color: C.text }}>{(s.investment / 1000000).toFixed(1)}M</span></div>
                      <div style={{ color: "#64748b" }}>📈 ROI: <span style={{ color: "#f59e0b", fontWeight: 700 }}>{s.roi}%</span></div>
                      <div style={{ color: "#64748b" }}>⏱️ استرداد: <span style={{ color: C.text }}>{s.payback}</span></div>
                      <div style={{ color: "#64748b" }}>⚡ خطر: <span style={{ color: s.risk === "منخفض" ? "#10b981" : "#f59e0b" }}>{s.risk}</span></div>
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
              <div style={{ fontSize: 18, fontWeight: 900, color: "#f59e0b", marginBottom: 6 }}>🗺️ الخطة الاستراتيجية - رؤية 2030</div>
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
            <Card title="التوافق مع رؤية 2030" icon="🇸🇦">
              <ResponsiveContainer width="100%" height={300}>
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
              </ResponsiveContainer>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

// ======================== CITIZEN PORTAL ========================
const CITIZEN_BINS = [
  { id: "BIN-001", address: "شارع الملك عبدالعزيز، حي الخليج", type: "عضوية", status: "نشطة", fillLevel: 45, lastPickup: "منذ يومين", nextPickup: "غداً 7:00 ص", installed: "2024/03/15" },
  { id: "BIN-002", address: "شارع الأمير نايف، حي الخليج", type: "بلاستيك", status: "نشطة", fillLevel: 72, lastPickup: "منذ 3 أيام", nextPickup: "اليوم 4:00 م", installed: "2024/05/20" },
];

const CITIZEN_REPORTS = [
  { id: "RPT-1042", date: "2026/04/06", type: "حاوية ممتلئة", status: "تم الحل", district: "حي الخليج", response: "تم التفريغ خلال 3 ساعات" },
  { id: "RPT-1038", date: "2026/04/02", type: "رائحة كريهة", status: "قيد المعالجة", district: "حي الخليج", response: "تم إرسال فريق التنظيف" },
  { id: "RPT-1035", date: "2026/03/28", type: "حاوية تالفة", status: "تم الحل", district: "حي الخليج", response: "تم استبدال الحاوية" },
];

const CitizenPortal = ({ user, onLogout, stations }) => {
  const [tab, setTab] = useState("home");
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [requestSubmitted, setRequestSubmitted] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [reportType, setReportType] = useState("");
  const [reportDesc, setReportDesc] = useState("");
  const [reqAddress, setReqAddress] = useState("");
  const [showPassModal, setShowPassModal] = useState(false);
  const [reqBinType, setReqBinType] = useState("عضوية");
  const [time, setTime] = useState(new Date());

  useEffect(() => { const i = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(i); }, []);

  const myStation = stations.find(s => s.district === user.district) || stations[0];

  const stationHistory = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => ({
      day: ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"][i],
      الامتلاء: Math.round(20 + Math.random() * 60),
      الكمية: Math.round(80 + Math.random() * 150),
    })), []);

  const monthlyCollection = useMemo(() =>
    Array.from({ length: 6 }, (_, i) => ({
      month: ["نوفمبر", "ديسمبر", "يناير", "فبراير", "مارس", "أبريل"][i],
      عضوية: Math.round(40 + Math.random() * 80),
      بلاستيك: Math.round(20 + Math.random() * 40),
      ورق: Math.round(10 + Math.random() * 30),
    })), []);

  const inputStyle = { width: "100%", padding: "12px 16px", borderRadius: 12, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, fontFamily: ARABIC_FONT, outline: "none", boxSizing: "border-box" };

  return (
    <div dir="rtl" style={{ fontFamily: ARABIC_FONT, background: C.bg, color: C.text, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      {showPassModal && <ChangePasswordModal onClose={() => setShowPassModal(false)} />}

      {/* Header */}
      <header style={{ padding: "12px 24px", background: C.card, borderBottom: `1px solid ${C.accent}30`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: C.g1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>♻️</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>بوابة المواطن</div>
            <div style={{ fontSize: 10, color: C.accent }}>نظام إدارة النفايات الذكي - بريدة • {time.toLocaleDateString("ar-SA")}</div>
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
      <div style={{ padding: "12px 24px 0", display: "flex", gap: 6 }}>
        {[
          { key: "home", label: "🏠 الرئيسية" },
          { key: "bins", label: "🗑️ حاوياتي" },
          { key: "station", label: "🏭 محطة الحي" },
          { key: "request", label: "📝 طلب حاوية" },
          { key: "report", label: "⚠️ إبلاغ عن مشكلة" },
          { key: "history", label: "📋 سجل البلاغات" },
        ].map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setShowRequestForm(false); setShowReportForm(false); setRequestSubmitted(false); setReportSubmitted(false); }} style={{
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
                مرحباً بك في بوابة المواطن لنظام إدارة النفايات الذكي. يمكنك متابعة حاوياتك، طلب حاوية جديدة، الإبلاغ عن مشاكل، ومتابعة أداء محطة حيك.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
              <StatCard title="حاوياتي" value={CITIZEN_BINS.length} icon="🗑️" gradient={C.g1} />
              <StatCard title="بلاغاتي" value={CITIZEN_REPORTS.length} icon="📋" gradient={C.g2} />
              <StatCard title="محطة الحي" value={myStation.fillLevel} unit="% امتلاء" icon="🏭" gradient={C.g3} />
              <StatCard title="التفريغ القادم" value="غداً" icon="🚛" gradient={C.g4} />
            </div>

            {/* Quick Actions */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              {[
                { label: "طلب حاوية جديدة", desc: "اطلب حاوية لمنزلك أو مبناك", icon: "📝", color: C.accent, action: () => setTab("request") },
                { label: "إبلاغ عن مشكلة", desc: "بلّغ عن حاوية تالفة أو ممتلئة", icon: "⚠️", color: C.warning, action: () => setTab("report") },
                { label: "متابعة محطة الحي", desc: "شاهد حالة محطة الشفط في حيك", icon: "📊", color: C.info, action: () => setTab("station") },
                { label: "عرض حاوياتي", desc: "تابع حالة حاوياتك ومواعيد التفريغ", icon: "🗑️", color: "#8b5cf6", action: () => setTab("bins") },
              ].map((item, i) => (
                <div key={i} onClick={item.action} style={{ background: C.card, border: `1px solid ${item.color}30`, borderRadius: 14, padding: 18, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = item.color + "70"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = item.color + "30"; e.currentTarget.style.transform = "translateY(0)"; }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>{item.icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: C.dim }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MY BINS */}
        {tab === "bins" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {CITIZEN_BINS.map((bin, i) => (
              <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>🗑️ {bin.id}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{bin.address}</div>
                  </div>
                  <span style={{ padding: "4px 12px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: bin.status === "نشطة" ? C.accent + "20" : C.warning + "20", color: bin.status === "نشطة" ? C.accent : C.warning }}>{bin.status}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                  {[
                    { label: "نوع النفايات", val: bin.type, icon: "♻️" },
                    { label: "مستوى الامتلاء", val: `${bin.fillLevel}%`, icon: "📊" },
                    { label: "آخر تفريغ", val: bin.lastPickup, icon: "🕐" },
                    { label: "التفريغ القادم", val: bin.nextPickup, icon: "🚛" },
                    { label: "تاريخ التركيب", val: bin.installed, icon: "📅" },
                  ].map((item, j) => (
                    <div key={j} style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 18 }}>{item.icon}</span>
                      <div>
                        <div style={{ fontSize: 10, color: C.dim }}>{item.label}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{item.val}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.dim, marginBottom: 4 }}>
                    <span>الامتلاء</span><span>{bin.fillLevel}%</span>
                  </div>
                  <div style={{ width: "100%", height: 8, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${bin.fillLevel}%`, height: "100%", background: bin.fillLevel > 80 ? C.danger : bin.fillLevel > 50 ? C.warning : C.accent, borderRadius: 4, transition: "width 1s" }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* STATION */}
        {tab === "station" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: 0 }}>{myStation.name}</h2>
                  <span style={{ fontSize: 12, color: C.muted }}>{myStation.id} | {myStation.district}</span>
                </div>
                <StatusBadge status={myStation.status} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14, marginBottom: 16 }}>
                {[
                  { label: "الامتلاء", val: myStation.fillLevel, color: myStation.fillLevel > 85 ? C.danger : myStation.fillLevel > 60 ? C.warning : C.accent },
                  { label: "صحة المحرك", val: myStation.motorHealth, color: myStation.motorHealth > 80 ? C.accent : C.warning },
                  { label: "معدل الشفط", val: myStation.suctionRate, color: C.info },
                ].map((item, i) => (
                  <div key={i} style={{ background: C.bg, borderRadius: 12, padding: 14, textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>{item.label}</div>
                    <div style={{ display: "flex", justifyContent: "center" }}><CircularGauge value={item.val} color={item.color} size={80} /></div>
                  </div>
                ))}
              </div>
            </Card>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Card title="سجل الامتلاء الأسبوعي" icon="📈">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={stationHistory} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="gCitFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.accent} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={C.accent} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="day" tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="الامتلاء" stroke={C.accent} fill="url(#gCitFill)" strokeWidth={2} name="الامتلاء %" />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              <Card title="كميات النفايات الشهرية (كجم)" icon="📊">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthlyCollection} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 10, fontFamily: ARABIC_FONT }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontFamily: ARABIC_FONT, fontSize: 10 }} />
                    <Bar dataKey="عضوية" stackId="a" fill={C.accent} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="بلاستيك" stackId="a" fill={C.info} />
                    <Bar dataKey="ورق" stackId="a" fill={C.warning} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
          </div>
        )}

        {/* REQUEST BIN */}
        {tab === "request" && (
          <div style={{ maxWidth: 550 }}>
            {requestSubmitted ? (
              <div style={{ background: C.card, border: `1px solid ${C.accent}40`, borderRadius: 16, padding: 32, textAlign: "center" }}>
                <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.accent, marginBottom: 8 }}>تم إرسال الطلب بنجاح!</div>
                <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.8, marginBottom: 16 }}>
                  رقم الطلب: <strong style={{ color: C.text }}>REQ-{Math.floor(1000 + Math.random() * 9000)}</strong><br />
                  سيتم مراجعة طلبك والرد عليك خلال 3-5 أيام عمل
                </div>
                <button onClick={() => { setRequestSubmitted(false); setReqAddress(""); }} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: C.accent, color: "#000", fontWeight: 700, cursor: "pointer", fontFamily: ARABIC_FONT, fontSize: 13 }}>تقديم طلب آخر</button>
              </div>
            ) : (
              <Card title="طلب حاوية جديدة" icon="📝">
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
                  <button onClick={() => { if (reqAddress.trim()) setRequestSubmitted(true); }} style={{
                    padding: "14px", borderRadius: 12, border: "none", background: reqAddress.trim() ? C.g1 : C.border,
                    color: reqAddress.trim() ? "#fff" : C.dim, fontWeight: 800, cursor: reqAddress.trim() ? "pointer" : "not-allowed",
                    fontFamily: ARABIC_FONT, fontSize: 14, marginTop: 8,
                  }}>إرسال الطلب</button>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* REPORT PROBLEM */}
        {tab === "report" && (
          <div style={{ maxWidth: 550 }}>
            {reportSubmitted ? (
              <div style={{ background: C.card, border: `1px solid ${C.accent}40`, borderRadius: 16, padding: 32, textAlign: "center" }}>
                <div style={{ fontSize: 56, marginBottom: 12 }}>📨</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.accent, marginBottom: 8 }}>تم إرسال البلاغ بنجاح!</div>
                <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.8, marginBottom: 16 }}>
                  رقم البلاغ: <strong style={{ color: C.text }}>RPT-{Math.floor(1000 + Math.random() * 9000)}</strong><br />
                  سيتم التعامل مع البلاغ خلال 24 ساعة كحد أقصى
                </div>
                <button onClick={() => { setReportSubmitted(false); setReportType(""); setReportDesc(""); }} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: C.accent, color: "#000", fontWeight: 700, cursor: "pointer", fontFamily: ARABIC_FONT, fontSize: 13 }}>تقديم بلاغ آخر</button>
              </div>
            ) : (
              <Card title="إبلاغ عن مشكلة" icon="⚠️">
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
                  <button onClick={() => { if (reportType && reportDesc.trim()) setReportSubmitted(true); }} style={{
                    padding: "14px", borderRadius: 12, border: "none",
                    background: (reportType && reportDesc.trim()) ? "linear-gradient(135deg, #f59e0b, #d97706)" : C.border,
                    color: (reportType && reportDesc.trim()) ? "#000" : C.dim,
                    fontWeight: 800, cursor: (reportType && reportDesc.trim()) ? "pointer" : "not-allowed",
                    fontFamily: ARABIC_FONT, fontSize: 14, marginTop: 8,
                  }}>إرسال البلاغ</button>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* REPORT HISTORY */}
        {tab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>📋 سجل البلاغات السابقة</div>
            {CITIZEN_REPORTS.map((r, i) => {
              const statusColor = r.status === "تم الحل" ? C.accent : C.warning;
              return (
                <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 11, color: C.dim, background: C.bg, padding: "3px 8px", borderRadius: 6 }}>{r.id}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{r.type}</span>
                    </div>
                    <span style={{ padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: statusColor + "20", color: statusColor }}>{r.status}</span>
                  </div>
                  <div style={{ display: "flex", gap: 16, fontSize: 11, color: C.dim, marginBottom: 8 }}>
                    <span>📅 {r.date}</span>
                    <span>📍 {r.district}</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, background: C.bg, padding: "8px 12px", borderRadius: 8 }}>
                    💬 الرد: {r.response}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
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
    { key: "citizen", label: "المواطنين", icon: "🏠", desc: "طلب حاويات، إبلاغ عن مشاكل، متابعة الحي", color: "#3b82f6", gradient: "linear-gradient(135deg, #3b82f6, #1d4ed8)" },
  ];

  const filteredHints = selectedRole ? ALL_USERS.filter(u => u.role === selectedRole) : ALL_USERS;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0e1a 0%, #0f172a 50%, #0a0e1a 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: ARABIC_FONT, direction: "rtl" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <div style={{ width: 480, padding: 36, background: "#111827", borderRadius: 24, border: "1px solid #1e293b", position: "relative", overflow: "hidden" }}>
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
  const { userData, userRole, logout } = useAuth();
  const [page, setPage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [time, setTime] = useState(new Date());
  const [showPassModal, setShowPassModal] = useState(false);

  // 📦 البيانات من Firebase
  const [stations, setStations] = useState([]);
  const [loadingStations, setLoadingStations] = useState(true);
  const weeklyData = useMemo(() => generateWeeklyData(), []);
  const monthlyTrend = useMemo(() => generateMonthlyTrend(), []);
  const hourlyData = useMemo(() => generateHourlyData(), []);

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
    { key: "dashboard", label: "لوحة التحكم", icon: "📊" },
    { key: "stations",  label: "المحطات",      icon: "🏭" },
    { key: "control",   label: "وحدة التحكم",  icon: "🚿" },
    { key: "fire",      label: "إنذار الحرائق", icon: "🔥" },
    { key: "predictions", label: "التنبؤات",   icon: "🔮" },
    { key: "reports",   label: "التقارير",      icon: "📋" },
    { key: "settings",  label: "الإعدادات",     icon: "⚙️" },
  ];

  return (
    <div dir="rtl" style={{ fontFamily: ARABIC_FONT, background: C.bg, color: C.text, minHeight: "100vh", display: "flex", overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <SessionTimeout onLogout={handleLogout} timeoutMin={30} countdownSec={10} />

      <aside style={{ width: sidebarOpen ? 240 : 64, background: C.card, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", transition: "width 0.3s ease", overflow: "hidden", flexShrink: 0 }}>
        <div style={{ padding: sidebarOpen ? "20px 18px" : "20px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, minHeight: 70 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: C.g1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>♻️</div>
          {sidebarOpen && <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text, whiteSpace: "nowrap" }}>إدارة النفايات - بريدة</div>
            <div style={{ fontSize: 10, color: C.accent, fontWeight: 600 }}>Smart Waste MIS</div>
          </div>}
        </div>
        <nav style={{ flex: 1, padding: "12px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
          {navItems.map((item) => (
            <button key={item.key} onClick={() => setPage(item.key)} style={{
              display: "flex", alignItems: "center", gap: 12, padding: sidebarOpen ? "12px 14px" : "12px 0",
              justifyContent: sidebarOpen ? "flex-start" : "center", borderRadius: 10, border: "none",
              background: page === item.key ? C.accent + "18" : "transparent", color: page === item.key ? C.accent : C.muted,
              cursor: "pointer", fontSize: 14, fontWeight: page === item.key ? 700 : 500, fontFamily: ARABIC_FONT, whiteSpace: "nowrap",
            }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>{item.icon}</span>
              {sidebarOpen && item.label}
            </button>
          ))}
        </nav>

        {/* User info + logout */}
        <div style={{ padding: "12px 8px", borderTop: `1px solid ${C.border}` }}>
          {sidebarOpen && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginBottom: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: C.accent + "20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{loggedInUser.avatar}</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{loggedInUser.name}</div>
                <div style={{ fontSize: 10, color: C.accent }}>{loggedInUser.roleTitle}</div>
              </div>
            </div>
          )}
          <button onClick={() => setShowPassModal(true)} style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%", padding: sidebarOpen ? "10px 14px" : "10px 0",
            justifyContent: sidebarOpen ? "flex-start" : "center", borderRadius: 10, marginBottom: 6,
            border: `1px solid #10b98130`, background: `#10b98110`, color: "#10b981",
            cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: ARABIC_FONT,
          }}>
            <span style={{ fontSize: 16 }}>⚙️</span>
            {sidebarOpen && "إعدادات الحساب"}
          </button>
          <button onClick={handleLogout} style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%", padding: sidebarOpen ? "10px 14px" : "10px 0",
            justifyContent: sidebarOpen ? "flex-start" : "center", borderRadius: 10,
            border: `1px solid ${C.danger}30`, background: `${C.danger}10`, color: C.danger,
            cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: ARABIC_FONT,
          }}>
            <span style={{ fontSize: 16 }}>🚪</span>
            {sidebarOpen && "تسجيل خروج"}
          </button>
        </div>
      </aside>

      {showPassModal && <ChangePasswordModal onClose={() => setShowPassModal(false)} />}

      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ padding: "14px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: C.card, flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: C.text }}>{navItems.find((n) => n.key === page)?.label}</h1>
            <span style={{ fontSize: 12, color: C.dim }}>مدينة بريدة • {time.toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} • {time.toLocaleTimeString("ar-SA")}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ position: "relative", width: 40, height: 40, borderRadius: 10, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              🔔
              <span style={{ position: "absolute", top: -2, right: -2, width: 16, height: 16, borderRadius: "50%", background: C.danger, fontSize: 9, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                {alerts.filter((a) => a.type === "حرج").length}
              </span>
            </div>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: C.g1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{loggedInUser.avatar}</div>
          </div>
        </header>
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          {page === "dashboard" && <DashboardPage stations={stations} weeklyData={weeklyData} monthlyTrend={monthlyTrend} alerts={alerts} hourlyData={hourlyData} />}
          {page === "stations" && <StationsPage stations={stations} />}
          {page === "control"  && <SuctionControlPage stations={stations} user={loggedInUser} />}
          {page === "fire" && <FireAlertPage stations={stations} />}
          {page === "predictions" && <PredictionsPage stations={stations} />}
          {page === "reports" && <ReportsPage stations={stations} monthlyTrend={monthlyTrend} weeklyData={weeklyData} />}
          {page === "settings" && <SettingsPage />}
        </div>
      </main>
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
      <div style={{ width:460, padding:"40px", background:"#111827", borderRadius:24, border:"1px solid #f59e0b30", textAlign:"center" }}>
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
          <div style={{ width:400, padding:40, background:"#111827", borderRadius:24, textAlign:"center", border:"1px solid #ef444430" }}>
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

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
