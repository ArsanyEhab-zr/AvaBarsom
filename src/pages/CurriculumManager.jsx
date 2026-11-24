import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSmartNavigation } from '../hooks/useSmartNavigation';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    BookOpen, ArrowRight, Plus, Calendar, FileText, Download,
    CheckCircle2, Clock, Edit3, Trash2, Search, Upload, Link as LinkIcon,
    X, Eye, Maximize2, Minimize2, Sparkles, Lock, ChevronDown, ExternalLink
} from 'lucide-react';
import { db } from '../db/database';
import { firestore, isFirebaseConfigured } from '../db/firebase';
import { TENANT_CONFIG, getLogoUrl } from '../utils/tenantConfig';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
import {
    CURRICULUM_CATEGORIES,
    CURRICULUM_STATUSES,
    LESSON_ONLY_CATEGORIES,
    getOsraCurricula,
    getOsraListFromSettings,
    saveOsraCurriculumItem,
    deleteOsraCurriculumItem,
    isPdfCurriculumItem,
    isCopticBookPlanItem,
    getItemAttachmentUrl,
    readFileAsAttachment,
    syncClassCurriculaWithCloud,
    toEmbeddablePdfUrl,
    triggerCurriculumDownload
} from '../utils/curriculumEngine';
import { getLocalDateString } from '../utils/serviceWeek';
import BottomNav from '../components/BottomNav';
import CopticBookProgressionSection from '../components/CopticBookProgressionSection';

const EMPTY_FORM = {
    id: null,
    itemType: 'lesson',
    category: 'درس كتاب مقدس وعقيدة',
    weekLabel: 'الأسبوع الحالي',
    lessonDate: getLocalDateString(),
    title: '',
    content: '',
    notes: '',
    fileUrl: '',
    cloudinaryPublicId: '',
    fileName: '',
    status: CURRICULUM_STATUSES[0]
};

function EmbeddedPdfModal({ preview, onClose }) {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [resolvedUrl, setResolvedUrl] = useState('');

    useEffect(() => {
        if (!preview?.url) {
            setResolvedUrl('');
            return undefined;
        }
        const raw = String(preview.url).trim();
        let createdBlobUrl = '';

        if (raw.startsWith('data:application/pdf')) {
            try {
                const parts = raw.split(',');
                const bstr = atob(parts[1] || '');
                const u8arr = new Uint8Array(bstr.length);
                for (let i = 0; i < bstr.length; i += 1) {
                    u8arr[i] = bstr.charCodeAt(i);
                }
                const blob = new Blob([u8arr], { type: 'application/pdf' });
                createdBlobUrl = URL.createObjectURL(blob);
                setResolvedUrl(createdBlobUrl);
            } catch {
                setResolvedUrl(raw);
            }
        } else {
            setResolvedUrl(toEmbeddablePdfUrl(raw));
        }

        return () => {
            if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl);
        };
    }, [preview]);

    if (!preview) return null;

    return (
        <div
            className="fixed inset-0 z-[110] bg-[#0F1B3D]/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 animate-modal-enter"
            onClick={onClose}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className={`bg-[#FBF5E9] border-2 border-[#DFC48F] shadow-2xl flex flex-col overflow-hidden transition-all ${
                    isFullscreen
                        ? 'w-full h-full rounded-xl'
                        : 'w-full max-w-5xl h-[88vh] rounded-3xl'
                }`}
            >
                <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 bg-[#1B2A59] text-[#F7E8CC] border-b border-[#C89B3C]/40">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <FileText size={20} className="text-[#E3B963] shrink-0" />
                        <h3 className="font-calligraphic font-bold text-base sm:text-lg truncate">
                            {preview.title || 'معاينة ملف المنهج (PDF)'}
                        </h3>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={() => triggerCurriculumDownload(preview.url, preview.title, preview.fileName)}
                            className="inline-flex items-center gap-1.5 bg-[#C89B3C] hover:bg-[#b5892f] text-[#111B3A] font-black text-xs px-3 py-2 rounded-xl transition-colors"
                        >
                            <Download size={14} />
                            <span className="hidden sm:inline">تحميل PDF</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => window.open(resolvedUrl || preview.url, '_blank', 'noopener,noreferrer')}
                            className="inline-flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white font-bold text-xs px-3 py-2 rounded-xl transition-colors"
                            title="فتح في نافذة مستقلة"
                        >
                            <ExternalLink size={14} />
                            <span className="hidden sm:inline">نافذة جديدة</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsFullscreen((f) => !f)}
                            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                            title={isFullscreen ? 'تصغير' : 'ملء الشاشة'}
                        >
                            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/35 text-rose-100 transition-colors"
                            title="إغلاق"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                <div className="bg-[#FAF1DE] border-b border-[#DFC48F] px-4 py-2 text-[11px] sm:text-xs font-bold text-[#6E5329] flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5"><FileText size={14} className="shrink-0" /> معاينة مباشرة للمنهج — على بعض أجهزة الموبايل يُفضّل الضغط على «تحميل PDF» أو «نافذة جديدة» لعرض واضح</span>
                    {preview.fileName && <span className="font-mono text-[#1B2A59]">{preview.fileName}</span>}
                </div>

                <div className="flex-1 bg-[#EAE0CE] relative">
                    {resolvedUrl ? (
                        <iframe
                            src={resolvedUrl}
                            title={preview.title || 'Curriculum PDF Viewer'}
                            className="w-full h-full border-0 bg-white"
                        />
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-[#1B2A59] p-6 text-center">
                            <FileText size={42} className="text-[#8C621E] mb-3 opacity-70" />
                            <p className="font-bold">جاري تجهيز المعاينة...</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function CurriculumManager() {
    const { goBack } = useSmartNavigation();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const urlSyncKey = (searchParams.get('syncKey') || '').trim();

    const [settingsTick, setSettingsTick] = useState(0);
    useEffect(() => {
        const bump = () => setSettingsTick((t) => t + 1);
        window.addEventListener('church-settings-updated', bump);
        window.addEventListener('demo-data-seeded', bump);
        window.addEventListener('storage', bump);
        return () => {
            window.removeEventListener('church-settings-updated', bump);
            window.removeEventListener('demo-data-seeded', bump);
            window.removeEventListener('storage', bump);
        };
    }, []);

    const scope = useMemo(() => resolveUserAccessScope(null, [], { includeFallback: true }), [settingsTick]);
    const osrasList = useMemo(() => getOsraListFromSettings(), [settingsTick]);

    const allowedOsras = useMemo(() => {
        if (scope.allowedOsras && scope.allowedOsras.length > 0) return scope.allowedOsras;
        const allowedSet = new Set(scope.allowedSyncKeys || []);
        const filtered = osrasList.filter((o) => allowedSet.has(o.syncKey));
        if (filtered.length > 0) return filtered;
        if (scope.primarySyncKey) {
            return [{
                syncKey: scope.primarySyncKey,
                name: scope.primaryClassName || scope.primarySyncKey,
                serviceName: scope.stageName || 'الخدمة'
            }];
        }
        return scope.isSuperAdmin ? osrasList : [];
    }, [osrasList, scope]);

    const groupedAllowedServices = useMemo(() => {
        const map = new Map();
        for (const o of allowedOsras) {
            const grp = o.serviceName || 'أسر الخدمة';
            if (!map.has(grp)) map.set(grp, []);
            map.get(grp).push(o);
        }
        return Array.from(map.entries());
    }, [allowedOsras]);

    const isLockedSingleFamily =
        Boolean(scope.isImpersonating) ||
        !scope.canSwitchClasses ||
        allowedOsras.length <= 1;

    const [selectedSyncKey, setSelectedSyncKey] = useState(() => {
        if (!isLockedSingleFamily && urlSyncKey && allowedOsras.some((o) => o.syncKey === urlSyncKey)) {
            return urlSyncKey;
        }
        return scope.primarySyncKey || allowedOsras[0]?.syncKey || '';
    });

    // Keep selectedSyncKey aligned when scope or URL ?syncKey changes
    useEffect(() => {
        if (isLockedSingleFamily) {
            const lockedKey = scope.primarySyncKey || allowedOsras[0]?.syncKey || '';
            if (lockedKey && selectedSyncKey !== lockedKey) {
                setSelectedSyncKey(lockedKey);
            }
            return;
        }
        if (urlSyncKey && allowedOsras.some((o) => o.syncKey === urlSyncKey)) {
            if (selectedSyncKey !== urlSyncKey) setSelectedSyncKey(urlSyncKey);
            return;
        }
        if (!selectedSyncKey || !allowedOsras.some((o) => o.syncKey === selectedSyncKey)) {
            const fallback = allowedOsras[0]?.syncKey || scope.primarySyncKey || '';
            if (fallback) setSelectedSyncKey(fallback);
        }
    }, [isLockedSingleFamily, urlSyncKey, allowedOsras, scope.primarySyncKey, selectedSyncKey]);

    const handleSelectFamily = (nextKey) => {
        if (isLockedSingleFamily || !nextKey || !allowedOsras.some((o) => o.syncKey === nextKey)) return;
        setSelectedSyncKey(nextKey);
        setSearchParams({ syncKey: nextKey }, { replace: true });
    };

    const selectedOsra = useMemo(
        () => allowedOsras.find((o) => o.syncKey === selectedSyncKey) || allowedOsras[0] || {
            syncKey: selectedSyncKey,
            name: scope.primaryClassName || selectedSyncKey || 'الأسرة',
            serviceName: scope.stageName || 'الخدمة'
        },
        [allowedOsras, selectedSyncKey, scope.primaryClassName, scope.stageName]
    );

    const allDbCurricula = useLiveQuery(() => db.curricula.toArray(), [], []);

    useEffect(() => {
        if (selectedSyncKey && isFirebaseConfigured && firestore) {
            void syncClassCurriculaWithCloud(selectedSyncKey, firestore);
        }
    }, [selectedSyncKey]);

    const familyCurricula = useMemo(
        () => getOsraCurricula(selectedSyncKey, allDbCurricula, osrasList),
        [selectedSyncKey, allDbCurricula, osrasList]
    );

    const copticBookItems = useMemo(
        () => familyCurricula.filter((item) => isCopticBookPlanItem(item)),
        [familyCurricula]
    );

    const pdfItems = useMemo(
        () => familyCurricula.filter((item) => isPdfCurriculumItem(item)),
        [familyCurricula]
    );

    const lessonItems = useMemo(
        () => familyCurricula.filter((item) => !isPdfCurriculumItem(item) && !isCopticBookPlanItem(item)),
        [familyCurricula]
    );

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('الكل');

    const filteredLessons = useMemo(() => {
        return lessonItems.filter((item) => {
            const catMatch = selectedCategory === 'الكل' || item.category === selectedCategory;
            if (!catMatch) return false;
            if (!searchQuery.trim()) return true;
            const q = searchQuery.trim().toLowerCase();
            return (
                (item.title || '').toLowerCase().includes(q) ||
                (item.content || '').toLowerCase().includes(q) ||
                (item.notes || '').toLowerCase().includes(q) ||
                (item.weekLabel || '').toLowerCase().includes(q)
            );
        });
    }, [lessonItems, selectedCategory, searchQuery]);

    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [feedbackToast, setFeedbackToast] = useState('');
    const [previewPdf, setPreviewPdf] = useState(null);

    const showToast = (msg) => {
        setFeedbackToast(msg);
        setTimeout(() => setFeedbackToast(''), 3200);
    };

    const openAddModal = (mode = 'lesson') => {
        const isPdfMode = mode === 'pdf';
        setForm({
            ...EMPTY_FORM,
            itemType: isPdfMode ? 'pdf' : 'lesson',
            category: isPdfMode ? 'ملف PDF / مذكرة' : LESSON_ONLY_CATEGORIES[0],
            weekLabel: isPdfMode ? 'المنهج الرسمي (PDF)' : 'الأسبوع الحالي',
            lessonDate: getLocalDateString(),
            status: CURRICULUM_STATUSES[0]
        });
        setShowModal(true);
    };

    const openEditModal = (item) => {
        const isPdf = isPdfCurriculumItem(item);
        setForm({
            id: item.id,
            itemType: isPdf ? 'pdf' : 'lesson',
            category: item.category || (isPdf ? 'ملف PDF / مذكرة' : LESSON_ONLY_CATEGORIES[0]),
            weekLabel: item.weekLabel || '',
            lessonDate: item.lessonDate || getLocalDateString(),
            title: item.title || '',
            content: item.content || '',
            notes: item.notes || '',
            fileUrl: getItemAttachmentUrl(item),
            fileName: item.fileName || '',
            status: item.status || CURRICULUM_STATUSES[0]
        });
        setShowModal(true);
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const res = await readFileAsAttachment(file, {
                syncKey: selectedSyncKey,
                title: form.title || file.name.replace(/\.[^.]+$/, '')
            });
            setForm((prev) => ({
                ...prev,
                fileUrl: res.url,
                cloudinaryPublicId: res.cloudinaryPublicId || prev.cloudinaryPublicId || '',
                fileName: res.fileName,
                title: prev.title.trim() ? prev.title : file.name.replace(/\.[^.]+$/, '')
            }));
            showToast(`تم تجهيز الملف: ${file.name}`);
        } catch (err) {
            alert(err.message || 'تعذر قراءة الملف المرفق');
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!form.title.trim()) {
            alert('يرجى كتابة عنوان الملف أو الدرس أولاً');
            return;
        }
        if (form.itemType === 'pdf' && !form.fileUrl.trim()) {
            alert('يرجى رفع ملف PDF أو لصق رابط Google Drive / المنهج');
            return;
        }
        if (!selectedSyncKey) {
            alert('يرجى تحديد الأسرة أولاً');
            return;
        }

        setSaving(true);
        try {
            await saveOsraCurriculumItem(selectedSyncKey, {
                id: form.id || undefined,
                itemType: form.itemType,
                category: form.itemType === 'pdf' ? 'ملف PDF / مذكرة' : form.category,
                weekLabel: form.weekLabel.trim(),
                lessonDate: form.lessonDate,
                title: form.title.trim(),
                content: form.content.trim(),
                notes: form.notes.trim(),
                fileUrl: form.fileUrl.trim(),
                pdfData: form.fileUrl.trim(),
                attachmentUrl: form.fileUrl.trim(),
                cloudinaryPublicId: form.cloudinaryPublicId || '',
                fileName: form.fileName.trim(),
                status: form.status
            }, {
                serviceName: selectedOsra?.serviceName,
                firestore: isFirebaseConfigured ? firestore : null
            });

            setShowModal(false);
            setForm(EMPTY_FORM);
            showToast(
                form.itemType === 'pdf'
                    ? `تم حفظ ملف المنهج لأسرة "${selectedOsra?.name || selectedSyncKey}"`
                    : `تم حفظ الدرس لأسرة "${selectedOsra?.name || selectedSyncKey}"`
            );
        } catch (err) {
            alert('حدث خطأ أثناء الحفظ: ' + (err?.message || err));
        } finally {
            setSaving(false);
        }
    };

    const handleToggleStatus = async (item) => {
        const isDone = String(item.status || '').includes('تم الشرح') || String(item.status || '').includes('مفعّل');
        const nextStatus = isDone ? CURRICULUM_STATUSES[1] : CURRICULUM_STATUSES[0];
        await saveOsraCurriculumItem(selectedSyncKey, {
            ...item,
            status: nextStatus
        }, {
            serviceName: selectedOsra?.serviceName,
            firestore: isFirebaseConfigured ? firestore : null
        });
        showToast(`تم تحديث الحالة: ${nextStatus}`);
    };

    const handleDelete = async (item) => {
        if (!window.confirm(`هل أنت متأكد من حذف "${item.title}" من منهج ${selectedOsra?.name || selectedSyncKey}؟`)) return;
        await deleteOsraCurriculumItem(selectedSyncKey, item.id, {
            serviceName: selectedOsra?.serviceName,
            firestore: isFirebaseConfigured ? firestore : null
        });
        showToast('تم الحذف ومزامنة المنهج');
    };

    const completedLessonsCount = lessonItems.filter(
        (l) => String(l.status || '').includes('تم الشرح') || String(l.status || '').includes('مفعّل')
    ).length;

    return (
        <div className="min-h-screen coptic-cream-surface pb-28 text-slate-900">
            {/* Toast */}
            {feedbackToast && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#1B2A59] text-[#F7E8CC] border border-[#C89B3C]/60 px-5 py-3 rounded-2xl shadow-2xl font-bold text-sm flex items-center gap-2 animate-card-enter">
                    <Sparkles size={16} className="text-[#E3B963]" />
                    <span>{feedbackToast}</span>
                </div>
            )}

            {/* Royal Coptic Header */}
            <header
                className="sticky top-0 z-30 shadow-lg border-b border-[#C89B3C]/45"
                style={{ background: 'linear-gradient(135deg, #162447 0%, #1B2A59 68%, #704E18 100%)' }}
            >
                <div className="max-w-5xl mx-auto px-4 py-3.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <button
                            type="button"
                            onClick={() => goBack('/')}
                            className="p-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-[#F7E8CC] transition-colors shrink-0 cursor-pointer"
                            title="العودة للرئيسية"
                        >
                            <ArrowRight size={20} />
                        </button>
                        <img
                            src={getLogoUrl()}
                            alt={TENANT_CONFIG.churchName}
                            className="w-10 h-10 rounded-full object-cover border-2 border-[#C89B3C]/70 shrink-0 hidden sm:block"
                        />
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h1 className="font-calligraphic text-lg sm:text-2xl font-bold text-[#F7E8CC] truncate flex items-center gap-2">
                                    <BookOpen size={20} className="text-[#C89B3C] shrink-0" />
                                    <span className="truncate">منهج ودروس أسرة: {selectedOsra?.name || selectedSyncKey}</span>
                                </h1>
                                {isLockedSingleFamily && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-black bg-[#C89B3C]/25 text-[#F6DFB0] border border-[#C89B3C]/50 px-2.5 py-0.5 rounded-full">
                                        <Lock size={11} />
                                        خاص بالأسرة
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] sm:text-xs text-[#E8D5B3] font-medium truncate">
                                المناهج المرفوعة من الإدارة + الدروس والمرفقات المضافة بواسطة خدام الأسرة
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => openAddModal('lesson')}
                        className="shrink-0 inline-flex items-center gap-1.5 bg-[#C89B3C] hover:bg-[#b5892f] text-[#111B3A] font-black text-xs sm:text-sm px-4 py-2.5 rounded-2xl shadow-md transition-all tactile-press"
                    >
                        <Plus size={18} />
                        <span className="hidden sm:inline">إضافة درس أو ملف</span>
                        <span className="sm:hidden">إضافة</span>
                    </button>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 pt-5 space-y-6">
                {/* Family Selector (ONLY for non-impersonating Priest / Super Admin / Stage Leader with >1 family) */}
                {!isLockedSingleFamily && allowedOsras.length > 1 && (
                    <section className="coptic-card rounded-3xl p-4 sm:p-5 border border-[#DFC48F]">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div>
                                <p className="text-xs font-black text-[#8C621E] flex items-center gap-1.5">
                                    <BookOpen size={14} />
                                    اختيار الأسرة / الفصل لعرض وإدارة منهجه المستقل
                                </p>
                                <p className="text-[11px] text-slate-600 font-semibold mt-0.5">
                                    كل فصل له ملفات PDF ودروس خاصة به متزامنة مباشرة مع صفحة إدارة الخدمة
                                </p>
                            </div>
                            <div className="relative min-w-[260px]">
                                <select
                                    value={selectedSyncKey}
                                    onChange={(e) => handleSelectFamily(e.target.value)}
                                    aria-label="اختر الأسرة / الفصل"
                                    className="coptic-cream-input w-full appearance-none font-black text-[#1B2A59] text-sm px-4 py-3 pl-10 rounded-2xl"
                                >
                                    {groupedAllowedServices.map(([svcName, osras]) => (
                                        <optgroup key={svcName} label={svcName}>
                                            {osras.map((o) => (
                                                <option key={o.syncKey} value={o.syncKey}>
                                                    {o.name} ({svcName})
                                                </option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </select>
                                <ChevronDown size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8C621E] pointer-events-none" />
                            </div>
                        </div>
                    </section>
                )}

                {/* Scoped Family Summary Cards */}
                <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="coptic-card rounded-2xl p-4">
                        <span className="text-[11px] font-bold text-[#6E5329] block">الأسرة الحالية</span>
                        <strong className="text-sm sm:text-base font-black text-[#1B2A59] truncate block mt-1">
                            {selectedOsra?.name || selectedSyncKey}
                        </strong>
                    </div>
                    <div className="coptic-card rounded-2xl p-4">
                        <span className="text-[11px] font-bold text-[#6E5329] block">ملفات المنهج (PDF)</span>
                        <strong className="text-xl font-black text-[#8C621E] tabular-nums block mt-0.5">
                            {pdfItems.length}
                        </strong>
                    </div>
                    <div className="coptic-card rounded-2xl p-4">
                        <span className="text-[11px] font-bold text-[#6E5329] block">دروس وإضافات الأسرة</span>
                        <strong className="text-xl font-black text-[#1B2A59] tabular-nums block mt-0.5">
                            {lessonItems.length}
                        </strong>
                    </div>
                    <div className="coptic-card rounded-2xl p-4">
                        <span className="text-[11px] font-bold text-[#6E5329] inline-flex items-center gap-1"><CheckCircle2 size={12} className="text-emerald-700" /> تم شرحه</span>
                        <strong className="text-xl font-black text-emerald-700 tabular-nums block mt-0.5">
                            {completedLessonsCount}
                        </strong>
                    </div>
                </section>

                {/* SECTION 0: Smart Coptic-Year PDF Book Uploader, Auto-Lesson Splitter & Green-Seal Weekly Progression Tracker */}
                <CopticBookProgressionSection
                    selectedSyncKey={selectedSyncKey}
                    selectedOsra={selectedOsra}
                    copticBooks={copticBookItems}
                    firestore={firestore}
                    isFirebaseConfigured={isFirebaseConfigured}
                    onToast={showToast}
                />

                {/* SECTION 1: Official PDF Curricula & Books for this Family */}
                <section className="coptic-card rounded-3xl p-5 sm:p-6 border-2 border-[#DFC48F] space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5D3B3] pb-4">
                        <div>
                            <h2 className="font-calligraphic text-lg sm:text-xl font-bold text-[#1B2A59] flex items-center gap-2">
                                <span className="w-9 h-9 rounded-xl bg-[#EFE0C2] text-[#8C621E] flex items-center justify-center shrink-0">
                                    <FileText size={20} />
                                </span>
                                <span>ملفات المنهج الرسمي (PDF والكتب الدراسية للأسرة)</span>
                            </h2>
                            <p className="text-xs text-[#6E5329] font-semibold mt-1">
                                عرض وقراءة كتب ومذكرات المنهج الخاصة بأسرة «{selectedOsra?.name || selectedSyncKey}» فقط
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() => openAddModal('pdf')}
                            className="inline-flex items-center justify-center gap-2 bg-[#1B2A59] hover:bg-[#142045] text-[#F7E8CC] font-black text-xs sm:text-sm px-4 py-2.5 rounded-2xl shadow-sm transition-all tactile-press shrink-0"
                        >
                            <Upload size={16} />
                            <span>رفع ملف PDF أو كتاب جديد للأسرة</span>
                        </button>
                    </div>

                    {pdfItems.length === 0 ? (
                        <div className="bg-[#FAF2E1] border border-dashed border-[#D3B683] rounded-2xl p-7 text-center space-y-2.5">
                            <FileText size={36} className="mx-auto text-[#9E7834] opacity-75" />
                            <h3 className="font-bold text-[#1B2A59] text-sm">
                                لا توجد ملفات PDF مرفوعة لهذه الأسرة حتى الآن
                            </h3>
                            <p className="text-xs text-[#6E5329] max-w-md mx-auto">
                                يمكنك رفع ملف المنهج أو لصق رابط Google Drive ليظهر هنا وفي لوحة إدارة الكنيسة فورياً.
                            </p>
                            <button
                                type="button"
                                onClick={() => openAddModal('pdf')}
                                className="inline-flex items-center gap-1.5 bg-[#C89B3C] text-[#111B3A] font-black text-xs px-4 py-2 rounded-xl mt-1"
                            >
                                <Plus size={15} />
                                رفع أول ملف PDF للأسرة
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {pdfItems.map((pdf) => {
                                const url = getItemAttachmentUrl(pdf);
                                return (
                                    <article
                                        key={pdf.id}
                                        className="bg-[#FFFBF2] border border-[#E2CCA2] rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4 shadow-sm hover:border-[#C89B3C] transition-all"
                                    >
                                        <div className="space-y-2">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <div className="w-11 h-11 rounded-2xl bg-[#EFE0C2] text-[#8C621E] border border-[#DFC48F] flex items-center justify-center shrink-0">
                                                        <FileText size={22} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <span className="inline-block text-[10px] font-black text-[#8C621E] bg-[#F6EAD0] px-2 py-0.5 rounded-full">
                                                            {pdf.weekLabel || 'ملف PDF / مذكرة'}
                                                        </span>
                                                        <h3 className="font-calligraphic font-bold text-base text-[#1B2A59] mt-0.5 leading-snug">
                                                            {pdf.title}
                                                        </h3>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => openEditModal(pdf)}
                                                        className="p-2 rounded-xl text-[#1B2A59] hover:bg-[#EFE0C2] transition-colors"
                                                        title="تعديل"
                                                    >
                                                        <Edit3 size={15} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDelete(pdf)}
                                                        className="p-2 rounded-xl text-rose-600 hover:bg-rose-50 transition-colors"
                                                        title="حذف"
                                                    >
                                                        <Trash2 size={15} />
                                                    </button>
                                                </div>
                                            </div>

                                            {pdf.content && (
                                                <p className="text-xs text-slate-700 leading-relaxed font-medium">
                                                    {pdf.content}
                                                </p>
                                            )}

                                            {pdf.fileName && (
                                                <p className="text-[11px] font-bold text-[#6E5329] truncate flex items-center gap-1">
                                                    <LinkIcon size={11} className="shrink-0" />
                                                    <span className="truncate">{pdf.fileName}</span>
                                                </p>
                                            )}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#EFE3CB]">
                                            {url ? (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => setPreviewPdf({ url, title: pdf.title, fileName: pdf.fileName })}
                                                        className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-1.5 bg-[#1B2A59] hover:bg-[#132045] text-[#F7E8CC] font-black text-xs px-3 py-2 rounded-xl transition-colors tactile-press"
                                                    >
                                                        <Eye size={15} />
                                                        <span>فتح وقراءة المنهج (PDF)</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => triggerCurriculumDownload(url, pdf.title, pdf.fileName)}
                                                        className="min-h-[42px] inline-flex items-center justify-center gap-1.5 bg-[#EFE0C2] hover:bg-[#E3CE9E] text-[#1B2A59] font-black text-xs px-3 py-2 rounded-xl transition-colors tactile-press"
                                                    >
                                                        <Download size={15} />
                                                        <span>تحميل ملف الـ PDF</span>
                                                    </button>
                                                </>
                                            ) : (
                                                <span className="text-xs text-amber-800 font-bold">
                                                    لم يتم إرفاق رابط PDF بعد — اضغط تعديل لإضافة الملف
                                                </span>
                                            )}
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </section>

                {/* SECTION 2: Family Lessons, Hymns, Verses & Servant Additions */}
                <section className="coptic-card rounded-3xl p-5 sm:p-6 border border-[#DFC48F] space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5D3B3] pb-4">
                        <div>
                            <h2 className="font-calligraphic text-lg sm:text-xl font-bold text-[#1B2A59] flex items-center gap-2">
                                <span className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                                    <BookOpen size={20} />
                                </span>
                                <span>دروس الأسرة، الألحان، المحفوظات وإضافات الخادم</span>
                            </h2>
                            <p className="text-xs text-[#6E5329] font-semibold mt-1">
                                تحضير الدروس الأسبوعية، الألحان، القبطي، والملاحظات الخاصة بأسرة «{selectedOsra?.name || selectedSyncKey}»
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() => openAddModal('lesson')}
                            className="inline-flex items-center justify-center gap-2 bg-[#C89B3C] hover:bg-[#b5892f] text-[#111B3A] font-black text-xs sm:text-sm px-4 py-2.5 rounded-2xl shadow-sm transition-all tactile-press shrink-0"
                        >
                            <Plus size={16} />
                            <span>إضافة درس أو ملف أو مرفق جديد للأسرة</span>
                        </button>
                    </div>

                    {/* Scoped Search & Category Filter */}
                    <div className="space-y-3">
                        <div className="relative">
                            <Search size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8C621E]" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={`ابحث داخل دروس أسرة ${selectedOsra?.name || selectedSyncKey}...`}
                                className="coptic-cream-input w-full pr-10 pl-4 py-2.5 rounded-2xl text-sm font-bold text-[#1B2A59]"
                            />
                        </div>

                        <div className="flex items-center gap-2 overflow-x-auto pb-1">
                            {['الكل', ...LESSON_ONLY_CATEGORIES].map((cat) => (
                                <button
                                    key={cat}
                                    type="button"
                                    onClick={() => setSelectedCategory(cat)}
                                    className={`px-3.5 py-2 rounded-xl text-xs font-black whitespace-nowrap transition-all ${
                                        selectedCategory === cat
                                            ? 'bg-[#1B2A59] text-[#F7E8CC] shadow-sm'
                                            : 'bg-[#F5EBD6] text-[#5C4520] hover:bg-[#EAD8B6]'
                                    }`}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                    </div>

                    {filteredLessons.length === 0 ? (
                        <div className="bg-[#FAF2E1] border border-dashed border-[#D3B683] rounded-2xl p-8 text-center space-y-2">
                            <BookOpen size={36} className="mx-auto text-[#9E7834] opacity-70" />
                            <h3 className="font-bold text-[#1B2A59] text-sm">
                                لا توجد دروس مطابقة في أسرة «{selectedOsra?.name || selectedSyncKey}»
                            </h3>
                            <button
                                type="button"
                                onClick={() => openAddModal('lesson')}
                                className="inline-flex items-center gap-1.5 bg-[#1B2A59] text-[#F7E8CC] font-bold text-xs px-4 py-2.5 rounded-xl mt-2"
                            >
                                <Plus size={15} />
                                أضف درساً جديداً للأسرة
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {filteredLessons.map((lesson) => {
                                const isDone = String(lesson.status || '').includes('تم الشرح') || String(lesson.status || '').includes('مفعّل');
                                const attachUrl = getItemAttachmentUrl(lesson);
                                return (
                                    <article
                                        key={lesson.id}
                                        className="bg-[#FFFBF2] border border-[#E2CCA2] rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-3 shadow-sm hover:border-[#C89B3C] transition-all"
                                    >
                                        <div className="space-y-2.5">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <span className="text-[11px] font-black bg-[#EFE0C2] text-[#785114] px-2.5 py-0.5 rounded-full">
                                                        {lesson.category}
                                                    </span>
                                                    {lesson.weekLabel && (
                                                        <span className="text-[11px] font-bold bg-[#E9EDF8] text-[#1B2A59] px-2.5 py-0.5 rounded-full">
                                                            {lesson.weekLabel}
                                                        </span>
                                                    )}
                                                    {lesson.lessonDate && (
                                                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                                                            <Calendar size={11} />
                                                            {lesson.lessonDate}
                                                        </span>
                                                    )}
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => handleToggleStatus(lesson)}
                                                    className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-full border transition-colors ${
                                                        isDone
                                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                                            : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                                                    }`}
                                                    title="اضغط لتغيير حالة الشرح"
                                                >
                                                    {isDone ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                                                    <span>{isDone ? 'تم الشرح' : 'مجدول'}</span>
                                                </button>
                                            </div>

                                            <h3 className="font-calligraphic font-bold text-base sm:text-lg text-[#1B2A59] leading-snug">
                                                {lesson.title}
                                            </h3>

                                            {lesson.content && (
                                                <p className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                                                    {lesson.content}
                                                </p>
                                            )}

                                            {lesson.notes && (
                                                <div className="bg-[#F6ECDA] border border-[#E5CFA2] rounded-xl p-2.5 text-xs text-[#5C4520] font-semibold flex items-start gap-1.5">
                                                    <Sparkles size={13} className="text-[#8C621E] shrink-0 mt-0.5" />
                                                    <span>ملاحظات الخادم: {lesson.notes}</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-[#EFE3CB]">
                                            <div>
                                                {attachUrl && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setPreviewPdf({ url: attachUrl, title: lesson.title, fileName: lesson.fileName })}
                                                        className="inline-flex items-center gap-1.5 text-xs font-black bg-[#1B2A59] text-[#F7E8CC] px-3 py-1.5 rounded-xl"
                                                    >
                                                        <Eye size={13} />
                                                        <span>معاينة المرفق</span>
                                                    </button>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => openEditModal(lesson)}
                                                    className="inline-flex items-center gap-1 text-xs font-bold text-[#1B2A59] hover:bg-[#EFE0C2] px-2.5 py-1.5 rounded-xl transition-colors"
                                                >
                                                    <Edit3 size={14} />
                                                    <span>تعديل</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(lesson)}
                                                    className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 hover:bg-rose-50 px-2.5 py-1.5 rounded-xl transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                    <span>حذف</span>
                                                </button>
                                            </div>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </section>
            </main>

            {/* Unified Add / Edit Curriculum Modal */}
            {showModal && (
                <div
                    className="fixed inset-0 z-[110] bg-[#0F1B3D]/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-modal-enter"
                    onClick={() => setShowModal(false)}
                >
                    <form
                        onSubmit={handleSave}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-[#FBF5E9] border-2 border-[#DFC48F] rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-4"
                    >
                        <div className="flex items-center justify-between gap-2 border-b border-[#E5D3B3] pb-3">
                            <div>
                                <h3 className="font-calligraphic text-lg sm:text-xl font-bold text-[#1B2A59]">
                                    {form.id ? 'تعديل عنصر المنهج' : 'إضافة إلى منهج الأسرة'}
                                </h3>
                                <p className="text-xs font-bold text-[#8C621E]">
                                    الأسرة المستهدفة: {selectedOsra?.name || selectedSyncKey}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowModal(false)}
                                className="p-2 rounded-xl bg-[#EFE0C2] text-[#1B2A59] hover:bg-[#E4CFA6]"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Type Toggle: PDF vs Lesson */}
                        <div className="grid grid-cols-2 gap-2 bg-[#EFE0C2]/60 p-1.5 rounded-2xl">
                            <button
                                type="button"
                                onClick={() => setForm((prev) => ({
                                    ...prev,
                                    itemType: 'pdf',
                                    category: 'ملف PDF / مذكرة'
                                }))}
                                className={`py-2.5 rounded-xl text-xs sm:text-sm font-black transition-all ${
                                    form.itemType === 'pdf'
                                        ? 'bg-[#1B2A59] text-[#F7E8CC] shadow-sm'
                                        : 'text-[#5C4520]'
                                }`}
                            >
                                <span className="inline-flex items-center justify-center gap-1.5"><FileText size={14} /> ملف PDF / كتاب منهج</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setForm((prev) => ({
                                    ...prev,
                                    itemType: 'lesson',
                                    category: prev.category === 'ملف PDF / مذكرة' ? LESSON_ONLY_CATEGORIES[0] : prev.category
                                }))}
                                className={`py-2.5 rounded-xl text-xs sm:text-sm font-black transition-all ${
                                    form.itemType === 'lesson'
                                        ? 'bg-[#1B2A59] text-[#F7E8CC] shadow-sm'
                                        : 'text-[#5C4520]'
                                }`}
                            >
                                <span className="inline-flex items-center justify-center gap-1.5"><BookOpen size={14} /> درس / لحن / نشاط</span>
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="sm:col-span-2">
                                <label className="block text-xs font-black text-[#1B2A59] mb-1">
                                    {form.itemType === 'pdf' ? 'اسم ملف المنهج / الكتاب (PDF) *' : 'عنوان الدرس أو الإضافة *'}
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={form.title}
                                    onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                                    placeholder={form.itemType === 'pdf' ? 'مثال: منهج مدارس الأحد الفصل الدراسي الأول PDF' : 'مثال: شرح مثل السامري الصالح'}
                                    className="coptic-cream-input w-full px-3.5 py-2.5 rounded-xl text-sm font-bold text-[#1B2A59]"
                                />
                            </div>

                            {form.itemType === 'lesson' && (
                                <div>
                                    <label className="block text-xs font-black text-[#1B2A59] mb-1">التصنيف</label>
                                    <select
                                        value={form.category}
                                        onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                                        className="coptic-cream-input w-full px-3.5 py-2.5 rounded-xl text-sm font-bold text-[#1B2A59]"
                                    >
                                        {CURRICULUM_CATEGORIES.map((c) => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-black text-[#1B2A59] mb-1">الأسبوع / الفترة</label>
                                <input
                                    type="text"
                                    value={form.weekLabel}
                                    onChange={(e) => setForm((p) => ({ ...p, weekLabel: e.target.value }))}
                                    placeholder="الأسبوع الأول / الترم الأول"
                                    className="coptic-cream-input w-full px-3.5 py-2.5 rounded-xl text-sm font-bold text-[#1B2A59]"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-black text-[#1B2A59] mb-1">التاريخ</label>
                                <input
                                    type="date"
                                    value={form.lessonDate}
                                    onChange={(e) => setForm((p) => ({ ...p, lessonDate: e.target.value }))}
                                    className="coptic-cream-input w-full px-3.5 py-2.5 rounded-xl text-sm font-bold text-[#1B2A59]"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-black text-[#1B2A59] mb-1">حالة المتابعة</label>
                                <select
                                    value={form.status}
                                    onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                                    className="coptic-cream-input w-full px-3.5 py-2.5 rounded-xl text-sm font-bold text-[#1B2A59]"
                                >
                                    {CURRICULUM_STATUSES.map((st) => (
                                        <option key={st} value={st}>{st}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-black text-[#1B2A59] mb-1">
                                {form.itemType === 'pdf' ? 'وصف مختصر للملف (اختياري)' : 'محتوى الدرس / المحفوظات / العناصر'}
                            </label>
                            <textarea
                                rows={3}
                                value={form.content}
                                onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
                                placeholder="اكتب ملخص الدرس أو الآيات أو ملاحظات المنهج..."
                                className="coptic-cream-input w-full px-3.5 py-2.5 rounded-xl text-sm font-medium text-[#1B2A59]"
                            />
                        </div>

                        {form.itemType === 'lesson' && (
                            <div>
                                <label className="block text-xs font-black text-[#1B2A59] mb-1">ملاحظات للخادم / وسائل الإيضاح (اختياري)</label>
                                <input
                                    type="text"
                                    value={form.notes}
                                    onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                                    placeholder="مثال: تجهيز لوحة + توزيع هدايا الحفظ..."
                                    className="coptic-cream-input w-full px-3.5 py-2.5 rounded-xl text-sm font-medium text-[#1B2A59]"
                                />
                            </div>
                        )}

                        {/* PDF / File Upload & Direct Link */}
                        <div className="bg-[#FAF1DE] border border-[#DFC48F] rounded-2xl p-3.5 space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-black text-[#1B2A59] flex items-center gap-1.5">
                                    <LinkIcon size={14} className="text-[#8C621E]" />
                                    {form.itemType === 'pdf' ? 'رفع ملف PDF أو لصق رابط مباشر *' : 'إرفاق ملف PDF أو رابط مساعد (اختياري)'}
                                </span>
                                <label className="cursor-pointer inline-flex items-center gap-1.5 bg-[#1B2A59] hover:bg-[#142045] text-[#F7E8CC] text-xs font-black px-3 py-1.5 rounded-xl">
                                    <Upload size={13} />
                                    <span>{uploading ? 'جاري التحميل...' : 'رفع من الجهاز (PDF/صورة)'}</span>
                                    <input
                                        type="file"
                                        accept=".pdf,application/pdf,image/*"
                                        onChange={handleFileUpload}
                                        disabled={uploading}
                                        className="hidden"
                                    />
                                </label>
                            </div>
                            <input
                                type="text"
                                dir="ltr"
                                value={form.fileUrl}
                                onChange={(e) => setForm((p) => ({ ...p, fileUrl: e.target.value }))}
                                placeholder="https://drive.google.com/file/d/.../view"
                                className="coptic-cream-input w-full px-3 py-2 rounded-xl text-xs font-mono text-[#1B2A59]"
                            />
                            {form.fileName && (
                                <p className="text-[11px] font-bold text-emerald-700">
                                    <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} /> الملف المجهز: {form.fileName}</span>
                                </p>
                            )}
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowModal(false)}
                                className="px-4 py-2.5 rounded-xl bg-[#EFE0C2] text-[#1B2A59] font-bold text-sm"
                            >
                                إلغاء
                            </button>
                            <button
                                type="submit"
                                disabled={saving || uploading}
                                className="px-6 py-2.5 rounded-xl bg-[#1B2A59] hover:bg-[#132045] text-[#F7E8CC] font-black text-sm shadow-md disabled:opacity-60"
                            >
                                {saving ? 'جاري الحفظ...' : 'حفظ في منهج الأسرة'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Embedded PDF Viewer Modal */}
            <EmbeddedPdfModal preview={previewPdf} onClose={() => setPreviewPdf(null)} />

            <BottomNav />
        </div>
    );
}
