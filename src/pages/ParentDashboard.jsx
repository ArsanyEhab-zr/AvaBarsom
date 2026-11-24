import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { QRCodeCanvas } from 'qrcode.react';
import { LogOut, Award, CheckCheck, UserCircle, Trophy, Church, ArrowRight, Crown, Search, Users, UserCheck, KeyRound } from 'lucide-react';
import { firestore, isFirebaseConfigured } from '../db/firebase';
import { doc, collection, onSnapshot } from 'firebase/firestore';
import { decryptData } from '../encryption';
import { TENANT_CONFIG, getLogoUrl, getAppEdition, readScopedStorage, writeScopedStorage, removeScopedStorage } from '../utils/tenantConfig';
import { db } from '../db/database';
import { isAttendanceRecordPresent, isAttendanceRecordExplicitAbsent } from '../utils/churchDataEngine';
import { resolveSessionMetaForDate } from '../utils/attendanceSessionHelper';
import { BookOpen as CurriculumBookIcon, FileText as LessonFileIcon, ExternalLink as LessonLinkIcon } from 'lucide-react';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
import { getOsraCurricula, getOsraCopticBookPlans, isCopticBookPlanItem, openCurriculumAttachment, isPdfCurriculumItem, syncClassCurriculaWithCloud } from '../utils/curriculumEngine';
import { ActiveFridayLessonCard } from '../components/CopticBookProgressionSection';
import { BroadcastMessagesFeed, IncomingMessageToastBanner, NotificationPermissionBanner } from '../components/BroadcastMessageCenter';
import { DEFAULT_CHURCH_LOGO_PATH, resolveOsraLogoUrl } from '../utils/realChurchStructure';

function getDistinctionBadge(grade, maxGrade) {
    if (!maxGrade || grade === null || grade === undefined) return { label: 'تم الرصد', cls: 'bg-amber-100 text-amber-800' };
    const pct = Math.round((Number(grade) / Number(maxGrade)) * 100);
    if (pct >= 85) return { label: 'امتياز', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', pct };
    if (pct >= 70) return { label: 'جيد جداً', cls: 'bg-indigo-100 text-[#1B2A59] border-indigo-200', pct };
    if (pct >= 50) return { label: 'جيد', cls: 'bg-amber-100 text-amber-800 border-amber-200', pct };
    if (pct >= 40) return { label: 'مقبول', cls: 'bg-sky-100 text-sky-800 border-sky-200', pct };
    return { label: 'يحتاج متابعة', cls: 'bg-rose-100 text-rose-700 border-rose-200', pct };
}

export default function ParentDashboard() {
    const navigate = useNavigate();
    const accessScope = resolveUserAccessScope(null, [], { includeFallback: true });
    const isParentLocked = accessScope.isParent;
    const [childId, setChildId] = useState(() => readScopedStorage('parentChildId') || accessScope.parentChildId || '');
    const [childName, setChildName] = useState(() => readScopedStorage('parentChildName') || accessScope.parentSession?.childName || '');
    const [syncKey, setSyncKey] = useState(() => readScopedStorage('parentSyncKey') || accessScope.parentSession?.syncKey || '');
    const [className, setClassName] = useState(() => readScopedStorage('parentClassName') || accessScope.parentSession?.className || '');
    const [studentSearch, setStudentSearch] = useState('');

    const [cloudChildInfo, setCloudChildInfo] = useState(null);
    const [cloudAttendance, setCloudAttendance] = useState([]);
    const [cloudGrades, setCloudGrades] = useState([]);

    const allowedSyncKeysKey = (accessScope.allowedSyncKeys || []).join('|');
    const allStudents = useLiveQuery(
        async () => {
            if (isParentLocked) return [];
            const rows = await db.children.filter(c => !c.isDeleted).toArray();
            if (accessScope.isSuperAdmin) return rows;
            const allowedSet = new Set(accessScope.allowedSyncKeys || []);
            return rows.filter(c => allowedSet.has(c.syncKey));
        },
        [isParentLocked, accessScope.isSuperAdmin, allowedSyncKeysKey]
    ) || [];

    const allCurricula = useLiveQuery(
        () => (db.curricula ? db.curricula.toArray() : Promise.resolve([])),
        []
    ) || [];

    const filteredStudents = useMemo(() => {
        const q = studentSearch.trim().toLowerCase();
        return [...allStudents]
            .filter(s => !q || String(s.name || '').toLowerCase().includes(q) || String(s.id || '').includes(q) || String(s.osraName || s.className || '').toLowerCase().includes(q))
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar'))
            .slice(0, 24);
    }, [allStudents, studentSearch]);

    const handleSelectStudent = (student) => {
        const idStr = String(student.id);
        const sKey = String(student.syncKey || '');
        const sClass = student.className || student.osraName || student.syncKey || 'أسرة الكنيسة';
        writeScopedStorage('parentChildId', idStr);
        writeScopedStorage('parentChildName', student.name || 'المخدوم');
        writeScopedStorage('parentSyncKey', sKey);
        writeScopedStorage('parentClassName', sClass);
        setChildId(idStr);
        setChildName(student.name || 'المخدوم');
        setSyncKey(sKey);
        setClassName(sClass);
        setCloudChildInfo(null);
        setCloudAttendance([]);
        setCloudGrades([]);
    };

    const handleResetSelection = () => {
        if (isParentLocked) return;
        removeScopedStorage('parentChildId');
        removeScopedStorage('parentChildName');
        removeScopedStorage('parentSyncKey');
        removeScopedStorage('parentClassName');
        setChildId('');
        setChildName('');
        setSyncKey('');
        setClassName('');
    };

    // Live reactive Dexie reads (always works 100% offline & demo)
    const localChild = useLiveQuery(
        () => (childId ? db.children.get(childId) : null),
        [childId]
    );
    const localAttendance = useLiveQuery(
        () => (childId ? db.attendance.where('childId').equals(childId).filter(a => !a.isDeleted).toArray() : []),
        [childId]
    ) || [];
    const localGradesRows = useLiveQuery(
        () => (childId ? db.grades.where('childId').equals(childId).filter(g => !g.isDeleted).toArray() : []),
        [childId]
    ) || [];
    const localExamsRows = useLiveQuery(
        () => db.exams.filter(e => !e.isDeleted).toArray(),
        []
    ) || [];
    const localPointsRows = useLiveQuery(
        () => (childId ? db.pointsLogs.where('childId').equals(childId).filter(p => !p.isDeleted).toArray() : []),
        [childId]
    ) || [];

    // Optional Firebase real-time sync when configured
    useEffect(() => {
        if (!isFirebaseConfigured || !childId || !syncKey || !firestore) return;

        const childRef = doc(firestore, 'Osras', syncKey, 'children', childId.toString());
        const unsubscribeChild = onSnapshot(childRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setCloudChildInfo(data.payload ? decryptData(data.payload) : data);
            }
        }, (err) => console.error('Error listening to child info:', err));

        const attendanceRef = collection(firestore, 'Osras', syncKey, 'attendance');
        const unsubscribeAttendance = onSnapshot(attendanceRef, (querySnapshot) => {
            const list = [];
            const targetIdStr = String(childId).trim();
            querySnapshot.forEach(docSnap => {
                const data = docSnap.data();
                const decrypted = data?.payload ? decryptData(data.payload) : data;
                if (decrypted) {
                    const recordChildIdStr = String(decrypted.childId || '').trim();
                    if (recordChildIdStr === targetIdStr) {
                        list.push({ id: docSnap.id, ...decrypted });
                    }
                }
            });
            if (list.length > 0) setCloudAttendance(list);
        }, (err) => console.error('Error listening to attendance:', err));

        void syncClassCurriculaWithCloud(syncKey, firestore);

        return () => {
            unsubscribeChild();
            unsubscribeAttendance();
        };
    }, [childId, syncKey]);

    useEffect(() => {
        if (!isFirebaseConfigured || !childId || !syncKey || !firestore) return;

        const examsRef = collection(firestore, 'Osras', syncKey, 'exams');
        let activeGradeUnsubscribes = {};
        const gradesMap = {};

        const unsubscribeExams = onSnapshot(examsRef, (examsSnapshot) => {
            const examsList = [];
            const newGradeUnsubscribes = {};

            const updateGradesState = () => {
                const combinedGrades = examsList.map(exam => {
                    const gradeObj = gradesMap[exam.id];
                    return {
                        examId: exam.id,
                        examName: exam.examName,
                        category: exam.category || gradeObj?.category || '',
                        note: gradeObj?.note || '',
                        date: exam.date,
                        grade: gradeObj ? gradeObj.grade : null,
                        maxGrade: exam.maxGrade
                    };
                }).filter(g => g.grade !== null);
                setCloudGrades(combinedGrades);
            };

            examsSnapshot.forEach((examDoc) => {
                const examData = examDoc.data();
                const examId = examDoc.id;
                examsList.push({ id: examId, ...examData });

                if (activeGradeUnsubscribes[examId]) {
                    newGradeUnsubscribes[examId] = activeGradeUnsubscribes[examId];
                    delete activeGradeUnsubscribes[examId];
                } else {
                    const gradeDocRef = doc(firestore, 'Osras', syncKey, 'exams', examId, 'grades', childId.toString());
                    newGradeUnsubscribes[examId] = onSnapshot(gradeDocRef, (gradeDocSnap) => {
                        if (gradeDocSnap.exists()) {
                            const gradeData = gradeDocSnap.data();
                            const decrypted = gradeData.payload ? decryptData(gradeData.payload) : gradeData;
                            if (decrypted) gradesMap[examId] = decrypted;
                        } else {
                            delete gradesMap[examId];
                        }
                        updateGradesState();
                    }, (err) => console.error('Error listening to grade:', err));
                }
            });

            Object.values(activeGradeUnsubscribes).forEach(unsub => unsub());
            activeGradeUnsubscribes = newGradeUnsubscribes;
            if (!examsSnapshot.empty) updateGradesState();
        }, (err) => console.error('Error listening to exams:', err));

        return () => {
            unsubscribeExams();
            Object.values(activeGradeUnsubscribes).forEach(unsub => unsub());
        };
    }, [childId, syncKey]);

    const handleLogout = () => {
        removeScopedStorage('parentChildId');
        removeScopedStorage('parentChildName');
        removeScopedStorage('parentSyncKey');
        removeScopedStorage('parentClassName');
        removeScopedStorage('parentSession');
        if (isParentLocked) {
            [
                'userRole',
                'currentSyncKey',
                'currentServant',
                'assignedOsra',
                'servantSession',
                'impersonated_osra',
                'isSuperAdminImpersonating',
                'masterSyncKey',
                'selectedOsra'
            ].forEach((k) => removeScopedStorage(k));
            const targetLogoutRoute = getAppEdition() === 'parent' ? '/parent-login' : '/login';
            navigate(targetLogoutRoute, { replace: true });
            if (typeof window !== 'undefined') {
                window.setTimeout(() => {
                    window.dispatchEvent(new Event('syncKey-changed'));
                    window.dispatchEvent(new Event('auth-changed'));
                }, 0);
            }
            return;
        }
        handleResetSelection();
    };

    const childInfo = cloudChildInfo || localChild;
    const resolvedChildSyncKey = childInfo?.syncKey || syncKey || accessScope.parentSession?.syncKey || '';
    const [settingsTick, setSettingsTick] = useState(0);
    useEffect(() => {
        const onUpdate = () => setSettingsTick((t) => t + 1);
        window.addEventListener('church-settings-updated', onUpdate);
        window.addEventListener('storage', onUpdate);
        return () => {
            window.removeEventListener('church-settings-updated', onUpdate);
            window.removeEventListener('storage', onUpdate);
        };
    }, []);

    const parentClassLogoUrl = useMemo(() => {
        try {
            const s = JSON.parse(readScopedStorage('appSettings') || '{}');
            for (const srv of (s.services || [])) {
                const matched = (srv.osras || []).find(
                    (o) => String(o.syncKey || '').trim() === String(resolvedChildSyncKey).trim()
                );
                if (matched) {
                    return resolveOsraLogoUrl(matched, srv, getLogoUrl());
                }
            }
        } catch (_e) {}
        return getLogoUrl() || DEFAULT_CHURCH_LOGO_PATH;
    }, [resolvedChildSyncKey, settingsTick]);

    const classCurricula = (() => {
        if (!resolvedChildSyncKey) return [];
        let settingsOsras = [];
        try {
            const s = JSON.parse(readScopedStorage('appSettings') || '{}');
            settingsOsras = (s.services || []).flatMap((srv) => srv.osras || []);
        } catch {
            settingsOsras = [];
        }
        return getOsraCurricula(resolvedChildSyncKey, allCurricula, settingsOsras);
    })();
    const attendance = cloudAttendance.length > 0 ? cloudAttendance : localAttendance;

    const grades = useMemo(() => {
        const examsById = new Map(localExamsRows.map(e => [String(e.firebaseId || e.id), e]));
        const localMapped = localGradesRows.map(g => {
            const examMeta = examsById.get(String(g.examId));
            return {
                examId: g.examId,
                examName: g.examName || examMeta?.examName || 'تقييم',
                category: g.category || examMeta?.category || '',
                note: g.note || '',
                date: g.date || examMeta?.date || '',
                grade: g.grade,
                maxGrade: g.maxGrade || examMeta?.maxGrade || 10
            };
        });
        const merged = cloudGrades.length > 0 ? cloudGrades : localMapped;
        return [...merged].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }, [cloudGrades, localGradesRows, localExamsRows]);

    const dedupedAttendanceEvents = useMemo(() => {
        const bySession = new Map();
        for (const a of (attendance || [])) {
            if (!a || !a.date || !a.type || a.type === 'visitation') continue;
            const dStr = String(a.date).split('T')[0];
            const sKey = String(a.sessionKey || a.type).trim();
            const key = `${dStr}::${sKey}`;
            const prev = bySession.get(key);
            const tNew = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const tOld = prev?.updatedAt ? new Date(prev.updatedAt).getTime() : -1;
            if (!prev || tNew >= tOld) {
                bySession.set(key, { ...a, date: dStr, sessionKey: sKey });
            }
        }
        return Array.from(bySession.values())
            .filter(a => !a.isDeleted && a.status !== 'unmarked' && (isAttendanceRecordPresent(a) || isAttendanceRecordExplicitAbsent(a)))
            .map(a => {
                const isPresent = isAttendanceRecordPresent(a);
                const resolvedMeta = a.sessionLabel
                    ? { sessionLabel: a.sessionLabel }
                    : resolveSessionMetaForDate({
                        syncKey: resolvedChildSyncKey,
                        className: childInfo?.className || childInfo?.osraName || className || '',
                        date: a.date,
                        type: a.type
                    });
                return {
                    ...a,
                    isPresent,
                    isAbsent: !isPresent && isAttendanceRecordExplicitAbsent(a),
                    resolvedLabel: resolvedMeta.sessionLabel || (a.type === 'liturgy' ? 'القداس' : a.type === 'tasbeha' ? 'التسبحة' : 'الخدمة')
                };
            })
            .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }, [attendance, resolvedChildSyncKey, childInfo, className]);

    const totalServices = dedupedAttendanceEvents.filter(a => (a.type === 'service' || a.type === 'service_meeting') && a.isPresent).length;
    const totalServiceAbsences = dedupedAttendanceEvents.filter(a => (a.type === 'service' || a.type === 'service_meeting') && a.isAbsent).length;
    const totalLiturgies = dedupedAttendanceEvents.filter(a => a.type === 'liturgy' && a.isPresent).length;
    const totalPoints = localPointsRows.reduce((sum, p) => sum + (Number(p.points) || 0), 0);

    const displayName = childInfo?.name || childName || 'المخدوم';
    const displayClass = childInfo?.className || childInfo?.osraName || childInfo?.syncKey || className || TENANT_CONFIG.APP_NAME;
    const childImg = childInfo?.profilePic || childInfo?.image || childInfo?.photo;

    if (!childId) {
        if (isParentLocked) {
            return (
                <div className="min-h-screen coptic-cream-surface flex flex-col items-center justify-center p-6 text-center" dir="rtl">
                    <div className="coptic-card max-w-md w-full p-6 rounded-3xl border border-[#DFC48F] space-y-4">
                        <h2 className="font-calligraphic text-xl font-bold text-[#1B2A59]">تعذر تحديد بيانات المخدوم</h2>
                        <p className="text-sm font-bold text-[#6E5329]">يرجى إعادة تسجيل الدخول برقم ولي الأمر وكود المخدوم.</p>
                        <button
                            type="button"
                            onClick={handleLogout}
                            className="bg-[#1B2A59] text-amber-100 px-5 py-2.5 rounded-xl font-black text-sm inline-flex items-center gap-2 cursor-pointer"
                        >
                            <LogOut size={16} /> العودة لتسجيل الدخول
                        </button>
                    </div>
                </div>
            );
        }
        return (
            <div className="min-h-screen coptic-cream-surface pb-20" dir="rtl">
                <header
                    className="text-white p-5 rounded-b-[2rem] shadow-lg sticky top-0 z-40 border-b border-amber-400/25"
                    style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 72%, #8C621E 100%)' }}
                >
                    <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-12 h-12 rounded-full bg-white p-1 border border-amber-300/70 shadow-sm shrink-0 overflow-hidden">
                                <img src={getLogoUrl()} alt={TENANT_CONFIG.CHURCH_NAME} className="w-full h-full object-contain rounded-full" />
                            </div>
                            <div className="min-w-0">
                                <h1 className="font-calligraphic text-xl font-bold text-amber-100 truncate">
                                    بوابة نتائج المخدومين وأولياء الأمور
                                </h1>
                                <p className="text-xs font-bold text-amber-200/90 truncate">{TENANT_CONFIG.CHURCH_NAME}</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => navigate('/')}
                            className="bg-white/15 hover:bg-white/25 px-3.5 py-2 rounded-full text-xs font-black transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
                        >
                            <ArrowRight size={15} /> الرئيسية
                        </button>
                    </div>
                </header>

                <main className="p-4 max-w-3xl mx-auto mt-5 space-y-5">
                    <section className="coptic-card rounded-3xl p-6 border border-[#DFC48F] shadow-xl space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 className="font-calligraphic text-xl font-bold text-[#1B2A59] flex items-center gap-2">
                                    <Users size={20} className="text-[#C8942E]" /> اختر مخدوماً لعرض بطاقته ونتائجه
                                </h2>
                                <p className="text-xs font-bold text-[#6E5329] mt-1">
                                    ابحث بالاسم أو الكود لعرض الحضور والنقاط ونتائج الامتحانات فوراً
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => navigate('/parent-login')}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-[#1B2A59] border border-amber-300 font-black text-xs transition-all cursor-pointer"
                            >
                                <KeyRound size={14} className="text-[#C8942E]" /> تسجيل الدخول بكود ولي الأمر
                            </button>
                        </div>

                        <div className="relative">
                            <Search size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8C621E]" />
                            <input
                                type="text"
                                value={studentSearch}
                                onChange={(e) => setStudentSearch(e.target.value)}
                                placeholder="ابحث باسم المخدوم أو الأسرة أو الكود..."
                                className="coptic-cream-input w-full pr-10 pl-4 py-3 rounded-2xl text-sm font-bold text-[#1B2A59] outline-none"
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[55vh] overflow-y-auto pr-0.5">
                            {filteredStudents.map((s) => (
                                <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => handleSelectStudent(s)}
                                    className="p-3.5 rounded-2xl bg-[#FAF3E3]/80 hover:bg-amber-50 border border-[#DFC48F] hover:border-[#C8942E] flex items-center justify-between gap-3 text-right transition-all cursor-pointer group"
                                >
                                    <div className="min-w-0">
                                        <p className="font-black text-[#1B2A59] text-sm truncate group-hover:text-[#8C621E] transition-colors">
                                            {s.name || 'بدون اسم'}
                                        </p>
                                        <p className="text-[11px] font-bold text-[#6E5329] truncate mt-0.5">
                                            {s.osraName || s.className || s.syncKey || 'أسرة الكنيسة'}
                                        </p>
                                    </div>
                                    <span className="inline-flex items-center gap-1 text-[11px] font-black bg-[#1B2A59] text-amber-100 px-3 py-1.5 rounded-xl shrink-0">
                                        <UserCheck size={13} /> عرض النتيجة
                                    </span>
                                </button>
                            ))}
                            {filteredStudents.length === 0 && (
                                <div className="sm:col-span-2 text-center py-8 text-sm font-bold text-[#6E5329]">
                                    لا توجد نتائج مطابقة للبحث الحالي
                                </div>
                            )}
                        </div>
                    </section>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen coptic-cream-surface pb-20" dir="rtl">
            <header
                className="text-white p-4 sm:p-5 rounded-b-3xl sm:rounded-b-[2.25rem] shadow-lg sticky top-0 z-50 border-b border-amber-400/25"
                style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 72%, #8C621E 100%)' }}
            >
                <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-full bg-white p-1 border border-amber-300/70 shadow-sm shrink-0 overflow-hidden">
                            <img
                                src={parentClassLogoUrl}
                                alt={TENANT_CONFIG.CHURCH_NAME}
                                onError={(e) => {
                                    e.currentTarget.onerror = null;
                                    e.currentTarget.src = DEFAULT_CHURCH_LOGO_PATH;
                                }}
                                className="w-full h-full object-contain rounded-full"
                            />
                        </div>
                        <div className="min-w-0">
                            <h1 className="font-calligraphic text-lg sm:text-xl font-bold text-amber-100 truncate">
                                أهلاً بك يا {displayName}
                            </h1>
                            <p className="text-xs font-bold text-indigo-100/90 truncate">
                                {displayClass} • {TENANT_CONFIG.CHURCH_NAME}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {!isParentLocked && (
                            <>
                                <button
                                    type="button"
                                    onClick={handleResetSelection}
                                    className="bg-amber-400/20 hover:bg-amber-400/30 border border-amber-300/40 text-amber-100 px-3 py-2 rounded-full text-xs font-black transition-colors flex items-center gap-1 cursor-pointer"
                                    title="تبديل الطالب"
                                >
                                    <Users size={14} />
                                    <span className="hidden sm:inline">تبديل المخدوم</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => navigate('/')}
                                    className="bg-white/15 hover:bg-white/25 px-3 py-2 rounded-full text-xs font-black transition-colors flex items-center gap-1 cursor-pointer"
                                    title="الرئيسية"
                                >
                                    <ArrowRight size={15} />
                                    <span className="hidden sm:inline">الرئيسية</span>
                                </button>
                            </>
                        )}
                        <button
                            type="button"
                            onClick={handleLogout}
                            className={`transition-colors cursor-pointer flex items-center gap-1.5 ${isParentLocked ? 'bg-rose-500/85 hover:bg-rose-600 text-white px-3.5 py-2 rounded-full text-xs font-black shadow-sm' : 'bg-white/15 hover:bg-rose-500/80 p-2.5 rounded-full'}`}
                            title={isParentLocked ? 'تسجيل الخروج' : 'خروج من العرض'}
                        >
                            <LogOut size={16} />
                            {isParentLocked && <span>تسجيل الخروج</span>}
                        </button>
                    </div>
                </div>
            </header>

            <main className="p-4 max-w-4xl mx-auto mt-5 space-y-5">
                {/* Hero Profile Card */}
                <div
                    className="rounded-3xl p-6 sm:p-7 shadow-xl relative overflow-hidden flex flex-col sm:flex-row items-center gap-5 text-center sm:text-right border border-amber-400/35 animate-card-enter"
                    style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 72%, #5B4318 100%)' }}
                >
                    <div className="relative shrink-0">
                        <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden border-4 border-amber-400 shadow-lg flex items-center justify-center bg-[#111C3D]">
                            {childImg ? (
                                <img
                                    src={childImg}
                                    alt={displayName}
                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <UserCircle className="w-16 h-16 text-amber-300 stroke-[1.5]" />
                            )}
                        </div>
                    </div>

                    <div className="flex-1 space-y-2 text-white min-w-0">
                        <h2 className="font-calligraphic text-2xl sm:text-3xl font-bold text-amber-100">
                            {displayName}
                        </h2>
                        <p className="text-sm sm:text-base font-black text-amber-300">
                            {displayClass}
                        </p>
                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-white/15 text-amber-100 border border-white/20">
                                <Trophy size={13} className="text-amber-300" /> {totalPoints} نقطة مكتسبة
                            </span>
                            {childInfo?.fatherConfessor && (
                                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-emerald-400/20 text-emerald-200 border border-emerald-400/30">
                                    أب الاعتراف: {childInfo.fatherConfessor}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* تنبيه تفعيل إشعارات الرسائل + رسائل وإعلانات الأسرة والكنيسة */}
                <IncomingMessageToastBanner />
                <NotificationPermissionBanner />
                <BroadcastMessagesFeed
                    mode="parent"
                    childSyncKey={resolvedChildSyncKey}
                    title="رسائل وإعلانات الأسرة والكنيسة"
                />

                {/* Attendance & Points KPI Summary */}
                <section className="coptic-card p-5 rounded-3xl border border-[#DFC48F] animate-card-enter">
                    <h2 className="font-calligraphic text-lg sm:text-xl font-bold text-[#1B2A59] mb-4 flex items-center gap-2">
                        <CheckCheck className="text-emerald-700" /> ملخص المواظبة والنقاط
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-emerald-50/90 p-3.5 rounded-2xl border border-emerald-200 flex flex-col items-center text-center">
                            <span className="text-xs font-black text-emerald-700 mb-1">حضور الخدمة</span>
                            <span className="text-2xl sm:text-3xl font-black text-emerald-800 tabular-nums">{totalServices}</span>
                        </div>
                        <div className="bg-rose-50/90 p-3.5 rounded-2xl border border-rose-200 flex flex-col items-center text-center">
                            <span className="text-xs font-black text-rose-700 mb-1">غياب الخدمة</span>
                            <span className="text-2xl sm:text-3xl font-black text-rose-800 tabular-nums">{totalServiceAbsences}</span>
                        </div>
                        <div className="bg-indigo-50/90 p-3.5 rounded-2xl border border-indigo-200 flex flex-col items-center text-center">
                            <span className="text-xs font-black text-[#1B2A59] mb-1 flex items-center gap-1">
                                <Church size={13} /> القداس
                            </span>
                            <span className="text-2xl sm:text-3xl font-black text-[#1B2A59] tabular-nums">{totalLiturgies}</span>
                        </div>
                        <div className="bg-amber-50/90 p-3.5 rounded-2xl border border-amber-300 flex flex-col items-center text-center">
                            <span className="text-xs font-black text-[#8C621E] mb-1">إجمالي النقاط</span>
                            <span className="text-2xl sm:text-3xl font-black text-[#8C621E] tabular-nums">{totalPoints}</span>
                        </div>
                    </div>

                    {dedupedAttendanceEvents.length > 0 && (
                        <div className="mt-4 pt-3.5 border-t border-[#E5D3B3] space-y-2">
                            <p className="text-xs font-black text-[#6E5329]">آخر الجلسات المسجلة:</p>
                            <div className="flex flex-wrap gap-2">
                                {dedupedAttendanceEvents.slice(0, 8).map((ev) => (
                                    <span
                                        key={`${ev.date}_${ev.sessionKey}`}
                                        className={`inline-flex items-center gap-1.5 text-[11px] font-black px-2.5 py-1 rounded-xl border ${
                                            ev.isPresent
                                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                                : 'bg-rose-50 text-rose-700 border-rose-200'
                                        }`}
                                    >
                                        <span>{ev.resolvedLabel} - {ev.isPresent ? 'حاضر' : 'غائب'}</span>
                                        <span className="opacity-70 tabular-nums" dir="ltr">({ev.date})</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </section>

                {/* Exams and Grades */}
                <section className="coptic-card p-5 rounded-3xl border border-[#DFC48F] animate-card-enter">
                    <h2 className="font-calligraphic text-lg sm:text-xl font-bold text-[#1B2A59] mb-4 flex items-center gap-2">
                        <Award className="text-[#8C621E]" /> نتائج الامتحانات والتقييمات ({grades.length})
                    </h2>
                    <div className="space-y-3">
                        {grades.length > 0 ? grades.map((g, i) => {
                            const badge = getDistinctionBadge(g.grade, g.maxGrade);
                            const pct = g.maxGrade > 0 ? Math.min(100, Math.round((Number(g.grade) / Number(g.maxGrade)) * 100)) : 0;
                            return (
                                <div key={`${g.examId || g.examName}_${i}`} className="p-4 bg-[#FAF3E3]/80 rounded-2xl border border-[#DFC48F] space-y-2">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            {g.category && (
                                                <span className="inline-block text-[10px] font-black bg-[#EFE0C2] text-[#7A5617] px-2 py-0.5 rounded-full mb-1">
                                                    {g.category}
                                                </span>
                                            )}
                                            <h3 className="font-black text-[#1B2A59] text-sm sm:text-base">{g.examName}</h3>
                                            <p className="text-xs font-bold text-[#6E5329] mt-0.5">{g.date}</p>
                                            {g.note && (
                                                <p className="text-xs font-bold text-[#1B2A59] mt-1">ملاحظة الخادم: {g.note}</p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[11px] font-black px-2.5 py-1 rounded-full border ${badge.cls}`}>
                                                {badge.label}
                                            </span>
                                            <div className="bg-[#1B2A59] text-amber-200 px-3 py-1.5 rounded-xl font-black text-sm tabular-nums">
                                                {g.grade} / {g.maxGrade}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="w-full h-2 bg-[#EFE0C2] rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-l from-amber-500 to-[#1B2A59] rounded-full transition-all"
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        }) : (
                            <div className="text-center py-6 text-[#6E5329] font-bold text-sm">
                                لا توجد درجات امتحانات مسجلة لهذا المخدوم حتى الآن.
                            </div>
                        )}
                    </div>
                </section>

                {/* Class Curricula & Lessons (Child's Class Only) */}
                <section className="coptic-card p-5 rounded-3xl border border-[#DFC48F] animate-card-enter space-y-4">
                    <h2 className="font-calligraphic text-lg sm:text-xl font-bold text-[#1B2A59] flex items-center gap-2">
                        <CurriculumBookIcon className="text-[#8C621E]" /> مناهج ودروس الفصل ({classCurricula.length})
                    </h2>

                    <ActiveFridayLessonCard
                        copticBooks={classCurricula.filter((item) => isCopticBookPlanItem(item))}
                        headingPrefix="درس هذه الجمعة لابنك"
                    />

                    {classCurricula.length > 0 ? (
                        <div className="space-y-3">
                            {classCurricula.map((item, idx) => {
                                const isPdf = isPdfCurriculumItem(item);
                                return (
                                    <div key={item.id || `${idx}_${item.title}`} className="p-4 bg-[#FAF3E3]/80 rounded-2xl border border-[#DFC48F] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="min-w-0 space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                {item.trackName && (
                                                    <span className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-0.5 rounded-full bg-[#1B2A59] text-amber-200">
                                                        {item.trackName}
                                                    </span>
                                                )}
                                                <span className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-0.5 rounded-full bg-amber-100 text-[#8C621E] border border-amber-300">
                                                    <LessonFileIcon size={12} /> {item.category || 'منهج الفصل'}
                                                </span>
                                                {item.date && (
                                                    <span className="text-[11px] font-bold text-[#6E5329]">{item.date}</span>
                                                )}
                                            </div>
                                            <h3 className="font-black text-[#1B2A59] text-sm sm:text-base">{item.title}</h3>
                                            {item.content && (
                                                <p className="text-xs text-[#6E5329] font-semibold line-clamp-2">{item.content}</p>
                                            )}
                                        </div>
                                        {item.fileUrl && (
                                            <button
                                                type="button"
                                                onClick={() => openCurriculumAttachment(navigate, item.fileUrl, item.title)}
                                                className="shrink-0 bg-[#1B2A59] hover:bg-[#142047] text-amber-100 px-3.5 py-2 rounded-xl font-black text-xs inline-flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                                            >
                                                <LessonLinkIcon size={14} className="text-amber-300" />
                                                {isPdf ? 'فتح المنهج (PDF)' : 'فتح الرابط'}
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="text-center py-6 text-[#6E5329] font-bold text-sm">
                            لا توجد مناهج أو دروس مضافة لهذا الفصل حالياً.
                        </div>
                    )}
                </section>

                {/* QR Code Section */}
                <section className="coptic-card p-6 rounded-3xl border border-[#DFC48F] flex flex-col items-center justify-center text-center">
                    <div className="bg-white p-4 rounded-3xl border-2 border-[#DFC48F] shadow-inner mb-3 inline-block">
                        <QRCodeCanvas value={`KHD:${childInfo?.qrId || childId}`} size={156} level="M" includeMargin={false} />
                    </div>
                    <p className="font-black text-[#1B2A59] font-mono text-sm tracking-wide" dir="ltr">
                        كود المخدوم: {childInfo?.qrId || childId}
                    </p>
                    <p className="text-xs font-bold text-[#6E5329] mt-1">
                        بطاقة الحضور السريع (QR) والاستعلام عن النتائج
                    </p>
                </section>
            </main>
        </div>
    );
}
