#!/usr/bin/env node
// scripts/verify_curricula_uncompleted.mjs
// Scans all Osras/*/curricula/* docs on avabarsoom-a869d and verifies/resets
// 100% of lessons across all books to isCompleted: false (leaving fileUrl, titles, pages untouched).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { REAL_CHURCH_OSRAS } from '../src/utils/realChurchStructure.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');

function loadEnvFile(filePath) {
    const out = {};
    if (!fs.existsSync(filePath)) return out;
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
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

    if (firebaseConfig.projectId !== 'avabarsoom-a869d') {
        throw new Error(`Unexpected projectId: ${firebaseConfig.projectId}`);
    }

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const syncKeys = new Set(REAL_CHURCH_OSRAS.map((o) => o.syncKey).filter(Boolean));

    try {
        const mainConfigSnap = await getDoc(doc(db, 'System', 'mainConfig'));
        if (mainConfigSnap.exists()) {
            const services = mainConfigSnap.data()?.services || [];
            for (const svc of services) {
                for (const osra of svc?.osras || []) {
                    if (osra?.syncKey) syncKeys.add(osra.syncKey);
                }
            }
        }
    } catch (err) {
        console.warn('Could not read System/mainConfig:', err.message);
    }

    try {
        const osrasSnap = await getDocs(collection(db, 'Osras'));
        osrasSnap.forEach((d) => syncKeys.add(d.id));
    } catch {
        // Osras root listing may be restricted by rules; REAL_CHURCH_OSRAS + mainConfig cover all active keys.
    }

    let totalBooks = 0;
    let totalLessons = 0;
    let booksUpdated = 0;
    let lessonsReset = 0;
    let alreadyCompletedLessons = 0;

    for (const syncKey of Array.from(syncKeys).sort()) {
        const curSnap = await getDocs(collection(db, 'Osras', syncKey, 'curricula'));
        for (const docSnap of curSnap.docs) {
            const data = docSnap.data() || {};
            const lessons = Array.isArray(data.lessons) ? data.lessons : null;
            if (!lessons) continue;

            totalBooks += 1;
            totalLessons += lessons.length;

            let needsUpdate = false;
            const cleanedLessons = lessons.map((lesson) => {
                if (lesson?.isCompleted === true || lesson?.completedAt || lesson?.completedBy || lesson?.isCompleted !== false) {
                    if (lesson?.isCompleted === true) alreadyCompletedLessons += 1;
                    needsUpdate = true;
                    lessonsReset += 1;
                    return {
                        ...lesson,
                        isCompleted: false,
                        completedAt: null,
                        completedBy: null
                    };
                }
                return lesson;
            });

            if (needsUpdate) {
                await setDoc(
                    doc(db, 'Osras', syncKey, 'curricula', docSnap.id),
                    {
                        lessons: cleanedLessons,
                        updatedAt: new Date().toISOString()
                    },
                    { merge: true }
                );
                booksUpdated += 1;
                console.log(`[RESET] Osras/${syncKey}/curricula/${docSnap.id} (${lessons.length} lessons)`);
            }
        }
    }

    console.log('\n=== Curricula Verification Summary (avabarsoom-a869d) ===');
    console.log(`Osras scanned: ${syncKeys.size}`);
    console.log(`Books scanned: ${totalBooks}`);
    console.log(`Total lessons verified: ${totalLessons}`);
    console.log(`Previously completed lessons found: ${alreadyCompletedLessons}`);
    console.log(`Books updated: ${booksUpdated}`);
    console.log(`Lessons normalized/reset to isCompleted:false: ${lessonsReset}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('Verification failed:', err);
    process.exit(1);
});
