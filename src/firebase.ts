// This file defines Firebase client-side configuration.
// In a Node.js (Firebase Functions) environment, environment variables are accessed via process.env.
// The 'VITE_' prefix is typically used by Vite for client-side environment variables.
// If these are meant to be Firebase Functions environment variables, they should be accessed via process.env.
// If this file is purely for client-side, it should be excluded from the functions build.
// Assuming it's intended for functions and needs to access environment variables.

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
  measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// You might also have some initialization here, e.g.:
// import { initializeApp } from "firebase/app";
// const app = initializeApp(firebaseConfig);

export default firebaseConfig;