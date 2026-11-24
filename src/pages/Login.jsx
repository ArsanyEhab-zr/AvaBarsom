/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck, Phone, Key, Loader2, Church, Lock, Download, Users } from 'lucide-react';

// استدعاء مكتبات الفايربيز
import { doc, getDoc } from 'firebase/firestore';
import { firestore, isFirebaseConfigured } from '../db/firebase';

// استدعاء قاعدة البيانات المحلية عشان ننظفها قبل الدخول
import { db } from '../db/database';
import { Capacitor } from '@capacitor/core';
import {
    TENANT_CONFIG,
    getLogoUrl,
    getAppEdition,
    getEditionConfig,
    getActiveLogoUrl,
    readScopedStorage,
    writeScopedStorage,
    removeScopedStorage
} from '../utils/tenantConfig';
import {
    resolveUserAccessScope,
    resolveServantNotificationScope,
    extractAllOsrasFromSettings
} from '../utils/notificationScopeEngine';
import {
    sanitizeChurchServices,
    sanitizeAuthorizedServants
} from '../utils/churchStructureSanitizer';
import { formatServantDisplayPhone, normalizeEgyptWhatsAppPhone } from '../utils/whatsappHelper';
import Footer from '../components/Footer';

export default function Login() {
    const navigate = useNavigate();
    const [phone, setPhone] = useState("");
    const [syncKey, setSyncKey] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    const [activeEdition, setActiveEdition] = useState(() => getAppEdition());
    const [appSettings, setAppSettings] = useState({ khedmaName: TENANT_CONFIG.churchName, khedmaLogo: getActiveLogoUrl() });
    const [logoError, setLogoError] = useState(false);

    const [deferredPrompt, setDeferredPrompt] = useState(null);

    useEffect(() => {
        const handleEditionSync = () => setActiveEdition(getAppEdition());
        window.addEventListener('edition-changed', handleEditionSync);
        return () => window.removeEventListener('edition-changed', handleEditionSync);
    }, []);

    useEffect(() => {
        const edition = getAppEdition();
        const scope = resolveUserAccessScope();
        if (edition === 'parent' || scope.isParent) {
            navigate(scope.isParent ? '/parent-dashboard' : '/parent-login', { replace: true });
            return;
        }
        if (!scope.isGuest) {
            navigate('/', { replace: true });
            return;
        }

        // جلب إعدادات التطبيق من Scoped Storage للعرض المبدئي
        const savedSettings = readScopedStorage('appSettings');
        if (savedSettings) {
            try {
                const parsed = JSON.parse(savedSettings);
                setAppSettings({
                    khedmaName: parsed.khedmaName || TENANT_CONFIG.churchName,
                    khedmaLogo: getLogoUrl(parsed.khedmaLogo)
                });
            } catch (e) {
                console.error("Error parsing local settings", e);
            }
        }

        // إعدادات التثبيت PWA
        const handleBeforeInstallPrompt = (e) => {
            e.preventDefault();
            setDeferredPrompt(e);
        };
        const handleAppInstalled = () => {
            setDeferredPrompt(null);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, [navigate, activeEdition]);

    const handleInstallClick = async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                setDeferredPrompt(null);
            }
        } else {
            alert("لتثبيت التطبيق على أجهزة آيفون، اضغط على زر المشاركة (Share) ثم اختر 'Add to Home Screen'.");
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        const cleanPhone = phone.trim().toLowerCase();
        const cleanSyncKey = syncKey.trim();
        const currentEdition = getAppEdition();

        if (currentEdition === 'parent') {
            navigate('/parent-login', { replace: true });
            return;
        }

        // الباب السري للـ Super Admin
        if (cleanPhone === 'admin' && cleanSyncKey === 'admin') {
            if (currentEdition === 'servant') {
                setError("هذا التطبيق مخصص لخدام الأسر والفصول فقط. يرجى استخدام تطبيق (أدمن).");
                setIsLoading(false);
                return;
            }
            if (isFirebaseConfigured) {
                try {
                    await db.children.clear();
                    await db.attendance.clear();
                } catch (clearErr) {
                    console.log("Error clearing DB:", clearErr);
                }
            }

            [
                'parentChildId',
                'parentChildName',
                'parentSyncKey',
                'parentClassName',
                'parentSession',
                'impersonated_osra',
                'isSuperAdminImpersonating',
                'masterSyncKey',
                'selectedOsra'
            ].forEach((k) => removeScopedStorage(k));
            writeScopedStorage('userRole', 'super_admin');
            writeScopedStorage('currentSyncKey', 'ADMIN_MODE');
            writeScopedStorage('currentServant', JSON.stringify({ name: 'المسئول العام', role: 'Super Admin' }));
            if (typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new Event('syncKey-changed'));
                window.dispatchEvent(new Event('auth-changed'));
            }
            navigate('/', { replace: true });
            return;
        }

        try {
            // السحب من mainConfig (اللي فيه الخدام المعتمدين)
            const configRef = firestore ? doc(firestore, 'System', 'mainConfig') : null;
            const configSnap = configRef ? await getDoc(configRef) : null;

            let servantsList = [];
            let activeServicesList = [];

            if (configSnap?.exists()) {
                const cloudData = configSnap.data();
                const cleanServices = sanitizeChurchServices(cloudData.services || [], []);
                activeServicesList = cleanServices;
                const rawServants = Array.isArray(cloudData.servants)
                    ? cloudData.servants
                    : (Array.isArray(cloudData.authorizedServants) ? cloudData.authorizedServants : []);
                servantsList = sanitizeAuthorizedServants(rawServants, cleanServices, {
                    fallbackToOfficial: false
                });

                // ندمج الداتا الجديدة المنقحة مع الداتا المحلية
                const localSettings = JSON.parse(readScopedStorage('appSettings') || '{}') || {};
                const mergedSettings = {
                    ...localSettings,
                    services: cleanServices,
                    servants: servantsList,
                    authorizedServants: servantsList
                };
                writeScopedStorage('appSettings', JSON.stringify(mergedSettings));
            } else {
                const localSettings = JSON.parse(readScopedStorage('appSettings') || '{}') || {};
                const cleanServices = sanitizeChurchServices(localSettings.services || [], []);
                activeServicesList = cleanServices;
                const rawLocalServants = Array.isArray(localSettings.servants)
                    ? localSettings.servants
                    : (Array.isArray(localSettings.authorizedServants) ? localSettings.authorizedServants : []);
                servantsList = sanitizeAuthorizedServants(rawLocalServants, cleanServices, {
                    fallbackToOfficial: false
                });
            }

            // Build osraKey -> canonical syncKey map so servants can log in with either their class's unique osraKey (AB-...) or syncKey
            const osraKeyToSyncKey = new Map();
            for (const svc of activeServicesList) {
                for (const osra of (svc?.osras || [])) {
                    const canonicalSk = String(osra?.syncKey || '').trim();
                    const ok1 = String(osra?.osraKey || '').trim().toUpperCase();
                    const ok2 = String(osra?.secretKey || '').trim().toUpperCase();
                    if (canonicalSk && ok1) osraKeyToSyncKey.set(ok1, canonicalSk);
                    if (canonicalSk && ok2) osraKeyToSyncKey.set(ok2, canonicalSk);
                }
            }

            const enteredPhoneDisplay = formatServantDisplayPhone(cleanPhone);
            const enteredPhoneWa = normalizeEgyptWhatsAppPhone(cleanPhone);
            const enteredKeyUpper = cleanSyncKey.toUpperCase();
            const resolvedTargetSyncKey = osraKeyToSyncKey.get(enteredKeyUpper) || cleanSyncKey;

            // 2. التحقق من وجود الخادم في لستة الخدام ومطابقة صلاحياته مع نسخة التطبيق الحالية
            const foundServant = servantsList.find((s) => {
                const sRawPhone = String(s?.phone || '').trim().toLowerCase();
                const sDispPhone = formatServantDisplayPhone(sRawPhone);
                const sWaPhone = normalizeEgyptWhatsAppPhone(sRawPhone);
                const phoneMatches =
                    sRawPhone === cleanPhone ||
                    (enteredPhoneDisplay && sDispPhone === enteredPhoneDisplay) ||
                    (enteredPhoneWa && sWaPhone === enteredPhoneWa);
                if (!phoneMatches) return false;

                const sSync = String(s?.syncKey || '').trim();
                const sOsraKey = String(s?.osraKey || s?.secretKey || '').trim().toUpperCase();
                return (
                    sSync === cleanSyncKey ||
                    sSync === resolvedTargetSyncKey ||
                    (sOsraKey && sOsraKey === enteredKeyUpper)
                );
            });

            if (foundServant) {
                const currentSettings = JSON.parse(readScopedStorage('appSettings') || '{}');
                const allOsras = extractAllOsrasFromSettings(currentSettings, [], { includeFallback: false });
                const previewScope = resolveServantNotificationScope(foundServant, allOsras, foundServant.syncKey);
                const candidateTier =
                    previewScope.tier === 'master_detailed'
                        ? 'super_admin'
                        : previewScope.tier === 'stage_leader_detailed'
                            ? 'stage_leader'
                            : 'class_servant';

                if (currentEdition === 'admin' && candidateTier === 'class_servant') {
                    setError("هذا التطبيق مخصص للأدمن وأمناء الخدمة والمراحل فقط. يرجى استخدام تطبيق (خادم/ة).");
                    setIsLoading(false);
                    return;
                }
                if (currentEdition === 'servant' && (candidateTier === 'super_admin' || candidateTier === 'stage_leader')) {
                    setError("هذا التطبيق مخصص لخدام الأسر والفصول فقط. يرجى استخدام تطبيق (أدمن).");
                    setIsLoading(false);
                    return;
                }

                if (isFirebaseConfigured) {
                    try {
                        await db.children.clear();
                        await db.attendance.clear();
                    } catch (clearErr) {
                        console.log("Error clearing DB:", clearErr);
                    }
                }

                // الخادم موجود!
                [
                    'parentChildId',
                    'parentChildName',
                    'parentSyncKey',
                    'parentClassName',
                    'parentSession',
                    'impersonated_osra',
                    'isSuperAdminImpersonating',
                    'masterSyncKey',
                    'selectedOsra'
                ].forEach((k) => removeScopedStorage(k));
                writeScopedStorage('currentSyncKey', foundServant.syncKey);
                writeScopedStorage('currentServant', JSON.stringify(foundServant));
                if (foundServant.assignedOsra) {
                    writeScopedStorage('assignedOsra', foundServant.assignedOsra);
                } else {
                    removeScopedStorage('assignedOsra');
                }
                const resolvedLoginScope = resolveUserAccessScope(
                    JSON.parse(readScopedStorage('appSettings') || '{}')
                );
                if (resolvedLoginScope.roleTier) {
                    writeScopedStorage('userRole', resolvedLoginScope.roleTier);
                }
                if (typeof window.dispatchEvent === 'function') {
                    window.dispatchEvent(new Event('syncKey-changed'));
                    window.dispatchEvent(new Event('auth-changed'));
                }

                // توجيه الخادم للرئيسية فوراً بدون تراكم في الـ History
                navigate('/', { replace: true });
            } else {
                setError("بيانات الدخول غير صحيحة. يرجى التأكد من رقم الهاتف ومفتاح الأسرة السري.");
                setIsLoading(false);
            }
        } catch (err) {
            console.error("Login error:", err);
            setError("حدث خطأ في الاتصال بالسيرفر، تأكد من وجود إنترنت.");
            setIsLoading(false);
        }
    };

    const editionCfg = getEditionConfig(activeEdition);
    const headerLogoSrc = activeEdition === 'all' ? (appSettings.khedmaLogo || getActiveLogoUrl('all')) : getActiveLogoUrl(activeEdition);
    const mainGradient =
        activeEdition === 'servant'
            ? 'from-[#092920] via-[#0F4C3A] to-[#0B3529]'
            : 'from-[#0F1B3D] via-[#1B2A59] to-[#121D40]';

    return (
        <main className={`min-h-screen bg-linear-to-br ${mainGradient} flex flex-col items-center justify-center p-4 font-sans relative overflow-hidden`} dir="rtl">
            <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-amber-500/15 rounded-full blur-[100px] animate-pulse"></div>
            <div className="absolute bottom-[-10%] left-[-10%] w-96 h-96 bg-sky-400/10 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '2s' }}></div>

            <div className="w-full max-w-lg relative z-10 my-4">
                <div className="bg-white/10 backdrop-blur-xl border border-amber-300/25 p-6 sm:p-8 rounded-[2.5rem] shadow-2xl">
                    <div className="flex flex-col items-center text-center mb-7">
                        <div className="w-28 h-28 rounded-full bg-white/95 border-3 border-amber-400 flex items-center justify-center p-1 mb-4 shadow-xl overflow-hidden">
                            {headerLogoSrc && !logoError ? (
                                <img
                                    src={headerLogoSrc}
                                    width="112"
                                    height="112"
                                    loading="eager"
                                    alt={`شعار ${TENANT_CONFIG.churchName}`}
                                    onError={() => setLogoError(true)}
                                    className="w-full h-full object-contain rounded-full"
                                />
                            ) : (
                                <Church className="text-[#1B2A59] w-12 h-12" />
                            )}
                        </div>
                        <span className="text-xs font-bold text-amber-300 bg-amber-500/15 border border-amber-400/30 px-3.5 py-1 rounded-full mb-2">
                            {TENANT_CONFIG.dioceseName || 'مطرانية المنيا للأقباط الأرثوذكس'}
                        </span>
                        <h1 className="font-calligraphic text-2xl sm:text-3xl font-bold text-white leading-snug">
                            {appSettings.khedmaName}
                        </h1>
                        <p className="text-sm font-bold text-indigo-100/90 mt-1">
                            {TENANT_CONFIG.serviceTitle}
                        </p>
                        {activeEdition !== 'all' && (
                            <div
                                data-testid="edition-subtitle-badge"
                                className={`mt-2.5 inline-flex items-center px-3.5 py-1 rounded-full border text-[11px] font-black shadow-sm ${editionCfg.badgeClass}`}
                            >
                                {editionCfg.subtitle}
                            </div>
                        )}
                    </div>

                    <form onSubmit={handleLogin} className="space-y-5">
                        {error && (
                            <div className="bg-red-500/20 border border-red-500/50 text-red-200 px-4 py-3 rounded-2xl text-xs font-bold text-center animate-in fade-in">
                                {error}
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-indigo-100 ml-1">رقم هاتف الخادم</label>
                            <div className="relative">
                                <Phone className="absolute right-4 top-1/2 -translate-y-1/2 text-indigo-300" size={18} />
                                <input
                                    type="text"
                                    required
                                    aria-label="رقم هاتف الخادم"
                                    value={phone}
                                    onChange={e => setPhone(e.target.value)}
                                    placeholder="أدخل رقمك المسجل..."
                                    className="w-full pl-4 pr-12 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-white font-bold placeholder:text-white/30 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-indigo-100 ml-1">مفتاح المزامنة (Cloud Key)</label>
                            <div className="relative">
                                <Key className="absolute right-4 top-1/2 -translate-y-1/2 text-indigo-300" size={18} />
                                <input
                                    type="password"
                                    required
                                    aria-label="مفتاح المزامنة"
                                    value={syncKey}
                                    onChange={e => setSyncKey(e.target.value)}
                                    placeholder="أدخل المفتاح السري لأسرتك..."
                                    className="w-full pl-4 pr-12 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-white font-bold placeholder:text-white/30 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all tracking-widest text-left"
                                    dir="ltr"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-linear-to-r from-indigo-500 to-purple-600 text-white py-4 rounded-2xl font-black text-sm shadow-lg hover:shadow-indigo-500/25 hover:scale-[1.02] active:scale-95 transition-all flex justify-center items-center gap-2 mt-4 disabled:opacity-70 disabled:hover:scale-100"
                        >
                            {isLoading ? <Loader2 className="animate-spin" size={20} /> : <><ShieldCheck size={20} /> دخول آمن</>}
                        </button>

                        <div className="mt-5 text-center space-y-2.5">
                            <div>
                                <span className="text-xs font-bold text-indigo-200">مش مسجل معانا في الخدمة؟ </span>
                                <Link to="/signup" className="text-xs font-black text-white hover:text-indigo-300 underline underline-offset-4 transition-all">
                                    اعمل طلب انضمام من هنا
                                </Link>
                            </div>
                            {activeEdition === 'all' && (
                                <div className="pt-2 border-t border-white/10">
                                    <Link
                                        to="/parent-login"
                                        data-testid="parent-portal-link"
                                        className="inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-amber-200 border border-amber-300/30 text-xs font-black transition-all"
                                    >
                                        <Users size={15} />
                                        دخول بوابة ولي الأمر والمخدوم
                                    </Link>
                                </div>
                            )}
                        </div>

                        {Capacitor.getPlatform() === 'web' && (
                            <>
                                <div className="flex items-center gap-3 my-6">
                                    <div className="flex-1 h-px bg-slate-200/20"></div>
                                    <span className="text-xs font-bold text-slate-400">أو</span>
                                    <div className="flex-1 h-px bg-slate-200/20"></div>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleInstallClick}
                                    className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl bg-linear-to-r from-emerald-500 to-green-600 text-white font-black hover:from-emerald-600 hover:to-green-700 transition-all shadow-lg active:scale-95"
                                >
                                    <Download size={22} />
                                    تثبيت التطبيق على الهاتف
                                </button>
                            </>
                        )}
                    </form>
                </div>
                <p className="text-center text-[10px] text-slate-500 mt-6 font-bold flex items-center justify-center gap-1">
                    <Lock size={10} /> نظام مشفر بتقنية Multi-tenant
                </p>
                <div className="mt-6">
                    <Footer compact />
                </div>
            </div>
        </main>
    );
}