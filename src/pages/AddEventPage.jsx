import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Plus, Trash2, ArrowRight, MapPin, Globe } from 'lucide-react';
import { db } from '../db/database';
import useAutoSync from '../hooks/useAutoSync';
import { resolveUserAccessScope } from '../utils/notificationScopeEngine';
import { useSmartNavigation } from '../hooks/useSmartNavigation';
import { readScopedStorage } from '../utils/tenantConfig';

export default function AddEventPage() {
    const { triggerAutoSync } = useAutoSync();
    const { goBack } = useSmartNavigation();
    const navigate = useNavigate();
    const [title, setTitle] = useState('');
    const [date, setDate] = useState('');
    const [tasks, setTasks] = useState([]);
    const [manualTask, setManualTask] = useState('');
    const [price, setPrice] = useState('');

    const accessScope = resolveUserAccessScope(null, [], { includeFallback: true });
    const currentSyncKey = accessScope.primarySyncKey || accessScope.activeSyncKey || readScopedStorage('currentSyncKey');
    const servantData = JSON.parse(readScopedStorage('currentServant') || '{}');

    const isLeader = accessScope.isSuperAdmin;
    const [isGlobal, setIsGlobal] = useState(false);

    const addManualTask = () => {
        if (!manualTask.trim()) return;
        setTasks([...tasks, {
            id: Date.now().toString(),
            title: manualTask,
            isCompleted: false,
            completedByName: '',
            note: ''
        }]);
        setManualTask('');
    };

    const removeTask = (id) => {
        setTasks(tasks.filter(t => t.id !== id));
    };

    const saveEvent = async () => {
        if (!title || !date) return alert("من فضلك اكتب اسم الحدث والتاريخ أولاً");

        const now = new Date().toISOString();
        const newEvent = {
            id: `ev_${Date.now()}`,
            syncKey: (isLeader && isGlobal) ? 'global' : currentSyncKey,
            isGlobal: isLeader ? isGlobal : false,
            createdAt: Date.now(),
            title,
            date,
            price: price || 'مجاناً',
            createdBy: servantData.name || 'خادم',
            tasks: tasks,
            isDirty: true,
            updatedAt: now,
            isDeleted: false
        };

        await db.events.add(newEvent);
        triggerAutoSync();
        navigate('/calendar');
    };

    return (
        <div className="min-h-screen coptic-cream-surface text-[#231B12] pb-24" dir="rtl">
            <header
                className="text-white px-4 py-4 flex items-center justify-between sticky top-0 z-50 shadow-lg border-b border-amber-400/25 rounded-b-3xl"
                style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 72%, #8C621E 100%)' }}
            >
                <div className="flex items-center gap-3">
                    <button type="button" onClick={() => goBack('/calendar')} className="p-2 bg-white/15 hover:bg-white/25 rounded-full transition-colors text-white cursor-pointer">
                        <ArrowRight size={20} />
                    </button>
                    <h1 className="font-calligraphic text-xl font-bold text-amber-100">إضافة حدث أو رحلة</h1>
                </div>
            </header>

            <div className="max-w-xl mx-auto px-4 mt-6 space-y-6">

                {/* 1. بيانات الحدث الأساسية */}
                <div className="coptic-card p-5 rounded-3xl border border-[#DFC48F] shadow-sm space-y-4">
                    <div>
                        <label className="text-xs font-black text-[#1B2A59] ml-1">اسم الحدث</label>
                        <input
                            className="coptic-cream-input w-full mt-1 p-4 rounded-2xl text-[#1B2A59] outline-none font-bold"
                            placeholder="مثال: رحلة دير أو مؤتمر شباب..."
                            value={title} onChange={e => setTitle(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-xs font-black text-[#1B2A59] ml-1">التاريخ</label>
                        <input
                            type="date"
                            className="coptic-cream-input w-full mt-1 p-4 rounded-2xl text-[#1B2A59] outline-none font-bold"
                            value={date} onChange={e => setDate(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-xs font-black text-[#1B2A59] ml-1">تكلفة الفرد (السعر)</label>
                        <input
                            type="text"
                            className="coptic-cream-input w-full mt-1 p-4 rounded-2xl text-[#1B2A59] outline-none font-bold"
                            placeholder="مثال: 150 جنيه / أو اتركه فارغاً لو مجاناً"
                            value={price} onChange={e => setPrice(e.target.value)}
                        />
                    </div>

                    {isLeader && (
                        <div className="flex items-center gap-3 bg-amber-50 p-4 rounded-2xl border border-amber-200 mt-2">
                            <input
                                type="checkbox"
                                id="globalEvent"
                                checked={isGlobal}
                                onChange={(e) => setIsGlobal(e.target.checked)}
                                className="w-5 h-5 accent-[#1B2A59] rounded cursor-pointer"
                            />
                            <label htmlFor="globalEvent" className="text-[#1B2A59] font-black text-sm cursor-pointer flex items-center gap-2">
                                <Globe size={18} className="text-[#C8942E]" />
                                حدث عام (يظهر لجميع الأسر والخدام)
                            </label>
                        </div>
                    )}
                </div>

                {/* 2. قائمة المهام */}
                <div className="coptic-card p-5 rounded-3xl border border-[#DFC48F] shadow-sm">
                    <h3 className="font-black text-[#1B2A59] mb-4 flex items-center gap-2">
                        <MapPin className="text-[#C8942E]" size={20} /> قائمة المهام المطلوبة
                    </h3>

                    <div className="flex gap-2 mb-5">
                        <input
                            className="coptic-cream-input flex-1 p-3 rounded-xl text-sm outline-none font-bold text-[#1B2A59]"
                            placeholder="إضافة مهمة يدوياً..."
                            value={manualTask} onChange={e => setManualTask(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && addManualTask()}
                        />
                        <button type="button" onClick={addManualTask} className="bg-[#1B2A59] text-amber-100 p-3 rounded-xl hover:bg-[#142047] transition-colors cursor-pointer"><Plus size={20} /></button>
                    </div>

                    <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                        {tasks.map(task => (
                            <div key={task.id} className="flex items-center justify-between p-3 bg-[#FAF3E3] rounded-xl border border-[#DFC48F]">
                                <span className="text-sm font-bold text-[#1B2A59] flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-[#C8942E]"></span> {task.title}
                                </span>
                                <button type="button" onClick={() => removeTask(task.id)} className="text-rose-600 hover:text-rose-700 transition-colors bg-white p-1.5 rounded-lg border border-rose-200 cursor-pointer">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                        {tasks.length === 0 && (
                            <p className="text-center text-xs font-bold text-[#6E5329] py-6 border border-dashed border-[#DFC48F] rounded-xl bg-[#FAF3E3]/50">
                                لم يتم إضافة أي مهام للحدث بعد.
                            </p>
                        )}
                    </div>
                </div>

                {/* 3. زر الحفظ */}
                <button
                    type="button"
                    onClick={saveEvent}
                    className="w-full bg-[#1B2A59] hover:bg-[#142047] text-amber-100 p-4 rounded-2xl font-black text-base flex justify-center items-center gap-2 transition-all shadow-lg active:scale-95 mt-4 cursor-pointer"
                >
                    <Check size={22} className="text-amber-300" /> إنشاء الحدث وحفظه
                </button>
            </div>
        </div>
    );
}
