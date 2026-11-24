import React, { useState } from 'react';
import { X, Trophy, Plus, Sparkles, Trash2, BookOpen, Church, Gift } from 'lucide-react';
import {
    POINTS_PRESETS,
    POINT_CATEGORY_LABELS,
    awardPointsToChild,
    deletePointsLog,
    formatArabicMonthKey
} from '../utils/pointsEngine';
import { getLocalDateString } from '../utils/serviceWeek';

export default function PointsManagerModal({
    isOpen,
    onClose,
    child,
    monthKey,
    childLogs = [],
    totalPoints = 0
}) {
    const [customPoints, setCustomPoints] = useState('10');
    const [customReason, setCustomReason] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    if (!isOpen || !child) return null;

    const handleQuickGrant = async (preset) => {
        setIsSaving(true);
        try {
            await awardPointsToChild({
                child,
                points: preset.points,
                category: preset.key,
                reason: preset.reason,
                date: getLocalDateString(new Date())
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleCustomSubmit = async (e) => {
        e.preventDefault();
        const pts = Number(customPoints);
        if (!Number.isFinite(pts) || pts === 0) return;
        setIsSaving(true);
        try {
            await awardPointsToChild({
                child,
                points: pts,
                category: 'custom',
                reason: customReason.trim() || 'نقاط إضافية مخصصة',
                date: getLocalDateString(new Date())
            });
            setCustomReason('');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[140] bg-slate-950/55 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in" dir="rtl">
            <div className="bg-[#FAF7F2] w-full max-w-lg rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl border border-amber-200 max-h-[90vh] flex flex-col overflow-hidden">
                <div className="bg-[#1B2A59] text-white p-5 flex items-center justify-between gap-3 shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/50 text-amber-300 flex items-center justify-center shrink-0">
                            <Trophy size={24} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="font-calligraphic text-xl font-bold truncate">{child.name}</h2>
                            <p className="text-xs font-bold text-amber-200 mt-0.5">
                                رصيد {formatArabicMonthKey(monthKey)}: <span className="text-sm text-white tabular-nums">{totalPoints} نقطة</span>
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="إغلاق"
                        className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer transition-colors shrink-0"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-5 overflow-y-auto space-y-5">
                    <div>
                        <h3 className="text-sm font-black text-[#1B2A59] mb-2.5 flex items-center gap-1.5">
                            <Sparkles size={16} className="text-amber-600" /> منح مكافأة فورية بضغطة واحدة
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => handleQuickGrant(POINTS_PRESETS.DISCIPLINE)}
                                className="min-h-[46px] bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300 px-3 py-2 rounded-2xl text-xs font-black cursor-pointer transition-all active:scale-95 flex items-center justify-center gap-1.5"
                            >
                                <Sparkles size={14} className="text-amber-600" />
                                <span>التزام وهدوء (+5)</span>
                            </button>
                            <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => handleQuickGrant(POINTS_PRESETS.MEMORIZATION)}
                                className="min-h-[46px] bg-indigo-50 hover:bg-indigo-100 text-indigo-950 border border-indigo-200 px-3 py-2 rounded-2xl text-xs font-black cursor-pointer transition-all active:scale-95 flex items-center justify-center gap-1.5"
                            >
                                <BookOpen size={14} className="text-indigo-600" />
                                <span>حفظ ومشاركة (+10)</span>
                            </button>
                            <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => handleQuickGrant(POINTS_PRESETS.EARLY_ARRIVAL)}
                                className="min-h-[46px] bg-emerald-50 hover:bg-emerald-100 text-emerald-950 border border-emerald-200 px-3 py-2 rounded-2xl text-xs font-black cursor-pointer transition-all active:scale-95 flex items-center justify-center gap-1.5"
                            >
                                <Church size={14} className="text-emerald-600" />
                                <span>حضور مبكر (+5)</span>
                            </button>
                        </div>
                    </div>

                    <form onSubmit={handleCustomSubmit} className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
                        <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5"><Gift size={14} className="text-[#C8942E]" /> نقاط إضافية مخصصة</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                                type="number"
                                min="1"
                                max="500"
                                value={customPoints}
                                onChange={(e) => setCustomPoints(e.target.value)}
                                className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 font-black text-sm text-slate-900 text-center"
                                placeholder="النقاط"
                            />
                            <input
                                type="text"
                                value={customReason}
                                onChange={(e) => setCustomReason(e.target.value)}
                                className="sm:col-span-2 min-h-[44px] px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 font-bold text-sm text-slate-900"
                                placeholder="السبب (مثال: مسابقة الإنجيل / مشاركة مميزة)"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="w-full min-h-[44px] bg-[#1B2A59] hover:bg-slate-900 text-white rounded-xl font-black text-sm flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                        >
                            <Plus size={18} /> إضافة النقاط الآن
                        </button>
                    </form>

                    <div>
                        <h4 className="text-xs font-black text-slate-700 mb-2">سجل نقاط الشهر ({childLogs.length})</h4>
                        {childLogs.length === 0 ? (
                            <p className="text-xs font-bold text-slate-500 text-center bg-white p-4 rounded-2xl border border-slate-200">
                                لا توجد نقاط مسجلة لهذا المخدوم في هذا الشهر بعد.
                            </p>
                        ) : (
                            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                {childLogs.map((log) => (
                                    <div key={log.id} className="bg-white p-3 rounded-2xl border border-slate-200 flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="text-xs sm:text-sm font-black text-slate-900 truncate">
                                                {log.reason || POINT_CATEGORY_LABELS[log.category] || 'نقاط'}
                                            </div>
                                            <div className="text-[11px] font-bold text-slate-500 mt-0.5">
                                                {log.date} • بواسطة: {log.awardedBy || 'الخادم'}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1 rounded-xl text-xs font-black tabular-nums">
                                                +{log.points}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => deletePointsLog(log.id)}
                                                title="حذف النقاط"
                                                aria-label="حذف سجل النقاط"
                                                className="w-8 h-8 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 flex items-center justify-center cursor-pointer"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
