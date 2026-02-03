import type { InteractionTraceConfig, TraceDetails, TraceReporter } from '../types.mjs'

/**
 * Map of trace names to their additional detail shapes.
 * Consumers define this to constrain valid trace names.
 */
type TraceDefinitions = Record<string, Record<string, unknown>>

/**
 * Extract valid trace names from a definitions type.
 */
type TraceNames<TDefs extends TraceDefinitions> = keyof TDefs & string

/**
 * A pre-typed signInteractionTrace function bound to specific TraceDefinitions.
 */
type TypedSignInteractionTrace<TDefs extends TraceDefinitions> = <TName extends TraceNames<TDefs>>(
    name: TName,
    details?: TDefs[TName],
) => void

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
    // Safe: TDetails extends TraceDetails, and the actual details object
    // passed to the reporter comes from signInteractionTrace which preserves the shape
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
 *
 * @example
 * // With TraceDefinitions type parameter
 * signInteractionTrace<MyTraces>('open modal', { modalId: 'settings' })
 *
 * @example
 * // Legacy/simple usage (any string)
 * signInteractionTrace('any trace name', { anyKey: 'anyValue' })
 *
 * @example
 * // Pre-typed pattern (recommended)
 * const signTrace = signInteractionTrace.withTypes<MyTraces>()
 * signTrace('open modal', { modalId: 'settings' })
 */
// Overload 1: With TraceDefinitions type parameter
export function signInteractionTrace<
    TDefs extends TraceDefinitions,
    TName extends TraceNames<TDefs> = TraceNames<TDefs>,
>(name: TName, details?: TDefs[TName]): void

// Overload 2: Legacy/simple usage (any string)
export function signInteractionTrace(name: string, details?: Record<string, unknown>): void

// Implementation
export function signInteractionTrace(name: string, details?: Record<string, unknown>): void {
    if (!initialized || !enrolled || !reporter) {
        return
    }

    const lastTrace = traces.at(-1)
    if (!lastTrace) {
        return
    }

    const mergedDetails = { name, ...details }
    lastTrace.sign(mergedDetails)
}

/**
 * Creates a pre-typed signInteractionTrace function bound to specific TraceDefinitions.
 * This is the recommended pattern for type-safe trace signing.
 *
 * @example
 * type MyTraces = {
 *     'open modal': { modalId: string }
 *     'submit form': { formId: string }
 * }
 *
 * const signTrace = signInteractionTrace.withTypes<MyTraces>()
 * signTrace('open modal', { modalId: 'settings' })  // ✅ autocomplete works!
 * signTrace('opne modal', { modalId: 'settings' })  // ❌ Error: typo caught
 */
signInteractionTrace.withTypes = function withTypes<
    TDefs extends TraceDefinitions,
>(): TypedSignInteractionTrace<TDefs> {
    return signInteractionTrace as TypedSignInteractionTrace<TDefs>
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
