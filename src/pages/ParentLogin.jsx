import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartNavigation } from '../hooks/useSmartNavigation';
import { db } from '../db/database';
import { ShieldAlert, Phone, LogIn, Loader2, ArrowRight } from 'lucide-react';
import { firestore, isFirebaseConfigured } from '../db/firebase';
import { collection, doc, getDoc, getDocs, collectionGroup } from 'firebase/firestore';
import { decryptData } from '../encryption';
import {
    TENANT_CONFIG,
    getActiveLogoUrl,
    getAppEdition,
    getEditionConfig,
    readScopedStorage,
    writeScopedStorage,
    removeScopedStorage
} from '../utils/tenantConfig';
import { extractAllOsrasFromSettings } from '../utils/notificationScopeEngine';

function matchesChildIdentity(candidate, targetClassName, targetSyncKey, normalizedInput, cleanPhone) {
    if (!candidate || candidate.isDeleted) return false;

    const childSyncKey = String(candidate.syncKey || '').trim();
    const matchesClass = !targetClassName || (
        childSyncKey === targetSyncKey ||
        candidate.className === targetClassName ||
        candidate.osraName === targetClassName
    );
    if (!matchesClass) return false;

    const cleanInput = normalizedInput.replace(/^KHD:/, '').trim();
    const childIdStr = String(candidate.id || '').trim().toUpperCase();
    const childCodeStr = String(candidate.code || '').trim().toUpperCase();
    const childQrStr = String(candidate.qrId || '').trim().toUpperCase();
    const matchesId = cleanInput.length >= 3 && (
        childIdStr === cleanInput ||
        childCodeStr === cleanInput ||
        (childQrStr && childQrStr === cleanInput) ||
        childIdStr.endsWith(cleanInput) ||
        childCodeStr.endsWith(cleanInput)
    );

    const phones = [candidate.phone, candidate.motherPhone, candidate.fatherPhone, candidate.childPhone]
        .map(p => String(p || '').trim().replace(/\D/g, ''))
        .filter(Boolean);

    const matchesPhone = cleanPhone.length >= 7 && phones.some(p => p.includes(cleanPhone) || cleanPhone.includes(p));
    return matchesId || matchesPhone;
}

export default function ParentLogin() {
    const { goBack } = useSmartNavigation();
    const navigate = useNavigate();
    const [classes, setClasses] = useState([]);
    const [selectedClass, setSelectedClass] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [activeEdition, setActiveEdition] = useState(() => getAppEdition());

    useEffect(() => {
        const handleEditionSync = () => setActiveEdition(getAppEdition());
        window.addEventListener('edition-changed', handleEditionSync);
        return () => window.removeEventListener('edition-changed', handleEditionSync);
    }, []);

    useEffect(() => {
        const fetchClasses = async () => {
            let loadedClasses = [];

            if (isFirebaseConfigured && navigator.onLine && firestore) {
                try {
                    const mainSnap = await getDoc(doc(firestore, 'System', 'mainConfig'));
                    if (mainSnap.exists()) {
                        const data = mainSnap.data() || {};
                        if (Array.isArray(data.services)) {
                            data.services.forEach(srv => {
                                (srv.osras || []).forEach(osra => {
                                    loadedClasses.push({ name: osra.name, syncKey: osra.syncKey });
                                });
                            });
                        }
                    }
                } catch (e) {
                    console.error('Error fetching classes from Firestore:', e);
                }
            }

            if (loadedClasses.length === 0) {
                try {
                    const savedSettings = readScopedStorage('appSettings');
                    const parsed = savedSettings ? JSON.parse(savedSettings) : {};
                    loadedClasses = extractAllOsrasFromSettings(parsed, [], { includeFallback: false })
                        .map(o => ({ name: o.name, syncKey: o.syncKey }));
                } catch (e) {
                    console.error(e);
                }
            }

            const seen = new Set();
            const uniqueClasses = loadedClasses.filter(c => {
                if (!c.name || seen.has(c.name)) return false;
                seen.add(c.name);
                return true;
            });
            setClasses(uniqueClasses);
        };
        fetchClasses();
    }, []);

    const performLogin = async (targetClassName, rawCredential) => {
        setErrorMsg('');
        setIsLoading(true);

        const rawInput = String(rawCredential || '').trim();
        const cleanPhone = rawInput.replace(/\D/g, '');
        const normalizedInput = rawInput.toUpperCase();

        try {
            const targetClass = classes.find(c => c.name === targetClassName) || { name: targetClassName, syncKey: targetClassName };
            let match = null;
            let matchedFromCloud = false;

            // 1. Local-first Dexie lookup (100% offline & demo-ready)
            const localChildren = await db.children.filter(c => !c.isDeleted).toArray();
            const localMatch = localChildren.find(c =>
                matchesChildIdentity(c, targetClass.name, targetClass.syncKey, normalizedInput, cleanPhone)
            );
            if (localMatch) {
                match = localMatch;
            }

            // 2. Fallback to Firestore only when configured, online, and not already found locally
            if (!match && isFirebaseConfigured && navigator.onLine && firestore) {
                const querySnapshot = await getDocs(collectionGroup(firestore, 'children'));
                for (const docSnap of querySnapshot.docs) {
                    const data = docSnap.data();
                    if (!data) continue;
                    const decrypted = data.payload ? decryptData(data.payload) : data;
                    if (!decrypted) continue;

                    const docSyncKey = docSnap.ref.parent?.parent?.id || '';
                    const candidate = {
                        ...decrypted,
                        id: String(decrypted.id || docSnap.id),
                        syncKey: decrypted.syncKey || docSyncKey
                    };
                    if (matchesChildIdentity(candidate, targetClass.name, targetClass.syncKey, normalizedInput, cleanPhone)) {
                        match = candidate;
                        matchedFromCloud = true;
                        break;
                    }
                }
            }

            if (match) {
                const resolvedSyncKey = match.syncKey || targetClass.syncKey;
                const resolvedClassName = targetClass.name || resolvedSyncKey;
                // إنهاء أي جلسة خادم أو تصفح سابقة عند تسجيل دخول ولي الأمر
                [
                    'currentSyncKey',
                    'currentServant',
                    'assignedOsra',
                    'servantSession',
                    'impersonated_osra',
                    'isSuperAdminImpersonating',
                    'masterSyncKey',
                    'selectedOsra'
                ].forEach((k) => removeScopedStorage(k));
                writeScopedStorage('userRole', 'parent');
                writeScopedStorage('parentChildId', String(match.id));
                writeScopedStorage('parentChildName', match.name);
                writeScopedStorage('parentSyncKey', resolvedSyncKey);
                writeScopedStorage('parentClassName', resolvedClassName);
                writeScopedStorage('parentSession', JSON.stringify({
                    childId: String(match.id),
                    name: match.name,
                    syncKey: resolvedSyncKey,
                    className: resolvedClassName
                }));
                if (typeof window.dispatchEvent === 'function') {
                    window.dispatchEvent(new Event('syncKey-changed'));
                    window.dispatchEvent(new Event('auth-changed'));
                }

                await db.children.put({
                    ...match,
                    id: String(match.id),
                    name: match.name,
                    phone: match.phone || '',
                    motherPhone: match.motherPhone || '',
                    fatherPhone: match.fatherPhone || '',
                    childPhone: match.childPhone || '',
                    syncKey: resolvedSyncKey,
                    className: targetClass.name || resolvedSyncKey
                });

                // Optional background cloud enrichment only when Firestore is configured & online
                if (matchedFromCloud && isFirebaseConfigured && navigator.onLine && firestore) {
                    try {
                        const attendanceSnapshot = await getDocs(collection(firestore, 'Osras', resolvedSyncKey, 'attendance'));
                        const localAttendanceRecords = [];
                        attendanceSnapshot.forEach(docSnap => {
                            const data = docSnap.data();
                            const record = data?.payload ? decryptData(data.payload) : data;
                            if (record && String(record.childId) === String(match.id)) {
                                localAttendanceRecords.push(record);
                            }
                        });
                        if (localAttendanceRecords.length > 0) {
                            await db.attendance.bulkPut(localAttendanceRecords);
                        }
                    } catch (attErr) {
                        console.error('Error fetching child attendance:', attErr);
                    }

                    try {
                        const examsSnapshot = await getDocs(collection(firestore, 'Osras', resolvedSyncKey, 'exams'));
                        const localExams = [];
                        for (const examDoc of examsSnapshot.docs) {
                            const examData = examDoc.data();
                            localExams.push({ id: examDoc.id, firebaseId: examDoc.id, syncKey: resolvedSyncKey, ...examData });
                            try {
                                const gradeSnap = await getDocs(collection(firestore, 'Osras', resolvedSyncKey, 'exams', examDoc.id, 'grades'));
                                for (const gDoc of gradeSnap.docs) {
                                    const gData = gDoc.data();
                                    const decryptedGrade = gData.payload ? decryptData(gData.payload) : gData;
                                    if (decryptedGrade && String(decryptedGrade.childId) === String(match.id)) {
                                        await db.grades.put({
                                            id: `${examDoc.id}_${match.id}`,
                                            examId: examDoc.id,
                                            childId: String(match.id),
                                            grade: decryptedGrade.grade,
                                            maxGrade: examData.maxGrade,
                                            examName: examData.examName,
                                            date: examData.date,
                                            syncKey: resolvedSyncKey,
                                            isDirty: false,
                                            updatedAt: new Date().toISOString()
                                        });
                                    }
                                }
                            } catch (gErr) {
                                console.warn('Error fetching grade for exam:', examDoc.id, gErr);
                            }
                        }
                        if (localExams.length > 0) {
                            await db.exams.bulkPut(localExams);
                        }
                    } catch (examErr) {
                        console.warn('Error fetching exams:', examErr);
                    }
                }

                navigate('/parent-dashboard', { replace: true });
            } else {
                setErrorMsg('لم يتم العثور على مخدوم مسجل بهذا الرقم أو الكود في هذا الفصل.');
            }
        } catch (error) {
            console.error(error);
            setErrorMsg('حدث خطأ أثناء التحقق من البيانات. حاول مرة أخرى.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogin = (e) => {
        e.preventDefault();
        void performLogin(selectedClass, phoneNumber);
    };

    const editionCfg = getEditionConfig(activeEdition === 'parent' ? 'parent' : 'all');
    const isParentStandaloneEdition = activeEdition === 'parent';
    const bannerGradient = isParentStandaloneEdition
        ? 'linear-gradient(135deg, #4B121F 0%, #6B1D2F 68%, #8C621E 100%)'
        : 'linear-gradient(135deg, #162447 0%, #1F3463 70%, #8C621E 100%)';

    return (
        <div className="min-h-screen coptic-cream-surface flex flex-col items-center justify-center p-4 gap-3" dir="rtl">
            <div className="coptic-card rounded-[2rem] shadow-2xl border-2 border-[#DFC48F] max-w-md w-full overflow-hidden animate-card-enter">
                {/* Royal Coptic Banner */}
                <div
                    className="p-6 text-center text-white relative"
                    style={{ background: bannerGradient }}
                >
                    {!isParentStandaloneEdition && (
                        <button
                            type="button"
                            onClick={() => goBack(readScopedStorage('currentSyncKey') ? '/' : '/login')}
                            aria-label="العودة"
                            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 border border-white/20 flex items-center justify-center hover:bg-white/25 transition-colors cursor-pointer"
                        >
                            <ArrowRight size={18} />
                        </button>
                    )}
                    <div className="w-24 h-24 rounded-full bg-white p-1.5 mx-auto mb-3 shadow-lg border-2 border-amber-300/80 overflow-hidden">
                        <img
                            src={getActiveLogoUrl(isParentStandaloneEdition ? 'parent' : activeEdition)}
                            alt={TENANT_CONFIG.CHURCH_NAME}
                            className="w-full h-full object-contain rounded-full"
                        />
                    </div>
                    <h1 className="font-calligraphic text-2xl font-bold text-amber-100">بوابة ولي الأمر والمخدوم</h1>
                    <p className="text-xs font-bold text-indigo-100/90 mt-1">{TENANT_CONFIG.CHURCH_NAME}</p>
                    <p className="text-[11px] font-bold text-amber-200/90 mt-1.5">{editionCfg.subtitle}</p>
                </div>

                <div className="p-6 sm:p-7">
                    {errorMsg && (
                        <div className="bg-rose-50 text-rose-700 p-3 rounded-2xl text-xs sm:text-sm font-bold mb-4 flex items-center gap-2 border border-rose-200">
                            <ShieldAlert size={16} className="shrink-0" /> {errorMsg}
                        </div>
                    )}

                    <form onSubmit={handleLogin} className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="block text-xs font-black text-[#6E5329]">اختر الأسرة / الفصل *</label>
                            <select
                                value={selectedClass}
                                onChange={(e) => setSelectedClass(e.target.value)}
                                className="w-full p-3.5 coptic-cream-input rounded-2xl font-bold text-sm"
                                required
                            >
                                <option value="" disabled>-- اختر الفصل --</option>
                                {classes.map((c, i) => (
                                    <option key={i} value={c.name || ''}>{c.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-1.5">
                            <label className="block text-xs font-black text-[#6E5329]">رقم التليفون أو كود المخدوم *</label>
                            <div className="relative">
                                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C621E]" size={18} />
                                <input
                                    type="text"
                                    value={phoneNumber}
                                    onChange={(e) => setPhoneNumber(e.target.value)}
                                    placeholder="01xxxxxxxxx أو BRS-XXXX"
                                    className="w-full pl-10 pr-4 py-3.5 coptic-cream-input rounded-2xl font-bold text-sm"
                                    required
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-gradient-to-l from-[#1B2A59] to-[#253A7A] hover:from-[#152248] hover:to-[#1B2A59] text-amber-100 py-3.5 rounded-2xl font-black text-base shadow-lg border border-amber-400/35 active:scale-[0.99] transition-all flex justify-center items-center gap-2 cursor-pointer"
                        >
                            {isLoading ? <Loader2 className="animate-spin" size={22} /> : <><LogIn size={19} /> عرض النتيجة وسجل الحضور</>}
                        </button>
                    </form>

                    {!isParentStandaloneEdition && (
                        <div className="mt-5 text-center">
                            <button
                                type="button"
                                onClick={() => navigate('/login', { replace: true })}
                                className="text-xs font-black text-[#8C621E] hover:text-[#1B2A59] underline cursor-pointer"
                            >
                                هل أنت خادم؟ الدخول من بوابة الخدام
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
