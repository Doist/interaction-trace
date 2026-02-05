/**
 * Test utilities for mocking browser Performance APIs.
 *
 * These mocks are needed because:
 * - HappyDOM doesn't support 'long-animation-frame' or 'event' entry types
 * - HappyDOM's performance.mark/getEntriesByName don't work with Vitest fake timers
 *
 * Usage:
 *   const registry = createMockObserverRegistry()
 *   vi.stubGlobal('PerformanceObserver', createPerformanceObserverMock({ registry }))
 *   vi.stubGlobal('performance', createPerformanceMock())
 *   vi.stubGlobal('navigator', createNavigatorMock())
 */
import { vi } from 'vitest'

type MockObserver = {
    type: string
    callback: PerformanceObserverCallback
    disconnect: ReturnType<typeof vi.fn>
}

type MockObserverRegistry = {
    observers: MockObserver[]
    findByType: (type: string) => MockObserver | undefined
    triggerCallback: (type: string, entries?: PerformanceEntry[]) => void
    clear: () => void
}

// ============================================================================
// Mock Observer Registry
// ============================================================================

/**
 * Creates a registry for tracking mock PerformanceObserver instances.
 * Use this to find observers by type and trigger their callbacks in tests.
 */
export function createMockObserverRegistry(): MockObserverRegistry {
    const observers: MockObserver[] = []

    return {
        observers,
        findByType: (type) => observers.find((o) => o.type === type),
        triggerCallback: (type, entries = []) => {
            const observer = observers.find((o) => o.type === type)
            observer?.callback(createMockEntryList(entries), {} as PerformanceObserver)
        },
        clear: () => {
            observers.length = 0
        },
    }
}

/**
 * Creates a mock PerformanceObserverEntryList for triggering observer callbacks.
 */
function createMockEntryList(entries: PerformanceEntry[] = []): PerformanceObserverEntryList {
    return {
        getEntries: () => entries,
        getEntriesByName: () => [],
        getEntriesByType: () => [],
    } as PerformanceObserverEntryList
}

// ============================================================================
// PerformanceObserver Mock
// ============================================================================

type PerformanceObserverMockOptions = {
    registry: MockObserverRegistry
    supportedEntryTypes?: string[]
}

/**
 * Creates a mock PerformanceObserver class.
 * Observers are registered in the provided registry for test access.
 */
export function createPerformanceObserverMock({
    registry,
    supportedEntryTypes = ['long-animation-frame', 'event'],
}: PerformanceObserverMockOptions) {
    class MockPerformanceObserver {
        callback: PerformanceObserverCallback

        constructor(callback: PerformanceObserverCallback) {
            this.callback = callback
        }

        observe(options: { type: string }) {
            registry.observers.push({
                type: options.type,
                callback: this.callback,
                disconnect: vi.fn(),
            })
        }

        disconnect() {
            const index = registry.observers.findIndex((o) => o.callback === this.callback)
            if (index >= 0) {
                registry.observers.splice(index, 1)
            }
        }

        static supportedEntryTypes = supportedEntryTypes
    }

    return MockPerformanceObserver
}

// ============================================================================
// Performance API Mock
// ============================================================================

type PerformanceMock = {
    mark: (name: string) => void
    measure: (name: string, startOrOptions?: string | object) => { duration: number }
    getEntriesByName: (name: string) => Array<{ name: string }>
    clearMarks: (name: string) => void
    clearMeasures: () => void
    now: () => number
    /** @test Clears all marks. Use in beforeEach to reset state. */
    clear: () => void
    /** @test Returns the number of marks for assertions. */
    marksCount: () => number
}

/**
 * Creates a mock performance object.
 */
export function createPerformanceMock(): PerformanceMock {
    const marks = new Set<string>()

    return {
        mark: (name: string) => {
            marks.add(name)
        },
        measure: (_name: string, startOrOptions?: string | object) => {
            if (typeof startOrOptions === 'object') {
                const opts = startOrOptions as { duration: number }
                return { duration: opts.duration }
            }
            return { duration: 0 }
        },
        getEntriesByName: (name: string) => (marks.has(name) ? [{ name }] : []),
        clearMarks: (name: string) => marks.delete(name),
        clearMeasures: () => {},
        now: () => Date.now(),
        clear: () => {
            marks.clear()
        },
        marksCount: () => marks.size,
    }
}
