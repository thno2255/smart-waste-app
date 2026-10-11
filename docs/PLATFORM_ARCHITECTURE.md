# Smart Waste MIS — منصة الإدارة الذكية للنفايات البلدية
## Phase 0 — Discovery & Architecture (12 أكتوبر 2026)

> حالة التنفيذ: الفجوات أدناه سُدّت في المراحل 1–7؛ التقرير النهائي (الملفات، قاعدة البيانات، الاختبارات، القيود) في `docs/ENTERPRISE_PLATFORM_REPORT.md`.

### 1. ما فُحص فعليًا
| المجال | الحالة الحالية (قبل هذه الجولة) |
|---|---|
| الكود | `src/App.jsx` ≈ 9,240 سطرًا (كل الصفحات)، 14 وحدة نقية مختبَرة (`decisionEngine`, `prediction`, `routeOptimizer`, `assignmentEngine`, `fleetEngine`, `navigation`, `executionEngine`, `mapVisual`, `impact`, `municipalities`, `simulation/*`, `demoScenario`, `offlineQueue`, `alertsEngine`) |
| قاعدة البيانات (Firestore) | `municipalities`, `neighborhoods`, `bins`, `iot_devices`, `sensor_readings` (REAL، كتابة خادمية فقط عبر `api/iot/readings`), `simulated_readings` (SIMULATED), `users`, `driver_profiles`, `driver_vehicle_assignments`, `driver_assignment_history`, `driver_shifts`, `driver_locations`, `vehicles`, `collection_routes` (تتضمن `orderedStops`), `collection_events`, `route_incidents`, `vehicle_status_history`, `audit_log`, `alerts`, `citizen_reports`, `requests`, `simulation_state`, `demo_sessions` + مجموعات قديمة للقراءة فقط |
| الصلاحيات | `firestore.rules` (مختبَرة على المحاكي، 13 سيناريو): أدوار `executive/manager/employee/driver/citizen`، عزل بالبلدية (`municipalityId`) خادميًا، السائق يرى جولاته فقط، القراءات الحقيقية غير قابلة للكتابة من العملاء |
| الصفحات | لوحة التحكم، الخريطة التشغيلية (طبقات)، البلديات والنطاقات، الأحياء، الحاويات، إدارة الجولات (اعتماد + توصية سائق + تحسين ترتيب)، السائقون والأسطول، متابعة الأسطول، الطلبات والبلاغات، التنبيهات الحرارية، التنبؤات، التقارير (أثر/أسطول)، سجل العمليات، المحاكاة، سيناريو العرض، الإعدادات، بوابة متخذي القرار، بوابة السائق (ملاحة)، بوابة الأفراد |
| المحركات | أولوية + أهلية الجمع، تنبؤ (انحدار خطي مع كشف تفريغ/شذوذ وثقة وأسباب)، اقتراح جولات لكل حي + مزامنة تلقائية، تحسين ترتيب (2-opt/Or-opt على مصفوفة OSRM بقيود السعة والأولوية)، ترشيح سائق (زمن طرق، سعة، حمل، حداثة الموقع)، ملاحة (مناورات OSRM، انحراف، وصول)، تنفيذ (تأكيد idempotent، تخطي منفصل، بلاغات) |
| الخرائط | 13 مضلع حي من OSM + السلامة تقريبي؛ نطاقات البلديات = غلاف محدب تجريبي (الحدود الرسمية PDF مصوّر فقط) |
| الخدمات/API | `api/iot/readings` (Vercel Function، مفاتيح أجهزة مُجزَّأة)، OSRM عام (route/table/steps) معزول في `roadRouting.js` |
| الاختبارات | 171 وحدة + 13 قواعد + تحقق Playwright على محاكي Firebase |
| المصادر الرسمية | انظر `docs/MULTI_MUNICIPALITY_PLATFORM.md` (البلديات الست، المساحات، أسماء الأحياء 130، خرائط النطاق) — روابط الأمانة تعمل لكن شهادة TLS لا تُتحقق من بعض العملاء |

### 2. الفجوات مقابل المطلوب
| المطلوب | الفجوة |
|---|---|
| هوية حكومية فاتحة + صفحة رئيسية عامة | الواجهة داكنة بالكامل، لا صفحة رئيسية قبل الدخول، الاسم "Smart Waste MIS" فقط |
| أربع بوابات بأدوار `AMANAH_DECISION_MAKER / MUNICIPALITY_MANAGER / OPERATIONS_EMPLOYEE / DRIVER` | موجودة فعليًا بأسماء قديمة (`executive/manager/employee/driver`)؛ تُعرض بالأسماء الجديدة دون كسر البيانات |
| زر "إنشاء خطة الجمع الذكية" (خطة شاملة للبلدية) | التوليد والتحسين والإسناد موجودة كخطوات منفصلة؛ لا محرك خطة موحّد ولا سجل `optimization_runs` |
| توزيع الموارد بين البلديات + طلبات الدعم + اعتماد النقل | غير موجود |
| مركز محاكاة القرارات (ماذا لو) | غير موجود (يوجد محاكي مستشعرات فقط) |
| "العقل التشغيلي للمدينة" (ماذا سيحدث / أفضل إجراء / الأثر) | غير موجود كواجهة مركزية |
| سيناريو عرض 21 خطوة عبر البوابات الأربع | يوجد سيناريو 12 خطوة |
| كيانات: `support_requests`, `resource_transfers`, `simulation_scenarios/results`, `optimization_runs`, `decision_recommendations` | غير موجودة |

### 3. المعمارية المستهدفة
```
الطبقة العامة: LandingPage (عام) → AuthPage → توجيه تلقائي بالدور
البوابات:   Amanah (executive) │ Municipality (manager) │ Operations (employee) │ Driver (driver) │ Citizen
المحركات النقية (بلا React/Firestore، مختبَرة):
   prediction → decisionEngine (أولوية/أهلية/اقتراح) → routeOptimizer → assignmentEngine
   collectionPlanner (جديد: خطة بلدية كاملة = اقتراح + تحسين + ترشيح + مؤشرات + ما تعذر خدمته)
   interMunicipalEngine (جديد: ضغط تشغيلي، نقص، مقترحات نقل بأثر الطرفين)
   decisionSimulator (جديد: نسخة معزولة من الحالة + سيناريو + إعادة تخطيط + مقارنة بخط الأساس)
   impact / fleet analytics (قياس عادل بنفس المدخلات)
الخدمة: firestoreService (hooks منطاقة بالبلدية، كتابات idempotent، batch/transactions)
الأمن: firestore.rules (RBAC + عزل + ملكية) + api/iot (خادم)
البيانات: كل صف قراءة/حاوية يحمل source ∈ {REAL, SIMULATED, IMPORTED} وdemo:true للصفوف القابلة للحذف
```
قرار معماري: لا توجد SQL ولا جداول علاقات؛ الكيانات المطلوبة تُمثَّل كمجموعات Firestore مع تنسيخ `municipalityId` للعزل الخادمي. `route_stops` تبقى مضمّنة في `collection_routes.orderedStops` (قراءة واحدة، أحجام صغيرة)، و`route_assignments` = حقول `driverId/vehicleId/approvedBy` على الجولة + سجل التدقيق، و`driver_neighborhood_assignments` = `driver_profiles.neighborhoodKeys` + `driver_assignment_history`.

### 4. خطة الترحيل
1. الأدوار: لا تغيير في القيم المخزنة؛ خريطة عرض `executive→AMANAH_DECISION_MAKER` …؛ الحسابات القديمة بلا `municipalityId` تبقى غير منطاقة (موسومة legacy) حتى تُعيَّن.
2. الثيم: `C` تُشتق من `localStorage.swm_theme` (فاتح افتراضيًا)؛ الألوان الصلبة تُستبدل برموز الثيم.
3. المجموعات الجديدة تُضاف بقواعد مقيدة (الأمانة تعتمد النقل، المدير يطلب الدعم، الموظف ينشئ الخطة).
4. كل ميزة تُختبر على محاكي Firebase محليًا قبل أي نشر؛ لا بيانات تجريبية في الإنتاج دون موافقة.
