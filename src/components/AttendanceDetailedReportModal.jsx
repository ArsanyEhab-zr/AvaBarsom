import React, { useMemo, useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import * as XLSX from 'xlsx';
import {
    X,
    Church,
    BookOpen,
    Sparkles,
    MessageCircle,
    Phone,
    Copy,
    Check,
    Download,
    CheckCircle2,
    XCircle,
    FileText,
    Trophy,
    AlertTriangle,
    Calendar,
    Users
} from 'lucide-react';
import { db } from '../db/database';
import { getServiceWeekRange } from '../utils/serviceWeek';
import { getValidatedClassAttendance, isAttendanceRecordPresent } from '../utils/churchDataEngine';
import { resolveAttendanceChild } from '../utils/childIdentity';
import { getExcelReportFilename } from '../utils/tenantConfig';

function buildStatusBadge(status) {
    if (status === 'present') {
        return {
            text: 'حضر',
            cls: 'bg-emerald-50 text-emerald-800 border-emerald-200'
        };
    }
    if (status === 'excused') {
        return {
            text: 'غياب بعذر',
            cls: 'bg-amber-50 text-amber-800 border-amber-200'
        };
    }
    if (status === 'absent') {
        return {
            text: 'غاب',
            cls: 'bg-rose-50 text-rose-700 border-rose-200'
        };
    }
    return {
        text: 'لم يُسجل بعد',
        cls: 'bg-slate-100 text-slate-600 border-slate-200'
    };
}

function getComparisonMeta(serviceStatus, liturgyStatus) {
    const srvPresent = serviceStatus === 'present';
    const litPresent = liturgyStatus === 'present';
    const srvAbsent = serviceStatus === 'absent';
    const litAbsent = liturgyStatus === 'absent';
    if (srvPresent && litPresent) return { key: 'both_present', label: 'حضر الخدمة والقداس معاً' };
    if (srvPresent && litAbsent) return { key: 'service_only', label: 'حضر الخدمة وغاب عن القداس' };
    if (srvPresent && !litAbsent) return { key: 'service_only', label: 'حضر الخدمة (القداس لم يُسجل)' };
    if (srvAbsent && litPresent) return { key: 'liturgy_only', label: 'حضر القداس وغاب عن الخدمة' };
    if (!srvAbsent && litPresent) return { key: 'liturgy_only', label: 'حضر القداس (الخدمة لم تُسجل)' };
    if (srvAbsent && litAbsent) return { key: 'both_absent', label: 'غاب عن الخدمة والقداس' };
    if (srvAbsent) return { key: 'both_absent', label: 'غاب عن الخدمة' };
    if (litAbsent) return { key: 'both_absent', label: 'غاب عن القداس' };
    return { key: 'unmarked', label: 'لم يُسجل بعد' };
}

/**
 * Interactive Service & Liturgy Attendance / Absence Comparison Modal.
 * Aggregates both Service and Friday Liturgy records across the active Thursday-Wednesday service week.
 */
export default function AttendanceDetailedReportModal({
    isOpen,
    initialTab = 'service',
    initialSubFilter = 'all',
    onClose,
    childrenList = [],
    canonicalData,
    selectedDate,
    className = '',
    activeSyncKey = '',
    monthlyPointsByChildId = new Map(),
    getTargetPhone,
    cleanPhoneNumber
}) {
    const [activeTab, setActiveTab] = useState(initialTab);
    const [subFilter, setSubFilter] = useState(initialSubFilter);
    const [combinedFilter, setCombinedFilter] = useState('all');
    const [copiedToast, setCopiedToast] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setActiveTab(initialTab || 'service');
            setSubFilter(initialSubFilter || 'all');
            setCombinedFilter('all');
            setCopiedToast(false);
        }
    }, [isOpen, initialTab, initialSubFilter]);

    const weekRange = useMemo(() => {
        const parsed = selectedDate ? new Date(`${selectedDate}T12:00:00`) : new Date();
        return getServiceWeekRange(Number.isNaN(parsed.getTime()) ? new Date() : parsed);
    }, [selectedDate]);

    const weekAttendance = useLiveQuery(
        () => (isOpen
            ? db.attendance.where('date').between(weekRange.startDate, weekRange.endDate, true, true).toArray()
            : []),
        [isOpen, weekRange.startDate, weekRange.endDate]
    ) || [];

    const reportData = useMemo(() => {
        const validatedWeek = getValidatedClassAttendance(weekAttendance, canonicalData, {
            targetSyncKey: activeSyncKey,
            startDate: weekRange.startDate,
            endDate: weekRange.endDate
        });

        // Resolve per-(childId, type) explicit status/notes prioritizing exact selectedDate then week latest
        const detailMap = new Map();
        const sortedRecords = [...weekAttendance]
            .filter(r => r && !r.isDeleted && r.type)
            .sort((a, b) => {
                const aExact = a.date === selectedDate ? 1 : 0;
                const bExact = b.date === selectedDate ? 1 : 0;
                if (aExact !== bExact) return aExact - bExact;
                const tA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
                const tB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
                return tA - tB;
            });

        for (const rec of sortedRecords) {
            const childObj = resolveAttendanceChild(rec, canonicalData);
            if (!childObj) continue;
            detailMap.set(`${String(childObj.id)}::${rec.type}`, rec);
        }

        const rows = (childrenList || []).map(child => {
            const idStr = String(child.id).trim();
            const srvRec = detailMap.get(`${idStr}::service`) || detailMap.get(`${idStr}::service_meeting`);
            const litRec = detailMap.get(`${idStr}::liturgy`);
            const childWeekStats = validatedWeek.byChild?.[idStr] || null;

            const serviceStatus = validatedWeek.servicePresentIds.has(idStr)
                ? 'present'
                : (validatedWeek.explicitAbsentServiceIds.has(idStr)
                    ? 'absent'
                    : (srvRec && !isAttendanceRecordPresent(srvRec) && srvRec.status === 'excused' ? 'excused' : 'unmarked'));

            const liturgyStatus = validatedWeek.liturgyPresentIds.has(idStr)
                ? 'present'
                : (validatedWeek.explicitAbsentLiturgyIds?.has(idStr)
                    ? 'absent'
                    : (litRec && !isAttendanceRecordPresent(litRec) && litRec.status === 'excused' ? 'excused' : 'unmarked'));

            const rawPhone = getTargetPhone ? getTargetPhone(child) : (child.childPhone || child.fatherPhone || child.motherPhone || child.phone || '');
            const waPhone = cleanPhoneNumber ? cleanPhoneNumber(rawPhone) : String(rawPhone || '').replace(/\D/g, '');
            const points = monthlyPointsByChildId.get(idStr) || 0;
            const comparison = getComparisonMeta(serviceStatus, liturgyStatus);

            return {
                child,
                id: idStr,
                name: child.name || 'بدون اسم',
                phone: rawPhone,
                waPhone,
                points,
                serviceStatus,
                liturgyStatus,
                servicePresentCount: childWeekStats?.servicePresentCount || 0,
                serviceAbsentCount: childWeekStats?.serviceAbsentCount || 0,
                serviceAbsentEvents: (childWeekStats?.absentEvents || []).filter(e => e.type === 'service' || e.type === 'service_meeting'),
                serviceExcuse: srvRec?.excuseReason || srvRec?.note || '',
                liturgyExcuse: litRec?.excuseReason || litRec?.note || '',
                comparisonKey: comparison.key,
                comparisonLabel: comparison.label
            };
        });

        const servicePresent = rows.filter(r => r.serviceStatus === 'present');
        const serviceAbsent = rows.filter(r => r.serviceStatus === 'absent' || r.serviceAbsentCount > 0);
        const serviceUnmarked = rows.filter(r => r.serviceStatus === 'unmarked' && r.serviceAbsentCount === 0);
        const liturgyPresent = rows.filter(r => r.liturgyStatus === 'present');
        const liturgyAbsent = rows.filter(r => r.liturgyStatus === 'absent');
        const liturgyUnmarked = rows.filter(r => r.liturgyStatus === 'unmarked');
        const bothPresent = rows.filter(r => r.comparisonKey === 'both_present');
        const serviceOnly = rows.filter(r => r.comparisonKey === 'service_only');
        const liturgyOnly = rows.filter(r => r.comparisonKey === 'liturgy_only');
        const bothAbsent = rows.filter(r => r.comparisonKey === 'both_absent');

        return {
            rows,
            servicePresent,
            serviceAbsent,
            serviceUnmarked,
            liturgyPresent,
            liturgyAbsent,
            liturgyUnmarked,
            bothPresent,
            serviceOnly,
            liturgyOnly,
            bothAbsent
        };
    }, [weekAttendance, canonicalData, activeSyncKey, weekRange.startDate, weekRange.endDate, selectedDate, childrenList, getTargetPhone, cleanPhoneNumber, monthlyPointsByChildId]);

    const combinedFilteredRows = useMemo(() => {
        if (combinedFilter === 'both_present') return reportData.bothPresent;
        if (combinedFilter === 'service_only') return reportData.serviceOnly;
        if (combinedFilter === 'liturgy_only') return reportData.liturgyOnly;
        if (combinedFilter === 'both_absent') return reportData.bothAbsent;
        return reportData.rows;
    }, [combinedFilter, reportData]);

    if (!isOpen) return null;

    const buildWhatsappMissingHref = (row, sessionLabel) => {
        const firstName = (row.name || '').split(' ')[0] || 'مخدومنا';
        const prefix = row.child?.gender === 'بنت' ? 'مخدومتنا' : 'مخدومنا';
        const msg = `سلام ونعمة يا ${prefix} ${firstName}\nافتقدناك جداً في ${sessionLabel} (أسبوع ${selectedDate})، مكانك غالي وسطينا ومستنيينك الأسبوع الجاي في الكنيسة!`;
        return `https://wa.me/${row.waPhone}?text=${encodeURIComponent(msg)}`;
    };

    const handleCopyWhatsappText = async () => {
        const headerTitle = className || activeSyncKey || 'الفصل';
        const lines = [
            `*تقرير الحضور والغياب — ${headerTitle}*`,
            `أسبوع الخدمة: ${weekRange.startDate} إلى ${weekRange.endDate}`,
            `إجمالي المخدومين: ${reportData.rows.length}`,
            '',
            `*الخدمة:* حضر (${reportData.servicePresent.length}) | غاب (${reportData.serviceAbsent.length})`,
            `الحاضرون في الخدمة:`,
            ...(reportData.servicePresent.length > 0 ? reportData.servicePresent.map((r, i) => `${i + 1}. ${r.name}`) : ['— لا يوجد —']),
            '',
            `الغائبون عن الخدمة (للافتقاد):`,
            ...(reportData.serviceAbsent.length > 0 ? reportData.serviceAbsent.map((r, i) => `${i + 1}. ${r.name}${r.serviceStatus === 'excused' ? ' (بعذر)' : ''}`) : ['— لا يوجد غياب —']),
            '',
            `*القداس:* حضر (${reportData.liturgyPresent.length}) | غاب (${reportData.liturgyAbsent.length})`,
            `الغائبون عن القداس:`,
            ...(reportData.liturgyAbsent.length > 0 ? reportData.liturgyAbsent.map((r, i) => `${i + 1}. ${r.name}`) : ['— لا يوجد غياب —']),
            '',
            `*حضر الخدمة والقداس معاً:* ${reportData.bothPresent.length} مخدوم`,
            `*غاب عن الخدمة والقداس معاً:* ${reportData.bothAbsent.length} مخدوم`
        ];
        const fullText = lines.join('\n');

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(fullText);
            } else {
                const ta = document.createElement('textarea');
                ta.value = fullText;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            setCopiedToast(true);
            setTimeout(() => setCopiedToast(false), 2600);
        } catch (err) {
            console.error('Copy failed:', err);
            alert('تعذر نسخ النص تلقائياً.');
        }
    };

    const handleExportExcel = () => {
        const sheetRows = reportData.rows.map((r, idx) => ({
            'م': idx + 1,
            'اسم المخدوم': r.name,
            'الفصل': r.child?.syncKey || className || activeSyncKey,
            'الهاتف': r.phone || '',
            'حضور الخدمة': r.serviceStatus === 'present' ? 'حاضر' : r.serviceStatus === 'excused' ? 'بعذر' : r.serviceStatus === 'absent' ? 'غائب' : 'لم يُسجل بعد',
            'حضور القداس': r.liturgyStatus === 'present' ? 'حاضر' : r.liturgyStatus === 'excused' ? 'بعذر' : r.liturgyStatus === 'absent' ? 'غائب' : 'لم يُسجل بعد',
            'التقرير المقارن': r.comparisonLabel.replace(/^[^\u0600-\u06FF]+\s*/, ''),
            'نقاط الشهر': r.points,
            'ملاحظات / عذر': r.serviceExcuse || r.liturgyExcuse || ''
        }));

        const worksheet = XLSX.utils.json_to_sheet(sheetRows);
        worksheet['!cols'] = [
            { wch: 5 },
            { wch: 28 },
            { wch: 20 },
            { wch: 16 },
            { wch: 15 },
            { wch: 15 },
            { wch: 30 },
            { wch: 12 },
            { wch: 25 }
        ];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'تقرير_الخدمة_والقداس');
        XLSX.writeFile(workbook, getExcelReportFilename(`تقرير_من_حضر_ومن_غاب_${className || 'الفصل'}`));
    };

    const renderAvatar = (row) => {
        if (row.child?.profilePic) {
            return (
                <img
                    src={row.child.profilePic}
                    alt={row.name}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    className="w-10 h-10 rounded-full object-cover border border-[#DFC48F] shrink-0"
                />
            );
        }
        return (
            <div className="w-10 h-10 rounded-full bg-[#EFE0C2] text-[#1B2A59] border border-[#DFC48F] flex items-center justify-center font-black text-sm shrink-0">
                {row.name.charAt(0)}
            </div>
        );
    };

    const renderPersonActionRow = (row, statusTypeLabel, isAbsentRow) => (
        <div
            key={`${row.id}_${statusTypeLabel}_${isAbsentRow ? 'abs' : 'prs'}`}
            className="coptic-card rounded-2xl p-3 border border-[#DFC48F] flex flex-wrap items-center justify-between gap-2.5"
        >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                {renderAvatar(row)}
                <div className="min-w-0">
                    <div className="font-black text-xs sm:text-sm text-[#1B2A59] truncate">{row.name}</div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span className="inline-flex items-center gap-1 text-[10px] font-black bg-amber-100 text-[#8C621E] px-2 py-0.5 rounded-full">
                            <Trophy size={11} /> {row.points} نقطة
                        </span>
                        {row.phone && (
                            <span className="text-[10px] font-bold text-[#6E5329]" dir="ltr">
                                {row.phone}
                            </span>
                        )}
                        {isAbsentRow && (statusTypeLabel === 'الخدمة' ? row.serviceStatus === 'excused' : row.liturgyStatus === 'excused') && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-black bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full">
                                <FileText size={11} /> بعذر{(statusTypeLabel === 'الخدمة' ? row.serviceExcuse : row.liturgyExcuse) ? `: ${statusTypeLabel === 'الخدمة' ? row.serviceExcuse : row.liturgyExcuse}` : ''}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {isAbsentRow && row.waPhone && (
                <div className="flex items-center gap-1.5 shrink-0">
                    <a
                        href={buildWhatsappMissingHref(row, statusTypeLabel)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black transition-colors"
                    >
                        <MessageCircle size={13} /> واتساب افتقاد
                    </a>
                    <a
                        href={`tel:${row.phone || row.waPhone}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#1B2A59] hover:bg-[#142044] text-amber-100 text-[11px] font-black transition-colors"
                    >
                        <Phone size={12} /> اتصال
                    </a>
                </div>
            )}
        </div>
    );

    const activeServiceRows = subFilter === 'present'
        ? { present: reportData.servicePresent, absent: [] }
        : subFilter === 'absent'
            ? { present: [], absent: reportData.serviceAbsent }
            : { present: reportData.servicePresent, absent: reportData.serviceAbsent };

    const activeLiturgyRows = subFilter === 'present'
        ? { present: reportData.liturgyPresent, absent: [] }
        : subFilter === 'absent'
            ? { present: [], absent: reportData.liturgyAbsent }
            : { present: reportData.liturgyPresent, absent: reportData.liturgyAbsent };

    return (
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#111C3D]/60 backdrop-blur-sm animate-in fade-in" dir="rtl">
            <div className="bg-[#FAF3E3] w-full max-w-3xl rounded-t-3xl sm:rounded-[2rem] max-h-[92vh] flex flex-col overflow-hidden shadow-2xl border-2 border-[#DFC48F] animate-modal-enter">
                {/* Modal Royal Navy Header */}
                <div
                    className="shrink-0 p-4 sm:p-5 text-white border-b border-amber-400/25"
                    style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 72%, #8C621E 100%)' }}
                >
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="font-calligraphic text-lg sm:text-2xl font-bold text-amber-100 flex items-center gap-2">
                                <FileText size={20} className="text-amber-300 shrink-0" />
                                <span>تقرير من حضر ومن غاب (الخدمة والقداس)</span>
                            </h2>
                            <p className="text-[11px] sm:text-xs font-bold text-indigo-100/90 mt-1">
                                {className || activeSyncKey || 'الفصل'} • أسبوع الخدمة: {weekRange.startDate} ← {weekRange.endDate} (اليوم المحدد: {selectedDate})
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="إغلاق التقرير"
                            className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* 3 Interactive Report Tabs */}
                    <div className="grid grid-cols-3 gap-1.5 mt-4 bg-white/10 p-1 rounded-2xl">
                        <button
                            type="button"
                            onClick={() => setActiveTab('service')}
                            className={`py-2 px-2 rounded-xl text-[11px] sm:text-xs font-black flex items-center justify-center gap-1 transition-all cursor-pointer ${
                                activeTab === 'service' ? 'bg-amber-400 text-[#1B2A59] shadow-sm' : 'text-amber-50 hover:bg-white/10'
                            }`}
                        >
                            <BookOpen size={14} className="shrink-0" />
                            <span className="truncate">الخدمة ({reportData.servicePresent.length}/{reportData.rows.length})</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('liturgy')}
                            className={`py-2 px-2 rounded-xl text-[11px] sm:text-xs font-black flex items-center justify-center gap-1 transition-all cursor-pointer ${
                                activeTab === 'liturgy' ? 'bg-amber-400 text-[#1B2A59] shadow-sm' : 'text-amber-50 hover:bg-white/10'
                            }`}
                        >
                            <Church size={14} className="shrink-0" />
                            <span className="truncate">القداس ({reportData.liturgyPresent.length}/{reportData.rows.length})</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('combined')}
                            className={`py-2 px-2 rounded-xl text-[11px] sm:text-xs font-black flex items-center justify-center gap-1 transition-all cursor-pointer ${
                                activeTab === 'combined' ? 'bg-amber-400 text-[#1B2A59] shadow-sm' : 'text-amber-50 hover:bg-white/10'
                            }`}
                        >
                            <Sparkles size={14} className="shrink-0" />
                            <span className="truncate">المقارن الشامل</span>
                        </button>
                    </div>
                </div>

                {/* Modal Body */}
                <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
                    {(activeTab === 'service' || activeTab === 'liturgy') && (
                        <>
                            {/* Filter Pills */}
                            <div className="flex flex-wrap gap-2">
                                {(() => {
                                    const pLen = activeTab === 'service' ? reportData.servicePresent.length : reportData.liturgyPresent.length;
                                    const aLen = activeTab === 'service' ? reportData.serviceAbsent.length : reportData.liturgyAbsent.length;
                                    return [
                                        { id: 'all', label: `الكل (${reportData.rows.length})` },
                                        { id: 'present', label: `من حضر (${pLen})` },
                                        { id: 'absent', label: `من غاب (${aLen})` }
                                    ].map(pill => (
                                        <button
                                            key={pill.id}
                                            type="button"
                                            onClick={() => setSubFilter(pill.id)}
                                            className={`px-3.5 py-1.5 rounded-xl text-xs font-black border transition-colors cursor-pointer ${
                                                subFilter === pill.id
                                                    ? 'bg-[#1B2A59] text-amber-200 border-[#1B2A59]'
                                                    : 'bg-white text-[#6E5329] border-[#DFC48F] hover:bg-[#EFE0C2]'
                                            }`}
                                        >
                                            {pill.label}
                                        </button>
                                    ));
                                })()}
                            </div>

                            {(() => {
                                const cur = activeTab === 'service' ? activeServiceRows : activeLiturgyRows;
                                const sessionLabel = activeTab === 'service' ? 'الخدمة' : 'القداس';
                                return (
                                    <div className="space-y-4">
                                        {cur.present.length > 0 && (
                                            <section>
                                                <h3 className="text-xs sm:text-sm font-black text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl mb-2.5 flex items-center gap-1.5">
                                                    <CheckCircle2 size={16} />
                                                    <span>حضر {sessionLabel} ({cur.present.length} مخدوم)</span>
                                                </h3>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                                    {cur.present.map(r => renderPersonActionRow(r, sessionLabel, false))}
                                                </div>
                                            </section>
                                        )}

                                        {cur.absent.length > 0 && (
                                            <section>
                                                <h3 className="text-xs sm:text-sm font-black text-rose-800 bg-rose-50 border border-rose-200 px-3 py-2 rounded-xl mb-2.5 flex items-center gap-1.5">
                                                    <XCircle size={16} />
                                                    <span>غاب عن {sessionLabel} ({cur.absent.length} مخدوم) — للافتقاد الفوري</span>
                                                </h3>
                                                <div className="space-y-2">
                                                    {cur.absent.map(r => renderPersonActionRow(r, sessionLabel, true))}
                                                </div>
                                            </section>
                                        )}

                                        {cur.present.length === 0 && cur.absent.length === 0 && (
                                            <div className="coptic-card p-8 rounded-2xl text-center text-sm font-bold text-[#6E5329]">
                                                لا توجد سجلات مطابقة لهذا العرض.
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </>
                    )}

                    {activeTab === 'combined' && (
                        <div className="space-y-4">
                            {/* Summary KPI Pills */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setCombinedFilter(combinedFilter === 'both_present' ? 'all' : 'both_present')}
                                    className={`p-2.5 rounded-2xl border text-center transition-all cursor-pointer ${
                                        combinedFilter === 'both_present' ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    }`}
                                >
                                    <div className="text-lg font-black tabular-nums">{reportData.bothPresent.length}</div>
                                    <div className="text-[11px] font-black flex items-center justify-center gap-1"><Sparkles size={12} /> حضر الاثنين</div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setCombinedFilter(combinedFilter === 'service_only' ? 'all' : 'service_only')}
                                    className={`p-2.5 rounded-2xl border text-center transition-all cursor-pointer ${
                                        combinedFilter === 'service_only' ? 'bg-amber-600 text-white border-amber-700' : 'bg-amber-50 text-amber-800 border-amber-200'
                                    }`}
                                >
                                    <div className="text-lg font-black tabular-nums">{reportData.serviceOnly.length}</div>
                                    <div className="text-[11px] font-black flex items-center justify-center gap-1"><AlertTriangle size={12} /> خدمة فقط</div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setCombinedFilter(combinedFilter === 'liturgy_only' ? 'all' : 'liturgy_only')}
                                    className={`p-2.5 rounded-2xl border text-center transition-all cursor-pointer ${
                                        combinedFilter === 'liturgy_only' ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-indigo-50 text-[#1B2A59] border-indigo-200'
                                    }`}
                                >
                                    <div className="text-lg font-black tabular-nums">{reportData.liturgyOnly.length}</div>
                                    <div className="text-[11px] font-black flex items-center justify-center gap-1"><Church size={12} /> قداس فقط</div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setCombinedFilter(combinedFilter === 'both_absent' ? 'all' : 'both_absent')}
                                    className={`p-2.5 rounded-2xl border text-center transition-all cursor-pointer ${
                                        combinedFilter === 'both_absent' ? 'bg-rose-600 text-white border-rose-700' : 'bg-rose-50 text-rose-800 border-rose-200'
                                    }`}
                                >
                                    <div className="text-lg font-black tabular-nums">{reportData.bothAbsent.length}</div>
                                    <div className="text-[11px] font-black flex items-center justify-center gap-1"><XCircle size={12} /> غاب عن الاثنين</div>
                                </button>
                            </div>

                            {/* Quick filter bar */}
                            <div className="flex flex-wrap gap-1.5">
                                {[
                                    { id: 'all', label: `الكل (${reportData.rows.length})` },
                                    { id: 'both_present', label: `حضر الخدمة والقداس معاً (${reportData.bothPresent.length})` },
                                    { id: 'service_only', label: `حضر الخدمة وغاب عن القداس (${reportData.serviceOnly.length})` },
                                    { id: 'both_absent', label: `غاب عن الخدمة والقداس (${reportData.bothAbsent.length})` }
                                ].map(pill => (
                                    <button
                                        key={pill.id}
                                        type="button"
                                        onClick={() => setCombinedFilter(pill.id)}
                                        className={`px-3 py-1.5 rounded-xl text-[11px] font-black border transition-colors cursor-pointer ${
                                            combinedFilter === pill.id
                                                ? 'bg-[#1B2A59] text-amber-200 border-[#1B2A59]'
                                                : 'bg-white text-[#6E5329] border-[#DFC48F] hover:bg-[#EFE0C2]'
                                        }`}
                                    >
                                        {pill.label}
                                    </button>
                                ))}
                            </div>

                            {/* Comparison Rows */}
                            <div className="space-y-2.5">
                                {combinedFilteredRows.map(row => {
                                    const srvBadge = buildStatusBadge(row.serviceStatus);
                                    const litBadge = buildStatusBadge(row.liturgyStatus);
                                    const needsVisitation = row.serviceStatus !== 'present' || row.liturgyStatus !== 'present';
                                    return (
                                        <div key={row.id} className="coptic-card rounded-2xl p-3.5 border border-[#DFC48F] flex flex-wrap items-center justify-between gap-3">
                                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                {renderAvatar(row)}
                                                <div className="min-w-0">
                                                    <div className="font-black text-xs sm:text-sm text-[#1B2A59] truncate">{row.name}</div>
                                                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg border ${srvBadge.cls}`}>
                                                            الخدمة: {srvBadge.text}
                                                        </span>
                                                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg border ${litBadge.cls}`}>
                                                            القداس: {litBadge.text}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-1.5 shrink-0">
                                                {needsVisitation && row.waPhone && (
                                                    <>
                                                        <a
                                                            href={buildWhatsappMissingHref(row, 'الخدمة والقداس')}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black"
                                                        >
                                                            <MessageCircle size={13} /> افتقاد
                                                        </a>
                                                        <a
                                                            href={`tel:${row.phone || row.waPhone}`}
                                                            className="w-8 h-8 rounded-xl bg-[#1B2A59] text-amber-100 flex items-center justify-center"
                                                            title="اتصال"
                                                        >
                                                            <Phone size={13} />
                                                        </a>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                {combinedFilteredRows.length === 0 && (
                                    <div className="coptic-card p-8 rounded-2xl text-center text-sm font-bold text-[#6E5329]">
                                        لا توجد حالات مطابقة لهذه التصفية في الأسبوع المحدد.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Modal Footer Actions (Copy WhatsApp Text + Export Excel) */}
                <div className="shrink-0 p-3.5 sm:p-4 bg-white/90 border-t border-[#DFC48F] flex flex-wrap items-center justify-between gap-2.5">
                    <button
                        type="button"
                        onClick={handleCopyWhatsappText}
                        className="flex-1 min-h-[44px] px-3.5 py-2 rounded-2xl bg-[#1B2A59] hover:bg-[#142044] text-amber-100 font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                    >
                        {copiedToast ? <><Check size={16} className="text-emerald-300" /> تم نسخ التقرير للواتساب</> : <><Copy size={15} /> نسخ التقرير نصياً للواتساب</>}
                    </button>
                    <button
                        type="button"
                        onClick={handleExportExcel}
                        className="flex-1 min-h-[44px] px-3.5 py-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                    >
                        <Download size={15} /> تصدير التقرير Excel
                    </button>
                </div>
            </div>
        </div>
    );
}
