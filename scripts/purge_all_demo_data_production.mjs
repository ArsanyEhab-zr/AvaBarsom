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
import {
    OFFICIAL_ST_BARSOUM_CLASS_KEYS,
    LEGACY_KINONIA_CLASS_TOKENS,
} from '../src/utils/churchStructureSanitizer.js';

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

    console.log(`[ProductionPurge] Connecting to Firestore project: ${projectId}`);
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const stats = {
        broadcastMessagesSubDocs: 0,
        curricula: 0,
        attendance: 0,
        pointsLogs: 0,
        visitations: 0,
        exams: 0,
        grades: 0,
        messages: 0,
        events: 0,
        activities: 0,
        childrenHandled: 0,
        servantAttendance: 0,
        joinRequests: 0,
    };

    // 1. Discover all candidate Osra syncKeys
    const mainConfigRef = doc(db, 'System', 'mainConfig');
    const existingMainSnap = await getDoc(mainConfigRef);
    const existingMainData = existingMainSnap.exists() ? (existingMainSnap.data() || {}) : {};

    const osraKeys = new Set([
        'global',
        ...OFFICIAL_ST_BARSOUM_CLASS_KEYS,
        ...LEGACY_KINONIA_CLASS_TOKENS,
    ]);

    for (const svc of (existingMainData.services || [])) {
        for (const osra of (svc?.osras || [])) {
            if (osra?.syncKey) osraKeys.add(String(osra.syncKey).trim());
            if (osra?.name) osraKeys.add(String(osra.name).trim());
        }
    }

    for (const cgName of ['children', 'events', 'activities', 'exams', 'messages']) {
        try {
            const cgSnap = await getDocs(collectionGroup(db, cgName));
            for (const d of cgSnap.docs) {
                const segs = d.ref.path.split('/');
                if (segs[0] === 'Osras' && segs[1]) {
                    osraKeys.add(segs[1]);
                }
            }
        } catch (err) {
            console.warn(`[ProductionPurge] collectionGroup(${cgName}) scan note:`, err?.message || err);
        }
    }

    // 2. Delete System/mainConfig/broadcastMessages subcollection docs
    const sysBroadcastSubSnap = await getDocs(collection(db, 'System', 'mainConfig', 'broadcastMessages'));
    for (const d of sysBroadcastSubSnap.docs) {
        await deleteDoc(d.ref);
        stats.broadcastMessagesSubDocs += 1;
    }

    // Reset System/broadcastMessages & System/broadcastNotifications list docs if present
    for (const sysListDoc of ['broadcastMessages', 'broadcastNotifications']) {
        const ref = doc(db, 'System', sysListDoc);
        const snap = await getDoc(ref);
        if (snap.exists()) {
            await setDoc(ref, { items: [], updatedAt: new Date().toISOString() });
        }
    }

    // 3. Purge all Osras/{syncKey}/* subcollections
    const deletableSubcollections = [
        'curricula',
        'attendance',
        'pointsLogs',
        'visitations',
        'messages',
        'events',
        'activities',
    ];

    for (const rawKey of osraKeys) {
        const syncKey = String(rawKey || '').trim();
        if (!syncKey || ['MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN'].includes(syncKey)) continue;

        // Exams + nested grades
        const examsSnap = await getDocs(collection(db, 'Osras', syncKey, 'exams'));
        for (const examDoc of examsSnap.docs) {
            const gradesSnap = await getDocs(collection(db, 'Osras', syncKey, 'exams', examDoc.id, 'grades'));
            for (const gDoc of gradesSnap.docs) {
                await deleteDoc(gDoc.ref);
                stats.grades += 1;
            }
            await deleteDoc(examDoc.ref);
            stats.exams += 1;
        }

        // Standard deletable subcollections
        for (const subName of deletableSubcollections) {
            const subSnap = await getDocs(collection(db, 'Osras', syncKey, subName));
            for (const d of subSnap.docs) {
                await deleteDoc(d.ref);
                stats[subName] += 1;
            }
        }

        // Children & childIdentities (delete if allowed, otherwise tombstone)
        for (const childCol of ['children', 'childIdentities']) {
            const cSnap = await getDocs(collection(db, 'Osras', syncKey, childCol));
            for (const d of cSnap.docs) {
                const data = d.data() || {};
                if (data.isDeleted === true) continue;
                try {
                    await deleteDoc(d.ref);
                    stats.childrenHandled += 1;
                } catch {
                    const tombstone = data.payload
                        ? {
                            payload: data.payload,
                            isDeleted: true,
                            deletedAt: Date.now(),
                            deletedBy: 'production_purge',
                            updatedAt: new Date().toISOString(),
                        }
                        : {
                            ...data,
                            name: data.name || 'محذوف',
                            isDeleted: true,
                            deletedAt: Date.now(),
                            deletedBy: 'production_purge',
                            updatedAt: new Date().toISOString(),
                        };
                    await setDoc(d.ref, tombstone);
                    stats.childrenHandled += 1;
                }
            }
        }
    }

    // 4. Clean ServantAttendance & JoinRequests
    const srvAttSnap = await getDocs(collection(db, 'ServantAttendance'));
    for (const d of srvAttSnap.docs) {
        await deleteDoc(d.ref);
        stats.servantAttendance += 1;
    }

    const joinReqSnap = await getDocs(collection(db, 'JoinRequests'));
    for (const d of joinReqSnap.docs) {
        await deleteDoc(d.ref);
        stats.joinRequests += 1;
    }

    // 5. Reset System/mainConfig to 100% clean production-ready empty structure
    const nowIso = new Date().toISOString();
    const baseCleanConfig = {
        khedmaName: 'كنيسة الأنبا برسوم العريان بطهنشا',
        osraName: 'كنيسة الأنبا برسوم العريان بطهنشا',
        secretPass: existingMainData.secretPass || '1234',
        deletePass: existingMainData.deletePass || 'مسح',
        adminPass: existingMainData.adminPass || 'admin',
        services: [],
        servants: [],
        updatedAt: nowIso,
    };

    try {
        await setDoc(mainConfigRef, {
            ...baseCleanConfig,
            authorizedServants: [],
        });
    } catch {
        // Fallback when deployed rules strictly allowlist `servants` prior to rules redeploy
        await setDoc(mainConfigRef, baseCleanConfig);
    }

    // 6. Verify live Firestore state after purge
    const verifiedMain = (await getDoc(mainConfigRef)).data() || {};
    const verifiedBroadcastSub = await getDocs(collection(db, 'System', 'mainConfig', 'broadcastMessages'));
    const verifiedExams = await getDocs(collectionGroup(db, 'exams'));
    const verifiedMessages = await getDocs(collectionGroup(db, 'messages'));
    const verifiedChildren = await getDocs(collectionGroup(db, 'children'));
    const activeChildrenCount = verifiedChildren.docs.filter((d) => d.data()?.isDeleted !== true).length;

    let remainingCurricula = 0;
    for (const rawKey of osraKeys) {
        const syncKey = String(rawKey || '').trim();
        if (!syncKey || ['MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN'].includes(syncKey)) continue;
        const cSnap = await getDocs(collection(db, 'Osras', syncKey, 'curricula'));
        remainingCurricula += cSnap.size;
    }

    console.log('[ProductionPurge] Deletion summary:', JSON.stringify(stats, null, 2));
    console.log('[ProductionPurge] Post-purge verification on avabarsoom-a869d:', JSON.stringify({
        servicesCount: (verifiedMain.services || []).length,
        servantsCount: (verifiedMain.servants || []).length,
        broadcastMessagesSubCount: verifiedBroadcastSub.size,
        examsCount: verifiedExams.size,
        messagesCount: verifiedMessages.size,
        activeChildrenCount,
        remainingCurriculaCount: remainingCurricula,
    }, null, 2));

    if (
        (verifiedMain.services || []).length !== 0 ||
        (verifiedMain.servants || []).length !== 0 ||
        verifiedBroadcastSub.size !== 0 ||
        verifiedExams.size !== 0 ||
        verifiedMessages.size !== 0 ||
        activeChildrenCount !== 0 ||
        remainingCurricula !== 0
    ) {
        throw new Error('Post-purge verification detected remaining non-zero records!');
    }

    console.log('[ProductionPurge] SUCCESS: avabarsoom-a869d is 100% clean and ready for production launch.');
    process.exit(0);
}

main().catch((err) => {
    console.error('[ProductionPurge] FAILED:', err);
    process.exit(1);
});
