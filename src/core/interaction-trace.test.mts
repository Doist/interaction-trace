import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TraceReport } from '../types.mjs'
import { InteractionTrace } from './interaction-trace.mjs'

describe('InteractionTrace', () => {
    let mockObservers: Array<{
        type: string
        callback: PerformanceObserverCallback
        disconnect: () => void
    }>
    let performanceMarks: Map<string, { startTime: number }>
    let performanceMeasures: Map<string, { duration: number }>

    beforeEach(() => {
        vi.useFakeTimers()
        mockObservers = []
        performanceMarks = new Map()
        performanceMeasures = new Map()

        vi.stubGlobal('crypto', {
            randomUUID: () => 'test-uuid-1234',
        })

        vi.stubGlobal('navigator', {
            deviceMemory: 8,
            hardwareConcurrency: 10,
        })

        // Mock PerformanceObserver
        vi.stubGlobal(
            'PerformanceObserver',
            class MockPerformanceObserver {
                callback: PerformanceObserverCallback

                constructor(callback: PerformanceObserverCallback) {
                    this.callback = callback
                }

                observe(options: { type: string }) {
                    const observer = {
                        type: options.type,
                        callback: this.callback,
                        disconnect: vi.fn(),
                    }
                    mockObservers.push(observer)
                }

                disconnect() {
                    const index = mockObservers.findIndex((o) => o.callback === this.callback)
                    if (index >= 0) {
                        mockObservers.splice(index, 1)
                    }
                }
            },
        )

        // Mock performance API
        vi.stubGlobal('performance', {
            mark: (name: string) => {
                performanceMarks.set(name, { startTime: Date.now() })
            },
            measure: (name: string, startOrOptions?: string | object, _end?: string) => {
                if (typeof startOrOptions === 'object') {
                    // INP style: { start, duration }
                    const opts = startOrOptions as { start: number; duration: number }
                    performanceMeasures.set(name, { duration: opts.duration })
                    return { duration: opts.duration }
                }
                // LoAF style: start and end marks
                performanceMeasures.set(name, { duration: 100 })
                return { duration: 100 }
            },
            getEntriesByName: (name: string) => {
                return performanceMarks.has(name) ? [{ name }] : []
            },
            clearMarks: (name: string) => {
                performanceMarks.delete(name)
            },
            clearMeasures: (name: string) => {
                performanceMeasures.delete(name)
            },
        })
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it('creates a trace with unique ID', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        expect(trace.id).toBe('test-uuid-1234')

        trace.dispose()
    })

    it('sets up PerformanceObservers for loaf and event', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        const types = mockObservers.map((o) => o.type)
        expect(types).toContain('long-animation-frame')
        expect(types).toContain('event')

        trace.dispose()
    })

    it('reports when signed and LoAF frames complete', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        trace.sign({ name: 'test-interaction', key: 'value' })

        // Trigger a LoAF frame
        const loafObserver = mockObservers.find((o) => o.type === 'long-animation-frame')
        loafObserver?.callback(
            {
                getEntries: () => [],
                getEntriesByName: () => [],
                getEntriesByType: () => [],
            } as PerformanceObserverEntryList,
            {} as PerformanceObserver,
        )

        // Fast forward past the 500ms timeout
        vi.advanceTimersByTime(501)

        expect(onComplete).toHaveBeenCalledOnce()
        const report = onComplete.mock.calls[0]?.[0] as TraceReport
        expect(report.id).toBe('test-uuid-1234')
        expect(report.details).toEqual({ name: 'test-interaction', key: 'value' })
        expect(report.duration).toBe(100)
        expect(report.device).toEqual({
            memoryGB: '8-plus',
            cpuCores: '9-16',
        })
    })

    it('captures INP from pointerup events', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        trace.sign({ name: 'test-interaction' })

        // Trigger INP observation
        const inpObserver = mockObservers.find((o) => o.type === 'event')
        inpObserver?.callback(
            {
                getEntries: () => [
                    {
                        name: 'pointerup',
                        startTime: 100,
                        duration: 50,
                    } as PerformanceEntry,
                ],
                getEntriesByName: () => [],
                getEntriesByType: () => [],
            } as PerformanceObserverEntryList,
            {} as PerformanceObserver,
        )

        // Trigger LoAF and complete
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

        expect(onComplete).toHaveBeenCalledOnce()
        const report = onComplete.mock.calls[0]?.[0] as TraceReport
        expect(report.inp).toBe(50)
    })

    it('does not report if not signed', () => {
        const onComplete = vi.fn()
        const _trace = new InteractionTrace(onComplete)

        // Trigger LoAF without signing
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

        expect(onComplete).not.toHaveBeenCalled()
    })

    it('times out after max wait (15s) if no LoAF frames', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        trace.sign({ name: 'test-interaction' })

        // Fast forward 15 seconds without any LoAF frames
        vi.advanceTimersByTime(15001)

        // Should have tried to report but no duration without end mark
        expect(onComplete).not.toHaveBeenCalled()
    })

    it('resets timeout when new LoAF frame arrives', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        trace.sign({ name: 'test-interaction' })

        const loafObserver = mockObservers.find((o) => o.type === 'long-animation-frame')

        // First LoAF frame
        loafObserver?.callback(
            {
                getEntries: () => [],
                getEntriesByName: () => [],
                getEntriesByType: () => [],
            } as PerformanceObserverEntryList,
            {} as PerformanceObserver,
        )

        vi.advanceTimersByTime(400)

        // Another LoAF frame resets the timeout
        loafObserver?.callback(
            {
                getEntries: () => [],
                getEntriesByName: () => [],
                getEntriesByType: () => [],
            } as PerformanceObserverEntryList,
            {} as PerformanceObserver,
        )

        vi.advanceTimersByTime(400)
        expect(onComplete).not.toHaveBeenCalled()

        vi.advanceTimersByTime(101)
        expect(onComplete).toHaveBeenCalledOnce()
    })

    it('dispose prevents reporting', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        trace.sign({ name: 'test-interaction' })
        trace.dispose()

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

        expect(onComplete).not.toHaveBeenCalled()
    })

    it('sign after dispose is no-op', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        trace.dispose()
        trace.sign({ name: 'test-interaction' })

        vi.advanceTimersByTime(15001)

        expect(onComplete).not.toHaveBeenCalled()
    })
})
