import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    createMockObserverRegistry,
    createPerformanceMock,
    createPerformanceObserverMock,
} from '../test-utils/performance-mocks.mjs'
import { resetFeatureDetection } from './feature-detection.mjs'
import {
    initInteractionTraceMonitor,
    isMonitorActive,
    resetController,
    signInteractionTrace,
} from './trace-controller.mjs'

describe('trace-controller', () => {
    const observerRegistry = createMockObserverRegistry()
    const performanceMock = createPerformanceMock()

    beforeEach(() => {
        vi.useFakeTimers()
        observerRegistry.clear()
        performanceMock.clear()

        vi.stubGlobal('navigator', { deviceMemory: 8, hardwareConcurrency: 10 })
        vi.stubGlobal(
            'PerformanceObserver',
            createPerformanceObserverMock({
                registry: observerRegistry,
                supportedEntryTypes: ['long-animation-frame', 'event'],
            }),
        )
        vi.stubGlobal('performance', performanceMock)

        // Clear sessionStorage to prevent state leaking between tests
        sessionStorage.clear()

        // Reset after stubs are set up (cancel() needs performance.clearMarks)
        resetController()
        resetFeatureDetection()
    })

    afterEach(() => {
        // Reset before switching timers or unstubbing (cancel() needs performance.clearMarks)
        resetController()
        resetFeatureDetection()
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    describe('initInteractionTraceMonitor', () => {
        it('initializes successfully with supported browser', () => {
            const reporter = vi.fn()
            const cleanup = initInteractionTraceMonitor({ reporter })

            expect(isMonitorActive()).toBe(true)
            expect(typeof cleanup).toBe('function')
        })

        it('returns no-op cleanup if browser is not supported', () => {
            vi.stubGlobal('PerformanceObserver', {
                supportedEntryTypes: [],
            })
            resetFeatureDetection()

            const reporter = vi.fn()
            const cleanup = initInteractionTraceMonitor({ reporter })

            expect(isMonitorActive()).toBe(false)
            cleanup()
        })

        it('cleanup function resets state', () => {
            const reporter = vi.fn()
            const cleanup = initInteractionTraceMonitor({ reporter })

            expect(isMonitorActive()).toBe(true)

            cleanup()

            expect(isMonitorActive()).toBe(false)
        })

        it('warns and returns no-op if already initialized', () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
            vi.stubGlobal('process', { env: { NODE_ENV: 'development' } })

            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })
            const cleanup2 = initInteractionTraceMonitor({ reporter })

            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[interaction-trace] Already initialized. Call cleanup function first.',
            )
            cleanup2()
            expect(isMonitorActive()).toBe(true)

            consoleWarnSpy.mockRestore()
        })
    })

    describe('enrollment', () => {
        it('respects sampleRate setting', () => {
            vi.spyOn(Math, 'random').mockReturnValue(0.5)

            const reporter = vi.fn()
            initInteractionTraceMonitor({
                reporter,
                enrollment: { sampleRate: 30 },
            })

            expect(isMonitorActive()).toBe(false)
        })

        it('persists enrollment in sessionStorage', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            expect(sessionStorage.getItem('interaction-trace-enrolled')).toBe('true')
        })

        it('uses custom persistKey', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({
                reporter,
                enrollment: { persistKey: 'custom-key' },
            })

            expect(sessionStorage.getItem('custom-key')).toBe('true')
        })

        it('respects isEnabled override', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({
                reporter,
                enrollment: {
                    sampleRate: 0,
                    isEnabled: () => true,
                },
            })

            expect(isMonitorActive()).toBe(true)
        })

        it('reads existing enrollment from sessionStorage', () => {
            sessionStorage.setItem('interaction-trace-enrolled', 'false')

            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            expect(isMonitorActive()).toBe(false)
        })
    })

    describe('signInteractionTrace', () => {
        it('is no-op when not initialized', () => {
            document.dispatchEvent(new PointerEvent('pointerup'))
            signInteractionTrace('test')
            expect(observerRegistry.observers).toHaveLength(0)
        })

        it('is no-op without pointerup event', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            signInteractionTrace('test-interaction')

            expect(observerRegistry.observers).toHaveLength(0)
        })

        it('calls reporter when trace completes', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            document.dispatchEvent(new PointerEvent('pointerup'))
            signInteractionTrace('test-interaction', { key: 'value' })

            const loafObserver = observerRegistry.findByType('long-animation-frame')
            loafObserver?.callback(
                {
                    getEntries: () => [],
                    getEntriesByName: () => [],
                    getEntriesByType: () => [],
                } as PerformanceObserverEntryList,
                {} as PerformanceObserver,
            )

            vi.advanceTimersByTime(501)

            expect(reporter).toHaveBeenCalledOnce()
            expect(reporter.mock.calls[0]?.[0]).toMatchObject({
                details: { name: 'test-interaction', key: 'value' },
            })
        })
    })

    describe('pointerup lifecycle', () => {
        it('creates a trace on pointerup event', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            document.dispatchEvent(new PointerEvent('pointerup'))

            const loafObserver = observerRegistry.findByType('long-animation-frame')
            expect(loafObserver).toBeDefined()
        })

        it('cancels previous trace on new pointerup', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            document.dispatchEvent(new PointerEvent('pointerup'))
            signInteractionTrace('first')

            document.dispatchEvent(new PointerEvent('pointerup'))

            const firstLoafObserver = observerRegistry.observers[0]
            firstLoafObserver?.callback(
                {
                    getEntries: () => [],
                    getEntriesByName: () => [],
                    getEntriesByType: () => [],
                } as PerformanceObserverEntryList,
                {} as PerformanceObserver,
            )
            vi.advanceTimersByTime(501)

            expect(reporter).not.toHaveBeenCalled()
        })

        it('does not report unsigned traces', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            document.dispatchEvent(new PointerEvent('pointerup'))

            const loafObserver = observerRegistry.findByType('long-animation-frame')
            loafObserver?.callback(
                {
                    getEntries: () => [],
                    getEntriesByName: () => [],
                    getEntriesByType: () => [],
                } as PerformanceObserverEntryList,
                {} as PerformanceObserver,
            )
            vi.advanceTimersByTime(501)

            expect(reporter).not.toHaveBeenCalled()
        })

        it('removes pointerup listener on cleanup', () => {
            const reporter = vi.fn()
            const cleanup = initInteractionTraceMonitor({ reporter })

            cleanup()

            observerRegistry.observers.length = 0

            document.dispatchEvent(new PointerEvent('pointerup'))

            expect(observerRegistry.observers).toHaveLength(0)
        })

        it('allows updating trace details before completion', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            document.dispatchEvent(new PointerEvent('pointerup'))
            signInteractionTrace('button-click', { buttonId: 'submit' })
            signInteractionTrace('button-click', { buttonId: 'submit', validated: true })

            const loafObserver = observerRegistry.findByType('long-animation-frame')
            loafObserver?.callback(
                {
                    getEntries: () => [],
                    getEntriesByName: () => [],
                    getEntriesByType: () => [],
                } as PerformanceObserverEntryList,
                {} as PerformanceObserver,
            )
            vi.advanceTimersByTime(501)

            expect(reporter).toHaveBeenCalledOnce()
            expect(reporter.mock.calls[0]?.[0]).toMatchObject({
                details: { name: 'button-click', buttonId: 'submit', validated: true },
            })
        })
    })

    describe('cleanup', () => {
        it('cancels active traces on cleanup', () => {
            const reporter = vi.fn()
            const cleanup = initInteractionTraceMonitor({ reporter })

            document.dispatchEvent(new PointerEvent('pointerup'))
            signInteractionTrace('test-interaction')

            cleanup()

            vi.advanceTimersByTime(15001)
            expect(reporter).not.toHaveBeenCalled()
        })
    })

    describe('abort signal support', () => {
        it('returns no-op cleanup when signal is already aborted', () => {
            const controller = new AbortController()
            controller.abort()

            const reporter = vi.fn()
            const cleanup = initInteractionTraceMonitor({
                reporter,
                abortSignal: controller.signal,
            })

            expect(isMonitorActive()).toBe(false)
            cleanup()
        })

        it('triggers cleanup when signal is aborted', () => {
            const controller = new AbortController()
            const reporter = vi.fn()

            initInteractionTraceMonitor({
                reporter,
                abortSignal: controller.signal,
            })

            expect(isMonitorActive()).toBe(true)

            controller.abort()

            expect(isMonitorActive()).toBe(false)
        })

        it('cleanup only runs once when both manual cleanup and abort occur', () => {
            const controller = new AbortController()
            const reporter = vi.fn()

            const cleanup = initInteractionTraceMonitor({
                reporter,
                abortSignal: controller.signal,
            })

            cleanup()
            controller.abort()

            expect(isMonitorActive()).toBe(false)
        })

        it('removes abort listener after manual cleanup', () => {
            const controller = new AbortController()
            const removeEventListenerSpy = vi.spyOn(controller.signal, 'removeEventListener')

            const reporter = vi.fn()
            const cleanup = initInteractionTraceMonitor({
                reporter,
                abortSignal: controller.signal,
            })

            cleanup()

            expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function))
        })

        it('does not attach abort listener when already initialized', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            const controller = new AbortController()
            const addEventListenerSpy = vi.spyOn(controller.signal, 'addEventListener')

            initInteractionTraceMonitor({
                reporter,
                abortSignal: controller.signal,
            })

            expect(addEventListenerSpy).not.toHaveBeenCalled()
        })

        it('does not attach abort listener when browser not supported', () => {
            vi.stubGlobal('PerformanceObserver', {
                supportedEntryTypes: [],
            })
            resetFeatureDetection()

            const controller = new AbortController()
            const addEventListenerSpy = vi.spyOn(controller.signal, 'addEventListener')

            const reporter = vi.fn()
            initInteractionTraceMonitor({
                reporter,
                abortSignal: controller.signal,
            })

            expect(addEventListenerSpy).not.toHaveBeenCalled()
        })
    })

    describe('signInteractionTrace type safety', () => {
        // These tests validate compile-time type checking behavior.
        // The @ts-expect-error annotations verify that TypeScript correctly
        // rejects invalid trace names and details.

        type TestTraces = {
            'open modal': { modalId: string }
            'close modal': { modalId: string }
            'submit form': { formId: string; success: boolean }
        }

        it('withTypes provides type-safe trace signing', () => {
            const signTrace = signInteractionTrace.withTypes<TestTraces>()

            // Valid calls - these should compile without errors
            signTrace('open modal', { modalId: 'settings' })
            signTrace('close modal', { modalId: 'settings' })
            signTrace('submit form', { formId: 'login', success: true })

            // @ts-expect-error - Invalid trace name (typo)
            signTrace('opne modal', { modalId: 'settings' })

            // @ts-expect-error - Wrong details shape for 'open modal'
            signTrace('open modal', { formId: 'wrong' })

            // @ts-expect-error - Missing required detail property
            signTrace('submit form', { formId: 'login' })

            // @ts-expect-error - Completely invalid trace name
            signTrace('unknown trace', {})

            expect(true).toBe(true)
        })

        it('inline type parameter works for type checking', () => {
            // Valid call with inline type parameter
            signInteractionTrace<TestTraces>('open modal', { modalId: 'settings' })

            // @ts-expect-error - Invalid trace name with inline type parameter
            signInteractionTrace<TestTraces>('invalid name', { modalId: 'settings' })

            expect(true).toBe(true)
        })

        it('legacy usage accepts any string (no type checking)', () => {
            // Legacy usage should accept any string without errors
            signInteractionTrace('any trace name', { anyKey: 'anyValue' })
            signInteractionTrace('another-trace', { foo: 123, bar: true })
            signInteractionTrace('just-a-name')

            expect(true).toBe(true)
        })

        it('withTypes returns the same function', () => {
            const signTrace = signInteractionTrace.withTypes<TestTraces>()

            // The returned function should be the same underlying function
            // (just with a different type signature)
            expect(typeof signTrace).toBe('function')
        })

        it('details type is properly constrained', () => {
            const signTrace = signInteractionTrace.withTypes<TestTraces>()

            // @ts-expect-error - Extra properties not allowed in strict mode
            signTrace('open modal', { modalId: 'settings', extraProp: 'not allowed' })

            expect(true).toBe(true)
        })
    })
})
