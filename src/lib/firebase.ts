import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyCcDxura-YKm4qmYV2z4G-EX8JkGr15C3Q",
  authDomain: "unscriptly.firebaseapp.com",
  projectId: "unscriptly",
  storageBucket: "unscriptly.firebasestorage.app",
  messagingSenderId: "95655827036",
  appId: "1:95655827036:web:636f218879ee017823b899",
  measurementId: "G-HSD466M6YR",
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, "us-central1");

export const analyticsPromise =
  typeof window !== "undefined"
    ? isSupported().then((supported) => {
        return supported ? getAnalytics(app) : null;
      })
    : Promise.resolve(null);