import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../db/database.js';
import {
    getCloudinaryConfig,
    upgradeDataUriToCloudinary,
    uploadImageToCloudinary,
    uploadPdfOrFileToCloudinary
} from './cloudinary.js';
import {
    CURRICULUM_CATEGORIES,
    CURRICULUM_STATUSES,
    buildDefaultCurriculaForOsra,
    hydrateServicesWithCurricula,
    buildSampleCurriculumPdfDataUri
} from './curriculumData.js';
import { readScopedStorage, writeScopedStorage } from './tenantConfig.js';

export {
    CURRICULUM_CATEGORIES,
    CURRICULUM_STATUSES,
    buildDefaultCurriculaForOsra,
    hydrateServicesWithCurricula,
    buildSampleCurriculumPdfDataUri
};

export const PDF_CATEGORIES = [
    'ملف PDF / مذكرة',
    'منهج عام / PDF'
];

export const LESSON_ONLY_CATEGORIES = [
    'درس كتاب مقدس وعقيدة',
    'ألحان وتسبحة',
    'لغة قبطية وطقس',
    'محفوظات وآيات',
    'إضافة خادم / نشاط'
];

export const DEFAULT_CURRICULUM_TRACKS = [
    {
        trackId: 'track_1',
        trackName: 'المنهج السنوي الأول',
        shortLabel: 'المنهج الأول'
    },
    {
        trackId: 'track_2',
        trackName: 'المنهج السنوي الثاني',
        shortLabel: 'المنهج الثاني'
    }
];

export const OFFICIAL_CHURCH_CURRICULUM_TRACKS = [
    {
        trackId: 'track_bishopric',
        trackName: 'منهج الأسقفية',
        shortLabel: 'منهج الأسقفية'
    },
    {
        trackId: 'track_pope',
        trackName: 'منهج البابا',
        shortLabel: 'منهج البابا'
    },
    {
        trackId: 'track_school',
        trackName: 'منهج المدرسة',
        shortLabel: 'منهج المدرسة'
    }
];

function parseCloudBookMetaFromNotes(rawNotes = '') {
    const str = String(rawNotes || '').trim();
    if (!str.startsWith('{') || !str.includes('__copticMeta')) return null;
    try {
        const parsed = JSON.parse(str);
        return parsed && parsed.__copticMeta ? parsed : null;
    } catch {
        return null;
    }
}

export function normalizeCurriculumTrack(raw = {}) {
    const embeddedMeta = parseCloudBookMetaFromNotes(raw?.teacherNotes || raw?.notes) || {};
    const firstLesson = Array.isArray(raw?.lessons) && raw.lessons.length > 0 ? raw.lessons[0] : {};

    let rawTrackId = String(raw?.trackId || embeddedMeta.trackId || firstLesson?.trackId || '').trim();
    const rawTrackName = String(raw?.trackName || embeddedMeta.trackName || firstLesson?.trackName || '').trim();

    if (!rawTrackId) {
        if (rawTrackName === 'منهج الأسقفية') {
            rawTrackId = 'track_bishopric';
        } else if (rawTrackName === 'منهج البابا') {
            rawTrackId = 'track_pope';
        } else if (rawTrackName === 'منهج المدرسة') {
            rawTrackId = 'track_school';
        } else if (rawTrackName === 'المنهج السنوي الثاني' || rawTrackName === 'المنهج الثاني') {
            rawTrackId = 'track_2';
        } else if (!rawTrackName || rawTrackName === 'المنهج السنوي الأول' || rawTrackName === 'المنهج الأول') {
            rawTrackId = 'track_1';
        } else {
            const cleanSlug = rawTrackName
                .replace(/\s+/g, '_')
                .replace(/[^\u0600-\u06FFa-zA-Z0-9_-]/g, '')
                .slice(0, 64);
            rawTrackId = `track_${cleanSlug || 'custom'}`;
        }
    }

    let trackName = rawTrackName;
    if (!trackName) {
        if (rawTrackId === 'track_bishopric') {
            trackName = 'منهج الأسقفية';
        } else if (rawTrackId === 'track_pope') {
            trackName = 'منهج البابا';
        } else if (rawTrackId === 'track_school') {
            trackName = 'منهج المدرسة';
        } else if (rawTrackId === 'track_2' || rawTrackId === 'track_secondary') {
            trackName = 'المنهج السنوي الثاني';
        } else if (rawTrackId === 'track_1' || rawTrackId === 'track_primary') {
            trackName = 'المنهج السنوي الأول';
        } else {
            trackName = rawTrackId;
        }
    }

    return {
        trackId: rawTrackId,
        trackName
    };
}

export function normalizeSyncKey(value) {
    return String(value || '').trim();
}

export function matchesSyncKey(candidateKey, targetSyncKey) {
    const target = normalizeSyncKey(targetSyncKey);
    if (!target) return false;
    return normalizeSyncKey(candidateKey) === target;
}

export function getItemAttachmentUrl(item = {}) {
    return String(item?.fileUrl || item?.pdfData || item?.attachmentUrl || '').trim();
}

export function isCopticBookPlanItem(item = {}) {
    return Boolean(item && item.itemType === 'coptic_book_plan');
}

export function isPdfCurriculumItem(item = {}) {
    if (!item) return false;
    if (item.itemType === 'coptic_book_plan') return false;
    if (item.itemType === 'pdf') return true;
    const cat = String(item.category || '');
    if (PDF_CATEGORIES.some((c) => cat.includes('PDF') || cat.includes('مذكرة') || cat === c)) {
        return true;
    }
    if (item.itemType === 'lesson') return false;
    const url = getItemAttachmentUrl(item).toLowerCase();
    return Boolean(
        !item.content &&
        !item.summary &&
        (url.startsWith('data:application/pdf') || url.endsWith('.pdf'))
    );
}

export function getOsraListFromSettings(settingsObj = null) {
    try {
        const parsed = settingsObj || (typeof localStorage !== 'undefined'
            ? JSON.parse(readScopedStorage('appSettings') || '{}')
            : {});
        const services = Array.isArray(parsed?.services) ? parsed.services : [];
        const list = [];
        for (const svc of services) {
            for (const osra of (svc?.osras || [])) {
                if (!osra?.syncKey) continue;
                list.push({
                    ...osra,
                    serviceName: svc.name || '',
                    serviceColor: svc.color || '#1B2A59',
                    serviceIcon: ''
                });
            }
        }
        return list;
    } catch {
        return [];
    }
}

function findOsraInList(syncKey, osrasList) {
    const target = normalizeSyncKey(syncKey);
    if (!target) return null;
    const list = Array.isArray(osrasList) ? osrasList : getOsraListFromSettings();
    return list.find((o) => matchesSyncKey(o?.syncKey, target)) || null;
}

function normalizeBookLessonEntry(rawLesson = {}, idx = 0) {
    const weekNumber = Math.max(1, Math.min(5, Number(rawLesson.weekNumber) || ((idx % 4) + 1)));
    const monthOrder = Math.max(1, Number(rawLesson.monthOrder) || (Math.floor(idx / 4) + 1));
    const copticMonth = String(rawLesson.copticMonth || '').trim() || `الشهر ${monthOrder}`;
    const defaultWeekLabels = ['الأسبوع الأول', 'الأسبوع الثاني', 'الأسبوع الثالث', 'الأسبوع الرابع', 'الأسبوع الخامس'];
    const weekLabel = String(rawLesson.weekLabel || '').trim() || defaultWeekLabels[weekNumber - 1] || `الأسبوع ${weekNumber}`;
    const startPage = Math.max(1, Number(rawLesson.startPage) || 1);
    const endPage = Math.max(startPage, Number(rawLesson.endPage) || startPage);
    const isCompleted = Boolean(rawLesson.isCompleted);

    return {
        id: String(rawLesson.id || `lesson_m${monthOrder}_w${weekNumber}`),
        copticMonth,
        monthOrder,
        weekNumber,
        weekLabel,
        title: String(rawLesson.title || '').trim() || `درس ${weekLabel} - شهر ${copticMonth}`,
        startPage,
        endPage,
        isCompleted,
        completedAt: isCompleted ? (rawLesson.completedAt || null) : null,
        completedBy: isCompleted ? (rawLesson.completedBy || null) : null
    };
}

function normalizeUnifiedItem(raw = {}, fallbackSyncKey = '', fallbackServiceName = '') {
    const syncKey = normalizeSyncKey(raw.syncKey || fallbackSyncKey);
    const serviceName = raw.serviceName || fallbackServiceName || '';
    const attachment = getItemAttachmentUrl(raw);
    const bodyText = raw.content || raw.description || raw.summary || '';
    const isBookPlan = isCopticBookPlanItem(raw);
    const isPdf = !isBookPlan && isPdfCurriculumItem({ ...raw, content: bodyText, fileUrl: attachment });
    const defaultCategory = isBookPlan
        ? 'كتاب المنهج السنوي الذكي'
        : (isPdf ? 'ملف PDF / مذكرة' : CURRICULUM_CATEGORIES[0]);

    const base = {
        id: String(raw.id || `cur-${syncKey}-${(raw.title || 'item').slice(0, 12)}`),
        syncKey,
        serviceName,
        title: String(raw.title || '').trim() || (isBookPlan ? 'كتاب المنهج السنوي' : (isPdf ? 'ملف المنهج الرسمي (PDF)' : 'درس جديد')),
        category: raw.category || defaultCategory,
        itemType: isBookPlan ? 'coptic_book_plan' : (isPdf ? 'pdf' : 'lesson'),
        weekLabel: raw.weekLabel || '',
        lessonDate: raw.lessonDate || (raw.createdAt ? String(raw.createdAt).split('T')[0] : new Date().toISOString().split('T')[0]),
        content: bodyText,
        description: bodyText,
        notes: raw.notes || raw.teacherNotes || '',
        fileUrl: attachment,
        pdfData: raw.pdfData || attachment,
        attachmentUrl: attachment,
        cloudinaryPublicId: raw.cloudinaryPublicId || '',
        fileName: raw.fileName || '',
        status: raw.status || CURRICULUM_STATUSES[0],
        createdAt: raw.createdAt || raw.updatedAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString()
    };

    if (isBookPlan) {
        const { trackId, trackName } = normalizeCurriculumTrack(raw);
        const embeddedMeta = parseCloudBookMetaFromNotes(raw?.teacherNotes || raw?.notes) || {};
        const partNumber = Math.max(1, Math.min(10, Number(raw.partNumber) || 1));
        const normalizedLessons = Array.isArray(raw.lessons)
            ? raw.lessons.map((l, idx) => normalizeBookLessonEntry(l, idx))
            : [];
        const copticMonths = Array.isArray(raw.copticMonths) && raw.copticMonths.length > 0
            ? raw.copticMonths.map((m) => String(m || '').trim()).filter(Boolean)
            : Array.from(new Set(normalizedLessons.map((l) => l.copticMonth).filter(Boolean)));
        return {
            ...base,
            trackId,
            trackName,
            partNumber,
            partLabel: String(raw.partLabel || '').trim() || `الجزء ${partNumber}`,
            totalPages: Math.max(1, Number(raw.totalPages) || 1),
            copticMonths,
            lessons: normalizedLessons,
            originalFileSize: Number(raw.originalFileSize || embeddedMeta.originalFileSize || 0) || null,
            compressedFileSize: Number(raw.compressedFileSize || embeddedMeta.compressedFileSize || 0) || null
        };
    }

    return base;
}

/**
 * Unified Per-Family Curriculum Reader (Node & Browser safe).
 * Strictly scopes to `syncKey` — merges Dexie `curricula` rows with `osra.curricula`
 * and legacy `osra.curriculumUrl` / `osra.pdfUrl`, deduping by `id` and honoring tombstones.
 */
export function getOsraCurricula(syncKey, allCurricula = [], osrasList = null) {
    const targetKey = normalizeSyncKey(syncKey);
    if (!targetKey) return [];

    const matchedOsra = findOsraInList(targetKey, osrasList);
    const serviceName = matchedOsra?.serviceName || '';

    const deletedIds = new Set();
    const activeById = new Map();

    const mergeRecord = (candidate) => {
        if (!candidate?.id || deletedIds.has(candidate.id)) return;
        const existing = activeById.get(candidate.id);
        if (!existing) {
            activeById.set(candidate.id, candidate);
            return;
        }
        const tNew = new Date(candidate.updatedAt || 0).getTime();
        const tOld = new Date(existing.updatedAt || 0).getTime();
        const winner = tNew >= tOld ? candidate : existing;
        const loser = winner === candidate ? existing : candidate;
        const attachment = getItemAttachmentUrl(winner) || getItemAttachmentUrl(loser);
        const contentText = winner.content || loser.content || '';
        activeById.set(candidate.id, {
            ...loser,
            ...winner,
            fileUrl: attachment,
            pdfData: winner.pdfData || loser.pdfData || attachment,
            attachmentUrl: attachment,
            content: contentText,
            description: contentText,
            fileName: winner.fileName || loser.fileName || ''
        });
    };

    // 1) Dexie rows strictly matching target syncKey
    const dbRows = Array.isArray(allCurricula) ? allCurricula : [];
    for (const row of dbRows) {
        if (!row || !matchesSyncKey(row.syncKey, targetKey)) continue;
        if (Number(row.isDeleted) === 1 || row.isDeleted === true) {
            if (row.id) deletedIds.add(String(row.id));
            continue;
        }
        mergeRecord(normalizeUnifiedItem(row, targetKey, row.serviceName || serviceName));
    }

    // 2) Settings `osra.curricula` array (respecting same family or un-tagged items stored directly inside matching osra)
    if (matchedOsra && Array.isArray(matchedOsra.curricula)) {
        for (const item of matchedOsra.curricula) {
            if (!item) continue;
            if (item.syncKey && !matchesSyncKey(item.syncKey, targetKey)) continue;
            mergeRecord(normalizeUnifiedItem(item, targetKey, serviceName));
        }
    }

    // 3) Legacy top-level `osra.curriculumUrl` / `osra.pdfUrl` migration
    const legacyPdfUrl = String(matchedOsra?.curriculumUrl || matchedOsra?.pdfUrl || '').trim();
    if (legacyPdfUrl) {
        const alreadyHasUrl = Array.from(activeById.values()).some(
            (x) => getItemAttachmentUrl(x) === legacyPdfUrl
        );
        const legacyId = `legacy-pdf-${targetKey}`;
        if (!alreadyHasUrl && !deletedIds.has(legacyId)) {
            mergeRecord(normalizeUnifiedItem({
                id: legacyId,
                syncKey: targetKey,
                serviceName,
                title: matchedOsra?.curriculumName || `ملف المنهج الرسمي — ${matchedOsra?.name || targetKey}`,
                category: 'ملف PDF / مذكرة',
                itemType: 'pdf',
                weekLabel: 'منهج الأسرة (PDF)',
                content: `ملف المنهج المعتمد لأسرة ${matchedOsra?.name || targetKey}.`,
                fileUrl: legacyPdfUrl,
                pdfData: legacyPdfUrl,
                attachmentUrl: legacyPdfUrl,
                fileName: `${matchedOsra?.name || targetKey}.pdf`,
                status: CURRICULUM_STATUSES[0]
            }, targetKey, serviceName));
        }
    }

    return Array.from(activeById.values()).sort((a, b) => {
        if (a.itemType === 'pdf' && b.itemType !== 'pdf') return -1;
        if (a.itemType !== 'pdf' && b.itemType === 'pdf') return 1;
        return new Date(b.updatedAt || b.lessonDate || 0).getTime() - new Date(a.updatedAt || a.lessonDate || 0).getTime();
    });
}

export function toDbCurriculumRow(item, serviceName, syncKey) {
    const nowIso = new Date().toISOString();
    const attachment = getItemAttachmentUrl(item);
    const isBookPlan = isCopticBookPlanItem(item);
    const isPdf = !isBookPlan && isPdfCurriculumItem(item);
    const bodyText = item.content || item.description || item.summary || '';
    const row = {
        id: item.id,
        serviceName: serviceName || item.serviceName || syncKey || 'الخدمة',
        syncKey,
        category: item.category || (isBookPlan ? 'كتاب المنهج السنوي الذكي' : (isPdf ? 'ملف PDF / مذكرة' : CURRICULUM_CATEGORIES[0])),
        itemType: isBookPlan ? 'coptic_book_plan' : (isPdf ? 'pdf' : 'lesson'),
        weekLabel: item.weekLabel || '',
        lessonDate: item.lessonDate || nowIso.split('T')[0],
        title: item.title || '',
        content: bodyText,
        teacherNotes: item.notes || item.teacherNotes || '',
        attachmentUrl: attachment,
        fileUrl: attachment,
        cloudinaryPublicId: item.cloudinaryPublicId || '',
        fileName: item.fileName || '',
        status: item.status || CURRICULUM_STATUSES[0],
        updatedAt: item.updatedAt || nowIso,
        isDirty: 1,
        isDeleted: 0
    };
    if (isBookPlan) {
        const { trackId, trackName } = normalizeCurriculumTrack(item);
        row.trackId = trackId;
        row.trackName = trackName;
        row.partNumber = Math.max(1, Math.min(4, Number(item.partNumber) || 1));
        row.partLabel = String(item.partLabel || '').trim();
        row.totalPages = Math.max(1, Number(item.totalPages) || 1);
        row.copticMonths = Array.isArray(item.copticMonths) ? item.copticMonths : [];
        row.lessons = Array.isArray(item.lessons)
            ? item.lessons.map((l, idx) => normalizeBookLessonEntry(l, idx))
            : [];
        if (item.originalFileSize) row.originalFileSize = Number(item.originalFileSize);
        if (item.compressedFileSize) row.compressedFileSize = Number(item.compressedFileSize);
    }
    return row;
}

async function getDbSafe() {
    if (typeof indexedDB === 'undefined' && !db) return null;
    return db || null;
}

function readLocalAppSettings() {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = readScopedStorage('appSettings');
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function dispatchSettingsUpdated() {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('church-settings-updated'));
    }
}

export function sanitizeServicesForCloud(services = []) {
    const keepSafeUrl = (v) => {
        const raw = String(v || '').trim();
        if (!raw || raw.startsWith('data:')) return '';
        return raw.length > 350000 ? '' : raw;
    };
    return (Array.isArray(services) ? services : []).map((svc) => ({
        ...svc,
        osras: (svc.osras || []).map((osra) => ({
            ...osra,
            pdfUrl: keepSafeUrl(osra.pdfUrl),
            curriculumUrl: keepSafeUrl(osra.curriculumUrl),
            curricula: (osra.curricula || []).map((cur) => ({
                ...cur,
                fileUrl: keepSafeUrl(cur.fileUrl),
                pdfData: '',
                attachmentUrl: keepSafeUrl(cur.attachmentUrl)
            }))
        }))
    }));
}

function toCloudCurriculumDoc(item = {}, targetKey = '', serviceName = '', { includeExtendedFields = true } = {}) {
    const rawUrl = String(getItemAttachmentUrl(item) || '').trim();
    const safeUrl = !rawUrl || rawUrl.startsWith('data:') ? '' : rawUrl;
    const isBookPlan = isCopticBookPlanItem(item);
    const docData = {
        id: String(item.id),
        syncKey: normalizeSyncKey(targetKey || item.syncKey),
        serviceName: serviceName || item.serviceName || '',
        title: String(item.title || '').trim(),
        category: item.category || '',
        itemType: isBookPlan ? 'coptic_book_plan' : (isPdfCurriculumItem(item) ? 'pdf' : 'lesson'),
        weekLabel: item.weekLabel || '',
        lessonDate: item.lessonDate || '',
        content: item.content || item.description || '',
        notes: item.notes || item.teacherNotes || '',
        fileUrl: safeUrl,
        attachmentUrl: safeUrl,
        cloudinaryPublicId: item.cloudinaryPublicId || '',
        fileName: item.fileName || '',
        status: item.status || CURRICULUM_STATUSES[0],
        updatedAt: item.updatedAt || new Date().toISOString(),
        isDeleted: false
    };
    if (isBookPlan) {
        const { trackId, trackName } = normalizeCurriculumTrack(item);
        const metaEnvelope = JSON.stringify({
            __copticMeta: 1,
            trackId,
            trackName,
            originalFileSize: item.originalFileSize || null,
            compressedFileSize: item.compressedFileSize || null
        });
        docData.teacherNotes = metaEnvelope;
        docData.partNumber = Math.max(1, Math.min(4, Number(item.partNumber) || 1));
        docData.partLabel = String(item.partLabel || '').trim().slice(0, 150);
        docData.totalPages = Math.max(1, Number(item.totalPages) || 1);
        docData.copticMonths = Array.isArray(item.copticMonths) ? item.copticMonths.slice(0, 20) : [];
        docData.lessons = Array.isArray(item.lessons)
            ? item.lessons.slice(0, 120).map((l, idx) => ({
                ...normalizeBookLessonEntry(l, idx),
                trackId,
                trackName
            }))
            : [];
        if (includeExtendedFields) {
            docData.trackId = trackId.slice(0, 120);
            docData.trackName = trackName.slice(0, 200);
            if (item.originalFileSize) docData.originalFileSize = Number(item.originalFileSize);
            if (item.compressedFileSize) docData.compressedFileSize = Number(item.compressedFileSize);
        }
    }
    return docData;
}

async function writeCloudCurriculumDocWithFallback(docRef, item, targetKey, serviceName) {
    try {
        await setDoc(docRef, toCloudCurriculumDoc(item, targetKey, serviceName, { includeExtendedFields: true }), { merge: true });
    } catch (err) {
        if (isCopticBookPlanItem(item) && (err?.code === 'permission-denied' || String(err?.message || '').includes('PERMISSION_DENIED'))) {
            await setDoc(docRef, toCloudCurriculumDoc(item, targetKey, serviceName, { includeExtendedFields: false }), { merge: true });
            return;
        }
        throw err;
    }
}

async function syncSettingsServicesToCloud(firestore, services) {
    if (!firestore || typeof navigator === 'undefined' || !navigator.onLine) return;
    try {
        await setDoc(doc(firestore, 'System', 'mainConfig'), {
            services: sanitizeServicesForCloud(services),
            updatedAt: new Date().toISOString()
        }, { merge: true });
    } catch (err) {
        console.warn('[curriculumEngine] Cloud mainConfig sync skipped:', err?.message || err);
    }
}

export async function syncClassCurriculaWithCloud(syncKey, firestore) {
    const targetKey = normalizeSyncKey(syncKey);
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!targetKey || !firestore || isOffline) return { synced: false, skipped: true };

    const database = await getDbSafe();
    if (!database?.curricula) return { synced: false, skipped: true };

    try {
        const colRef = collection(firestore, 'Osras', targetKey, 'curricula');
        const snap = await getDocs(colRef);
        const cloudDocs = (snap?.docs || []).map((d) => ({ ...(d.data() || {}), id: String(d.id || d.data()?.id || '') }));
        const localRows = await database.curricula.where('syncKey').equals(targetKey).toArray();
        const localMap = new Map(localRows.map((r) => [String(r.id), r]));

        for (const cloud of cloudDocs) {
            if (!cloud.id) continue;
            const local = localMap.get(cloud.id);
            const cloudTime = new Date(cloud.updatedAt || 0).getTime();
            const localTime = new Date(local?.updatedAt || 0).getTime();
            if (cloud.isDeleted === true) {
                if (!local || Number(local.isDeleted) !== 1 || cloudTime >= localTime) {
                    const row = {
                        ...(local || {}),
                        id: cloud.id,
                        syncKey: targetKey,
                        serviceName: cloud.serviceName || local?.serviceName || targetKey,
                        title: cloud.title || local?.title || '',
                        updatedAt: cloud.updatedAt || new Date().toISOString(),
                        isDeleted: 1,
                        isDirty: 0
                    };
                    await database.curricula.put(row);
                    localMap.set(cloud.id, row);
                }
                continue;
            }
            if (local?.isDirty && localTime > cloudTime) continue;
            if (!local || cloudTime >= localTime) {
                const mergedRow = { ...toDbCurriculumRow(cloud, cloud.serviceName || targetKey, targetKey), isDirty: 0, isDeleted: 0 };
                await database.curricula.put(mergedRow);
                localMap.set(cloud.id, mergedRow);
            }
        }

        const cloudMap = new Map(cloudDocs.map((c) => [c.id, c]));
        for (const local of localMap.values()) {
            if (!local?.isDirty) continue;
            const docRef = doc(firestore, 'Osras', targetKey, 'curricula', String(local.id));
            if (Number(local.isDeleted) === 1 || local.isDeleted === true) {
                await setDoc(docRef, {
                    id: String(local.id),
                    syncKey: targetKey,
                    isDeleted: true,
                    updatedAt: local.updatedAt || new Date().toISOString()
                }, { merge: true });
                await database.curricula.update(local.id, { isDirty: 0 });
                continue;
            }
            const cloudExisting = cloudMap.get(String(local.id));
            if (cloudExisting?.isDeleted === true && new Date(cloudExisting.updatedAt || 0).getTime() >= new Date(local.updatedAt || 0).getTime()) {
                await database.curricula.update(local.id, { isDeleted: 1, isDirty: 0 });
                continue;
            }
            let itemToPush = { ...local };
            const currentUrl = getItemAttachmentUrl(itemToPush);
            if (currentUrl.startsWith('data:')) {
                const upgraded = await upgradeDataUriToCloudinary(currentUrl, {
                    syncKey: targetKey,
                    kind: isPdfCurriculumItem(itemToPush) ? 'pdf' : 'image',
                    title: itemToPush.title || itemToPush.fileName || 'curriculum'
                });
                if (upgraded.upgraded && upgraded.url) {
                    itemToPush = {
                        ...itemToPush,
                        fileUrl: upgraded.url,
                        attachmentUrl: upgraded.url,
                        cloudinaryPublicId: upgraded.publicId || itemToPush.cloudinaryPublicId || ''
                    };
                }
            }
            const safeCloudUrl = getItemAttachmentUrl(itemToPush);
            const stillOversizedData = safeCloudUrl.startsWith('data:') && safeCloudUrl.length > 20000;
            await writeCloudCurriculumDocWithFallback(docRef, itemToPush, targetKey, itemToPush.serviceName);
            await database.curricula.put({
                ...itemToPush,
                isDirty: stillOversizedData ? 1 : 0,
                isDeleted: 0
            });
        }
        return { synced: true, count: localMap.size };
    } catch (err) {
        console.warn('[curriculumEngine] syncClassCurriculaWithCloud warning:', err?.message || err);
        return { synced: false, error: err?.message || String(err) };
    }
}

/**
 * Two-Way Unified Save for a specific family (`syncKey`).
 * Persists to BOTH Dexie `db.curricula` AND `localStorage.appSettings` (`osra.curricula`),
 * auto-uploads pending Base64 attachments to Cloudinary when online, and syncs to Firestore.
 */
export async function saveOsraCurriculumItem(syncKey, item = {}, options = {}) {
    const targetKey = normalizeSyncKey(syncKey || item.syncKey);
    if (!targetKey) throw new Error('syncKey is required to save curriculum item.');

    const nowIso = new Date().toISOString();
    const osrasList = getOsraListFromSettings();
    const matchedOsra = findOsraInList(targetKey, osrasList);
    const serviceName = options.serviceName || item.serviceName || matchedOsra?.serviceName || targetKey;

    const generatedId = item.id || `cur-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let normalized = normalizeUnifiedItem({
        ...item,
        id: generatedId,
        syncKey: targetKey,
        serviceName,
        updatedAt: nowIso
    }, targetKey, serviceName);

    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    const rawAttachment = getItemAttachmentUrl(normalized);
    if (rawAttachment.startsWith('data:') && options.firestore && options.syncToCloud !== false && isOnline) {
        const upgraded = await upgradeDataUriToCloudinary(rawAttachment, {
            syncKey: targetKey,
            kind: isPdfCurriculumItem(normalized) ? 'pdf' : 'image',
            title: normalized.title || normalized.fileName || 'curriculum'
        });
        if (upgraded.upgraded && upgraded.url) {
            normalized = {
                ...normalized,
                fileUrl: upgraded.url,
                pdfData: '',
                attachmentUrl: upgraded.url,
                cloudinaryPublicId: upgraded.publicId || normalized.cloudinaryPublicId || ''
            };
        }
    }

    const db = await getDbSafe();
    const dbRow = toDbCurriculumRow(normalized, serviceName, targetKey);
    if (db?.curricula) {
        await db.curricula.put(dbRow);
    }

    let updatedServices = null;
    let updatedCurricula = [normalized];
    const parsedSettings = readLocalAppSettings();
    if (parsedSettings && Array.isArray(parsedSettings.services)) {
        updatedServices = parsedSettings.services.map((svc) => ({
            ...svc,
            osras: (svc.osras || []).map((osra) => {
                if (!matchesSyncKey(osra.syncKey, targetKey)) return osra;
                const existingList = Array.isArray(osra.curricula) ? osra.curricula : [];
                const exists = existingList.some((c) => c.id === normalized.id);
                const nextList = exists
                    ? existingList.map((c) => (c.id === normalized.id ? { ...c, ...normalized } : c))
                    : [normalized, ...existingList];

                const firstPdf = nextList.find((c) => isPdfCurriculumItem(c) && getItemAttachmentUrl(c));
                const nextPdfUrl = firstPdf ? getItemAttachmentUrl(firstPdf) : (osra.pdfUrl || '');
                updatedCurricula = nextList;

                return {
                    ...osra,
                    curricula: nextList,
                    pdfUrl: nextPdfUrl,
                    curriculumUrl: nextPdfUrl,
                    curriculumName: firstPdf?.title || osra.curriculumName || ''
                };
            })
        }));

        const nextSettings = { ...parsedSettings, services: updatedServices };
        writeScopedStorage('appSettings', JSON.stringify(nextSettings));
        dispatchSettingsUpdated();
    }

    if (options.firestore && options.syncToCloud !== false && isOnline) {
        try {
            await writeCloudCurriculumDocWithFallback(
                doc(options.firestore, 'Osras', targetKey, 'curricula', String(normalized.id)),
                normalized,
                targetKey,
                serviceName
            );
            const finalUrl = getItemAttachmentUrl(normalized);
            const hasLargePendingData = finalUrl.startsWith('data:') && finalUrl.length > 20000;
            if (db?.curricula && !hasLargePendingData) {
                await db.curricula.update(dbRow.id, { isDirty: 0 });
            }
        } catch (err) {
            console.warn('[curriculumEngine] Failed syncing curriculum doc:', err?.message || err);
        }
        if (updatedServices && !isCopticBookPlanItem(normalized)) {
            void syncSettingsServicesToCloud(options.firestore, updatedServices);
        }
    }

    return { savedItem: normalized, updatedCurricula, updatedServices };
}

/**
 * Two-Way Unified Delete for a specific family (`syncKey`).
 * Marks Dexie row deleted (tombstone so sync never revives it) and removes from `osra.curricula`.
 */
export async function deleteOsraCurriculumItem(syncKey, itemId, options = {}) {
    const targetKey = normalizeSyncKey(syncKey);
    if (!targetKey || !itemId) return { deletedId: itemId, updatedCurricula: [], updatedServices: null };

    const nowIso = new Date().toISOString();
    let removedTitle = '';
    const db = await getDbSafe();
    if (db?.curricula) {
        const existingRow = await db.curricula.get(itemId);
        if (existingRow) {
            removedTitle = existingRow.title || '';
            await db.curricula.update(itemId, {
                isDeleted: 1,
                isDirty: 1,
                updatedAt: nowIso
            });
        } else {
            await db.curricula.put({
                id: String(itemId),
                serviceName: options.serviceName || targetKey,
                syncKey: targetKey,
                title: options.title || '',
                updatedAt: nowIso,
                isDirty: 1,
                isDeleted: 1
            });
        }
    }

    let updatedServices = null;
    let updatedCurricula = [];
    const parsedSettings = readLocalAppSettings();
    if (parsedSettings && Array.isArray(parsedSettings.services)) {
        updatedServices = parsedSettings.services.map((svc) => ({
            ...svc,
            osras: (svc.osras || []).map((osra) => {
                if (!matchesSyncKey(osra.syncKey, targetKey)) return osra;
                const prevList = Array.isArray(osra.curricula) ? osra.curricula : [];
                const removedItem = prevList.find((c) => c.id === itemId);
                if (!removedTitle && removedItem?.title) {
                    removedTitle = removedItem.title;
                }
                const nextList = prevList.filter((c) => c.id !== itemId);

                const removedUrl = getItemAttachmentUrl(removedItem);
                const isLegacyTombstone = itemId === `legacy-pdf-${targetKey}`;
                let nextPdfUrl = osra.pdfUrl || osra.curriculumUrl || '';
                if (isLegacyTombstone || (removedUrl && nextPdfUrl === removedUrl)) {
                    const fallbackPdf = nextList.find((c) => isPdfCurriculumItem(c) && getItemAttachmentUrl(c));
                    nextPdfUrl = fallbackPdf ? getItemAttachmentUrl(fallbackPdf) : '';
                }

                updatedCurricula = nextList;
                return {
                    ...osra,
                    curricula: nextList,
                    pdfUrl: nextPdfUrl,
                    curriculumUrl: nextPdfUrl,
                    curriculumName: nextPdfUrl ? (osra.curriculumName || '') : ''
                };
            })
        }));

        const nextSettings = { ...parsedSettings, services: updatedServices };
        writeScopedStorage('appSettings', JSON.stringify(nextSettings));
        dispatchSettingsUpdated();
    }

    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (options.firestore && options.syncToCloud !== false && isOnline) {
        try {
            await setDoc(doc(options.firestore, 'Osras', targetKey, 'curricula', String(itemId)), {
                id: String(itemId),
                syncKey: targetKey,
                title: String(removedTitle || options.title || 'منهج محذوف').trim(),
                isDeleted: true,
                updatedAt: nowIso
            }, { merge: true });
            if (db?.curricula) {
                await db.curricula.update(String(itemId), { isDirty: 0 });
            }
        } catch (err) {
            console.warn('[curriculumEngine] Failed syncing curriculum tombstone:', err?.message || err);
        }
        if (updatedServices) {
            void syncSettingsServicesToCloud(options.firestore, updatedServices);
        }
    }

    return { deletedId: itemId, updatedCurricula, updatedServices };
}

/**
 * Bulk two-way sync of a single osra's `curricula` array into Dexie.
 * Honors existing `isDeleted === 1` tombstones so deleted items never return.
 */
export async function syncOsraCurriculaToDb(serviceName, osra) {
    const db = await getDbSafe();
    if (!osra?.syncKey || !db?.curricula) return;
    const list = Array.isArray(osra.curricula) ? osra.curricula : [];
    const existingRows = await db.curricula.where('syncKey').equals(osra.syncKey).toArray();
    const deletedIds = new Set(existingRows.filter((r) => Number(r.isDeleted) === 1).map((r) => r.id));

    for (const item of list) {
        if (!item?.id || deletedIds.has(item.id)) continue;
        await db.curricula.put(toDbCurriculumRow(item, serviceName, osra.syncKey));
    }
}

/**
 * Hydrate and sync all services/osras into Dexie `curricula`.
 */
export async function syncAllServicesCurriculaToDb(services = []) {
    if (!Array.isArray(services) || services.length === 0) return services;
    const hydrated = hydrateServicesWithCurricula(services);
    const db = await getDbSafe();
    if (!db?.curricula) return hydrated;
    for (const svc of hydrated) {
        for (const osra of (svc.osras || [])) {
            await syncOsraCurriculaToDb(svc.name, osra);
        }
    }
    return hydrated;
}

/**
 * Uploads file to Cloudinary if configured + online, otherwise reads locally
 * as Base64 / compressed JPEG (<= 3MB for PDFs).
 */
export async function readFileAsAttachment(file, options = {}) {
    if (!file) throw new Error('لم يتم اختيار ملف');

    try {
        const { isConfigured, isForbiddenLegacy } = getCloudinaryConfig();
        const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
        if (!isForbiddenLegacy && isConfigured && isOnline) {
            const isImage = Boolean(file.type?.startsWith('image/'));
            if (isImage) {
                const secureUrl = await uploadImageToCloudinary(file, { syncKey: options?.syncKey });
                if (secureUrl) {
                    return { url: secureUrl, cloudinaryPublicId: '', fileName: file.name, isLocalData: false };
                }
            } else {
                const res = await uploadPdfOrFileToCloudinary(file, {
                    syncKey: options?.syncKey,
                    title: options?.title || file.name.replace(/\.[^/.]+$/, '')
                });
                if (res?.secureUrl) {
                    return {
                        url: res.secureUrl,
                        cloudinaryPublicId: res.publicId || '',
                        fileName: file.name,
                        isLocalData: false
                    };
                }
            }
        }
    } catch (err) {
        console.warn('[curriculumEngine] Cloudinary upload skipped/failed, falling back locally:', err?.message || err);
    }

    if (file.type?.startsWith('image/') && file.size > 400 * 1024) {
        const compressedUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const maxDim = 1200;
                    let w = img.width;
                    let h = img.height;
                    if (w > maxDim || h > maxDim) {
                        if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
                        else { w = Math.round((w * maxDim) / h); h = maxDim; }
                    }
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', 0.8));
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        });
        return { url: compressedUrl, fileName: file.name, isLocalData: true };
    }

    if (file.size > 3 * 1024 * 1024) {
        throw new Error('حجم الملف المحلي كبير جداً (الحد الأقصى 3 ميجابايت بدون إنترنت). استخدم رابط Google Drive المباشر أو صغّر الملف.');
    }

    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result);
        reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
        reader.readAsDataURL(file);
    });

    return { url: dataUrl, fileName: file.name, isLocalData: true };
}

/**
 * Converts Google Drive sharing URLs into previewable embed URLs for iframes.
 */
export function toEmbeddablePdfUrl(rawUrl) {
    const url = String(rawUrl || '').trim();
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    if (driveMatch) {
        return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
    }
    return url;
}

/**
 * Opens attachment safely (triggers embedded modal callback when provided, otherwise opens in new tab / downloads).
 */
export function openCurriculumAttachment(navigate, attachmentUrl, title = 'منهج الخدمة', onPreviewPdf = null) {
    const url = String(attachmentUrl || '').trim();
    if (!url) return;
    if (typeof onPreviewPdf === 'function') {
        onPreviewPdf({ url, title });
        return;
    }
    if (url.startsWith('data:')) {
        if (url.startsWith('data:application/pdf')) {
            try {
                const arr = url.split(',');
                const mime = arr[0].match(/:(.*?);/)[1];
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) u8arr[n] = bstr.charCodeAt(n);
                const blob = new Blob([u8arr], { type: mime });
                const blobUrl = URL.createObjectURL(blob);
                window.open(blobUrl, '_blank', 'noopener,noreferrer');
                return;
            } catch {
                // fallback below
            }
        }
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/\s+/g, '-')}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
}

export function triggerCurriculumDownload(attachmentUrl, title = 'منهج الخدمة', fileName = '') {
    const url = String(attachmentUrl || '').trim();
    if (!url) return;
    if (url.startsWith('data:') || url.startsWith('blob:')) {
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName || `${title.replace(/\s+/g, '-')}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
    }
    const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    const dlUrl = driveMatch
        ? `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`
        : url;
    window.open(dlUrl, '_blank', 'noopener,noreferrer');
}

function getTrackSortRank(trackId = '') {
    if (trackId === 'track_bishopric') return 1;
    if (trackId === 'track_pope') return 2;
    if (trackId === 'track_school') return 3;
    if (trackId === 'track_1' || trackId === 'track_primary') return 4;
    if (trackId === 'track_2' || trackId === 'track_secondary') return 5;
    return 10;
}

/**
 * Returns only the Coptic Book Plan (`itemType === 'coptic_book_plan'`) records for a family (`syncKey`),
 * sorted by track order then `partNumber` ascending.
 */
export function getOsraCopticBookPlans(syncKey, allCurricula = [], osrasList = null) {
    const allItems = getOsraCurricula(syncKey, allCurricula, osrasList);
    return allItems
        .filter((item) => isCopticBookPlanItem(item))
        .sort((a, b) => {
            const trackA = normalizeCurriculumTrack(a).trackId;
            const trackB = normalizeCurriculumTrack(b).trackId;
            if (trackA !== trackB) {
                const rankDiff = getTrackSortRank(trackA) - getTrackSortRank(trackB);
                if (rankDiff !== 0) return rankDiff;
                return trackA.localeCompare(trackB, 'ar');
            }
            return (Number(a.partNumber) || 1) - (Number(b.partNumber) || 1);
        });
}

function resolveSingleTrackProgressionInternal(rawTrackBooks = [], trackMeta = {}) {
    const { trackId, trackName } = normalizeCurriculumTrack(trackMeta);

    // Deduplicate by partNumber WITHIN this specific track (latest updatedAt wins)
    const partMap = new Map();
    for (const rawBook of rawTrackBooks) {
        const pNum = Math.max(1, Math.min(10, Number(rawBook.partNumber) || 1));
        const prev = partMap.get(pNum);
        if (!prev) {
            partMap.set(pNum, rawBook);
            continue;
        }
        const tNew = new Date(rawBook.updatedAt || 0).getTime();
        const tOld = new Date(prev.updatedAt || 0).getTime();
        if (tNew >= tOld) {
            partMap.set(pNum, rawBook);
        }
    }

    const sortedBooks = Array.from(partMap.values()).sort(
        (a, b) => (Number(a.partNumber) || 1) - (Number(b.partNumber) || 1)
    );

    let currentActiveLesson = null;
    let totalLessons = 0;
    let completedLessons = 0;

    const parts = sortedBooks.map((book) => {
        const partNumber = Math.max(1, Math.min(10, Number(book.partNumber) || 1));
        const partLabel = String(book.partLabel || '').trim() || `الجزء ${partNumber}`;
        const fileUrl = getItemAttachmentUrl(book);
        const normalizedLessons = (Array.isArray(book.lessons) ? book.lessons : [])
            .map((l, idx) => normalizeBookLessonEntry(l, idx))
            .sort((a, b) => {
                if (a.monthOrder !== b.monthOrder) return a.monthOrder - b.monthOrder;
                return a.weekNumber - b.weekNumber;
            });

        const monthGroupsMap = new Map();
        for (const lesson of normalizedLessons) {
            const mKey = `${lesson.monthOrder}::${lesson.copticMonth}`;
            if (!monthGroupsMap.has(mKey)) {
                monthGroupsMap.set(mKey, {
                    copticMonth: lesson.copticMonth,
                    monthOrder: lesson.monthOrder,
                    lessons: []
                });
            }
            monthGroupsMap.get(mKey).lessons.push(lesson);
        }

        const months = Array.from(monthGroupsMap.values())
            .sort((a, b) => a.monthOrder - b.monthOrder)
            .map((m) => {
                const mCompleted = m.lessons.filter((l) => l.isCompleted).length;
                const mTotal = m.lessons.length;
                const isMonthCompleted = mTotal > 0 && mCompleted === mTotal;

                for (const lesson of m.lessons) {
                    totalLessons += 1;
                    if (lesson.isCompleted) {
                        completedLessons += 1;
                    } else if (!currentActiveLesson) {
                        currentActiveLesson = {
                            ...lesson,
                            bookId: book.id,
                            bookTitle: book.title || partLabel,
                            trackId,
                            trackName,
                            partNumber,
                            partLabel,
                            fileUrl,
                            syncKey: book.syncKey || ''
                        };
                    }
                }

                return {
                    ...m,
                    completedCount: mCompleted,
                    totalCount: mTotal,
                    isMonthCompleted
                };
            });

        const partCompletedCount = months.reduce((acc, m) => acc + m.completedCount, 0);
        const partTotalCount = months.reduce((acc, m) => acc + m.totalCount, 0);
        const isPartCompleted = months.length > 0 && months.every((m) => m.isMonthCompleted);

        return {
            ...book,
            trackId,
            trackName,
            partNumber,
            partLabel,
            fileUrl,
            lessons: normalizedLessons,
            months,
            completedLessonsCount: partCompletedCount,
            totalLessonsCount: partTotalCount,
            progressPercent: partTotalCount > 0 ? Math.round((partCompletedCount / partTotalCount) * 100) : 0,
            isPartCompleted
        };
    });

    const allCompleted = parts.length > 0 && parts.every((p) => p.isPartCompleted);
    const activePartNumber = currentActiveLesson
        ? currentActiveLesson.partNumber
        : (parts[parts.length - 1]?.partNumber || 1);
    const activeCopticMonth = currentActiveLesson
        ? currentActiveLesson.copticMonth
        : (parts[parts.length - 1]?.months?.[0]?.copticMonth || '');

    return {
        trackId,
        trackName,
        parts,
        currentActiveLesson,
        activePartNumber,
        activeCopticMonth,
        completedCount: completedLessons,
        totalCount: totalLessons,
        totalLessons,
        completedLessons,
        overallProgressPercent: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
        allCompleted,
        hasBooks: parts.length > 0
    };
}

/**
 * Multi-Track Annual Curriculum Progression Resolver.
 * Resolves 2 (or more) completely independent Annual Curricula per class, where each track
 * maintains its own parts (1..4), active Friday lesson, green seals, and automatic advancement.
 */
export function resolveMultiTrackBookProgression(booksList = []) {
    const rawBooks = (Array.isArray(booksList) ? booksList : []).filter((b) => {
        if (!b || b.isDeleted === true || Number(b.isDeleted) === 1) return false;
        if (b.itemType && b.itemType !== 'coptic_book_plan') return false;
        return Array.isArray(b.lessons) && b.lessons.length > 0;
    });

    const groupsByTrack = new Map();
    const insertionOrder = [];

    for (const book of rawBooks) {
        const { trackId, trackName } = normalizeCurriculumTrack(book);
        if (!groupsByTrack.has(trackId)) {
            groupsByTrack.set(trackId, {
                trackId,
                trackName,
                latestUpdatedAt: new Date(book.updatedAt || 0).getTime(),
                books: []
            });
            insertionOrder.push(trackId);
        }
        const entry = groupsByTrack.get(trackId);
        entry.books.push(book);
        const bookTime = new Date(book.updatedAt || 0).getTime();
        if (book.trackName && bookTime >= entry.latestUpdatedAt) {
            entry.trackName = String(book.trackName).trim();
            entry.latestUpdatedAt = bookTime;
        }
    }

    const sortedTrackIds = [...insertionOrder].sort((a, b) => {
        const rankDiff = getTrackSortRank(a) - getTrackSortRank(b);
        if (rankDiff !== 0) return rankDiff;
        return insertionOrder.indexOf(a) - insertionOrder.indexOf(b);
    });

    return sortedTrackIds.map((tId) => {
        const group = groupsByTrack.get(tId);
        return resolveSingleTrackProgressionInternal(group.books, {
            trackId: group.trackId,
            trackName: group.trackName
        });
    });
}

/**
 * Sequential Auto-Advancement Resolver across Coptic Year Parts (1 -> 2 -> 3 -> 4),
 * Coptic Months (monthOrder 1 -> 4), and Weeks (1 -> 4).
 * Supports optional `{ trackId }` filtering while remaining 100% backward-compatible.
 */
export function resolveCurrentBookProgression(booksList = [], options = {}) {
    if (options?.trackId) {
        const targetTrack = normalizeCurriculumTrack({
            trackId: options.trackId,
            trackName: options.trackName
        });
        const filtered = (Array.isArray(booksList) ? booksList : []).filter((b) => {
            if (!b || b.isDeleted === true || Number(b.isDeleted) === 1) return false;
            if (b.itemType && b.itemType !== 'coptic_book_plan') return false;
            if (!Array.isArray(b.lessons) || b.lessons.length === 0) return false;
            return normalizeCurriculumTrack(b).trackId === targetTrack.trackId;
        });
        return resolveSingleTrackProgressionInternal(filtered, targetTrack);
    }

    const tracks = resolveMultiTrackBookProgression(booksList);
    if (tracks.length === 0) {
        return {
            trackId: 'track_1',
            trackName: 'المنهج السنوي الأول',
            parts: [],
            currentActiveLesson: null,
            activePartNumber: 1,
            activeCopticMonth: '',
            completedCount: 0,
            totalCount: 0,
            totalLessons: 0,
            completedLessons: 0,
            overallProgressPercent: 0,
            allCompleted: false,
            hasBooks: false,
            tracks: []
        };
    }

    return {
        ...tracks[0],
        tracks
    };
}

/**
 * Uploads the PDF file ONCE to Cloudinary (if `bookPayload.file` is provided) and saves
 * the lightweight Coptic Book Plan metadata (`itemType: 'coptic_book_plan'`) scoped to `(syncKey, trackId, partNumber)`.
 */
export async function saveOsraCopticBookPlan(syncKey, bookPayload = {}, options = {}) {
    const targetKey = normalizeSyncKey(syncKey || bookPayload.syncKey);
    if (!targetKey) throw new Error('يرجى تحديد الأسرة أولاً لحفظ كتاب المنهج');

    const { trackId, trackName } = normalizeCurriculumTrack(bookPayload);
    const partNumber = Math.max(1, Math.min(10, Number(bookPayload.partNumber) || 1));
    const partLabel = String(bookPayload.partLabel || '').trim() || `الجزء ${partNumber}`;
    const title = String(bookPayload.title || '').trim() || `${trackName} (${targetKey}) - ${partLabel}`;

    let resolvedFileUrl = String(bookPayload.fileUrl || '').trim();
    let cloudinaryPublicId = String(bookPayload.cloudinaryPublicId || '').trim();
    let fileName = String(bookPayload.fileName || '').trim();

    if (bookPayload.file) {
        fileName = fileName || bookPayload.file.name || `${title}.pdf`;
        const { isConfigured, isForbiddenLegacy } = getCloudinaryConfig();
        const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
        if (!isForbiddenLegacy && isConfigured && isOnline) {
            const uploaded = await uploadPdfOrFileToCloudinary(bookPayload.file, {
                syncKey: targetKey,
                title,
                onProgress: options?.onProgress
            });
            if (uploaded?.secureUrl) {
                resolvedFileUrl = uploaded.secureUrl;
                cloudinaryPublicId = uploaded.publicId || cloudinaryPublicId;
            }
        } else if (!resolvedFileUrl) {
            const fallbackAttachment = await readFileAsAttachment(bookPayload.file, {
                syncKey: targetKey,
                title
            });
            resolvedFileUrl = fallbackAttachment.url;
            cloudinaryPublicId = fallbackAttachment.cloudinaryPublicId || cloudinaryPublicId;
        }
    }

    const lessons = (Array.isArray(bookPayload.lessons) ? bookPayload.lessons : []).map((l, idx) =>
        normalizeBookLessonEntry(l, idx)
    );
    const copticMonths = Array.isArray(bookPayload.copticMonths) && bookPayload.copticMonths.length > 0
        ? bookPayload.copticMonths
        : Array.from(new Set(lessons.map((l) => l.copticMonth).filter(Boolean)));

    const bookId = String(bookPayload.id || `book_${targetKey}_${trackId}_part${partNumber}_${Date.now()}`);

    return saveOsraCurriculumItem(targetKey, {
        id: bookId,
        itemType: 'coptic_book_plan',
        category: 'كتاب المنهج السنوي الذكي',
        trackId,
        trackName,
        title,
        weekLabel: partLabel,
        partNumber,
        partLabel,
        totalPages: Math.max(1, Number(bookPayload.totalPages) || 1),
        copticMonths,
        lessons,
        fileUrl: resolvedFileUrl,
        attachmentUrl: resolvedFileUrl,
        cloudinaryPublicId,
        fileName,
        originalFileSize: bookPayload.originalFileSize || null,
        compressedFileSize: bookPayload.compressedFileSize || null,
        content: `${trackName} — كتاب المنهج المقسم تلقائياً (${lessons.length} درس أسبوعي)`
    }, options);
}

/**
 * Stamps or unstamps a lesson's Green Completion Seal (`تم الشرح`) inside a Coptic Book Plan
 * and immediately persists & syncs the updated book to Dexie + Firestore.
 */
export async function toggleLessonCompletionSeal(bookId, lessonId, servantName = '', syncKey = '', options = {}) {
    const targetBookId = String(bookId || '').trim();
    const targetLessonId = String(lessonId || '').trim();
    if (!targetBookId || !targetLessonId) {
        throw new Error('معرف الكتاب والدرس مطلوبان لختم الشرح');
    }

    let sourceBook = options.book || null;
    const database = await getDbSafe();
    if (!sourceBook && database?.curricula) {
        sourceBook = await database.curricula.get(targetBookId);
    }
    if (!sourceBook && syncKey) {
        const list = getOsraCopticBookPlans(syncKey);
        sourceBook = list.find((b) => String(b.id) === targetBookId) || null;
    }
    if (!sourceBook) {
        throw new Error('تعذر العثور على كتاب المنهج المحدد');
    }

    const targetSyncKey = normalizeSyncKey(syncKey || sourceBook.syncKey);
    const nowIso = new Date().toISOString();
    let updatedLesson = null;

    const nextLessons = (Array.isArray(sourceBook.lessons) ? sourceBook.lessons : []).map((rawLesson, idx) => {
        const normalized = normalizeBookLessonEntry(rawLesson, idx);
        if (normalized.id !== targetLessonId) return normalized;
        const nextCompleted = typeof options.forceCompleted === 'boolean'
            ? options.forceCompleted
            : !normalized.isCompleted;
        updatedLesson = {
            ...normalized,
            isCompleted: nextCompleted,
            completedAt: nextCompleted ? nowIso : null,
            completedBy: nextCompleted ? (String(servantName || '').trim() || 'خادم الأسرة') : null
        };
        return updatedLesson;
    });

    if (!updatedLesson) {
        throw new Error('تعذر العثور على الدرس داخل الكتاب');
    }

    const { savedItem } = await saveOsraCurriculumItem(targetSyncKey, {
        ...sourceBook,
        id: targetBookId,
        itemType: 'coptic_book_plan',
        lessons: nextLessons,
        updatedAt: nowIso
    }, {
        serviceName: options.serviceName || sourceBook.serviceName,
        firestore: options.firestore || null,
        syncToCloud: options.syncToCloud
    });

    return {
        updatedBook: savedItem,
        updatedLesson,
        isCompleted: updatedLesson.isCompleted
    };
}
