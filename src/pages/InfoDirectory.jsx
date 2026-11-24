import { useChurchDataEngine } from '../hooks/useChurchDataEngine';
import { getImpersonatedOsra, resolveUserAccessScope } from '../utils/notificationScopeEngine';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Phone, Info, ChevronLeft, Gift, Cake, User, UserPlus, Edit3 } from 'lucide-react';
import BottomNav from '../components/BottomNav';
import { StudentFormModal } from '../components/AddStudent';
import { readScopedStorage } from '../utils/tenantConfig';

export default function InfoDirectory() {
    const [activeFilter, setActiveFilter] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedMonthFilter, setSelectedMonthFilter] = useState("all");
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [modalChild, setModalChild] = useState(null);

    // عزل البيانات حسب الهرم الكنسي (4 مستويات)
    const accessScope = resolveUserAccessScope(null, [], { includeFallback: true });
    const impersonated = getImpersonatedOsra();
    const activeTargetSyncKey = impersonated?.syncKey || accessScope.activeSyncKey || readScopedStorage('currentSyncKey') || '';
    const isMaster = accessScope.canSwitchClasses;
    const { activeChildren } = useChurchDataEngine(accessScope.allowedSyncKeys || []);
    const children = activeChildren.filter(c => !searchQuery || c.name?.toLowerCase().includes(searchQuery.toLowerCase()));


    // دالة لاستخراج شهر الميلاد للفلترة
    const getBirthMonth = (child) => {
        if (child.birthMonth) return child.birthMonth;
        if (!child.birthDate) return null;
        const bDateStr = String(child.birthDate);
        const arabicMonths = { "يناير": 1, "فبراير": 2, "مارس": 3, "ابريل": 4, "إبريل": 4, "مايو": 5, "يونيو": 6, "يوليو": 7, "اغسطس": 8, "أغسطس": 8, "سبتمبر": 9, "اكتوبر": 10, "أكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12 };
        for (const [arMonth, num] of Object.entries(arabicMonths)) {
            if (bDateStr.includes(arMonth)) return num;
        }
        const d = new Date(bDateStr);
        if (!isNaN(d.getTime())) return d.getMonth() + 1;
        return null;
    };

    // دالة لاكتشاف لو عيد ميلاد المخدوم النهارده
    const isBirthdayToday = (birthDateStr) => {
        if (!birthDateStr) return false;
        const str = String(birthDateStr);
        const today = new Date();
        const currentDay = today.getDate();
        const currentMonth = today.getMonth() + 1;

        const dayMatch = str.match(/\d+/);
        const day = dayMatch ? parseInt(dayMatch[0], 10) : null;

        const arabicMonths = { "يناير": 1, "فبراير": 2, "مارس": 3, "ابريل": 4, "إبريل": 4, "مايو": 5, "يونيو": 6, "يوليو": 7, "اغسطس": 8, "أغسطس": 8, "سبتمبر": 9, "اكتوبر": 10, "أكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12 };
        let month = null;
        for (const [arMonth, num] of Object.entries(arabicMonths)) {
            if (str.includes(arMonth)) { month = num; break; }
        }

        if (!month) {
            const d = new Date(str);
            if (!isNaN(d.getTime())) {
                month = d.getMonth() + 1;
                if (!day) return d.getDate() === currentDay && month === currentMonth;
            }
        }
        return day === currentDay && month === currentMonth;
    };

    const filteredChildren = children?.filter((c) => {
        // فلتر النوع
        if (activeFilter === "boys" && c.gender === "بنت") return false;
        if (activeFilter === "girls" && c.gender !== "بنت") return false;
        // فلتر شهر الميلاد
        if (selectedMonthFilter !== "all") {
            const bMonth = getBirthMonth(c);
            if (bMonth !== Number(selectedMonthFilter)) return false;
        }
        return true;
    }) || [];

    const getDisplayPhone = (child) => {
        if (child.whatsappTarget === 'child' && child.childPhone) return `المخدوم: ${child.childPhone}`;
        if (child.whatsappTarget === 'father' && child.fatherPhone) return `الأب: ${child.fatherPhone}`;
        if (child.whatsappTarget === 'mother' && child.motherPhone) return `الأم: ${child.motherPhone}`;
        
        if (child.childPhone) return `المخدوم: ${child.childPhone}`;
        if (child.fatherPhone) return `الأب: ${child.fatherPhone}`;
        if (child.motherPhone) return `الأم: ${child.motherPhone}`;
        if (child.phone) return child.phone;
        return 'لا يوجد تليفون';
    };

    const monthsOptions = [
        { id: "all", label: "كل الشهور" },
        { id: 1, label: "يناير" }, { id: 2, label: "فبراير" }, { id: 3, label: "مارس" },
        { id: 4, label: "أبريل" }, { id: 5, label: "مايو" }, { id: 6, label: "يونيو" },
        { id: 7, label: "يوليو" }, { id: 8, label: "أغسطس" }, { id: 9, label: "سبتمبر" },
        { id: 10, label: "أكتوبر" }, { id: 11, label: "نوفمبر" }, { id: 12, label: "ديسمبر" }
    ];

    return (
        <div className="min-h-screen coptic-cream-surface pb-32 font-sans" dir="rtl">
            <header className="bg-gradient-to-b from-[#FAF4E8]/95 to-[#F6EDDB]/95 backdrop-blur-md p-4 shadow-sm mb-6 rounded-b-4xl border-b border-[#E5D7BF]">
                <div className="max-w-4xl mx-auto">
                    {/* البحث بالاسم */}
                    <div className="relative mb-4">
                        <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C7D68]" />
                        <input type="text" placeholder="ابحث في الدليل بالاسم..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pr-10 pl-4 py-2.5 rounded-full coptic-cream-input text-sm font-bold" />
                    </div>

                    {/* فلتر النوع */}
                    <div className="flex gap-2 justify-center mb-3">
                        {[{ id: "all", label: "الكل" }, { id: "boys", label: "ولاد" }, { id: "girls", label: "بنات" }].map(f => (
                            <button key={f.id} onClick={() => setActiveFilter(f.id)} className={`flex-1 px-4 py-2 rounded-full text-xs font-black transition-all cursor-pointer ${activeFilter === f.id ? "bg-[#1B2A59] text-[#F4D078] shadow-md" : "bg-[#FFFDF7] border border-[#E3D6BF] text-[#5E5242] hover:border-[#C8942E]"}`}>{f.label}</button>
                        ))}
                    </div>

                    {/* فلتر شهور أعياد الميلاد */}
                    <div className="flex gap-2 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden">
                        {monthsOptions.map(m => (
                            <button key={m.id} onClick={() => setSelectedMonthFilter(m.id)} className={`shrink-0 px-4 py-1.5 rounded-full text-[10px] font-black transition-all cursor-pointer ${selectedMonthFilter === m.id ? 'bg-[#C8942E] text-white shadow-md' : 'bg-[#FFFDF7] border border-[#E3D6BF] text-[#5E5242]'}`}>
                                {m.id !== "all" && <Gift size={10} className="inline ml-1 mb-0.5" />} {m.label}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <main className="px-4 max-w-4xl mx-auto">
                <div className="bg-[#F5EBD6] border border-[#DFC99B] p-4 rounded-3xl mb-6 flex items-center gap-3">
                    <Info className="text-[#1B2A59]" size={24} />
                    <div>
                        <h2 className="font-black text-[#1B2A59]">دليل المخدومين {isMaster ? '(الكل)' : ''}</h2>
                        <p className="text-xs font-bold text-[#6E604F]">اضغط لفتح الملف والصور</p>
                    </div>
                </div>

                <div className="mb-6">
                    <button
                        type="button"
                        onClick={() => { setModalChild(null); setIsAddModalOpen(true); }}
                        className="w-full sm:w-auto px-5 py-3.5 rounded-2xl font-black text-sm text-[#FCE9B8] shadow-lg hover:brightness-110 transition-all flex items-center justify-center gap-2 shrink-0 cursor-pointer border border-[#C8942E]/40"
                        style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 65%, #8C621E 100%)' }}
                    >
                        <UserPlus size={18} className="text-[#F4D078]" />
                        <span>إضافة مخدوم جديد للفصل</span>
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredChildren.length === 0 ? (
                        <div className="col-span-full text-center py-10 text-[#6E604F] font-bold border-2 border-dashed border-[#DFC99B] rounded-3xl bg-[#FAF4E8]/50">لا يوجد مخدومين مطابقين للبحث.</div>
                    ) : (
                        filteredChildren.map(child => {
                            const isBday = isBirthdayToday(child.birthDate); // فحص عيد الميلاد

                            return (
                                <Link key={child.id} to={`/info/${child.id}`} className={`p-4 rounded-3xl shadow-sm border flex items-center gap-4 transition-all relative overflow-hidden ${isBday ? 'bg-linear-to-l from-[#FDF5E2] to-[#FCE9C0] border-[#C8942E] shadow-amber-200/50 scale-[1.02]' : 'coptic-card hover:border-[#C8942E]'}`}>
                                    {/* شريط الإضاءة لو عيد ميلاده */}
                                    {isBday && <div className="absolute top-0 left-0 w-full h-1.5 bg-linear-to-r from-[#1B2A59] via-[#C8942E] to-[#1B2A59]"></div>}

                                    <div className={`w-14 h-14 rounded-full flex items-center justify-center overflow-hidden shadow-inner ${isBday ? 'bg-[#F4D078]/40 border-2 border-[#C8942E] text-[#1B2A59]' : 'bg-[#F5EBD6] text-[#1B2A59]'}`}>
                                        {child.profilePic ? (
                                            <img 
                                                src={child.profilePic} 
                                                className="object-cover w-full h-full" 
                                                alt={child.name} 
                                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                            />
                                        ) : <User size={24} />}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-black text-[#1B2A59] text-sm flex items-center gap-1 truncate">
                                            {child.name}
                                            {isBday && <Cake size={16} className="text-[#C8942E] animate-bounce shrink-0" />}
                                        </h3>
                                        <p className="text-[10px] text-[#6E604F] font-bold mt-1 flex items-center gap-1" dir="ltr">
                                            <Phone size={10} /> {getDisplayPhone(child)}
                                        </p>

                                        {/* إظهار تاريخ الميلاد لو النهارده */}
                                        {child.birthDate && (
                                            <p className={`text-[10px] font-black mt-1.5 flex items-center gap-1 w-fit px-2 py-0.5 rounded-lg ${isBday ? 'bg-[#1B2A59] text-[#F4D078] shadow-sm' : 'bg-[#FAF4E8] border border-[#E5D7BF] text-[#6E604F]'}`}>
                                                <Gift size={10} /> {child.birthDate} {isBday && ' (النهارده!)'}
                                            </p>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        title="تعديل بيانات المخدوم"
                                        aria-label={`تعديل ${child.name}`}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setModalChild(child);
                                            setIsAddModalOpen(true);
                                        }}
                                        className="w-9 h-9 rounded-xl bg-[#FAF4E8] border border-[#C8942E]/30 text-[#1B2A59] hover:bg-[#1B2A59] hover:text-[#F4D078] transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                                    >
                                        <Edit3 size={15} />
                                    </button>
                                    <ChevronLeft size={20} className={isBday ? "text-[#C8942E]" : "text-[#8C7D68]"} />
                                </Link>
                            );
                        })
                    )}
                </div>
            </main>
            <StudentFormModal
                isOpen={isAddModalOpen || Boolean(modalChild)}
                editingChild={modalChild}
                initialSyncKey={activeTargetSyncKey}
                onClose={() => {
                    setIsAddModalOpen(false);
                    setModalChild(null);
                }}
            />
            <BottomNav />
        </div>
    );
}