import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import useAutoSync from '../hooks/useAutoSync';
import { ArrowRight, Phone, MapPin, ClipboardList, Briefcase, Calendar, Info, Map, AlertTriangle, PartyPopper, Trash2, Camera, Loader2, User, Edit3 } from 'lucide-react';
import { deleteChildRecord } from '../db/sync';
import { uploadImageWithFallback } from '../utils/cloudinary';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
import { useSmartNavigation } from '../hooks/useSmartNavigation';
import { StudentFormModal } from '../components/AddStudent';

export default function ChildInfo() {
    const { goBack } = useSmartNavigation();
    const { id } = useParams();
    const navigate = useNavigate();
    const { triggerAutoSync } = useAutoSync();

    // نستخرج ID من الـ URL فقط ليكون المصدر الوحيد للحقيقة
    const childId = String(id);

    // تحديث البيانات في الخلفية فور فتح البروفايل
    useEffect(() => {
        triggerAutoSync();
    }, [triggerAutoSync]);

    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);

    const accessScope = resolveUserAccessScope(null, [], { includeFallback: true });
    const rawChild = useLiveQuery(() => {
        if (childId) return db.children.get(childId);
        return null;
    }, [childId]);
    const isOutOfScope = Boolean(
        rawChild &&
        !accessScope.isSuperAdmin &&
        !accessScope.allowedSyncKeys.includes(rawChild.syncKey)
    );
    const child = isOutOfScope ? null : rawChild;

    const handlePhotoUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !child) return;
        setIsUploadingPhoto(true);
        try {
            const secure_url = await uploadImageWithFallback(file, { syncKey: child.syncKey });
            const now = new Date().toISOString();
            await db.children.update(childId, {
                profilePic: secure_url,
                isDirty: true,
                updatedAt: now
            });
            triggerAutoSync();
            alert('تم تحديث صورة المخدوم بنجاح!');
        } catch (err) {
            console.error("Photo upload error:", err);
            alert('فشل حفظ الصورة، حاول مرة أخرى.');
        } finally {
            setIsUploadingPhoto(false);
        }
    };

    const handleDeleteChild = async () => {
        if (!child) return;
        if (window.confirm(`متأكد إنك عايز تمسح المخدوم (${child.name}) نهائياً؟`)) {
            await deleteChildRecord(childId, child);
            goBack('/info-directory');
        }
    };

    // لو مفيش ID مبعوت من الأساس
    if (!childId) {
        return (
            <div className="min-h-screen coptic-cream-surface flex flex-col items-center justify-center p-10 font-bold text-[#6E604F] font-sans" dir="rtl">
                <AlertTriangle size={40} className="text-rose-500 mb-4" />
                <p>بيانات المخدوم غير متوفرة أو المسار غير صحيح.</p>
                <button onClick={() => goBack('/info-directory')} className="mt-6 bg-[#1B2A59] text-[#F4D078] px-6 py-2 rounded-xl text-sm hover:opacity-90 transition-opacity cursor-pointer">رجوع</button>
            </div>
        );
    }

    if (isOutOfScope) {
        return (
            <div className="min-h-screen coptic-cream-surface flex flex-col items-center justify-center p-10 font-bold text-[#6E604F] font-sans" dir="rtl">
                <AlertTriangle size={40} className="text-amber-600 mb-4" />
                <p>عذراً، بيانات هذا المخدوم خارج نطاق فصلك أو مرحلتك.</p>
                <button onClick={() => navigate('/')} className="mt-6 bg-[#1B2A59] text-[#F4D078] px-6 py-2 rounded-xl text-sm hover:opacity-90 transition-opacity cursor-pointer">العودة للرئيسية</button>
            </div>
        );
    }

    if (!child) return <div className="min-h-screen coptic-cream-surface flex items-center justify-center text-center p-10 font-bold text-[#6E604F] animate-pulse font-sans" dir="rtl">جاري تحميل بيانات المخدوم...</div>;

    const isGirl = child.gender === 'بنت';
    const primaryPhone = child.whatsappTarget === 'father' ? child.fatherPhone : child.whatsappTarget === 'child' ? child.childPhone : child.motherPhone || child.phone;

    // فحص عيد الميلاد جوه الملف
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

    const isBday = isBirthdayToday(child.birthDate);

    return (
        <div className="min-h-screen coptic-cream-surface relative pb-20 font-sans" dir="rtl">
            <div className="relative z-10 max-w-3xl mx-auto px-4 pt-6 animate-in fade-in duration-500">

                {/* يافطة الاحتفال لو عيد ميلاده النهارده */}
                {isBday && (
                    <div className="bg-linear-to-r from-[#1B2A59] via-[#C8942E] to-[#1B2A59] p-1 rounded-3xl mb-4 shadow-lg">
                        <div className="bg-white/15 backdrop-blur-sm px-4 py-3 rounded-[1.3rem] flex items-center justify-center gap-2 text-white font-black text-sm">
                            <PartyPopper size={20} className="text-[#F4D078]" /> كل سنة وأنت طيب! النهارده عيد ميلاد المخدوم
                        </div>
                    </div>
                )}

                {/* ─── Header ─── */}
                <div className="coptic-card flex items-center justify-between mb-6 p-5 rounded-[2.5rem]">
                    <div className="flex items-center gap-4">
                        <div className="relative group">
                            <div className={`w-20 h-20 rounded-full flex items-center justify-center shadow-inner overflow-hidden border-4 ${isGirl ? 'bg-pink-50 text-pink-600' : 'bg-[#EFF3FA] text-[#1B2A59]'} ${isBday ? 'border-[#C8942E]' : 'border-white'}`}>
                                {isUploadingPhoto ? (
                                    <Loader2 className="animate-spin text-[#1B2A59]" size={24} />
                                ) : child.profilePic ? (
                                    <img 
                                        src={child.profilePic} 
                                        className="w-full h-full object-cover" 
                                        alt={child.name} 
                                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    />
                                ) : <User size={34} />}
                            </div>
                            <label className="absolute bottom-0 right-0 bg-[#1B2A59] hover:bg-[#243875] text-[#F4D078] p-1.5 rounded-full cursor-pointer shadow-md transition-transform active:scale-95" title="تغيير الصورة">
                                <Camera size={14} />
                                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={isUploadingPhoto} />
                            </label>
                        </div>
                        <div>
                            <h1 className="text-xl md:text-2xl font-black text-[#1B2A59]">{child.name}</h1>
                            <span className={`inline-block mt-1 px-3 py-1 rounded-full text-[10px] font-black border ${isGirl ? 'bg-pink-50 text-pink-700 border-pink-200' : 'bg-[#F5EBD6] text-[#8B6217] border-[#DFC99B]'}`}>
                                مواظبة: {child.streak || 0}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setIsEditOpen(true)}
                            title="تعديل بيانات المخدوم"
                            className="h-12 px-4 bg-[#1B2A59] text-[#F4D078] rounded-full hover:bg-[#243875] transition-all shadow-sm flex items-center justify-center gap-1.5 shrink-0 cursor-pointer font-black text-xs border border-[#C8942E]/40"
                        >
                            <Edit3 size={16} />
                            <span className="hidden sm:inline">تعديل البيانات</span>
                        </button>
                        <button 
                            onClick={handleDeleteChild} 
                            title="حذف المخدوم نهائياً" 
                            className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full hover:bg-rose-600 hover:text-white transition-all shadow-sm flex items-center justify-center shrink-0 cursor-pointer"
                        >
                            <Trash2 size={20} />
                        </button>
                        <button onClick={() => goBack('/info-directory')} aria-label="الرجوع للخلف" className="w-12 h-12 bg-[#FAF4E8] border border-[#E5D7BF] text-[#1B2A59] rounded-full hover:bg-[#EFE4CF] transition-all shadow-sm flex items-center justify-center shrink-0 cursor-pointer">
                            <ArrowRight size={20} />
                        </button>
                    </div>
                </div>

                {/* ─── بطاقة البيانات الشاملة ─── */}
                <section className="coptic-card p-6 rounded-[2.5rem] mb-6">
                    <h3 className="text-lg font-black text-[#1B2A59] mb-5 flex items-center gap-2 border-b border-[#EDE3CE] pb-3">
                        <Info className="text-[#C8942E]" size={20} /> بيانات المخدوم
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-[#FAF4E8] p-4 rounded-2xl border border-[#E5D7BF]">
                            <span className="text-[10px] font-bold text-[#6E604F] flex items-center gap-1 mb-1"><Phone size={12} /> تليفون الأم</span>
                            <p className="font-black text-[#1B2A59] text-sm" dir="ltr">{child.motherPhone || 'لا يوجد'}</p>
                        </div>
                        <div className="bg-[#FAF4E8] p-4 rounded-2xl border border-[#E5D7BF]">
                            <span className="text-[10px] font-bold text-[#6E604F] flex items-center gap-1 mb-1"><Phone size={12} /> تليفون الأب</span>
                            <p className="font-black text-[#1B2A59] text-sm" dir="ltr">{child.fatherPhone || 'لا يوجد'}</p>
                        </div>
                        {child.childPhone && (
                            <div className="md:col-span-2 bg-[#FAF4E8] p-4 rounded-2xl border border-[#E5D7BF]">
                                <span className="text-[10px] font-bold text-[#6E604F] flex items-center gap-1 mb-1"><Phone size={12} /> تليفون المخدوم</span>
                                <p className="font-black text-[#1B2A59] text-sm" dir="ltr">{child.childPhone}</p>
                            </div>
                        )}
                        {child.phone && !child.motherPhone && !child.fatherPhone && !child.childPhone && (
                            <div className="md:col-span-2 bg-amber-50 p-4 rounded-2xl border border-amber-200">
                                <span className="text-[10px] font-bold text-amber-700 flex items-center gap-1 mb-1"><Phone size={12} /> رقم مسجل سابقاً</span>
                                <p className="font-black text-amber-900 text-sm" dir="ltr">{child.phone}</p>
                            </div>
                        )}

                        <div className="md:col-span-2 bg-emerald-50/80 p-4 rounded-2xl border border-emerald-200 flex justify-between items-center">
                            <div>
                                <span className="text-[10px] font-bold text-emerald-700 mb-1 block">رقم الواتس الأساسي (للافتقاد)</span>
                                <p className="font-black text-emerald-900 text-sm" dir="ltr">{primaryPhone || 'غير محدد'}</p>
                            </div>
                            {primaryPhone && (
                                <a href={`https://wa.me/2${primaryPhone}`} target="_blank" rel="noreferrer" className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-black shadow-md hover:bg-emerald-700 transition-all">
                                    مراسلة
                                </a>
                            )}
                        </div>

                        <div className="bg-[#FAF4E8] p-4 rounded-2xl border border-[#E5D7BF]">
                            <span className="text-[10px] font-bold text-[#6E604F] flex items-center gap-1 mb-1"><MapPin size={12} /> المنطقة</span>
                            <p className="font-black text-[#1B2A59] text-sm">{child.address || 'غير محددة'}</p>
                        </div>

                        <div className={`p-4 rounded-2xl border ${isBday ? 'bg-pink-50 border-pink-200' : 'bg-[#FAF4E8] border-[#E5D7BF]'}`}>
                            <span className={`text-[10px] font-bold flex items-center gap-1 mb-1 ${isBday ? 'text-pink-600' : 'text-[#6E604F]'}`}><Calendar size={12} /> تاريخ الميلاد</span>
                            <p className={`font-black text-sm ${isBday ? 'text-pink-800' : 'text-[#1B2A59]'}`}>{child.birthDate || 'غير محدد'}</p>
                        </div>

                        <div className="md:col-span-2 bg-[#EFF3FA] p-4 rounded-2xl border border-[#D4DFF0]">
                            <span className="text-[10px] font-bold text-[#1B2A59] flex items-center gap-1 mb-1"><MapPin size={12} /> العنوان التفصيلي (وصف البيت)</span>
                            <p className="font-black text-[#1B2A59] text-sm leading-relaxed">{child.detailedAddress || 'لا يوجد وصف للبيت'}</p>
                        </div>

                        <div className="md:col-span-2 bg-[#FAF4E8] p-4 rounded-2xl border border-[#E5D7BF]">
                            <span className="text-[10px] font-bold text-[#6E604F] flex items-center gap-1 mb-1"><Briefcase size={12} /> وظيفة الأب</span>
                            <p className="font-black text-[#1B2A59] text-sm">{child.fatherJob || 'غير محددة'}</p>
                        </div>

                        <div className="bg-[#FAF4E8] p-4 rounded-2xl border border-[#E5D7BF]">
                            <span className="text-[10px] font-bold text-[#6E604F] flex items-center gap-1 mb-1"><Info size={12} /> أب الاعتراف</span>
                            <p className="font-black text-[#1B2A59] text-sm">{child.fatherConfessor || 'غير مسجل'}</p>
                        </div>

                        {(child.academicYear || child.schoolYear) && (
                            <div className="bg-[#FAF4E8] p-4 rounded-2xl border border-[#E5D7BF]">
                                <span className="text-[10px] font-bold text-[#6E604F] flex items-center gap-1 mb-1"><Info size={12} /> السنة الدراسية</span>
                                <p className="font-black text-[#1B2A59] text-sm">{child.academicYear || child.schoolYear}</p>
                            </div>
                        )}

                        {child.gpsLink && (
                            <div className="md:col-span-2 bg-[#EFF3FA] p-4 rounded-2xl border border-[#D4DFF0] flex justify-between items-center">
                                <span className="text-xs font-black text-[#1B2A59] flex items-center gap-1"><Map size={16} /> اللوكيشن</span>
                                <a href={child.gpsLink} target="_blank" rel="noreferrer" className="bg-[#1B2A59] text-[#F4D078] px-4 py-2 rounded-xl text-xs font-black shadow-md">
                                    فتح الخريطة
                                </a>
                            </div>
                        )}

                        {child.specialNotes && (
                            <div className="md:col-span-2 bg-amber-50 p-4 rounded-2xl border border-amber-200">
                                <span className="text-[10px] font-bold text-amber-700 flex items-center gap-1 mb-1"><AlertTriangle size={12} /> ملاحظات هامة</span>
                                <p className="font-black text-amber-900 text-sm leading-relaxed whitespace-pre-wrap">{child.specialNotes}</p>
                            </div>
                        )}
                    </div>
                </section>


                {/* ─── سجل ملاحظات الافتقاد ─── */}
                <section className="coptic-card p-6 rounded-[2.5rem]">
                    <h3 className="text-lg font-black text-[#1B2A59] mb-4 flex items-center gap-2 border-b border-[#EDE3CE] pb-3">
                        <ClipboardList className="text-[#C8942E]" size={20} /> سجل الافتقاد السابق
                    </h3>
                    {child.notes && child.notes.length > 0 ? (
                        <div className="space-y-3">
                            {[...child.notes].reverse().map(note => (
                                <div key={note.id} className="bg-[#FAF4E8] p-4 rounded-2xl border border-[#E5D7BF] relative">
                                    <span className="absolute top-4 left-4 w-2 h-2 rounded-full bg-[#C8942E]"></span>
                                    <p className="text-[10px] text-[#8C7D68] font-bold mb-2">{new Date(note.date).toLocaleString('ar-EG')}</p>
                                    <p className="text-sm font-medium text-[#1B2A59] whitespace-pre-wrap">{note.text}</p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-center text-sm font-bold text-[#8C7D68] py-6 bg-[#FAF4E8] rounded-2xl border border-dashed border-[#DFC99B]">مفيش ملاحظات افتقاد مسجلة.</p>
                    )}
                </section>

            </div>
            <StudentFormModal
                isOpen={isEditOpen}
                editingChild={child}
                initialSyncKey={child?.syncKey}
                onClose={() => setIsEditOpen(false)}
            />
        </div>
    );
}