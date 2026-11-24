import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers } from 'lucide-react';
import {
    EDITION_CONFIG,
    getAppEdition,
    isStandaloneEditionBuild,
} from '../utils/tenantConfig';
import { switchPreviewAppEdition } from '../utils/notificationScopeEngine';

const EDITION_ITEMS = [
    EDITION_CONFIG.admin,
    EDITION_CONFIG.servant,
    EDITION_CONFIG.parent,
    EDITION_CONFIG.all,
];

/**
 * شريط معاينة نسخ التطبيق الثلاث (تطبيق الأدمن | تطبيق الخادم/ة | تطبيق ولي الأمر | العرض الشامل)
 * يظهر حصرياً في النسخة الشاملة الموحدة ويختفي تماماً عند بناء أي تطبيق مستقل
 */
export default function EditionPreviewBar({
    activeEdition = getAppEdition(),
    onEditionChanged = null,
    variant = 'dark',
    compact = false,
}) {
    const navigate = useNavigate();

    if (isStandaloneEditionBuild()) return null;

    const isDark = variant === 'dark';

    const handleSelect = (editionId) => {
        const applied = switchPreviewAppEdition(editionId, navigate);
        if (typeof onEditionChanged === 'function') {
            onEditionChanged(applied);
        }
    };

    return (
        <div
            data-testid="edition-preview-bar"
            className={`rounded-3xl border transition-all ${
                compact ? 'p-2.5' : 'p-3.5 sm:p-4'
            } ${
                isDark
                    ? 'bg-white/10 border-amber-300/30 text-white'
                    : 'bg-[#FAF3E4]/95 border-[#DFC48F] text-[#1B2A59]'
            }`}
            dir="rtl"
        >
            <div className="flex items-center justify-between gap-2 mb-2.5">
                <span className={`text-[11px] sm:text-xs font-black flex items-center gap-1.5 min-w-0 ${isDark ? 'text-amber-200' : 'text-[#1B2A59]'}`}>
                    <Layers size={14} className={isDark ? 'text-amber-300 shrink-0' : 'text-[#C8942E] shrink-0'} />
                    <span className="truncate">معاينة نسخ التطبيق الثلاث (3 Apps)</span>
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${
                    isDark ? 'bg-amber-400/20 text-amber-100' : 'bg-[#1B2A59]/10 text-[#1B2A59]'
                }`}>
                    {EDITION_CONFIG[activeEdition]?.badgeLabel || 'الكل'}
                </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {EDITION_ITEMS.map((item) => {
                    const isActive = activeEdition === item.id;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            data-edition-btn={item.id}
                            onClick={() => handleSelect(item.id)}
                            className={`flex items-center gap-2 px-2.5 py-2 rounded-2xl border text-right transition-all cursor-pointer active:scale-95 ${
                                isActive
                                    ? isDark
                                        ? 'bg-amber-400 text-[#162447] border-amber-200 shadow-md'
                                        : 'bg-[#1B2A59] text-amber-100 border-[#1B2A59] shadow-md'
                                    : isDark
                                        ? 'bg-white/8 hover:bg-white/18 text-white border-white/15'
                                        : 'bg-white/90 hover:bg-[#EFE0C2] text-[#1B2A59] border-[#DFC48F]'
                            }`}
                        >
                            <img
                                src={item.logoUrl}
                                alt={item.shortLabel}
                                className="w-8 h-8 rounded-full bg-white object-contain p-0.5 border border-amber-300/60 shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                                <div className="text-[11px] font-black leading-tight truncate">{item.shortLabel}</div>
                                <div className={`text-[9px] font-bold truncate ${
                                    isActive
                                        ? isDark ? 'text-[#162447]/80' : 'text-amber-200'
                                        : isDark ? 'text-indigo-100/75' : 'text-[#6E5329]'
                                }`}>
                                    {item.badgeLabel}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
