/* eslint-disable react-refresh/only-export-components */
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    BookOpen, Upload, CheckCircle2, Circle, Award, ChevronDown, ChevronUp,
    FileText, Sparkles, X, Eye, Trash2, Edit3, RotateCcw, Calendar,
    Layers, AlertTriangle, Plus, ArrowLeft, Loader2
} from 'lucide-react';
import {
    COPTIC_YEAR_PARTS,
    getCopticPartMeta,
    extractLessonsFromPagesText,
    analyzeAndCompressCurriculumPdf
} from '../utils/pdfCurriculumIndexer';
import {
    OFFICIAL_CHURCH_CURRICULUM_TRACKS,
    normalizeCurriculumTrack,
    resolveCurrentBookProgression,
    resolveMultiTrackBookProgression,
    saveOsraCopticBookPlan,
    toggleLessonCompletionSeal,
    deleteOsraCurriculumItem
} from '../utils/curriculumEngine';
import { validateCloudinaryPdfSize } from '../utils/cloudinary';
import { readScopedStorage } from '../utils/tenantConfig';

function getCurrentServantDisplayName() {
    try {
        const srv = JSON.parse(readScopedStorage('currentServant') || '{}');
        return srv?.name || readScopedStorage('servantName') || 'خادم الأسرة';
    } catch {
        return 'خادم الأسرة';
    }
}

export function openLessonInPdfViewer(navigate, lesson, fallbackBook = null) {
    if (!navigate || !lesson) return;
    const pdfUrl = String(lesson.fileUrl || fallbackBook?.fileUrl || fallbackBook?.attachmentUrl || '').trim();
    if (!pdfUrl) {
        alert('لم يتم إرفاق ملف الـ PDF لهذا الجزء بعد.');
        return;
    }
    const startPage = Math.max(1, Number(lesson.startPage) || 1);
    const endPage = Math.max(startPage, Number(lesson.endPage) || startPage);
    const lessonTitle = String(lesson.title || 'درس الأسبوع').trim();
    const bookTitle = String(lesson.bookTitle || fallbackBook?.title || 'كتاب المنهج السنوي').trim();

    const params = new URLSearchParams({
        startPage: String(startPage),
        endPage: String(endPage),
        lessonTitle,
        title: bookTitle,
        pdfUrl
    });

    navigate(`/pdf-viewer?${params.toString()}`, {
        state: {
            pdfUrl,
            title: bookTitle,
            lessonTitle,
            startPage,
            endPage
        }
    });
}

/**
 * Multi-Track Active Friday Lesson Cards for `Home.jsx` (Servant View) and `ParentDashboard.jsx`.
 * Renders an independent card for EACH active curriculum track in the class, clearly badged
 * with `trackName` and equipped with a 1-click `افتح الشرح (ص X)` button.
 */
export function ActiveFridayLessonCard({
    copticBooks = [],
    headingPrefix = 'درس هذه الجمعة',
    className = ''
}) {
    const navigate = useNavigate();
    const activeTracks = useMemo(() => {
        return resolveMultiTrackBookProgression(copticBooks).filter((t) => Boolean(t.currentActiveLesson));
    }, [copticBooks]);

    if (activeTracks.length === 0) return null;

    return (
        <div className={`space-y-3 ${className}`} dir="rtl">
            {activeTracks.map((track) => {
                const activeLesson = track.currentActiveLesson;
                if (!activeLesson) return null;
                const trackBadgeTitle = track.trackName || activeLesson.trackName || 'المنهج السنوي الأول';

                return (
                    <div
                        key={`${track.trackId}_${activeLesson.bookId}_${activeLesson.id}`}
                        className="coptic-card rounded-3xl p-4 sm:p-5 border-2 border-[#C8942E] bg-linear-to-l from-[#FFFDF7] via-[#FAF3E3] to-[#F5E6C4] shadow-md"
                    >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                                <div className="w-12 h-12 rounded-2xl bg-[#1B2A59] text-amber-300 border border-[#C8942E] flex items-center justify-center shrink-0 shadow-sm">
                                    <BookOpen size={22} />
                                </div>
                                <div className="min-w-0 space-y-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="inline-flex items-center gap-1 text-[10px] font-black bg-[#8C621E] text-white px-2.5 py-0.5 rounded-full shadow-2xs">
                                            <Layers size={11} />
                                            <span>{trackBadgeTitle}</span>
                                        </span>
                                        <span className="inline-flex items-center gap-1 text-[10px] font-black bg-[#1B2A59] text-amber-200 px-2.5 py-0.5 rounded-full">
                                            <Sparkles size={11} />
                                            <span>{activeLesson.partLabel || `الجزء ${activeLesson.partNumber}`}</span>
                                        </span>
                                        <span className="text-[10px] font-black bg-amber-100 text-[#785114] border border-amber-300 px-2.5 py-0.5 rounded-full">
                                            شهر {activeLesson.copticMonth} • {activeLesson.weekLabel}
                                        </span>
                                        <span className="text-[10px] font-black bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full tabular-nums">
                                            ص {activeLesson.startPage} - {activeLesson.endPage}
                                        </span>
                                    </div>
                                    <h3 className="font-calligraphic font-bold text-base sm:text-lg text-[#1B2A59] truncate">
                                        {headingPrefix}: {activeLesson.title}
                                    </h3>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => openLessonInPdfViewer(navigate, activeLesson)}
                                    className="w-full sm:w-auto min-h-[42px] inline-flex items-center justify-center gap-1.5 bg-[#1B2A59] hover:bg-[#132046] text-amber-200 border border-[#C8942E]/60 px-4 py-2 rounded-2xl font-black text-xs shadow-sm transition-all cursor-pointer tactile-press"
                                >
                                    <Eye size={15} />
                                    <span>افتح الشرح (ص {activeLesson.startPage})</span>
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

const NEW_CUSTOM_TRACK_VALUE = '__new_custom_track__';

export default function CopticBookProgressionSection({
    selectedSyncKey = '',
    selectedOsra = null,
    copticBooks = [],
    firestore = null,
    isFirebaseConfigured = false,
    onToast = null
}) {
    const navigate = useNavigate();

    // Custom empty tracks added in the UI before their first PDF is uploaded (scoped per class)
    const [customClassTracksBySyncKey, setCustomClassTracksBySyncKey] = useState({});
    const [showNewTrackCreator, setShowNewTrackCreator] = useState(false);
    const [newTrackNameInput, setNewTrackNameInput] = useState('');

    const multiTrackProgressions = useMemo(
        () => resolveMultiTrackBookProgression(copticBooks),
        [copticBooks]
    );

    const availableTracks = useMemo(() => {
        const trackMap = new Map();

        // Display ONLY the tracks that actually exist for this class (zero empty default tabs)
        for (const prog of multiTrackProgressions) {
            trackMap.set(prog.trackId, {
                trackId: prog.trackId,
                trackName: prog.trackName,
                shortLabel: prog.trackName,
                progression: prog
            });
        }

        // Merge any user-created custom tracks added explicitly during this session for the active class
        const localCustom = customClassTracksBySyncKey[selectedSyncKey] || [];
        for (const custom of localCustom) {
            if (!trackMap.has(custom.trackId)) {
                trackMap.set(custom.trackId, {
                    trackId: custom.trackId,
                    trackName: custom.trackName,
                    shortLabel: custom.trackName,
                    progression: null
                });
            }
        }

        return Array.from(trackMap.values());
    }, [multiTrackProgressions, customClassTracksBySyncKey, selectedSyncKey]);

    const modalSelectableTracks = useMemo(() => {
        const map = new Map();
        for (const t of availableTracks) {
            map.set(t.trackId, { trackId: t.trackId, trackName: t.trackName });
        }
        for (const preset of OFFICIAL_CHURCH_CURRICULUM_TRACKS) {
            if (!map.has(preset.trackId)) {
                map.set(preset.trackId, { trackId: preset.trackId, trackName: preset.trackName });
            }
        }
        return Array.from(map.values());
    }, [availableTracks]);

    const [selectedTrackId, setSelectedTrackId] = useState('track_bishopric');
    const [manualPartByTrack, setManualPartByTrack] = useState({});
    const [manualMonthToggles, setManualMonthToggles] = useState({});
    const [stampingLessonId, setStampingLessonId] = useState('');

    const activeTrackMeta = useMemo(() => {
        return availableTracks.find((t) => t.trackId === selectedTrackId) || availableTracks[0] || {
            trackId: 'track_bishopric',
            trackName: 'منهج الأسقفية',
            shortLabel: 'منهج الأسقفية',
            progression: null
        };
    }, [availableTracks, selectedTrackId]);

    const progression = useMemo(() => {
        if (activeTrackMeta?.progression) return activeTrackMeta.progression;
        return resolveCurrentBookProgression(copticBooks, {
            trackId: activeTrackMeta.trackId,
            trackName: activeTrackMeta.trackName
        });
    }, [activeTrackMeta, copticBooks]);

    const trackScopeKey = `${selectedSyncKey}::${activeTrackMeta.trackId}`;
    const selectedPartNumber = manualPartByTrack[trackScopeKey] || progression.activePartNumber || 1;
    const setSelectedPartNumber = (partNum) => {
        setManualPartByTrack((prev) => ({ ...prev, [trackScopeKey]: Number(partNum) || 1 }));
    };

    // Upload / Auto-Splitter / Compressor Modal State
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [modalTrackSelect, setModalTrackSelect] = useState('track_1');
    const [modalTrackName, setModalTrackName] = useState('المنهج السنوي الأول');
    const [modalPartNumber, setModalPartNumber] = useState(1);
    const [modalBookId, setModalBookId] = useState(null);
    const [modalTitle, setModalTitle] = useState('');
    const [modalFile, setModalFile] = useState(null);
    const [modalFileUrl, setModalFileUrl] = useState('');
    const [modalFileName, setModalFileName] = useState('');
    const [modalTotalPages, setModalTotalPages] = useState(64);
    const [modalLessons, setModalLessons] = useState([]);

    const [pipelineStage, setPipelineStage] = useState('idle'); // 'idle' | 'analyzing' | 'compressing' | 'ready'
    const [compressProgress, setCompressProgress] = useState(0);
    const [compressionStats, setCompressionStats] = useState(null);
    const [scanSummary, setScanSummary] = useState('');
    const [sizeGuardError, setSizeGuardError] = useState('');
    const [uploadProgress, setUploadProgress] = useState(0);
    const [savingBook, setSavingBook] = useState(false);

    const activePartObj = useMemo(() => {
        return progression.parts.find((p) => p.partNumber === selectedPartNumber) || null;
    }, [progression.parts, selectedPartNumber]);

    const expandedMonths = useMemo(() => {
        if (!activePartObj) return {};
        const nextExpanded = {};
        activePartObj.months.forEach((m) => {
            const toggleKey = `${trackScopeKey}::p${activePartObj.partNumber}::${m.copticMonth}`;
            if (Object.prototype.hasOwnProperty.call(manualMonthToggles, toggleKey)) {
                nextExpanded[m.copticMonth] = manualMonthToggles[toggleKey];
                return;
            }
            const isCurrentActiveMonth =
                progression.currentActiveLesson &&
                progression.currentActiveLesson.partNumber === activePartObj.partNumber &&
                progression.currentActiveLesson.copticMonth === m.copticMonth;
            nextExpanded[m.copticMonth] = Boolean(isCurrentActiveMonth || !m.isMonthCompleted);
        });
        return nextExpanded;
    }, [activePartObj, progression.currentActiveLesson, manualMonthToggles, trackScopeKey]);

    const notify = (msg) => {
        if (typeof onToast === 'function') onToast(msg);
    };

    const resolveEffectiveModalTrack = () => {
        if (modalTrackSelect === NEW_CUSTOM_TRACK_VALUE) {
            const customTitle = modalTrackName.trim() || 'منهج سنوي إضافي';
            return normalizeCurriculumTrack({ trackName: customTitle });
        }
        return normalizeCurriculumTrack({
            trackId: modalTrackSelect,
            trackName: modalTrackName.trim()
        });
    };

    const initializeModalForPart = (partNum = 1, existingBook = null, explicitTrack = null) => {
        const partMeta = getCopticPartMeta(partNum);
        const osraName = selectedOsra?.name || selectedSyncKey || 'الفصل';
        const targetTrack = explicitTrack || (existingBook
            ? normalizeCurriculumTrack(existingBook)
            : { trackId: activeTrackMeta.trackId, trackName: activeTrackMeta.trackName });

        // Check if this (trackId, partNumber) already has an uploaded book when existingBook isn't explicitly passed
        const matchedExistingInTrack = existingBook || copticBooks.find(
            (b) => normalizeCurriculumTrack(b).trackId === targetTrack.trackId && Number(b.partNumber) === Number(partNum)
        ) || null;

        setModalTrackSelect(
            modalSelectableTracks.some((t) => t.trackId === targetTrack.trackId)
                ? targetTrack.trackId
                : NEW_CUSTOM_TRACK_VALUE
        );
        setModalTrackName(targetTrack.trackName);

        if (matchedExistingInTrack) {
            setModalBookId(matchedExistingInTrack.id);
            setModalPartNumber(matchedExistingInTrack.partNumber || partNum);
            setModalTitle(
                matchedExistingInTrack.title ||
                `${targetTrack.trackName} (${osraName}) - ${partMeta.shortLabel}`
            );
            setModalFile(null);
            setModalFileUrl(matchedExistingInTrack.fileUrl || matchedExistingInTrack.attachmentUrl || '');
            setModalFileName(matchedExistingInTrack.fileName || '');
            setModalTotalPages(matchedExistingInTrack.totalPages || 64);
            setModalLessons(
                Array.isArray(matchedExistingInTrack.lessons)
                    ? matchedExistingInTrack.lessons.map((l) => ({ ...l }))
                    : []
            );
            setScanSummary(`تعديل جدول دروس ${partMeta.label} ضمن «${targetTrack.trackName}» (${matchedExistingInTrack.lessons?.length || 0} درس)`);
        } else {
            const defaultPlan = extractLessonsFromPagesText(new Array(64).fill(''), partNum);
            setModalBookId(null);
            setModalPartNumber(partNum);
            setModalTitle(`${targetTrack.trackName} (${osraName}) - ${partMeta.shortLabel}`);
            setModalFile(null);
            setModalFileUrl('');
            setModalFileName('');
            setModalTotalPages(defaultPlan.totalPages);
            setModalLessons(defaultPlan.lessons);
            setScanSummary('اختر ملف الـ PDF ليقوم النظام بتحليل الدروس ثم ضغط الملف تلقائياً لأصغر مساحة ممكنة قبل الرفع.');
        }

        setPipelineStage('idle');
        setCompressProgress(0);
        setCompressionStats(null);
        setSizeGuardError('');
        setUploadProgress(0);
        setShowUploadModal(true);
    };

    const handleModalTrackSelectChange = (val) => {
        setModalTrackSelect(val);
        const osraName = selectedOsra?.name || selectedSyncKey || 'الفصل';
        const partMeta = getCopticPartMeta(modalPartNumber);
        if (val === NEW_CUSTOM_TRACK_VALUE) {
            const defaultCustomName = 'منهج سنوي إضافي';
            setModalTrackName('');
            setModalBookId(null);
            setModalTitle(`${defaultCustomName} (${osraName}) - ${partMeta.shortLabel}`);
            return;
        }
        const found = modalSelectableTracks.find((t) => t.trackId === val);
        const nextName = found?.trackName || normalizeCurriculumTrack({ trackId: val }).trackName;
        setModalTrackName(nextName);

        const existingInTarget = copticBooks.find(
            (b) => normalizeCurriculumTrack(b).trackId === val && Number(b.partNumber) === Number(modalPartNumber)
        );
        setModalBookId(existingInTarget?.id || null);
        setModalTitle(`${nextName} (${osraName}) - ${partMeta.shortLabel}`);
    };

    const handleChangeModalPart = (nextPartNum) => {
        const num = Number(nextPartNum) || 1;
        const partMeta = getCopticPartMeta(num);
        const osraName = selectedOsra?.name || selectedSyncKey || 'الفصل';
        const effTrack = resolveEffectiveModalTrack();
        const existingInTarget = copticBooks.find(
            (b) => normalizeCurriculumTrack(b).trackId === effTrack.trackId && Number(b.partNumber) === num
        );
        setModalBookId(existingInTarget?.id || null);
        setModalPartNumber(num);
        setModalTitle(`${effTrack.trackName} (${osraName}) - ${partMeta.shortLabel}`);
        if (!modalFile) {
            const fallbackPlan = extractLessonsFromPagesText(new Array(modalTotalPages || 64).fill(''), num);
            setModalLessons(fallbackPlan.lessons);
        } else {
            void handlePdfFileSelected(modalFile, num);
        }
    };

    const handleCreateNewTrackInline = (openUploaderImmediately = true) => {
        const trimmed = newTrackNameInput.trim();
        if (!trimmed) {
            alert('يرجى كتابة اسم المنهج السنوي الجديد أولاً (مثال: منهج الكتاب المقدس والطقس).');
            return;
        }
        const createdTrack = normalizeCurriculumTrack({ trackName: trimmed });
        setCustomClassTracksBySyncKey((prev) => {
            const existing = prev[selectedSyncKey] || [];
            if (existing.some((t) => t.trackId === createdTrack.trackId)) return prev;
            return {
                ...prev,
                [selectedSyncKey]: [...existing, createdTrack]
            };
        });
        setSelectedTrackId(createdTrack.trackId);
        setSelectedPartNumber(1);
        setNewTrackNameInput('');
        setShowNewTrackCreator(false);
        if (openUploaderImmediately) {
            setTimeout(() => {
                initializeModalForPart(1, null, createdTrack);
            }, 0);
        } else {
            notify(`تمت إضافة «${createdTrack.trackName}» للفصل — يمكنك الآن رفع أجزائه الأربعة`);
        }
    };

    const handlePdfFileSelected = async (rawFile, explicitPartNum = null) => {
        if (!rawFile) return;
        setSizeGuardError('');
        setUploadProgress(0);
        setCompressionStats(null);
        const targetPart = explicitPartNum || modalPartNumber;
        setModalFileName(rawFile.name);
        setPipelineStage('analyzing');
        setCompressProgress(0);
        setScanSummary('جاري تحليل الـ PDF وتقسيم الدروس على أسابيع السنة...');

        try {
            const { extracted, compressedFile, compression } = await analyzeAndCompressCurriculumPdf(
                rawFile,
                targetPart,
                (status) => {
                    if (status.stage === 'analyzing') {
                        setPipelineStage('analyzing');
                    } else if (status.stage === 'compressing') {
                        setPipelineStage('compressing');
                        setCompressProgress(Number(status.progress) || 0);
                    }
                }
            );

            const postSizeCheck = validateCloudinaryPdfSize(compressedFile);
            if (!postSizeCheck.ok) {
                setModalFile(null);
                setPipelineStage('idle');
                setSizeGuardError(postSizeCheck.message);
                return;
            }

            setModalFile(compressedFile);
            setCompressionStats(compression);
            setModalTotalPages(extracted.totalPages);
            setModalLessons(extracted.lessons);
            setPipelineStage('ready');

            if (extracted.detectedCount > 0) {
                setScanSummary(
                    `تم فحص ${extracted.totalPages} صفحة واكتشاف ${extracted.detectedCount} درس تلقائياً وضغط الملف بنجاح — يمكنك مراجعة أو تعديل أي عنوان أو رقم صفحة قبل الحفظ.`
                );
            } else {
                setScanSummary(
                    `تم فحص ${extracted.totalPages} صفحة وتوليد جدول الـ 16 أسبوعاً وضغط الملف بنجاح — يمكنك تعديل أسماء الدروس وأرقام الصفحات بسهولة.`
                );
            }
        } catch (err) {
            const fallback = extractLessonsFromPagesText(new Array(64).fill(''), targetPart);
            setModalLessons(fallback.lessons);
            setModalFile(rawFile);
            setPipelineStage('ready');
            setScanSummary('تم تجهيز جدول الأسابيع القبطية الافتراضي — يمكنك تعديل العناوين وأرقام الصفحات قبل الحفظ.');
            console.warn('[CopticBookProgressionSection] PDF pipeline fallback:', err);
        }
    };

    const handleUpdateModalLesson = (lessonId, field, value) => {
        setModalLessons((prev) =>
            prev.map((lesson) => {
                if (lesson.id !== lessonId) return lesson;
                if (field === 'startPage' || field === 'endPage') {
                    const num = Math.max(1, parseInt(value, 10) || 1);
                    return { ...lesson, [field]: num };
                }
                return { ...lesson, [field]: value };
            })
        );
    };

    const handleSaveBookPlan = async (e) => {
        e.preventDefault();
        if (!selectedSyncKey) {
            alert('يرجى اختيار الأسرة / الفصل أولاً');
            return;
        }
        if (!modalFile && !modalFileUrl.trim()) {
            alert('يرجى اختيار ملف الـ PDF أو إدخال رابط الملف أولاً');
            return;
        }
        if (modalTrackSelect === NEW_CUSTOM_TRACK_VALUE && !modalTrackName.trim()) {
            alert('يرجى إدخال اسم المنهج السنوي الجديد أولاً');
            return;
        }
        if (modalFile) {
            const sizeCheck = validateCloudinaryPdfSize(modalFile);
            if (!sizeCheck.ok) {
                setSizeGuardError(sizeCheck.message);
                return;
            }
        }

        const effectiveTrack = resolveEffectiveModalTrack();
        setSavingBook(true);
        setUploadProgress(modalFile ? 1 : 0);

        try {
            const partMeta = getCopticPartMeta(modalPartNumber);
            await saveOsraCopticBookPlan(
                selectedSyncKey,
                {
                    id: modalBookId || undefined,
                    trackId: effectiveTrack.trackId,
                    trackName: effectiveTrack.trackName,
                    title: modalTitle.trim() || `${effectiveTrack.trackName} (${selectedOsra?.name || selectedSyncKey}) - ${partMeta.shortLabel}`,
                    partNumber: modalPartNumber,
                    partLabel: partMeta.label,
                    totalPages: modalTotalPages,
                    copticMonths: partMeta.months,
                    lessons: modalLessons,
                    file: modalFile,
                    fileUrl: modalFileUrl.trim(),
                    fileName: modalFileName,
                    originalFileSize: compressionStats?.originalBytes || null,
                    compressedFileSize: compressionStats?.compressedBytes || null
                },
                {
                    serviceName: selectedOsra?.serviceName,
                    firestore: isFirebaseConfigured ? firestore : null,
                    onProgress: (pct) => setUploadProgress(pct)
                }
            );

            setCustomClassTracksBySyncKey((prev) => {
                const existing = prev[selectedSyncKey] || [];
                if (
                    availableTracks.some((d) => d.trackId === effectiveTrack.trackId) ||
                    existing.some((t) => t.trackId === effectiveTrack.trackId)
                ) {
                    return prev;
                }
                return {
                    ...prev,
                    [selectedSyncKey]: [...existing, effectiveTrack]
                };
            });

            setShowUploadModal(false);
            setUploadProgress(0);
            setSelectedTrackId(effectiveTrack.trackId);
            setSelectedPartNumber(modalPartNumber);
            notify(`تم حفظ واعتماد ${partMeta.shortLabel} ضمن «${effectiveTrack.trackName}» بنجاح`);
        } catch (err) {
            alert('حدث خطأ أثناء رفع وحفظ الكتاب: ' + (err?.message || err));
        } finally {
            setSavingBook(false);
        }
    };

    const handleStampLesson = async (bookId, lesson, explicitBook = null) => {
        if (!bookId || !lesson?.id) return;
        setStampingLessonId(lesson.id);
        try {
            const servantName = getCurrentServantDisplayName();
            const res = await toggleLessonCompletionSeal(
                bookId,
                lesson.id,
                servantName,
                selectedSyncKey,
                {
                    book: explicitBook,
                    serviceName: selectedOsra?.serviceName,
                    firestore: isFirebaseConfigured ? firestore : null
                }
            );
            notify(
                res.isCompleted
                    ? `تم ختم الدرس "${lesson.title}" بـ (تم الشرح) والانتقال التلقائي للدرس التالي في «${activeTrackMeta.trackName}»`
                    : `تم إلغاء ختم الدرس "${lesson.title}" وإعادته للمتابعة`
            );
        } catch (err) {
            alert('تعذر تحديث ختم الدرس: ' + (err?.message || err));
        } finally {
            setStampingLessonId('');
        }
    };

    const handleDeleteBookPart = async (partObj) => {
        if (!partObj?.id) return;
        if (!window.confirm(`هل أنت متأكد من حذف "${partObj.title}" وجدول دروسه من هذه الأسرة؟`)) return;
        await deleteOsraCurriculumItem(selectedSyncKey, partObj.id, {
            serviceName: selectedOsra?.serviceName,
            firestore: isFirebaseConfigured ? firestore : null
        });
        notify('تم حذف الجزء من منهج الأسرة');
    };

    const activeLesson = progression.currentActiveLesson;
    const isProcessingPdf = pipelineStage === 'analyzing' || pipelineStage === 'compressing';

    return (
        <section className="coptic-card rounded-3xl p-5 sm:p-6 border-2 border-[#C8942E] bg-[#FFFDF7] space-y-5 shadow-md">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5D3B3] pb-4">
                <div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="w-10 h-10 rounded-2xl bg-[#1B2A59] text-amber-300 border border-[#C8942E] flex items-center justify-center shrink-0">
                            <Layers size={20} />
                        </span>
                        <div>
                            <h2 className="font-calligraphic text-lg sm:text-xl font-bold text-[#1B2A59]">
                                المناهج السنوية الذكية للفصل (دعم أكثر من منهج سنوي مستقل)
                            </h2>
                            <p className="text-xs text-[#6E5329] font-semibold mt-0.5">
                                ضغط تلقائي للـ PDF وتقسيم على الشهور القبطية مع تتبع مستقل للختم الأخضر ودرس الجمعة لكل منهج
                            </p>
                        </div>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => initializeModalForPart(progression.activePartNumber || 1)}
                    className="inline-flex items-center justify-center gap-2 bg-linear-to-r from-[#1B2A59] to-[#243773] hover:opacity-95 text-amber-200 border border-[#C8942E]/60 font-black text-xs sm:text-sm px-4 py-2.5 rounded-2xl shadow-md transition-all cursor-pointer tactile-press shrink-0"
                >
                    <Upload size={16} />
                    <span>رفع جزء جديد من كتاب المنهج (PDF)</span>
                </button>
            </div>

            {/* Multi-Track Switcher Bar (المنهج الأول | المنهج الثاني | + إضافة منهج سنوي جديد للفصل) */}
            <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2 bg-[#FAF2E1] p-2 rounded-2xl border border-[#DFC48F]">
                    {availableTracks.length === 0 && (
                        <span className="text-xs font-bold text-[#7A5617] px-2 py-1">
                            لا توجد مناهج مرفوعة لهذا الفصل بعد — يمكنك رفع منهج جديد في أي وقت.
                        </span>
                    )}
                    {availableTracks.map((t) => {
                        const isSelected = t.trackId === activeTrackMeta.trackId;
                        const tProg = t.progression;
                        const hasUploaded = Boolean(tProg?.hasBooks);
                        const isDone = Boolean(tProg?.allCompleted);

                        return (
                            <button
                                key={t.trackId}
                                type="button"
                                onClick={() => setSelectedTrackId(t.trackId)}
                                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all inline-flex items-center gap-2 cursor-pointer ${
                                    isSelected
                                        ? 'bg-[#1B2A59] text-amber-200 shadow-sm border border-[#C8942E]'
                                        : 'bg-white/85 text-[#5C4520] hover:bg-white border border-transparent'
                                }`}
                            >
                                <BookOpen size={14} className={isSelected ? 'text-amber-300' : 'text-[#8C621E]'} />
                                <span>{t.shortLabel || t.trackName}</span>
                                {isDone ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-black bg-emerald-600 text-white px-2 py-0.5 rounded-full">
                                        <CheckCircle2 size={10} />
                                        <span>مكتمل</span>
                                    </span>
                                ) : hasUploaded ? (
                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full tabular-nums ${
                                        isSelected ? 'bg-amber-400 text-[#111B3A]' : 'bg-[#EFE0C2] text-[#785114]'
                                    }`}>
                                        {tProg.completedCount}/{tProg.totalCount}
                                    </span>
                                ) : (
                                    <span className="text-[10px] font-bold opacity-65">لم يُرفع</span>
                                )}
                            </button>
                        );
                    })}

                    <button
                        type="button"
                        onClick={() => setShowNewTrackCreator((v) => !v)}
                        className="px-3.5 py-2 rounded-xl text-xs font-black bg-[#EFE0C2] hover:bg-[#E5D0A6] text-[#1B2A59] border border-[#C8942E]/50 inline-flex items-center gap-1.5 transition-all cursor-pointer mr-auto"
                    >
                        <Plus size={14} className="text-[#8C621E]" />
                        <span>إضافة منهج سنوي جديد للفصل</span>
                    </button>
                </div>

                {showNewTrackCreator && (
                    <div className="bg-[#FFF9EC] border border-[#C8942E] rounded-2xl p-3.5 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 animate-card-enter">
                        <input
                            type="text"
                            value={newTrackNameInput}
                            onChange={(e) => setNewTrackNameInput(e.target.value)}
                            placeholder="اكتب اسم المنهج السنوي الجديد (مثال: منهج الكتاب المقدس والطقس)..."
                            className="coptic-cream-input flex-1 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold text-[#1B2A59]"
                        />
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                type="button"
                                onClick={() => handleCreateNewTrackInline(true)}
                                className="px-3.5 py-2 rounded-xl bg-[#1B2A59] hover:bg-[#132046] text-amber-200 font-black text-xs inline-flex items-center gap-1.5 cursor-pointer"
                            >
                                <Upload size={13} />
                                <span>إنشاء ورفع الجزء الأول</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => handleCreateNewTrackInline(false)}
                                className="px-3 py-2 rounded-xl bg-[#EFE0C2] hover:bg-[#E4CFA3] text-[#1B2A59] font-black text-xs cursor-pointer"
                            >
                                إضافة التبويب فقط
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowNewTrackCreator(false)}
                                className="p-2 rounded-xl text-[#6E5329] hover:bg-[#EFE0C2] cursor-pointer"
                            >
                                <X size={15} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Hero Card — «درس هذه الجمعة (عليه الدور الآن)» for Selected Track */}
            {activeLesson ? (
                <div
                    className="rounded-3xl p-5 sm:p-6 border-2 border-[#C8942E] text-white shadow-xl relative overflow-hidden"
                    style={{ background: 'linear-gradient(135deg, #132046 0%, #1B2A59 64%, #7A5419 100%)' }}
                >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="space-y-2.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 text-xs font-black bg-amber-400 text-[#111B3A] px-3 py-1 rounded-full shadow-xs">
                                    <Sparkles size={13} />
                                    <span>درس هذا الأسبوع — {activeTrackMeta.trackName}</span>
                                </span>
                                <span className="text-xs font-black bg-white/15 text-amber-200 border border-amber-300/40 px-3 py-1 rounded-full">
                                    {activeLesson.partLabel || `الجزء ${activeLesson.partNumber}`}
                                </span>
                                <span className="text-xs font-black bg-white/15 text-slate-100 border border-white/25 px-3 py-1 rounded-full">
                                    شهر {activeLesson.copticMonth} • {activeLesson.weekLabel}
                                </span>
                                <span className="text-xs font-black bg-white/10 text-[#F7E8CC] px-3 py-1 rounded-full tabular-nums">
                                    ص {activeLesson.startPage} - {activeLesson.endPage}
                                </span>
                            </div>

                            <h3 className="font-calligraphic text-xl sm:text-2xl font-bold text-amber-300 leading-snug">
                                {activeLesson.title}
                            </h3>

                            <p className="text-xs text-indigo-100/90 font-semibold">
                                الكتاب: {activeLesson.bookTitle} • تقدم «{activeTrackMeta.trackName}»: {progression.completedLessons} من {progression.totalLessons} درس ({progression.overallProgressPercent}%)
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
                            <button
                                type="button"
                                onClick={() => openLessonInPdfViewer(navigate, activeLesson)}
                                className="min-h-[46px] inline-flex items-center justify-center gap-2 bg-[#C8942E] hover:bg-[#b58424] text-[#111B3A] font-black text-xs sm:text-sm px-4 py-2.5 rounded-2xl shadow-lg transition-all cursor-pointer tactile-press"
                            >
                                <BookOpen size={17} />
                                <span>فتح شرح الدرس في الـ PDF (ص {activeLesson.startPage})</span>
                            </button>

                            <button
                                type="button"
                                disabled={stampingLessonId === activeLesson.id}
                                onClick={() => handleStampLesson(activeLesson.bookId, activeLesson)}
                                className="min-h-[46px] inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-[#1B2A59] border border-slate-300 font-black text-xs sm:text-sm px-4 py-2.5 rounded-2xl shadow-sm transition-all cursor-pointer tactile-press disabled:opacity-60"
                            >
                                <Circle size={16} className="text-slate-500" />
                                <span>تأكيد الشرح</span>
                            </button>
                        </div>
                    </div>
                </div>
            ) : progression.hasBooks && progression.allCompleted ? (
                <div className="rounded-3xl p-5 bg-emerald-50 border-2 border-emerald-400 text-emerald-950 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md">
                            <Award size={26} />
                        </div>
                        <div>
                            <span className="text-xs font-black text-emerald-700 block">
                                اكتمل شرح الأجزاء المرفوعة في «{activeTrackMeta.trackName}»
                            </span>
                            <h3 className="font-calligraphic text-lg sm:text-xl font-bold text-emerald-950">
                                تم ختم جميع دروس هذا المنهج المرفوعة بختم (تم الشرح) ({progression.completedLessons}/{progression.totalLessons})
                            </h3>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => initializeModalForPart(Math.min(4, (progression.parts.length || 1) + 1))}
                        className="inline-flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs px-4 py-2.5 rounded-2xl cursor-pointer shrink-0"
                    >
                        <Upload size={15} />
                        <span>رفع الجزء التالي من هذا المنهج</span>
                    </button>
                </div>
            ) : null}

            {/* Parts Switcher (الجزء 1 | الجزء 2 | الجزء 3 | الجزء 4 + أي أجزاء إضافية) within Selected Track */}
            <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-[#F5EBD6] p-1.5 rounded-2xl border border-[#DFC48F]">
                    {[
                        ...COPTIC_YEAR_PARTS,
                        ...progression.parts
                            .filter((p) => p.partNumber > 4)
                            .map((p) => ({ partNumber: p.partNumber, shortLabel: p.partLabel || `الجزء ${p.partNumber}` }))
                    ].map((partMeta) => {
                        const uploadedPart = progression.parts.find((p) => p.partNumber === partMeta.partNumber);
                        const isSelected = selectedPartNumber === partMeta.partNumber;
                        const isCompleted = Boolean(uploadedPart?.isPartCompleted);
                        const isCurrentActivePart = activeLesson?.partNumber === partMeta.partNumber;

                        return (
                            <button
                                key={partMeta.partNumber}
                                type="button"
                                onClick={() => setSelectedPartNumber(partMeta.partNumber)}
                                className={`py-2.5 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-between gap-1.5 cursor-pointer ${
                                    isSelected
                                        ? 'bg-[#1B2A59] text-amber-200 shadow-sm border border-[#C8942E]'
                                        : 'bg-white/70 text-[#5C4520] hover:bg-white'
                                }`}
                            >
                                <span className="truncate">الجزء {partMeta.partNumber}</span>
                                {isCompleted ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-black bg-emerald-600 text-white px-2 py-0.5 rounded-full shrink-0">
                                        <CheckCircle2 size={11} />
                                        مكتمل
                                    </span>
                                ) : uploadedPart ? (
                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 tabular-nums ${
                                        isCurrentActivePart
                                            ? 'bg-amber-400 text-[#111B3A]'
                                            : 'bg-[#EFE0C2] text-[#785114]'
                                    }`}>
                                        {uploadedPart.completedLessonsCount}/{uploadedPart.totalLessonsCount}
                                    </span>
                                ) : (
                                    <span className="text-[10px] font-bold opacity-60 shrink-0">غير مرفوع</span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Selected Part Details & Coptic Month Accordions */}
                {!activePartObj ? (
                    <div className="bg-[#FAF2E1] border border-dashed border-[#D3B683] rounded-2xl p-7 text-center space-y-3">
                        <BookOpen size={36} className="mx-auto text-[#9E7834] opacity-75" />
                        <h3 className="font-bold text-[#1B2A59] text-sm">
                            لم يتم رفع «{getCopticPartMeta(selectedPartNumber).label}» ضمن «{activeTrackMeta.trackName}» بعد
                        </h3>
                        <p className="text-xs text-[#6E5329] max-w-md mx-auto">
                            ارفع ملف الـ PDF الخاص بهذا الجزء ليقوم النظام بتحليل الدروس ثم ضغط الملف تلقائياً لأصغر مساحة ممكنة وحفظه مستقلاً لهذا المنهج.
                        </p>
                        <button
                            type="button"
                            onClick={() => initializeModalForPart(selectedPartNumber)}
                            className="inline-flex items-center gap-1.5 bg-[#C8942E] hover:bg-[#b58424] text-[#111B3A] font-black text-xs px-4 py-2.5 rounded-xl cursor-pointer"
                        >
                            <Upload size={15} />
                            <span>رفع {getCopticPartMeta(selectedPartNumber).shortLabel} في «{activeTrackMeta.shortLabel || activeTrackMeta.trackName}»</span>
                        </button>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {/* Part Summary Bar */}
                        <div className="bg-[#FAF3E3] border border-[#DFC48F] rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1 text-[11px] font-black bg-[#8C621E] text-white px-2.5 py-0.5 rounded-full">
                                    <Layers size={11} />
                                    <span>{activePartObj.trackName || activeTrackMeta.trackName}</span>
                                </span>
                                <span className="text-xs font-black text-[#1B2A59]">{activePartObj.title}</span>
                                <span className="text-[11px] font-bold text-[#8C621E]">
                                    ({activePartObj.partLabel} • {activePartObj.totalPages} صفحة)
                                </span>
                                {activePartObj.isPartCompleted && (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-black bg-emerald-600 text-white px-2.5 py-0.5 rounded-full">
                                        <Award size={12} />
                                        تم ختم الجزء بالكامل
                                    </span>
                                )}
                            </div>

                            <div className="flex items-center gap-1.5">
                                {activePartObj.fileUrl && (
                                    <button
                                        type="button"
                                        onClick={() => openLessonInPdfViewer(navigate, {
                                            title: activePartObj.title,
                                            bookTitle: activePartObj.title,
                                            fileUrl: activePartObj.fileUrl,
                                            startPage: 1,
                                            endPage: activePartObj.totalPages || 1
                                        }, activePartObj)}
                                        className="inline-flex items-center gap-1 text-xs font-black bg-[#1B2A59] text-amber-200 px-3 py-1.5 rounded-xl cursor-pointer"
                                    >
                                        <Eye size={13} />
                                        <span>فتح الكتاب كاملاً</span>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => initializeModalForPart(activePartObj.partNumber, activePartObj)}
                                    className="inline-flex items-center gap-1 text-xs font-bold text-[#1B2A59] bg-[#EFE0C2] hover:bg-[#E4CFA3] px-2.5 py-1.5 rounded-xl cursor-pointer"
                                >
                                    <Edit3 size={13} />
                                    <span>تعديل الفهرس</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDeleteBookPart(activePartObj)}
                                    className="inline-flex items-center gap-1 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 px-2.5 py-1.5 rounded-xl cursor-pointer"
                                >
                                    <Trash2 size={13} />
                                    <span>حذف</span>
                                </button>
                            </div>
                        </div>

                        {/* Coptic Month Accordions */}
                        {activePartObj.months.map((monthGroup) => {
                            const isExpanded = Boolean(expandedMonths[monthGroup.copticMonth]);
                            const isCurrentActiveMonth =
                                activeLesson &&
                                activeLesson.partNumber === activePartObj.partNumber &&
                                activeLesson.copticMonth === monthGroup.copticMonth;

                            return (
                                <div
                                    key={monthGroup.copticMonth}
                                    className={`rounded-2xl border transition-all overflow-hidden ${
                                        monthGroup.isMonthCompleted
                                            ? 'border-emerald-300 bg-emerald-50/40'
                                            : isCurrentActiveMonth
                                                ? 'border-2 border-[#C8942E] bg-[#FFFBF2]'
                                                : 'border-[#E2CCA2] bg-[#FFFBF2]'
                                    }`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const toggleKey = `${trackScopeKey}::p${activePartObj.partNumber}::${monthGroup.copticMonth}`;
                                            setManualMonthToggles((prev) => ({
                                                ...prev,
                                                [toggleKey]: !isExpanded
                                            }));
                                        }}
                                        className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-right hover:bg-[#FAF1DE]/60 transition-colors cursor-pointer"
                                    >
                                        <div className="flex items-center gap-2.5 flex-wrap">
                                            <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs ${
                                                monthGroup.isMonthCompleted
                                                    ? 'bg-emerald-600 text-white'
                                                    : isCurrentActiveMonth
                                                        ? 'bg-[#1B2A59] text-amber-300'
                                                        : 'bg-[#EFE0C2] text-[#785114]'
                                            }`}>
                                                {monthGroup.isMonthCompleted ? <CheckCircle2 size={16} /> : monthGroup.monthOrder}
                                            </span>
                                            <span className="font-calligraphic font-bold text-base sm:text-lg text-[#1B2A59]">
                                                شهر {monthGroup.copticMonth}
                                            </span>

                                            {monthGroup.isMonthCompleted ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-black bg-emerald-600 text-white px-2.5 py-0.5 rounded-full shadow-2xs">
                                                    <Award size={12} />
                                                    اكتمل الشهر ({monthGroup.completedCount}/{monthGroup.totalCount})
                                                </span>
                                            ) : isCurrentActiveMonth ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-black bg-amber-100 text-[#8C621E] border border-[#C8942E] px-2.5 py-0.5 rounded-full">
                                                    <Sparkles size={11} />
                                                    الشهر الحالي ({monthGroup.completedCount}/{monthGroup.totalCount})
                                                </span>
                                            ) : (
                                                <span className="text-[11px] font-bold text-[#6E5329]">
                                                    ({monthGroup.completedCount}/{monthGroup.totalCount} مكتمل)
                                                </span>
                                            )}
                                        </div>

                                        <span className="text-[#8C621E]">
                                            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                        </span>
                                    </button>

                                    {isExpanded && (
                                        <div className="p-3 sm:p-4 pt-0 space-y-2.5 border-t border-[#EFE3CB]">
                                            {monthGroup.lessons.map((lesson) => {
                                                const isActiveFriday =
                                                    activeLesson &&
                                                    activeLesson.bookId === activePartObj.id &&
                                                    activeLesson.id === lesson.id;
                                                const completedDateText = lesson.completedAt
                                                    ? String(lesson.completedAt).split('T')[0]
                                                    : '';

                                                return (
                                                    <div
                                                        key={lesson.id}
                                                        className={`rounded-2xl p-3.5 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                                                            lesson.isCompleted
                                                                ? 'bg-emerald-50/75 border border-emerald-300'
                                                                : isActiveFriday
                                                                    ? 'bg-linear-to-l from-[#FFF9EA] to-[#FDF2D6] border-2 border-[#C8942E] shadow-sm'
                                                                    : 'bg-white border border-[#E7D6B4]'
                                                        }`}
                                                    >
                                                        <div className="flex items-start gap-3 min-w-0">
                                                            <div
                                                                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-black text-xs transition-all ${
                                                                    lesson.isCompleted
                                                                        ? 'bg-emerald-600 text-white ring-4 ring-emerald-200 shadow-sm'
                                                                        : isActiveFriday
                                                                            ? 'bg-[#1B2A59] text-amber-300 ring-2 ring-[#C8942E]'
                                                                            : 'bg-[#FAF3E3] text-[#785114] border border-[#DFC48F]'
                                                                }`}
                                                                title={lesson.isCompleted ? 'تم الشرح' : lesson.weekLabel}
                                                            >
                                                                {lesson.isCompleted ? <CheckCircle2 size={19} /> : lesson.weekNumber}
                                                            </div>

                                                            <div className="min-w-0 space-y-1">
                                                                <div className="flex flex-wrap items-center gap-1.5">
                                                                    <span className="text-[11px] font-black text-[#8C621E] bg-[#F6EAD0] px-2.5 py-0.5 rounded-full">
                                                                        {lesson.weekLabel}
                                                                    </span>
                                                                    <span className="text-[11px] font-black text-[#1B2A59] bg-[#E9EDF8] px-2.5 py-0.5 rounded-full tabular-nums">
                                                                        ص {lesson.startPage} - {lesson.endPage}
                                                                    </span>
                                                                    {lesson.isCompleted ? (
                                                                        <span className="inline-flex items-center gap-1 text-[10px] font-black bg-emerald-600 text-white px-2.5 py-0.5 rounded-full shadow-2xs">
                                                                            <CheckCircle2 size={11} />
                                                                            تم الشرح {completedDateText ? `(${completedDateText})` : ''}
                                                                        </span>
                                                                    ) : isActiveFriday ? (
                                                                        <span className="inline-flex items-center gap-1 text-[10px] font-black bg-[#C8942E] text-[#111B3A] px-2.5 py-0.5 rounded-full">
                                                                            <Sparkles size={10} />
                                                                            درس هذا الأسبوع
                                                                        </span>
                                                                    ) : (
                                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-0.5 rounded-full">
                                                                            لم يُشرح بعد
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                <h4 className="font-bold text-sm sm:text-base text-[#1B2A59] leading-snug">
                                                                    {lesson.title}
                                                                </h4>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-2 shrink-0">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    openLessonInPdfViewer(
                                                                        navigate,
                                                                        {
                                                                            ...lesson,
                                                                            fileUrl: activePartObj.fileUrl,
                                                                            bookTitle: activePartObj.title
                                                                        },
                                                                        activePartObj
                                                                    )
                                                                }
                                                                className="inline-flex items-center gap-1.5 bg-[#1B2A59] hover:bg-[#132046] text-amber-200 font-black text-xs px-3.5 py-2 rounded-xl transition-colors cursor-pointer"
                                                            >
                                                                <FileText size={14} />
                                                                <span>فتح (ص {lesson.startPage})</span>
                                                            </button>

                                                            {lesson.isCompleted ? (
                                                                <button
                                                                    type="button"
                                                                    disabled={stampingLessonId === lesson.id}
                                                                    onClick={() => handleStampLesson(activePartObj.id, lesson, activePartObj)}
                                                                    className="inline-flex items-center gap-1.5 font-bold text-xs px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 transition-all cursor-pointer disabled:opacity-60"
                                                                >
                                                                    <RotateCcw size={13} />
                                                                    <span>إلغاء الختم</span>
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    disabled={stampingLessonId === lesson.id}
                                                                    onClick={() => handleStampLesson(activePartObj.id, lesson, activePartObj)}
                                                                    className="inline-flex items-center gap-1.5 font-black text-xs px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-[#1B2A59] transition-all cursor-pointer disabled:opacity-60"
                                                                >
                                                                    <Circle size={14} className="text-slate-500" />
                                                                    <span>تأكيد الشرح</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Upload, Auto-Compress & Auto-Lesson Splitter Modal */}
            {showUploadModal && (
                <div
                    className="fixed inset-0 z-[120] bg-[#0F1B3D]/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-modal-enter"
                    onClick={() => !savingBook && !isProcessingPdf && setShowUploadModal(false)}
                >
                    <form
                        onSubmit={handleSaveBookPlan}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-[#FBF5E9] border-2 border-[#C8942E] rounded-3xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-5 sm:p-6 space-y-4"
                    >
                        <div className="flex items-center justify-between gap-2 border-b border-[#E5D3B3] pb-3">
                            <div>
                                <h3 className="font-calligraphic text-lg sm:text-xl font-bold text-[#1B2A59]">
                                    {modalBookId ? 'تعديل فهرس ودروس كتاب المنهج' : 'رفع وضغط وتقسيم كتاب المنهج السنوي الذكي (PDF)'}
                                </h3>
                                <p className="text-xs font-bold text-[#8C621E]">
                                    الأسرة: {selectedOsra?.name || selectedSyncKey} • تحليل العناوين ثم الضغط التلقائي قبل الرفع على Cloudinary
                                </p>
                            </div>
                            <button
                                type="button"
                                disabled={savingBook || isProcessingPdf}
                                onClick={() => setShowUploadModal(false)}
                                className="p-2 rounded-xl bg-[#EFE0C2] text-[#1B2A59] hover:bg-[#E4CFA6] cursor-pointer disabled:opacity-50"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Track Selection & Custom Track Name */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#FAF2E1] border border-[#DFC48F] rounded-2xl p-3.5">
                            <div>
                                <label className="block text-xs font-black text-[#1B2A59] mb-1">
                                    اختر المسار / المنهج السنوي للفصل *
                                </label>
                                <select
                                    value={modalTrackSelect}
                                    onChange={(e) => handleModalTrackSelectChange(e.target.value)}
                                    className="coptic-cream-input w-full px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-black text-[#1B2A59]"
                                >
                                    {modalSelectableTracks.map((t) => (
                                        <option key={t.trackId} value={t.trackId}>
                                            {t.trackName}
                                        </option>
                                    ))}
                                    <option value={NEW_CUSTOM_TRACK_VALUE}>
                                        + إنشاء منهج سنوي جديد مخصص للفصل...
                                    </option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-black text-[#1B2A59] mb-1">
                                    اسم المنهج السنوي المعروض (قابل للتخصيص) *
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={modalTrackName}
                                    onChange={(e) => {
                                        const nextTrackLabel = e.target.value;
                                        setModalTrackName(nextTrackLabel);
                                        const partMeta = getCopticPartMeta(modalPartNumber);
                                        const osraName = selectedOsra?.name || selectedSyncKey || 'الفصل';
                                        if (nextTrackLabel.trim()) {
                                            setModalTitle(`${nextTrackLabel.trim()} (${osraName}) - ${partMeta.shortLabel}`);
                                        }
                                    }}
                                    placeholder="مثال: منهج التربية الكنسية أو منهج الكتاب المقدس والطقس"
                                    className="coptic-cream-input w-full px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-[#1B2A59]"
                                />
                            </div>
                        </div>

                        {/* Part Selection & Book Title */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-black text-[#1B2A59] mb-1">
                                    الجزء من السنة القبطية (داخل هذا المنهج) *
                                </label>
                                <select
                                    value={modalPartNumber}
                                    onChange={(e) => handleChangeModalPart(Number(e.target.value))}
                                    className="coptic-cream-input w-full px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-black text-[#1B2A59]"
                                >
                                    {COPTIC_YEAR_PARTS.map((p) => (
                                        <option key={p.partNumber} value={p.partNumber}>
                                            {p.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-black text-[#1B2A59] mb-1">
                                    عنوان الكتاب / الجزء *
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={modalTitle}
                                    onChange={(e) => setModalTitle(e.target.value)}
                                    placeholder="مثال: منهج الصف الأول الابتدائي - الجزء الأول"
                                    className="coptic-cream-input w-full px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-[#1B2A59]"
                                />
                            </div>
                        </div>

                        {/* PDF File Picker, 3-Stage Live Progress & Direct Link */}
                        <div className="bg-[#FAF1DE] border border-[#DFC48F] rounded-2xl p-4 space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-black text-[#1B2A59] flex items-center gap-1.5">
                                    <FileText size={15} className="text-[#8C621E]" />
                                    <span>اختر ملف الـ PDF (يتم التحليل والضغط التلقائي لأي حجم حتى 50+ ميجابايت)</span>
                                </span>

                                <label className={`inline-flex items-center gap-1.5 bg-[#1B2A59] hover:bg-[#132045] text-amber-200 text-xs font-black px-3.5 py-2 rounded-xl shadow-xs ${
                                    isProcessingPdf || savingBook ? 'opacity-65 cursor-not-allowed' : 'cursor-pointer'
                                }`}>
                                    {isProcessingPdf ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                    <span>{isProcessingPdf ? 'جاري التحليل والضغط...' : 'اختيار ملف PDF من الجهاز'}</span>
                                    <input
                                        type="file"
                                        accept=".pdf,application/pdf"
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            if (f) void handlePdfFileSelected(f);
                                            e.target.value = '';
                                        }}
                                        disabled={isProcessingPdf || savingBook}
                                        className="hidden"
                                    />
                                </label>
                            </div>

                            <input
                                type="text"
                                dir="ltr"
                                value={modalFileUrl}
                                onChange={(e) => setModalFileUrl(e.target.value)}
                                placeholder="https://res.cloudinary.com/.../book_part1.pdf"
                                className="coptic-cream-input w-full px-3 py-2 rounded-xl text-xs font-mono text-[#1B2A59]"
                            />

                            {/* Stage 1: Analyzing Original Crisp PDF */}
                            {pipelineStage === 'analyzing' && (
                                <div className="bg-white/95 border border-[#C8942E] rounded-xl p-3 flex items-center gap-2.5 text-xs font-black text-[#1B2A59]">
                                    <Loader2 size={16} className="animate-spin text-[#8C621E] shrink-0" />
                                    <span>جاري تحليل الـ PDF وتقسيم الدروس على أسابيع السنة...</span>
                                </div>
                            )}

                            {/* Stage 2: Automatic Client-Side Compression */}
                            {pipelineStage === 'compressing' && (
                                <div className="space-y-1.5 bg-white/95 border border-[#C8942E] rounded-xl p-3">
                                    <div className="flex items-center justify-between text-xs font-black text-[#1B2A59]">
                                        <span className="flex items-center gap-1.5">
                                            <Loader2 size={14} className="animate-spin text-[#8C621E]" />
                                            <span>جاري ضغط ملف الـ PDF لأصغر مساحة ممكنة... ({compressProgress}%)</span>
                                        </span>
                                        <span className="tabular-nums text-[#8C621E]">{compressProgress}%</span>
                                    </div>
                                    <div className="w-full h-2.5 bg-[#EFE0C2] rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-linear-to-l from-emerald-600 to-[#1B2A59] rounded-full transition-all duration-200"
                                            style={{ width: `${compressProgress}%` }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Stage 3: Uploading to Cloudinary & Saving Index */}
                            {savingBook && (
                                <div className="space-y-1.5 bg-white/95 border border-[#DFC48F] rounded-xl p-3">
                                    <div className="flex items-center justify-between text-xs font-black text-[#1B2A59]">
                                        <span className="flex items-center gap-1.5">
                                            <Loader2 size={14} className="animate-spin text-[#1B2A59]" />
                                            <span>جاري الرفع على Cloudinary وحفظ الفهرس... ({uploadProgress}%)</span>
                                        </span>
                                        <span className="tabular-nums text-[#8C621E]">{uploadProgress}%</span>
                                    </div>
                                    <div className="w-full h-2.5 bg-[#EFE0C2] rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-linear-to-l from-[#C8942E] to-[#1B2A59] rounded-full transition-all duration-200"
                                            style={{ width: `${Math.max(4, uploadProgress)}%` }}
                                        />
                                    </div>
                                </div>
                            )}

                            {sizeGuardError && (
                                <div className="bg-rose-50 border border-rose-300 text-rose-800 rounded-xl px-3.5 py-2.5 text-xs font-black flex items-start gap-2">
                                    <AlertTriangle size={16} className="shrink-0 mt-0.5 text-rose-600" />
                                    <span>{sizeGuardError}</span>
                                </div>
                            )}

                            {modalFileName && !sizeGuardError && !isProcessingPdf && (
                                <div className="flex flex-wrap items-center justify-between gap-2 bg-emerald-50/90 border border-emerald-300 rounded-xl px-3 py-2 text-[11px] font-black text-emerald-900">
                                    <span className="flex items-center gap-1.5">
                                        <CheckCircle2 size={14} className="text-emerald-700 shrink-0" />
                                        <span>الملف الجاهز للرفع: {modalFileName} ({modalTotalPages} صفحة)</span>
                                    </span>
                                    {compressionStats && (
                                        <span className="inline-flex items-center gap-1.5 bg-white border border-emerald-300 px-2.5 py-0.5 rounded-full tabular-nums text-emerald-800">
                                            <span>الحجم الأصلي: {compressionStats.originalMB} MB</span>
                                            <ArrowLeft size={12} />
                                            <span>بعد الضغط: {compressionStats.compressedMB} MB</span>
                                        </span>
                                    )}
                                </div>
                            )}

                            {scanSummary && !isProcessingPdf && (
                                <p className="text-[11px] font-bold text-[#6E5329] bg-white/80 border border-[#E5D3B3] rounded-xl px-3 py-2">
                                    {scanSummary}
                                </p>
                            )}
                        </div>

                        {/* Editable Auto-Extracted Lessons Preview Table */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <h4 className="text-xs sm:text-sm font-black text-[#1B2A59] flex items-center gap-1.5">
                                    <Calendar size={15} className="text-[#8C621E]" />
                                    <span>جدول الدروس الأسبوعية المستخرج ({modalLessons.length} درس) — يمكنك تعديل أي عنوان أو رقم صفحة:</span>
                                </h4>
                            </div>

                            <div className="max-h-[320px] overflow-y-auto rounded-2xl border border-[#DFC48F] bg-white">
                                <table className="w-full text-right text-xs">
                                    <thead className="bg-[#1B2A59] text-amber-200 sticky top-0 z-10">
                                        <tr>
                                            <th className="py-2.5 px-3 font-black">الشهر القبطي</th>
                                            <th className="py-2.5 px-3 font-black">الأسبوع</th>
                                            <th className="py-2.5 px-3 font-black">اسم الدرس</th>
                                            <th className="py-2.5 px-2 font-black w-20 text-center">من صفحة</th>
                                            <th className="py-2.5 px-2 font-black w-20 text-center">إلى صفحة</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#EFE3CB]">
                                        {modalLessons.map((lesson) => (
                                            <tr key={lesson.id} className="hover:bg-[#FAF3E3]/60">
                                                <td className="py-2 px-3 font-black text-[#1B2A59] whitespace-nowrap">
                                                    شهر {lesson.copticMonth}
                                                </td>
                                                <td className="py-2 px-3 font-bold text-[#8C621E] whitespace-nowrap">
                                                    {lesson.weekLabel}
                                                </td>
                                                <td className="py-1.5 px-3">
                                                    <input
                                                        type="text"
                                                        value={lesson.title}
                                                        onChange={(e) => handleUpdateModalLesson(lesson.id, 'title', e.target.value)}
                                                        className="coptic-cream-input w-full px-2.5 py-1.5 rounded-lg text-xs font-bold text-[#1B2A59]"
                                                    />
                                                </td>
                                                <td className="py-1.5 px-2">
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={lesson.startPage}
                                                        onChange={(e) => handleUpdateModalLesson(lesson.id, 'startPage', e.target.value)}
                                                        className="coptic-cream-input w-full px-2 py-1.5 rounded-lg text-xs font-black text-center text-[#1B2A59] tabular-nums"
                                                    />
                                                </td>
                                                <td className="py-1.5 px-2">
                                                    <input
                                                        type="number"
                                                        min={lesson.startPage || 1}
                                                        value={lesson.endPage}
                                                        onChange={(e) => handleUpdateModalLesson(lesson.id, 'endPage', e.target.value)}
                                                        className="coptic-cream-input w-full px-2 py-1.5 rounded-lg text-xs font-black text-center text-[#1B2A59] tabular-nums"
                                                    />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[#E5D3B3]">
                            <button
                                type="button"
                                disabled={savingBook || isProcessingPdf}
                                onClick={() => setShowUploadModal(false)}
                                className="px-4 py-2.5 rounded-xl bg-[#EFE0C2] text-[#1B2A59] font-bold text-xs sm:text-sm cursor-pointer disabled:opacity-50"
                            >
                                إلغاء
                            </button>
                            <button
                                type="submit"
                                disabled={savingBook || isProcessingPdf}
                                className="px-5 py-2.5 rounded-xl bg-[#1B2A59] hover:bg-[#132045] text-amber-200 border border-[#C8942E]/60 font-black text-xs sm:text-sm shadow-md disabled:opacity-60 cursor-pointer"
                            >
                                {savingBook
                                    ? `جاري الرفع على Cloudinary وحفظ الفهرس... (${uploadProgress}%)`
                                    : 'رفع على Cloudinary وحفظ الجدول (حفظ واعتماد الكتاب والدروس)'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </section>
    );
}
