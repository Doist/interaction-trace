/**
 * Approximate amount of memory in GB, capped at 8GB and separated into buckets.
 * - 'unknown': deviceMemory not available
 * - '0.25-2': memory <= 2GB
 * - '3-7': memory > 2GB and < 8GB
 * - '8-plus': memory >= 8GB
 */
export type MemoryBucket = 'unknown' | '0.25-2' | '3-7' | '8-plus'

/**
 * Number of logical CPU cores the device can run in parallel, separated into buckets.
 * - '1-8': cores <= 8
 * - '9-16': cores > 8 and <= 16
 * - '17-plus': cores > 16
 */
export type CpuCoresBucket = '1-8' | '9-16' | '17-plus'

/**
 * Device capability information collected at trace time.
 */
export type DeviceInfo = {
    readonly memoryGB: MemoryBucket
    readonly cpuCores: CpuCoresBucket
}

/**
 * Base type for trace details. Requires a name field.
 */
export type TraceDetails<TName extends string = string> = {
    readonly name: TName
} & Record<string, unknown>

/**
 * Report generated when an interaction trace completes.
 */
export type TraceReport<TDetails extends TraceDetails = TraceDetails> = {
    /** Unique trace ID (crypto.randomUUID()) */
    readonly id: string
    /** Total duration from start mark to last LoAF end mark (ms, rounded) */
    readonly duration: number
    /** INP value if captured (ms, rounded), undefined if no pointerup event */
    readonly inp: number | undefined
    /** Details from signInteractionTrace() call, includes name */
    readonly details: TDetails
    /** Device capability info */
    readonly device: DeviceInfo
}

/**
 * Function called when a trace completes to report metrics.
 */
export type TraceReporter<TDetails extends TraceDetails = TraceDetails> = (
    report: TraceReport<TDetails>,
) => void | Promise<void>

/**
 * Configuration for session enrollment/sampling.
 */
export type EnrollmentConfig = {
    /** Percentage of sessions to enroll (0-100). Default: 100 */
    sampleRate?: number
    /** sessionStorage key for enrollment state. Default: 'interaction-trace-enrolled' */
    persistKey?: string
    /** Override function - takes precedence over sampleRate if provided */
    isEnabled?: () => boolean
}

/**
 * Configuration for initializing the interaction trace monitor.
 */
export type InteractionTraceConfig<TDetails extends TraceDetails = TraceDetails> = {
    /** Reporter function called when a trace completes */
    reporter: TraceReporter<TDetails>
    /** Enrollment/sampling configuration */
    enrollment?: EnrollmentConfig
    /** Optional AbortSignal - when aborted, automatically calls cleanup */
    abortSignal?: AbortSignal
}
