import type { DeviceInfo } from '../types'
import { getCpuCoresBucket, getMemoryBucket } from '../utils/size-buckets'

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
