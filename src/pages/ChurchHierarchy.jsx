/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect } from 'react';
import { Church, UserCheck, Users, Shield, Cloud, ChevronDown, ChevronUp, ArrowRight, User } from 'lucide-react';
import { TENANT_CONFIG, getLogoUrl,
    readScopedStorage
} from '../utils/tenantConfig';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';

import { useSmartNavigation } from '../hooks/useSmartNavigation';

export default function ChurchHierarchy() {
    const { goBack } = useSmartNavigation();
    const [isOsrasOpen, setIsOsrasOpen] = useState(false);
    const [appSettings, setAppSettings] = useState({ services: [], servants: [], osraLogo: "", khedmaLogo: "" });

    useEffect(() => {
        try {
            const saved = readScopedStorage('appSettings');
            if (saved) setAppSettings(JSON.parse(saved));
        } catch (err) {
            console.warn("Failed to parse appSettings in ChurchHierarchy:", err);
        }
    }, []);

    const accessScope = resolveUserAccessScope(appSettings, [], { includeFallback: true });
    const allowedSet = new Set(accessScope.allowedSyncKeys || []);
    const scopedServices = (appSettings?.services || []).filter((srv) => {
        if (accessScope.isSuperAdmin) return true;
        return (srv?.osras || []).some((o) => allowedSet.has(o?.syncKey));
    });
    const primaryService = scopedServices[0] || appSettings?.services?.[0] || null;
    const rawAllOsras = (appSettings?.services || []).flatMap((srv) => srv?.osras || []);
    const allOsras = accessScope.isSuperAdmin
        ? rawAllOsras
        : rawAllOsras.filter((o) => allowedSet.has(o?.syncKey));
    const rawAllServants = Array.isArray(appSettings?.servants) ? appSettings.servants : [];
    const allServants = accessScope.isSuperAdmin
        ? rawAllServants
        : rawAllServants.filter((s) => allowedSet.has(s?.syncKey) || allowedSet.has(s?.assignedOsra));

    const mainService = {
        name: accessScope.isStageLeader && accessScope.stageName ? accessScope.stageName : (primaryService?.name || TENANT_CONFIG.churchName),
        priest: primaryService?.priest || (TENANT_CONFIG.PRIESTS?.join('، ') || TENANT_CONFIG.dioceseName || 'الآباء الكهنة'),
        aminKhedma: accessScope.isStageLeader ? (accessScope.servantName || 'أمين المرحلة') : (primaryService?.amin || 'أمين الخدمة العام'),
        logo: getLogoUrl(primaryService?.logo || appSettings.khedmaLogo),
    };

    const colors = ['indigo', 'emerald', 'purple', 'amber', 'sky', 'rose'];

    return (
        <div className="min-h-screen coptic-cream-surface font-sans pb-20" dir="rtl">
            {/* ─── الهيدر ─── */}
            <header className="bg-gradient-to-l from-[#141F45] via-[#1B2A59] to-[#243875] text-white p-4 sticky top-0 z-50 shadow-lg rounded-b-[2.5rem] border-b-2 border-[#C8942E]/40">
                <div className="max-w-4xl mx-auto flex items-center gap-3">
                    <button onClick={() => goBack('/')} className="w-10 h-10 bg-white/10 hover:bg-white/20 text-[#F4D078] rounded-full flex items-center justify-center transition-all shrink-0 border border-white/15 cursor-pointer">
                        <ArrowRight size={20} />
                    </button>
                    <div>
                        <h1 className="text-lg font-black flex items-center gap-2 text-[#F4D078]">
                            <Church size={20} /> هيكل الخدمة والكنيسة
                        </h1>
                        <p className="text-xs font-bold text-[#FBF6EB]/80">{TENANT_CONFIG.churchShortName}</p>
                    </div>
                </div>
            </header>

            <main className="p-4 max-w-2xl mx-auto mt-6 animate-in slide-in-from-bottom-8 duration-500">
                {/* ─── كارت الخدمة الأم (الرئيسي) ─── */}
                <div
                    onClick={() => setIsOsrasOpen(!isOsrasOpen)}
                    className="coptic-card rounded-[2.5rem] p-6 border-2 border-[#C8942E]/35 cursor-pointer hover:border-[#C8942E] transition-all duration-300 relative overflow-hidden group"
                >
                    <div className="absolute top-0 right-0 w-full h-2 bg-linear-to-r from-[#1B2A59] via-[#C8942E] to-[#1B2A59]"></div>

                    <div className="flex flex-col items-center text-center mt-2">
                        {mainService.logo ? (
                            <img
                                src={mainService.logo}
                                alt={mainService.name}
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                className="w-24 h-24 rounded-full border-4 border-[#F4D078]/60 shadow-md mb-4 object-cover group-hover:scale-105 transition-transform"
                            />
                        ) : (
                            <div className="w-24 h-24 rounded-full border-4 border-[#F4D078]/60 shadow-md mb-4 bg-[#F5EBD6] flex items-center justify-center text-4xl font-black text-[#1B2A59] group-hover:scale-105 transition-transform">
                                <Church size={36} />
                            </div>
                        )}
                        <h2 className="text-2xl font-black text-[#1B2A59] mb-4">{mainService.name}</h2>

                        <div className="flex w-full gap-2">
                            <div className="flex-1 bg-[#FAF4E8] p-3 rounded-2xl border border-[#E5D7BF]">
                                <Shield className="text-[#C8942E] mx-auto mb-1" size={20} />
                                <span className="block text-[10px] font-bold text-[#6E604F]">أب الاعتراف / المسئول</span>
                                <span className="block text-sm font-black text-[#1B2A59]">{mainService.priest}</span>
                            </div>
                            <div className="flex-1 bg-[#FAF4E8] p-3 rounded-2xl border border-[#E5D7BF]">
                                <UserCheck className="text-[#1B2A59] mx-auto mb-1" size={20} />
                                <span className="block text-[10px] font-bold text-[#6E604F]">أمين الخدمة</span>
                                <span className="block text-sm font-black text-[#1B2A59]">{mainService.aminKhedma}</span>
                            </div>
                        </div>

                        <div className="mt-6 flex items-center gap-2 text-[#1B2A59] font-black bg-[#F5EBD6] border border-[#DFC99B] px-6 py-2 rounded-full">
                            {isOsrasOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                            {isOsrasOpen ? 'إخفاء الأسر' : `عرض الأسر التابعة للخدمة (${allOsras.length})`}
                        </div>
                    </div>
                </div>

                {/* ─── الأسر التابعة (تظهر عند الضغط) ─── */}
                {isOsrasOpen && (
                    <div className="mt-6 space-y-6 animate-in slide-in-from-top-4 duration-300">
                        {allOsras.length === 0 ? (
                            <div className="coptic-card rounded-3xl p-6 text-center text-[#6E604F] font-bold text-sm">
                                لم يتم إضافة فصول أو أسر حتى الآن. يمكن لأمين النظام إضافتها من لوحة التحكم.
                            </div>
                        ) : (
                            allOsras.map((osra, idx) => {
                                const color = colors[idx % colors.length];
                                const osraServants = allServants.filter(
                                    (s) => s.syncKey === osra.syncKey || s.assignedOsra === osra.name
                                );
                                return (
                                    <div key={osra.id || osra.syncKey || idx} className="coptic-card rounded-4xl p-5 border-2 border-[#E3D6BF] relative">
                                        <div className="absolute -top-3 left-6 bg-[#1B2A59] text-[#F4D078] border border-[#C8942E]/40 px-3 py-1 rounded-full text-[10px] font-black shadow-sm flex items-center gap-1">
                                            <Cloud size={12} /> كود المزامنة: {osra.syncKey}
                                        </div>

                                        <div className="flex items-center gap-3 border-b border-[#EDE3CE] pb-4 mb-4 mt-2">
                                            <div className="w-12 h-12 rounded-2xl bg-[#F5EBD6] text-[#1B2A59] flex items-center justify-center">
                                                <Users size={24} />
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-black text-[#1B2A59]">{osra.name}</h3>
                                                <p className="text-[10px] font-bold text-[#6E604F]">قاعدة بيانات مفصولة بمفتاح المزامنة ({color})</p>
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="text-xs font-black text-[#6E604F] mb-3 flex items-center gap-1">
                                                <User size={14} /> خدام الأسرة
                                            </h4>
                                            {osraServants.length === 0 ? (
                                                <p className="text-xs text-[#8C7D68] font-bold">لم يتم تسجيل خدام لهذه الأسرة بعد</p>
                                            ) : (
                                                <div className="grid grid-cols-2 gap-2">
                                                    {osraServants.map((servant, i) => (
                                                        <div key={servant.id || i} className="bg-[#FAF4E8] p-2.5 rounded-xl border border-[#E5D7BF] flex flex-col">
                                                            <span className="text-[10px] font-bold text-[#8B6217] mb-0.5">{servant.role || 'خادم'}</span>
                                                            <span className="text-xs font-black text-[#1B2A59]">{servant.name}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
