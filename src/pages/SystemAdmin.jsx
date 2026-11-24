/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { uploadImageToCloudinary, uploadImageWithFallback } from '../utils/cloudinary';
import {
    ShieldAlert, Key, Church, ImagePlus, Lock,
    Trash2, Save, Users, UserPlus, ArrowRight,
    Layers, PlusCircle, FileText, UserCircle, Loader2, BookOpen, X,
    MessageCircle, CheckCircle, XCircle, Clock, WifiOff, Edit3,
    Sparkles, Calendar, Upload, ExternalLink, Plus, Tag, FolderOpen,
    Copy, RefreshCw, RotateCcw
} from 'lucide-react';

// استدعاءات الفايربيز وقاعدة البيانات
import { collection, getDocs, doc, deleteDoc, setDoc, getDoc, addDoc } from 'firebase/firestore';
import { firestore, isFirebaseConfigured } from '../db/firebase';
import { db } from '../db/database';
import { logActivity } from '../utils/activityLogger';
import EditServantModal from '../components/EditServantModal';
import {
    TENANT_CONFIG,
    getLogoUrl,
    readScopedStorage,
    writeScopedStorage,
    removeScopedStorage
} from '../utils/tenantConfig';
import {
    sanitizeChurchServices,
    sanitizeAuthorizedServants
} from '../utils/churchStructureSanitizer';
import {
    DEFAULT_CHURCH_LOGO_PATH,
    generateUniqueOsraKey,
    collectExistingOsraKeys,
    hasCustomOsraLogo,
    resolveOsraLogoUrl
} from '../utils/realChurchStructure';
import {
    buildServantApprovalWhatsAppUrl,
    resolveServantWhatsappContext
} from '../utils/whatsappHelper';
import { WEEK_DAYS_LIST, buildScheduleLabel, getClassScheduleConfig } from '../utils/serviceWeek';
import {
    CURRICULUM_CATEGORIES,
    CURRICULUM_STATUSES,
    hydrateServicesWithCurricula,
    getOsraCurricula,
    saveOsraCurriculumItem,
    deleteOsraCurriculumItem,
    isPdfCurriculumItem,
    getItemAttachmentUrl,
    readFileAsAttachment,
    syncAllServicesCurriculaToDb,
    openCurriculumAttachment,
    sanitizeServicesForCloud
} from '../utils/curriculumEngine';

import { useSmartNavigation } from '../hooks/useSmartNavigation';

const EMPTY_CURRICULUM_ITEM = {
    id: null,
    title: '',
    category: CURRICULUM_CATEGORIES[0],
    fileUrl: '',
    pdfData: '',
    fileName: '',
    description: '',
    status: CURRICULUM_STATUSES[0]
};

/**
 * محرر تفاعلي لأيام الخدمة الأسبوعية وأيام القداس المخصصة لكل خدمة أو فصل
 */
function ScheduleDayPicker({
    serviceDays = [],
    liturgyDays = [],
    onChange,
    disabled = false,
    compact = false,
    useCustomSchedule = null,
    onToggleInheritance = null
}) {
    const safeServiceDays = Array.isArray(serviceDays) ? serviceDays : [];
    const safeLiturgyDays = Array.isArray(liturgyDays) ? liturgyDays : [];
    const previewLabel = buildScheduleLabel(safeServiceDays, safeLiturgyDays);

    const toggleDay = (list, dayKey, allowEmpty = false) => {
        if (disabled) return;
        const exists = list.includes(dayKey);
        if (exists && !allowEmpty && list.length <= 1) return; // Require at least 1 service day
        const next = exists ? list.filter(k => k !== dayKey) : [...list, dayKey];
        return next;
    };

    return (
        <div className={`rounded-2xl border border-[#DFC48F] bg-[#FFFDF7] ${compact ? 'p-3 space-y-2.5' : 'p-4 space-y-3'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-black text-[#1B2A59] flex items-center gap-1.5">
                    <Calendar size={13} className="text-[#8C621E]" />
                    <span>مواعيد الخدمة والقداس الأسبوعية:</span>
                </span>
                <span className="text-[10px] font-black bg-[#1B2A59] text-amber-200 px-2.5 py-0.5 rounded-full">
                    {previewLabel}
                </span>
            </div>

            {typeof useCustomSchedule === 'boolean' && onToggleInheritance && !disabled && (
                <div className="flex flex-wrap items-center gap-1.5 bg-[#FAF3E3] p-1 rounded-xl border border-[#E7D4AF]">
                    <button
                        type="button"
                        onClick={() => onToggleInheritance(false)}
                        className={`flex-1 py-1 px-2.5 rounded-lg text-[10px] font-black transition-all cursor-pointer ${
                            !useCustomSchedule
                                ? 'bg-[#1B2A59] text-amber-200 shadow-2xs'
                                : 'text-[#6E5329] hover:text-[#1B2A59]'
                        }`}
                    >
                        يرث مواعيد الخدمة الأم
                    </button>
                    <button
                        type="button"
                        onClick={() => onToggleInheritance(true)}
                        className={`flex-1 py-1 px-2.5 rounded-lg text-[10px] font-black transition-all cursor-pointer ${
                            useCustomSchedule
                                ? 'bg-[#8C621E] text-white shadow-2xs'
                                : 'text-[#6E5329] hover:text-[#1B2A59]'
                        }`}
                    >
                        تخصيص جدول مستقل للفصل
                    </button>
                </div>
            )}

            <div className="space-y-1.5">
                <span className="block text-[10px] font-black text-[#6E5329]">
                    أيام الاجتماع / الخدمة الأسبوعية:
                </span>
                <div className="flex flex-wrap gap-1.5">
                    {WEEK_DAYS_LIST.map((day) => {
                        const active = safeServiceDays.includes(day.key);
                        return (
                            <button
                                key={`srv_${day.key}`}
                                type="button"
                                disabled={disabled}
                                onClick={() => {
                                    const nextServiceDays = toggleDay(safeServiceDays, day.key, false);
                                    if (nextServiceDays) {
                                        onChange({ serviceDays: nextServiceDays, liturgyDays: safeLiturgyDays });
                                    }
                                }}
                                className={`px-2.5 py-1 rounded-xl text-[11px] font-black border transition-all ${
                                    disabled ? 'opacity-65 cursor-not-allowed' : 'cursor-pointer'
                                } ${
                                    active
                                        ? 'bg-emerald-700 text-white border-emerald-800 shadow-xs'
                                        : 'bg-[#FAF4E8] text-[#6E5329] border-[#DFC48F] hover:border-[#8C621E]'
                                }`}
                            >
                                {day.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="space-y-1.5">
                <span className="block text-[10px] font-black text-[#6E5329]">
                    أيام القداس المخصصة للفصل (اختياري):
                </span>
                <div className="flex flex-wrap gap-1.5">
                    {WEEK_DAYS_LIST.map((day) => {
                        const active = safeLiturgyDays.includes(day.key);
                        return (
                            <button
                                key={`lit_${day.key}`}
                                type="button"
                                disabled={disabled}
                                onClick={() => {
                                    const nextLiturgyDays = toggleDay(safeLiturgyDays, day.key, true);
                                    if (nextLiturgyDays) {
                                        onChange({ serviceDays: safeServiceDays, liturgyDays: nextLiturgyDays });
                                    }
                                }}
                                className={`px-2.5 py-1 rounded-xl text-[11px] font-black border transition-all ${
                                    disabled ? 'opacity-65 cursor-not-allowed' : 'cursor-pointer'
                                } ${
                                    active
                                        ? 'bg-[#1B2A59] text-amber-300 border-[#1B2A59] shadow-xs'
                                        : 'bg-[#FAF4E8] text-[#6E5329] border-[#DFC48F] hover:border-[#1B2A59]'
                                }`}
                            >
                                قداس {day.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

const getSettings = () => {
    const defaults = {
        secretPass: "1234",
        deletePass: "مسح",
        adminPass: "admin",
        appUrl: window.location.origin,
        services: [],
        servants: []
    };
    const saved = readScopedStorage('appSettings');
    if (saved) {
        try {
            const parsed = { ...defaults, ...JSON.parse(saved) };
            const cleanServices = sanitizeChurchServices(parsed.services || [], []);
            parsed.services = hydrateServicesWithCurricula(cleanServices);
            const rawServants = Array.isArray(parsed.servants)
                ? parsed.servants
                : (Array.isArray(parsed.authorizedServants) ? parsed.authorizedServants : []);
            parsed.servants = sanitizeAuthorizedServants(rawServants, cleanServices, {
                fallbackToOfficial: false
            });
            writeScopedStorage('appSettings', JSON.stringify(parsed));
            return parsed;
        } catch (e) {
            console.error("Error parsing settings", e);
        }
    }
    return defaults;
};

export default function SystemAdmin() {
    const { goBack } = useSmartNavigation();
    const navigate = useNavigate();
    const [appSettings, setAppSettings] = useState(getSettings());
    const [isAdminAuth, setIsAdminAuth] = useState(false);
    const [temporarySuperAdmin, setTemporarySuperAdmin] = useState(false);
    const [adminPasswordInput, setAdminPasswordInput] = useState("");
    const [form, setForm] = useState(getSettings());
    const [newServant, setNewServant] = useState({ name: '', role: 'خادم', email: '', phone: '', assignedOsra: '', syncKey: '', password: '', allowedClasses: [] });
    const [editingServant, setEditingServant] = useState(null);

    const [curriculumModal, setCurriculumModal] = useState({ isOpen: false, sId: null, oId: null, osraName: '', syncKey: '' });
    const [curriculumForm, setCurriculumForm] = useState(EMPTY_CURRICULUM_ITEM);
    const [curriculumNotice, setCurriculumNotice] = useState('');
    const [isUploadingPdf, setIsUploadingPdf] = useState(false);
    const allDbCurricula = useLiveQuery(() => db.curricula.toArray(), [], []);

    const [isSavingToCloud, setIsSavingToCloud] = useState(false);
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    const [joinRequests, setJoinRequests] = useState([]);
    const [isLoadingRequests, setIsLoadingRequests] = useState(false);

    const currentSyncKey = readScopedStorage('currentSyncKey');
    const currentServant = JSON.parse(readScopedStorage('currentServant') || '{}');

    const isSuperAdmin = temporarySuperAdmin || currentSyncKey === 'MASTER_ACCESS' || currentSyncKey === 'ADMIN_MODE' || currentServant.role === 'أدمن مساعد';
    const isPriest = currentServant.role === 'كاهن';
    const isAmin = currentServant.role === 'أمين خدمة' || currentServant.role === 'أمين أسرة';

    useEffect(() => {
        if (isSuperAdmin || isPriest || isAmin) {
            setIsAdminAuth(true);
        }

        const handleOnline = async () => {
            setIsOnline(true);
            if (readScopedStorage('pendingStructureSync') === 'true' && firestore) {
                const saved = JSON.parse(readScopedStorage('appSettings') || 'null');
                if (saved) {
                    try {
                        const sanitizedServicesInput = sanitizeChurchServices(saved.services || [], []);
                        const cleanServices = sanitizeServicesForCloud(JSON.parse(JSON.stringify(sanitizedServicesInput)));
                        const cleanServants = sanitizeAuthorizedServants(saved.servants || [], sanitizedServicesInput, {
                            fallbackToOfficial: false
                        });
                        await setDoc(doc(firestore, "System", "mainConfig"), {
                            services: cleanServices,
                            servants: cleanServants,
                            updatedAt: new Date().toISOString()
                        }, { merge: true });
                        removeScopedStorage('pendingStructureSync');
                    } catch (e) { console.error("Auto-sync failed", e); }
                }
            }
        };
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [isSuperAdmin, isPriest, isAmin]);

    useEffect(() => {
        if (isAdminAuth) {
            const fetchJoinRequests = async () => {
                if (!navigator.onLine || !firestore) return;
                setIsLoadingRequests(true);
                try {
                    const querySnapshot = await getDocs(collection(firestore, "JoinRequests"));
                    const requests = [];
                    querySnapshot.forEach((doc) => {
                        requests.push({ id: doc.id, ...doc.data() });
                    });
                    setJoinRequests(requests);
                } catch (error) {
                    console.error("خطأ في جلب الطلبات:", error);
                }
                setIsLoadingRequests(false);
            };
            fetchJoinRequests();
        }
    }, [isAdminAuth]);

    // Auto-Pull: سحب الهيكل المركزي تلقائياً عند فتح الصفحة
    useEffect(() => {
        const autoFetchStructure = async () => {
            if (!navigator.onLine || !firestore) return;
            try {
                const snap = await getDoc(doc(firestore, "System", "mainConfig"));
                if (!snap.exists()) return;
                const cloudData = snap.data();
                const localSettingsString = readScopedStorage('appSettings');
                const localParsed = JSON.parse(localSettingsString || '{}');
                const cloudServicesRaw = Array.isArray(cloudData.services) ? cloudData.services : (localParsed.services || []);
                const cleanServices = sanitizeChurchServices(cloudServicesRaw, []);
                const mergedServices = hydrateServicesWithCurricula(cleanServices);
                const cloudServantsRaw = Array.isArray(cloudData.servants)
                    ? cloudData.servants
                    : (Array.isArray(cloudData.authorizedServants) ? cloudData.authorizedServants : (localParsed.servants || []));
                const cleanServants = sanitizeAuthorizedServants(
                    cloudServantsRaw,
                    cleanServices,
                    { fallbackToOfficial: false }
                );
                const mergedSettings = { ...localParsed, ...cloudData, services: mergedServices, servants: cleanServants };
                setAppSettings(mergedSettings);
                setForm(mergedSettings);
                writeScopedStorage('appSettings', JSON.stringify(mergedSettings));
                console.log('[SystemAdmin] Auto-pulled structure from cloud.');
            } catch (e) {
                console.warn('[SystemAdmin] Auto-pull failed (offline?):', e.message);
            }
        };
        if (isAdminAuth) autoFetchStructure();
    }, [isAdminAuth]);

    const updateSettings = async (newSettings) => {
        const sanitizedServices = sanitizeChurchServices(newSettings.services || [], []);
        const sanitizedServants = sanitizeAuthorizedServants(newSettings.servants || [], sanitizedServices, {
            fallbackToOfficial: false
        });
        const hydratedSettings = {
            ...newSettings,
            services: hydrateServicesWithCurricula(sanitizedServices),
            servants: sanitizedServants
        };
        setAppSettings(hydratedSettings);
        setForm(hydratedSettings);

        writeScopedStorage('appSettings', JSON.stringify(hydratedSettings));
        const nowIso = new Date().toISOString();
        if (db?.appSettings) {
            await db.appSettings.put({
                id: 'mainConfig',
                services: hydratedSettings.services,
                servants: hydratedSettings.servants,
                updatedAt: nowIso
            }).catch(() => {});
        }
        await syncAllServicesCurriculaToDb(hydratedSettings.services);

        if (!firestore) {
            alert("تم حفظ هيكل الخدمات والمناهج بنجاح!");
            goBack('/');
            return;
        }

        if (!navigator.onLine) {
            writeScopedStorage('pendingStructureSync', 'true');
            alert("تم الحفظ على الموبايل فقط (أوفلاين). سيتم الرفع للسحابة تلقائياً فور عودة الإنترنت!");
            goBack('/');
            return;
        }

        setIsSavingToCloud(true);
        try {
            const cleanServices = sanitizeServicesForCloud(JSON.parse(JSON.stringify(hydratedSettings.services || [])));
            const cleanServants = JSON.parse(JSON.stringify(hydratedSettings.servants || []));
            await setDoc(doc(firestore, "System", "mainConfig"), {
                khedmaName: hydratedSettings.khedmaName || TENANT_CONFIG.churchName,
                osraName: hydratedSettings.osraName || TENANT_CONFIG.churchName,
                secretPass: hydratedSettings.secretPass || "1234",
                deletePass: hydratedSettings.deletePass || "مسح",
                adminPass: hydratedSettings.adminPass || "admin",
                services: cleanServices,
                servants: cleanServants,
                updatedAt: nowIso
            }, { merge: true });
            removeScopedStorage('pendingStructureSync');
            logActivity('SAVE_STRUCTURE', `حفظ هيكل الخدمة (${cleanServices.length} خدمة، ${cleanServants.length} خادم) ورفعه للسحابة`);
            alert("تم حفظ هيكل الخدمات والمناهج ورفعه للسحابة بنجاح!");
            goBack('/');
        } catch (e) {
            console.error("Firebase Save Error:", e);
            writeScopedStorage('pendingStructureSync', 'true');
            alert("فشل الرفع للسحابة: " + (e.message || "تأكد من إعدادات فايربيز"));
        } finally {
            setIsSavingToCloud(false);
        }
    };

    const handleSave = (e) => {
        e.preventDefault();
        updateSettings(form);
    };

    const visibleServices = form.services?.filter(service => {
        if (isSuperAdmin) return true;
        return service.osras.some(osra => osra.syncKey === currentSyncKey);
    });

    const handleAddService = () => {
        const defaultServiceDays = ['friday'];
        const defaultLiturgyDays = ['friday'];
        const newService = {
            id: Date.now(),
            name: '',
            priest: '',
            logo: '',
            serviceDays: defaultServiceDays,
            liturgyDays: defaultLiturgyDays,
            scheduleLabel: buildScheduleLabel(defaultServiceDays, defaultLiturgyDays),
            osras: []
        };
        setForm({ ...form, services: [...form.services, newService] });
    };

    const handleUpdateService = (sId, field, value) => {
        const updatedServices = form.services.map(s => s.id === sId ? { ...s, [field]: value } : s);
        setForm({ ...form, services: updatedServices });
    };

    const handleUpdateServiceSchedule = (sId, { serviceDays, liturgyDays }) => {
        const nextLabel = buildScheduleLabel(serviceDays, liturgyDays);
        const updatedServices = form.services.map((s) => {
            if (s.id !== sId) return s;
            const nextOsras = (s.osras || []).map((o) => {
                if (o.useCustomSchedule) return o;
                return {
                    ...o,
                    serviceDays: [...serviceDays],
                    liturgyDays: [...liturgyDays],
                    scheduleLabel: nextLabel
                };
            });
            return {
                ...s,
                serviceDays: [...serviceDays],
                liturgyDays: [...liturgyDays],
                scheduleLabel: nextLabel,
                osras: nextOsras
            };
        });
        setForm({ ...form, services: updatedServices });
    };

    const handleDeleteService = (sId) => {
        if (window.confirm("متأكد إنك عايز تمسح الخدمة دي؟ كل أسرها والخدام بتوعها هيتطردوا من النظام!")) {
            const serviceToDelete = form.services.find(s => s.id === sId);
            const osrasNamesInService = serviceToDelete ? serviceToDelete.osras.map(o => o.name) : [];
            const updatedServices = form.services.filter(s => s.id !== sId);
            const updatedServants = form.servants.filter(servant => !osrasNamesInService.includes(servant.assignedOsra));
            setForm({ ...form, services: updatedServices, servants: updatedServants });
        }
    };

    const handleAddOsra = (serviceId) => {
        const parentSvc = form.services.find(s => s.id === serviceId);
        const fallbackSched = getClassScheduleConfig(parentSvc?.osras?.[0]?.syncKey, parentSvc?.name || '', form);
        const parentServiceDays = Array.isArray(parentSvc?.serviceDays) && parentSvc.serviceDays.length > 0
            ? parentSvc.serviceDays
            : fallbackSched.serviceDays;
        const parentLiturgyDays = Array.isArray(parentSvc?.liturgyDays)
            ? parentSvc.liturgyDays
            : fallbackSched.liturgyDays;

        const existingKeys = collectExistingOsraKeys(form.services || []);
        const generatedOsraKey = generateUniqueOsraKey(parentSvc?.name || 'CLS', existingKeys);

        const newOsra = {
            id: Date.now(),
            name: '',
            amin: '',
            syncKey: '',
            osraKey: generatedOsraKey,
            secretKey: generatedOsraKey,
            defaultLogo: DEFAULT_CHURCH_LOGO_PATH,
            logo: DEFAULT_CHURCH_LOGO_PATH,
            customLogoUrl: '',
            logoUrl: '',
            serviceDays: [...parentServiceDays],
            liturgyDays: [...parentLiturgyDays],
            scheduleLabel: buildScheduleLabel(parentServiceDays, parentLiturgyDays),
            useCustomSchedule: false,
            curriculumName: '',
            pdfUrl: '',
            curricula: [],
            lessons: []
        };
        const updatedServices = form.services.map(s => {
            if (s.id === serviceId) return { ...s, osras: [...s.osras, newOsra] };
            return s;
        });
        setForm({ ...form, services: updatedServices });
    };

    const handleUpdateOsra = (serviceId, osraId, field, value) => {
        const updatedServices = form.services.map(s => {
            if (s.id === serviceId) {
                const updatedOsras = s.osras.map(o => o.id === osraId ? { ...o, [field]: value } : o);
                return { ...s, osras: updatedOsras };
            }
            return s;
        });
        setForm({ ...form, services: updatedServices });
    };

    const handleUpdateOsraSchedule = (serviceId, osraId, { serviceDays, liturgyDays, useCustomSchedule = true }) => {
        const nextLabel = buildScheduleLabel(serviceDays, liturgyDays);
        const updatedServices = form.services.map((s) => {
            if (s.id !== serviceId) return s;
            const updatedOsras = (s.osras || []).map((o) => {
                if (o.id !== osraId) return o;
                return {
                    ...o,
                    useCustomSchedule,
                    serviceDays: [...serviceDays],
                    liturgyDays: [...liturgyDays],
                    scheduleLabel: nextLabel
                };
            });
            return { ...s, osras: updatedOsras };
        });
        setForm({ ...form, services: updatedServices });
    };

    const handleToggleOsraInheritance = (serviceId, osraId, enableCustom) => {
        const parentSvc = form.services.find(s => s.id === serviceId);
        const fallbackSched = getClassScheduleConfig(parentSvc?.osras?.[0]?.syncKey, parentSvc?.name || '', form);
        const parentServiceDays = Array.isArray(parentSvc?.serviceDays) && parentSvc.serviceDays.length > 0
            ? parentSvc.serviceDays
            : fallbackSched.serviceDays;
        const parentLiturgyDays = Array.isArray(parentSvc?.liturgyDays)
            ? parentSvc.liturgyDays
            : fallbackSched.liturgyDays;

        const targetOsra = parentSvc?.osras?.find(o => o.id === osraId);
        if (!enableCustom) {
            handleUpdateOsraSchedule(serviceId, osraId, {
                serviceDays: parentServiceDays,
                liturgyDays: parentLiturgyDays,
                useCustomSchedule: false
            });
        } else {
            const currentSched = getClassScheduleConfig(targetOsra || '', targetOsra?.name || parentSvc?.name || '', form);
            handleUpdateOsraSchedule(serviceId, osraId, {
                serviceDays: targetOsra?.serviceDays?.length ? targetOsra.serviceDays : currentSched.serviceDays,
                liturgyDays: Array.isArray(targetOsra?.liturgyDays) ? targetOsra.liturgyDays : currentSched.liturgyDays,
                useCustomSchedule: true
            });
        }
    };

    const handleDeleteOsra = (serviceId, osraId) => {
        if (window.confirm("متأكد إنك عايز تمسح الأسرة دي؟ كل الخدام اللي فيها هيتطردوا فوراً!")) {
            let osraNameToDelete = "";
            const updatedServices = form.services.map(s => {
                if (s.id === serviceId) {
                    const osraToDelete = s.osras.find(o => o.id === osraId);
                    if (osraToDelete) osraNameToDelete = osraToDelete.name;
                    return { ...s, osras: s.osras.filter(o => o.id !== osraId) };
                }
                return s;
            });
            const updatedServants = form.servants.filter(servant => servant.assignedOsra !== osraNameToDelete);
            setForm({ ...form, services: updatedServices, servants: updatedServants });
        }
    };

    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [copiedKeyId, setCopiedKeyId] = useState('');
    const [newlyApprovedServant, setNewlyApprovedServant] = useState(null);

    const persistSettingsQuietly = async (nextSettings) => {
        const sanitizedServices = sanitizeChurchServices(nextSettings.services || [], []);
        const sanitizedServants = sanitizeAuthorizedServants(nextSettings.servants || [], sanitizedServices, {
            fallbackToOfficial: false
        });
        const hydrated = {
            ...nextSettings,
            services: hydrateServicesWithCurricula(sanitizedServices),
            servants: sanitizedServants
        };
        setAppSettings(hydrated);
        setForm(hydrated);
        writeScopedStorage('appSettings', JSON.stringify(hydrated));
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new Event('church-settings-updated'));
        }
        const nowIso = new Date().toISOString();
        if (db?.appSettings) {
            await db.appSettings.put({
                id: 'mainConfig',
                services: hydrated.services,
                servants: hydrated.servants,
                updatedAt: nowIso
            }).catch(() => {});
        }
        if (firestore && navigator.onLine) {
            const cleanServices = sanitizeServicesForCloud(JSON.parse(JSON.stringify(hydrated.services || [])));
            const cleanServants = JSON.parse(JSON.stringify(hydrated.servants || []));
            await setDoc(doc(firestore, "System", "mainConfig"), {
                khedmaName: hydrated.khedmaName || TENANT_CONFIG.churchName,
                osraName: hydrated.osraName || TENANT_CONFIG.churchName,
                secretPass: hydrated.secretPass || "1234",
                deletePass: hydrated.deletePass || "مسح",
                adminPass: hydrated.adminPass || "admin",
                services: cleanServices,
                servants: cleanServants,
                updatedAt: nowIso
            }, { merge: true });
            removeScopedStorage('pendingStructureSync');
        } else {
            writeScopedStorage('pendingStructureSync', 'true');
        }
        return hydrated;
    };

    const handleCopyOsraKey = async (keyValue, badgeId) => {
        const text = String(keyValue || '').trim();
        if (!text) return;
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            }
            setCopiedKeyId(String(badgeId));
            window.setTimeout(() => {
                setCopiedKeyId((cur) => (cur === String(badgeId) ? '' : cur));
            }, 1800);
        } catch (_err) {
            alert(`مفتاح الأسرة: ${text}`);
        }
    };

    const handleUpdateOsraSecretKey = (serviceId, osraId, nextKeyValue) => {
        const cleaned = String(nextKeyValue || '').trim().toUpperCase();
        const updatedServices = form.services.map((s) => {
            if (s.id !== serviceId) return s;
            return {
                ...s,
                osras: (s.osras || []).map((o) =>
                    o.id === osraId ? { ...o, osraKey: cleaned, secretKey: cleaned } : o
                )
            };
        });
        setForm({ ...form, services: updatedServices });
    };

    const handleRegenerateOsraKey = (serviceId, osraId, seedLabel = '') => {
        const existingKeys = collectExistingOsraKeys(form.services || []);
        const freshKey = generateUniqueOsraKey(seedLabel, existingKeys, true);
        handleUpdateOsraSecretKey(serviceId, osraId, freshKey);
    };

    const handleImageUpload = async (e, type, sId, oId = null) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploadingImage(true);
        try {
            const matchedService = form.services.find(s => s.id === sId);
            const matchedOsra = matchedService?.osras?.find(o => o.id === oId);
            const folderKey = type === 'osra' ? (matchedOsra?.syncKey || 'classes') : 'services';
            const url = await uploadImageWithFallback(file, { syncKey: folderKey });
            let updatedServices = form.services;
            if (type === 'service') {
                updatedServices = form.services.map((s) =>
                    s.id === sId ? { ...s, logo: url, customLogoUrl: url, logoUrl: url, defaultLogo: DEFAULT_CHURCH_LOGO_PATH } : s
                );
            } else if (type === 'osra') {
                updatedServices = form.services.map((s) => {
                    if (s.id !== sId) return s;
                    return {
                        ...s,
                        osras: (s.osras || []).map((o) =>
                            o.id === oId
                                ? { ...o, logo: url, customLogoUrl: url, logoUrl: url, defaultLogo: DEFAULT_CHURCH_LOGO_PATH }
                                : o
                        )
                    };
                });
            }
            await persistSettingsQuietly({ ...form, services: updatedServices });
        } catch (err) {
            console.error(err);
            alert("مشكلة في معالجة الصورة: " + err.message);
        } finally {
            setIsUploadingImage(false);
            e.target.value = '';
        }
    };

    const handleResetOsraLogo = async (sId, oId = null) => {
        let updatedServices = form.services;
        if (oId == null) {
            updatedServices = form.services.map((s) =>
                s.id === sId ? { ...s, logo: DEFAULT_CHURCH_LOGO_PATH, customLogoUrl: '', logoUrl: '', defaultLogo: DEFAULT_CHURCH_LOGO_PATH } : s
            );
        } else {
            updatedServices = form.services.map((s) => {
                if (s.id !== sId) return s;
                return {
                    ...s,
                    osras: (s.osras || []).map((o) =>
                        o.id === oId
                            ? { ...o, logo: DEFAULT_CHURCH_LOGO_PATH, customLogoUrl: '', logoUrl: '', defaultLogo: DEFAULT_CHURCH_LOGO_PATH }
                            : o
                    )
                };
            });
        }
        await persistSettingsQuietly({ ...form, services: updatedServices });
    };

    const openCurriculumManager = (sId, oId, osraName, syncKey = '') => {
        setCurriculumModal({ isOpen: true, sId, oId, osraName, syncKey });
        setCurriculumForm(EMPTY_CURRICULUM_ITEM);
        setCurriculumNotice('');
    };

    const flashCurriculumNotice = (msg) => {
        setCurriculumNotice(msg);
        window.clearTimeout(window.__curNoticeTimer);
        window.__curNoticeTimer = window.setTimeout(() => setCurriculumNotice(''), 3200);
    };

    const getActiveOsraContext = () => {
        if (!curriculumModal.isOpen) return { activeService: null, activeOsra: null, activeCurricula: [] };
        for (const s of (form.services || [])) {
            if (s.id === curriculumModal.sId) {
                const o = (s.osras || []).find(x => x.id === curriculumModal.oId);
                if (o) {
                    const syncKey = o.syncKey || curriculumModal.syncKey || o.name;
                    const list = getOsraCurricula(syncKey, allDbCurricula, [{ ...o, serviceName: s.name }]);
                    return { activeService: s, activeOsra: o, activeCurricula: list };
                }
            }
        }
        return { activeService: null, activeOsra: null, activeCurricula: [] };
    };

    const syncLocalStateWithServices = (updatedServices, noticeMsg) => {
        if (Array.isArray(updatedServices)) {
            const nextForm = { ...form, services: updatedServices };
            setForm(nextForm);
            setAppSettings(nextForm);
        }
        if (noticeMsg) flashCurriculumNotice(noticeMsg);
    };

    const handleCurriculumFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploadingPdf(true);
        try {
            const { activeOsra } = getActiveOsraContext();
            const targetKey = activeOsra?.syncKey || curriculumModal.syncKey || 'general';
            const attached = await readFileAsAttachment(file, {
                syncKey: targetKey,
                title: curriculumForm.title || file.name.replace(/\.[^/.]+$/, '')
            });
            setCurriculumForm(prev => ({
                ...prev,
                title: prev.title || file.name.replace(/\.[^/.]+$/, ''),
                fileUrl: attached.url,
                pdfData: attached.isLocalData ? attached.url : '',
                cloudinaryPublicId: attached.cloudinaryPublicId || prev.cloudinaryPublicId || '',
                fileName: attached.fileName
            }));
            flashCurriculumNotice(`تم تجهيز الملف: ${attached.fileName}`);
        } catch (err) {
            alert("مشكلة في معالجة الملف: " + err.message);
        } finally {
            setIsUploadingPdf(false);
            e.target.value = '';
        }
    };

    const handleSaveCurriculumItem = async (e) => {
        e.preventDefault();
        const trimmedTitle = (curriculumForm.title || curriculumForm.fileName || '').trim();
        if (!trimmedTitle) {
            alert('يرجى إدخال اسم المنهج أو الدرس أولاً.');
            return;
        }

        const { activeService, activeOsra } = getActiveOsraContext();
        const targetSyncKey = activeOsra?.syncKey || curriculumModal.syncKey;
        if (!targetSyncKey) return;

        const isEditing = Boolean(curriculumForm.id);
        const attachment = (curriculumForm.fileUrl || curriculumForm.pdfData || '').trim();
        const isPdf = isPdfCurriculumItem({ category: curriculumForm.category, fileUrl: attachment, content: curriculumForm.description });

        // Ensure current form.services exists in scoped storage before unified engine runs
        try {
            const existingRaw = JSON.parse(readScopedStorage('appSettings') || '{}');
            if (!Array.isArray(existingRaw.services) || existingRaw.services.length === 0) {
                writeScopedStorage('appSettings', JSON.stringify(form));
            }
        } catch {
            writeScopedStorage('appSettings', JSON.stringify(form));
        }

        const { updatedServices } = await saveOsraCurriculumItem(targetSyncKey, {
            id: curriculumForm.id || undefined,
            title: trimmedTitle,
            category: curriculumForm.category || CURRICULUM_CATEGORIES[0],
            itemType: isPdf ? 'pdf' : 'lesson',
            fileUrl: attachment,
            pdfData: curriculumForm.pdfData || (attachment.startsWith('data:') ? attachment : ''),
            attachmentUrl: attachment,
            cloudinaryPublicId: curriculumForm.cloudinaryPublicId || '',
            fileName: curriculumForm.fileName || '',
            content: (curriculumForm.description || '').trim(),
            description: (curriculumForm.description || '').trim(),
            status: curriculumForm.status || CURRICULUM_STATUSES[0]
        }, {
            serviceName: activeService?.name,
            firestore: isFirebaseConfigured ? firestore : null
        });

        syncLocalStateWithServices(
            updatedServices,
            isEditing ? 'تم تحديث المنهج وحفظه في الخدمة وفي صفحة الفصل!' : 'تم إضافة المنهج بنجاح وتزامن فورياً مع صفحة الأسرة!'
        );
        setCurriculumForm(EMPTY_CURRICULUM_ITEM);
    };

    const handleEditCurriculumItem = (item) => {
        setCurriculumForm({
            id: item.id,
            title: item.title || '',
            category: item.category || CURRICULUM_CATEGORIES[0],
            fileUrl: getItemAttachmentUrl(item),
            pdfData: item.pdfData || '',
            fileName: item.fileName || '',
            description: item.description || item.content || '',
            status: item.status || CURRICULUM_STATUSES[0]
        });
    };

    const handleDeleteCurriculumItem = async (curId) => {
        if (!window.confirm('هل أنت متأكد من حذف هذا المنهج من الخدمة؟')) return;
        const { activeService, activeOsra } = getActiveOsraContext();
        const targetSyncKey = activeOsra?.syncKey || curriculumModal.syncKey;
        if (!targetSyncKey) return;

        if (curriculumForm.id === curId) setCurriculumForm(EMPTY_CURRICULUM_ITEM);
        const { updatedServices } = await deleteOsraCurriculumItem(targetSyncKey, curId, {
            serviceName: activeService?.name,
            firestore: isFirebaseConfigured ? firestore : null
        });
        syncLocalStateWithServices(updatedServices, 'تم حذف المنهج ومزامنته مع صفحة الأسرة');
    };

    const handleToggleCurriculumStatus = async (curId) => {
        const { activeService, activeOsra, activeCurricula } = getActiveOsraContext();
        const targetSyncKey = activeOsra?.syncKey || curriculumModal.syncKey;
        const targetItem = activeCurricula.find(item => item.id === curId);
        if (!targetSyncKey || !targetItem) return;

        const isDone = String(targetItem.status || '').includes('تم الشرح') || String(targetItem.status || '').includes('مفعّل');
        const nextStatus = isDone ? CURRICULUM_STATUSES[1] : CURRICULUM_STATUSES[0];
        const { updatedServices } = await saveOsraCurriculumItem(targetSyncKey, {
            ...targetItem,
            status: nextStatus
        }, {
            serviceName: activeService?.name,
            firestore: isFirebaseConfigured ? firestore : null
        });
        syncLocalStateWithServices(updatedServices, 'تم تحديث حالة تفعيل المنهج');
    };

    const { activeOsra, activeCurricula } = getActiveOsraContext();

    const handleAddServant = async () => {
        if (!newServant.name || !newServant.phone || !newServant.assignedOsra || !newServant.syncKey) {
            return alert("يرجى استكمال الاسم ورقم الموبايل والأسرة أولاً.");
        }
        let matchedServiceName = '';
        let matchedOsraKey = '';
        form.services?.forEach((svc) => {
            const found = (svc.osras || []).find((o) => o.name === newServant.assignedOsra || o.syncKey === newServant.syncKey);
            if (found) {
                matchedServiceName = svc.name || '';
                matchedOsraKey = found.osraKey || found.secretKey || found.syncKey || '';
            }
        });
        const newServantObj = {
            id: Date.now(),
            name: String(newServant.name || "").trim(),
            role: newServant.role || "خادم فصل",
            email: String(newServant.email || "").trim(),
            phone: String(newServant.phone || "").trim(),
            serviceName: matchedServiceName,
            assignedOsra: newServant.assignedOsra || "",
            osraName: newServant.assignedOsra || "",
            syncKey: newServant.syncKey || "",
            osraKey: matchedOsraKey || newServant.syncKey || "",
            password: newServant.password || "",
            allowedClasses: newServant.allowedClasses || [],
            createdAt: new Date().toISOString()
        };
        const cleanServantObj = JSON.parse(JSON.stringify(newServantObj));
        const updatedServants = [...(form.servants || []), cleanServantObj];
        await persistSettingsQuietly({ ...form, servants: updatedServants });
        setNewlyApprovedServant(cleanServantObj);
        setNewServant({ name: '', role: 'خادم', email: '', phone: '', assignedOsra: '', syncKey: '', password: '', allowedClasses: [] });
    };

    const handleRemoveServant = (id) => {
        if (window.confirm("متأكد إنك عايز تحظر الخادم ده وتمسحه من النظام؟ بمجرد الحفظ هيتم طرده!")) {
            const updatedServants = form.servants.filter(s => s.id !== id);
            setForm({ ...form, servants: updatedServants });
        }
    };

    const handleApproveRequest = async (request) => {
        if (!navigator.onLine) return alert("يلزم الاتصال بالإنترنت للموافقة على طلبات الانضمام وتفعيل الحساب.");
        try {
            let matchedService = null;
            let matchedOsra = null;
            for (const srv of (form.services || [])) {
                const candidateOsra = (srv.osras || []).find(
                    (o) =>
                        (srv.name === request.serviceName && o.name === request.osraName) ||
                        o.name === request.osraName ||
                        o.syncKey === request.osraName
                );
                if (candidateOsra) {
                    matchedService = srv;
                    matchedOsra = candidateOsra;
                    break;
                }
            }

            if (!matchedOsra || !matchedOsra.syncKey) {
                alert("لم يتم العثور على الفصل أو مفتاح المزامنة لهذه الأسرة. يرجى التأكد من وجود الأسرة في الهيكل التنظيمي.");
                return;
            }

            const nowIso = new Date().toISOString();
            const resolvedServiceName = String(matchedService?.name || request.serviceName || 'خدمة الكنيسة').trim();
            const resolvedOsraName = String(matchedOsra.name || request.osraName || matchedOsra.syncKey).trim();
            const resolvedSyncKey = String(matchedOsra.syncKey).trim();
            const resolvedOsraKey = String(matchedOsra.osraKey || matchedOsra.secretKey || resolvedSyncKey).trim();
            const resolvedRole = String(request.role || 'خادم فصل').trim() || 'خادم فصل';

            if (!firestore) return alert("إعدادات Firebase غير مفعلة حالياً في ملف .env.");

            // 1. إضافة الخادم لمجموعة servants في الفايربيز بالحقول المسموحة في قواعد الأمان
            const firestoreServantDoc = {
                id: Date.now(),
                name: String(request.name || "").trim(),
                phone: String(request.phone || "").trim(),
                role: resolvedRole,
                serviceName: resolvedServiceName,
                assignedOsra: resolvedOsraName,
                osraName: resolvedOsraName,
                syncKey: resolvedSyncKey,
                email: String(request.email || "").trim(),
                profileImage: String(request.profileImage || "").trim(),
                createdAt: nowIso,
                updatedAt: nowIso
            };
            const docRef = await addDoc(collection(firestore, "servants"), firestoreServantDoc);

            // 2. حفظ الخادم فوراً في System/mainConfig مع مفتاح الأسرة الفريد osraKey بدون الحاجة للضغط اليدوي على حفظ بالأسفل
            const mainConfigServant = {
                ...firestoreServantDoc,
                uid: docRef.id,
                osraKey: resolvedOsraKey,
                secretKey: resolvedOsraKey
            };
            const cleanServantObj = JSON.parse(JSON.stringify(mainConfigServant));
            const existingFiltered = (form.servants || []).filter(
                (s) => !(String(s?.phone || '').trim() === cleanServantObj.phone && String(s?.syncKey || '').trim() === cleanServantObj.syncKey)
            );
            const updatedServants = [...existingFiltered, cleanServantObj];
            await persistSettingsQuietly({ ...form, servants: updatedServants });

            await deleteDoc(doc(firestore, "JoinRequests", request.id));
            setJoinRequests((prev) => prev.filter((r) => r.id !== request.id));
            setNewlyApprovedServant(cleanServantObj);
            logActivity('APPROVE_SERVANT', `قبول وتفعيل حساب الخادم: ${cleanServantObj.name} (${resolvedServiceName} / ${resolvedOsraName})`);
        } catch (error) {
            console.error("خطأ في القبول:", error);
            alert("حدث خطأ أثناء قبول الطلب: " + (error?.message || "يرجى المحاولة مرة أخرى"));
        }
    };

    const handleRejectRequest = async (id) => {
        if (!navigator.onLine || !firestore) return alert("يلزم الاتصال بالإنترنت وتفعيل إعدادات Firebase لرفض الطلب!");
        if (window.confirm("متأكد إنك عايز ترفض وتمسح الطلب ده؟")) {
            try {
                await deleteDoc(doc(firestore, "JoinRequests", id));
                setJoinRequests(joinRequests.filter(r => r.id !== id));
            } catch (error) {
                console.error("خطأ في الرفض:", error);
            }
        }
    };

    const openServantApprovalWhatsapp = (servantObj) => {
        const waUrl = buildServantApprovalWhatsAppUrl(servantObj, form.services || []);
        if (!waUrl) {
            alert("لا يوجد رقم موبايل صالح مسجل لهذا الخادم.");
            return;
        }
        window.open(waUrl, '_blank', 'noopener,noreferrer');
    };

    if (!isAdminAuth) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-4" dir="rtl">
                <div className="coptic-card shimmer-gold-border p-8 rounded-[2.5rem] max-w-sm w-full text-center relative overflow-hidden animate-card-enter">
                    <div className="w-20 h-20 mx-auto mb-4 rounded-3xl p-1.5 bg-gradient-to-br from-[#1B2A59] to-[#8C621E] shadow-lg flex items-center justify-center">
                        <img src={getLogoUrl()} alt={TENANT_CONFIG.churchName} className="w-full h-full object-contain rounded-2xl bg-[#FFFDF7] p-1" />
                    </div>
                    <h2 className="font-calligraphic text-2xl font-bold text-[#1B2A59] mb-1">بوابة الإدارة المركزية</h2>
                    <p className="text-xs font-bold text-[#7A5617] mb-5">{TENANT_CONFIG.churchName}</p>
                    <form onSubmit={(e) => {
                        e.preventDefault();
                        if (adminPasswordInput === appSettings.adminPass) {
                            setIsAdminAuth(true);
                            setTemporarySuperAdmin(true);
                        } else alert("كلمة المرور خاطئة");
                    }} className="space-y-4">
                        <div className="relative">
                            <Key className="absolute right-4 top-1/2 -translate-y-1/2 text-[#A07123]" size={18} />
                            <input
                                type="password"
                                placeholder="كلمة مرور الإدارة..."
                                value={adminPasswordInput}
                                onChange={e => setAdminPasswordInput(e.target.value)}
                                className="coptic-cream-input w-full min-h-[48px] pl-4 pr-12 py-3 rounded-2xl text-center font-black outline-none"
                                autoFocus
                            />
                        </div>
                        <button type="submit" className="w-full min-h-[48px] bg-gradient-to-r from-[#162447] via-[#1B2A59] to-[#8C621E] text-amber-100 py-3 rounded-2xl font-black shadow-lg hover:brightness-110 transition-all cursor-pointer">
                            دخول آمن كمسئول
                        </button>
                        <button type="button" onClick={() => goBack('/')} className="w-full min-h-[44px] bg-[#EFE0C2] text-[#1B2A59] py-2.5 rounded-2xl font-bold hover:bg-[#E7D4AF] transition-all cursor-pointer">
                            رجوع للخدمة
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    const allOsrasNames = form.services?.flatMap(s => s.osras.map(o => o.name)) || [];
    const totalServicesCount = visibleServices?.length || 0;
    const totalOsrasCount = (visibleServices || []).reduce((sum, s) => sum + (s.osras?.length || 0), 0);
    const totalCurriculaCount = (visibleServices || []).reduce(
        (sum, s) => sum + (s.osras || []).reduce((cSum, o) => cSum + (o.curricula?.length || 0), 0),
        0
    );
    const totalServantsCount = (form.servants || []).length;

    return (
        <div className="min-h-screen pb-12" dir="rtl">
            {/* Royal Coptic Control Center Header */}
            <header
                className="text-white pt-4 pb-6 px-4 sticky top-0 z-40 shadow-2xl rounded-b-[2.5rem] border-b-2 border-amber-400/50"
                style={{ background: 'linear-gradient(135deg, #162447 0%, #1B2A59 55%, #8C621E 100%)' }}
            >
                <div className="max-w-6xl mx-auto space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <button
                                type="button"
                                onClick={() => goBack('/')}
                                aria-label="الرجوع للخلف"
                                className="w-11 h-11 bg-white/15 hover:bg-white/25 border border-amber-300/30 rounded-2xl flex items-center justify-center transition-all shrink-0 cursor-pointer"
                            >
                                <ArrowRight size={20} className="text-amber-200" />
                            </button>
                            <div className="w-12 h-12 rounded-2xl p-1 bg-[#FFFDF7] border-2 border-amber-400/80 shadow-md shrink-0 flex items-center justify-center">
                                <img src={getLogoUrl()} alt={TENANT_CONFIG.churchName} className="w-full h-full object-contain rounded-xl" />
                            </div>
                            <div className="min-w-0">
                                <h1 className="font-calligraphic text-xl sm:text-3xl font-bold text-amber-300 truncate leading-snug">
                                    إدارة هيكل الخدمات والمناهج والأسر
                                </h1>
                                <p className="text-xs sm:text-sm font-bold text-amber-100/85 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <span>{TENANT_CONFIG.churchName}</span>
                                    <span className="opacity-50 hidden sm:inline">•</span>
                                    {isOnline ? (
                                        <span className="text-emerald-300 inline-flex items-center gap-1">متصل</span>
                                    ) : (
                                        <span className="text-amber-300 inline-flex items-center gap-1"><WifiOff size={12} /> وضع محلي</span>
                                    )}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                            {isSuperAdmin && (
                                <button
                                    type="button"
                                    onClick={handleAddService}
                                    className="min-h-[44px] bg-white/15 hover:bg-white/25 border border-amber-300/40 text-amber-100 px-3.5 py-2 rounded-2xl font-black text-xs sm:text-sm flex items-center gap-1.5 transition-all cursor-pointer"
                                >
                                    <PlusCircle size={17} />
                                    <span>خدمة جديدة</span>
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => updateSettings(form)}
                                disabled={isSavingToCloud}
                                className="min-h-[44px] bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-[#162447] px-4 py-2 rounded-2xl font-black text-xs sm:text-sm shadow-lg flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                                {isSavingToCloud ? <Loader2 className="animate-spin" size={17} /> : <Save size={17} />}
                                <span>حفظ الكل</span>
                            </button>
                        </div>
                    </div>

                    {/* KPI Summary Strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div className="bg-white/10 backdrop-blur-sm border border-amber-300/25 rounded-2xl px-3 py-2 flex items-center justify-between">
                            <span className="text-xs font-bold text-amber-100/90">الخدمات الرئيسية</span>
                            <span className="text-lg font-black text-amber-300 tabular-nums">{totalServicesCount}</span>
                        </div>
                        <div className="bg-white/10 backdrop-blur-sm border border-amber-300/25 rounded-2xl px-3 py-2 flex items-center justify-between">
                            <span className="text-xs font-bold text-amber-100/90">الفصول والأسر</span>
                            <span className="text-lg font-black text-white tabular-nums">{totalOsrasCount}</span>
                        </div>
                        <div className="bg-emerald-500/20 backdrop-blur-sm border border-emerald-300/35 rounded-2xl px-3 py-2 flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-100">مناهج مضافة</span>
                            <span className="text-lg font-black text-emerald-300 tabular-nums">{totalCurriculaCount}</span>
                        </div>
                        <div className="bg-white/10 backdrop-blur-sm border border-amber-300/25 rounded-2xl px-3 py-2 flex items-center justify-between">
                            <span className="text-xs font-bold text-amber-100/90">الخدام</span>
                            <span className="text-lg font-black text-amber-200 tabular-nums">{totalServantsCount}</span>
                        </div>
                    </div>
                </div>
            </header>

            <main className="p-4 max-w-6xl mx-auto mt-4 space-y-7">

                {/* شريط تأكيد قبول وتفعيل الخادم + إرسال رسالة القبول على واتساب */}
                {newlyApprovedServant && (() => {
                    const waUrl = buildServantApprovalWhatsAppUrl(newlyApprovedServant, form.services || []);
                    const waCtx = resolveServantWhatsappContext(newlyApprovedServant, form.services || []);
                    return (
                        <div className="bg-emerald-50 border-2 border-emerald-400 rounded-[2rem] p-5 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-card-enter">
                            <div className="flex items-start gap-3.5 min-w-0">
                                <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                                    <CheckCircle size={24} />
                                </div>
                                <div className="min-w-0">
                                    <h4 className="font-black text-emerald-950 text-base">
                                        تم قبول وتفعيل حساب الخادم بنجاح وحفظه سحابياً: {waCtx.servantName}
                                    </h4>
                                    <p className="text-xs font-bold text-emerald-900 mt-1">
                                        الخدمة: {waCtx.serviceName} • الأسرة: {waCtx.osraName} • مفتاح الأسرة الخاص: <span className="font-black text-[#1B2A59]" dir="ltr">{waCtx.uniqueOsraKey}</span>
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
                                {waUrl ? (
                                    <a
                                        href={waUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex-1 md:flex-none min-h-[46px] bg-[#25D366] hover:bg-[#1ebe5d] text-white px-5 py-2.5 rounded-2xl text-xs sm:text-sm font-black flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
                                    >
                                        <MessageCircle size={18} />
                                        <span>إرسال رسالة القبول والتفعيل على واتساب</span>
                                    </a>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => setNewlyApprovedServant(null)}
                                    aria-label="إخفاء الإشعار"
                                    className="min-h-[46px] px-3 rounded-2xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-bold text-xs transition-colors cursor-pointer"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </div>
                    );
                })()}

                {/* قسم طلبات الانضمام */}
                {isOnline && (
                    <div className="coptic-card p-6 rounded-[2rem] animate-card-enter">
                        <div className="flex items-center gap-2.5 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center text-[#8C621E]">
                                <Clock size={20} />
                            </div>
                            <h3 className="font-calligraphic text-xl font-bold text-[#1B2A59]">طلبات الانضمام المعلقة</h3>
                            {joinRequests.length > 0 && (
                                <span className="bg-[#8C621E] text-white text-xs font-black px-2.5 py-0.5 rounded-full tabular-nums">{joinRequests.length}</span>
                            )}
                        </div>

                        {isLoadingRequests ? (
                            <div className="flex items-center justify-center py-4 gap-2 text-[#8C621E]">
                                <Loader2 className="animate-spin" size={20} /> <span className="text-sm font-bold">جاري تحميل الطلبات...</span>
                            </div>
                        ) : joinRequests.length === 0 ? (
                            <div className="text-center text-[#7A5617]/75 font-bold text-sm py-4 border-2 border-dashed border-[#DFC48F] rounded-2xl bg-[#FAF3E3]/50">
                                لا يوجد طلبات انضمام جديدة حالياً.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {(joinRequests || []).map(request => {
                                    if (!request) return null;
                                    try {
                                        return (
                                            <div key={request.id || Math.random()} className="bg-[#FAF3E3]/70 p-4 rounded-2xl border border-[#DFC48F] flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
                                                <div className="flex items-center gap-4 flex-1">
                                                    {request?.profileImage ? (
                                                        <img
                                                            src={request.profileImage}
                                                            alt={request?.name || 'صورة الخادم'}
                                                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                            className="w-14 h-14 rounded-full object-cover border-2 border-amber-300"
                                                        />
                                                    ) : (
                                                        <div className="w-14 h-14 rounded-full bg-[#EFE0C2] flex items-center justify-center text-[#8C621E] font-bold text-xl">
                                                            {request?.name ? request.name.charAt(0) : <UserCircle size={24} />}
                                                        </div>
                                                    )}
                                                    <div>
                                                        <p className="font-black text-[#1B2A59] text-sm">{request?.name || 'بدون اسم'}</p>
                                                        <p className="text-xs font-bold text-[#5C492B] mt-1">تليفون: <span className="text-[#1B2A59]">{request?.phone || 'غير متوفر'}</span></p>
                                                        <p className="text-[11px] font-bold text-[#7A5617] mt-1 bg-amber-100/80 inline-block px-2.5 py-0.5 rounded-lg border border-amber-200">
                                                            يريد الانضمام لـ: {request?.serviceName} / {request?.osraName}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 w-full md:w-auto">
                                                    <button type="button" onClick={() => handleApproveRequest(request)} className="flex-1 md:flex-none min-h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1 transition-all cursor-pointer">
                                                        <CheckCircle size={16} /> قبول وإضافة
                                                    </button>
                                                    <button type="button" onClick={() => handleRejectRequest(request?.id)} className="flex-1 md:flex-none min-h-[44px] bg-rose-100 hover:bg-rose-600 hover:text-white text-rose-700 px-4 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1 transition-all cursor-pointer">
                                                        <XCircle size={16} /> رفض
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    } catch (err) {
                                        console.error("Error rendering request:", err);
                                        return null;
                                    }
                                })}
                            </div>
                        )}
                    </div>
                )}

                <form onSubmit={handleSave} className="space-y-7">
                    <div className="coptic-card shimmer-gold-border p-5 sm:p-7 rounded-[2.25rem]">
                        <div className="flex flex-wrap justify-between items-center gap-3 border-b border-[#E7D4AF] pb-4 mb-6">
                            <h3 className="font-calligraphic text-2xl font-bold text-[#1B2A59] flex items-center gap-2.5">
                                <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1B2A59] to-[#8C621E] text-amber-200 flex items-center justify-center shadow-sm">
                                    <Layers size={20} />
                                </span>
                                <span>الهيكل التنظيمي للخدمات والمناهج</span>
                            </h3>
                            {isSuperAdmin && (
                                <button
                                    type="button"
                                    onClick={handleAddService}
                                    className="min-h-[44px] bg-gradient-to-r from-[#162447] to-[#1B2A59] text-amber-200 px-4 py-2 rounded-2xl font-black text-sm flex items-center gap-2 hover:brightness-110 shadow-md transition-all cursor-pointer"
                                >
                                    <PlusCircle size={18} /> إضافة خدمة جديدة
                                </button>
                            )}
                        </div>

                        <div className="space-y-8">
                            {visibleServices?.length === 0 && (
                                <p className="text-center text-[#7A5617] font-bold py-8">لا يوجد خدمات مخصصة لك لعرضها.</p>
                            )}

                            {visibleServices?.map((service, sIndex) => {
                                const fallbackSrv = getClassScheduleConfig(service.osras?.[0]?.syncKey, service.name, form);
                                const effectiveSvcDays = Array.isArray(service.serviceDays) && service.serviceDays.length > 0
                                    ? service.serviceDays
                                    : fallbackSrv.serviceDays;
                                const effectiveSvcLiturgyDays = Array.isArray(service.liturgyDays)
                                    ? service.liturgyDays
                                    : fallbackSrv.liturgyDays;
                                const effectiveSvcLabel = buildScheduleLabel(effectiveSvcDays, effectiveSvcLiturgyDays);
                                const serviceCurriculaCount = (service.osras || []).reduce(
                                    (sum, o) => sum + getOsraCurricula(o.syncKey, allDbCurricula, [{ ...o, serviceName: service.name }]).length,
                                    0
                                );

                                return (
                                    <div
                                        key={service.id}
                                        style={{ animationDelay: `${Math.min(sIndex * 70, 350)}ms` }}
                                        className="bg-[#FAF3E3]/80 border-2 border-[#DFC48F] rounded-[2rem] p-5 relative shadow-sm animate-card-enter"
                                    >
                                        {isSuperAdmin && (
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteService(service.id)}
                                                aria-label="حذف الخدمة"
                                                className="absolute top-4 left-4 w-10 h-10 text-rose-500 hover:text-white hover:bg-rose-600 bg-[#FFFDF7] border border-rose-200 rounded-full flex items-center justify-center shadow-sm transition-colors cursor-pointer"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}

                                        {/* Service Header Banner Strip */}
                                        <div className="flex flex-wrap items-center gap-2 mb-4 pl-12">
                                            <span className="inline-flex items-center gap-1.5 text-xs font-black bg-[#1B2A59] text-amber-200 px-3 py-1 rounded-full">
                                                <Calendar size={13} />
                                                {service.scheduleLabel || effectiveSvcLabel}
                                            </span>
                                            <span className="inline-flex items-center gap-1 text-xs font-bold bg-[#EFE0C2] text-[#7A5617] border border-[#DFC48F] px-3 py-1 rounded-full">
                                                <Users size={13} />
                                                {(service.osras || []).length} فصول / أسر
                                            </span>
                                            <span className="inline-flex items-center gap-1 text-xs font-bold bg-emerald-100/90 text-emerald-900 border border-emerald-300 px-3 py-1 rounded-full">
                                                <BookOpen size={13} />
                                                {serviceCurriculaCount} مناهج
                                            </span>
                                        </div>

                                        <div className="flex flex-col md:flex-row gap-4 mb-6">
                                            <div className="flex flex-col items-center gap-1.5 shrink-0">
                                                <div className="w-20 h-20 rounded-2xl bg-[#FFFDF7] border-2 border-[#C89B3C] p-1 shadow-sm flex items-center justify-center overflow-hidden relative group cursor-pointer">
                                                    <img
                                                        src={resolveOsraLogoUrl(null, service)}
                                                        onError={(e) => {
                                                            e.currentTarget.onerror = null;
                                                            e.currentTarget.src = DEFAULT_CHURCH_LOGO_PATH;
                                                        }}
                                                        className="w-full h-full object-contain rounded-xl"
                                                        alt="لوجو الخدمة"
                                                    />
                                                    {isSuperAdmin && (
                                                        <>
                                                            <div className="absolute inset-0 bg-[#1B2A59]/70 hidden group-hover:flex items-center justify-center text-amber-200 text-[10px] font-bold text-center">تغيير الشعار</div>
                                                            <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, 'service', service.id)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                                        </>
                                                    )}
                                                    {isUploadingImage && (
                                                        <div className="absolute inset-0 bg-[#FFFDF7]/80 flex items-center justify-center">
                                                            <Loader2 size={20} className="animate-spin text-[#8C621E]" />
                                                        </div>
                                                    )}
                                                </div>
                                                {isSuperAdmin && hasCustomOsraLogo(service) && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleResetOsraLogo(service.id, null)}
                                                        className="text-[10px] font-black text-[#7A5617] hover:text-rose-700 bg-[#FFFDF7] border border-[#DFC48F] px-2 py-1 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                                                        title="استعادة لوجو الكنيسة الافتراضي"
                                                    >
                                                        <RotateCcw size={10} />
                                                        <span>استعادة لوجو الكنيسة الافتراضي</span>
                                                    </button>
                                                )}
                                            </div>
                                            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-xs font-black text-[#6E5329] mb-1">اسم الخدمة / المجموعة</label>
                                                    <input
                                                        type="text"
                                                        value={service.name || ''}
                                                        readOnly={!isSuperAdmin}
                                                        onChange={e => handleUpdateService(service.id, 'name', e.target.value)}
                                                        className="coptic-cream-input w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl font-black text-base"
                                                        required
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-black text-[#6E5329] mb-1">الأب الكاهن المسئول</label>
                                                    <input
                                                        type="text"
                                                        value={service.priest || ''}
                                                        readOnly={!isSuperAdmin}
                                                        onChange={e => handleUpdateService(service.id, 'priest', e.target.value)}
                                                        placeholder="أبونا..."
                                                        className="coptic-cream-input w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl font-bold text-sm"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Interactive Service-Level Schedule Day Picker */}
                                        <div className="mb-5">
                                            <ScheduleDayPicker
                                                serviceDays={effectiveSvcDays}
                                                liturgyDays={effectiveSvcLiturgyDays}
                                                disabled={!isSuperAdmin}
                                                onChange={(nextSched) => handleUpdateServiceSchedule(service.id, nextSched)}
                                            />
                                        </div>

                                        {/* Inner Classes / Osras Box */}
                                        <div className="bg-[#FFFDF7] rounded-[1.6rem] p-4 sm:p-5 border border-[#DFC48F] shadow-inner">
                                            <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
                                                <h4 className="font-calligraphic text-lg font-bold text-[#1B2A59] flex items-center gap-2">
                                                    <Users size={18} className="text-[#A07123]" />
                                                    <span>الأسر والفصول الدراسية</span>
                                                </h4>
                                                {(isSuperAdmin || isPriest) && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleAddOsra(service.id)}
                                                        className="min-h-[40px] text-[#1B2A59] bg-[#EFE0C2] border border-[#DFC48F] px-3.5 py-1.5 rounded-xl font-black text-xs flex items-center gap-1.5 hover:bg-[#E7D4AF] transition-colors cursor-pointer"
                                                    >
                                                        <PlusCircle size={15} /> إضافة أسرة / فصل
                                                    </button>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                                {service.osras.filter(o => isSuperAdmin || isPriest || o.syncKey === currentSyncKey).map((osra, oIdx) => {
                                                    const osraSchedule = getClassScheduleConfig({ ...osra, serviceName: service.name }, osra.name || service.name, form);
                                                    const osraCurriculaCount = getOsraCurricula(osra.syncKey, allDbCurricula, [{ ...osra, serviceName: service.name }]).length;
                                                    const isCustomOsra = Boolean(osra.useCustomSchedule);
                                                    const displayedOsraServiceDays = isCustomOsra && Array.isArray(osra.serviceDays) && osra.serviceDays.length > 0
                                                        ? osra.serviceDays
                                                        : effectiveSvcDays;
                                                    const displayedOsraLiturgyDays = isCustomOsra && Array.isArray(osra.liturgyDays)
                                                        ? osra.liturgyDays
                                                        : effectiveSvcLiturgyDays;

                                                    return (
                                                        <div
                                                            key={osra.id}
                                                            style={{ animationDelay: `${Math.min(oIdx * 45, 300)}ms` }}
                                                            className="bg-[#FAF3E3]/75 hover:bg-[#FFFDF7] border border-[#DFC48F] hover:border-[#C89B3C] rounded-2xl p-4 relative group transition-all duration-300 shadow-xs hover:shadow-md animate-card-enter"
                                                        >
                                                            {(isSuperAdmin || isPriest) && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDeleteOsra(service.id, osra.id)}
                                                                    aria-label="حذف الأسرة"
                                                                    className="absolute top-2.5 left-2.5 w-8 h-8 rounded-full flex items-center justify-center text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                                                >
                                                                    <Trash2 size={15} />
                                                                </button>
                                                            )}

                                                            <div className="flex items-start gap-3 mb-3 pl-8">
                                                                <div className="flex flex-col items-center gap-1 shrink-0">
                                                                    <div className="w-13 h-13 rounded-2xl bg-[#FFFDF7] border-2 border-[#C89B3C]/70 flex items-center justify-center overflow-hidden relative cursor-pointer shadow-xs group/osralogo">
                                                                        <img
                                                                            src={resolveOsraLogoUrl(osra, service)}
                                                                            width="52"
                                                                            height="52"
                                                                            loading="lazy"
                                                                            onError={(e) => {
                                                                                e.currentTarget.onerror = null;
                                                                                e.currentTarget.src = DEFAULT_CHURCH_LOGO_PATH;
                                                                            }}
                                                                            className="w-full h-full object-contain p-0.5"
                                                                            alt="لوجو الأسرة"
                                                                        />
                                                                        <div className="absolute inset-0 bg-[#1B2A59]/65 hidden group-hover/osralogo:flex items-center justify-center text-amber-200">
                                                                            <ImagePlus size={15} />
                                                                        </div>
                                                                        <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, 'osra', service.id, osra.id)} className="absolute inset-0 opacity-0 cursor-pointer" title="رفع شعار مخصص للأسرة" />
                                                                        {isUploadingImage && (
                                                                            <div className="absolute inset-0 bg-[#FFFDF7]/85 flex items-center justify-center">
                                                                                <Loader2 size={16} className="animate-spin text-[#8C621E]" />
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    {hasCustomOsraLogo(osra) && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleResetOsraLogo(service.id, osra.id)}
                                                                            className="text-[9px] font-black text-[#7A5617] hover:text-rose-700 bg-[#FFFDF7] border border-[#DFC48F] px-1.5 py-0.5 rounded-md flex items-center gap-0.5 transition-colors cursor-pointer whitespace-nowrap"
                                                                            title="استعادة لوجو الكنيسة الافتراضي"
                                                                        >
                                                                            <RotateCcw size={9} />
                                                                            <span>استعادة لوجو الكنيسة الافتراضي</span>
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <div className="flex-1 min-w-0 space-y-1.5">
                                                                    <input
                                                                        type="text"
                                                                        value={osra.name || ''}
                                                                        onChange={e => handleUpdateOsra(service.id, osra.id, 'name', e.target.value)}
                                                                        className="coptic-cream-input w-full px-3 py-1.5 rounded-xl font-black text-sm"
                                                                        placeholder="اسم الأسرة أو الفصل"
                                                                    />
                                                                    <input
                                                                        type="text"
                                                                        placeholder="أمين الأسرة / المسئول..."
                                                                        value={osra.amin || ''}
                                                                        onChange={e => handleUpdateOsra(service.id, osra.id, 'amin', e.target.value)}
                                                                        className="w-full px-2 py-1 bg-transparent border-b border-[#DFC48F] focus:border-[#A07123] outline-none text-xs font-bold text-[#6E5329]"
                                                                    />
                                                                </div>
                                                            </div>

                                                            <div className="flex flex-wrap items-center gap-1.5 mb-3">
                                                                <span className="text-[11px] font-black bg-[#EFE0C2] text-[#7A5617] border border-[#DFC48F] px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                                                                    <Calendar size={11} /> {osraSchedule.shortBadge || osraSchedule.scheduleBadge}
                                                                </span>
                                                                {osra.syncKey && (
                                                                    <span className="text-[11px] font-black bg-[#1B2A59]/10 text-[#1B2A59] px-2.5 py-0.5 rounded-full inline-flex items-center gap-1" dir="ltr">
                                                                        <Key size={11} /> {osra.syncKey}
                                                                    </span>
                                                                )}
                                                                {(osra.osraKey || osra.secretKey) && (
                                                                    <span className="text-[11px] font-black bg-amber-100 text-[#8C621E] border border-amber-300 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1" dir="ltr">
                                                                        <Lock size={10} /> {osra.osraKey || osra.secretKey}
                                                                    </span>
                                                                )}
                                                            </div>

                                                            <div className="mb-3">
                                                                <ScheduleDayPicker
                                                                    compact={true}
                                                                    serviceDays={displayedOsraServiceDays}
                                                                    liturgyDays={displayedOsraLiturgyDays}
                                                                    useCustomSchedule={isCustomOsra}
                                                                    disabled={!isSuperAdmin && !isPriest}
                                                                    onToggleInheritance={(custom) => handleToggleOsraInheritance(service.id, osra.id, custom)}
                                                                    onChange={(nextSched) => handleUpdateOsraSchedule(service.id, osra.id, { ...nextSched, useCustomSchedule: true })}
                                                                />
                                                            </div>

                                                            {/* مفتاح الأسرة الفريد (osraKey) مع النسخ السريع والتوليد */}
                                                            <div className="mb-3 p-2.5 rounded-xl bg-[#FFFDF7] border border-[#DFC48F]">
                                                                <div className="flex items-center justify-between gap-2 mb-1">
                                                                    <label className="text-[11px] font-black text-[#1B2A59] flex items-center gap-1">
                                                                        <Key size={12} className="text-[#8C621E]" />
                                                                        <span>مفتاح الأسرة الفريد (لدخول الخدام)</span>
                                                                    </label>
                                                                    {copiedKeyId === String(osra.id) && (
                                                                        <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                                                            تم النسخ
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-1.5">
                                                                    <input
                                                                        type="text"
                                                                        value={osra.osraKey || osra.secretKey || ''}
                                                                        readOnly={!isSuperAdmin && !isPriest}
                                                                        onChange={(e) => handleUpdateOsraSecretKey(service.id, osra.id, e.target.value)}
                                                                        placeholder="AB-CLS-01"
                                                                        className="coptic-cream-input flex-1 min-w-0 min-h-[38px] px-2.5 py-1.5 rounded-xl font-black text-xs text-[#1B2A59] text-center tracking-wider"
                                                                        dir="ltr"
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleCopyOsraKey(osra.osraKey || osra.secretKey || osra.syncKey, osra.id)}
                                                                        className="min-h-[38px] px-2.5 py-1.5 rounded-xl bg-[#1B2A59] hover:bg-[#253A7A] text-amber-200 font-black text-[11px] flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                                                                        title="نسخ مفتاح الأسرة"
                                                                    >
                                                                        <Copy size={13} />
                                                                        <span>نسخ</span>
                                                                    </button>
                                                                    {(isSuperAdmin || isPriest) && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleRegenerateOsraKey(service.id, osra.id, `${service.name} ${osra.name}`)}
                                                                            className="min-h-[38px] px-2.5 py-1.5 rounded-xl bg-[#EFE0C2] hover:bg-[#E7D4AF] text-[#1B2A59] border border-[#DFC48F] font-black text-[11px] flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                                                                            title="توليد مفتاح فريد جديد للأسرة"
                                                                        >
                                                                            <RefreshCw size={13} />
                                                                            <span>تجديد</span>
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
                                                                <div>
                                                                    <label className="block text-[11px] font-black text-[#6E5329] mb-1">مفتاح الكلاود</label>
                                                                    <input
                                                                        type="text"
                                                                        value={osra.syncKey || ''}
                                                                        readOnly={!isSuperAdmin && !isPriest}
                                                                        onChange={e => handleUpdateOsra(service.id, osra.id, 'syncKey', e.target.value)}
                                                                        className="coptic-cream-input w-full min-h-[44px] px-2.5 py-2 rounded-xl font-black text-xs text-[#1B2A59] text-center"
                                                                        dir="ltr"
                                                                        required
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="block text-[11px] font-black text-[#6E5329] mb-1">مناهج الأسرة المتعددة</label>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => openCurriculumManager(service.id, osra.id, osra.name || 'الأسرة', osra.syncKey)}
                                                                        className="w-full min-h-[44px] px-3 py-2 bg-gradient-to-r from-emerald-700 to-emerald-600 hover:from-emerald-600 hover:to-emerald-500 text-white border border-emerald-400/50 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 shadow-sm hover:shadow-md transition-all cursor-pointer"
                                                                    >
                                                                        <BookOpen size={15} />
                                                                        <span>إدارة مناهج الخدمة</span>
                                                                        <span className="bg-amber-300 text-[#162447] text-[10px] font-black px-2 py-0.5 rounded-full tabular-nums">
                                                                            {osraCurriculaCount}
                                                                        </span>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {isSuperAdmin && (
                        <div className="coptic-card p-6 rounded-[2rem] space-y-4 animate-card-enter">
                            <h3 className="font-calligraphic text-xl font-bold text-[#1B2A59] border-b border-[#E7D4AF] pb-2 mb-4 flex items-center gap-2">
                                <Lock size={18} className="text-[#8C621E]" /> إعدادات الحماية (لمسئول النظام)
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-black text-rose-700 ml-1">باسوورد مطور النظام</label>
                                    <input
                                        type="text"
                                        value={form.adminPass || ''}
                                        onChange={e => setForm({ ...form, adminPass: e.target.value })}
                                        className="coptic-cream-input w-full min-h-[46px] p-3 rounded-xl font-black text-center text-rose-800"
                                        required
                                    />
                                </div>

                                <div className="space-y-1">
                                    <label className="text-xs font-black text-[#6E5329] ml-1">كلمة سر مسح الداتا</label>
                                    <input
                                        type="text"
                                        value={form.deletePass || ''}
                                        onChange={e => setForm({ ...form, deletePass: e.target.value })}
                                        className="coptic-cream-input w-full min-h-[46px] p-3 rounded-xl font-black text-center"
                                        required
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isSavingToCloud}
                        className="w-full min-h-[54px] text-amber-100 py-4 rounded-2xl font-black hover:brightness-110 transition-all shadow-xl flex justify-center items-center gap-2.5 text-lg cursor-pointer"
                        style={{ background: 'linear-gradient(135deg, #162447 0%, #1B2A59 60%, #8C621E 100%)' }}
                    >
                        {isSavingToCloud ? <Loader2 className="animate-spin" size={24} /> : <Save size={24} className="text-amber-300" />}
                        <span>
                            {isSavingToCloud
                                ? "جاري حفظ الهيكل والمناهج..."
                                : firestore
                                    ? (isOnline ? "حفظ واعتماد الهيكل والمناهج (أونلاين)" : "حفظ التعديلات محلياً")
                                    : "حفظ واعتماد هيكل الخدمات والمناهج"}
                        </span>
                    </button>
                </form>

                {isSuperAdmin && (
                    <div className="coptic-card shimmer-gold-border p-6 rounded-[2.25rem] mt-8 animate-card-enter">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#1B2A59] to-[#8C621E] text-amber-200 flex items-center justify-center shadow-sm">
                                <UserCircle size={24} />
                            </div>
                            <div>
                                <h3 className="font-calligraphic text-2xl font-bold text-[#1B2A59]">إدارة الخدام والصلاحيات</h3>
                                <p className="text-xs font-bold text-[#7A5617]">تعيين الخدام، الأمناء، وأمناء المراحل وربط مفاتيح المزامنة</p>
                            </div>
                        </div>

                        <div className="bg-[#FAF3E3]/80 p-4 sm:p-5 rounded-3xl border border-[#DFC48F] mb-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
                                <select
                                    value={newServant.role || ''}
                                    onChange={e => {
                                        const selectedRole = e.target.value;
                                        if (selectedRole === 'كاهن' || selectedRole === 'أدمن مساعد') {
                                            setNewServant({ ...newServant, role: selectedRole, assignedOsra: 'كل الأسر (صلاحية كاملة)', syncKey: 'MASTER_ACCESS' });
                                        } else {
                                            setNewServant({ ...newServant, role: selectedRole, assignedOsra: '', syncKey: '' });
                                        }
                                    }}
                                    className="coptic-cream-input min-h-[46px] p-3 rounded-xl font-bold text-sm"
                                >
                                    <option value="خادم">خادم عادي</option>
                                    <option value="تاسوني">تاسوني</option>
                                    <option value="أمين أسرة">أمين أسرة</option>
                                    <option value="أمين مرحلة">أمين مرحلة</option>
                                    <option value="كاهن">أب كاهن</option>
                                    <option value="أدمن مساعد">أدمن مساعد</option>
                                </select>

                                <input type="text" placeholder="اسم الخادم..." value={newServant.name || ''} onChange={e => setNewServant({ ...newServant, name: e.target.value })} className="coptic-cream-input min-h-[46px] p-3 rounded-xl font-bold text-sm" />
                                <input type="tel" placeholder="رقم التليفون (للدخول)..." value={newServant.phone || ''} onChange={e => setNewServant({ ...newServant, phone: e.target.value })} className="coptic-cream-input min-h-[46px] p-3 rounded-xl font-bold text-sm text-left" dir="ltr" />

                                <select
                                    value={newServant.assignedOsra || ''}
                                    disabled={newServant.role === 'كاهن' || newServant.role === 'أدمن مساعد' || newServant.role === 'أمين مرحلة'}
                                    onChange={e => {
                                        const selectedOsraName = e.target.value;
                                        let matchedSyncKey = '';
                                        form.services?.forEach(service => {
                                            const foundOsra = service.osras.find(o => o.name === selectedOsraName);
                                            if (foundOsra) matchedSyncKey = foundOsra.syncKey;
                                        });
                                        setNewServant({ ...newServant, assignedOsra: selectedOsraName, syncKey: matchedSyncKey });
                                    }}
                                    className={`coptic-cream-input min-h-[46px] p-3 rounded-xl font-bold text-sm ${newServant.role === 'كاهن' || newServant.role === 'أدمن مساعد' || newServant.role === 'أمين مرحلة' ? 'opacity-75 cursor-not-allowed' : ''}`}
                                >
                                    {newServant.role === 'كاهن' || newServant.role === 'أدمن مساعد' ? (
                                        <option value="كل الأسر (صلاحية كاملة)">كل الأسر (صلاحية كاملة)</option>
                                    ) : newServant.role === 'أمين مرحلة' ? (
                                        <option value="قطاع مخصص">قطاع مخصص (عدة فصول)</option>
                                    ) : (
                                        <>
                                            <option value="">اختر الأسرة...</option>
                                            {allOsrasNames.map((name, i) => <option key={i} value={name}>{name}</option>)}
                                        </>
                                    )}
                                </select>

                                <input
                                    type="text"
                                    placeholder="مفتاح الكلاود..."
                                    value={newServant.syncKey || ''}
                                    readOnly
                                    className={`p-3 min-h-[46px] rounded-xl border font-black text-sm text-left cursor-not-allowed ${newServant.syncKey === 'MASTER_ACCESS' || newServant.syncKey === 'STAGE_ADMIN' ? 'bg-amber-100 border-amber-400 text-amber-900 shadow-inner' : 'bg-[#EFE0C2]/60 border-[#DFC48F] text-[#6E5329]'}`}
                                    dir="ltr"
                                />
                            </div>

                            {newServant.role === 'أمين مرحلة' && (
                                <div className="mb-4 p-4 rounded-2xl border border-[#DFC48F] bg-[#FFFDF7]">
                                    <label className="block text-sm font-black text-[#1B2A59] mb-3">اختر الفصول المسموح بها لأمين المرحلة:</label>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                        {form.services?.flatMap(s => s.osras).map((osra) => (
                                            <label key={osra.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-[#FAF3E3] border border-[#E7D4AF]/60 cursor-pointer transition-colors">
                                                <input
                                                    type="checkbox"
                                                    checked={(newServant.allowedClasses || []).includes(osra.syncKey)}
                                                    onChange={(e) => {
                                                        const current = new Set(newServant.allowedClasses || []);
                                                        if (e.target.checked) current.add(osra.syncKey);
                                                        else current.delete(osra.syncKey);
                                                        setNewServant({
                                                            ...newServant,
                                                            allowedClasses: Array.from(current),
                                                            assignedOsra: 'قطاع مخصص',
                                                            syncKey: 'STAGE_ADMIN'
                                                        });
                                                    }}
                                                    className="w-5 h-5 text-[#1B2A59] rounded-md"
                                                />
                                                <span className="text-sm font-bold text-[#1B2A59]">{osra.name}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={handleAddServant}
                                className="w-full min-h-[48px] bg-gradient-to-r from-[#162447] to-[#1B2A59] text-amber-200 py-3 rounded-2xl font-black shadow-md hover:brightness-110 flex justify-center items-center gap-2 cursor-pointer"
                            >
                                <UserPlus size={18} /> إضافة الخادم يدوياً
                            </button>
                        </div>

                        <div className="space-y-3">
                            {(form.servants || []).map(s => {
                                if (!s) return null;
                                try {
                                    return (
                                        <div key={s.id || Math.random()} className="flex flex-col md:flex-row items-center justify-between p-4 bg-[#FFFDF7] rounded-2xl border border-[#DFC48F] shadow-xs gap-4">
                                            <div className="flex flex-col w-full md:w-1/4">
                                                <span className="font-black text-sm text-[#1B2A59] flex items-center gap-1.5"><Users size={15} className="text-[#A07123]" /> {s?.role || 'بدون دور'} / {s?.name || 'بدون اسم'}</span>
                                                <span className="text-xs text-[#7A5617] font-bold mr-5" dir="ltr">{s?.phone || 'غير متوفر'}</span>
                                            </div>
                                            <div className="flex flex-col w-full md:w-1/4 bg-[#FAF3E3] border border-[#E7D4AF] p-2 rounded-xl text-center">
                                                <span className="text-xs font-bold text-[#6E5329]">الأسرة: <span className="text-[#1B2A59] font-black">{s?.assignedOsra || 'بدون أسرة'}</span></span>
                                            </div>

                                            <div className="flex flex-wrap w-full md:w-auto gap-2">
                                                <button type="button" onClick={() => setEditingServant(s)} className="flex-1 md:flex-none min-h-[42px] bg-[#EFE0C2] text-[#1B2A59] px-3 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1 hover:bg-[#E7D4AF] transition-all cursor-pointer">
                                                    <Edit3 size={14} /> تعديل
                                                </button>
                                                <button type="button" onClick={() => openServantApprovalWhatsapp(s)} className="flex-1 md:flex-none min-h-[42px] bg-[#25D366] text-white px-3 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1 hover:bg-[#20b858] transition-all shadow-sm cursor-pointer">
                                                    <MessageCircle size={14} /> إرسال رسالة القبول والتفعيل (واتساب)
                                                </button>
                                                <button type="button" onClick={() => handleRemoveServant(s?.id)} className="flex-1 md:flex-none min-h-[42px] bg-rose-50 text-rose-600 px-3 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1 hover:bg-rose-100 transition-all cursor-pointer">
                                                    <Trash2 size={14} /> مسح وحظر
                                                </button>
                                            </div>
                                        </div>
                                    );
                                } catch (err) {
                                    console.error("Error rendering servant:", err);
                                    return null;
                                }
                            })}
                        </div>
                    </div>
                )}
            </main>

            {/* Per-Class Unlimited Multi-Curriculum Modal */}
            {curriculumModal.isOpen && (
                <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#162447]/65 backdrop-blur-sm animate-in fade-in">
                    <div className="coptic-card shimmer-gold-border w-full max-w-3xl rounded-t-[2.2rem] sm:rounded-[2.2rem] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
                        {/* Modal Royal Header */}
                        <div
                            className="p-5 text-white flex justify-between items-center gap-3 shrink-0 border-b border-amber-300/35"
                            style={{ background: 'linear-gradient(135deg, #162447 0%, #1B2A59 65%, #8C621E 100%)' }}
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-11 h-11 rounded-2xl bg-amber-400/20 border border-amber-300/40 flex items-center justify-center text-amber-300 shrink-0">
                                    <BookOpen size={22} />
                                </div>
                                <div className="min-w-0">
                                    <h2 className="font-calligraphic text-xl sm:text-2xl font-bold text-amber-300 truncate">
                                        إدارة مناهج: {activeOsra?.name || curriculumModal.osraName}
                                    </h2>
                                    <p className="text-xs font-bold text-amber-100/85">
                                        {activeCurricula.length} مناهج ومذكرات مسجلة لهذا الفصل • يتم الحفظ تلقائياً
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {(activeOsra?.syncKey || curriculumModal.syncKey) && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const target = activeOsra?.syncKey || curriculumModal.syncKey;
                                            setCurriculumModal({ isOpen: false, sId: null, oId: null, osraName: '', syncKey: '' });
                                            navigate(`/curriculum?syncKey=${encodeURIComponent(target)}`);
                                        }}
                                        className="min-h-[40px] px-3 py-1.5 rounded-xl bg-[#C89B3C] hover:bg-[#b5892f] text-[#111B3A] font-black text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                                    >
                                        <ExternalLink size={14} />
                                        <span className="hidden sm:inline">فتح صفحة مناهج الأسرة الكاملة</span>
                                        <span className="sm:hidden">صفحة الأسرة</span>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setCurriculumModal({ isOpen: false, sId: null, oId: null, osraName: '', syncKey: '' })}
                                    aria-label="إغلاق"
                                    className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 bg-[#FAF3E3]/70">
                            {curriculumNotice && (
                                <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-black flex items-center gap-2 shadow-xs">
                                    <Sparkles size={16} className="text-emerald-600 shrink-0" />
                                    <span>{curriculumNotice}</span>
                                </div>
                            )}

                            {/* 1. List of Existing Curricula for This Class */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-black text-sm text-[#1B2A59] flex items-center gap-2">
                                        <FolderOpen size={17} className="text-[#8C621E]" />
                                        <span>المناهج المضافة ({activeCurricula.length})</span>
                                    </h3>
                                    {curriculumForm.id && (
                                        <button
                                            type="button"
                                            onClick={() => setCurriculumForm(EMPTY_CURRICULUM_ITEM)}
                                            className="text-xs font-black text-[#1B2A59] bg-[#EFE0C2] px-3 py-1 rounded-xl cursor-pointer"
                                        >
                                            + إضافة منهج جديد
                                        </button>
                                    )}
                                </div>

                                {activeCurricula.length === 0 ? (
                                    <div className="text-center py-6 px-4 bg-[#FFFDF7] border-2 border-dashed border-[#DFC48F] rounded-2xl text-xs font-bold text-[#7A5617]">
                                        لا يوجد مناهج مضافة لهذا الفصل بعد. أضف المنهج الأول من النموذج بالأسفل!
                                    </div>
                                ) : (
                                    <div className="space-y-2.5">
                                        {activeCurricula.map((item) => {
                                            const attachmentUrl = getItemAttachmentUrl(item);
                                            const isEnabled = String(item.status || '').includes('تم الشرح') || String(item.status || '').includes('مفعّل');
                                            const itemBody = item.description || item.content || '';
                                            return (
                                                <div
                                                    key={item.id}
                                                    className="bg-[#FFFDF7] border border-[#DFC48F] rounded-2xl p-4 shadow-xs flex flex-col gap-2.5 transition-all hover:border-[#C89B3C]"
                                                >
                                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                                                <span className="inline-flex items-center gap-1 text-[11px] font-black bg-[#EFE0C2] text-[#7A5617] px-2.5 py-0.5 rounded-full">
                                                                    <Tag size={11} />
                                                                    {item.category}
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleToggleCurriculumStatus(item.id)}
                                                                    className={`text-[11px] font-black px-2.5 py-0.5 rounded-full border cursor-pointer transition-colors ${
                                                                        isEnabled
                                                                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                                                                            : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                                                                    }`}
                                                                >
                                                                    {item.status || CURRICULUM_STATUSES[0]}
                                                                </button>
                                                            </div>
                                                            <h4 className="font-black text-sm sm:text-base text-[#1B2A59]">{item.title}</h4>
                                                            {itemBody && (
                                                                <p className="text-xs font-bold text-[#5C492B] mt-1 leading-relaxed">
                                                                    {itemBody}
                                                                </p>
                                                            )}
                                                        </div>

                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            {attachmentUrl && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openCurriculumAttachment(navigate, attachmentUrl, item.title)}
                                                                    className="min-h-[38px] px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black flex items-center gap-1 cursor-pointer"
                                                                >
                                                                    <ExternalLink size={13} /> عرض المذكرة
                                                                </button>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => handleEditCurriculumItem(item)}
                                                                aria-label="تعديل المنهج"
                                                                className="w-9 h-9 rounded-xl bg-[#EFE0C2] hover:bg-[#E7D4AF] text-[#1B2A59] flex items-center justify-center cursor-pointer"
                                                            >
                                                                <Edit3 size={15} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteCurriculumItem(item.id)}
                                                                aria-label="حذف المنهج"
                                                                className="w-9 h-9 rounded-xl bg-rose-50 hover:bg-rose-600 text-rose-600 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                                                            >
                                                                <Trash2 size={15} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* 2. Add / Edit Curriculum Form */}
                            <form
                                onSubmit={handleSaveCurriculumItem}
                                className="bg-[#FFFDF7] border-2 border-[#C89B3C]/65 rounded-[1.75rem] p-4 sm:p-5 space-y-3.5 shadow-sm"
                            >
                                <h3 className="font-calligraphic text-lg font-bold text-[#1B2A59] flex items-center gap-2 border-b border-[#E7D4AF] pb-2">
                                    <Sparkles size={18} className="text-[#8C621E]" />
                                    <span>{curriculumForm.id ? 'تعديل المنهج المحدد' : 'إضافة منهج / مذكرة / درس جديد للفصل'}</span>
                                </h3>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="sm:col-span-2">
                                        <label className="block text-xs font-black text-[#6E5329] mb-1">اسم المنهج أو الدرس *</label>
                                        <input
                                            type="text"
                                            value={curriculumForm.title}
                                            onChange={(e) => setCurriculumForm(prev => ({ ...prev, title: e.target.value }))}
                                            placeholder="مثال: منهج العقيدة / لحن إبنوتي ناي نان / مسابقة الآيات..."
                                            className="coptic-cream-input w-full min-h-[44px] px-3.5 py-2 rounded-xl text-sm font-bold"
                                            required={!curriculumForm.fileName}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-black text-[#6E5329] mb-1">التصنيف</label>
                                        <select
                                            value={curriculumForm.category}
                                            onChange={(e) => setCurriculumForm(prev => ({ ...prev, category: e.target.value }))}
                                            className="coptic-cream-input w-full min-h-[44px] px-3 py-2 rounded-xl text-xs sm:text-sm font-bold"
                                        >
                                            {CURRICULUM_CATEGORIES.map(cat => (
                                                <option key={cat} value={cat}>{cat}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-black text-[#6E5329] mb-1">الحالة للخدام</label>
                                        <select
                                            value={curriculumForm.status}
                                            onChange={(e) => setCurriculumForm(prev => ({ ...prev, status: e.target.value }))}
                                            className="coptic-cream-input w-full min-h-[44px] px-3 py-2 rounded-xl text-xs sm:text-sm font-bold"
                                        >
                                            {CURRICULUM_STATUSES.map(st => (
                                                <option key={st} value={st}>{st}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-black text-[#6E5329] mb-1">شرح أو محتوى المنهج النصي</label>
                                    <textarea
                                        rows={2}
                                        value={curriculumForm.description}
                                        onChange={(e) => setCurriculumForm(prev => ({ ...prev, description: e.target.value }))}
                                        placeholder="أهداف الدرس، الآيات المحفظة، أو خطة الشرح للأسبوع..."
                                        className="coptic-cream-input w-full px-3.5 py-2 rounded-xl text-sm font-bold"
                                    />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                    <div>
                                        <label className="block text-xs font-black text-[#6E5329] mb-1">رفع ملف PDF أو صورة من الجهاز</label>
                                        <label className="min-h-[44px] px-3 py-2 rounded-xl border border-dashed border-[#A07123] bg-[#FAF3E3] hover:bg-[#EFE0C2] text-[#1B2A59] text-xs font-black flex items-center justify-center gap-2 cursor-pointer transition-colors">
                                            {isUploadingPdf ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} className="text-[#8C621E]" />}
                                            <span className="truncate">{curriculumForm.fileName || 'اختر ملف PDF أو صورة'}</span>
                                            <input
                                                type="file"
                                                accept=".pdf,.doc,.docx,image/*"
                                                onChange={handleCurriculumFileUpload}
                                                className="hidden"
                                            />
                                        </label>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-black text-[#6E5329] mb-1">أو رابط PDF / Google Drive مباشر</label>
                                        <input
                                            type="url"
                                            dir="ltr"
                                            value={String(curriculumForm.fileUrl || '').startsWith('data:') ? '' : curriculumForm.fileUrl}
                                            onChange={(e) => setCurriculumForm(prev => ({ ...prev, fileUrl: e.target.value, pdfData: '', fileName: prev.fileName }))}
                                            placeholder="https://drive.google.com/..."
                                            className="coptic-cream-input w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold text-left"
                                        />
                                    </div>
                                </div>

                                <div className="flex gap-2 pt-1">
                                    <button
                                        type="submit"
                                        disabled={isUploadingPdf}
                                        className="flex-1 min-h-[46px] bg-gradient-to-r from-[#162447] via-[#1B2A59] to-[#8C621E] text-amber-100 rounded-xl font-black text-sm shadow-md hover:brightness-110 flex items-center justify-center gap-2 cursor-pointer"
                                    >
                                        <Plus size={18} />
                                        <span>{curriculumForm.id ? 'حفظ تعديل المنهج' : 'إضافة المنهج للفصل'}</span>
                                    </button>
                                    {curriculumForm.id && (
                                        <button
                                            type="button"
                                            onClick={() => setCurriculumForm(EMPTY_CURRICULUM_ITEM)}
                                            className="min-h-[46px] px-4 bg-[#EFE0C2] text-[#1B2A59] rounded-xl font-black text-xs cursor-pointer"
                                        >
                                            إلغاء التعديل
                                        </button>
                                    )}
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* تعديل بيانات الخادم مباشرة (Requirement #5) */}
            {editingServant && (
                <EditServantModal
                    isOpen={!!editingServant}
                    servant={editingServant}
                    services={form.services}
                    onClose={() => setEditingServant(null)}
                    onSaved={(updated) => {
                        const updatedList = (form.servants || []).map(serv => 
                            (serv.id === updated.id || (serv.phone && serv.phone === updated.phone)) ? updated : serv
                        );
                        setForm(prev => ({ ...prev, servants: updatedList }));
                        setEditingServant(null);
                    }}
                />
            )}
        </div>
    );
}