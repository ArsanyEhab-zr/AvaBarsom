import React, { useState, useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useSmartNavigation } from '../hooks/useSmartNavigation';
import {
    ArrowRight, Download, BookOpen, ExternalLink,
    ChevronRight, ChevronLeft, RotateCcw, Sparkles, FileText
} from 'lucide-react';
import { TENANT_CONFIG } from '../utils/tenantConfig';
import { toEmbeddablePdfUrl } from '../utils/curriculumEngine';

export default function PdfViewer() {
    const { goBack } = useSmartNavigation();
    const location = useLocation();
    const [searchParams] = useSearchParams();

    const stateData = location.state || {};
    const pdfUrl = stateData.pdfUrl || searchParams.get('pdfUrl') || searchParams.get('url') || '';
    const title = stateData.title || searchParams.get('title') || '';
    const lessonTitle = stateData.lessonTitle || searchParams.get('lessonTitle') || '';

    const rawStartPage = stateData.startPage ?? searchParams.get('startPage') ?? searchParams.get('page');
    const rawEndPage = stateData.endPage ?? searchParams.get('endPage');

    const parsedStartPage = Math.max(0, parseInt(rawStartPage, 10) || 0);
    const parsedEndPage = Math.max(parsedStartPage, parseInt(rawEndPage, 10) || parsedStartPage);
    const hasLessonPageJump = parsedStartPage > 0 || Boolean(lessonTitle);
    const effectiveStartPage = parsedStartPage > 0 ? parsedStartPage : 1;
    const effectiveEndPage = parsedEndPage > 0 ? parsedEndPage : effectiveStartPage;

    const [activePage, setActivePage] = useState(effectiveStartPage);
    const [resolvedBlobUrl, setResolvedBlobUrl] = useState('');

    useEffect(() => {
        setActivePage(effectiveStartPage);
    }, [effectiveStartPage, pdfUrl]);

    useEffect(() => {
        if (!pdfUrl || !String(pdfUrl).startsWith('data:application/pdf')) {
            setResolvedBlobUrl('');
            return undefined;
        }
        let objectUrl = '';
        try {
            const parts = String(pdfUrl).split(',');
            const bstr = atob(parts[1] || '');
            const u8arr = new Uint8Array(bstr.length);
            for (let i = 0; i < bstr.length; i += 1) {
                u8arr[i] = bstr.charCodeAt(i);
            }
            const blob = new Blob([u8arr], { type: 'application/pdf' });
            objectUrl = URL.createObjectURL(blob);
            setResolvedBlobUrl(objectUrl);
        } catch {
            setResolvedBlobUrl('');
        }
        return () => {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [pdfUrl]);

    if (!pdfUrl) {
        return (
            <div className="min-h-screen bg-[#FAF3E3] flex flex-col items-center justify-center p-6 text-center" dir="rtl">
                <div className="coptic-card p-8 rounded-3xl max-w-md w-full space-y-4">
                    <BookOpen size={44} className="mx-auto text-[#C8942E]" />
                    <h2 className="text-2xl font-bold text-[#1B2A59]">لا يوجد ملف مرفق للعرض</h2>
                    <button
                        type="button"
                        onClick={() => goBack('/curriculum')}
                        className="w-full min-h-[46px] bg-[#1B2A59] text-amber-200 rounded-2xl font-bold cursor-pointer"
                    >
                        العودة للصفحة السابقة
                    </button>
                </div>
            </div>
        );
    }

    const isDataUri = String(pdfUrl).startsWith('data:');
    const isImageData = String(pdfUrl).startsWith('data:image/') || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(pdfUrl);
    const isPdfData = String(pdfUrl).startsWith('data:application/pdf');
    const isDriveUrl = /drive\.google\.com/i.test(pdfUrl);

    const cleanBasePdfUrl = (isPdfData && resolvedBlobUrl)
        ? resolvedBlobUrl
        : String(toEmbeddablePdfUrl(pdfUrl)).split('#')[0];

    const pageHashFragment = `#page=${activePage}&view=FitH`;

    const viewerSrc = (() => {
        if (isPdfData) {
            return `${cleanBasePdfUrl}${pageHashFragment}`;
        }
        if (hasLessonPageJump && !isDriveUrl) {
            return `${cleanBasePdfUrl}${pageHashFragment}`;
        }
        if (!isDriveUrl && /\.pdf(\?|$)/i.test(cleanBasePdfUrl)) {
            return `${cleanBasePdfUrl}${pageHashFragment}`;
        }
        return `https://docs.google.com/viewer?url=${encodeURIComponent(pdfUrl)}&embedded=true${parsedStartPage > 0 ? `#page=${activePage}&view=FitH` : ''}`;
    })();

    const directOpenHref = isDataUri
        ? pdfUrl
        : `${String(pdfUrl).split('#')[0]}${hasLessonPageJump ? pageHashFragment : ''}`;

    return (
        <div className="min-h-screen bg-slate-900 flex flex-col" dir="rtl">
            <header className="bg-linear-to-l from-[#132046] via-[#1B2A59] to-[#111C3D] text-white p-4 sticky top-0 z-50 shadow-lg border-b-2 border-amber-500/70 flex justify-between items-center gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <button
                        type="button"
                        onClick={() => goBack('/curriculum')}
                        className="w-11 h-11 bg-white/15 hover:bg-white/25 rounded-2xl flex items-center justify-center transition-all cursor-pointer shrink-0"
                        aria-label="رجوع"
                    >
                        <ArrowRight size={20} />
                    </button>
                    <div className="min-w-0">
                        <h1 className="font-calligraphic text-xl sm:text-2xl font-bold text-amber-300 truncate">
                            {lessonTitle || title || 'قارئ مناهج الخدمة'}
                        </h1>
                        <p className="text-xs font-semibold text-indigo-100/80 truncate">
                            {title && lessonTitle && title !== lessonTitle ? `${title} • ${TENANT_CONFIG.churchName}` : TENANT_CONFIG.churchName}
                        </p>
                    </div>
                </div>
            </header>

            {hasLessonPageJump && (
                <section
                    className="bg-linear-to-r from-[#162447] via-[#1B2A59] to-[#6E4D16] text-[#F7E8CC] border-b border-[#C8942E]/60 px-4 py-3 shadow-md"
                    aria-label="شريط صفحات الدرس"
                >
                    <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-1.5 text-amber-300 font-black text-xs sm:text-sm">
                                <Sparkles size={15} className="shrink-0" />
                                <span className="truncate">درس الجمعة: {lessonTitle || title || 'الدرس المحدد'}</span>
                            </div>
                            <p className="text-[11px] sm:text-xs font-bold text-[#F3E2BE] flex items-center gap-1.5">
                                <FileText size={13} className="text-amber-300 shrink-0" />
                                <span>نطاق الدرس: من صفحة {effectiveStartPage} إلى صفحة {effectiveEndPage}</span>
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            <button
                                type="button"
                                onClick={() => setActivePage((p) => Math.max(1, p - 1))}
                                disabled={activePage <= 1}
                                className="inline-flex items-center gap-1 bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white text-xs font-black px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
                            >
                                <ChevronRight size={14} />
                                <span>السابق</span>
                            </button>

                            <span className="inline-flex items-center justify-center bg-[#C8942E] text-[#111B3A] font-black text-xs px-3.5 py-1.5 rounded-xl shadow-xs tabular-nums">
                                صفحة {activePage}
                            </span>

                            <button
                                type="button"
                                onClick={() => setActivePage((p) => p + 1)}
                                className="inline-flex items-center gap-1 bg-white/10 hover:bg-white/20 text-white text-xs font-black px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
                            >
                                <span>التالي</span>
                                <ChevronLeft size={14} />
                            </button>

                            <button
                                type="button"
                                onClick={() => setActivePage(effectiveStartPage)}
                                className="inline-flex items-center gap-1 bg-amber-300/20 hover:bg-amber-300/30 border border-amber-300/50 text-amber-200 text-xs font-black px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
                            >
                                <RotateCcw size={13} />
                                <span>بداية الدرس (ص {effectiveStartPage})</span>
                            </button>
                        </div>
                    </div>
                </section>
            )}

            <main className="flex-1 flex flex-col items-center p-4 md:p-8 overflow-y-auto">
                <div className="coptic-card bg-[#FFFDF7] rounded-3xl shadow-2xl overflow-hidden w-full max-w-4xl p-3 md:p-5">
                    {isImageData ? (
                        <img
                            src={pdfUrl}
                            alt={title || 'مرفق المنهج'}
                            className="w-full max-h-[78vh] object-contain mx-auto rounded-2xl"
                        />
                    ) : (
                        <iframe
                            key={`${viewerSrc}_${activePage}`}
                            src={viewerSrc}
                            className="w-full h-[78vh] border-none rounded-2xl bg-white"
                            allowFullScreen
                            title={lessonTitle || title || 'PDF Viewer'}
                        />
                    )}
                </div>

                <div className="mt-6 flex flex-wrap justify-center gap-3">
                    <a
                        href={directOpenHref}
                        download={isDataUri ? `${(title || 'curriculum').replace(/\s+/g, '_')}.pdf` : undefined}
                        target={isDataUri ? undefined : '_blank'}
                        rel="noreferrer"
                        className="min-h-[48px] flex items-center gap-2 bg-linear-to-r from-[#1B2A59] to-[#253875] hover:opacity-95 text-amber-200 border border-amber-400/50 px-6 py-3 rounded-2xl font-bold transition-all shadow-lg"
                    >
                        {isDataUri ? <Download size={18} /> : <ExternalLink size={18} />}
                        <span>{isDataUri ? 'تحميل الملف على الجهاز' : 'فتح أو تحميل الملف مباشرة'}</span>
                    </a>
                </div>
            </main>
        </div>
    );
}
