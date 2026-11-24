import assert from 'node:assert/strict';
import test from 'node:test';
import { getHierarchyFallback } from '../src/hooks/useSmartNavigation.js';

test('Hierarchy fallback resolves correct deterministic parent routes', () => {
    // Child details/profile -> Info Directory
    assert.equal(getHierarchyFallback('/profile/abc123'), '/info-directory');
    assert.equal(getHierarchyFallback('/info/child456'), '/info-directory');

    // Event details -> Calendar
    assert.equal(getHierarchyFallback('/event/evt789'), '/calendar');

    // Admin subpages -> System Admin
    assert.equal(getHierarchyFallback('/admin/servants-followup'), '/admin');
    assert.equal(getHierarchyFallback('/admin/servants-report'), '/admin');
    assert.equal(getHierarchyFallback('/master-logs'), '/admin');
    assert.equal(getHierarchyFallback('/audit-logs'), '/admin');

    // Standard dashboard and operational pages -> Home
    assert.equal(getHierarchyFallback('/dashboard'), '/');
    assert.equal(getHierarchyFallback('/master-dashboard'), '/');
    assert.equal(getHierarchyFallback('/curriculum'), '/');
    assert.equal(getHierarchyFallback('/points'), '/');
    assert.equal(getHierarchyFallback('/attendance'), '/');
    assert.equal(getHierarchyFallback('/visitation'), '/');
    assert.equal(getHierarchyFallback('/qr-attendance'), '/');
    assert.equal(getHierarchyFallback('/'), '/');
});

test('Session storage navigation stack filter rules', () => {
    const STACK_KEY = 'nav_history_stack_v1';
    const mockStorage = new Map();
    const windowMock = {
        sessionStorage: {
            getItem: (k) => mockStorage.get(k) || null,
            setItem: (k, v) => mockStorage.set(k, v)
        }
    };

    function readHistoryStack() {
        try {
            const raw = windowMock.sessionStorage.getItem(STACK_KEY);
            if (!raw) return ['/'];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) && parsed.length > 0 ? parsed : ['/'];
        } catch {
            return ['/'];
        }
    }

    function recordRoute(pathname) {
        if (pathname === '/login' || pathname === '/parent-login' || pathname === '/signup') {
            return;
        }
        const stack = readHistoryStack();
        const last = stack[stack.length - 1];
        if (last !== pathname) {
            stack.push(pathname);
            windowMock.sessionStorage.setItem(STACK_KEY, JSON.stringify(stack));
        }
    }

    assert.deepEqual(readHistoryStack(), ['/']);

    // Visit dashboard
    recordRoute('/dashboard');
    assert.deepEqual(readHistoryStack(), ['/', '/dashboard']);

    // Visit curriculum
    recordRoute('/curriculum');
    assert.deepEqual(readHistoryStack(), ['/', '/dashboard', '/curriculum']);

    // Login route is ignored from stack
    recordRoute('/login');
    assert.deepEqual(readHistoryStack(), ['/', '/dashboard', '/curriculum']);

    // Parent login is ignored from stack
    recordRoute('/parent-login');
    assert.deepEqual(readHistoryStack(), ['/', '/dashboard', '/curriculum']);
});
