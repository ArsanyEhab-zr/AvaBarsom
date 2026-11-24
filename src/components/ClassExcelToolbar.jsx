import React, { useState } from 'react';
import { Download, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import ExcelImporter, { downloadBlankClassExcelTemplate } from './ExcelImporter';
import ExcelExporter from './ExcelExporter';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
import { resolveScopedClassTarget } from '../utils/excelClassHelpers';
import { readScopedStorage } from '../utils/tenantConfig';

const readLocalAppSettings = () => {
    try {
        return JSON.parse(readScopedStorage('appSettings') || '{}') || {};
    } catch {
        return {};
    }
};

export default function ClassExcelToolbar({
    syncKey: propSyncKey = '',
    osraName: propOsraName = '',
    className = '',
    onImported = null
}) {
    const appSettings = readLocalAppSettings();
    const accessScope = resolveUserAccessScope(appSettings, [], { includeFallback: true });
    const initialTarget = resolveScopedClassTarget({
        explicitSyncKey: propSyncKey,
        explicitOsraName: propOsraName,
        accessScope,
        appSettings
    });

    const [selectedSyncKey, setSelectedSyncKey] = useState(
        () => initialTarget.syncKey || accessScope.allowedOsras?.[0]?.syncKey || ''
    );
    const [templateFeedback, setTemplateFeedback] = useState('');

    if (accessScope.isParent || accessScope.isGuest) {
        return null;
    }

    const effectiveSyncKey = propSyncKey || selectedSyncKey || initialTarget.syncKey || '';
    const activeTarget = resolveScopedClassTarget({
        explicitSyncKey: effectiveSyncKey,
        explicitOsraName: propOsraName,
        accessScope,
        appSettings
    });

    const showClassSelector = !propSyncKey && Array.isArray(accessScope.allowedOsras) && accessScope.allowedOsras.length > 1;

    const handleDownloadTemplate = () => {
        const filename = downloadBlankClassExcelTemplate(activeTarget.osraName, activeTarget.syncKey);
        setTemplateFeedback(`تم تنزيل التمبليت القياسي: ${filename}`);
        setTimeout(() => setTemplateFeedback(''), 4000);
    };

    return (
        <div className={`coptic-card rounded-3xl p-4 border border-[#DFC99B] shadow-sm space-y-3 ${className}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-[#F5EBD6] border border-[#DFC99B] text-[#1B2A59] flex items-center justify-center shrink-0">
                        <FileSpreadsheet size={18} />
                    </div>
                    <div>
                        <h3 className="text-xs sm:text-sm font-black text-[#1B2A59]">
                            أدوات الإكسيل الذكية ({activeTarget.osraName})
                        </h3>
                        <p className="text-[11px] font-bold text-[#6E604F]">
                            تمبليت قياسي، استيراد مجمّع، وتصدير شامل للبيانات والحضور
                        </p>
                    </div>
                </div>

                {showClassSelector && (
                    <select
                        value={effectiveSyncKey}
                        onChange={(e) => setSelectedSyncKey(e.target.value)}
                        aria-label="اختيار الفصل لإجراءات الإكسيل"
                        className="px-3 py-2 rounded-xl bg-[#FFFDF7] border border-[#DFC99B] text-xs font-black text-[#1B2A59] focus:outline-none focus:border-[#C8942E]"
                    >
                        {accessScope.allowedOsras.map((osra) => (
                            <option key={osra.syncKey} value={osra.syncKey}>
                                {osra.name}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-start">
                <div>
                    <button
                        type="button"
                        onClick={handleDownloadTemplate}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-[#FAF4E8] border border-[#DFC99B] text-[#1B2A59] font-black text-xs hover:bg-[#F5EBD6] transition-all tactile-press cursor-pointer shadow-xs"
                    >
                        <Download size={16} />
                        <span>تحميل تمبليت فارغ</span>
                    </button>
                    {templateFeedback && (
                        <div className="mt-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-bold flex items-center gap-1.5">
                            <CheckCircle2 size={13} className="shrink-0" />
                            <span className="truncate">{templateFeedback}</span>
                        </div>
                    )}
                </div>

                <ExcelImporter
                    syncKey={activeTarget.syncKey}
                    osraName={activeTarget.osraName}
                    variant="compact"
                    onImported={onImported}
                />

                <ExcelExporter
                    syncKey={activeTarget.syncKey}
                    osraName={activeTarget.osraName}
                    variant="compact"
                />
            </div>
        </div>
    );
}
