import { doc, setDoc } from 'firebase/firestore';
import { db } from '../db/database';
import { firestore, isFirebaseConfigured } from '../db/firebase';
import { encryptData } from '../encryption';
import { getLocalDateString } from './serviceWeek';
import { readScopedStorage } from './tenantConfig';
import { POINTS_PRESETS, getMonthKeyFromDate } from './pointsMath';

export { POINTS_PRESETS, getMonthKeyFromDate, formatArabicMonthKey, aggregateMonthlyPoints, POINT_CATEGORY_LABELS } from './pointsMath';

const trySyncPointsLogToCloud = async (record) => {
    if (!isFirebaseConfigured || !firestore || !record?.syncKey || !record?.id) return;
    try {
        await setDoc(doc(firestore, 'Osras', String(record.syncKey), 'pointsLogs', String(record.id)), {
            payload: encryptData(record),
            updatedAt: record.updatedAt,
            isDeleted: Boolean(record.isDeleted)
        });
    } catch (_err) {
        // Offline / non-blocking sync queue keeps isDirty: true
    }
};

/**
 * Awards points to a child (either quick bonus or custom reward) in Dexie + optional Firestore.
 */
export async function awardPointsToChild({
    child,
    points,
    category = 'bonus',
    reason = 'مكافأة تشجيعية',
    date = getLocalDateString(new Date()),
    awardedBy = null
}) {
    if (!child?.id) return null;
    const servant = (() => {
        try {
            return JSON.parse(readScopedStorage('currentServant') || '{}');
        } catch {
            return {};
        }
    })();

    const nowIso = new Date().toISOString();
    const cleanDate = getLocalDateString(date) || getLocalDateString(new Date());
    const monthKey = getMonthKeyFromDate(cleanDate);
    const id = `pt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const record = {
        id,
        childId: String(child.id),
        childName: child.name || '',
        syncKey: String(child.syncKey || readScopedStorage('currentSyncKey') || '').trim(),
        date: cleanDate,
        monthKey,
        points: Number(points) || 0,
        category,
        reason,
        awardedBy: awardedBy || servant.name || 'الخادم',
        isDirty: true,
        updatedAt: nowIso,
        isDeleted: false
    };

    await db.pointsLogs.put(record);
    void trySyncPointsLogToCloud(record);

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('points-updated', { detail: record }));
    }
    return record;
}

/**
 * Idempotently grants or revokes automatic attendance points for a given (childId, date, type).
 * - service -> +10
 * - liturgy -> +15
 * - tasbeha -> +10
 */
export async function syncAttendancePoints({
    child,
    type = 'service',
    sessionKey = '',
    date = getLocalDateString(new Date()),
    isPresent = false,
    awardedBy = null
}) {
    if (!child?.id || !type) return null;
    const childIdStr = String(child.id).trim();
    const cleanDate = getLocalDateString(date) || getLocalDateString(new Date());
    const monthKey = getMonthKeyFromDate(cleanDate);
    const sessionToken = String(sessionKey || type).trim();
    const id = `pt_auto_${childIdStr}_${cleanDate}_${sessionToken}`;
    const legacyId = sessionToken !== type ? `pt_auto_${childIdStr}_${cleanDate}_${type}` : null;
    const nowIso = new Date().toISOString();

    const preset = type === 'liturgy'
        ? POINTS_PRESETS.AUTO_LITURGY
        : (type === 'tasbeha' ? POINTS_PRESETS.AUTO_TASBEHA : POINTS_PRESETS.AUTO_SERVICE);

    const syncKey = String(child.syncKey || readScopedStorage('currentSyncKey') || '').trim();
    const servantName = awardedBy || (() => {
        try {
            return JSON.parse(readScopedStorage('currentServant') || '{}').name || 'النظام الآلي';
        } catch {
            return 'النظام الآلي';
        }
    })();

    const existing = (await db.pointsLogs.get(id)) || (legacyId ? await db.pointsLogs.get(legacyId) : null);

    if (isPresent) {
        if (legacyId && existing && existing.id === legacyId && !existing.isDeleted) {
            await db.pointsLogs.put({ ...existing, isDeleted: true, isDirty: true, updatedAt: nowIso });
        }
        const record = {
            id,
            childId: childIdStr,
            childName: child.name || '',
            syncKey,
            date: cleanDate,
            monthKey,
            points: preset.points,
            category: preset.key,
            reason: preset.reason,
            awardedBy: servantName,
            isAutoAttendance: true,
            isDirty: true,
            updatedAt: nowIso,
            isDeleted: false
        };
        await db.pointsLogs.put(record);
        void trySyncPointsLogToCloud(record);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('points-updated', { detail: record }));
        }
        return record;
    } else if (existing && !existing.isDeleted) {
        const deletedRecord = {
            ...existing,
            isDeleted: true,
            isDirty: true,
            updatedAt: nowIso
        };
        await db.pointsLogs.put(deletedRecord);
        void trySyncPointsLogToCloud(deletedRecord);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('points-updated', { detail: deletedRecord }));
        }
        return deletedRecord;
    }

    return null;
}

/**
 * Soft-deletes a point log entry.
 */
export async function deletePointsLog(id) {
    if (!id) return;
    const existing = await db.pointsLogs.get(id);
    if (!existing) return;
    const updated = {
        ...existing,
        isDeleted: true,
        isDirty: true,
        updatedAt: new Date().toISOString()
    };
    await db.pointsLogs.put(updated);
    void trySyncPointsLogToCloud(updated);
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('points-updated', { detail: updated }));
    }
}
