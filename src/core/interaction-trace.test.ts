import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    createMockObserverRegistry,
    createPerformanceMock,
    createPerformanceObserverMock,
} from '../test-utils/performance-mocks'
import type { TraceReport } from '../types'
import { InteractionTrace } from './interaction-trace'

describe('InteractionTrace', () => {
    const observerRegistry = createMockObserverRegistry()
    const performanceMock = createPerformanceMock()

    beforeEach(() => {
        vi.useFakeTimers()
        observerRegistry.clear()
        performanceMock.clear()

        vi.stubGlobal('navigator', { deviceMemory: 8, hardwareConcurrency: 10 })
        vi.stubGlobal(
            'PerformanceObserver',
            createPerformanceObserverMock({ registry: observerRegistry }),
        )
        vi.stubGlobal('performance', performanceMock)
    })

    afterEach(() => {
        vi.runOnlyPendingTimers()
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it('creates a trace with unique ID', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        expect(trace.id).toMatch(/^[0-9a-f-]{36}$/)

        trace.cancel()
    })

    it('sets up PerformanceObservers for loaf and event', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        const types = observerRegistry.observers.map((o) => o.type)
        expect(types).toEqual(['long-animation-frame', 'event'])

        trace.cancel()
    })

    it('reports when signed and LoAF frames complete', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        trace.sign({ name: 'test-interaction', key: 'value' })

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

        expect(onComplete).toHaveBeenCalledOnce()
        const report = onComplete.mock.calls[0]?.[0] as TraceReport
        expect(report.id).toMatch(/^[0-9a-f-]{36}$/)
        expect(report.details).toEqual({ name: 'test-interaction', key: 'value' })
        expect(typeof report.duration).toBe('number')
        expect(report.device).toEqual({
            memoryGB: '8-plus',
            cpuCores: '9-16',
        })
    })

    it('captures INP from pointerup events', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        trace.sign({ name: 'test-interaction' })

        const inpObserver = observerRegistry.findByType('event')
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

        expect(onComplete).toHaveBeenCalledOnce()
        const report = onComplete.mock.calls[0]?.[0] as TraceReport
        expect(report.inp).toBe(50)
    })

    it('does not report if not signed', () => {
        const onComplete = vi.fn()
        new InteractionTrace(onComplete)

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

        expect(onComplete).not.toHaveBeenCalled()
    })

    it('times out after max wait (15s) if no LoAF frames', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        trace.sign({ name: 'test-interaction' })

        vi.advanceTimersByTime(15001)

        expect(onComplete).not.toHaveBeenCalled()
    })

    it('resets timeout when new LoAF frame arrives', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        trace.sign({ name: 'test-interaction' })

        const loafObserver = observerRegistry.findByType('long-animation-frame')

        loafObserver?.callback(
            {
                getEntries: () => [],
                getEntriesByName: () => [],
                getEntriesByType: () => [],
            } as PerformanceObserverEntryList,
            {} as PerformanceObserver,
        )

        vi.advanceTimersByTime(400)

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

    it('cancel prevents reporting', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        trace.sign({ name: 'test-interaction' })
        trace.cancel()

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

        expect(onComplete).not.toHaveBeenCalled()
    })

    it('sign after cancel is no-op', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        trace.cancel()
        trace.sign({ name: 'test-interaction' })

        vi.advanceTimersByTime(15001)

        expect(onComplete).not.toHaveBeenCalled()
    })

    it('cancel is idempotent', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        trace.sign({ name: 'test-interaction' })
        trace.cancel()
        trace.cancel()
        trace.cancel()

        expect(trace.isCancelled).toBe(true)
        expect(onComplete).not.toHaveBeenCalled()
    })

    it('cancel clears performance marks', () => {
        const onComplete = vi.fn()
        const trace = new InteractionTrace(onComplete)

        expect(performanceMock.marksCount()).toBeGreaterThan(0)

        trace.cancel()

        expect(performanceMock.marksCount()).toBe(0)
    })
})
