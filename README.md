# ♻️ Smart Waste MIS — نظام إدارة النفايات الذكي

<div align="center">
🚀 **[تجربة النظام مباشرة](https://smart-waste-app-psi.vercel.app)**

![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite)
![Firebase](https://img.shields.io/badge/Firebase-Firestore-FFCA28?style=flat-square&logo=firebase)
![Vercel](https://img.shields.io/badge/Deployed-Vercel-000000?style=flat-square&logo=vercel)

<br/>

لوحة تحكم ذكية لإدارة محطات شفط النفايات في مدينة بريدة — منطقة القصيم

</div>
---

## 📋 وصف المشروع

**Smart Waste MIS** نظام متكامل لإدارة البنية التحتية لشفط النفايات مبني بتقنيات حديثة. يوفر النظام بيانات فورية (Realtime)
 لمستويات الامتلاء والضغط وحالة الحاويات، مع دعم ثلاثة مستويات وصول مختلفة: الموظفون، الإدارة العليا، والمواطنون.

---

## ✨ المميزات

### 🏭 إدارة المحطات
- عرض جميع المحطات مع مؤشرات الامتلاء والضغط والنفايات اليومية
- إضافة وتعديل المحطات مع حقل الحي كنص حر
- فلترة المحطات حسب الحالة (طبيعي / تحذير / حرج)
- ترتيب المحطات حسب مستوى الامتلاء أو عدد الحاويات

### 🗑️ إدارة الحاويات
- CRUD كامل للحاويات داخل كل محطة
- مؤشرات خطر مرمّزة بالألوان مع تأثير توهّج للحالات الحرجة
- ترتيب الحاويات حسب درجة الخطر

### 🚿 وحدة التحكم بالشفط
- إصدار أوامر شفط فورية أو مجدولة أو متكررة يومياً
- تحديد نوع العملية: من حاوية إلى محطة، أو من محطة إلى المركزية
- متابعة الأوامر النشطة والسجل التاريخي في الوقت الفعلي

### 🔔 نظام التنبيهات
- تنبيهات تلقائية عند تجاوز حدود الامتلاء
- إنذارات حريق (fire alerts) مع تحليل درجة الحرارة ومستوى الغاز
- تصنيف ثلاثي: حرج / تحذير / طبيعي

### 🏛️ بوابة الإدارة العليا
- تحليلات مالية وأداء ربعي
- مقارنة أداء الأحياء
- سيناريوهات القرار والأهداف الاستراتيجية

### 🏠 بوابة المواطن
- تقديم طلبات حاويات جديدة والإبلاغ عن مشاكل
- متابعة حالة الطلبات والبلاغات بشكل فوري (Realtime)
- عرض الحاويات المعتمدة بعد موافقة الموظف

### 📬 إدارة الطلبات والبلاغات (للموظفين)
- قبول أو رفض طلبات المواطنين مع إمكانية إضافة رد
- تحديث حالة البلاغات (تم الحل / تحت المتابعة / مرفوض)
- التحديث ينعكس فوراً على حساب المواطن

### 🔒 أمان الجلسة
- انتهاء تلقائي بعد 30 دقيقة من الخمول
- نافذة تحذير مع عد تنازلي 10 ثوانٍ قبل تسجيل الخروج

### 📊 الرسوم البيانية والتحليلات
- مخططات مساحية وشريطية ودائرية (Recharts)
- بيانات أداء أسبوعية وشهرية وربعية

### 📱 تصميم متجاوب
- دعم كامل للجوال مع قائمة جانبية كـ Drawer overlay
- هيدر مضغوط على الشاشات الصغيرة

---

## 🛠️ التقنيات المستخدمة

| التقنية | الاستخدام |
|---------|-----------|
| **React 18** | واجهة المستخدم وإدارة الحالة |
| **Vite 5** | بيئة التطوير والبناء السريع |
| **Firebase Auth** | تسجيل الدخول والتسجيل وإدارة المستخدمين |
| **Cloud Firestore** | قاعدة البيانات الفورية (onSnapshot) |
| **Recharts** | الرسوم البيانية والتحليلات |
| **SheetJS (xlsx)** | تصدير البيانات إلى Excel |
| **Vercel** | النشر والاستضافة |

---

## 🗄️ هيكل قاعدة البيانات (Firestore Collections)

```
📦 Firestore
 ├── 📁 stations          # المحطات
 │    └── { name, district, fillLevel, pressure, dailyWaste, wasteType, containers[] }
 ├── 📁 sensors           # المستشعرات
 │    └── { stationId, containerId, type, value, unit, lastReading }
 ├── 📁 alerts            # التنبيهات
 │    └── { stationId, stationName, type, message, severity, resolved }
 ├── 📁 fire_alerts       # إنذارات الحريق
 │    └── { stationId, temperature, gasLevel, smokeDetected, riskLevel, resolved }
 ├── 📁 suctionJobs       # أوامر الشفط
 │    └── { type, scheduleType, scheduledAt, recurringTime, status, fromId, toId }
 ├── 📁 requests          # طلبات الحاويات
 │    └── { userId, userName, district, address, binType, notes, status, response }
 ├── 📁 citizen_reports   # بلاغات المواطنين
 │    └── { userId, userName, district, type, description, location, status, response }
 ├── 📁 districts         # الأحياء
 │    └── { name, city, fillLevel, wasteTotal, performance, stationCount }
 └── 📁 users             # المستخدمون
      └── { uid, email, fullName, role, district, status, createdAt }
```

### منطق تصنيف الحالات (مشتق — لا يُخزَّن في Firebase)

```js
getStatus(fillLevel):
  >= 85  →  "حرج"    🔴
  >= 60  →  "تحذير"  🟡
  <  60  →  "طبيعي"  🟢
```

---

## 🚀 تشغيل المشروع محلياً

### المتطلبات
- Node.js 18+
- حساب Firebase مع Firestore و Authentication مفعّلَيْن

### خطوات التشغيل

```bash
# 1. استنساخ المستودع
git clone https://github.com/your-username/smart-waste-mis.git
cd smart-waste-mis

# 2. تثبيت الحزم
npm install

# 3. إعداد Firebase — عدّل src/firebase.js بإعدادات مشروعك
```

```js
// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
```

```bash
# 4. تشغيل خادم التطوير
npm run dev
```

افتح المتصفح على: `http://localhost:5173`

> **تهيئة قاعدة البيانات:** بعد تسجيل الدخول كموظف، اذهب إلى **الإعدادات** واضغط **"🚀 تهيئة Collections الناقصة"** لإنشاء البيانات الأولية.

---

## 📦 بناء المشروع للإنتاج

```bash
npm run build
# الناتج في مجلد dist/
```

---

## 🌐 النشر على Vercel

### من واجهة Vercel (الأسهل)

1. ارفع المشروع على GitHub
2. اذهب إلى [vercel.com](https://vercel.com) وسجّل الدخول
3. اضغط **New Project** → استورد المستودع
4. Vercel يكتشف Vite تلقائياً → اضغط **Deploy**

### من سطر الأوامر

```bash
npm install -g vercel
vercel --prod
```

---

## 👥 مستويات الوصول

| الدور | الصلاحيات |
|-------|-----------|
| 👷 **موظف** | إدارة المحطات والحاويات، وحدة الشفط، الطلبات والبلاغات، التقارير |
| 🏛️ **إدارة عليا** | التحليلات المالية، أداء الأحياء، سيناريوهات القرار، إدارة المستخدمين |
| 🏠 **مواطن** | تقديم طلبات وبلاغات، متابعة حالتها، عرض حاوياتي |

---

## 📸 لقطات الشاشة

> ضع لقطات الشاشة في مجلد `screenshots/` وأزل التعليق عن الجدول أدناه

<!--
| لوحة التحكم | المحطات | وحدة الشفط |
|-------------|---------|------------|
| ![dashboard](screenshots/dashboard.png) | ![stations](screenshots/stations.png) | ![suction](screenshots/suction.png) |

| بوابة المواطن | الإدارة العليا | الطلبات والبلاغات |
|--------------|----------------|-------------------|
| ![citizen](screenshots/citizen.png) | ![exec](screenshots/exec.png) | ![requests](screenshots/requests.png) |
-->

---

## 📁 هيكل الملفات

```
src/
 ├── App.jsx                   # التطبيق الكامل (مكونات + صفحات + منطق)
 ├── firebase.js               # إعداد Firebase
 ├── firestoreService.js       # طبقة Firestore (Hooks + CRUD لكل collection)
 ├── exportAllDataToExcel.js   # تصدير كامل قاعدة البيانات إلى Excel
 ├── seedFirestore.js          # تهيئة البيانات التجريبية الأولية
 └── index.css                 # الأنماط العامة والتجاوب مع الجوال
```

---

## 📄 الرخصة

هذا المشروع مطوّر لأغراض تعليمية وبحثية.  
**المدينة:** بريدة، منطقة القصيم، المملكة العربية السعودية.
