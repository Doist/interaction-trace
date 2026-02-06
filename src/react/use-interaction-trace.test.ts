import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFeatureDetection } from '../core/feature-detection'
import * as traceController from '../core/trace-controller'
import {
    createMockObserverRegistry,
    createPerformanceMock,
    createPerformanceObserverMock,
} from '../test-utils/performance-mocks'
import { useInteractionTrace } from './use-interaction-trace'

describe('useInteractionTrace', () => {
    const observerRegistry = createMockObserverRegistry()
    const performanceMock = createPerformanceMock()

    beforeEach(() => {
        vi.useFakeTimers()
        observerRegistry.clear()
        performanceMock.clear()

        vi.stubGlobal(
            'PerformanceObserver',
            createPerformanceObserverMock({ registry: observerRegistry }),
        )
        vi.stubGlobal('performance', performanceMock)

        traceController.resetController()
        resetFeatureDetection()
    })

    afterEach(() => {
        sessionStorage.clear()
        traceController.resetController()
        resetFeatureDetection()
        vi.runOnlyPendingTimers()
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    describe('basic functionality', () => {
        it('calls signInteractionTrace on mount', () => {
            const reporter = vi.fn()
            traceController.initInteractionTraceMonitor({ reporter })

            document.dispatchEvent(new PointerEvent('pointerup'))

            renderHook(() => useInteractionTrace('test-interaction', { key: 'value' }))

            observerRegistry.triggerCallback('long-animation-frame')

            vi.advanceTimersByTime(501)

            expect(reporter).toHaveBeenCalledOnce()
            expect(reporter.mock.calls[0]?.[0]).toMatchObject({
                details: { name: 'test-interaction', key: 'value' },
            })
        })

        it('works without details parameter', () => {
            const reporter = vi.fn()
            traceController.initInteractionTraceMonitor({ reporter })

            document.dispatchEvent(new PointerEvent('pointerup'))

            renderHook(() => useInteractionTrace('simple-trace'))

            observerRegistry.triggerCallback('long-animation-frame')

            vi.advanceTimersByTime(501)

            expect(reporter).toHaveBeenCalledOnce()
            expect(reporter.mock.calls[0]?.[0]).toMatchObject({
                details: { name: 'simple-trace' },
            })
        })
    })

    describe('type safety', () => {
        type TestTraces = {
            'open modal': { modalId: string }
            'close modal': { modalId: string }
            'submit form': { formId: string; success: boolean }
        }

        it('withTypes provides type-safe trace signing', () => {
            const useTrace = useInteractionTrace.withTypes<TestTraces>()

            renderHook(() => useTrace('open modal', { modalId: 'settings' }))
            renderHook(() => useTrace('close modal', { modalId: 'settings' }))
            renderHook(() => useTrace('submit form', { formId: 'login', success: true }))

            // @ts-expect-error - Invalid trace name (typo)
            renderHook(() => useTrace('opne modal', { modalId: 'settings' }))

            // @ts-expect-error - Wrong details shape for 'open modal'
            renderHook(() => useTrace('open modal', { formId: 'wrong' }))

            // @ts-expect-error - Missing required detail property
            renderHook(() => useTrace('submit form', { formId: 'login' }))

            // @ts-expect-error - Completely invalid trace name
            renderHook(() => useTrace('unknown trace', {}))

            expect(true).toBe(true)
        })

        it('inline type parameter works for type checking', () => {
            renderHook(() => useInteractionTrace<TestTraces>('open modal', { modalId: 'settings' }))

            renderHook(() =>
                // @ts-expect-error - Invalid trace name with inline type parameter
                useInteractionTrace<TestTraces>('invalid name', { modalId: 'settings' }),
            )

            expect(true).toBe(true)
        })

        it('untyped usage accepts any string (no type checking)', () => {
            renderHook(() => useInteractionTrace('any trace name', { anyKey: 'anyValue' }))
            renderHook(() => useInteractionTrace('another-trace', { foo: 123, bar: true }))
            renderHook(() => useInteractionTrace('just-a-name'))

            expect(true).toBe(true)
        })

        it('details type is properly constrained', () => {
            const useTrace = useInteractionTrace.withTypes<TestTraces>()

            renderHook(() =>
                // @ts-expect-error - Extra properties not allowed in strict mode
                useTrace('open modal', { modalId: 'settings', extraProp: 'not allowed' }),
            )

            expect(true).toBe(true)
        })
    })
})
