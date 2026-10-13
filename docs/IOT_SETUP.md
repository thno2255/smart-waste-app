# ربط ESP32 الحقيقي — خطوات التشغيل

الكود جاهز في المستودع؛ ما يلي هو ما يحتاج تدخّلًا بشريًا لأنه يمس بيئة الإنتاج (أسرار/قواعد).

## 1. حساب الخدمة (Firebase)
Firebase console → Project settings → Service accounts → **Generate new private key**.
ضع محتوى الملف JSON كاملًا على سطر واحد في متغير البيئة `FIREBASE_SERVICE_ACCOUNT_JSON` في Vercel
(Project → Settings → Environment Variables). لا تضعه أبدًا في ملف داخل المستودع ولا بالبادئة `VITE_`.

## 2. تفعيل نقطة الاستقبال
في Vercel أيضًا: `IOT_INGEST_ENABLED=true`. بدونها ترد النقطة `503` (مفتاح إيقاف طارئ).

النقطة: `POST https://<your-app>.vercel.app/api/iot/readings`
- الترويسة: `x-device-key: <مفتاح الجهاز>`
- الجسم: `{ "device_id": "DEV-الريان-01", "fill_level_percent": 63, "temperature_celsius": 29.5, "battery_level": 88, "signal": -61 }`
- الخادم يحدد الحاوية من سجل الجهاز (لا يثق بأي `bin_id` يرسله الجهاز)، يرفض القيم خارج النطاق (`422`)، ويرفض المفتاح التجريبي للمولّد.

## 3. مفتاح لكل جهاز
الإعدادات → **أجهزة IoT ومفاتيح الدخول** → "توليد مفتاح". يُعرض المفتاح مرة واحدة ويُخزَّن تجزئته فقط (SHA-256).
انسخه إلى `DEVICE_KEY` في `firmware/esp32_smart_bin/esp32_smart_bin.ino` مع `DEVICE_ID` المطابق لحقل `deviceId` في `iot_devices`.

## 4. قواعد Firestore
الملف `firestore.rules` موثّق في المستودع لكنه **غير منشور**. راجعه مقابل قواعد الـconsole الحالية ثم:
```bash
npm i -g firebase-tools && firebase login && firebase deploy --only firestore:rules
```
أهم ما يفرضه: `sensor_readings` لا تُكتب من أي عميل (الخادم فقط)، السائق يعدّل حقول التنفيذ فقط، والاعتماد للموظفين.

## 5. الجهاز
- ESP32 + HC-SR04 (TRIG 5 / ECHO 18 عبر مقسّم جهد) + DS18B20 (GPIO 4).
- ركّب DS18B20 داخل الحاوية قرب المستشعر في مسار الصدى، لا على اللوحة ولا داخل الغلاف المعرّض للشمس: الـsketch يستخدم قراءته لتعويض سرعة الصوت حراريًا. بدون التعويض تبدو الحاوية الفارغة ممتلئة بنحو 5% عند 50°م. إذا انفصل المسبار يرجع الحساب تلقائيًا لسرعة 20°م.
- عدّل `WIFI_SSID/WIFI_PASSWORD/INGEST_URL/BIN_HEIGHT_CM` في الـsketch وارفعه من Arduino IDE (مكتبات: OneWire, DallasTemperature, ArduinoJson).
- أول قراءة ناجحة ترد `201` وتظهر فورًا على الخريطة ولوحة التحكم.

## اختبار بدون جهاز
```bash
curl -X POST https://<your-app>.vercel.app/api/iot/readings \
  -H "Content-Type: application/json" -H "x-device-key: <المفتاح>" \
  -d '{"device_id":"DEV-الريان-01","fill_level_percent":91,"temperature_celsius":30}'
```
محليًا: `vercel dev` (وليس `npm run dev`) لتشغيل مجلد `api/`.
