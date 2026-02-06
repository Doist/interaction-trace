import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCpuCoresBucket, getMemoryBucket } from './size-buckets'

describe('getMemoryBucket', () => {
    const originalNavigator = globalThis.navigator

    beforeEach(() => {
        vi.stubGlobal('navigator', { ...originalNavigator })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('returns "unknown" when deviceMemory is not available', () => {
        vi.stubGlobal('navigator', { deviceMemory: undefined })
        expect(getMemoryBucket()).toBe('unknown')
    })

    it('returns "0.25-2" for memory <= 2GB', () => {
        vi.stubGlobal('navigator', { deviceMemory: 0.25 })
        expect(getMemoryBucket()).toBe('0.25-2')

        vi.stubGlobal('navigator', { deviceMemory: 1 })
        expect(getMemoryBucket()).toBe('0.25-2')

        vi.stubGlobal('navigator', { deviceMemory: 2 })
        expect(getMemoryBucket()).toBe('0.25-2')
    })

    it('returns "3-7" for memory > 2GB and < 8GB', () => {
        vi.stubGlobal('navigator', { deviceMemory: 4 })
        expect(getMemoryBucket()).toBe('3-7')

        vi.stubGlobal('navigator', { deviceMemory: 6 })
        expect(getMemoryBucket()).toBe('3-7')
    })

    it('returns "8-plus" for memory >= 8GB', () => {
        vi.stubGlobal('navigator', { deviceMemory: 8 })
        expect(getMemoryBucket()).toBe('8-plus')

        vi.stubGlobal('navigator', { deviceMemory: 16 })
        expect(getMemoryBucket()).toBe('8-plus')
    })
})

describe('getCpuCoresBucket', () => {
    const originalNavigator = globalThis.navigator

    beforeEach(() => {
        vi.stubGlobal('navigator', { ...originalNavigator })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('returns "1-8" when hardwareConcurrency is not available', () => {
        vi.stubGlobal('navigator', { hardwareConcurrency: undefined })
        expect(getCpuCoresBucket()).toBe('1-8')
    })

    it('returns "1-8" for cores <= 8', () => {
        vi.stubGlobal('navigator', { hardwareConcurrency: 1 })
        expect(getCpuCoresBucket()).toBe('1-8')

        vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
        expect(getCpuCoresBucket()).toBe('1-8')

        vi.stubGlobal('navigator', { hardwareConcurrency: 8 })
        expect(getCpuCoresBucket()).toBe('1-8')
    })

    it('returns "9-16" for cores > 8 and <= 16', () => {
        vi.stubGlobal('navigator', { hardwareConcurrency: 10 })
        expect(getCpuCoresBucket()).toBe('9-16')

        vi.stubGlobal('navigator', { hardwareConcurrency: 16 })
        expect(getCpuCoresBucket()).toBe('9-16')
    })

    it('returns "17-plus" for cores > 16', () => {
        vi.stubGlobal('navigator', { hardwareConcurrency: 20 })
        expect(getCpuCoresBucket()).toBe('17-plus')

        vi.stubGlobal('navigator', { hardwareConcurrency: 32 })
        expect(getCpuCoresBucket()).toBe('17-plus')
    })
})
