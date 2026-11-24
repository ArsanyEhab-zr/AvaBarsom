import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Ensures immediate scroll reset to the top whenever pathname, search, or hash changes.
 * Disables browser automatic scroll restoration and resets all possible scroll containers.
 */
export function executeScrollToTop() {
    if (typeof window === 'undefined') return;

    try {
        if ('scrollRestoration' in window.history) {
            window.history.scrollRestoration = 'manual';
        }
    } catch {
        // Ignore if restricted
    }

    try {
        window.scrollTo({
            top: 0,
            left: 0,
            behavior: 'instant'
        });
    } catch {
        window.scrollTo(0, 0);
    }

    if (document.documentElement) {
        document.documentElement.scrollTop = 0;
    }
    if (document.body) {
        document.body.scrollTop = 0;
    }

    // Scroll containers commonly used in responsive / main views
    const rootEl = document.getElementById('root');
    if (rootEl) {
        rootEl.scrollTop = 0;
    }
    const mainEl = document.querySelector('main');
    if (mainEl) {
        mainEl.scrollTop = 0;
    }
}

export default function ScrollToTop() {
    const { pathname, search, hash } = useLocation();

    useLayoutEffect(() => {
        executeScrollToTop();
    }, [pathname, search, hash]);

    useEffect(() => {
        // Double-check with rAF in case React renders content asynchronously or dynamically
        const raf = requestAnimationFrame(() => {
            executeScrollToTop();
        });
        return () => cancelAnimationFrame(raf);
    }, [pathname, search, hash]);

    useEffect(() => {
        const handleImpersonationScroll = () => {
            executeScrollToTop();
            requestAnimationFrame(() => executeScrollToTop());
        };

        window.addEventListener('syncKey-changed', handleImpersonationScroll);
        window.addEventListener('impersonation-changed', handleImpersonationScroll);

        return () => {
            window.removeEventListener('syncKey-changed', handleImpersonationScroll);
            window.removeEventListener('impersonation-changed', handleImpersonationScroll);
        };
    }, []);

    return null;
}
