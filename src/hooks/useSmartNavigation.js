import { useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { executeScrollToTop } from '../components/ScrollToTop';

const STACK_STORAGE_KEY = 'nav_history_stack_v1';
const MAX_STACK_SIZE = 30;

function readHistoryStack() {
    if (typeof window === 'undefined' || !window.sessionStorage) return ['/'];
    try {
        const raw = window.sessionStorage.getItem(STACK_STORAGE_KEY);
        if (!raw) return ['/'];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : ['/'];
    } catch {
        return ['/'];
    }
}

function writeHistoryStack(stack) {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
        const trimmed = stack.slice(-MAX_STACK_SIZE);
        window.sessionStorage.setItem(STACK_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
        // Ignore quota errors
    }
}

/**
 * Resolves safe deterministic fallback route up the church hierarchy
 * based on current route pattern.
 */
export function getHierarchyFallback(currentPath = '/') {
    const path = String(currentPath || '/').trim();

    // From Child Profile or Details -> go back to Directory or Attendance or Home
    if (path.startsWith('/profile/') || path.startsWith('/info/')) {
        return '/info-directory';
    }

    if (path.startsWith('/event/')) {
        return '/calendar';
    }

    // From Admin subpages -> go back to SystemAdmin or Home
    if (path === '/admin/servants-followup' || path === '/admin/servants-report' || path === '/master-logs' || path === '/audit-logs') {
        return '/admin';
    }

    // Default for all operational and dashboard pages -> Home (/)
    return '/';
}

/**
 * Global Smart Navigation Hook:
 * 1. Maintains sessionStorage route history stack.
 * 2. Provides smart `goBack(customFallback)` that navigates backwards cleanly,
 *    avoiding login traps and loops, and defaulting to '/' or hierarchy fallback.
 */
export function useSmartNavigation() {
    const location = useLocation();
    const navigate = useNavigate();
    const currentPath = `${location.pathname}${location.search}`;
    const isNavigatingRef = useRef(false);

    useEffect(() => {
        // Do not record login/auth routes or duplicates
        const pathOnly = location.pathname;
        if (pathOnly === '/login' || pathOnly === '/parent-login' || pathOnly === '/signup') {
            return;
        }

        const stack = readHistoryStack();
        const lastEntry = stack[stack.length - 1];

        if (lastEntry !== currentPath) {
            stack.push(currentPath);
            writeHistoryStack(stack);
        }
    }, [currentPath, location.pathname]);

    const goBack = useCallback((customFallback = null) => {
        if (isNavigatingRef.current) return;
        isNavigatingRef.current = true;

        executeScrollToTop();

        const stack = readHistoryStack();
        const fallbackTarget = customFallback || getHierarchyFallback(location.pathname);

        // Pop current route if it matches top of stack
        while (stack.length > 0 && stack[stack.length - 1] === currentPath) {
            stack.pop();
        }

        // Find the most recent valid in-app route that isn't auth or current
        let candidateRoute = null;
        while (stack.length > 0) {
            const popped = stack.pop();
            const basePath = popped.split('?')[0];
            if (basePath !== '/login' && basePath !== '/parent-login' && basePath !== '/signup' && popped !== currentPath) {
                candidateRoute = popped;
                break;
            }
        }

        writeHistoryStack(stack);

        if (candidateRoute) {
            navigate(candidateRoute, { replace: true });
        } else if (window.history.length > 1) {
            navigate(-1);
        } else {
            navigate(fallbackTarget, { replace: true });
        }

        requestAnimationFrame(() => {
            executeScrollToTop();
            isNavigatingRef.current = false;
        });
    }, [currentPath, location.pathname, navigate]);

    return { goBack, currentPath };
}

export default useSmartNavigation;
