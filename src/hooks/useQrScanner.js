import { getCanonicalActiveChildren } from '../utils/churchDataEngine';
import { scopedSyncKeys } from '../db/childSync';
/* eslint-disable no-unused-vars */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { db } from '../db/database';
import { TENANT_CONFIG } from '../utils/tenantConfig';

// Web Audio API — Zero-dependency sound FX
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
        // Audio not supported — fail silently
    }
}

function playSuccessChime() {
    try {
        const ctx = getAudioCtx();
        const now = ctx.currentTime;
        // Two-tone ascending chime
        [880, 1320].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.connect(g);
            g.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.08);
            g.gain.setValueAtTime(0.25, now + i * 0.08);
            g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.12);
            osc.start(now + i * 0.08);
            osc.stop(now + i * 0.08 + 0.12);
        });
    } catch (_e) { /* ignore */ }
}

// QR Code Prefix Validation
const QR_PREFIX = 'KHD:';

function parseQrCode(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const trimmed = rawText.trim();
    if (trimmed.startsWith(QR_PREFIX)) {
        const id = trimmed.substring(QR_PREFIX.length).trim();
        if (id) {
            return { childId: String(id), raw: trimmed };
        }
    }
    if (/^BRS-[A-Z0-9]+-[A-Z0-9]+$/i.test(trimmed)) {
        return { childId: trimmed.toUpperCase(), raw: `${QR_PREFIX}${trimmed.toUpperCase()}` };
    }
    return null;
}

// useQrScanner Hook
export default function useQrScanner() {
    const scannerRef = useRef(null);
    const scannedIdsRef = useRef(new Set());
    const cooldownRef = useRef(new Map()); // childId → timestamp for 500ms cooldown
    const containerIdRef = useRef('qr-reader-container');

    const [isActive, setIsActive] = useState(false);
    const [scannedList, setScannedList] = useState([]); // [{ childId, raw, name, gender, timestamp }]
    const [flashColor, setFlashColor] = useState(null); // 'green' | 'amber' | 'red' | null
    const [toastMessage, setToastMessage] = useState(null);
    const [cameraError, setCameraError] = useState(null);
    const [isMuted, setIsMuted] = useState(false);
    const [isStarting, setIsStarting] = useState(false);

    // ─── Toast helper ───
    const showToast = useCallback((message, type = 'success') => {
        setToastMessage({ message, type });
        setTimeout(() => setToastMessage(null), 2200);
    }, []);

    // ─── Flash overlay helper ───
    const triggerFlash = useCallback((color) => {
        setFlashColor(color);
        setTimeout(() => setFlashColor(null), 300);
    }, []);

    // ─── Resolve child name from Dexie ───
    const resolveChildName = useCallback(async (childId) => {
        try {
            const child = getCanonicalActiveChildren(await db.children.toArray(), scopedSyncKeys()).childMapById.get(String(childId));
            if (child && !child.isDeleted) {
                return { name: child.name || 'بدون اسم', gender: child.gender || '' };
            }
            return null;
        } catch (_e) {
            return null;
        }
    }, []);

    // ─── Handle successful QR decode ───
    const handleScanSuccess = useCallback(async (decodedText) => {
        const parsed = parseQrCode(decodedText);

        if (!parsed) {
            // Not a valid QR code
            triggerFlash('red');
            showToast('كود QR غير صالح — ' + TENANT_CONFIG.QR_INVALID_MESSAGE, 'error');
            if (!isMuted) playBeep(300, 150, 0.2);
            return;
        }

        const { childId } = parsed;
        const now = Date.now();

        // Cooldown check — prevent rapid re-fire of the same card within 500ms
        const lastScan = cooldownRef.current.get(childId);
        if (lastScan && now - lastScan < 500) return;
        cooldownRef.current.set(childId, now);

        // Duplicate check
        if (scannedIdsRef.current.has(childId)) {
            triggerFlash('amber');
            showToast('تم مسح هذا المخدوم بالفعل', 'warning');
            if (!isMuted) playBeep(400, 120, 0.2);
            return;
        }

        // New successful scan — resolve name from Dexie
        const resolved = await resolveChildName(childId);
        if (!resolved) { showToast('المخدوم محذوف أو خارج النطاق أو لم تكتمل المزامنة', 'error'); return; }
        const { name, gender } = resolved;
        scannedIdsRef.current.add(childId);
        setScannedList(prev => [{ childId, raw: parsed.raw, name, gender, timestamp: now }, ...prev]);
        triggerFlash('green');
        showToast(name, 'success');
        if (!isMuted) playSuccessChime();
    }, [isMuted, triggerFlash, showToast, resolveChildName]);

    // Manual 1-tap check-in fallback when camera is unavailable
    const markChildManually = useCallback((child) => {
        if (!child) return;
        const idStr = String(child.id);
        if (scannedIdsRef.current.has(idStr)) {
            triggerFlash('amber');
            showToast('تم تسجيل هذا المخدوم مسبقاً في الجلسة', 'warning');
            return;
        }
        scannedIdsRef.current.add(idStr);
        setScannedList(prev => [{
            childId: idStr,
            raw: `KHD:${idStr}`,
            name: child.name || 'بدون اسم',
            gender: child.gender || '',
            timestamp: Date.now()
        }, ...prev]);
        triggerFlash('green');
        showToast(child.name || 'تم التسجيل', 'success');
        if (!isMuted) playSuccessChime();
    }, [isMuted, triggerFlash, showToast]);

    // Start camera
    const startCamera = useCallback(async () => {
        setCameraError(null);
        setIsStarting(true);

        try {
            // Resume AudioContext (required after user gesture on mobile)
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
                (_errorMessage) => {
                    // Scan error (not a QR in frame) — expected, don't surface
                }
            );

            setIsActive(true);
        } catch (err) {
            console.error('Camera start error:', err);
            let errorMsg = 'تعذر تشغيل الكاميرا على هذا الجهاز.';

            if (err.name === 'NotAllowedError' || err.message?.includes('Permission')) {
                errorMsg = 'تم رفض إذن الكاميرا. من فضلك اسمح بالوصول للكاميرا من إعدادات المتصفح أو استخدم التسجيل اليدوي السريع بالأسفل.';
            } else if (err.name === 'NotFoundError' || err.message?.includes('Requested device not found')) {
                errorMsg = 'لا توجد كاميرا متاحة على هذا الجهاز. يمكنك استخدام البحث والتسجيل اليدوي السريع بالأسفل.';
            } else if (err.name === 'NotReadableError' || err.message?.includes('Could not start')) {
                errorMsg = 'الكاميرا مستخدمة من تطبيق آخر حالياً. أغلق التطبيقات الأخرى أو استخدم التسجيل السريع بالأسفل.';
            }

            setCameraError(errorMsg);
        } finally {
            setIsStarting(false);
        }
    }, [handleScanSuccess]);

    // ─── Stop camera ───
    const stopCamera = useCallback(async () => {
        if (scannerRef.current) {
            try {
                await scannerRef.current.stop();
            } catch (_e) { /* already stopped */ }
            scannerRef.current = null;
        }
        setIsActive(false);
    }, []);

    // ─── Remove item from scanned list ───
    const removeItem = useCallback((childId) => {
        scannedIdsRef.current.delete(childId);
        cooldownRef.current.delete(childId);
        setScannedList(prev => prev.filter(item => item.childId !== childId));
    }, []);

    // ─── Clear all scanned ───
    const clearAll = useCallback(() => {
        scannedIdsRef.current.clear();
        cooldownRef.current.clear();
        setScannedList([]);
    }, []);

    // ─── Cleanup on unmount ───
    useEffect(() => {
        return () => {
            if (scannerRef.current) {
                scannerRef.current.stop().catch(() => {});
                scannerRef.current = null;
            }
        };
    }, []);

    // ─── Pause camera when app is backgrounded ───
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

    return {
        // State
        isActive,
        isStarting,
        scannedList,
        flashColor,
        toastMessage,
        cameraError,
        isMuted,
        containerId: containerIdRef.current,
        scannedCount: scannedList.length,

        // Actions
        startCamera,
        stopCamera,
        markChildManually,
        removeItem,
        clearAll,
        setIsMuted,
        setCameraError,
    };
}
