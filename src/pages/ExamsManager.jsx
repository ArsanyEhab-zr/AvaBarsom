import React, { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
    Search,
    Award,
    ChevronRight,
    Trash2,
    Plus,
    Users,
    Calendar,
    GraduationCap,
    Sparkles,
    Save,
    Download,
    CheckCircle2,
    BookOpen,
    StickyNote,
    Loader2
} from 'lucide-react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../db/database';
import { firestore, isFirebaseConfigured } from '../db/firebase';
import { encryptData } from '../encryption';
import BottomNav from '../components/BottomNav';
import useAutoSync from '../hooks/useAutoSync';
import { useSmartNavigation } from '../hooks/useSmartNavigation';
import { resolveUserAccessScope, getImpersonatedOsra } from '../utils/notificationScopeEngine';
import { readScopedStorage } from '../utils/tenantConfig';
import { getLocalDateString } from '../utils/serviceWeek';

export const CHURCH_EXAM_CATEGORIES = [
    'امتحان الكتاب المقدس والعقيدة',
    'مسابقة المحفوظات والآيات',
    'تقييم الدروس والموضوعات الروحية',
    'الاختبار الشهري العام للأسرة',
    'تقييم المواظبة والمشاركة الكنسية',
    'تقييم مخصص (إدخال حر)'
];

export const EXAM_SCORE_PRESETS = [10, 20, 50, 100];

export function getDistinctionLabel(grade, maxGrade) {
    if (grade === '' || grade === null || grade === undefined || !maxGrade) return null;
    const numeric = Number(grade);
    const maxNum = Number(maxGrade);
    if (Number.isNaN(numeric) || maxNum <= 0) return null;
    const pct = Math.round((numeric / maxNum) * 100);
    if (pct >= 85) return { label: 'امتياز', badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300', pct };
    if (pct >= 70) return { label: 'جيد جداً', badgeClass: 'bg-indigo-100 text-[#1B2A59] border-indigo-200', pct };
    if (pct >= 50) return { label: 'جيد', badgeClass: 'bg-amber-100 text-amber-800 border-amber-300', pct };
    if (pct >= 40) return { label: 'مقبول', badgeClass: 'bg-sky-100 text-sky-800 border-sky-200', pct };
    return { label: 'يحتاج متابعة', badgeClass: 'bg-rose-100 text-rose-700 border-rose-200', pct };
}

export default function ExamsManager() {
    const { triggerAutoSync } = useAutoSync();
    const { goBack } = useSmartNavigation();
    const navigate = useNavigate();

    const [examName, setExamName] = useState('');
    const [examCategory, setExamCategory] = useState(CHURCH_EXAM_CATEGORIES[0]);
    const [customCategory, setCustomCategory] = useState('');
    const [maxGrade, setMaxGrade] = useState(20);
    const [examDate, setExamDate] = useState(() => getLocalDateString(new Date()));

    const [selectedExamId, setSelectedExamId] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [gradeStatusFilter, setGradeStatusFilter] = useState('ALL'); // ALL | GRADED | UNGRADED

    // Interactive batch-editable drafts per selected exam: { [childId]: { grade, note } }
    const [draftEntries, setDraftEntries] = useState({});
    const [isSavingBatch, setIsSavingBatch] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');

    const accessScope = resolveUserAccessScope(null, [], { includeFallback: true });
    const impersonatedOsra = getImpersonatedOsra();
    const activeSyncKey = accessScope.activeSyncKey || String(readScopedStorage('currentSyncKey') || '');
    const isMaster = accessScope.canSwitchClasses;

    const availableOsras = useMemo(() => {
        return accessScope.allowedOsras || [];
    }, [accessScope]);

    const allowedKeysSet = useMemo(() => new Set(accessScope.allowedSyncKeys || []), [accessScope]);
    const allowedKeysList = useMemo(() => Array.from(allowedKeysSet), [allowedKeysSet]);

    const [filterClassKey, setFilterClassKey] = useState(() => (isMaster ? 'ALL' : activeSyncKey));
    const [createTargetSyncKey, setCreateTargetSyncKey] = useState(() => {
        if (!isMaster) return activeSyncKey;
        const firstClass = availableOsras.find(o => o.syncKey === 'رابعة ابتدائي') || availableOsras[0];
        return firstClass?.syncKey || '';
    });

    useEffect(() => {
        if (!isMaster) {
            setFilterClassKey(activeSyncKey);
            setCreateTargetSyncKey(activeSyncKey);
        } else {
            if (filterClassKey !== 'ALL' && !allowedKeysSet.has(filterClassKey)) {
                setFilterClassKey('ALL');
            }
            if ((!createTargetSyncKey || !allowedKeysSet.has(createTargetSyncKey)) && availableOsras.length > 0) {
                const preferred = availableOsras.find(o => o.syncKey === 'رابعة ابتدائي') || availableOsras[0];
                setCreateTargetSyncKey(preferred?.syncKey || '');
            }
        }
    }, [isMaster, activeSyncKey, availableOsras, allowedKeysSet, filterClassKey, createTargetSyncKey]);

    const children = useLiveQuery(() => {
        if (accessScope.isSuperAdmin) {
            return db.children.filter(c => !c.isDeleted).toArray();
        }
        if (allowedKeysList.length === 0) return [];
        if (allowedKeysList.length === 1) {
            return db.children.where('syncKey').equals(allowedKeysList[0]).filter(c => !c.isDeleted).toArray();
        }
        return db.children.where('syncKey').anyOf(allowedKeysList).filter(c => !c.isDeleted).toArray();
    }, [accessScope.isSuperAdmin, allowedKeysList.join('|')]) || [];

    const exams = useLiveQuery(() => {
        if (accessScope.isSuperAdmin) {
            return db.exams.filter(e => !e.isDeleted).toArray();
        }
        if (allowedKeysList.length === 0) return [];
        if (allowedKeysList.length === 1) {
            return db.exams.where('syncKey').equals(allowedKeysList[0]).filter(e => !e.isDeleted).toArray();
        }
        return db.exams.where('syncKey').anyOf(allowedKeysList).filter(e => !e.isDeleted).toArray();
    }, [accessScope.isSuperAdmin, allowedKeysList.join('|')]) || [];

    const filteredExams = useMemo(() => {
        const scoped = accessScope.isSuperAdmin
            ? exams
            : exams.filter(e => allowedKeysSet.has(e.syncKey));
        const list = filterClassKey && filterClassKey !== 'ALL' && allowedKeysSet.has(filterClassKey)
            ? scoped.filter(e => e.syncKey === filterClassKey)
            : scoped;
        return [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }, [exams, filterClassKey, accessScope.isSuperAdmin, allowedKeysSet]);

    const selectedExam = useMemo(() => {
        if (!selectedExamId) return null;
        return exams.find(e => e.id === selectedExamId || e.firebaseId === selectedExamId) || null;
    }, [selectedExamId, exams]);

    const examGradesArray = useLiveQuery(() => {
        if (!selectedExam) return [];
        const examId = selectedExam.firebaseId || selectedExam.id?.toString();
        if (!examId) return [];
        return db.grades
            .where('examId').equals(examId)
            .filter(g => !g.isDeleted)
            .toArray();
    }, [selectedExam]) || [];

    useEffect(() => {
        if (!selectedExam) {
            setDraftEntries({});
            return;
        }
        const nextDraft = {};
        examGradesArray.forEach((g) => {
            nextDraft[String(g.childId)] = {
                grade: g.grade !== undefined && g.grade !== null ? String(g.grade) : '',
                note: String(g.note || '')
            };
        });
        setDraftEntries(nextDraft);
    }, [selectedExam?.id, selectedExam?.firebaseId, examGradesArray.length]);

    const classChildrenForExam = useMemo(() => {
        let list = children;
        if (selectedExam?.syncKey && selectedExam.syncKey !== 'MASTER_ACCESS') {
            list = list.filter(c => c.syncKey === selectedExam.syncKey);
        } else if (!isMaster && activeSyncKey) {
            list = list.filter(c => c.syncKey === activeSyncKey);
        }
        return [...list].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar'));
    }, [children, selectedExam, isMaster, activeSyncKey]);

    const examStats = useMemo(() => {
        if (!selectedExam) return { total: 0, gradedCount: 0, avgPct: 0, maxScore: 0 };
        const scores = classChildrenForExam
            .map(c => draftEntries[String(c.id)]?.grade)
            .filter(val => val !== undefined && val !== '' && !Number.isNaN(Number(val)))
            .map(Number);
        if (scores.length === 0) {
            return { total: classChildrenForExam.length, gradedCount: 0, avgPct: 0, maxScore: 0 };
        }
        const sum = scores.reduce((acc, n) => acc + n, 0);
        const avgPct = selectedExam.maxGrade > 0 ? Math.round((sum / scores.length / selectedExam.maxGrade) * 100) : 0;
        const maxScore = Math.max(...scores);
        return { total: classChildrenForExam.length, gradedCount: scores.length, avgPct, maxScore };
    }, [selectedExam, classChildrenForExam, draftEntries]);

    const filteredChildren = useMemo(() => {
        let list = classChildrenForExam;
        if (gradeStatusFilter === 'GRADED') {
            list = list.filter(c => {
                const val = draftEntries[String(c.id)]?.grade;
                return val !== undefined && val !== '';
            });
        } else if (gradeStatusFilter === 'UNGRADED') {
            list = list.filter(c => {
                const val = draftEntries[String(c.id)]?.grade;
                return val === undefined || val === '';
            });
        }
        if (searchQuery.trim()) {
            const q = searchQuery.trim().toLowerCase();
            list = list.filter(c => (c.name || '').toLowerCase().includes(q));
        }
        return list;
    }, [classChildrenForExam, gradeStatusFilter, draftEntries, searchQuery]);

    const resolvedCategoryLabel =
        examCategory === 'تقييم مخصص (إدخال حر)'
            ? (customCategory.trim() || 'تقييم مخصص')
            : examCategory;

    const handleSaveExam = async (e) => {
        e.preventDefault();
        if (!examName.trim()) {
            alert('يرجى إدخال اسم الامتحان أو التقييم أولاً.');
            return;
        }
        const targetKey = (isMaster ? createTargetSyncKey : activeSyncKey) || activeSyncKey || 'رابعة ابتدائي';
        try {
            const now = new Date().toISOString();
            const dateStr = examDate || now.split('T')[0];
            const firebaseId = `exam_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

            const examData = {
                firebaseId,
                examName: examName.trim(),
                category: resolvedCategoryLabel,
                maxGrade: Math.max(1, parseInt(maxGrade, 10) || 20),
                date: dateStr,
                syncKey: targetKey,
                isDirty: true,
                updatedAt: now,
                isDeleted: false
            };

            const localId = await db.exams.add(examData);
            triggerAutoSync();

            if (isFirebaseConfigured && firestore && navigator.onLine && targetKey && targetKey !== 'MASTER_ACCESS') {
                const docRef = doc(firestore, 'Osras', targetKey, 'exams', firebaseId);
                setDoc(docRef, {
                    id: firebaseId,
                    examName: examData.examName,
                    category: examData.category,
                    maxGrade: examData.maxGrade,
                    date: dateStr,
                    syncKey: targetKey,
                    updatedAt: now
                }).then(() => {
                    db.exams.update(localId, { isDirty: false, updatedAt: new Date().toISOString() });
                }).catch(err => {
                    console.warn('[ExamSync] Direct Firebase write failed, sync pipeline will retry:', err.message);
                });
            }

            setSelectedExamId(localId);
            setExamName('');
            setCustomCategory('');
            setMaxGrade(20);
        } catch (error) {
            console.error('Error creating exam:', error);
            alert('حدث خطأ أثناء حفظ التقييم.');
        }
    };

    const handleDeleteExam = async (exam) => {
        if (!confirm('هل أنت متأكد من حذف هذا التقييم نهائياً؟')) return;
        try {
            const now = new Date().toISOString();
            await db.exams.update(exam.id, { isDeleted: true, isDirty: true, updatedAt: now });

            const examId = exam.firebaseId || exam.id?.toString();
            if (examId) {
                await db.grades.where('examId').equals(examId).modify({ isDeleted: true, isDirty: true, updatedAt: now });
                if (db.examResults) {
                    await db.examResults.where('examId').equals(examId).modify({ isDeleted: true, isDirty: true, updatedAt: now }).catch(() => {});
                }
            }

            triggerAutoSync();

            const targetKey = exam.syncKey || activeSyncKey;
            if (isFirebaseConfigured && firestore && navigator.onLine && exam.firebaseId && targetKey && targetKey !== 'MASTER_ACCESS') {
                const examDocRef = doc(firestore, 'Osras', targetKey, 'exams', exam.firebaseId);
                deleteDoc(examDocRef).catch(err => {
                    console.warn('[ExamSync] Direct Firebase delete failed, sync pipeline will retry:', err.message);
                });
            }

            if (selectedExamId === exam.id || selectedExamId === exam.firebaseId) {
                setSelectedExamId(null);
            }
        } catch (error) {
            console.error('Error deleting exam:', error);
            alert('حدث خطأ أثناء حذف التقييم.');
        }
    };

    const persistSingleChildGrade = async (childId, rawGradeValue, rawNoteValue) => {
        if (!selectedExam) return;
        const examId = selectedExam.firebaseId || selectedExam.id?.toString();
        if (!examId) return;

        let gradeVal = '';
        if (rawGradeValue !== '' && rawGradeValue !== null && rawGradeValue !== undefined) {
            const parsedNum = Number(rawGradeValue);
            if (!Number.isNaN(parsedNum)) {
                gradeVal = Math.min(Math.max(Math.round(parsedNum * 100) / 100, 0), selectedExam.maxGrade);
            }
        }

        const now = new Date().toISOString();
        const childIdStr = String(childId);
        const noteStr = String(rawNoteValue || '').trim();
        const targetSyncKey = (selectedExam.syncKey && selectedExam.syncKey !== 'MASTER_ACCESS')
            ? selectedExam.syncKey
            : (activeSyncKey || 'default');

        const existing = await db.grades.where('examId').equals(examId).filter(g => String(g.childId) === childIdStr).toArray();
        const match = existing[0];

        if (gradeVal === '') {
            if (match) {
                await db.grades.update(match.id, { isDeleted: true, isDirty: true, updatedAt: now });
            }
            if (db.examResults) {
                await db.examResults.where('examId').equals(examId).filter(r => String(r.childId) === childIdStr).modify({ isDeleted: true, isDirty: true, updatedAt: now }).catch(() => {});
            }
        } else {
            const payloadObj = {
                childId: childIdStr,
                grade: gradeVal,
                note: noteStr,
                examId,
                examName: selectedExam.examName,
                category: selectedExam.category || 'تقييم الدروس والموضوعات الروحية',
                maxGrade: selectedExam.maxGrade,
                date: selectedExam.date,
                syncKey: targetSyncKey,
                isDirty: true,
                updatedAt: now,
                isDeleted: false
            };

            if (match) {
                await db.grades.update(match.id, payloadObj);
            } else {
                await db.grades.add(payloadObj);
            }

            if (db.examResults) {
                const resMatch = await db.examResults.where('examId').equals(examId).filter(r => String(r.childId) === childIdStr).first().catch(() => null);
                if (resMatch) {
                    await db.examResults.update(resMatch.id, payloadObj).catch(() => {});
                } else {
                    await db.examResults.add(payloadObj).catch(() => {});
                }
            }
        }

        if (isFirebaseConfigured && firestore && navigator.onLine && examId && targetSyncKey && targetSyncKey !== 'MASTER_ACCESS') {
            const gradeDocRef = doc(firestore, 'Osras', targetSyncKey, 'exams', examId, 'grades', childIdStr);
            if (gradeVal === '') {
                deleteDoc(gradeDocRef).catch(() => {});
            } else {
                const gradeDataForCloud = {
                    childId: childIdStr,
                    grade: gradeVal,
                    note: noteStr,
                    examId,
                    examName: selectedExam.examName,
                    category: selectedExam.category || '',
                    maxGrade: selectedExam.maxGrade,
                    date: selectedExam.date,
                    syncKey: targetSyncKey,
                    updatedAt: now
                };
                setDoc(gradeDocRef, { payload: encryptData(gradeDataForCloud) }, { merge: true }).then(async () => {
                    const freshMatch = await db.grades.where('examId').equals(examId).filter(g => String(g.childId) === childIdStr && !g.isDeleted).first();
                    if (freshMatch) {
                        await db.grades.update(freshMatch.id, { isDirty: false, updatedAt: new Date().toISOString() });
                    }
                }).catch(() => {});
            }
        }
    };

    const handleDraftFieldChange = (childId, field, value) => {
        const key = String(childId);
        setSaveMessage('');
        setDraftEntries(prev => {
            const existing = prev[key] || { grade: '', note: '' };
            let nextValue = value;
            if (field === 'grade' && value !== '') {
                const n = Number(value);
                if (!Number.isNaN(n) && selectedExam?.maxGrade) {
                    nextValue = String(Math.min(Math.max(n, 0), selectedExam.maxGrade));
                }
            }
            return {
                ...prev,
                [key]: { ...existing, [field]: nextValue }
            };
        });
    };

    const handleSaveAllClassGrades = async () => {
        if (!selectedExam) return;
        setIsSavingBatch(true);
        setSaveMessage('');
        try {
            let savedCount = 0;
            for (const child of classChildrenForExam) {
                const entry = draftEntries[String(child.id)];
                if (!entry) continue;
                await persistSingleChildGrade(child.id, entry.grade, entry.note);
                if (entry.grade !== '' && entry.grade !== undefined) savedCount += 1;
            }
            triggerAutoSync();
            setSaveMessage(`تم حفظ درجات الفصل بالكامل بنجاح (${savedCount} مخدوم مرصود)!`);
        } catch (err) {
            console.error('Batch save exam grades error:', err);
            alert('حدث خطأ أثناء حفظ درجات الفصل.');
        } finally {
            setIsSavingBatch(false);
        }
    };

    const handleExportExamExcel = () => {
        if (!selectedExam || classChildrenForExam.length === 0) {
            alert('لا توجد بيانات مخدومين لتصدير كشف الدرجات.');
            return;
        }
        const rows = classChildrenForExam.map((child, idx) => {
            const entry = draftEntries[String(child.id)] || {};
            const gradeVal = entry.grade;
            const hasScore = gradeVal !== undefined && gradeVal !== '';
            const dist = hasScore ? getDistinctionLabel(gradeVal, selectedExam.maxGrade) : null;
            return {
                'م': idx + 1,
                'اسم المخدوم': child.name || '',
                'الفصل / الأسرة': child.syncKey || selectedExam.syncKey || '',
                'اسم التقييم': selectedExam.examName || '',
                'التصنيف': selectedExam.category || 'تقييم عام للخدمة',
                'الدرجة': hasScore ? Number(gradeVal) : 'لم يُرصد',
                'النهاية العظمى': selectedExam.maxGrade || 0,
                'النسبة المئوية': dist ? `${dist.pct}%` : '-',
                'التقدير': dist ? dist.label : 'لم يُرصد',
                'ملاحظات الخادم': entry.note || ''
            };
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [
            { wch: 6 }, { wch: 28 }, { wch: 20 }, { wch: 30 }, { wch: 26 },
            { wch: 12 }, { wch: 15 }, { wch: 14 }, { wch: 16 }, { wch: 30 }
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'كشف الدرجات');
        const safeName = `${selectedExam.examName || 'تقييم'}_${selectedExam.syncKey || 'الفصل'}`
            .replace(/[\\/:*?"<>|\s]+/g, '_');
        XLSX.writeFile(wb, `كشف_درجات_${safeName}.xlsx`);
    };

    const handleBack = () => {
        if (selectedExam) {
            setSelectedExamId(null);
            setSaveMessage('');
        } else {
            goBack('/');
        }
    };

    return (
        <div className="min-h-screen coptic-cream-surface pb-32" dir="rtl">
            <header
                className="text-white p-4 sm:p-5 rounded-b-3xl sm:rounded-b-[2.25rem] sticky top-0 z-50 shadow-lg border-b border-amber-400/25"
                style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 72%, #8C621E 100%)' }}
            >
                <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <button
                            type="button"
                            onClick={handleBack}
                            aria-label="رجوع"
                            className="w-10 h-10 bg-white/15 border border-white/20 rounded-full flex items-center justify-center hover:bg-white/25 transition-colors shrink-0 cursor-pointer"
                        >
                            <ChevronRight size={20} />
                        </button>
                        <div className="min-w-0">
                            <h1 className="font-calligraphic text-lg sm:text-2xl font-bold text-amber-100 flex items-center gap-2 truncate">
                                <Award className="text-amber-300 shrink-0" size={22} />
                                <span className="truncate">امتحانات وتقييمات الخدمات الكنسية</span>
                            </h1>
                            <p className="text-xs font-bold text-indigo-100/90 truncate">
                                {impersonatedOsra?.name
                                    ? `أسرة: ${impersonatedOsra.name}`
                                    : isMaster
                                        ? 'رصد مسابقات الكتاب المقدس والمحفوظات والدروس الروحية لجميع الخدمات'
                                        : `رصد وتقييم مخدومي: ${activeSyncKey}`}
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => navigate('/parent-login')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-400/20 hover:bg-amber-400/30 border border-amber-300/40 text-xs font-black text-amber-100 transition-colors cursor-pointer"
                    >
                        <GraduationCap size={15} className="text-amber-300" />
                        <span>بوابة ولي الأمر</span>
                    </button>
                </div>
            </header>

            <main className="px-4 max-w-4xl mx-auto mt-5 space-y-5">
                {!selectedExam ? (
                    <div className="space-y-5">
                        {/* Create Exam Form */}
                        <div className="coptic-card p-5 sm:p-6 rounded-3xl border border-[#DFC48F] animate-card-enter">
                            <h2 className="font-calligraphic text-lg sm:text-xl font-bold text-[#1B2A59] mb-4 flex items-center gap-2">
                                <Plus className="text-[#8C621E]" size={20} /> إنشاء امتحان أو تقييم جديد للفصل
                            </h2>
                            <form onSubmit={handleSaveExam} className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                                    <div className="sm:col-span-2">
                                        <label className="block text-xs font-black text-[#6E5329] mb-1.5">عنوان الامتحان أو المسابقة *</label>
                                        <input
                                            type="text"
                                            value={examName}
                                            onChange={(e) => setExamName(e.target.value)}
                                            placeholder="مثال: مسابقة سفر أعمال الرسل، الاختبار الشهري للكتاب المقدس..."
                                            className="w-full p-3.5 rounded-2xl coptic-cream-input font-bold text-sm"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-black text-[#6E5329] mb-1.5">تصنيف التقييم الكنسي *</label>
                                        <select
                                            value={examCategory}
                                            onChange={(e) => setExamCategory(e.target.value)}
                                            className="w-full p-3.5 rounded-2xl coptic-cream-input font-bold text-sm"
                                        >
                                            {CHURCH_EXAM_CATEGORIES.map((cat) => (
                                                <option key={cat} value={cat}>{cat}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-black text-[#6E5329] mb-1.5">تاريخ التقييم *</label>
                                        <input
                                            type="date"
                                            value={examDate}
                                            onChange={(e) => setExamDate(e.target.value)}
                                            className="w-full p-3.5 rounded-2xl coptic-cream-input font-bold text-sm text-right"
                                            required
                                        />
                                    </div>

                                    {examCategory === 'تقييم مخصص (إدخال حر)' && (
                                        <div className="sm:col-span-2">
                                            <label className="block text-xs font-black text-[#6E5329] mb-1.5">اكتب اسم التصنيف المخصص *</label>
                                            <input
                                                type="text"
                                                value={customCategory}
                                                onChange={(e) => setCustomCategory(e.target.value)}
                                                placeholder="مثال: نشاط المخيم الصيفي / مهرجان الكرازة..."
                                                className="w-full p-3.5 rounded-2xl coptic-cream-input font-bold text-sm"
                                            />
                                        </div>
                                    )}

                                    <div className="sm:col-span-2">
                                        <label className="block text-xs font-black text-[#6E5329] mb-1.5">الدرجة النهائية *</label>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <input
                                                type="number"
                                                value={maxGrade}
                                                onChange={(e) => setMaxGrade(parseInt(e.target.value, 10) || 1)}
                                                min="1"
                                                className="w-28 p-3 rounded-2xl coptic-cream-input font-black text-sm text-center"
                                                required
                                            />
                                            {EXAM_SCORE_PRESETS.map((preset) => (
                                                <button
                                                    type="button"
                                                    key={preset}
                                                    onClick={() => setMaxGrade(preset)}
                                                    className={`px-3.5 py-2.5 rounded-xl text-xs font-black border transition-all cursor-pointer ${
                                                        Number(maxGrade) === preset
                                                            ? 'bg-[#1B2A59] text-amber-200 border-[#1B2A59]'
                                                            : 'bg-[#FAF4E8] text-[#6E5329] border-[#DFC48F] hover:border-[#8C621E]'
                                                    }`}
                                                >
                                                    من {preset}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {isMaster && availableOsras.length > 0 && (
                                    <div>
                                        <label className="block text-xs font-black text-[#6E5329] mb-1.5">الأسرة / الفصل المستهدف *</label>
                                        <select
                                            value={createTargetSyncKey}
                                            onChange={(e) => setCreateTargetSyncKey(e.target.value)}
                                            className="w-full p-3.5 rounded-2xl coptic-cream-input font-bold text-sm"
                                            required
                                        >
                                            {availableOsras.map(o => (
                                                <option key={o.syncKey} value={o.syncKey}>{o.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    className="w-full bg-gradient-to-l from-[#1B2A59] to-[#253A7A] hover:from-[#152248] hover:to-[#1B2A59] text-amber-100 py-3.5 rounded-2xl font-black text-base shadow-md border border-amber-400/35 active:scale-[0.99] transition-all flex justify-center items-center gap-2 cursor-pointer"
                                >
                                    <Sparkles size={18} className="text-amber-300" />
                                    <span>إنشاء التقييم وفتح جدول الرصد الفوري</span>
                                </button>
                            </form>
                        </div>

                        {/* Exams List with Filter */}
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                                <h2 className="font-calligraphic text-lg sm:text-xl font-bold text-[#1B2A59]">
                                    الامتحانات والتقييمات المسجلة ({filteredExams.length})
                                </h2>
                                {isMaster && availableOsras.length > 0 && (
                                    <select
                                        value={filterClassKey}
                                        onChange={(e) => setFilterClassKey(e.target.value)}
                                        className="px-3 py-1.5 rounded-xl coptic-cream-input text-xs font-black"
                                    >
                                        <option value="ALL">كل الأسر والفصول</option>
                                        {availableOsras.map(o => (
                                            <option key={o.syncKey} value={o.syncKey}>{o.name}</option>
                                        ))}
                                    </select>
                                )}
                            </div>

                            {filteredExams.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {filteredExams.map((exam) => (
                                        <div
                                            key={exam.id || exam.firebaseId}
                                            className="coptic-card p-4 rounded-3xl border border-[#DFC48F] flex items-center justify-between gap-3 hover:border-[#C89B3C] transition-all animate-card-enter"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => setSelectedExamId(exam.id || exam.firebaseId)}
                                                className="flex-1 text-right focus:outline-none min-w-0 cursor-pointer"
                                            >
                                                <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                                                    {exam.syncKey && exam.syncKey !== 'MASTER_ACCESS' && (
                                                        <span className="text-[10px] font-black bg-[#1B2A59] text-amber-200 px-2 py-0.5 rounded-full">
                                                            {exam.syncKey}
                                                        </span>
                                                    )}
                                                    <span className="text-[10px] font-black bg-[#EFE0C2] text-[#7A5617] px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                                        <BookOpen size={10} /> {exam.category || 'تقييم خدمة كنسية'}
                                                    </span>
                                                    <span className="text-[10px] font-black bg-indigo-50 text-[#1B2A59] px-2 py-0.5 rounded-full">
                                                        النهاية العظمى: {exam.maxGrade}
                                                    </span>
                                                </div>
                                                <h3 className="font-black text-[#1B2A59] text-sm sm:text-base leading-snug truncate">
                                                    {exam.examName}
                                                </h3>
                                                <p className="text-xs font-bold text-[#6E5329] mt-1 flex items-center gap-1.5">
                                                    <Calendar size={12} /> تاريخ الرصد: {exam.date}
                                                </p>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteExam(exam)}
                                                className="w-9 h-9 bg-rose-50 text-rose-600 border border-rose-200 rounded-full flex items-center justify-center hover:bg-rose-100 transition-colors shrink-0 cursor-pointer"
                                                title="حذف الامتحان"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="coptic-card text-center py-10 text-[#6E5329] font-bold rounded-3xl border border-[#DFC48F]">
                                    لا توجد امتحانات مسجلة لهذا الفصل حالياً — أضف أول تقييم من النموذج أعلاه.
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    // Fast Interactive Class Grading Table View
                    <div className="space-y-4 animate-card-enter">
                        <div className="coptic-card border-2 border-[#C89B3C]/60 p-4 sm:p-5 rounded-3xl flex flex-wrap justify-between items-center gap-3">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                    {selectedExam.syncKey && selectedExam.syncKey !== 'MASTER_ACCESS' && (
                                        <span className="text-[11px] font-black bg-[#1B2A59] text-amber-200 px-2.5 py-0.5 rounded-full">
                                            {selectedExam.syncKey}
                                        </span>
                                    )}
                                    <span className="text-[11px] font-black bg-amber-100 text-[#7A5617] border border-amber-300 px-2.5 py-0.5 rounded-full">
                                        {selectedExam.category || 'تقييم خدمة كنسية'}
                                    </span>
                                    <span className="text-[11px] font-black bg-[#EFE0C2] text-[#1B2A59] px-2.5 py-0.5 rounded-full">
                                        الدرجة من {selectedExam.maxGrade}
                                    </span>
                                </div>
                                <h2 className="font-calligraphic text-lg sm:text-xl font-bold text-[#1B2A59]">
                                    {selectedExam.examName}
                                </h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => { setSelectedExamId(null); setSaveMessage(''); }}
                                className="bg-[#1B2A59] text-amber-200 px-4 py-2 rounded-xl text-xs font-black shadow-sm hover:bg-[#152248] transition-colors cursor-pointer"
                            >
                                ← الرجوع لقائمة الامتحانات
                            </button>
                        </div>

                        {/* Exam Stats Bar */}
                        <div className="grid grid-cols-3 gap-2.5">
                            <div className="coptic-card p-3 rounded-2xl text-center">
                                <div className="text-[11px] font-bold text-[#6E5329]">تم الرصد</div>
                                <div className="text-lg sm:text-xl font-black text-[#1B2A59] tabular-nums">
                                    {examStats.gradedCount} / {examStats.total}
                                </div>
                            </div>
                            <div className="coptic-card p-3 rounded-2xl text-center">
                                <div className="text-[11px] font-bold text-[#6E5329]">متوسط النجاح</div>
                                <div className="text-lg sm:text-xl font-black text-emerald-700 tabular-nums">
                                    {examStats.avgPct}%
                                </div>
                            </div>
                            <div className="coptic-card p-3 rounded-2xl text-center">
                                <div className="text-[11px] font-bold text-[#6E5329]">أعلى درجة</div>
                                <div className="text-lg sm:text-xl font-black text-[#8C621E] tabular-nums">
                                    {examStats.maxScore} / {selectedExam.maxGrade}
                                </div>
                            </div>
                        </div>

                        {/* Batch Save + Excel Export Actions */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <button
                                type="button"
                                onClick={handleSaveAllClassGrades}
                                disabled={isSavingBatch}
                                className="py-3.5 px-5 rounded-2xl font-black text-sm text-[#FCE9B8] shadow-md hover:brightness-110 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                                style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 70%, #8C621E 100%)' }}
                            >
                                {isSavingBatch ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                <span>حفظ درجات الفصل بالكامل</span>
                            </button>

                            <button
                                type="button"
                                onClick={handleExportExamExcel}
                                className="py-3.5 px-5 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                            >
                                <Download size={18} />
                                <span>تصدير كشف درجات الامتحان (Excel)</span>
                            </button>
                        </div>

                        {saveMessage && (
                            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm font-black flex items-center gap-2">
                                <CheckCircle2 size={18} className="shrink-0" />
                                <span>{saveMessage}</span>
                            </div>
                        )}

                        {/* Search & Filter */}
                        <div className="flex flex-col sm:flex-row gap-2.5">
                            <div className="relative flex-1">
                                <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8C621E]" size={18} />
                                <input
                                    type="text"
                                    placeholder="ابحث عن مخدوم لرصد الدرجة..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pr-11 pl-4 py-3 rounded-2xl coptic-cream-input text-sm font-bold"
                                />
                            </div>
                            <div className="flex items-center gap-1.5 bg-[#FFFDF7] p-1 rounded-2xl border border-[#DFC48F]">
                                {[
                                    { id: 'ALL', label: 'الكل' },
                                    { id: 'GRADED', label: 'تم الرصد' },
                                    { id: 'UNGRADED', label: 'لم يُرصد' }
                                ].map(tab => (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => setGradeStatusFilter(tab.id)}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-black transition-colors cursor-pointer ${
                                            gradeStatusFilter === tab.id
                                                ? 'bg-[#1B2A59] text-amber-200'
                                                : 'text-[#6E5329] hover:bg-[#EFE0C2]/60'
                                        }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Interactive Grading Rows */}
                        <div className="space-y-3">
                            {filteredChildren.map((child, idx) => {
                                const entry = draftEntries[String(child.id)] || { grade: '', note: '' };
                                const distinction = getDistinctionLabel(entry.grade, selectedExam.maxGrade);
                                return (
                                    <div key={child.id} className="coptic-card p-3.5 sm:p-4 rounded-2xl border border-[#DFC48F] space-y-2.5">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-6 h-6 rounded-full bg-[#EFE0C2] text-[#1B2A59] text-[11px] font-black flex items-center justify-center shrink-0">
                                                        {idx + 1}
                                                    </span>
                                                    <span className="font-black text-[#1B2A59] text-sm sm:text-base truncate">
                                                        {child.name}
                                                    </span>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                                    <span className="text-[11px] font-bold text-[#6E5329] flex items-center gap-1">
                                                        <Users size={11} /> {child.syncKey}
                                                    </span>
                                                    {distinction && (
                                                        <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border ${distinction.badgeClass}`}>
                                                            {distinction.label} ({distinction.pct}%)
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max={selectedExam.maxGrade}
                                                    step="0.5"
                                                    value={entry.grade}
                                                    onChange={(e) => handleDraftFieldChange(child.id, 'grade', e.target.value)}
                                                    onBlur={() => void persistSingleChildGrade(child.id, entry.grade, entry.note)}
                                                    placeholder="الدرجة"
                                                    className="w-22 text-center p-2.5 coptic-cream-input rounded-xl font-black text-[#1B2A59] text-sm"
                                                />
                                                <span className="text-xs font-black text-[#8C621E] tabular-nums">/ {selectedExam.maxGrade}</span>
                                            </div>
                                        </div>

                                        <div className="relative">
                                            <StickyNote size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8C621E]" />
                                            <input
                                                type="text"
                                                value={entry.note || ''}
                                                onChange={(e) => handleDraftFieldChange(child.id, 'note', e.target.value)}
                                                onBlur={() => void persistSingleChildGrade(child.id, entry.grade, entry.note)}
                                                placeholder="ملاحظة اختيارية للخادم أو لولي الأمر..."
                                                className="w-full pr-8 pl-3 py-2 rounded-xl bg-[#FAF4E8] border border-[#E5D7BF] text-xs font-bold text-[#1B2A59] focus:outline-none focus:border-[#C8942E]"
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                            {filteredChildren.length === 0 && (
                                <div className="coptic-card text-center py-8 text-[#6E5329] font-bold rounded-3xl border border-[#DFC48F]">
                                    لا يوجد مخدومين مطابقين للبحث أو التصفية.
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </main>
            <BottomNav />
        </div>
    );
}
