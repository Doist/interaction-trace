import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    isBrowserSupported,
    isInpSupported,
    isLoafSupported,
    resetFeatureDetection,
} from './feature-detection.mjs'

describe('feature-detection', () => {
    beforeEach(() => {
        resetFeatureDetection()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        resetFeatureDetection()
    })

    describe('isLoafSupported', () => {
        it('returns true when long-animation-frame is supported', () => {
            vi.stubGlobal('PerformanceObserver', {
                supportedEntryTypes: ['long-animation-frame', 'event'],
            })

            expect(isLoafSupported()).toBe(true)
        })

        it('returns false when long-animation-frame is not supported', () => {
            vi.stubGlobal('PerformanceObserver', {
                supportedEntryTypes: ['event'],
            })

            expect(isLoafSupported()).toBe(false)
        })

        it('returns false when PerformanceObserver is not available', () => {
            vi.stubGlobal('PerformanceObserver', undefined)

            expect(isLoafSupported()).toBe(false)
        })

        it('memoizes the result', () => {
            vi.stubGlobal('PerformanceObserver', {
                supportedEntryTypes: ['long-animation-frame'],
            })

            expect(isLoafSupported()).toBe(true)

            vi.stubGlobal('PerformanceObserver', {
                supportedEntryTypes: [],
            })

            expect(isLoafSupported()).toBe(true)
        })
    })

    describe('isInpSupported', () => {
        it('returns true when event is supported', () => {
            vi.stubGlobal('PerformanceObserver', {
                supportedEntryTypes: ['event'],
            })

            expect(isInpSupported()).toBe(true)
        })

        it('returns false when event is not supported', () => {
            vi.stubGlobal('PerformanceObserver', {
                supportedEntryTypes: ['long-animation-frame'],
            })

            expect(isInpSupported()).toBe(false)
        })

        it('memoizes the result', () => {
            vi.stubGlobal('PerformanceObserver', {
                supportedEntryTypes: ['event'],
            })

            expect(isInpSupported()).toBe(true)

            vi.stubGlobal('PerformanceObserver', {
                supportedEntryTypes: [],
            })

            expect(isInpSupported()).toBe(true)
        })
    })

    describe('isBrowserSupported', () => {
        it('returns true when both loaf and event are supported', () => {
            vi.stubGlobal('PerformanceObserver', {
                supportedEntryTypes: ['long-animation-frame', 'event'],
            })

            expect(isBrowserSupported()).toBe(true)
        })

        it('returns false when only loaf is supported', () => {
            vi.stubGlobal('PerformanceObserver', {
                supportedEntryTypes: ['long-animation-frame'],
            })

            expect(isBrowserSupported()).toBe(false)
        })

        it('returns false when only event is supported', () => {
            vi.stubGlobal('PerformanceObserver', {
                supportedEntryTypes: ['event'],
            })

            expect(isBrowserSupported()).toBe(false)
        })

        it('returns false when neither is supported', () => {
            vi.stubGlobal('PerformanceObserver', {
                supportedEntryTypes: [],
            })

            expect(isBrowserSupported()).toBe(false)
        })
    })
})
