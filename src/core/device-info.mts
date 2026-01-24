import type { DeviceInfo } from '../types.mts'
import { getCpuCoresBucket, getMemoryBucket } from '../utils/size-buckets.mts'

/**
 * Collects device capability information.
 * Safe for SSR - returns default buckets when navigator is unavailable.
 */
export function getDeviceInfo(): DeviceInfo {
    return {
        memoryGB: getMemoryBucket(),
        cpuCores: getCpuCoresBucket(),
    }
}
