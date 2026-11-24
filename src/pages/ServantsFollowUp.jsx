import React, { useState, useEffect, useMemo } from 'react';
import { 
    ArrowRight, 
    ClipboardList, 
    Search, 
    Save, 
    CheckCircle2, 
    Calendar, 
    Users, 
    UserX, 
    UserMinus, 
    BarChart3, 
    Church, 
    BookOpen, 
    HandHelping, 
    Eye,
    TrendingUp,
    Sparkles,
    Award,
    HelpCircle,
    Edit3,
    Printer
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, getDocs, onSnapshot, query, where, setDoc, deleteDoc } from 'firebase/firestore';
import { firestore } from '../db/firebase';
import ServantProfile from '../components/ServantProfile';
import EditServantModal from '../components/EditServantModal';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
import { readScopedStorage } from '../utils/tenantConfig';

const cleanPhone = (p) => String(p || '').replace(/\D/g, '').replace(/^0+/, '');
const cleanName = (n) => String(n || '').trim().replace(/[إأآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');

// Filter out Priests from servants meeting roster
const isPriestRecord = (s) => {
    if (!s) return false;
    if (s.role === 'priest' || s.isPriest === true || s.role === 'كاهن' || s.role === 'الاب الكاهن') return true;
    const name = String(s.name || '').trim();
    return name.startsWith('أبونا') || name.startsWith('ابونا') || name.startsWith('القمص') || name.startsWith('القس');
};

import { useSmartNavigation } from '../hooks/useSmartNavigation';

export default function ServantsFollowUp() {
    const { goBack } = useSmartNavigation();
    const navigate = useNavigate();
    const [search, setSearch] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [selectedServantForProfile, setSelectedServantForProfile] = useState(null);
    const [editingServant, setEditingServant] = useState(null);

    const getOsraName = (key) => {
        if (!key || key === 'الكل') return key || "غير محدد";
        try {
            const settings = JSON.parse(readScopedStorage('appSettings')) || {};
            const services = settings.services || [];
            let foundName = key;
            services.forEach(service => {
                const foundOsra = (service.osras || []).find(o => String(o.syncKey).trim() === String(key).trim());
                if (foundOsra) foundName = foundOsra.name;
            });
            return foundName;
        } catch(e) {
            return key;
        }
    };

    const getArabicDateText = (dateString) => {
        try {
            const d = new Date(dateString);
            const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
            const dayName = days[d.getDay()];
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dayName}، ${dd}/${mm}/${yyyy}`;
        } catch(e) {
            return dateString;
        }
    };

    const getSelectedDate = (date = new Date()) => {
        const d = new Date(date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    // Helper: get the Saturday→Friday week range around a given date
    const getWeekRange = (dateStr) => {
        const d = new Date(dateStr + 'T12:00:00');
        const dayOfWeek = d.getDay(); // 0=Sun..6=Sat
        // Saturday is day 6. Go back to the most recent Saturday.
        const diffToSaturday = dayOfWeek === 6 ? 0 : dayOfWeek + 1;
        const saturday = new Date(d);
        saturday.setDate(d.getDate() - diffToSaturday);
        const dates = [];
        for (let i = 0; i < 7; i++) {
            const day = new Date(saturday);
            day.setDate(saturday.getDate() + i);
            dates.push(getSelectedDate(day));
        }
        return dates; // [Sat, Sun, Mon, Tue, Wed, Thu, Fri]
    };

    const [weekDate, setWeekDate] = useState(() => getSelectedDate());

    const handleDateChange = (val) => {
        if (!val) return;
        setWeekDate(getSelectedDate(val));
    };

    const weekRange = useMemo(() => getWeekRange(weekDate), [weekDate]);
    const weekLabel = useMemo(() => {
        if (weekRange.length < 7) return '';
        return `${getArabicDateText(weekRange[0])}  ←  ${getArabicDateText(weekRange[6])}`;
    }, [weekRange]);

    const [servantsData, setServantsData] = useState([]);
    const [weeklyRecords, setWeeklyRecords] = useState([]);
    const [totalServantCount, setTotalServantCount] = useState(0);
    const [profileUpdateCount, setProfileUpdateCount] = useState(0);

    // Live Listener: Re-sync servant roster when a profile is updated anywhere
    useEffect(() => {
        const handleUpdate = () => setProfileUpdateCount(c => c + 1);
        window.addEventListener('servant-profile-updated', handleUpdate);
        window.addEventListener('storage', handleUpdate);
        return () => {
            window.removeEventListener('servant-profile-updated', handleUpdate);
            window.removeEventListener('storage', handleUpdate);
        };
    }, []);
    
    // 1. Fetch Servants & Listen to Attendance
    useEffect(() => {
        let unsubscribe = () => {};
        let unsubWeekly = () => {};

        const fetchAndListen = async () => {
            const accessScope = resolveUserAccessScope(null, [], { includeFallback: true });
            const allowedKeysSet = new Set(accessScope.allowedSyncKeys || []);
            const allowedNamesSet = new Set((accessScope.allowedOsras || []).map(o => String(o.name || '').trim()).filter(Boolean));
            const isServantInScope = (s) => {
                if (accessScope.isSuperAdmin) return true;
                const sk = String(s?.syncKey || '').trim();
                const on = String(s?.osraName || s?.assignedOsra || '').trim();
                if (allowedKeysSet.has(sk) || allowedKeysSet.has(on) || allowedNamesSet.has(on)) return true;
                if (Array.isArray(s?.allowedClasses) && s.allowedClasses.some(k => allowedKeysSet.has(String(k || '').trim()))) return true;
                return false;
            };

            if (!firestore) {
                let demoServants = [];
                try {
                    const settings = JSON.parse(readScopedStorage('appSettings') || '{}');
                    demoServants = (settings.servants || []).filter(s => !isPriestRecord(s) && isServantInScope(s));
                } catch {
                    demoServants = [];
                }
                setTotalServantCount(demoServants.length);

                let daySaved = {};
                try {
                    daySaved = JSON.parse(localStorage.getItem(`demo_servants_attendance_${weekDate}`) || '{}');
                } catch {
                    daySaved = {};
                }

                const mapped = demoServants.map(s => {
                    const sId = String(s.id || s.uid || s.phone || s.name);
                    const savedRow = daySaved[sId] || {};
                    const isExplicit = !!(savedRow.attendance && ['حضور', 'غياب', 'اعتذار'].includes(savedRow.attendance));
                    return {
                        id: sId,
                        uid: s.uid || sId,
                        phone: s.phone ? String(s.phone).trim() : "",
                        name: s.name || "خادم",
                        role: s.role || 'خادم',
                        assignedOsra: s.assignedOsra || s.osraName || '',
                        syncKey: s.syncKey || '',
                        birthDate: s.birthDate || s.birthdate || '',
                        confessionFather: s.confessionFather || s.fatherConfessor || '',
                        osraName: s.osraName || s.assignedOsra || s.syncKey || "غير محدد",
                        weekDate,
                        month: weekDate.substring(0, 7),
                        attendance: isExplicit ? savedRow.attendance : "",
                        excuseNote: savedRow.excuseNote || "",
                        hasExplicitRecord: isExplicit,
                        liturgy: !!savedRow.liturgy,
                        preparation: !!savedRow.preparation,
                        meeting: !!savedRow.meeting,
                        visitation: !!savedRow.visitation,
                        confessionDate: savedRow.confessionDate || "",
                        activitiesService: !!savedRow.activitiesService,
                        activitiesDiocese: savedRow.activitiesDiocese || "",
                        tasks: savedRow.tasks || "",
                        leaderNotes: savedRow.leaderNotes || "",
                        profileImage: s.profileImage || s.photoURL || s.profilePic || ""
                    };
                });
                setServantsData(mapped);

                const localWeekly = [];
                weekRange.forEach(dStr => {
                    try {
                        const obj = JSON.parse(localStorage.getItem(`demo_servants_attendance_${dStr}`) || '{}');
                        Object.values(obj).forEach(r => {
                            if (r && ['حضور', 'غياب', 'اعتذار'].includes(r.attendance)) {
                                localWeekly.push({ ...r, weekDate: dStr, docId: `${dStr}_${r.uid || r.id}` });
                            }
                        });
                    } catch {
                        // ignore
                    }
                });
                setWeeklyRecords(localWeekly);
                return;
            }
            let baseServants = [];
            const aliasMap = {}; // Maps docIds/self-check-in uids to servant phone/id

            try {
                // 1. Authoritative church roster: System/mainConfig
                const configSnap = await getDoc(doc(firestore, 'System', 'mainConfig'));
                if (configSnap.exists() && Array.isArray(configSnap.data().servants) && configSnap.data().servants.length > 0) {
                    baseServants = configSnap.data().servants;
                } else {
                    // Fallback only if mainConfig has no servants
                    const servantsSnap = await getDocs(collection(firestore, "servants"));
                    const seen = new Set();
                    servantsSnap.forEach(docSnap => {
                        const d = docSnap.data();
                        const p = cleanPhone(d.phone) || docSnap.id;
                        if (!seen.has(p)) {
                            seen.add(p);
                            baseServants.push({ ...d, uid: docSnap.id, id: docSnap.id });
                        }
                    });
                }

                // 2. Fetch servants collection to map docIds/self-check-in uids to canonical servant profiles
                try {
                    const servantsSnap = await getDocs(collection(firestore, "servants"));
                    servantsSnap.forEach(docSnap => {
                        const d = docSnap.data();
                        const p = cleanPhone(d.phone);
                        if (p) {
                            aliasMap[docSnap.id] = p;
                            if (d.uid) aliasMap[d.uid] = p;
                        }
                    });
                } catch (e) {
                    console.warn("Error fetching servants aliases:", e);
                }
            } catch (err) {
                console.error("Error fetching base servants:", err);
            }

            // Exclude deleted servants if appSettings exists in localStorage
            try {
                const appSettingsStr = readScopedStorage('appSettings');
                if (appSettingsStr) {
                    const appSettings = JSON.parse(appSettingsStr);
                    const activeServants = appSettings.servants || [];
                    if (activeServants.length > 0) {
                        baseServants = baseServants.filter(s => 
                            activeServants.some(active => 
                                String(active.id) === String(s.id) || 
                                (active.phone && s.phone && cleanPhone(active.phone) === cleanPhone(s.phone)) || 
                                active.name === s.name
                            )
                        );
                    }
                }
            } catch (err) {
                console.error("Error filtering active servants:", err);
            }

            // Exclude Priests and restrict strictly to active 4-tier RBAC scope
            baseServants = baseServants.filter(s => !isPriestRecord(s) && isServantInScope(s));

            setTotalServantCount(baseServants.length);

            // Prepare base servants map with strictly EMPTY attendance by default (NO "حضور" assumption!)
            const servantsMap = {};
            baseServants.forEach(s => {
                const sId = String(s.id || s.uid || s.phone);
                servantsMap[sId] = {
                    id: sId,
                    uid: s.uid || sId,
                    phone: s.phone ? String(s.phone).trim() : "",
                    name: s.name,
                    role: s.role || 'خادم',
                    assignedOsra: s.assignedOsra || s.osraName || '',
                    syncKey: s.syncKey || '',
                    birthDate: s.birthDate || s.birthdate || '',
                    confessionFather: s.confessionFather || s.fatherConfessor || '',
                    osraName: s.osraName || s.assignedOsra || s.syncKey || "غير محدد",
                    weekDate,
                    month: weekDate.substring(0, 7),
                    attendance: "", // STRICT: NO default "حضور" assumption! Empty by default.
                    excuseNote: "",
                    hasExplicitRecord: false,
                    liturgy: false, 
                    preparation: false, 
                    meeting: false, 
                    visitation: false,
                    confessionDate: "", 
                    activitiesService: false, 
                    activitiesDiocese: "", 
                    tasks: "", 
                    leaderNotes: "",
                    profileImage: s.profileImage || s.photoURL || s.profilePic || ""
                };
            });

            // Listen to attendance data for the selected day in real-time
            const q = query(collection(firestore, "ServantAttendance"), where("weekDate", "==", weekDate));
            
            unsubscribe = onSnapshot(q, (snapshot) => {
                const currentData = {};
                Object.keys(servantsMap).forEach(k => {
                    currentData[k] = { ...servantsMap[k] };
                });

                snapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    if (!data) return;

                    const docIdSuffix = docSnap.id.includes('_') ? docSnap.id.split('_').slice(1).join('_') : docSnap.id;
                    const cleanDPhone = cleanPhone(data.phone || data.uid || docIdSuffix);
                    const cleanDName = cleanName(data.name);
                    const aliasPhone = aliasMap[data.uid] || aliasMap[docIdSuffix];

                    const matchedId = Object.keys(currentData).find(sId => {
                        const s = currentData[sId];
                        if (s.uid && (data.uid === s.uid || docIdSuffix === s.uid)) return true;
                        if (s.id && (String(data.id) === String(s.id) || String(data.uid) === String(s.id))) return true;
                        const sPhone = cleanPhone(s.phone);
                        if (sPhone && (cleanDPhone === sPhone || (aliasPhone && sPhone === aliasPhone))) return true;
                        if (s.name && data.name && cleanName(s.name) === cleanDName) return true;
                        return false;
                    });

                    if (matchedId) {
                        const isExplicit = !!(data.attendance && ['حضور', 'غياب', 'اعتذار'].includes(data.attendance));
                        currentData[matchedId] = { 
                            ...currentData[matchedId], 
                            ...data,
                            id: matchedId,
                            attendance: isExplicit ? data.attendance : "",
                            excuseNote: data.excuseNote || "",
                            hasExplicitRecord: isExplicit
                        };
                    }
                });

                setServantsData(Object.values(currentData));
            });

            // Listen to weekly records in real-time across the whole Sat -> Fri range
            try {
                const weekQ = query(
                    collection(firestore, "ServantAttendance"),
                    where("weekDate", "in", weekRange)
                );
                unsubWeekly = onSnapshot(weekQ, (snapshot) => {
                    const records = [];
                    snapshot.forEach(docSnap => {
                        const data = docSnap.data();
                        // Strict check: only count documents with an explicit status
                        if (data && data.weekDate && ['حضور', 'غياب', 'اعتذار'].includes(data.attendance)) {
                            records.push({ ...data, docId: docSnap.id });
                        }
                    });
                    setWeeklyRecords(records);
                }, (err) => {
                    console.warn("[ServantsFollowUp] Weekly stats listener error:", err);
                });
            } catch (err) {
                console.warn("[ServantsFollowUp] Setup weekly listener error:", err);
            }
        };

        fetchAndListen();
        return () => {
            unsubscribe();
            unsubWeekly();
        };
    }, [weekDate, profileUpdateCount]);

    const handleUpdate = async (id, field, value) => {
        // Optimistic UI update for current day
        const updatedServants = servantsData.map(s => {
            if (s.id === id) {
                const updated = { ...s, [field]: value };
                if (field === 'attendance') {
                    const isExplicit = !!(value && ['حضور', 'غياب', 'اعتذار'].includes(value));
                    updated.hasExplicitRecord = isExplicit;
                    if (value !== 'حضور') {
                        updated.liturgy = false;
                        updated.preparation = false;
                        updated.meeting = false;
                        updated.visitation = false;
                    }
                    if (value !== 'اعتذار') {
                        updated.excuseNote = '';
                    }
                }
                return updated;
            }
            return s;
        });
        setServantsData(updatedServants);

        const target = updatedServants.find(s => s.id === id);
        if (!target) return;

        // Optimistic update for weekly records so stats cards reflect changes instantly
        const recordUid = target.uid || target.phone || target.id;
        const docId = `${weekDate}_${recordUid}`;

        setWeeklyRecords(prev => {
            const filtered = prev.filter(r => !(r.docId === docId || (r.uid === recordUid && r.weekDate === target.weekDate)));
            if (target.hasExplicitRecord) {
                return [...filtered, { ...target, uid: recordUid, docId }];
            }
            return filtered;
        });

        // Local persistence fallback when offline or in Demo mode
        if (!firestore) {
            try {
                const storageKey = `demo_servants_attendance_${weekDate}`;
                const existing = JSON.parse(localStorage.getItem(storageKey) || '{}');
                if (field === 'attendance' && !target.hasExplicitRecord) {
                    delete existing[id];
                } else {
                    existing[id] = { ...target };
                }
                localStorage.setItem(storageKey, JSON.stringify(existing));
            } catch {
                // ignore storage write errors
            }
            return;
        }
        try {
            if (field === 'attendance' && !target.hasExplicitRecord) {
                // If reset to unrecorded / empty, delete document from ServantAttendance
                await deleteDoc(doc(firestore, "ServantAttendance", docId));
            } else if (target.hasExplicitRecord) {
                const statusVal = target.attendance === 'حضور' ? 'present' : target.attendance === 'اعتذار' ? 'excused' : target.attendance === 'غياب' ? 'absent' : target.attendance;
                await setDoc(doc(firestore, "ServantAttendance", docId), {
                    id: target.id,
                    uid: recordUid,
                    phone: target.phone || "",
                    name: target.name,
                    osraName: target.osraName,
                    weekDate,
                    month: weekDate.substring(0, 7),
                    attendance: target.attendance,
                    status: statusVal,
                    excuseNote: target.excuseNote || "",
                    liturgy: target.liturgy || false,
                    preparation: target.preparation || false,
                    meeting: target.meeting || false,
                    visitation: target.visitation || false,
                    confessionDate: target.confessionDate || "",
                    activitiesService: target.activitiesService || false,
                    activitiesDiocese: target.activitiesDiocese || "",
                    tasks: target.tasks || "",
                    leaderNotes: target.leaderNotes || "",
                    profileImage: target.profileImage || ""
                }, { merge: true });
            }
        } catch (err) {
            console.error("Error updating firebase:", err);
        }
    };

    const handleSave = async () => {
        if (!firestore) {
            setIsSaving(true);
            try {
                const storageKey = `demo_servants_attendance_${weekDate}`;
                const payload = {};
                let savedCount = 0;
                servantsData.forEach(s => {
                    if (s.hasExplicitRecord) {
                        payload[s.id] = { ...s };
                        savedCount++;
                    }
                });
                localStorage.setItem(storageKey, JSON.stringify(payload));
                alert(`تم حفظ ${savedCount} تقييم بنجاح على الجهاز.`);
            } finally {
                setIsSaving(false);
            }
            return;
        }
        setIsSaving(true);
        try {
            let savedCount = 0;
            for (const s of servantsData) {
                if (s.hasExplicitRecord) {
                    const recordUid = s.uid || s.phone || s.id;
                    const docId = `${weekDate}_${recordUid}`;
                    const statusVal = s.attendance === 'حضور' ? 'present' : s.attendance === 'اعتذار' ? 'excused' : s.attendance === 'غياب' ? 'absent' : s.attendance;
                    await setDoc(doc(firestore, "ServantAttendance", docId), {
                        id: s.id,
                        uid: recordUid,
                        phone: s.phone || "",
                        name: s.name,
                        osraName: s.osraName,
                        weekDate,
                        month: weekDate.substring(0, 7),
                        attendance: s.attendance,
                        status: statusVal,
                        excuseNote: s.excuseNote || "",
                        liturgy: s.liturgy || false,
                        preparation: s.preparation || false,
                        meeting: s.meeting || false,
                        visitation: s.visitation || false,
                        confessionDate: s.confessionDate || "",
                        activitiesService: s.activitiesService || false,
                        activitiesDiocese: s.activitiesDiocese || "",
                        tasks: s.tasks || "",
                        leaderNotes: s.leaderNotes || "",
                        profileImage: s.profileImage || ""
                    }, { merge: true });
                    savedCount++;
                }
            }
            alert(`تم حفظ ${savedCount} تقييم بنجاح للسحابة!`);
        } catch (err) {
            console.error("Error saving evaluations:", err);
            alert("حدث خطأ أثناء حفظ التقييمات");
        } finally {
            setIsSaving(false);
        }
    };

    const filteredServants = servantsData.filter(s => s.name.includes(search));

    // ────────────────────────────────────────────────
    // Selected Day Quick Breakdown
    // ────────────────────────────────────────────────
    const dayStats = useMemo(() => {
        let present = 0;
        let excused = 0;
        let absent = 0;
        let unrecorded = 0;

        servantsData.forEach(s => {
            if (s.attendance === 'حضور') present++;
            else if (s.attendance === 'اعتذار') excused++;
            else if (s.attendance === 'غياب') absent++;
            else unrecorded++;
        });

        return { present, excused, absent, unrecorded, total: servantsData.length };
    }, [servantsData]);

    // ────────────────────────────────────────────────
    // Comprehensive Weekly Stats Computation (Strict Verification)
    // ────────────────────────────────────────────────
    const weeklyStats = useMemo(() => {
        const findServantId = (rec) => {
            const docIdSuffix = rec.docId && rec.docId.includes('_') ? rec.docId.split('_').slice(1).join('_') : rec.docId;
            const recPhone = cleanPhone(rec.phone || rec.uid || docIdSuffix);
            const recName = cleanName(rec.name);

            for (const s of servantsData) {
                if (s.uid && (rec.uid === s.uid || docIdSuffix === s.uid)) return s.id;
                if (s.id && (String(rec.id) === String(s.id) || String(rec.uid) === String(s.id))) return s.id;
                const sPhone = cleanPhone(s.phone);
                if (sPhone && (recPhone === sPhone || recPhone.endsWith(sPhone) || sPhone.endsWith(recPhone))) return s.id;
                if (s.name && rec.name && cleanName(s.name) === recName) return s.id;
            }
            return null;
        };

        // Key: `${weekDate}_${canonicalServantId}` -> record
        const recordMap = new Map();

        // 1. Add records from Firestore weekly listener (already verified explicit)
        weeklyRecords.forEach(r => {
            if (r.weekDate && ['حضور', 'غياب', 'اعتذار'].includes(r.attendance)) {
                const servantId = findServantId(r);
                if (servantId) {
                    recordMap.set(`${r.weekDate}_${servantId}`, { ...r, canonicalId: servantId });
                }
            }
        });

        // 2. Overlay live servantsData for the currently selected weekDate ONLY if explicit
        servantsData.forEach(s => {
            if (s.weekDate) {
                const key = `${s.weekDate}_${s.id}`;
                if (s.hasExplicitRecord && ['حضور', 'غياب', 'اعتذار'].includes(s.attendance)) {
                    recordMap.set(key, { ...s, canonicalId: s.id });
                } else {
                    recordMap.delete(key);
                }
            }
        });

        const explicitRecords = Array.from(recordMap.values());

        // Group explicit records strictly by canonical servant id
        const servantMap = new Map();
        explicitRecords.forEach(r => {
            if (!servantMap.has(r.canonicalId)) {
                servantMap.set(r.canonicalId, []);
            }
            servantMap.get(r.canonicalId).push(r);
        });

        // Categorize each unique servant strictly across the week:
        const uniquePresentServants = new Set();
        const uniqueExcusedServants = new Set();
        const uniqueAbsentServants = new Set();

        servantsData.forEach(s => {
            const records = servantMap.get(s.id) || [];
            if (records.length === 0) return; // Unrecorded across the week

            const hasPresent = records.some(r => r.attendance === 'حضور');
            const hasExcused = records.some(r => r.attendance === 'اعتذار');
            const hasAbsent = records.some(r => r.attendance === 'غياب');

            if (hasPresent) {
                uniquePresentServants.add(s.id);
            } else if (hasExcused) {
                uniqueExcusedServants.add(s.id);
            } else if (hasAbsent) {
                uniqueAbsentServants.add(s.id);
            }
        });

        // Unrecorded servants: church servants with ZERO explicit records anywhere this week
        const recordedUniqueTotal = uniquePresentServants.size + uniqueExcusedServants.size + uniqueAbsentServants.size;
        const totalServants = servantsData.length;
        const unrecordedCount = Math.max(0, totalServants - recordedUniqueTotal);

        // Total log counts across all sessions/days
        const totalPresentRecords = explicitRecords.filter(r => r.attendance === 'حضور').length;
        const totalExcusedRecords = explicitRecords.filter(r => r.attendance === 'اعتذار').length;
        const totalAbsentRecords = explicitRecords.filter(r => r.attendance === 'غياب').length;
        const totalRecords = explicitRecords.length;

        // Activities & Meetings breakdown (from explicit records only)
        const liturgyCount = explicitRecords.filter(r => r.liturgy === true).length;
        const preparationCount = explicitRecords.filter(r => r.preparation === true).length;
        const meetingCount = explicitRecords.filter(r => r.meeting === true).length;
        const visitationCount = explicitRecords.filter(r => r.visitation === true).length;
        const activitiesServiceCount = explicitRecords.filter(r => r.activitiesService === true).length;
        const activitiesDioceseCount = explicitRecords.filter(r => r.activitiesDiocese && String(r.activitiesDiocese).trim() !== '').length;

        const totalActivityEngagements = liturgyCount + preparationCount + meetingCount + visitationCount + activitiesServiceCount + activitiesDioceseCount;
        const uniqueActivityServants = new Set(
            explicitRecords
                .filter(r => r.liturgy || r.preparation || r.meeting || r.visitation || r.activitiesService || (r.activitiesDiocese && String(r.activitiesDiocese).trim() !== ''))
                .map(r => r.canonicalId)
        );

        const uniqueDays = new Set(explicitRecords.map(r => r.weekDate).filter(Boolean));
        const daysWithData = uniqueDays.size;

        // Attendance Rate strictly out of total church servants
        const rate = totalServants > 0 ? Math.round((uniquePresentServants.size / totalServants) * 100) : 0;
        const recordedRate = recordedUniqueTotal > 0 ? Math.round((uniquePresentServants.size / recordedUniqueTotal) * 100) : 0;

        return {
            totalRecords,
            totalPresentRecords,
            totalExcusedRecords,
            totalAbsentRecords,
            uniquePresentCount: uniquePresentServants.size,
            uniqueExcusedCount: uniqueExcusedServants.size,
            uniqueAbsentCount: uniqueAbsentServants.size,
            unrecordedCount,
            recordedUniqueTotal,
            totalServants,
            liturgyCount,
            preparationCount,
            meetingCount,
            visitationCount,
            activitiesServiceCount,
            activitiesDioceseCount,
            totalActivityEngagements,
            uniqueActivityServantsCount: uniqueActivityServants.size,
            daysWithData,
            rate,
            recordedRate
        };
    }, [weeklyRecords, servantsData]);

    return (
        <div className="min-h-screen coptic-cream-surface pb-24 text-[#231B12]" dir="rtl">
            {/* Header Bar */}
            <header
                className="text-white p-4 sticky top-0 z-50 shadow-lg rounded-b-3xl sm:rounded-b-[2.25rem] border-b border-amber-400/25"
                style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 72%, #8C621E 100%)' }}
            >
                <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <button type="button" onClick={() => goBack('/')} className="w-10 h-10 bg-white/15 text-white rounded-full flex items-center justify-center hover:bg-white/25 transition-all shrink-0 cursor-pointer" title="رجوع">
                            <ArrowRight size={20} />
                        </button>
                        <div className="min-w-0">
                            <h1 className="font-calligraphic text-lg sm:text-xl font-bold text-amber-100 flex items-center gap-2 truncate">
                                <ClipboardList size={19} className="text-amber-300 shrink-0" />
                                <span className="truncate">متابعة اجتماع الخدام</span>
                            </h1>
                            <p className="text-[11px] sm:text-xs font-bold text-amber-200/85 truncate">
                                تسجيل ومتابعة حضور والتزامات الخدام الأسبوعية
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={() => navigate('/servants-report')}
                            className="bg-amber-400 hover:bg-amber-300 text-[#162447] px-3 sm:px-3.5 py-2 rounded-xl text-xs font-black transition-colors flex items-center gap-1.5 shadow-md cursor-pointer"
                            title="فتح التقرير الشامل لاجتماع الخدام"
                        >
                            <Printer size={16} />
                            <span className="hidden sm:inline">تقرير الخدام</span>
                        </button>
                        <button type="button" onClick={handleSave} disabled={isSaving} className="bg-emerald-700 hover:bg-emerald-600 text-white px-3.5 sm:px-4 py-2 rounded-xl text-xs font-black transition-colors flex items-center gap-1.5 shadow-md cursor-pointer">
                            {isSaving ? "جاري الحفظ..." : <><Save size={16} /> حفظ التقييم</>}
                        </button>
                    </div>
                </div>
            </header>

            <main className="p-3.5 sm:p-4 max-w-7xl mx-auto mt-3 sm:mt-6">
                <div className="coptic-card p-4 sm:p-6 rounded-3xl sm:rounded-[2.25rem] shadow-lg border border-[#DFC48F]">
                    {/* Filters Row */}
                    <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
                        <div className="relative w-full md:w-1/3">
                            <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8C621E]" size={18} />
                            <input
                                type="date"
                                value={weekDate}
                                onChange={e => handleDateChange(e.target.value)}
                                className="coptic-cream-input w-full pl-4 pr-12 py-3 rounded-xl font-bold text-sm outline-none text-[#1B2A59] transition-all cursor-pointer"
                            />
                        </div>
                        <div className="relative w-full md:w-1/3">
                            <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8C621E]" size={18} />
                            <input
                                type="text"
                                placeholder="ابحث باسم الخادم..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="coptic-cream-input w-full pl-4 pr-12 py-3 rounded-xl font-bold text-sm outline-none text-[#1B2A59] transition-all"
                            />
                        </div>
                    </div>

                    <div className="mb-6 bg-[#FAF3E3] border border-[#DFC48F] p-4 rounded-2xl shadow-sm flex flex-col md:flex-row items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-[#1B2A59] font-black text-sm">
                            <Calendar size={17} className="text-[#C8942E]" />
                            <span>اجتماع الخدام: <strong>{getArabicDateText(weekDate)}</strong></span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs font-black">
                            <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-1 rounded-xl">
                                حضور: {dayStats.present}
                            </span>
                            <span className="bg-amber-100 text-amber-800 border border-amber-200 px-3 py-1 rounded-xl">
                                اعتذار: {dayStats.excused}
                            </span>
                            <span className="bg-rose-100 text-rose-800 border border-rose-200 px-3 py-1 rounded-xl">
                                غياب: {dayStats.absent}
                            </span>
                            <span className="bg-white text-[#6E5329] border border-[#DFC48F] px-3 py-1 rounded-xl">
                                لم يُسجل: {dayStats.unrecorded}
                            </span>
                        </div>
                    </div>

                    {/* Desktop Table View */}
                    <div className="overflow-x-auto rounded-2xl border border-[#DFC48F] bg-[#FFFDF7] hidden md:block">
                        <table className="w-full min-w-[1200px] text-sm text-right">
                            <thead className="bg-[#FAF3E3] text-[#1B2A59] font-black border-b border-[#DFC48F]">
                                <tr>
                                    <th className="p-4 text-center border-l border-[#DFC48F] w-12">الصورة</th>
                                    <th className="p-4 min-w-[170px]">اسم الخادم</th>
                                    <th className="p-4 min-w-[120px]">الأسرة</th>
                                    <th className="p-4 text-center min-w-[150px]">حضور الاجتماع</th>
                                    <th className="p-4 text-center">قداس</th>
                                    <th className="p-4 text-center">التحضير</th>
                                    <th className="p-4 text-center">اجتماع الخدمة</th>
                                    <th className="p-4 text-center">الافتقاد</th>
                                    <th className="p-4 text-center min-w-[140px]">تاريخ الاعتراف</th>
                                    <th className="p-4 text-center border-r border-[#DFC48F]" colSpan="2">مشارك بالأنشطة</th>
                                    <th className="p-4 min-w-[200px]">المهام / الملاحظات</th>
                                    <th className="p-4 min-w-[200px]">ملاحظات أمين الخدمة</th>
                                </tr>
                                <tr className="bg-[#F6ECDA]/70 text-[11px] text-[#6E5329] border-b border-[#DFC48F]">
                                    <th colSpan="9"></th>
                                    <th className="p-2 text-center border-r border-[#DFC48F] min-w-[100px]">الخدمة</th>
                                    <th className="p-2 text-center border-l border-[#DFC48F] min-w-[140px]">الإيبارشية</th>
                                    <th></th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#EFE0C2]">
                                {filteredServants.map(s => (
                                    <tr key={s.id} className="hover:bg-[#FAF3E3]/50 transition-colors">
                                        <td className="p-2 text-center border-l border-[#EFE0C2]">
                                            <button
                                                type="button"
                                                onClick={() => setSelectedServantForProfile(s)}
                                                className="cursor-pointer hover:opacity-80 transition-opacity mx-auto block group"
                                                title="عرض وتعديل بروفايل الخادم"
                                            >
                                                {s.profileImage ? (
                                                    <img
                                                        src={s.profileImage}
                                                        alt={s.name}
                                                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                        className="w-10 h-10 rounded-full mx-auto object-cover border-2 border-[#DFC48F]"
                                                    />
                                                ) : (
                                                    <div className="w-10 h-10 rounded-full mx-auto bg-[#FAF3E3] border border-[#DFC48F] flex items-center justify-center text-[#1B2A59] font-black">
                                                        <span className="text-xs">{s.name.substring(0, 2)}</span>
                                                    </div>
                                                )}
                                            </button>
                                        </td>
                                        <td className="p-4 font-black text-[#1B2A59]">
                                            <div className="flex items-center justify-between gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedServantForProfile(s)}
                                                    className="text-right hover:text-[#8C621E] hover:underline cursor-pointer flex items-center gap-1.5 group"
                                                    title="عرض بروفايل الخادم"
                                                >
                                                    <span>{s.name}</span>
                                                    <Eye size={14} className="opacity-0 group-hover:opacity-100 text-[#8C621E] transition-opacity" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingServant(s)}
                                                    className="text-[#8C621E] hover:text-[#1B2A59] p-1.5 rounded-lg bg-[#FAF3E3] hover:bg-amber-100 border border-[#DFC48F] transition-colors shrink-0 cursor-pointer"
                                                    title="تعديل بيانات الخادم"
                                                >
                                                    <Edit3 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className="bg-indigo-50 text-[#1B2A59] border border-indigo-200 px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap">
                                                {getOsraName(s.osraName)}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <select
                                                value={s.attendance || ''}
                                                onChange={e => handleUpdate(s.id, 'attendance', e.target.value)}
                                                className={`w-full p-2 rounded-lg text-xs font-black text-center outline-none border transition-colors cursor-pointer ${
                                                    s.attendance === 'حضور'
                                                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                                        : s.attendance === 'غياب'
                                                            ? 'bg-rose-50 text-rose-800 border-rose-300'
                                                            : s.attendance === 'اعتذار'
                                                                ? 'bg-amber-50 text-amber-800 border-amber-300'
                                                                : 'coptic-cream-input text-[#6E5329]'
                                                }`}
                                            >
                                                <option value="">-- لم يُسجل --</option>
                                                <option value="حضور">حاضر</option>
                                                <option value="اعتذار">معتذر</option>
                                                <option value="غياب">غائب</option>
                                            </select>
                                            {s.attendance === 'اعتذار' && (
                                                <input
                                                    type="text"
                                                    placeholder="سبب الاعتذار (اختياري)..."
                                                    value={s.excuseNote || ''}
                                                    onChange={e => handleUpdate(s.id, 'excuseNote', e.target.value)}
                                                    className="coptic-cream-input mt-1.5 w-full rounded-lg p-1.5 text-[11px] font-bold text-[#1B2A59] outline-none"
                                                />
                                            )}
                                        </td>
                                        <td className="p-4 text-center">
                                            <input type="checkbox" disabled={s.attendance !== 'حضور'} checked={s.liturgy} onChange={e => handleUpdate(s.id, 'liturgy', e.target.checked)} className="w-5 h-5 accent-emerald-700 cursor-pointer disabled:opacity-30" />
                                        </td>
                                        <td className="p-4 text-center">
                                            <input type="checkbox" disabled={s.attendance !== 'حضور'} checked={s.preparation} onChange={e => handleUpdate(s.id, 'preparation', e.target.checked)} className="w-5 h-5 accent-emerald-700 cursor-pointer disabled:opacity-30" />
                                        </td>
                                        <td className="p-4 text-center">
                                            <input type="checkbox" disabled={s.attendance !== 'حضور'} checked={s.meeting} onChange={e => handleUpdate(s.id, 'meeting', e.target.checked)} className="w-5 h-5 accent-emerald-700 cursor-pointer disabled:opacity-30" />
                                        </td>
                                        <td className="p-4 text-center">
                                            <input type="checkbox" disabled={s.attendance !== 'حضور'} checked={s.visitation} onChange={e => handleUpdate(s.id, 'visitation', e.target.checked)} className="w-5 h-5 accent-emerald-700 cursor-pointer disabled:opacity-30" />
                                        </td>
                                        <td className="p-4 text-center">
                                            <input type="date" value={s.confessionDate || ''} onChange={e => handleUpdate(s.id, 'confessionDate', e.target.value)} className="coptic-cream-input rounded-lg p-2 text-xs font-bold w-full outline-none text-[#1B2A59]" />
                                        </td>
                                        <td className="p-4 text-center border-r border-[#EFE0C2] bg-[#FAF3E3]/30">
                                            <input type="checkbox" checked={s.activitiesService} onChange={e => handleUpdate(s.id, 'activitiesService', e.target.checked)} className="w-5 h-5 accent-[#1B2A59] cursor-pointer" />
                                        </td>
                                        <td className="p-4 text-center border-l border-[#EFE0C2] bg-[#FAF3E3]/30">
                                            <textarea value={s.activitiesDiocese || ''} onChange={e => handleUpdate(s.id, 'activitiesDiocese', e.target.value)} placeholder="نشاط إيبارشية..." className="coptic-cream-input resize-y min-h-[60px] min-w-[120px] p-2 w-full rounded text-xs text-[#1B2A59] outline-none" />
                                        </td>
                                        <td className="p-4">
                                            <textarea value={s.tasks || ''} onChange={e => handleUpdate(s.id, 'tasks', e.target.value)} placeholder="ملاحظات الخادم..." className="coptic-cream-input resize-y min-h-[60px] min-w-[120px] p-2 w-full rounded text-xs text-[#1B2A59] outline-none" />
                                        </td>
                                        <td className="p-4">
                                            <textarea value={s.leaderNotes || ''} onChange={e => handleUpdate(s.id, 'leaderNotes', e.target.value)} placeholder="ملاحظات أمين الخدمة..." className="coptic-cream-input resize-y min-h-[60px] min-w-[120px] p-2 w-full rounded text-xs text-[#1B2A59] outline-none" />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {filteredServants.length === 0 && (
                            <div className="text-center py-8 text-[#6E5329] font-bold">لا توجد بيانات خدام لعرضها.</div>
                        )}
                    </div>

                    {/* Mobile View Cards */}
                    <div className="md:hidden space-y-4 mt-4">
                        {filteredServants.map(s => (
                            <div key={s.id} className="bg-[#FAF3E3]/70 border border-[#DFC48F] p-4 rounded-2xl shadow-sm">
                                <div className="flex justify-between items-center mb-4 border-b border-[#DFC48F] pb-3 gap-2">
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setSelectedServantForProfile(s)}
                                            className="font-black text-[#1B2A59] text-base hover:underline text-right flex items-center gap-1.5 cursor-pointer"
                                            title="عرض بروفايل الخادم"
                                        >
                                            <span>{s.name}</span>
                                            <Eye size={15} className="text-[#8C621E]" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setEditingServant(s)}
                                            className="text-[#8C621E] hover:text-[#1B2A59] p-1 rounded-lg bg-white border border-[#DFC48F] transition-colors cursor-pointer"
                                            title="تعديل بيانات الخادم"
                                        >
                                            <Edit3 size={13} />
                                        </button>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <select
                                            value={s.attendance || ''}
                                            onChange={e => handleUpdate(s.id, 'attendance', e.target.value)}
                                            className={`p-1.5 rounded-lg text-xs font-black text-center outline-none border transition-colors cursor-pointer ${
                                                s.attendance === 'حضور'
                                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                                    : s.attendance === 'غياب'
                                                        ? 'bg-rose-50 text-rose-800 border-rose-300'
                                                        : s.attendance === 'اعتذار'
                                                            ? 'bg-amber-50 text-amber-800 border-amber-300'
                                                            : 'bg-white text-[#6E5329] border-[#DFC48F]'
                                            }`}
                                        >
                                            <option value="">-- لم يُسجل --</option>
                                            <option value="حضور">حاضر</option>
                                            <option value="اعتذار">معتذر</option>
                                            <option value="غياب">غائب</option>
                                        </select>
                                        {s.attendance === 'اعتذار' && (
                                            <input
                                                type="text"
                                                placeholder="سبب الاعتذار..."
                                                value={s.excuseNote || ''}
                                                onChange={e => handleUpdate(s.id, 'excuseNote', e.target.value)}
                                                className="coptic-cream-input w-full rounded-lg p-1 text-[10px] font-bold outline-none"
                                            />
                                        )}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3 mb-4 text-sm text-[#1B2A59] font-bold">
                                    <label className={`flex items-center gap-2 justify-between p-2 rounded-lg border border-[#DFC48F] ${s.attendance === 'حضور' ? 'bg-white' : 'bg-[#FAF3E3] opacity-50'}`}>
                                        <span>قداس</span>
                                        <input type="checkbox" disabled={s.attendance !== 'حضور'} checked={s.liturgy} onChange={e => handleUpdate(s.id, 'liturgy', e.target.checked)} className="w-5 h-5 accent-emerald-700" />
                                    </label>
                                    <label className={`flex items-center gap-2 justify-between p-2 rounded-lg border border-[#DFC48F] ${s.attendance === 'حضور' ? 'bg-white' : 'bg-[#FAF3E3] opacity-50'}`}>
                                        <span>التحضير</span>
                                        <input type="checkbox" disabled={s.attendance !== 'حضور'} checked={s.preparation} onChange={e => handleUpdate(s.id, 'preparation', e.target.checked)} className="w-5 h-5 accent-emerald-700" />
                                    </label>
                                    <label className={`flex items-center gap-2 justify-between p-2 rounded-lg border border-[#DFC48F] ${s.attendance === 'حضور' ? 'bg-white' : 'bg-[#FAF3E3] opacity-50'}`}>
                                        <span>الاجتماع</span>
                                        <input type="checkbox" disabled={s.attendance !== 'حضور'} checked={s.meeting} onChange={e => handleUpdate(s.id, 'meeting', e.target.checked)} className="w-5 h-5 accent-emerald-700" />
                                    </label>
                                    <label className={`flex items-center gap-2 justify-between p-2 rounded-lg border border-[#DFC48F] ${s.attendance === 'حضور' ? 'bg-white' : 'bg-[#FAF3E3] opacity-50'}`}>
                                        <span>الافتقاد</span>
                                        <input type="checkbox" disabled={s.attendance !== 'حضور'} checked={s.visitation} onChange={e => handleUpdate(s.id, 'visitation', e.target.checked)} className="w-5 h-5 accent-emerald-700" />
                                    </label>
                                </div>
                                <div className="mb-4">
                                    <label className="block text-xs font-black text-[#6E5329] mb-1">تاريخ الاعتراف</label>
                                    <input type="date" value={s.confessionDate || ''} onChange={e => handleUpdate(s.id, 'confessionDate', e.target.value)} className="coptic-cream-input w-full rounded-lg p-2 text-sm outline-none" />
                                </div>
                                <div className="mb-4 bg-white p-3 rounded-xl border border-[#DFC48F]">
                                    <label className="block text-xs font-black text-[#6E5329] mb-2 border-b border-[#EFE0C2] pb-1">مشارك بالأنشطة</label>
                                    <div className="flex flex-col gap-3 mt-2">
                                        <label className="flex items-center gap-2 text-sm text-[#1B2A59] font-bold">
                                            <input type="checkbox" checked={s.activitiesService} onChange={e => handleUpdate(s.id, 'activitiesService', e.target.checked)} className="w-5 h-5 accent-[#1B2A59]" /> الخدمة
                                        </label>
                                        <textarea value={s.activitiesDiocese || ''} onChange={e => handleUpdate(s.id, 'activitiesDiocese', e.target.value)} placeholder="نشاط الإيبارشية..." className="coptic-cream-input resize-y min-h-[60px] p-2 w-full rounded text-sm outline-none" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-black text-[#6E5329] mb-1">المهام / ملاحظات الخادم</label>
                                    <textarea value={s.tasks || ''} onChange={e => handleUpdate(s.id, 'tasks', e.target.value)} placeholder="اكتب ملاحظة..." className="coptic-cream-input resize-y min-h-[60px] p-2 w-full rounded text-sm outline-none mb-3" />
                                </div>
                                <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
                                    <label className="block text-xs text-[#8C621E] font-black mb-1">ملاحظات أمين الخدمة</label>
                                    <textarea value={s.leaderNotes || ''} onChange={e => handleUpdate(s.id, 'leaderNotes', e.target.value)} placeholder="ملاحظات أمين الأسرة..." className="coptic-cream-input resize-y min-h-[60px] p-2 w-full rounded text-sm outline-none" />
                                </div>
                            </div>
                        ))}
                    </div>

                </div>

                {/* Comprehensive Weekly Attendance & Activity Statistics */}
                <div className="mt-8 coptic-card p-6 md:p-8 rounded-3xl sm:rounded-[2.25rem] shadow-lg border border-[#DFC48F] relative overflow-hidden">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 pb-5 border-b border-[#DFC48F]">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-[#1B2A59] text-amber-300 rounded-2xl flex items-center justify-center shadow-md">
                                <BarChart3 size={24} />
                            </div>
                            <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h2 className="font-calligraphic text-xl font-bold text-[#1B2A59]">إحصائيات الحضور والأنشطة الأسبوعية</h2>
                                    <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-black px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                        <Sparkles size={11} /> تقرير موثق بدقة
                                    </span>
                                </div>
                                <p className="text-xs font-bold text-[#6E5329] mt-0.5 flex items-center gap-1.5">
                                    <Calendar size={13} className="text-[#C8942E]" />
                                    نطاق الأسبوع: <span className="text-[#1B2A59] font-black">{weekLabel}</span>
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                            <div className="bg-[#FAF3E3] px-3.5 py-2 rounded-xl border border-[#DFC48F] text-[#6E5329]">
                                إجمالي الخدام: <span className="text-[#1B2A59] font-black">{totalServantCount}</span>
                            </div>
                            <div className="bg-[#FAF3E3] px-3.5 py-2 rounded-xl border border-[#DFC48F] text-[#6E5329]">
                                أيام مسجلة: <span className="text-[#8C621E] font-black">{weeklyStats.daysWithData}</span>
                            </div>
                            <div className="bg-[#FAF3E3] px-3.5 py-2 rounded-xl border border-[#DFC48F] text-[#6E5329]">
                                الخدام المسجلون: <span className="text-[#1B2A59] font-black">{weeklyStats.recordedUniqueTotal}</span> / {totalServantCount}
                            </div>
                        </div>
                    </div>

                    {/* Row 1: Strict Status Breakdown Counters */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 mb-6">
                        <div className="bg-emerald-50/70 border border-emerald-200 rounded-3xl p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-black px-2.5 py-1 rounded-full flex items-center gap-1">
                                    <CheckCircle2 size={13} /> حاضر
                                </span>
                                <CheckCircle2 size={16} className="text-emerald-700" />
                            </div>
                            <div className="text-3xl font-black text-emerald-800 tabular-nums">{weeklyStats.uniquePresentCount}</div>
                            <div className="text-xs font-black text-[#1B2A59] mt-1">إجمالي الحاضرين</div>
                            <div className="mt-2 text-[10px] font-bold text-emerald-700">
                                {weeklyStats.uniquePresentCount} من {totalServantCount} خادم
                            </div>
                        </div>

                        <div className="bg-amber-50/70 border border-amber-200 rounded-3xl p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-black px-2.5 py-1 rounded-full flex items-center gap-1">
                                    <UserMinus size={13} /> معتذر
                                </span>
                                <UserMinus size={16} className="text-amber-700" />
                            </div>
                            <div className="text-3xl font-black text-amber-800 tabular-nums">{weeklyStats.uniqueExcusedCount}</div>
                            <div className="text-xs font-black text-[#1B2A59] mt-1">إجمالي المعتذرين</div>
                            <div className="mt-2 text-[10px] font-bold text-amber-700">اعتذار مسبق موثق</div>
                        </div>

                        <div className="bg-rose-50/70 border border-rose-200 rounded-3xl p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="bg-rose-100 text-rose-800 border border-rose-200 text-[11px] font-black px-2.5 py-1 rounded-full flex items-center gap-1">
                                    <UserX size={13} /> غائب
                                </span>
                                <UserX size={16} className="text-rose-700" />
                            </div>
                            <div className="text-3xl font-black text-rose-800 tabular-nums">{weeklyStats.uniqueAbsentCount}</div>
                            <div className="text-xs font-black text-[#1B2A59] mt-1">إجمالي الغائبين</div>
                            <div className="mt-2 text-[10px] font-bold text-rose-700">غياب صريح</div>
                        </div>

                        <div className="bg-[#FAF3E3] border border-[#DFC48F] rounded-3xl p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="bg-white text-[#6E5329] border border-[#DFC48F] text-[11px] font-black px-2.5 py-1 rounded-full flex items-center gap-1">
                                    <HelpCircle size={13} /> لم يُسجل
                                </span>
                                <HelpCircle size={16} className="text-[#8C621E]" />
                            </div>
                            <div className="text-3xl font-black text-[#1B2A59] tabular-nums">{weeklyStats.unrecordedCount}</div>
                            <div className="text-xs font-black text-[#1B2A59] mt-1">بدون تسجيل أسبوعي</div>
                            <div className="mt-2 text-[10px] font-bold text-[#6E5329]">بانتظار التسجيل</div>
                        </div>

                        <div className="bg-indigo-50/80 border border-indigo-200 rounded-3xl p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className={`text-[11px] font-black px-2.5 py-1 rounded-full flex items-center gap-1 border ${
                                    weeklyStats.rate >= 75
                                        ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                        : weeklyStats.rate >= 50
                                            ? 'bg-amber-100 text-amber-800 border-amber-200'
                                            : 'bg-rose-100 text-rose-800 border-rose-200'
                                }`}>
                                    <TrendingUp size={13} />
                                    {weeklyStats.rate >= 75 ? 'ممتاز' : weeklyStats.rate >= 50 ? 'متوسط' : 'متابعة'}
                                </span>
                                <BarChart3 size={16} className="text-[#1B2A59]" />
                            </div>
                            <div className="text-3xl font-black text-[#1B2A59] tabular-nums">{weeklyStats.rate}%</div>
                            <div className="text-xs font-black text-[#1B2A59] mt-1">نسبة الحضور الأسبوعية</div>
                            <div className="mt-2 h-2 w-full bg-[#EFE0C2] rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-[#1B2A59] transition-all duration-700" style={{ width: `${weeklyStats.rate}%` }}></div>
                            </div>
                        </div>
                    </div>

                    {/* Row 2: Servant Activities & Meetings Counters */}
                    <div className="bg-[#FAF3E3] border border-[#DFC48F] rounded-3xl p-5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 border-b border-[#DFC48F] pb-3">
                            <div className="flex items-center gap-2">
                                <Award size={18} className="text-[#C8942E]" />
                                <h3 className="text-sm font-black text-[#1B2A59]">
                                    مشاركة الخدام في الاجتماعات والأنشطة الأسبوعية
                                </h3>
                            </div>
                            <span className="bg-[#1B2A59] text-amber-100 text-xs font-black px-3 py-1 rounded-xl w-fit">
                                {weeklyStats.totalActivityEngagements} مشاركة · {weeklyStats.uniqueActivityServantsCount} خادم
                            </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                            <div className="bg-white border border-[#DFC48F] rounded-2xl p-4 text-center">
                                <div className="w-9 h-9 mx-auto bg-emerald-100 rounded-xl flex items-center justify-center mb-2">
                                    <Users size={18} className="text-emerald-700" />
                                </div>
                                <span className="text-2xl font-black text-[#1B2A59] block tabular-nums">{weeklyStats.meetingCount}</span>
                                <div className="text-xs font-black text-[#1B2A59] mt-1">اجتماع الخدمة</div>
                                <p className="text-[10px] font-bold text-[#6E5329] mt-0.5">حضور الاجتماع الأسبوعي</p>
                            </div>

                            <div className="bg-white border border-[#DFC48F] rounded-2xl p-4 text-center">
                                <div className="w-9 h-9 mx-auto bg-sky-100 rounded-xl flex items-center justify-center mb-2">
                                    <Eye size={18} className="text-sky-700" />
                                </div>
                                <span className="text-2xl font-black text-[#1B2A59] block tabular-nums">{weeklyStats.visitationCount}</span>
                                <div className="text-xs font-black text-[#1B2A59] mt-1">مشارك بالافتقاد</div>
                                <p className="text-[10px] font-bold text-[#6E5329] mt-0.5">افتقاد أولاد وأسر الأسرة</p>
                            </div>

                            <div className="bg-white border border-[#DFC48F] rounded-2xl p-4 text-center">
                                <div className="w-9 h-9 mx-auto bg-indigo-100 rounded-xl flex items-center justify-center mb-2">
                                    <Church size={18} className="text-[#1B2A59]" />
                                </div>
                                <span className="text-2xl font-black text-[#1B2A59] block tabular-nums">{weeklyStats.liturgyCount}</span>
                                <div className="text-xs font-black text-[#1B2A59] mt-1">القداس الإلهي</div>
                                <p className="text-[10px] font-bold text-[#6E5329] mt-0.5">حضور الذبيحة والمناولة</p>
                            </div>

                            <div className="bg-white border border-[#DFC48F] rounded-2xl p-4 text-center">
                                <div className="w-9 h-9 mx-auto bg-amber-100 rounded-xl flex items-center justify-center mb-2">
                                    <BookOpen size={18} className="text-[#8C621E]" />
                                </div>
                                <span className="text-2xl font-black text-[#1B2A59] block tabular-nums">{weeklyStats.preparationCount}</span>
                                <div className="text-xs font-black text-[#1B2A59] mt-1">التحضير الأسبوعي</div>
                                <p className="text-[10px] font-bold text-[#6E5329] mt-0.5">تحضير الدروس والأنشطة</p>
                            </div>

                            <div className="bg-white border border-[#DFC48F] rounded-2xl p-4 text-center col-span-2 sm:col-span-1">
                                <div className="w-9 h-9 mx-auto bg-rose-100 rounded-xl flex items-center justify-center mb-2">
                                    <HandHelping size={18} className="text-rose-700" />
                                </div>
                                <span className="text-2xl font-black text-[#1B2A59] block tabular-nums">
                                    {weeklyStats.activitiesServiceCount + weeklyStats.activitiesDioceseCount}
                                </span>
                                <div className="text-xs font-black text-[#1B2A59] mt-1">أنشطة الخدمة والإيبارشية</div>
                                <p className="text-[10px] font-bold text-[#6E5329] mt-0.5">
                                    {weeklyStats.activitiesServiceCount} خدمة · {weeklyStats.activitiesDioceseCount} إيبارشية
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

            </main>

            {selectedServantForProfile && (
                <ServantProfile
                    servantData={selectedServantForProfile}
                    servant={selectedServantForProfile}
                    isOpen={true}
                    onClose={() => setSelectedServantForProfile(null)}
                    isModal={true}
                />
            )}

            {editingServant && (
                <EditServantModal
                    isOpen={!!editingServant}
                    servant={editingServant}
                    onClose={() => setEditingServant(null)}
                    onSaved={(updated) => {
                        setServantsData(prev => prev.map(item => (item.id === updated.id || (item.phone && item.phone === updated.phone)) ? { ...item, ...updated } : item));
                        setEditingServant(null);
                    }}
                />
            )}
        </div>
    );
}
