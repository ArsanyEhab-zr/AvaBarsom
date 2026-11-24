/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import { ArrowRight, UserCheck, CheckCircle2, XCircle, Circle, Check, Church, BookOpen, MapPin, Save, BellRing, Sparkles } from 'lucide-react';
import { doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { firestore } from '../db/firebase';
import { useNavigate } from 'react-router-dom';
import { useSmartNavigation } from '../hooks/useSmartNavigation';
import { logActivity } from '../utils/activityLogger';
import { TENANT_CONFIG,
    readScopedStorage
} from '../utils/tenantConfig';

export default function ServantSelfCheckIn() {
    const { goBack } = useSmartNavigation();
    const navigate = useNavigate();
    const [isSaving, setIsSaving] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    const getLocalYYYYMMDD = (d = new Date()) => {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const today = new Date();
    const todayMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const currentServant = JSON.parse(readScopedStorage('currentServant') || '{}');

    const weekDate = getLocalYYYYMMDD();
    const [year, month, dayStr] = weekDate.split('-');
    const displayDate = `${dayStr}/${month}/${year}`;
    const docId = `${weekDate}_${currentServant.uid || currentServant.phone || 'servant'}`;
    const localDraftKey = `servantSelfCheckIn_${docId}`;

    const [hasSavedRecord, setHasSavedRecord] = useState(false);

    const [record, setRecord] = useState(() => {
        try {
            const cached = localStorage.getItem(localDraftKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && ['حضور', 'غياب', 'اعتذار'].includes(parsed.attendance)) {
                    return parsed;
                }
            }
        } catch {
            // ignore
        }
        return {
            uid: currentServant.uid || currentServant.phone || 'demo_servant',
            phone: currentServant.phone ? String(currentServant.phone).trim() : "",
            servantId: currentServant.id || "",
            osraName: currentServant.assignedOsra || currentServant.osraName || "",
            name: currentServant.name || "خادم",
            weekDate,
            month: todayMonth,
            attendance: "",
            status: "",
            liturgy: false,
            preparation: false,
            meeting: false,
            visitation: false,
            confessionDate: "",
            activitiesService: false,
            activitiesDiocese: "",
            tasks: "",
            leaderNotes: ""
        };
    });

    useEffect(() => {
        if (!firestore) return;
        const docRef = doc(firestore, "ServantAttendance", docId);
        const unsubscribe = onSnapshot(docRef, (snap) => {
            if (snap.exists()) {
                const d = snap.data();
                setHasSavedRecord(Boolean(d?.attendance && ['حضور', 'غياب', 'اعتذار'].includes(d.attendance)));
                setRecord(prev => ({ ...prev, ...d }));
            } else {
                setHasSavedRecord(false);
            }
        });
        return () => unsubscribe();
    }, [docId]);

    const handleUpdate = (field, value) => {
        setRecord(prev => {
            const updated = { ...prev, [field]: value };
            if (field === 'attendance') {
                updated.status = value === 'حضور'
                    ? 'present'
                    : (value === 'غياب' ? 'absent' : (value === 'اعتذار' ? 'excused' : ''));
                if (value !== 'حضور') {
                    updated.liturgy = false;
                    updated.preparation = false;
                    updated.meeting = false;
                    updated.visitation = false;
                }
            }
            return updated;
        });
    };

    const handleSave = async () => {
        if (!record.attendance) {
            if (hasSavedRecord) {
                setIsSaving(true);
                try {
                    localStorage.removeItem(localDraftKey);
                    if (firestore && record.uid && record.uid !== "undefined") {
                        await deleteDoc(doc(firestore, "ServantAttendance", docId));
                    }
                    setHasSavedRecord(false);
                    setIsSaving(false);
                    setShowSuccess(true);
                    setTimeout(() => {
                        setShowSuccess(false);
                        goBack('/');
                    }, 1200);
                } catch (error) {
                    console.error("Error clearing attendance:", error);
                    alert("حدث خطأ أثناء إلغاء التسجيل.");
                    setIsSaving(false);
                }
                return;
            }
            alert("برجاء اختيار حالتك اليوم أولاً (حاضر أو غائب).");
            return;
        }

        setIsSaving(true);
        try {
            const statusCode = record.attendance === 'حضور'
                ? 'present'
                : (record.attendance === 'غياب' ? 'absent' : 'excused');
            const cleanRecord = { ...record, status: statusCode };
            Object.keys(cleanRecord).forEach(key => {
                if (cleanRecord[key] === undefined) cleanRecord[key] = "";
            });

            localStorage.setItem(localDraftKey, JSON.stringify(cleanRecord));

            if (firestore && cleanRecord.uid && cleanRecord.uid !== "undefined") {
                const docRef = doc(firestore, "ServantAttendance", docId);
                await setDoc(docRef, cleanRecord, { merge: true });
            }

            const attendanceStatus = cleanRecord.attendance === 'حضور' ? 'حاضر' : (cleanRecord.attendance === 'اعتذار' ? 'اعتذار' : 'غائب');
            logActivity('RECORD_ATTENDANCE', `تسجيل حضور خادم: ${cleanRecord.name || 'خادم'} — ${attendanceStatus} ليوم ${weekDate}`);

            setIsSaving(false);
            setShowSuccess(true);
            setTimeout(() => {
                setShowSuccess(false);
                goBack('/');
            }, 1500);
        } catch (error) {
            console.error("Error saving attendance:", error);
            alert("حدث خطأ أثناء حفظ التسجيل.");
            setIsSaving(false);
        }
    };

    const ToggleCard = ({ label, icon: Icon, field, activeColor = "bg-[#1B2A59]", activeBg = "bg-indigo-50/90", activeBorder = "border-[#1B2A59]" }) => {
        const isActive = record[field];
        const isDisabled = record.attendance !== 'حضور' && field !== 'attendance';

        return (
            <button
                type="button"
                disabled={isDisabled}
                onClick={() => handleUpdate(field, !isActive)}
                className={`w-full p-4 rounded-2xl flex items-center justify-between border-2 transition-all duration-300 relative overflow-hidden group cursor-pointer
                    ${isDisabled ? 'opacity-40 cursor-not-allowed bg-[#FAF3E3] border-[#DFC48F]' :
                        isActive ? `${activeBg} ${activeBorder} shadow-sm` : 'coptic-card border-[#DFC48F] hover:border-[#C8942E]'}`}
            >
                <div className="flex items-center gap-3.5 relative z-10">
                    <div className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors duration-300 ${isActive ? activeColor + ' text-white shadow-md' : 'bg-[#FAF3E3] border border-[#DFC48F] text-[#8C621E]'}`}>
                        <Icon size={22} />
                    </div>
                    <span className="text-base sm:text-lg font-black text-[#1B2A59]">{label}</span>
                </div>

                <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all duration-300 relative z-10 ${isActive ? `border-transparent ${activeColor} text-white` : 'border-[#DFC48F]'}`}>
                    {isActive && <Check size={15} strokeWidth={4} />}
                </div>
            </button>
        );
    };

    return (
        <div className="min-h-screen coptic-cream-surface text-[#231B12] pb-24" dir="rtl">
            <header
                className="text-white p-5 sticky top-0 z-50 border-b border-amber-400/25 rounded-b-[2rem] shadow-lg"
                style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 72%, #8C621E 100%)' }}
            >
                <div className="max-w-md mx-auto flex items-center justify-between">
                    <button type="button" onClick={() => goBack('/')} className="w-11 h-11 bg-white/15 rounded-full flex items-center justify-center text-white hover:bg-white/25 transition-all cursor-pointer">
                        <ArrowRight size={22} />
                    </button>
                    <div className="text-center">
                        <h1 className="font-calligraphic text-xl font-bold text-amber-100 flex items-center gap-2 justify-center">
                            <Sparkles size={18} className="text-amber-300" /> تسجيلي اليوم
                        </h1>
                        <p className="text-[11px] font-bold text-amber-200/85 mt-0.5">{TENANT_CONFIG.CHURCH_NAME}</p>
                    </div>
                    <div className="w-11" />
                </div>
            </header>

            <main className="p-4 max-w-md mx-auto mt-5 space-y-5">
                {/* Greeting Card */}
                <div
                    className="p-6 rounded-3xl shadow-xl border border-amber-400/35 text-white flex items-center justify-between"
                    style={{ background: 'linear-gradient(135deg, #162447 0%, #22386E 70%, #7C5819 100%)' }}
                >
                    <div>
                        <h2 className="text-xs font-bold text-amber-200 mb-1">أهلاً بك في الخدمة يا</h2>
                        <h1 className="font-calligraphic text-2xl font-bold text-amber-100">{record.name}</h1>
                    </div>
                    {currentServant.photoURL || currentServant.profileImage || currentServant.profilePic ? (
                        <img
                            src={currentServant.photoURL || currentServant.profileImage || currentServant.profilePic}
                            alt={record.name}
                            className="w-15 h-15 rounded-full object-cover border-2 border-amber-300 shadow-md"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                    ) : (
                        <div className="w-15 h-15 rounded-full bg-white/15 flex items-center justify-center text-amber-200 border-2 border-amber-300/40">
                            <span className="text-lg font-black">{(record.name || 'خ').substring(0, 2)}</span>
                        </div>
                    )}
                </div>

                <div className="text-center">
                    <span className="inline-block bg-amber-100 border border-amber-300 text-[#1B2A59] font-black text-xs sm:text-sm px-4 py-2 rounded-full">
                        تسجيل متابعة الخدمة: {displayDate}
                    </span>
                </div>

                {/* Main Attendance 3-State Neutral Controls */}
                <div className="coptic-card p-5 rounded-3xl border border-[#DFC48F] shadow-sm space-y-3.5">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
                                record.attendance === 'حضور'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : record.attendance === 'غياب'
                                        ? 'bg-rose-100 text-rose-800'
                                        : 'bg-slate-100 text-slate-600'
                            }`}>
                                <UserCheck size={20} />
                            </div>
                            <div>
                                <p className="text-sm font-black text-[#1B2A59]">حالة حضورك اليوم</p>
                                <p className="text-xs font-bold text-[#6E5329]">
                                    {record.attendance === 'حضور'
                                        ? 'حاضر بالخدمة اليوم'
                                        : record.attendance === 'غياب'
                                            ? 'غائب عن الخدمة اليوم'
                                            : record.attendance === 'اعتذار'
                                                ? 'اعتذار مسبق'
                                                : 'لم يتم تسجيل حضورك اليوم بعد'}
                                </p>
                            </div>
                        </div>

                        {record.attendance === 'حضور' ? (
                            <span className="inline-flex items-center gap-1 text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded-full">
                                <CheckCircle2 size={13} /> حاضر
                            </span>
                        ) : record.attendance === 'غياب' ? (
                            <span className="inline-flex items-center gap-1 text-xs font-black bg-rose-100 text-rose-800 border border-rose-200 px-2.5 py-1 rounded-full">
                                <XCircle size={13} /> غائب
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-1 rounded-full">
                                <Circle size={12} /> لم يُسجل بعد
                            </span>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                        <button
                            type="button"
                            onClick={() => handleUpdate('attendance', record.attendance === 'حضور' ? '' : 'حضور')}
                            className={`min-h-[48px] py-3 px-4 rounded-2xl text-sm font-black border-2 transition-all flex items-center justify-center gap-2 cursor-pointer ${
                                record.attendance === 'حضور'
                                    ? 'bg-emerald-600 border-emerald-700 text-white shadow-md'
                                    : 'bg-white border-slate-300 text-[#1B2A59] hover:bg-slate-50'
                            }`}
                        >
                            <CheckCircle2 size={18} />
                            <span>حاضر</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleUpdate('attendance', record.attendance === 'غياب' ? '' : 'غياب')}
                            className={`min-h-[48px] py-3 px-4 rounded-2xl text-sm font-black border-2 transition-all flex items-center justify-center gap-2 cursor-pointer ${
                                record.attendance === 'غياب'
                                    ? 'bg-rose-700 border-rose-800 text-white shadow-md'
                                    : 'bg-white border-slate-300 text-[#1B2A59] hover:bg-slate-50'
                            }`}
                        >
                            <XCircle size={18} />
                            <span>غائب</span>
                        </button>
                    </div>
                </div>

                {/* Sub Activities */}
                <div className="space-y-3">
                    <ToggleCard label="حضرت القداس" icon={Church} field="liturgy" activeColor="bg-[#1B2A59]" activeBg="bg-indigo-50" activeBorder="border-[#1B2A59]" />
                    <ToggleCard label="حضرت اجتماع الخدمة" icon={BellRing} field="meeting" activeColor="bg-[#C8942E]" activeBg="bg-amber-50" activeBorder="border-[#C8942E]" />
                    <ToggleCard label="حضرت التحضير" icon={BookOpen} field="preparation" activeColor="bg-purple-700" activeBg="bg-purple-50" activeBorder="border-purple-600" />
                    <ToggleCard label="شاركت بالافتقاد" icon={MapPin} field="visitation" activeColor="bg-rose-700" activeBg="bg-rose-50" activeBorder="border-rose-600" />
                </div>

                {/* Eparchy Activities Section */}
                <div className="coptic-card p-5 rounded-3xl border border-[#DFC48F] shadow-sm">
                    <label className="block text-sm font-black text-[#1B2A59] mb-2">نشاط الإيبارشية</label>
                    <textarea
                        value={record.activitiesDiocese || ''}
                        onChange={e => handleUpdate('activitiesDiocese', e.target.value)}
                        placeholder="أدخل نشاط الإيبارشية هنا..."
                        className="coptic-cream-input resize-y min-h-[64px] p-3 w-full rounded-xl text-sm font-bold text-[#1B2A59] outline-none"
                    />
                </div>

                {/* Notes Section */}
                <div className="coptic-card p-5 rounded-3xl border border-[#DFC48F] shadow-sm">
                    <label className="block text-sm font-black text-[#1B2A59] mb-2">المهام / الملاحظات (للإدارة)</label>
                    <textarea
                        value={record.tasks || ''}
                        onChange={e => handleUpdate('tasks', e.target.value)}
                        placeholder="أدخل أي ملاحظات تود مشاركتها مع قيادة الخدمة..."
                        className="coptic-cream-input resize-y min-h-[64px] p-3 w-full rounded-xl text-sm font-bold text-[#1B2A59] outline-none"
                    />
                </div>

                {/* Submit Button */}
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving || showSuccess}
                    className={`w-full py-4 rounded-2xl font-black text-base flex items-center justify-center gap-3 transition-all shadow-xl cursor-pointer
                        ${showSuccess ? 'bg-emerald-700 text-white' : 'bg-[#1B2A59] hover:bg-[#142047] text-amber-100'}`}
                >
                    {isSaving ? (
                        <div className="w-6 h-6 border-4 border-amber-200/40 border-t-amber-200 rounded-full animate-spin" />
                    ) : showSuccess ? (
                        <><CheckCircle2 size={22} /> تم الحفظ بنجاح</>
                    ) : (
                        <><Save size={22} className="text-amber-300" /> حفظ تسجيلي</>
                    )}
                </button>
            </main>
        </div>
    );
}
