import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { db } from '../db/database';
import { Download, Loader2, FileSpreadsheet, CheckCircle2, AlertCircle } from 'lucide-react';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
import {
    buildClassExcelExportRows,
    formatClassMonthlyExcelFilename,
    resolveScopedClassTarget
} from '../utils/excelClassHelpers';
import { readScopedStorage } from '../utils/tenantConfig';

// eslint-disable-next-line react-refresh/only-export-components
export { formatClassMonthlyExcelFilename };

const SHEET1_COLS = [
    { wch: 22 }, // كود المخدوم
    { wch: 22 }, // كود الـ QR الخاص
    { wch: 28 }, // الاسم بالكامل
    { wch: 10 }, // النوع
    { wch: 15 }, // تاريخ الميلاد
    { wch: 22 }, // الفصل / الأسرة
    { wch: 16 }, // تليفون الأم
    { wch: 16 }, // تليفون الأب
    { wch: 16 }, // تليفون المخدوم
    { wch: 16 }, // الواتساب للتواصل
    { wch: 36 }, // المنطقة والعنوان
    { wch: 22 }, // أب الاعتراف
    { wch: 18 }, // حضور الخدمة (الشهر الحالي)
    { wch: 18 }, // غياب الخدمة (الشهر الحالي)
    { wch: 18 }, // حضور القداس (الشهر الحالي)
    { wch: 18 }, // إجمالي حضور الخدمة
    { wch: 18 }, // إجمالي غياب الخدمة
    { wch: 18 }, // إجمالي حضور القداس
    { wch: 36 }, // تواريخ الحضور بالشهر الحالي
    { wch: 18 }, // حالة الأسبوع الحالي
    { wch: 16 }, // المواظبة المتتالية
    { wch: 16 }, // نقاط الشهر الحالي
    { wch: 28 }, // آخر افتقاد ونوعه
    { wch: 32 }, // ملاحظات هامة
    { wch: 44 }  // رابط الصورة (Cloudinary)
];

const SHEET2_HEADERS = [
    'التاريخ',
    'اليوم',
    'نوع النشاط',
    'كود الـ QR الخاص',
    'اسم المخدوم',
    'الفصل / الأسرة',
    'الحالة',
    'ملاحظات الافتقاد'
];

const SHEET2_COLS = [
    { wch: 14 },
    { wch: 12 },
    { wch: 18 },
    { wch: 22 },
    { wch: 28 },
    { wch: 22 },
    { wch: 14 },
    { wch: 34 }
];

export default function ExcelExporter({
    variant = 'default',
    className = '',
    syncKey: propSyncKey = '',
    osraName: propOsraName = ''
}) {
    const [isExporting, setIsExporting] = useState(false);
    const [statusNote, setStatusNote] = useState(null);

    const handleExport = async () => {
        setIsExporting(true);
        setStatusNote(null);
        try {
            let appSettings = {};
            try {
                appSettings = JSON.parse(readScopedStorage('appSettings') || '{}') || {};
            } catch {
                appSettings = {};
            }

            const accessScope = resolveUserAccessScope(appSettings, [], { includeFallback: true });
            const target = resolveScopedClassTarget({
                explicitSyncKey: propSyncKey,
                explicitOsraName: propOsraName,
                accessScope,
                appSettings
            });

            if (accessScope.isParent || accessScope.isGuest) {
                setStatusNote({ type: 'error', text: 'غير مصرح بتصدير كشوف البيانات لهذا الحساب.' });
                setIsExporting(false);
                return;
            }

            const scopedKeys = target.syncKey
                ? [target.syncKey]
                : (accessScope.isSuperAdmin ? null : (accessScope.allowedSyncKeys || []));

            let children = [];
            let attendance = [];
            let pointsLogs = [];

            if (scopedKeys === null) {
                [children, attendance, pointsLogs] = await Promise.all([
                    db.children.filter((c) => !c.isDeleted).toArray(),
                    db.attendance.filter((a) => !a.isDeleted).toArray(),
                    db.pointsLogs ? db.pointsLogs.filter((p) => !p.isDeleted).toArray() : Promise.resolve([])
                ]);
            } else if (scopedKeys.length > 0) {
                [children, attendance, pointsLogs] = await Promise.all([
                    db.children.where('syncKey').anyOf(scopedKeys).filter((c) => !c.isDeleted).toArray(),
                    db.attendance.where('syncKey').anyOf(scopedKeys).filter((a) => !a.isDeleted).toArray(),
                    db.pointsLogs ? db.pointsLogs.where('syncKey').anyOf(scopedKeys).filter((p) => !p.isDeleted).toArray() : Promise.resolve([])
                ]);
            }

            const { sheet1Rows, sheet2Rows, activeCount } = buildClassExcelExportRows({
                children,
                attendance,
                pointsLogs,
                services: appSettings.services || [],
                refDate: new Date(),
                allowedSyncKeys: scopedKeys
            });

            if (activeCount === 0) {
                setStatusNote({ type: 'error', text: 'لا توجد بيانات مخدومين لتصديرها حالياً.' });
                setIsExporting(false);
                return;
            }

            const sheet1 = XLSX.utils.json_to_sheet(sheet1Rows);
            sheet1['!cols'] = SHEET1_COLS;

            const sheet2 = sheet2Rows.length > 0
                ? XLSX.utils.json_to_sheet(sheet2Rows, { header: SHEET2_HEADERS })
                : XLSX.utils.json_to_sheet([], { header: SHEET2_HEADERS });
            sheet2['!cols'] = SHEET2_COLS;

            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, sheet1, 'بيانات وحضور المخدومين');
            XLSX.utils.book_append_sheet(workbook, sheet2, 'سجل الحضور والغياب التفصيلي للفصل');

            const filename = formatClassMonthlyExcelFilename(target.osraName, new Date());
            XLSX.writeFile(workbook, filename);
            setStatusNote({ type: 'success', text: `تم تحميل الملف (${activeCount} مخدوم).` });
        } catch (err) {
            console.error('خطأ في تصدير الإكسيل:', err);
            setStatusNote({ type: 'error', text: 'حدث خطأ أثناء تجهيز كشف الإكسيل.' });
        } finally {
            setIsExporting(false);
        }
    };

    if (variant === 'tile') {
        return (
            <button
                type="button"
                onClick={handleExport}
                disabled={isExporting}
                className={`coptic-card rounded-2xl p-3 flex items-center gap-2.5 hover:border-emerald-500/60 transition-all tactile-press cursor-pointer text-right min-h-[58px] disabled:opacity-60 ${className}`}
            >
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 border border-emerald-300/60 flex items-center justify-center shrink-0">
                    {isExporting ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
                </div>
                <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-black text-[#1B2A59] truncate">
                        {isExporting ? 'جاري التجهيز...' : 'تصدير Excel'}
                    </div>
                    <div className="text-[10px] font-bold text-[#6E5329] truncate">بيانات وحضور</div>
                </div>
            </button>
        );
    }

    if (variant === 'compact') {
        return (
            <div className={className}>
                <button
                    type="button"
                    onClick={handleExport}
                    disabled={isExporting}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-emerald-700 border border-emerald-700 text-white font-black text-xs hover:bg-emerald-800 transition-all tactile-press shadow-sm cursor-pointer disabled:opacity-60"
                >
                    {isExporting ? <Loader2 className="animate-spin" size={16} /> : <FileSpreadsheet size={16} />}
                    <span>{isExporting ? 'جاري التجهيز...' : 'تصدير بيانات وحضور الفصل'}</span>
                </button>
                {statusNote && (
                    <div className={`mt-2 px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 border ${statusNote.type === 'error' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`}>
                        {statusNote.type === 'error' ? <AlertCircle size={13} className="shrink-0" /> : <CheckCircle2 size={13} className="shrink-0" />}
                        <span>{statusNote.text}</span>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className={`space-y-2 ${className}`}>
            <button
                type="button"
                onClick={handleExport}
                disabled={isExporting}
                className="flex items-center justify-center gap-2 w-full py-3.5 px-4 rounded-2xl bg-emerald-50 border-2 border-emerald-200 text-emerald-800 font-black hover:bg-emerald-100 transition-all shadow-sm active:scale-95 cursor-pointer disabled:opacity-60"
            >
                {isExporting ? <Loader2 className="animate-spin" size={18} /> : <FileSpreadsheet size={18} />}
                <span>{isExporting ? 'جاري تجهيز كشف الفصل...' : 'تصدير بيانات وحضور الفصل (Excel)'}</span>
            </button>
            {statusNote && (
                <div className={`px-3.5 py-2 rounded-2xl text-xs font-bold flex items-center gap-2 border ${statusNote.type === 'error' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`}>
                    {statusNote.type === 'error' ? <AlertCircle size={15} className="shrink-0" /> : <CheckCircle2 size={15} className="shrink-0" />}
                    <span>{statusNote.text}</span>
                </div>
            )}
        </div>
    );
}
