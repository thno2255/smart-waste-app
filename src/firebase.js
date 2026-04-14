// firebase.js

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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