import { getCanonicalActiveChildren, isAttendanceRecordPresent, isAttendanceRecordExplicitAbsent } from './churchDataEngine';
import { resolveAttendanceChild, timestamp } from './childIdentity';
import { ARABIC_MONTHS, aggregateMonthlyPoints, getMonthKeyFromDate } from './pointsMath';
import { DAY_NUM_TO_ARABIC, isWithinCurrentServiceWeek } from './serviceWeek';
import { formatLastVisitedDate, getVisitationInfo } from './visitationTypes';
import { readScopedStorage } from './tenantConfig';

export const BLANK_CLASS_TEMPLATE_HEADERS = [
    'الاسم',
    'النوع',
    'تليفون المخدوم',
    'تليفون الأب',
    'تليفون الأم',
    'تاريخ الميلاد',
    'المنطقة',
    'العنوان',
    'أب الاعتراف',
    'وظيفة الأب',
    'ملاحظات',
];

const INVALID_TEMPLATE_FILENAME_CHARS = /[\\/:*?"<>|\s]+/g;

export function sanitizeExcelFilenamePart(text = '') {
    return String(text || '')
        .trim()
        .replace(INVALID_TEMPLATE_FILENAME_CHARS, '_')
        .replace(/^_+|_+$/g, '');
}

export function buildBlankClassTemplateSampleRow(osraName = '') {
    const classLabel = String(osraName || '').trim();
    return {
        الاسم: 'مينا جرجس عياد بطرس',
        النوع: 'ولد',
        'تليفون المخدوم': '01200000001',
        'تليفون الأب': '01200000002',
        'تليفون الأم': '01200000003',
        'تاريخ الميلاد': '2015-05-14',
        المنطقة: 'طهنشا',
        العنوان: 'شارع الكنيسة - طهنشا',
        'أب الاعتراف': 'أبونا برسوم',
        'وظيفة الأب': 'مهندس',
        ملاحظات: classLabel ? `صف إرشادي تجريبي لفصل (${classLabel}) - احذفه أو عدله` : 'صف إرشادي تجريبي - احذفه أو عدله',
    };
}

/**
 * Generates standardized blank Excel template filename for a specific class.
 */
export function formatBlankTemplateFilename(osraName = 'الفصل') {
    const cleanName = sanitizeExcelFilenamePart(osraName) || 'الفصل';
    return `تمبليت_بيانات_مخدومين_${cleanName}.xlsx`;
}

/**
 * Generates standardized monthly comprehensive Excel filename:
 * بيانات_وغياب_<Class>_شهر_<ArabicMonth>_<Year>.xlsx
 */
export function formatClassMonthlyExcelFilename(className = 'الفصل', dateInput = new Date()) {
    let targetDate = null;
    if (dateInput instanceof Date) {
        targetDate = dateInput;
    } else if (typeof dateInput === 'string' && /^\d{4}-\d{2}/.test(dateInput.trim())) {
        const [y, m] = dateInput.trim().slice(0, 7).split('-').map(Number);
        targetDate = new Date(y, Math.max(0, (m || 1) - 1), 15);
    } else {
        targetDate = new Date(dateInput);
    }

    const validDate = isNaN(targetDate.getTime()) ? new Date() : targetDate;
    const arabicMonthName = ARABIC_MONTHS[validDate.getMonth()] || String(validDate.getMonth() + 1).padStart(2, '0');
    const year = validDate.getFullYear();
    const cleanClassName = sanitizeExcelFilenamePart(className) || 'الفصل';

    return `بيانات_وغياب_${cleanClassName}_شهر_${arabicMonthName}_${year}.xlsx`;
}

export function parseArabicDateParts(dateString) {
    if (!dateString) return { bMonth: null, bDay: null };
    const str = String(dateString).trim();

    const arabicMonths = {
        'يناير': 1, 'فبراير': 2, 'مارس': 3, 'ابريل': 4, 'إبريل': 4,
        'مايو': 5, 'يونيو': 6, 'يونيه': 6, 'يوليو': 7, 'يوليه': 7,
        'اغسطس': 8, 'أغسطس': 8, 'سبتمبر': 9, 'اكتوبر': 10, 'أكتوبر': 10,
        'نوفمبر': 11, 'ديسمبر': 12
    };

    let bMonth = null;
    let bDay = null;

    for (const [monthName, monthNum] of Object.entries(arabicMonths)) {
        if (str.includes(monthName)) {
            bMonth = monthNum;
            const match = str.match(/\d{1,2}/);
            if (match) bDay = parseInt(match[0], 10);
            break;
        }
    }

    if (!bMonth) {
        const parts = str.split(/[-/]/);
        if (parts.length >= 2) {
            // Handle YYYY-MM-DD cleanly
            if (/^\d{4}$/.test(parts[0])) {
                const m = parseInt(parts[1], 10);
                const d = parseInt(parts[2], 10);
                if (m >= 1 && m <= 12) bMonth = m;
                if (d >= 1 && d <= 31) bDay = d;
            } else {
                const p1 = parseInt(parts[0], 10);
                const p2 = parseInt(parts[1], 10);
                if (p2 >= 1 && p2 <= 12 && p1 >= 1 && p1 <= 31) {
                    bDay = p1;
                    bMonth = p2;
                } else if (p1 >= 1 && p1 <= 12 && p2 >= 1 && p2 <= 31) {
                    bMonth = p1;
                    bDay = p2;
                }
            }
        }
    }

    return { bMonth, bDay };
}

function getArabicDayLabel(dateStr = '') {
    if (!dateStr) return '';
    const d = new Date(`${String(dateStr).split('T')[0]}T12:00:00`);
    if (isNaN(d.getTime())) return '';
    return DAY_NUM_TO_ARABIC[d.getDay()] || '';
}

function normalizeAttendanceType(rawType = '') {
    const t = String(rawType || 'service').trim().toLowerCase();
    if (t === 'visitation' || t.includes('افتقاد')) return 'visitation';
    if (t === 'liturgy' || t.includes('قداس')) return 'liturgy';
    if (t === 'tasbeha' || t.includes('تسبح')) return 'tasbeha';
    return 'service';
}

function getArabicActivityLabel(typeKey = 'service') {
    if (typeKey === 'visitation') return 'افتقاد';
    if (typeKey === 'liturgy') return 'القداس الإلهي';
    if (typeKey === 'tasbeha') return 'التسبحة والألحان';
    return 'اجتماع الخدمة';
}

/**
 * Resolves active target class { syncKey, osraName, serviceName } safely across Admin/Leader/Servant roles.
 */
export function resolveScopedClassTarget({ explicitSyncKey = '', explicitOsraName = '', accessScope = null, appSettings = {} } = {}) {
    const sentinelKeys = new Set(['MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN', 'all']);
    const normalizeKey = (k) => {
        const clean = String(k || '').trim();
        return clean && !sentinelKeys.has(clean) ? clean : '';
    };

    let targetSyncKey = normalizeKey(explicitSyncKey);
    if (!targetSyncKey && accessScope) {
        if (accessScope.isClassServant) {
            targetSyncKey = normalizeKey(accessScope.activeSyncKey || accessScope.primarySyncKey || accessScope.allowedSyncKeys?.[0]);
        } else if (Array.isArray(accessScope.allowedOsras) && accessScope.allowedOsras.length === 1) {
            targetSyncKey = normalizeKey(accessScope.allowedOsras[0].syncKey);
        }
    }
    if (!targetSyncKey && typeof window !== 'undefined' && window.localStorage) {
        const storedKey = normalizeKey(readScopedStorage('currentSyncKey'));
        const sessionKey = normalizeKey(window.sessionStorage?.getItem('dashboard_activeClassKey'));
        targetSyncKey = sessionKey || storedKey;
    }

    let resolvedOsraName = String(explicitOsraName || '').trim();
    let resolvedServiceName = '';
    const services = Array.isArray(appSettings?.services) ? appSettings.services : [];

    if (targetSyncKey) {
        for (const svc of services) {
            const match = (svc.osras || []).find((o) => String(o.syncKey || '').trim() === targetSyncKey);
            if (match) {
                resolvedOsraName = resolvedOsraName || match.name || targetSyncKey;
                resolvedServiceName = svc.name || '';
                break;
            }
        }
    }

    if (!resolvedOsraName && accessScope?.isStageLeader && accessScope.stageName) {
        resolvedOsraName = accessScope.stageName;
    } else if (!resolvedOsraName && accessScope?.isSuperAdmin) {
        resolvedOsraName = appSettings?.khedmaName || 'كافة_فصول_الكنيسة';
    }

    return {
        syncKey: targetSyncKey,
        osraName: resolvedOsraName || 'الفصل',
        serviceName: resolvedServiceName,
    };
}

/**
 * Builds both comprehensive monthly worksheets (summary + chronological detailed attendance log).
 */
export function buildClassExcelExportRows({
    children = [],
    attendance = [],
    pointsLogs = [],
    services = [],
    refDate = new Date(),
    allowedSyncKeys = null,
} = {}) {
    const canonicalData = getCanonicalActiveChildren(children, allowedSyncKeys);
    const activeChildren = [...canonicalData.activeChildren].sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), 'ar')
    );

    const monthKey = getMonthKeyFromDate(refDate);

    // Resolve Osra/Service lookup table by syncKey
    const osraMetaMap = new Map();
    for (const svc of (Array.isArray(services) ? services : [])) {
        for (const o of (svc.osras || [])) {
            const key = String(o.syncKey || '').trim();
            if (key) osraMetaMap.set(key, { osraName: o.name || key, serviceName: svc.name || '' });
        }
    }

    // Deduplicate attendance rows by (canonicalChildId, date, sessionKey || type) keeping newest timestamp
    const dedupedAttendance = new Map();
    for (const rawRow of (attendance || [])) {
        if (!rawRow || !rawRow.date) continue;
        const matched = resolveAttendanceChild(rawRow, canonicalData);
        if (!matched) continue;
        const typeKey = normalizeAttendanceType(rawRow.type);
        const dateStr = String(rawRow.date).split('T')[0];
        const sessionToken = String(rawRow.sessionKey || typeKey).trim();
        const mapKey = `${matched.id}::${dateStr}::${sessionToken}`;
        const prev = dedupedAttendance.get(mapKey);
        if (!prev || timestamp(rawRow.updatedAt) >= timestamp(prev.row.updatedAt)) {
            dedupedAttendance.set(mapKey, { row: rawRow, child: matched, date: dateStr, typeKey });
        }
    }

    const statsByChildId = new Map();
    const sheet2Items = [];

    for (const entry of dedupedAttendance.values()) {
        const { row, child, date, typeKey } = entry;
        if (row.isDeleted || row.status === 'unmarked') continue;

        const cid = String(child.id);
        if (!statsByChildId.has(cid)) {
            statsByChildId.set(cid, {
                monthServiceDates: [],
                monthServiceAbsentDates: [],
                monthLiturgyDates: [],
                totalServiceCount: 0,
                totalServiceAbsentCount: 0,
                totalLiturgyCount: 0,
                weekServicePresentCount: 0,
                weekServiceAbsentCount: 0,
                weekServicePresent: false,
                weekLiturgyPresent: false,
                weekHasAbsent: false,
            });
        }
        const st = statsByChildId.get(cid);
        const isPresent = isAttendanceRecordPresent(row);
        const isExplicitAbsent = !isPresent && isAttendanceRecordExplicitAbsent(row);
        const inMonth = date.startsWith(monthKey);
        const inWeek = isWithinCurrentServiceWeek(date, refDate);

        if (isPresent) {
            if (typeKey === 'liturgy') {
                st.totalLiturgyCount += 1;
                if (inMonth) st.monthLiturgyDates.push(date);
                if (inWeek) st.weekLiturgyPresent = true;
            } else if (typeKey === 'service') {
                st.totalServiceCount += 1;
                if (inMonth) st.monthServiceDates.push(date);
                if (inWeek) {
                    st.weekServicePresent = true;
                    st.weekServicePresentCount += 1;
                }
            }
        } else if (isExplicitAbsent) {
            if (typeKey === 'service') {
                st.totalServiceAbsentCount += 1;
                if (inMonth) st.monthServiceAbsentDates.push(date);
                if (inWeek) {
                    st.weekHasAbsent = true;
                    st.weekServiceAbsentCount += 1;
                }
            } else if (inWeek) {
                st.weekHasAbsent = true;
            }
        }

        const meta = osraMetaMap.get(String(child.syncKey || '').trim());
        sheet2Items.push({
            date,
            childName: child.name || '',
            qrId: child.qrId || child.id || '',
            osraName: meta?.osraName || child.syncKey || 'غير محدد',
            typeKey,
            sessionLabel: String(row.sessionLabel || '').trim(),
            isPresent,
            statusRaw: row.status,
            presentRaw: row.present,
            note: row.visitationNote || row.note || '',
        });
    }

    // Monthly points aggregation (canonical ID resolution)
    const leaderboard = aggregateMonthlyPoints({
        pointsLogs,
        children: activeChildren,
        monthKey,
        syncKeyFilter: Array.isArray(allowedSyncKeys) && allowedSyncKeys.length === 1 ? allowedSyncKeys[0] : 'all',
    });
    const pointsByChildId = new Map(leaderboard.map((item) => [String(item.childId), item.totalPoints || 0]));

    const sheet1Rows = activeChildren.map((child) => {
        const cid = String(child.id);
        const qrCode = child.qrId || cid;
        const meta = osraMetaMap.get(String(child.syncKey || '').trim());
        const st = statsByChildId.get(cid) || {
            monthServiceDates: [],
            monthServiceAbsentDates: [],
            monthLiturgyDates: [],
            totalServiceCount: 0,
            totalServiceAbsentCount: 0,
            totalLiturgyCount: 0,
            weekServicePresentCount: 0,
            weekServiceAbsentCount: 0,
            weekServicePresent: false,
            weekLiturgyPresent: false,
            weekHasAbsent: false,
        };

        let weekStatus = 'لم يُسجَّل';
        if (st.weekServicePresent && st.weekServiceAbsentCount > 0) {
            weekStatus = `حاضر (${st.weekServicePresentCount}) / غائب (${st.weekServiceAbsentCount})`;
        } else if (st.weekServicePresent && st.weekLiturgyPresent) {
            weekStatus = 'حاضر خدمة وقداس';
        } else if (st.weekServicePresent) {
            weekStatus = st.weekServicePresentCount > 1 ? `حاضر خدمة (${st.weekServicePresentCount})` : 'حاضر خدمة';
        } else if (st.weekLiturgyPresent) {
            weekStatus = 'حاضر قداس';
        } else if (st.weekHasAbsent) {
            weekStatus = st.weekServiceAbsentCount > 1 ? `غائب (${st.weekServiceAbsentCount})` : 'غائب';
        }

        const lastVisitedStr = formatLastVisitedDate(child.last_visited);
        const visitationLabel = child.lastVisitationLabel
            || (child.lastVisitationType ? getVisitationInfo(child.lastVisitationType).label : '');
        const visitationSummary = lastVisitedStr
            ? (visitationLabel ? `${lastVisitedStr} (${visitationLabel})` : lastVisitedStr)
            : 'لم يُفتقد';

        const monthDatesMerged = [...new Set([...st.monthServiceDates, ...st.monthLiturgyDates])].sort();

        return {
            'كود المخدوم': cid,
            'كود الـ QR الخاص': qrCode,
            'الاسم بالكامل': child.name || '',
            'النوع': child.gender || '',
            'تاريخ الميلاد': child.birthDate || '',
            'الفصل / الأسرة': meta?.osraName || child.syncKey || 'غير محدد',
            'تليفون الأم': child.motherPhone || '',
            'تليفون الأب': child.fatherPhone || '',
            'تليفون المخدوم': child.childPhone || '',
            'الواتساب للتواصل': child.whatsappTarget === 'father' ? 'الأب' : child.whatsappTarget === 'child' ? 'المخدوم' : 'الأم',
            'المنطقة والعنوان': [child.address, child.detailedAddress].filter(Boolean).join(' - '),
            'أب الاعتراف': child.fatherConfessor || child.confessionFather || '',
            'حضور الخدمة (الشهر الحالي)': st.monthServiceDates.length,
            'غياب الخدمة (الشهر الحالي)': st.monthServiceAbsentDates.length,
            'حضور القداس (الشهر الحالي)': st.monthLiturgyDates.length,
            'إجمالي حضور الخدمة': st.totalServiceCount,
            'إجمالي غياب الخدمة': st.totalServiceAbsentCount,
            'إجمالي حضور القداس': st.totalLiturgyCount,
            'تواريخ الحضور بالشهر الحالي': monthDatesMerged.join('، ') || 'لا يوجد',
            'حالة الأسبوع الحالي': weekStatus,
            'المواظبة المتتالية': child.streak || 0,
            'نقاط الشهر الحالي': pointsByChildId.get(cid) || 0,
            'آخر افتقاد ونوعه': visitationSummary,
            'ملاحظات هامة': child.specialNotes || '',
            'رابط الصورة (Cloudinary)': child.profilePic && !String(child.profilePic).startsWith('data:')
                ? child.profilePic
                : (child.profilePic ? 'صورة محلية (تُرفع مع المزامنة)' : 'لا توجد صورة'),
        };
    });

    sheet2Items.sort((a, b) => {
        const cmpDate = b.date.localeCompare(a.date);
        if (cmpDate !== 0) return cmpDate;
        return String(a.childName).localeCompare(String(b.childName), 'ar');
    });

    const sheet2Rows = sheet2Items.map((item) => ({
        'التاريخ': item.date,
        'اليوم': getArabicDayLabel(item.date),
        'نوع النشاط': item.sessionLabel || getArabicActivityLabel(item.typeKey),
        'كود الـ QR الخاص': item.qrId,
        'اسم المخدوم': item.childName,
        'الفصل / الأسرة': item.osraName,
        'الحالة': item.isPresent
            ? 'حاضر'
            : (item.statusRaw === 'absent' || item.presentRaw === false ? 'غائب' : (item.statusRaw || 'مسجل')),
        'ملاحظات الافتقاد': item.note,
    }));

    return { sheet1Rows, sheet2Rows, activeCount: activeChildren.length, monthKey };
}
