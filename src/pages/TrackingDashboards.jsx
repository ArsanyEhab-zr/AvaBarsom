import React, { useState } from 'react';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { Calendar, UserCheck, UserX, Clock, Printer } from 'lucide-react';
import { readScopedStorage } from '../utils/tenantConfig';

export default function TrackingDashboards() {
    const [activeTab, setActiveTab] = useState('visitation');

    const appSettingsStr = readScopedStorage('appSettings');
    const appSettings = appSettingsStr ? JSON.parse(appSettingsStr) : {};
    const accessScope = resolveUserAccessScope(appSettings, [], { includeFallback: true });
    const allowedSyncKeys = accessScope.allowedSyncKeys || [];
    const allowedKeySig = allowedSyncKeys.join('|');

    const children = useLiveQuery(async () => {
        if (accessScope.isParent || accessScope.isGuest) return [];
        const allowedSet = new Set(allowedSyncKeys);
        let kids = accessScope.isSuperAdmin
            ? await db.children.toArray()
            : (allowedSyncKeys.length > 0
                ? await db.children.where('syncKey').anyOf(allowedSyncKeys).toArray()
                : []);
        kids = kids.filter(c => !c.isDeleted);

        if (accessScope.isSuperAdmin && allowedSet.size > 0) {
            kids = kids.filter(c => allowedSet.has(c.syncKey));
        }
        return kids;
    }, [accessScope.isSuperAdmin, accessScope.isParent, accessScope.isGuest, allowedKeySig]) || [];

    let servants = appSettings.servants || [];
    if (!accessScope.isSuperAdmin) {
        const allowedSet = new Set(allowedSyncKeys);
        servants = servants.filter(s => allowedSet.has(s.syncKey) || allowedSet.has(s.osraName));
    }

    const allPeople = [...children, ...servants];

    const renderVisitation = () => {
        const recentlyVisited = allPeople.filter(p => p.visitationParticipation);
        const forgotten = allPeople.filter(p => !p.visitationParticipation);

        return (
            <div className="space-y-6">
                <div className="flex gap-4 mb-4 no-print">
                    <button type="button" onClick={() => window.print()} className="bg-[#1B2A59] text-amber-100 px-4 py-2 rounded-xl text-sm font-black shadow-md hover:bg-[#142047] inline-flex items-center gap-2 cursor-pointer">
                        <Printer size={16} className="text-amber-300" /> طباعة التقرير
                    </button>
                </div>
                <div>
                    <h4 className="font-black text-emerald-800 bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl mb-2 flex items-center gap-2"><UserCheck size={18} /> تم الافتقاد حديثاً ({recentlyVisited.length})</h4>
                    <table className="w-full text-right text-sm">
                        <thead className="bg-[#FAF3E3] text-[#1B2A59]">
                            <tr>
                                <th className="p-2 border-b border-[#DFC48F]">الاسم</th>
                                <th className="p-2 border-b border-[#DFC48F]">النوع</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recentlyVisited.map(p => (
                                <tr key={p.id} className="border-b border-[#EFE0C2] hover:bg-[#FAF3E3]/50">
                                    <td className="p-2 font-bold text-[#1B2A59]">{p.name}</td>
                                    <td className="p-2 text-[#6E5329]">{p.gender}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div>
                    <h4 className="font-black text-rose-800 bg-rose-50 border border-rose-200 p-2.5 rounded-xl mb-2 flex items-center gap-2"><UserX size={18} /> منسي / يحتاج افتقاد ({forgotten.length})</h4>
                    <table className="w-full text-right text-sm">
                        <thead className="bg-[#FAF3E3] text-[#1B2A59]">
                            <tr>
                                <th className="p-2 border-b border-[#DFC48F]">الاسم</th>
                                <th className="p-2 border-b border-[#DFC48F]">النوع</th>
                                <th className="p-2 border-b border-[#DFC48F]">رقم الهاتف</th>
                            </tr>
                        </thead>
                        <tbody>
                            {forgotten.map(p => (
                                <tr key={p.id} className="border-b border-[#EFE0C2] hover:bg-[#FAF3E3]/50">
                                    <td className="p-2 font-bold text-[#1B2A59]">{p.name}</td>
                                    <td className="p-2 text-[#6E5329]">{p.gender}</td>
                                    <td className="p-2 text-[#6E5329]" dir="ltr">{p.phone || 'غير مسجل'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderConfession = () => {
        const today = new Date();
        const overdue = allPeople.filter(p => {
            if (!p.lastConfessionDate) return true;
            const cDate = new Date(p.lastConfessionDate);
            const diffDays = Math.ceil((today - cDate) / (1000 * 60 * 60 * 24));
            return diffDays > 45;
        });
        const active = allPeople.filter(p => !overdue.includes(p));

        return (
            <div className="space-y-6">
                <div className="flex gap-4 mb-4 no-print">
                    <button type="button" onClick={() => window.print()} className="bg-[#1B2A59] text-amber-100 px-4 py-2 rounded-xl text-sm font-black shadow-md hover:bg-[#142047] inline-flex items-center gap-2 cursor-pointer">
                        <Printer size={16} className="text-amber-300" /> طباعة التقرير
                    </button>
                </div>
                <div>
                    <h4 className="font-black text-rose-800 bg-rose-50 border border-rose-200 p-2.5 rounded-xl mb-2 flex items-center gap-2"><Clock size={18} /> متأخر عن الاعتراف ({overdue.length})</h4>
                    <table className="w-full text-right text-sm">
                        <thead className="bg-[#FAF3E3] text-[#1B2A59]">
                            <tr>
                                <th className="p-2 border-b border-[#DFC48F]">الاسم</th>
                                <th className="p-2 border-b border-[#DFC48F]">آخر اعتراف</th>
                            </tr>
                        </thead>
                        <tbody>
                            {overdue.map(p => (
                                <tr key={p.id} className="border-b border-[#EFE0C2] hover:bg-[#FAF3E3]/50">
                                    <td className="p-2 font-bold text-[#1B2A59]">{p.name}</td>
                                    <td className="p-2 text-rose-700 font-bold">{p.lastConfessionDate || 'لم يعترف من قبل'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div>
                    <h4 className="font-black text-emerald-800 bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl mb-2 flex items-center gap-2"><UserCheck size={18} /> مواظب ({active.length})</h4>
                    <table className="w-full text-right text-sm">
                        <thead className="bg-[#FAF3E3] text-[#1B2A59]">
                            <tr>
                                <th className="p-2 border-b border-[#DFC48F]">الاسم</th>
                                <th className="p-2 border-b border-[#DFC48F]">آخر اعتراف</th>
                            </tr>
                        </thead>
                        <tbody>
                            {active.map(p => (
                                <tr key={p.id} className="border-b border-[#EFE0C2] hover:bg-[#FAF3E3]/50">
                                    <td className="p-2 font-bold text-[#1B2A59]">{p.name}</td>
                                    <td className="p-2 text-emerald-700 font-bold">{p.lastConfessionDate}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <div className="coptic-card rounded-3xl shadow-sm border border-[#DFC48F] p-5" dir="rtl">
            <h2 className="font-calligraphic text-xl font-bold text-[#1B2A59] mb-5 flex items-center gap-2 no-print">
                <Calendar className="text-[#C8942E]" /> لوحة المتابعة والتقارير
            </h2>

            <div className="flex gap-2 border-b border-[#DFC48F] pb-4 mb-6 no-print">
                <button
                    type="button"
                    onClick={() => setActiveTab('visitation')}
                    className={`px-4 py-2 rounded-full font-black text-sm transition-all cursor-pointer ${activeTab === 'visitation' ? 'bg-[#1B2A59] text-amber-100 shadow-md' : 'bg-[#FAF3E3] text-[#6E5329] hover:bg-amber-100 border border-[#DFC48F]'}`}
                >
                    تقرير الافتقاد
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('confession')}
                    className={`px-4 py-2 rounded-full font-black text-sm transition-all cursor-pointer ${activeTab === 'confession' ? 'bg-[#1B2A59] text-amber-100 shadow-md' : 'bg-[#FAF3E3] text-[#6E5329] hover:bg-amber-100 border border-[#DFC48F]'}`}
                >
                    تقرير الاعتراف
                </button>
            </div>

            <div className="print-only-container">
                {activeTab === 'visitation' ? renderVisitation() : renderConfession()}
            </div>
        </div>
    );
}
