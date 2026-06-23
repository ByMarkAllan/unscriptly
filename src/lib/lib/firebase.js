"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyticsPromise = exports.functions = exports.db = exports.auth = exports.app = void 0;
const app_1 = require("firebase/app");
const auth_1 = require("firebase/auth");
const firestore_1 = require("firebase/firestore");
const functions_1 = require("firebase/functions");
const analytics_1 = require("firebase/analytics");
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};
exports.app = (0, app_1.initializeApp)(firebaseConfig);
exports.auth = (0, auth_1.getAuth)(exports.app);
exports.db = (0, firestore_1.getFirestore)(exports.app);
exports.functions = (0, functions_1.getFunctions)(exports.app, "us-central1");
exports.analyticsPromise = typeof window !== "undefined"
    ? (0, analytics_1.isSupported)().then((supported) => {
        return supported ? (0, analytics_1.getAnalytics)(exports.app) : null;
    })
    : Promise.resolve(null);
