import React, { useEffect, useMemo, useState } from 'react';
import {
    Camera,
    Calendar,
    Edit3,
    GraduationCap,
    HeartHandshake,
    Loader2,
    Map,
    MapPin,
    MessageCircle,
    Phone,
    Save,
    StickyNote,
    Upload,
    User,
    UserPlus,
    Briefcase,
    X,
    Navigation
} from 'lucide-react';
import { db } from '../db/database';
import { syncWithCloud } from '../db/sync';
import { uploadImageWithFallback } from '../utils/cloudinary';
import { createCanonicalChildRecord } from '../utils/churchDataEngine';
import { logActivity } from '../utils/activityLogger';
import { getImpersonatedOsra, resolveUserAccessScope } from '../utils/notificationScopeEngine';
import { readScopedStorage } from '../utils/tenantConfig';
import useAutoSync from '../hooks/useAutoSync';

const ARABIC_MONTHS = {
    'يناير': 1, 'فبراير': 2, 'مارس': 3, 'ابريل': 4, 'إبريل': 4, 'أبريل': 4,
    'مايو': 5, 'يونيو': 6, 'يوليو': 7, 'اغسطس': 8, 'أغسطس': 8,
    'سبتمبر': 9, 'اكتوبر': 10, 'أكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12
};

function parseBirthMonth(birthDate = '') {
    const raw = String(birthDate || '').trim();
    if (!raw) return null;
    for (const [arMonth, num] of Object.entries(ARABIC_MONTHS)) {
        if (raw.includes(arMonth)) return num;
    }
    const parsed = new Date(raw);
    return !Number.isNaN(parsed.getTime()) ? parsed.getMonth() + 1 : null;
}

function buildInitialForm(child = null, defaultSyncKey = '') {
    return {
        name: child?.name || '',
        gender: child?.gender === 'بنت' ? 'بنت' : 'ولد',
        birthDate: child?.birthDate || '',
        academicYear: child?.academicYear || child?.schoolYear || '',
        syncKey: child?.syncKey || defaultSyncKey || '',
        childPhone: child?.childPhone || '',
        motherPhone: child?.motherPhone || '',
        fatherPhone: child?.fatherPhone || '',
        whatsappTarget: child?.whatsappTarget === 'father' || child?.whatsappTarget === 'child'
            ? child.whatsappTarget
            : 'mother',
        whatsapp: child?.whatsapp || '',
        address: child?.address || '',
        detailedAddress: child?.detailedAddress || '',
        gpsLink: child?.gpsLink || '',
        fatherJob: child?.fatherJob || '',
        fatherConfessor: child?.fatherConfessor || child?.confessionFather || '',
        specialNotes: child?.specialNotes || '',
        profilePic: child?.profilePic || ''
    };
}

export function StudentFormModal({
    isOpen = true,
    editingChild = null,
    initialSyncKey = '',
    onClose,
    onSaved,
    embedded = false
}) {
    const { triggerAutoSync } = useAutoSync();
    const accessScope = resolveUserAccessScope(null, [], { includeFallback: true });
    const impersonated = getImpersonatedOsra();

    const allowedOsras = useMemo(() => {
        const list = Array.isArray(accessScope.allowedOsras) ? accessScope.allowedOsras : [];
        if (list.length > 0) return list;
        if (impersonated?.syncKey) {
            return [{ syncKey: impersonated.syncKey, name: impersonated.name || impersonated.syncKey }];
        }
        return [];
    }, [accessScope.allowedOsras, impersonated]);

    const resolvedDefaultSyncKey = useMemo(() => {
        if (editingChild?.syncKey) return String(editingChild.syncKey).trim();
        const candidate = String(
            initialSyncKey || impersonated?.syncKey || accessScope.activeSyncKey || ''
        ).trim();
        if (candidate && !['MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN'].includes(candidate)) {
            return candidate;
        }
        return allowedOsras[0]?.syncKey || '';
    }, [editingChild, initialSyncKey, impersonated, accessScope.activeSyncKey, allowedOsras]);

    const [form, setForm] = useState(() => buildInitialForm(editingChild, resolvedDefaultSyncKey));
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isLocating, setIsLocating] = useState(false);

    useEffect(() => {
        if (!isOpen && !embedded) return;
        setForm(buildInitialForm(editingChild, resolvedDefaultSyncKey));
    }, [isOpen, embedded, editingChild, resolvedDefaultSyncKey]);

    if (!embedded && !isOpen) return null;

    const isClassLocked = accessScope.isClassServant || allowedOsras.length <= 1;
    const activeOsraObj = allowedOsras.find(o => o.syncKey === form.syncKey) || allowedOsras[0];
    const activeClassLabel =
        activeOsraObj?.name ||
        impersonated?.name ||
        readScopedStorage('assignedOsra') ||
        form.syncKey ||
        'فصل الكنيسة';

    const autoWhatsappNumber =
        form.whatsappTarget === 'father'
            ? (form.fatherPhone || form.motherPhone || form.childPhone)
            : form.whatsappTarget === 'child'
                ? (form.childPhone || form.motherPhone || form.fatherPhone)
                : (form.motherPhone || form.fatherPhone || form.childPhone);

    const handlePhotoChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploadingPhoto(true);
        try {
            const targetKey = form.syncKey || resolvedDefaultSyncKey || 'general';
            const uploadedUrl = await uploadImageWithFallback(file, { syncKey: targetKey });
            setForm(prev => ({ ...prev, profilePic: uploadedUrl }));
        } catch (err) {
            console.error(err);
            alert('تعذر رفع الصورة، يرجى المحاولة مرة أخرى.');
        } finally {
            setIsUploadingPhoto(false);
        }
    };

    const handleDetectGps = () => {
        if (!navigator?.geolocation) {
            alert('المتصفح لا يدعم تحديد الموقع التلقائي.');
            return;
        }
        setIsLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude.toFixed(6);
                const lng = pos.coords.longitude.toFixed(6);
                setForm(prev => ({ ...prev, gpsLink: `https://maps.google.com/?q=${lat},${lng}` }));
                setIsLocating(false);
            },
            () => {
                alert('تعذر الحصول على الموقع الحالي. تأكد من تفعيل صلاحية الموقع GPS.');
                setIsLocating(false);
            },
            { timeout: 8000 }
        );
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const trimmedName = String(form.name || '').trim();
        if (!trimmedName) {
            alert('يرجى كتابة الاسم الرباعي للمخدوم أولاً.');
            return;
        }

        const targetSyncKey = String(form.syncKey || resolvedDefaultSyncKey || '').trim();
        if (!targetSyncKey || ['MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN'].includes(targetSyncKey)) {
            alert('يرجى تحديد الفصل / الأسرة التابع لها المخدوم أولاً.');
            return;
        }

        setIsSaving(true);
        try {
            const nowIso = new Date().toISOString();
            const bMonth = parseBirthMonth(form.birthDate);
            const canonicalPayload = createCanonicalChildRecord({
                ...(editingChild || {}),
                name: trimmedName,
                gender: form.gender === 'بنت' ? 'بنت' : 'ولد',
                birthDate: form.birthDate.trim(),
                birthMonth: bMonth || editingChild?.birthMonth || null,
                academicYear: form.academicYear.trim(),
                schoolYear: form.academicYear.trim(),
                syncKey: targetSyncKey,
                childPhone: form.childPhone.trim(),
                motherPhone: form.motherPhone.trim(),
                fatherPhone: form.fatherPhone.trim(),
                whatsappTarget: form.whatsappTarget,
                whatsapp: (form.whatsapp || autoWhatsappNumber || '').trim(),
                address: form.address.trim(),
                detailedAddress: form.detailedAddress.trim(),
                gpsLink: form.gpsLink.trim(),
                fatherJob: form.fatherJob.trim(),
                fatherConfessor: form.fatherConfessor.trim(),
                confessionFather: form.fatherConfessor.trim(),
                specialNotes: form.specialNotes.trim(),
                profilePic: form.profilePic.trim(),
                streak: editingChild ? (editingChild.streak || 0) : 0,
                gotClothes: editingChild ? Boolean(editingChild.gotClothes) : false,
                updatedAt: nowIso,
                isDirty: true,
                isDeleted: false,
                restoredAt: editingChild?.isDeleted ? Date.now() : (editingChild?.restoredAt || null)
            }, targetSyncKey);

            // إزالة أي حقول قديمة خاصة بالشموسية عند التحديث
            delete canonicalPayload.isOrdained;
            delete canonicalPayload.ordinationRank;

            await db.children.put(canonicalPayload);
            logActivity(
                editingChild ? 'UPDATE_CHILD' : 'ADD_CHILD',
                `${editingChild ? 'تعديل بيانات المخدوم' : 'إضافة مخدوم جديد'}: ${canonicalPayload.name} (${activeClassLabel})`
            );

            void syncWithCloud(targetSyncKey);
            triggerAutoSync();

            if (onSaved) onSaved(canonicalPayload);
            if (onClose) onClose();
            alert(editingChild ? 'تم تحديث بيانات المخدوم بنجاح!' : 'تم حفظ المخدوم الجديد بنجاح!');
        } catch (err) {
            console.error('Save student error:', err);
            alert('حدث خطأ أثناء حفظ البيانات، حاول مرة أخرى.');
        } finally {
            setIsSaving(false);
        }
    };

    const formContent = (
        <div
            className={`w-full ${embedded ? 'max-w-3xl mx-auto mb-6' : 'max-w-2xl max-h-[92vh] overflow-y-auto'} rounded-[2rem] border border-[#C8942E]/40 bg-[#FAF4E8] shadow-2xl overflow-hidden animate-card-enter`}
            dir="rtl"
        >
            {/* Royal Navy & Gold Coptic Header */}
            <div
                className="relative px-6 py-6 text-white border-b-2 border-[#C8942E]/60"
                style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 65%, #8C621E 100%)' }}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 h-12 rounded-2xl bg-white/10 border border-[#F4D078]/40 flex items-center justify-center shrink-0 shadow-inner">
                            {editingChild ? <Edit3 className="text-[#F4D078]" size={22} /> : <UserPlus className="text-[#F4D078]" size={22} />}
                        </div>
                        <div className="min-w-0">
                            <h2 className="font-calligraphic text-2xl sm:text-3xl font-bold text-[#FCE9B8] leading-snug">
                                {editingChild ? 'تعديل بيانات المخدوم' : 'إضافة مخدوم جديد للفصل'}
                            </h2>
                            <div className="mt-1 inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-white/10 border border-[#F4D078]/35 text-[11px] font-black text-[#F4D078]">
                                <span>{activeClassLabel}</span>
                            </div>
                        </div>
                    </div>

                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="إغلاق الاستمارة"
                            className="w-10 h-10 rounded-full bg-white/15 border border-white/25 flex items-center justify-center text-white hover:bg-white/25 transition-colors shrink-0 cursor-pointer"
                        >
                            <X size={20} />
                        </button>
                    )}
                </div>
            </div>

            <form onSubmit={handleSubmit} className="p-5 sm:p-7 space-y-6">
                {/* Centered Circular Avatar Photo Uploader */}
                <div className="flex flex-col items-center gap-2.5 bg-[#FFFDF7] border border-[#C8942E]/30 rounded-3xl p-5 shadow-xs">
                    <label className="relative cursor-pointer group">
                        <div className="w-28 h-28 rounded-full bg-[#FAF4E8] ring-4 ring-[#C8942E]/30 border-2 border-[#C8942E]/60 shadow-lg flex items-center justify-center overflow-hidden transition-transform group-hover:scale-[1.03]">
                            {isUploadingPhoto ? (
                                <div className="flex flex-col items-center text-[#1B2A59]">
                                    <Loader2 className="animate-spin mb-1" size={26} />
                                    <span className="text-[10px] font-black">جاري الرفع</span>
                                </div>
                            ) : form.profilePic ? (
                                <img
                                    src={form.profilePic}
                                    alt={form.name || 'صورة المخدوم'}
                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <User className="text-[#9E7628]" size={40} />
                            )}
                        </div>
                        <span className="absolute -bottom-1 -left-1 w-9 h-9 rounded-full bg-[#1B2A59] text-[#F4D078] border-2 border-[#FFFDF7] shadow-md flex items-center justify-center group-hover:bg-[#8C621E] group-hover:text-white transition-colors">
                            <Camera size={16} />
                        </span>
                        <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handlePhotoChange}
                            disabled={isUploadingPhoto}
                        />
                    </label>
                    <p className="text-xs font-black text-[#6E604F] flex items-center gap-1.5">
                        <Upload size={13} className="text-[#9E7628]" />
                        اضغط على الدائرة لرفع أو تغيير صورة المخدوم (Cloudinary)
                    </p>
                </div>

                {/* Section 1: البيانات الأساسية */}
                <section className="bg-[#FFFDF7] border border-[#C8942E]/30 rounded-3xl p-5 shadow-xs space-y-4">
                    <div className="flex items-center gap-2.5 pb-2 border-b border-[#E5D7BF]">
                        <span className="w-8 h-8 rounded-xl bg-[#1B2A59] text-[#F4D078] flex items-center justify-center shrink-0">
                            <User size={16} />
                        </span>
                        <h3 className="font-black text-base text-[#1B2A59]">البيانات الأساسية</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5 md:col-span-2">
                            <label className="text-xs font-black text-[#5E5242] block">الاسم الرباعي للمخدوم *</label>
                            <input
                                type="text"
                                required
                                value={form.name}
                                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="مثال: أبانوب عماد لطفي جرجس"
                                className="w-full px-4 py-3.5 rounded-2xl coptic-cream-input font-bold text-[#1B2A59] text-sm"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-black text-[#5E5242] block">النوع</label>
                            <div className="flex gap-2">
                                {['ولد', 'بنت'].map((g) => (
                                    <button
                                        type="button"
                                        key={g}
                                        onClick={() => setForm(prev => ({ ...prev, gender: g }))}
                                        className={`flex-1 py-3 rounded-2xl text-sm font-black transition-all cursor-pointer border ${
                                            form.gender === g
                                                ? 'bg-[#1B2A59] text-[#F4D078] border-[#1B2A59] shadow-md'
                                                : 'bg-[#FAF4E8] text-[#6E604F] border-[#E3D6BF] hover:border-[#C8942E]'
                                        }`}
                                    >
                                        {g}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-black text-[#5E5242] flex items-center gap-1.5">
                                <Calendar size={13} className="text-[#9E7628]" /> تاريخ الميلاد
                            </label>
                            <input
                                type="text"
                                value={form.birthDate}
                                onChange={(e) => setForm(prev => ({ ...prev, birthDate: e.target.value }))}
                                placeholder="مثال: 15 أغسطس 2016"
                                className="w-full px-4 py-3.5 rounded-2xl coptic-cream-input font-bold text-[#1B2A59] text-sm"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-black text-[#5E5242] flex items-center gap-1.5">
                                <GraduationCap size={14} className="text-[#9E7628]" /> السنة الدراسية
                            </label>
                            <input
                                type="text"
                                value={form.academicYear}
                                onChange={(e) => setForm(prev => ({ ...prev, academicYear: e.target.value }))}
                                placeholder="مثال: رابعة ابتدائي / أولى إعدادي"
                                className="w-full px-4 py-3.5 rounded-2xl coptic-cream-input font-bold text-[#1B2A59] text-sm"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-black text-[#5E5242] block">الفصل / الأسرة</label>
                            {isClassLocked ? (
                                <div className="w-full px-4 py-3.5 rounded-2xl bg-[#F5EBD6] border border-[#C8942E]/40 font-black text-[#1B2A59] text-sm flex items-center justify-between">
                                    <span>{activeClassLabel}</span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1B2A59] text-[#F4D078]">فصل مقيد</span>
                                </div>
                            ) : (
                                <select
                                    value={form.syncKey}
                                    onChange={(e) => setForm(prev => ({ ...prev, syncKey: e.target.value }))}
                                    className="w-full px-4 py-3.5 rounded-2xl coptic-cream-input font-bold text-[#1B2A59] text-sm"
                                >
                                    {allowedOsras.map((o) => (
                                        <option key={o.syncKey} value={o.syncKey}>
                                            {o.name} {o.serviceName ? `— ${o.serviceName}` : ''}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>
                    </div>
                </section>

                {/* Section 2: أرقام التواصل والواتساب */}
                <section className="bg-[#FFFDF7] border border-[#C8942E]/30 rounded-3xl p-5 shadow-xs space-y-4">
                    <div className="flex items-center gap-2.5 pb-2 border-b border-[#E5D7BF]">
                        <span className="w-8 h-8 rounded-xl bg-[#1B2A59] text-[#F4D078] flex items-center justify-center shrink-0">
                            <Phone size={16} />
                        </span>
                        <h3 className="font-black text-base text-[#1B2A59]">أرقام التواصل والواتساب</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                        <div className="space-y-1.5">
                            <label className="text-xs font-black text-[#5E5242] block">رقم موبايل المخدوم</label>
                            <input
                                type="tel"
                                dir="ltr"
                                value={form.childPhone}
                                onChange={(e) => setForm(prev => ({ ...prev, childPhone: e.target.value }))}
                                placeholder="012..."
                                className="w-full px-4 py-3 rounded-2xl coptic-cream-input font-bold text-left text-[#1B2A59] text-sm"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-black text-[#5E5242] block">موبايل الأب</label>
                            <input
                                type="tel"
                                dir="ltr"
                                value={form.fatherPhone}
                                onChange={(e) => setForm(prev => ({ ...prev, fatherPhone: e.target.value }))}
                                placeholder="012..."
                                className="w-full px-4 py-3 rounded-2xl coptic-cream-input font-bold text-left text-[#1B2A59] text-sm"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-black text-[#5E5242] block">موبايل الأم</label>
                            <input
                                type="tel"
                                dir="ltr"
                                value={form.motherPhone}
                                onChange={(e) => setForm(prev => ({ ...prev, motherPhone: e.target.value }))}
                                placeholder="012..."
                                className="w-full px-4 py-3 rounded-2xl coptic-cream-input font-bold text-left text-[#1B2A59] text-sm"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#FAF4E8] border border-[#E5D7BF] rounded-2xl p-4">
                        <div className="space-y-2">
                            <label className="text-xs font-black text-[#1B2A59] flex items-center gap-1.5">
                                <MessageCircle size={14} className="text-emerald-700" /> رقم الواتساب الأساسي للافتقاد
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { id: 'mother', label: 'رقم الأم' },
                                    { id: 'father', label: 'رقم الأب' },
                                    { id: 'child', label: 'رقم المخدوم' }
                                ].map((opt) => (
                                    <button
                                        type="button"
                                        key={opt.id}
                                        onClick={() => setForm(prev => ({ ...prev, whatsappTarget: opt.id }))}
                                        className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer border ${
                                            form.whatsappTarget === opt.id
                                                ? 'bg-emerald-700 text-white border-emerald-700 shadow-sm'
                                                : 'bg-[#FFFDF7] text-[#5E5242] border-[#DFC99B] hover:border-emerald-500'
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-black text-[#5E5242] block">رقم الواتساب (مباشر أو بديل)</label>
                            <input
                                type="tel"
                                dir="ltr"
                                value={form.whatsapp}
                                onChange={(e) => setForm(prev => ({ ...prev, whatsapp: e.target.value }))}
                                placeholder={autoWhatsappNumber || '012...'}
                                className="w-full px-4 py-3 rounded-2xl coptic-cream-input font-bold text-left text-[#1B2A59] text-sm"
                            />
                        </div>
                    </div>
                </section>

                {/* Section 3: العنوان والرعاية الروحية */}
                <section className="bg-[#FFFDF7] border border-[#C8942E]/30 rounded-3xl p-5 shadow-xs space-y-4">
                    <div className="flex items-center gap-2.5 pb-2 border-b border-[#E5D7BF]">
                        <span className="w-8 h-8 rounded-xl bg-[#1B2A59] text-[#F4D078] flex items-center justify-center shrink-0">
                            <HeartHandshake size={16} />
                        </span>
                        <h3 className="font-black text-base text-[#1B2A59]">العنوان والرعاية الروحية</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-black text-[#5E5242] flex items-center gap-1.5">
                                <MapPin size={13} className="text-[#9E7628]" /> المنطقة
                            </label>
                            <input
                                type="text"
                                value={form.address}
                                onChange={(e) => setForm(prev => ({ ...prev, address: e.target.value }))}
                                placeholder="مثال: طهنشا / وسط البلد"
                                className="w-full px-4 py-3.5 rounded-2xl coptic-cream-input font-bold text-[#1B2A59] text-sm"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-black text-[#5E5242] flex items-center gap-1.5">
                                <Map size={13} className="text-[#9E7628]" /> لوكيشن البيت (GPS)
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="url"
                                    dir="ltr"
                                    value={form.gpsLink}
                                    onChange={(e) => setForm(prev => ({ ...prev, gpsLink: e.target.value }))}
                                    placeholder="https://maps.google.com/..."
                                    className="flex-1 min-w-0 px-4 py-3.5 rounded-2xl coptic-cream-input font-bold text-left text-[#1B2A59] text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={handleDetectGps}
                                    disabled={isLocating}
                                    title="التقاط الموقع الحالي"
                                    className="px-3.5 rounded-2xl bg-[#FAF4E8] border border-[#C8942E]/40 text-[#1B2A59] font-black text-xs hover:bg-[#F5EBD6] transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                                >
                                    {isLocating ? <Loader2 size={14} className="animate-spin" /> : <Navigation size={14} className="text-[#9E7628]" />}
                                    <span className="hidden sm:inline">موقعي</span>
                                </button>
                            </div>
                        </div>

                        <div className="space-y-1.5 md:col-span-2">
                            <label className="text-xs font-black text-[#5E5242] block">العنوان بالتفصيل</label>
                            <textarea
                                value={form.detailedAddress}
                                onChange={(e) => setForm(prev => ({ ...prev, detailedAddress: e.target.value }))}
                                placeholder="اسم الشارع، رقم المنزل، الدور، أقرب علامة مميزة..."
                                className="w-full px-4 py-3 rounded-2xl coptic-cream-input font-bold text-[#1B2A59] text-sm min-h-20"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-black text-[#5E5242] flex items-center gap-1.5">
                                <Briefcase size={13} className="text-[#9E7628]" /> وظيفة الأب
                            </label>
                            <input
                                type="text"
                                value={form.fatherJob}
                                onChange={(e) => setForm(prev => ({ ...prev, fatherJob: e.target.value }))}
                                placeholder="اختياري"
                                className="w-full px-4 py-3.5 rounded-2xl coptic-cream-input font-bold text-[#1B2A59] text-sm"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-black text-[#5E5242] flex items-center gap-1.5">
                                <HeartHandshake size={13} className="text-[#9E7628]" /> أب الاعتراف
                            </label>
                            <input
                                type="text"
                                value={form.fatherConfessor}
                                onChange={(e) => setForm(prev => ({ ...prev, fatherConfessor: e.target.value }))}
                                placeholder="مثال: القس ..."
                                className="w-full px-4 py-3.5 rounded-2xl coptic-cream-input font-bold text-[#1B2A59] text-sm"
                            />
                        </div>

                        <div className="space-y-1.5 md:col-span-2">
                            <label className="text-xs font-black text-[#5E5242] flex items-center gap-1.5">
                                <StickyNote size={13} className="text-[#9E7628]" /> ملاحظات هامة
                            </label>
                            <textarea
                                value={form.specialNotes}
                                onChange={(e) => setForm(prev => ({ ...prev, specialNotes: e.target.value }))}
                                placeholder="ملاحظات صحية أو أسرية أو مواهب خاصة بالمخدوم..."
                                className="w-full px-4 py-3 rounded-2xl coptic-cream-input font-bold text-[#1B2A59] text-sm min-h-20"
                            />
                        </div>
                    </div>
                </section>

                {/* Actions Footer */}
                <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="sm:flex-1 py-3.5 px-5 rounded-2xl font-black text-sm bg-[#EFE4CF] text-[#5E5242] hover:bg-[#E5D7BF] transition-colors cursor-pointer"
                        >
                            إلغاء
                        </button>
                    )}
                    <button
                        type="submit"
                        disabled={isSaving || isUploadingPhoto}
                        className="sm:flex-2 py-3.5 px-6 rounded-2xl font-black text-sm text-[#FCE9B8] shadow-lg hover:brightness-110 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                        style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 70%, #8C621E 100%)' }}
                    >
                        {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        <span>{editingChild ? 'حفظ التعديلات في سجل الكنيسة' : 'إضافة وحفظ المخدوم في الفصل'}</span>
                    </button>
                </div>
            </form>
        </div>
    );

    if (embedded) return formContent;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-[#0F1B3A]/65 backdrop-blur-sm animate-fade-in"
            onClick={(e) => {
                if (e.target === e.currentTarget && onClose) onClose();
            }}
        >
            {formContent}
        </div>
    );
}

export default function AddStudent(props) {
    return <StudentFormModal embedded {...props} />;
}
