import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { db } from '../db/database';
import { Upload, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import useAutoSync from '../hooks/useAutoSync';
import { syncWithCloud } from '../db/sync';
import { createCanonicalChildRecord } from '../utils/churchDataEngine';
import { normalizeArabicName } from '../utils/childIdentity';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
import {
    BLANK_CLASS_TEMPLATE_HEADERS,
    buildBlankClassTemplateSampleRow,
    formatBlankTemplateFilename,
    parseArabicDateParts,
    resolveScopedClassTarget
} from '../utils/excelClassHelpers';
import { readScopedStorage } from '../utils/tenantConfig';

export { BLANK_CLASS_TEMPLATE_HEADERS };

/**
 * Downloads a clean blank Excel template pre-formatted for bulk class import.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function downloadBlankClassExcelTemplate(osraName = 'الفصل', syncKey = '') {
    const sampleRows = [buildBlankClassTemplateSampleRow(osraName)];
    const worksheet = XLSX.utils.json_to_sheet(sampleRows, {
        header: BLANK_CLASS_TEMPLATE_HEADERS
    });
    worksheet['!cols'] = Array(BLANK_CLASS_TEMPLATE_HEADERS.length).fill({ wch: 24 });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'بيانات المخدومين');
    const filename = formatBlankTemplateFilename(osraName || syncKey || 'الفصل');
    XLSX.writeFile(workbook, filename);
    return filename;
}

export default function ExcelImporter({
    syncKey: propSyncKey = '',
    osraName: propOsraName = '',
    variant = 'default',
    className = '',
    onImported = null
}) {
    const [isImporting, setIsImporting] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const { triggerAutoSync } = useAutoSync();

    const handleFileUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsImporting(true);
        setFeedback(null);

        const reader = new FileReader();

        reader.onload = async (event) => {
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

                if (!target.syncKey) {
                    setFeedback({
                        type: 'error',
                        text: 'يرجى الدخول إلى فصل محدد أو اختياره أولاً قبل استيراد الشيت.'
                    });
                    setIsImporting(false);
                    e.target.value = '';
                    return;
                }

                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                const existingChildren = await db.children
                    .where('syncKey')
                    .equals(target.syncKey)
                    .toArray();

                const existingByNormName = new Map();
                const existingById = new Map();
                for (const c of existingChildren) {
                    const nKey = normalizeArabicName(c.name || '');
                    if (nKey && !existingByNormName.has(nKey)) {
                        existingByNormName.set(nKey, c);
                    }
                    if (c.id) existingById.set(String(c.id), c);
                    if (c.cloudId) existingById.set(String(c.cloudId), c);
                }

                const nowIso = new Date().toISOString();
                let createdCount = 0;
                let updatedCount = 0;
                let failCount = 0;

                for (let i = 0; i < jsonData.length; i++) {
                    const row = jsonData[i] || {};
                    const rawName = String(row.name || row['الاسم'] || row['الاسم بالكامل'] || '').trim();
                    if (!rawName) continue;

                    const notesText = String(row.specialNotes || row['ملاحظات'] || '').trim();
                    if (notesText.startsWith('صف إرشادي تجريبي')) continue;

                    const rawBirthDate = row.birthDate || row['تاريخ الميلاد'] || '';
                    const { bMonth, bDay } = parseArabicDateParts(rawBirthDate);
                    const normalizedGender = String(row.gender || row['النوع'] || '').trim() === 'بنت' ? 'بنت' : 'ولد';

                    const incomingId = row.id || row.code || row['كود المخدوم'] ? String(row.id || row.code || row['كود المخدوم']).trim() : '';
                    const existingMatch = (incomingId && existingById.get(incomingId))
                        || existingByNormName.get(normalizeArabicName(rawName))
                        || null;

                    const canonicalPayload = createCanonicalChildRecord({
                        ...(existingMatch || {}),
                        id: existingMatch?.id || undefined,
                        cloudId: existingMatch?.cloudId || existingMatch?.id || undefined,
                        qrId: existingMatch?.qrId || undefined,
                        name: rawName,
                        gender: normalizedGender,
                        childPhone: String(row.childPhone ?? row['تليفون المخدوم'] ?? existingMatch?.childPhone ?? ''),
                        fatherPhone: String(row.fatherPhone ?? row['تليفون الأب'] ?? existingMatch?.fatherPhone ?? ''),
                        motherPhone: String(row.motherPhone ?? row['تليفون الأم'] ?? existingMatch?.motherPhone ?? ''),
                        whatsappTarget: row.whatsappTarget || existingMatch?.whatsappTarget || 'mother',
                        birthDate: String(rawBirthDate || existingMatch?.birthDate || ''),
                        birthMonth: bMonth || existingMatch?.birthMonth || null,
                        birthDay: bDay || existingMatch?.birthDay || null,
                        address: String(row.address ?? row['المنطقة'] ?? existingMatch?.address ?? ''),
                        detailedAddress: String(row.detailedAddress ?? row['العنوان'] ?? existingMatch?.detailedAddress ?? ''),
                        fatherConfessor: String(row.fatherConfessor ?? row['أب الاعتراف'] ?? existingMatch?.fatherConfessor ?? ''),
                        fatherJob: String(row.fatherJob ?? row['وظيفة الأب'] ?? existingMatch?.fatherJob ?? ''),
                        specialNotes: notesText || existingMatch?.specialNotes || '',
                        streak: row['المواظبة'] !== undefined || row.streak !== undefined ? Number(row['المواظبة'] ?? row.streak ?? 0) : (existingMatch?.streak || 0),
                        gotClothes: Boolean(existingMatch?.gotClothes),
                        updatedAt: nowIso,
                        isDirty: true,
                        isDeleted: false,
                        restoredAt: existingMatch?.isDeleted ? Date.now() : (existingMatch?.restoredAt || null)
                    }, target.syncKey);

                    try {
                        await db.children.put(canonicalPayload);
                        existingByNormName.set(normalizeArabicName(rawName), canonicalPayload);
                        existingById.set(String(canonicalPayload.id), canonicalPayload);
                        if (existingMatch) updatedCount += 1;
                        else createdCount += 1;
                    } catch (err) {
                        console.error(`Failed to import row ${i + 1} (${rawName}):`, err);
                        failCount += 1;
                    }
                }

                const totalProcessed = createdCount + updatedCount;
                if (typeof navigator !== 'undefined' && navigator.onLine) {
                    void syncWithCloud(target.syncKey);
                }
                triggerAutoSync();

                setFeedback({
                    type: failCount > 0 ? 'warning' : 'success',
                    text: `تم استيراد ${createdCount} وتحديث ${updatedCount} مخدوم لفصل (${target.osraName})${failCount > 0 ? ` — تعذر ${failCount} صف` : ''}.`
                });

                if (typeof onImported === 'function') {
                    onImported({
                        createdCount,
                        updatedCount,
                        totalProcessed,
                        failCount,
                        syncKey: target.syncKey,
                        osraName: target.osraName
                    });
                }
            } catch (err) {
                console.error(err);
                setFeedback({
                    type: 'error',
                    text: 'تعذر قراءة ملف الإكسيل. تأكد من تنسيق الأعمدة وفق التمبليت القياسي.'
                });
            } finally {
                setIsImporting(false);
                if (e.target) e.target.value = '';
            }
        };

        reader.readAsArrayBuffer(file);
    };

    if (variant === 'compact') {
        return (
            <div className={className}>
                <label className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border font-black text-xs cursor-pointer transition-all tactile-press ${isImporting ? 'bg-slate-100 border-slate-300 text-slate-500' : 'bg-[#1B2A59] border-[#1B2A59] text-[#F4D078] hover:bg-[#142044] shadow-sm'}`}>
                    {isImporting ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                    <span>{isImporting ? 'جاري الاستيراد...' : 'استيراد من Excel'}</span>
                    <input type="file" accept=".xlsx, .xls, .csv" className="hidden" onChange={handleFileUpload} disabled={isImporting} />
                </label>
                {feedback && (
                    <div className={`mt-2 px-3 py-2 rounded-xl text-[11px] font-bold flex items-center gap-1.5 border ${feedback.type === 'error' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`}>
                        {feedback.type === 'error' ? <AlertCircle size={14} className="shrink-0" /> : <CheckCircle2 size={14} className="shrink-0" />}
                        <span>{feedback.text}</span>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className={`space-y-2 ${className}`}>
            <label className={`flex items-center justify-center gap-3 w-full py-3.5 px-4 rounded-2xl border-2 border-dashed cursor-pointer transition-all ${isImporting ? 'bg-slate-100 border-slate-300' : 'bg-indigo-50/80 border-indigo-200 hover:bg-indigo-100/80'}`}>
                {isImporting ? <Loader2 className="animate-spin text-indigo-700" size={20} /> : <Upload className="text-indigo-700" size={20} />}
                <span className="text-xs sm:text-sm font-black text-indigo-800">
                    {isImporting ? 'جاري معالجة واستيراد المخدومين...' : 'استيراد شيت المخدومين (Excel)'}
                </span>
                <input type="file" accept=".xlsx, .xls, .csv" className="hidden" onChange={handleFileUpload} disabled={isImporting} />
            </label>
            {feedback && (
                <div className={`px-3.5 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 border ${feedback.type === 'error' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`}>
                    {feedback.type === 'error' ? <AlertCircle size={16} className="shrink-0" /> : <CheckCircle2 size={16} className="shrink-0" />}
                    <span>{feedback.text}</span>
                </div>
            )}
        </div>
    );
}
