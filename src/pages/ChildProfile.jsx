import { useChurchDataEngine } from '../hooks/useChurchDataEngine';
import { attendanceIdentity, resolveAttendanceChild } from '../utils/childIdentity';
import { isAttendanceRecordPresent, isAttendanceRecordExplicitAbsent } from '../utils/churchDataEngine';
import { resolveSessionMetaForDate } from '../utils/attendanceSessionHelper';
import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { db } from '../db/database';
import useAutoSync from '../hooks/useAutoSync';
import { ArrowRight, Phone, Save, History, CheckCircle2, XCircle, AlertTriangle, Trash2, User, Clock, Calendar } from 'lucide-react';
import { logActivity } from '../utils/activityLogger';
import { deleteChildEverywhere } from '../db/sync';
import { VISITATION_TYPES, getVisitationInfo, formatLastVisitedDate } from '../utils/visitationTypes';
import { getLocalDateString } from '../utils/serviceWeek';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
import { useSmartNavigation } from '../hooks/useSmartNavigation';
import { readScopedStorage } from '../utils/tenantConfig';

const ChildProfile = () => {
    const { triggerAutoSync } = useAutoSync();
    const { goBack } = useSmartNavigation();
    const { id } = useParams();
    const navigate = useNavigate();
    const childId = String(id);
    const accessScope = resolveUserAccessScope(null, [], { includeFallback: true });
    const { canonicalData } = useChurchDataEngine(accessScope.allowedSyncKeys || []);
    const child = canonicalData.childMapById.get(childId);

    const rawChildAttendance = useLiveQuery(
        () => (child ? db.attendance.where('syncKey').equals(child.syncKey).toArray() : []),
        [child?.id, child?.syncKey]
    ) || [];

    const attendanceSummary = useMemo(() => {
        if (!child) return { servicePresent: 0, serviceAbsent: 0, liturgyPresent: 0, events: [] };
        const bySession = new Map();
        for (const r of rawChildAttendance) {
            if (!r || !r.date || !r.type || r.type === 'visitation') continue;
            const resolved = resolveAttendanceChild(r, canonicalData);
            if (!resolved || String(resolved.id) !== String(child.id)) continue;
            const dStr = String(r.date).split('T')[0];
            const sKey = String(r.sessionKey || r.type).trim();
            const key = `${dStr}::${sKey}`;
            const prev = bySession.get(key);
            const tNew = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
            const tOld = prev?.updatedAt ? new Date(prev.updatedAt).getTime() : -1;
            if (!prev || tNew >= tOld) {
                bySession.set(key, { ...r, date: dStr, sessionKey: sKey });
            }
        }
        const events = Array.from(bySession.values())
            .filter(r => !r.isDeleted && r.status !== 'unmarked' && (isAttendanceRecordPresent(r) || isAttendanceRecordExplicitAbsent(r)))
            .map(r => {
                const isPresent = isAttendanceRecordPresent(r);
                const meta = r.sessionLabel
                    ? { sessionLabel: r.sessionLabel }
                    : resolveSessionMetaForDate({ syncKey: child.syncKey, className: child.className || '', date: r.date, type: r.type });
                return {
                    ...r,
                    isPresent,
                    isAbsent: !isPresent && isAttendanceRecordExplicitAbsent(r),
                    label: meta.sessionLabel || (r.type === 'liturgy' ? 'القداس' : r.type === 'tasbeha' ? 'التسبحة' : 'الخدمة')
                };
            })
            .sort((a, b) => String(b.date).localeCompare(String(a.date)));

        return {
            servicePresent: events.filter(e => (e.type === 'service' || e.type === 'service_meeting') && e.isPresent).length,
            serviceAbsent: events.filter(e => (e.type === 'service' || e.type === 'service_meeting') && e.isAbsent).length,
            liturgyPresent: events.filter(e => e.type === 'liturgy' && e.isPresent).length,
            events
        };
    }, [child, rawChildAttendance, canonicalData]);

    const [isSaving, setIsSaving] = useState(false);
    const [aiSummary, setAiSummary] = useState('');
    const [visitationType, setVisitationType] = useState('home_inside');
    const [isInterventionRequired, setIsInterventionRequired] = useState(false);

    const handleDeleteChild = async () => {
        if (!child) return;
        if (window.confirm(`متأكد إنك عايز تمسح المخدوم (${child.name}) نهائياً؟`)) {
            const deletion = await deleteChildEverywhere(child, JSON.parse(readScopedStorage('currentServant') || '{}').name);
            if (deletion.pendingSync) alert('تم الحذف على هذا الجهاز؛ سيصل للأجهزة الأخرى عند اكتمال المزامنة.');
            goBack('/visitation');
        }
    };

    const saveNote = async () => {
        if (!aiSummary || isSaving) return;
        setIsSaving(true);
        
        const now = new Date().toISOString();
        const nowTs = Date.now();
        const todayStr = getLocalDateString();
        const currentServant = JSON.parse(readScopedStorage('currentServant') || '{}');
        const typeInfo = getVisitationInfo(visitationType);

        const newNote = {
            id: nowTs,
            text: aiSummary,
            date: now,
            visitationType: visitationType,
            visitationLabel: typeInfo.label,
            requiresIntervention: isInterventionRequired,
            interventionStatus: isInterventionRequired ? 'pending' : 'resolved',
            servantName: currentServant.name || 'خادم غير معروف',
            childName: child.name || 'مخدوم',
            osraName: currentServant.assignedOsra || child.stage || 'غير محدد'
        };
        
        const updatedNotes = child.notes ? [...child.notes, newNote] : [newNote];
        
        // 1. Update child record with last_visited, lastVisitationType, lastVisitationLabel
        await db.children.update(child.id, {
            notes: updatedNotes, 
            last_visited: nowTs,
            lastVisitationType: visitationType,
            lastVisitationLabel: typeInfo.label,
            isDirty: true,
            updatedAt: nowTs
        });

        // 2. Also log a visitation record in db.attendance
        await db.attendance.add({
            date: todayStr,
            ...attendanceIdentity(child),
            type: 'visitation',
            status: 'present',
            visitationType: visitationType,
            visitationLabel: typeInfo.label,
            note: aiSummary,
            syncKey: child.syncKey || currentServant.syncKey || 'default',
            isDirty: true,
            updatedAt: now,
            isDeleted: false
        });

        setIsSaving(false);
        setAiSummary('');
        setIsInterventionRequired(false);
        
        triggerAutoSync();

        // Audit Trail: تسجيل حفظ تقرير الافتقاد
        const logDetails = isInterventionRequired
            ? `إضافة تقرير ${typeInfo.label} + طلب تدخل أبوي للمخدوم: ${child.name}`
            : `إضافة تقرير ${typeInfo.label} للمخدوم: ${child.name}`;
        logActivity(isInterventionRequired ? 'SAVE_NOTE_WITH_INTERVENTION' : 'SAVE_NOTE', logDetails);

        alert('تم حفظ تقرير الافتقاد في ملف المخدوم بنجاح!');
    };

    if (!child) return <div className="min-h-screen coptic-cream-surface text-center p-10 font-bold text-[#6E604F] animate-pulse" dir="rtl">جاري تحميل ملف المخدوم...</div>;

    const isGirl = child.gender === 'بنت';
    const themeBg = isGirl ? 'bg-pink-50' : 'bg-[#EFF3FA]';
    const themeText = isGirl ? 'text-pink-700' : 'text-[#1B2A59]';
    const themeBorder = isGirl ? 'border-pink-200' : 'border-[#D4DFF0]';
    const badgeBg = isGirl ? 'bg-pink-50' : 'bg-[#F5EBD6]';

    return (
        <main className="min-h-screen coptic-cream-surface relative overflow-x-hidden font-sans pb-20" dir="rtl">
            <div className="relative z-10 max-w-3xl mx-auto px-4 pt-6">

                {/* ─── Header ─── */}
                <div className="coptic-card flex items-center justify-between mb-8 p-4 rounded-[2.5rem]">
                    <div className="flex items-center gap-4">
                        <div className={`w-14 h-14 rounded-full ${themeBg} ${themeText} flex items-center justify-center shadow-inner overflow-hidden border border-[#E5D7BF]`}>
                            {child.profilePic ? (
                                <img 
                                    src={child.profilePic} 
                                    width="56" 
                                    height="56" 
                                    loading="eager" 
                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    className="w-full h-full object-cover" 
                                    alt={child.name} 
                                />
                            ) : <User size={26} />}
                        </div>
                        <div>
                            <h1 className="text-xl md:text-2xl font-black text-[#1B2A59] flex items-center gap-2 flex-wrap">
                                {child.name}
                            </h1>
                            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[#6E604F] mt-1">
                                <span className={`px-2 py-0.5 rounded-full ${badgeBg} ${themeText} border ${themeBorder}`}>
                                    مواظبة: {child.streak || 0} / 4
                                </span>
                                {child.last_visited && (
                                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-black flex items-center gap-1 shadow-2xs ${getVisitationInfo(child.lastVisitationType).badgeClass}`}>
                                        <span className="flex items-center gap-1"><Clock size={11} /> آخر افتقاد: {formatLastVisitedDate(child.last_visited)}</span>
                                        <span>({child.lastVisitationLabel || getVisitationInfo(child.lastVisitationType).shortLabel})</span>
                                    </span>
                                )}
                                {child.fatherPhone && <span className="flex items-center gap-1" title="تليفون الأب"><Phone size={11} /> الأب: {child.fatherPhone}</span>}
                                {child.motherPhone && <span className="flex items-center gap-1" title="تليفون الأم"><Phone size={11} /> الأم: {child.motherPhone}</span>}
                                {child.childPhone && <span className="flex items-center gap-1" title="تليفون المخدوم"><Phone size={11} /> المخدوم: {child.childPhone}</span>}
                                {!child.fatherPhone && !child.motherPhone && !child.childPhone && child.phone && <span className="flex items-center gap-1"><Phone size={12} /> {child.phone}</span>}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={handleDeleteChild} 
                            title="حذف المخدوم نهائياً" 
                            className="flex items-center justify-center w-12 h-12 bg-rose-50 text-rose-600 rounded-full hover:bg-rose-600 hover:text-white transition-all shadow-sm cursor-pointer"
                        >
                            <Trash2 size={20} />
                        </button>
                        <button onClick={() => goBack('/visitation')} aria-label="الرجوع للخلف" className="flex items-center justify-center w-12 h-12 bg-[#FAF4E8] border border-[#E5D7BF] text-[#1B2A59] rounded-full hover:bg-[#1B2A59] hover:text-[#F4D078] transition-all shadow-sm cursor-pointer">
                            <ArrowRight size={20} />
                        </button>
                    </div>
                </div>


                {/* ─── سجل الحضور والغياب متعدد الجلسات ─── */}
                <section className="bg-white p-5 rounded-[2.5rem] shadow-sm border border-slate-200 mb-6">
                    <h3 className="text-base font-black text-[#1B2A59] mb-3 flex items-center gap-2">
                        <Calendar className="text-[#C8942E]" size={18} /> سجل الحضور والغياب المسجل
                    </h3>
                    <div className="grid grid-cols-3 gap-2.5 mb-3">
                        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-center">
                            <span className="block text-xl font-black text-emerald-800 tabular-nums">{attendanceSummary.servicePresent}</span>
                            <span className="text-[11px] font-bold text-emerald-700">حضور الخدمة</span>
                        </div>
                        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-center">
                            <span className="block text-xl font-black text-rose-800 tabular-nums">{attendanceSummary.serviceAbsent}</span>
                            <span className="text-[11px] font-bold text-rose-700">غياب الخدمة</span>
                        </div>
                        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-3 text-center">
                            <span className="block text-xl font-black text-[#1B2A59] tabular-nums">{attendanceSummary.liturgyPresent}</span>
                            <span className="text-[11px] font-bold text-[#1B2A59]">حضور القداس</span>
                        </div>
                    </div>
                    {attendanceSummary.events.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {attendanceSummary.events.slice(0, 12).map(ev => (
                                <span
                                    key={`${ev.date}_${ev.sessionKey}`}
                                    className={`inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-xl border ${
                                        ev.isPresent
                                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                            : 'bg-rose-50 text-rose-700 border-rose-200'
                                    }`}
                                >
                                    {ev.isPresent ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                                    <span>{ev.label} - {ev.isPresent ? 'حاضر' : 'غائب'}</span>
                                    <span className="opacity-70 tabular-nums" dir="ltr">({ev.date})</span>
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs font-bold text-slate-400 text-center py-2">
                            لم يُسجل حضور أو غياب لهذا المخدوم بعد.
                        </p>
                    )}
                </section>

                {/* ─── تقرير الافتقاد وتحديد نوعه ─── */}
                <section className="bg-linear-to-br from-indigo-900 to-purple-900 p-6 md:p-8 rounded-[2.5rem] shadow-xl text-white relative overflow-hidden group mb-8">
                    <div className="absolute -left-10 -top-10 w-40 h-40 bg-purple-500/20 rounded-full blur-3xl"></div>

                    <div className="relative z-10 flex flex-col items-center text-center">
                        <h2 className="text-2xl font-black mb-2 flex items-center gap-2">
                             إضافة تقرير افتقاد
                        </h2>

                        <div className="mt-8 w-full bg-white/10 backdrop-blur-md p-5 rounded-3xl border border-white/20 text-right">
                                <div className="animate-in fade-in slide-in-from-bottom-2 border-t border-white/10 pt-4">
                                    {/* 3 أزرار لاختيار نوع الافتقاد (Requirement #6) */}
                                    <div className="mb-4">
                                        <label className="block text-xs font-black text-indigo-100 mb-2">نوع الافتقاد:</label>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                            {VISITATION_TYPES.map(t => {
                                                const isSelected = visitationType === t.id;
                                                return (
                                                    <button
                                                        key={t.id}
                                                        type="button"
                                                        onClick={() => setVisitationType(t.id)}
                                                        className={`p-2.5 rounded-2xl border text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${
                                                            isSelected
                                                                ? 'bg-white text-indigo-950 border-white shadow-md font-black scale-102'
                                                                : 'bg-white/10 text-white/80 border-white/20 hover:bg-white/20'
                                                        }`}
                                                    >
                                                        <span>{t.label}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <textarea
                                        value={aiSummary}
                                        onChange={(e) => setAiSummary(e.target.value)}
                                        className="w-full bg-black/20 text-white p-3 rounded-xl border border-white/10 text-sm focus:ring-2 focus:ring-purple-400 outline-none min-h-[140px] mb-4"
                                        placeholder="اكتب تفاصيل الافتقاد هنا..."
                                    />
                                    <div className="flex items-center gap-2 mb-4 bg-amber-500/10 p-3 rounded-xl border border-amber-500/30">
                                        <input 
                                            type="checkbox" 
                                            id="intervention" 
                                            checked={isInterventionRequired} 
                                            onChange={(e) => setIsInterventionRequired(e.target.checked)}
                                            className="w-5 h-5 accent-amber-500 rounded cursor-pointer"
                                        />
                                        <label htmlFor="intervention" className="text-amber-200 font-bold text-sm cursor-pointer flex items-center gap-1">
                                            <AlertTriangle size={16} /> طلب تدخل أبوي (تصعيد المشكلة لأبونا أو أمين الخدمة)
                                        </label>
                                    </div>
                                    <button onClick={saveNote} className="w-full bg-green-500 text-white py-3 rounded-2xl font-black flex justify-center items-center gap-2 hover:bg-green-600 active:scale-95 transition-all shadow-lg">
                                        <Save size={18} /> حفظ التقرير في ملف المخدوم
                                    </button>
                                </div>
                        </div>
                    </div>
                </section>

                {/* ─── سجل الملاحظات السابقة ─── */}
                <section className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-200">
                    <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
                        <History className="text-indigo-500" size={20} /> سجل الافتقاد السابق
                    </h3>

                    {child.notes && child.notes.length > 0 ? (
                        <div className="space-y-4">
                            {[...child.notes].reverse().map(note => (
                                <div key={note.id} className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                                    <p className="text-[10px] text-slate-400 font-bold mb-2 flex justify-between">
                                        <span>{new Date(note.date).toLocaleString('ar-EG')}</span>
                                        {note.requiresIntervention && (
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] ${note.interventionStatus === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                {note.interventionStatus === 'resolved' ? 'تم حل المشكلة' : 'تدخل أبوي عاجل'}
                                            </span>
                                        )}
                                    </p>
                                    <p className="text-sm font-medium text-slate-700 whitespace-pre-wrap leading-relaxed">
                                        {note.text}
                                    </p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8 bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                            <p className="text-sm font-bold text-slate-400">مفيش أي تقارير افتقاد متسجلة للمخدوم ده لسه.</p>
                        </div>
                    )}
                </section>

            </div>
        </main>
    );
};

export default ChildProfile;
