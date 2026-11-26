import { scopedSyncKeys, syncScopedClassesFromCloud, syncWithCloud } from '../db/childSync';
import { pullStructureFromCloud } from '../db/sync';
/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import SmartAlerts from '../components/SmartAlerts';
import { Settings, Users, MapPin, Gift, BookOpen, CalendarDays, Church, UserMinus, UserCheck, User, X, MessageCircleWarning, FileText, Crown, ArrowRight, Bell, Star, PhoneCall, Award, ChevronRight, QrCode, CreditCard, Target, CheckCircle, Trophy, Sparkles, Clock, Home as HomeIcon, AlertTriangle, Flame, Megaphone, Send, LayoutDashboard } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { firestore } from '../db/firebase';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Network } from '@capacitor/network';
import { calculateExactAge } from '../utils/dateUtils';
import { TENANT_CONFIG, getLogoUrl,
    readScopedStorage,
    writeScopedStorage
} from '../utils/tenantConfig';
import { getCurrentServiceFridayDate, formatCopticDate, isThursdayServiceClass, getClassScheduleConfig } from '../utils/serviceWeek';
import { getOsraCurricula, getOsraCopticBookPlans, openCurriculumAttachment, isPdfCurriculumItem, getItemAttachmentUrl } from '../utils/curriculumEngine';
import { ActiveFridayLessonCard } from '../components/CopticBookProgressionSection';
import { aggregateMonthlyPoints, getMonthKeyFromDate, formatArabicMonthKey } from '../utils/pointsMath';
import { useWeeklyClassActivity } from '../hooks/useWeeklyClassActivity';
import { useChurchDataEngine } from '../hooks/useChurchDataEngine';
import { useUrgentInterventionAlerts } from '../hooks/useUrgentInterventionAlerts';
import UrgentInterventionModal from '../components/UrgentInterventionModal';
import WeeklyClassActivitySummary from '../components/WeeklyClassActivitySummary';
import ScopedNotificationCenter from '../components/ScopedNotificationCenter';
import BroadcastMessageCenter, { BroadcastMessagesFeed, IncomingMessageToastBanner, NotificationPermissionBanner } from '../components/BroadcastMessageCenter';
import {
    getImpersonatedOsra,
    startOsraImpersonation,
    exitOsraImpersonation,
    extractAllOsrasFromSettings,
    resolveUserAccessScope
} from '../utils/notificationScopeEngine';
import { DEFAULT_CHURCH_LOGO_PATH, resolveOsraLogoUrl } from '../utils/realChurchStructure';

export default function Home() {
    const navigate = useNavigate();
    const [gregorianDate, setGregorianDate] = useState("");
    const [copticDate, setCopticDate] = useState("");
    const [modalState, setModalState] = useState({ isOpen: false, type: null });
    const [showPastDatePicker, setShowPastDatePicker] = useState(false);
    const [pastDate, setPastDate] = useState('');
    const [currentSyncKey, setCurrentSyncKey] = useState(() => String(readScopedStorage('currentSyncKey') || ''));
    const [impersonatedOsra, setImpersonatedOsra] = useState(() => getImpersonatedOsra());
    const [settingsVersion, setSettingsVersion] = useState(0);

    useEffect(() => {
        const refreshAuthAndScope = () => {
            setCurrentSyncKey(String(readScopedStorage('currentSyncKey') || ''));
            setImpersonatedOsra(getImpersonatedOsra());
            setSettingsVersion(v => v + 1);
        };
        window.addEventListener('syncKey-changed', refreshAuthAndScope);
        window.addEventListener('auth-changed', refreshAuthAndScope);
        window.addEventListener('servant-profile-updated', refreshAuthAndScope);
        window.addEventListener('church-settings-updated', refreshAuthAndScope);
        window.addEventListener('storage', refreshAuthAndScope);
        return () => {
            window.removeEventListener('syncKey-changed', refreshAuthAndScope);
            window.removeEventListener('auth-changed', refreshAuthAndScope);
            window.removeEventListener('servant-profile-updated', refreshAuthAndScope);
            window.removeEventListener('church-settings-updated', refreshAuthAndScope);
            window.removeEventListener('storage', refreshAuthAndScope);
        };
    }, []);

    // سحب هيكل الكنيسة ومزامنة الفصول بصمت في الخلفية بدون أزرار أو أقفال
    useEffect(() => {
        void pullStructureFromCloud().then((res) => {
            if (res?.updated) setSettingsVersion(v => v + 1);
        });
        const keys = scopedSyncKeys().sort();
        if (keys.length > 0) {
            void syncScopedClassesFromCloud(keys).catch(() => {});
        }
    }, []);

    const isImpersonating = Boolean(impersonatedOsra?.syncKey);

    // Support mobile back button and swipe-back (popstate) to gracefully exit class impersonation
    useEffect(() => {
        if (!isImpersonating) return;

        const handlePopState = () => {
            const restoredKey = exitOsraImpersonation();
            setImpersonatedOsra(null);
            setCurrentSyncKey(restoredKey);
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [isImpersonating]);

    // المحرك المركزي لصلاحيات الهرم الكنسي (4 مستويات)
    const accessScope = resolveUserAccessScope(null, [], { currentSyncKeyOverride: currentSyncKey });
    const isSuperAdmin = accessScope.isSuperAdmin;
    const isStageLeader = accessScope.isStageLeader;
    const isClassServant = accessScope.isClassServant;
    const activeSyncKey = isImpersonating
        ? impersonatedOsra.syncKey
        : (isClassServant ? accessScope.activeSyncKey : '');
    
    // جلب أنشطة الأسرة والمناهج من قاعدة البيانات المحلية (Dexie)
    const activities = useLiveQuery(() => 
        activeSyncKey
            ? db.activities.filter(a => a.syncKey === activeSyncKey && !a.isDeleted).toArray()
            : [],
        [activeSyncKey]
    ) || [];

    const dbClassCurricula = useLiveQuery(
        () => activeSyncKey
            ? db.curricula.filter(c => !c.isDeleted && String(c.syncKey || '').trim() === String(activeSyncKey).trim()).toArray()
            : [],
        [activeSyncKey]
    ) || [];

    const targetedActivities = activities.filter(a => a.type === 'targeted');
    const executedActivities = activities.filter(a => a.type === 'executed');

    // جلب بيانات الخادم من التخزين المحلي
    const currentServant = JSON.parse(readScopedStorage('currentServant') || '{}');

    // تحديد صلاحيات القيادة vs خادم الفصل الواحد
    const isMaster = accessScope.canAccessMasterDashboard;
    const isLeadership = isMaster || currentServant.role === 'أمين أسرة';

    // جلب إعدادات الكنيسة والخدمة
    const [appSettings, setAppSettings] = useState({ khedmaName: "الخدمة", osraName: "الأسرة", osraLogo: "", khedmaLogo: "" });
    const [todaysLesson, setTodaysLesson] = useState(null);
    const [curriculumPdfUrl, setCurriculumPdfUrl] = useState("");
    const [classCurricula, setClassCurricula] = useState([]);

    const [activeWidget, setActiveWidget] = useState(localStorage.getItem('preferredWidget') || 'BIRTHDAYS');

    // Anchored to Thursday-to-Wednesday service cycle
    const targetDate = useMemo(() => {
        return getCurrentServiceFridayDate();
    }, []);

    // Single Source of Truth (SSOT) for children, class counts, and validated weekly attendance
    const {
        activeChildren: children,
        classCounts,
        weeklyAttendance,
        isLoadingInitialData
    } = useChurchDataEngine(accessScope.allowedSyncKeys || []);

    // Real-time weekly class activity badges (Requirement #2)
    const { activityByClass } = useWeeklyClassActivity();

    // Urgent pastoral intervention alerts & PWA badges (scoped cleanly by roleTier)
    const { urgentCases, urgentCount, hasUrgentCases, permission, requestNotificationPermission } = useUrgentInterventionAlerts(
        isSuperAdmin ? 'all' : (activeSyncKey || 'all')
    );
    const [showUrgentModal, setShowUrgentModal] = useState(false);
    const [broadcastModal, setBroadcastModal] = useState({ isOpen: false, targetType: '', syncKey: '' });

    // عدد الأحداث العامة الغير مقروءة
    const unseenGlobalEventsCount = useLiveQuery(() => {
        const lastViewed = parseInt(localStorage.getItem('lastSeenGlobalEventTime') || '0', 10);
        const todayStr = new Date().toISOString().split('T')[0];
        return db.events.filter(e => {
            const isGlobal = e.isGlobal === true || e.syncKey === 'global';
            return isGlobal && (e.date >= todayStr) && ((e.createdAt || 0) > lastViewed);
        }).count();
    }, []);

    useEffect(() => {
        // 1. تظبيط التواريخ
        const date = new Date();
        setGregorianDate(date.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
        setCopticDate(formatCopticDate(date));

        // 2. قراءة الداتا بذكاء من الـ appSettings (الاسم، اللوجو، المنهج، الـ PDF)
        const savedSettings = readScopedStorage('appSettings');
        if (savedSettings) {
            try {
                const parsed = JSON.parse(savedSettings);
                let finalKhedmaName = parsed.khedmaName || "الخدمة";
                let finalKhedmaLogo = parsed.khedmaLogo || "";
                let finalOsraName = parsed.osraName || "الأسرة";
                let finalOsraLogo = parsed.osraLogo || "";

                let matchedPdf = "";
                let matchedLessons = [];
                let matchedCurricula = [];

                if (isSuperAdmin) {
                    finalKhedmaName = parsed.services?.[0]?.name || parsed.khedmaName || "الخدمة المركزية";
                    finalKhedmaLogo = parsed.services?.[0]?.logo || parsed.khedmaLogo || "";
                    finalOsraName = "كل الأسر والخدمات";
                } else if (isStageLeader) {
                    finalKhedmaName = parsed.khedmaName || TENANT_CONFIG.churchName;
                    finalKhedmaLogo = parsed.khedmaLogo || "";
                    finalOsraName = `مرحلة: ${accessScope.stageName || 'الخدمة'}`;
                } else if (parsed.services && Array.isArray(parsed.services)) {
                    // البحث عن أسرة الخادم أو الأسرة المتصفحة حالياً
                    for (const service of parsed.services) {
                        const foundOsra = (service.osras || []).find(o => String(o.syncKey).trim() === String(activeSyncKey).trim());
                        if (foundOsra) {
                            finalKhedmaName = service.name;
                            finalKhedmaLogo = resolveOsraLogoUrl(null, service);
                            finalOsraName = foundOsra.name;
                            finalOsraLogo = resolveOsraLogoUrl(foundOsra, service);

                            // السحر هنا: بناخد المنهج من جوه الأسرة نفسها!
                            matchedPdf = foundOsra.pdfUrl || "";
                            matchedLessons = foundOsra.lessons || [];
                            matchedCurricula = Array.isArray(foundOsra.curricula) ? foundOsra.curricula : [];
                            break;
                        }
                    }
                    if (isImpersonating && impersonatedOsra?.name && finalOsraName === (parsed.osraName || "الأسرة")) {
                        finalOsraName = impersonatedOsra.name;
                        finalKhedmaName = impersonatedOsra.serviceName || finalKhedmaName;
                        finalOsraLogo = impersonatedOsra.logo || finalOsraLogo;
                    }
                } else if (isImpersonating && impersonatedOsra?.name) {
                    finalOsraName = impersonatedOsra.name;
                    finalKhedmaName = impersonatedOsra.serviceName || finalKhedmaName;
                    finalOsraLogo = impersonatedOsra.logo || finalOsraLogo;
                }

                // 3. عرض البيانات في الشاشة
                setAppSettings({ khedmaName: finalKhedmaName, khedmaLogo: finalKhedmaLogo, osraName: finalOsraName, osraLogo: finalOsraLogo });

                setCurriculumPdfUrl(matchedPdf);
                setClassCurricula(matchedCurricula);
                if (matchedPdf) {
                    localStorage.setItem('curriculumPdfUrl', matchedPdf);
                } else {
                    localStorage.removeItem('curriculumPdfUrl');
                }

                if (matchedLessons.length > 0) {
                    // فلترة الدروس: إخفاء الدروس اللي تاريخها فات
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const todayStr = today.toISOString().split('T')[0];

                    const validLessons = matchedLessons.filter(l => {
                        if (!l.date) return true; // لو مفيش تاريخ، نعرضه
                        const parsed = new Date(l.date);
                        if (!isNaN(parsed.getTime())) {
                            // تاريخ ISO حقيقي — نقارن تاريخياً
                            parsed.setHours(0, 0, 0, 0);
                            return parsed >= today;
                        }
                        // تاريخ نصي قديم (عربي) — نعرضه عشان ميختفيش
                        return true;
                    });
                    const lesson = validLessons.find(l => l.date === targetDate) || validLessons[0];
                    setTodaysLesson(lesson || null);
                } else {
                    setTodaysLesson(null);
                }

            } catch (e) { console.error("Error reading settings", e); }
        } else if (isImpersonating && impersonatedOsra?.name) {
            setAppSettings({
                khedmaName: impersonatedOsra.serviceName || "الخدمة",
                khedmaLogo: "",
                osraName: impersonatedOsra.name,
                osraLogo: impersonatedOsra.logo || ""
            });
        }
    }, [targetDate, activeSyncKey, isMaster, isImpersonating, impersonatedOsra, settingsVersion]);


    useEffect(() => {
        localStorage.setItem('preferredWidget', activeWidget);
    }, [activeWidget]);

    const [pointsShowcase, setPointsShowcase] = useState({ monthKey: getMonthKeyFromDate(new Date()), topChild: null, totalLogs: 0, totalCurricula: 0 });
    const [demoSeedTick, setDemoSeedTick] = useState(0);

    useEffect(() => {
        const handleSeeded = () => setDemoSeedTick(t => t + 1);
        window.addEventListener('demo-data-seeded', handleSeeded);
        return () => window.removeEventListener('demo-data-seeded', handleSeeded);
    }, []);

    const allLiveCurricula = useLiveQuery(
        () => db.curricula ? db.curricula.filter(c => c.isDeleted !== true).toArray() : [],
        []
    ) || [];
    const livePointsRowCount = useLiveQuery(
        () => db.pointsLogs ? db.pointsLogs.count() : 0,
        []
    ) || 0;

    useEffect(() => {
        let cancelled = false;
        const loadShowcaseStats = async () => {
            try {
                const monthKey = getMonthKeyFromDate(new Date());
                const allowedKeys = accessScope.allowedSyncKeys || [];
                const allowedSet = new Set(allowedKeys);
                const [logs, allChildren] = await Promise.all([
                    db.pointsLogs ? db.pointsLogs.toArray() : Promise.resolve([]),
                    isMaster ? db.children.filter(c => c.isDeleted !== true).toArray() : Promise.resolve(children || [])
                ]);
                if (cancelled) return;
                const scopedLogs = isSuperAdmin
                    ? logs
                    : (allowedSet.size > 0 ? logs.filter(l => !l.syncKey || allowedSet.has(l.syncKey)) : []);
                const scopedChildren = isSuperAdmin
                    ? allChildren
                    : (allowedSet.size > 0 ? allChildren.filter(c => allowedSet.has(c.syncKey)) : []);
                const leaderboard = aggregateMonthlyPoints({ pointsLogs: scopedLogs, children: scopedChildren, monthKey });
                const activeCurricula = isSuperAdmin
                    ? allLiveCurricula
                    : (allowedSet.size > 0 ? allLiveCurricula.filter(c => allowedSet.has(c.syncKey)) : []);
                setPointsShowcase({
                    monthKey,
                    topChild: leaderboard[0] || null,
                    totalLogs: scopedLogs.filter(l => l.isDeleted !== true && (l.monthKey === monthKey)).length,
                    totalCurricula: activeCurricula.length
                });
            } catch (err) {
                console.warn('Showcase stats load error:', err);
            }
        };
        loadShowcaseStats();
        return () => { cancelled = true; };
    }, [children, activeSyncKey, isMaster, isSuperAdmin, (accessScope.allowedSyncKeys || []).join('|'), settingsVersion, demoSeedTick, allLiveCurricula.length, livePointsRowCount]);

    const widgetData = useMemo(() => {
        if (!children || isLeadership) return { birthdays: [], topStreaks: [], needsVisitation: [] };

        const now = new Date();
        const currentMonth = now.getMonth() + 1;

        const birthdays = children.filter(c => c.birthMonth === currentMonth).map(c => {
            const age = calculateExactAge(c.birthDate);
            return { ...c, calculatedAge: age === 'غير محدد' ? '' : `${age} سنة` };
        });

        const topStreaks = [...children]
            .sort((a, b) => (b.streak || 0) - (a.streak || 0))
            .filter(c => (c.streak || 0) > 0)
            .slice(0, 15);

        const needsVisitation = children.filter(c => {
            if (!c.last_service && !c.last_liturgy) return true;
            const lastAttended = new Date(Math.max(
                c.last_service ? new Date(c.last_service).getTime() : 0,
                c.last_liturgy ? new Date(c.last_liturgy).getTime() : 0
            ));
            const diffDays = Math.floor((now - lastAttended) / (1000 * 60 * 60 * 24));
            return diffDays >= 21 || c.streak === 0;
        }).slice(0, 5);

        return { birthdays, topStreaks, needsVisitation };
    }, [children, isLeadership]);

    // نظام الإشعارات الذكي (مراقبة النت وأعياد الميلاد)
    useEffect(() => {
        const setupNotifications = async () => {
            try {
                const permStatus = await LocalNotifications.requestPermissions();

                Network.addListener('networkStatusChange', async status => {
                    if (status.connected) {
                        const hasUnsyncedNotes = Object.keys(localStorage).some(key => key.startsWith('draft_note_'));
                        const dirtyChildren = await db.children.filter(c => c.isDirty === true || c.synced === 0).count();
                        const dirtyAttendance = await db.attendance.filter(a => a.isDirty === true || a.synced === 0).count();

                        if (hasUnsyncedNotes || dirtyChildren > 0 || dirtyAttendance > 0) {
                            await LocalNotifications.schedule({
                                notifications: [
                                    {
                                        title: "النت رجع يا هندسة!",
                                        body: "عندك داتا وملاحظات متسجلة أوفلاين، افتح الأبلكيشن واعمل مزامنة عشان متضيعش.",
                                        id: 100,
                                        schedule: { at: new Date(Date.now() + 1000) },
                                        sound: null,
                                        smallIcon: "ic_launcher"
                                    }
                                ]
                            });
                        }
                    }
                });

            } catch (error) {
                console.log("مشكلة في تشغيل الإشعارات:", error);
            }
        };

        setupNotifications();

        return () => {
            Network.removeAllListeners();
        };
    }, []);



    const getReportData = () => {
        let list = [];
        if (modalState.classSyncKey) {
            const classAct = activityByClass[modalState.classSyncKey] || {};
            if (modalState.type === 'service') {
                list = classAct.whoAttendedServiceList || [];
            } else if (modalState.type === 'absent') {
                list = classAct.whoAbsentServiceList || [];
            } else if (modalState.type === 'liturgy') {
                list = classAct.whoAttendedLiturgyList || [];
            }
        } else if (modalState.type === 'absent') {
            list = weeklyAttendance?.whoAbsentServiceList || [];
        } else if (modalState.type === 'service') {
            list = weeklyAttendance?.whoAttendedServiceList || [];
        } else if (modalState.type === 'liturgy') {
            list = weeklyAttendance?.whoAttendedLiturgyList || [];
        }

        return {
            boys: list.filter(c => c.gender !== 'بنت'),
            girls: list.filter(c => c.gender === 'بنت')
        };
    };

    const { boys: reportBoys, girls: reportGirls } = modalState.isOpen ? getReportData() : { boys: [], girls: [] };

    const cleanPhoneNumber = (phone) => {
        let clean = String(phone || "").replace(/\D/g, '');
        if (clean.startsWith('0')) clean = '2' + clean;
        else if (!clean.startsWith('20') && clean.length > 0) clean = '20' + clean;
        return clean;
    };

    const getTargetPhone = (child) => {
        if (child.whatsappTarget === 'child' && child.childPhone) return child.childPhone;
        if (child.whatsappTarget === 'child' && !child.childPhone) return child.motherPhone || child.fatherPhone || child.phone;
        if (child.whatsappTarget === 'father' && child.fatherPhone) return child.fatherPhone;
        if (child.whatsappTarget === 'mother' && child.motherPhone) return child.motherPhone;
        return child.motherPhone || child.fatherPhone || child.childPhone || child.phone;
    };

    const generateMissedFridayMsg = (child, specificTarget = null) => {
        const title = child.gender === 'بنت' ? 'مخدومتنا' : 'مخدومنا';
        const namePart = child.name ? child.name.split(' ')[0] : '';
        let msg = `وحشتنا يا ${title} ${namePart ? `(${namePart})` : ''}!\nمجتش ليه الجمعة اللي فاتت؟ مكانك كان فاضي، مستنيينك الجمعة الجاية ضروري!`;

        let phoneStr = '';
        if (specificTarget === 'father' && child.fatherPhone) phoneStr = child.fatherPhone;
        else if (specificTarget === 'mother' && child.motherPhone) phoneStr = child.motherPhone;
        else if (specificTarget === 'child' && child.childPhone) phoneStr = child.childPhone;
        else phoneStr = getTargetPhone(child);

        return `https://api.whatsapp.com/send?phone=${cleanPhoneNumber(phoneStr)}&text=${encodeURIComponent(msg)}`;
    };

    const masterOsras = useMemo(() => {
        if (!isMaster) return [];
        try {
            const extraKeys = Object.keys(classCounts || {});
            const allExtracted = extractAllOsrasFromSettings(null, extraKeys, { includeFallback: true });
            const scope = resolveUserAccessScope(null, extraKeys, { ignoreImpersonation: true, includeFallback: true });
            if (scope.isSuperAdmin && scope.allowedSyncKeys.length === 0) return allExtracted;
            const allowedSet = new Set(scope.allowedSyncKeys || []);
            if (allowedSet.size === 0) return scope.isSuperAdmin ? allExtracted : [];
            return allExtracted.filter(osra => allowedSet.has(osra.syncKey));
        } catch (_e) {
            return [];
        }
    }, [isMaster, classCounts, currentSyncKey, settingsVersion]);

    const handleEnterOsra = (osra) => {
        if (!osra?.syncKey) return;
        const payload = startOsraImpersonation(osra, currentSyncKey);
        if (payload) {
            setImpersonatedOsra(payload);
            setCurrentSyncKey(payload.syncKey);
            void syncWithCloud(payload.syncKey);
            try {
                window.history.pushState({ impersonating: payload.syncKey }, '', window.location.href);
            } catch {
                // Ignore if history state push is unsupported
            }
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        }
    };

    const handleOpenOsraDashboard = (osra) => {
        if (!osra?.syncKey) return;
        writeScopedStorage('selectedOsra', JSON.stringify(osra));
        sessionStorage.setItem('dashboard_activeClassKey', osra.syncKey);
        void syncWithCloud(osra.syncKey);
        navigate(`/dashboard?syncKey=${encodeURIComponent(osra.syncKey)}`);
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    };

    const handleExitOsraImpersonation = () => {
        const restoredKey = exitOsraImpersonation();
        setImpersonatedOsra(null);
        setCurrentSyncKey(restoredKey);
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    };

    const handleCurriculumClick = () => {
        navigate(activeSyncKey && !isMaster ? `/curriculum?syncKey=${encodeURIComponent(activeSyncKey)}` : '/curriculum');
    };

    // SmartRadar & SmartWidget logic refactored into main render return

    return (
        <div className="min-h-screen coptic-cream-surface relative overflow-x-hidden font-sans pb-10" dir="rtl">
            <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
                <div className="absolute -top-40 -right-40 w-125 h-125 rounded-full bg-indigo-600/5 blur-[100px]" />
                <div className="absolute bottom-10 -left-20 w-100 h-100 rounded-full bg-amber-500/5 blur-[80px]" />
            </div>

            <main className="relative z-10 max-w-4xl mx-auto px-3.5 sm:px-4 pt-4 sm:pt-6">

                <header className="coptic-card bg-white/95 backdrop-blur-md rounded-3xl sm:rounded-[2.25rem] p-4 sm:p-6 mb-5 sm:mb-6">
                    <div className="flex flex-col gap-3.5">
                        {/* Row 1 (Top Bar - Avatar, Role Pill & Action Icons) */}
                        <div className="flex items-center justify-between gap-2 w-full">
                            {/* Right side (RTL): Church/Osra avatar + Role pill */}
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="relative flex shrink-0">
                                    {!isMaster && (
                                        <img 
                                            src={appSettings.osraLogo || DEFAULT_CHURCH_LOGO_PATH} 
                                            alt="لوجو الأسرة" 
                                            width="44" 
                                            height="44" 
                                            loading="lazy" 
                                            decoding="async" 
                                            onError={(e) => {
                                                e.currentTarget.onerror = null;
                                                e.currentTarget.src = DEFAULT_CHURCH_LOGO_PATH;
                                            }}
                                            className="w-11 h-11 rounded-full border-2 border-amber-400/70 shadow-sm z-10 bg-white object-contain p-0.5" 
                                        />
                                    )}
                                    <img 
                                        src={getLogoUrl(appSettings.khedmaLogo) || TENANT_CONFIG.logoUrl} 
                                        alt={TENANT_CONFIG.churchName}
                                        width="44" 
                                        height="44" 
                                        loading="eager" 
                                        decoding="async" 
                                        onError={(e) => { e.currentTarget.src = '/logo.png'; }}
                                        className={`w-11 h-11 rounded-full border-2 border-amber-400/80 shadow-sm bg-white object-contain p-0.5 ${!isMaster ? '-mr-3' : ''}`} 
                                    />
                                </div>

                                {/* Role / Osra Badge */}
                                {isSuperAdmin ? (
                                    <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs sm:text-sm font-bold bg-amber-50 text-amber-900 border border-amber-300/70 shadow-2xs truncate">
                                        <Crown size={14} className="text-amber-600 shrink-0" />
                                        كل الأسر والخدمات
                                    </span>
                                ) : isStageLeader ? (
                                    <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs sm:text-sm font-bold bg-indigo-50 text-[#1B2A59] border border-indigo-200/80 shadow-2xs truncate max-w-[200px] sm:max-w-xs">
                                        <Crown size={14} className="text-amber-600 shrink-0" />
                                        مرحلة: {accessScope.stageName}
                                    </span>
                                ) : appSettings.osraName ? (
                                    <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs sm:text-sm font-bold bg-indigo-50 text-[#1B2A59] border border-indigo-200/70 shadow-2xs truncate max-w-[175px] sm:max-w-xs">
                                        {appSettings.osraName}
                                    </span>
                                ) : null}
                            </div>

                            {/* Left side (RTL): Notifications, Profile & Admin Settings (Super Admin ONLY) */}
                            <div className="flex items-center gap-2 shrink-0">
                                <ScopedNotificationCenter variant="light" />
                                <Link 
                                    to="/servant-profile" 
                                    aria-label="الملف الشخصي" 
                                    title="الملف الشخصي (بروفايلي)" 
                                    className="w-11 h-11 rounded-full ring-2 ring-[#1B2A59]/15 hover:ring-[#C8942E] text-[#1B2A59] flex justify-center items-center bg-indigo-50/80 hover:bg-[#1B2A59] hover:text-white transition-all shadow-xs overflow-hidden tactile-press"
                                >
                                    {currentServant.photoURL || currentServant.profileImage || currentServant.profilePic ? (
                                        <img 
                                            src={currentServant.photoURL || currentServant.profileImage || currentServant.profilePic} 
                                            alt={currentServant.name} 
                                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                            className="w-full h-full object-cover" 
                                        />
                                    ) : (
                                        <User size={19} />
                                    )}
                                </Link>
                                {isSuperAdmin && (
                                    <Link 
                                        to="/admin" 
                                        aria-label="إدارة النظام وهيكل الكنيسة" 
                                        title="إدارة النظام وهيكل الكنيسة"
                                        className="w-11 h-11 rounded-full bg-slate-100 text-slate-700 flex justify-center items-center hover:bg-[#1B2A59] hover:text-white transition-all shadow-xs tactile-press"
                                    >
                                        <Settings size={19} />
                                    </Link>
                                )}
                            </div>
                        </div>

                        {/* Row 2 (Calligraphic Church Title) */}
                        <div className="w-full pt-0.5">
                            <h1 className="font-calligraphic text-xl sm:text-2xl font-bold text-[#1B2A59] leading-snug text-right">
                                {TENANT_CONFIG.churchName}
                            </h1>
                            {TENANT_CONFIG.dioceseName && (
                                <p className="text-xs sm:text-sm font-bold text-amber-800/90 mt-0.5">
                                    {TENANT_CONFIG.dioceseName} • {TENANT_CONFIG.serviceTitle}
                                </p>
                            )}
                        </div>

                        {/* Row 3 (Dedicated Urgent Intervention Bar) */}
                        {(hasUrgentCases && (isMaster || isLeadership)) && (
                            <div className="flex flex-wrap items-center justify-between gap-2 w-full pt-1">
                                <button
                                    onClick={() => setShowUrgentModal(true)}
                                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-2xl bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 text-white text-xs sm:text-sm font-black shadow-md shadow-red-500/20 hover:scale-[1.01] active:scale-95 transition-all"
                                    title="حالات التدخل العاجل للآباء الكهنة"
                                >
                                    <span className="relative flex h-2.5 w-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
                                    </span>
                                    <AlertTriangle size={14} className="shrink-0" />
                                    <span>حالات التدخل العاجل للآباء الكهنة ({urgentCount})</span>
                                </button>

                                {permission === 'default' && (isMaster || currentServant.role === 'كاهن') && (
                                    <button
                                        onClick={requestNotificationPermission}
                                        className="w-full sm:w-auto text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 px-3 py-1.5 rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-2xs"
                                        title="تفعيل إشعارات التدخل العاجل على الهاتف"
                                    >
                                        <Bell size={13} className="shrink-0" /> تفعيل إشعارات الهاتف
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Row 4 (Date Badges) */}
                        <div
                            onClick={() => {
                                localStorage.setItem('lastSeenGlobalEventTime', Date.now().toString());
                                navigate('/calendar');
                            }}
                            className="pt-2 border-t border-slate-100 cursor-pointer hover:opacity-95 active:scale-[0.99] transition-all group select-none relative"
                            title="افتح أجندة الخدمة والمهام"
                        >
                            {unseenGlobalEventsCount > 0 && (
                                <div className="absolute -top-2.5 right-2 z-10 flex items-center gap-1 bg-white px-2 py-0.5 rounded-full border border-red-200 shadow-xs">
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                    </span>
                                    <span className="text-[10px] font-black text-red-600">حدث جديد</span>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-2.5 w-full">
                                <div className="flex items-center justify-center gap-1.5 text-[11px] sm:text-xs font-bold text-slate-700 bg-slate-100/90 px-3 py-2 rounded-xl group-hover:bg-blue-50 group-hover:text-blue-700 border border-slate-200/60 group-hover:border-blue-200 transition-colors shadow-2xs truncate">
                                    <CalendarDays size={14} className="text-blue-500 shrink-0 group-hover:scale-110 transition-transform" />
                                    <span className="truncate">{gregorianDate}</span>
                                </div>

                                <div className="flex items-center justify-center gap-1.5 text-[11px] sm:text-xs font-bold text-amber-800 bg-amber-50/90 px-3 py-2 rounded-xl border border-amber-200/60 group-hover:bg-amber-100 transition-colors shadow-2xs truncate">
                                    <Church size={14} className="text-amber-600 shrink-0 group-hover:scale-110 transition-transform" />
                                    <span className="truncate">{copticDate}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </header>

                {/* Smart Alerts & One-Tap Mobile Notification Permission Banner */}
                <IncomingMessageToastBanner />
                <NotificationPermissionBanner className="mb-4" />
                <SmartAlerts />

                {/* التطبيقات الذكية المتغيرة (تم إزالتها وتحويلها لبطاقات رئيسية بناءً على طلب المستخدم) */}



                {/* بطاقة وضع تصفح الأسرة كخادم (Single-Class Servant Impersonation Overview) */}
                {isImpersonating && (
                    <div className="mb-6 bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 text-white p-4 sm:p-5 rounded-3xl shadow-xl border border-amber-400/30 animate-in fade-in duration-300">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/40 text-amber-300 flex items-center justify-center font-black text-lg shrink-0">
                                    {impersonatedOsra?.name ? impersonatedOsra.name.charAt(0) : 'ف'}
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-[11px] font-black bg-amber-500 text-indigo-950 px-2.5 py-0.5 rounded-full">
                                            وضع خادم الفصل
                                        </span>
                                        <span className="text-xs font-bold text-indigo-200">
                                            {impersonatedOsra?.stageName || ''}
                                        </span>
                                    </div>
                                    <h2 className="text-lg sm:text-xl font-black text-white truncate mt-1">
                                        {impersonatedOsra?.name || appSettings.osraName}
                                    </h2>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={handleExitOsraImpersonation}
                                className="w-full sm:w-auto bg-white/10 hover:bg-white/20 text-white border border-white/20 px-4 py-2 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-1.5 shrink-0"
                            >
                                <ArrowRight size={14} /> العودة للوضع الإداري
                            </button>
                        </div>

                        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
                            <div className="bg-white/10 rounded-2xl p-2.5 text-center border border-white/10">
                                <span className="block text-lg sm:text-xl font-black text-amber-300">
                                    {children?.length || classCounts?.[activeSyncKey] || 0}
                                </span>
                                <span className="text-[11px] font-bold text-indigo-100">إجمالي المخدومين</span>
                            </div>
                            <div className="bg-emerald-500/20 rounded-2xl p-2.5 text-center border border-emerald-400/30">
                                <span className="block text-lg sm:text-xl font-black text-emerald-300">
                                    {weeklyAttendance?.presentCount || 0}
                                </span>
                                <span className="text-[11px] font-bold text-emerald-100">حضور هذا الأسبوع</span>
                            </div>
                            <div className="bg-blue-500/20 rounded-2xl p-2.5 text-center border border-blue-400/30">
                                <span className="block text-lg sm:text-xl font-black text-blue-300">
                                    {weeklyAttendance?.liturgyCount || 0}
                                </span>
                                <span className="text-[11px] font-bold text-blue-100">حضور القداس</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <Link
                                to="/qr-attendance"
                                className="bg-amber-500 hover:bg-amber-400 text-indigo-950 py-2.5 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                            >
                                <QrCode size={15} /> حضور بالـ QR
                            </Link>
                            <Link
                                to="/attendance"
                                className="bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                            >
                                <Users size={15} /> سجل الغياب
                            </Link>
                            <Link
                                to="/visitation"
                                className="bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                            >
                                <MapPin size={15} /> خريطة الافتقاد
                            </Link>
                            <Link
                                to="/dashboard"
                                className="bg-amber-400 hover:bg-amber-300 text-[#162447] py-2.5 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                            >
                                <LayoutDashboard size={15} /> لوحة تحكم الأسرة
                            </Link>
                        </div>
                    </div>
                )}

                {/* شريط الإجراءات السريع لخادم الفصل (لوحة تحكم الأسرة + إرسال رسالة للمخدومين) */}
                {!isMaster && (
                    <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 gap-3 animate-card-enter">
                        <Link
                            to="/dashboard"
                            className="p-4 rounded-3xl text-white shadow-lg border border-amber-400/45 flex items-center justify-between gap-3 hover:brightness-110 transition-all tactile-press"
                            style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 68%, #8C621E 100%)' }}
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-11 h-11 rounded-2xl bg-amber-400/20 border border-amber-300/45 text-amber-300 flex items-center justify-center shrink-0">
                                    <LayoutDashboard size={22} />
                                </div>
                                <div className="min-w-0">
                                    <h2 className="font-calligraphic text-base sm:text-lg font-bold text-amber-100 leading-snug truncate">
                                        لوحة تحكم الأسرة
                                    </h2>
                                    <p className="text-[11px] font-bold text-indigo-100/90 truncate">
                                        مرايا المخدومين وشيت الإكسيل والإحصائيات
                                    </p>
                                </div>
                            </div>
                            <ChevronRight size={18} className="text-amber-300 shrink-0 rotate-180" />
                        </Link>

                        <button
                            type="button"
                            onClick={() => setBroadcastModal({ isOpen: true, targetType: 'children', syncKey: activeSyncKey })}
                            className="p-4 rounded-3xl coptic-card border-2 border-[#C8942E]/45 hover:border-[#C8942E] flex items-center justify-between gap-3 text-right transition-all tactile-press cursor-pointer"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-11 h-11 rounded-2xl bg-emerald-700 text-white flex items-center justify-center shrink-0 shadow-xs">
                                    <Send size={20} />
                                </div>
                                <div className="min-w-0">
                                    <h2 className="font-calligraphic text-base sm:text-lg font-bold text-[#1B2A59] leading-snug truncate">
                                        إرسال رسالة لمخدومي الفصل
                                    </h2>
                                    <p className="text-[11px] font-bold text-[#6E5329] truncate">
                                        نص • صورة • فيديو • رابط + واتساب مباشر
                                    </p>
                                </div>
                            </div>
                            <ChevronRight size={18} className="text-[#8C621E] shrink-0 rotate-180" />
                        </button>
                    </div>
                )}

                {/* مركز الرسائل العام للأب الكاهن / أمين الخدمة / أمين المرحلة */}
                {isMaster && (
                    <div className="mb-5 animate-card-enter">
                        <button
                            type="button"
                            onClick={() => setBroadcastModal({ isOpen: true, targetType: 'servants', syncKey: '' })}
                            className="w-full p-4 rounded-3xl text-white shadow-lg border border-amber-400/45 flex items-center justify-between gap-3 hover:brightness-110 transition-all tactile-press text-right cursor-pointer"
                            style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 65%, #8C621E 100%)' }}
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-11 h-11 rounded-2xl bg-amber-400/20 border border-amber-300/40 text-amber-300 flex items-center justify-center shrink-0">
                                    <Megaphone size={22} />
                                </div>
                                <div className="min-w-0">
                                    <h2 className="font-calligraphic text-base sm:text-lg font-bold text-amber-100 leading-snug truncate">
                                        {isSuperAdmin
                                            ? 'مركز الرسائل العام (إرسال للخدام أو للمخدومين)'
                                            : `مركز رسائل المرحلة (${accessScope.stageName || 'المرحلة'})`}
                                    </h2>
                                    <p className="text-[11px] font-bold text-indigo-100/90 truncate">
                                        إرسال نص • صورة • فيديو • رابط — داخل التطبيق + إشعار موبايل + واتساب
                                    </p>
                                </div>
                            </div>
                            <ChevronRight size={18} className="text-amber-300 shrink-0 rotate-180" />
                        </button>
                    </div>
                )}

                {/* سجل الرسائل والإعلانات المرسلة والواردة مباشرة أسفل زر المراسلة */}
                <div className="mb-5">
                    <BroadcastMessagesFeed
                        mode="servant"
                        title="سجل الرسائل والإعلانات المرسلة والواردة"
                        onComposeClick={() => setBroadcastModal({ isOpen: true, targetType: isMaster ? 'servants' : 'children', syncKey: activeSyncKey })}
                    />
                </div>

                {/* Unified Quick-Access Grid (Balanced Responsive Cards — Zero Title Clipping) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-5">
                    {isMaster && (
                        <Link
                            to="/master-dashboard"
                            className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 via-amber-500 to-yellow-600 p-4 text-white shadow-md shadow-amber-500/20 border border-amber-300/70 flex items-center justify-between gap-3 hover:shadow-lg transition-all tactile-press min-h-[82px]"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-11 h-11 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
                                    <Crown size={20} />
                                </div>
                                <div className="min-w-0">
                                    <h2 className="font-calligraphic text-base sm:text-lg font-bold leading-snug">
                                        {isSuperAdmin ? 'لوحة الكاهن الشاملة' : 'لوحة متابعة المرحلة'}
                                    </h2>
                                    <p className="text-[11px] font-bold text-amber-50 leading-snug mt-0.5">
                                        {isSuperAdmin ? 'مراقبة جميع الأسر' : accessScope.stageName}
                                    </p>
                                </div>
                            </div>
                            <ChevronRight size={18} className="text-white/90 shrink-0 rotate-180 group-hover:-translate-x-0.5 transition-transform" />
                        </Link>
                    )}

                    {isMaster && (
                        <Link
                            to="/dashboard"
                            onClick={() => sessionStorage.setItem('dashboard_activeClassKey', 'all')}
                            className="group coptic-card rounded-2xl p-4 border-2 border-[#C8942E]/75 hover:border-[#1B2A59] flex items-center justify-between gap-3 shadow-sm hover:shadow-md transition-all tactile-press min-h-[82px]"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#1B2A59] to-[#283E80] text-amber-300 border border-amber-400/40 flex items-center justify-center shadow-xs shrink-0">
                                    <LayoutDashboard size={20} />
                                </div>
                                <div className="min-w-0">
                                    <h3 className="font-calligraphic text-base sm:text-lg font-bold text-[#1B2A59] leading-snug">
                                        إدارة الأسر والتقارير
                                    </h3>
                                    <p className="text-[11px] text-[#6E5329] font-semibold leading-snug mt-0.5">
                                        تقارير الحضور والغياب، التنبيهات، وبيانات الأسر
                                    </p>
                                </div>
                            </div>
                            <ChevronRight size={18} className="text-[#1B2A59] shrink-0 rotate-180 group-hover:-translate-x-0.5 transition-transform" />
                        </Link>
                    )}

                    <Link
                        to="/points"
                        className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1B2A59] via-[#1E316A] to-[#111C3D] p-4 text-white shadow-md shadow-[#1B2A59]/15 border border-amber-400/35 flex items-center justify-between gap-3 hover:shadow-lg transition-all tactile-press min-h-[82px]"
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-300 to-amber-500 text-[#1B2A59] flex items-center justify-center shadow-sm shrink-0">
                                <Trophy size={20} />
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <h3 className="font-calligraphic text-base sm:text-lg font-bold text-amber-100 leading-snug">
                                        النقاط والمكافآت
                                    </h3>
                                    <span className="text-[10px] font-bold bg-amber-400/20 text-amber-200 border border-amber-400/30 px-1.5 py-0.5 rounded-full shrink-0">
                                        {formatArabicMonthKey(pointsShowcase.monthKey)}
                                    </span>
                                </div>
                                <p className="text-[11px] text-indigo-100/90 font-semibold leading-snug mt-0.5">
                                    {pointsShowcase.topChild
                                        ? <span className="inline-flex items-center gap-1 max-w-full"><Award size={12} className="text-amber-300 shrink-0" /><span className="truncate">{pointsShowcase.topChild.name} ({pointsShowcase.topChild.totalPoints})</span></span>
                                        : 'لوحة شرف المخدومين'}
                                </p>
                            </div>
                        </div>
                        <ChevronRight size={18} className="text-amber-300 shrink-0 rotate-180 group-hover:-translate-x-0.5 transition-transform" />
                    </Link>

                    <Link
                        to={isMaster ? '/curriculum' : (activeSyncKey ? `/curriculum?syncKey=${encodeURIComponent(activeSyncKey)}` : '/curriculum')}
                        className="group coptic-card rounded-2xl p-4 flex items-center justify-between gap-3 hover:border-amber-500/50 transition-all tactile-press min-h-[82px]"
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-800 border border-amber-300/60 flex items-center justify-center shrink-0">
                                <BookOpen size={20} />
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <h3 className="font-calligraphic text-base sm:text-lg font-bold text-[#1B2A59] leading-snug">
                                        {isMaster ? 'منظومة المناهج' : 'منهج الأسرة'}
                                    </h3>
                                    <span className="text-[10px] font-bold bg-indigo-50 text-[#1B2A59] border border-indigo-200/70 px-1.5 py-0.5 rounded-full tabular-nums shrink-0">
                                        {isMaster ? pointsShowcase.totalCurricula : getOsraCurricula(activeSyncKey, allLiveCurricula).length}
                                    </span>
                                </div>
                                <p className="text-[11px] text-[#6E5329] font-semibold leading-snug mt-0.5">
                                    الكتاب المقدس • العقيدة • الألحان
                                </p>
                            </div>
                        </div>
                        <ChevronRight size={18} className="text-[#1B2A59] shrink-0 rotate-180 group-hover:-translate-x-0.5 transition-transform" />
                    </Link>

                    <Link
                        to="/exams"
                        className="group coptic-card rounded-2xl p-4 flex items-center justify-between gap-3 hover:border-[#C89B3C] transition-all tactile-press min-h-[82px]"
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-11 h-11 rounded-xl bg-indigo-100 text-[#1B2A59] border border-indigo-200 flex items-center justify-center shrink-0">
                                <Award size={20} />
                            </div>
                            <div className="min-w-0">
                                <h3 className="font-calligraphic text-base sm:text-lg font-bold text-[#1B2A59] leading-snug">
                                    النتائج والامتحانات
                                </h3>
                                <p className="text-[11px] text-[#6E5329] font-semibold leading-snug mt-0.5">
                                    رصد الدرجات وتقييم المخدومين
                                </p>
                            </div>
                        </div>
                        <ChevronRight size={18} className="text-[#1B2A59] shrink-0 rotate-180 group-hover:-translate-x-0.5 transition-transform" />
                    </Link>
                </div>

                {/* Classes Dashboard (Central Control Room) */}
                {isMaster && (
                    <div className="mb-8 animate-card-enter">
                        {/* Compact Weekly Activity Summary Bar */}
                        <WeeklyClassActivitySummary 
                            classes={masterOsras} 
                            activityByClass={activityByClass}
                            classCounts={classCounts}
                            isLoadingInitialData={isLoadingInitialData}
                            onClassClick={(osra) => handleEnterOsra(osra)} 
                        />

                        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                            <h2 className="font-calligraphic text-xl sm:text-2xl font-bold text-[#1B2A59] flex items-center gap-2">
                                <Church className="text-amber-600" />
                                {isSuperAdmin ? 'لوحة الفصول والأسر والخدمات' : `فصول ${accessScope.stageName}`}
                            </h2>
                            {isSuperAdmin && (
                                <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                                    <span className="bg-amber-50 text-amber-900 border border-amber-200 px-2.5 py-1 rounded-full">مدارس الأحد: الأحد والخميس • القداس: الجمعة</span>
                                    <span className="bg-indigo-50 text-indigo-800 border border-indigo-200 px-2.5 py-1 rounded-full">إعدادي: الجمعة</span>
                                    <span className="bg-sky-50 text-sky-800 border border-sky-200 px-2.5 py-1 rounded-full">ثانوي: الخميس</span>
                                    <span className="bg-purple-50 text-purple-800 border border-purple-200 px-2.5 py-1 rounded-full">جامعة: الاثنين</span>
                                    <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded-full">الخدام: الأربعاء</span>
                                </div>
                            )}
                        </div>

                        {masterOsras.length > 0 ? (() => {
                            const sundaySchoolList = masterOsras
                                .filter(o => {
                                    const sc = getClassScheduleConfig(o, o.name, appSettings);
                                    return sc.isSundaySchool || o.syncKey.includes('sunday_school') || (o.serviceName || '').includes('مدارس الأحد');
                                })
                                .sort((a, b) => {
                                    const aIsServants = (a.name || '').includes('خدام مدارس الأحد') || a.syncKey === 'sunday_school_servants' ? 0 : 1;
                                    const bIsServants = (b.name || '').includes('خدام مدارس الأحد') || b.syncKey === 'sunday_school_servants' ? 0 : 1;
                                    return aIsServants - bIsServants;
                                });
                            const otherServicesList = masterOsras.filter(o => !sundaySchoolList.includes(o));

                            const renderOsraCard = (osra, i) => {
                                const act = activityByClass[osra.syncKey] || {};
                                const totalKids = act.totalActiveChildren ?? classCounts[osra.syncKey] ?? 0;
                                const presentCount = Math.min(act.presentCount || 0, totalKids);
                                const sched = getClassScheduleConfig(osra, osra.name, appSettings);
                                const isServantsRoster = (osra.name || '').includes('خدام مدارس الأحد') || osra.syncKey === 'sunday_school_servants';
                                const showLoadingKids = totalKids === 0 && isLoadingInitialData;
                                const curriculaCount = getOsraCurricula(osra.syncKey, allLiveCurricula, [osra]).length;
                                return (
                                    <div key={osra.syncKey || i} className={`bg-gradient-to-br ${isServantsRoster ? 'from-[#2A1F0A] via-[#1B2A59] to-[#111C3D] border-amber-400/70 ring-1 ring-amber-400/35' : 'from-[#1B2A59] to-[#111C3D] border-amber-500/25'} p-4 sm:p-5 rounded-3xl shadow-lg shadow-[#1B2A59]/15 border flex flex-col justify-between hover:scale-[1.01] transition-transform`}>
                                        <div className="flex items-center justify-between gap-3 mb-3">
                                            <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                                                <img 
                                                    src={resolveOsraLogoUrl(osra)} 
                                                    alt={osra.name} 
                                                    onError={(e) => {
                                                        e.currentTarget.onerror = null;
                                                        e.currentTarget.src = DEFAULT_CHURCH_LOGO_PATH;
                                                    }}
                                                    className="w-14 h-14 rounded-2xl object-contain bg-white p-1 shadow-sm shrink-0" 
                                                />
                                                <div className="min-w-0">
                                                    {isServantsRoster && (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-black bg-amber-400 text-[#1B2A59] px-2 py-0.5 rounded-full mb-1">
                                                            <Users size={11} /> قائمة خدام مدارس الأحد
                                                        </span>
                                                    )}
                                                    <h3 className="text-white font-black text-base sm:text-lg truncate">{osra.name}</h3>
                                                    <span className="text-xs font-bold text-indigo-100/90 flex items-center gap-1 mt-0.5 tabular-nums flex-wrap">
                                                        {showLoadingKids ? <span className="inline-flex items-center gap-1"><Clock size={12} /> جاري التحميل...</span> : <span className="inline-flex items-center gap-1">{isServantsRoster ? <User size={12} /> : <Users size={12} />} {totalKids} {isServantsRoster ? 'خادم' : 'مخدوم'}</span>} • {sched.scheduleBadge}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Activity Badges */}
                                        <div className="flex flex-wrap items-center gap-2 mb-4">
                                            {act.hasRecordedAttendance ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setModalState({ isOpen: true, type: 'service', classSyncKey: osra.syncKey, className: osra.name })}
                                                    className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-400/40 px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1 shadow-xs cursor-pointer transition-colors min-h-[36px]"
                                                    title="اضغط لعرض قائمة الحاضرين"
                                                >
                                                    <CheckCircle size={13} /> سجل الحضور ({presentCount} / {totalKids})
                                                </button>
                                            ) : showLoadingKids ? (
                                                <span className="bg-slate-800/80 text-slate-300 border border-slate-700/80 px-2.5 py-1 rounded-xl text-xs font-bold flex items-center gap-1 animate-pulse">
                                                    <Clock size={13} /> جاري تحميل بيانات الفصل...
                                                </span>
                                            ) : (
                                                <span className="bg-slate-900/60 text-slate-300 border border-slate-700/80 px-2.5 py-1 rounded-xl text-xs font-bold flex items-center gap-1">
                                                    <Clock size={13} /> لم يسجل الحضور بعد (0 / {totalKids})
                                                </span>
                                            )}

                                            {act.hasRecordedVisitation ? (
                                                <span className="bg-amber-500/20 text-amber-200 border border-amber-400/40 px-2.5 py-1 rounded-xl text-xs font-black flex items-center gap-1 shadow-xs">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping inline-block" />
                                                    <HomeIcon size={12} /> افتقد ({act.visitationCount})
                                                </span>
                                            ) : null}

                                            <span className="bg-amber-400/15 text-amber-200 border border-amber-300/35 px-2.5 py-1 rounded-xl text-xs font-black flex items-center gap-1">
                                                <BookOpen size={12} /> {curriculaCount} مناهج
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleOpenOsraDashboard(osra)}
                                                className="w-full min-h-[44px] bg-white/15 hover:bg-white/25 text-amber-100 border border-amber-300/40 py-2.5 px-3 rounded-2xl text-xs sm:text-sm font-black shadow-sm transition-colors flex items-center justify-center gap-1.5 tactile-press cursor-pointer"
                                            >
                                                <LayoutDashboard size={16} />
                                                <span>لوحة تحكم الأسرة</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleEnterOsra(osra)}
                                                className="w-full min-h-[44px] bg-amber-400 hover:bg-amber-300 text-[#1B2A59] py-2.5 px-3 rounded-2xl text-xs sm:text-sm font-black shadow-md transition-colors flex items-center justify-center gap-1.5 tactile-press cursor-pointer"
                                            >
                                                <Award size={16} />
                                                <span>{isServantsRoster ? 'إدارة خدام مدارس الأحد' : 'الدخول كخادم للأسرة'}</span>
                                            </button>
                                        </div>
                                    </div>
                                );
                            };

                            return (
                                <div className="space-y-6">
                                    {sundaySchoolList.length > 0 && (
                                        <section className="rounded-3xl bg-amber-50/70 border border-amber-300/60 p-4 sm:p-5">
                                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
                                                <h3 className="font-calligraphic text-lg sm:text-xl font-bold text-[#1B2A59] flex items-center gap-2">
                                                    <Church size={18} className="text-[#8C621E] shrink-0" /> <span>مجموعة مدارس الأحد (حضانة وابتدائي + خدام مدارس الأحد)</span>
                                                </h3>
                                                <span className="text-xs font-black bg-[#1B2A59] text-amber-200 px-3 py-1 rounded-full inline-flex items-center gap-1.5">
                                                    <CalendarDays size={12} /> الأحد والخميس • <Church size={12} /> قداس الجمعة
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                {sundaySchoolList.map((osra, idx) => renderOsraCard(osra, `ss_${idx}`))}
                                            </div>
                                        </section>
                                    )}

                                    {otherServicesList.length > 0 && (
                                        <section>
                                            <h3 className="font-kufi text-base sm:text-lg font-black text-[#1B2A59] mb-3 flex items-center gap-2">
                                                <Church size={17} className="text-[#8C621E] shrink-0" /> <span>خدمات المراحل والاجتماع العام</span>
                                            </h3>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                {otherServicesList.map((osra, idx) => renderOsraCard(osra, `oth_${idx}`))}
                                            </div>
                                        </section>
                                    )}
                                </div>
                            );
                        })() : (
                            <div className="text-center p-8 bg-white rounded-3xl shadow-sm border border-slate-100 text-slate-500 font-bold">
                                لا توجد أسر مخصصة لك.
                            </div>
                        )}
                    </div>
                )}

                {/* 3 Primary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    {/* 1. سجل الغياب */}
                    {!isMaster && (
                        <div className="relative overflow-hidden p-6 rounded-3xl border border-indigo-100 shadow-xl bg-white hover:border-indigo-300 transition-all duration-300 flex flex-col items-center text-center">
                            <Link to="/attendance" className="flex flex-col items-center w-full pb-4">
                                <div className="w-16 h-16 rounded-full bg-indigo-900 text-white flex items-center justify-center mb-3 transition-transform hover:scale-110">
                                    <Users size={32} strokeWidth={2} />
                                </div>
                                <h2 className="text-xl font-black mb-1 text-indigo-900">سجل الغياب</h2>
                                <p className="text-[11px] font-bold text-slate-500">تسجيل ومتابعة حضور اليوم</p>
                            </Link>

                            <div className="w-full pt-4 border-t border-slate-100 grid grid-cols-1 gap-2 mt-auto">
                                <button onClick={() => setModalState({ isOpen: true, type: 'absent' })} className="bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-xs font-black shadow-md transition-all flex items-center justify-center gap-1.5 w-full">
                                    <UserMinus size={14} /> مين غاب؟ ({weeklyAttendance?.whoAbsentServiceList?.length || 0})
                                </button>
                                <div className="flex gap-2 w-full">
                                    <button onClick={() => setModalState({ isOpen: true, type: 'service' })} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-xl text-[11px] font-black shadow-md transition-all flex items-center justify-center gap-1.5">
                                        <UserCheck size={14} /> حضر الخدمة ({weeklyAttendance?.presentCount || 0})
                                    </button>
                                    <button onClick={() => setModalState({ isOpen: true, type: 'liturgy' })} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-xl text-[11px] font-black shadow-md transition-all flex items-center justify-center gap-1.5">
                                        <Church size={14} /> حضر القداس ({weeklyAttendance?.liturgyCount || 0})
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 2. أعياد الميلاد والمواظبة */}
                    {!isMaster && (
                        <div className="relative overflow-hidden p-6 rounded-3xl bg-white border border-indigo-100 shadow-xl transition-all duration-300 flex flex-col">
                            <div className="flex items-center gap-3 mb-4 border-b border-slate-100 pb-3">
                                <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                                    <Gift size={20} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-indigo-900">أعياد الميلاد</h2>
                                </div>
                            </div>

                            <div className="flex flex-col gap-3 flex-1 overflow-y-auto max-h-40 pr-1 mb-4">
                                {widgetData?.birthdays?.length > 0 ? widgetData.birthdays.map(c => (
                                    <div key={c.id} className="flex justify-between items-center bg-slate-50 p-3 rounded-2xl">
                                        <span className="text-xs font-black text-indigo-900">{c.name}</span>
                                        <Gift className="text-amber-500" size={16} />
                                    </div>
                                )) : <p className="text-xs font-bold text-slate-400 text-center py-2">لا يوجد أعياد ميلاد هذا الشهر</p>}
                            </div>

                            <div className="w-full pt-4 border-t border-slate-100 mt-auto">
                                <button onClick={() => setModalState({ isOpen: true, type: 'champions' })} className="w-full bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-xl text-xs font-black shadow-md transition-all flex items-center justify-center gap-1.5">
                                    <Trophy size={15} /> عرض مخدومين المواظبة
                                </button>
                            </div>
                        </div>
                    )}

                    {/* 3. الافتقاد */}
                    {!isMaster && (
                        <Link to="/visitation" className="group p-6 rounded-3xl bg-white border border-indigo-100 hover:border-indigo-300 shadow-xl hover:shadow-indigo-900/20 transition-all duration-300 flex flex-col items-center justify-center text-center cursor-pointer">
                            <div className="w-16 h-16 rounded-full bg-indigo-900 text-amber-500 flex items-center justify-center mb-3 transition-transform group-hover:scale-110">
                                <MapPin size={32} strokeWidth={2} />
                            </div>
                            <h2 className="text-xl font-black text-indigo-900 mb-1">خريطة الافتقاد</h2>
                            <p className="text-[11px] font-bold text-slate-500">متابعة الغياب وزيارات البيوت</p>
                        </Link>
                    )}
                </div>

                {/* تسجيل حضور الخادم الذاتي (Self Check-in) */}
                {!isMaster && (
                    <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <button
                            onClick={() => navigate('/servant-checkin')}
                            className="w-full bg-gradient-to-l from-emerald-600 to-emerald-800 hover:from-emerald-700 hover:to-emerald-900 p-6 rounded-[2.5rem] shadow-xl shadow-emerald-900/20 hover:shadow-2xl transition-all duration-300 flex items-center justify-between group border border-emerald-500/30 text-right cursor-pointer transform active:scale-95"
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-14 h-14 bg-white/20 text-white rounded-2xl flex items-center justify-center group-hover:scale-105 transition-all backdrop-blur-sm">
                                    <UserCheck size={28} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-white">تسجيل حضوري اليوم</h2>
                                    <p className="text-xs text-emerald-100 mt-1 font-bold">
                                        سجل حضورك، القداس، والافتقاد بضغطة واحدة
                                    </p>
                                </div>
                            </div>
                            <div className="w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center group-hover:-translate-x-1 transition-all">
                                <ChevronRight size={20} className="rotate-180" />
                            </div>
                        </button>
                    </div>
                )}

                {/* دليل الأبطال (Deacons Directory) */}
                {!isMaster && (
                    <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <button
                            onClick={() => navigate('/info-directory')}
                            className="w-full bg-indigo-900 hover:bg-indigo-950 p-4 sm:p-6 rounded-3xl sm:rounded-[2.5rem] shadow-md hover:shadow-lg transition-all duration-300 flex items-center justify-between gap-3 group border border-indigo-800 text-right cursor-pointer"
                        >
                            <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-amber-500/10 text-amber-500 rounded-2xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-all">
                                    <BookOpen size={24} className="sm:w-7 sm:h-7" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h2 className="text-base sm:text-lg font-black text-white truncate">دليل المخدومين</h2>
                                    <p className="text-xs text-indigo-200 mt-1 font-bold leading-snug">
                                        عرض وتعديل بيانات المخدومين، المجموعات، والملفات الشخصية بالكامل
                                    </p>
                                </div>
                            </div>
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/10 text-white flex items-center justify-center shrink-0 group-hover:translate-x-[-4px] transition-all">
                                <ChevronRight size={20} className="rotate-180" />
                            </div>
                        </button>
                    </div>
                )}

                {/* Sections for Exams and Curriculum */}
                {!isMaster && (
                    <div className="space-y-4 mb-8">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Link to="/exams" className="coptic-card p-5 rounded-3xl flex items-center gap-4 hover:border-[#C89B3C] transition-all min-h-[82px] tactile-press">
                                <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-[#1B2A59] flex items-center justify-center shrink-0">
                                    <Award size={24} />
                                </div>
                                <div>
                                    <h3 className="font-black text-[#1B2A59]">النتائج والامتحانات وتقييم المخدومين</h3>
                                    <p className="text-xs text-[#6E5329] font-bold">رصد وتقييم أداء المخدومين</p>
                                </div>
                            </Link>

                            <Link
                                to={activeSyncKey ? `/curriculum?syncKey=${encodeURIComponent(activeSyncKey)}` : '/curriculum'}
                                className="coptic-card p-5 rounded-3xl flex items-center gap-4 hover:border-[#C89B3C] transition-all min-h-[82px] tactile-press"
                            >
                                <div className="w-12 h-12 rounded-2xl bg-[#EFE0C2] text-[#8C621E] flex items-center justify-center shrink-0">
                                    <FileText size={24} />
                                </div>
                                <div className="min-w-0">
                                    <h3 className="font-black text-[#1B2A59] truncate">
                                        منهج ودروس: {appSettings.osraName || activeSyncKey}
                                    </h3>
                                    <p className="text-xs text-[#6E5329] font-bold">
                                        {getOsraCurricula(activeSyncKey, allLiveCurricula).length} ملف PDF ودرس مضاف للأسرة
                                    </p>
                                </div>
                            </Link>
                        </div>

                        {/* كارت درس هذه الجمعة من كتاب المنهج السنوي الذكي (إن وجد للأسرة) */}
                        <ActiveFridayLessonCard
                            copticBooks={getOsraCopticBookPlans(activeSyncKey, allLiveCurricula)}
                            headingPrefix="درس هذه الجمعة"
                        />

                        {/* مناهج الفصل المفعلة */}
                        {(classCurricula.length > 0 || dbClassCurricula.length > 0) && (
                            <div className="coptic-card shimmer-gold-border rounded-3xl p-4 sm:p-5 space-y-3 animate-card-enter">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E7D4AF] pb-2.5">
                                    <h3 className="font-calligraphic text-lg sm:text-xl font-bold text-[#1B2A59] flex items-center gap-2">
                                        <BookOpen size={19} className="text-[#8C621E]" />
                                        <span>مناهج ومذكرات الفصل ({appSettings.osraName})</span>
                                    </h3>
                                    <Link
                                        to={activeSyncKey ? `/curriculum?syncKey=${encodeURIComponent(activeSyncKey)}` : '/curriculum'}
                                        className="text-xs font-black bg-[#EFE0C2] hover:bg-[#E7D4AF] text-[#1B2A59] px-3 py-1.5 rounded-xl transition-colors"
                                    >
                                        إدارة كل المناهج ←
                                    </Link>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {(() => {
                                        const merged = [...classCurricula];
                                        const seenTitles = new Set(merged.map(c => (c.title || '').trim()));
                                        for (const row of dbClassCurricula) {
                                            if (!seenTitles.has((row.title || '').trim())) {
                                                seenTitles.add((row.title || '').trim());
                                                merged.push({
                                                    id: row.id,
                                                    title: row.title,
                                                    category: row.category,
                                                    fileUrl: row.attachmentUrl || '',
                                                    description: row.summary || '',
                                                    status: row.status || ''
                                                });
                                            }
                                        }
                                        return merged.slice(0, 4).map((cur) => {
                                            const attachment = cur.fileUrl || cur.pdfData || '';
                                            return (
                                                <div key={cur.id} className="bg-[#FAF3E3]/85 border border-[#DFC48F] rounded-2xl p-3.5 flex flex-col justify-between gap-2">
                                                    <div>
                                                        <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1">
                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                                {cur.trackName && (
                                                                    <span className="text-[10px] font-black bg-[#1B2A59] text-amber-200 px-2 py-0.5 rounded-full">
                                                                        {cur.trackName}
                                                                    </span>
                                                                )}
                                                                <span className="text-[11px] font-black bg-[#EFE0C2] text-[#7A5617] px-2 py-0.5 rounded-full">
                                                                    {cur.category}
                                                                </span>
                                                            </div>
                                                            {cur.status && (
                                                                <span className="text-[10px] font-black text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                                                    {cur.status}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <h4 className="font-black text-sm text-[#1B2A59] leading-snug">{cur.title}</h4>
                                                        {cur.description && (
                                                            <p className="text-xs font-semibold text-[#5C492B] mt-1 line-clamp-2">{cur.description}</p>
                                                        )}
                                                    </div>
                                                    {attachment && (
                                                        <button
                                                            type="button"
                                                            onClick={() => openCurriculumAttachment(navigate, attachment, cur.title)}
                                                            className="self-start min-h-[36px] px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center gap-1 cursor-pointer"
                                                        >
                                                            <FileText size={13} /> فتح المذكرة / المرفق
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* أدوات QR — تسجيل حضور وطباعة كارنيهات */}
                {!isMaster && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                        <Link to="/qr-attendance" className="bg-white p-5 rounded-2xl shadow-md border border-slate-100 flex items-center gap-4 hover:bg-slate-50 transition-all duration-300">
                            <div className="w-12 h-12 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center">
                                <QrCode size={24} />
                            </div>
                            <div>
                                <h3 className="font-black text-indigo-900">حضور QR سريع</h3>
                                <p className="text-xs text-slate-500 font-bold">مسح بطاقات المخدومين وتسجيل الحضور</p>
                            </div>
                        </Link>

                        <Link to="/generate-cards" className="bg-white p-5 rounded-2xl shadow-md border border-slate-100 flex items-center gap-4 hover:bg-slate-50 transition-all duration-300">
                            <div className="w-12 h-12 rounded-full bg-cyan-100 text-cyan-700 flex items-center justify-center">
                                <CreditCard size={24} />
                            </div>
                            <div>
                                <h3 className="font-black text-indigo-900">طباعة كارنيهات QR</h3>
                                <p className="text-xs text-slate-500 font-bold">إنشاء وطباعة بطاقات QR للمخدومين</p>
                            </div>
                        </Link>
                    </div>
                )}

                {/* متابعة أنشطة الأسرة (Read-Only) */}
                {!isMaster && (
                    <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 mb-8">
                        <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2">
                            <Target className="text-indigo-500" size={24} /> متابعة أنشطة الأسرة
                        </h3>

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
                                            <div key={act.id} className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
                                                <p className="text-sm font-bold text-slate-700">{act.text}</p>
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
                                            <div key={act.id} className="bg-white p-3 rounded-xl shadow-sm border border-green-200 flex items-center gap-2">
                                                <CheckCircle size={20} className="text-green-600 shrink-0" />
                                                <p className="text-sm font-bold text-slate-800">{act.text}</p>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </main>

            <BroadcastMessageCenter
                isOpen={broadcastModal.isOpen}
                initialTargetType={broadcastModal.targetType}
                initialSyncKey={broadcastModal.syncKey}
                onClose={() => setBroadcastModal({ isOpen: false, targetType: '', syncKey: '' })}
            />

            {/* المودال بتاع تقرير الغياب السريع */}
            {modalState.isOpen && (
                <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white w-full max-w-md rounded-[2.5rem] p-6 shadow-2xl animate-in slide-in-from-bottom-8">
                        <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
                            <h2 className={`text-lg font-black flex items-center gap-2 
                                ${modalState.type === 'absent' ? 'text-red-600' : modalState.type === 'champions' ? 'text-amber-500' : modalState.type === 'service' ? 'text-green-600' : 'text-blue-600'}`}>
                                {modalState.type === 'absent' && <><UserMinus size={20} /> مين غاب؟ ({reportBoys.length + reportGirls.length})</>}
                                {modalState.type === 'service' && <><BookOpen size={20} /> حضروا الخدمة {modalState.className ? `— ${modalState.className}` : ''} ({reportBoys.length + reportGirls.length})</>}
                                {modalState.type === 'liturgy' && <><Church size={20} /> حضروا القداس ({reportBoys.length + reportGirls.length})</>}
                                {modalState.type === 'champions' && <><Award size={20} className="text-amber-500 animate-bounce" /> مخدومين المواظبة</>}
                            </h2>
                            <button onClick={() => setModalState({ isOpen: false, type: null })} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"><X size={16} /></button>
                        </div>

                        <div className="max-h-[60vh] overflow-y-auto pr-1">
                            {modalState.type === 'champions' ? (
                                <div className="space-y-2.5">
                                    {widgetData.topStreaks.length > 0 ? (
                                        widgetData.topStreaks.map((child, index) => (
                                            <div key={child.id} className="flex justify-between items-center bg-amber-50/50 p-3.5 rounded-2xl border border-amber-100 shadow-sm">
                                                <div className="flex items-center gap-2.5">
                                                    <span className="w-6 h-6 rounded-full bg-amber-500 text-white font-black text-xs flex items-center justify-center">
                                                        {index + 1}
                                                    </span>
                                                    <span className="font-black text-xs text-slate-800">{child.name}</span>
                                                </div>
                                                <span className="text-xs font-black text-amber-700 bg-amber-100 px-3 py-1 rounded-xl flex items-center gap-1">
                                                    <Flame size={12} /> {child.streak} مواظبة
                                                </span>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-xs font-bold text-slate-400 text-center py-4">لا يوجد مخدومين مواظبة حالياً</p>
                                    )}
                                </div>
                            ) : (
                                <>
                                    {reportBoys.length > 0 && (
                                        <div className="mb-6">
                                            <h3 className="bg-blue-50 text-blue-700 font-black text-xs py-2 px-3 rounded-lg mb-3 inline-flex items-center gap-1">
                                                <User size={13} /> ولاد ({reportBoys.length})
                                            </h3>
                                            <div className="space-y-2">
                                                {reportBoys.map(child => (
                                                    <div key={child.id} className="flex justify-between items-center bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
                                                        <span className="font-black text-xs text-slate-700">{child.name || 'بدون اسم'}</span>
                                                        {modalState.type === 'absent' && (
                                                            <div className="flex gap-1 flex-wrap">
                                                                {child.fatherPhone && <a href={generateMissedFridayMsg(child, 'father')} target="_blank" rel="noreferrer" className="bg-blue-600 text-blue-50 px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 hover:bg-blue-700"><MessageCircleWarning size={12} /> أب</a>}
                                                                {child.motherPhone && <a href={generateMissedFridayMsg(child, 'mother')} target="_blank" rel="noreferrer" className="bg-pink-600 text-pink-50 px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 hover:bg-pink-700"><MessageCircleWarning size={12} /> أم</a>}
                                                                {child.childPhone && <a href={generateMissedFridayMsg(child, 'child')} target="_blank" rel="noreferrer" className="bg-green-600 text-green-50 px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 hover:bg-green-700"><MessageCircleWarning size={12} /> مخدوم</a>}
                                                                {(!child.fatherPhone && !child.motherPhone && !child.childPhone) && <a href={generateMissedFridayMsg(child)} target="_blank" rel="noreferrer" className="bg-slate-600 text-slate-50 px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 hover:bg-slate-700"><MessageCircleWarning size={12} /> رسالة</a>}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {reportGirls.length > 0 && (
                                        <div>
                                            <h3 className="bg-pink-50 text-pink-700 font-black text-xs py-2 px-3 rounded-lg mb-3 inline-flex items-center gap-1">
                                                <User size={13} /> بنات ({reportGirls.length})
                                            </h3>
                                            <div className="space-y-2">
                                                {reportGirls.map(child => (
                                                    <div key={child.id} className="flex justify-between items-center bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
                                                        <span className="font-black text-xs text-slate-700">{child.name || 'بدون اسم'}</span>
                                                        {modalState.type === 'absent' && (
                                                            <div className="flex gap-1 flex-wrap">
                                                                {child.fatherPhone && <a href={generateMissedFridayMsg(child, 'father')} target="_blank" rel="noreferrer" className="bg-blue-600 text-blue-50 px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 hover:bg-blue-700"><MessageCircleWarning size={12} /> أب</a>}
                                                                {child.motherPhone && <a href={generateMissedFridayMsg(child, 'mother')} target="_blank" rel="noreferrer" className="bg-pink-600 text-pink-50 px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 hover:bg-pink-700"><MessageCircleWarning size={12} /> أم</a>}
                                                                {child.childPhone && <a href={generateMissedFridayMsg(child, 'child')} target="_blank" rel="noreferrer" className="bg-green-600 text-green-50 px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 hover:bg-green-700"><MessageCircleWarning size={12} /> مخدوم</a>}
                                                                {(!child.fatherPhone && !child.motherPhone && !child.childPhone) && <a href={generateMissedFridayMsg(child)} target="_blank" rel="noreferrer" className="bg-slate-600 text-slate-50 px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 hover:bg-slate-700"><MessageCircleWarning size={12} /> رسالة</a>}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {reportBoys.length === 0 && reportGirls.length === 0 && (
                                        <div className="text-center py-8 text-slate-400 font-bold text-sm">مفيش بيانات للتقرير ده.</div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Urgent Intervention Modal for Priests & Admins (Requirement #1) */}
            <UrgentInterventionModal 
                isOpen={showUrgentModal}
                onClose={() => setShowUrgentModal(false)}
                urgentCases={urgentCases}
            />
        </div>
    );
}