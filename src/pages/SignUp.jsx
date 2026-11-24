import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { doc, getDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { firestore } from '../db/firebase';
import { ShieldCheck, UserPlus, Loader2, Phone, Lock, User, Layers, ImagePlus } from 'lucide-react';
import { uploadImageToCloudinary, uploadImageWithFallback } from '../utils/cloudinary';
import { readScopedStorage, writeScopedStorage } from '../utils/tenantConfig';

export default function SignUp() {
    const navigate = useNavigate();
    const [services, setServices] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // بيانات الفورم
    const [formData, setFormData] = useState({
        name: '', phone: '',
        selectedService: '', selectedOsra: '',
        profileImage: ''
    });
    const [isUploadingImg, setIsUploadingImg] = useState(false);

    // جلب الخدمات والأسر من الفايربيز مع دعم الوضع المحلي
    useEffect(() => {
        const fetchServices = async () => {
            if (!firestore) {
                try {
                    const localSettings = JSON.parse(readScopedStorage('appSettings') || '{}');
                    setServices((localSettings.services || []).filter(s => s.name));
                } catch {
                    setServices([]);
                }
                setIsLoading(false);
                return;
            }
            try {
                const snap = await getDoc(doc(firestore, "System", "mainConfig"));
                if (snap.exists()) {
                    const data = snap.data();
                    const fetchedServices = (data.services || []).filter(s => s.name);
                    setServices(fetchedServices);
                } else {
                    console.warn("No mainConfig document found in Firestore.");
                }
            } catch (error) {
                console.error("خطأ في جلب الخدمات:", error);
                alert("تأكد من اتصالك بالإنترنت وحاول مرة أخرى.");
            }
            setIsLoading(false);
        };
        fetchServices();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.selectedService || !formData.selectedOsra) {
            alert("لازم تختار الخدمة والأسرة!"); return;
        }

        if (!firestore) {
            setIsSubmitting(true);
            try {
                const existing = JSON.parse(readScopedStorage('demoJoinRequests') || '[]');
                existing.push({
                    id: `demo_join_${Date.now()}`,
                    name: formData.name,
                    phone: formData.phone,
                    serviceName: formData.selectedService,
                    osraName: formData.selectedOsra,
                    profileImage: formData.profileImage,
                    status: 'pending',
                    createdAt: new Date().toISOString()
                });
                writeScopedStorage('demoJoinRequests', JSON.stringify(existing));
                alert("تم تسجيل طلب الانضمام محلياً في الوضع التجريبي بنجاح! في انتظار مراجعة أمين الخدمة.");
                navigate('/login');
            } finally {
                setIsSubmitting(false);
            }
            return;
        }
        setIsSubmitting(true);
        try {
            await addDoc(collection(firestore, "JoinRequests"), {
                name: formData.name,
                phone: formData.phone,
                serviceName: formData.selectedService,
                osraName: formData.selectedOsra,
                profileImage: formData.profileImage,
                status: "pending",
                createdAt: serverTimestamp()
            });
            alert("تم إرسال طلبك بنجاح! في انتظار موافقة أمين الخدمة أو الكاهن.");
            navigate('/login');
        } catch (error) {
            console.error("خطأ:", error);
            alert("حصلت مشكلة أثناء إرسال الطلب.");
        }
        setIsSubmitting(false);
    };

    return (
        <main className="min-h-screen coptic-cream-surface flex flex-col justify-center items-center p-4" dir="rtl">
            <div className="coptic-card p-8 rounded-[2.5rem] border border-[#E5D7BF] w-full max-w-md">
                <div className="w-16 h-16 bg-gradient-to-br from-[#1B2A59] to-[#243875] text-[#F4D078] rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-[#C8942E]/40 shadow-md">
                    <UserPlus size={30} />
                </div>
                <h1 className="text-2xl font-black text-center text-[#1B2A59] mb-2">طلب انضمام للخدمة</h1>
                <p className="text-sm text-center text-[#6E604F] mb-8 font-bold">برجاء إدخال بياناتك بدقة لاختيار أسرتك</p>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-10">
                        <Loader2 className="animate-spin text-[#C8942E] mb-2" size={30} />
                        <span className="text-[#6E604F] font-bold text-sm">جاري تحميل الخدمات...</span>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* الاسم */}
                        <div className="relative">
                            <User className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8C7D68]" size={20} />
                            <input type="text" required placeholder="الاسم الثلاثي"
                                className="w-full pl-4 pr-12 py-3 rounded-2xl coptic-cream-input font-bold text-sm"
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
                        </div>

                        {/* التليفون */}
                        <div className="relative">
                            <Phone className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8C7D68]" size={20} />
                            <input type="tel" required placeholder="رقم الهاتف (اليوزرنيم)"
                                className="w-full pl-4 pr-12 py-3 rounded-2xl coptic-cream-input font-bold text-sm"
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
                        </div>

                        {/* رفع الصورة الشخصية */}
                        <div className="relative bg-[#FAF4E8] border border-[#E3D6BF] rounded-2xl p-4 flex flex-col items-center justify-center gap-3">
                            {formData.profileImage ? (
                                <div className="relative w-20 h-20">
                                    <img 
                                        src={formData.profileImage} 
                                        alt="Profile" 
                                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                        className="w-full h-full rounded-full object-cover border-2 border-[#C8942E] shadow-md" 
                                    />
                                </div>
                            ) : (
                                <div className="w-16 h-16 rounded-full bg-[#EFE4CF] flex items-center justify-center text-[#8C7D68]">
                                    <User size={28} />
                                </div>
                            )}
                            
                            <label className="cursor-pointer bg-[#1B2A59] text-[#F4D078] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 hover:bg-[#243875] transition-colors">
                                {isUploadingImg ? <Loader2 className="animate-spin" size={16} /> : <ImagePlus size={16} />}
                                {isUploadingImg ? "جاري الرفع..." : "اختر صورة شخصية"}
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    className="hidden" 
                                    onChange={async (e) => {
                                        const file = e.target.files[0];
                                        if (file) {
                                            setIsUploadingImg(true);
                                            try {
                                                const url = await uploadImageWithFallback(file, 'image');
                                                setFormData({ ...formData, profileImage: url });
                                            } catch (error) {
                                                console.error(error);
                                                alert("فشل معالجة الصورة الشخصية.");
                                            }
                                            setIsUploadingImg(false);
                                        }
                                    }}
                                />
                            </label>
                        </div>


                        {/* اختيار الخدمة */}
                        <div className="relative">
                            <Layers className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8C7D68]" size={20} />
                            <select required className="w-full pl-4 pr-12 py-3 rounded-2xl coptic-cream-input font-bold text-sm appearance-none"
                                onChange={(e) => setFormData({ ...formData, selectedService: e.target.value, selectedOsra: '' })}>
                                <option value="">-- اختر الخدمة --</option>
                                {services.map((srv, idx) => (
                                    <option key={idx} value={srv.name || ''}>{srv.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* اختيار الأسرة */}
                        {formData.selectedService && (
                            <div className="relative animate-in fade-in slide-in-from-top-2">
                                <ShieldCheck className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8C7D68]" size={20} />
                                <select required className="w-full pl-4 pr-12 py-3 rounded-2xl coptic-cream-input font-bold text-sm appearance-none"
                                    onChange={(e) => setFormData({ ...formData, selectedOsra: e.target.value })}>
                                    <option value="">-- اختر الأسرة --</option>
                                    {services.find(s => s.name === formData.selectedService)?.osras.map((osra, idx) => (
                                        <option key={idx} value={osra.name || ''}>{osra.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <button type="submit" disabled={isSubmitting} className="w-full py-4 mt-2 rounded-2xl bg-gradient-to-l from-[#1B2A59] to-[#243875] text-[#F4D078] font-black hover:opacity-95 transition-all flex justify-center items-center gap-2 active:scale-95 shadow-md cursor-pointer">
                            {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : "إرسال طلب الانضمام"}
                        </button>
                    </form>
                )}

                <div className="mt-6 text-center">
                    <Link to="/login" className="text-sm font-bold text-[#1B2A59] hover:text-[#C8942E] hover:underline">لديك حساب بالفعل؟ تسجيل الدخول</Link>
                </div>
            </div>
        </main>
    );
}