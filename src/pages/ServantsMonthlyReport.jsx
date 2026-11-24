import React, { useState, useEffect, useMemo } from 'react';
import { 
    Printer, 
    ArrowRight, 
    Calendar, 
    Filter, 
    Loader2, 
    Users, 
    Download, 
    CheckCircle2, 
    XCircle,
    Clock,
    BarChart3,
    UserMinus, 
    UserX, 
    TrendingUp,
    FileSpreadsheet,
    CalendarRange,
    RefreshCw
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { firestore } from '../db/firebase';
import { getReportHeaderTitle, getExcelReportFilename,
    readScopedStorage
} from '../utils/tenantConfig';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
import * as XLSX from 'xlsx';

const cleanPhone = (p) => String(p || '').replace(/\D/g, '').replace(/^0+/, '');
const cleanName = (n) => String(n || '').trim().replace(/[إأآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');

// Helper to strictly exclude Priests (الآباء الكهنة) from servants attendance roster
const isPriestRecord = (s) => {
    if (!s) return false;
    if (s.role === 'priest' || s.isPriest === true || s.role === 'كاهن' || s.role === 'الاب الكاهن') return true;
    const name = String(s.name || '').trim();
    return name.startsWith('أبونا') || name.startsWith('ابونا') || name.startsWith('القمص') || name.startsWith('القس');
};

const getActiveAppSettingsServants = () => {
    try {
        const appSettingsStr = readScopedStorage('appSettings');
        if (!appSettingsStr) return [];
        const appSettings = JSON.parse(appSettingsStr);
        return Array.isArray(appSettings.servants) ? appSettings.servants : [];
    } catch {
        return [];
    }
};

const matchServantRecord = (filteredServants, data, docId = '', aliasMap = {}) => {
    const docIdSuffix = docId.includes('_') ? docId.split('_').slice(1).join('_') : docId;
    const cleanDPhone = cleanPhone(data.phone || data.uid || docIdSuffix);
    const cleanDName = cleanName(data.name);
    const aliasPhone = aliasMap[data.uid] || aliasMap[docIdSuffix];

    return filteredServants.find(s => {
        if (s.uid && (data.uid === s.uid || docIdSuffix === s.uid)) return true;
        if (s.id && (String(data.id) === String(s.id) || String(data.uid) === String(s.id))) return true;
        const sPhone = cleanPhone(s.phone);
        if (sPhone && (cleanDPhone === sPhone || (aliasPhone && sPhone === aliasPhone))) return true;
        if (s.name && data.name && cleanName(s.name) === cleanDName) return true;
        return false;
    });
};

const aggregateServantsReport = (filteredServants, attendanceByServant, sortedMeetingDates) => {
    return filteredServants.map((s, idx) => {
        const sKey = String(s.id || s.uid || s.phone || s.name);
        const records = attendanceByServant[sKey] || [];
        records.sort((a, b) => (a.weekDate || '').localeCompare(b.weekDate || ''));

        const datesMap = {};
        records.forEach(r => {
            if (r.weekDate) {
                const val = r.attendance || r.status;
                datesMap[r.weekDate] = (val === 'present' ? 'حضور' : val === 'excused' ? 'اعتذار' : val === 'absent' ? 'غياب' : val);
            }
        });

        const presentCount = records.filter(r => r.attendance === 'حضور' || r.attendance === 'حاضر' || r.attendance === 'present' || r.status === 'present' || r.status === 'حضور').length;
        const excusedCount = records.filter(r => r.attendance === 'اعتذار' || r.attendance === 'معتذر' || r.attendance === 'excused' || r.status === 'excused' || r.status === 'اعتذار').length;
        const absentCount = records.filter(r => r.attendance === 'غياب' || r.attendance === 'غائب' || r.attendance === 'absent' || r.status === 'absent' || r.status === 'غياب').length;

        const totalTrackedMeetings = sortedMeetingDates.length > 0 ? sortedMeetingDates.length : (presentCount + excusedCount + absentCount);
        const attendancePercentage = totalTrackedMeetings > 0
            ? Math.round((presentCount / totalTrackedMeetings) * 100)
            : 0;

        const liturgyCount = records.filter(r => r.liturgy).length;
        const prepCount = records.filter(r => r.preparation).length;
        const serviceMeetingCommitmentCount = records.filter(r => r.meeting).length;
        const visitationCount = records.filter(r => r.visitation).length;
        const serviceActivityCount = records.filter(r => r.activitiesService).length;
        const dioceseActivityCount = records.filter(r => r.activitiesDiocese && r.activitiesDiocese.trim() !== "").length;

        let confessionDate = s.confessionDate || "";
        let activitiesDiocese = "";
        let tasks = "";
        records.forEach(r => {
            if (r.confessionDate) confessionDate = r.confessionDate;
            if (r.activitiesDiocese) activitiesDiocese = r.activitiesDiocese;
            if (r.tasks) tasks = r.tasks;
        });

        const notesList = [];
        records.forEach(r => {
            if (r.excuseNote) {
                notesList.push({ date: r.weekDate, label: 'اعتذار', text: r.excuseNote });
            }
            if (r.leaderNotes) {
                notesList.push({ date: r.weekDate, label: 'أمين الخدمة', text: r.leaderNotes });
            }
        });

        const canonicalId = s.id || s.uid || sKey || `servant-${idx}`;

        return {
            id: canonicalId,
            index: idx + 1,
            name: s.name,
            phone: s.phone || '',
            osraName: s.osraName || s.assignedOsra || 'غير محدد',
            datesMap,
            presentCount,
            excusedCount,
            absentCount,
            attendancePercentage,
            totalTrackedMeetings,
            liturgyCount,
            prepCount,
            serviceMeetingCommitmentCount,
            visitationCount,
            visitationText: records.some(r => r.visitation) ? 'نعم' : 'لا',
            serviceActivityCount,
            activitiesServiceText: records.some(r => r.activitiesService) ? 'نعم' : 'لا',
            dioceseActivityCount,
            activitiesDiocese: activitiesDiocese || (dioceseActivityCount > 0 ? `${dioceseActivityCount} مشاركة` : '-'),
            confessionDate: confessionDate || '-',
            tasks: tasks || '-',
            notesList,
            allNotesText: notesList.map(n => `[${n.date} ${n.label}]: ${n.text}`).join(' | ')
        };
    });
};

import { useSmartNavigation } from '../hooks/useSmartNavigation';

export default function ServantsMonthlyReport() {
    const { goBack } = useSmartNavigation();
    const navigate = useNavigate();
    
    const getCurrentMonthYear = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    const getTodayDate = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const getFirstDayOfMonth = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    };

    // Filter states
    const [periodMode, setPeriodMode] = useState('monthly'); // 'monthly' | 'custom' | 'yearly'
    const [monthYear, setMonthYear] = useState(getCurrentMonthYear());
    const [fromDate, setFromDate] = useState(getFirstDayOfMonth());
    const [toDate, setToDate] = useState(getTodayDate());
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
    const [osraFilter, setOsraFilter] = useState("الكل");

    const getOsraName = (key) => {
        if (!key || key === 'الكل') return key || "غير محدد";
        try {
            const settings = JSON.parse(readScopedStorage('appSettings')) || {};
            const services = settings.services || [];
            let foundName = key;
            services.forEach(service => {
                const foundOsra = (service.osras || []).find(o => String(o.syncKey).trim() === String(key).trim());
                if (foundOsra) foundName = foundOsra.name;
            });
            return foundName;
        } catch(e) {
            return key;
        }
    };
    
    const [reportData, setReportData] = useState([]);
    const [uniqueMeetingDates, setUniqueMeetingDates] = useState([]);
    const [uniqueOsras, setUniqueOsras] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isExportingExcel, setIsExportingExcel] = useState(false);

    // Human readable active period description
    const activePeriodLabel = useMemo(() => {
        if (periodMode === 'monthly') {
            const [y, m] = monthYear.split('-');
            const monthsAr = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
            const mName = monthsAr[parseInt(m, 10) - 1] || m;
            return `شهر ${mName} ${y}`;
        }
        if (periodMode === 'custom') {
            return `الفترة من ${fromDate} إلى ${toDate}`;
        }
        return `عام ${selectedYear}`;
    }, [periodMode, monthYear, fromDate, toDate, selectedYear]);

    useEffect(() => {
        const fetchReport = async () => {
            setIsLoading(true);
            try {
                const rangeStart = periodMode === 'monthly'
                    ? `${monthYear}-01`
                    : periodMode === 'custom'
                        ? (fromDate || getFirstDayOfMonth())
                        : `${selectedYear}-01-01`;
                const rangeEnd = periodMode === 'monthly'
                    ? `${monthYear}-31`
                    : periodMode === 'custom'
                        ? (toDate || getTodayDate())
                        : `${selectedYear}-12-31`;

                const accessScope = resolveUserAccessScope(null, [], { includeFallback: true });
                const allowedKeysSet = new Set(accessScope.allowedSyncKeys || []);
                const allowedNamesSet = new Set((accessScope.allowedOsras || []).map(o => String(o.name || '').trim()).filter(Boolean));
                const isServantInScope = (s) => {
                    if (accessScope.isSuperAdmin) return true;
                    const sk = String(s?.syncKey || '').trim();
                    const on = String(s?.osraName || s?.assignedOsra || '').trim();
                    if (allowedKeysSet.has(sk) || allowedKeysSet.has(on) || allowedNamesSet.has(on)) return true;
                    if (Array.isArray(s?.allowedClasses) && s.allowedClasses.some(k => allowedKeysSet.has(String(k || '').trim()))) return true;
                    return false;
                };

                // 1. Offline / Demo localStorage mode
                if (!firestore) {
                    const demoServants = getActiveAppSettingsServants().filter(s => !isPriestRecord(s) && isServantInScope(s));
                    const osras = new Set();
                    demoServants.forEach(s => {
                        s.osraName = s.osraName || s.assignedOsra || s.syncKey || "غير محدد";
                        if (s.osraName !== "MASTER_ACCESS" && s.osraName !== "ADMIN_MODE" && s.osraName !== "STAGE_ADMIN") {
                            osras.add(s.osraName);
                        }
                    });
                    setUniqueOsras(Array.from(osras));

                    const filteredServants = osraFilter === "الكل"
                        ? demoServants
                        : demoServants.filter(s => (s.osraName === osraFilter || s.assignedOsra === osraFilter));

                    const attendanceByServant = {};
                    const meetingDatesSet = new Set();
                    const seenKeys = new Set();

                    const pushLocalRecord = (rawRecord, docId = '') => {
                        if (!rawRecord || !rawRecord.weekDate) return;
                        if (rawRecord.weekDate < rangeStart || rawRecord.weekDate > rangeEnd) return;
                        meetingDatesSet.add(rawRecord.weekDate);
                        const matchedServant = matchServantRecord(filteredServants, rawRecord, docId);
                        if (matchedServant) {
                            const sKey = String(matchedServant.id || matchedServant.uid || matchedServant.phone || matchedServant.name);
                            const dedupe = `${rawRecord.weekDate}_${sKey}`;
                            if (seenKeys.has(dedupe)) return;
                            seenKeys.add(dedupe);
                            if (!attendanceByServant[sKey]) attendanceByServant[sKey] = [];
                            attendanceByServant[sKey].push(rawRecord);
                        }
                    };

                    try {
                        for (let i = 0; i < localStorage.length; i++) {
                            const key = localStorage.key(i);
                            if (!key) continue;
                            if (key.startsWith('demo_servants_attendance_')) {
                                const dateStr = key.replace('demo_servants_attendance_', '');
                                if (dateStr >= rangeStart && dateStr <= rangeEnd) {
                                    const obj = JSON.parse(localStorage.getItem(key) || '{}');
                                    Object.entries(obj).forEach(([k, rec]) => {
                                        if (rec) pushLocalRecord({ ...rec, weekDate: rec.weekDate || dateStr }, `${dateStr}_${rec.uid || rec.id || k}`);
                                    });
                                }
                            } else if (key.startsWith('servantSelfCheckIn_')) {
                                const docId = key.replace('servantSelfCheckIn_', '');
                                const rec = JSON.parse(localStorage.getItem(key) || 'null');
                                if (rec) pushLocalRecord(rec, docId);
                            }
                        }
                    } catch (err) {
                        console.error("Error reading local servant attendance:", err);
                    }

                    const sortedMeetingDates = Array.from(meetingDatesSet).sort();
                    setUniqueMeetingDates(sortedMeetingDates);
                    setReportData(aggregateServantsReport(filteredServants, attendanceByServant, sortedMeetingDates));
                    setIsLoading(false);
                    return;
                }

                // 2. Cloud Firestore mode
                let baseServants = [];
                const configSnap = await getDoc(doc(firestore, 'System', 'mainConfig'));
                if (configSnap.exists()) {
                    baseServants = configSnap.data().servants || [];
                }
                const servantsSnap = await getDocs(collection(firestore, "servants"));
                servantsSnap.forEach(docSnap => {
                    if (!baseServants.find(s => s.phone === docSnap.data().phone)) {
                        baseServants.push({ ...docSnap.data(), uid: docSnap.id });
                    }
                });

                // Exclude Priests (الآباء الكهنة) and filter by 4-tier RBAC scope
                baseServants = baseServants.filter(s => !isPriestRecord(s) && isServantInScope(s));

                // Exclude deleted servants if appSettings exists in localStorage
                try {
                    const activeServants = getActiveAppSettingsServants();
                    if (activeServants.length > 0) {
                        baseServants = baseServants.filter(s =>
                            activeServants.some(active =>
                                (active.id && s.id && String(active.id) === String(s.id)) ||
                                (active.phone && s.phone && cleanPhone(active.phone) === cleanPhone(s.phone)) ||
                                active.name === s.name
                            )
                        );
                    }
                } catch (err) {
                    console.error("Error filtering active servants:", err);
                }

                const osras = new Set();
                baseServants.forEach(s => {
                    s.osraName = s.osraName || s.assignedOsra || s.syncKey || "غير محدد";
                    if (s.osraName !== "MASTER_ACCESS" && s.osraName !== "ADMIN_MODE") {
                        osras.add(s.osraName);
                    }
                });
                setUniqueOsras(Array.from(osras));

                let filteredServants = baseServants;
                if (osraFilter !== "الكل") {
                    filteredServants = filteredServants.filter(s => (s.osraName === osraFilter || s.assignedOsra === osraFilter));
                }

                const aliasMap = {};
                try {
                    servantsSnap.forEach(docSnap => {
                        const d = docSnap.data();
                        const p = cleanPhone(d.phone);
                        if (p) {
                            aliasMap[docSnap.id] = p;
                            if (d.uid) aliasMap[d.uid] = p;
                        }
                    });
                } catch (e) {
                    console.warn("Error fetching servants aliases:", e);
                }

                const q = query(
                    collection(firestore, "ServantAttendance"),
                    where("weekDate", ">=", rangeStart),
                    where("weekDate", "<=", rangeEnd)
                );
                const attendanceSnap = await getDocs(q);

                const attendanceByServant = {};
                const meetingDatesSet = new Set();

                attendanceSnap.forEach(d => {
                    const data = d.data();
                    if (!data) return;
                    if (data.weekDate) meetingDatesSet.add(data.weekDate);

                    const matchedServant = matchServantRecord(filteredServants, data, d.id, aliasMap);
                    if (matchedServant) {
                        const sKey = String(matchedServant.id || matchedServant.uid || matchedServant.phone || matchedServant.name);
                        if (!attendanceByServant[sKey]) attendanceByServant[sKey] = [];
                        attendanceByServant[sKey].push(data);
                    }
                });

                const sortedMeetingDates = Array.from(meetingDatesSet).sort();
                setUniqueMeetingDates(sortedMeetingDates);
                setReportData(aggregateServantsReport(filteredServants, attendanceByServant, sortedMeetingDates));
            } catch (err) {
                console.error("Error fetching report data:", err);
            }
            setIsLoading(false);
        };

        fetchReport();
    }, [monthYear, fromDate, toDate, selectedYear, periodMode, osraFilter]);

    // Print handler
    const handlePrint = () => {
        window.print();
    };

    // Excel export handler
    const handleExportExcel = () => {
        setIsExportingExcel(true);
        try {
            const dataToExport = reportData.map((s, idx) => {
                const row = {
                    'م': s.index || idx + 1,
                    'اسم الخادم': s.name,
                    'الأسرة / الخدمة': getOsraName(s.osraName),
                    'عدد الحضور (اجتماع الخدام)': s.presentCount,
                    'عدد الاعتذار': s.excusedCount,
                    'عدد الغياب': s.absentCount,
                    'نسبة الحضور': `${s.attendancePercentage}%`
                };

                // Add meeting dates columns if in month or custom mode
                if (periodMode !== 'yearly' && uniqueMeetingDates.length > 0) {
                    uniqueMeetingDates.forEach((dStr) => {
                        const status = s.datesMap[dStr];
                        row[`اجتماع ${dStr}`] = status === 'حضور' ? 'حاضر' : status === 'اعتذار' ? 'معتذر' : status === 'غياب' ? 'غائب' : 'لم يُسجل بعد';
                    });
                }

                row['القداسات'] = s.liturgyCount;
                row['التحضير الأسبوعي'] = s.prepCount;
                row['مشارك بالافتقاد'] = s.visitationCount;
                row['تاريخ آخر اعتراف'] = s.confessionDate;
                row['مشاركات الأنشطة'] = s.serviceActivityCount + s.dioceseActivityCount;
                row['أنشطة الإيبارشية'] = s.activitiesDiocese;
                row['ملاحظات وأسباب الاعتذار'] = s.allNotesText || '-';

                return row;
            });

            const ws = XLSX.utils.json_to_sheet(dataToExport);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "تقرير اجتماع الخدام");
            
            // Clean filename
            const cleanPeriodName = activePeriodLabel.replace(/[/\\?%*:|"<>]/g, '_');
            XLSX.writeFile(wb, getExcelReportFilename(`تقرير_اجتماع_الخدام_${cleanPeriodName}`));
        } catch (err) {
            console.error("Excel export error:", err);
            alert("حدث خطأ أثناء تصدير ملف الإكسيل.");
        } finally {
            setIsExportingExcel(false);
        }
    };

    // Overall summary metrics across all servants
    const overallSummary = useMemo(() => {
        const totalServants = reportData.length;
        const totalPresents = reportData.reduce((acc, s) => acc + s.presentCount, 0);
        const totalExcuses = reportData.reduce((acc, s) => acc + s.excusedCount, 0);
        const totalAbsents = reportData.reduce((acc, s) => acc + s.absentCount, 0);
        const avgPercentage = totalServants > 0 
            ? Math.round(reportData.reduce((acc, s) => acc + s.attendancePercentage, 0) / totalServants)
            : 0;
        return { totalServants, totalPresents, totalExcuses, totalAbsents, avgPercentage };
    }, [reportData]);

    return (
        <div className="min-h-screen coptic-cream-surface font-sans pb-20 print:pb-0 print:bg-white" dir="rtl">
            
            <style>
                {`
                @media print {
                    @page { 
                        size: A4 landscape; 
                        margin: 8mm; 
                    }
                    body { 
                        background-color: #fff !important; 
                        -webkit-print-color-adjust: exact !important; 
                        print-color-adjust: exact !important; 
                        direction: rtl !important;
                    }
                    .no-print { display: none !important; }
                    
                    header, nav, .sidebar { display: none !important; }

                    .print-area { 
                        width: 100% !important; 
                        max-width: 100% !important;
                        margin: 0 !important; 
                        padding: 0 !important; 
                        box-shadow: none !important;
                        border: none !important;
                    }
                    
                    .overflow-x-auto { 
                        overflow: visible !important; 
                    }

                    table { 
                        border-collapse: collapse !important; 
                        width: 100% !important; 
                        background: #fff !important;
                    }
                    th, td { 
                        border: 1px solid #333 !important; 
                        padding: 4px 6px !important; 
                        text-align: center !important; 
                        font-size: 10px !important; 
                        color: #000 !important; 
                        vertical-align: middle !important;
                        background: #fff !important;
                        word-wrap: break-word !important;
                    }
                    th { 
                        background-color: #f1f5f9 !important; 
                        font-weight: bold !important; 
                    }
                    
                    .print-header { 
                        display: block !important; 
                        margin-bottom: 15px; 
                        text-align: center; 
                        color: #000 !important;
                    }
                    
                    .badge-print-present { background-color: #d1fae5 !important; color: #065f46 !important; font-weight: bold; }
                    .badge-print-excused { background-color: #fef3c7 !important; color: #92400e !important; font-weight: bold; }
                    .badge-print-absent { background-color: #ffe4e6 !important; color: #9f1239 !important; font-weight: bold; }
                }
                `}
            </style>

            {/* Print Header (Only visible on print) */}
            <div className="hidden print:block print-header">
                <h1 className="text-xl font-black mb-1">
                    {getReportHeaderTitle('تقرير متابعة اجتماع الخدام')}
                </h1>
                <h2 className="text-sm font-bold text-slate-700">
                    {activePeriodLabel} | الأسرة: {osraFilter === 'الكل' ? 'جميع الأسر والخدمات' : getOsraName(osraFilter)} (مستبعد منه الآباء الكهنة)
                </h2>
                <div className="flex justify-center gap-6 mt-2 text-xs font-bold">
                    <span>إجمالي الخدام: {overallSummary.totalServants}</span>
                    <span>إجمالي الحضور: {overallSummary.totalPresents}</span>
                    <span>إجمالي الاعتذارات: {overallSummary.totalExcuses}</span>
                    <span>إجمالي الغياب: {overallSummary.totalAbsents}</span>
                    <span>متوسط الحضور: {overallSummary.avgPercentage}%</span>
                </div>
            </div>

            {/* App Navbar (Hidden on print) */}
            <header className="bg-gradient-to-l from-[#141F45] via-[#1B2A59] to-[#243875] text-white p-3.5 sm:p-4 sticky top-0 z-50 shadow-lg rounded-b-3xl sm:rounded-b-[2.5rem] no-print border-b-2 border-[#C8942E]/40">
                <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <button 
                            onClick={() => goBack('/admin/servants-followup')} 
                            className="w-10 h-10 bg-white/10 hover:bg-white/20 text-[#F4D078] rounded-full flex items-center justify-center transition-all shrink-0 border border-white/15 cursor-pointer"
                            title="رجوع"
                        >
                            <ArrowRight size={20} />
                        </button>
                        <div className="min-w-0">
                            <h1 className="text-base sm:text-lg font-black text-[#F4D078] flex items-center gap-1.5 truncate">
                                <Users size={18} className="shrink-0" />
                                <span className="truncate">تقرير اجتماع الخدام</span>
                            </h1>
                            <p className="text-[11px] sm:text-xs font-bold text-[#FBF6EB]/80 truncate">
                                متابعة الحضور والاعتذار والغياب لاجتماع الخدام الأسبوعي
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <button 
                            onClick={handleExportExcel} 
                            disabled={isExportingExcel || reportData.length === 0}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 sm:px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-md hover:shadow-lg disabled:opacity-50 cursor-pointer"
                        >
                            <FileSpreadsheet size={16} />
                            <span className="hidden sm:inline">تصدير إكسيل</span>
                        </button>
                        <button 
                            onClick={handlePrint} 
                            disabled={reportData.length === 0}
                            className="bg-[#C8942E] hover:bg-[#B88222] text-white px-3.5 sm:px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-md hover:shadow-lg disabled:opacity-50 cursor-pointer"
                        >
                            <Printer size={16} />
                            <span>طباعة</span>
                        </button>
                    </div>
                </div>
            </header>

            <main className="p-3.5 sm:p-4 max-w-[98%] mx-auto mt-2 sm:mt-4 print-area">
                
                {/* Control Bar (Hidden on print) */}
                <div className="coptic-card p-3.5 sm:p-5 rounded-3xl mb-6 flex flex-col lg:flex-row gap-3 sm:gap-4 items-center justify-between no-print animate-in slide-in-from-top-4">
                    
                    {/* View Switcher Tabs (Flexible Period Filter) */}
                    <div className="flex bg-[#F7EFE0] border border-[#E6DAC2] p-1 rounded-2xl w-full lg:w-auto">
                        <button 
                            onClick={() => setPeriodMode('monthly')}
                            className={`flex-1 lg:flex-none px-3 sm:px-5 py-2 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${periodMode === 'monthly' ? 'bg-[#1B2A59] text-white shadow-sm' : 'text-[#5E5242] hover:text-[#1B2A59]'}`}
                        >
                            <Calendar size={14} />
                            <span>شهري</span>
                        </button>
                        <button 
                            onClick={() => setPeriodMode('custom')}
                            className={`flex-1 lg:flex-none px-3 sm:px-5 py-2 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${periodMode === 'custom' ? 'bg-[#1B2A59] text-white shadow-sm' : 'text-[#5E5242] hover:text-[#1B2A59]'}`}
                        >
                            <CalendarRange size={14} />
                            <span>فترة مخصصة</span>
                        </button>
                        <button 
                            onClick={() => setPeriodMode('yearly')}
                            className={`flex-1 lg:flex-none px-3 sm:px-5 py-2 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${periodMode === 'yearly' ? 'bg-[#1B2A59] text-white shadow-sm' : 'text-[#5E5242] hover:text-[#1B2A59]'}`}
                        >
                            <BarChart3 size={14} />
                            <span>سنوي</span>
                        </button>
                    </div>

                    {/* Inputs for Dates */}
                    <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2.5 items-center w-full lg:w-auto">
                        {periodMode === 'monthly' && (
                            <div className="flex items-center justify-between sm:justify-start gap-2 bg-[#FAF4E8] px-3 py-2 rounded-xl border border-[#E3D6BF] w-full sm:w-auto">
                                <div className="flex items-center gap-2">
                                    <Calendar className="text-[#1B2A59] shrink-0" size={16} />
                                    <span className="text-xs font-bold text-[#6E604F]">الشهر:</span>
                                </div>
                                <input 
                                    type="month" 
                                    value={monthYear} 
                                    onChange={(e) => setMonthYear(e.target.value)} 
                                    className="bg-transparent border-none outline-none font-bold text-xs text-[#1B2A59] cursor-pointer"
                                />
                            </div>
                        )}

                        {periodMode === 'custom' && (
                            <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2 bg-[#FAF4E8] p-2.5 rounded-xl border border-[#E3D6BF] w-full sm:w-auto">
                                <div className="flex items-center justify-between sm:justify-start gap-1.5">
                                    <span className="text-xs font-bold text-[#6E604F] flex items-center gap-1"><CalendarRange className="text-[#1B2A59]" size={15} /> من:</span>
                                    <input 
                                        type="date" 
                                        value={fromDate} 
                                        onChange={(e) => setFromDate(e.target.value)} 
                                        className="bg-[#FFFDF7] border border-[#E3D6BF] rounded-lg px-2 py-1 font-bold text-xs text-[#1B2A59] outline-none cursor-pointer"
                                    />
                                </div>
                                <div className="flex items-center justify-between sm:justify-start gap-1.5">
                                    <span className="text-xs font-bold text-[#6E604F]">إلى:</span>
                                    <input 
                                        type="date" 
                                        value={toDate} 
                                        onChange={(e) => setToDate(e.target.value)} 
                                        className="bg-[#FFFDF7] border border-[#E3D6BF] rounded-lg px-2 py-1 font-bold text-xs text-[#1B2A59] outline-none cursor-pointer"
                                    />
                                </div>
                            </div>
                        )}

                        {periodMode === 'yearly' && (
                            <div className="flex items-center justify-between sm:justify-start gap-2 bg-[#FAF4E8] px-3 py-2 rounded-xl border border-[#E3D6BF] w-full sm:w-auto">
                                <div className="flex items-center gap-2">
                                    <Calendar className="text-[#1B2A59] shrink-0" size={16} />
                                    <span className="text-xs font-bold text-[#6E604F]">السنة:</span>
                                </div>
                                <select 
                                    value={selectedYear} 
                                    onChange={(e) => setSelectedYear(e.target.value)} 
                                    className="bg-transparent border-none outline-none font-bold text-xs text-[#1B2A59] cursor-pointer"
                                >
                                    {Array.from({length: 8}, (_, i) => new Date().getFullYear() - i).map(year => (
                                        <option key={year} value={year}>{year}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        
                        {/* Osra Filter */}
                        <div className="flex items-center gap-2 bg-[#FAF4E8] px-3 py-2 rounded-xl border border-[#E3D6BF] w-full sm:w-auto">
                            <Users className="text-[#C8942E] shrink-0" size={16} />
                            <select 
                                value={osraFilter} 
                                onChange={(e) => setOsraFilter(e.target.value)} 
                                className="w-full sm:w-auto bg-transparent border-none outline-none font-bold text-xs text-[#1B2A59] sm:max-w-[170px] truncate cursor-pointer"
                            >
                                <option value="الكل">كل الأسر والخدمات</option>
                                {uniqueOsras.map(osra => (
                                    <option key={osra} value={osra}>{getOsraName(osra)}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* KPI Summary Cards (Hidden on print) */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5 mb-6 no-print">
                    <div className="coptic-card p-4 rounded-2xl flex items-center justify-between">
                        <div>
                            <span className="text-xs font-bold text-[#6E604F] block mb-1">الخدام المشمولين</span>
                            <span className="text-2xl font-black text-[#1B2A59]">{overallSummary.totalServants}</span>
                        </div>
                        <div className="w-10 h-10 rounded-xl bg-[#F3EAD8] flex items-center justify-center text-[#1B2A59]">
                            <Users size={18} />
                        </div>
                    </div>

                    <div className="bg-emerald-50/85 p-4 rounded-2xl border border-emerald-200 shadow-sm flex items-center justify-between">
                        <div>
                            <span className="text-xs font-black text-emerald-800 block mb-1">إجمالي الحضور</span>
                            <span className="text-2xl font-black text-emerald-600">{overallSummary.totalPresents}</span>
                        </div>
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600">
                            <CheckCircle2 size={18} />
                        </div>
                    </div>

                    <div className="bg-amber-50/85 p-4 rounded-2xl border border-amber-200 shadow-sm flex items-center justify-between">
                        <div>
                            <span className="text-xs font-black text-amber-800 block mb-1">إجمالي الاعتذارات</span>
                            <span className="text-2xl font-black text-amber-600">{overallSummary.totalExcuses}</span>
                        </div>
                        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
                            <UserMinus size={18} />
                        </div>
                    </div>

                    <div className="bg-rose-50/85 p-4 rounded-2xl border border-rose-200 shadow-sm flex items-center justify-between">
                        <div>
                            <span className="text-xs font-black text-rose-800 block mb-1">إجمالي الغياب</span>
                            <span className="text-2xl font-black text-rose-600">{overallSummary.totalAbsents}</span>
                        </div>
                        <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center text-rose-600">
                            <UserX size={18} />
                        </div>
                    </div>

                    <div className="coptic-card p-4 rounded-2xl border border-[#C8942E]/30 flex items-center justify-between col-span-2 sm:col-span-1">
                        <div>
                            <span className="text-xs font-black text-[#8B6217] block mb-1">متوسط نسبة الحضور</span>
                            <span className="text-2xl font-black text-[#1B2A59]">{overallSummary.avgPercentage}%</span>
                        </div>
                        <div className="w-10 h-10 rounded-xl bg-[#FDF5E2] flex items-center justify-center text-[#C8942E]">
                            <TrendingUp size={18} />
                        </div>
                    </div>
                </div>

                {/* The Main Report Table */}
                <div className="coptic-card rounded-3xl overflow-x-auto print-area animate-in zoom-in-95">
                    <table className="w-full text-center text-xs border-collapse">
                        <thead className="bg-[#F5EBD6] text-[#1B2A59] font-black border-b-2 border-[#D7C4A1]">
                            <tr>
                                <th className="p-3 border border-[#E5D7BF] w-10" rowSpan={periodMode !== 'yearly' && uniqueMeetingDates.length > 0 ? 2 : 1}>م</th>
                                <th className="p-3 border border-[#E5D7BF] min-w-[140px]" rowSpan={periodMode !== 'yearly' && uniqueMeetingDates.length > 0 ? 2 : 1}>اسم الخادم</th>
                                <th className="p-3 border border-[#E5D7BF] min-w-[110px]" rowSpan={periodMode !== 'yearly' && uniqueMeetingDates.length > 0 ? 2 : 1}>الأسرة / الخدمة</th>
                                
                                <th className="p-2 border border-[#E5D7BF] bg-emerald-100/70 text-emerald-900 min-w-[85px]" rowSpan={periodMode !== 'yearly' && uniqueMeetingDates.length > 0 ? 2 : 1}>
                                    <span className="inline-flex items-center gap-1 justify-center"><CheckCircle2 size={13} className="text-emerald-700" /> عدد الحضور</span>
                                </th>
                                <th className="p-2 border border-[#E5D7BF] bg-amber-100/70 text-amber-900 min-w-[85px]" rowSpan={periodMode !== 'yearly' && uniqueMeetingDates.length > 0 ? 2 : 1}>
                                    <span className="inline-flex items-center gap-1 justify-center"><Clock size={13} className="text-amber-700" /> عدد الاعتذار</span>
                                </th>
                                <th className="p-2 border border-[#E5D7BF] bg-rose-100/70 text-rose-900 min-w-[85px]" rowSpan={periodMode !== 'yearly' && uniqueMeetingDates.length > 0 ? 2 : 1}>
                                    <span className="inline-flex items-center gap-1 justify-center"><XCircle size={13} className="text-rose-700" /> عدد الغياب</span>
                                </th>
                                <th className="p-2 border border-[#E5D7BF] bg-[#EAE2D0] text-[#1B2A59] min-w-[75px]" rowSpan={periodMode !== 'yearly' && uniqueMeetingDates.length > 0 ? 2 : 1}>
                                    نسبة الحضور %
                                </th>

                                {/* Meeting Dates Detail columns */}
                                {periodMode !== 'yearly' && uniqueMeetingDates.length > 0 && (
                                    <th className="p-2 border border-[#E5D7BF] bg-[#E8EEF8] text-[#1B2A59]" colSpan={uniqueMeetingDates.length}>
                                        سجل حضور مواعيد اجتماع الخدام ({uniqueMeetingDates.length} اجتماع)
                                    </th>
                                )}

                                <th className="p-3 border border-[#E5D7BF] min-w-[65px]" rowSpan={periodMode !== 'yearly' && uniqueMeetingDates.length > 0 ? 2 : 1}>قداس</th>
                                <th className="p-3 border border-[#E5D7BF] min-w-[65px]" rowSpan={periodMode !== 'yearly' && uniqueMeetingDates.length > 0 ? 2 : 1}>تحضير</th>
                                <th className="p-3 border border-[#E5D7BF] min-w-[70px]" rowSpan={periodMode !== 'yearly' && uniqueMeetingDates.length > 0 ? 2 : 1}>افتقاد</th>
                                <th className="p-3 border border-[#E5D7BF] min-w-[95px]" rowSpan={periodMode !== 'yearly' && uniqueMeetingDates.length > 0 ? 2 : 1}>تاريخ الاعتراف</th>
                                <th className="p-3 border border-[#E5D7BF] min-w-[75px]" rowSpan={periodMode !== 'yearly' && uniqueMeetingDates.length > 0 ? 2 : 1}>أنشطة الخدمة</th>
                                <th className="p-3 border border-[#E5D7BF] min-w-[100px]" rowSpan={periodMode !== 'yearly' && uniqueMeetingDates.length > 0 ? 2 : 1}>أنشطة الإيبارشية</th>
                                <th className="p-3 border border-[#E5D7BF] min-w-[180px]" rowSpan={periodMode !== 'yearly' && uniqueMeetingDates.length > 0 ? 2 : 1}>ملاحظات أمين الخدمة وأسباب الاعتذار</th>
                            </tr>

                            {/* Second row of headers for meeting dates */}
                            {periodMode !== 'yearly' && uniqueMeetingDates.length > 0 && (
                                <tr className="bg-[#FAF4E8] text-[10px] text-[#5E5242]">
                                    {uniqueMeetingDates.map((dateStr) => (
                                        <th key={dateStr} className="p-1 border border-[#E5D7BF] min-w-[42px] bg-[#EFF3FA]" title={dateStr}>
                                            {dateStr.substring(5)}
                                        </th>
                                    ))}
                                </tr>
                            )}
                        </thead>

                        <tbody className="divide-y divide-[#EDE3CE]">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={13 + (periodMode !== 'yearly' ? uniqueMeetingDates.length : 0)} className="text-center p-12">
                                        <Loader2 className="w-8 h-8 animate-spin text-[#C8942E] mx-auto mb-2" />
                                        <span className="text-xs font-bold text-[#6E604F]">جاري تجميع تقرير اجتماع الخدام...</span>
                                    </td>
                                </tr>
                            ) : reportData.length === 0 ? (
                                <tr>
                                    <td colSpan={13 + (periodMode !== 'yearly' ? uniqueMeetingDates.length : 0)} className="text-center p-12 text-[#6E604F] font-bold">
                                        لا توجد بيانات للاجتماع مسجلة في هذه الفترة المحددة.
                                    </td>
                                </tr>
                            ) : (
                                reportData.map((s, index) => (
                                    <tr key={s.id || index} className="hover:bg-[#FAF4E8]/80 transition-colors">
                                        <td className="p-2 border border-[#EDE3CE] font-bold text-[#6E604F]">{s.index || index + 1}</td>
                                        <td className="p-2 border border-[#EDE3CE] font-black text-[#1B2A59] text-right">
                                            {s.name}
                                        </td>
                                        <td className="p-2 border border-[#EDE3CE] font-bold text-[#1B2A59] bg-[#F7F1E4]/50 text-[11px]">
                                            {getOsraName(s.osraName)}
                                        </td>

                                        <td className="p-2 border border-[#EDE3CE] font-black text-emerald-700 bg-emerald-50/50 badge-print-present">
                                            {s.presentCount}
                                        </td>
                                        <td className="p-2 border border-[#EDE3CE] font-black text-amber-700 bg-amber-50/50 badge-print-excused">
                                            {s.excusedCount}
                                        </td>
                                        <td className="p-2 border border-[#EDE3CE] font-black text-rose-700 bg-rose-50/50 badge-print-absent">
                                            {s.absentCount}
                                        </td>
                                        <td className="p-2 border border-[#EDE3CE] font-black text-[#1B2A59] bg-[#FAF4E8]/70">
                                            {s.attendancePercentage}%
                                        </td>

                                        {/* Specific Meeting Dates Statuses */}
                                        {periodMode !== 'yearly' && uniqueMeetingDates.length > 0 && (
                                            uniqueMeetingDates.map(dateStr => {
                                                const status = s.datesMap[dateStr];
                                                return (
                                                    <td key={dateStr} className="p-1 border border-[#EDE3CE] text-xs font-black">
                                                        {status === 'حضور' ? (
                                                            <span className="inline-flex items-center justify-center text-emerald-600" title="حاضر"><CheckCircle2 size={15} /></span>
                                                        ) : status === 'اعتذار' ? (
                                                            <span className="inline-flex items-center justify-center text-amber-600" title="معتذر"><Clock size={15} /></span>
                                                        ) : status === 'غياب' ? (
                                                            <span className="inline-flex items-center justify-center text-rose-600" title="غائب"><XCircle size={15} /></span>
                                                        ) : (
                                                            <span className="text-slate-400 text-[10px] font-bold" title="لم يُسجل بعد">لم يُسجل</span>
                                                        )}
                                                    </td>
                                                );
                                            })
                                        )}

                                        {/* Spiritual & Commitments */}
                                        <td className="p-2 border border-[#EDE3CE] font-bold text-[#1B2A59]">{s.liturgyCount}</td>
                                        <td className="p-2 border border-[#EDE3CE] font-bold text-[#1B2A59]">{s.prepCount}</td>
                                        <td className="p-2 border border-[#EDE3CE] font-bold text-[#1B2A59]">
                                            {periodMode === 'yearly' ? s.visitationCount : s.visitationText}
                                        </td>
                                        <td className="p-2 border border-[#EDE3CE] font-bold text-[#5E5242] text-[11px]" dir="ltr">
                                            {s.confessionDate}
                                        </td>
                                        <td className="p-2 border border-[#EDE3CE] font-black text-[#1B2A59] text-[11px]">
                                            {periodMode === 'yearly' ? s.serviceActivityCount : s.activitiesServiceText}
                                        </td>
                                        <td className="p-2 border border-[#EDE3CE] font-bold text-[#5E5242] text-[10px]">
                                            {s.activitiesDiocese}
                                        </td>
                                        
                                        {/* Notes & Excuses */}
                                        <td className="p-2 border border-[#EDE3CE] text-[10px] font-bold text-[#1B2A59] text-right leading-relaxed max-w-[220px]">
                                            {s.notesList && s.notesList.length > 0 ? (
                                                <ul className="space-y-1 list-none p-0 m-0">
                                                    {s.notesList.map((item, nIdx) => (
                                                        <li key={nIdx} className="border-b border-[#EDE3CE] last:border-b-0 pb-0.5">
                                                            <span className={`text-[9px] font-black block ${item.label === 'اعتذار' ? 'text-amber-600' : 'text-[#8B6217]'}`}>
                                                                {item.date} ({item.label}):
                                                            </span>
                                                            <span className="text-[#1B2A59]">{item.text}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <span className="text-[#B8AB96]">-</span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </main>
        </div>
    );
}
