/**
 * Pure Monthly Points & Rewards Math Helpers (Browser & Node-test compatible)
 */

export const POINTS_PRESETS = {
    AUTO_SERVICE: { key: 'attendance', points: 10, reason: 'حضور الخدمة', badge: 'حضور الخدمة (+10)' },
    AUTO_LITURGY: { key: 'liturgy', points: 15, reason: 'حضور القداس', badge: 'حضور القداس (+15)' },
    AUTO_TASBEHA: { key: 'tasbeha', points: 10, reason: 'حضور التسبحة', badge: 'حضور التسبحة (+10)' },
    DISCIPLINE: { key: 'behavior', points: 5, reason: 'التزام وهدوء', label: 'التزام وهدوء (+5)' },
    MEMORIZATION: { key: 'memorization', points: 10, reason: 'حفظ ومشاركة', label: 'حفظ ومشاركة (+10)' },
    EARLY_ARRIVAL: { key: 'early', points: 5, reason: 'حضور مبكر', label: 'حضور مبكر (+5)' },
    CUSTOM_BONUS: { key: 'custom', points: 10, reason: 'نقاط إضافية مخصصة', label: 'نقاط إضافية مخصصة' }
};

export const POINT_CATEGORY_LABELS = {
    attendance: 'حضور الخدمة',
    liturgy: 'حضور القداس',
    tasbeha: 'التسبحة والألحان',
    behavior: 'التزام وهدوء',
    memorization: 'حفظ ومشاركة',
    early: 'حضور مبكر',
    custom: 'مكافآت إضافية',
    bonus: 'مكافآت تشجيعية'
};

export const ARABIC_MONTHS = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

export const getMonthKeyFromDate = (dateInput = new Date()) => {
    if (typeof dateInput === 'string') {
        const clean = dateInput.trim().slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(clean)) return clean;
    }
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    const valid = isNaN(d.getTime()) ? new Date() : d;
    const yyyy = valid.getFullYear();
    const mm = String(valid.getMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
};

export const formatArabicMonthKey = (monthKey = '') => {
    const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return monthKey || 'الشهر الحالي';
    const year = match[1];
    const monthIndex = Number(match[2]) - 1;
    const monthName = ARABIC_MONTHS[monthIndex] || match[2];
    return `${monthName} ${year}`;
};

/**
 * Pure Monthly Points Aggregator
 * Sums active (non-deleted) point logs for the selected monthKey,
 * groups by childId (or alias), and returns a ranked leaderboard array.
 */
export const aggregateMonthlyPoints = ({
    pointsLogs = [],
    children = [],
    monthKey = getMonthKeyFromDate(new Date()),
    syncKeyFilter = 'all'
} = {}) => {
    const activeChildrenMap = new Map();
    for (const child of (children || [])) {
        if (!child || child.isDeleted) continue;
        if (syncKeyFilter && syncKeyFilter !== 'all' && String(child.syncKey || '').trim() !== String(syncKeyFilter).trim()) {
            continue;
        }
        const idStr = String(child.id || '').trim();
        if (!idStr) continue;
        activeChildrenMap.set(idStr, {
            child,
            childId: idStr,
            name: child.name || 'بدون اسم',
            syncKey: child.syncKey || '',
            gender: child.gender || 'ولد',
            profilePic: child.profilePic || '',
            totalPoints: 0,
            logsCount: 0,
            breakdown: {
                attendance: 0,
                liturgy: 0,
                tasbeha: 0,
                behavior: 0,
                memorization: 0,
                early: 0,
                custom: 0
            },
            recentLogs: []
        });
    }

    const seenIds = new Set();
    for (const log of (pointsLogs || [])) {
        if (!log || log.isDeleted) continue;
        const logId = String(log.id || '');
        if (logId && seenIds.has(logId)) continue;
        if (logId) seenIds.add(logId);

        const logMonth = log.monthKey || getMonthKeyFromDate(log.date || log.updatedAt);
        if (monthKey && monthKey !== 'ALL' && logMonth !== monthKey) continue;

        const cid = String(log.childId || '').trim();
        if (!cid) continue;

        let entry = activeChildrenMap.get(cid);
        if (!entry) {
            // Only synthesize entry if syncKeyFilter allows or no child matched
            if (syncKeyFilter && syncKeyFilter !== 'all' && String(log.syncKey || '').trim() !== String(syncKeyFilter).trim()) {
                continue;
            }
            if ((children || []).length > 0 && syncKeyFilter && syncKeyFilter !== 'all') {
                continue;
            }
            entry = {
                child: { id: cid, name: log.childName || 'مخدوم', syncKey: log.syncKey || '' },
                childId: cid,
                name: log.childName || 'مخدوم',
                syncKey: log.syncKey || '',
                gender: 'ولد',
                profilePic: '',
                totalPoints: 0,
                logsCount: 0,
                breakdown: {
                    attendance: 0,
                    liturgy: 0,
                    tasbeha: 0,
                    behavior: 0,
                    memorization: 0,
                    early: 0,
                    custom: 0
                },
                recentLogs: []
            };
            activeChildrenMap.set(cid, entry);
        }

        const pts = Number(log.points) || 0;
        const cat = log.category && entry.breakdown[log.category] !== undefined ? log.category : 'custom';
        entry.totalPoints += pts;
        entry.logsCount += 1;
        entry.breakdown[cat] += pts;
        entry.recentLogs.push(log);
    }

    const list = Array.from(activeChildrenMap.values()).map(item => ({
        ...item,
        recentLogs: item.recentLogs.sort((a, b) => String(b.date || b.updatedAt || '').localeCompare(String(a.date || a.updatedAt || '')))
    }));

    list.sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
        if (b.logsCount !== a.logsCount) return b.logsCount - a.logsCount;
        return String(a.name).localeCompare(String(b.name), 'ar');
    });

    return list.map((row, idx) => ({
        ...row,
        rank: idx + 1
    }));
};
