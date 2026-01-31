import type { InteractionTraceConfig, TraceDetails, TraceReporter } from '../types.mjs'
import { isBrowserSupported } from './feature-detection.mjs'
import { InteractionTrace } from './interaction-trace.mjs'

const DEFAULT_PERSIST_KEY = 'interaction-trace-enrolled'
const DEFAULT_SAMPLE_RATE = 100
const CLEANUP_TIMER_MS = 1000

let initialized = false
let enrolled = false
let reporter: TraceReporter | undefined

type Trace = Pick<InteractionTrace<TraceDetails>, 'cancel' | 'sign' | 'isProcessed' | 'isCancelled'>

let traces: Trace[] = []
let cleanupTimeoutId: ReturnType<typeof setTimeout> | undefined

function handlePointerUp(): void {
    if (!reporter) return

    for (const trace of traces) {
        trace.cancel()
    }
    traces = []

    const trace = new InteractionTrace<TraceDetails>((report) => {
        reporter?.(report)
    })
    traces.push(trace)

    if (cleanupTimeoutId !== undefined) {
        clearTimeout(cleanupTimeoutId)
    }
    cleanupTimeoutId = setTimeout(() => {
        traces = traces.filter((t) => !t.isProcessed && !t.isCancelled)
        cleanupTimeoutId = undefined
    }, CLEANUP_TIMER_MS)
}

/**
 * Initializes the interaction trace monitor.
 *
 * @param config - Configuration including reporter and enrollment options
 * @returns Cleanup function to disable monitoring
 */
export function initInteractionTraceMonitor<TDetails extends TraceDetails = TraceDetails>(
    config: InteractionTraceConfig<TDetails>,
): () => void {
    if (config.abortSignal?.aborted) {
        return () => {}
    }

    if (initialized) {
        if (process.env.NODE_ENV === 'development') {
            console.warn('[interaction-trace] Already initialized. Call cleanup function first.')
        }
        return () => {}
    }

    if (!isBrowserSupported()) {
        if (process.env.NODE_ENV === 'development') {
            console.warn(
                '[interaction-trace] Browser does not support required Performance APIs (long-animation-frame, event).',
            )
        }
        return () => {}
    }

    enrolled = checkEnrollment(config.enrollment)

    if (!enrolled) {
        return () => {}
    }

    initialized = true
    reporter = config.reporter as TraceReporter

    document.addEventListener('pointerup', handlePointerUp)

    let cleanedUp = false

    function cleanup() {
        if (cleanedUp) {
            return
        }
        cleanedUp = true

        config.abortSignal?.removeEventListener('abort', cleanup)

        document.removeEventListener('pointerup', handlePointerUp)

        if (cleanupTimeoutId !== undefined) {
            clearTimeout(cleanupTimeoutId)
            cleanupTimeoutId = undefined
        }

        for (const trace of traces) {
            trace.cancel()
        }
        traces = []

        initialized = false
        enrolled = false
        reporter = undefined
    }

    config.abortSignal?.addEventListener('abort', cleanup, { once: true })

    return cleanup
}

/**
 * Signs the most recent interaction trace with the given name and details.
 * The trace must have been created by a pointerup event.
 *
 * No-op if not initialized, not enrolled, or no pending trace exists.
 *
 * @param name - The trace name
 * @param details - Optional additional trace details
 */
export function signInteractionTrace<TDetails extends TraceDetails>(
    name: TDetails['name'],
    details?: Omit<TDetails, 'name'>,
): void {
    if (!initialized || !enrolled || !reporter) {
        return
    }

    const lastTrace = traces.at(-1)
    if (!lastTrace) {
        return
    }

    const mergedDetails = { name, ...details } as TDetails
    lastTrace.sign(mergedDetails)
}

function checkEnrollment(config: InteractionTraceConfig['enrollment']): boolean {
    if (config?.isEnabled) {
        return config.isEnabled()
    }

    const sampleRate = config?.sampleRate ?? DEFAULT_SAMPLE_RATE
    const persistKey = config?.persistKey ?? DEFAULT_PERSIST_KEY

    if (typeof sessionStorage !== 'undefined') {
        const stored = sessionStorage.getItem(persistKey)

        if (stored !== null) {
            return stored === 'true'
        }

        const isEnrolled = Math.random() * 100 < sampleRate

        try {
            sessionStorage.setItem(persistKey, String(isEnrolled))
        } catch {
            // sessionStorage may be unavailable (private browsing, quota exceeded)
        }

        return isEnrolled
    }

    return Math.random() * 100 < sampleRate
}

/**
 * Returns whether the monitor is currently initialized and enrolled.
 * @internal
 */
export function isMonitorActive(): boolean {
    return initialized && enrolled
}

/**
 * Resets the controller state.
 * Only for testing purposes.
 * @internal
 */
export function resetController(): void {
    document.removeEventListener('pointerup', handlePointerUp)

    if (cleanupTimeoutId !== undefined) {
        clearTimeout(cleanupTimeoutId)
        cleanupTimeoutId = undefined
    }

    for (const trace of traces) {
        trace.cancel()
    }
    traces = []

    initialized = false
    enrolled = false
    reporter = undefined
}
