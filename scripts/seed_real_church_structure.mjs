#!/usr/bin/env node
// scripts/seed_real_church_structure.mjs
// Populates System/mainConfig on live Firestore (avabarsoom-a869d) with the exact
// 9 Services and 20 Classes/Osras of كنيسة الأنبا برسوم العريان بطهنشا (0 fake data).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { REAL_CHURCH_SERVICES, DEFAULT_CHURCH_LOGO_PATH } from '../src/utils/realChurchStructure.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');

function loadEnvFile(filePath) {
    const out = {};
    if (!fs.existsSync(filePath)) return out;
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const k = trimmed.slice(0, eq).trim();
        let v = trimmed.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
        }
        out[k] = v;
    }
    return out;
}

async function main() {
    const env = { ...loadEnvFile(envPath), ...process.env };
    const firebaseConfig = {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: env.VITE_FIREBASE_APP_ID
    };

    if (!firebaseConfig.projectId || firebaseConfig.projectId !== 'avabarsoom-a869d') {
        throw new Error(`Unexpected Firebase projectId: ${firebaseConfig.projectId}`);
    }

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const mainConfigRef = doc(db, 'System', 'mainConfig');

    const existingSnap = await getDoc(mainConfigRef);
    const existing = existingSnap.exists() ? existingSnap.data() : {};

    // Preserve any real non-demo servants if already present; never seed fake servants
    const existingServants = Array.isArray(existing.servants)
        ? existing.servants.filter(
            (s) =>
                s &&
                !String(s.id || '').startsWith('srv_demo_') &&
                !s.isDemo &&
                !String(s.name || '').includes('(تجريبي)')
        )
        : [];

    const nowIso = new Date().toISOString();
    const cleanServices = JSON.parse(JSON.stringify(REAL_CHURCH_SERVICES));

    const payload = {
        khedmaName: 'كنيسة الأنبا برسوم العريان بطهنشا',
        osraName: 'كنيسة الأنبا برسوم العريان بطهنشا',
        khedmaLogo: DEFAULT_CHURCH_LOGO_PATH,
        osraLogo: DEFAULT_CHURCH_LOGO_PATH,
        adminPass: String(existing.adminPass || 'admin'),
        deletePass: String(existing.deletePass || 'مسح'),
        secretPass: String(existing.secretPass || '1234'),
        services: cleanServices,
        servants: existingServants,
        updatedAt: nowIso
    };

    await setDoc(mainConfigRef, payload);

    // Verify round-trip from live Firestore
    const verifySnap = await getDoc(mainConfigRef);
    const verified = verifySnap.data() || {};
    const verifiedServices = verified.services || [];
    const verifiedOsras = verifiedServices.flatMap((s) => s.osras || []);
    const uniqueKeys = new Set(verifiedOsras.map((o) => o.osraKey));

    console.log(`[SeedStructure] Project: ${firebaseConfig.projectId}`);
    console.log(`[SeedStructure] Services saved: ${verifiedServices.length} (expected 9)`);
    console.log(`[SeedStructure] Classes/Osras saved: ${verifiedOsras.length} (expected 20)`);
    console.log(`[SeedStructure] Unique osraKey count: ${uniqueKeys.size} (expected 20)`);
    console.log(`[SeedStructure] Authorized real servants: ${(verified.servants || []).length}`);

    if (verifiedServices.length !== 9 || verifiedOsras.length !== 20 || uniqueKeys.size !== 20) {
        throw new Error('Verification mismatch after writing System/mainConfig!');
    }

    for (const svc of verifiedServices) {
        console.log(`  - [${svc.name}] (${svc.scheduleLabel}) -> ${(svc.osras || []).map((o) => `${o.name} [${o.osraKey}]`).join(', ')}`);
    }

    process.exit(0);
}

main().catch((err) => {
    console.error('[SeedStructure] ERROR:', err);
    process.exit(1);
});
