import { useChurchDataEngine } from '../hooks/useChurchDataEngine';
import { isAttendanceRecordPresent } from '../utils/churchDataEngine';
import { syncAttendancePoints } from '../utils/pointsEngine';
import { attendanceIdentity, resolveAttendanceChild } from '../utils/childIdentity';
import { getDefaultServiceDateForClass, getClassWeeklySessions, getDefaultWeeklySessionForClass } from '../utils/serviceWeek';
import { buildCanonicalAttendancePayload, pushAttendanceRecordToCloud, formatSessionShortDateAr } from '../utils/attendanceSessionHelper';
import { getImpersonatedOsra, resolveUserAccessScope } from '../utils/notificationScopeEngine';
import { TENANT_CONFIG, getLogoUrl,
    readScopedStorage
} from '../utils/tenantConfig';
import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import useQrScanner from '../hooks/useQrScanner';
import { db } from '../db/database';
import useAutoSync from '../hooks/useAutoSync';
import { logActivity } from '../utils/activityLogger';
import {
    Camera, CameraOff, Trash2, ArrowRight, Volume2, VolumeX,
    RotateCcw, ScanLine, CheckCircle2, XCircle, X,
    Church, BookOpen, Calendar, ChevronLeft, Save,
    Users, QrCode, ClipboardList, Sparkles, Loader2, Search, UserCheck, User
} from 'lucide-react';

// Stage Constants
const STAGE = {
    CONFIG: 'config',
    SCANNING: 'scanning',
    REVIEW: 'review',
};

const EVENT_TYPES = [
    { id: 'liturgy', label: 'القداس', icon: Church, activeGrad: 'linear-gradient(135deg, #162447 0%, #243C78 100%)', iconBg: 'bg-indigo-100 text-[#1B2A59] border-indigo-200' },
    { id: 'service', label: 'الخدمة', icon: BookOpen, activeGrad: 'linear-gradient(135deg, #14532D 0%, #0F766E 100%)', iconBg: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    { id: 'service_meeting', label: 'اجتماع الخدمة', icon: Users, activeGrad: 'linear-gradient(135deg, #14532D 0%, #0F766E 100%)', iconBg: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    { id: 'tasbeha', label: 'التسبحة', icon: Sparkles, activeGrad: 'linear-gradient(135deg, #4C1D95 0%, #6D28D9 100%)', iconBg: 'bg-violet-100 text-violet-800 border-violet-200' },
];

import { useSmartNavigation } from '../hooks/useSmartNavigation';

// Production QR Attendance Component
export default function QrAttendance() {
    const { goBack } = useSmartNavigation();
    const navigate = useNavigate();
    const { triggerAutoSync } = useAutoSync();

    // Session Config State (strictly scoped by 4-tier RBAC)
    const accessScope = resolveUserAccessScope(null, [], { includeFallback: true });
    const impersonatedOsra = accessScope.impersonatedOsra || getImpersonatedOsra();
    const activeClassSyncKey = accessScope.activeSyncKey || impersonatedOsra?.syncKey || readScopedStorage('currentSyncKey');
    const [stage, setStage] = useState(STAGE.CONFIG);
    const defaultSession = useMemo(
        () => getDefaultWeeklySessionForClass({ syncKey: activeClassSyncKey, name: impersonatedOsra?.name }),
        [activeClassSyncKey, impersonatedOsra?.name]
    );
    const [eventType, setEventType] = useState(() => defaultSession?.type || 'service'); // 'liturgy' | 'service'
    const [selectedDate, setSelectedDate] = useState(() => defaultSession?.date || getDefaultServiceDateForClass(activeClassSyncKey, impersonatedOsra?.name));
    const [selectedSessionKey, setSelectedSessionKey] = useState(() => defaultSession?.id || '');
    const [manualQuery, setManualQuery] = useState('');

    const weeklySessions = useMemo(
        () => getClassWeeklySessions({ syncKey: activeClassSyncKey, name: impersonatedOsra?.name }, null, selectedDate ? new Date(`${selectedDate}T12:00:00`) : new Date()),
        [activeClassSyncKey, impersonatedOsra?.name, selectedDate]
    );
    const activeSessionObj = useMemo(
        () => weeklySessions.find(s => (selectedSessionKey ? s.id === selectedSessionKey : (s.date === selectedDate && s.type === eventType))) || null,
        [weeklySessions, selectedSessionKey, selectedDate, eventType]
    );

    // Save State
    const [isSaving, setIsSaving] = useState(false);
    const [saveResult, setSaveResult] = useState(null);

    // QR Scanner Hook (strictly scoped to allowedSyncKeys)
    const { canonicalData } = useChurchDataEngine(accessScope.allowedSyncKeys || []);
    const scanner = useQrScanner();

    // Derived
    const activeEventConfig = useMemo(() => EVENT_TYPES.find(e => e.id === eventType) || EVENT_TYPES[1], [eventType]);
    const canProceed = Boolean(eventType && selectedDate);

    const scannedIdSet = useMemo(
        () => new Set(scanner.scannedList.map(s => String(s.childId))),
        [scanner.scannedList]
    );

    const quickManualChildren = useMemo(() => {
        const list = canonicalData?.activeChildren || [];
        const q = manualQuery.trim().toLowerCase();
        return list
            .filter(c => !q || String(c.name || '').toLowerCase().includes(q) || String(c.id || '').includes(q))
            .slice(0, 16);
    }, [canonicalData, manualQuery]);

    // Stage transitions
    const goToScanning = () => {
        if (!canProceed) return;
        setStage(STAGE.SCANNING);
    };

    const goToReview = async () => {
        await scanner.stopCamera();
        setStage(STAGE.REVIEW);
    };

    const goBackToScanning = () => {
        setStage(STAGE.SCANNING);
    };

    const goBackToConfig = async () => {
        await scanner.stopCamera();
        scanner.clearAll();
        setStage(STAGE.CONFIG);
    };

    const handleSaveAttendance = useCallback(async () => {
        if (isSaving || scanner.scannedCount === 0) return;
        setIsSaving(true);

        try {
            const currentSyncKey = getImpersonatedOsra()?.syncKey || readScopedStorage('currentSyncKey');
            const now = new Date().toISOString();
            const type = eventType;
            const date = selectedDate;
            const childIds = scanner.scannedList.map(item => item.childId);

            // Fetch existing attendance for this date to prevent duplicates
            const existingRecords = await db.attendance
                .where('date').equals(date)
                .toArray();
            const existingActive = existingRecords.filter(r => !r.isDeleted);
            const sameSessionRecords = existingActive.filter(r =>
                activeSessionObj?.id
                    ? (r.sessionKey ? r.sessionKey === activeSessionObj.id : r.type === type)
                    : r.type === type
            );
            const alreadyPresentSet = new Set(
                sameSessionRecords
                    .filter(r => isAttendanceRecordPresent(r))
                    .map(r => String(resolveAttendanceChild(r, canonicalData)?.id))
            );
            const existingByChildId = new Map();
            for (const r of sameSessionRecords) {
                const resolvedId = String(resolveAttendanceChild(r, canonicalData)?.id || '');
                if (resolvedId) existingByChildId.set(resolvedId, r);
            }

            // Filter out children already recorded as present for this date+session
            const newChildIds = [...new Set(childIds.map(id => canonicalData.childMapById.get(String(id))?.id).filter(id => id != null))]
                .filter(id => !alreadyPresentSet.has(String(id)));

            if (newChildIds.length === 0) {
                setSaveResult({
                    success: false,
                    count: 0,
                    message: 'كل المخدومين المختارين مسجلون حضوراً بالفعل لهذا التاريخ.',
                });
                setIsSaving(false);
                return;
            }

            // Atomic Transaction: Insert/Upgrade Canonical Attendance + Update Children + Instant Cloud Push
            const cloudQueue = [];
            const pointsQueue = [];
            await db.transaction('rw', db.attendance, db.children, async () => {
                for (const childId of newChildIds) {
                    const child = canonicalData.childMapById.get(String(childId));
                    if (!child) continue;
                    const targetSyncKey = child?.syncKey || currentSyncKey;
                    const attPayload = buildCanonicalAttendancePayload({
                        child,
                        date,
                        type,
                        status: 'present',
                        syncKey: targetSyncKey,
                        sessionKey: activeSessionObj?.id || '',
                        sessionLabel: activeSessionObj?.label || ''
                    });

                    const existingSameSession = existingByChildId.get(String(childId));
                    let rowId;
                    if (existingSameSession?.id != null) {
                        await db.attendance.update(existingSameSession.id, attPayload);
                        rowId = existingSameSession.id;
                    } else {
                        rowId = await db.attendance.add(attPayload);
                    }
                    cloudQueue.push({ payload: attPayload, rowId });
                    pointsQueue.push({ child, type, sessionKey: attPayload.sessionKey, date });

                    if (child && !child.isDeleted) {
                        const field = type === 'liturgy' ? 'last_liturgy' : 'last_service';
                        const updates = {
                            isDirty: true,
                            updatedAt: now,
                        };

                        if (!child[field] || date >= child[field]) {
                            updates[field] = date;
                        }

                        const childExistingForDate = existingActive.filter(r => r.childId === childId && isAttendanceRecordPresent(r));
                        if (childExistingForDate.length === 0) {
                            updates.streak = (child.streak || 0) + 1;
                        }

                        await db.children.update(childId, updates);
                    }
                }
            });

            cloudQueue.forEach(({ payload, rowId }) => {
                void pushAttendanceRecordToCloud(payload, rowId);
            });
            for (const item of pointsQueue) {
                await syncAttendancePoints({
                    child: item.child,
                    type: item.type,
                    sessionKey: item.sessionKey,
                    date: item.date,
                    isPresent: true
                });
            }
            triggerAutoSync();

            const skipped = childIds.length - newChildIds.length;
            let message = `تم تسجيل حضور ${newChildIds.length} مخدوم بنجاح.`;
            if (skipped > 0) {
                message += `\nتم تخطي ${skipped} مخدوم مسجلين مسبقاً.`;
            }

            setSaveResult({
                success: true,
                count: newChildIds.length,
                message: `${message}\nالمخدومون الذين لم يُمسح كودهم يظلون بحالة «لم يُسجل بعد» ولا يُحسبون غائبين تلقائياً.`,
            });

            const typeLabel = type === 'liturgy' ? 'القداس' : 'الخدمة';
            logActivity('RECORD_ATTENDANCE', `تسجيل حضور جماعي بـ QR — ${newChildIds.length} مخدوم (${typeLabel}) ليوم ${date}`);

        } catch (err) {
            console.error('[QrAttendance] Save error:', err);
            setSaveResult({
                success: false,
                count: 0,
                message: `تعذر إتمام الحفظ: ${err.message}`,
            });
        } finally {
            setIsSaving(false);
        }
    }, [canonicalData, isSaving, scanner.scannedList, scanner.scannedCount, eventType, selectedDate, triggerAutoSync]);

    const handleDismissSaveResult = useCallback(() => {
        const wasSuccess = saveResult?.success;
        setSaveResult(null);
        if (wasSuccess) {
            scanner.clearAll();
            setEventType('service');
            const osra = getImpersonatedOsra();
            setSelectedDate(getDefaultServiceDateForClass(osra?.syncKey || readScopedStorage('currentSyncKey'), osra?.name));
            setStage(STAGE.CONFIG);
        }
    }, [saveResult, scanner]);

    const handleExit = async () => {
        await scanner.stopCamera();
        goBack('/');
    };

    const stageTitle = {
        [STAGE.CONFIG]: 'تسجيل الحضور السريع (QR)',
        [STAGE.SCANNING]: activeEventConfig ? `مسح الحضور — ${activeEventConfig.label}` : 'المسح',
        [STAGE.REVIEW]: 'مراجعة واعتماد الحضور',
    };

    return (
        <div className="min-h-screen coptic-cream-surface text-[#231B12]" dir="rtl">

            {/* Header */}
            <header
                className="sticky top-0 z-40 text-white px-4 py-3.5 shadow-lg border-b border-amber-400/25 rounded-b-3xl"
                style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 72%, #8C621E 100%)' }}
            >
                <div className="max-w-lg mx-auto flex items-center justify-between gap-2">
                    <button
                        type="button"
                        onClick={stage === STAGE.CONFIG ? handleExit : stage === STAGE.SCANNING ? goBackToConfig : goBackToScanning}
                        className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors active:scale-90 shrink-0 cursor-pointer"
                        aria-label="رجوع"
                    >
                        <ArrowRight size={20} />
                    </button>
                    <div className="flex items-center gap-2 min-w-0">
                        <img src={getLogoUrl()} alt={TENANT_CONFIG.CHURCH_NAME} className="w-8 h-8 rounded-full bg-white p-0.5 border border-amber-300/60 object-contain shrink-0" />
                        <div className="min-w-0 text-center">
                            <h1 className="font-calligraphic text-base font-bold text-amber-100 flex items-center gap-1.5 truncate">
                                <QrCode size={16} className="text-amber-300 shrink-0" />
                                <span className="truncate">{stageTitle[stage]}</span>
                            </h1>
                            <p className="text-[10px] font-bold text-amber-200/80 truncate">{TENANT_CONFIG.CHURCH_NAME}</p>
                        </div>
                    </div>
                    {stage === STAGE.SCANNING ? (
                        <button
                            type="button"
                            onClick={() => scanner.setIsMuted(m => !m)}
                            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${scanner.isMuted ? 'bg-red-500/80 text-white' : 'bg-white/15 text-amber-200 hover:bg-white/25'}`}
                            aria-label={scanner.isMuted ? 'تشغيل الصوت' : 'كتم الصوت'}
                        >
                            {scanner.isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                        </button>
                    ) : (
                        <div className="w-10" />
                    )}
                </div>
            </header>

            <main className="max-w-lg mx-auto px-4 pb-32">

                {/* STAGE 1: SESSION CONFIG */}
                {stage === STAGE.CONFIG && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-5 mt-5">

                        {/* Hero Card */}
                        <div
                            className="rounded-3xl p-6 text-center text-white shadow-xl border border-amber-400/30"
                            style={{ background: 'linear-gradient(135deg, #162447 0%, #22386E 70%, #7C5819 100%)' }}
                        >
                            <div className="w-16 h-16 rounded-2xl bg-white/15 border border-amber-300/40 flex items-center justify-center mx-auto mb-3 shadow-md">
                                <QrCode size={32} className="text-amber-200" />
                            </div>
                            <h2 className="font-calligraphic text-2xl font-bold text-amber-100 mb-1.5">تسجيل الحضور بـ QR</h2>
                            <p className="text-xs sm:text-sm text-amber-100/85 font-bold leading-relaxed max-w-xs mx-auto">
                                اختر نوع الاجتماع والتاريخ لبدء مسح الكارنيهات أو التسجيل الفوري بنقرة واحدة
                            </p>
                        </div>

                        {/* Event Type & Weekly Sessions Picker */}
                        <div className="coptic-card rounded-3xl p-5 border border-[#DFC48F] shadow-sm space-y-4">
                            {weeklySessions.length > 0 && (
                                <div>
                                    <label className="text-xs font-black text-[#1B2A59] mb-2 flex items-center gap-2">
                                        <Calendar size={14} className="text-[#C8942E]" />
                                        جلسات الأسبوع المعتمدة للفصل:
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        {weeklySessions.map((sess) => {
                                            const isActive = selectedDate === sess.date && eventType === sess.type;
                                            return (
                                                <button
                                                    key={sess.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setEventType(sess.type);
                                                        setSelectedDate(sess.date);
                                                        setSelectedSessionKey(sess.id);
                                                    }}
                                                    className={`px-3 py-2 rounded-xl text-xs font-black border transition-all cursor-pointer ${
                                                        isActive
                                                            ? (sess.type === 'liturgy' ? 'bg-[#1B2A59] text-amber-200 border-[#1B2A59] shadow-sm' : 'bg-emerald-700 text-white border-emerald-800 shadow-sm')
                                                            : 'bg-[#FAF4E8] text-[#1B2A59] border-[#DFC48F] hover:border-[#8C621E]'
                                                    }`}
                                                >
                                                    {sess.label} ({formatSessionShortDateAr(sess.date)})
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="text-xs font-black text-[#1B2A59] mb-2.5 flex items-center gap-2">
                                    <Sparkles size={14} className="text-[#C8942E]" />
                                    نوع الاجتماع / المناسبة
                                </label>
                                <div className="grid grid-cols-2 gap-3">
                                    {EVENT_TYPES.map(evt => {
                                        const Icon = evt.icon;
                                        const isSelected = eventType === evt.id;
                                        return (
                                            <button
                                                key={evt.id}
                                                type="button"
                                                onClick={() => setEventType(evt.id)}
                                                style={isSelected ? { background: evt.activeGrad } : undefined}
                                                className={`relative overflow-hidden rounded-2xl p-4 border-2 transition-all duration-200 active:scale-95 cursor-pointer ${
                                                    isSelected
                                                        ? 'border-amber-300 text-white shadow-lg scale-[1.02]'
                                                        : 'bg-[#FAF3E3]/70 border-[#DFC48F] text-[#1B2A59] hover:border-[#C8942E]'
                                                }`}
                                            >
                                                <div className={`w-11 h-11 rounded-xl border flex items-center justify-center mb-2.5 mx-auto ${isSelected ? 'bg-white/20 border-white/30 text-amber-200' : evt.iconBg}`}>
                                                    <Icon size={22} />
                                                </div>
                                                <p className={`text-sm font-black ${isSelected ? 'text-white' : 'text-[#1B2A59]'}`}>
                                                    {evt.label}
                                                </p>
                                                {isSelected && (
                                                    <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-amber-400 text-[#162447] flex items-center justify-center">
                                                        <CheckCircle2 size={13} />
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Date Picker */}
                            <div>
                                <label className="text-xs font-black text-[#1B2A59] mb-2 flex items-center gap-2">
                                    <Calendar size={14} className="text-[#C8942E]" />
                                    تاريخ الحضور
                                </label>
                                <input
                                    type="date"
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                    className="coptic-cream-input w-full text-[#1B2A59] font-black py-3 px-4 rounded-xl outline-none text-sm"
                                />
                            </div>
                        </div>

                        {/* Proceed Button */}
                        <button
                            type="button"
                            onClick={goToScanning}
                            disabled={!canProceed}
                            className={`w-full py-4 rounded-2xl font-black text-base flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl cursor-pointer ${
                                canProceed
                                    ? 'bg-gradient-to-r from-[#1B2A59] to-[#233975] text-amber-100 border border-amber-400/40 hover:opacity-95'
                                    : 'bg-stone-200 text-stone-400 cursor-not-allowed shadow-none'
                            }`}
                        >
                            <Camera size={22} className="text-amber-300" />
                            بدء المسح وتسجيل الحضور
                            <ChevronLeft size={18} />
                        </button>
                    </div>
                )}

                {/* STAGE 2: ACTIVE SCANNING + MANUAL FALLBACK */}
                {stage === STAGE.SCANNING && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-5 mt-4">

                        {/* Session Indicator Pill */}
                        <div className="flex items-center justify-center">
                            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#1B2A59] text-amber-100 border border-amber-400/40 shadow-sm">
                                {React.createElement(activeEventConfig.icon, { size: 14, className: 'text-amber-300' })}
                                <span className="text-xs font-black">
                                    {activeEventConfig.label} — {selectedDate}
                                </span>
                            </div>
                        </div>

                        {/* Camera Viewport Card */}
                        <section>
                            <div className="relative rounded-3xl overflow-hidden coptic-card border-2 border-[#DFC48F] shadow-xl">
                                <div
                                    id={scanner.containerId}
                                    className="w-full"
                                    style={{ minHeight: scanner.isActive ? '300px' : '0px', transition: 'min-height 0.3s' }}
                                />

                                {scanner.flashColor && (
                                    <div
                                        className={`absolute inset-0 z-20 pointer-events-none transition-opacity duration-300 rounded-3xl ${
                                            scanner.flashColor === 'green' ? 'bg-emerald-500/25' :
                                            scanner.flashColor === 'amber' ? 'bg-amber-500/25' :
                                            'bg-red-500/25'
                                        }`}
                                    />
                                )}

                                {/* Idle State */}
                                {!scanner.isActive && !scanner.cameraError && (
                                    <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
                                        <div className="w-20 h-20 rounded-full bg-[#FAF3E3] border-2 border-[#DFC48F] flex items-center justify-center mb-4">
                                            <Camera size={34} className="text-[#1B2A59]" />
                                        </div>
                                        <h2 className="text-lg font-black text-[#1B2A59] mb-1.5">الكاميرا جاهزة لمسح الكارنيهات</h2>
                                        <p className="text-xs text-[#6E5329] font-bold leading-relaxed mb-5 max-w-xs">
                                            اضغط لفتح الكاميرا لمسح بطاقات المخدومين، أو استخدم قائمة التسجيل السريع بالأسفل في حال عدم توفر كاميرا
                                        </p>
                                        <button
                                            type="button"
                                            onClick={scanner.startCamera}
                                            disabled={scanner.isStarting}
                                            className="bg-gradient-to-r from-[#1B2A59] to-[#233975] text-amber-100 px-7 py-3.5 rounded-2xl font-black text-sm shadow-lg hover:opacity-95 active:scale-95 transition-all flex items-center gap-2.5 disabled:opacity-50 cursor-pointer"
                                        >
                                            {scanner.isStarting ? (
                                                <>
                                                    <div className="w-4 h-4 border-2 border-amber-200 border-t-transparent rounded-full animate-spin" />
                                                    جاري تشغيل الكاميرا...
                                                </>
                                            ) : (
                                                <>
                                                    <Camera size={18} className="text-amber-300" />
                                                    فتح الكاميرا للمسح
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}

                                {/* Error State */}
                                {scanner.cameraError && (
                                    <div className="flex flex-col items-center justify-center py-8 px-6 text-center bg-rose-50/70">
                                        <div className="w-16 h-16 rounded-full bg-rose-100 border border-rose-200 flex items-center justify-center mb-4">
                                            <XCircle size={32} className="text-rose-600" />
                                        </div>
                                        <p className="text-xs sm:text-sm font-bold text-rose-800 leading-relaxed mb-4 max-w-xs">{scanner.cameraError}</p>
                                        <button
                                            type="button"
                                            onClick={() => { scanner.setCameraError(null); scanner.startCamera(); }}
                                            className="bg-rose-600 text-white px-5 py-2.5 rounded-xl font-black text-xs hover:bg-rose-700 active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
                                        >
                                            <RotateCcw size={14} /> إعادة المحاولة
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Camera Active Controls */}
                            {scanner.isActive && (
                                <div className="mt-3 flex gap-3">
                                    <button
                                        type="button"
                                        onClick={scanner.stopCamera}
                                        className="flex-1 bg-rose-600 hover:bg-rose-700 text-white py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-colors active:scale-95 cursor-pointer"
                                    >
                                        <CameraOff size={18} /> إيقاف الكاميرا
                                    </button>
                                    <button
                                        type="button"
                                        onClick={goToReview}
                                        disabled={scanner.scannedCount === 0}
                                        className={`flex-1 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer ${
                                            scanner.scannedCount > 0
                                                ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                                                : 'bg-stone-200 text-stone-400 cursor-not-allowed'
                                        }`}
                                    >
                                        <ClipboardList size={18} /> مراجعة وحفظ
                                    </button>
                                </div>
                            )}
                        </section>

                        {/* Quick Manual Search / 1-Tap Check-In List */}
                        <section className="coptic-card rounded-3xl p-4 sm:p-5 border border-[#DFC48F] shadow-sm space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-sm font-black text-[#1B2A59] flex items-center gap-2">
                                    <UserCheck size={17} className="text-[#C8942E]" />
                                    تسجيل سريع بالاسم أو الكود
                                </h3>
                                <span className="text-[11px] font-black text-[#8C621E] bg-[#FAF3E3] px-2.5 py-0.5 rounded-full border border-[#DFC48F]">
                                    {quickManualChildren.length} مخدوم
                                </span>
                            </div>

                            <div className="relative">
                                <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8C621E]" />
                                <input
                                    type="text"
                                    value={manualQuery}
                                    onChange={(e) => setManualQuery(e.target.value)}
                                    placeholder="اكتب اسم المخدوم أو الكود للتسجيل بنقرة واحدة..."
                                    className="coptic-cream-input w-full pr-10 pl-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-[#1B2A59] outline-none"
                                />
                            </div>

                            <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
                                {quickManualChildren.map(child => {
                                    const alreadyScanned = scannedIdSet.has(String(child.id));
                                    return (
                                        <div
                                            key={child.id}
                                            className="p-2.5 rounded-2xl bg-[#FAF3E3]/70 border border-[#DFC48F] flex items-center justify-between gap-2"
                                        >
                                            <div className="min-w-0">
                                                <p className="text-xs sm:text-sm font-black text-[#1B2A59] truncate">{child.name}</p>
                                                <p className="text-[10px] font-bold text-[#6E5329] font-mono" dir="ltr">{child.qrId || `KHD:${child.id}`}</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => alreadyScanned ? scanner.removeItem(String(child.id)) : scanner.markChildManually(child)}
                                                className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                                                    alreadyScanned
                                                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                                        : 'bg-[#1B2A59] hover:bg-[#142047] text-amber-100'
                                                }`}
                                            >
                                                <CheckCircle2 size={13} />
                                                {alreadyScanned ? 'تم المسح' : 'تحضير'}
                                            </button>
                                        </div>
                                    );
                                })}
                                {quickManualChildren.length === 0 && (
                                    <p className="text-center py-4 text-xs font-bold text-[#6E5329]">
                                        لا توجد أسماء مطابقة في الفصل الحالي
                                    </p>
                                )}
                            </div>
                        </section>

                        {/* Toast Notification */}
                        {scanner.toastMessage && (
                            <div
                                className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl font-black text-sm shadow-2xl border max-w-[90vw] ${
                                    scanner.toastMessage.type === 'success' ? 'bg-emerald-700 text-white border-emerald-400' :
                                    scanner.toastMessage.type === 'warning' ? 'bg-amber-600 text-white border-amber-300' :
                                    'bg-rose-700 text-white border-rose-400'
                                }`}
                            >
                                {scanner.toastMessage.message}
                            </div>
                        )}

                        {/* Running Summary Banner (Fixed at Bottom) */}
                        <div className="fixed bottom-0 left-0 right-0 z-30 bg-[#FFFDF7]/95 backdrop-blur-xl border-t border-[#DFC48F] px-4 py-3.5 shadow-lg">
                            <div className="max-w-lg mx-auto flex items-center justify-between gap-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-11 h-11 rounded-2xl bg-emerald-100 flex items-center justify-center border border-emerald-300 text-emerald-800">
                                        <Users size={20} />
                                    </div>
                                    <div>
                                        <p className="text-sm font-black text-[#1B2A59]">
                                            {scanner.scannedCount} مخدوم تم تسجيلهم
                                        </p>
                                        <p className="text-[11px] text-[#8C621E] font-bold">
                                            {activeEventConfig.label} — {selectedDate}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={goToReview}
                                    disabled={scanner.scannedCount === 0}
                                    className={`px-5 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition-all active:scale-95 cursor-pointer ${
                                        scanner.scannedCount > 0
                                            ? 'bg-[#1B2A59] text-amber-100 hover:bg-[#142047] shadow-md'
                                            : 'bg-stone-200 text-stone-400 cursor-not-allowed'
                                    }`}
                                >
                                    <ClipboardList size={14} />
                                    مراجعة ({scanner.scannedCount})
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* STAGE 3: REVIEW */}
                {stage === STAGE.REVIEW && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-5 mt-5">

                        {/* Review Header Card */}
                        <div
                            className="rounded-3xl p-5 text-white shadow-xl border border-amber-400/35"
                            style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 72%, #7C5819 100%)' }}
                        >
                            <div className="flex items-center gap-4 mb-4">
                                <div className="w-13 h-13 rounded-2xl bg-white/15 border border-amber-300/40 flex items-center justify-center shadow-md">
                                    {React.createElement(activeEventConfig.icon, { size: 25, className: 'text-amber-200' })}
                                </div>
                                <div>
                                    <h2 className="font-calligraphic text-xl font-bold text-amber-100">{activeEventConfig.label}</h2>
                                    <p className="text-xs text-amber-200/80 font-bold flex items-center gap-1.5 mt-0.5">
                                        <Calendar size={12} /> {selectedDate}
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <div className="flex-1 bg-white/10 border border-white/15 rounded-2xl p-3 text-center">
                                    <p className="text-2xl font-black text-amber-200 tabular-nums">{scanner.scannedCount}</p>
                                    <p className="text-[11px] font-black text-amber-100/80 mt-0.5">إجمالي الحضور</p>
                                </div>
                                <div className="flex-1 bg-white/10 border border-white/15 rounded-2xl p-3 text-center">
                                    <p className="text-2xl font-black text-rose-200 tabular-nums">
                                        {scanner.scannedList.filter(s => s.gender === 'بنت').length}
                                    </p>
                                    <p className="text-[11px] font-black text-amber-100/80 mt-0.5">بنات</p>
                                </div>
                                <div className="flex-1 bg-white/10 border border-white/15 rounded-2xl p-3 text-center">
                                    <p className="text-2xl font-black text-sky-200 tabular-nums">
                                        {scanner.scannedList.filter(s => s.gender !== 'بنت').length}
                                    </p>
                                    <p className="text-[11px] font-black text-amber-100/80 mt-0.5">أولاد</p>
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={goBackToScanning}
                                className="flex-1 coptic-card hover:bg-[#FAF3E3] text-[#1B2A59] py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-colors border border-[#DFC48F] cursor-pointer"
                            >
                                <ScanLine size={18} className="text-[#C8942E]" />
                                العودة للمسح
                            </button>
                            <button
                                type="button"
                                onClick={() => scanner.clearAll()}
                                disabled={scanner.scannedCount === 0}
                                className="bg-rose-50 hover:bg-rose-100 text-rose-700 px-4 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-colors border border-rose-200 cursor-pointer"
                            >
                                <Trash2 size={16} />
                                تفريغ القائمة
                            </button>
                        </div>

                        {/* Scanned Children List */}
                        <div>
                            <h3 className="text-sm font-black text-[#1B2A59] mb-3 flex items-center gap-2 px-1">
                                <CheckCircle2 size={16} className="text-emerald-700" />
                                قائمة المخدومين المسجلين ({scanner.scannedCount})
                            </h3>

                            {scanner.scannedCount === 0 ? (
                                <div className="text-center py-12 coptic-card border border-dashed border-[#DFC48F] rounded-3xl text-[#6E5329]">
                                    <ScanLine size={38} className="mx-auto mb-3 opacity-35 text-[#C8942E]" />
                                    <p className="font-bold text-sm">لا يوجد مخدومون في القائمة حالياً</p>
                                    <p className="text-xs mt-1">ارجع لشاشة المسح لإضافة المخدومين</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {scanner.scannedList.map((item) => (
                                        <div
                                            key={item.childId}
                                            className="coptic-card border border-[#DFC48F] rounded-2xl px-4 py-3 flex items-center justify-between gap-2 shadow-sm"
                                        >
                                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                                <div className="w-10 h-10 rounded-full bg-[#FAF3E3] border border-[#DFC48F] text-[#1B2A59] flex items-center justify-center shrink-0">
                                                    <User size={18} />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-black text-[#1B2A59] truncate">{item.name}</p>
                                                    <p className="text-[10px] text-[#8C621E] font-bold mt-0.5 font-mono truncate" dir="ltr">
                                                        {item.raw}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => scanner.removeItem(item.childId)}
                                                className="w-9 h-9 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition-all shrink-0 cursor-pointer"
                                                aria-label={`حذف ${item.name}`}
                                            >
                                                <X size={15} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Save Button */}
                        {scanner.scannedCount > 0 && (
                            <button
                                type="button"
                                onClick={handleSaveAttendance}
                                disabled={isSaving}
                                className={`w-full py-4 rounded-2xl font-black text-base flex items-center justify-center gap-3 shadow-xl transition-all cursor-pointer ${
                                    isSaving
                                        ? 'bg-stone-300 text-stone-500 cursor-not-allowed shadow-none'
                                        : 'bg-gradient-to-r from-emerald-700 to-teal-700 text-white hover:opacity-95'
                                }`}
                            >
                                {isSaving ? (
                                    <>
                                        <Loader2 size={22} className="animate-spin" />
                                        جاري الحفظ...
                                    </>
                                ) : (
                                    <>
                                        <Save size={22} />
                                        اعتماد وحفظ الحضور ({scanner.scannedCount} مخدوم)
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                )}

            </main>

            {/* SAVE RESULT MODAL */}
            {saveResult && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#162447]/65 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="coptic-card border-2 border-[#DFC48F] w-full max-w-sm rounded-3xl p-6 shadow-2xl">
                        <div className="flex justify-center mb-4">
                            {saveResult.success ? (
                                <div className="w-20 h-20 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-700">
                                    <CheckCircle2 size={40} />
                                </div>
                            ) : (
                                <div className="w-20 h-20 rounded-full bg-rose-100 border border-rose-300 flex items-center justify-center text-rose-700">
                                    <XCircle size={40} />
                                </div>
                            )}
                        </div>

                        <h2 className={`text-lg font-black text-center mb-2 ${saveResult.success ? 'text-emerald-800' : 'text-rose-700'}`}>
                            {saveResult.success ? 'تم حفظ الحضور بنجاح' : 'تنبيه أثناء الحفظ'}
                        </h2>

                        <p className="text-sm text-[#6E5329] font-bold text-center leading-relaxed whitespace-pre-line mb-2">
                            {saveResult.message}
                        </p>

                        {saveResult.success && saveResult.count > 0 && (
                            <div className="flex justify-center my-4">
                                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-6 py-3 text-center">
                                    <p className="text-3xl font-black text-emerald-800 tabular-nums">{saveResult.count}</p>
                                    <p className="text-[11px] font-black text-emerald-700 mt-0.5">مخدوم تم تسجيل حضورهم</p>
                                </div>
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={handleDismissSaveResult}
                            className="w-full py-3.5 rounded-2xl font-black text-sm flex items-center justify-center gap-2 bg-[#1B2A59] hover:bg-[#142047] text-amber-100 shadow-lg mt-4 cursor-pointer"
                        >
                            {saveResult.success ? (
                                <>
                                    <QrCode size={16} className="text-amber-300" />
                                    جلسة جديدة
                                </>
                            ) : (
                                <>
                                    <ArrowRight size={16} />
                                    رجوع
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

        </div>
    );
}
