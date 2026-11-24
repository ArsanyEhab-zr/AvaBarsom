import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../db/database';
import { ArrowRight, CalendarDays, Plus, Edit, Trash2, X, MapPin, User, CheckCircle2, Circle, MessageSquare, Save, Globe, Coins } from 'lucide-react';
import useAutoSync from '../hooks/useAutoSync';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { useSmartNavigation } from '../hooks/useSmartNavigation';
import { readScopedStorage } from '../utils/tenantConfig';

export default function EventDetailsPage() {
    const { triggerAutoSync } = useAutoSync();
    const { goBack } = useSmartNavigation();
    const { id } = useParams();
    const navigate = useNavigate();
    const [event, setEvent] = useState(null);
    const [loading, setLoading] = useState(true);
    const servantData = JSON.parse(readScopedStorage('currentServant') || '{}');

    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState({ title: '', date: '', price: '', tasks: [] });
    const [newTaskTitle, setNewTaskTitle] = useState('');

    useEffect(() => {
        const loadEvent = async () => {
            try {
                const ev = await db.events.get(id);
                setEvent(ev || null);
                if (ev) {
                    setEditData({ title: ev.title, date: ev.date, price: ev.price || '', tasks: ev.tasks || [] });
                }
            } finally {
                setLoading(false);
            }
        };
        loadEvent();
    }, [id]);

    const toggleTask = async (taskId) => {
        if (!event || isEditing) return;

        const updatedTasks = (event.tasks || []).map(task => {
            if (task.id === taskId) {
                const isNowCompleted = !task.isCompleted;
                let note = task.note;

                if (isNowCompleted) {
                    const userNote = prompt("أضف ملاحظة (اختياري): \nمثال: تم تجهيز المستلزمات المطلوبة");
                    if (userNote === null) return task;
                    note = userNote.trim();
                } else {
                    note = '';
                }

                return {
                    ...task,
                    isCompleted: isNowCompleted,
                    completedByName: isNowCompleted ? servantData.name : '',
                    note: isNowCompleted ? note : ''
                };
            }
            return task;
        });

        const now = new Date().toISOString();
        const updatedEvent = { ...event, tasks: updatedTasks, isDirty: true, updatedAt: now };
        await db.events.put(updatedEvent);
        triggerAutoSync();
        setEvent(updatedEvent);
    };

    const handleUpdateEditTask = (taskId, newTitle) => {
        const updatedTasks = editData.tasks.map(t => t.id === taskId ? { ...t, title: newTitle } : t);
        setEditData({ ...editData, tasks: updatedTasks });
    };

    const handleRemoveEditTask = (taskId) => {
        const updatedTasks = editData.tasks.filter(t => t.id !== taskId);
        setEditData({ ...editData, tasks: updatedTasks });
    };

    const handleAddNewTask = () => {
        if (!newTaskTitle.trim()) return;
        const newTask = {
            id: Date.now().toString(),
            title: newTaskTitle.trim(),
            isCompleted: false,
            completedByName: '',
            note: ''
        };
        setEditData({ ...editData, tasks: [...editData.tasks, newTask] });
        setNewTaskTitle('');
    };

    const handleDeleteEvent = async () => {
        if (window.confirm("هل أنت متأكد من حذف هذا الحدث نهائياً؟")) {
            const now = new Date().toISOString();
            await db.events.update(id, { isDeleted: true, isDirty: true, updatedAt: now });
            triggerAutoSync();
            goBack('/calendar');
        }
    };

    const handleSaveEdit = async () => {
        if (!editData.title || !editData.date) return alert("اسم الحدث والتاريخ مطلوبان");
        const now = new Date().toISOString();
        const updatedEvent = {
            ...event,
            title: editData.title,
            date: editData.date,
            price: editData.price,
            tasks: editData.tasks,
            isDirty: true,
            updatedAt: now
        };
        await db.events.put(updatedEvent);
        triggerAutoSync();
        setEvent(updatedEvent);
        setIsEditing(false);
    };

    if (loading) {
        return <div className="min-h-screen coptic-cream-surface text-[#1B2A59] font-black flex justify-center items-center">جاري تحميل تفاصيل الحدث...</div>;
    }

    if (!event) {
        return (
            <div className="min-h-screen coptic-cream-surface flex flex-col items-center justify-center p-6 text-center" dir="rtl">
                <div className="coptic-card rounded-3xl p-7 max-w-sm w-full border border-[#DFC48F] shadow-xl space-y-4">
                    <p className="font-black text-[#1B2A59]">لم يتم العثور على هذا الحدث</p>
                    <button type="button" onClick={() => navigate('/calendar')} className="bg-[#1B2A59] text-amber-100 px-5 py-2.5 rounded-xl font-black text-xs cursor-pointer">
                        العودة للأجندة
                    </button>
                </div>
            </div>
        );
    }

    const eventTasks = event?.tasks || [];
    const completedCount = eventTasks.filter(t => t.isCompleted).length;
    const progress = eventTasks.length === 0 ? 0 : (completedCount / eventTasks.length) * 100;
    const isGlobalEvent = event?.isGlobal || event?.syncKey === 'global';

    return (
        <div className="min-h-screen coptic-cream-surface text-[#231B12] pb-24" dir="rtl">
            <header
                className="text-white px-4 py-4 flex items-center justify-between sticky top-0 z-50 shadow-lg border-b border-amber-400/25 rounded-b-3xl"
                style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 72%, #8C621E 100%)' }}
            >
                <div className="flex items-center gap-3 min-w-0">
                    <button type="button" onClick={() => goBack('/calendar')} className="p-2.5 bg-white/15 hover:bg-white/25 rounded-full cursor-pointer shrink-0">
                        <ArrowRight size={20} />
                    </button>
                    <h1 className="font-calligraphic text-xl font-bold text-amber-100 truncate">{event?.title || 'تفاصيل الحدث'}</h1>
                </div>

                {!isEditing ? (
                    <div className="flex gap-2 shrink-0">
                        <button type="button" onClick={() => setIsEditing(true)} className="p-2 bg-white/15 text-amber-200 hover:bg-amber-400 hover:text-[#162447] rounded-xl transition-all cursor-pointer"><Edit size={18} /></button>
                        <button type="button" onClick={handleDeleteEvent} className="p-2 bg-rose-500/20 text-rose-200 hover:bg-rose-600 hover:text-white rounded-xl transition-all cursor-pointer"><Trash2 size={18} /></button>
                    </div>
                ) : (
                    <button type="button" onClick={() => setIsEditing(false)} className="p-2 bg-white/15 hover:bg-white/25 rounded-xl cursor-pointer"><X size={18} /></button>
                )}
            </header>

            <div className="p-4 max-w-lg mx-auto space-y-6 mt-2">
                <div
                    className="rounded-3xl p-5 shadow-xl text-white border border-amber-400/30 transition-all"
                    style={{ background: 'linear-gradient(135deg, #162447 0%, #22386E 70%, #7C5819 100%)' }}
                >
                    {!isEditing ? (
                        <>
                            {isGlobalEvent && (
                                <div className="mb-3 inline-flex items-center gap-2 bg-amber-400/20 text-amber-200 border border-amber-300/40 text-xs font-black px-3 py-1 rounded-full">
                                    <Globe size={14} /> حدث عام
                                </div>
                            )}
                            <h2 className="font-calligraphic text-2xl font-bold text-amber-100 mb-4">{event?.title || ''}</h2>
                            <div className="space-y-2.5 text-sm font-bold text-amber-100/90">
                                <p className="flex items-center gap-2"><CalendarDays size={16} className="text-amber-300" /> {event?.date ? format(new Date(event.date), 'EEEE، d MMMM yyyy', { locale: ar }) : 'بدون تاريخ'}</p>
                                <p className="flex items-center gap-2 bg-white/15 text-amber-100 px-3 py-1.5 rounded-xl w-fit"><Coins size={15} className="text-amber-300" /> التكلفة: {event?.price || 'مجاناً'}</p>
                                <p className="flex items-center gap-2 text-amber-100/80"><User size={16} className="text-amber-300" /> أُضيف بواسطة: {event?.createdBy || 'إدارة الخدمة'}</p>
                            </div>

                            <div className="mt-5">
                                <div className="flex justify-between text-xs font-bold text-amber-200 mb-2">
                                    <span>نسبة إنجاز المهام</span>
                                    <span>{completedCount} من {eventTasks.length}</span>
                                </div>
                                <div className="w-full bg-white/15 rounded-full h-2.5 overflow-hidden">
                                    <div className="bg-amber-400 h-2.5 rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs text-amber-200 font-bold mb-1 block">اسم الحدث</label>
                                <input className="w-full p-3 bg-white/10 rounded-xl border border-amber-300/40 outline-none text-white" value={editData.title || ''} onChange={e => setEditData({ ...editData, title: e.target.value })} />
                            </div>
                            <div>
                                <label className="text-xs text-amber-200 font-bold mb-1 block">التاريخ</label>
                                <input type="date" className="w-full p-3 bg-white/10 rounded-xl border border-amber-300/40 outline-none text-white" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} />
                            </div>
                            <div>
                                <label className="text-xs text-amber-200 font-bold mb-1 block">السعر / التكلفة</label>
                                <input className="w-full p-3 bg-white/10 rounded-xl border border-amber-300/40 outline-none text-white" placeholder="مجاناً" value={editData.price || ''} onChange={e => setEditData({ ...editData, price: e.target.value })} />
                            </div>
                        </div>
                    )}
                </div>

                <div>
                    <h3 className="text-lg font-black text-[#1B2A59] mb-4 flex items-center gap-2">
                        <MapPin className="text-[#C8942E]" /> {isEditing ? 'تعديل المهام' : 'قائمة المهام والتجهيزات'}
                    </h3>

                    {!isEditing ? (
                        <div className="space-y-3">
                            {eventTasks.map(task => (
                                <div
                                    key={task.id}
                                    onClick={() => toggleTask(task.id)}
                                    className={`p-4 rounded-2xl border transition-all cursor-pointer flex gap-3 coptic-card ${task.isCompleted
                                        ? 'border-emerald-300 bg-emerald-50/70'
                                        : 'border-[#DFC48F] hover:border-[#C8942E]'
                                        }`}
                                >
                                    <div className="mt-0.5">
                                        {task.isCompleted ? <CheckCircle2 className="text-emerald-700" size={24} /> : <Circle className="text-[#8C621E]" size={24} />}
                                    </div>
                                    <div className="flex-1">
                                        <h4 className={`font-black ${task.isCompleted ? 'text-emerald-900 line-through opacity-70' : 'text-[#1B2A59]'}`}>
                                            {task.title}
                                        </h4>

                                        {task.isCompleted && (
                                            <div className="mt-2 text-xs text-emerald-800 bg-emerald-100/70 p-2 rounded-lg border border-emerald-200">
                                                <p className="font-bold flex items-center gap-1 mb-1"><User size={10} /> أتمها: {task.completedByName || 'خادم'}</p>
                                                {task.note && <p className="flex items-start gap-1 opacity-90"><MessageSquare size={10} className="mt-0.5 shrink-0" /> {task.note}</p>}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {eventTasks.length === 0 && (
                                <p className="text-center text-[#6E5329] text-sm font-bold py-6 coptic-card border border-dashed border-[#DFC48F] rounded-2xl">لا توجد مهام مسجلة لهذا الحدث حالياً.</p>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {editData.tasks.map(task => (
                                <div key={task.id} className="flex items-center gap-2 p-3 coptic-card rounded-xl border border-[#DFC48F]">
                                    <input
                                        className="flex-1 bg-transparent text-[#1B2A59] outline-none text-sm font-bold"
                                        value={task.title || ''}
                                        onChange={e => handleUpdateEditTask(task.id, e.target.value)}
                                    />
                                    <button type="button" onClick={() => handleRemoveEditTask(task.id)} className="text-rose-600 hover:text-rose-700 p-1 cursor-pointer">
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            ))}

                            <div className="flex items-center gap-2 p-2 coptic-card rounded-xl border border-[#DFC48F] mt-4">
                                <input
                                    className="flex-1 bg-transparent text-[#1B2A59] outline-none text-sm px-2 font-bold"
                                    placeholder="إضافة مهمة جديدة..."
                                    value={newTaskTitle}
                                    onChange={e => setNewTaskTitle(e.target.value)}
                                    onKeyPress={e => e.key === 'Enter' && handleAddNewTask()}
                                />
                                <button type="button" onClick={handleAddNewTask} className="p-2 bg-emerald-100 text-emerald-800 hover:bg-emerald-700 hover:text-white rounded-lg transition-colors cursor-pointer">
                                    <Plus size={18} />
                                </button>
                            </div>

                            <button type="button" onClick={handleSaveEdit} className="w-full bg-[#1B2A59] hover:bg-[#142047] text-amber-100 p-4 rounded-2xl font-black text-base flex justify-center items-center gap-2 mt-4 shadow-lg cursor-pointer">
                                <Save size={20} className="text-amber-300" /> حفظ جميع التعديلات
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
