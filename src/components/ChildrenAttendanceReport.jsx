import { resolveAttendanceChild } from '../utils/childIdentity';
import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import * as XLSX from 'xlsx';
import {
    Calendar, Download, Printer, Search, Users, CheckCircle2,
    TrendingUp, ArrowRight, Phone, BarChart3, CalendarRange, Clock, Church, XCircle
} from 'lucide-react';
import { getVisitationInfo, formatLastVisitedDate } from '../utils/visitationTypes';
import {
    getLocalDateString,
    isThursdayServiceClass,
    getElapsedServiceDatesForClass,
    getClassScheduleConfig,
    getClassWeeklySessions
} from '../utils/serviceWeek';
import {
    getCanonicalActiveChildren,
    isAttendanceRecordPresent,
    isAttendanceRecordExplicitAbsent
} from '../utils/churchDataEngine';
import { TENANT_CONFIG, getExcelReportFilename } from '../utils/tenantConfig';

const MONTHS_AR = [
    { value: 1, label: 'يناير (1)' },
    { value: 2, label: 'فبراير (2)' },
    { value: 3, label: 'مارس (3)' },
    { value: 4, label: 'أبريل (4)' },
    { value: 5, label: 'مايو (5)' },
    { value: 6, label: 'يونيو (6)' },
    { value: 7, label: 'يوليو (7)' },
    { value: 8, label: 'أغسطس (8)' },
    { value: 9, label: 'سبتمبر (9)' },
    { value: 10, label: 'أكتوبر (10)' },
    { value: 11, label: 'نوفمبر (11)' },
    { value: 12, label: 'ديسمبر (12)' }
];

export default function ChildrenAttendanceReport({ childrenData = [], appSettings = {}, scopedSyncKeys = [], onBack = null }) {
    const today = new Date();
    const todayStr = getLocalDateString(today);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    // Period Filter State (Requirement #3)
    const [periodMode, setPeriodMode] = useState('monthly'); // 'monthly' | 'yearly' | 'custom'
    const [selectedYear, setSelectedYear] = useState(currentYear);
    const [selectedMonth, setSelectedMonth] = useState(currentMonth);
    const [fromDate, setFromDate] = useState(() => {
        const d = new Date();
        d.setDate(1);
        return getLocalDateString(d);
    });
    const [toDate, setToDate] = useState(todayStr);

    // Search and Class Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedOsraFilter, setSelectedOsraFilter] = useState('all');
    const [sessionFilter, setSessionFilter] = useState('all'); // 'all' | 'service::<dayNum>' | 'liturgy::<dayNum>'

    // Compute period date bounds
    const periodBounds = useMemo(() => {
        if (periodMode === 'monthly') {
            const mPad = String(selectedMonth).padStart(2, '0');
            const startBound = `${selectedYear}-${mPad}-01`;
            const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
            const endBound = `${selectedYear}-${mPad}-${String(lastDay).padStart(2, '0')}`;
            return { startBound, endBound };
        }
        if (periodMode === 'yearly') {
            return {
                startBound: `${selectedYear}-01-01`,
                endBound: `${selectedYear}-12-31`
            };
        }
        return {
            startBound: fromDate || '2000-01-01',
            endBound: toDate || todayStr
        };
    }, [periodMode, selectedYear, selectedMonth, fromDate, toDate, todayStr]);

    // Canonical Active Children from SSOT Engine
    const canonicalData = useMemo(() => {
        return getCanonicalActiveChildren(childrenData);
    }, [childrenData]);

    const activeKids = canonicalData.activeChildren;

    // Fetch scoped attendance from Dexie within periodBounds
    const attendanceRecords = useLiveQuery(async () => {
        const { startBound, endBound } = periodBounds;
        const records = await db.attendance
            .where('date')
            .between(startBound, endBound, true, true)
            .toArray();

        return records || [];
    }, [periodBounds.startBound, periodBounds.endBound]) || [];

    // Helper to resolve Osra Name
    const getOsraName = (child) => {
        if (child.osraName) return child.osraName;
        if (child.assignedOsra) return child.assignedOsra;
        const services = appSettings.services || [];
        for (const s of services) {
            const found = (s.osras || []).find(o => String(o.syncKey).trim() === String(child.syncKey).trim());
            if (found) return found.name;
        }
        return child.syncKey || 'غير محدد';
    };

    // Filter available Osras
    const availableOsras = useMemo(() => {
        const set = new Set();
        activeKids.forEach(c => {
            const name = getOsraName(c);
            if (name) set.add(name);
        });
        return Array.from(set).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeKids, appSettings]);

    // Build dynamic session filter options across visible classes (and configured scope even before kids load)
    const availableSessionOptions = useMemo(() => {
        const optionMap = new Map();
        const scopedKids = selectedOsraFilter === 'all'
            ? activeKids
            : activeKids.filter(c => getOsraName(c) === selectedOsraFilter);
        const classTargets = new Map(); // syncKey -> className
        scopedKids.forEach((c) => {
            const k = String(c.syncKey || '').trim();
            if (k && !classTargets.has(k)) {
                classTargets.set(k, getOsraName(c));
            }
        });
        if (selectedOsraFilter === 'all') {
            (Array.isArray(scopedSyncKeys) ? scopedSyncKeys : []).forEach((rawKey) => {
                const k = String(rawKey || '').trim();
                if (k && k !== 'all' && !classTargets.has(k)) {
                    const matchedOsra = (appSettings?.services || [])
                        .flatMap(s => s.osras || [])
                        .find(o => o.syncKey === k);
                    classTargets.set(k, matchedOsra?.name || k);
                }
            });
            if (classTargets.size === 0) {
                (appSettings?.services || []).flatMap(s => s.osras || []).forEach((o) => {
                    const k = String(o?.syncKey || '').trim();
                    if (k && !classTargets.has(k)) {
                        classTargets.set(k, o.name || k);
                    }
                });
            }
        } else {
            const matchedOsra = (appSettings?.services || [])
                .flatMap(s => s.osras || [])
                .find(o => o.name === selectedOsraFilter || o.syncKey === selectedOsraFilter);
            if (matchedOsra?.syncKey && !classTargets.has(matchedOsra.syncKey)) {
                classTargets.set(matchedOsra.syncKey, matchedOsra.name || selectedOsraFilter);
            }
        }
        classTargets.forEach((osraName, k) => {
            const sessions = getClassWeeklySessions({ syncKey: k, name: osraName }, appSettings);
            sessions.forEach((s) => {
                const filterId = `${s.type}::${s.dayNum}`;
                if (!optionMap.has(filterId)) {
                    optionMap.set(filterId, { id: filterId, type: s.type, dayNum: s.dayNum, label: s.label });
                }
            });
        });
        return Array.from(optionMap.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeKids, selectedOsraFilter, appSettings, scopedSyncKeys]);

    // Compute Per-Child Attendance & Absence Metrics (supporting multi-day schedules & dynamic session filtering)
    const { computedReport, summaryServiceDates } = useMemo(() => {
        const { startBound, endBound } = periodBounds;
        const activeSessionParts = sessionFilter !== 'all' ? sessionFilter.split('::') : null;
        const filterType = activeSessionParts ? activeSessionParts[0] : null;
        const filterDayNum = activeSessionParts ? Number(activeSessionParts[1]) : null;

        // Deduplicate attendance rows by (date, canonicalChildId, sessionKey || type) and group by canonicalChildId
        const dedupedByKey = new Map();
        for (const r of attendanceRecords) {
            if (!r || !r.date || !r.type) continue;
            const canonicalChild = resolveAttendanceChild(r, canonicalData);
            if (!canonicalChild) continue; // Ignore orphaned/deleted children

            const cid = String(canonicalChild.id).trim();
            const dStr = String(r.date).split('T')[0];
            const sessToken = String(r.sessionKey || r.type).trim();
            const key = `${dStr}::${cid}::${sessToken}`;
            const existing = dedupedByKey.get(key);
            if (!existing) {
                dedupedByKey.set(key, { record: r, canonicalChild, cid, dStr, sessToken });
            } else {
                const t1 = existing.record.updatedAt ? new Date(existing.record.updatedAt).getTime() : 0;
                const t2 = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
                if (t2 >= t1) {
                    dedupedByKey.set(key, { record: r, canonicalChild, cid, dStr, sessToken });
                }
            }
        }

        const attByChild = {};
        const actualServiceDatesByClass = new Map();

        for (const { record: r, canonicalChild, cid, dStr, sessToken } of dedupedByKey.values()) {
            if (r.isDeleted || r.status === 'unmarked') continue;
            if (!attByChild[cid]) attByChild[cid] = [];
            attByChild[cid].push({ ...r, date: dStr, _sessToken: sessToken });

            const isServiceRecord = r.type === 'service' || r.type === 'service_meeting';
            const matchesFilter = !filterType || (
                (filterType === 'service' ? isServiceRecord : r.type === filterType) &&
                new Date(`${dStr}T12:00:00`).getDay() === filterDayNum
            );
            if (matchesFilter && (isServiceRecord || filterType === 'liturgy') && (isAttendanceRecordPresent(r) || isAttendanceRecordExplicitAbsent(r))) {
                const sKey = canonicalChild.syncKey;
                if (!actualServiceDatesByClass.has(sKey)) {
                    actualServiceDatesByClass.set(sKey, new Set());
                }
                actualServiceDatesByClass.get(sKey).add(dStr);
            }
        }

        // Precompute elapsed target dates per class (respecting custom serviceDays/liturgyDays and active sessionFilter)
        const serviceDatesByClass = new Map();
        const allSummaryDatesSet = new Set();

        for (const c of activeKids) {
            const sKey = c.syncKey;
            if (!serviceDatesByClass.has(sKey)) {
                const osraName = getOsraName(c);
                const actualDates = Array.from(actualServiceDatesByClass.get(sKey) || []);
                let elapsed = [];
                if (filterType !== null && !Number.isNaN(filterDayNum)) {
                    // Count elapsed occurrences of ONLY the selected weekday session inside [startBound, min(endBound, todayStr)]
                    const capEnd = endBound < todayStr ? endBound : todayStr;
                    const cur = new Date(`${startBound}T12:00:00`);
                    const end = new Date(`${capEnd}T12:00:00`);
                    const dayDates = new Set(actualDates);
                    if (!isNaN(cur.getTime()) && !isNaN(end.getTime())) {
                        while (cur <= end) {
                            if (cur.getDay() === filterDayNum) {
                                dayDates.add(getLocalDateString(cur));
                            }
                            cur.setDate(cur.getDate() + 1);
                        }
                    }
                    elapsed = Array.from(dayDates).filter(d => d >= startBound && d <= capEnd).sort();
                } else {
                    elapsed = getElapsedServiceDatesForClass(startBound, endBound, {
                        syncKey: sKey,
                        className: osraName,
                        actualServiceDates: actualDates,
                        todayStr,
                        appSettings
                    });
                }
                serviceDatesByClass.set(sKey, elapsed);
                elapsed.forEach(d => allSummaryDatesSet.add(d));
            }
        }

        const rows = activeKids.map((c, index) => {
            const cid = String(c.id).trim();
            const records = attByChild[cid] || [];
            const osraName = getOsraName(c);
            const sched = getClassScheduleConfig({ syncKey: c.syncKey, name: osraName }, osraName, appSettings);
            const isThursdayClass = isThursdayServiceClass(c.syncKey, osraName, appSettings);
            const classServiceDates = serviceDatesByClass.get(c.syncKey) || [];

            const attendedServiceSessions = new Set();
            const absentServiceSessions = new Set();
            const attendedLiturgySessions = new Set();
            const absentLiturgySessions = new Set();
            const attendedTasbehaSessions = new Set();
            const absentTasbehaSessions = new Set();

            records.forEach(r => {
                const isPresent = isAttendanceRecordPresent(r);
                const isExplicitAbsent = !isPresent && isAttendanceRecordExplicitAbsent(r);
                if (!isPresent && !isExplicitAbsent) return;

                const isServiceType = r.type === 'service' || r.type === 'service_meeting';
                if (filterType !== null && !Number.isNaN(filterDayNum)) {
                    const rDay = new Date(`${r.date}T12:00:00`).getDay();
                    const typeMatches = filterType === 'service' ? isServiceType : r.type === filterType;
                    if (!typeMatches || rDay !== filterDayNum) return;
                }

                const occurrenceKey = `${r.date}::${r._sessToken || r.sessionKey || r.type}`;
                if (isServiceType) {
                    if (isPresent) attendedServiceSessions.add(occurrenceKey);
                    else absentServiceSessions.add(occurrenceKey);
                } else if (r.type === 'liturgy') {
                    if (isPresent) attendedLiturgySessions.add(occurrenceKey);
                    else absentLiturgySessions.add(occurrenceKey);
                } else if (r.type === 'tasbeha') {
                    if (isPresent) attendedTasbehaSessions.add(occurrenceKey);
                    else absentTasbehaSessions.add(occurrenceKey);
                }
            });

            const presentCount = filterType === 'liturgy'
                ? attendedLiturgySessions.size
                : (filterType === 'tasbeha' ? attendedTasbehaSessions.size : attendedServiceSessions.size);
            // ZERO false absences: ONLY count explicit status === 'absent' records (never unmarked sessions!)
            const absentCount = filterType === 'liturgy'
                ? absentLiturgySessions.size
                : (filterType === 'tasbeha' ? absentTasbehaSessions.size : absentServiceSessions.size);
            const totalRecordedForChild = presentCount + absentCount;
            const totalServiceDays = Math.max(classServiceDates.length, totalRecordedForChild);
            const attendancePercentage = totalServiceDays > 0
                ? Math.min(100, Math.round((presentCount / totalServiceDays) * 100))
                : 0;

            const lastVisitDate = formatLastVisitedDate(c.last_visited);
            const lastVisitTypeInfo = c.lastVisitationType ? getVisitationInfo(c.lastVisitationType) : null;
            const lastVisitLabel = c.lastVisitationLabel || (lastVisitTypeInfo ? lastVisitTypeInfo.shortLabel : (lastVisitDate ? 'افتـقـاد' : 'لم يُفتقد'));

            return {
                index: index + 1,
                id: c.id,
                syncKey: c.syncKey,
                name: c.name || 'بدون اسم',
                gender: c.gender,
                osraName,
                isThursdayClass,
                serviceDayLabel: sched.shortBadge || sched.scheduleBadge,
                phone: c.childPhone || c.fatherPhone || c.motherPhone || c.phone || '',
                presentCount,
                absentCount,
                totalLiturgy: attendedLiturgySessions.size,
                totalTasbeha: attendedTasbehaSessions.size,
                totalFridays: totalServiceDays,
                totalServiceDays,
                classServiceDates,
                attendancePercentage,
                lastVisitDate,
                lastVisitType: c.lastVisitationType || null,
                lastVisitLabel,
                lastVisitBadgeClass: lastVisitTypeInfo ? lastVisitTypeInfo.badgeClass : 'bg-slate-100 text-slate-600 border-slate-200'
            };
        });

        return {
            computedReport: rows,
            summaryServiceDates: Array.from(allSummaryDatesSet).sort()
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeKids, canonicalData, attendanceRecords, periodBounds, todayStr, appSettings, sessionFilter]);

    // Apply User Filters
    const filteredReport = useMemo(() => {
        return computedReport.filter(item => {
            if (selectedOsraFilter !== 'all' && item.osraName !== selectedOsraFilter) {
                return false;
            }
            if (searchTerm.trim()) {
                const term = searchTerm.toLowerCase();
                const matchName = item.name.toLowerCase().includes(term);
                const matchPhone = item.phone.includes(term);
                if (!matchName && !matchPhone) return false;
            }
            return true;
        });
    }, [computedReport, selectedOsraFilter, searchTerm]);

    // Summary Statistics
    const statsSummary = useMemo(() => {
        const totalKids = filteredReport.length;
        if (totalKids === 0) {
            return {
                totalKids: 0,
                avgRate: 0,
                totalPresents: 0,
                totalAbsents: 0,
                serviceDaysCount: summaryServiceDates.length,
                activeServiceDates: summaryServiceDates
            };
        }

        const totalPresents = filteredReport.reduce((sum, item) => sum + item.presentCount, 0);
        const totalAbsents = filteredReport.reduce((sum, item) => sum + item.absentCount, 0);
        const avgRate = Math.round(
            filteredReport.reduce((sum, item) => sum + item.attendancePercentage, 0) / totalKids
        );

        const scopedDatesSet = new Set();
        filteredReport.forEach(item => {
            (item.classServiceDates || []).forEach(d => scopedDatesSet.add(d));
        });
        const scopedDates = scopedDatesSet.size > 0 ? Array.from(scopedDatesSet).sort() : summaryServiceDates;
        const representativeDaysCount = selectedOsraFilter !== 'all' && filteredReport[0]
            ? filteredReport[0].totalServiceDays
            : scopedDates.length;

        return {
            totalKids,
            avgRate,
            totalPresents,
            totalAbsents,
            serviceDaysCount: representativeDaysCount,
            activeServiceDates: scopedDates
        };
    }, [filteredReport, selectedOsraFilter, summaryServiceDates]);

    // Excel Export Handler (Requirement #3)
    const handleExportExcel = () => {
        if (filteredReport.length === 0) {
            alert('لا توجد بيانات متاحة للتصدير!');
            return;
        }

        const periodLabel = periodMode === 'monthly'
            ? `شهر_${selectedMonth}_${selectedYear}`
            : (periodMode === 'yearly' ? `سنة_${selectedYear}` : `فترة_${fromDate}_إلى_${toDate}`);

        const exportData = filteredReport.map(item => ({
            "م": item.index,
            "كود المخدوم": item.id,
            "اسم المخدوم": item.name,
            "الفصل / الأسرة": item.osraName,
            "يوم الخدمة": item.serviceDayLabel,
            "إجمالي أيام الخدمة للفترة": item.totalServiceDays,
            "عدد أيام الحضور (الخدمة)": item.presentCount,
            "عدد أيام الغياب (الخدمة)": item.absentCount,
            "نسبة الحضور %": `${item.attendancePercentage}%`,
            "حضور القداسات": item.totalLiturgy,
            "تاريخ آخر افتقاد": item.lastVisitDate || 'لم يُفتقد',
            "نوع آخر افتقاد": item.lastVisitLabel || 'غير مسجل',
            "رقم التليفون": item.phone || 'لا يوجد'
        }));

        const worksheet = XLSX.utils.json_to_sheet(exportData);
        worksheet['!cols'] = [
            { wch: 5 }, { wch: 14 }, { wch: 25 }, { wch: 20 }, { wch: 12 },
            { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 },
            { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 16 }
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'حضور_وغياب_المخدومين');
        XLSX.writeFile(workbook, getExcelReportFilename(`تقرير_حضور_وغياب_المخدومين_${periodLabel}`));
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300" dir="rtl">
            {/* Header & Period Switcher */}
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-indigo-100">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div>
                        <div className="flex items-center gap-2">
                            {onBack && (
                                <button
                                    onClick={onBack}
                                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                                    title="رجوع"
                                >
                                    <ArrowRight size={18} />
                                </button>
                            )}
                            <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                                <BarChart3 size={20} className="text-[#C8942E]" />
                                <span>تقرير حضور وغياب المخدومين</span>
                            </h2>
                        </div>
                        <p className="text-xs font-bold text-slate-500 mt-1">
                            {TENANT_CONFIG.churchName} — حساب دقيق لنسب الحضور والغياب لجميع أيام الخدمة المنقضية ومتابعة الافتقاد
                        </p>
                    </div>

                    <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
                        <button
                            type="button"
                            onClick={handleExportExcel}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-black text-xs shadow-md shadow-emerald-600/20 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                            <Download size={15} /> تصدير Excel
                        </button>
                        <button
                            type="button"
                            onClick={() => window.print()}
                            className="bg-slate-800 hover:bg-slate-900 text-white px-4 py-2.5 rounded-xl font-black text-xs shadow-md shadow-slate-800/20 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                            <Printer size={15} /> طباعة
                        </button>
                    </div>
                </div>

                {/* أزرار اختيار وضع الفترة (شهري / سنوي / فترة مخصصة) */}
                <div className="bg-slate-100/80 p-1.5 rounded-2xl flex flex-wrap gap-1.5 mb-5">
                    <button
                        type="button"
                        onClick={() => setPeriodMode('monthly')}
                        className={`flex-1 min-w-[100px] py-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            periodMode === 'monthly'
                                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                                : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                        <Calendar size={14} /> تقرير شهري
                    </button>
                    <button
                        type="button"
                        onClick={() => setPeriodMode('yearly')}
                        className={`flex-1 min-w-[100px] py-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            periodMode === 'yearly'
                                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                                : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                        <CalendarRange size={14} /> تقرير سنوي
                    </button>
                    <button
                        type="button"
                        onClick={() => setPeriodMode('custom')}
                        className={`flex-1 min-w-[100px] py-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            periodMode === 'custom'
                                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                                : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                        <Clock size={14} /> فترة مخصصة
                    </button>
                </div>

                {/* Filters Input Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-1">
                    {periodMode === 'monthly' && (
                        <>
                            <div>
                                <label className="block text-[11px] font-black text-slate-500 mb-1">الشهر:</label>
                                <select
                                    value={selectedMonth}
                                    onChange={(e) => setSelectedMonth(Number(e.target.value))}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    {MONTHS_AR.map(m => (
                                        <option key={m.value} value={m.value}>{m.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[11px] font-black text-slate-500 mb-1">السنة:</label>
                                <select
                                    value={selectedYear}
                                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map(y => (
                                        <option key={y} value={y}>{y}</option>
                                    ))}
                                </select>
                            </div>
                        </>
                    )}

                    {periodMode === 'yearly' && (
                        <div className="sm:col-span-2">
                            <label className="block text-[11px] font-black text-slate-500 mb-1">اختر السنة الكاملة:</label>
                            <select
                                value={selectedYear}
                                onChange={(e) => setSelectedYear(Number(e.target.value))}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map(y => (
                                    <option key={y} value={y}>سنة {y}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {periodMode === 'custom' && (
                        <>
                            <div>
                                <label className="block text-[11px] font-black text-slate-500 mb-1">من تاريخ:</label>
                                <input
                                    type="date"
                                    value={fromDate}
                                    onChange={(e) => setFromDate(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                            <div>
                                <label className="block text-[11px] font-black text-slate-500 mb-1">إلى تاريخ:</label>
                                <input
                                    type="date"
                                    value={toDate}
                                    onChange={(e) => setToDate(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                        </>
                    )}

                    <div>
                        <label className="block text-[11px] font-black text-slate-500 mb-1">فلتر الفصل / الأسرة:</label>
                        <select
                            value={selectedOsraFilter}
                            onChange={(e) => setSelectedOsraFilter(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="all">كل الفصول ({activeKids.length})</option>
                            {availableOsras.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-[11px] font-black text-slate-500 mb-1">الجلسة / اليوم الأسبوعي:</label>
                        <select
                            value={sessionFilter}
                            onChange={(e) => setSessionFilter(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="all">كل جلسات الأسبوع</option>
                            {availableSessionOptions.map(opt => (
                                <option key={opt.id} value={opt.id}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-[11px] font-black text-slate-500 mb-1">بحث بالاسم أو الهاتف:</label>
                        <div className="relative">
                            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="ابحث..."
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-8 pl-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Summary KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white p-4 rounded-2xl shadow-xs border border-indigo-50 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                        <Users size={20} />
                    </div>
                    <div>
                        <div className="text-[10px] font-black text-slate-400">إجمالي المخدومين</div>
                        <div className="text-lg font-black text-slate-800">{statsSummary.totalKids}</div>
                    </div>
                </div>

                <div className="bg-white p-4 rounded-2xl shadow-xs border border-purple-50 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                        <Calendar size={20} />
                    </div>
                    <div>
                        <div className="text-[10px] font-black text-slate-400">أيام الخدمة المنقضية</div>
                        <div className="text-lg font-black text-purple-700">{statsSummary.serviceDaysCount} يوم</div>
                    </div>
                </div>

                <div className="bg-white p-4 rounded-2xl shadow-xs border border-emerald-50 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                        <CheckCircle2 size={20} />
                    </div>
                    <div>
                        <div className="text-[10px] font-black text-slate-400">إجمالي الحضور</div>
                        <div className="text-lg font-black text-emerald-600">{statsSummary.totalPresents}</div>
                    </div>
                </div>

                <div className="bg-white p-4 rounded-2xl shadow-xs border border-amber-50 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                        <TrendingUp size={20} />
                    </div>
                    <div>
                        <div className="text-[10px] font-black text-slate-400">متوسط المواظبة</div>
                        <div className="text-lg font-black text-amber-600">{statsSummary.avgRate}%</div>
                    </div>
                </div>
            </div>

            {/* Report Data Table */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-black text-slate-700">
                        كشف الحضور والغياب والافتقاد ({filteredReport.length} مخدوم)
                    </span>
                    <span className="text-[11px] font-bold text-slate-500">
                        {statsSummary.activeServiceDates.length > 0
                            ? `أيام الخدمة المحسوبة: ${statsSummary.activeServiceDates.join(' ، ')}`
                            : 'لم تنقضِ أي أيام خدمة بعد في هذه الفترة'}
                    </span>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-100">
                    <table className="w-full text-right border-collapse text-xs sm:text-sm">
                        <thead>
                            <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-black">
                                <th className="px-2.5 py-2 sm:p-3 w-10 text-center">#</th>
                                <th className="px-2.5 py-2 sm:p-3 min-w-[130px]">اسم المخدوم</th>
                                <th className="px-2.5 py-2 sm:p-3 min-w-[110px]">الفصل / الأسرة</th>
                                <th className="px-2.5 py-2 sm:p-3 text-center"><span className="inline-flex items-center gap-1 justify-center"><CheckCircle2 size={13} className="text-emerald-600" /> حضور الخدمة</span></th>
                                <th className="px-2.5 py-2 sm:p-3 text-center"><span className="inline-flex items-center gap-1 justify-center"><Church size={13} className="text-[#C8942E]" /> حضور القداس</span></th>
                                <th className="px-2.5 py-2 sm:p-3 text-center"><span className="inline-flex items-center gap-1 justify-center"><XCircle size={13} className="text-rose-600" /> غياب الخدمة</span></th>
                                <th className="px-2.5 py-2 sm:p-3 text-center">نسبة الحضور %</th>
                                <th className="px-2.5 py-2 sm:p-3 min-w-[130px]">آخر افتقاد ونوعه</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-bold">
                            {filteredReport.length === 0 ? (
                                <tr>
                                    <td colSpan="8" className="p-8 text-center text-slate-400 font-black">
                                        لا توجد بيانات مطابقة للبحث أو الفلتر المحدد.
                                    </td>
                                </tr>
                            ) : (
                                filteredReport.map((child) => (
                                    <tr key={child.id} className="hover:bg-indigo-50/40 transition-colors">
                                        <td className="p-3 text-center text-slate-400 text-[11px]">{child.index}</td>
                                        <td className="p-3">
                                            <div className="font-black text-slate-800 flex items-center gap-1.5">
                                                {child.name}
                                            </div>
                                            {child.phone && (
                                                <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5" dir="ltr">
                                                    <Phone size={10} /> {child.phone}
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-3 text-slate-600 text-xs">
                                            <div className="flex flex-col gap-0.5">
                                                <span>{child.osraName}</span>
                                                <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded w-fit ${
                                                    child.isThursdayClass
                                                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                                        : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                                                }`}>
                                                    {child.serviceDayLabel}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-3 text-center">
                                            <span className="inline-block px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-black">
                                                {child.presentCount} / {child.totalServiceDays}
                                            </span>
                                        </td>
                                        <td className="p-3 text-center">
                                            <span className="inline-block px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-black">
                                                {child.totalLiturgy}
                                            </span>
                                        </td>
                                        <td className="p-3 text-center">
                                            <span className={`inline-block px-2.5 py-1 rounded-xl text-xs font-black border ${
                                                child.absentCount > 0 
                                                    ? 'bg-red-50 text-red-600 border-red-200' 
                                                    : 'bg-slate-50 text-slate-400 border-slate-200'
                                            }`}>
                                                {child.absentCount}
                                            </span>
                                        </td>
                                        <td className="p-3 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <span className={`text-xs font-black ${
                                                    child.attendancePercentage >= 75 ? 'text-emerald-600' :
                                                    child.attendancePercentage >= 50 ? 'text-amber-600' : 'text-red-500'
                                                }`}>
                                                    {child.attendancePercentage}%
                                                </span>
                                                <div className="w-12 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                                    <div 
                                                        className={`h-full rounded-full ${
                                                            child.attendancePercentage >= 75 ? 'bg-emerald-500' :
                                                            child.attendancePercentage >= 50 ? 'bg-amber-500' : 'bg-red-500'
                                                        }`}
                                                        style={{ width: `${child.attendancePercentage}%` }}
                                                    ></div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-3">
                                            {child.lastVisitDate ? (
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-[11px] font-black text-slate-700 inline-flex items-center gap-1">
                                                        <Calendar size={11} className="text-[#C8942E]" /> {child.lastVisitDate}
                                                    </span>
                                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg border w-fit ${child.lastVisitBadgeClass}`}>
                                                        {child.lastVisitLabel}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-[11px] text-slate-400 font-bold">
                                                    لم يُفتقد
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
