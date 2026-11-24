import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartNavigation } from '../hooks/useSmartNavigation';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff, Trash2, ArrowRight, Volume2, VolumeX, RotateCcw, ScanLine, CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react';
import { TENANT_CONFIG } from '../utils/tenantConfig';

const AudioCtxRef = { ctx: null };

function getAudioCtx() {
    if (!AudioCtxRef.ctx) {
        AudioCtxRef.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return AudioCtxRef.ctx;
}

function playBeep(frequency = 1200, durationMs = 80, volume = 0.3) {
    try {
        const ctx = getAudioCtx();
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + durationMs / 1000);
    } catch (_e) {
        // Audio not supported
    }
}

const QR_PREFIX = 'KHD:';

function parseQrCode(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const trimmed = rawText.trim();
    if (trimmed.startsWith(QR_PREFIX)) {
        const id = trimmed.substring(QR_PREFIX.length);
        if (id) {
            return { childId: String(id), raw: trimmed };
        }
    }
    return null;
}

export default function QrScannerPoC() {
    const { goBack } = useSmartNavigation();
    const navigate = useNavigate();
    const scannerRef = useRef(null);
    const scannedIdsRef = useRef(new Set());
    const cooldownRef = useRef(new Map());
    const containerIdRef = useRef('qr-reader-container-poc');

    const [isActive, setIsActive] = useState(false);
    const [scannedList, setScannedList] = useState([]);
    const [flashColor, setFlashColor] = useState(null);
    const [toastMessage, setToastMessage] = useState(null);
    const [cameraError, setCameraError] = useState(null);
    const [isMuted, setIsMuted] = useState(false);
    const [isStarting, setIsStarting] = useState(false);

    const showToast = useCallback((message, type = 'success') => {
        setToastMessage({ message, type });
        setTimeout(() => setToastMessage(null), 2000);
    }, []);

    const triggerFlash = useCallback((color) => {
        setFlashColor(color);
        setTimeout(() => setFlashColor(null), 300);
    }, []);

    const handleScanSuccess = useCallback((decodedText) => {
        const parsed = parseQrCode(decodedText);

        if (!parsed) {
            triggerFlash('red');
            showToast('كود QR غير صالح — ' + TENANT_CONFIG.QR_INVALID_MESSAGE, 'error');
            if (!isMuted) playBeep(300, 150, 0.2);
            return;
        }

        const { childId } = parsed;
        const now = Date.now();

        const lastScan = cooldownRef.current.get(childId);
        if (lastScan && now - lastScan < 500) return;
        cooldownRef.current.set(childId, now);

        if (scannedIdsRef.current.has(childId)) {
            triggerFlash('amber');
            showToast(`تم مسح المعرف ${childId} بالفعل`, 'warning');
            if (!isMuted) playBeep(400, 120, 0.2);
            return;
        }

        scannedIdsRef.current.add(childId);
        setScannedList(prev => [{ childId, raw: parsed.raw, timestamp: now }, ...prev]);
        triggerFlash('green');
        showToast(`تم مسح المعرف: ${childId}`, 'success');
        if (!isMuted) playBeep(1200, 80, 0.3);
    }, [isMuted, triggerFlash, showToast]);

    const startCamera = useCallback(async () => {
        setCameraError(null);
        setIsStarting(true);

        try {
            try { getAudioCtx().resume(); } catch (_e) { /* ignore */ }

            if (scannerRef.current) {
                try { await scannerRef.current.stop(); } catch (_e) { /* already stopped */ }
            }

            const html5QrCode = new Html5Qrcode(containerIdRef.current);
            scannerRef.current = html5QrCode;

            const viewportWidth = Math.min(window.innerWidth - 32, 500);
            const qrboxSize = Math.floor(viewportWidth * 0.65);

            await html5QrCode.start(
                { facingMode: 'environment' },
                {
                    fps: 15,
                    qrbox: { width: qrboxSize, height: qrboxSize },
                    aspectRatio: 1.0,
                    videoConstraints: {
                        facingMode: 'environment',
                        advanced: [{ focusMode: 'continuous' }]
                    }
                },
                (decodedText) => {
                    handleScanSuccess(decodedText);
                },
                () => {}
            );

            setIsActive(true);
        } catch (err) {
            console.error('Camera start error:', err);
            let errorMsg = 'تعذر تشغيل الكاميرا على هذا الجهاز.';
            if (err.name === 'NotAllowedError' || err.message?.includes('Permission')) {
                errorMsg = 'تم رفض إذن الكاميرا. اسمح بالوصول للكاميرا من إعدادات المتصفح.';
            } else if (err.name === 'NotFoundError' || err.message?.includes('Requested device not found')) {
                errorMsg = 'لا توجد كاميرا متاحة على هذا الجهاز.';
            } else if (err.name === 'NotReadableError' || err.message?.includes('Could not start')) {
                errorMsg = 'الكاميرا مستخدمة من تطبيق آخر حالياً.';
            }
            setCameraError(errorMsg);
        } finally {
            setIsStarting(false);
        }
    }, [handleScanSuccess]);

    const stopCamera = useCallback(async () => {
        if (scannerRef.current) {
            try {
                await scannerRef.current.stop();
            } catch (_e) { /* already stopped */ }
            scannerRef.current = null;
        }
        setIsActive(false);
    }, []);

    const removeItem = useCallback((childId) => {
        scannedIdsRef.current.delete(childId);
        cooldownRef.current.delete(childId);
        setScannedList(prev => prev.filter(item => item.childId !== childId));
    }, []);

    const clearAll = useCallback(() => {
        scannedIdsRef.current.clear();
        cooldownRef.current.clear();
        setScannedList([]);
    }, []);

    useEffect(() => {
        return () => {
            if (scannerRef.current) {
                scannerRef.current.stop().catch(() => {});
                scannerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.hidden && scannerRef.current) {
                scannerRef.current.stop().catch(() => {});
                scannerRef.current = null;
                setIsActive(false);
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    return (
        <div className="min-h-screen coptic-cream-surface text-[#231B12]" dir="rtl">

            <header
                className="sticky top-0 z-40 text-white px-4 py-3.5 shadow-lg border-b border-amber-400/25 rounded-b-3xl"
                style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 72%, #8C621E 100%)' }}
            >
                <div className="max-w-lg mx-auto flex items-center justify-between">
                    <button
                        type="button"
                        onClick={() => { stopCamera(); goBack('/'); }}
                        className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors cursor-pointer"
                        aria-label="رجوع"
                    >
                        <ArrowRight size={20} />
                    </button>
                    <h1 className="font-calligraphic text-lg font-bold text-amber-100 flex items-center gap-2">
                        <ScanLine size={20} className="text-amber-300" />
                        فحص قارئ الكارنيهات (QR)
                    </h1>
                    <button
                        type="button"
                        onClick={() => setIsMuted(m => !m)}
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${isMuted ? 'bg-rose-500/80 text-white' : 'bg-white/15 text-amber-200 hover:bg-white/25'}`}
                        aria-label={isMuted ? 'تشغيل الصوت' : 'كتم الصوت'}
                    >
                        {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                    </button>
                </div>
            </header>

            <main className="max-w-lg mx-auto px-4 pb-28">
                <section className="mt-6 relative">
                    <div className="relative rounded-3xl overflow-hidden coptic-card border-2 border-[#DFC48F] shadow-xl">
                        <div
                            id={containerIdRef.current}
                            className="w-full"
                            style={{ minHeight: isActive ? '320px' : '0px', transition: 'min-height 0.3s' }}
                        />

                        {flashColor && (
                            <div
                                className={`absolute inset-0 z-20 pointer-events-none transition-opacity duration-300 rounded-3xl ${
                                    flashColor === 'green' ? 'bg-emerald-500/25' :
                                    flashColor === 'amber' ? 'bg-amber-500/25' :
                                    'bg-rose-500/25'
                                }`}
                            />
                        )}

                        {!isActive && !cameraError && (
                            <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
                                <div className="w-20 h-20 rounded-full bg-[#FAF3E3] border-2 border-[#DFC48F] flex items-center justify-center mb-5">
                                    <Camera size={36} className="text-[#1B2A59]" />
                                </div>
                                <h2 className="text-xl font-black text-[#1B2A59] mb-2">جاهز للمسح التجريبي</h2>
                                <p className="text-sm text-[#6E5329] font-bold leading-relaxed mb-6">
                                    اضغط لتشغيل الكاميرا واختبار قراءة بطاقات QR
                                </p>
                                <button
                                    type="button"
                                    onClick={startCamera}
                                    disabled={isStarting}
                                    className="bg-[#1B2A59] hover:bg-[#142047] text-amber-100 px-8 py-4 rounded-2xl font-black text-sm shadow-lg transition-all flex items-center gap-3 disabled:opacity-50 cursor-pointer"
                                >
                                    {isStarting ? (
                                        <>
                                            <div className="w-5 h-5 border-2 border-amber-200 border-t-transparent rounded-full animate-spin" />
                                            جاري فتح الكاميرا...
                                        </>
                                    ) : (
                                        <>
                                            <Camera size={20} className="text-amber-300" />
                                            تشغيل الكاميرا
                                        </>
                                    )}
                                </button>
                            </div>
                        )}

                        {cameraError && (
                            <div className="flex flex-col items-center justify-center py-12 px-6 text-center bg-rose-50/70">
                                <div className="w-16 h-16 rounded-full bg-rose-100 border border-rose-200 flex items-center justify-center mb-4">
                                    <XCircle size={32} className="text-rose-600" />
                                </div>
                                <p className="text-sm font-bold text-rose-800 leading-relaxed mb-5">{cameraError}</p>
                                <button
                                    type="button"
                                    onClick={() => { setCameraError(null); startCamera(); }}
                                    className="bg-rose-600 text-white px-6 py-3 rounded-xl font-black text-sm hover:bg-rose-700 transition-all flex items-center gap-2 cursor-pointer"
                                >
                                    <RotateCcw size={16} /> إعادة المحاولة
                                </button>
                            </div>
                        )}
                    </div>

                    {isActive && (
                        <div className="mt-4 flex gap-3">
                            <button
                                type="button"
                                onClick={stopCamera}
                                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white py-3.5 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-colors shadow-lg cursor-pointer"
                            >
                                <CameraOff size={18} />
                                إيقاف الكاميرا
                            </button>
                        </div>
                    )}
                </section>

                {toastMessage && (
                    <div
                        className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl font-black text-sm shadow-2xl border max-w-[90vw] ${
                            toastMessage.type === 'success' ? 'bg-emerald-700 text-white border-emerald-400' :
                            toastMessage.type === 'warning' ? 'bg-amber-600 text-white border-amber-300' :
                            'bg-rose-700 text-white border-rose-400'
                        }`}
                    >
                        {toastMessage.message}
                    </div>
                )}

                <div className="mt-6 flex items-center justify-between px-1">
                    <h3 className="text-base font-black text-[#1B2A59] flex items-center gap-2">
                        <CheckCircle2 size={20} className="text-emerald-700" />
                        البطاقات المقروءة
                        <span className="bg-[#1B2A59] text-amber-100 px-3 py-0.5 rounded-full text-xs font-black min-w-[28px] text-center">
                            {scannedList.length}
                        </span>
                    </h3>
                    {scannedList.length > 0 && (
                        <button
                            type="button"
                            onClick={clearAll}
                            className="text-rose-700 text-xs font-black flex items-center gap-1 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl hover:bg-rose-100 transition-colors cursor-pointer"
                        >
                            <Trash2 size={14} /> تفريغ الكل
                        </button>
                    )}
                </div>

                <div className="mt-4 space-y-2">
                    {scannedList.length === 0 ? (
                        <div className="text-center py-12 coptic-card border border-dashed border-[#DFC48F] rounded-3xl text-[#6E5329]">
                            <ScanLine size={40} className="mx-auto mb-3 opacity-35 text-[#C8942E]" />
                            <p className="font-bold text-sm">لا توجد بطاقات ممسوحة بعد</p>
                            <p className="text-xs mt-1">قم بتشغيل الكاميرا وتوجيهها نحو بطاقة QR</p>
                        </div>
                    ) : (
                        scannedList.map((item) => (
                            <div
                                key={item.childId}
                                className="coptic-card border border-[#DFC48F] rounded-2xl px-4 py-3 flex items-center justify-between"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-[#FAF3E3] border border-[#DFC48F] flex items-center justify-center text-[#1B2A59] font-black text-sm">
                                        {item.childId}
                                    </div>
                                    <div>
                                        <p className="text-sm font-black text-[#1B2A59]">المعرف: {item.childId}</p>
                                        <p className="text-[10px] text-[#8C621E] font-bold mt-0.5 font-mono" dir="ltr">{item.raw}</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => removeItem(item.childId)}
                                    className="w-8 h-8 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition-colors cursor-pointer"
                                    aria-label={`حذف ${item.childId}`}
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))
                    )}
                </div>

                <div className="mt-8 bg-amber-50 border border-amber-300 rounded-2xl p-4 flex gap-3">
                    <AlertTriangle size={20} className="text-[#8C621E] shrink-0 mt-0.5" />
                    <div>
                        <p className="text-xs font-black text-[#1B2A59] mb-1">شاشة اختبار قراءة الباركود</p>
                        <p className="text-[11px] text-[#6E5329] font-bold leading-relaxed">
                            هذه الصفحة مخصصة لاختبار كاميرا قراءة الكارنيهات دون تعديل سجلات الحضور الفعلية.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}
