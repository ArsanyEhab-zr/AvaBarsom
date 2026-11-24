import { persistVisitationLogAndSync } from '../utils/attendanceSessionHelper';
import { getLocalDateString } from '../utils/serviceWeek';
import { useChurchDataEngine } from '../hooks/useChurchDataEngine';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
import React, { useState } from 'react';
import { db } from '../db/database';
import { Link } from 'react-router-dom';
import { Search, MapPin, ClipboardList, Navigation, MessageCircleWarning, CheckCircle2, Map, Crosshair, MapPinned, Loader2, AlertTriangle, Mic, User } from 'lucide-react';
import BottomNav from '../components/BottomNav';
import useAutoSync from '../hooks/useAutoSync';
import { logActivity } from '../utils/activityLogger';
import LogVisitationModal from '../components/LogVisitationModal';
import { getVisitationInfo, formatLastVisitedDate } from '../utils/visitationTypes';

export default function Visitation() {
    const { triggerAutoSync } = useAutoSync();
    const [activeFilter, setActiveFilter] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");

    // حالة المخدوم المحدد
    const [selectedChildId, setSelectedChildId] = useState(null);
    const [visitingChild, setVisitingChild] = useState(null);
    const [isLocating, setIsLocating] = useState(false);

    const today = getLocalDateString();

    // عزل البيانات حسب الهرم الكنسي (4 مستويات)
    const accessScope = resolveUserAccessScope(null, [], { includeFallback: true });
    const isMaster = accessScope.canSwitchClasses;
    const { activeChildren, validatedAttendance } = useChurchDataEngine(accessScope.allowedSyncKeys || []);
    const children = activeChildren.filter(c => !searchQuery || c.name?.toLowerCase().includes(searchQuery.toLowerCase()));


    const filteredChildren = children?.filter((c) => {
        if (activeFilter === "boys" && c.gender === "بنت") return false;
        if (activeFilter === "girls" && c.gender !== "بنت") return false;
        return true;
    }) || [];

    const groupedByZone = filteredChildren.reduce((acc, child) => {
        const zone = child.address && child.address.trim() !== "" ? child.address : 'مناطق غير محددة';
        if (!acc[zone]) acc[zone] = [];
        acc[zone].push(child);
        return acc;
    }, {});

    // وظائف الافتقاد وتحديد رقم الواتساب الذكي
    const cleanPhoneNumber = (phone) => {
        let clean = String(phone || "").replace(/\D/g, '');
        if (clean.startsWith('0')) clean = '2' + clean;
        else if (!clean.startsWith('20') && clean.length > 0) clean = '20' + clean;
        return clean;
    };

    const getTargetPhone = (child) => {
        if (child.whatsappTarget === 'child' && child.childPhone) return child.childPhone;
        if (child.whatsappTarget === 'father' && child.fatherPhone) return child.fatherPhone;
        if (child.whatsappTarget === 'mother' && child.motherPhone) return child.motherPhone;
        return child.childPhone || child.fatherPhone || child.motherPhone || child.phone;
    };

    const getDisplayPhone = (c) => {
        if (c.whatsappTarget === 'child' && c.childPhone) return `المخدوم: ${c.childPhone}`;
        if (c.whatsappTarget === 'father' && c.fatherPhone) return `الأب: ${c.fatherPhone}`;
        if (c.whatsappTarget === 'mother' && c.motherPhone) return `الأم: ${c.motherPhone}`;
        
        if (c.childPhone) return `المخدوم: ${c.childPhone}`;
        if (c.fatherPhone) return `الأب: ${c.fatherPhone}`;
        if (c.motherPhone) return `الأم: ${c.motherPhone}`;
        if (c.phone) return c.phone;
        return 'لا يوجد تليفون';
    };

    const markAsVisited = async (child) => {
        try {
            const nowTs = Date.now();
            await persistVisitationLogAndSync({
                child,
                date: today,
                visitationType: 'home_visit',
                visitationLabel: 'افتقاد سريع',
                syncKey: child.syncKey || accessScope.activeSyncKey || ''
            });
            await db.children.update(child.id, {
                last_visited: nowTs,
                lastVisitationType: 'home_visit',
                lastVisitationLabel: 'افتقاد سريع',
                isDirty: true,
                updatedAt: nowTs
            });
            triggerAutoSync();
            logActivity('SAVE_NOTE', `تسجيل افتقاد للمخدوم: ${child.name || child.id} بتاريخ ${today}`);
            alert("تم الافتقاد بنجاح!");
            setSelectedChildId(null);
        } catch (error) {
            console.error("Error marking as visited:", error);
        }
    };

    const handleSaveGPS = (child) => {
        if (!navigator.geolocation) return alert("متصفحك لا يدعم تحديد الموقع!");
        setIsLocating(true);
        navigator.geolocation.getCurrentPosition(async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lon}`;
            const now = new Date().toISOString();
            await db.children.update(child.id, { gpsLink: googleMapsUrl, isDirty: true, updatedAt: now });
            triggerAutoSync();
            setIsLocating(false);
            logActivity('UPDATE_CHILD', `حفظ موقع GPS للمخدوم: ${child.name || child.id}`);
            alert("تم حفظ اللوكيشن بنجاح!");
        }, () => {
            setIsLocating(false);
            alert("شغل الـ GPS في موبايلك وادي صلاحية للمتصفح.");
        }, { enableHighAccuracy: true });
    };

    const generateVisitationMsg = (child) => {
        const title = child.gender === 'بنت' ? 'مخدومتنا الجميلة' : 'مخدومنا الغالي';
        const namePart = child.name ? child.name.split(' ')[0] : '';
        let msg = `أزيك يا ${title} ${namePart ? `(${namePart})` : ''}!\nعامل إيه؟ افتقدناك جداً وحابين نطمن عليك..`;
        return `https://api.whatsapp.com/send?phone=${cleanPhoneNumber(getTargetPhone(child))}&text=${encodeURIComponent(msg)}`;
    };

    const generateOnMyWayMsg = (child) => {
        const namePart = child.name ? child.name.split(' ')[0] : '';
        let msg = `أزيك يا ${namePart ? `(${namePart})` : 'مخدوم'}!\nأنا في طريقي ليك دلوقتي عشان أسلم عليك، جاهز؟`;
        return `https://api.whatsapp.com/send?phone=${cleanPhoneNumber(getTargetPhone(child))}&text=${encodeURIComponent(msg)}`;
    };

    return (
        <div className="min-h-screen coptic-cream-surface pb-32 font-sans" dir="rtl">
            <header className="bg-gradient-to-b from-[#FAF4E8]/95 to-[#F6EDDB]/95 backdrop-blur-md p-4 shadow-sm mb-6 rounded-b-[2.5rem] relative z-10 border-b border-[#E5D7BF]">
                <div className="max-w-4xl mx-auto">
                    <div className="relative mb-4">
                        <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C7D68]" />
                        <input type="text" placeholder="ابحث عن مخدوم على الخريطة..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pr-10 pl-4 py-3 rounded-full coptic-cream-input text-sm font-bold text-[#1B2A59]" />
                    </div>
                    <div className="flex gap-2 justify-center">
                        {[{ id: "all", label: "الكل" }, { id: "boys", label: "ولاد" }, { id: "girls", label: "بنات" }].map(f => (
                            <button key={f.id} onClick={() => setActiveFilter(f.id)} className={`flex-1 px-4 py-2.5 rounded-full text-xs font-black transition-all cursor-pointer ${activeFilter === f.id ? "bg-[#1B2A59] text-[#F4D078] shadow-md" : "bg-[#FFFDF7] border border-[#E3D6BF] text-[#5E5242]"}`}>{f.label}</button>
                        ))}
                    </div>
                </div>
            </header>

            <main className="px-4 max-w-2xl mx-auto relative z-10">
                <div className="bg-gradient-to-l from-[#141F45] via-[#1B2A59] to-[#243875] text-white p-5 rounded-[2.5rem] mb-8 flex items-center gap-4 shadow-xl border border-[#C8942E]/40">
                    <div className="w-14 h-14 bg-[#C8942E]/20 border border-[#C8942E]/40 text-[#F4D078] rounded-full flex items-center justify-center backdrop-blur-sm shrink-0"><MapPinned size={28} /></div>
                    <div>
                        <h1 className="font-black text-xl text-[#F4D078]">خريطة الافتقاد التفاعلية {isMaster ? '(الكل)' : ''}</h1>
                        <p className="text-xs font-medium text-[#FBF6EB]/85 mt-1">اضغط على المخدوم لتسجيل الزيارة أو تحديد موقعه</p>
                    </div>
                </div>

                <div className="space-y-10 pl-2">
                    {Object.entries(groupedByZone).map(([zone, zoneChildren], i) => (
                        <div key={i} className="relative border-r-4 border-dashed border-[#D7C4A1] pr-6 pb-4">
                            <div className="absolute -right-3.5 top-0 w-6 h-6 bg-[#FAF4E8] border-4 border-[#C8942E] rounded-full shadow-md"></div>

                            <h3 className="coptic-card px-5 py-2.5 rounded-2xl font-black text-[#1B2A59] text-sm flex w-fit gap-2 mb-5 -mt-2">
                                <MapPin size={18} className="text-[#C8942E]" /> {zone}
                                <span className="bg-[#F5EBD6] text-[#1B2A59] border border-[#DFC99B] px-2 rounded-lg text-[10px] flex items-center">{zoneChildren.length}</span>
                            </h3>

                            <div className="flex flex-wrap gap-4 mb-4 items-start">
                                {zoneChildren.map(child => {
                                    const childStats = validatedAttendance?.byChild?.[String(child.id).trim()];
                                    const isDanger = (childStats?.serviceAbsentCount || 0) >= 2 && (childStats?.servicePresentCount || 0) === 0;
                                    const isSelected = selectedChildId === child.id;
                                    const childLastVisitStr = formatLastVisitedDate(child.last_visited);
                                    const isVisitedRecently = childLastVisitStr === today;
                                    const lastVisitInfo = child.lastVisitationType ? getVisitationInfo(child.lastVisitationType) : null;
                                    const latestNote = child.notes ? child.notes[child.notes.length - 1] : null;

                                    return (
                                        <React.Fragment key={child.id}>
                                            {/* الفقاعة (الدبوس) */}
                                            <div className="relative flex flex-col items-center">
                                                <button
                                                    onClick={() => setSelectedChildId(isSelected ? null : child.id)}
                                                    className={`group flex flex-col items-center transition-all duration-300 cursor-pointer ${isSelected ? '-translate-y-2 scale-110' : 'hover:-translate-y-1'}`}
                                                >
                                                    {isDanger && <span className="absolute -top-1 -right-1 flex h-4 w-4 z-10"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span><span className="relative inline-flex rounded-full h-4 w-4 bg-rose-500 border-2 border-white"></span></span>}
                                                    {isVisitedRecently && (
                                                        <span className="absolute -top-1 -left-1 z-10 bg-emerald-500 text-white rounded-full p-0.5 shadow-sm" title="تم الافتقاد اليوم">
                                                            <CheckCircle2 size={12} />
                                                        </span>
                                                    )}

                                                    <div className={`w-14 h-14 rounded-full border-4 ${isSelected ? 'border-[#1B2A59] shadow-xl' : (isVisitedRecently ? 'border-emerald-400 opacity-85' : 'border-[#FFFDF7] shadow-md')} overflow-hidden bg-[#F5EBD6] text-[#1B2A59] flex items-center justify-center text-xl`}>
                                                        {child.profilePic ? (
                                                            <img 
                                                                src={child.profilePic} 
                                                                width="56" 
                                                                height="56" 
                                                                loading="lazy" 
                                                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                                className="w-full h-full object-cover" 
                                                                alt={child.name} 
                                                            />
                                                        ) : <User size={22} />}
                                                    </div>
                                                    <div className={`w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-8 ${isSelected ? 'border-t-[#1B2A59]' : (isVisitedRecently ? 'border-t-emerald-400 opacity-85' : 'border-t-[#FFFDF7]')}`}></div>

                                                    <span className={`text-[10px] font-black mt-1 px-2.5 py-0.5 rounded-full shadow-sm transition-colors max-w-[100px] truncate text-center ${isSelected ? 'bg-[#1B2A59] text-[#F4D078]' : 'bg-[#FFFDF7] border border-[#E5D7BF] text-[#1B2A59] group-hover:bg-[#FAF4E8]'}`} title={child.name}>
                                                        {child.name ? child.name.trim().split(/\s+/).slice(0, 2).join(' ') : 'مخدوم'}
                                                    </span>
                                                </button>
                                            </div>

                                            {/* كارت التفاصيل */}
                                            {isSelected && (
                                                <div className="w-full basis-full mt-1 mb-2 animate-in slide-in-from-top-2 duration-300">
                                                    <div className="coptic-card rounded-4xl p-5 border-2 border-[#C8942E]/40 relative overflow-hidden">
                                                        <div className="absolute top-0 right-0 w-full h-1.5 bg-[#1B2A59]"></div>

                                                        <div className="flex justify-between items-start mb-3">
                                                            <div>
                                                                <h4 className="font-black text-lg text-[#1B2A59]">{child.name}</h4>
                                                                <p className="text-xs font-bold text-[#6E604F] mt-0.5 flex items-center gap-1">
                                                                    رقم الواتس: <span dir="ltr">{getDisplayPhone(child)}</span>
                                                                </p>
                                                            </div>
                                                            {isDanger && <span className="text-[10px] text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg font-black border border-rose-200 animate-pulse flex items-center gap-1"><AlertTriangle size={12} /> يحتاج افتقاد (غياب متكرر)</span>}
                                                        </div>

                                                        {/* شارة تفصيلية لآخر افتقاد ونوعه */}
                                                        {childLastVisitStr ? (
                                                            <div className="bg-[#FAF4E8] p-3 rounded-2xl mb-3 border border-[#E5D7BF] flex items-center justify-between gap-2">
                                                                <div className="text-right">
                                                                    <span className="text-[10px] font-black text-[#8C7D68] block">آخر افتقاد مسجل</span>
                                                                    <span className="text-xs font-black text-[#1B2A59]">{childLastVisitStr}</span>
                                                                </div>
                                                                <span className={`text-[11px] font-black px-3 py-1 rounded-xl border flex items-center gap-1 shadow-xs ${lastVisitInfo ? lastVisitInfo.badgeClass : 'bg-[#F5EBD6] text-[#1B2A59] border-[#DFC99B]'}`}>
                                                                    {child.lastVisitationLabel || (lastVisitInfo ? lastVisitInfo.label : 'افتقاد عام')}
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <div className="bg-[#FAF4E8] p-2.5 rounded-2xl mb-3 border border-dashed border-[#DFC99B] text-center">
                                                                <span className="text-[11px] font-bold text-[#8C7D68]">لم يتم تسجيل أي افتقاد له مسبقاً</span>
                                                            </div>
                                                        )}

                                                        {/* زرار الـ GPS */}
                                                        <div className="bg-[#FAF4E8] p-3 rounded-2xl mb-4 border border-[#E5D7BF] flex flex-wrap items-center justify-between gap-2">
                                                            <div>
                                                                <span className="text-[10px] font-black text-[#6E604F] block">الموقع (GPS)</span>
                                                                {child.gpsLink ? (
                                                                    <span className="text-xs font-bold text-emerald-700 flex items-center gap-1 mt-0.5"><CheckCircle2 size={12} /> اللوكيشن محفوظ</span>
                                                                ) : (
                                                                    <span className="text-xs font-bold text-amber-700 flex items-center gap-1 mt-0.5"><AlertTriangle size={12} /> مش محفوظ لسه</span>
                                                                )}
                                                            </div>
                                                            {child.gpsLink ? (
                                                                <a href={child.gpsLink} target="_blank" rel="noreferrer" className="bg-[#EFF3FA] text-[#1B2A59] px-3 py-2 rounded-xl text-xs font-black hover:bg-[#DFE7F5] transition-colors flex items-center gap-1 border border-[#D4DFF0]">
                                                                    <Map size={14} /> الخريطة
                                                                </a>
                                                            ) : (
                                                                <button onClick={() => handleSaveGPS(child)} aria-label="حفظ الموقع الحالي له" disabled={isLocating} className="bg-[#1B2A59] text-[#F4D078] px-3 py-2 rounded-xl text-xs font-black hover:bg-[#243875] transition-all shadow-md flex items-center gap-1 cursor-pointer">
                                                                    {isLocating ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />} حفظ المكان
                                                                </button>
                                                            )}
                                                        </div>

                                                        {/* الملاحظة السابقة لو موجودة */}
                                                        {latestNote && (
                                                            <div className="bg-amber-50 p-3 rounded-2xl border border-amber-200 mb-4">
                                                                <span className="font-black text-amber-800 mb-1 text-[10px] flex items-center gap-1"><ClipboardList size={12} /> أهم المهام (من الزيارة السابقة):</span>
                                                                <p className="text-xs text-[#1B2A59] font-medium leading-relaxed whitespace-pre-wrap">{latestNote.text}</p>
                                                            </div>
                                                        )}

                                                        {/* زراير الأكشن */}
                                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                                                            <a href={generateOnMyWayMsg(child)} target="_blank" rel="noreferrer" className="bg-[#F4D078] text-[#1B2A59] py-3 rounded-xl text-xs font-black flex items-center justify-center gap-1 shadow-sm hover:bg-[#e5bf62] transition-all">
                                                                <Navigation size={14} /> جايلك
                                                            </a>
                                                            <a href={generateVisitationMsg(child)} target="_blank" rel="noreferrer" className="bg-emerald-600 text-white py-3 rounded-xl text-xs font-black flex items-center justify-center gap-1 shadow-md hover:bg-emerald-700 transition-all">
                                                                <MessageCircleWarning size={14} /> رسالة
                                                            </a>
                                                            <button 
                                                                type="button"
                                                                onClick={() => setVisitingChild(child)} 
                                                                className={`py-3 rounded-xl text-xs font-black flex items-center justify-center gap-1 transition-all cursor-pointer ${
                                                                    isVisitedRecently 
                                                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100' 
                                                                        : 'bg-[#1B2A59] text-[#F4D078] shadow-md hover:bg-[#243875]'
                                                                }`}
                                                            >
                                                                <CheckCircle2 size={14} /> {isVisitedRecently ? 'تم الافتقاد اليوم' : 'تسجيل افتقاد'}
                                                            </button>
                                                            <Link to={`/profile/${child.id}`} className="bg-[#F5EBD6] text-[#1B2A59] py-3 rounded-xl text-xs font-black flex items-center justify-center gap-1 shadow-sm hover:bg-[#ebdcb9] transition-all border border-[#DFC99B]">
                                                                <Mic size={14} /> تلخيص بالمايك
                                                            </Link>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </main>

            {/* نافذة اختيار نوع الافتقاد */}
            {visitingChild && (
                <LogVisitationModal
                    isOpen={!!visitingChild}
                    child={visitingChild}
                    onClose={() => setVisitingChild(null)}
                    onSuccess={() => setVisitingChild(null)}
                />
            )}

            <BottomNav />
        </div>
    );
}