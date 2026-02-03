import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFeatureDetection } from './feature-detection.mjs'
import {
    initInteractionTraceMonitor,
    isMonitorActive,
    resetController,
    signInteractionTrace,
} from './trace-controller.mjs'

describe('trace-controller', () => {
    let mockObservers: Array<{
        type: string
        callback: PerformanceObserverCallback
    }>
    let performanceMarks: Map<string, { startTime: number }>

    beforeEach(() => {
        vi.useFakeTimers()
        mockObservers = []
        performanceMarks = new Map()

        vi.stubGlobal('crypto', {
            randomUUID: () => `test-uuid-${Math.random().toString(36).slice(2)}`,
        })

        vi.stubGlobal('navigator', {
            deviceMemory: 8,
            hardwareConcurrency: 10,
        })

        vi.stubGlobal('PerformanceObserver', {
            supportedEntryTypes: ['long-animation-frame', 'event'],
        })

        vi.stubGlobal(
            'PerformanceObserver',
            Object.assign(
                class MockPerformanceObserver {
                    callback: PerformanceObserverCallback

                    constructor(callback: PerformanceObserverCallback) {
                        this.callback = callback
                    }

                    observe(options: { type: string }) {
                        mockObservers.push({
                            type: options.type,
                            callback: this.callback,
                        })
                    }

                    disconnect() {}
                },
                {
                    supportedEntryTypes: ['long-animation-frame', 'event'],
                },
            ),
        )

        vi.stubGlobal('performance', {
            now: () => Date.now(),
            mark: (name: string) => {
                performanceMarks.set(name, { startTime: Date.now() })
            },
            measure: () => ({ duration: 100 }),
            getEntriesByName: (name: string) => {
                return performanceMarks.has(name) ? [{ name }] : []
            },
            clearMarks: () => {},
            clearMeasures: () => {},
        })

        const storage = new Map<string, string>()
        vi.stubGlobal('sessionStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        })

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
            expect(mockObservers).toHaveLength(0)
        })

        it('is no-op without pointerup event', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            signInteractionTrace('test-interaction')

            expect(mockObservers).toHaveLength(0)
        })

        it('calls reporter when trace completes', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            document.dispatchEvent(new PointerEvent('pointerup'))
            signInteractionTrace('test-interaction', { key: 'value' })

            const loafObserver = mockObservers.find((o) => o.type === 'long-animation-frame')
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

            const loafObserver = mockObservers.find((o) => o.type === 'long-animation-frame')
            expect(loafObserver).toBeDefined()
        })

        it('cancels previous trace on new pointerup', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            document.dispatchEvent(new PointerEvent('pointerup'))
            signInteractionTrace('first')

            document.dispatchEvent(new PointerEvent('pointerup'))

            const firstLoafObserver = mockObservers[0]
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

            const loafObserver = mockObservers.find((o) => o.type === 'long-animation-frame')
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

            mockObservers.length = 0

            document.dispatchEvent(new PointerEvent('pointerup'))

            expect(mockObservers).toHaveLength(0)
        })

        it('allows updating trace details before completion', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            document.dispatchEvent(new PointerEvent('pointerup'))
            signInteractionTrace('button-click', { buttonId: 'submit' })
            signInteractionTrace('button-click', { buttonId: 'submit', validated: true })

            const loafObserver = mockObservers.find((o) => o.type === 'long-animation-frame')
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
})
