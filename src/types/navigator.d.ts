/**
 * Augment Navigator with deviceMemory property from Device Memory API.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory
 */
interface Navigator {
    /**
     * Approximate amount of device memory in gigabytes.
     * This is an approximation given by rounding down to the nearest power of 2
     * and dividing that number by 1024.
     * May not be available in all browsers (Chrome/Edge only).
     */
    readonly deviceMemory?: number
}
