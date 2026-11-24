import { createSyncDeadline, beginSyncStatus, notifySyncStatus, SYNC_TIMEOUT_MS } from '../utils/syncDeadline';
import { logActivity } from '../utils/activityLogger';
import { db } from './database';
import { firestore } from './firebase';
import { collection, getDocs, getDocsFromServer, doc, setDoc } from 'firebase/firestore';
import { encryptData, decryptData } from '../encryption';
import { normalizeArabicName, sameChild, childAliases, childNameKey, deletionWins, timestamp, attendanceIdentity, resolveAttendanceChild } from '../utils/childIdentity';
import { getCanonicalActiveChildren, consolidateLocalDexieDuplicates, generateClassScopedQrId } from '../utils/churchDataEngine';
import { resolveServantNotificationScope } from '../utils/notificationScopeEngine';
import { getScopedStorageKey } from '../utils/tenantConfig';
import { upgradeDataUriToCloudinary } from '../utils/cloudinary';
import { syncClassCurriculaWithCloud } from '../utils/curriculumEngine';

const REGISTRY = getScopedStorageKey('deleted_children_tombstones_v1');
const syncCheckpointKey = (key) => getScopedStorageKey(`lastSyncTime_${key}`);
const registry = () => JSON.parse(localStorage.getItem(REGISTRY) || '{}');
const registryKeys = c => [...childAliases(c).map(id => `${c.syncKey}::id::${id}`), childNameKey(c)];
const remember = c => {
    const entries = registry();
    for (const key of registryKeys(c)) {
        if (c.isDeleted && timestamp(c.deletedAt) >= timestamp(entries[key]?.deletedAt)) entries[key] = { deletedAt: c.deletedAt || 0, deletedBy: c.deletedBy || 'خادم' };
        else if (timestamp(c.restoredAt) > timestamp(entries[key]?.deletedAt)) delete entries[key];
    }
    localStorage.setItem(REGISTRY, JSON.stringify(entries));
};
const localTombstone = c => registryKeys(c).map(k => registry()[k]).filter(Boolean).sort((a, b) => timestamp(b.deletedAt) - timestamp(a.deletedAt))[0];
export const scopedSyncKeys = () => resolveServantNotificationScope().allowedSyncKeys;
export const decodeCloudRecord = snapshot => {
    const raw = snapshot.data();
    const payload = raw?.payload ? decryptData(raw.payload) : raw;
    if (!payload) throw new Error(`تعذر قراءة المستند ${snapshot.id}`);
    // Top-level lifecycle metadata overrides legacy encrypted payloads.
    const lifecycle = Object.fromEntries(['isDeleted', 'deletedAt', 'deletedBy', 'restoredAt', 'restoredBy', 'updatedAt'].filter(k => raw[k] !== undefined).map(k => [k, raw[k]]));
    return { ...payload, ...lifecycle, cloudId: snapshot.ref.parent.id === 'childIdentities' ? (payload.cloudId || payload.id) : snapshot.id, syncKey: snapshot.ref.parent.parent.id };
};
const envelope = c => ({ payload: encryptData(JSON.parse(JSON.stringify(c))), isDeleted: !!c.isDeleted,
    deletedAt: c.deletedAt || null, deletedBy: c.deletedBy || null, restoredAt: c.restoredAt || null,
    restoredBy: c.restoredBy || null, updatedAt: c.updatedAt || 0 });

/**
 * Field-level timestamp-aware child merge that always preserves a valid `profilePic`
 * (preventing blank cloud fields from wiping a local/CDN avatar) and canonical `qrId`/`cloudId`.
 */
export const mergeChildRecordsPreservingPhoto = (existingLocal = null, incomingCloud = {}) => {
    const localTime = timestamp(existingLocal?.updatedAt);
    const cloudTime = timestamp(incomingCloud?.updatedAt);
    const localWins = Boolean(existingLocal?.isDirty && localTime > cloudTime);
    const winner = localWins ? existingLocal : incomingCloud;
    const loser = localWins ? incomingCloud : existingLocal;

    const winPhoto = String(winner?.profilePic || '').trim();
    const losePhoto = String(loser?.profilePic || '').trim();
    const resolvedPhoto = winPhoto || losePhoto || '';

    const resolvedSyncKey = String(incomingCloud?.syncKey || existingLocal?.syncKey || '').trim();
    const resolvedQrId = String(incomingCloud?.qrId || existingLocal?.qrId || '').trim()
        || (resolvedSyncKey ? generateClassScopedQrId(resolvedSyncKey) : '');

    return {
        ...(loser || {}),
        ...(winner || {}),
        id: existingLocal?.id ?? incomingCloud?.id,
        syncKey: resolvedSyncKey,
        qrId: resolvedQrId,
        profilePic: resolvedPhoto,
        isDeleted: false,
        isDirty: localWins
    };
};

const localTransaction = (deadline, tables, callback) => deadline.run(() => db.transaction('rw', ...tables, async tx => {
    const unsubscribe = deadline.onCancel(() => tx?.abort?.());
    try { deadline.check(); return await callback(); }
    finally { unsubscribe(); }
}));

export const reconcileCloudChildrenBatch = async (cloudRows, deadline = createSyncDeadline()) => {
    if (!cloudRows.length) return;
    await localTransaction(deadline, [db.children, db.attendance], async () => {
        const key = cloudRows[0].syncKey;
        const children = new Map((await db.children.where('syncKey').equals(key).toArray()).map(c => [c.id, c]));
        const attendance = cloudRows.some(c => c.isDeleted) ? await db.attendance.where('syncKey').equals(key).toArray() : [];
        const save = async child => {
            deadline.check();
            if (JSON.stringify(child) !== JSON.stringify(children.get(child.id))) await db.children.put(child);
            children.set(child.id, child);
        };
        for (const cloud of [...cloudRows].sort((a, b) => Number(a.isDeleted) - Number(b.isDeleted))) {
            deadline.check();
            if (cloud.syncKey !== key) continue;
            const savedTombstone = localTombstone(cloud);
            if (!cloud.isDeleted && savedTombstone && deletionWins({ ...savedTombstone, isDeleted: true }, cloud)) continue;
            const matches = [...children.values()].filter(c => sameChild(c, cloud));
            const newLocalId = `${key}::${cloud.cloudId || cloud.id}`;
            if (cloud.isDeleted) {
                remember(cloud);
                const targets = matches.length ? matches : [{ ...cloud, id: newLocalId }];
                const deletedIds = new Set();
                for (const child of targets) {
                    if (!deletionWins(cloud, child) || (child.isDeleted && timestamp(child.deletedAt) > timestamp(cloud.deletedAt))) continue;
                    const deleted = { ...child, isDeleted: true, deletedAt: cloud.deletedAt || 0, deletedBy: cloud.deletedBy || 'خادم', updatedAt: cloud.updatedAt || cloud.deletedAt || 0, isDirty: false };
                    remember(deleted);
                    await save(deleted);
                    childAliases(child).forEach(id => deletedIds.add(id));
                }
                for (const row of attendance) {
                    deadline.check();
                    if ([row.childId, row.childCloudId, row.childLocalId].some(id => deletedIds.has(String(id)))) {
                        const changes = { isDeleted: true, isDirty: false, updatedAt: cloud.deletedAt || 0 };
                        if (!row.isDeleted || row.isDirty || row.updatedAt !== changes.updatedAt) await db.attendance.update(row.id, changes);
                        Object.assign(row, changes);
                    }
                }
            } else {
                remember(cloud);
                const match = matches.find(c => String(c.cloudId || c.id) === String(cloud.cloudId)) || matches[0];
                if (matches.some(c => deletionWins(c, cloud))) continue;
                if (match?.isDirty && timestamp(cloud.restoredAt) <= timestamp(match.deletedAt)) continue;
                const cloudIds = [...new Set([cloud.cloudId, ...matches.flatMap(c => [c.cloudId, ...(c.cloudIds || [])])].filter(Boolean).map(String))].sort();
                const merged = mergeChildRecordsPreservingPhoto(match, cloud);
                await save({
                    ...merged,
                    id: match?.id ?? newLocalId,
                    aliasIds: [...new Set([...childAliases(merged), ...childAliases(cloud), ...matches.flatMap(childAliases)])].sort(),
                    cloudIds,
                    cloudId: cloudIds[0],
                    isDirty: false
                });
            }
        }
    });
};
export const reconcileCloudChild = (cloud, deadline) => reconcileCloudChildrenBatch([cloud], deadline);

export const reconcileCloudAttendanceBatch = async (cloudRows, deadline = createSyncDeadline()) => {
    if (!cloudRows.length) return;
    await localTransaction(deadline, [db.children, db.attendance], async () => {
        const key = cloudRows[0].syncKey;
        const allChildren = await db.children.where('syncKey').equals(key).toArray();
        const canonical = getCanonicalActiveChildren(allChildren);
        const records = await db.attendance.where('syncKey').equals(key).toArray();
        const bySession = new Map();
        const sessionKey = row => {
            const child = resolveAttendanceChild(row, canonical);
            return `${row.date}::${child?.cloudId || child?.id || row.childCloudId || row.childId}::${row.sessionKey || row.type}`;
        };
        for (const row of records) {
            const session = sessionKey(row);
            if (!bySession.has(session)) bySession.set(session, []);
            bySession.get(session).push(row);
        }
        for (let cloud of cloudRows) {
            deadline.check();
            if (!cloud.date || !cloud.type || cloud.syncKey !== key) continue;
            const deletedChild = allChildren.find(c => c.isDeleted && ([cloud.childId, cloud.childCloudId, cloud.childLocalId].some(id => childAliases(c).includes(String(id))) || (cloud.childName && childNameKey(c) === childNameKey({ syncKey: key, name: cloud.childName }))));
            if (deletedChild) cloud = { ...cloud, isDeleted: true };
            const child = resolveAttendanceChild(cloud, canonical);
            const data = { ...cloud, ...(child ? attendanceIdentity(child) : {}) };
            const session = sessionKey(data);
            const matches = bySession.get(session) || [];
            const newest = matches.sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt))[0];
            if (newest && timestamp(newest.updatedAt) > timestamp(cloud.updatedAt)) continue;
            const { id: _remoteId, ...fields } = data;
            const updated = { ...fields, ...(newest ? { id: newest.id } : {}), isDirty: false };
            if (JSON.stringify(updated) !== JSON.stringify(newest)) updated.id = await db.attendance.put(updated);
            for (const duplicate of matches.slice(1)) await db.attendance.delete(duplicate.id);
            bySession.set(session, [updated]);
        }
    });
};
export const reconcileCloudAttendance = (cloud, deadline) => reconcileCloudAttendanceBatch([cloud], deadline);

// Pre-fetched snapshot checks deliberately avoid Web SDK transactions. This is
// not an atomic compare-and-set: server-side rules remain necessary for races.
export const pushChildSafely = async (child, cloudChildren, deadline = createSyncDeadline()) => {
    if (!firestore) return;
    const currentLocal = await deadline.run(() => db.children.get(child.id));
    if (!currentLocal || currentLocal.updatedAt !== child.updatedAt || currentLocal.isDeleted !== child.isDeleted) return;
    const matching = cloudChildren.filter(c => sameChild(c, child));
    const saved = localTombstone(child);
    const records = [...matching, ...(saved ? [{ ...child, ...saved, isDeleted: true }] : [])];
    const tombstone = records.find(c => deletionWins(c, child));
    if (!child.isDeleted && tombstone) { await reconcileCloudChild(tombstone, deadline); return; }
    const newer = records.find(c => !c.isDeleted && timestamp(c.restoredAt) > timestamp(child.deletedAt) && child.isDeleted);
    if (newer) { await reconcileCloudChild(newer, deadline); return; }
    const primaryId = child.cloudId || matching.find(c => !c.isDeleted)?.cloudId || child.id;
    const ensuredQrId = child.qrId || (child.syncKey ? generateClassScopedQrId(child.syncKey) : '');
    let preparedProfilePic = String(child.profilePic || '').trim();
    if (!child.isDeleted && preparedProfilePic.startsWith('data:image/')) {
        const upgradedPhoto = await upgradeDataUriToCloudinary(preparedProfilePic, {
            syncKey: child.syncKey,
            kind: 'image'
        });
        if (upgradedPhoto.upgraded && upgradedPhoto.url) {
            preparedProfilePic = upgradedPhoto.url;
            await localTransaction(deadline, [db.children], async () => {
                const current = await db.children.get(child.id);
                if (current && current.updatedAt === child.updatedAt) {
                    await db.children.update(child.id, { profilePic: preparedProfilePic });
                }
            });
        }
    }
    child = { ...child, cloudId: String(primaryId), ...(ensuredQrId ? { qrId: ensuredQrId } : {}), profilePic: preparedProfilePic };
    const docIds = [...new Set([String(primaryId), ...matching.map(c => String(c.cloudId || c.id))])];
    const explicitRestore = child.lifecycleDirty === true && !!child.restoredAt && !child.isDeleted;
    const targets = child.isDeleted || explicitRestore ? docIds : [String(primaryId)];
    for (const id of targets) {
        const cloudSafePic = (preparedProfilePic.startsWith('data:') && preparedProfilePic.length > 80000) ? '' : preparedProfilePic;
        const data = envelope({ ...child, profilePic: cloudSafePic, cloudId: id, isDirty: false, lifecycleDirty: false });
        // Ordinary edits/creations never clear lifecycle fields in a merge. A
        // deletion arriving after our snapshot keeps its top-level tombstone.
        if (!child.isDeleted && !explicitRestore) {
            for (const field of ['isDeleted', 'deletedAt', 'deletedBy', 'restoredAt', 'restoredBy']) delete data[field];
        }
        await deadline.run(() => setDoc(doc(firestore, 'Osras', child.syncKey, 'children', id), data, { merge: true }));
    }
    if (child.isDeleted || explicitRestore) {
        const identityRef = doc(firestore, 'Osras', child.syncKey, 'childIdentities', encodeURIComponent(normalizeArabicName(child.name || String(primaryId))));
        await deadline.run(() => setDoc(identityRef, envelope({ ...child, isDirty: false, lifecycleDirty: false }), { merge: true }));
    }
    deadline.check();
    remember(child);
    await localTransaction(deadline, [db.children], async () => {
        const current = await db.children.get(child.id);
        deadline.check();
        if (current && current.updatedAt === child.updatedAt && current.isDeleted === child.isDeleted) await db.children.update(child.id, { isDirty: false, lifecycleDirty: false, cloudId: child.cloudId });
    });
};

const inFlight = new Map();
const fetchCollectionDocs = async (colRef, deadline) => {
    try {
        return await deadline.run(() => getDocs(colRef));
    } catch {
        return await deadline.run(() => getDocsFromServer(colRef));
    }
};

export const syncClass = (key, parentDeadline) => {
    if (!key || !firestore) return Promise.resolve({ success: false, skipped: true });
    if (inFlight.has(key)) return inFlight.get(key);
    const deadline = createSyncDeadline(`مزامنة الفصل ${key}`, SYNC_TIMEOUT_MS);
    const unlink = parentDeadline?.onCancel?.(deadline.cancel);
    const task = deadline.run(async () => {
        const [kids, attendance, identities] = await Promise.all([
            fetchCollectionDocs(collection(firestore, 'Osras', key, 'children'), deadline),
            fetchCollectionDocs(collection(firestore, 'Osras', key, 'attendance'), deadline),
            fetchCollectionDocs(collection(firestore, 'Osras', key, 'childIdentities'), deadline)
        ]);
        const cloudChildren = [...kids.docs, ...identities.docs].map(decodeCloudRecord);
        await reconcileCloudChildrenBatch(cloudChildren, deadline);
        const localChildren = await deadline.run(() => db.children.where('syncKey').equals(key).toArray());
        for (const child of localChildren) {
            deadline.check();
            if (child.isDirty) await pushChildSafely(child, cloudChildren, deadline);
        }
        const cloudAttendance = attendance.docs.map(decodeCloudRecord);
        await reconcileCloudAttendanceBatch(cloudAttendance, deadline);
        const canonical = getCanonicalActiveChildren(await deadline.run(() => db.children.where('syncKey').equals(key).toArray()), [key]);
        const localAttendance = await deadline.run(() => db.attendance.where('syncKey').equals(key).toArray());
        const cloudMap = new Map(cloudAttendance.map(row => [row.cloudId, row]));
        for (const row of localAttendance) {
            deadline.check();
            if (!row.isDirty) continue;
            const child = resolveAttendanceChild(row, canonical);
            if (!child && !row.isDeleted) continue;
            const data = { ...row, ...(child ? attendanceIdentity(child) : {}), isDirty: false };
            const id = row.cloudId || `${data.date}_${data.childCloudId || data.childId}_${data.sessionKey || data.type}`;
            if (timestamp(cloudMap.get(id)?.updatedAt) > timestamp(row.updatedAt)) continue;
            await deadline.run(() => setDoc(doc(firestore, 'Osras', key, 'attendance', id), envelope(data), { merge: true }));
            await localTransaction(deadline, [db.attendance], async () => {
                const current = await db.attendance.get(row.id);
                deadline.check();
                if (current?.updatedAt === row.updatedAt && current.isDeleted === row.isDeleted && current.status === row.status) await db.attendance.update(row.id, { isDirty: false, cloudId: id });
            });
        }
        if (db?.pointsLogs) {
            try {
                const pointsSnap = await fetchCollectionDocs(collection(firestore, 'Osras', key, 'pointsLogs'), deadline);
                const cloudPoints = (pointsSnap?.docs || []).map(decodeCloudRecord);
                const localPoints = await deadline.run(() => db.pointsLogs.where('syncKey').equals(key).toArray());
                const localMap = new Map(localPoints.map(p => [String(p.id), p]));
                for (const cp of cloudPoints) {
                    if (!cp?.id) continue;
                    const lp = localMap.get(String(cp.id));
                    if (lp?.isDirty && timestamp(lp.updatedAt) > timestamp(cp.updatedAt)) continue;
                    if (!lp || timestamp(cp.updatedAt) >= timestamp(lp.updatedAt)) {
                        await deadline.run(() => db.pointsLogs.put({ ...cp, id: String(cp.id), syncKey: key, isDirty: false }));
                        localMap.set(String(cp.id), cp);
                    }
                }
                for (const lp of localMap.values()) {
                    deadline.check();
                    if (!lp?.isDirty) continue;
                    const pointPayload = { ...lp, syncKey: key, isDirty: false };
                    await deadline.run(() => setDoc(doc(firestore, 'Osras', key, 'pointsLogs', String(lp.id)), {
                        payload: encryptData(JSON.parse(JSON.stringify(pointPayload))),
                        updatedAt: pointPayload.updatedAt || 0,
                        isDeleted: Boolean(pointPayload.isDeleted)
                    }, { merge: true }));
                    await deadline.run(() => db.pointsLogs.update(lp.id, { isDirty: false }));
                }
            } catch (pointsErr) {
                console.warn(`[Sync] pointsLogs sync warning (${key}):`, pointsErr?.message || pointsErr);
            }
        }
        if (db?.curricula) {
            await deadline.run(() => syncClassCurriculaWithCloud(key, firestore));
        }
        deadline.check();
        localStorage.setItem(syncCheckpointKey(key), new Date().toISOString());
        return { success: true, syncKey: key };
    }).finally(() => {
        deadline.cancel();
        unlink?.();
        if (inFlight.get(key) === task) inFlight.delete(key);
    });
    inFlight.set(key, task);
    return task;
};

export const syncWithCloud = (syncKey) => {
    if (!syncKey) return Promise.resolve({ success: false });
    return syncClass(syncKey).catch(err => {
        console.warn(`[Sync] Single class sync warning (${syncKey}):`, err?.message || err);
        return { success: false, syncKey, error: err?.message };
    });
};

const scopedFlights = new Map();
export const syncScopedClassesFromCloud = (keys = scopedSyncKeys(), parentDeadline) => {
    const allowed = new Set(scopedSyncKeys());
    const scope = [...new Set(keys)].filter(k => allowed.has(k)).sort();
    const lockKey = JSON.stringify(scope);
    if (scopedFlights.has(lockKey)) return scopedFlights.get(lockKey);
    const finishStatus = beginSyncStatus();
    let outcome = 'error';
    const startedAt = performance.now();
    const BATCH_SIZE = 3;
    const task = (async () => {
        const failures = [];
        // Prioritize classes with oldest sync checkpoint so progressive batches update stale classes first
        const queue = [...scope].sort((a, b) => timestamp(localStorage.getItem(syncCheckpointKey(a))) - timestamp(localStorage.getItem(syncCheckpointKey(b))));
        for (let i = 0; i < queue.length; i += BATCH_SIZE) {
            if (i > 0) notifySyncStatus('syncing');
            const batch = queue.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(batch.map(key => syncClass(key, parentDeadline)));
            results.forEach((r, j) => {
                if (r.status === 'rejected') {
                    const failedKey = batch[j];
                    const msg = r.reason?.message || String(r.reason);
                    console.warn(`[Sync] تخطي الفصل البطيء (${failedKey}) واستكمال باقي الفصول:`, msg);
                    failures.push(`${failedKey}: ${msg}`);
                }
            });
        }
        if (firestore && (typeof navigator === 'undefined' || navigator.onLine)) {
            try {
                const cleanupDeadline = createSyncDeadline('توحيد السجلات المحلية', SYNC_TIMEOUT_MS);
                await cleanupDeadline.run(() => consolidateLocalDexieDuplicates(cleanupDeadline));
            } catch (cleanupErr) {
                console.warn('[Sync] Local duplicate consolidation warning:', cleanupErr?.message || cleanupErr);
            }
        }
        const syncedCount = scope.length - failures.length;
        const allFailed = scope.length > 0 && syncedCount === 0;
        outcome = allFailed ? 'error' : 'success';
        return {
            success: !allFailed,
            partial: failures.length > 0 && !allFailed,
            classCount: scope.length,
            syncedCount,
            failures,
            durationMs: Math.round(performance.now() - startedAt)
        };
    })().finally(() => {
        if (scopedFlights.get(lockKey) === task) scopedFlights.delete(lockKey);
        finishStatus(outcome);
    });
    scopedFlights.set(lockKey, task);
    return task;
};

const changeChildLifecycle = async (childOrId, user, restore) => {
    const deadline = createSyncDeadline('حفظ حالة المخدوم');
    const children = await deadline.run(() => db.children.toArray());
    const child = typeof childOrId === 'object' ? childOrId : children.find(c => childAliases(c).includes(String(childOrId)));
    if (!child?.syncKey) throw new Error('لم يتم العثور على المخدوم أو الفصل');
    if (!scopedSyncKeys().includes(child.syncKey)) throw new Error('الفصل خارج نطاق المستخدم');
    const matches = children.filter(c => sameChild(c, child));
    const now = Math.max(Date.now(), ...matches.flatMap(c => [timestamp(c.deletedAt) + 1, timestamp(c.restoredAt) + 1]));
    const changes = restore ? { isDeleted: false, lifecycleDirty: true, restoredAt: now, restoredBy: user || 'خادم', deletedAt: null, deletedBy: null, updatedAt: now, isDirty: true }
        : { isDeleted: true, lifecycleDirty: true, deletedAt: now, deletedBy: user || 'خادم', updatedAt: now, isDirty: true, restoredAt: null };
    const targets = matches.length ? matches : [child];
    await localTransaction(deadline, [db.children, db.attendance, db.grades], async () => {
        for (const c of targets) await db.children.put({ ...c, ...changes });
        if (!restore) {
            const ids = new Set(targets.flatMap(childAliases));
            for (const table of [db.attendance, db.grades]) for (const row of await table.toArray()) {
                if (row.syncKey === child.syncKey && ([row.childId, row.childCloudId, row.childLocalId].some(id => ids.has(String(id))) || (row.childName && childNameKey({ ...row, name: row.childName }) === childNameKey(child)))) {
                    await table.update(row.id, { isDeleted: true, updatedAt: now, isDirty: true });
                }
            }
        }
    });
    for (const c of targets) remember({ ...c, ...changes });
    let pendingSync = true;
    if (navigator.onLine && firestore) {
        try {
            const snapshots = await deadline.run(() => Promise.all(['children', 'childIdentities'].map(type => deadline.run(() => getDocsFromServer(collection(firestore, 'Osras', child.syncKey, type))))));
            const cloud = snapshots.flatMap(snapshot => snapshot.docs.map(decodeCloudRecord));
            for (const c of targets) await pushChildSafely({ ...c, ...changes }, cloud, deadline);
            pendingSync = false;
        } catch (error) { console.warn('Lifecycle saved locally; cloud retry required', error); }
    }
    void logActivity(restore ? 'RESTORE_CHILD' : 'DELETE_CHILD', `${restore ? 'استعادة' : 'حذف'} المخدوم: ${child.name || child.id} (${child.syncKey})`);
    return { success: true, pendingSync };
};
export const deleteChildEverywhere = (child, user) => changeChildLifecycle(child, user, false);
export const restoreChildEverywhere = (child, user) => changeChildLifecycle(child, user, true);
