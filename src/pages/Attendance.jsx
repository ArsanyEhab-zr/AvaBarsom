import { attendanceIdentity, resolveAttendanceChild } from '../utils/childIdentity';
/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable no-unused-vars */
import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { Search, Church, BookOpen, CheckCheck, X, MessageCircleWarning, History, UserMinus, UserCheck, Calendar, Trophy, Sparkles, Plus, BarChart3, User, Music, CheckCircle2, XCircle, Circle, Lock } from 'lucide-react';
import useAutoSync from '../hooks/useAutoSync';
import BottomNav from '../components/BottomNav';
import AttendanceDetailedReportModal from '../components/AttendanceDetailedReportModal';
import { logActivity } from '../utils/activityLogger';
import {
    getDefaultServiceDateForClass,
    getClassScheduleConfig,
    getClassWeeklySessions,
    getDefaultWeeklySessionForClass,
    getServiceWeekRange,
    getDateForDayInServiceWeek,
    resolveClassInfo,
    getLocalDateString
} from '../utils/serviceWeek';
import {
    buildCanonicalAttendancePayload,
    pushAttendanceRecordToCloud,
    resolveSessionMetaForDate,
    formatSessionShortDateAr
} from '../utils/attendanceSessionHelper';
import { isAttendanceRecordPresent } from '../utils/churchDataEngine';
import {
    syncAttendancePoints,
    awardPointsToChild,
    getMonthKeyFromDate,
    aggregateMonthlyPoints,
    POINTS_PRESETS
} from '../utils/pointsEngine';
import { useChurchDataEngine } from '../hooks/useChurchDataEngine';
import { getImpersonatedOsra, resolveUserAccessScope } from '../utils/notificationScopeEngine';
import { readScopedStorage } from '../utils/tenantConfig';

export default function Attendance() {
    const { triggerAutoSync } = useAutoSync();
    const location = useLocation();
    const navigate = useNavigate();
    const passedDate = location.state?.preselectedDate;

    const [activeFilter, setActiveFilter] = useState(sessionStorage.getItem('attendance_filter') || "all");
    const [searchQuery, setSearchQuery] = useState(sessionStorage.getItem('attendance_search') || "");
    const [detailedReportModal, setDetailedReportModal] = useState({ isOpen: false, tab: 'service', subFilter: 'all' });

    // Sync state with sessionStorage
    useEffect(() => sessionStorage.setItem('attendance_filter', activeFilter), [activeFilter]);
    useEffect(() => sessionStorage.setItem('attendance_search', searchQuery), [searchQuery]);

    // Resolve active class syncKey & className (strictly enforced by 4-tier RBAC scope)
    const accessScope = resolveUserAccessScope(null, [], { includeFallback: true });
    const impersonatedOsra = accessScope.impersonatedOsra || getImpersonatedOsra();
    const currentSyncKey = String(accessScope.activeSyncKey || impersonatedOsra?.syncKey || readScopedStorage('currentSyncKey') || '').trim();
    const isMaster = accessScope.canSwitchClasses;
    const dashboardActiveClass = sessionStorage.getItem('dashboard_activeClassKey') || 'all';
    const allowedSet = new Set(accessScope.allowedSyncKeys || []);
    const activeSyncKey = impersonatedOsra?.syncKey
        ? impersonatedOsra.syncKey
        : (isMaster
            ? (dashboardActiveClass && dashboardActiveClass !== 'all' && allowedSet.has(dashboardActiveClass)
                ? dashboardActiveClass
                : (accessScope.allowedSyncKeys?.[0] || ''))
            : (accessScope.activeSyncKey || currentSyncKey));

    const classInfo = useMemo(() => resolveClassInfo(activeSyncKey), [activeSyncKey]);
    const activeClassName = impersonatedOsra?.name || classInfo.className || readScopedStorage('assignedOsra') || '';
    const scheduleConfig = useMemo(
        () => getClassScheduleConfig(activeSyncKey, activeClassName),
        [activeSyncKey, activeClassName]
    );
    const defaultSession = useMemo(
        () => getDefaultWeeklySessionForClass({ syncKey: activeSyncKey, name: activeClassName }),
        [activeSyncKey, activeClassName]
    );
    const [pointsToast, setPointsToast] = useState(null);
    const [activeRewardMode, setActiveRewardMode] = useState(() => sessionStorage.getItem('attendance_reward_mode') || 'attendance');

    const showPointsToast = (text) => {
        setPointsToast(text);
        setTimeout(() => {
            setPointsToast((cur) => (cur === text ? null : cur));
        }, 2200);
    };

    // Smart default service date
    const targetDate = useMemo(() => {
        return defaultSession?.date || getDefaultServiceDateForClass(activeSyncKey, activeClassName);
    }, [defaultSession, activeSyncKey, activeClassName]);

    const [hasManualDate, setHasManualDate] = useState(() => Boolean(passedDate));
    const [selectedDate, setSelectedDate] = useState(() => {
        if (passedDate) return passedDate;
        const savedManualKey = sessionStorage.getItem('attendance_manual_syncKey');
        const savedManualDate = sessionStorage.getItem('attendance_manual_date');
        if (savedManualKey === activeSyncKey && savedManualDate) {
            return savedManualDate;
        }
        return defaultSession?.date || getDefaultServiceDateForClass(activeSyncKey, activeClassName);
    });
    const [selectedSessionKey, setSelectedSessionKey] = useState(() => defaultSession?.id || '');

    const weeklySessions = useMemo(
        () => getClassWeeklySessions({ syncKey: activeSyncKey, name: activeClassName }, null, selectedDate ? new Date(`${selectedDate}T12:00:00`) : new Date()),
        [activeSyncKey, activeClassName, selectedDate]
    );
    const activeWeekRange = useMemo(
        () => getServiceWeekRange(selectedDate ? new Date(`${selectedDate}T12:00:00`) : new Date()),
        [selectedDate]
    );
    const weekAttendanceRecords = useLiveQuery(
        () => db.attendance.where('date').between(activeWeekRange.startDate, activeWeekRange.endDate, true, true).toArray(),
        [activeWeekRange.startDate, activeWeekRange.endDate]
    ) || [];

    // If user switches classes and hasn't manually picked a custom date for the new class, update to that class's default service date
    useEffect(() => {
        if (passedDate) return;
        const savedManualKey = sessionStorage.getItem('attendance_manual_syncKey');
        if (!hasManualDate || savedManualKey !== activeSyncKey) {
            const nextDef = getDefaultWeeklySessionForClass({ syncKey: activeSyncKey, name: activeClassName });
            setSelectedDate(nextDef?.date || getDefaultServiceDateForClass(activeSyncKey, activeClassName));
            if (nextDef?.id) setSelectedSessionKey(nextDef.id);
            setHasManualDate(false);
        }
    }, [activeSyncKey, activeClassName, passedDate, hasManualDate]);

    useEffect(() => {
        sessionStorage.setItem('attendance_date', selectedDate);
    }, [selectedDate]);

    const handleDateChange = (e) => {
        const val = e.target.value;
        if (!val) return;
        setHasManualDate(true);
        setSelectedDate(val);
        sessionStorage.setItem('attendance_manual_syncKey', activeSyncKey);
        sessionStorage.setItem('attendance_manual_date', val);
    };

    const handlePreviousWeek = () => {
        const d = new Date(`${selectedDate}T12:00:00`);
        if (!isNaN(d.getTime())) {
            d.setDate(d.getDate() - 7);
            const prevStr = getLocalDateString(d);
            setHasManualDate(true);
            setSelectedDate(prevStr);
            sessionStorage.setItem('attendance_manual_syncKey', activeSyncKey);
            sessionStorage.setItem('attendance_manual_date', prevStr);
        }
    };

    const handleResetToCurrentWeek = () => {
        const defDate = getDefaultServiceDateForClass(activeSyncKey, activeClassName);
        setHasManualDate(false);
        setSelectedDate(defDate);
        sessionStorage.removeItem('attendance_manual_syncKey');
        sessionStorage.removeItem('attendance_manual_date');
    };

    // Single Source of Truth Engine for children & selectedDate attendance
    const {
        activeChildren: canonicalChildren,
        validatedAttendance, canonicalData
    } = useChurchDataEngine(activeSyncKey, {
        exactDate: selectedDate,
        targetSyncKey: activeSyncKey
    });

    // Raw attendance records for selectedDate to display exact button states (present / absent / excused)
    const attendanceRecords = useLiveQuery(
        () => db.attendance.where('date').equals(selectedDate).toArray(),
        [selectedDate]
    );

    const activeMonthKey = useMemo(() => getMonthKeyFromDate(selectedDate), [selectedDate]);
    const monthlyPointsLogs = useLiveQuery(
        () => db.pointsLogs.where('monthKey').equals(activeMonthKey).toArray(),
        [activeMonthKey]
    ) || [];

    const monthlyPointsByChildId = useMemo(() => {
        const ranked = aggregateMonthlyPoints({
            pointsLogs: monthlyPointsLogs,
            children: canonicalChildren,
            monthKey: activeMonthKey
        });
        const map = new Map();
        ranked.forEach((row) => map.set(String(row.childId), row.totalPoints));
        return map;
    }, [monthlyPointsLogs, canonicalChildren, activeMonthKey]);

    const handleQuickDayPill = (pill) => {
        const snappedDate = pill.date || getDateForDayInServiceWeek(pill.dayNum, new Date(`${selectedDate}T12:00:00`));
        setHasManualDate(true);
        setSelectedDate(snappedDate);
        if (pill.id) setSelectedSessionKey(pill.id);
        sessionStorage.setItem('attendance_manual_syncKey', activeSyncKey);
        sessionStorage.setItem('attendance_manual_date', snappedDate);
    };

    const sessionPresentCounts = useMemo(() => {
        const counts = new Map();
        weeklySessions.forEach(s => counts.set(s.id, new Set()));
        for (const r of weekAttendanceRecords) {
            if (!r || !isAttendanceRecordPresent(r)) continue;
            const child = resolveAttendanceChild(r, canonicalData);
            if (!child) continue;
            const rDate = String(r.date || '').split('T')[0];
            for (const sess of weeklySessions) {
                const matchesSession = r.sessionKey
                    ? r.sessionKey === sess.id
                    : r.type === sess.type;
                if (rDate === sess.date && matchesSession) {
                    counts.get(sess.id)?.add(String(child.id));
                }
            }
        }
        const result = new Map();
        counts.forEach((set, k) => result.set(k, set.size));
        return result;
    }, [weeklySessions, weekAttendanceRecords, canonicalData]);

    const handleQuickBonusPoints = async (child, preset) => {
        try {
            await awardPointsToChild({
                child,
                points: preset.points,
                category: preset.key,
                reason: preset.reason,
                date: selectedDate
            });
            showPointsToast(`+${preset.points} نقطة (${preset.reason}) لـ ${child.name}`);
            triggerAutoSync();
        } catch (err) {
            alert('تعذر تسجيل النقاط: ' + err.message);
        }
    };

    const handleCustomBonusPoints = async (child) => {
        const rawPts = prompt(`أدخل عدد النقاط الإضافية للمخدوم (${child.name}):`, '10');
        if (rawPts === null) return;
        const pts = Number(rawPts);
        if (!Number.isFinite(pts) || pts <= 0) return;
        const reason = prompt('سبب المكافأة (اختياري):', 'تميز ومشاركة إضافية') || 'نقاط إضافية مخصصة';
        try {
            await awardPointsToChild({
                child,
                points: pts,
                category: 'custom',
                reason,
                date: selectedDate
            });
            showPointsToast(`+${pts} نقطة لـ ${child.name}`);
            triggerAutoSync();
        } catch (err) {
            alert('تعذر تسجيل النقاط: ' + err.message);
        }
    };

    const activeSelectedSession = useMemo(() => {
        if (!weeklySessions.length) return null;
        return (
            weeklySessions.find((s) => s.id === selectedSessionKey && s.date === selectedDate) ||
            weeklySessions.find((s) => s.date === selectedDate) ||
            null
        );
    }, [weeklySessions, selectedSessionKey, selectedDate]);

    const statusByChildAndType = useMemo(() => {
        const map = new Map();
        const putLatest = (key, r) => {
            const existing = map.get(key);
            if (!existing) {
                map.set(key, r);
            } else {
                const t1 = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
                const t2 = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
                if (t2 >= t1) map.set(key, r);
            }
        };
        for (const r of (attendanceRecords || [])) {
            if (!r || !r.type) continue;
            const resolvedChild = resolveAttendanceChild(r, canonicalData);
            if (!resolvedChild) continue;
            const cid = String(resolvedChild.id);
            putLatest(`${cid}::${r.type}`, r);
            if (r.sessionKey) {
                putLatest(`${cid}::session::${r.sessionKey}`, r);
            }
        }
        return map;
    }, [attendanceRecords, canonicalData]);

    const getAttendanceStatus = (childId, type, explicitSessionId = '') => {
        const cleanId = String(childId).trim();
        let record = null;
        if (explicitSessionId) {
            record = statusByChildAndType.get(`${cleanId}::session::${explicitSessionId}`) || null;
        }
        if (!record) {
            record = statusByChildAndType.get(`${cleanId}::${type}`) || null;
        }
        if (!record || record.isDeleted || record.status === 'unmarked') return null;
        if (record.present === false || record.attended === false || record.status === 'absent') return 'absent';
        if (record.status === 'excused') return 'excused';
        return record.status || 'present';
    };

    const children = useMemo(() => {
        if (!canonicalChildren) return [];
        if (!searchQuery.trim()) return canonicalChildren;
        const q = searchQuery.toLowerCase();
        return canonicalChildren.filter(c => c.name?.toLowerCase().includes(q));
    }, [canonicalChildren, searchQuery]);

    const filteredChildren = useMemo(() => {
        return children.filter((c) => {
            if (activeFilter === "boys" && c.gender === "بنت") return false;
            if (activeFilter === "girls" && c.gender !== "بنت") return false;
            return true;
        });
    }, [children, activeFilter]);

    const filteredChildIdSet = useMemo(
        () => new Set(filteredChildren.map(c => String(c.id).trim())),
        [filteredChildren]
    );

    const activeSessionType = activeSelectedSession?.type || 'service';
    const activeSessionId = activeSelectedSession?.id || '';
    const activeSessionLabel = activeSelectedSession?.label || (
        activeSessionType === 'liturgy'
            ? 'القداس'
            : (activeSessionType === 'tasbeha'
                ? 'التسبحة'
                : (activeSessionType === 'service_meeting' ? 'اجتماع الخدمة' : 'الخدمة'))
    );

    // 3-state neutral counters for the active session (present | absent | unmarked)
    const activeSessionCounts = useMemo(() => {
        let present = 0;
        let absent = 0;
        let unmarked = 0;
        for (const c of filteredChildren) {
            const st = getAttendanceStatus(c.id, activeSessionType, activeSessionId);
            if (st === 'present') present += 1;
            else if (st === 'absent') absent += 1;
            else unmarked += 1;
        }
        return { present, absent, unmarked };
    }, [filteredChildren, statusByChildAndType, activeSessionType, activeSessionId]);

    const [isClosingAbsence, setIsClosingAbsence] = useState(false);

    // Strictly validated present & explicit-absent counts for the displayed children
    const liturgyCount = useMemo(() => {
        return validatedAttendance.whoAttendedLiturgyList.filter(c =>
            filteredChildIdSet.has(String(c.id).trim())
        ).length;
    }, [validatedAttendance.whoAttendedLiturgyList, filteredChildIdSet]);

    const serviceCount = useMemo(() => {
        return validatedAttendance.whoAttendedServiceList.filter(c =>
            filteredChildIdSet.has(String(c.id).trim())
        ).length;
    }, [validatedAttendance.whoAttendedServiceList, filteredChildIdSet]);

    const serviceExplicitAbsentCount = useMemo(() => {
        return validatedAttendance.whoAbsentServiceList.filter(c =>
            filteredChildIdSet.has(String(c.id).trim())
        ).length;
    }, [validatedAttendance.whoAbsentServiceList, filteredChildIdSet]);

    const openDetailedReport = (tab = 'service', subFilter = 'all') => {
        setDetailedReportModal({ isOpen: true, tab, subFilter });
    };

    const setAttendanceStatus = async (child, type, status, explicitSessionOverride = null) => {
        try {
            const nowIso = new Date().toISOString();
            const nowMs = Date.now();
            const currentKey = String(readScopedStorage('currentSyncKey') || '').trim();
            const targetSyncKey = String(
                child.syncKey ||
                (activeSyncKey !== 'MASTER_ACCESS' && activeSyncKey !== 'ADMIN_MODE' && activeSyncKey !== 'STAGE_ADMIN' ? activeSyncKey : '') ||
                currentKey
            ).trim();

            const activeExplicitSess =
                explicitSessionOverride ||
                weeklySessions.find(s => s.id === selectedSessionKey && s.date === selectedDate && s.type === type) ||
                weeklySessions.find(s => s.date === selectedDate && s.type === type) ||
                null;
            const sessionMeta = resolveSessionMetaForDate({
                syncKey: targetSyncKey,
                className: activeClassName,
                date: selectedDate,
                type,
                explicitSession: activeExplicitSess
            });

            // Fetch all records for selectedDate to deduplicate per non-colliding sessionKey (e.g. Thursday Service vs Thursday Tasbeha)
            const recordsForDate = await db.attendance.where('date').equals(selectedDate).toArray();
            const childRecordsForDate = recordsForDate.filter(a => resolveAttendanceChild(a, canonicalData)?.id === child.id);
            const sameTypeRecords = childRecordsForDate.filter(a =>
                a.sessionKey ? a.sessionKey === sessionMeta.sessionKey : a.type === type
            );

            // Clean up any duplicate rows in db.attendance for the same (date, childId, sessionKey)
            const activeSameType = sameTypeRecords.filter(r => !r.isDeleted);
            const primaryRecord = activeSameType[0] || sameTypeRecords[0] || null;
            const duplicateIds = sameTypeRecords
                .filter(r => primaryRecord && r.id !== primaryRecord.id && r.id != null)
                .map(r => r.id);

            if (duplicateIds.length > 0) {
                await db.attendance.bulkDelete(duplicateIds);
            }

            const otherActiveRecords = childRecordsForDate.filter(r =>
                (r.sessionKey ? r.sessionKey !== sessionMeta.sessionKey : r.type !== type) &&
                !r.isDeleted &&
                r.status === 'present'
            );
            const updates = { isDirty: true, updatedAt: nowIso };
            const canonicalPayload = buildCanonicalAttendancePayload({
                child,
                date: selectedDate,
                type,
                status,
                syncKey: targetSyncKey,
                sessionKey: sessionMeta.sessionKey,
                sessionLabel: sessionMeta.sessionLabel
            });

            if (primaryRecord && !primaryRecord.isDeleted) {
                if (primaryRecord.status === status) {
                    // Clicking the same active status toggles it off (soft-delete for cloud sync)
                    const tombstonePatch = {
                        ...canonicalPayload,
                        status: primaryRecord.status,
                        isDeleted: true,
                        isDirty: true,
                        updatedAt: nowIso,
                        updatedAtMs: nowMs
                    };
                    await db.attendance.update(primaryRecord.id, tombstonePatch);
                    void pushAttendanceRecordToCloud(tombstonePatch, primaryRecord.id);
                    if (status === 'present') {
                        const field = type === 'liturgy' ? 'last_liturgy' : 'last_service';
                        if (child[field] === selectedDate) updates[field] = null;
                        if (otherActiveRecords.length === 0) {
                            updates.streak = Math.max((child.streak || 0) - 1, 0);
                        }
                        await syncAttendancePoints({ child, type, sessionKey: sessionMeta.sessionKey, date: selectedDate, isPresent: false });
                    }
                } else {
                    // Update existing record to the new status
                    await db.attendance.update(primaryRecord.id, canonicalPayload);
                    void pushAttendanceRecordToCloud(canonicalPayload, primaryRecord.id);
                    if (status === 'present') {
                        const field = type === 'liturgy' ? 'last_liturgy' : 'last_service';
                        if (!child[field] || selectedDate >= child[field]) updates[field] = selectedDate;
                        await syncAttendancePoints({ child, type, sessionKey: sessionMeta.sessionKey, date: selectedDate, isPresent: true });
                        showPointsToast(`+${type === 'liturgy' ? 15 : 10} نقطة تلقائية لـ ${child.name}`);
                    } else {
                        await syncAttendancePoints({ child, type, sessionKey: sessionMeta.sessionKey, date: selectedDate, isPresent: false });
                    }
                }
            } else if (primaryRecord && primaryRecord.isDeleted) {
                // Revive previously soft-deleted record for the same (date, childId, sessionKey) to avoid duplicate rows
                await db.attendance.update(primaryRecord.id, canonicalPayload);
                void pushAttendanceRecordToCloud(canonicalPayload, primaryRecord.id);
                if (status === 'present') {
                    const field = type === 'liturgy' ? 'last_liturgy' : 'last_service';
                    if (!child[field] || selectedDate >= child[field]) updates[field] = selectedDate;
                    if (otherActiveRecords.length === 0) updates.streak = (child.streak || 0) + 1;
                    await syncAttendancePoints({ child, type, sessionKey: sessionMeta.sessionKey, date: selectedDate, isPresent: true });
                    showPointsToast(`+${type === 'liturgy' ? 15 : 10} نقطة تلقائية لـ ${child.name}`);
                }
            } else {
                // Insert a single clean canonical attendance record for this (date, childId, sessionKey)
                const insertedId = await db.attendance.add(canonicalPayload);
                void pushAttendanceRecordToCloud(canonicalPayload, insertedId);

                if (status === 'present') {
                    const field = type === 'liturgy' ? 'last_liturgy' : 'last_service';
                    if (!child[field] || selectedDate >= child[field]) updates[field] = selectedDate;
                    if (otherActiveRecords.length === 0) updates.streak = (child.streak || 0) + 1;
                    await syncAttendancePoints({ child, type, sessionKey: sessionMeta.sessionKey, date: selectedDate, isPresent: true });
                    showPointsToast(`+${type === 'liturgy' ? 15 : 10} نقطة تلقائية لـ ${child.name}`);
                }
            }

            await db.children.update(child.id, updates);
            triggerAutoSync();

            // Audit Trail: تسجيل تغيير حالة الحضور
            const statusLabels = { present: 'حاضر', absent: 'غائب', excused: 'بعذر' };
            const typeLabels = { liturgy: 'القداس', service: 'الخدمة', service_meeting: 'اجتماع الخدمة', tasbeha: 'التسبحة' };
            logActivity('RECORD_ATTENDANCE', `تسجيل حضور المخدوم: ${child.name || child.id} — ${statusLabels[status] || status} (${sessionMeta.sessionLabel || typeLabels[type] || type}) ليوم ${selectedDate}`);
        } catch (err) {
            alert("عطل في قاعدة البيانات: " + err.message);
        }
    };

    const handleMarkRemainingAbsent = async () => {
        const unmarkedChildren = filteredChildren.filter(
            (c) => getAttendanceStatus(c.id, activeSessionType, activeSessionId) === null
        );
        if (unmarkedChildren.length === 0) {
            showPointsToast('لا يوجد مخدومون غير مسجلين في هذه الجلسة.');
            return;
        }
        const confirmed = window.confirm(
            `هل تريد تأكيد تحديد (${unmarkedChildren.length}) مخدوم غير مسجلين كـ "غائب" في «${activeSessionLabel}» ليوم ${selectedDate}؟`
        );
        if (!confirmed) return;

        setIsClosingAbsence(true);
        try {
            for (const child of unmarkedChildren) {
                await setAttendanceStatus(child, activeSessionType, 'absent', activeSelectedSession);
            }
            showPointsToast(`تم إغلاق الغياب وتحديد ${unmarkedChildren.length} مخدوم كغائب.`);
        } finally {
            setIsClosingAbsence(false);
        }
    };

    const cleanPhoneNumber = (phone) => {
        let clean = String(phone || "").replace(/\D/g, '');
        if (clean.startsWith('0')) clean = '2' + clean;
        else if (!clean.startsWith('20') && clean.length > 0) clean = '20' + clean;
        return clean;
    };

    const getTargetPhone = (child) => {
        if (child.whatsappTarget === 'child' && child.childPhone) return child.childPhone;
        if (child.whatsappTarget === 'father' && child.fatherPhone) return child.fatherPhone;
        if (child.whatsappTarget === 'mother' && child.motherPhone) return child.motherPhone;
        return child.childPhone || child.fatherPhone || child.motherPhone || child.phone;
    };

    const generateMissedServiceMsg = (child) => {
        const title = child.gender === 'بنت' ? 'مخدومتنا' : 'مخدومنا';
        const namePart = child.name ? child.name.split(' ')[0] : 'يا مخدوم';
        let msg = `وحشتنا يا ${title} (${namePart})!\nمجتش ليه يوم ${selectedDate}؟ مكانك كان فاضي، مستنيينك في الكنيسة!`;
        const phone = cleanPhoneNumber(getTargetPhone(child));
        return {
            whatsapp: `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`,
            sms: `sms:${phone}?body=${encodeURIComponent(msg)}`
        };
    };

    const getArabicDateText = (dateString) => {
        try {
            const d = new Date(`${dateString}T12:00:00`);
            const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
            const dayName = days[d.getDay()];
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dayName}، ${dd}/${mm}/${yyyy}`;
        } catch (e) {
            return dateString;
        }
    };

    return (
        <div className="min-h-screen bg-[#FAF7F2] pb-32 font-sans" dir="rtl">
            {pointsToast && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[150] bg-indigo-950 text-amber-300 border border-amber-400/50 px-5 py-3 rounded-2xl shadow-2xl font-black text-sm flex items-center gap-2 animate-in fade-in slide-in-from-top-4">
                    <Sparkles size={18} className="text-amber-400 shrink-0" />
                    <span>{pointsToast}</span>
                </div>
            )}

            <header className="bg-white/95 backdrop-blur-md p-4 sm:p-5 shadow-sm border-b border-amber-200/60 mb-6 rounded-b-4xl">
                <div className="max-w-4xl mx-auto">
                    {/* Class Title + Points Leaderboard Quick Jump */}
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <div className="min-w-0">
                            <h1 className="font-calligraphic text-2xl sm:text-3xl font-bold text-[#1B2A59] leading-tight truncate">
                                {activeClassName || 'تسجيل الحضور والنقاط'}
                            </h1>
                            <p className="text-xs sm:text-sm font-bold text-amber-800 mt-1">
                                موعد الخدمة المعتمد: {scheduleConfig.scheduleBadge}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => navigate('/points')}
                            className="min-h-[44px] bg-gradient-to-l from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-indigo-950 px-4 py-2 rounded-2xl text-xs sm:text-sm font-black shadow-md flex items-center gap-2 cursor-pointer transition-all active:scale-95 shrink-0"
                        >
                            <Trophy size={18} />
                            <span>لوحة النقاط الشهرية</span>
                        </button>
                    </div>

                    {/* Date Warning Banner */}
                    <div className="mb-3 bg-amber-50 border border-amber-300 text-amber-950 p-3.5 rounded-2xl shadow-xs font-black text-sm flex flex-col sm:flex-row items-center justify-between gap-2 text-center">
                        <span className="inline-flex items-center justify-center gap-1.5">
                            <Calendar size={16} className="shrink-0" /> تسجيل الحضور ليوم: {getArabicDateText(selectedDate)}
                        </span>
                        <span className="text-xs bg-amber-200/80 text-amber-950 px-3 py-1 rounded-xl font-black">
                            {scheduleConfig.shortBadge}
                        </span>
                    </div>

                    {/* Dynamic Weekly Multi-Session Switcher Tabs */}
                    <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="اختيار سريع لأيام الخدمة والقداس">
                        {weeklySessions.map((pill) => {
                            const pillDate = pill.date;
                            const isSelectedPill = selectedDate === pillDate && (!selectedSessionKey || selectedSessionKey === pill.id || !weeklySessions.some(s => s.id === selectedSessionKey && s.date === selectedDate));
                            const isLiturgyPill = pill.type === 'liturgy';
                            const sessPresentCount = sessionPresentCounts.get(pill.id) || 0;
                            return (
                                <button
                                    key={pill.id}
                                    type="button"
                                    onClick={() => handleQuickDayPill(pill)}
                                    className={`min-h-[52px] flex-1 min-w-[140px] px-3.5 py-2 rounded-2xl text-xs sm:text-sm font-black border transition-all cursor-pointer active:scale-95 flex flex-col items-center justify-center gap-0.5 ${
                                        isSelectedPill
                                            ? (isLiturgyPill
                                                ? 'bg-[#1B2A59] text-amber-300 border-[#1B2A59] shadow-md'
                                                : 'bg-emerald-700 text-white border-emerald-800 shadow-md')
                                            : 'bg-white text-slate-800 border-slate-200 hover:border-amber-400 hover:bg-amber-50/50'
                                    }`}
                                >
                                    <span className="leading-tight">{pill.label} ({formatSessionShortDateAr(pillDate)})</span>
                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full tabular-nums ${
                                        isSelectedPill
                                            ? 'bg-white/20 text-white'
                                            : 'bg-slate-100 text-slate-600'
                                    }`}>
                                        حضر هذا الأسبوع: {sessPresentCount}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Date Picker UI Wrapper */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4 bg-white p-2.5 rounded-2xl shadow-xs border border-slate-200">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                            <Calendar className="text-[#1B2A59] w-5 h-5 mr-1 shrink-0" />
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={handleDateChange}
                                className="flex-1 min-w-0 w-full min-h-[44px] bg-slate-50 text-slate-800 font-bold py-2 px-3 rounded-xl outline-none border border-slate-200 focus:border-[#1B2A59] focus:bg-white transition-all text-sm"
                            />
                        </div>
                        <div className={`grid gap-2 shrink-0 ${selectedDate !== targetDate ? 'grid-cols-2' : 'grid-cols-1'} sm:flex`}>
                            {selectedDate !== targetDate && (
                                <button
                                    onClick={handleResetToCurrentWeek}
                                    className="min-h-[44px] bg-emerald-50 text-emerald-800 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black hover:bg-emerald-100 transition-all border border-emerald-200 cursor-pointer"
                                >
                                    أسبوع الخدمة الحالي
                                </button>
                            )}
                            <button
                                onClick={handlePreviousWeek}
                                className="min-h-[44px] bg-indigo-50 text-[#1B2A59] px-4 py-2 rounded-xl text-xs sm:text-sm font-black hover:bg-indigo-100 transition-all border border-indigo-200 cursor-pointer"
                            >
                                الأسبوع الماضي
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5 text-center mb-3" role="status">
                        <button
                            type="button"
                            onClick={() => openDetailedReport(activeSessionType === 'liturgy' ? 'liturgy' : 'service', 'present')}
                            className="bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-2xl py-2.5 px-1 transition-all cursor-pointer"
                            title="عرض قائمة من حضر"
                        >
                            <div className="text-base sm:text-lg font-black text-emerald-800 tabular-nums">{activeSessionCounts.present}</div>
                            <div className="text-xs font-bold text-emerald-800">حضر ({activeSessionCounts.present})</div>
                        </button>
                        <button
                            type="button"
                            onClick={() => openDetailedReport(activeSessionType === 'liturgy' ? 'liturgy' : 'service', 'absent')}
                            className="bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-2xl py-2.5 px-1 transition-all cursor-pointer"
                            title="عرض قائمة من سُجل غائباً صراحةً"
                        >
                            <div className="text-base sm:text-lg font-black text-rose-800 tabular-nums">{activeSessionCounts.absent}</div>
                            <div className="text-xs font-bold text-rose-800">غاب ({activeSessionCounts.absent})</div>
                        </button>
                        <button
                            type="button"
                            onClick={() => openDetailedReport('combined', 'all')}
                            className="bg-slate-50 border border-slate-200 hover:border-[#C89B3C] rounded-2xl py-2.5 px-1 transition-all cursor-pointer"
                            title="مخدومون لم يُسجل حضورهم أو غيابهم بعد"
                        >
                            <div className="text-base sm:text-lg font-black text-slate-700 tabular-nums">{activeSessionCounts.unmarked}</div>
                            <div className="text-xs font-bold text-slate-600">لم يُسجل ({activeSessionCounts.unmarked})</div>
                        </button>
                    </div>

                    {/* Explicit optional action to close unmarked children as absent (NEVER runs automatically) */}
                    {activeSessionCounts.unmarked > 0 && (
                        <div className="mb-3">
                            <button
                                type="button"
                                disabled={isClosingAbsence}
                                onClick={handleMarkRemainingAbsent}
                                className="w-full min-h-[44px] px-4 py-2.5 rounded-2xl bg-white hover:bg-rose-50 text-rose-800 border border-rose-300 font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60"
                            >
                                <Lock size={15} className="shrink-0" />
                                <span>
                                    {isClosingAbsence
                                        ? 'جارٍ إغلاق الغياب...'
                                        : `تحديد الباقي كغائب (إغلاق الغياب — ${activeSessionCounts.unmarked} متبقي)`}
                                </span>
                            </button>
                        </div>
                    )}

                    {/* Quick toggle between Attendance Mode vs Bonus Points Focus Mode */}
                    <div className="flex gap-2 mb-3 bg-slate-100 p-1 rounded-2xl">
                        <button
                            type="button"
                            onClick={() => { setActiveRewardMode('attendance'); sessionStorage.setItem('attendance_reward_mode', 'attendance'); }}
                            className={`flex-1 min-h-[44px] rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 ${activeRewardMode === 'attendance' ? 'bg-[#1B2A59] text-white shadow-sm' : 'text-slate-700'}`}
                        >
                            <CheckCircle2 size={15} /> الحضور (+10 / +15)
                        </button>
                        <button
                            type="button"
                            onClick={() => { setActiveRewardMode('rewards'); sessionStorage.setItem('attendance_reward_mode', 'rewards'); }}
                            className={`flex-1 min-h-[44px] rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 ${activeRewardMode === 'rewards' ? 'bg-amber-500 text-indigo-950 shadow-sm' : 'text-slate-700'}`}
                        >
                            <Trophy size={15} /> منح مكافآت سريعة
                        </button>
                    </div>

                    <div className="relative mb-4">
                        <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="ابحث عن مخدوم أو خادم بالاسم..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full min-h-[46px] pr-11 pl-4 py-2.5 rounded-2xl bg-slate-100 text-sm sm:text-base font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1B2A59]/30"
                        />
                    </div>
                    <div className="flex gap-2 justify-center">
                        {[{ id: "all", label: `الكل (${children.length})` }, { id: "boys", label: "ولاد / خدام" }, { id: "girls", label: "بنات / خادمات" }].map(f => (
                            <button
                                key={f.id}
                                onClick={() => setActiveFilter(f.id)}
                                aria-label={`تصفية حسب ${f.label}`}
                                className={`flex-1 min-h-[44px] px-3 py-2 rounded-2xl text-xs sm:text-sm font-black transition-all cursor-pointer ${activeFilter === f.id ? "bg-[#1B2A59] text-white shadow-md" : "bg-slate-100 text-slate-700"}`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <main className="px-4 max-w-4xl mx-auto">
                <div className="coptic-card border border-[#DFC48F] p-4 rounded-3xl mb-6 shadow-sm flex flex-col gap-3.5">
                    <div className="flex flex-wrap justify-between items-center gap-2 px-1">
                        <h3 className="text-sm sm:text-base font-black text-[#1B2A59] flex items-center gap-2">
                            <History size={18} className="text-[#8C621E]" /> تقارير الحضور والغياب ({selectedDate})
                        </h3>
                        <span className="text-xs sm:text-sm font-black text-[#6E5329] tabular-nums">
                            الإجمالي: {filteredChildren.length}
                        </span>
                    </div>

                    <button
                        type="button"
                        onClick={() => openDetailedReport('combined', 'all')}
                        className="w-full min-h-[48px] px-4 py-3 rounded-2xl bg-gradient-to-l from-[#1B2A59] to-[#253A7A] hover:from-[#142044] hover:to-[#1B2A59] text-amber-100 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md border border-amber-400/35 active:scale-[0.99] transition-all cursor-pointer"
                    >
                        <BarChart3 size={18} className="text-amber-300 shrink-0" />
                        <span>عرض تقرير من حضر ومن غاب (الخدمة والقداس)</span>
                    </button>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full">
                        <button onClick={() => openDetailedReport('service', 'absent')} className="min-h-[42px] bg-red-700 text-red-50 border border-red-800 py-2 rounded-xl text-xs sm:text-sm font-black hover:bg-red-800 active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                            <UserMinus size={16} /> من غاب عن الخدمة ({serviceExplicitAbsentCount})
                        </button>
                        <button onClick={() => openDetailedReport('service', 'present')} className="min-h-[42px] bg-green-700 text-green-50 border border-green-800 py-2 rounded-xl text-xs sm:text-sm font-black hover:bg-green-800 active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                            <UserCheck size={16} /> من حضر الخدمة ({serviceCount})
                        </button>
                        <button onClick={() => openDetailedReport('liturgy', 'all')} className="min-h-[42px] bg-amber-600 text-white border border-amber-700 py-2 rounded-xl text-xs sm:text-sm font-black hover:bg-amber-700 active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                            <Church size={16} /> من حضر القداس ({liturgyCount})
                        </button>
                    </div>
                </div>

                <div className="flex gap-3 mb-6">
                    <div className="flex-1 bg-blue-50 p-3.5 rounded-2xl border border-blue-200 flex justify-between items-center">
                        <span className="text-blue-900 font-black text-sm flex items-center gap-1.5"><Church size={18} /> قداس (+15)</span>
                        <span className="bg-blue-700 text-white px-3 py-1 rounded-xl text-xs font-black tabular-nums">{liturgyCount} / {filteredChildren.length}</span>
                    </div>
                    <div className="flex-1 bg-emerald-50 p-3.5 rounded-2xl border border-emerald-200 flex justify-between items-center">
                        <span className="text-emerald-900 font-black text-sm flex items-center gap-1.5"><BookOpen size={18} /> خدمة (+10)</span>
                        <span className="bg-emerald-700 text-white px-3 py-1 rounded-xl text-xs font-black tabular-nums">{serviceCount} / {filteredChildren.length}</span>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredChildren.map(child => {
                        const monthPts = monthlyPointsByChildId.get(String(child.id)) || 0;
                        return (
                            <div key={child.id} className="bg-white rounded-3xl p-4 shadow-sm border border-slate-200 flex flex-col gap-3 hover:shadow-md hover:border-amber-300 transition-all">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-xl overflow-hidden ring-2 ring-amber-200 shrink-0">
                                        {child.profilePic ? (
                                            <img
                                                src={child.profilePic}
                                                alt={child.name}
                                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                className="object-cover w-full h-full"
                                            />
                                        ) : (<User size={24} className="text-[#1B2A59]/70" />)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <h3 className="font-black text-slate-900 text-base leading-snug line-clamp-2">{child.name || 'بدون اسم'}</h3>
                                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                            <span className={`text-xs px-2.5 py-0.5 rounded-lg font-bold tabular-nums ${child.streak > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                                                مواظبة: {child.streak || 0}
                                            </span>
                                            <span className="text-xs px-2.5 py-0.5 rounded-lg font-black bg-amber-100 text-amber-900 border border-amber-200 tabular-nums inline-flex items-center gap-1">
                                                <Trophy size={12} className="text-amber-700" /> {monthPts} نقطة
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Attendance Controls (3-State Neutral: unmarked | present | absent) */}
                                {(() => {
                                    const activeStatus = getAttendanceStatus(child.id, activeSessionType, activeSessionId);
                                    const liturgySess = activeSelectedSession?.type === 'liturgy' ? activeSelectedSession : null;
                                    const tasbehaSess = activeSelectedSession?.type === 'tasbeha' ? activeSelectedSession : null;
                                    const showQuickSecondary = activeSessionType === 'service' || activeSessionType === 'service_meeting';
                                    return (
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-[11px] font-bold text-slate-500">
                                                    حالة {activeSessionLabel}:
                                                </span>
                                                {activeStatus === 'present' ? (
                                                    <span className="inline-flex items-center gap-1 text-[11px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                                                        <CheckCircle2 size={12} /> حاضر
                                                    </span>
                                                ) : activeStatus === 'absent' ? (
                                                    <span className="inline-flex items-center gap-1 text-[11px] font-black bg-rose-100 text-rose-800 border border-rose-200 px-2.5 py-0.5 rounded-full">
                                                        <XCircle size={12} /> غائب
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-0.5 rounded-full">
                                                        <Circle size={11} /> لم يُسجل بعد
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setAttendanceStatus(child, activeSessionType, 'present', activeSelectedSession)}
                                                    className={`min-h-[44px] flex-1 py-2.5 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                                        activeStatus === 'present'
                                                            ? 'bg-emerald-600 text-white border border-emerald-700 shadow-sm'
                                                            : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
                                                    }`}
                                                >
                                                    <CheckCircle2 size={15} /> حاضر
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setAttendanceStatus(child, activeSessionType, 'absent', activeSelectedSession)}
                                                    className={`min-h-[44px] flex-1 py-2.5 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                                        activeStatus === 'absent'
                                                            ? 'bg-rose-700 text-white border border-rose-800 shadow-sm'
                                                            : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
                                                    }`}
                                                >
                                                    <XCircle size={15} /> غائب
                                                </button>
                                            </div>

                                            {showQuickSecondary && (
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setAttendanceStatus(child, 'liturgy', 'present', liturgySess)}
                                                        className={`min-h-[38px] flex-1 py-1.5 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                                            getAttendanceStatus(child.id, 'liturgy', liturgySess?.id) === 'present'
                                                                ? 'bg-[#1B2A59] text-amber-300 shadow-sm'
                                                                : 'bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100'
                                                        }`}
                                                    >
                                                        <Church size={14} /> قداس (+15)
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setAttendanceStatus(child, 'tasbeha', 'present', tasbehaSess)}
                                                        className={`min-h-[38px] flex-1 py-1.5 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                                            getAttendanceStatus(child.id, 'tasbeha', tasbehaSess?.id) === 'present'
                                                                ? 'bg-violet-700 text-white shadow-sm'
                                                                : 'bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100'
                                                        }`}
                                                    >
                                                        <Music size={14} /> تسبحة (+10)
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {/* Quick 1-Tap Bonus Rewards Bar */}
                                <div className={`pt-2 border-t border-slate-100 ${activeRewardMode === 'rewards' ? 'bg-amber-50/70 -mx-4 -mb-4 p-3 rounded-b-3xl border-t-amber-200' : ''}`}>
                                    <div className="flex flex-wrap gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => handleQuickBonusPoints(child, POINTS_PRESETS.DISCIPLINE)}
                                            className="min-h-[38px] flex-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 px-2 py-1.5 rounded-xl text-[11px] font-black cursor-pointer transition-colors whitespace-nowrap"
                                        >
                                            <span className="inline-flex items-center justify-center gap-1"><Sparkles size={11} /> التزام +5</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleQuickBonusPoints(child, POINTS_PRESETS.MEMORIZATION)}
                                            className="min-h-[38px] flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 px-2 py-1.5 rounded-xl text-[11px] font-black cursor-pointer transition-colors whitespace-nowrap"
                                        >
                                            <span className="inline-flex items-center justify-center gap-1"><BookOpen size={11} /> حفظ +10</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleQuickBonusPoints(child, POINTS_PRESETS.EARLY_ARRIVAL)}
                                            className="min-h-[38px] flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 px-2 py-1.5 rounded-xl text-[11px] font-black cursor-pointer transition-colors whitespace-nowrap"
                                        >
                                            <span className="inline-flex items-center justify-center gap-1"><Church size={11} /> مبكر +5</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleCustomBonusPoints(child)}
                                            className="min-h-[38px] bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 px-2.5 py-1.5 rounded-xl text-[11px] font-black cursor-pointer transition-colors flex items-center gap-1"
                                            title="نقاط إضافية مخصصة"
                                        >
                                            <Plus size={12} /> مخصص
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <button onClick={() => openDetailedReport('combined', 'all')} className="w-full mt-8 min-h-[52px] py-4 rounded-2xl bg-[#1B2A59] text-amber-100 font-black text-base flex items-center justify-center gap-2 shadow-lg hover:bg-slate-900 active:scale-95 transition-all cursor-pointer"><CheckCheck size={20} /> عرض التقرير المقارن الشامل (الخدمة والقداس)</button>
            </main>

            <AttendanceDetailedReportModal
                isOpen={detailedReportModal.isOpen}
                initialTab={detailedReportModal.tab}
                initialSubFilter={detailedReportModal.subFilter}
                onClose={() => setDetailedReportModal({ isOpen: false, tab: 'service', subFilter: 'all' })}
                childrenList={filteredChildren}
                canonicalData={canonicalData}
                selectedDate={selectedDate}
                className={activeClassName}
                activeSyncKey={activeSyncKey}
                monthlyPointsByChildId={monthlyPointsByChildId}
                getTargetPhone={getTargetPhone}
                cleanPhoneNumber={cleanPhoneNumber}
            />
            <BottomNav />
        </div>
    );
}
