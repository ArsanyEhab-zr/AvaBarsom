// src/utils/attendanceSessionHelper.js
// مساعد موحد لتسجيل جلسات الحضور المتعددة أسبوعياً والافتقاد وتزامنها الفوري مع Firestore

import { doc, setDoc } from 'firebase/firestore';
import { db } from '../db/database';
import { firestore, isFirebaseConfigured } from '../db/firebase';
import { encryptData } from '../encryption';
import { attendanceIdentity } from './childIdentity';
import { getClassWeeklySessions, DAY_NUM_TO_ARABIC, DAY_NUM_TO_KEY } from './serviceWeek';
import { readScopedStorage } from './tenantConfig';

const ARABIC_SHORT_MONTHS = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

export function formatSessionShortDateAr(dateStr = '') {
    if (!dateStr) return '';
    const d = new Date(`${String(dateStr).split('T')[0]}T12:00:00`);
    if (isNaN(d.getTime())) return String(dateStr);
    const day = d.getDate();
    const month = ARABIC_SHORT_MONTHS[d.getMonth()] || '';
    return `${day} ${month}`;
}

export function resolveSessionMetaForDate({ syncKey = '', className = '', date = '', type = 'service', explicitSession = null } = {}) {
    if (explicitSession && explicitSession.id && explicitSession.type === type && explicitSession.date === date) {
        return {
            sessionKey: explicitSession.id,
            sessionLabel: explicitSession.label
        };
    }

    const sessions = getClassWeeklySessions(
        { syncKey, name: className },
        null,
        date ? new Date(`${date}T12:00:00`) : new Date()
    );
    const exactMatch = sessions.find(s => s.date === date && s.type === type);
    if (exactMatch) {
        return {
            sessionKey: exactMatch.id,
            sessionLabel: exactMatch.label
        };
    }

    const d = date ? new Date(`${date}T12:00:00`) : new Date();
    const dayIdx = isNaN(d.getTime()) ? new Date().getDay() : d.getDay();
    const dayKey = DAY_NUM_TO_KEY[dayIdx] || 'friday';
    const dayAr = DAY_NUM_TO_ARABIC[dayIdx] || 'الجمعة';
    const prefix = type === 'liturgy'
        ? 'قداس'
        : (type === 'tasbeha'
            ? 'تسبحة'
            : (type === 'service_meeting' ? 'اجتماع الخدمة' : 'خدمة'));
    return {
        sessionKey: `${type}_${dayKey}`,
        sessionLabel: `${prefix} ${dayAr}`
    };
}

export function getCurrentRecorderName() {
    try {
        const srv = JSON.parse(readScopedStorage('currentServant') || '{}');
        return String(srv?.name || srv?.role || 'خادم').trim();
    } catch {
        return 'خادم';
    }
}

export function buildCanonicalAttendancePayload({
    child,
    date,
    type = 'service',
    status = 'present',
    syncKey = '',
    sessionKey = '',
    sessionLabel = '',
    recordedBy = '',
    extra = {}
}) {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const ident = attendanceIdentity(child);
    const canonicalChildId = String(ident.childCloudId || ident.childId || child?.id || '').trim();
    const targetSyncKey = String(syncKey || ident.syncKey || child?.syncKey || '').trim();

    const resolvedMeta = (!sessionKey || !sessionLabel)
        ? resolveSessionMetaForDate({ syncKey: targetSyncKey, className: child?.className || '', date, type })
        : { sessionKey, sessionLabel };
    const sessionIdToken = String(resolvedMeta.sessionKey || type).trim();
    const cloudId = `${date}_${canonicalChildId}_${sessionIdToken}`;

    return {
        cloudId,
        ...ident,
        syncKey: targetSyncKey,
        date,
        type,
        sessionKey: resolvedMeta.sessionKey,
        sessionLabel: resolvedMeta.sessionLabel,
        status,
        recordedBy: recordedBy || getCurrentRecorderName(),
        timestamp: nowMs,
        updatedAt: nowIso,
        updatedAtMs: nowMs,
        isDirty: true,
        isDeleted: false,
        ...extra
    };
}

/**
 * Push an attendance record immediately to Firestore Osras/{syncKey}/attendance/{cloudId}
 * (non-blocking, safely falling back to local isDirty queue when offline).
 */
export async function pushAttendanceRecordToCloud(record, localRowId = null) {
    if (!isFirebaseConfigured || !firestore || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;
    const syncKey = String(record?.syncKey || '').trim();
    const cloudId = String(record?.cloudId || `${record?.date}_${record?.childCloudId || record?.childId}_${record?.sessionKey || record?.type}`).trim();
    if (!syncKey || !cloudId || ['MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN', 'all'].includes(syncKey)) {
        return false;
    }

    try {
        const cleanData = { ...record, id: cloudId, cloudId, isDirty: false };
        await setDoc(
            doc(firestore, 'Osras', syncKey, 'attendance', cloudId),
            {
                payload: encryptData(JSON.parse(JSON.stringify(cleanData))),
                updatedAt: record.updatedAtMs || record.updatedAt || Date.now(),
                isDeleted: Boolean(record.isDeleted)
            },
            { merge: true }
        );
        if (localRowId != null && db?.attendance) {
            await db.attendance.update(localRowId, { isDirty: false, cloudId }).catch(() => {});
        }
        return true;
    } catch (err) {
        console.warn('[AttendanceSync] Deferred cloud push to retry queue:', err?.message || err);
        return false;
    }
}

/**
 * Persist visitation log cleanly to Dexie (`db.visitations` + `db.attendance`) AND Firestore `Osras/{syncKey}/visitations/{id}`.
 */
export async function persistVisitationLogAndSync({
    child,
    date,
    visitationType = 'home_visit',
    visitationLabel = 'زيارة منزلية',
    note = '',
    syncKey = ''
}) {
    if (!child?.id) return null;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const ident = attendanceIdentity(child);
    const targetSyncKey = String(syncKey || ident.syncKey || child.syncKey || '').trim();
    const canonicalChildId = String(ident.childCloudId || ident.childId || child.id).trim();
    const visitId = `visit_${date}_${canonicalChildId}_${nowMs}`;
    const recordedBy = getCurrentRecorderName();

    const visitRecord = {
        id: visitId,
        cloudId: visitId,
        ...ident,
        syncKey: targetSyncKey,
        date,
        type: 'visitation',
        status: 'present',
        visitationType,
        visitationLabel,
        note: String(note || '').trim(),
        recordedBy,
        updatedAt: nowIso,
        createdAt: nowIso,
        isDirty: true,
        isDeleted: false
    };

    if (db?.visitations) {
        await db.visitations.put(visitRecord).catch(() => {});
    }

    const attPayload = buildCanonicalAttendancePayload({
        child,
        date,
        type: 'visitation',
        status: 'present',
        syncKey: targetSyncKey,
        sessionKey: 'visitation',
        sessionLabel: visitationLabel,
        recordedBy,
        extra: {
            visitationType,
            visitationLabel,
            note: String(note || '').trim()
        }
    });
    const localAttId = await db.attendance.add(attPayload);

    if (isFirebaseConfigured && firestore && (typeof navigator === 'undefined' || navigator.onLine !== false) && targetSyncKey && !['MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN', 'all'].includes(targetSyncKey)) {
        try {
            await setDoc(
                doc(firestore, 'Osras', targetSyncKey, 'visitations', visitId),
                {
                    payload: encryptData(JSON.parse(JSON.stringify({ ...visitRecord, isDirty: false }))),
                    updatedAt: nowIso,
                    isDeleted: false
                },
                { merge: true }
            );
            if (db?.visitations) {
                await db.visitations.update(visitId, { isDirty: false }).catch(() => {});
            }
        } catch (err) {
            console.warn('[VisitationSync] Deferred visitation push:', err?.message || err);
        }
        void pushAttendanceRecordToCloud(attPayload, localAttId);
    }

    return visitRecord;
}
