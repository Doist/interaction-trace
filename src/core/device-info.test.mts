import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDeviceInfo } from './device-info.mts'

describe('getDeviceInfo', () => {
    const originalNavigator = globalThis.navigator

    beforeEach(() => {
        vi.stubGlobal('navigator', { ...originalNavigator })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('returns device info with memory and CPU buckets', () => {
        vi.stubGlobal('navigator', {
            deviceMemory: 8,
            hardwareConcurrency: 10,
        })

        const info = getDeviceInfo()

        expect(info).toEqual({
            memoryGB: '8-plus',
            cpuCores: '9-16',
        })
    })

    it('returns defaults when navigator APIs are unavailable', () => {
        vi.stubGlobal('navigator', {
            deviceMemory: undefined,
            hardwareConcurrency: undefined,
        })

        const info = getDeviceInfo()

        expect(info).toEqual({
            memoryGB: 'unknown',
            cpuCores: '1-8',
        })
    })
})
