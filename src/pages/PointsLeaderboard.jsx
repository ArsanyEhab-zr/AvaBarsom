import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import * as XLSX from 'xlsx';
import {
    Trophy, Crown, Medal, Download, ArrowRight, Search,
    Sparkles, Calendar, Users, Gift, Plus, Church, BookOpen, Music
} from 'lucide-react';
import { db } from '../db/database';
import { TENANT_CONFIG, getLogoUrl, getExcelReportFilename } from '../utils/tenantConfig';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
import { getLocalDateString } from '../utils/serviceWeek';
import {
    aggregateMonthlyPoints,
    formatArabicMonthKey,
    getMonthKeyFromDate,
    awardPointsToChild,
    POINTS_PRESETS
} from '../utils/pointsEngine';
import PointsManagerModal from '../components/PointsManagerModal';
import BottomNav from '../components/BottomNav';

import { useSmartNavigation } from '../hooks/useSmartNavigation';

export default function PointsLeaderboard() {
    const { goBack } = useSmartNavigation();
    const navigate = useNavigate();
    const accessScope = resolveUserAccessScope(null, [], { includeFallback: true });
    const isMaster = accessScope.canSwitchClasses;
    const lockedSyncKey = accessScope.activeSyncKey || '';

    const [selectedMonth, setSelectedMonth] = useState(() => getMonthKeyFromDate(new Date()));
    const [selectedSyncKey, setSelectedSyncKey] = useState(() => (isMaster ? 'all' : lockedSyncKey));
    const [searchQuery, setSearchQuery] = useState('');
    const [activeChildModal, setActiveChildModal] = useState(null);
    const [toastMsg, setToastMsg] = useState('');

    const allChildren = useLiveQuery(() => db.children.toArray(), []) || [];
    const allPointsLogs = useLiveQuery(() => db.pointsLogs.toArray(), []) || [];
    const availableOsras = useMemo(() => accessScope.allowedOsras || [], [accessScope]);
    const allowedKeysSet = useMemo(() => new Set(accessScope.allowedSyncKeys || []), [accessScope]);

    const validSelectedSyncKey = useMemo(() => {
        if (!isMaster) return lockedSyncKey;
        if (selectedSyncKey === 'all' || allowedKeysSet.has(selectedSyncKey)) return selectedSyncKey;
        return 'all';
    }, [isMaster, lockedSyncKey, selectedSyncKey, allowedKeysSet]);

    const activeChildren = useMemo(
        () => allChildren.filter(c => !c.isDeleted && (accessScope.isSuperAdmin || allowedKeysSet.has(c.syncKey))),
        [allChildren, accessScope.isSuperAdmin, allowedKeysSet]
    );

    const monthOptions = useMemo(() => {
        const set = new Set([getMonthKeyFromDate(new Date())]);
        allPointsLogs.forEach(log => {
            if (log && !log.isDeleted && log.monthKey) set.add(log.monthKey);
        });
        return Array.from(set).sort().reverse();
    }, [allPointsLogs]);

    const leaderboard = useMemo(() => {
        return aggregateMonthlyPoints({
            pointsLogs: allPointsLogs,
            children: activeChildren,
            monthKey: selectedMonth,
            syncKeyFilter: validSelectedSyncKey
        });
    }, [allPointsLogs, activeChildren, selectedMonth, validSelectedSyncKey]);

    const filteredLeaderboard = useMemo(() => {
        if (!searchQuery.trim()) return leaderboard;
        const q = searchQuery.trim().toLowerCase();
        return leaderboard.filter(row =>
            row.name?.toLowerCase().includes(q) || row.syncKey?.toLowerCase().includes(q)
        );
    }, [leaderboard, searchQuery]);

    const topThree = filteredLeaderboard.slice(0, 3);
    const totalMonthPoints = useMemo(
        () => filteredLeaderboard.reduce((acc, row) => acc + (row.totalPoints || 0), 0),
        [filteredLeaderboard]
    );

    const showToast = (msg) => {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(prev => (prev === msg ? '' : prev)), 2400);
    };

    const handleQuickRewardRow = async (row, preset) => {
        await awardPointsToChild({
            child: row.child,
            points: preset.points,
            category: preset.key,
            reason: preset.reason,
            date: getLocalDateString(new Date())
        });
        showToast(`تم منح +${preset.points} نقطة (${preset.reason}) لـ ${row.name}`);
    };

    const handleExportExcel = () => {
        if (filteredLeaderboard.length === 0) {
            alert('لا توجد بيانات نقاط للتصدير في هذا الشهر.');
            return;
        }

        const headerRows = [
            [`${TENANT_CONFIG.churchName} — كشف نقاط ومكافآت شهر ${formatArabicMonthKey(selectedMonth)}`],
            [`الفصل / القطاع: ${selectedSyncKey === 'all' ? 'جميع الخدمات والأسر' : selectedSyncKey}`, `تاريخ الإصدار: ${getLocalDateString(new Date())}`],
            [],
            ['الترتيب', 'الاسم', 'الفصل / الخدمة', 'حضور الخدمة', 'حضور القداس', 'التسبحة', 'حفظ ومشاركة', 'التزام وهدوء', 'حضور مبكر', 'مكافآت إضافية', 'إجمالي النقاط']
        ];

        const dataRows = filteredLeaderboard.map(row => ([
            row.rank,
            row.name,
            row.syncKey || '-',
            row.breakdown.attendance || 0,
            row.breakdown.liturgy || 0,
            row.breakdown.tasbeha || 0,
            row.breakdown.memorization || 0,
            row.breakdown.behavior || 0,
            row.breakdown.early || 0,
            row.breakdown.custom || 0,
            row.totalPoints
        ]));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([...headerRows, ...dataRows]);
        ws['!cols'] = [
            { wch: 8 }, { wch: 28 }, { wch: 22 },
            { wch: 13 }, { wch: 13 }, { wch: 11 },
            { wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 14 }, { wch: 15 }
        ];
        XLSX.utils.book_append_sheet(wb, ws, 'نقاط الشهر');
        const filename = getExcelReportFilename(`كشف_نقاط_ومكافآت_${selectedMonth}`);
        XLSX.writeFile(wb, filename);
        showToast(`تم تصدير ${filename} بنجاح`);
    };

    const modalChildRow = activeChildModal
        ? leaderboard.find(r => r.childId === activeChildModal.childId) || activeChildModal
        : null;

    return (
        <div className="min-h-screen bg-[#FAF7F2] pb-28 font-sans" dir="rtl">
            {toastMsg && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[150] bg-[#1B2A59] text-amber-300 border border-amber-400/50 px-5 py-3 rounded-2xl shadow-2xl font-black text-sm flex items-center gap-2 animate-in fade-in slide-in-from-top-4">
                    <Sparkles size={18} className="shrink-0" />
                    <span>{toastMsg}</span>
                </div>
            )}

            {/* Header */}
            <header className="bg-linear-to-bl from-[#132046] via-[#1B2A59] to-[#101A3B] text-white p-5 sm:p-7 rounded-b-[2.5rem] shadow-xl border-b-4 border-amber-500/80 mb-6">
                <div className="max-w-5xl mx-auto">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                        <div className="flex items-center gap-3 min-w-0">
                            <button
                                type="button"
                                onClick={() => goBack('/')}
                                className="w-11 h-11 rounded-2xl bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer transition-colors shrink-0"
                                aria-label="رجوع"
                            >
                                <ArrowRight size={22} />
                            </button>
                            <img
                                src={getLogoUrl()}
                                alt="شعار الكنيسة"
                                className="w-12 h-12 rounded-full bg-white p-0.5 object-contain border border-amber-400 shrink-0"
                            />
                            <div className="min-w-0">
                                <h1 className="font-calligraphic text-2xl sm:text-3xl font-bold text-amber-300 truncate">
                                    نظام النقاط والمكافآت الشهرية
                                </h1>
                                <p className="text-xs sm:text-sm font-bold text-indigo-100/90 leading-snug">
                                    {TENANT_CONFIG.churchName} • لوحة الأوائل والتكريم
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={handleExportExcel}
                            className="min-h-[46px] bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-black shadow-lg flex items-center gap-2 cursor-pointer transition-all active:scale-95"
                        >
                            <Download size={18} />
                            <span>تصدير كشف نقاط ومكافآت الشهر (Excel)</span>
                        </button>
                    </div>

                    {/* Filters & KPIs */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <div className="bg-white/10 border border-white/15 rounded-2xl p-3 flex items-center gap-2.5">
                            <Calendar size={18} className="text-amber-300 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <label className="block text-[11px] font-bold text-indigo-200 mb-0.5">الشهر</label>
                                <select
                                    value={selectedMonth}
                                    onChange={(e) => setSelectedMonth(e.target.value)}
                                    className="w-full bg-transparent text-white font-black text-sm outline-none cursor-pointer"
                                >
                                    {monthOptions.map(mk => (
                                        <option key={mk} value={mk} className="text-slate-900">
                                            {formatArabicMonthKey(mk)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="bg-white/10 border border-white/15 rounded-2xl p-3 flex items-center gap-2.5 sm:col-span-2">
                            <Users size={18} className="text-amber-300 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <label className="block text-[11px] font-bold text-indigo-200 mb-0.5">تصفية حسب الفصل / الخدمة</label>
                                <select
                                    value={validSelectedSyncKey}
                                    onChange={(e) => setSelectedSyncKey(e.target.value)}
                                    disabled={!isMaster}
                                    className="w-full bg-transparent text-white font-black text-sm outline-none cursor-pointer disabled:opacity-80"
                                >
                                    {isMaster && (
                                        <option value="all" className="text-slate-900">
                                            {accessScope.isSuperAdmin ? `جميع الفصول والأسر (${activeChildren.length})` : `كل فصول ${accessScope.stageName} (${activeChildren.length})`}
                                        </option>
                                    )}
                                    {availableOsras.map(osra => (
                                        <option key={osra.syncKey} value={osra.syncKey} className="text-slate-900">
                                            {osra.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="bg-amber-500/20 border border-amber-400/40 rounded-2xl p-3 text-center flex flex-col justify-center">
                            <span className="text-[11px] font-bold text-amber-200">إجمالي نقاط الشهر</span>
                            <span className="text-2xl font-black text-amber-300 tabular-nums">{totalMonthPoints}</span>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 space-y-6">
                {/* Scoring Legend */}
                <section className="bg-white border border-amber-200 rounded-3xl p-4 shadow-xs">
                    <div className="text-xs sm:text-sm font-black text-[#1B2A59] mb-2.5 flex items-center gap-2">
                        <Gift size={18} className="text-amber-600" /> معايير احتساب النقاط التلقائية والمكافآت:
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <span className="bg-emerald-50 text-emerald-900 border border-emerald-200 px-3 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1.5"><Calendar size={14} className="text-emerald-700" /> حضور الخدمة: +10</span>
                        <span className="bg-blue-50 text-blue-900 border border-blue-200 px-3 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1.5"><Church size={14} className="text-blue-700" /> حضور القداس: +15</span>
                        <span className="bg-violet-50 text-violet-900 border border-violet-200 px-3 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1.5"><Music size={14} className="text-violet-700" /> حضور التسبحة: +10</span>
                        <span className="bg-amber-50 text-amber-900 border border-amber-200 px-3 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1.5"><Sparkles size={14} className="text-amber-700" /> التزام وهدوء: +5</span>
                        <span className="bg-indigo-50 text-indigo-900 border border-indigo-200 px-3 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1.5"><BookOpen size={14} className="text-indigo-700" /> حفظ ومشاركة: +10</span>
                        <span className="bg-teal-50 text-teal-900 border border-teal-200 px-3 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1.5"><Church size={14} className="text-teal-700" /> حضور مبكر: +5</span>
                    </div>
                </section>

                {/* Top 3 Golden Podium */}
                {topThree.length > 0 && (
                    <section className="bg-linear-to-br from-[#1B2A59] via-[#22346E] to-[#132046] rounded-[2rem] p-5 sm:p-7 text-white shadow-xl border border-amber-400/35">
                        <div className="flex items-center justify-between gap-2 mb-6">
                            <h2 className="font-calligraphic text-2xl sm:text-3xl font-bold text-amber-300 flex items-center gap-2">
                                <Crown size={28} className="text-amber-400" /> لوحة الشرف والأوائل — {formatArabicMonthKey(selectedMonth)}
                            </h2>
                            <span className="text-xs font-black bg-amber-400/20 text-amber-200 border border-amber-400/40 px-3 py-1 rounded-full">
                                أبطال المواظبة والتميز
                            </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                            {/* Reorder visually on desktop: 2nd, 1st (tallest center), 3rd */}
                            {[
                                { item: topThree[1], medal: <Medal size={34} className="text-slate-200 mx-auto" />, place: 'المركز الثاني', orderCls: 'sm:order-1', cardCls: 'bg-slate-200/15 border-slate-300/40 sm:py-6' },
                                { item: topThree[0], medal: <Crown size={38} className="text-amber-300 mx-auto" />, place: 'المركز الأول', orderCls: 'sm:order-2', cardCls: 'bg-linear-to-b from-amber-400/30 to-amber-600/20 border-amber-300 shadow-[0_0_30px_rgba(245,158,11,0.25)] sm:py-8' },
                                { item: topThree[2], medal: <Medal size={34} className="text-amber-400 mx-auto" />, place: 'المركز الثالث', orderCls: 'sm:order-3', cardCls: 'bg-orange-400/15 border-orange-300/40 sm:py-5' }
                            ].map(({ item, medal, place, orderCls, cardCls }) => {
                                if (!item) return null;
                                return (
                                    <div
                                        key={item.childId}
                                        onClick={() => setActiveChildModal(item)}
                                        className={`${orderCls} ${cardCls} border-2 rounded-3xl p-5 text-center flex flex-col items-center cursor-pointer hover:scale-[1.02] transition-all`}
                                    >
                                        <div className="text-4xl mb-2 animate-bounce" style={{ animationDuration: '2.8s' }}>{medal}</div>
                                        <span className="text-xs font-black text-amber-200 bg-black/25 px-3 py-0.5 rounded-full mb-2">
                                            {place}
                                        </span>
                                        <h3 className="text-lg sm:text-xl font-black text-white leading-snug line-clamp-1">{item.name}</h3>
                                        <span className="text-xs font-bold text-indigo-200 mt-1">{item.syncKey}</span>
                                        <div className="mt-3 bg-white text-[#1B2A59] px-5 py-1.5 rounded-2xl font-black text-xl tabular-nums shadow-md">
                                            {item.totalPoints} <span className="text-xs font-bold">نقطة</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* Search & Full Ranked List */}
                <section className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <h2 className="text-lg sm:text-xl font-black text-[#1B2A59] flex items-center gap-2">
                            <Medal size={22} className="text-amber-600" /> الترتيب الكامل وتجميع النقاط ({filteredLeaderboard.length})
                        </h2>
                        <div className="relative w-full sm:w-80">
                            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="ابحث بالاسم أو الفصل..."
                                className="w-full min-h-[44px] pr-10 pl-4 py-2 rounded-2xl bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
                            />
                        </div>
                    </div>

                    {filteredLeaderboard.length === 0 ? (
                        <div className="bg-white rounded-3xl p-10 text-center border border-slate-200">
                            <Trophy size={42} className="mx-auto text-slate-300 mb-3" />
                            <p className="text-base font-black text-slate-700">لا توجد نقاط مسجلة في هذا النطاق بعد.</p>
                            <p className="text-sm font-bold text-slate-500 mt-1">سجّل الحضور أو اضغط على أي مخدوم لمنحه نقاط مكافأة!</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-3">
                            {filteredLeaderboard.map((row) => {
                                const rankBadge = row.rank === 1 ? <Crown size={20} className="text-amber-500 mx-auto" /> : row.rank === 2 ? <Medal size={20} className="text-slate-400 mx-auto" /> : row.rank === 3 ? <Medal size={20} className="text-amber-700 mx-auto" /> : `#${row.rank}`;
                                return (
                                    <div
                                        key={row.childId}
                                        className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-xs hover:border-amber-300 hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                                    >
                                        <div className="flex items-center gap-3.5 min-w-0">
                                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shrink-0 ${
                                                row.rank <= 3 ? 'bg-amber-100 text-amber-900 border border-amber-300 text-2xl' : 'bg-slate-100 text-[#1B2A59]'
                                            }`}>
                                                {rankBadge}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <h3 className="font-black text-base sm:text-lg text-slate-900 truncate">{row.name}</h3>
                                                    <span className="text-xs font-bold bg-indigo-50 text-[#1B2A59] border border-indigo-100 px-2.5 py-0.5 rounded-lg">
                                                        {row.syncKey}
                                                    </span>
                                                </div>
                                                <div className="flex flex-wrap gap-1.5 mt-2">
                                                    {row.breakdown.attendance > 0 && (
                                                        <span className="text-[11px] font-bold bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded-md">خدمة: +{row.breakdown.attendance}</span>
                                                    )}
                                                    {row.breakdown.liturgy > 0 && (
                                                        <span className="text-[11px] font-bold bg-blue-50 text-blue-800 px-2 py-0.5 rounded-md">قداس: +{row.breakdown.liturgy}</span>
                                                    )}
                                                    {row.breakdown.memorization > 0 && (
                                                        <span className="text-[11px] font-bold bg-indigo-50 text-indigo-800 px-2 py-0.5 rounded-md">حفظ: +{row.breakdown.memorization}</span>
                                                    )}
                                                    {row.breakdown.behavior > 0 && (
                                                        <span className="text-[11px] font-bold bg-amber-50 text-amber-900 px-2 py-0.5 rounded-md">التزام: +{row.breakdown.behavior}</span>
                                                    )}
                                                    {(row.breakdown.early > 0 || row.breakdown.custom > 0 || row.breakdown.tasbeha > 0) && (
                                                        <span className="text-[11px] font-bold bg-violet-50 text-violet-800 px-2 py-0.5 rounded-md">
                                                            إضافي/تسبحة: +{(row.breakdown.early || 0) + (row.breakdown.custom || 0) + (row.breakdown.tasbeha || 0)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => handleQuickRewardRow(row, POINTS_PRESETS.DISCIPLINE)}
                                                className="min-h-[40px] bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-200 px-2.5 py-1.5 rounded-xl text-xs font-black cursor-pointer"
                                            >
                                                <span className="inline-flex items-center gap-1"><Sparkles size={12} /> +5</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleQuickRewardRow(row, POINTS_PRESETS.MEMORIZATION)}
                                                className="min-h-[40px] bg-indigo-50 hover:bg-indigo-100 text-indigo-950 border border-indigo-200 px-2.5 py-1.5 rounded-xl text-xs font-black cursor-pointer"
                                            >
                                                <span className="inline-flex items-center gap-1"><BookOpen size={12} /> +10</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setActiveChildModal(row)}
                                                className="min-h-[42px] bg-[#1B2A59] hover:bg-slate-900 text-white px-4 py-2 rounded-2xl text-xs sm:text-sm font-black flex items-center gap-2 cursor-pointer transition-colors"
                                            >
                                                <Plus size={15} className="text-amber-300" />
                                                <span className="tabular-nums font-black text-amber-300 text-base">{row.totalPoints}</span>
                                                <span>نقطة</span>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </main>

            <PointsManagerModal
                isOpen={Boolean(modalChildRow)}
                onClose={() => setActiveChildModal(null)}
                child={modalChildRow?.child}
                monthKey={selectedMonth}
                childLogs={modalChildRow?.recentLogs || []}
                totalPoints={modalChildRow?.totalPoints || 0}
            />
            <BottomNav />
        </div>
    );
}
