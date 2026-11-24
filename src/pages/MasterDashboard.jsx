import { scopedSyncKeys, syncScopedClassesFromCloud } from '../db/childSync';
import { resolveUserAccessScope, extractAllOsrasFromSettings, startOsraImpersonation } from '../utils/notificationScopeEngine';
import { childAliases, attendanceIdentity } from '../utils/childIdentity';
import { deleteChildEverywhere, pullStructureFromCloud, syncWithCloud } from '../db/sync';
/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
// استدعاء فايربيز عشان زرار المزامنة
import { doc, getDoc, onSnapshot, setDoc, writeBatch, collectionGroup, getDocs, collection, deleteDoc } from 'firebase/firestore';
import { encryptData, decryptData } from '../encryption';
import { firestore } from '../db/firebase';
import { ArrowRight, ShieldAlert, Users, Search, Phone, Crown, Layers, MessageCircle, UserCircle, Key, AlertTriangle, CheckCircle, RefreshCw, Trash2, Target, CheckSquare, Plus, Edit3, ArrowLeftRight, ChevronDown, FileText, Printer, Trophy, BookOpen, Award, Bell, Clock, Home as HomeIcon, User, Upload, Download, X, LayoutDashboard } from 'lucide-react';
import ExcelExporter from '../components/ExcelExporter';
import useAutoSync from '../hooks/useAutoSync';
import { TENANT_CONFIG,
    readScopedStorage,
    writeScopedStorage
} from '../utils/tenantConfig';
import { logActivity } from '../utils/activityLogger';
import ServantProfile from '../components/ServantProfile';
import EditServantModal from '../components/EditServantModal';
import { getCurrentServiceFridayDate, isThursdayServiceClass, getClassScheduleConfig } from '../utils/serviceWeek';
import { useWeeklyClassActivity } from '../hooks/useWeeklyClassActivity';
import { useChurchDataEngine } from '../hooks/useChurchDataEngine';
import { useUrgentInterventionAlerts } from '../hooks/useUrgentInterventionAlerts';
import WeeklyClassActivitySummary from '../components/WeeklyClassActivitySummary';
import UrgentInterventionModal from '../components/UrgentInterventionModal';
import ScopedNotificationCenter from '../components/ScopedNotificationCenter';

import { useSmartNavigation } from '../hooks/useSmartNavigation';
import { DEFAULT_CHURCH_LOGO_PATH, resolveOsraLogoUrl } from '../utils/realChurchStructure';
import { buildServantApprovalWhatsAppUrl } from '../utils/whatsappHelper';

export default function MasterDashboard() {
    const { goBack } = useSmartNavigation();
    const navigate = useNavigate();
    const { triggerAutoSync } = useAutoSync();
    const [editingServant, setEditingServant] = useState(null);

    // Weekly activity & urgent alerts (Requirements #2 & #1)
    const { activityByClass } = useWeeklyClassActivity();
    const { urgentCases, urgentCount, hasUrgentCases, permission, requestNotificationPermission } = useUrgentInterventionAlerts('all');
    const [showUrgentModal, setShowUrgentModal] = useState(false);

    // جلب الهوية الأساسية للخادم
    const currentSyncKey = readScopedStorage('currentSyncKey');

    const handleOpenOsraDashboard = (osra) => {
        if (!osra?.syncKey) return;
        writeScopedStorage('selectedOsra', JSON.stringify(osra));
        sessionStorage.setItem('dashboard_activeClassKey', osra.syncKey);
        void syncWithCloud(osra.syncKey);
        navigate(`/dashboard?syncKey=${encodeURIComponent(osra.syncKey)}`);
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    };

    const handleEnterOsraAsServant = (osra) => {
        if (!osra?.syncKey) return;
        startOsraImpersonation(osra, currentSyncKey);
        void syncWithCloud(osra.syncKey);
        navigate('/');
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    };
    const currentServant = JSON.parse(readScopedStorage('currentServant') || '{}');

    // جلب الإعدادات في State
    const [appSettings, setAppSettings] = useState(JSON.parse(readScopedStorage('appSettings')) || {});


    // تحديد الصلاحيات بدقة جراحية (تسمح فقط للكاهن/أمين الخدمة العام وأمين المرحلة، مع تجاهل التصفح المؤقت)
    const masterScope = useMemo(
        () => resolveUserAccessScope(appSettings, [], { ignoreImpersonation: true, currentSyncKeyOverride: currentSyncKey, includeFallback: true }),
        [currentSyncKey, appSettings]
    );
    const isSuperAdmin = masterScope.isSuperAdmin;
    const isStageAdmin = masterScope.isStageLeader;
    const isPriest = isSuperAdmin && currentServant.role === 'كاهن';
    const hasAccess = masterScope.canAccessMasterDashboard;

    // States
    const [selectedOsraKey, setSelectedOsraKey] = useState(sessionStorage.getItem('master_osraKey') || null);
    const [searchTerm, setSearchTerm] = useState(sessionStorage.getItem('master_search') || '');
    const [genderFilter, setGenderFilter] = useState(sessionStorage.getItem('master_gender') || 'ALL');
    const [showWhoAttendedList, setShowWhoAttendedList] = useState(false);

    // المتغير الجديد للتبديل بين الأطفال والخدام
    const [viewMode, setViewMode] = useState(sessionStorage.getItem('master_viewMode') || 'KIDS'); // 'KIDS' | 'SERVANTS'
    const [selectedServantForProfile, setSelectedServantForProfile] = useState(null);


    useEffect(() => {
        if (selectedOsraKey) sessionStorage.setItem('master_osraKey', selectedOsraKey);
        else sessionStorage.removeItem('master_osraKey');
    }, [selectedOsraKey]);
    useEffect(() => sessionStorage.setItem('master_search', searchTerm), [searchTerm]);
    useEffect(() => sessionStorage.setItem('master_gender', genderFilter), [genderFilter]);
    useEffect(() => sessionStorage.setItem('master_viewMode', viewMode), [viewMode]);

    const allowedOsras = useMemo(() => {
        if (masterScope.isSuperAdmin && (!masterScope.allowedOsras || masterScope.allowedOsras.length === 0)) {
            return extractAllOsrasFromSettings(appSettings, [], { includeFallback: true });
        }
        return masterScope.allowedOsras || [];
    }, [appSettings, masterScope]);

    // Single Source of Truth (SSOT) Engine for children, class counts, and validated weekly attendance
    const allowedSyncKeyList = useMemo(
        () => allowedOsras.map(o => o.syncKey).filter(Boolean),
        [allowedOsras]
    );

    useEffect(() => {
        if (selectedOsraKey && selectedOsraKey !== 'ALL_CHURCH' && allowedSyncKeyList.length > 0 && !allowedSyncKeyList.includes(selectedOsraKey)) {
            setSelectedOsraKey(null);
        }
    }, [selectedOsraKey, allowedSyncKeyList]);

    const {
        allScopedChildren: children,
        classCounts,
        validatedAttendance: selectedClassAttendance,
        isLoadingInitialData,
        weekRange
    } = useChurchDataEngine(allowedSyncKeyList, {
        targetSyncKey: selectedOsraKey && selectedOsraKey !== 'ALL_CHURCH' && allowedSyncKeyList.includes(selectedOsraKey)
            ? selectedOsraKey
            : null
    });

    // Auto-Pull + Background Silent Sync عند فتح الصفحة بدون أزرار تقنية مزعجة
    useEffect(() => {
        const keys = scopedSyncKeys().sort();
        if (keys.length > 0) {
            void syncScopedClassesFromCloud(keys).catch(() => {});
        }
        const autoFetchStructure = async () => {
            if (!hasAccess) return;
            const res = await pullStructureFromCloud();
            if (res?.settings) {
                setAppSettings(res.settings);
            }
        };
        void autoFetchStructure();

        // Live Listener: Re-sync servant data & structure when a profile is updated anywhere
        const handleProfileUpdate = () => {
            try {
                const freshSettings = JSON.parse(readScopedStorage('appSettings') || '{}');
                setAppSettings(freshSettings);
            } catch (_e) { }
        };
        window.addEventListener('servant-profile-updated', handleProfileUpdate);
        window.addEventListener('church-settings-updated', handleProfileUpdate);
        window.addEventListener('storage', handleProfileUpdate);

        return () => {
            window.removeEventListener('servant-profile-updated', handleProfileUpdate);
            window.removeEventListener('church-settings-updated', handleProfileUpdate);
            window.removeEventListener('storage', handleProfileUpdate);
        };
    }, [hasAccess]);

    const cleanPhoneForWhatsapp = (phone) => {
        let clean = String(phone || "").replace(/\D/g, '');
        if (clean.startsWith('0')) clean = '2' + clean;
        return clean;
    };

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

    const getBestPhone = (c) => {
        if (c.whatsappTarget === 'child' && c.childPhone) return c.childPhone;
        if (c.whatsappTarget === 'father' && c.fatherPhone) return c.fatherPhone;
        if (c.whatsappTarget === 'mother' && c.motherPhone) return c.motherPhone;
        return c.childPhone || c.fatherPhone || c.motherPhone || c.phone || '';
    };


    // أداة ترحيل المخدومين بين الفصول
    const [showTransferTool, setShowTransferTool] = useState(false);
    const [transferSourceKey, setTransferSourceKey] = useState('');
    const [transferTargetKey, setTransferTargetKey] = useState('');
    const [transferSelectedIds, setTransferSelectedIds] = useState(new Set());
    const [isTransferring, setIsTransferring] = useState(false);

    const transferSourceChildren = useMemo(() => {
        if (!transferSourceKey || !children) return [];
        return children.filter(c => c.syncKey === transferSourceKey);
    }, [transferSourceKey, children]);

    const handleToggleTransferSelect = (childId) => {
        setTransferSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(childId)) next.delete(childId);
            else next.add(childId);
            return next;
        });
    };

    const handleToggleSelectAll = () => {
        if (transferSelectedIds.size === transferSourceChildren.length) {
            setTransferSelectedIds(new Set());
        } else {
            setTransferSelectedIds(new Set(transferSourceChildren.map(c => c.id)));
        }
    };

    const executeTransfer = async () => {
        if (!transferSourceKey || !transferTargetKey || transferSelectedIds.size === 0) return;
        if (transferSourceKey === transferTargetKey) {
            alert('فصل المصدر والوجهة متطابقان! اختر فصلًا مختلفًا.');
            return;
        }
        if (!window.confirm(`هل تريد ترحيل ${transferSelectedIds.size} مخدوم من الفصل المصدر إلى الفصل الجديد؟ هذه العملية ستنقل بياناتهم بالكامل وتحدث سجلاتهم.`)) return;

        if (!firestore) {
            alert("إعدادات Firebase غير مفعلة حالياً — تعذر الترحيل السحابي.");
            return;
        }
        setIsTransferring(true);
        try {
            const batch = writeBatch(firestore);
            let transferredCount = 0;
            const now = new Date().toISOString();

            // Fetch source attendance once to batch migrate if needed
            let sourceAttendanceDocs = [];
            try {
                const attColRef = collection(firestore, 'Osras', transferSourceKey, 'attendance');
                const attSnap = await getDocs(attColRef);
                sourceAttendanceDocs = attSnap?.docs || [];
            } catch (attErr) {
                console.warn('Could not fetch source attendance for transfer:', attErr);
            }

            for (const childId of transferSelectedIds) {
                try {
                    const child = children.find(c => c.id === childId);
                    if (!child) continue;

                    const childIdStr = String(child.cloudId || child.id);
                    const oldDocRef = doc(firestore, 'Osras', transferSourceKey, 'children', childIdStr);
                    const newDocRef = doc(firestore, 'Osras', transferTargetKey, 'children', childIdStr);

                    // 1. Read existing Firestore data or fallback to Dexie data
                    let childDataToMigrate = null;
                    let hadRemoteDoc = false;
                    try {
                        const oldSnap = await getDoc(oldDocRef);
                        if (oldSnap.exists()) {
                            hadRemoteDoc = true;
                            const rawData = oldSnap.data();
                            childDataToMigrate = rawData.payload ? decryptData(rawData.payload) : rawData;
                        }
                    } catch (_err) { }

                    if (!childDataToMigrate) {
                        childDataToMigrate = { ...child };
                    }

                    // 2. Set new target class key
                    childDataToMigrate.syncKey = transferTargetKey;
                    childDataToMigrate.updatedAt = now;
                    childDataToMigrate.isDirty = false;
                    childDataToMigrate.isDeleted = false;

                    const newPayload = { payload: encryptData(childDataToMigrate) };
                    batch.set(newDocRef, newPayload);
                    batch.set(oldDocRef, { payload: encryptData({ ...child, isDeleted: true, deletedAt: Date.now(), deletedBy: 'نقل فصل', updatedAt: Date.now() }), isDeleted: true, deletedAt: Date.now(), deletedBy: 'نقل فصل', updatedAt: Date.now() });

                    // 3. Migrate Child's Attendance in Firestore
                    for (const attDoc of sourceAttendanceDocs) {
                        try {
                            const rawAtt = attDoc.data();
                            const attData = rawAtt.payload ? decryptData(rawAtt.payload) : rawAtt;
                            if (attData && childAliases(child).includes(String(attData.childId))) {
                                const newAttDocRef = doc(firestore, 'Osras', transferTargetKey, 'attendance', attDoc.id);
                                const updatedAtt = {
                                    ...attData,
                                    syncKey: transferTargetKey,
                                    updatedAt: now,
                                    isDirty: false,
                                    isDeleted: false
                                };
                                batch.set(newAttDocRef, { payload: encryptData(updatedAtt) });
                                batch.delete(attDoc.ref);
                            }
                        } catch (_e) { }
                    }

                    transferredCount++;
                } catch (err) {
                    console.error('Failed to transfer child:', childId, err);
                }
            }

            if (transferredCount > 0) {
                await batch.commit();

                // 4. Update Dexie locally for all transferred children & their attendance and grades
                for (const childId of transferSelectedIds) {
                    const idStr = String(childId);
                    try {
                        await db.children.update(childId, {
                            syncKey: transferTargetKey,
                            isDirty: false,
                            updatedAt: now
                        });
                        if (childId !== idStr) {
                            try {
                                await db.children.update(idStr, {
                                    syncKey: transferTargetKey,
                                    isDirty: false,
                                    updatedAt: now
                                });
                            } catch (_e) { }
                        }

                        // Update attendance syncKey in Dexie
                        try {
                            const childAtts = await db.attendance.where('childId').equals(childId).toArray();
                            for (const a of childAtts) {
                                await db.attendance.update(a.id, {
                                    syncKey: transferTargetKey,
                                    isDirty: false,
                                    updatedAt: now
                                });
                            }
                            if (childId !== idStr) {
                                const idStrAtts = await db.attendance.where('childId').equals(idStr).toArray();
                                for (const a of idStrAtts) {
                                    await db.attendance.update(a.id, {
                                        syncKey: transferTargetKey,
                                        isDirty: false,
                                        updatedAt: now
                                    });
                                }
                            }
                        } catch (_e) { }

                        // Update grades syncKey in Dexie
                        await db.grades.where('childId').equals(childId).modify({
                            syncKey: transferTargetKey,
                            isDirty: false,
                            updatedAt: now
                        });
                        if (childId !== idStr) {
                            await db.grades.where('childId').equals(idStr).modify({
                                syncKey: transferTargetKey,
                                isDirty: false,
                                updatedAt: now
                            });
                        }
                    } catch (_e) { /* skip if not found locally */ }
                }

                alert(`تم ترحيل ${transferredCount} مخدوم بنجاح ونقل سجلاتهم بالكامل!`);
                logActivity('TRANSFER_CHILDREN', `ترحيل ${transferredCount} مخدوم من ${allowedOsras.find(o => o.syncKey === transferSourceKey)?.name || transferSourceKey} إلى ${allowedOsras.find(o => o.syncKey === transferTargetKey)?.name || transferTargetKey}`);
                setTransferSelectedIds(new Set());
                setTransferSourceKey('');
                setTransferTargetKey('');
                setShowTransferTool(false);
                triggerAutoSync();
            } else {
                alert('لم يتم ترحيل أي مخدوم. تأكد من اختيار مخدومين صحيحين.');
            }
        } catch (error) {
            console.error('Transfer error:', error);
            alert('حدث خطأ أثناء الترحيل: ' + error.message);
        } finally {
            setIsTransferring(false);
        }
    };


    const activeOsra = selectedOsraKey === 'ALL_CHURCH'
        ? { name: (isSuperAdmin || isPriest) ? 'كل الكنيسة (جميع المخدومين)' : TENANT_CONFIG.MASTER_VIEW_NAME, logo: '' }
        : allowedOsras.find(o => o.syncKey === selectedOsraKey);

    // الفلترة الذكية للأطفال (مغلفة بـ useMemo)
    const osraChildren = useMemo(() => {
        if (!children) return [];
        return children.filter(child => {
            if (selectedOsraKey !== 'ALL_CHURCH' && child.syncKey !== selectedOsraKey) return false;
            if (selectedOsraKey === 'ALL_CHURCH') {
                const isChildInScope = allowedOsras.some(o => o.syncKey === child.syncKey);
                if (!isChildInScope) return false;
            }
            const genderTxt = String(child.gender || '').trim();
            const isGirl = ['بنت', 'أنثى', 'انثى', 'انثي', 'فتاة'].includes(genderTxt);
            if (genderFilter === 'BOYS' && isGirl) return false;
            if (genderFilter === 'GIRLS' && !isGirl) return false;
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                return child.name?.toLowerCase().includes(term) || child.phone?.includes(term) || child.motherPhone?.includes(term) || child.fatherPhone?.includes(term) || child.childPhone?.includes(term);
            }
            return true;
        });
    }, [children, selectedOsraKey, allowedOsras, genderFilter, searchTerm]);

    // الفلترة الذكية للخدام (الميزة الجديدة لأبونا)
    const osraServants = useMemo(() => {
        let list = appSettings.servants || [];

        // 1. فلترة بالصلاحيات (الأمين بيشوف خدام أسرته بس)
        if (!isSuperAdmin && !isPriest) {
            const allowedKeys = allowedOsras.map(o => o.syncKey);
            list = list.filter(s => allowedKeys.includes(s.syncKey));
        }

        // 2. فلترة بالأسرة المحددة
        if (selectedOsraKey && selectedOsraKey !== 'ALL_CHURCH') {
            list = list.filter(s => s.syncKey === selectedOsraKey);
        }

        // 3. فلترة بالبحث
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            list = list.filter(s => s.name?.toLowerCase().includes(term) || s.phone?.includes(term));
        }

        return list;
    }, [appSettings.servants, isSuperAdmin, isPriest, allowedOsras, selectedOsraKey, searchTerm]);

    const handleGoBack = () => {
        if (selectedOsraKey) {
            setSelectedOsraKey(null);
            setSearchTerm('');
            setGenderFilter('ALL');
            setViewMode('KIDS');
        } else {
            goBack('/');
        }
    };

    const pendingInterventions = useMemo(() => {
        if (!children) return [];
        let interventions = [];
        children.forEach(child => {
            const isChildInScope = isSuperAdmin || isPriest || allowedOsras.some(o => o.syncKey === child.syncKey);
            if (!isChildInScope) return;

            if (child.notes && Array.isArray(child.notes)) {
                child.notes.forEach(note => {
                    if (note?.requiresIntervention && note?.interventionStatus === 'pending') {
                        interventions.push({ ...note, childId: child.id });
                    }
                });
            }
        });
        return interventions.sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [children, allowedOsras, isSuperAdmin, isPriest]);

    const handleResolveIntervention = async (childId, noteId) => {
        if (!window.confirm('هل أنت متأكد من حل هذه المشكلة وإغلاق طلب التدخل؟')) return;

        try {
            const childToUpdate = await db.children.get(childId);
            if (childToUpdate && childToUpdate.notes) {
                const updatedNotes = childToUpdate.notes.map(n =>
                    n.id === noteId ? { ...n, interventionStatus: 'resolved' } : n
                );
                const hasPendingNotes = updatedNotes.some(n => n.requiresIntervention && n.interventionStatus === 'pending');
                const updates = {
                    notes: updatedNotes,
                    isDirty: true,
                    updatedAt: new Date().toISOString()
                };
                if (!hasPendingNotes) {
                    updates.requiresIntervention = false;
                    updates.interventionStatus = 'resolved';
                }
                await db.children.update(childId, updates);
                logActivity('RESOLVE_INTERVENTION', `حل طلب تدخل أبوي للمخدوم: ${childToUpdate.name || childId}`);
                triggerAutoSync();
            }
        } catch (error) {
            console.error('Error resolving intervention:', error);
            alert('حدث خطأ أثناء إغلاق الطلب.');
        }
    };

    const totalScopedKidsCount = useMemo(() => {
        return allowedOsras.reduce((sum, o) => sum + (classCounts[o.syncKey] ?? 0), 0)
            || children?.filter(c => allowedOsras.some(o => o.syncKey === c.syncKey)).length
            || 0;
    }, [allowedOsras, classCounts, children]);

    if (!hasAccess) {
        return (
            <div className="min-h-screen coptic-cream-surface flex flex-col items-center justify-center p-4 font-sans" dir="rtl">
                <div className="coptic-card p-8 rounded-[2.5rem] text-center border-2 border-[#C8942E]/40 max-w-md w-full">
                    <ShieldAlert className="text-rose-500 mx-auto mb-4 w-16 h-16" strokeWidth={1.5} />
                    <h2 className="text-2xl font-black text-[#1B2A59] mb-2">غير مصرح لك بالدخول</h2>
                    <p className="text-[#6E604F] text-sm mb-6 font-bold">هذه الصفحة مخصصة للآباء الكهنة وأمناء الخدمة فقط.</p>
                    <button onClick={() => goBack('/')} className="bg-gradient-to-l from-[#1B2A59] to-[#243875] text-[#F4D078] px-6 py-3 rounded-xl font-black hover:opacity-95 w-full transition-opacity cursor-pointer">العودة للرئيسية</button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen coptic-cream-surface pb-20" dir="rtl">
            <header
                className="text-white p-4 sm:p-5 sticky top-0 z-50 shadow-lg rounded-b-3xl sm:rounded-b-[2.25rem] border-b border-amber-400/25"
                style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 65%, #8C621E 100%)' }}
            >
                <div className="max-w-6xl mx-auto flex flex-col gap-3">
                    {/* Row 1: Royal Navy & Gold Top Navigation + Integrated Church Count Pill */}
                    <div className="flex flex-wrap items-center justify-between gap-2.5 w-full">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <button onClick={handleGoBack} aria-label="الرجوع للخلف" className="w-10 h-10 bg-white/15 border border-white/20 rounded-full flex items-center justify-center hover:bg-white/25 transition-all shrink-0 backdrop-blur-md active:scale-95 cursor-pointer">
                                <ArrowRight size={20} />
                            </button>
                            <div className="min-w-0">
                                <h1 className="font-calligraphic text-lg sm:text-2xl font-bold flex items-center gap-2 truncate text-amber-100">
                                    <Crown size={18} className="shrink-0 text-amber-300" />
                                    <span className="truncate">
                                        {isSuperAdmin ? 'لوحة الإدارة الشاملة' : `لوحة قيادة: ${masterScope.stageName || 'المرحلة'}`}
                                    </span>
                                </h1>
                                <p className="text-[11px] sm:text-xs font-bold text-indigo-100/90 truncate">
                                    {selectedOsraKey && activeOsra
                                        ? `عرض بيانات: ${activeOsra.name}`
                                        : (isSuperAdmin ? TENANT_CONFIG.CHURCH_NAME : `متابعة فصول ${masterScope.stageName || 'المرحلة'} فقط`)}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                type="button"
                                onClick={() => setSelectedOsraKey('ALL_CHURCH')}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 border border-amber-300/40 backdrop-blur-md text-xs font-black text-amber-100 transition-all cursor-pointer active:scale-95"
                                title={isSuperAdmin ? 'عرض جميع المخدومين والخدام في كل الكنيسة' : 'عرض جميع المخدومين في فصول المرحلة'}
                            >
                                <Users size={14} className="text-amber-300 shrink-0" />
                                <span>{isSuperAdmin ? 'كل الكنيسة' : (masterScope.stageName || 'المرحلة')}:</span>
                                <span className="bg-amber-400 text-[#1B2A59] px-2 py-0.5 rounded-full text-[11px] font-black tabular-nums">
                                    {isLoadingInitialData && totalScopedKidsCount === 0 ? '...' : totalScopedKidsCount} مخدوم
                                </span>
                            </button>
                            <ScopedNotificationCenter variant="dark" />
                        </div>
                    </div>

                    {/* Urgent Intervention Bar if cases exist */}
                    {hasUrgentCases && (
                        <div className="flex flex-wrap items-center justify-between gap-2 w-full pt-2 border-t border-white/15">
                            <button
                                onClick={() => setShowUrgentModal(true)}
                                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black shadow-md shadow-red-950/20 active:scale-95 transition-all cursor-pointer"
                                title="حالات التدخل العاجل للآباء الكهنة"
                            >
                                <span className="relative flex h-2 w-2 shrink-0">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                                </span>
                                <AlertTriangle size={14} className="shrink-0" />
                                <span className="truncate">حالات التدخل العاجل ({urgentCount})</span>
                            </button>

                            {permission === 'default' && (
                                <button
                                    onClick={requestNotificationPermission}
                                    className="w-full sm:w-auto text-[11px] font-bold bg-white/15 hover:bg-white/25 text-white border border-white/25 px-3 py-1 rounded-xl transition-colors flex items-center justify-center gap-1 shrink-0 backdrop-blur-md cursor-pointer"
                                    title="تفعيل إشعارات التدخل العاجل على الهاتف"
                                >
                                    <Bell size={13} /> تفعيل الإشعارات
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </header>

            <main className="p-3.5 sm:p-5 max-w-5xl mx-auto mt-2 sm:mt-3">
                {/* Unified Compact Quick Tools Bar (Replaces Stacked Banners) */}
                {!selectedOsraKey && (
                    <div className="mb-4 space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                            <button
                                type="button"
                                onClick={() => navigate('/points')}
                                className="rounded-2xl bg-gradient-to-br from-[#1B2A59] to-[#253875] text-white border border-amber-400/40 p-3 flex items-center gap-2.5 hover:shadow-md transition-all tactile-press cursor-pointer text-right min-h-[58px]"
                            >
                                <span className="w-9 h-9 rounded-xl bg-amber-400 text-[#1B2A59] flex items-center justify-center shrink-0">
                                    <Trophy size={18} />
                                </span>
                                <div className="min-w-0">
                                    <div className="text-xs sm:text-sm font-black text-amber-200 truncate">النقاط والمكافآت</div>
                                    <div className="text-[10px] font-bold text-indigo-100/85 truncate">لوحة الشرف</div>
                                </div>
                            </button>

                            <button
                                type="button"
                                onClick={() => navigate('/curriculum')}
                                className="coptic-card rounded-2xl p-3 flex items-center gap-2.5 hover:border-amber-500/60 transition-all tactile-press cursor-pointer text-right min-h-[58px]"
                            >
                                <span className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 border border-amber-300/60 flex items-center justify-center shrink-0">
                                    <BookOpen size={18} />
                                </span>
                                <div className="min-w-0">
                                    <div className="text-xs sm:text-sm font-black text-[#1B2A59] truncate">المناهج</div>
                                    <div className="text-[10px] font-bold text-[#6E5329] truncate">الدروس والمذكرات</div>
                                </div>
                            </button>

                            {(isSuperAdmin || isPriest) && (
                                <button
                                    type="button"
                                    onClick={() => navigate('/master-logs')}
                                    className="coptic-card rounded-2xl p-3 flex items-center gap-2.5 hover:border-amber-500/60 transition-all tactile-press cursor-pointer text-right min-h-[58px]"
                                >
                                    <span className="w-9 h-9 rounded-xl bg-[#EFE0C2] text-[#8C621E] flex items-center justify-center shrink-0">
                                        <FileText size={18} />
                                    </span>
                                    <div className="min-w-0">
                                        <div className="text-xs sm:text-sm font-black text-[#1B2A59] truncate">سجل النشاط</div>
                                        <div className="text-[10px] font-bold text-[#6E5329] truncate">Audit Trail</div>
                                    </div>
                                </button>
                            )}

                            {isSuperAdmin && (
                                <button
                                    type="button"
                                    onClick={() => setShowTransferTool(!showTransferTool)}
                                    className={`rounded-2xl p-3 flex items-center gap-2.5 transition-all tactile-press cursor-pointer text-right min-h-[58px] border ${showTransferTool ? 'bg-[#1B2A59] text-white border-amber-400' : 'coptic-card hover:border-indigo-400 text-[#1B2A59]'}`}
                                >
                                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${showTransferTool ? 'bg-amber-400 text-[#1B2A59]' : 'bg-indigo-100 text-[#1B2A59]'}`}>
                                        <ArrowLeftRight size={18} />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs sm:text-sm font-black truncate">ترحيل مخدومين</div>
                                        <div className={`text-[10px] font-bold truncate ${showTransferTool ? 'text-amber-200' : 'text-[#6E5329]'}`}>بين الفصول</div>
                                    </div>
                                </button>
                            )}

                            {!isStageAdmin && <ExcelExporter variant="tile" />}
                        </div>

                        {isSuperAdmin && showTransferTool && (
                            <div className="coptic-card p-4 sm:p-5 rounded-3xl border-2 border-[#DFC48F] shadow-lg animate-card-enter">
                                {/* الفصل المصدر والوجهة */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                                    <div>
                                        <label className="flex items-center gap-1.5 text-xs font-black text-slate-600 mb-2"><Upload size={13} /> فصل المصدر</label>
                                        <select
                                            value={transferSourceKey}
                                            onChange={(e) => { setTransferSourceKey(e.target.value); setTransferSelectedIds(new Set()); }}
                                            className="w-full p-3 rounded-xl border-2 border-slate-200 font-bold text-sm bg-slate-50 focus:border-indigo-400 focus:outline-none transition-colors"
                                        >
                                            <option value="">-- اختر فصل المصدر --</option>
                                            {allowedOsras.map(o => (
                                                <option key={o.syncKey} value={o.syncKey || ''}>{o.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="flex items-center gap-1.5 text-xs font-black text-slate-600 mb-2"><Download size={13} /> الفصل الجديد / الوجهة</label>
                                        <select
                                            value={transferTargetKey}
                                            onChange={(e) => setTransferTargetKey(e.target.value)}
                                            className="w-full p-3 rounded-xl border-2 border-slate-200 font-bold text-sm bg-slate-50 focus:border-indigo-400 focus:outline-none transition-colors"
                                        >
                                            <option value="">-- اختر الفصل الجديد --</option>
                                            {allowedOsras.filter(o => o.syncKey !== transferSourceKey).map(o => (
                                                <option key={o.syncKey} value={o.syncKey || ''}>{o.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {/* جدول المخدومين */}
                                {transferSourceKey && transferSourceChildren.length > 0 && (
                                    <div>
                                        <div className="flex items-center justify-between mb-3">
                                            <h4 className="text-sm font-black text-slate-700">مخدومين الفصل ({transferSourceChildren.length})</h4>
                                            <button
                                                onClick={handleToggleSelectAll}
                                                className="text-xs font-black text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors"
                                            >
                                                {transferSelectedIds.size === transferSourceChildren.length ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
                                            </button>
                                        </div>
                                        <div className="max-h-64 overflow-y-auto rounded-2xl border border-slate-200">
                                            {transferSourceChildren.map((child) => (
                                                <label
                                                    key={child.id}
                                                    className={`flex items-center gap-3 p-3 border-b border-slate-100 last:border-b-0 cursor-pointer transition-colors ${transferSelectedIds.has(child.id) ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={transferSelectedIds.has(child.id)}
                                                        onChange={() => handleToggleTransferSelect(child.id)}
                                                        className="w-5 h-5 rounded-md accent-indigo-600 shrink-0"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <span className="text-sm font-black text-slate-800 block truncate">{child.name}</span>
                                                        <span className="text-[10px] font-bold text-slate-400">{String(child.id || '')}</span>
                                                    </div>
                                                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg shrink-0">
                                                        <span className="inline-flex items-center gap-1"><User size={11} /> {String(child.gender || '').includes('ولد') || String(child.gender || '').toLowerCase() === 'boy' ? 'ولد' : 'بنت'}</span>
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {transferSourceKey && transferSourceChildren.length === 0 && (
                                    <p className="text-center text-sm font-bold text-slate-400 py-6">لا يوجد مخدومين في هذا الفصل.</p>
                                )}

                                {/* زر التنفيذ */}
                                {transferSelectedIds.size > 0 && transferTargetKey && (
                                    <button
                                        onClick={executeTransfer}
                                        disabled={isTransferring}
                                        className={`w-full mt-4 p-3.5 rounded-2xl font-black text-white shadow-md flex items-center justify-center gap-2 transition-all ${isTransferring ? 'bg-slate-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 hover:shadow-lg'}`}
                                    >
                                        <ArrowLeftRight size={18} />
                                        {isTransferring ? 'جاري الترحيل بأمان...' : `ترحيل المخدومين المحددين (${transferSelectedIds.size})`}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* قسم طلبات التدخل الرعوي العاجلة */}
                {!selectedOsraKey && pendingInterventions.length > 0 && (
                    <div className="mb-8 animate-in fade-in slide-in-from-top-4">
                        <div className="flex items-center gap-2 mb-4 bg-red-100 p-3 rounded-2xl border border-red-200">
                            <AlertTriangle className="text-red-600" size={24} />
                            <h2 className="text-lg font-black text-red-800">طلبات التدخل الرعوي العاجلة ({pendingInterventions.length})</h2>
                        </div>
                        <div className="grid grid-cols-1 gap-4">
                            {pendingInterventions.map((intervention) => (
                                <div key={intervention.id} className="bg-white p-5 rounded-3xl border-2 border-red-100 shadow-md relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 w-2 h-full bg-red-500"></div>
                                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 pl-4 pr-6">
                                        <div>
                                            <h3 className="font-black text-xl text-slate-800 flex items-center gap-2">
                                                {intervention.childName} <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-full">{intervention.osraName}</span>
                                            </h3>
                                            <p className="text-xs font-bold text-slate-400 mt-1 flex items-center gap-1">
                                                <UserCircle size={14} /> الخادم المُبلغ: <span className="text-slate-700">{intervention.servantName}</span> • {new Date(intervention.date).toLocaleDateString('ar-EG')}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleResolveIntervention(intervention.childId, intervention.id)}
                                            className="bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-500 hover:text-white px-4 py-2 rounded-xl font-black text-sm transition-colors flex items-center gap-2 w-full md:w-auto justify-center"
                                        >
                                            <CheckCircle size={16} /> تمت المتابعة وحل المشكلة
                                        </button>
                                    </div>
                                    <div className="bg-red-50 p-4 rounded-2xl border border-red-100 text-sm font-bold text-red-900 whitespace-pre-wrap leading-relaxed mr-6">
                                        "{intervention.text}"
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* الشاشة الأولى: لستة الأسر */}
                {!selectedOsraKey && (
                    <div className="animate-in fade-in zoom-in duration-300">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                            <h2 className="font-calligraphic text-lg sm:text-xl font-bold text-[#1B2A59] flex items-center gap-2">
                                <Layers size={18} className="text-[#8C621E]" /> اختر الأسرة لعرض المخدومين والخدام:
                            </h2>
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => navigate('/exams')}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/90 border border-[#DFC48F] hover:border-[#C89B3C] text-xs font-black text-[#1B2A59] shadow-xs transition-all cursor-pointer"
                                >
                                    <Award size={14} className="text-[#8C621E]" />
                                    <span>النتائج والامتحانات</span>
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                            {/* Compact Weekly Activity Summary Bar (Collapsed by default) */}
                            <div className="col-span-1 sm:col-span-2">
                                <WeeklyClassActivitySummary
                                    classes={allowedOsras}
                                    activityByClass={activityByClass}
                                    classCounts={classCounts}
                                    isLoadingInitialData={isLoadingInitialData}
                                    onClassClick={(osra) => setSelectedOsraKey(osra.syncKey)}
                                />
                            </div>

                            {/* كروت الأسر المنفصلة */}
                            {allowedOsras.map((osra) => {
                                const countKids = classCounts[osra.syncKey] ?? (children?.filter(c => c.syncKey === osra.syncKey).length || 0);
                                const countServants = appSettings.servants?.filter(s => s.syncKey === osra.syncKey).length || 0;
                                const act = activityByClass[osra.syncKey] || {};
                                const presentCount = Math.min(act.presentCount || 0, countKids);
                                const isThu = isThursdayServiceClass(osra.syncKey, osra.name);
                                const sched = getClassScheduleConfig(osra.syncKey, osra.name);
                                const isServantsRoster = (osra.name || '').includes('خدام مدارس الأحد') || osra.syncKey === 'sunday_school_servants';
                                const showLoadingKids = countKids === 0 && isLoadingInitialData;
                                return (
                                    <div
                                        key={osra.syncKey}
                                        onClick={() => setSelectedOsraKey(osra.syncKey)}
                                        className="coptic-card p-3.5 sm:p-5 rounded-3xl sm:rounded-4xl shadow-sm border border-[#DFC48F] hover:shadow-lg hover:border-[#C8942E] cursor-pointer transition-all flex flex-col gap-3 group"
                                    >
                                        <div className="flex items-center gap-3 sm:gap-4">
                                            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-[#FAF4E8] border-4 border-[#EFE0C2] overflow-hidden shrink-0 group-hover:border-amber-200 transition-colors p-0.5">
                                                <img
                                                    src={resolveOsraLogoUrl(osra)}
                                                    width="64"
                                                    height="64"
                                                    loading="lazy"
                                                    alt="لوجو الأسرة"
                                                    className="w-full h-full object-contain rounded-full bg-white"
                                                    onError={(e) => {
                                                        e.currentTarget.onerror = null;
                                                        e.currentTarget.src = DEFAULT_CHURCH_LOGO_PATH;
                                                    }}
                                                />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="font-black text-base sm:text-lg text-[#1B2A59] truncate">{osra.name}</h3>
                                                <p className="text-[10px] font-bold text-[#6E5329] mt-1 flex flex-wrap gap-1.5">
                                                    <span className="truncate max-w-full">أمين الأسرة: {osra.amin || 'غير محدد'}</span>
                                                    <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded shrink-0 inline-flex items-center gap-1"><UserCircle size={11} /> {countServants} خدام</span>
                                                    <span className={`px-2 py-0.5 rounded shrink-0 font-black ${isServantsRoster ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'text-indigo-800 bg-indigo-50'}`}>
                                                        {isServantsRoster ? 'خدام مدارس الأحد • ' : ''}{sched.scheduleBadge}
                                                    </span>
                                                </p>

                                                {/* Requirement #2: In-App Class Card Activity Badges */}
                                                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                                    {act.hasRecordedAttendance ? (
                                                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-lg text-[10px] font-black flex items-center gap-1 shadow-2xs">
                                                            <CheckCircle size={12} /> سجل الحضور ({presentCount} / {countKids})
                                                        </span>
                                                    ) : showLoadingKids ? (
                                                        <span className="bg-[#FAF4E8] text-[#8C7D68] border border-[#DFC48F] px-2 py-0.5 rounded-lg text-[10px] font-bold flex items-center gap-1 animate-pulse">
                                                            <Clock size={12} /> جاري التحميل...
                                                        </span>
                                                    ) : (
                                                        <span className="bg-[#FAF4E8] text-[#6E5329] border border-[#DFC48F] px-2 py-0.5 rounded-lg text-[10px] font-bold flex items-center gap-1">
                                                            <Clock size={12} /> لم يسجل بعد (0 / {countKids})
                                                        </span>
                                                    )}

                                                    {act.hasRecordedVisitation ? (
                                                        <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-lg text-[10px] font-black flex items-center gap-1 shadow-2xs">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping inline-block" />
                                                            <HomeIcon size={12} /> افتقد ({act.visitationCount})
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-center justify-center bg-[#EFE0C2]/60 w-12 h-12 rounded-2xl shrink-0">
                                                <span className="font-black text-[#1B2A59]">{showLoadingKids ? '...' : countKids}</span>
                                                <span className="text-[9px] font-bold text-[#6E5329]">مخدوم</span>
                                            </div>
                                        </div>

                                        {/* Side-by-side actions: لوحة تحكم الأسرة | الدخول كخادم للأسرة */}
                                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#E7D4AF]">
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleOpenOsraDashboard(osra);
                                                }}
                                                className="py-2 px-2.5 rounded-xl bg-[#1B2A59] hover:bg-[#142047] text-amber-200 text-[11px] sm:text-xs font-black flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                                            >
                                                <LayoutDashboard size={14} />
                                                <span>لوحة تحكم الأسرة</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleEnterOsraAsServant(osra);
                                                }}
                                                className="py-2 px-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-[#1B2A59] text-[11px] sm:text-xs font-black flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                                            >
                                                <Award size={14} />
                                                <span>الدخول كخادم للأسرة</span>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* الشاشة التانية: العرض الداخلي (أطفال / خدام) */}
                {selectedOsraKey && activeOsra && (
                    <div className="animate-in slide-in-from-left duration-300 space-y-4">

                        {/* الهيدر بتاع الأسرة المحددة */}
                        <div className="bg-white p-3.5 sm:p-5 rounded-3xl sm:rounded-4xl shadow-sm border border-slate-200 flex items-center justify-between gap-2.5">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                {activeOsra.logo ? (
                                    <img src={activeOsra.logo} width="48" height="48" loading="eager" alt="لوجو الأسرة" className="w-11 h-11 sm:w-12 sm:h-12 rounded-full border-2 border-slate-100 object-cover shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                ) : (
                                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-500 shrink-0"><Users size={20} /></div>
                                )}
                                <div className="min-w-0">
                                    <h2 className="font-black text-slate-800 text-sm sm:text-base truncate">{activeOsra.name}</h2>
                                    <p className="text-[10px] font-bold text-slate-400 truncate">مفاتيح الكلاود: {activeOsra.syncKey || 'متعدد'}</p>
                                </div>
                            </div>
                            <button onClick={handleGoBack} className="text-xs font-black bg-slate-100 text-slate-600 px-3 sm:px-4 py-2 rounded-xl flex items-center gap-1 hover:bg-slate-200 shrink-0">
                                <ArrowRight size={14} /> عودة
                            </button>
                        </div>

                        {/* زراير التبديل بين الأطفال والخدام + قائمة مين حضر هذا الأسبوع */}
                        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 bg-slate-200/50 p-1.5 rounded-2xl mb-4">
                            <button onClick={() => setViewMode('KIDS')} className={`py-2.5 px-3 text-xs font-black rounded-xl transition-all flex justify-center items-center gap-1.5 sm:flex-1 ${viewMode === 'KIDS' ? 'bg-white text-indigo-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:bg-slate-200'}`}>
                                <Users size={14} /> المخدومين ({osraChildren.length})
                            </button>
                            <button onClick={() => setViewMode('SERVANTS')} className={`py-2.5 px-3 text-xs font-black rounded-xl transition-all flex justify-center items-center gap-1.5 sm:flex-1 ${viewMode === 'SERVANTS' ? 'bg-amber-500 text-white shadow-md shadow-amber-500/30' : 'text-slate-500 hover:bg-slate-200'}`}>
                                <UserCircle size={14} /> الخدام ({osraServants.length})
                            </button>
                            <button
                                onClick={() => setShowWhoAttendedList(prev => !prev)}
                                className={`col-span-2 sm:col-span-1 sm:flex-1 py-2.5 px-3 text-xs font-black rounded-xl transition-all flex justify-center items-center gap-1.5 ${showWhoAttendedList ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/30' : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'}`}
                            >
                                <CheckCircle size={14} /> مين حضر هذا الأسبوع ({selectedClassAttendance?.presentCount || 0} / {selectedClassAttendance?.totalActiveChildren || 0})
                            </button>
                        </div>

                        {showWhoAttendedList && (
                            <div className="bg-emerald-50/70 border border-emerald-200 rounded-3xl p-3.5 sm:p-4 mb-4 animate-in fade-in duration-200">
                                <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                                    <div className="min-w-0 flex-1">
                                        <h3 className="text-xs sm:text-sm font-black text-emerald-900 leading-snug flex items-center gap-1.5">
                                            <CheckCircle size={14} className="shrink-0" />
                                            <span>قائمة المخدومين الحاضرين في الخدمة هذا الأسبوع ({selectedClassAttendance?.whoAttendedServiceList?.length || 0} من {selectedClassAttendance?.totalActiveChildren || 0})</span>
                                        </h3>
                                        <p className="text-[10px] font-bold text-emerald-700 mt-0.5">
                                            دورة الأسبوع: الخميس {weekRange.startDate} إلى الأربعاء {weekRange.endDate}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setShowWhoAttendedList(false)}
                                        className="text-xs font-black text-emerald-800 bg-white px-2.5 py-1 rounded-lg border border-emerald-200 hover:bg-emerald-100 shrink-0"
                                    >
                                        <span className="inline-flex items-center gap-1">إغلاق <X size={12} /></span>
                                    </button>
                                </div>
                                {(!selectedClassAttendance?.whoAttendedServiceList || selectedClassAttendance.whoAttendedServiceList.length === 0) ? (
                                    <p className="text-xs font-bold text-emerald-700/80 text-center py-4">
                                        لم يتم تسجيل حضور خدمة لأي مخدوم نشط في هذا الفصل خلال أسبوع الخدمة الحالي.
                                    </p>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                                        {selectedClassAttendance.whoAttendedServiceList.map((c, idx) => (
                                            <div key={c.id} className="bg-white border border-emerald-200/80 rounded-xl px-3 py-2 flex items-center justify-between text-xs font-bold text-slate-800 shadow-2xs">
                                                <span className="truncate">{idx + 1}. {c.name}</span>
                                                <span className="text-[10px] text-emerald-700 shrink-0 inline-flex items-center gap-0.5"><User size={11} /> {c.gender === 'بنت' ? 'بنت' : 'ولد'}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="relative">
                            <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                            <input
                                type="text"
                                placeholder={`ابحث بالاسم أو التليفون في ${viewMode === 'KIDS' ? 'المخدومين' : 'الخدام'}...`}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-4 pr-12 py-4 rounded-2xl bg-white border border-slate-200 shadow-sm font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                            />
                        </div>

                        {/* الفلتر بيظهر للأطفال بس */}
                        {viewMode === 'KIDS' && (
                            <div className="flex gap-2 bg-slate-200/50 p-1 rounded-2xl mb-4">
                                <button onClick={() => setGenderFilter('ALL')} className={`flex-1 py-2.5 text-xs font-black rounded-xl transition-all ${genderFilter === 'ALL' ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:bg-slate-200'}`}>الكل</button>
                                <button onClick={() => setGenderFilter('BOYS')} className={`flex-1 py-2.5 text-xs font-black rounded-xl transition-all ${genderFilter === 'BOYS' ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30' : 'text-slate-500 hover:bg-slate-200'}`}>ولاد</button>
                                <button onClick={() => setGenderFilter('GIRLS')} className={`flex-1 py-2.5 text-xs font-black rounded-xl transition-all ${genderFilter === 'GIRLS' ? 'bg-pink-500 text-white shadow-sm shadow-pink-500/30' : 'text-slate-500 hover:bg-slate-200'}`}>بنات</button>
                            </div>
                        )}

                        {/* أزرار الانتقال المباشر لتقارير ومتابعة الخدام */}
                        {viewMode === 'SERVANTS' && (
                            <div className="flex flex-col sm:flex-row gap-2 mb-3">
                                <button
                                    type="button"
                                    onClick={() => navigate('/servants-report')}
                                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2.5 px-4 rounded-xl font-black text-xs shadow-md shadow-amber-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                    <Printer size={16} /> تقرير اجتماع الخدام
                                </button>
                                <button
                                    type="button"
                                    onClick={() => navigate('/admin/servants-followup')}
                                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 px-4 rounded-xl font-black text-xs shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                    <CheckSquare size={16} /> تسجيل اجتماع الخدام
                                </button>
                            </div>
                        )}

                        <div className="space-y-3 pt-2">
                            {/* عرض الخدام */}
                            {viewMode === 'SERVANTS' ? (
                                osraServants.length === 0 ? (
                                    <div className="text-center py-10 bg-white rounded-[2.5rem] border border-dashed border-slate-300">
                                        <UserCircle className="text-amber-300 mx-auto mb-3" size={40} />
                                        <p className="text-slate-500 font-bold text-sm">لا يوجد خدام يطابقون البحث.</p>
                                    </div>
                                ) : (
                                    osraServants.map(servant => (
                                        <div
                                            key={servant.id}
                                            onClick={() => setSelectedServantForProfile(servant)}
                                            className="bg-white p-4 rounded-2xl shadow-sm border border-amber-100 flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden group hover:shadow-md hover:border-amber-300 transition-all cursor-pointer"
                                            title="اضغط لعرض الملف الشخصي وإحصائيات الخادم"
                                        >
                                            <div className="absolute top-0 right-0 w-1.5 h-full bg-amber-400 group-hover:bg-amber-500 transition-colors"></div>

                                            <div className="flex items-center gap-3 pr-2">
                                                <div className="w-12 h-12 rounded-full ring-2 ring-amber-100 bg-amber-50 text-amber-700 flex items-center justify-center font-bold overflow-hidden shrink-0 shadow-xs">
                                                    {servant.photoURL || servant.profileImage || servant.profilePic ? (
                                                        <img src={servant.photoURL || servant.profileImage || servant.profilePic} alt={servant.name} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                                    ) : (
                                                        <UserCircle size={28} className="text-amber-400" />
                                                    )}
                                                </div>

                                                <div>
                                                    <h3 className="font-black text-slate-800 flex items-center gap-2 group-hover:text-amber-700 transition-colors">
                                                        {servant.name}
                                                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-600 font-bold border border-amber-200/50">
                                                            {servant.role}
                                                        </span>
                                                    </h3>
                                                    <p className="text-[11px] font-bold text-slate-500 mt-1 flex flex-wrap items-center gap-2">
                                                        <span className="flex items-center gap-1"><Users size={12} className="text-slate-400" /> {servant.assignedOsra}</span>
                                                        <span className="flex items-center gap-1 text-indigo-500"><Key size={12} /> {servant.syncKey}</span>
                                                        {servant.address && (
                                                            <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                                                <span className="w-1 h-1 rounded-full bg-slate-300 inline-block"></span>
                                                                {servant.address}
                                                            </span>
                                                        )}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 self-end md:self-center">
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingServant(servant);
                                                    }}
                                                    className="text-[11px] font-black text-amber-700 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-xl border border-amber-200 transition-colors flex items-center gap-1 cursor-pointer"
                                                    title="تعديل بيانات الخادم مباشرة"
                                                >
                                                    <Edit3 size={13} /> تعديل
                                                </button>
                                                <span className="text-[11px] font-black text-amber-700 bg-amber-50 group-hover:bg-amber-100 px-3 py-1.5 rounded-xl border border-amber-200/60 transition-colors ml-2 hidden sm:inline-flex items-center gap-1">
                                                    <UserCircle size={13} /> عرض البروفايل
                                                </span>
                                                <a
                                                    href={`tel:${servant.phone}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                    title="اتصال هاتفياً"
                                                    className="bg-slate-50 text-slate-600 p-2.5 rounded-xl hover:bg-slate-200 transition-colors flex items-center justify-center shadow-xs"
                                                >
                                                    <Phone size={16} />
                                                </a>
                                                <a
                                                    href={buildServantApprovalWhatsAppUrl(servant, appSettings.services || []) || `https://wa.me/${cleanPhoneForWhatsapp(servant.phone)}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    title="إرسال رسالة القبول والتفعيل على واتساب"
                                                    className="bg-green-50 text-green-700 px-2.5 py-2 rounded-xl hover:bg-green-100 border border-green-200 transition-colors flex items-center justify-center gap-1 text-[11px] font-black shadow-xs"
                                                >
                                                    <MessageCircle size={15} />
                                                    <span className="hidden sm:inline">رسالة التفعيل</span>
                                                </a>
                                            </div>
                                        </div>
                                    ))
                                )
                            ) : (
                                /* عرض المخدومين (الأطفال) */
                                osraChildren.length === 0 ? (
                                    <div className="text-center py-10 bg-white rounded-[2.5rem] border border-dashed border-slate-300">
                                        <Users className="text-slate-300 mx-auto mb-3" size={40} />
                                        <p className="text-slate-500 font-bold text-sm">لا يوجد مخدومين يطابقون البحث.</p>
                                    </div>
                                ) : (
                                    osraChildren.map(child => {
                                        const genderTxt = String(child.gender || '').trim();
                                        const isGirl = ['بنت', 'أنثى', 'انثى', 'انثي', 'فتاة'].includes(genderTxt);

                                        return (
                                            <div key={child.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden group">
                                                <div className={`absolute top-0 right-0 w-1.5 h-full ${isGirl ? 'bg-pink-400' : 'bg-blue-400'}`}></div>

                                                <div className="pr-2">
                                                    <h3 className="font-black text-slate-800 flex items-center gap-2">
                                                        {child.name}
                                                        <span className={`text-[10px] px-2 py-0.5 rounded-md ${isGirl ? 'bg-pink-50 text-pink-500' : 'bg-blue-50 text-blue-500'}`}>
                                                            {child.gender || 'غير محدد'}
                                                        </span>
                                                    </h3>
                                                    <p className="text-[11px] font-bold text-slate-400 mt-1 flex items-center gap-1">
                                                        <Phone size={10} /> {getDisplayPhone(child)}
                                                    </p>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    {getBestPhone(child) && (
                                                        <a href={`tel:${getBestPhone(child)}`} className="bg-slate-50 text-slate-600 p-2.5 rounded-xl hover:bg-slate-200 transition-colors flex items-center justify-center shadow-sm">
                                                            <Phone size={16} />
                                                        </a>
                                                    )}
                                                    {getBestPhone(child) && (
                                                        <a href={`https://wa.me/${cleanPhoneForWhatsapp(getBestPhone(child))}`} target="_blank" rel="noreferrer" className="bg-green-50 text-green-600 p-2.5 rounded-xl hover:bg-green-100 transition-colors flex items-center justify-center shadow-sm">
                                                            <MessageCircle size={16} />
                                                        </a>
                                                    )}
                                                    <button onClick={() => navigate(`/info/${child.id}`)} className="flex-1 md:flex-none bg-slate-800 text-white px-4 py-2.5 rounded-xl text-xs font-black hover:bg-slate-700 transition-colors text-center shadow-md">
                                                        عرض الملف
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    })
                                )
                            )}
                        </div>
                    </div>
                )}



                {/* منطقة الخطر للإدارة المركزية (Global Wipe) */}
                {isSuperAdmin && (
                    <div className="mt-8 pt-6">
                        <div className="bg-red-50 border border-red-200 p-6 rounded-3xl text-center">
                            <h3 className="text-sm font-black text-red-800 mb-2 flex items-center justify-center gap-2">
                                <AlertTriangle className="text-red-500" size={18} /> منطقة الخطر (Danger Zone - Global Wipe)
                            </h3>
                            <p className="text-[10px] font-bold text-red-600/80 mb-4">احذر: هذا القسم يمسح بيانات جميع الفصول على مستوى الكنيسة.</p>

                            <div className="flex flex-col gap-3">
                                <button
                                    onClick={async () => {
                                        if (selectedOsraKey && selectedOsraKey !== 'ALL_CHURCH') {
                                            alert("تنبيه: لا يمكن مسح جميع الفصول أثناء تفعيل فلتر لأسرة معينة. قم بإلغاء الفلتر أولاً.");
                                            return;
                                        }
                                        if (window.confirm("تحذير شديد: هل أنت متأكد من تصفير العدادات لجميع الفصول بالكامل؟")) {
                                            if (window.confirm("تأكيد أخير: الداتا هتتصفر لجميع الفصول ومش هترجع، كمل؟")) {
                                                try {
                                                    const now = new Date().toISOString();
                                                    const allKids = await db.children.toArray();
                                                    const updates = allKids.map(c => db.children.update(c.id, { streak: 0, last_liturgy: null, last_service: null, last_visited: null, isDirty: true, updatedAt: now }));
                                                    await Promise.all(updates);
                                                    logActivity('GLOBAL_RESET', `تصفير عدادات جميع الفصول (${allKids.length} مخدوم)`);
                                                    triggerAutoSync();
                                                    alert("تم تصفير العدادات بنجاح لجميع الفصول!");
                                                } catch (error) {
                                                    console.error(error);
                                                    alert("عطل في قاعدة البيانات: " + error.message);
                                                }
                                            }
                                        }
                                    }}
                                    className={`w-full py-3 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-2 shadow-sm ${selectedOsraKey && selectedOsraKey !== 'ALL_CHURCH' ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-amber-500 text-white hover:bg-amber-600'}`}
                                >
                                    <RefreshCw size={16} /> تصفير العدادات لجميع الفصول (Global Reset)
                                </button>

                                <button
                                    onClick={async () => {
                                        if (selectedOsraKey && selectedOsraKey !== 'ALL_CHURCH') {
                                            alert("تنبيه: لا يمكن مسح جميع الفصول أثناء تفعيل فلتر لأسرة معينة. قم بإلغاء الفلتر أولاً.");
                                            return;
                                        }
                                        if (window.confirm("تحذير شديد: هل أنت متأكد من مسح جميع بيانات الخدمة لجميع الفصول بالكامل؟")) {
                                            const confirmPass = appSettings.deletePass || 'مسح';
                                            const pass = prompt(`اكتب كلمة (${confirmPass}) للتأكيد النهائي:`);
                                            if (pass === confirmPass) {
                                                try {
                                                    const now = new Date().toISOString();
                                                    const allKids = await db.children.toArray();
                                                    for (const child of allKids.filter(c => allowedSyncKeyList.includes(c.syncKey))) await deleteChildEverywhere(child, JSON.parse(readScopedStorage('currentServant') || '{}').name);

                                                    const allAtt = await db.attendance.toArray();
                                                    // Linked attendance is tombstoned atomically by deleteChildEverywhere.

                                                    logActivity('GLOBAL_WIPE', `مسح كامل لجميع الفصول (${allKids.length} مخدوم + ${allAtt.length} سجل حضور)`);
                                                    triggerAutoSync();
                                                    alert("تم مسح البيانات بالكامل لجميع الفصول! الأرض فاضية.");
                                                } catch (error) {
                                                    console.error(error);
                                                    alert("عطل في قاعدة البيانات: " + error.message);
                                                }
                                            } else {
                                                alert("تم إلغاء العملية، كلمة المرور خاطئة.");
                                            }
                                        }
                                    }}
                                    className={`w-full py-3 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-2 shadow-sm border ${selectedOsraKey && selectedOsraKey !== 'ALL_CHURCH' ? 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed' : 'bg-white text-red-600 border-red-100 hover:bg-red-50'}`}
                                >
                                    <Trash2 size={16} /> مسح المخدومين والغياب لجميع الفصول (Clean Slate)
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* بروفايل الخادم (معاينة إدارية لأبونا / السوبر أدمن) */}
            {selectedServantForProfile && (
                <ServantProfile
                    servantData={selectedServantForProfile}
                    servant={selectedServantForProfile}
                    isOpen={true}
                    onClose={() => setSelectedServantForProfile(null)}
                    isModal={true}
                />
            )}

            {/* نافذة تعديل بيانات الخادم المباشرة */}
            {editingServant && (
                <EditServantModal
                    isOpen={!!editingServant}
                    servant={editingServant}
                    services={appSettings.services}
                    onClose={() => setEditingServant(null)}
                    onSaved={(updated) => {
                        setAppSettings(prev => {
                            const updatedList = (prev.servants || []).map(s =>
                                (s.id === updated.id || (s.phone && s.phone === updated.phone)) ? { ...s, ...updated } : s
                            );
                            return { ...prev, servants: updatedList };
                        });
                        setEditingServant(null);
                    }}
                />
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