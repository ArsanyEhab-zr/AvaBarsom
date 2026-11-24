/**
 * Service Week & Multi-Day Church Schedule Engine
 *
 * Thursday-to-Wednesday weekly cycle:
 * - The church service week starts on Thursday 00:00:00 and ends on Wednesday 23:59:59.999.
 * - Dynamically reads `serviceDays` & `liturgyDays` from any service or class configuration in appSettings,
 *   with reliable fallback to St. Barsoum default schedules for legacy classes.
 */

import { readScopedStorage } from './tenantConfig.js';
import { SUNDAY_SCHOOL_SERVANTS_CUSTOM_SESSIONS } from './realChurchStructure.js';

export const DAY_KEY_TO_NUM = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
};

export const DAY_NUM_TO_KEY = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const DAY_NUM_TO_ARABIC = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export const WEEK_DAYS_LIST = DAY_NUM_TO_KEY.map((key, num) => ({
    key,
    num,
    label: DAY_NUM_TO_ARABIC[num]
}));

export const parseDayTokenToNum = (token) => {
    if (token === null || token === undefined) return null;
    if (typeof token === 'number' && token >= 0 && token <= 6) return token;
    const raw = String(token).trim().toLowerCase();
    if (/^[0-6]$/.test(raw)) return Number(raw);
    if (DAY_KEY_TO_NUM[raw] !== undefined) return DAY_KEY_TO_NUM[raw];
    if (raw.includes('احد') || raw.includes('أحد')) return 0;
    if (raw.includes('اثنين') || raw.includes('إثنين') || raw.includes('تنين')) return 1;
    if (raw.includes('ثلاثاء') || raw.includes('تلات')) return 2;
    if (raw.includes('اربعاء') || raw.includes('أربعاء') || raw.includes('اربع')) return 3;
    if (raw.includes('خميس')) return 4;
    if (raw.includes('جمعه') || raw.includes('جمعة')) return 5;
    if (raw.includes('سبت')) return 6;
    return null;
};

/**
 * Normalizes any array/string of weekday tokens into unique sorted day keys & indices.
 */
export function normalizeScheduleDaysList(rawList) {
    if (!Array.isArray(rawList)) return [];
    const seen = new Set();
    const nums = [];
    for (const item of rawList) {
        const n = parseDayTokenToNum(item);
        if (n !== null && !seen.has(n)) {
            seen.add(n);
            nums.push(n);
        }
    }
    return nums;
}

/**
 * Formats a Date object, timestamp, or date string into local 'YYYY-MM-DD'
 * without any UTC timezone offset shift.
 */
export const getLocalDateString = (d = new Date()) => {
    if (!d) return '';
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
        return d.trim();
    }
    const target = (typeof d === 'number' || typeof d === 'string') ? new Date(d) : d;
    if (isNaN(target.getTime())) return '';
    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, '0');
    const dd = String(target.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

/**
 * Normalizes Arabic text for reliable matching of class/service names.
 */
export const normalizeArabicText = (text = '') => {
    return String(text || '')
        .trim()
        .toLowerCase()
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/[ىي]/g, 'ي')
        .replace(/[ؤئ]/g, 'ء')
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/\s+/g, ' ');
};

/**
 * Builds a clean Arabic schedule badge from serviceDays and liturgyDays arrays.
 */
export function buildScheduleLabel(serviceDays = [], liturgyDays = []) {
    const sNums = normalizeScheduleDaysList(serviceDays);
    const lNums = normalizeScheduleDaysList(liturgyDays);

    let servicePart = '';
    if (sNums.length === 2 && sNums.includes(0) && sNums.includes(4)) {
        servicePart = 'الأحد والخميس';
    } else if (sNums.length > 0) {
        servicePart = sNums.map(n => DAY_NUM_TO_ARABIC[n]).join(' و');
    }

    let liturgyPart = '';
    if (lNums.length === 1) {
        liturgyPart = `قداس ${DAY_NUM_TO_ARABIC[lNums[0]]}`;
    } else if (lNums.length > 1) {
        liturgyPart = `قداس ${lNums.map(n => DAY_NUM_TO_ARABIC[n]).join(' و')}`;
    }

    if (servicePart && liturgyPart) return `${servicePart} • ${liturgyPart}`;
    return servicePart || liturgyPart || 'جدول أسبوعي';
}

function readSettingsObjectSafe(explicitAppSettings = null) {
    if (explicitAppSettings && typeof explicitAppSettings === 'object') {
        return explicitAppSettings;
    }
    if (typeof window !== 'undefined' && window.localStorage) {
        try {
            const saved = readScopedStorage('appSettings');
            if (saved) return JSON.parse(saved);
        } catch (_e) {}
    }
    return null;
}

/**
 * Resolves class metadata (name, serviceName, serviceDays, liturgyDays, scheduleLabel)
 * supporting BOTH string syncKeys AND direct osra/service objects or explicit appSettings.
 */
export const resolveClassInfo = (osraOrSyncKey = '', className = '', explicitAppSettings = null) => {
    const isObjInput = osraOrSyncKey && typeof osraOrSyncKey === 'object';
    const cleanKey = String(isObjInput ? (osraOrSyncKey.syncKey || '') : (osraOrSyncKey || '')).trim();
    let resolvedName = String(isObjInput ? (osraOrSyncKey.name || className || '') : (className || '')).trim();
    let serviceName = String(isObjInput ? (osraOrSyncKey.serviceName || '') : '').trim();
    let serviceDay = isObjInput ? (osraOrSyncKey.serviceDay ?? null) : null;
    let serviceDays = isObjInput && Array.isArray(osraOrSyncKey.serviceDays) ? osraOrSyncKey.serviceDays : null;
    let liturgyDay = isObjInput ? (osraOrSyncKey.liturgyDay ?? null) : null;
    let liturgyDays = isObjInput && Array.isArray(osraOrSyncKey.liturgyDays) ? osraOrSyncKey.liturgyDays : null;
    let useCustomSchedule = isObjInput ? Boolean(osraOrSyncKey.useCustomSchedule) : false;
    let serviceGroup = isObjInput ? (osraOrSyncKey.serviceGroup || '') : '';
    let isServantsRoster = isObjInput ? Boolean(osraOrSyncKey.isServantsRoster) : false;
    let customSessions = isObjInput && Array.isArray(osraOrSyncKey.customSessions) ? osraOrSyncKey.customSessions : null;
    let scheduleLabel = isObjInput && osraOrSyncKey.scheduleLabel ? String(osraOrSyncKey.scheduleLabel).trim() : '';

    const settings = readSettingsObjectSafe(explicitAppSettings);
    if (settings && Array.isArray(settings.services)) {
        for (const s of settings.services) {
            const osras = s?.osras || [];
            const matchedOsra = osras.find((o) => {
                const oKey = String(o?.syncKey || '').trim();
                const oName = String(o?.name || '').trim();
                return (cleanKey && oKey === cleanKey) || (resolvedName && oName === resolvedName);
            });

            if (matchedOsra) {
                if (!resolvedName && matchedOsra.name) resolvedName = String(matchedOsra.name).trim();
                if (!serviceName) serviceName = String(s?.name || matchedOsra?.serviceName || '').trim();
                serviceGroup = serviceGroup || matchedOsra?.serviceGroup || s?.serviceGroup || '';
                isServantsRoster = isServantsRoster || Boolean(matchedOsra?.isServantsRoster);
                if (!customSessions) {
                    if (Array.isArray(matchedOsra.customSessions) && matchedOsra.customSessions.length > 0) {
                        customSessions = matchedOsra.customSessions;
                    } else if (Array.isArray(s?.customSessions) && s.customSessions.length > 0) {
                        customSessions = s.customSessions;
                    }
                }
                if (!scheduleLabel) {
                    scheduleLabel = String(matchedOsra.scheduleLabel || s?.scheduleLabel || '').trim();
                }

                const osraHasCustom =
                    useCustomSchedule ||
                    Boolean(matchedOsra.useCustomSchedule) ||
                    (Array.isArray(matchedOsra.serviceDays) && matchedOsra.serviceDays.length > 0 && (
                        !Array.isArray(s?.serviceDays) ||
                        matchedOsra.useCustomSchedule !== false
                    ));

                if (!serviceDays) {
                    if (osraHasCustom && Array.isArray(matchedOsra.serviceDays) && matchedOsra.serviceDays.length > 0) {
                        serviceDays = matchedOsra.serviceDays;
                    } else if (Array.isArray(s?.serviceDays) && s.serviceDays.length > 0) {
                        serviceDays = s.serviceDays;
                    } else if (Array.isArray(matchedOsra.serviceDays)) {
                        serviceDays = matchedOsra.serviceDays;
                    }
                }
                if (serviceDay === null) {
                    serviceDay = matchedOsra?.serviceDay ?? s?.serviceDay ?? null;
                }
                if (!liturgyDays) {
                    if ((useCustomSchedule || matchedOsra.useCustomSchedule) && Array.isArray(matchedOsra.liturgyDays)) {
                        liturgyDays = matchedOsra.liturgyDays;
                    } else if (Array.isArray(matchedOsra.liturgyDays)) {
                        liturgyDays = matchedOsra.liturgyDays;
                    } else if (Array.isArray(s?.liturgyDays)) {
                        liturgyDays = s.liturgyDays;
                    }
                }
                if (liturgyDay === null) {
                    liturgyDay = matchedOsra?.liturgyDay ?? s?.liturgyDay ?? null;
                }
                break;
            }

            // Fallback match by service name when no specific osra syncKey matched
            if (!matchedOsra && !cleanKey && resolvedName && String(s?.name || '').trim() === resolvedName) {
                serviceName = String(s.name).trim();
                if (!serviceDays && Array.isArray(s.serviceDays) && s.serviceDays.length > 0) {
                    serviceDays = s.serviceDays;
                }
                if (!liturgyDays && Array.isArray(s.liturgyDays)) {
                    liturgyDays = s.liturgyDays;
                }
                if (!customSessions && Array.isArray(s.customSessions) && s.customSessions.length > 0) {
                    customSessions = s.customSessions;
                }
                if (!scheduleLabel && s.scheduleLabel) {
                    scheduleLabel = String(s.scheduleLabel).trim();
                }
                if (serviceDay === null) serviceDay = s.serviceDay ?? null;
                if (liturgyDay === null) liturgyDay = s.liturgyDay ?? null;
                break;
            }
        }
    }

    if (!resolvedName && cleanKey && typeof window !== 'undefined' && window.localStorage) {
        try {
            const currentKey = String(readScopedStorage('currentSyncKey') || '').trim();
            if (cleanKey === currentKey) {
                const assignedOsra = readScopedStorage('assignedOsra') || '';
                const servantStr = readScopedStorage('currentServant');
                const servant = servantStr ? JSON.parse(servantStr) : {};
                resolvedName = assignedOsra || servant.osraName || servant.assignedOsra || servant.serviceName || '';
            }
        } catch (_e) {}
    }

    // Built-in canonical production fallback for خدام مدارس الأحد when customSessions aren't explicitly supplied
    if (!customSessions && cleanKey === 'خدام مدارس الأحد') {
        customSessions = SUNDAY_SCHOOL_SERVANTS_CUSTOM_SESSIONS;
        if (!serviceDays) serviceDays = ['sunday', 'thursday', 'wednesday'];
        if (!liturgyDays) liturgyDays = ['friday'];
        if (!scheduleLabel) scheduleLabel = 'الأحد والخميس • قداس الجمعة • اجتماع الأربعاء • تسبحة الخميس';
    }

    return {
        syncKey: cleanKey,
        className: resolvedName,
        serviceName,
        serviceDay,
        serviceDays,
        liturgyDay,
        liturgyDays,
        serviceGroup,
        isServantsRoster,
        customSessions,
        scheduleLabel
    };
};

/**
 * Returns full schedule configuration for any class or service:
 * - serviceDays / serviceDayNums
 * - liturgyDays / liturgyDayNums (supports 0, 1, or multiple liturgy days dynamically!)
 * - shortBadge & scheduleBadge
 * - quickDayPills
 */
export const getClassScheduleConfig = (osraOrSyncKey = '', className = '', explicitAppSettings = null) => {
    const info = resolveClassInfo(osraOrSyncKey, className, explicitAppSettings);
    const norm = normalizeArabicText(`${info.syncKey} ${info.className} ${info.serviceName} ${info.serviceGroup}`);

    let serviceDayNums = normalizeScheduleDaysList(info.serviceDays);
    if (serviceDayNums.length === 0 && info.serviceDay !== null && info.serviceDay !== undefined) {
        const single = parseDayTokenToNum(info.serviceDay);
        if (single !== null) serviceDayNums = [single];
    }

    const isServantsGeneral =
        norm.includes('اجتماع الخدام') ||
        norm.includes('الخدام العام') ||
        norm.includes('wednesday');

    const isSundaySchoolServants =
        norm.includes('خدام مدارس الاحد') ||
        info.isServantsRoster === true;

    const isUniversityOrYouth =
        norm.includes('جامعه') ||
        norm.includes('شباب') ||
        norm.includes('خريجين') ||
        norm.includes('youth') ||
        norm.includes('monday');

    const isSecondary =
        norm.includes('ثانوي') ||
        norm.includes('secondary');

    const isPrep =
        norm.includes('اعدادي') ||
        norm.includes('prep');

    const isPrimaryOrKg =
        norm.includes('مدارس الاحد') ||
        norm.includes('ابتدائي') ||
        norm.includes('كي جي') ||
        norm.includes('كيجي') ||
        norm.includes('kg') ||
        norm.includes('حضانه') ||
        norm.includes('ملائكه') ||
        norm.includes('تمهيدي') ||
        norm.includes('اولي') ||
        norm.includes('ثانيه') ||
        norm.includes('تانيه') ||
        norm.includes('ثالثه') ||
        norm.includes('تالته') ||
        norm.includes('رابعه') ||
        norm.includes('خامسه') ||
        norm.includes('سادسه') ||
        norm.includes('ساته') ||
        norm.includes('primary');

    if (serviceDayNums.length === 0) {
        if (isServantsGeneral && !isSundaySchoolServants) {
            serviceDayNums = [3]; // Wednesday
        } else if (isSundaySchoolServants || isPrimaryOrKg) {
            serviceDayNums = [0, 4]; // Sunday & Thursday
        } else if (isSecondary) {
            serviceDayNums = [4]; // Thursday
        } else if (isUniversityOrYouth) {
            serviceDayNums = [1]; // Monday
        } else if (isPrep) {
            serviceDayNums = [5]; // Friday
        } else if (norm.includes('خميس') || norm.includes('thursday')) {
            serviceDayNums = [4];
        } else if (norm.includes('اثنين') || norm.includes('monday')) {
            serviceDayNums = [1];
        } else if (norm.includes('اربعاء') || norm.includes('wednesday')) {
            serviceDayNums = [3];
        } else {
            serviceDayNums = [5]; // Default Friday
        }
    }

    // Dynamic Liturgy Days: explicit `info.liturgyDays` array (including [] to disable!) takes priority
    let liturgyDayNums = [];
    if (Array.isArray(info.liturgyDays)) {
        liturgyDayNums = normalizeScheduleDaysList(info.liturgyDays);
    } else if (info.liturgyDay !== null && info.liturgyDay !== undefined && info.liturgyDay !== '') {
        const singleLit = parseDayTokenToNum(info.liturgyDay);
        liturgyDayNums = singleLit !== null ? [singleLit] : [];
    } else {
        liturgyDayNums = [5]; // Default Friday Liturgy when unconfigured
    }

    const uniqueServiceNums = Array.from(new Set(serviceDayNums));
    const uniqueLiturgyNums = Array.from(new Set(liturgyDayNums));

    const serviceDays = uniqueServiceNums.map(n => DAY_NUM_TO_KEY[n]);
    const liturgyDays = uniqueLiturgyNums.map(n => DAY_NUM_TO_KEY[n]);
    const primaryLiturgyNum = uniqueLiturgyNums.length > 0 ? uniqueLiturgyNums[0] : null;

    const isSundaySchool = (uniqueServiceNums.includes(0) && uniqueServiceNums.includes(4)) || isSundaySchoolServants || isPrimaryOrKg;

    let shortBadge = uniqueServiceNums.map(n => DAY_NUM_TO_ARABIC[n]).join(' و');
    if (uniqueServiceNums.length === 2 && uniqueServiceNums.includes(0) && uniqueServiceNums.includes(4)) {
        shortBadge = 'الأحد والخميس';
    }

    const scheduleBadge = info.scheduleLabel || buildScheduleLabel(serviceDays, (isSundaySchool || Array.isArray(info.liturgyDays) || info.liturgyDay) ? liturgyDays : []);

    let quickDayPills = [];
    if (Array.isArray(info.customSessions) && info.customSessions.length > 0) {
        quickDayPills = info.customSessions
            .map((cs) => {
                const dayNum = parseDayTokenToNum(cs.dayKey ?? cs.dayNum);
                if (dayNum === null) return null;
                const resolvedDayKey = DAY_NUM_TO_KEY[dayNum];
                const resolvedType = String(cs.type || 'service').trim();
                const resolvedId = String(cs.id || cs.key || `${resolvedType}_${resolvedDayKey}`).trim();
                return {
                    id: resolvedId,
                    key: resolvedId,
                    dayKey: resolvedDayKey,
                    dayNum,
                    type: resolvedType,
                    label: String(cs.label || `خدمة ${DAY_NUM_TO_ARABIC[dayNum]}`).trim(),
                    points: Number(cs.points) || (resolvedType === 'liturgy' ? 15 : 10)
                };
            })
            .filter(Boolean);
    } else {
        quickDayPills = uniqueServiceNums.map(n => ({
            id: `service_${DAY_NUM_TO_KEY[n]}`,
            key: DAY_NUM_TO_KEY[n],
            dayKey: DAY_NUM_TO_KEY[n],
            dayNum: n,
            type: 'service',
            label: n === 3 && isServantsGeneral
                ? 'اجتماع الأربعاء'
                : `خدمة ${DAY_NUM_TO_ARABIC[n]}`,
            points: 10
        }));

        uniqueLiturgyNums.forEach((n) => {
            quickDayPills.push({
                id: `liturgy_${DAY_NUM_TO_KEY[n]}`,
                key: `${DAY_NUM_TO_KEY[n]}_liturgy`,
                dayKey: DAY_NUM_TO_KEY[n],
                dayNum: n,
                type: 'liturgy',
                label: `قداس ${DAY_NUM_TO_ARABIC[n]}`,
                points: 15
            });
        });
    }

    return {
        serviceDays,
        serviceDayNums: uniqueServiceNums,
        liturgyDays,
        liturgyDayNums: uniqueLiturgyNums,
        liturgyDay: primaryLiturgyNum !== null ? DAY_NUM_TO_KEY[primaryLiturgyNum] : null,
        liturgyDayNum: primaryLiturgyNum,
        shortBadge,
        scheduleBadge: scheduleBadge || shortBadge,
        quickDayPills,
        customSessions: Array.isArray(info.customSessions) ? info.customSessions : null,
        isMultiDay: uniqueServiceNums.length > 1 || quickDayPills.length > 2,
        isSundaySchool,
        isServantsRoster: isSundaySchoolServants || isServantsGeneral
    };
};

const SESSION_TYPE_ORDER = {
    service: 1,
    service_meeting: 2,
    liturgy: 3,
    tasbeha: 4
};

/**
 * Dynamic Session Resolver for any class:
 * Returns exact session objects within the active Thursday–Wednesday cycle for refDate:
 * { id, type: 'service'|'liturgy'|'service_meeting'|'tasbeha', dayKey, dayNum, label, date: 'YYYY-MM-DD', points }
 */
export const getClassWeeklySessions = (osraOrSyncKey = '', explicitAppSettings = null, refDate = new Date()) => {
    const cfg = getClassScheduleConfig(osraOrSyncKey, '', explicitAppSettings);
    const sessions = cfg.quickDayPills.map((pill) => ({
        id: pill.id,
        key: pill.id,
        type: pill.type,
        dayKey: pill.dayKey,
        dayNum: pill.dayNum,
        label: pill.label,
        date: getDateForDayInServiceWeek(pill.dayNum, refDate),
        points: pill.points
    }));

    // Order chronologically inside Thu..Wed week, with deterministic session-type order on the same date
    return sessions.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        const ordA = SESSION_TYPE_ORDER[a.type] ?? 99;
        const ordB = SESSION_TYPE_ORDER[b.type] ?? 99;
        if (ordA !== ordB) return ordA - ordB;
        return String(a.id).localeCompare(String(b.id));
    });
};

/**
 * Automatically detects whether a class holds a Thursday service.
 */
export const isThursdayServiceClass = (syncKey = '', className = '', explicitAppSettings = null) => {
    const cfg = getClassScheduleConfig(syncKey, className, explicitAppSettings);
    return cfg.serviceDayNums.includes(4);
};

/**
 * Returns { startDate, endDate, startTimestamp, endTimestamp, thursdayDate, fridayDate }
 * spanning Thursday 00:00:00.000 through Wednesday 23:59:59.999 in local time.
 */
export const getServiceWeekRange = (refDate = new Date()) => {
    const d = (refDate instanceof Date) ? new Date(refDate.getTime()) : new Date(refDate);
    const validDate = isNaN(d.getTime()) ? new Date() : d;
    validDate.setHours(12, 0, 0, 0);

    const dayOfWeek = validDate.getDay(); // 0: Sun, 1: Mon, 2: Tue, 3: Wed, 4: Thu, 5: Fri, 6: Sat
    const diffToThursday = (dayOfWeek - 4 + 7) % 7;

    const thursdayDateObj = new Date(validDate);
    thursdayDateObj.setDate(validDate.getDate() - diffToThursday);

    const startDate = getLocalDateString(thursdayDateObj);

    const fridayDateObj = new Date(thursdayDateObj);
    fridayDateObj.setDate(thursdayDateObj.getDate() + 1);
    const fridayDate = getLocalDateString(fridayDateObj);

    const wednesdayDateObj = new Date(thursdayDateObj);
    wednesdayDateObj.setDate(thursdayDateObj.getDate() + 6);
    const endDate = getLocalDateString(wednesdayDateObj);

    const startTimestamp = new Date(`${startDate}T00:00:00.000`).getTime();
    const endTimestamp = new Date(`${endDate}T23:59:59.999`).getTime();

    return {
        startDate,
        endDate,
        startTimestamp,
        endTimestamp,
        thursdayDate: startDate,
        fridayDate
    };
};

/**
 * Resolves the exact YYYY-MM-DD inside the active Thursday–Wednesday cycle
 * for a given weekday name/number (0=Sun..6=Sat).
 */
export const getDateForDayInServiceWeek = (dayKeyOrNum, refDate = new Date()) => {
    const targetNum = parseDayTokenToNum(dayKeyOrNum);
    const { thursdayDate } = getServiceWeekRange(refDate);
    if (targetNum === null) return thursdayDate;
    const offsetFromThu = (targetNum - 4 + 7) % 7;
    const base = new Date(`${thursdayDate}T12:00:00`);
    base.setDate(base.getDate() + offsetFromThu);
    return getLocalDateString(base);
};

/**
 * Smart Default Service Date Resolver for a given class:
 * - If today IS one of the class's service days, defaults to today's YYYY-MM-DD.
 * - Otherwise picks the most recent elapsed service day in this week, or the first scheduled service day in this week.
 */
export const getDefaultServiceDateForClass = (syncKey = '', className = '', now = new Date(), explicitAppSettings = null) => {
    const d = (now instanceof Date) ? new Date(now.getTime()) : new Date(now);
    const validNow = isNaN(d.getTime()) ? new Date() : d;
    const todayStr = getLocalDateString(validNow);
    const cfg = getClassScheduleConfig(syncKey, className, explicitAppSettings);
    const dayNums = cfg.serviceDayNums.length > 0 ? cfg.serviceDayNums : [5];

    if (dayNums.includes(validNow.getDay())) {
        return todayStr;
    }

    const weekDates = dayNums
        .map(num => getDateForDayInServiceWeek(num, validNow))
        .sort();

    const elapsed = weekDates.filter(dateStr => dateStr <= todayStr);
    if (elapsed.length > 0) {
        return elapsed[elapsed.length - 1];
    }
    return weekDates[0];
};

/**
 * Resolves the default active session object from getClassWeeklySessions for initial selection.
 */
export const getDefaultWeeklySessionForClass = (osraOrSyncKey = '', explicitAppSettings = null, now = new Date()) => {
    const sessions = getClassWeeklySessions(osraOrSyncKey, explicitAppSettings, now);
    if (sessions.length === 0) return null;
    const validNow = (now instanceof Date && !isNaN(now.getTime())) ? now : new Date();
    const todayStr = getLocalDateString(validNow);

    // 1. Exact today's service session first, else today's liturgy
    const todayService = sessions.find(s => s.date === todayStr && s.type === 'service');
    if (todayService) return todayService;
    const todayLiturgy = sessions.find(s => s.date === todayStr && s.type === 'liturgy');
    if (todayLiturgy) return todayLiturgy;

    // 2. Otherwise most recent elapsed service session in the active week, or first service session
    const serviceSessions = sessions.filter(s => s.type === 'service');
    const elapsedServices = serviceSessions.filter(s => s.date <= todayStr);
    if (elapsedServices.length > 0) return elapsedServices[elapsedServices.length - 1];
    return serviceSessions[0] || sessions[0];
};

/**
 * Backward-compatible helper returning the active default date for the current class.
 */
export const getCurrentServiceFridayDate = (refDate = new Date(), syncKey = null, className = null) => {
    let activeKey = syncKey;
    let activeName = className;

    if (typeof window !== 'undefined' && window.localStorage) {
        if (!activeKey) {
            const storedClassKey = sessionStorage.getItem('dashboard_activeClassKey');
            const currentKey = readScopedStorage('currentSyncKey');
            activeKey = (storedClassKey && storedClassKey !== 'all') ? storedClassKey : currentKey;
        }
        if (!activeName) {
            activeName = readScopedStorage('assignedOsra') || '';
        }
    }

    return getDefaultServiceDateForClass(activeKey, activeName, refDate);
};

/**
 * Checks whether a given YYYY-MM-DD or timestamp falls within the current Thursday-to-Wednesday week.
 */
export const isWithinCurrentServiceWeek = (dateVal, refDate = new Date()) => {
    if (!dateVal) return false;
    const { startDate, endDate } = getServiceWeekRange(refDate);
    if (typeof dateVal === 'number' || dateVal instanceof Date) {
        const dStr = getLocalDateString(dateVal);
        return dStr >= startDate && dStr <= endDate;
    }
    const dStr = String(dateVal).split('T')[0];
    return dStr >= startDate && dStr <= endDate;
};

/**
 * Calculates elapsed scheduled service dates for any class schedule
 * within [startDateStr, endDateStr] up to todayStr, combined with recorded service dates.
 */
export const getElapsedServiceDatesForClass = (startDateStr, endDateStr, {
    syncKey = '',
    className = '',
    actualServiceDates = [],
    todayStr = getLocalDateString(new Date()),
    appSettings = null
} = {}) => {
    const cfg = getClassScheduleConfig(syncKey, className, appSettings);
    const targetDaysSet = new Set(cfg.serviceDayNums);

    const datesSet = new Set();
    const start = new Date(`${startDateStr}T12:00:00`);
    const end = new Date(`${endDateStr}T12:00:00`);

    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        const cur = new Date(start);
        while (cur <= end) {
            if (targetDaysSet.has(cur.getDay())) {
                const dStr = getLocalDateString(cur);
                if (dStr && dStr <= todayStr) {
                    datesSet.add(dStr);
                }
            }
            cur.setDate(cur.getDate() + 1);
        }
    }

    if (Array.isArray(actualServiceDates)) {
        actualServiceDates.forEach(dStr => {
            if (dStr && dStr >= startDateStr && dStr <= endDateStr && dStr <= todayStr) {
                datesSet.add(dStr);
            }
        });
    }

    return Array.from(datesSet).sort();
};

const COPTIC_MONTHS_AR = [
    'توت',
    'بابه',
    'هاتور',
    'كيهك',
    'طوبة',
    'أمشير',
    'برمهات',
    'برمودة',
    'بشنس',
    'بؤونة',
    'أبيب',
    'مسرى',
    'نسئ'
];

/**
 * Formats a date into a clean Arabic Coptic date string (e.g., '٣ هاتور ١٧٤٣ ش')
 * mapping numeric Coptic months (1..13) directly to explicit Arabic Coptic month names.
 */
export const formatCopticDate = (d = new Date()) => {
    try {
        const target = (typeof d === 'number' || typeof d === 'string') ? new Date(d) : d;
        if (isNaN(target.getTime())) return 'التقويم القبطي';

        const parts = new Intl.DateTimeFormat('en-u-ca-coptic', {
            day: 'numeric',
            month: 'numeric',
            year: 'numeric'
        }).formatToParts(target);

        const dayNum = parseInt(parts.find(p => p.type === 'day')?.value || '', 10);
        const monthNum = parseInt(parts.find(p => p.type === 'month')?.value || '', 10);
        const yearNum = parseInt(parts.find(p => p.type === 'year')?.value || '', 10);

        if (!isNaN(dayNum) && monthNum >= 1 && monthNum <= 13 && !isNaN(yearNum)) {
            const arNumber = new Intl.NumberFormat('ar-EG', { useGrouping: false });
            const monthName = COPTIC_MONTHS_AR[monthNum - 1];
            return `${arNumber.format(dayNum)} ${monthName} ${arNumber.format(yearNum)} ش`;
        }

        let str = new Intl.DateTimeFormat('ar-EG-u-ca-coptic', { day: 'numeric', month: 'long', year: 'numeric' }).format(target);
        const monthsMap = {
            'tout': 'توت', 'thout': 'توت',
            'baba': 'بابه', 'paopi': 'بابه',
            'hathor': 'هاتور', 'hatur': 'هاتور',
            'kiahk': 'كيهك', 'koiak': 'كيهك',
            'tobi': 'طوبة', 'tubah': 'طوبة', 'toubah': 'طوبة',
            'meshir': 'أمشير', 'emshir': 'أمشير',
            'paremhat': 'برمهات', 'baramhat': 'برمهات',
            'paremoude': 'برمودة', 'baramouda': 'برمودة',
            'pashons': 'بشنس', 'bashans': 'بشنس',
            'paoni': 'بؤونة', 'baounah': 'بؤونة',
            'epip': 'أبيب', 'abib': 'أبيب',
            'mesori': 'مسرى', 'mesra': 'مسرى',
            'nasie': 'نسئ', 'pi kogi enavot': 'نسئ'
        };
        Object.keys(monthsMap).forEach(m => {
            str = str.replace(new RegExp(m, 'gi'), monthsMap[m]);
        });
        str = str.replace(/\b(AM|PM|ERA\d*|A\.M\.)\b/gi, '').replace(/[a-zA-Z]/g, '').trim();
        str = str.replace(/\s+/g, ' ');
        return str || 'التقويم القبطي';
    } catch {
        return 'التقويم القبطي';
    }
};
