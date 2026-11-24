import React from 'react';
import { Sparkles, Star } from 'lucide-react';
import { TENANT_CONFIG, getActiveLogoUrl } from '../utils/tenantConfig';

export default function Footer({ compact = false }) {
    const activeLogoUrl = getActiveLogoUrl();
    return (
        <footer
            className={`relative text-center flex flex-col items-center justify-center overflow-hidden ${compact ? 'pt-6 pb-8' : 'pt-10 pb-28'}`}
            dir="rtl"
        >
            <div className="relative z-10 max-w-lg mx-auto px-4 flex flex-col items-center gap-6 w-full">
                {/* كارت الآية الكنسية بطابع قبطي دافئ (يظهر في الرئيسية والصفحات الكاملة فقط) */}
                {!compact && (
                    <div className="relative w-full animate-card-enter">
                        <div className="relative bg-gradient-to-br from-[#1B2A59] via-[#1E316A] to-[#111C3D] p-6 md:p-7 rounded-3xl border border-amber-400/40 shadow-xl shadow-[#1B2A59]/15 flex flex-col items-center text-center">
                            <Sparkles className="absolute top-4 right-4 text-amber-300 w-5 h-5" />
                            <Star className="absolute bottom-4 left-4 text-amber-300/70 w-4 h-4" />

                            <img
                                src={activeLogoUrl}
                                alt={TENANT_CONFIG.churchName}
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                className="w-12 h-12 rounded-full bg-[#FFFDF7] p-0.5 border-2 border-amber-400/80 shadow-md mb-3 object-contain"
                            />

                            <p className="font-calligraphic text-xl md:text-2xl text-amber-100 leading-relaxed mt-1">
                                "فَلاَ نَفْشَلْ فِي عَمَلِ الْخَيْرِ لأَنَّنَا سَنَحْصُدُ فِي وَقْتِهِ إِنْ كُنَّا لاَ نَكِلُّ."
                            </p>

                            <div className="mt-4 px-4 py-1 bg-white/10 rounded-full border border-amber-300/30">
                                <p className="text-xs font-bold text-amber-200">(غلاطية ٦: ٩) • {TENANT_CONFIG.churchShortName}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* توقيع المصمم والمطور (Signature Collectible Plaque — Arsany Zika) */}
                <div className="relative w-fit max-w-[95vw] mx-auto animate-card-enter">
                    <div className="coptic-card shimmer-gold-border bg-[#FFFDF7]/95 backdrop-blur-md px-6 sm:px-8 py-4 rounded-[2rem] border border-amber-500/35 shadow-[0_12px_32px_-8px_rgba(27,42,89,0.16)] flex flex-col items-center justify-center gap-1">
                        <span className="text-[11px] sm:text-xs font-bold text-slate-600 tracking-wide">
                            صُمم وطُوّر بعناية • <span dir="ltr">Designed &amp; Crafted by</span>
                        </span>

                        <div className="relative flex flex-col items-center pt-0.5" dir="ltr">
                            <span
                                className="font-signature text-3xl sm:text-4xl font-bold leading-none select-none px-2 py-1"
                                style={{
                                    backgroundImage: 'linear-gradient(135deg, #B8860B 0%, #D4AF37 48%, #1B2A59 100%)',
                                    WebkitBackgroundClip: 'text',
                                    backgroundClip: 'text',
                                    color: 'transparent'
                                }}
                            >
                                Arsany Zika
                            </span>

                            {/* Animated Golden Flourish SVG */}
                            <svg
                                viewBox="0 0 220 18"
                                className="w-44 sm:w-52 h-3.5 -mt-1 overflow-visible"
                                aria-hidden="true"
                            >
                                <defs>
                                    <linearGradient id="arsanyFlourishGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stopColor="#B8860B" stopOpacity="0.25" />
                                        <stop offset="45%" stopColor="#D4AF37" stopOpacity="0.95" />
                                        <stop offset="100%" stopColor="#1B2A59" stopOpacity="0.8" />
                                    </linearGradient>
                                </defs>
                                <path
                                    d="M 8 11 Q 65 2, 118 9 T 212 6"
                                    fill="none"
                                    stroke="url(#arsanyFlourishGrad)"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                />
                            </svg>
                        </div>

                        <span
                            dir="ltr"
                            className="inline-flex items-center px-3 py-0.5 rounded-full text-[10px] font-bold tracking-widest bg-[#1B2A59] text-amber-200 border border-amber-400/35 mt-0.5"
                        >
                            (c) 2026
                        </span>
                    </div>
                </div>
            </div>
        </footer>
    );
}
