/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar as CalendarIcon, Plus, ChevronRight, ChevronLeft, MapPin, CheckCircle2, ArrowRight, Globe, Sparkles, Coins } from 'lucide-react';
import { db } from '../db/database';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday } from 'date-fns';
import { ar } from 'date-fns/locale';
import { TENANT_CONFIG } from '../utils/tenantConfig';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
import { useSmartNavigation } from '../hooks/useSmartNavigation';

export default function CalendarPage() {
    const { goBack } = useSmartNavigation();
    const navigate = useNavigate();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [events, setEvents] = useState([]);
    const [selectedDate, setSelectedDate] = useState(new Date());
    const accessScope = resolveUserAccessScope(null, [], { includeFallback: true });

    const [holidays, setHolidays] = useState({ fixed: {}, dynamic: {} });

    // جلب الأحداث من الداتابيز المحلية مع العزل الهرمي
    const fetchEvents = async () => {
        const allEvents = await db.events.toArray();
        const allowedSet = new Set(accessScope.allowedSyncKeys);
        setEvents(allEvents.filter((e) => {
            if (e.isDeleted) return false;
            if (accessScope.isSuperAdmin) return true;
            if (e.isGlobal || e.syncKey === 'global') return true;
            return allowedSet.has(e.syncKey) || (accessScope.isStageLeader && accessScope.stageName && e.syncKey === accessScope.stageName);
        }));
    };

    useEffect(() => {
        localStorage.setItem('lastSeenGlobalEventTime', Date.now().toString());
        fetchEvents();
    }, [currentSyncKey]);

    useEffect(() => {
        const loadHolidays = async () => {
            const currentYear = currentDate.getFullYear();
            const cacheKey = `holidays_${currentYear}`;

            const fixedHolidays = {
                '01-07': 'عيد الميلاد المجيد',
                '01-19': 'عيد الغطاس المجيد',
                '01-25': 'عيد الشرطة / ثورة 25 يناير',
                '03-19': 'عيد الصليب المجيد',
                '04-25': 'عيد تحرير سيناء',
                '05-01': 'عيد العمال',
                '06-01': 'دخول العائلة المقدسة أرض مصر',
                '06-30': 'ثورة 30 يونيو',
                '07-12': 'عيد الرسل الأطهار',
                '07-23': 'ثورة 23 يوليو',
                '08-22': 'صعود جسد السيدة العذراء مريم',
                '09-11': 'عيد النيروز (رأس السنة القبطية)',
                '09-27': 'عيد الصليب المجيد',
                '10-06': 'انتصارات أكتوبر'
            };

            let dynamicHolidays = {};
            const cachedDynamic = localStorage.getItem(cacheKey);

            if (cachedDynamic) {
                dynamicHolidays = JSON.parse(cachedDynamic);
            } else if (navigator.onLine) {
                try {
                    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${currentYear}/EG`);
                    const data = await res.json();
                    data.forEach(h => {
                        dynamicHolidays[h.date] = h.localName;
                    });
                    localStorage.setItem(cacheKey, JSON.stringify(dynamicHolidays));
                } catch {
                    // اعتماد الثوابت الكنسية والوطنية عند انقطاع الشبكة
                }
            }

            setHolidays({ fixed: fixedHolidays, dynamic: dynamicHolidays });
        };

        loadHolidays();
    }, [currentDate.getFullYear()]);

    const getHolidayInfo = (dateObj) => {
        const mmdd = format(dateObj, 'MM-dd');
        const yyyymmdd = format(dateObj, 'yyyy-MM-dd');
        return holidays.fixed[mmdd] || holidays.dynamic[yyyymmdd] || null;
    };

    const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
    const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

    const selectedDateEvents = events.filter(event => isSameDay(new Date(event.date), selectedDate));
    const selectedHoliday = getHolidayInfo(selectedDate);

    return (
        <div className="min-h-screen coptic-cream-surface pb-32 text-[#231B12] relative" dir="rtl">

            {/* Header */}
            <header
                className="text-white sticky top-0 z-40 px-4 py-4 flex items-center justify-between shadow-lg border-b border-amber-400/25 rounded-b-3xl"
                style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 72%, #8C621E 100%)' }}
            >
                <div className="flex items-center gap-3 min-w-0">
                    <button
                        type="button"
                        onClick={() => goBack('/')}
                        className="p-2.5 bg-white/15 hover:bg-white/25 rounded-full transition-colors text-white cursor-pointer shrink-0"
                        aria-label="رجوع"
                    >
                        <ArrowRight size={20} />
                    </button>
                    <div className="bg-amber-400/20 p-2 rounded-xl border border-amber-300/40 shrink-0">
                        <CalendarIcon className="text-amber-200" size={22} />
                    </div>
                    <div className="min-w-0">
                        <h1 className="font-calligraphic text-xl font-bold text-amber-100 truncate">أجندة الخدمة والمناسبات</h1>
                        <p className="text-[11px] font-bold text-amber-200/80 truncate">{TENANT_CONFIG.CHURCH_NAME}</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => navigate('/add-event')}
                    className="bg-amber-400 hover:bg-amber-300 text-[#162447] px-4 py-2 rounded-xl font-black text-xs sm:text-sm flex items-center gap-1.5 transition-all shadow-md shrink-0 cursor-pointer"
                >
                    <Plus size={17} /> حدث جديد
                </button>
            </header>

            <div className="p-4 max-w-lg mx-auto space-y-6 mt-2">

                {/* Calendar UI */}
                <div className="coptic-card border border-[#DFC48F] rounded-3xl p-5 shadow-lg">
                    <div className="flex justify-between items-center mb-5">
                        <button type="button" onClick={prevMonth} className="p-2 bg-[#FAF3E3] hover:bg-amber-100 text-[#1B2A59] border border-[#DFC48F] rounded-full transition-colors cursor-pointer">
                            <ChevronRight size={20} />
                        </button>
                        <h2 className="font-calligraphic text-xl font-bold text-[#1B2A59]">
                            {format(currentDate, 'MMMM yyyy', { locale: ar })}
                        </h2>
                        <button type="button" onClick={nextMonth} className="p-2 bg-[#FAF3E3] hover:bg-amber-100 text-[#1B2A59] border border-[#DFC48F] rounded-full transition-colors cursor-pointer">
                            <ChevronLeft size={20} />
                        </button>
                    </div>

                    <div className="grid grid-cols-7 gap-2 text-center text-xs font-black text-[#8C621E] mb-2">
                        {['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'].map(day => <div key={day}>{day}</div>)}
                    </div>

                    <div className="grid grid-cols-7 gap-2">
                        {daysInMonth.map(day => {
                            const hasEvent = events.some(e => isSameDay(new Date(e.date), day) && !e.isGlobal && e.syncKey !== 'global');
                            const hasGlobalEvent = events.some(e => isSameDay(new Date(e.date), day) && (e.isGlobal || e.syncKey === 'global'));
                            const isSelected = isSameDay(day, selectedDate);
                            const isCurrentDay = isToday(day);
                            const holidayName = getHolidayInfo(day);

                            return (
                                <button
                                    key={day.toString()}
                                    type="button"
                                    onClick={() => setSelectedDate(day)}
                                    title={holidayName || ''}
                                    className={`
                                        aspect-square flex flex-col items-center justify-center rounded-2xl text-sm font-black transition-all relative cursor-pointer
                                        ${isSelected ? 'bg-[#1B2A59] text-amber-100 shadow-lg ring-2 ring-amber-400' : 'hover:bg-[#FAF3E3] text-[#2B2012]'}
                                        ${isCurrentDay && !isSelected ? 'border-2 border-[#C8942E] text-[#1B2A59] bg-amber-50' : ''}
                                        ${holidayName && !isSelected ? 'text-rose-700 bg-rose-50/90 border border-rose-200' : ''}
                                    `}
                                >
                                    {format(day, 'd')}
                                    <div className="flex gap-1 mt-1">
                                        {hasGlobalEvent && <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-amber-300' : 'bg-[#C8942E]'}`}></span>}
                                        {hasEvent && <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-[#1B2A59]'}`}></span>}
                                        {holidayName && !hasEvent && !hasGlobalEvent && <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-rose-200' : 'bg-rose-500'}`}></span>}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Selected Date Events */}
                <div>
                    <h3 className="text-sm font-black text-[#1B2A59] mb-3 px-2 flex items-center gap-2">
                        <CalendarIcon size={16} className="text-[#C8942E]" />
                        أحداث يوم {format(selectedDate, 'EEEE، d MMMM', { locale: ar })}
                    </h3>

                    {selectedHoliday && (
                        <div className="mb-4 bg-gradient-to-l from-amber-50 to-rose-50 border border-amber-300/70 p-4 rounded-2xl flex items-center gap-4 shadow-sm">
                            <div className="bg-rose-100 p-2.5 rounded-xl text-rose-700 border border-rose-200">
                                <Sparkles size={20} />
                            </div>
                            <div>
                                <p className="text-[11px] text-[#8C621E] font-black mb-0.5">مناسبة كنسية / وطنية</p>
                                <p className="text-sm text-[#1B2A59] font-black">{selectedHoliday}</p>
                            </div>
                        </div>
                    )}

                    <div className="space-y-3">
                        {selectedDateEvents.length === 0 ? (
                            <div className="text-center py-8 coptic-card border border-dashed border-[#DFC48F] rounded-3xl text-[#6E5329] text-sm font-bold">
                                لا توجد مهام أو أحداث مسجلة للأسرة في هذا اليوم
                            </div>
                        ) : (
                            selectedDateEvents.map(event => {
                                const totalTasks = event.tasks?.length || 0;
                                const completedTasks = event.tasks?.filter(t => t.isCompleted).length || 0;
                                const isAllCompleted = totalTasks > 0 && completedTasks === totalTasks;

                                return (
                                    <div
                                        key={event.id}
                                        onClick={() => navigate(`/event/${event.id}`)}
                                        className="coptic-card border border-[#DFC48F] rounded-2xl p-4 cursor-pointer hover:border-[#C8942E] transition-all flex items-center justify-between shadow-sm group"
                                    >
                                        <div>
                                            <h4 className="font-black text-[#1B2A59] mb-2 flex items-center gap-2 flex-wrap">
                                                {(event.isGlobal || event.syncKey === 'global') && <span className="bg-amber-100 text-[#8C621E] border border-amber-300 text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap flex items-center gap-1"><Globe size={10} /> حدث عام</span>}
                                                {event.title}
                                                {!event.isSynced && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="بانتظار المزامنة"></span>}
                                            </h4>

                                            <div className="flex flex-wrap items-center gap-2">
                                                <div className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg transition-colors ${isAllCompleted ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-indigo-50 text-[#1B2A59] border border-indigo-200'}`}>
                                                    {isAllCompleted ? <CheckCircle2 size={12} /> : <MapPin size={12} />}
                                                    {totalTasks > 0 ? `${completedTasks} / ${totalTasks} مهام` : 'لا توجد مهام'}
                                                </div>

                                                <div className="flex items-center gap-1 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                                                    <Coins size={12} /> {event.price || 'مجاناً'}
                                                </div>
                                            </div>
                                        </div>
                                        <ChevronLeft className="text-[#8C621E] group-hover:-translate-x-0.5 transition-transform" size={20} />
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
