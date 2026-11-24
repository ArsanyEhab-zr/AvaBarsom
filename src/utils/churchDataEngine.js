import { createSyncDeadline } from './syncDeadline';
import { groupChildren, preferredChild, childAliases, childNameKey, resolveAttendanceChild, attendanceIdentity, timestamp } from './childIdentity';
import { db } from '../db/database';
import { readScopedStorage } from './tenantConfig';

/**
 * Normalizes a phone number to its last 10 digits for deterministic duplicate detection.
 */
export const normalizePhoneDigits = (phone = '') => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.length > 10 ? digits.slice(-10) : digits;
};

const computeClassQrHash = (syncKey = '') => {
    let hash = 2166136261;
    const str = String(syncKey || '');
    for (let i = 0; i < str.length; i += 1) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) % (36 ** 4)).toString(36).toUpperCase().padStart(4, '0');
};

/**
 * Generates a unique, human-readable, scannable QR code scoped to the child's class.
 */
export const generateClassScopedQrId = (syncKey, existingQrId = '') => {
    const trimmed = String(existingQrId || '').trim();
    if (trimmed) return trimmed;
    const syncKeyHash = computeClassQrHash(syncKey);
    const uniqueCode = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, '0');
    return `BRS-${syncKeyHash}-${uniqueCode}`;
};

/**
 * Canonical Child Record Factory (Single Source of Truth for child identity).
 * Enforces identical `id` and `cloudId`, assigns a scannable class-scoped `qrId`,
 * binds strictly to `syncKey`, and prevents incomplete/ghost child documents.
 */
export const createCanonicalChildRecord = (rawInput = {}, syncKey = '') => {
    const resolvedSyncKey = String(syncKey || rawInput?.syncKey || '').trim();
    if (!resolvedSyncKey || ['MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN'].includes(resolvedSyncKey)) {
        throw new Error('يرجى تحديد الفصل (syncKey) قبل إنشاء أو تعديل سجل المخدوم.');
    }

    const nowIso = new Date().toISOString();
    const existingId = rawInput?.id != null && String(rawInput.id).trim() !== ''
        ? String(rawInput.id).trim()
        : (rawInput?.cloudId != null && String(rawInput.cloudId).trim() !== '' ? String(rawInput.cloudId).trim() : '');

    const canonicalId = existingId || `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const cloudId = String(rawInput?.cloudId || canonicalId).trim();
    const qrId = generateClassScopedQrId(resolvedSyncKey, rawInput?.qrId);
    const confessionFather = String(rawInput?.confessionFather || rawInput?.fatherConfessor || '').trim();
    const motherPhone = String(rawInput?.motherPhone || '').trim();
    const fatherPhone = String(rawInput?.fatherPhone || '').trim();
    const childPhone = String(rawInput?.childPhone || '').trim();
    const phone = String(rawInput?.phone || '').trim();
    const whatsappTarget = rawInput?.whatsappTarget || (
        rawInput?.whatsapp === 'father' || rawInput?.whatsapp === 'child' ? rawInput.whatsapp : 'mother'
    );
    const whatsapp = String(
        rawInput?.whatsapp || rawInput?.whatsappTarget || motherPhone || fatherPhone || childPhone || phone || ''
    ).trim();

    const aliasIds = [...new Set([
        canonicalId,
        cloudId,
        qrId,
        ...(Array.isArray(rawInput?.aliasIds) ? rawInput.aliasIds : [])
    ].filter(v => v != null && v !== '').map(String))].sort();

    const { isOrdained: _dropOrdained, ordinationRank: _dropRank, ...cleanRawInput } = rawInput || {};

    return {
        ...cleanRawInput,
        id: canonicalId,
        cloudId,
        qrId,
        aliasIds,
        name: String(rawInput?.name || '').trim(),
        syncKey: resolvedSyncKey,
        phone,
        fatherPhone,
        motherPhone,
        childPhone,
        whatsappTarget,
        whatsapp,
        birthDate: String(rawInput?.birthDate || '').trim(),
        address: String(rawInput?.address || '').trim(),
        detailedAddress: String(rawInput?.detailedAddress || '').trim(),
        gpsLink: String(rawInput?.gpsLink || '').trim(),
        academicYear: String(rawInput?.academicYear || rawInput?.schoolYear || '').trim(),
        schoolYear: String(rawInput?.schoolYear || rawInput?.academicYear || '').trim(),
        confessionFather,
        fatherConfessor: confessionFather,
        fatherJob: String(rawInput?.fatherJob || '').trim(),
        gender: (rawInput?.gender === 'بنت' || rawInput?.gender === 'girl') ? 'بنت' : 'ولد',
        profilePic: String(rawInput?.profilePic || '').trim(),
        specialNotes: String(rawInput?.specialNotes || (typeof rawInput?.notes === 'string' ? rawInput.notes : '') || '').trim(),
        notes: Array.isArray(rawInput?.notes) ? rawInput.notes : [],
        streak: Number(rawInput?.streak || 0),
        gotClothes: Boolean(rawInput?.gotClothes),
        createdAt: rawInput?.createdAt || nowIso,
        updatedAt: rawInput?.updatedAt ?? nowIso,
        isDeleted: false,
        isDirty: rawInput?.isDirty !== undefined ? Boolean(rawInput.isDirty) : true
    };
};

/**
 * Extracts the primary normalized phone for a child record.
 */
export const getPrimaryNormalizedPhone = (child = {}) => {
    return (
        normalizePhoneDigits(child.childPhone) ||
        normalizePhoneDigits(child.motherPhone) ||
        normalizePhoneDigits(child.fatherPhone) ||
        normalizePhoneDigits(child.phone) ||
        ''
    );
};

/**
 * Reads all configured valid class syncKeys from appSettings in localStorage.
 */
export const getConfiguredValidSyncKeys = () => {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
        const saved = readScopedStorage('appSettings');
        if (!saved) return null;
        const parsed = JSON.parse(saved);
        const services = parsed?.services || [];
        const keys = services
            .flatMap(s => s?.osras || [])
            .map(o => String(o?.syncKey || '').trim())
            .filter(Boolean);
        return keys.length > 0 ? new Set(keys) : null;
    } catch {
        return null;
    }
};

/**
 * Helper to compare two child records and pick the more authoritative / newer one.
 */
/**
 * 1. Canonical Active Children Resolver
 * Strictly excludes deleted or nameless records, normalizes syncKey, and deduplicates
 * by canonical ID (id / cloudId) and by (syncKey + normalized Arabic 4-part name + phone).
 *
 * @param {Array} allChildren - Raw children array from Dexie
 * @param {Array|Set|null} allowedSyncKeys - Optional set/array of allowed class syncKeys
 */
export const getCanonicalActiveChildren = (allChildren = [], allowedSyncKeys = null) => {
    const allowed = allowedSyncKeys == null ? null : new Set(Array.from(allowedSyncKeys).map(String));
    const groups = groupChildren(allChildren.filter(c => c && c.syncKey && (!allowed || allowed.has(String(c.syncKey)))));
    const activeChildren = groups.map(preferredChild).filter(c => !c.isDeleted && c.name && !['MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN'].includes(c.syncKey));
    const childrenByClassMap = new Map(), activeChildIdSetByClass = new Map(), childMapById = new Map();
    for (const child of activeChildren) {
        if (!childrenByClassMap.has(child.syncKey)) childrenByClassMap.set(child.syncKey, []);
        childrenByClassMap.get(child.syncKey).push(child);
        if (!activeChildIdSetByClass.has(child.syncKey)) activeChildIdSetByClass.set(child.syncKey, new Set());
        for (const alias of childAliases(child)) {
            activeChildIdSetByClass.get(child.syncKey).add(alias);
            childMapById.set(alias, child);
            childMapById.set(`${child.syncKey}::id::${alias}`, child);
        }
        childMapById.set(childNameKey(child), child);
    }
    return { activeChildren, childrenByClassMap, activeChildIdSetByClass, childMapById };
};

/**
 * Checks whether an attendance record represents an active "present" status.
 * Critical Rule #1: Ignore any record where isDeleted === true, status === 'absent',
 * status === 'excused', present === false, or attended === false.
 */
export const isAttendanceRecordPresent = (r) => {
    if (!r || r.isDeleted === true) return false;
    if (r.status === 'absent' || r.status === 'excused' || r.status === 'unmarked') return false;
    if (r.present === false || r.attended === false) return false;
    return true;
};

/**
 * Checks whether an attendance record represents an explicit "absent" status.
 * Never treats missing/unmarked or deleted records as absent.
 */
export const isAttendanceRecordExplicitAbsent = (r) => {
    if (!r || r.isDeleted === true) return false;
    return r.status === 'absent' || r.present === false || r.attended === false;
};

/**
 * 2. Canonical Validated Attendance Resolver
 * Enforces:
 * - Rule #1: Neutral 3-state semantics (unmarked | present | absent). Unmarked records are NEVER counted as absent.
 * - Rule #2: Authoritative Child & Class Join (must exist in canonicalData.childMapById; attributed to child.syncKey)
 * - Rule #3: Strict per-session deduplication keyed by (date, canonicalChildId, sessionKey || type) so multi-day
 *   weekly sessions (e.g. Sunday + Thursday) are counted independently for BOTH attendances and absences.
 *
 * @param {Array} allAttendance - Raw attendance rows from Dexie
 * @param {Object} canonicalData - Result of getCanonicalActiveChildren()
 * @param {Object} options - Optional filters: { targetSyncKey, exactDate, startDate, endDate, sessionKey }
 */
export const getValidatedClassAttendance = (allAttendance = [], canonicalData, options = {}) => {
    const safeCanonical = canonicalData || getCanonicalActiveChildren([]);
    const { childrenByClassMap, activeChildren } = safeCanonical;

    const {
        targetSyncKey = null,
        exactDate = null,
        startDate = null,
        endDate = null,
        sessionKey: filterSessionKey = null
    } = options;

    const cleanTargetKey = (
        targetSyncKey &&
        targetSyncKey !== 'all' &&
        targetSyncKey !== 'ALL_CHURCH' &&
        targetSyncKey !== 'MASTER_ACCESS' &&
        targetSyncKey !== 'ADMIN_MODE' &&
        targetSyncKey !== 'STAGE_ADMIN'
    )
        ? String(targetSyncKey).trim()
        : null;

    // Global deduplicated Sets of canonical child IDs (String(canonicalChild.id))
    const servicePresentIds = new Set();
    const liturgyPresentIds = new Set();
    const tasbehaPresentIds = new Set();
    const visitationPresentIds = new Set();

    const explicitAbsentServiceIds = new Set();
    const explicitExcusedServiceIds = new Set();
    const recordedServiceIds = new Set();

    const explicitAbsentLiturgyIds = new Set();
    const recordedLiturgyIds = new Set();

    const explicitAbsentTasbehaIds = new Set();
    const recordedTasbehaIds = new Set();

    // Multi-session event lists (preserve Sunday + Thursday independently within the same week)
    const allEvents = [];
    const servicePresentEvents = [];
    const serviceAbsentEvents = [];
    const liturgyPresentEvents = [];
    const liturgyAbsentEvents = [];
    const tasbehaPresentEvents = [];
    const tasbehaAbsentEvents = [];

    // Per-child multi-session summary
    const byChild = {};
    const ensureChildEntry = (childIdStr) => {
        if (!byChild[childIdStr]) {
            byChild[childIdStr] = {
                childId: childIdStr,
                servicePresentCount: 0,
                serviceAbsentCount: 0,
                liturgyPresentCount: 0,
                liturgyAbsentCount: 0,
                tasbehaPresentCount: 0,
                tasbehaAbsentCount: 0,
                visitationCount: 0,
                totalPresentCount: 0,
                totalAbsentCount: 0,
                presentEvents: [],
                absentEvents: []
            };
        }
        return byChild[childIdStr];
    };

    // Per-class deduplicated Sets & event lists
    const classSetsMap = new Map();

    const ensureClassEntry = (syncKey) => {
        if (!classSetsMap.has(syncKey)) {
            classSetsMap.set(syncKey, {
                servicePresentIds: new Set(),
                liturgyPresentIds: new Set(),
                tasbehaPresentIds: new Set(),
                visitationPresentIds: new Set(),
                recordedService: false,
                recordedAny: false,
                recordedServiceIds: new Set(),
                explicitAbsentServiceIds: new Set(),
                explicitExcusedServiceIds: new Set(),
                explicitAbsentLiturgyIds: new Set(),
                explicitAbsentTasbehaIds: new Set(),
                servicePresentEvents: [],
                serviceAbsentEvents: [],
                liturgyPresentEvents: [],
                liturgyAbsentEvents: [],
                tasbehaPresentEvents: [],
                tasbehaAbsentEvents: []
            });
        }
        return classSetsMap.get(syncKey);
    };

    // Pre-initialize all known classes from childrenByClassMap so classes with 0 attendance still exist in byClass
    for (const syncKey of childrenByClassMap.keys()) {
        if (!cleanTargetKey || syncKey === cleanTargetKey) {
            ensureClassEntry(syncKey);
        }
    }

    // Track latest record per (date, canonicalChildId, sessionKey || type) so multi-day sessions never collide
    const deduplicatedRowsMap = new Map();

    for (const r of (allAttendance || [])) {
        if (!r) continue;
        if (!r.date || !r.type) continue;

        const rDate = String(r.date).split('T')[0];
        if (exactDate && rDate !== exactDate) continue;
        if (startDate && rDate < startDate) continue;
        if (endDate && rDate > endDate) continue;

        const resolvedSessionKey = String(r.sessionKey || r.type).trim();
        if (filterSessionKey && resolvedSessionKey !== filterSessionKey && r.type !== filterSessionKey) continue;

        // CRITICAL RULE #2: Look up r.childId in canonicalData.childMapById
        const canonicalChild = resolveAttendanceChild(r, safeCanonical);
        if (!canonicalChild) {
            // Child was deleted or is a ghost/orphaned record -> IGNORE completely!
            continue;
        }

        // Always attribute to the child's authoritative syncKey
        const authoritativeSyncKey = canonicalChild.syncKey;
        if (cleanTargetKey && authoritativeSyncKey !== cleanTargetKey) {
            continue;
        }

        const canonicalIdStr = String(canonicalChild.id).trim();
        const rowKey = `${rDate}::${canonicalIdStr}::${resolvedSessionKey}`;
        const existingRow = deduplicatedRowsMap.get(rowKey);

        if (!existingRow) {
            deduplicatedRowsMap.set(rowKey, { record: r, canonicalChild, canonicalIdStr, authoritativeSyncKey, rDate, resolvedSessionKey });
        } else {
            const existingTime = existingRow.record.updatedAt ? new Date(existingRow.record.updatedAt).getTime() : 0;
            const candidateTime = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
            if (candidateTime >= existingTime) {
                deduplicatedRowsMap.set(rowKey, { record: r, canonicalChild, canonicalIdStr, authoritativeSyncKey, rDate, resolvedSessionKey });
            }
        }
    }

    // Process deduplicated valid records
    for (const { record: r, canonicalChild, canonicalIdStr, authoritativeSyncKey, rDate, resolvedSessionKey } of deduplicatedRowsMap.values()) {
        const classEntry = ensureClassEntry(authoritativeSyncKey);
        if (r.isDeleted || r.status === 'unmarked') continue;

        const isServiceType = r.type === 'service' || r.type === 'service_meeting';
        const isPresent = isAttendanceRecordPresent(r);
        const isExplicitAbsent = !isPresent && isAttendanceRecordExplicitAbsent(r);
        const isExcused = !isPresent && r.status === 'excused';

        if (isServiceType) classEntry.recordedService = true;
        classEntry.recordedAny = true;

        const childStats = ensureChildEntry(canonicalIdStr);
        const eventItem = {
            date: rDate,
            type: r.type,
            sessionKey: resolvedSessionKey,
            sessionLabel: String(r.sessionLabel || '').trim(),
            status: isPresent ? 'present' : (isExplicitAbsent ? 'absent' : (isExcused ? 'excused' : 'unmarked')),
            childId: canonicalIdStr,
            child: canonicalChild,
            syncKey: authoritativeSyncKey,
            record: r
        };
        allEvents.push(eventItem);

        if (isPresent) {
            if (isServiceType) {
                servicePresentIds.add(canonicalIdStr);
                recordedServiceIds.add(canonicalIdStr);
                classEntry.servicePresentIds.add(canonicalIdStr);
                classEntry.recordedServiceIds.add(canonicalIdStr);
                servicePresentEvents.push(eventItem);
                classEntry.servicePresentEvents.push(eventItem);
                childStats.servicePresentCount += 1;
                childStats.totalPresentCount += 1;
                childStats.presentEvents.push(eventItem);
            } else if (r.type === 'liturgy') {
                liturgyPresentIds.add(canonicalIdStr);
                recordedLiturgyIds.add(canonicalIdStr);
                classEntry.liturgyPresentIds.add(canonicalIdStr);
                liturgyPresentEvents.push(eventItem);
                classEntry.liturgyPresentEvents.push(eventItem);
                childStats.liturgyPresentCount += 1;
                childStats.totalPresentCount += 1;
                childStats.presentEvents.push(eventItem);
            } else if (r.type === 'tasbeha') {
                tasbehaPresentIds.add(canonicalIdStr);
                recordedTasbehaIds.add(canonicalIdStr);
                classEntry.tasbehaPresentIds.add(canonicalIdStr);
                tasbehaPresentEvents.push(eventItem);
                classEntry.tasbehaPresentEvents.push(eventItem);
                childStats.tasbehaPresentCount += 1;
                childStats.totalPresentCount += 1;
                childStats.presentEvents.push(eventItem);
            } else if (r.type === 'visitation') {
                visitationPresentIds.add(canonicalIdStr);
                classEntry.visitationPresentIds.add(canonicalIdStr);
                childStats.visitationCount += 1;
            }
        } else if (isExplicitAbsent) {
            if (isServiceType) {
                explicitAbsentServiceIds.add(canonicalIdStr);
                recordedServiceIds.add(canonicalIdStr);
                classEntry.explicitAbsentServiceIds.add(canonicalIdStr);
                classEntry.recordedServiceIds.add(canonicalIdStr);
                serviceAbsentEvents.push(eventItem);
                classEntry.serviceAbsentEvents.push(eventItem);
                childStats.serviceAbsentCount += 1;
                childStats.totalAbsentCount += 1;
                childStats.absentEvents.push(eventItem);
            } else if (r.type === 'liturgy') {
                explicitAbsentLiturgyIds.add(canonicalIdStr);
                recordedLiturgyIds.add(canonicalIdStr);
                classEntry.explicitAbsentLiturgyIds.add(canonicalIdStr);
                liturgyAbsentEvents.push(eventItem);
                classEntry.liturgyAbsentEvents.push(eventItem);
                childStats.liturgyAbsentCount += 1;
                childStats.totalAbsentCount += 1;
                childStats.absentEvents.push(eventItem);
            } else if (r.type === 'tasbeha') {
                explicitAbsentTasbehaIds.add(canonicalIdStr);
                recordedTasbehaIds.add(canonicalIdStr);
                classEntry.explicitAbsentTasbehaIds.add(canonicalIdStr);
                tasbehaAbsentEvents.push(eventItem);
                classEntry.tasbehaAbsentEvents.push(eventItem);
                childStats.tasbehaAbsentCount += 1;
                childStats.totalAbsentCount += 1;
                childStats.absentEvents.push(eventItem);
            }
        } else if (isExcused && isServiceType) {
            explicitExcusedServiceIds.add(canonicalIdStr);
            recordedServiceIds.add(canonicalIdStr);
            classEntry.explicitExcusedServiceIds.add(canonicalIdStr);
            classEntry.recordedServiceIds.add(canonicalIdStr);
        }
    }

    // Scoped active children for this query
    const scopedActiveChildren = cleanTargetKey
        ? (childrenByClassMap.get(cleanTargetKey) || [])
        : activeChildren;

    // Resolve exact Child object lists (ZERO false absences: unmarked children are NEVER in whoAbsentServiceList)
    const whoAttendedServiceList = scopedActiveChildren.filter(c => servicePresentIds.has(String(c.id).trim()));
    const whoAttendedLiturgyList = scopedActiveChildren.filter(c => liturgyPresentIds.has(String(c.id).trim()));
    const whoAttendedTasbehaList = scopedActiveChildren.filter(c => tasbehaPresentIds.has(String(c.id).trim()));
    const whoVisitedList = scopedActiveChildren.filter(c => visitationPresentIds.has(String(c.id).trim()));
    const whoExplicitAbsentServiceList = scopedActiveChildren.filter(c => explicitAbsentServiceIds.has(String(c.id).trim()));
    const whoAbsentServiceList = whoExplicitAbsentServiceList;
    const whoUnmarkedServiceList = scopedActiveChildren.filter(c => !recordedServiceIds.has(String(c.id).trim()));
    const whoExplicitExcusedServiceList = scopedActiveChildren.filter(c => explicitExcusedServiceIds.has(String(c.id).trim()));
    const whoAbsentLiturgyList = scopedActiveChildren.filter(c => explicitAbsentLiturgyIds.has(String(c.id).trim()));
    const whoUnmarkedLiturgyList = scopedActiveChildren.filter(c => !recordedLiturgyIds.has(String(c.id).trim()));
    const whoAbsentTasbehaList = scopedActiveChildren.filter(c => explicitAbsentTasbehaIds.has(String(c.id).trim()));
    const whoUnmarkedTasbehaList = scopedActiveChildren.filter(c => !recordedTasbehaIds.has(String(c.id).trim()));

    // Build per-class breakdown
    const byClass = {};
    for (const [syncKey, sets] of classSetsMap.entries()) {
        const classChildren = childrenByClassMap.get(syncKey) || [];
        const totalActiveChildren = classChildren.length;

        const classWhoAttendedService = classChildren.filter(c => sets.servicePresentIds.has(String(c.id).trim()));
        const classWhoAttendedLiturgy = classChildren.filter(c => sets.liturgyPresentIds.has(String(c.id).trim()));
        const classWhoAttendedTasbeha = classChildren.filter(c => sets.tasbehaPresentIds.has(String(c.id).trim()));
        const classWhoVisited = classChildren.filter(c => sets.visitationPresentIds.has(String(c.id).trim()));
        const classWhoAbsentService = classChildren.filter(c => sets.explicitAbsentServiceIds.has(String(c.id).trim()));
        const classWhoUnmarkedService = classChildren.filter(c => !sets.recordedServiceIds.has(String(c.id).trim()));

        // Guaranteed <= totalActiveChildren for unique-child counts
        const presentCount = classWhoAttendedService.length;
        const absentCount = classWhoAbsentService.length;
        const unmarkedCount = classWhoUnmarkedService.length;
        const liturgyCount = classWhoAttendedLiturgy.length;
        const tasbehaCount = classWhoAttendedTasbeha.length;
        const visitationCount = classWhoVisited.length;

        byClass[syncKey] = {
            syncKey,
            totalActiveChildren,
            presentCount,
            absentCount,
            unmarkedCount,
            liturgyCount,
            tasbehaCount,
            visitationCount,
            attendanceCount: presentCount,
            totalVisitationRecords: visitationCount,
            hasRecordedAttendance: sets.recordedService,
            hasRecordedAnyAttendance: sets.recordedAny,
            hasRecordedVisitation: visitationCount > 0,
            servicePresentOccurrences: sets.servicePresentEvents.length,
            serviceAbsentOccurrences: sets.serviceAbsentEvents.length,
            liturgyPresentOccurrences: sets.liturgyPresentEvents.length,
            liturgyAbsentOccurrences: sets.liturgyAbsentEvents.length,
            tasbehaPresentOccurrences: sets.tasbehaPresentEvents.length,
            tasbehaAbsentOccurrences: sets.tasbehaAbsentEvents.length,
            totalPresentOccurrences: sets.servicePresentEvents.length + sets.liturgyPresentEvents.length + sets.tasbehaPresentEvents.length,
            totalAbsentOccurrences: sets.serviceAbsentEvents.length + sets.liturgyAbsentEvents.length + sets.tasbehaAbsentEvents.length,
            servicePresentIds: sets.servicePresentIds,
            explicitAbsentServiceIds: sets.explicitAbsentServiceIds,
            liturgyPresentIds: sets.liturgyPresentIds,
            tasbehaPresentIds: sets.tasbehaPresentIds,
            visitationPresentIds: sets.visitationPresentIds,
            whoAttendedServiceList: classWhoAttendedService,
            whoAttendedLiturgyList: classWhoAttendedLiturgy,
            whoAttendedTasbehaList: classWhoAttendedTasbeha,
            whoVisitedList: classWhoVisited,
            whoAbsentServiceList: classWhoAbsentService,
            whoExplicitAbsentServiceList: classWhoAbsentService,
            whoUnmarkedServiceList: classWhoUnmarkedService
        };
    }

    return {
        totalActiveChildren: scopedActiveChildren.length,
        presentCount: whoAttendedServiceList.length,
        absentCount: whoAbsentServiceList.length,
        unmarkedCount: whoUnmarkedServiceList.length,
        liturgyCount: whoAttendedLiturgyList.length,
        liturgyAbsentCount: whoAbsentLiturgyList.length,
        liturgyUnmarkedCount: whoUnmarkedLiturgyList.length,
        tasbehaCount: whoAttendedTasbehaList.length,
        tasbehaAbsentCount: whoAbsentTasbehaList.length,
        tasbehaUnmarkedCount: whoUnmarkedTasbehaList.length,
        visitationCount: whoVisitedList.length,
        servicePresentOccurrences: servicePresentEvents.length,
        serviceAbsentOccurrences: serviceAbsentEvents.length,
        liturgyPresentOccurrences: liturgyPresentEvents.length,
        liturgyAbsentOccurrences: liturgyAbsentEvents.length,
        tasbehaPresentOccurrences: tasbehaPresentEvents.length,
        tasbehaAbsentOccurrences: tasbehaAbsentEvents.length,
        totalPresentOccurrences: servicePresentEvents.length + liturgyPresentEvents.length + tasbehaPresentEvents.length,
        totalAbsentOccurrences: serviceAbsentEvents.length + liturgyAbsentEvents.length + tasbehaAbsentEvents.length,
        servicePresentIds,
        liturgyPresentIds,
        tasbehaPresentIds,
        visitationPresentIds,
        explicitAbsentServiceIds,
        explicitExcusedServiceIds,
        explicitAbsentLiturgyIds,
        explicitAbsentTasbehaIds,
        whoAttendedServiceList,
        whoAttendedLiturgyList,
        whoAttendedTasbehaList,
        whoVisitedList,
        whoAbsentServiceList,
        whoExplicitAbsentServiceList,
        whoUnmarkedServiceList,
        whoExplicitExcusedServiceList,
        whoAbsentLiturgyList,
        whoUnmarkedLiturgyList,
        whoAbsentTasbehaList,
        whoUnmarkedTasbehaList,
        allEvents,
        servicePresentEvents,
        serviceAbsentEvents,
        liturgyPresentEvents,
        liturgyAbsentEvents,
        tasbehaPresentEvents,
        tasbehaAbsentEvents,
        byChild,
        byClass
    };
};

/**
 * Cleans up duplicate (date, childId, type) rows and orphaned attendance rows in Dexie
 * without locking IndexedDB reads inside a write transaction.
 */
export const consolidateLocalDexieDuplicates = options => {
    const ownsDeadline = typeof options?.run !== 'function';
    const deadline = ownsDeadline ? createSyncDeadline('تنظيف السجلات') : options;
    return deadline.run(async () => {
        deadline?.check?.();
        const [children, originalRows] = await Promise.all([
            db.children.toArray(),
            db.attendance.toArray(),
        ]);
        deadline?.check?.();

        const canonical = getCanonicalActiveChildren(children);
        const childrenToPut = [];
        const childIdsToDelete = [];
        const attendanceIdsToDelete = [];
        const attendanceToPut = [];

        for (const group of groupChildren(children)) {
            deadline?.check?.();
            if (group.length < 2) continue;
            const winner = preferredChild(group);
            childrenToPut.push({ ...winner, isDirty: group.some(c => c.isDirty) });
            for (const child of group) {
                if (child.id !== winner.id) childIdsToDelete.push(child.id);
            }
        }

        const seen = new Map();
        const originalById = new Map(originalRows.map(row => [row.id, row]));
        for (const row of originalRows) {
            deadline?.check?.();
            const child = resolveAttendanceChild(row, canonical);
            if (!child) continue;
            const updated = { ...row, ...attendanceIdentity(child) };
            const key = `${child.syncKey}::${row.date}::${updated.childId}::${row.sessionKey || row.type}`;
            const previous = seen.get(key);
            if (!previous || timestamp(row.updatedAt) >= timestamp(previous.updatedAt)) {
                if (previous) attendanceIdsToDelete.push(previous.id);
                seen.set(key, updated);
            } else {
                attendanceIdsToDelete.push(row.id);
            }
        }

        for (const row of seen.values()) {
            deadline?.check?.();
            if (JSON.stringify(row) !== JSON.stringify(originalById.get(row.id))) {
                attendanceToPut.push(row);
            }
        }

        const deletedCount = childIdsToDelete.length + attendanceIdsToDelete.length;
        const fixedCount = attendanceToPut.length;

        if (childrenToPut.length === 0 && deletedCount === 0 && fixedCount === 0) {
            return { deletedCount: 0, fixedCount: 0, totalCleaned: 0 };
        }

        await db.transaction('rw', db.children, db.attendance, async tx => {
            const unsubscribe = deadline?.onCancel?.(() => tx?.abort?.());
            try {
                deadline?.check?.();
                for (const c of childrenToPut) await db.children.put(c);
                for (const id of childIdsToDelete) await db.children.delete(id);
                for (const id of attendanceIdsToDelete) await db.attendance.delete(id);
                for (const row of attendanceToPut) await db.attendance.put(row);
            } finally {
                unsubscribe?.();
            }
        });

        return { deletedCount, fixedCount, totalCleaned: deletedCount + fixedCount };
    }).finally(() => { if (ownsDeadline) deadline.cancel(); });
};
export const cleanupDuplicateAndOrphanedAttendance = consolidateLocalDexieDuplicates;
