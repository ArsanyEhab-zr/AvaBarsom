/* eslint-disable no-unused-vars */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    AlertCircle,
    BellRing,
    CheckCircle2,
    ChevronLeft,
    Copy,
    ExternalLink,
    Film,
    Image as ImageIcon,
    Link2,
    Loader2,
    Maximize2,
    Megaphone,
    MessageCircle,
    Phone,
    Play,
    Plus,
    Search,
    Send,
    Share2,
    SkipForward,
    Square,
    Trash2,
    Upload,
    UserCheck,
    Users,
    Video,
    X
} from 'lucide-react';
import { db } from '../db/database';
import { firestore, isFirebaseConfigured } from '../db/firebase';
import { uploadImageWithFallback, uploadVideoToCloudinary, getCloudinaryConfig } from '../utils/cloudinary';
import {
    resolveUserAccessScope,
    extractAllOsrasFromSettings,
    getImpersonatedOsra
} from '../utils/notificationScopeEngine';
import { readScopedStorage } from '../utils/tenantConfig';
import { requestAppNotificationPermission } from '../utils/pwaNotificationService';
import {
    MESSAGE_DEFAULT_LINK_LABEL,
    parseVideoEmbedUrl,
    formatBroadcastWhatsappText,
    buildWhatsappDirectLink,
    getAudienceScopeOptions,
    resolveTargetRecipients,
    isMessageVisibleInHomeHub,
    isMessageVisibleToChild,
    isMessageTombstoned,
    isDemoOrFakeMessage,
    canCurrentUserDeleteMessage,
    saveAndBroadcastMessage,
    subscribeToRealtimeMessages,
    deleteBroadcastMessage
} from '../utils/messagingEngine';

function sanitizeExternalHttpUrl(raw = '') {
    const val = String(raw || '').trim();
    if (!val) return '';
    if (/^https?:\/\//i.test(val)) return val;
    return `https://${val}`;
}

function playSubtleIncomingChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.14); // A5
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.36);
        setTimeout(() => {
            try { ctx.close(); } catch (_e) {}
        }, 500);
    } catch (_e) {
        // Ignore audio context autoplay restrictions
    }
}

export function IncomingMessageToastBanner() {
    const [toastMsg, setToastMsg] = useState(null);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        let hideTimer = null;
        const handleIncoming = (ev) => {
            const incoming = ev?.detail?.message;
            if (!incoming) return;
            setToastMsg(incoming);
            playSubtleIncomingChime();
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(() => setToastMsg(null), 7000);
        };
        window.addEventListener('church-incoming-message-toast', handleIncoming);
        return () => {
            window.removeEventListener('church-incoming-message-toast', handleIncoming);
            if (hideTimer) clearTimeout(hideTimer);
        };
    }, []);

    if (!toastMsg) return null;

    return (
        <div
            className="fixed top-4 left-4 right-4 z-[140] max-w-md mx-auto rounded-2xl border-2 border-amber-300 text-white shadow-2xl p-3.5 animate-in slide-in-from-top-4 duration-300"
            style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 72%, #8C621E 100%)' }}
            role="alert"
        >
            <div className="flex items-start justify-between gap-2.5">
                <div className="flex items-start gap-2.5 min-w-0">
                    <span className="w-9 h-9 rounded-xl bg-amber-400 text-[#162447] flex items-center justify-center shrink-0 shadow-xs">
                        <BellRing size={18} />
                    </span>
                    <div className="min-w-0">
                        <span className="text-[10px] font-black text-amber-200 block">
                            رسالة جديدة من {toastMsg.senderName || 'إدارة الخدمة'}
                        </span>
                        <h4 className="font-black text-xs sm:text-sm text-white truncate">
                            {toastMsg.title || 'إعلان جديد'}
                        </h4>
                        {toastMsg.body && (
                            <p className="text-[11px] font-semibold text-indigo-100/90 line-clamp-2 mt-0.5">
                                {toastMsg.body}
                            </p>
                        )}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => setToastMsg(null)}
                    className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center shrink-0 cursor-pointer"
                    aria-label="إغلاق التنبيه"
                >
                    <X size={14} />
                </button>
            </div>
        </div>
    );
}

export function NotificationPermissionBanner({ className = '' }) {
    const [permState, setPermState] = useState(() => {
        if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
        return Notification.permission;
    });
    const [dismissed, setDismissed] = useState(false);
    const [isRequesting, setIsRequesting] = useState(false);

    if (permState !== 'default' || dismissed) return null;

    const handleEnable = async () => {
        setIsRequesting(true);
        try {
            const result = await requestAppNotificationPermission();
            setPermState(result);
        } finally {
            setIsRequesting(false);
        }
    };

    return (
        <div className={`rounded-2xl border border-[#C8942E]/50 bg-gradient-to-l from-[#162447] to-[#1F3463] text-white p-3.5 shadow-md flex flex-wrap items-center justify-between gap-2.5 ${className}`}>
            <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-9 h-9 rounded-xl bg-amber-400/20 border border-amber-300/40 text-amber-300 flex items-center justify-center shrink-0">
                    <BellRing size={18} />
                </span>
                <div className="min-w-0">
                    <span className="font-black text-xs sm:text-sm text-amber-100 block">
                        تفعيل إشعارات الرسائل والتنبيهات على الموبايل
                    </span>
                    <span className="text-[10px] font-bold text-indigo-100/85 block">
                        لتصلك إعلانات الخدمة ورسائل الفصل لحظياً حتى عند إغلاق التطبيق
                    </span>
                </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <button
                    type="button"
                    disabled={isRequesting}
                    onClick={handleEnable}
                    className="px-3.5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-[#162447] text-xs font-black inline-flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-60"
                >
                    {isRequesting ? <Loader2 size={13} className="animate-spin" /> : <BellRing size={13} />}
                    <span>تفعيل الآن</span>
                </button>
                <button
                    type="button"
                    onClick={() => setDismissed(true)}
                    className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
                    aria-label="إخفاء"
                >
                    <X size={14} />
                </button>
            </div>
        </div>
    );
}

export function EmbeddedVideoPlayer({ videoUrl = '' }) {
    const parsed = useMemo(() => parseVideoEmbedUrl(videoUrl), [videoUrl]);
    if (!videoUrl || parsed.type === 'none') return null;

    if (parsed.type === 'iframe') {
        return (
            <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-[#162447] border border-[#DFC48F] shadow-sm">
                <iframe
                    src={parsed.embedUrl}
                    title="فيديو مرفق"
                    className="w-full h-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                />
            </div>
        );
    }

    if (parsed.type === 'video') {
        return (
            <div className="w-full rounded-2xl overflow-hidden bg-[#162447] border border-[#DFC48F] shadow-sm">
                <video
                    src={parsed.embedUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full max-h-80 object-contain mx-auto"
                />
            </div>
        );
    }

    return (
        <a
            href={sanitizeExternalHttpUrl(parsed.rawUrl)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-2 p-3.5 rounded-2xl bg-[#1B2A59]/5 border border-[#DFC48F] hover:bg-[#EFE0C2]/40 transition-colors"
        >
            <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-9 h-9 rounded-xl bg-[#1B2A59] text-amber-300 flex items-center justify-center shrink-0">
                    <Video size={18} />
                </span>
                <div className="min-w-0">
                    <span className="text-xs font-black text-[#1B2A59] block">فيديو مرفق</span>
                    <span className="text-[11px] font-bold text-[#6E5329] truncate block" dir="ltr">
                        {parsed.rawUrl}
                    </span>
                </div>
            </div>
            <ExternalLink size={16} className="text-[#8C621E] shrink-0" />
        </a>
    );
}

export function BroadcastMessagesFeed({
    mode = 'servant', // 'servant' | 'parent'
    childSyncKey = '',
    title = '',
    maxItems = 12,
    onComposeClick = null
}) {
    const [lightboxImage, setLightboxImage] = useState('');
    const [deletingId, setDeletingId] = useState('');

    const appSettings = useMemo(() => {
        try {
            return JSON.parse(readScopedStorage('appSettings') || '{}') || {};
        } catch {
            return {};
        }
    }, []);
    const accessScope = resolveUserAccessScope(appSettings, [], { includeFallback: true });
    const currentServant = useMemo(() => {
        try {
            return JSON.parse(readScopedStorage('currentServant') || '{}') || {};
        } catch {
            return {};
        }
    }, []);
    const allOsras = useMemo(
        () => extractAllOsrasFromSettings(appSettings, [], { includeFallback: true }),
        [appSettings]
    );

    const effectiveRealtimeKey = mode === 'parent'
        ? childSyncKey
        : ((accessScope.isClassServant || accessScope.isImpersonating) ? accessScope.activeSyncKey : '');
    const listenAllGroups = mode === 'servant' && (accessScope.isSuperAdmin || accessScope.isStageLeader) && !accessScope.isImpersonating;

    const relevanceRef = useRef(() => true);
    relevanceRef.current = (msg) => (
        mode === 'parent'
            ? isMessageVisibleToChild(msg, childSyncKey, allOsras)
            : isMessageVisibleInHomeHub(msg, accessScope, currentServant, allOsras)
    );

    useEffect(() => {
        if (!isFirebaseConfigured || !firestore) return undefined;
        return subscribeToRealtimeMessages(firestore, {
            syncKey: effectiveRealtimeKey,
            listenAllGroups,
            isMessageRelevantToViewer: (msg) => relevanceRef.current(msg)
        });
    }, [effectiveRealtimeKey, listenAllGroups]);

    const rawMessages = useLiveQuery(
        () => (db?.messages ? db.messages.filter(m => !m.isDeleted).toArray() : Promise.resolve([])),
        []
    ) || [];

    const visibleMessages = useMemo(() => {
        const filtered = rawMessages.filter((msg) => {
            if (!msg || msg.isDeleted || isMessageTombstoned(msg.id) || isDemoOrFakeMessage(msg)) return false;
            return mode === 'parent'
                ? isMessageVisibleToChild(msg, childSyncKey, allOsras)
                : isMessageVisibleInHomeHub(msg, accessScope, currentServant, allOsras);
        });
        return [...filtered]
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
            .slice(0, maxItems);
    }, [rawMessages, mode, childSyncKey, allOsras, accessScope, currentServant, maxItems]);

    const sectionTitle = title || (
        mode === 'parent'
            ? 'رسائل وإعلانات الأسرة والكنيسة'
            : 'سجل الرسائل والإعلانات المرسلة والواردة'
    );

    const handleDeleteMessage = async (msg) => {
        if (!msg?.id) return;
        setDeletingId(msg.id);
        try {
            await deleteBroadcastMessage(
                msg.id,
                msg.targetSyncKey || msg.syncKey || '',
                isFirebaseConfigured ? firestore : null,
                { scopeKind: msg.scopeKind || msg.targetScope }
            );
        } finally {
            setDeletingId('');
        }
    };

    if (visibleMessages.length === 0 && mode === 'servant' && !onComposeClick) {
        return null;
    }

    return (
        <section className="coptic-card rounded-3xl p-4 sm:p-5 border border-[#DFC48F] shadow-sm space-y-3.5 animate-card-enter">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E7D4AF] pb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#162447] to-[#8C621E] text-amber-200 flex items-center justify-center shrink-0 shadow-xs">
                        <Megaphone size={18} />
                    </span>
                    <div className="min-w-0">
                        <h3 className="font-calligraphic text-lg sm:text-xl font-bold text-[#1B2A59] truncate">
                            {sectionTitle}
                        </h3>
                        <p className="text-[11px] font-bold text-[#6E5329]">
                            {visibleMessages.length > 0
                                ? `${visibleMessages.length} رسالة وإعلان مفعّل — بث مباشر`
                                : 'لا توجد رسائل أو إعلانات حالياً'}
                        </p>
                    </div>
                </div>

                {onComposeClick && (
                    <button
                        type="button"
                        onClick={onComposeClick}
                        className="px-3.5 py-2 rounded-xl bg-[#1B2A59] hover:bg-[#142047] text-amber-200 text-xs font-black inline-flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                    >
                        <Send size={14} />
                        <span>إرسال رسالة</span>
                    </button>
                )}
            </div>

            {visibleMessages.length > 0 ? (
                <div className="space-y-3">
                    {visibleMessages.map((msg) => {
                        const allowDelete = mode === 'servant' && canCurrentUserDeleteMessage(msg, accessScope, currentServant);
                        return (
                            <article
                                key={msg.id}
                                className="bg-[#FFFDF7] border border-[#DFC48F] rounded-2xl p-4 space-y-3 shadow-2xs"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                        <span className="text-[10px] font-black bg-[#1B2A59] text-amber-200 px-2.5 py-0.5 rounded-full">
                                            {msg.senderName || 'إدارة الخدمة'}
                                        </span>
                                        {msg.targetLabel && (
                                            <span className="text-[10px] font-black bg-[#EFE0C2] text-[#7A5617] px-2.5 py-0.5 rounded-full">
                                                {msg.targetLabel}
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        {msg.createdAt && (
                                            <span className="text-[10px] font-bold text-[#6E5329]">
                                                {new Date(msg.createdAt).toLocaleDateString('ar-EG', {
                                                    day: 'numeric',
                                                    month: 'short',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </span>
                                        )}
                                        {allowDelete && (
                                            <button
                                                type="button"
                                                disabled={deletingId === msg.id}
                                                onClick={() => handleDeleteMessage(msg)}
                                                className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-black inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                                            >
                                                {deletingId === msg.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                                                <span>حذف الرسالة</span>
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div>
                                    {msg.title && (
                                        <h4 className="font-black text-[#1B2A59] text-sm sm:text-base leading-snug">
                                            {msg.title}
                                        </h4>
                                    )}
                                    {msg.body && (
                                        <p className="text-xs sm:text-sm font-semibold text-[#4B3D28] mt-1 leading-relaxed whitespace-pre-wrap">
                                            {msg.body}
                                        </p>
                                    )}
                                </div>

                                {msg.imageUrl && (
                                    <div className="relative rounded-2xl overflow-hidden border border-[#DFC48F] bg-[#FAF3E3]">
                                        <img
                                            src={msg.imageUrl}
                                            alt={msg.title || 'صورة مرفقة'}
                                            onClick={() => setLightboxImage(msg.imageUrl)}
                                            className="w-full max-h-72 object-cover cursor-pointer hover:opacity-95 transition-opacity"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setLightboxImage(msg.imageUrl)}
                                            className="absolute bottom-2 left-2 bg-[#162447]/80 text-amber-200 px-2.5 py-1 rounded-xl text-[10px] font-black inline-flex items-center gap-1 cursor-pointer"
                                        >
                                            <Maximize2 size={12} /> تكبير الصورة
                                        </button>
                                    </div>
                                )}

                                {msg.videoUrl && <EmbeddedVideoPlayer videoUrl={msg.videoUrl} />}

                                {msg.linkUrl && (
                                    <a
                                        href={sanitizeExternalHttpUrl(msg.linkUrl)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-l from-[#1B2A59] to-[#263C80] hover:brightness-110 text-amber-100 text-xs font-black shadow-sm transition-all"
                                    >
                                        <Link2 size={14} className="text-amber-300" />
                                        <span>{msg.linkLabel || msg.linkTitle || MESSAGE_DEFAULT_LINK_LABEL}</span>
                                        <ExternalLink size={13} />
                                    </a>
                                )}
                            </article>
                        );
                    })}
                </div>
            ) : (
                <div className="text-center py-6 text-xs font-bold text-[#6E5329] bg-[#FAF4E8]/70 rounded-2xl border border-dashed border-[#DFC99B]">
                    لا توجد رسائل أو إعلانات جديدة حتى الآن.
                </div>
            )}

            {lightboxImage && (
                <div
                    className="fixed inset-0 z-[130] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setLightboxImage('')}
                >
                    <div className="relative max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            onClick={() => setLightboxImage('')}
                            className="absolute -top-11 left-0 w-9 h-9 rounded-full bg-white text-[#1B2A59] flex items-center justify-center shadow-lg cursor-pointer"
                            aria-label="إغلاق"
                        >
                            <X size={18} />
                        </button>
                        <img
                            src={lightboxImage}
                            alt="معاينة الصورة"
                            className="w-full max-h-[82vh] object-contain rounded-2xl border border-amber-300/40 shadow-2xl"
                        />
                    </div>
                </div>
            )}
        </section>
    );
}

export default function BroadcastMessageCenter({
    isOpen,
    onClose,
    initialTargetType = '',
    initialSyncKey = ''
}) {
    const appSettings = useMemo(() => {
        try {
            return JSON.parse(readScopedStorage('appSettings') || '{}') || {};
        } catch {
            return {};
        }
    }, [isOpen]);

    const currentServant = useMemo(() => {
        try {
            return JSON.parse(readScopedStorage('currentServant') || '{}') || {};
        } catch {
            return {};
        }
    }, [isOpen]);

    const accessScope = useMemo(
        () => resolveUserAccessScope(appSettings, [], { includeFallback: true }),
        [appSettings]
    );
    const impersonatedOsra = useMemo(
        () => getImpersonatedOsra(),
        [isOpen]
    );
    const allOsras = useMemo(
        () => extractAllOsrasFromSettings(appSettings, [], { includeFallback: true }),
        [appSettings]
    );

    const stagesList = useMemo(() => {
        const set = new Set();
        allOsras.forEach((o) => {
            if (o.stageName) set.add(o.stageName);
        });
        return Array.from(set);
    }, [allOsras]);

    const audienceOptions = useMemo(
        () => getAudienceScopeOptions(accessScope, impersonatedOsra?.name || ''),
        [accessScope, impersonatedOsra?.name]
    );

    const [activeTab, setActiveTab] = useState('compose'); // 'compose' | 'history'
    const [selectedOptionId, setSelectedOptionId] = useState('');
    const [selectedStage, setSelectedStage] = useState('');
    const [selectedClassKey, setSelectedClassKey] = useState('');
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [videoUrl, setVideoUrl] = useState('');
    const [linkUrl, setLinkUrl] = useState('');
    const [linkLabel, setLinkLabel] = useState('');
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [isUploadingVideo, setIsUploadingVideo] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [feedback, setFeedback] = useState({ type: '', text: '' });
    const [lastDispatchedMsg, setLastDispatchedMsg] = useState(null);
    const [recipientSearch, setRecipientSearch] = useState('');
    const [copiedText, setCopiedText] = useState(false);

    // محرك الإرسال الفردي المتتالي الذكي عبر واتساب (Phase 3)
    const [personalizeNames, setPersonalizeNames] = useState(true);
    const [autoAdvanceOnReturn, setAutoAdvanceOnReturn] = useState(true);
    const [campaignStatus, setCampaignStatus] = useState('idle'); // 'idle' | 'running' | 'completed'
    const [campaignQueue, setCampaignQueue] = useState([]);
    const [campaignIndex, setCampaignIndex] = useState(0);
    const [sentRecipientIds, setSentRecipientIds] = useState(() => new Set());
    const [skippedRecipientIds, setSkippedRecipientIds] = useState(() => new Set());
    const [autoAdvancePending, setAutoAdvancePending] = useState(false);

    const awaitingReturnRef = useRef(false);
    const autoTimerRef = useRef(null);

    const clearAutoTimer = () => {
        if (autoTimerRef.current) {
            clearTimeout(autoTimerRef.current);
            autoTimerRef.current = null;
        }
        setAutoAdvancePending(false);
    };

    useEffect(() => {
        if (!isOpen) {
            clearAutoTimer();
            awaitingReturnRef.current = false;
            setCampaignStatus('idle');
            return;
        }
        const preferred =
            (initialTargetType === 'children' && initialSyncKey && audienceOptions.find(o => o.id === 'class_children')) ||
            (initialTargetType && audienceOptions.find(o => o.targetType === initialTargetType)) ||
            audienceOptions[0];
        if (preferred) setSelectedOptionId(preferred.id);

        if (!selectedStage && stagesList[0]) {
            setSelectedStage(stagesList[0]);
        }
        if (initialSyncKey && allOsras.some(o => o.syncKey === initialSyncKey)) {
            setSelectedClassKey(initialSyncKey);
        } else if (!selectedClassKey && (impersonatedOsra?.syncKey || allOsras[0]?.syncKey)) {
            setSelectedClassKey(impersonatedOsra?.syncKey || allOsras[0]?.syncKey || '');
        }
        setFeedback({ type: '', text: '' });
    }, [isOpen, initialTargetType, initialSyncKey]);

    const allChildren = useLiveQuery(
        () => (isOpen ? db.children.filter(c => !c.isDeleted).toArray() : Promise.resolve([])),
        [isOpen]
    ) || [];

    const allSavedMessages = useLiveQuery(
        () => (db?.messages ? db.messages.filter(m => !m.isDeleted).toArray() : Promise.resolve([])),
        [isOpen]
    ) || [];

    const currentOpt = audienceOptions.find(o => o.id === selectedOptionId) || audienceOptions[0] || {};
    const effectiveTargetType = currentOpt.targetType || 'children';
    const effectiveScopeKind = currentOpt.scopeKind || 'class_children';
    const effectiveStage = currentOpt.fixedStage || (currentOpt.needsStage ? selectedStage : '');
    const effectiveClassKey = currentOpt.fixedSyncKey || (currentOpt.needsClass ? selectedClassKey : '');

    const targetLabel = (() => {
        if (effectiveScopeKind === 'all_servants') return 'كل خدام الكنيسة';
        if (effectiveScopeKind === 'all_children') return 'كل مخدومي الكنيسة وأولياء الأمور';
        if (effectiveScopeKind === 'stage_servants') return `خدام ${effectiveStage || 'المرحلة'}`;
        if (effectiveScopeKind === 'stage_children') return `مخدومي ${effectiveStage || 'المرحلة'}`;
        const osraObj = allOsras.find(o => o.syncKey === effectiveClassKey);
        const clsName = osraObj?.name || effectiveClassKey || 'الفصل';
        return effectiveTargetType === 'servants' ? `خدام ${clsName}` : `مخدومي وأولياء أمور ${clsName}`;
    })();

    const draftMessagePreview = {
        title: title.trim() || 'إعلان من الكنيسة',
        body: body.trim(),
        imageUrl: imageUrl.trim(),
        videoUrl: videoUrl.trim(),
        linkUrl: linkUrl.trim(),
        linkLabel: linkLabel.trim() || MESSAGE_DEFAULT_LINK_LABEL,
        targetLabel
    };

    const activeDispatcherMessage = lastDispatchedMsg || draftMessagePreview;

    const allResolvedRecipients = useMemo(() => {
        if (!isOpen) return [];
        return resolveTargetRecipients({
            targetType: activeDispatcherMessage.targetType || effectiveTargetType,
            scopeKind: activeDispatcherMessage.scopeKind || effectiveScopeKind,
            targetSyncKey: activeDispatcherMessage.targetSyncKey || effectiveClassKey,
            targetStage: activeDispatcherMessage.targetStage || effectiveStage,
            allOsras,
            children: allChildren,
            servants: appSettings?.servants || [],
            services: appSettings?.services || []
        });
    }, [
        isOpen,
        activeDispatcherMessage,
        effectiveTargetType,
        effectiveScopeKind,
        effectiveClassKey,
        effectiveStage,
        allOsras,
        allChildren,
        appSettings
    ]);

    const recipients = useMemo(() => {
        const q = recipientSearch.trim().toLowerCase();
        if (!q) return allResolvedRecipients;
        return allResolvedRecipients.filter(r =>
            String(r.name || '').toLowerCase().includes(q) ||
            String(r.phone || '').includes(q) ||
            String(r.subtitle || '').toLowerCase().includes(q)
        );
    }, [allResolvedRecipients, recipientSearch]);

    const openRecipientWhatsapp = (rec, idx, markAsSent = true) => {
        if (!rec) return;
        const msgObj = activeDispatcherMessage;
        const text = formatBroadcastWhatsappText(msgObj, personalizeNames ? rec.name : '');
        const waUrl = buildWhatsappDirectLink(rec.phone, text);
        window.open(waUrl, '_blank', 'noopener,noreferrer');
        if (markAsSent) {
            setSentRecipientIds((prev) => new Set(prev).add(rec.id));
        }
        if (idx !== undefined && idx !== null) {
            awaitingReturnRef.current = true;
        }
    };

    const advanceCampaignToNext = () => {
        clearAutoTimer();
        awaitingReturnRef.current = false;
        if (campaignIndex + 1 >= campaignQueue.length) {
            setCampaignStatus('completed');
            return;
        }
        const nextIdx = campaignIndex + 1;
        setCampaignIndex(nextIdx);
        openRecipientWhatsapp(campaignQueue[nextIdx], nextIdx, true);
    };

    // الانتقال التلقائي فور العودة من نافذة واتساب عند تفعيل وضع التتابع
    useEffect(() => {
        if (!isOpen || campaignStatus !== 'running' || !autoAdvanceOnReturn) return undefined;

        const scheduleNextOnReturn = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            if (!awaitingReturnRef.current || campaignStatus !== 'running') return;
            if (campaignIndex + 1 >= campaignQueue.length) {
                awaitingReturnRef.current = false;
                setCampaignStatus('completed');
                return;
            }
            if (autoTimerRef.current) return;
            setAutoAdvancePending(true);
            autoTimerRef.current = setTimeout(() => {
                autoTimerRef.current = null;
                setAutoAdvancePending(false);
                advanceCampaignToNext();
            }, 1200);
        };

        window.addEventListener('focus', scheduleNextOnReturn);
        document.addEventListener('visibilitychange', scheduleNextOnReturn);
        return () => {
            window.removeEventListener('focus', scheduleNextOnReturn);
            document.removeEventListener('visibilitychange', scheduleNextOnReturn);
        };
    }, [isOpen, campaignStatus, autoAdvanceOnReturn, campaignIndex, campaignQueue]);

    useEffect(() => () => clearAutoTimer(), []);

    if (!isOpen) return null;

    const persistDraftToCloudIfNeeded = async () => {
        if (lastDispatchedMsg) return lastDispatchedMsg;
        if (!title.trim() && !body.trim() && !imageUrl.trim() && !videoUrl.trim() && !linkUrl.trim()) {
            return null;
        }
        const saved = await saveAndBroadcastMessage({
            syncKey: effectiveClassKey || 'ALL',
            targetType: effectiveTargetType,
            scopeKind: effectiveScopeKind,
            targetSyncKey: effectiveClassKey || 'ALL',
            targetStage: effectiveStage,
            targetLabel,
            title: title.trim() || 'رسالة جديدة من الخدمة',
            body: body.trim(),
            imageUrl: imageUrl.trim(),
            videoUrl: videoUrl.trim(),
            linkUrl: linkUrl.trim(),
            linkLabel: linkLabel.trim() || MESSAGE_DEFAULT_LINK_LABEL,
            senderName: currentServant?.name || 'إدارة الخدمة',
            senderRole: currentServant?.role || accessScope.roleTitle || '',
            senderPhone: currentServant?.phone || ''
        }, {
            firestore: isFirebaseConfigured ? firestore : null
        });
        setLastDispatchedMsg(saved);
        return saved;
    };

    const handleImageUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploadingImage(true);
        setFeedback({ type: '', text: '' });
        try {
            const url = await uploadImageWithFallback(file, {
                syncKey: effectiveClassKey || effectiveStage || 'broadcast'
            });
            setImageUrl(url);
            setLastDispatchedMsg(null);
            setFeedback({ type: 'success', text: 'تم تجهيز وإرفاق الصورة بنجاح.' });
        } catch (err) {
            setFeedback({ type: 'error', text: err?.message || 'تعذر رفع الصورة، يمكنك لصق رابط مباشر بدلاً من ذلك.' });
        } finally {
            setIsUploadingImage(false);
        }
    };

    const handleVideoUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const { isConfigured } = getCloudinaryConfig();
        if (!isConfigured || !navigator.onLine) {
            setFeedback({ type: 'error', text: 'رفع ملفات الفيديو يتطلب اتصالاً بالإنترنت وإعداد Cloudinary؛ يمكنك لصق رابط فيديو من YouTube أو Facebook أو Google Drive.' });
            return;
        }
        setIsUploadingVideo(true);
        setFeedback({ type: '', text: '' });
        try {
            const uploaded = await uploadVideoToCloudinary(file, {
                syncKey: effectiveClassKey || effectiveStage || 'broadcast'
            });
            setVideoUrl(uploaded.secureUrl);
            setLastDispatchedMsg(null);
            setFeedback({ type: 'success', text: 'تم رفع الفيديو إلى Cloudinary وتضمينه بنجاح.' });
        } catch (err) {
            setFeedback({ type: 'error', text: err?.message || 'تعذر رفع الفيديو، يمكنك لصق رابط مباشر.' });
        } finally {
            setIsUploadingVideo(false);
        }
    };

    const handleBroadcastSubmit = async (e) => {
        e.preventDefault();
        if (!title.trim() && !body.trim() && !imageUrl.trim() && !videoUrl.trim() && !linkUrl.trim()) {
            setFeedback({ type: 'error', text: 'يرجى كتابة نص الرسالة أو إرفاق وسائط قبل الإرسال.' });
            return;
        }
        setIsSending(true);
        setFeedback({ type: '', text: '' });
        try {
            setLastDispatchedMsg(null);
            const saved = await saveAndBroadcastMessage({
                syncKey: effectiveClassKey || 'ALL',
                targetType: effectiveTargetType,
                scopeKind: effectiveScopeKind,
                targetSyncKey: effectiveClassKey || 'ALL',
                targetStage: effectiveStage,
                targetLabel,
                title: title.trim() || 'رسالة جديدة من الخدمة',
                body: body.trim(),
                imageUrl: imageUrl.trim(),
                videoUrl: videoUrl.trim(),
                linkUrl: linkUrl.trim(),
                linkLabel: linkLabel.trim() || MESSAGE_DEFAULT_LINK_LABEL,
                senderName: currentServant?.name || 'إدارة الخدمة',
                senderRole: currentServant?.role || accessScope.roleTitle || '',
                senderPhone: currentServant?.phone || ''
            }, {
                firestore: isFirebaseConfigured ? firestore : null
            });

            setLastDispatchedMsg(saved);
            setFeedback({
                type: saved.cloudError ? 'error' : 'success',
                text: saved.cloudSynced
                    ? `تم بث الرسالة لحظياً عبر Firebase لـ (${targetLabel}) وظهورها مباشرة على تطبيق ولي الأمر والخدام.`
                    : saved.cloudError
                        ? `تم الحفظ محلياً فقط — تعذر النشر إلى Firebase (${saved.cloudError}).`
                        : `تم حفظ الرسالة محلياً لـ (${targetLabel}).`
            });
        } catch (err) {
            setFeedback({ type: 'error', text: err?.message || 'حدث خطأ أثناء إرسال الرسالة.' });
        } finally {
            setIsSending(false);
        }
    };

    const handleStartSequentialCampaign = async () => {
        if (recipients.length === 0) {
            setFeedback({ type: 'error', text: 'لا توجد أرقام موبايل مسجلة ضمن القائمة المختارة لبدء الحملة.' });
            return;
        }
        if (!title.trim() && !body.trim() && !imageUrl.trim() && !videoUrl.trim() && !linkUrl.trim() && !lastDispatchedMsg) {
            setFeedback({ type: 'error', text: 'يرجى كتابة نص الرسالة أو إرفاق وسائط أولاً ثم بدء الإرسال الفردي.' });
            return;
        }

        clearAutoTimer();
        const snapshotQueue = [...recipients];
        setCampaignQueue(snapshotQueue);
        setCampaignIndex(0);
        setSentRecipientIds(new Set());
        setSkippedRecipientIds(new Set());
        setCampaignStatus('running');
        // فتح محادثة المستلم الأول بشكل متزامن داخل نقرة المستخدم حتى لا يوقفه مانع النوافذ المنبثقة
        openRecipientWhatsapp(snapshotQueue[0], 0, true);

        setIsSending(true);
        try {
            await persistDraftToCloudIfNeeded();
        } finally {
            setIsSending(false);
        }
    };

    const handleSkipCurrent = () => {
        clearAutoTimer();
        awaitingReturnRef.current = false;
        const curr = campaignQueue[campaignIndex];
        if (curr) {
            setSkippedRecipientIds((prev) => new Set(prev).add(curr.id));
        }
        if (campaignIndex + 1 >= campaignQueue.length) {
            setCampaignStatus('completed');
            return;
        }
        const nextIdx = campaignIndex + 1;
        setCampaignIndex(nextIdx);
        openRecipientWhatsapp(campaignQueue[nextIdx], nextIdx, true);
    };

    const handleStopCampaign = () => {
        clearAutoTimer();
        awaitingReturnRef.current = false;
        setCampaignStatus('idle');
    };

    const handleOpenDesktopBatch5 = async () => {
        if (recipients.length === 0) return;
        const pending = recipients.filter(r => !sentRecipientIds.has(r.id));
        const batch = (pending.length > 0 ? pending : recipients).slice(0, 5);
        if (batch.length === 0) return;
        batch.forEach((rec) => {
            const text = formatBroadcastWhatsappText(activeDispatcherMessage, personalizeNames ? rec.name : '');
            window.open(buildWhatsappDirectLink(rec.phone, text), '_blank', 'noopener,noreferrer');
        });
        setSentRecipientIds((prev) => {
            const next = new Set(prev);
            batch.forEach(r => next.add(r.id));
            return next;
        });
        setFeedback({ type: 'success', text: `تم فتح ${batch.length} محادثات واتساب سريعة في نوافذ جديدة.` });
        void persistDraftToCloudIfNeeded();
    };

    const handleShareGroupWhatsapp = async () => {
        const msgObj = activeDispatcherMessage;
        const formattedText = formatBroadcastWhatsappText(msgObj);
        if (!formattedText.trim()) return;

        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            try {
                const sharePayload = {
                    title: msgObj.title || 'رسالة من الكنيسة',
                    text: formattedText
                };
                if (msgObj.linkUrl) sharePayload.url = sanitizeExternalHttpUrl(msgObj.linkUrl);
                await navigator.share(sharePayload);
                return;
            } catch (_err) {
                // Fallback to WhatsApp URL when share sheet cancelled/unsupported
            }
        }
        window.open(buildWhatsappDirectLink('', formattedText), '_blank', 'noopener,noreferrer');
    };

    const handleCopyMessageText = async () => {
        const formatted = formatBroadcastWhatsappText(activeDispatcherMessage);
        try {
            await navigator.clipboard.writeText(formatted);
            setCopiedText(true);
            setTimeout(() => setCopiedText(false), 2500);
        } catch (_e) {
            // ignore clipboard failure
        }
    };

    const sortedHistory = [...allSavedMessages]
        .filter((m) => !m.isDeleted && !isMessageTombstoned(m.id) && !isDemoOrFakeMessage(m))
        .filter((m) => {
            if (accessScope.isSuperAdmin && !accessScope.isImpersonating) return true;
            if (accessScope.isStageLeader && !accessScope.isImpersonating) {
                return m.targetStage === accessScope.stageName || m.stageName === accessScope.stageName || (accessScope.allowedSyncKeys || []).includes(m.targetSyncKey);
            }
            return m.targetSyncKey === accessScope.activeSyncKey || m.syncKey === accessScope.activeSyncKey;
        })
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    const activeCampaignRecipient = campaignQueue[campaignIndex] || null;
    const campaignSentCount = sentRecipientIds.size;

    return (
        <div
            className="fixed inset-0 z-[120] bg-[#0F1B3A]/70 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-5 animate-fade-in"
            onClick={(e) => {
                if (e.target === e.currentTarget && onClose) onClose();
            }}
            dir="rtl"
        >
            <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-[2rem] bg-[#FAF4E8] border border-[#C8942E]/45 shadow-2xl overflow-hidden flex flex-col">
                {/* Header */}
                <div
                    className="px-5 py-5 text-white border-b-2 border-[#C8942E]/60 sticky top-0 z-20"
                    style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 68%, #8C621E 100%)' }}
                >
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-11 h-11 rounded-2xl bg-white/10 border border-amber-300/40 flex items-center justify-center shrink-0">
                                <Megaphone className="text-amber-300" size={22} />
                            </div>
                            <div className="min-w-0">
                                <h2 className="font-calligraphic text-xl sm:text-2xl font-bold text-amber-100 leading-snug truncate">
                                    مركز إرسال الرسائل والوسائط
                                </h2>
                                <p className="text-[11px] sm:text-xs font-bold text-indigo-100/90 truncate">
                                    بث مباشر في Firebase • إشعار فوري • إرسال واتساب فردي تلقائي
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="إغلاق مركز الرسائل"
                            className="w-9 h-9 rounded-full bg-white/15 border border-white/25 flex items-center justify-center hover:bg-white/25 transition-colors shrink-0 cursor-pointer"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-2 mt-4">
                        <button
                            type="button"
                            onClick={() => setActiveTab('compose')}
                            className={`flex-1 py-2 px-3 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                activeTab === 'compose'
                                    ? 'bg-amber-400 text-[#162447] shadow-sm'
                                    : 'bg-white/10 text-amber-100 hover:bg-white/20'
                            }`}
                        >
                            <Plus size={15} /> إنشاء رسالة وبث واتساب
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('history')}
                            className={`flex-1 py-2 px-3 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                activeTab === 'history'
                                    ? 'bg-amber-400 text-[#162447] shadow-sm'
                                    : 'bg-white/10 text-amber-100 hover:bg-white/20'
                            }`}
                        >
                            <Megaphone size={15} /> سجل الرسائل المرسلة ({sortedHistory.length})
                        </button>
                    </div>
                </div>

                <div className="p-4 sm:p-6 space-y-5">
                    {feedback.text && (
                        <div className={`p-3.5 rounded-2xl border text-xs font-black flex items-center gap-2 ${
                            feedback.type === 'error'
                                ? 'bg-rose-50 text-rose-800 border-rose-200'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        }`}>
                            {feedback.type === 'error' ? <AlertCircle size={16} className="shrink-0" /> : <CheckCircle2 size={16} className="shrink-0" />}
                            <span>{feedback.text}</span>
                        </div>
                    )}

                    {activeTab === 'compose' ? (
                        <>
                            <form onSubmit={handleBroadcastSubmit} className="space-y-4">
                                {/* Target Audience Selector */}
                                <div className="bg-[#FFFDF7] border border-[#DFC48F] rounded-3xl p-4 space-y-3">
                                    <label className="text-xs font-black text-[#1B2A59] flex items-center gap-1.5">
                                        <Users size={15} className="text-[#8C621E]" /> الجمهور المستهدف:
                                    </label>
                                    {audienceOptions.length <= 1 ? (
                                        <div className="px-4 py-3 rounded-2xl bg-[#EFE0C2]/60 border border-[#C8942E]/40 text-xs font-black text-[#1B2A59] flex items-center justify-between gap-2">
                                            <span>{audienceOptions[0]?.label || targetLabel}</span>
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1B2A59] text-amber-200">تلقائي</span>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {audienceOptions.map((opt) => (
                                                <button
                                                    type="button"
                                                    key={opt.id}
                                                    onClick={() => {
                                                        setSelectedOptionId(opt.id);
                                                        setLastDispatchedMsg(null);
                                                    }}
                                                    className={`p-3 rounded-2xl text-right text-xs font-black border transition-all cursor-pointer ${
                                                        selectedOptionId === opt.id
                                                            ? 'bg-[#1B2A59] text-amber-200 border-[#1B2A59] shadow-sm'
                                                            : 'bg-[#FAF4E8] text-[#4B3D28] border-[#DFC48F] hover:border-[#8C621E]'
                                                    }`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {currentOpt.needsStage && stagesList.length > 0 && (
                                        <select
                                            value={selectedStage}
                                            onChange={(e) => {
                                                setSelectedStage(e.target.value);
                                                setLastDispatchedMsg(null);
                                            }}
                                            className="w-full p-3 rounded-2xl coptic-cream-input text-xs font-black"
                                        >
                                            {stagesList.map(st => (
                                                <option key={st} value={st}>{st}</option>
                                            ))}
                                        </select>
                                    )}

                                    {currentOpt.needsClass && allOsras.length > 0 && (
                                        <select
                                            value={selectedClassKey}
                                            onChange={(e) => {
                                                setSelectedClassKey(e.target.value);
                                                setLastDispatchedMsg(null);
                                            }}
                                            className="w-full p-3 rounded-2xl coptic-cream-input text-xs font-black"
                                        >
                                            {allOsras.map(o => (
                                                <option key={o.syncKey} value={o.syncKey}>
                                                    {o.name} {o.serviceName ? `(${o.serviceName})` : ''}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>

                                {/* 1. النص الأساسي */}
                                <div className="bg-[#FFFDF7] border border-[#DFC48F] rounded-3xl p-4 space-y-3">
                                    <div>
                                        <label className="block text-xs font-black text-[#6E5329] mb-1">عنوان الرسالة</label>
                                        <input
                                            type="text"
                                            value={title}
                                            onChange={(e) => {
                                                setTitle(e.target.value);
                                                setLastDispatchedMsg(null);
                                            }}
                                            placeholder="مثال: تنبيه مهم لموعد الاجتماع / آية الأسبوع..."
                                            className="w-full p-3.5 rounded-2xl coptic-cream-input font-bold text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-black text-[#6E5329] mb-1">نص الرسالة</label>
                                        <textarea
                                            value={body}
                                            onChange={(e) => {
                                                setBody(e.target.value);
                                                setLastDispatchedMsg(null);
                                            }}
                                            placeholder="اكتب نص الرسالة أو الإعلان هنا..."
                                            className="w-full p-3.5 rounded-2xl coptic-cream-input font-bold text-sm min-h-24"
                                        />
                                    </div>
                                </div>

                                {/* 2. إرفاق صورة + 3. إرفاق فيديو */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-[#FFFDF7] border border-[#DFC48F] rounded-3xl p-4 space-y-2.5">
                                        <label className="text-xs font-black text-[#1B2A59] flex items-center gap-1.5">
                                            <ImageIcon size={15} className="text-[#8C621E]" /> 2. إرفاق صورة
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="url"
                                                dir="ltr"
                                                value={imageUrl}
                                                onChange={(e) => {
                                                    setImageUrl(e.target.value);
                                                    setLastDispatchedMsg(null);
                                                }}
                                                placeholder="رابط صورة https://... أو ارفع من الجهاز"
                                                className="flex-1 min-w-0 p-2.5 rounded-xl coptic-cream-input text-xs font-bold text-left"
                                            />
                                            <label className="px-3 py-2.5 rounded-xl bg-[#1B2A59] text-amber-200 text-xs font-black flex items-center gap-1 cursor-pointer shrink-0 hover:brightness-110">
                                                {isUploadingImage ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                                <span>رفع</span>
                                                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={isUploadingImage} />
                                            </label>
                                        </div>
                                        {imageUrl && (
                                            <div className="relative rounded-xl overflow-hidden border border-[#DFC48F] bg-[#FAF4E8]">
                                                <img src={imageUrl} alt="معاينة" className="w-full h-36 object-cover" />
                                                <button
                                                    type="button"
                                                    onClick={() => setImageUrl('')}
                                                    className="absolute top-1.5 left-1.5 w-7 h-7 rounded-full bg-rose-600 text-white flex items-center justify-center cursor-pointer shadow"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    <div className="bg-[#FFFDF7] border border-[#DFC48F] rounded-3xl p-4 space-y-2.5">
                                        <label className="text-xs font-black text-[#1B2A59] flex items-center gap-1.5">
                                            <Film size={15} className="text-[#8C621E]" /> 3. إرفاق فيديو (YouTube / Drive / ملف)
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="url"
                                                dir="ltr"
                                                value={videoUrl}
                                                onChange={(e) => {
                                                    setVideoUrl(e.target.value);
                                                    setLastDispatchedMsg(null);
                                                }}
                                                placeholder="رابط YouTube / Facebook / Vimeo / MP4"
                                                className="flex-1 min-w-0 p-2.5 rounded-xl coptic-cream-input text-xs font-bold text-left"
                                            />
                                            <label className="px-3 py-2.5 rounded-xl bg-[#8C621E] text-white text-xs font-black flex items-center gap-1 cursor-pointer shrink-0 hover:brightness-110">
                                                {isUploadingVideo ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                                <span>فيديو</span>
                                                <input type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} disabled={isUploadingVideo} />
                                            </label>
                                        </div>
                                        {videoUrl && <EmbeddedVideoPlayer videoUrl={videoUrl} />}
                                    </div>
                                </div>

                                {/* 4. رابط خارجي */}
                                <div className="bg-[#FFFDF7] border border-[#DFC48F] rounded-3xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-black text-[#1B2A59] flex items-center gap-1.5 mb-1">
                                            <Link2 size={14} className="text-[#8C621E]" /> 4. رابط خارجي مرفق
                                        </label>
                                        <input
                                            type="url"
                                            dir="ltr"
                                            value={linkUrl}
                                            onChange={(e) => {
                                                setLinkUrl(e.target.value);
                                                setLastDispatchedMsg(null);
                                            }}
                                            placeholder="https://..."
                                            className="w-full p-2.5 rounded-xl coptic-cream-input text-xs font-bold text-left"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-black text-[#6E5329] block mb-1">نص زر الرابط</label>
                                        <input
                                            type="text"
                                            value={linkLabel}
                                            onChange={(e) => {
                                                setLinkLabel(e.target.value);
                                                setLastDispatchedMsg(null);
                                            }}
                                            placeholder="مثال: رابط مسابقة الأسبوع / ملف PDF"
                                            className="w-full p-2.5 rounded-xl coptic-cream-input text-xs font-bold"
                                        />
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={isSending || isUploadingImage || isUploadingVideo}
                                    className="w-full py-4 rounded-2xl font-black text-sm text-[#FCE9B8] shadow-lg hover:brightness-110 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                                    style={{ background: 'linear-gradient(135deg, #162447 0%, #1F3463 70%, #8C621E 100%)' }}
                                >
                                    {isSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                                    <span>{isSending ? 'جاري النشر والمزامنة السحابية...' : 'إرسال الرسالة داخل التطبيق وبث الإشعار الآن'}</span>
                                </button>
                            </form>

                            {/* Channel C: Smart Sequential Individual & Group WhatsApp Dispatcher */}
                            <div className="bg-[#FFFDF7] border-2 border-emerald-600/35 rounded-3xl p-4 sm:p-5 space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E7D4AF] pb-3">
                                    <div>
                                        <h3 className="font-calligraphic text-lg font-bold text-[#1B2A59] flex items-center gap-2">
                                            <MessageCircle size={18} className="text-emerald-700" />
                                            <span>محرك الإرسال الفردي المتتالي عبر واتساب</span>
                                        </h3>
                                        <p className="text-[11px] font-bold text-[#6E5329]">
                                            المستلمون بأرقام مسجلة: {recipients.length} ({effectiveTargetType === 'servants' ? 'خدام' : 'مخدومين وأولياء أمور'})
                                        </p>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={handleCopyMessageText}
                                            className="px-3 py-2 rounded-xl bg-[#FAF4E8] border border-[#DFC48F] text-[#1B2A59] text-xs font-black inline-flex items-center gap-1 cursor-pointer hover:bg-[#EFE0C2]"
                                        >
                                            <Copy size={13} />
                                            <span>{copiedText ? 'تم النسخ' : 'نسخ النص'}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleShareGroupWhatsapp}
                                            className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                                        >
                                            <Share2 size={14} />
                                            <span>مشاركة لجروب الواتساب</span>
                                        </button>
                                    </div>
                                </div>

                                {/* تخصيص الاسم + زر الحملة الفردية الرئيسية */}
                                <div className="space-y-2.5 bg-[#FAF4E8] border border-[#DFC48F] rounded-2xl p-3.5">
                                    <label className="flex items-center gap-2 text-xs font-black text-[#1B2A59] cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={personalizeNames}
                                            onChange={(e) => setPersonalizeNames(e.target.checked)}
                                            className="w-4 h-4 accent-[#8C621E] rounded"
                                        />
                                        <span>تخصيص الرسالة باسم كل مخدوم / خادم تلقائياً (سلام ونعمة يا [الاسم])</span>
                                    </label>

                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <button
                                            type="button"
                                            onClick={handleStartSequentialCampaign}
                                            disabled={recipients.length === 0 || isSending}
                                            className="flex-1 py-3.5 px-4 rounded-2xl text-white font-black text-xs sm:text-sm shadow-md hover:brightness-110 transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                                            style={{ background: 'linear-gradient(135deg, #065F46 0%, #059669 65%, #C8942E 100%)' }}
                                        >
                                            <Play size={16} />
                                            <span>بدء الإرسال الفردي لكل القائمة بالتتابع ({recipients.length} مستلم)</span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={handleOpenDesktopBatch5}
                                            disabled={recipients.length === 0 || isSending}
                                            className="py-3 px-3.5 rounded-2xl bg-[#1B2A59] hover:bg-[#142047] text-amber-200 font-black text-xs shadow-sm inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                                        >
                                            <Users size={15} />
                                            <span>فتح دفعة محادثات سريعة (5 محادثات)</span>
                                        </button>
                                    </div>
                                </div>

                                {/* بطاقة تتبع حملة الإرسال الفردي المتتالي */}
                                {campaignStatus !== 'idle' && (
                                    <div className="rounded-2xl p-4 border-2 border-[#C8942E] bg-gradient-to-br from-[#FFFDF7] to-[#FAF0D7] space-y-3 shadow-md">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div>
                                                {campaignStatus === 'completed' ? (
                                                    <h4 className="font-black text-sm text-emerald-800 flex items-center gap-1.5">
                                                        <CheckCircle2 size={17} /> اكتمل الإرسال الفردي لجميع المستلمين ({campaignSentCount} من {campaignQueue.length})
                                                    </h4>
                                                ) : (
                                                    <h4 className="font-black text-sm text-[#1B2A59]">
                                                        جاري الإرسال الفردي المتتالي: {campaignIndex + 1} من {campaignQueue.length} — المستلم الحالي:{' '}
                                                        <span className="text-[#8C621E] underline">{activeCampaignRecipient?.name || ''}</span>
                                                    </h4>
                                                )}
                                                <p className="text-[11px] font-bold text-[#6E5329] mt-0.5">
                                                    تم الفتح/الإرسال: {campaignSentCount} • تم التخطي: {skippedRecipientIds.size}
                                                </p>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={handleStopCampaign}
                                                className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-black inline-flex items-center gap-1 cursor-pointer"
                                            >
                                                <Square size={12} /> إيقاف الحملة
                                            </button>
                                        </div>

                                        <div className="w-full h-2.5 rounded-full bg-[#EFE0C2] overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-l from-emerald-600 to-[#C8942E] transition-all duration-300"
                                                style={{
                                                    width: `${campaignQueue.length > 0 ? Math.min(100, Math.round(((campaignIndex + (campaignStatus === 'completed' ? 1 : 0)) / campaignQueue.length) * 100)) : 0}%`
                                                }}
                                            />
                                        </div>

                                        {campaignStatus === 'running' && (
                                            <>
                                                <label className="flex items-center gap-2 text-xs font-black text-[#1B2A59] cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={autoAdvanceOnReturn}
                                                        onChange={(e) => {
                                                            setAutoAdvanceOnReturn(e.target.checked);
                                                            if (!e.target.checked) clearAutoTimer();
                                                        }}
                                                        className="w-4 h-4 accent-emerald-700 rounded"
                                                    />
                                                    <span>الانتقال التلقائي للشخص التالي فور العودة من واتساب (تلقائي)</span>
                                                </label>

                                                {autoAdvancePending && (
                                                    <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-black flex items-center justify-between gap-2">
                                                        <span>تمت العودة من واتساب — جاري فتح محادثة المستلم التالي تلقائياً...</span>
                                                        <button
                                                            type="button"
                                                            onClick={clearAutoTimer}
                                                            className="px-2 py-0.5 rounded-lg bg-white border border-emerald-300 text-[10px] font-black cursor-pointer"
                                                        >
                                                            إلغاء التلقائي
                                                        </button>
                                                    </div>
                                                )}

                                                <div className="flex flex-wrap gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={advanceCampaignToNext}
                                                        className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-sm font-black inline-flex items-center justify-center gap-1.5 shadow cursor-pointer"
                                                    >
                                                        <span>
                                                            {campaignIndex + 1 >= campaignQueue.length
                                                                ? 'إنهاء الحملة وإتمام الإرسال'
                                                                : `إرسال للتالي فوراً (${campaignQueue[campaignIndex + 1]?.name || ''})`}
                                                        </span>
                                                        <ChevronLeft size={16} />
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={handleSkipCurrent}
                                                        className="px-4 py-2.5 rounded-xl bg-[#FAF4E8] hover:bg-[#EFE0C2] border border-[#DFC48F] text-[#4B3D28] text-xs font-black inline-flex items-center gap-1 cursor-pointer"
                                                    >
                                                        <SkipForward size={14} /> تخطي
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

                                <div className="relative">
                                    <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8C621E]" />
                                    <input
                                        type="text"
                                        value={recipientSearch}
                                        onChange={(e) => setRecipientSearch(e.target.value)}
                                        placeholder="ابحث بالاسم أو رقم الموبايل لإرسال رسالة واتساب فردية..."
                                        className="w-full pr-9 pl-3 py-2.5 rounded-xl coptic-cream-input text-xs font-bold"
                                    />
                                </div>

                                {recipients.length > 0 ? (
                                    <div className="max-h-60 overflow-y-auto space-y-2 pr-0.5">
                                        {recipients.map((rec) => {
                                            const personalText = formatBroadcastWhatsappText(
                                                activeDispatcherMessage,
                                                personalizeNames ? rec.name : ''
                                            );
                                            const waUrl = buildWhatsappDirectLink(rec.phone, personalText);
                                            const isSent = sentRecipientIds.has(rec.id);
                                            const isSkipped = skippedRecipientIds.has(rec.id);
                                            const isCurrent = campaignStatus === 'running' && activeCampaignRecipient?.id === rec.id;

                                            return (
                                                <div
                                                    key={rec.id}
                                                    className={`p-2.5 rounded-2xl border flex items-center justify-between gap-2 transition-colors ${
                                                        isCurrent
                                                            ? 'bg-amber-50 border-[#C8942E]'
                                                            : isSent
                                                                ? 'bg-emerald-50/70 border-emerald-200'
                                                                : 'bg-[#FAF4E8] border-[#DFC48F]'
                                                    }`}
                                                >
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <span className="font-black text-xs text-[#1B2A59] truncate">{rec.name}</span>
                                                            {isSent && (
                                                                <span className="text-[10px] font-black bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full inline-flex items-center gap-0.5">
                                                                    <CheckCircle2 size={10} /> تم الإرسال
                                                                </span>
                                                            )}
                                                            {!isSent && isSkipped && (
                                                                <span className="text-[10px] font-black bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                                                                    تم التخطي
                                                                </span>
                                                            )}
                                                            {!isSent && !isSkipped && campaignStatus === 'running' && (
                                                                <span className="text-[10px] font-bold bg-amber-100 text-[#8C621E] px-2 py-0.5 rounded-full">
                                                                    قيد الانتظار
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="text-[10px] font-bold text-[#6E5329] inline-flex items-center gap-1" dir="ltr">
                                                            <Phone size={10} /> {rec.phone} {rec.subtitle ? `• ${rec.subtitle}` : ''}
                                                        </span>
                                                    </div>
                                                    <a
                                                        href={waUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        onClick={() => setSentRecipientIds((prev) => new Set(prev).add(rec.id))}
                                                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black inline-flex items-center gap-1 shrink-0 shadow-xs"
                                                    >
                                                        <MessageCircle size={12} /> إرسال واتساب
                                                    </a>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-center py-4 text-xs font-bold text-[#6E5329]">
                                        لا توجد أرقام موبايل مسجلة ضمن هذا النطاق حالياً.
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="space-y-3">
                            {sortedHistory.length > 0 ? sortedHistory.map((msg) => (
                                <div key={msg.id} className="bg-[#FFFDF7] border border-[#DFC48F] rounded-2xl p-4 space-y-2.5">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="text-[10px] font-black bg-[#1B2A59] text-amber-200 px-2.5 py-0.5 rounded-full">
                                                {msg.targetLabel || msg.targetType}
                                            </span>
                                            <span className="text-[10px] font-bold text-[#6E5329]">
                                                {msg.createdAt ? new Date(msg.createdAt).toLocaleDateString('ar-EG') : ''}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setLastDispatchedMsg(msg);
                                                    setActiveTab('compose');
                                                }}
                                                className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-black inline-flex items-center gap-1 cursor-pointer"
                                            >
                                                <Share2 size={12} /> إعادة مشاركة واتساب
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => deleteBroadcastMessage(
                                                    msg.id,
                                                    msg.targetSyncKey || msg.syncKey,
                                                    isFirebaseConfigured ? firestore : null,
                                                    { scopeKind: msg.scopeKind || msg.targetScope }
                                                )}
                                                className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 inline-flex items-center gap-1 text-[11px] font-black cursor-pointer hover:bg-rose-100"
                                                title="حذف الرسالة نهائياً"
                                            >
                                                <Trash2 size={12} /> حذف
                                            </button>
                                        </div>
                                    </div>
                                    <h4 className="font-black text-sm text-[#1B2A59]">{msg.title}</h4>
                                    {msg.body && <p className="text-xs font-semibold text-[#4B3D28] whitespace-pre-wrap">{msg.body}</p>}
                                    {msg.imageUrl && <img src={msg.imageUrl} alt={msg.title} className="w-full max-h-48 object-cover rounded-xl border border-[#DFC48F]" />}
                                    {msg.videoUrl && <EmbeddedVideoPlayer videoUrl={msg.videoUrl} />}
                                </div>
                            )) : (
                                <div className="text-center py-8 text-xs font-bold text-[#6E5329] bg-[#FFFDF7] rounded-2xl border border-[#DFC48F]">
                                    لم يتم إرسال أي رسائل جماعية بعد.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
