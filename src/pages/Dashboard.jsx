import { scopedSyncKeys, syncScopedClassesFromCloud } from '../db/childSync';
import { useSmartNavigation } from '../hooks/useSmartNavigation';
import { getOsraCurricula, sanitizeServicesForCloud } from '../utils/curriculumEngine';
import {
    DEFAULT_CHURCH_LOGO_PATH,
    hasCustomOsraLogo,
    resolveOsraLogoUrl
} from '../utils/realChurchStructure';
import { resolveAttendanceChild } from '../utils/childIdentity';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useMemo } from 'react';
import { uploadImageToCloudinary, uploadImageWithFallback } from '../utils/cloudinary';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
// السطرين دول اتضافوا عشان السيستم يكلم فايربيز ويتأكد من الطرد
import { collection, getDocs, onSnapshot, collectionGroup, setDoc, doc, addDoc, deleteDoc } from 'firebase/firestore';
import { firestore, isFirebaseConfigured } from '../db/firebase';
import { encryptData, decryptData } from '../encryption';
import {
    BarChart3, Users, ArrowRight,
    ImagePlus, Loader2, Sparkles, BookOpen, UserPlus, Edit3, Trash2,
    Lock, Shirt, MapPin, DatabaseBackup, Save, FileSpreadsheet, ChevronRight, Phone, Search, Map, Calendar, Briefcase, StickyNote, Camera,
    LogOut, ShieldAlert, Download, AlertTriangle, RefreshCw, Music, CloudUpload, UserCheck, ClipboardList, Printer, Target, CheckSquare, CheckCircle, Plus, UserCircle,
    BellRing, ChevronUp, ChevronDown, CalendarX, HeartHandshake, CheckCircle2, MessageCircle, X, FileText, Trophy, Award, User, Clock, TrendingUp, TrendingDown, LayoutDashboard
} from 'lucide-react';
import ClassExcelToolbar from '../components/ClassExcelToolbar';
import SmartAlertsCard from '../components/SmartAlertsCard';
import ChildrenAttendanceReport from '../components/ChildrenAttendanceReport';
import { StudentFormModal } from '../components/AddStudent';
import { getVisitationInfo, formatLastVisitedDate } from '../utils/visitationTypes';
import { TENANT_CONFIG, getExcelReportFilename,
    readScopedStorage, writeScopedStorage, removeScopedStorage
} from '../utils/tenantConfig';
import useAutoSync from '../hooks/useAutoSync';
import { calculateExactAge } from '../utils/dateUtils';
import { logActivity } from '../utils/activityLogger';
import { deleteChildEverywhere, syncWithCloud, pullStructureFromCloud } from '../db/sync';
import {
    getCurrentServiceFridayDate,
    getServiceWeekRange,
    isWithinCurrentServiceWeek,
    isThursdayServiceClass,
    getElapsedServiceDatesForClass,
    getLocalDateString
} from '../utils/serviceWeek';
import {
    getCanonicalActiveChildren,
    getValidatedClassAttendance,
    isAttendanceRecordPresent,
    cleanupDuplicateAndOrphanedAttendance,
    createCanonicalChildRecord
} from '../utils/churchDataEngine';
import { useChurchDataEngine } from '../hooks/useChurchDataEngine';
import ScopedNotificationCenter from '../components/ScopedNotificationCenter';
import { getImpersonatedOsra, exitOsraImpersonation } from '../utils/notificationScopeEngine';

const getSettings = () => {
    const defaults = {
        khedmaName: "خدمة ابتدائي",
        osraLogo: "",
        aiPrompt: "خادم بمدارس الأحد 10 سنوات. حضر درس بعنوان: '[اسم_الدرس]'. مقسم لـ: 1. قصة مشوقة 2. أسئلة تفاعلية 3. لعبة حركية. باللغة العربية.",
        secretPass: "1234",
        deletePass: "مسح",
        adminPass: "admin"
    };
    const saved = readScopedStorage('appSettings');
    if (saved) {
        try { return { ...defaults, ...JSON.parse(saved) }; }
        catch (e) { return defaults; }
    }
    return defaults;
};

export default function Dashboard() {
    const { goBack } = useSmartNavigation();
    const navigate = useNavigate();
    const location = useLocation();
    const [currentView, setCurrentView] = useState(() => {
        try {
            const urlTab = new URLSearchParams(location.search).get('view');
            if (urlTab === 'kids' || urlTab === 'stats' || urlTab === 'reports' || urlTab === 'activities') return urlTab;
        } catch (_e) {
            // ignore
        }
        return 'menu';
    });
    const [appSettings, setAppSettings] = useState(getSettings());
    const impersonatedOsra = getImpersonatedOsra();
    const currentServantObj = JSON.parse(readScopedStorage('currentServant') || '{}');
    const accessScope = useMemo(
        () => resolveUserAccessScope(appSettings, [], { includeFallback: true }),
        [appSettings]
    );
    const isSuperAdmin = accessScope.isSuperAdmin;
    const isMaster = accessScope.canAccessMasterDashboard;
    const currentSyncKey = accessScope.isClassServant
        ? accessScope.activeSyncKey
        : (impersonatedOsra?.syncKey || readScopedStorage('currentSyncKey'));

    const [activeClassKey, setActiveClassKey] = useState(() => {
        if (accessScope.isClassServant) return accessScope.activeSyncKey || '';
        const urlSyncKey = new URLSearchParams(location.search).get('syncKey');
        if (urlSyncKey) {
            sessionStorage.setItem('dashboard_activeClassKey', urlSyncKey);
            return urlSyncKey;
        }
        try {
            const savedOsra = JSON.parse(readScopedStorage('selectedOsra') || 'null');
            if (savedOsra?.syncKey && sessionStorage.getItem('dashboard_activeClassKey')) {
                return sessionStorage.getItem('dashboard_activeClassKey');
            }
        } catch (_e) {}
        return sessionStorage.getItem('dashboard_activeClassKey') || 'all';
    });

    useEffect(() => {
        if (accessScope.isClassServant) return;
        const params = new URLSearchParams(location.search);
        const urlSyncKey = params.get('syncKey');
        const urlView = params.get('view');
        if (urlSyncKey) {
            sessionStorage.setItem('dashboard_activeClassKey', urlSyncKey);
            setActiveClassKey(urlSyncKey);
        }
        if (urlView === 'kids' || urlView === 'stats' || urlView === 'reports' || urlView === 'activities') {
            setCurrentView(urlView);
        }
    }, [location.search, accessScope.isClassServant]);

    const allAvailableOsras = useMemo(() => {
        return accessScope.allowedOsras || [];
    }, [accessScope]);

    const allowedKeySet = useMemo(
        () => new Set(accessScope.allowedSyncKeys || []),
        [accessScope]
    );

    const validActiveClassKey = useMemo(() => {
        if (!accessScope.canSwitchClasses) return accessScope.activeSyncKey || '';
        if (activeClassKey !== 'all' && allowedKeySet.has(activeClassKey)) return activeClassKey;
        return 'all';
    }, [accessScope, activeClassKey, allowedKeySet]);

    const allLiveCurricula = useLiveQuery(
        () => db.curricula.filter(c => !c.isDeleted).toArray(),
        []
    ) || [];

    const scopedCurriculumSyncKey = accessScope.isClassServant
        ? accessScope.activeSyncKey
        : (validActiveClassKey !== 'all' ? validActiveClassKey : '');

    const activeCurriculaCount = useMemo(() => {
        if (scopedCurriculumSyncKey) {
            return getOsraCurricula(scopedCurriculumSyncKey, allLiveCurricula).length;
        }
        if (isSuperAdmin) return allLiveCurricula.length;
        return allLiveCurricula.filter(c => allowedKeySet.has(c.syncKey)).length;
    }, [scopedCurriculumSyncKey, allLiveCurricula, isSuperAdmin, allowedKeySet]);

    // Single Source of Truth (SSOT) Engine for children & attendance
    const engineScope = useMemo(() => {
        if (!accessScope.canSwitchClasses) {
            return accessScope.activeSyncKey ? [accessScope.activeSyncKey] : [];
        }
        return validActiveClassKey !== 'all' ? [validActiveClassKey] : (accessScope.allowedSyncKeys || []);
    }, [accessScope, validActiveClassKey]);

    const {
        isLoading: isEngineLoading,
        activeChildren: children
    } = useChurchDataEngine(engineScope, {
        targetSyncKey: validActiveClassKey !== 'all' ? validActiveClassKey : (accessScope.isClassServant ? accessScope.activeSyncKey : 'all')
    });

    const [isUploadingOsraLogo, setIsUploadingOsraLogo] = useState(false);

    useEffect(() => {
        const reloadSettings = () => setAppSettings(getSettings());
        window.addEventListener('church-settings-updated', reloadSettings);
        window.addEventListener('storage', reloadSettings);
        return () => {
            window.removeEventListener('church-settings-updated', reloadSettings);
            window.removeEventListener('storage', reloadSettings);
        };
    }, []);

    const activeOsraBundle = useMemo(() => {
        if (!scopedCurriculumSyncKey || !Array.isArray(appSettings.services)) {
            return { service: null, osra: null };
        }
        for (const svc of appSettings.services) {
            const found = (svc.osras || []).find(
                (o) => String(o.syncKey || '').trim() === String(scopedCurriculumSyncKey).trim()
            );
            if (found) return { service: svc, osra: found };
        }
        return { service: null, osra: null };
    }, [appSettings.services, scopedCurriculumSyncKey]);

    const effectiveDashboardLogo = useMemo(() => {
        if (activeOsraBundle.osra) {
            return resolveOsraLogoUrl(activeOsraBundle.osra, activeOsraBundle.service);
        }
        if (impersonatedOsra?.logo) return impersonatedOsra.logo;
        return appSettings.osraLogo || DEFAULT_CHURCH_LOGO_PATH;
    }, [activeOsraBundle, impersonatedOsra, appSettings.osraLogo]);

    const persistClassLogoChange = async (nextLogoUrl, isReset = false) => {
        if (!scopedCurriculumSyncKey || !Array.isArray(appSettings.services)) return;
        const updatedServices = appSettings.services.map((svc) => ({
            ...svc,
            osras: (svc.osras || []).map((o) => {
                if (String(o.syncKey || '').trim() !== String(scopedCurriculumSyncKey).trim()) return o;
                return isReset
                    ? { ...o, logo: DEFAULT_CHURCH_LOGO_PATH, customLogoUrl: '', logoUrl: '', defaultLogo: DEFAULT_CHURCH_LOGO_PATH }
                    : { ...o, logo: nextLogoUrl, customLogoUrl: nextLogoUrl, logoUrl: nextLogoUrl, defaultLogo: DEFAULT_CHURCH_LOGO_PATH };
            })
        }));

        const nextSettings = { ...appSettings, services: updatedServices };
        setAppSettings(nextSettings);
        writeScopedStorage('appSettings', JSON.stringify(nextSettings));

        if (impersonatedOsra && String(impersonatedOsra.syncKey).trim() === String(scopedCurriculumSyncKey).trim()) {
            writeScopedStorage('impersonated_osra', JSON.stringify({
                ...impersonatedOsra,
                logo: isReset ? DEFAULT_CHURCH_LOGO_PATH : nextLogoUrl
            }));
        }

        const nowIso = new Date().toISOString();
        if (db?.appSettings) {
            await db.appSettings.put({
                id: 'mainConfig',
                services: updatedServices,
                servants: nextSettings.servants || [],
                updatedAt: nowIso
            }).catch(() => {});
        }

        if (isFirebaseConfigured && firestore && navigator.onLine) {
            try {
                const cleanServices = sanitizeServicesForCloud(JSON.parse(JSON.stringify(updatedServices)));
                await setDoc(doc(firestore, 'System', 'mainConfig'), {
                    services: cleanServices,
                    updatedAt: nowIso
                }, { merge: true });
            } catch (cloudErr) {
                console.warn('[Dashboard] Deferred class logo sync:', cloudErr?.message || cloudErr);
                writeScopedStorage('pendingStructureSync', 'true');
            }
        } else {
            writeScopedStorage('pendingStructureSync', 'true');
        }

        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new Event('church-settings-updated'));
        }
    };

    const handleDashboardOsraLogoUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !scopedCurriculumSyncKey) return;
        setIsUploadingOsraLogo(true);
        try {
            const uploadedUrl = await uploadImageWithFallback(file, { syncKey: scopedCurriculumSyncKey });
            await persistClassLogoChange(uploadedUrl, false);
        } catch (err) {
            alert('تعذر رفع شعار الأسرة: ' + (err?.message || err));
        } finally {
            setIsUploadingOsraLogo(false);
            e.target.value = '';
        }
    };

    const handleDashboardResetOsraLogo = async () => {
        await persistClassLogoChange(DEFAULT_CHURCH_LOGO_PATH, true);
    };

    const { triggerAutoSync } = useAutoSync();

    // currentSyncKey and isMaster are already defined above with the children query

    // زرعنا كود الطرد التلقائي والمزامنة الصامتة بالخلفية
    useEffect(() => {
        const keys = scopedSyncKeys().sort();
        if (keys.length > 0) {
            void syncScopedClassesFromCloud(keys).catch(() => {});
        }
        const verifyServantAccess = async () => {
            try {
                // القائد العام وأمين المرحلة ليسا مقيدين بأسرة واحدة فلا ينطبق عليهما فحص إغلاق أسرة فردية
                if (isMaster || isSuperAdmin || accessScope.isStageLeader || !accessScope.isClassServant) {
                    return;
                }

                const servantData = readScopedStorage('currentServant');
                if (!servantData) return;

                const currentServant = JSON.parse(servantData);
                const servantSyncKey = String(currentServant.syncKey || accessScope.activeSyncKey || '').trim();
                const servantOsraName = String(currentServant.osraName || '').trim();
                if (!servantOsraName && !servantSyncKey) return;
                if (['MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN'].includes(servantSyncKey)) return;

                const res = await pullStructureFromCloud();
                const services = res?.settings?.services;
                if (!Array.isArray(services) || services.length === 0) return;

                let isOsraStillExists = false;
                services.forEach(service => {
                    if (service.osras) {
                        service.osras.forEach(osra => {
                            if (
                                (servantSyncKey && String(osra.syncKey || '').trim() === servantSyncKey) ||
                                (servantOsraName && String(osra.name || '').trim() === servantOsraName)
                            ) {
                                isOsraStillExists = true;
                            }
                        });
                    }
                });

                if (!isOsraStillExists) {
                    alert("جالك قرار إزالة! تم إغلاق أسرتك أو إزالتك من النظام المركزي بواسطة الإدارة. جاري مسح بياناتك وتسجيل الخروج فوراً.");

                    await db.children.clear();
                    await db.attendance.clear();

                    removeScopedStorage('currentServant');
                    removeScopedStorage('currentSyncKey');
                    window.dispatchEvent(new Event('auth-changed'));
                    window.location.hash = '#/login';
                }
            } catch (error) {
                console.warn("النت فاصل أو فيه مشكلة في فحص الصلاحيات:", error?.message || error);
            }
        };

        verifyServantAccess();
    }, []);
    // نهاية كود الطرد

    if (isEngineLoading) return (
        <div className="min-h-screen coptic-cream-surface flex flex-col items-center justify-center font-bold text-[#6E604F] gap-3" dir="rtl">
            <Loader2 className="animate-spin text-[#C8942E] w-10 h-10" /> جاري تحميل غرفة الإدارة...
        </div>
    );

    const handleLogout = async () => {
        const confirmMsg = isFirebaseConfigured
            ? "متأكد إنك عايز تسجل خروج؟ (سيتم مسح البيانات المحلية من الجهاز للأمان)"
            : "متأكد إنك عايز تبدّل الحساب أو تسجل خروج؟ (سيتم الحفاظ على بيانات العرض التجريبي)";
        if (window.confirm(confirmMsg)) {
            if (isFirebaseConfigured) {
                await db.children.clear();
                await db.attendance.clear();
            }

            removeScopedStorage('currentSyncKey');
            removeScopedStorage('currentServant');
            removeScopedStorage('assignedOsra');
            removeScopedStorage('servantSession');
            removeScopedStorage('impersonated_osra');
            removeScopedStorage('isSuperAdminImpersonating');
            removeScopedStorage('masterSyncKey');
            removeScopedStorage('parentChildId');
            removeScopedStorage('parentSession');
            removeScopedStorage('userRole');
            window.dispatchEvent(new Event('syncKey-changed'));
            window.dispatchEvent(new Event('auth-changed'));
            window.location.hash = '#/login';
        }
    };

    const dynamicTitle = currentServantObj.stageName || currentServantObj.serviceName || currentServantObj.osraName || currentServantObj.role || appSettings.khedmaName || 'الخدمة';

    return (
        <div className="min-h-screen coptic-cream-surface pb-20" dir="rtl">
            <header
                className="text-white p-4 sticky top-0 z-50 shadow-lg rounded-b-[2rem] border-b border-amber-400/25"
                style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 72%, #8C621E 100%)' }}
            >
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {currentView === 'menu' ? (
                            <button type="button" onClick={() => goBack('/')} aria-label="العودة للرئيسية" className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center hover:bg-slate-700 transition-all shrink-0 cursor-pointer">
                                <ArrowRight size={20} />
                            </button>
                        ) : (
                            <button onClick={() => setCurrentView('menu')} aria-label="الرجوع للقائمة" className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center hover:bg-slate-700 transition-all shrink-0 cursor-pointer">
                                <ChevronRight size={24} />
                            </button>
                        )}
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <img 
                                src={effectiveDashboardLogo} 
                                width="40" 
                                height="40" 
                                loading="eager" 
                                fetchpriority="high" 
                                onError={(e) => {
                                    e.currentTarget.onerror = null;
                                    e.currentTarget.src = DEFAULT_CHURCH_LOGO_PATH;
                                }}
                                className="w-10 h-10 rounded-full object-contain bg-white p-0.5 border-2 border-amber-300/70 shrink-0" 
                                alt="لوجو الأسرة" 
                            />
                            <div className="min-w-0 flex-1">
                                <h1 className="text-sm sm:text-base font-black text-indigo-300 truncate">
                                    {isMaster ? 'لوحة الإدارة المركزية' : dynamicTitle}
                                </h1>
                                <p className="text-xs font-bold text-slate-300 truncate">
                                    {isMaster ? 'لوحة تحكم الأدمن' : currentView === 'menu' ? 'غرفة الإدارة' :
                                        currentView === 'stats' ? 'الإحصائيات والداتا' :
                                            currentView === 'kids' ? 'مرايا المخدومين' : currentView === 'activities' ? 'متابعة أنشطة الأسرة' : 'إخوة الرب'}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <ScopedNotificationCenter variant="dark" />
                    </div>
                </div>
            </header>

            <main className="p-3.5 sm:p-4 max-w-4xl mx-auto mt-2 sm:mt-4">
                {currentView === 'menu' && (
                    <div className="animate-in fade-in zoom-in-95 duration-300">
                        {/* شريط اختيار الأسرة للقائد (Admin / Stage Class Selector) */}
                        {accessScope.canSwitchClasses && (
                            <div className="mb-4 bg-white p-3.5 sm:p-4 rounded-[1.75rem] border border-indigo-100 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center font-black shrink-0 shadow-xs">
                                        <Users size={18} />
                                    </div>
                                    <div>
                                        <span className="text-xs font-black text-slate-800 block">تصفية حسب الأسرة / الفصل:</span>
                                        <span className="text-[10px] font-bold text-slate-500">
                                            {validActiveClassKey === 'all'
                                                ? (isSuperAdmin ? 'عرض شامل لكل الأسر' : `عرض فصول ${accessScope.stageName || 'المرحلة'}`)
                                                : `محدد: ${allAvailableOsras.find(o => o.syncKey === validActiveClassKey)?.name || validActiveClassKey}`}
                                        </span>
                                    </div>
                                </div>
                                <select
                                    value={validActiveClassKey}
                                    onChange={(e) => {
                                        setActiveClassKey(e.target.value);
                                        sessionStorage.setItem('dashboard_activeClassKey', e.target.value);
                                        window.dispatchEvent(new Event('syncKey-changed'));
                                    }}
                                    className="w-full sm:w-auto bg-indigo-50/70 border border-indigo-200 text-indigo-900 font-black text-xs rounded-xl px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-xs"
                                >
                                    <option value="all">{isSuperAdmin ? 'كل الأسر (عام)' : `كل فصول ${accessScope.stageName || 'المرحلة'}`}</option>
                                    {allAvailableOsras.map(osra => (
                                        <option key={osra.syncKey} value={osra.syncKey}>
                                            {osra.name} ({osra.serviceName || 'الخدمة'})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {impersonatedOsra?.syncKey && (
                            <div className="mb-4 p-3 rounded-2xl bg-amber-50 border border-amber-300 flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-black text-[#1B2A59]">
                                    لوحة تحكم الأسرة: {impersonatedOsra.name}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        exitOsraImpersonation();
                                        navigate('/master-dashboard');
                                    }}
                                    className="px-3 py-1.5 rounded-xl bg-[#1B2A59] text-amber-200 text-[11px] font-black cursor-pointer"
                                >
                                    العودة للوضع الإداري العام
                                </button>
                            </div>
                        )}

                        {/* تخصيص شعار الأسرة أو استعادة لوجو الكنيسة الافتراضي */}
                        {scopedCurriculumSyncKey && activeOsraBundle.osra && (
                            <div className="mb-4 coptic-card p-3.5 sm:p-4 rounded-3xl border border-[#DFC48F] flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-14 h-14 rounded-2xl bg-[#FFFDF7] border-2 border-[#C89B3C] p-1 flex items-center justify-center shrink-0 overflow-hidden shadow-xs">
                                        <img
                                            src={effectiveDashboardLogo}
                                            alt={activeOsraBundle.osra.name}
                                            onError={(e) => {
                                                e.currentTarget.onerror = null;
                                                e.currentTarget.src = DEFAULT_CHURCH_LOGO_PATH;
                                            }}
                                            className="w-full h-full object-contain rounded-xl"
                                        />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="font-black text-sm text-[#1B2A59] truncate">
                                            شعار أسرة: {activeOsraBundle.osra.name}
                                        </h3>
                                        <p className="text-[11px] font-bold text-[#6E5329]">
                                            {hasCustomOsraLogo(activeOsraBundle.osra)
                                                ? 'مفعّل شعار خاص بالأسرة (مرفوع على السحابة)'
                                                : 'مفعّل شعار الكنيسة الرسمي الافتراضي'}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <label className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#1B2A59] hover:bg-[#253A7A] text-amber-200 text-xs font-black inline-flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors relative overflow-hidden">
                                        {isUploadingOsraLogo ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                                        <span>{isUploadingOsraLogo ? 'جاري رفع الشعار...' : 'رفع شعار خاص للأسرة'}</span>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            disabled={isUploadingOsraLogo}
                                            onChange={handleDashboardOsraLogoUpload}
                                            className="absolute inset-0 opacity-0 cursor-pointer"
                                        />
                                    </label>
                                    {hasCustomOsraLogo(activeOsraBundle.osra) && (
                                        <button
                                            type="button"
                                            onClick={handleDashboardResetOsraLogo}
                                            className="min-h-[40px] px-3 py-2 rounded-xl bg-[#FAF3E3] hover:bg-rose-50 text-[#7A5617] hover:text-rose-700 border border-[#DFC48F] text-xs font-black inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                                        >
                                            <RefreshCw size={13} />
                                            <span>استعادة لوجو الكنيسة الافتراضي</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* كارت التنبيهات الذكية والمتابعة الفورية */}
                        <SmartAlertsCard activeClassKey={validActiveClassKey || 'all'} />

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* مرايا المخدومين (بيانات وإضافة المخدومين وشيت الإكسيل) — متاحة دائماً في أعلى القائمة */}
                            <button onClick={() => setCurrentView('kids')} className="coptic-card p-6 rounded-[2.5rem] border-2 border-[#C8942E] hover:border-[#1B2A59] transition-all flex flex-col items-center text-center group cursor-pointer animate-card-enter">
                                <div className="w-16 h-16 bg-blue-100 text-[#1B2A59] rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><Users size={32} /></div>
                                <h2 className="text-xl font-black text-[#1B2A59]">مرايا المخدومين (بيانات وإضافة المخدومين وشيت الإكسيل)</h2>
                                <p className="text-xs font-bold text-[#6E5329] mt-1">إضافة مخدومين، تعديل البيانات، واستيراد/تصدير Excel</p>
                            </button>
                            {/* بروفايل الخادم (الملف الشخصي) */}
                            <Link to="/servant-profile" className="coptic-card p-6 rounded-[2.5rem] border-2 border-[#DFC48F] hover:border-[#C89B3C] transition-all flex flex-col items-center text-center group animate-card-enter">
                                <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform overflow-hidden ring-2 ring-[#C89B3C]/50 shadow-xs">
                                    {currentServantObj?.photoURL || currentServantObj?.profileImage || currentServantObj?.profilePic ? (
                                        <img 
                                            src={currentServantObj.photoURL || currentServantObj.profileImage || currentServantObj.profilePic} 
                                            alt="بروفايلي" 
                                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                            className="w-full h-full object-cover" 
                                        />
                                    ) : (
                                        <UserCircle size={32} />
                                    )}
                                </div>
                                <h2 className="text-xl font-black text-[#1B2A59]">الملف الشخصي (بروفايلي)</h2>
                                <p className="text-xs font-bold text-[#6E5329] mt-1">تحديث الصورة الشخصية، العنوان، ومتابعة سجل الحضور</p>
                            </Link>

                            <button onClick={() => setCurrentView('stats')} className="coptic-card p-6 rounded-[2.5rem] border-2 border-[#DFC48F] hover:border-[#C89B3C] transition-all flex flex-col items-center text-center group cursor-pointer animate-card-enter">
                                <div className="w-16 h-16 bg-indigo-100 text-[#1B2A59] rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><BarChart3 size={32} /></div>
                                <h2 className="text-xl font-black text-[#1B2A59]">الإحصائيات والداتا</h2>
                                <p className="text-xs font-bold text-[#6E5329] mt-1">سحب شيت الإكسيل، وتصفير العدادات</p>
                            </button>

                            {/* كارت تقرير حضور وغياب المخدومين (شهري / سنوي) (Requirement #3) */}
                            <button onClick={() => setCurrentView('reports')} className="coptic-card p-6 rounded-[2.5rem] border-2 border-[#DFC48F] hover:border-[#C89B3C] transition-all flex flex-col items-center text-center group cursor-pointer animate-card-enter">
                                <div className="w-16 h-16 bg-purple-100 text-purple-700 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><FileText size={32} /></div>
                                <h2 className="text-xl font-black text-[#1B2A59]">تقرير حضور وغياب المخدومين</h2>
                                <p className="text-xs font-bold text-[#6E5329] mt-1">تقرير شهري وسنوي، نسب الغياب، وتصدير Excel</p>
                            </button>

                            {/* نظام النقاط والمكافآت */}
                            <Link to="/points" className="coptic-card p-6 rounded-[2.5rem] border-2 border-amber-300/80 hover:border-amber-500 transition-all flex flex-col items-center text-center group tactile-press animate-card-enter">
                                <div className="w-16 h-16 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><Trophy size={32} /></div>
                                <h2 className="text-xl font-black text-[#1B2A59]">نظام النقاط والمكافآت</h2>
                                <p className="text-xs font-bold text-[#6E5329] mt-1">لوحة الشرف الشهرية ومنح النقاط وتصدير الإكسيل</p>
                            </Link>

                            {/* منظومة مناهج الخدمة */}
                            <Link
                                to={scopedCurriculumSyncKey ? `/curriculum?syncKey=${encodeURIComponent(scopedCurriculumSyncKey)}` : '/curriculum'}
                                className="coptic-card p-6 rounded-[2.5rem] border-2 border-[#DFC48F] hover:border-[#C89B3C] transition-all flex flex-col items-center text-center group tactile-press animate-card-enter"
                            >
                                <div className="w-16 h-16 bg-[#EFE0C2] text-[#1B2A59] rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><BookOpen size={32} /></div>
                                <h2 className="text-xl font-black text-[#1B2A59]">
                                    {scopedCurriculumSyncKey
                                        ? `منهج ودروس: ${allAvailableOsras.find(o => o.syncKey === scopedCurriculumSyncKey)?.name || scopedCurriculumSyncKey}`
                                        : 'منظومة مناهج الخدمة'}
                                </h2>
                                <p className="text-xs font-bold text-[#6E5329] mt-1">
                                    {scopedCurriculumSyncKey
                                        ? `${activeCurriculaCount} ملف PDF ودرس مضاف للأسرة`
                                        : `تخطيط وتنظيم دروس ومذكرات كل مرحلة (${activeCurriculaCount} مضاف)`}
                                </p>
                            </Link>

                            {/* New Card for Servants Follow-up */}
                            {isMaster && (
                                <>
                                    <Link to="/admin/servants-followup" className="coptic-card p-6 rounded-[2.5rem] border-2 border-[#DFC48F] hover:border-[#C89B3C] transition-all flex flex-col items-center text-center group animate-card-enter">
                                        <div className="w-16 h-16 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><ClipboardList size={32} /></div>
                                        <h2 className="text-xl font-black text-[#1B2A59]">متابعة وتقييم الخدام</h2>
                                        <p className="text-xs font-bold text-[#6E5329] mt-1">حضور، تحضير، قداسات، وافتقاد</p>
                                    </Link>
                                    
                                    <Link to="/admin/servants-report" className="coptic-card p-6 rounded-[2.5rem] border-2 border-[#DFC48F] hover:border-[#C89B3C] transition-all flex flex-col items-center text-center group animate-card-enter">
                                        <div className="w-16 h-16 bg-amber-100 text-[#8C621E] rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><Printer size={32} /></div>
                                        <h2 className="text-xl font-black text-[#1B2A59]">التقرير الشهري للخدام</h2>
                                        <p className="text-xs font-bold text-[#6E5329] mt-1">تجميع وطباعة التقرير الشامل</p>
                                    </Link>
                                </>
                            )}

                            {/* النتائج والامتحانات وتقييم المخدومين */}
                            <Link to="/exams" className="coptic-card p-6 rounded-[2.5rem] border-2 border-[#DFC48F] hover:border-[#C89B3C] transition-all flex flex-col items-center text-center group tactile-press animate-card-enter">
                                <div className="w-16 h-16 bg-indigo-100 text-[#1B2A59] rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><Award size={32} /></div>
                                <h2 className="text-xl font-black text-[#1B2A59]">النتائج والامتحانات</h2>
                                <p className="text-xs font-bold text-[#6E5329] mt-1">رصد الدرجات وتقييم المخدومين</p>
                            </Link>
                            
                            {!isMaster && (
                                <button onClick={() => setCurrentView('activities')} className="coptic-card p-6 rounded-[2.5rem] border-2 border-[#DFC48F] hover:border-[#C89B3C] transition-all flex flex-col items-center text-center group cursor-pointer animate-card-enter">
                                    <div className="w-16 h-16 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><Target size={32} /></div>
                                    <h2 className="text-xl font-black text-[#1B2A59]">متابعة أنشطة الأسرة</h2>
                                    <p className="text-xs font-bold text-[#6E5329] mt-1">تسجيل ومتابعة الأنشطة المستهدفة والمنفذة للأسرة</p>
                                </button>
                            )}


                        </div>

                        {/* الزرار اللي بيودي لصفحة الإدارة المركزية (مقيد بالكاهن / أمين الخدمة العام فقط) */}
                        {isSuperAdmin && (
                            <div className="mt-10 text-center">
                                <Link to="/admin" className="text-[10px] text-slate-400 hover:text-slate-600 font-bold underline flex items-center justify-center gap-1 mx-auto">
                                    <ShieldAlert size={12} /> الانتقال للوحة الإدارة المركزية (Super Admin)
                                </Link>
                            </div>
                        )}

                        <button onClick={handleLogout} className="mt-6 w-full bg-slate-200 text-slate-600 py-3 rounded-xl font-black text-sm hover:bg-red-50 hover:text-red-600 transition-all flex justify-center items-center gap-2 shadow-sm">
                            <LogOut size={18} /> تسجيل الخروج من الحساب
                        </button>
                    </div>
                )}

                {currentView === 'stats' && <StatsView childrenData={children} appSettings={appSettings} scopedSyncKeys={engineScope} />}
                {currentView === 'reports' && (
                    <div className="space-y-4">
                        <button 
                            onClick={() => setCurrentView('menu')} 
                            className="text-xs font-black bg-slate-200 text-slate-700 px-4 py-2.5 rounded-xl flex items-center gap-1.5 hover:bg-slate-300 transition-colors cursor-pointer"
                        >
                            <ArrowRight size={15} /> عودة للوحة التحكم
                        </button>
                        <ChildrenAttendanceReport 
                            childrenData={children} 
                            appSettings={appSettings} 
                            scopedSyncKeys={engineScope}
                            onBack={() => setCurrentView('menu')}
                        />
                    </div>
                )}
                {currentView === 'kids' && (
                    <KidsManagerView
                        childrenData={children}
                        activeClassSyncKey={validActiveClassKey !== 'all' ? validActiveClassKey : (impersonatedOsra?.syncKey || accessScope.activeSyncKey || '')}
                        activeClassOsraName={
                            allAvailableOsras.find(o => o.syncKey === validActiveClassKey)?.name ||
                            impersonatedOsra?.name ||
                            dynamicTitle
                        }
                    />
                )}
                {currentView === 'activities' && !isMaster && <ActivitiesView />}


            </main>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════════════
// الإحصائيات والأبطال والذكاء الاصطناعي وإخوة الرب (زي ما هما بالظبط)
// ══════════════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════════════
// 1. الإحصائيات (Advanced Analytics Dashboard)
// ══════════════════════════════════════════════════════════════════════════════════════
function StatsView({ childrenData, appSettings, scopedSyncKeys = [] }) {
    const { triggerAutoSync } = useAutoSync();
    const [statsTab, setStatsTab] = useState('overview'); // 'overview' | 'attendance_report'
    const [showWhoAttended, setShowWhoAttended] = useState(false);
    const [isCleaningUp, setIsCleaningUp] = useState(false);

    const canonicalData = useMemo(() => getCanonicalActiveChildren(childrenData), [childrenData]);
    const activeChildren = canonicalData.activeChildren;

    const total = activeChildren.length;
    const boys = activeChildren.filter(c => c.gender !== 'بنت').length;
    const girls = activeChildren.filter(c => c.gender === 'بنت').length;
    const today = getLocalDateString();

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const currentMonthPrefix = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    // جلب داتا الغياب للسنة الحالية
    const attendanceData = useLiveQuery(() =>
        db.attendance.toArray()
    ) || [];

    // Anchored Thursday-to-Wednesday service cycle counters (SSOT)
    const serviceWeek = getServiceWeekRange();

    const weeklyStats = useMemo(() => {
        const validatedWeek = getValidatedClassAttendance(attendanceData, canonicalData, {
            startDate: serviceWeek.startDate,
            endDate: serviceWeek.endDate
        });

        return {
            serviceCount: validatedWeek.presentCount,
            liturgyCount: validatedWeek.liturgyCount,
            tasbehaCount: validatedWeek.tasbehaCount,
            weekVisitations: validatedWeek.visitationCount,
            whoAttendedServiceList: validatedWeek.whoAttendedServiceList,
            whoAttendedLiturgyList: validatedWeek.whoAttendedLiturgyList,
            whoAbsentServiceList: validatedWeek.whoAbsentServiceList,
            weekStartDate: serviceWeek.startDate,
            weekEndDate: serviceWeek.endDate
        };
    }, [attendanceData, canonicalData, serviceWeek.startDate, serviceWeek.endDate]);

    // ─── 1. حساب إحصائيات الحضور لأيام الخدمة في الشهر الحالي (الخميس والجمعة) ───
    const attendanceStats = useMemo(() => {
        const year = new Date().getFullYear();
        const month = new Date().getMonth() + 1;
        const mPad = String(month).padStart(2, '0');
        const startBound = `${year}-${mPad}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endBound = `${year}-${mPad}-${String(lastDay).padStart(2, '0')}`;

        // Detect if scoped children belong to Thursday classes, Friday classes, or both
        let hasThursdayClass = false;
        let hasFridayClass = false;
        const distinctSyncKeys = new Set(activeChildren.map(c => c.syncKey));
        for (const sKey of distinctSyncKeys) {
            if (isThursdayServiceClass(sKey)) hasThursdayClass = true;
            else hasFridayClass = true;
        }
        if (!hasThursdayClass && !hasFridayClass) {
            const currentKey = readScopedStorage('currentSyncKey') || '';
            if (isThursdayServiceClass(currentKey)) hasThursdayClass = true;
            else hasFridayClass = true;
        }

        // Actual service dates recorded in this month for scoped children
        const actualDatesSet = new Set();
        attendanceData.forEach(a => {
            if (!a || a.isDeleted || !a.date || !a.date.startsWith(currentMonthPrefix)) return;
            if (a.type === 'service' && isAttendanceRecordPresent(a) && resolveAttendanceChild(a, canonicalData)) {
                actualDatesSet.add(a.date);
            }
        });

        const monthDatesSet = new Set(actualDatesSet);
        const cur = new Date(`${startBound}T12:00:00`);
        const end = new Date(`${endBound}T12:00:00`);
        while (cur <= end) {
            const day = cur.getDay();
            const dStr = getLocalDateString(cur);
            if (dStr <= today) {
                if ((hasThursdayClass && day === 4) || (hasFridayClass && day === 5)) {
                    monthDatesSet.add(dStr);
                }
            }
            cur.setDate(cur.getDate() + 1);
        }

        const sortedDates = Array.from(monthDatesSet).sort();
        const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

        return sortedDates.map((dStr, index) => {
            const validatedDay = getValidatedClassAttendance(attendanceData, canonicalData, {
                exactDate: dStr
            });
            const dObj = new Date(`${dStr}T12:00:00`);
            const dayName = !isNaN(dObj.getTime()) ? dayNames[dObj.getDay()] : 'خدمة';
            return {
                date: dStr,
                label: `${dayName} ${index + 1}`,
                service: validatedDay.presentCount,
                liturgy: validatedDay.liturgyCount
            };
        });
    }, [attendanceData, canonicalData, activeChildren, currentMonthPrefix, today]);

    // ─── تنظيف وتصحيح سجلات الحضور المكررة واليتيمة ───
    const handleCleanupDuplicateAttendance = async () => {
        try {
            setIsCleaningUp(true);
            const res = await cleanupDuplicateAndOrphanedAttendance({ removeCloudOrphans: true });
            triggerAutoSync();
            alert(
                `تم تنظيف وتصحيح سجلات الحضور بنجاح!\n` +
                `• سجلات مكررة أو يتيمة تم حذفها: ${res.deletedCount}\n` +
                `• سجلات تم تصحيح ربط الفصل لها: ${res.fixedCount}`
            );
        } catch (err) {
            alert('حدث خطأ أثناء تنظيف السجلات: ' + err.message);
        } finally {
            setIsCleaningUp(false);
        }
    };

    // ─── 2. تجميع إحصائيات الافتقاد بالتواريخ والأنواع (Requirement #6) ───
    const visitationsByDate = childrenData.reduce((acc, child) => {
        if (child.last_visited) {
            const dateStr = formatLastVisitedDate(child.last_visited);
            if (dateStr) {
                if (!acc[dateStr]) acc[dateStr] = [];
                const typeInfo = getVisitationInfo(child.lastVisitationType);
                const firstName = (child.name || '').split(' ')[0];
                acc[dateStr].push(`${firstName} (${typeInfo.shortLabel})`);
            }
        }
        return acc;
    }, {});

    const sortedVisitDates = Object.keys(visitationsByDate).sort((a, b) => new Date(b) - new Date(a));

    // ─── 3. الشيت الإكسيل الذكي (الكل - ولاد - بنات) ───
    const handleExport = (filterType) => {
        const currentYear = new Date().getFullYear();

        // فلترة الداتا وتحديد اسم الملف بناءً على الزرار اللي انداس
        let dataToExport = childrenData;
        let fileName = "أرشيف_الخدمة_الشامل";
        let sheetName = "التقرير الشامل";

        if (filterType === 'boys') {
            dataToExport = childrenData.filter(c => c.gender !== 'بنت');
            fileName = "أرشيف_الخدمة_ولاد";
            sheetName = "تقرير الولاد";
        } else if (filterType === 'girls') {
            dataToExport = childrenData.filter(c => c.gender === 'بنت');
            fileName = "أرشيف_الخدمة_بنات";
            sheetName = "تقرير البنات";
        }

        if (dataToExport.length === 0) {
            alert("لا يوجد مخدومين في هذه الفئة لتصديرهم!");
            return;
        }

        const dataForExcel = dataToExport.map(c => {
            // حساب العمر
            const calculatedAge = calculateExactAge(c.birthDate);

            // حساب الحضور الفعلي الموثق بدون تكرار أو غياب
            const childAtt = attendanceData.filter(a => resolveAttendanceChild(a, canonicalData)?.id === c.id && isAttendanceRecordPresent(a));
            const totalService = new Set(childAtt.filter(a => a.type === 'service').map(a => a.date)).size;
            const totalLiturgy = new Set(childAtt.filter(a => a.type === 'liturgy').map(a => a.date)).size;

            return {
                "م": c.id,
                "كود المخدوم": c.id || "لم يتم إنشاء كود",
                "كود الـ QR الخاص": c.qrId || c.id || "لم يتم إنشاء كود",
                "اسم المخدوم": c.name || 'بدون اسم',
                "النوع": c.gender || 'غير محدد',
                "رابط الصورة المرفوعة": c.profilePic ? c.profilePic : "لا توجد صورة",
                "تاريخ الميلاد": c.birthDate || 'غير مسجل',
                "العمر التقريبي": calculatedAge,
                "تليفون الأم": c.motherPhone || 'لا يوجد',
                "تليفون الأب": c.fatherPhone || 'لا يوجد',
                "تليفون المخدوم": c.childPhone || 'لا يوجد',
                "الواتساب للتواصل": c.whatsappTarget === 'father' ? 'الأب' : c.whatsappTarget === 'child' ? 'المخدوم' : 'الأم',
                "المنطقة السكنية": c.address || 'غير محدد',
                "العنوان التفصيلي": c.detailedAddress || 'غير مسجل',
                "إجمالي حضور الخدمة": totalService,
                "إجمالي حضور القداس": totalLiturgy,
                "المواظبة المتتالية الحالية": c.streak || 0,
                "آخر حضور قداس": c.last_liturgy || 'لم يحضر',
                "آخر تاريخ افتقاد": formatLastVisitedDate(c.last_visited) || 'لم يُفتقد',
                "نوع آخر افتقاد": c.lastVisitationLabel || (c.lastVisitationType ? getVisitationInfo(c.lastVisitationType).label : (c.last_visited ? 'افتـقـاد' : 'غير مسجل')),
                "أب الاعتراف": c.fatherConfessor || 'غير مسجل',
                "السنة الدراسية": c.academicYear || c.schoolYear || 'غير محدد',
                "ملاحظات إضافية": c.specialNotes || 'لا يوجد',
                "بيانات الـ QR": (c.qrId || c.id) ? `KHD:${c.qrId || c.id}` : "غير متوفر"
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(dataForExcel);

        // تظبيط عرض العواميد
        const wscols = [
            { wch: 5 }, { wch: 15 }, { wch: 22 }, { wch: 25 }, { wch: 10 }, { wch: 40 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 35 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 40 }, { wch: 22 }
        ];
        worksheet['!cols'] = wscols;

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        XLSX.writeFile(workbook, getExcelReportFilename(fileName, today));
    };
    const statsScope = resolveUserAccessScope(appSettings, [], { includeFallback: true });
    const currentSyncKey = statsScope.isClassServant ? statsScope.activeSyncKey : readScopedStorage('currentSyncKey');
    const isMaster = statsScope.canAccessMasterDashboard;
    const currentServantObj = JSON.parse(readScopedStorage('currentServant') || '{}');
    const className = statsScope.isSuperAdmin
        ? (appSettings.khedmaName || 'الخدمة المركزية')
        : (statsScope.isStageLeader ? statsScope.stageName : (statsScope.primaryClassName || currentServantObj.osraName || 'الفصل'));

    const handleGlobalReset = async () => {
        if (window.confirm(`هل أنت متأكد من تصفير/مسح بيانات فصل ${className} فقط؟ لن تؤثر هذه العملية على بقية الفصول.`)) {
            if (window.confirm("تأكيد أخير: الداتا هتتمسح ومش هترجع، كمل؟")) {
                try {
                    const now = new Date().toISOString();
                    const updates = childrenData.map(c => db.children.update(c.id, { streak: 0, last_liturgy: null, last_service: null, last_visited: null, isDirty: true, updatedAt: now }));
                    await Promise.all(updates);
                    logActivity('RESET_COUNTERS', `تصفير عدادات فصل: ${className} (${childrenData.length} مخدوم)`);
                    triggerAutoSync();
                    alert(`تم تصفير العدادات بنجاح لفصل ${className}!`);
                } catch (error) {
                    console.error(error);
                    alert("عطل في قاعدة البيانات: " + error.message);
                }
            }
        }
    };

    const handleNuclearDelete = async () => {
        if (window.confirm(`هل أنت متأكد من تصفير/مسح بيانات فصل ${className} فقط؟ لن تؤثر هذه العملية على بقية الفصول.`)) {
            const pass = prompt(`اكتب كلمة (${appSettings.deletePass}) للتأكيد النهائي:`);
            if (pass === appSettings.deletePass) {
                try {
                    const now = new Date().toISOString();
                    for (const child of childrenData) await deleteChildEverywhere(child, JSON.parse(readScopedStorage('currentServant') || '{}').name);
                    logActivity('NUCLEAR_DELETE', `مسح كامل لبيانات فصل: ${className} (${childrenData.length} مخدوم + السجلات المرتبطة سجل حضور)`);
                    triggerAutoSync();
                    alert(`تم تنظيف قاعدة بيانات ${className} بالكامل! الأرض فاضية.`);
                } catch (error) {
                    console.error(error);
                    alert("عطل في قاعدة البيانات: " + error.message);
                }
            } else {
                alert("تم إلغاء العملية، كلمة المرور خاطئة، الداتا في أمان.");
            }
        }
    };

    const calcPercent = (count) => total === 0 ? 0 : Math.round((count / total) * 100);

    return (
        <div className="animate-in slide-in-from-right-8 duration-300 space-y-6">

            {/* شريط التبديل بين الإحصائيات العامة وتقرير الحضور والغياب (Requirement #3) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-200/60 p-1.5 rounded-2xl">
                <button
                    type="button"
                    onClick={() => setStatsTab('overview')}
                    className={`w-full py-2.5 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        statsTab === 'overview'
                            ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                            : 'text-slate-600 hover:text-slate-900'
                    }`}
                >
                    <BarChart3 size={15} className="shrink-0" /> ملخص الإحصائيات العامة
                </button>
                <button
                    type="button"
                    onClick={() => setStatsTab('attendance_report')}
                    className={`w-full py-2.5 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        statsTab === 'attendance_report'
                            ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                            : 'text-slate-600 hover:text-slate-900'
                    }`}
                >
                    <FileSpreadsheet size={15} className="shrink-0" /> تقرير الحضور والغياب (شهري / سنوي)
                </button>
            </div>

            {statsTab === 'attendance_report' ? (
                <ChildrenAttendanceReport 
                    childrenData={childrenData} 
                    appSettings={appSettings} 
                    scopedSyncKeys={scopedSyncKeys}
                />
            ) : (
                <>
                    {/* 1. الكروت العلوية (ملخص الأرقام) */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center col-span-2">
                            <Users className="text-indigo-50 mb-1 w-8 h-8" />
                            <h3 className="text-slate-500 font-black text-xs">إجمالي المخدومين المقيدين</h3>
                            <p className="text-3xl font-black text-slate-800">{total}</p>
                            <div className="flex gap-4 mt-2 text-[10px] font-bold text-slate-600 bg-slate-50 px-4 py-1.5 rounded-full">
                                <span className="inline-flex items-center gap-1"><User size={11} /> {boys} ولاد</span><span className="inline-flex items-center gap-1"><User size={11} /> {girls} بنات</span>
                            </div>
                        </div>
                    </div>

                    {/* ملخص أرقام أسبوع الخدمة الحالي (من الخميس للأربعاء) */}
                    <div className="bg-gradient-to-br from-indigo-900 to-indigo-950 text-white p-5 rounded-3xl shadow-md border border-indigo-800">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-indigo-800/80 pb-3 mb-4">
                            <div className="flex items-center gap-2 min-w-0">
                                <Calendar className="text-amber-400 w-5 h-5 shrink-0" />
                                <div className="min-w-0">
                                    <h3 className="text-xs sm:text-sm font-black truncate">نشاط أسبوع الخدمة الحالي (SSOT)</h3>
                                    <p className="text-[10px] text-indigo-200 font-bold leading-snug">دورة الأسبوع: الخميس {weeklyStats.weekStartDate} حتى الأربعاء {weeklyStats.weekEndDate}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto">
                                <button
                                    type="button"
                                    onClick={() => setShowWhoAttended(prev => !prev)}
                                    className="w-full sm:w-auto text-[11px] bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-3 py-1.5 rounded-xl font-black cursor-pointer transition-colors text-center"
                                >
                                    <span className="inline-flex items-center justify-center gap-1.5"><Users size={13} /> مين حضر الخدمة؟ ({weeklyStats.serviceCount} / {total})</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCleanupDuplicateAttendance}
                                    disabled={isCleaningUp}
                                    className="w-full sm:w-auto text-[11px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 px-3 py-1.5 rounded-xl font-black cursor-pointer transition-colors text-center"
                                    title="تنظيف وتصحيح سجلات الحضور المكررة أو اليتيمة"
                                >
                                    {isCleaningUp ? <span className="inline-flex items-center justify-center gap-1.5"><Clock size={13} /> جاري التنظيف...</span> : <span className="inline-flex items-center justify-center gap-1.5"><RefreshCw size={13} /> تنظيف سجلات الحضور المكررة</span>}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                            <div
                                onClick={() => setShowWhoAttended(prev => !prev)}
                                className="bg-white/10 hover:bg-white/15 cursor-pointer backdrop-blur-sm p-3 rounded-2xl border border-white/10 transition-colors"
                                title="اضغط لعرض قائمة مين حضر الخدمة هذا الأسبوع"
                            >
                                <div className="text-emerald-400 font-black text-2xl">{weeklyStats.serviceCount} <span className="text-xs text-indigo-200">/ {total}</span></div>
                                <div className="text-[11px] font-bold text-slate-200 mt-0.5">حاضرين الخدمة</div>
                            </div>
                            <div className="bg-white/10 backdrop-blur-sm p-3 rounded-2xl border border-white/10">
                                <div className="text-amber-400 font-black text-2xl">{weeklyStats.liturgyCount} <span className="text-xs text-indigo-200">/ {total}</span></div>
                                <div className="text-[11px] font-bold text-slate-200 mt-0.5">حضور القداس</div>
                            </div>
                            <div className="bg-white/10 backdrop-blur-sm p-3 rounded-2xl border border-white/10">
                                <div className="text-cyan-400 font-black text-2xl">{weeklyStats.tasbehaCount}</div>
                                <div className="text-[11px] font-bold text-slate-200 mt-0.5">حضور التسبحة</div>
                            </div>
                            <div className="bg-white/10 backdrop-blur-sm p-3 rounded-2xl border border-white/10">
                                <div className="text-purple-400 font-black text-2xl">{weeklyStats.weekVisitations}</div>
                                <div className="text-[11px] font-bold text-slate-200 mt-0.5">الافتقاد الأسبوعي</div>
                            </div>
                        </div>

                        {/* قائمة مين حضر الخدمة هذا الأسبوع (Who Attended Service List) */}
                        {showWhoAttended && (
                            <div className="mt-4 pt-4 border-t border-indigo-800/80 animate-in fade-in duration-200">
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-xs font-black text-emerald-300 flex items-center gap-1.5">
                                        <CheckCircle2 size={14} /> قائمة الحاضرين في الخدمة هذا الأسبوع ({weeklyStats.whoAttendedServiceList.length} مخدوم):
                                    </h4>
                                    <button
                                        type="button"
                                        onClick={() => setShowWhoAttended(false)}
                                        className="text-[10px] text-indigo-300 hover:text-white font-bold"
                                    >
                                        <span className="inline-flex items-center gap-1">إغلاق <X size={12} /></span>
                                    </button>
                                </div>
                                {weeklyStats.whoAttendedServiceList.length === 0 ? (
                                    <p className="text-xs font-bold text-indigo-200/80 py-2 text-center">
                                        لم يتم تسجيل حضور خدمة لأي مخدوم نشط في هذا الأسبوع بعد.
                                    </p>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                                        {weeklyStats.whoAttendedServiceList.map((child, idx) => (
                                            <div key={child.id} className="bg-white/10 border border-white/15 rounded-xl px-3 py-2 flex items-center justify-between text-xs font-bold">
                                                <span className="truncate">{idx + 1}. {child.name}</span>
                                                <span className="text-[10px] text-emerald-300 shrink-0 inline-flex items-center gap-0.5"><User size={11} /> {child.gender === 'بنت' ? 'بنت' : 'ولد'}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

            {/* 2. مؤشر حضور الشهر (رسم بياني) */}
            <div className="bg-white p-5 rounded-3xl shadow-sm border border-blue-100">
                <div className="flex items-center justify-between mb-4 border-b border-slate-50 pb-3">
                    <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                        <BarChart3 className="text-blue-500 w-5 h-5" /> مؤشر حضور الشهر الحالي
                    </h3>
                </div>

                <div className="space-y-5">
                    {attendanceStats.map((stat, i) => {
                        const prevStat = i > 0 ? attendanceStats[i - 1] : null;
                        const serviceTrend = prevStat ? (stat.service >= prevStat.service ? <TrendingUp size={12} className="text-emerald-600 shrink-0" /> : <TrendingDown size={12} className="text-rose-500 shrink-0" />) : <BarChart3 size={12} className="text-indigo-500 shrink-0" />;

                        return (
                            <div key={stat.date} className="space-y-2">
                                <div className="flex justify-between text-[10px] font-black text-slate-600">
                                    <span>{stat.label} ({stat.date.slice(5)})</span>
                                </div>

                                {/* بار الخدمة */}
                                <div className="flex items-center gap-2">
                                    <div className="w-10 text-[9px] font-bold text-indigo-500 text-right">الخدمة:</div>
                                    <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden flex">
                                        <div className="bg-indigo-500 h-full rounded-full transition-all duration-1000" style={{ width: `${calcPercent(stat.service)}%` }}></div>
                                    </div>
                                    <div className="w-12 text-[10px] font-black text-slate-700 text-left flex items-center justify-end gap-1">
                                        {stat.service} {serviceTrend}
                                    </div>
                                </div>

                                {/* بار القداس */}
                                <div className="flex items-center gap-2">
                                    <div className="w-10 text-[9px] font-bold text-amber-500 text-right">القداس:</div>
                                    <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden flex">
                                        <div className="bg-amber-400 h-full rounded-full transition-all duration-1000" style={{ width: `${calcPercent(stat.liturgy)}%` }}></div>
                                    </div>
                                    <div className="w-12 text-[10px] font-black text-slate-700 text-left flex items-center justify-end gap-1">
                                        {stat.liturgy}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                    {attendanceStats.length === 0 && <p className="text-xs text-center text-slate-400 font-bold py-4">لا توجد جُمع في هذا الشهر بعد.</p>}
                </div>
            </div>

            {/* 3. ملخص الافتقاد الزمني (Timeline) */}
            <div className="bg-white p-5 rounded-3xl shadow-sm border border-emerald-100">
                <h3 className="text-sm font-black text-slate-800 mb-4 border-b border-slate-50 pb-3 flex items-center gap-2">
                    <MapPin className="text-emerald-500 w-5 h-5" /> سجل الافتقاد السريع
                </h3>

                <div className="space-y-4 max-h-60 overflow-y-auto pr-1">
                    {sortedVisitDates.length === 0 ? (
                        <p className="text-[10px] font-bold text-slate-400 text-center py-2">لم يتم تسجيل أي افتقاد مؤخراً.</p>
                    ) : (
                        sortedVisitDates.map(date => (
                            <div key={date} className="relative pl-4 border-r-2 border-emerald-200">
                                <div className="absolute w-3 h-3 bg-emerald-500 rounded-full -right-1.75 top-1 border-2 border-white shadow-sm"></div>
                                <h3 className="text-[11px] font-black text-emerald-800 mb-1 flex items-center gap-2">
                                    <Calendar size={12} /> {date} <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md text-[9px]">({visitationsByDate[date].length} مخدومين)</span>
                                </h3>
                                <p className="text-[10px] font-bold text-slate-500 leading-6">
                                    {visitationsByDate[date].join('، ')}
                                </p>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* 4. تصدير الداتا المتطور (التقسيم الجبار) */}
            <div className="bg-linear-to-br from-green-50 to-emerald-50 p-6 rounded-3xl shadow-sm border border-green-200">
                <h3 className="text-sm font-black text-green-800 mb-2 flex items-center gap-2"><FileSpreadsheet className="text-green-600 w-5 h-5" /> تصدير الداتا (Excel)</h3>
                <p className="text-[10px] font-bold text-green-700/80 mb-5">اختر الفئة اللي عايز تطبعها أو تبعتها لخدامها.</p>

                <div className="flex flex-col gap-3">
                    <button onClick={() => handleExport('all')} className="w-full bg-green-600 text-white py-3.5 rounded-xl font-black text-sm hover:bg-green-700 active:scale-95 transition-all shadow-md flex items-center justify-center gap-2">
                        <Download size={18} /> تحميل الكشف الشامل (الكل)
                    </button>

                    <div className="flex gap-3">
                        <button onClick={() => handleExport('boys')} className="flex-1 bg-blue-500 text-white py-3 rounded-xl font-black text-xs hover:bg-blue-600 active:scale-95 transition-all shadow-md flex items-center justify-center gap-1.5">
                            <Users size={15} /> كشف الولاد
                        </button>
                        <button onClick={() => handleExport('girls')} className="flex-1 bg-pink-500 text-white py-3 rounded-xl font-black text-xs hover:bg-pink-600 active:scale-95 transition-all shadow-md flex items-center justify-center gap-1.5">
                            <Users size={15} /> كشف البنات
                        </button>
                    </div>
                </div>
            </div>

            {/* 5. منطقة الخطر (التنظيف) */}
            {isMaster && (
                <div className="bg-red-50 p-6 rounded-3xl border border-red-100 mt-10">
                    <h3 className="text-sm font-black text-red-800 mb-1 flex items-center gap-2">
                        <AlertTriangle className="text-red-500" size={16} /> منطقة تنظيف البيانات للفصل
                    </h3>
                    <p className="text-[10px] font-bold text-red-600/80 mb-4">احذر: استخدام هذه الأزرار سيؤدي لمسح البيانات من جهازك.</p>

                    <div className="flex flex-col gap-2">
                        <button
                            onClick={handleCleanupDuplicateAttendance}
                            disabled={isCleaningUp}
                            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-black text-xs hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                        >
                            <RefreshCw size={15} /> تنظيف وتصحيح سجلات الحضور المكررة
                        </button>

                        <button onClick={handleGlobalReset} className="w-full bg-amber-500 text-white py-3 rounded-xl font-black text-xs hover:bg-amber-600 transition-all flex items-center justify-center gap-2 shadow-sm">
                            <RefreshCw size={16} /> تصفير العدادات للفصل (لبداية شهر جديد)
                        </button>

                        <button onClick={handleNuclearDelete} className="w-full bg-red-600 text-white py-3 rounded-xl font-black text-xs hover:bg-red-700 transition-all flex items-center justify-center gap-2 shadow-sm">
                            <Trash2 size={16} /> مسح المخدومين والغياب للفصل
                        </button>
                    </div>
                </div>
            )}
            </>
            )}
        </div>
    );
}

function KidsManagerView({ childrenData, activeClassSyncKey = '', activeClassOsraName = '' }) {
    const { triggerAutoSync } = useAutoSync();
    const [search, setSearch] = useState("");
    const [genderFilter, setGenderFilter] = useState("all");
    const [editingChild, setEditingChild] = useState(null);
    const [isAdding, setIsAdding] = useState(false);

    const filtered = (childrenData || []).filter(c => {
        const matchesSearch = (c.name || '').includes(search);
        const matchesGender = genderFilter === "all" ? true : c.gender === (genderFilter === "boys" ? "ولد" : "بنت");
        return matchesSearch && matchesGender;
    });

    const getDisplayPhone = (c) => {
        if (c.whatsappTarget === 'child' && c.childPhone) return `مخدوم: ${c.childPhone}`;
        if (c.whatsappTarget === 'father' && c.fatherPhone) return `الأب: ${c.fatherPhone}`;
        if (c.whatsappTarget === 'mother' && c.motherPhone) return `الأم: ${c.motherPhone}`;
        
        if (c.childPhone) return `مخدوم: ${c.childPhone}`;
        if (c.fatherPhone) return `الأب: ${c.fatherPhone}`;
        if (c.motherPhone) return `الأم: ${c.motherPhone}`;
        if (c.phone) return `هاتف: ${c.phone}`;
        return 'لا يوجد تليفون';
    };

    const handleDelete = async (id) => {
        const childToDelete = childrenData?.find(c => c.id === id) || await db.children.get(id);
        const childName = childToDelete?.name || id;
        if (window.confirm(`متأكد إنك عايز تمسح المخدوم (${childName}) نهائياً؟`)) {
            if (editingChild?.id === id) {
                setEditingChild(null);
            }
            const deletion = await deleteChildEverywhere(childToDelete, JSON.parse(readScopedStorage('currentServant') || '{}').name);
            if (deletion.pendingSync) alert('تم الحذف على هذا الجهاز؛ سيصل للأجهزة الأخرى عند اكتمال المزامنة.');
            triggerAutoSync();
        }
    };

    if (isAdding || editingChild) {
        const activeTargetSyncKey =
            editingChild?.syncKey ||
            getImpersonatedOsra()?.syncKey ||
            readScopedStorage('currentSyncKey');

        return (
            <StudentFormModal
                embedded
                editingChild={editingChild}
                initialSyncKey={activeTargetSyncKey}
                onClose={() => {
                    setIsAdding(false);
                    setEditingChild(null);
                }}
                onSaved={() => {
                    setIsAdding(false);
                    setEditingChild(null);
                }}
            />
        );
    }

    return (
        <div className="animate-in slide-in-from-right-8 duration-300 space-y-5">
            {/* شريط مرايا المخدومين الموحد: إضافة مخدوم + تمبليت Excel + استيراد وتصدير الفصل */}
            <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <h2 className="font-calligraphic text-xl font-bold text-[#1B2A59] flex items-center gap-2">
                            <Users size={20} className="text-[#8C621E]" />
                            <span>مرايا المخدومين {activeClassOsraName ? `— ${activeClassOsraName}` : ''}</span>
                        </h2>
                        <p className="text-xs font-bold text-[#6E5329]">
                            إضافة وتعديل بيانات المخدومين، تنزيل تمبليت الإكسيل، واستيراد وتصدير شيت الفصل
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsAdding(true)}
                        aria-label="إضافة مخدوم جديد"
                        className="px-5 py-3 rounded-2xl font-black text-xs sm:text-sm text-[#FCE9B8] shadow-md hover:brightness-110 transition-all flex items-center justify-center gap-2 shrink-0 cursor-pointer border border-[#C8942E]/40"
                        style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 65%, #8C621E 100%)' }}
                    >
                        <UserPlus size={18} className="text-[#F4D078]" />
                        <span>إضافة مخدوم جديد</span>
                    </button>
                </div>

                <ClassExcelToolbar syncKey={activeClassSyncKey} osraName={activeClassOsraName} />
            </div>

            <div className="space-y-4">
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C7D68]" />
                        <input type="text" placeholder="ابحث لتعديل البيانات..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pr-10 pl-4 py-3 rounded-2xl coptic-cream-input font-bold shadow-sm" />
                    </div>
                </div>

                <div className="flex gap-2 justify-center">
                    {[{ id: "boys", label: "ولاد" }, { id: "girls", label: "بنات" }].map(f => (
                        <button key={f.id} onClick={() => setGenderFilter(f.id)} className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${genderFilter === f.id ? "bg-[#1B2A59] text-[#F4D078] shadow-md" : "bg-[#FFFDF7] text-[#5E5242] border border-[#E3D6BF]"}`}>{f.label}</button>
                    ))}
                </div>
            </div>

            <div className="space-y-3">
                {filtered.length === 0 ? (
                    <div className="text-center py-10 text-[#6E604F] font-bold bg-[#FAF4E8]/60 rounded-3xl border border-dashed border-[#DFC99B]">لا يوجد مخدومين بهذا الاسم.</div>
                ) : (
                    filtered.slice(0, 50).map(child => (
                        <div key={child.id} className="coptic-card p-4 rounded-2xl shadow-sm flex flex-col gap-3">
                            <div className="flex justify-between items-start">
                                <div className="flex items-center gap-3">
                                    <div className="relative w-12 h-12 bg-[#F5EBD6] rounded-full flex items-center justify-center text-xl overflow-hidden shadow-inner">
                                        {child.profilePic ? (
                                            <img 
                                                src={child.profilePic} 
                                                width="48" 
                                                height="48" 
                                                loading="lazy" 
                                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                className="w-full h-full object-cover" 
                                                alt={child.name} 
                                            />
                                        ) : (<User size={22} className="text-[#1B2A59]" />)}

                                    </div>
                                    <div>
                                        <h3 className="font-black text-sm text-[#1B2A59]">{child.name}</h3>
                                        <p className="text-[10px] font-bold text-[#6E604F] mt-0.5 flex gap-2">
                                            <span className="flex items-center gap-0.5"><MapPin size={10} /> {child.address || 'بدون منطقة'}</span>
                                            <span className="flex items-center gap-0.5"><Phone size={10} /> {getDisplayPhone(child)}</span>
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-2 border-t border-[#EDE3CE] pt-3 mt-1">
                                <button onClick={() => setEditingChild(child)} className="flex-1 bg-[#FAF4E8] text-[#1B2A59] border border-[#E5D7BF] py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1 hover:bg-[#F5EBD6] cursor-pointer"><Edit3 size={14} /> تعديل شامل</button>
                                <button onClick={() => handleDelete(child.id)} className="flex-1 bg-rose-50 text-rose-600 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1 hover:bg-rose-100 cursor-pointer"><Trash2 size={14} /> مسح</button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

function ActivitiesView() {
    const { triggerAutoSync } = useAutoSync();
    const currentSyncKey = readScopedStorage('currentSyncKey');
    const activities = useLiveQuery(() => 
        db.activities.filter(a => a.syncKey === currentSyncKey && !a.isDeleted).toArray()
    ) || [];

    const [newActivity, setNewActivity] = useState('');
    const [newActivityType, setNewActivityType] = useState('targeted');

    const targetedActivities = activities.filter(a => a.type === 'targeted');
    const executedActivities = activities.filter(a => a.type === 'executed');

    const handleAddActivity = async () => {
        if (!newActivity.trim()) return;
        const now = new Date().toISOString();
        const newAct = {
            id: Date.now().toString(),
            syncKey: currentSyncKey,
            text: newActivity.trim(),
            type: newActivityType,
            isDirty: true,
            updatedAt: now,
            isDeleted: false
        };
        await db.activities.add(newAct);
        setNewActivity('');
        triggerAutoSync();
    };

    const handleDeleteActivity = async (id) => {
        if (!window.confirm("متأكد من مسح هذا النشاط؟")) return;
        const now = new Date().toISOString();
        await db.activities.update(id, { isDeleted: true, isDirty: true, updatedAt: now });
        triggerAutoSync();
    };

    const handleMoveToExecuted = async (id) => {
        const now = new Date().toISOString();
        await db.activities.update(id, { type: 'executed', isDirty: true, updatedAt: now });
        triggerAutoSync();
    };

    const handleEditActivity = async (id, oldText) => {
        const newText = prompt("تعديل النشاط:", oldText);
        if (newText && newText.trim() && newText.trim() !== oldText) {
            const now = new Date().toISOString();
            await db.activities.update(id, { text: newText.trim(), isDirty: true, updatedAt: now });
            triggerAutoSync();
        }
    };

    return (
        <div className="animate-in slide-in-from-bottom-4 duration-300">
            <div className="bg-white border border-slate-200 p-4 sm:p-6 rounded-3xl shadow-sm overflow-hidden">
                <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2">
                    <Target className="text-indigo-500" size={24} /> متابعة أنشطة الأسرة
                </h3>

                <div className="flex flex-col sm:flex-row gap-2 mb-6">
                    <select 
                        value={newActivityType} 
                        onChange={(e) => setNewActivityType(e.target.value)}
                        className="w-full sm:w-auto shrink-0 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none"
                    >
                        <option value="targeted">مستهدف</option>
                        <option value="executed">منفذ</option>
                    </select>
                    <input 
                        type="text" 
                        placeholder="أضف نشاطاً جديداً للأسرة..." 
                        value={newActivity} 
                        onChange={(e) => setNewActivity(e.target.value)}
                        className="w-full min-w-0 flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddActivity()}
                    />
                    <button 
                        onClick={handleAddActivity}
                        className="w-full sm:w-auto shrink-0 bg-indigo-600 text-white px-6 py-3 rounded-xl font-black hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
                    >
                        <Plus size={20} /> إضافة
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Targeted */}
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                        <h4 className="font-black text-slate-700 mb-4 flex items-center gap-2">
                            <Target size={18} className="text-blue-500" /> الأنشطة المستهدفة للأسرة
                        </h4>
                        <div className="space-y-3">
                            {targetedActivities.length === 0 ? (
                                <p className="text-xs text-slate-400 font-bold text-center">لا توجد أنشطة مستهدفة.</p>
                            ) : (
                                targetedActivities.map(act => (
                                    <div key={act.id} className="bg-white p-3 rounded-xl shadow-sm border border-slate-200 flex items-center justify-between gap-3 group">
                                        <p className="text-sm font-bold text-slate-700 flex-1">{act.text}</p>
                                        <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handleMoveToExecuted(act.id)} className="w-8 h-8 rounded-lg bg-green-50 text-green-600 flex items-center justify-center hover:bg-green-100" title="نقل إلى المنفذ">
                                                <CheckSquare size={16} />
                                            </button>
                                            <button onClick={() => handleEditActivity(act.id, act.text)} className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-100">
                                                <Edit3 size={14} />
                                            </button>
                                            <button onClick={() => handleDeleteActivity(act.id)} className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center hover:bg-red-100">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Executed */}
                    <div className="bg-green-50/30 p-4 rounded-2xl border border-green-100">
                        <h4 className="font-black text-slate-700 mb-4 flex items-center gap-2">
                            <CheckCircle size={18} className="text-green-500" /> الأنشطة المنفذة
                        </h4>
                        <div className="space-y-3">
                            {executedActivities.length === 0 ? (
                                <p className="text-xs text-slate-400 font-bold text-center">لا توجد أنشطة منفذة.</p>
                            ) : (
                                executedActivities.map(act => (
                                    <div key={act.id} className="bg-white p-3 rounded-xl shadow-sm border border-green-200 flex items-center justify-between gap-3 group">
                                        <div className="flex items-center gap-2 flex-1">
                                            <CheckCircle size={20} className="text-green-600 shrink-0" />
                                            <p className="text-sm font-bold text-slate-800">{act.text}</p>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handleEditActivity(act.id, act.text)} className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-100">
                                                <Edit3 size={14} />
                                            </button>
                                            <button onClick={() => handleDeleteActivity(act.id)} className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center hover:bg-red-100">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}


