import type { CpuCoresBucket, MemoryBucket } from '../types.mjs'

/**
 * Returns the memory bucket based on navigator.deviceMemory.
 * Uses the Client Hints API which may not be available in all browsers.
 */
export function getMemoryBucket(): MemoryBucket {
    if (typeof navigator === 'undefined') {
        return 'unknown'
    }

    const memory = navigator.deviceMemory

    if (!memory) {
        return 'unknown'
    }

    if (memory <= 2) {
        return '0.25-2'
    }

    if (memory < 8) {
        return '3-7'
    }

    return '8-plus'
}

/**
 * Returns the CPU cores bucket based on navigator.hardwareConcurrency.
 */
export function getCpuCoresBucket(): CpuCoresBucket {
    if (typeof navigator === 'undefined') {
        return '1-8'
    }

    const logicalCores = navigator.hardwareConcurrency

    if (!logicalCores || logicalCores <= 8) {
        return '1-8'
    }

    if (logicalCores <= 16) {
        return '9-16'
    }

    return '17-plus'
}
