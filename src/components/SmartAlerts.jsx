import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { AlertCircle, Stethoscope, Gift, UserMinus, ChevronDown, ChevronUp } from 'lucide-react';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
import { readScopedStorage } from '../utils/tenantConfig';

export default function SmartAlerts() {
    const [isExpanded, setIsExpanded] = useState(false);
    const scope = resolveUserAccessScope();
    const allowedKeys = scope.allowedSyncKeys || [];
    const scopeKeySig = allowedKeys.join('|');

    const children = useLiveQuery(async () => {
        if (scope.isParent || scope.isGuest || allowedKeys.length === 0) return [];
        const kids = allowedKeys.length === 1
            ? await db.children.where('syncKey').equals(allowedKeys[0]).toArray()
            : await db.children.where('syncKey').anyOf(allowedKeys).toArray();
        return kids.filter(c => !c.isDeleted);
    }, [scopeKeySig, scope.isParent, scope.isGuest]) || [];

    const attendance = useLiveQuery(async () => {
        if (scope.isParent || scope.isGuest || allowedKeys.length === 0) return [];
        return allowedKeys.length === 1
            ? await db.attendance.where('syncKey').equals(allowedKeys[0]).toArray()
            : await db.attendance.where('syncKey').anyOf(allowedKeys).toArray();
    }, [scopeKeySig, scope.isParent, scope.isGuest]) || [];

    const appSettingsStr = readScopedStorage('appSettings');
    const appSettings = appSettingsStr ? JSON.parse(appSettingsStr) : {};
    const activeServants = (appSettings?.servants || []).filter(s =>
        scope.isSuperAdmin || allowedKeys.includes(s?.syncKey) || allowedKeys.includes(s?.osraName)
    );

    const alerts = useMemo(() => {
        let generatedAlerts = [];
        const allPeople = [...(children || []), ...(activeServants || [])];

        // 1. Birthdays (next 14 days)
        const today = new Date();
        const nextTwoWeeks = new Date();
        nextTwoWeeks.setDate(today.getDate() + 14);

        allPeople.forEach(person => {
            if (person?.medicalStatus?.isSick) {
                generatedAlerts.push({
                    type: 'medical',
                    message: `${person.name} يحتاج افتقاد مرضي - ${person.medicalStatus.notes || ''}`,
                    priority: 'high',
                    icon: <Stethoscope size={18} />
                });
            }

            // Simple absence calculation (STRICT: ONLY active, non-deleted explicit status === 'absent' service records)
            const personAttendance = attendance
                .filter(a => a && !a.isDeleted && String(a.childId) === String(person?.id) && (a.type === 'service' || a.type === 'service_meeting'))
                .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
            if (personAttendance.length >= 3) {
                const last3 = personAttendance.slice(0, 3);
                if (last3.every(a => a.status === 'absent')) {
                    generatedAlerts.push({
                        type: 'absence',
                        message: `${person?.name} تغيب لثلاث مرات متتالية!`,
                        priority: 'medium',
                        icon: <UserMinus size={18} />
                    });
                }
            }

            // Birthdays (simplified check, assumes proper Date format or simple extraction)
            // Warning: Arabic date parsing requires specific implementation. Assuming standard format for now.
            if (person?.birthDate && typeof person.birthDate === 'string' && person.birthDate.includes('-')) {
                const [y, m, d] = person.birthDate.split('-').map(Number);
                if (m && d) {
                    const bDayThisYear = new Date(today.getFullYear(), m - 1, d);
                    const diffTime = bDayThisYear - today;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    if (diffDays >= 0 && diffDays <= 14) {
                        generatedAlerts.push({
                            type: 'birthday',
                            message: `عيد ميلاد ${person.name} اقترب (بعد ${diffDays} يوم)!`,
                            priority: 'low',
                            icon: <Gift size={18} />
                        });
                    }
                }
            }
        });

        return generatedAlerts.sort((a, b) => {
            const pMap = { high: 1, medium: 2, low: 3 };
            return pMap[a.priority] - pMap[b.priority];
        });
    }, [children, activeServants, attendance]);

    if (!alerts || alerts.length === 0) return null;

    const birthdayCount = alerts.filter(a => a.type === 'birthday').length;

    return (
        <div className="coptic-card rounded-2xl border border-[#DFC48F] mb-4 no-print overflow-hidden transition-all" dir="rtl">
            <button
                type="button"
                onClick={() => setIsExpanded(prev => !prev)}
                className="w-full min-h-[48px] px-3.5 py-2.5 flex items-center justify-between gap-3 text-right hover:bg-[#EFE0C2]/45 transition-colors cursor-pointer"
                aria-expanded={isExpanded}
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-amber-100/90 text-[#8C621E] border border-amber-300/60 flex items-center justify-center shrink-0">
                        {birthdayCount > 0 ? <Gift size={16} /> : <AlertCircle size={16} className="text-rose-600" />}
                    </div>
                    <span className="font-black text-xs sm:text-sm text-[#1B2A59] truncate">
                        تنبيهات وأعياد ميلاد الأسبوع ({alerts.length})
                    </span>
                </div>
                <span className="flex items-center gap-1 text-[11px] font-black text-[#8C621E] bg-[#EFE0C2]/80 px-2.5 py-1 rounded-full shrink-0">
                    <span>{isExpanded ? 'إخفاء' : 'اضغط للعرض'}</span>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </span>
            </button>

            {isExpanded && (
                <div className="px-3.5 pb-3.5 pt-2 border-t border-[#E7D4AF]/80 space-y-2 max-h-60 overflow-y-auto animate-card-enter">
                    {alerts.map((alert, idx) => (
                        <div key={idx} className={`flex items-center gap-3 p-2.5 rounded-xl border ${
                            alert.priority === 'high' ? 'bg-rose-50/90 border-rose-200 text-rose-900' :
                            alert.priority === 'medium' ? 'bg-amber-50/90 border-amber-200 text-amber-900' :
                            'bg-indigo-50/80 border-indigo-200 text-[#1B2A59]'
                        }`}>
                            <div className={`p-1.5 rounded-full shrink-0 ${
                                alert.priority === 'high' ? 'bg-rose-100' :
                                alert.priority === 'medium' ? 'bg-amber-100' :
                                'bg-indigo-100'
                            }`}>
                                {alert.icon}
                            </div>
                            <span className="font-bold text-xs sm:text-sm leading-snug">{alert.message}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
