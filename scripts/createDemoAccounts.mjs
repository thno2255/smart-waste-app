#!/usr/bin/env node
/**
 * Creates/refreshes the DEMO accounts for the judging panel — one per role —
 * with NO password in the repository. Uses the Firebase Admin SDK (bypasses
 * security rules, so it can set role/status/municipality directly).
 *
 *   # local emulators (what `VITE_USE_EMULATOR=1 npm run dev` uses):
 *   FIREBASE_EMULATOR=1 DEMO_PASSWORD='<choose one>' node scripts/createDemoAccounts.mjs
 *
 *   # production project (needs the service-account JSON, same as api/iot/readings):
 *   FIREBASE_SERVICE_ACCOUNT_JSON='…' DEMO_PASSWORD='<choose one>' node scripts/createDemoAccounts.mjs
 *
 * Optional: DEMO_EMAIL_DOMAIN (default demo.smartwaste.local), FIREBASE_PROJECT_ID.
 *
 * Accounts (all status=active, flagged demo:true):
 *   admin@…         executive  PLATFORM_ADMIN        all municipalities
 *   manager.east@…  manager    MUNICIPALITY_MANAGER  municipalityId=east
 *   manager.north@… manager    MUNICIPALITY_MANAGER  municipalityId=north
 *   ops.east@…      employee   OPERATIONS_EMPLOYEE   municipalityId=east
 *   driver.east@…   driver     DRIVER                municipalityId=east (+ driver profile)
 */
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PASSWORD = process.env.DEMO_PASSWORD;
if (!PASSWORD || PASSWORD.length < 8) { console.error("Set DEMO_PASSWORD (≥ 8 chars). Nothing is hard-coded in the repo."); process.exit(1); }
const DOMAIN = process.env.DEMO_EMAIL_DOMAIN || "demo.smartwaste.local";
const projectId = process.env.FIREBASE_PROJECT_ID || (readFileSync(new URL("../src/firebase.js", import.meta.url), "utf8").match(/projectId:\s*"([^"]+)"/) || [])[1];

if (process.env.FIREBASE_EMULATOR === "1") {
  process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
  initializeApp({ projectId });
  console.log("→ emulator mode (" + projectId + ")");
} else {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) { console.error("Production run needs FIREBASE_SERVICE_ACCOUNT_JSON (or use FIREBASE_EMULATOR=1)."); process.exit(1); }
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)), projectId });
}
const auth = getAuth(); const db = getFirestore();

const ACCOUNTS = [
  { local: "admin",         role: "executive", roleAr: "مدير المنصة (إدارة عليا)", fullName: "مدير المنصة — عرض", municipalityId: null },
  { local: "manager.east",  role: "manager",   roleAr: "مدير بلدية",              fullName: "مدير بلدية شرق بريدة — عرض", municipalityId: "east" },
  { local: "manager.north", role: "manager",   roleAr: "مدير بلدية",              fullName: "مدير بلدية شمال بريدة — عرض", municipalityId: "north" },
  { local: "ops.east",      role: "employee",  roleAr: "موظف تشغيلي",             fullName: "موظف تشغيل شرق بريدة — عرض", municipalityId: "east" },
  { local: "driver.east",   role: "driver",    roleAr: "سائق ميداني",             fullName: "سائق شرق بريدة — عرض", municipalityId: "east" },
];

const now = new Date().toISOString();
for (const a of ACCOUNTS) {
  const email = `${a.local}@${DOMAIN}`;
  let user;
  try { user = await auth.getUserByEmail(email); await auth.updateUser(user.uid, { password: PASSWORD, displayName: a.fullName }); console.log("existing", email); }
  catch { user = await auth.createUser({ email, password: PASSWORD, displayName: a.fullName, emailVerified: true }); console.log("created ", email); }
  const ref = db.collection("users").doc(user.uid);
  const prev = (await ref.get()).data();
  await ref.set({ uid: user.uid, email, fullName: a.fullName, phone: "", district: "", role: a.role, roleAr: a.roleAr, status: "active", municipalityId: a.municipalityId, demo: true, createdAt: prev?.createdAt || now, updatedAt: now }, { merge: true });
  if (a.role === "driver") {
    const pref = db.collection("driver_profiles").doc(user.uid);
    const p = (await pref.get()).data();
    if (!p) await pref.set({ uid: user.uid, driverCode: null, fullName: a.fullName, phone: "", email, accountStatus: "active", shiftStatus: "off_shift", availability: "available", vehicleId: null, neighborhoodKeys: [], shiftStart: null, shiftEnd: null, locationSharing: false, lastLocation: null, currentRouteId: null, municipalityId: a.municipalityId, demo: true, stats: { routesCompleted: 0, binsCollected: 0 }, createdAt: now, updatedAt: now });
    else await pref.set({ municipalityId: a.municipalityId, updatedAt: now }, { merge: true });
  }
}
console.log("\nDone. Emails: " + ACCOUNTS.map((a) => `${a.local}@${DOMAIN}`).join(", ") + "\nPassword: the DEMO_PASSWORD you provided (stored nowhere).");
process.exit(0);
