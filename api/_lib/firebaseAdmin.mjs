/* global process */
// Shared firebase-admin initialisation for server functions (files under api/_lib are not routes).
// Emulator: when FIRESTORE_EMULATOR_HOST is set the Admin SDK talks to the local emulator and
// needs no credentials. Production: FIREBASE_SERVICE_ACCOUNT_JSON (server env, never VITE_-prefixed).
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

export function adminApp() {
  if (!getApps().length) {
    if (process.env.FIRESTORE_EMULATOR_HOST) initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "hdhdhsus-84995" });
    else {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
      initializeApp({ credential: cert(JSON.parse(raw)) });
    }
  }
  return getApps()[0];
}
export const adminDb = () => { adminApp(); return getFirestore(); };
export const adminAuth = () => { adminApp(); return getAuth(); };
