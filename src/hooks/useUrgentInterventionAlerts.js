import { useEffect, useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { TENANT_CONFIG, getPwaIconUrl,
    readScopedStorage
} from '../utils/tenantConfig';
import { getLocalDateString } from '../utils/serviceWeek';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';

/**
 * Hook to manage Urgent Pastoral Intervention Alerts & PWA App Badges (Requirement #1)
 * 
 * Computes urgent cases (3+ consecutive missed Fridays without recent visitation,
 * or explicit pastoral intervention flags) and updates:
 * 1. Web Badging API (navigator.setAppBadge / clearAppBadge)
 * 2. Document Title with urgent count badge
 * 3. System Push / PWA Notification for Priests & Admins
 */
export function useUrgentInterventionAlerts(activeClassKey = 'all') {
    const currentSyncKey = readScopedStorage('currentSyncKey') || '';
    const scope = resolveUserAccessScope();
    const isPriest = String(scope.roleTitle || '').includes('كاهن');
    const isMaster = scope.isSuperAdmin;
    const isStageAdmin = scope.isStageLeader;
    const allowedClasses = useMemo(() => scope.allowedSyncKeys || [], [scope.allowedSyncKeys]);
    const allowedClassesSig = allowedClasses.join('|');

    const [permission, setPermission] = useState(() => {
        return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied';
    });

    const appSettings = useMemo(() => {
        try {
            return JSON.parse(readScopedStorage('appSettings') || '{}');
        } catch (_e) {
            return {};
        }
    }, []);

    const getOsraName = (syncKey) => {
        if (!syncKey) return '';
        try {
            const services = appSettings.services || [];
            for (const s of services) {
                const found = (s.osras || []).find(o => String(o.syncKey).trim() === String(syncKey).trim());
                if (found) return found.name;
            }
        } catch (_e) {}
        return syncKey;
    };

    const parseDateToMs = (val) => {
        if (!val) return 0;
        if (typeof val === 'number') return val;
        const d = new Date(val);
        const ts = d.getTime();
        return isNaN(ts) ? 0 : ts;
    };

    // Live Query to compute urgent cases reactively
    const urgentCases = useLiveQuery(async () => {
        try {
            const nowTs = Date.now();
            const sevenDaysAgoTs = nowTs - (7 * 24 * 60 * 60 * 1000);
            const twentyOneDaysAgoTs = nowTs - (21 * 24 * 60 * 60 * 1000);

            const explicitClass = activeClassKey && !['all', 'MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN'].includes(activeClassKey)
                ? activeClassKey
                : '';

            // 1. Fetch scoped children
            let kids = [];
            if (scope.isParent || scope.isGuest) {
                return [];
            } else if (isMaster) {
                if (explicitClass) {
                    kids = await db.children.where('syncKey').equals(explicitClass).toArray();
                } else {
                    kids = await db.children.toArray();
                }
            } else if (isStageAdmin) {
                if (explicitClass && allowedClasses.includes(explicitClass)) {
                    kids = await db.children.where('syncKey').equals(explicitClass).toArray();
                } else {
                    if (allowedClasses.length === 0) return [];
                    kids = await db.children.where('syncKey').anyOf(allowedClasses).toArray();
                }
            } else if (scope.activeSyncKey || currentSyncKey) {
                const targetSk = scope.activeSyncKey || currentSyncKey;
                kids = await db.children.where('syncKey').equals(targetSk).toArray();
            }

            // Exclude soft-deleted
            kids = (kids || []).filter(c => !c.isDeleted);

            // Filter out snoozed children
            kids = kids.filter(c => {
                if (c.alertSnoozedUntil && Number(c.alertSnoozedUntil) > nowTs) {
                    return false;
                }
                return true;
            });

            // 2. Fetch attendance for scoped classes
            let attendanceRecords = [];
            if (isMaster) {
                if (explicitClass) {
                    attendanceRecords = await db.attendance.where('syncKey').equals(explicitClass).toArray();
                } else {
                    attendanceRecords = await db.attendance.toArray();
                }
            } else if (isStageAdmin) {
                if (explicitClass && allowedClasses.includes(explicitClass)) {
                    attendanceRecords = await db.attendance.where('syncKey').equals(explicitClass).toArray();
                } else if (allowedClasses.length > 0) {
                    attendanceRecords = await db.attendance.where('syncKey').anyOf(allowedClasses).toArray();
                }
            } else if (scope.activeSyncKey || currentSyncKey) {
                const targetSk = scope.activeSyncKey || currentSyncKey;
                attendanceRecords = await db.attendance.where('syncKey').equals(targetSk).toArray();
            }

            attendanceRecords = (attendanceRecords || []).filter(r => !r.isDeleted);

            // 3. Extract recorded service Fridays per class (syncKey)
            // A class Friday is valid ONLY if there is at least 1 'service' attendance record on that Friday for that syncKey.
            const classServiceFridaysMap = {};
            attendanceRecords.forEach(a => {
                if (a.date && a.type === 'service') {
                    const d = new Date(a.date + 'T12:00:00');
                    if (d.getDay() === 5) {
                        const sk = String(a.syncKey || '');
                        if (sk) {
                            if (!classServiceFridaysMap[sk]) {
                                classServiceFridaysMap[sk] = new Set();
                            }
                            classServiceFridaysMap[sk].add(a.date);
                        }
                    }
                }
            });

            // Convert to sorted arrays descending (most recent recorded service Friday first)
            const sortedClassFridays = {};
            Object.keys(classServiceFridaysMap).forEach(sk => {
                sortedClassFridays[sk] = Array.from(classServiceFridaysMap[sk]).sort().reverse();
            });

            // Build attendance lookup for fast O(1) check: `${childId}_${date}` -> attended
            const childPresentSet = new Set();
            attendanceRecords.forEach(a => {
                if (a.date && a.childId && a.type === 'service' && a.status === 'present') {
                    childPresentSet.add(`${String(a.childId)}_${a.date}`);
                }
            });

            // Build last visitation map from attendance
            const lastVisitationMap = {};
            attendanceRecords.forEach(a => {
                if (a.type === 'visitation' && a.date) {
                    const cid = String(a.childId);
                    const aDateTs = new Date(a.date + 'T12:00:00').getTime();
                    if (!lastVisitationMap[cid] || aDateTs > lastVisitationMap[cid].ts) {
                        lastVisitationMap[cid] = { ts: aDateTs, dateStr: a.date };
                    }
                }
            });

            const cases = [];

            for (const child of kids) {
                // Check recent visitation (in the last 7 days)
                let lastVisitedTs = parseDateToMs(child.last_visited);
                const attVis = lastVisitationMap[String(child.id)];
                if (attVis && attVis.ts > lastVisitedTs) {
                    lastVisitedTs = attVis.ts;
                }
                const hasRecentVisitationIn7Days = lastVisitedTs >= sevenDaysAgoTs;

                // Priority Check 1: Explicit pastoral intervention requested
                if (child.requiresIntervention === true || child.interventionStatus === 'pending') {
                    cases.push({
                        child,
                        id: child.id,
                        name: child.name,
                        syncKey: child.syncKey,
                        osraName: getOsraName(child.syncKey),
                        missedFridaysCount: 3,
                        missedDates: [],
                        lastVisited: lastVisitedTs ? getLocalDateString(lastVisitedTs) : null,
                        phone: child.phone,
                        fatherPhone: child.fatherPhone,
                        motherPhone: child.motherPhone,
                        childPhone: child.childPhone,
                        reason: 'طلب تدخل ورعاية كنسية عاجل',
                        severity: 'critical'
                    });
                    continue;
                }

                // If recently visited in the last 7 days, they don't need urgent priest escalation right now
                if (hasRecentVisitationIn7Days) {
                    continue;
                }

                // Check 2: Consecutive missed Fridays (>= 3 recorded service Fridays for that child's class)
                const classFridays = sortedClassFridays[String(child.syncKey || '')] || [];

                // If the class has fewer than 3 recorded service dates in history, the child cannot have 3 consecutive absences
                if (classFridays.length < 3) {
                    continue;
                }

                const targetFridays = classFridays.slice(0, 3);
                const attendedAny = targetFridays.some(fDate => childPresentSet.has(`${String(child.id)}_${fDate}`));

                if (!attendedAny) {
                    cases.push({
                        child,
                        id: child.id,
                        name: child.name,
                        syncKey: child.syncKey,
                        osraName: getOsraName(child.syncKey),
                        missedFridaysCount: 3,
                        missedDates: targetFridays,
                        lastVisited: lastVisitedTs ? getLocalDateString(lastVisitedTs) : null,
                        phone: child.phone,
                        fatherPhone: child.fatherPhone,
                        motherPhone: child.motherPhone,
                        childPhone: child.childPhone,
                        reason: 'غياب 3 جُمع متتالية دون افتقاد قريب',
                        severity: 'high'
                    });
                }
            }

            return cases;
        } catch (err) {
            console.error("Error computing urgent intervention alerts:", err);
            return [];
        }
    }, [isMaster, isStageAdmin, currentSyncKey, activeClassKey, allowedClassesSig, scope.activeSyncKey, scope.isParent, scope.isGuest]) || [];

    // 1. Web Badging API (`navigator.setAppBadge` / `clearAppBadge`)
    useEffect(() => {
        try {
            if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
                if (urgentCases.length > 0) {
                    navigator.setAppBadge(urgentCases.length).catch(() => {});
                } else if ('clearAppBadge' in navigator) {
                    navigator.clearAppBadge().catch(() => {});
                }
            }
        } catch (_e) {}
    }, [urgentCases.length]);

    // 2. Document Title dynamic badge for Priests & Admins
    useEffect(() => {
        try {
            const baseTitle = TENANT_CONFIG.churchName;
            if (urgentCases.length > 0 && (isMaster || isPriest)) {
                document.title = `(${urgentCases.length} تدخل عاجل) ${baseTitle}`;
            } else {
                document.title = baseTitle;
            }
        } catch (_e) {}
    }, [urgentCases.length, isMaster, isPriest]);

    // 3. Native ServiceWorker Notification once per session for Priests & Admins
    useEffect(() => {
        if (urgentCases.length === 0) return;
        if (!isMaster && !isPriest) return;
        if (typeof window === 'undefined' || !('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;

        const sessionKey = `notified_urgent_session_${new Date().toISOString().split('T')[0]}`;
        const alreadyNotified = sessionStorage.getItem(sessionKey);

        if (!alreadyNotified) {
            try {
                if (navigator.serviceWorker && 'ready' in navigator.serviceWorker) {
                    navigator.serviceWorker.ready.then(registration => {
                        registration.showNotification('تنبيه تدخل عاجل للآباء الكهنة', {
                            body: `يوجد ${urgentCases.length} مخدومين بحاجة لتدخل ورعاية عاجلة هذا الأسبوع.`,
                            icon: getPwaIconUrl(),
                            badge: getPwaIconUrl(),
                            tag: 'urgent-pastoral-intervention'
                        });
                        sessionStorage.setItem(sessionKey, 'true');
                    }).catch(() => {
                        new Notification('تنبيه تدخل عاجل للآباء الكهنة', {
                            body: `يوجد ${urgentCases.length} مخدومين بحاجة لتدخل ورعاية عاجلة هذا الأسبوع.`,
                            icon: getPwaIconUrl()
                        });
                        sessionStorage.setItem(sessionKey, 'true');
                    });
                } else {
                    new Notification('تنبيه تدخل عاجل للآباء الكهنة', {
                        body: `يوجد ${urgentCases.length} مخدومين بحاجة لتدخل ورعاية عاجلة هذا الأسبوع.`,
                        icon: getPwaIconUrl()
                    });
                    sessionStorage.setItem(sessionKey, 'true');
                }
            } catch (_e) {}
        }
    }, [urgentCases.length, isMaster, isPriest]);

    // 4. One-click Notification Permission Request
    const requestNotificationPermission = async () => {
        if (typeof window === 'undefined' || !('Notification' in window)) {
            alert('متصفحك لا يدعم نظام الإشعارات.');
            return 'unsupported';
        }
        try {
            const res = await Notification.requestPermission();
            setPermission(res);
            if (res === 'granted' && urgentCases.length > 0) {
                if (navigator.serviceWorker && 'ready' in navigator.serviceWorker) {
                    navigator.serviceWorker.ready.then(reg => {
                        reg.showNotification('تم تفعيل إشعارات التدخل العاجل بنجاح', {
                            body: `سيصلك إشعار فوري عند وجود مخدومين يحتاجون لتدخل ورعاية كهنوتية عاجلة.`,
                            icon: getPwaIconUrl(),
                            badge: getPwaIconUrl()
                        });
                    });
                }
            }
            return res;
        } catch (err) {
            console.error("Error requesting notification permission:", err);
            return 'denied';
        }
    };

    return {
        urgentCases,
        urgentCount: urgentCases.length,
        hasUrgentCases: urgentCases.length > 0,
        permission,
        requestNotificationPermission,
        isPriest,
        isMaster
    };
}
