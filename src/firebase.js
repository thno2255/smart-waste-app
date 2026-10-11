// firebase.js

import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAP0p-be5NrCJACSAhUc1OStZwdFwfLnmA",
  authDomain: "hdhdhsus-84995.firebaseapp.com",
  projectId: "hdhdhsus-84995",
  storageBucket: "hdhdhsus-84995.firebasestorage.app",
  messagingSenderId: "100944130128",
  appId: "1:100944130128:web:c37d9b7b3cf4632f5ba155",
};

const app = initializeApp(firebaseConfig);

// 🔑 المهمين
export const auth = getAuth(app);
export const db = getFirestore(app);

// Local emulator mode (never in production builds): `VITE_USE_EMULATOR=1 npm run dev`
// with `firebase emulators:start` → the whole app runs against local Auth+Firestore,
// so demos, seeds and simulations can be verified without touching real data.
export const USING_EMULATOR = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === "1";
if (USING_EMULATOR) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  console.info("[firebase] connected to local emulators (auth:9099, firestore:8080)");
}