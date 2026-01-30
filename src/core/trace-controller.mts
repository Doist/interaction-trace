import type { InteractionTraceConfig, TraceReporter } from '../types.mjs'
import { isBrowserSupported } from './feature-detection.mjs'
import { InteractionTrace } from './interaction-trace.mjs'

const DEFAULT_PERSIST_KEY = 'interaction-trace-enrolled'
const DEFAULT_SAMPLE_RATE = 100

let initialized = false
let enrolled = false
let reporter: TraceReporter<string, unknown> | undefined
let contextGetter: (() => Record<string, unknown>) | undefined

/** Active traces that need cleanup on dispose */
const activeTraces = new Set<{ dispose(): void }>()

/**
 * Initializes the interaction trace monitor.
 *
 * @param config - Configuration including reporter and enrollment options
 * @returns Cleanup function to disable monitoring
 */
export function initInteractionTraceMonitor<
    TName extends string = string,
    TDetails = Record<string, unknown>,
>(config: InteractionTraceConfig<TName, TDetails>): () => void {
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
    reporter = config.reporter as TraceReporter<string, unknown>

    let cleanedUp = false

    function cleanup() {
        if (cleanedUp) {
            return
        }
        cleanedUp = true

        config.abortSignal?.removeEventListener('abort', cleanup)

        initialized = false
        enrolled = false
        reporter = undefined
        contextGetter = undefined

        for (const trace of activeTraces) {
            trace.dispose()
        }
        activeTraces.clear()
    }

    config.abortSignal?.addEventListener('abort', cleanup, { once: true })

    return cleanup
}

/**
 * Signs an interaction trace with the given name and details.
 * Creates a new trace instance that will report when complete.
 *
 * No-op if not initialized or not enrolled.
 *
 * @param name - The trace name
 * @param details - Optional trace details
 */
export function signInteractionTrace<
    TName extends string = string,
    TDetails = Record<string, unknown>,
>(name: TName, details?: TDetails): void {
    if (!initialized || !enrolled || !reporter) {
        return
    }

    const currentReporter = reporter
    const trace = new InteractionTrace<TName, TDetails>((report) => {
        activeTraces.delete(trace)
        currentReporter(report)
    })

    activeTraces.add(trace)

    const context = contextGetter?.() ?? {}
    trace.sign(name, (details ?? {}) as TDetails, context)
}

/**
 * Sets the context getter function.
 * Used by React provider to supply context values.
 * @internal
 */
export function setContextGetter(getter: (() => Record<string, unknown>) | undefined): void {
    contextGetter = getter
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
    initialized = false
    enrolled = false
    reporter = undefined
    contextGetter = undefined

    for (const trace of activeTraces) {
        trace.dispose()
    }
    activeTraces.clear()
}
