# خريطة التكامل — دورة التشغيل من القراءة إلى بوابة الأمانة
**التصنيف:** CONNECTED · PARTIALLY_CONNECTED · DISCONNECTED · NOT_VERIFIED

**حالة الاختبار:** **E2E** = `tests/integration/dispatch.e2e.test.mjs` (أُعيد تشغيله أثناء التدقيق: 8 من 8، محاكي معزول). **رحلة** = Playwright على المحاكي المحلي في جلسة التطوير السابقة اليوم، ولم يُعد تشغيلها أثناء التدقيق لأنها تكتب في قاعدة العرض المحلية.

> **الإنتاج:** لا شيء مما يلي منشور. كل التصنيفات تخص البيئة المحلية (انظر OPS-01).

| # | الانتقال | المصدر | المسؤول | مكان الحفظ | المستهلك | تحديث الواجهة | معالجة الأخطاء | الاختبار | التصنيف |
|---|---|---|---|---|---|---|---|---|---|
| 1 | قراءة المستشعر ← التحقق | ESP32 أو المحاكي | `api/iot/readings.js` (الحدود، المفتاح، الطابع الزمني)؛ المحاكي يكتب مباشرة | `sensor_readings` و`bins.last*`؛ المحاكي في `simulated_readings` و`bins` | المتصفح عبر `useRecentReadings` والخادم عبر `loadMunicipalityState` | `onSnapshot` | ingest يرد 4xx؛ المحاكي يعرض «تعذر تنفيذ العملية» | ingest **بلا اختبار آلي**؛ المحاكي برحلة | ingest: **NOT_VERIFIED**؛ المحاكي: **CONNECTED** |
| 2 | التحقق ← التنبؤ | القراءات خلال 24 ساعة | `getSensorConnectivity`، `getSensorHealth`، `computeFillRate`، `predictFullTime` | محسوب لا محفوظ | الأولوية والتخطيط والواجهة | إعادة حساب عند كل لقطة | «لا بيانات كافية» بدل التخمين | وحدات (prediction 9، priority 9) | **CONNECTED** |
| 3 | التنبؤ ← الأولوية | — | `getBinPriority` (امتلاء، حرارة، تنبؤ، زمن منذ آخر جمع، تنبيه حراري، بلاغات) | محسوب | الإسناد والواجهة | — | تُخفض الثقة عند خلل المستشعر | وحدات | **PARTIALLY_CONNECTED**: التنبيه الحراري من `fire_sensors` مزروعة ثابتة (IOT-03) |
| 4 | الأولوية ← تخطيط الجولة | — | الخادم: `planDispatch` (إدراج أولًا ثم جولة لكل حي و2-opt جوي)؛ المتصفح: `collectionPlanner` و`reconcileRecommendations` | `collection_routes` (خادم: `auto_<key>`) | السائق والعمليات | `onSnapshot` | تصعيد في `dispatch_decisions` | وحدات 18 + تكامل 10 + E2E | **CONNECTED** (الخادم) |
| 5 | التخطيط ← اختيار السائق | `driver_profiles`، `vehicles`، الجولات النشطة | `rankDriverCandidates` + زمن وصول OSRM (`computeRoadTravel`) | داخل القرار | — | — | فشل OSRM يعطي تقديرًا موسومًا؛ غياب الإحداثيات يرفع `routing_failed` | E2E (طرق مزيفة حتمية + فشل) + رحلة (OSRM حقيقي، 10 د) | **CONNECTED** |
| 6 | الاختيار ← الإسناد | — | `execute()` في معاملة مع قفل وإعادة تحقق | `collection_routes.status = approved`، `dispatch_decisions`، `audit_log` | العمليات والسائق | `onSnapshot` | `rejected_at_commit` مع السبب | E2E + تزامن | **CONNECTED** |
| 7 | الإسناد ← إشعار السائق | — | `notify()` في المعاملة | `driver_notifications` | بوابة السائق (`DriverNotifications`) | `onSnapshot` | — | E2E عبر القواعد + رحلة | **PARTIALLY_CONNECTED**: داخل التطبيق فقط، لا Web Push (DRV-01) |
| 8 | الإشعار ← بدء الجولة | السائق | `handleStart` و`startRoute` | `status = in_progress`، والمركبة `on_route` | العمليات | `onSnapshot` | طابور دون اتصال `offlineQueue` | E2E + رحلة | **CONNECTED** |
| 9 | البدء ← تأكيد التفريغ | السائق | `confirmCollection` (معرّف حتمي) | `collection_events`، `collectedBinIds`، `bins.lastCollectionAt` | العمليات والتقارير | `onSnapshot` | تكرار آمن | E2E + رحلة (6 من 6) | **CONNECTED** |
| 10 | التفريغ ← المؤشرات | قراءة المستشعر التالية | المستشعر الحقيقي، أو في العرض `syncEmptiedFromCollections` داخل نبضة المحاكي | `simulated_readings`، `bins` | اللوحات | `onSnapshot` | — | رحلة (15 إلى 13 حرجة) | **PARTIALLY_CONNECTED**: في العرض يتطلب تشغيل نبضة المحاكي من تبويب متصفح بحساب الأمانة (DRV-03) |
| 11 | المؤشرات ← بوابة البلدية | `bins`، `collection_routes`، `dispatch_decisions` | `DashboardPage`، `MunicipalityDashboard`، `DispatchSummary` | — | المدير | `onSnapshot` | — | رحلة | **CONNECTED** |
| 12 | ← بوابة الأمانة | نفس البيانات لكل البلديات | `useCityPressure` و`municipalityPressure` و`AmanahStrategicPanel` | محسوب | الأمانة | `onSnapshot` | — | وحدات (interMunicipal 7)؛ تحديث اللوحة بعد هذه الرحلة تحديدًا **لم يُختبر** | **NOT_VERIFIED** |

## مسارات جانبية
| المسار | التصنيف | الدليل |
|---|---|---|
| مزامنة المتصفح القديمة للاقتراحات | **PARTIALLY_CONNECTED**: تعمل من متصفح الموظف بمؤقت حين يكون الإسناد متوقفًا | `useEffect` + `setTimeout(6000)` في الغلاف |
| الجدولة الدورية في الإنتاج | **DISCONNECTED**: الملفات موجودة، لم تُدفع، الأسرار غير مضبوطة | ARCHITECTURE §6 |
| بوابة الأفراد ← الحاويات | **DISCONNECTED**: تعتمد `stations` القديمة | `CitizenPortal` |
| المساعد الذكي ← البيانات الحالية | **DISCONNECTED**: يقرأ `stations` و`suctionJobs` | `AIAssistant` |
| التنبيهات الحرارية ← حرارة الحاويات | **DISCONNECTED**: الصفحة تقرأ `fire_sensors` (أو أرقامًا عشوائية)، بينما الإسناد يستخدم `bins.lastTemperatureCelsius`. نموذجان منفصلان | `FireAlertPage`، `generateFireData` |
| نقل الموارد ← الإسناد | **CONNECTED**: تنفيذ النقل يغيّر `municipalityId` للمركبة والسائق، فتراه دورة الإسناد التالية | `executeResourceTransfer` + رحلة 21 خطوة سابقة |
| طلب الدعم ← الأمانة | **CONNECTED** | اختبار قواعد + رحلة سابقة |

## عزل البلديات حسب الصفحة
| الصفحة | التقييد | الدليل |
|---|---|---|
| لوحة العمليات، الجولات، الأسطول، الحاويات، الخريطة | مقيّدة (hooks بـ `municipalityId`) | `useScopedCollection` |
| **البلاغات والطلبات** | **غير مقيّدة**: الطلبات وبلاغات المواطنين لكل المدينة | `RequestsManagementPage` يستعلم المجموعتين بلا فلتر بلدية (ISO-01) |
| **التنبيهات الحرارية** | **غير مقيّدة**: `stations` و`fire_sensors` للمدينة | `FireAlertPage` |
| سجل العمليات | مقيّد في القواعد؟ **لا**: القراءة `isEmployee()` | `audit_log` |
| مستخدمو المنصة | **غير مقيّد** | SEC-02 |
