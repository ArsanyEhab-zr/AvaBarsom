#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    getDocs,
    deleteDoc,
    collection,
    collectionGroup,
} from 'firebase/firestore';
import { DEFAULT_CHURCH_SERVICES } from '../src/utils/notificationScopeEngine.js';
import {
    OFFICIAL_ST_BARSOUM_CLASS_KEYS,
    OFFICIAL_ST_BARSOUM_SERVANTS,
    LEGACY_KINONIA_CLASS_TOKENS,
    isLegacyKinoniaClass,
    isLegacyKinoniaServant,
} from '../src/utils/churchStructureSanitizer.js';

function sanitizeServicesForCloud(services = []) {
    return (Array.isArray(services) ? services : []).map((svc) => ({
        ...svc,
        osras: (svc?.osras || []).map((osra) => {
            const cleanedCurricula = (osra?.curricula || []).map((item) => {
                const copy = { ...item };
                if (typeof copy.pdfData === 'string' && copy.pdfData.startsWith('data:')) {
                    copy.pdfData = '';
                }
                if (typeof copy.fileUrl === 'string' && copy.fileUrl.startsWith('data:')) {
                    copy.fileUrl = '';
                }
                return copy;
            });
            const cleanedPdfData = (typeof osra?.pdfData === 'string' && osra.pdfData.startsWith('data:'))
                ? ''
                : (osra?.pdfData || '');
            return {
                ...osra,
                pdfData: cleanedPdfData,
                curricula: cleanedCurricula,
            };
        }),
    }));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');

function loadDotEnv(file) {
    if (!fs.existsSync(file)) return {};
    const content = fs.readFileSync(file, 'utf8');
    const result = {};
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const idx = line.indexOf('=');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        let val = line.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        result[key] = val;
    }
    return result;
}

async function main() {
    const env = loadDotEnv(envPath);
    const projectId = env.VITE_FIREBASE_PROJECT_ID || '';

    if (projectId !== 'avabarsoom-a869d') {
        throw new Error(`Refusing to run against unexpected projectId: "${projectId}". Expected "avabarsoom-a869d".`);
    }

    const firebaseConfig = {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: env.VITE_FIREBASE_APP_ID,
        measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
    };

    console.log(`[Purge] Connecting to Firestore project: ${projectId}`);
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    // 1. Inspect existing System/mainConfig
    const mainConfigRef = doc(db, 'System', 'mainConfig');
    const existingSnap = await getDoc(mainConfigRef);
    let legacyServantsCount = 0;
    let legacyServicesCount = 0;

    if (existingSnap.exists()) {
        const data = existingSnap.data() || {};
        const prevServants = Array.isArray(data.servants) ? data.servants : [];
        const prevServices = Array.isArray(data.services) ? data.services : [];
        legacyServantsCount = prevServants.filter((s) => isLegacyKinoniaServant(s, DEFAULT_CHURCH_SERVICES)).length;
        legacyServicesCount = prevServices.filter((svc) =>
            (svc?.osras || []).some((o) => isLegacyKinoniaClass(o?.syncKey || o?.name))
        ).length;
        console.log(`[Purge] Existing System/mainConfig found: ${prevServants.length} servants (${legacyServantsCount} legacy), ${prevServices.length} services (${legacyServicesCount} legacy-contaminated).`);
    } else {
        console.log('[Purge] System/mainConfig does not exist yet on cloud. Creating clean canonical config...');
    }

    // 2. Overwrite System/mainConfig with canonical St. Barsoum El-Erian Church Tahnasha structure & clean servants
    const cleanServices = sanitizeServicesForCloud(JSON.parse(JSON.stringify(DEFAULT_CHURCH_SERVICES)));
    const cleanServants = JSON.parse(JSON.stringify(OFFICIAL_ST_BARSOUM_SERVANTS));

    await setDoc(mainConfigRef, {
        khedmaName: 'كنيسة الأنبا برسوم العريان بطهنشا',
        osraName: 'كنيسة الأنبا برسوم العريان بطهنشا',
        services: cleanServices,
        servants: cleanServants,
        updatedAt: new Date().toISOString(),
    });
    console.log(`[Purge] Wrote clean System/mainConfig: ${cleanServices.length} services, ${OFFICIAL_ST_BARSOUM_CLASS_KEYS.length} classes, ${cleanServants.length} official servants.`);

    // 3. Verify System/mainConfig immediately after write
    const verifiedSnap = await getDoc(mainConfigRef);
    const verifiedData = verifiedSnap.data() || {};
    const remainingLegacy = (verifiedData.servants || []).filter((s) => isLegacyKinoniaServant(s, cleanServices));
    console.log(`[Purge] Verified System/mainConfig -> servants=${verifiedData.servants?.length || 0}, legacyMatches=${remainingLegacy.length}`);

    // 4. Inspect JoinRequests & servants collection for any legacy entries
    const joinReqSnap = await getDocs(collection(db, 'JoinRequests'));
    let deletedJoinRequests = 0;
    for (const d of joinReqSnap.docs) {
        const val = d.data() || {};
        if (isLegacyKinoniaServant(val, cleanServices) || isLegacyKinoniaClass(val.syncKey || val.osraName)) {
            await deleteDoc(d.ref);
            deletedJoinRequests += 1;
        }
    }
    console.log(`[Purge] Scanned JoinRequests (${joinReqSnap.size} docs), deleted ${deletedJoinRequests} legacy requests.`);

    const servantsColSnap = await getDocs(collection(db, 'servants'));
    let legacyServantDocs = 0;
    for (const d of servantsColSnap.docs) {
        const val = d.data() || {};
        if (isLegacyKinoniaServant(val, cleanServices)) {
            legacyServantDocs += 1;
            console.warn(`[Purge] Legacy doc detected in /servants/${d.id} (name="${val.name}", syncKey="${val.syncKey}").`);
        }
    }
    console.log(`[Purge] Scanned /servants (${servantsColSnap.size} docs), legacy=${legacyServantDocs}.`);

    // 5. Scan permitted collectionGroups + explicit legacy Osras subcollections
    const officialSet = new Set(OFFICIAL_ST_BARSOUM_CLASS_KEYS);
    const permittedGroupQueries = ['events', 'exams', 'activities'];
    const subcollectionsToClean = ['curricula', 'attendance', 'events', 'exams', 'activities', 'pointsLogs'];
    let deletedLegacyOsraSubdocs = 0;
    let flaggedLegacyChildren = 0;

    for (const subCol of permittedGroupQueries) {
        const snap = await getDocs(collectionGroup(db, subCol));
        for (const d of snap.docs) {
            const parts = d.ref.path.split('/');
            if (parts[0] === 'Osras' && parts[1] && !officialSet.has(parts[1]) && isLegacyKinoniaClass(parts[1])) {
                await deleteDoc(d.ref);
                deletedLegacyOsraSubdocs += 1;
            }
        }
    }

    // Check explicit legacy Osras keys across all subcollections (curricula, attendance, pointsLogs, etc.)
    const uniqueLegacyKeys = [...new Set(LEGACY_KINONIA_CLASS_TOKENS)];
    for (const legacyKey of uniqueLegacyKeys) {
        if (officialSet.has(legacyKey)) continue;
        for (const subCol of subcollectionsToClean) {
            const subSnap = await getDocs(collection(db, 'Osras', legacyKey, subCol));
            for (const d of subSnap.docs) {
                await deleteDoc(d.ref);
                deletedLegacyOsraSubdocs += 1;
            }
        }
        const legacyChildrenSnap = await getDocs(collection(db, 'Osras', legacyKey, 'children'));
        for (const d of legacyChildrenSnap.docs) {
            flaggedLegacyChildren += 1;
            await setDoc(d.ref, { isDeleted: true, deletedAt: Date.now(), deletedBy: 'system_purge' }, { merge: true });
        }
    }

    const childrenGroupSnap = await getDocs(collectionGroup(db, 'children'));
    for (const d of childrenGroupSnap.docs) {
        const parts = d.ref.path.split('/');
        if (parts[0] === 'Osras' && parts[1] && !officialSet.has(parts[1]) && isLegacyKinoniaClass(parts[1])) {
            flaggedLegacyChildren += 1;
            console.warn(`[Purge] Legacy child found at ${d.ref.path} (soft-marking deleted tombstone)`);
            await setDoc(d.ref, { isDeleted: true, deletedAt: Date.now(), deletedBy: 'system_purge' }, { merge: true });
        }
    }

    console.log(`[Purge] Scanned Osras subcollections: deleted ${deletedLegacyOsraSubdocs} legacy subdocs, quarantined/flagged ${flaggedLegacyChildren} legacy children.`);
    console.log('[Purge] Firestore purge complete for avabarsoom-a869d.');
    process.exit(0);
}

main().catch((err) => {
    console.error('[Purge] Failed:', err);
    process.exit(1);
});
