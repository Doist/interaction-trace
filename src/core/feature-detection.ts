let loafSupported: boolean | undefined
let inpSupported: boolean | undefined

/**
 * Checks if long-animation-frame entry type is supported.
 * Result is memoized after first check.
 */
export function isLoafSupported(): boolean {
    if (loafSupported !== undefined) {
        return loafSupported
    }

    loafSupported = checkEntryTypeSupport('long-animation-frame')
    return loafSupported
}

/**
 * Checks if event entry type is supported (for INP measurement).
 * Result is memoized after first check.
 */
export function isInpSupported(): boolean {
    if (inpSupported !== undefined) {
        return inpSupported
    }

    inpSupported = checkEntryTypeSupport('event')
    return inpSupported
}

/**
 * Checks if browser supports both LoAF and INP measurement.
 */
export function isBrowserSupported(): boolean {
    return isLoafSupported() && isInpSupported()
}

function checkEntryTypeSupport(entryType: string): boolean {
    if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
        return false
    }

    return PerformanceObserver.supportedEntryTypes?.includes(entryType) ?? false
}

/**
 * Resets memoized feature detection results.
 * Only for testing purposes.
 * @internal
 */
export function resetFeatureDetection(): void {
    loafSupported = undefined
    inpSupported = undefined
}
