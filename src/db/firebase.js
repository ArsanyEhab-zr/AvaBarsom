// src/db/firebase.js
import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";
import { getStorage } from "firebase/storage";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const readViteEnv = (getter) => {
  try {
    const val = getter();
    return val !== undefined && val !== null ? String(val).trim() : "";
  } catch {
    return "";
  }
};

const decodeGuardToken = (encoded) => {
  try {
    if (typeof atob === "function") return atob(encoded).toLowerCase();
    if (typeof Buffer !== "undefined") return Buffer.from(encoded, "base64").toString("utf8").toLowerCase();
  } catch {
    return "";
  }
  return "";
};

// Runtime safety blocklist preventing accidental connection to legacy deployments
const FORBIDDEN_LEGACY_B64 = [
  "c3RnZW9yZ2VnYW1hemEtNjIwODc=",
  "a2hlZG1ldHktYXBwLWZmOTgw",
  "c3RnZW9yZ2U=",
  "c3QtZ2Vvcmdl",
  "Z2FtYXph",
  "Z2hhbWF6YQ==",
  "bXItZ2VyZ3M=",
  "Z2VyZ3M=",
  "a2hlZG1ldHk=",
  "a2hlZG1pdHk=",
  "NTU4NDQxNDkwMDY1",
  "MjU0NzkzNDgzMzgw",
  "QUl6YVN5QUZzRjV1VXJEZzRHVFNlT0ViMmlUX0hfV3JzUTFIMGRZ"
];

const PLACEHOLDER_PATTERNS = [
  /^your_/i,
  /your_new_/i,
  /placeholder/i,
  /change_me/i,
  /replace_with/i,
  /^example/i,
  /^\.\.\.$/,
  /^<.*>$/
];

const firebaseConfig = {
  apiKey: readViteEnv(() => import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: readViteEnv(() => import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: readViteEnv(() => import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: readViteEnv(() => import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: readViteEnv(() => import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: readViteEnv(() => import.meta.env.VITE_FIREBASE_APP_ID),
  measurementId: readViteEnv(() => import.meta.env.VITE_FIREBASE_MEASUREMENT_ID)
};

function evaluateFirebaseSafetyFirewall(config) {
  const requiredKeys = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];
  const missingKeys = requiredKeys.filter((k) => !config[k]);

  if (missingKeys.length > 0) {
    return {
      ok: false,
      type: "missing",
      reason: `إعدادات Firebase غير مكتملة (${missingKeys.join(", ")}). أضف بيانات مشروع Firebase الخاص بالكنيسة الجديدة في ملف .env لتفعيل المزامنة السحابية.`
    };
  }

  const valuesToCheck = requiredKeys.map((k) => config[k]);
  if (valuesToCheck.some((val) => PLACEHOLDER_PATTERNS.some((rx) => rx.test(val)))) {
    return {
      ok: false,
      type: "placeholder",
      reason: "تم اكتشاف قيم نموذجية (Placeholder) في إعدادات Firebase. استبدل القيم في ملف .env ببيانات مشروع الكنيسة الجديدة الحقيقية."
    };
  }

  const forbiddenTokens = FORBIDDEN_LEGACY_B64.map(decodeGuardToken).filter(Boolean);
  const allCombined = valuesToCheck.join(" ").toLowerCase();
  const matchedForbidden = forbiddenTokens.some((token) => allCombined.includes(token));

  if (matchedForbidden) {
    return {
      ok: false,
      type: "forbidden_legacy",
      reason: "حظر جدار الحماية: تم منع الاتصال لأن بيانات Firebase تطابق مشروع كنيسة سابقة. يُمنع القراءة أو الكتابة على قاعدة بيانات الكنيسة القديمة نهائياً."
    };
  }

  return { ok: true, type: "configured", reason: "" };
}

const firewallResult = evaluateFirebaseSafetyFirewall(firebaseConfig);

export const isFirebaseConfigured = firewallResult.ok;
export const firebaseGuardType = firewallResult.type;
export const firebaseGuardReason = firewallResult.reason;

let app = null;
let analytics = null;
let db = null;
let firestore = null;
let storage = null;

if (firewallResult.ok) {
  app = initializeApp(firebaseConfig);

  const recaptchaKey = readViteEnv(() => import.meta.env.VITE_FIREBASE_RECAPTCHA_KEY);
  if (typeof window !== "undefined" && recaptchaKey) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(recaptchaKey),
        isTokenAutoRefreshEnabled: true
      });
    } catch (error) {
      console.warn("AppCheck initialization skipped:", error);
    }
  }

  if (typeof window !== "undefined" && firebaseConfig.measurementId) {
    try {
      analytics = getAnalytics(app);
    } catch (error) {
      console.warn("Firebase Analytics skipped:", error);
    }
  }

  db = initializeFirestore(app, {
    localCache: persistentLocalCache(),
    experimentalAutoDetectLongPolling: true
  });
  firestore = db;
  storage = getStorage(app);
} else if (typeof console !== "undefined") {
  console.warn("[Firebase Firewall Guard]", firewallResult.reason);
}

export const assertFirebaseConfigured = () => {
  if (!isFirebaseConfigured || !firestore) {
    throw new Error(firebaseGuardReason || "Firebase is not configured for this church.");
  }
  return firestore;
};

export { app, analytics, db, firestore, storage };
