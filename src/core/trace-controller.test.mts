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
        resetController()
        resetFeatureDetection()
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
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
        resetController()
        resetFeatureDetection()
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
        it('enrolls when sampleRate is 100 (default)', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            expect(isMonitorActive()).toBe(true)
        })

        it('respects sampleRate setting', () => {
            vi.spyOn(Math, 'random').mockReturnValue(0.5)

            const reporter = vi.fn()
            initInteractionTraceMonitor({
                reporter,
                enrollment: { sampleRate: 30 },
            })

            // random() = 0.5, so 50 < 30 is false, not enrolled
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
            signInteractionTrace('test')
            expect(mockObservers).toHaveLength(0)
        })

        it('creates trace when initialized', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            signInteractionTrace('test-interaction')

            expect(mockObservers.length).toBeGreaterThan(0)
        })

        it('calls reporter when trace completes', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

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

        it('supports multiple concurrent traces', () => {
            const reporter = vi.fn()
            initInteractionTraceMonitor({ reporter })

            signInteractionTrace('trace-1')
            signInteractionTrace('trace-2')

            const loafObservers = mockObservers.filter((o) => o.type === 'long-animation-frame')
            expect(loafObservers.length).toBe(2)
        })
    })

    describe('cleanup', () => {
        it('disposes active traces on cleanup', () => {
            const reporter = vi.fn()
            const cleanup = initInteractionTraceMonitor({ reporter })

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

        it('disposes active traces when signal is aborted', () => {
            const controller = new AbortController()
            const reporter = vi.fn()

            initInteractionTraceMonitor({
                reporter,
                abortSignal: controller.signal,
            })

            signInteractionTrace('test-interaction')

            controller.abort()

            vi.advanceTimersByTime(15001)
            expect(reporter).not.toHaveBeenCalled()
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

        it('works normally without abort signal (backward compatibility)', () => {
            const reporter = vi.fn()
            const cleanup = initInteractionTraceMonitor({ reporter })

            expect(isMonitorActive()).toBe(true)

            cleanup()

            expect(isMonitorActive()).toBe(false)
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
