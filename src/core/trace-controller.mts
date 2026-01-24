import type { InteractionTraceConfig, TraceReporter } from '../types.mts'
import { isBrowserSupported } from './feature-detection.mts'
import { InteractionTrace } from './interaction-trace.mts'

const DEFAULT_PERSIST_KEY = 'interaction-trace-enrolled'
const DEFAULT_SAMPLE_RATE = 100

let initialized = false
let enrolled = false
let reporter: TraceReporter<string, unknown> | undefined
let contextGetter: (() => Record<string, unknown>) | undefined

// Store traces by their dispose function - we only need to call dispose() on cleanup
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
    if (initialized) {
        if (process.env.NODE_ENV === 'development') {
            console.warn('[interaction-trace] Already initialized. Call cleanup function first.')
        }
        return () => {}
    }

    // Check browser support
    if (!isBrowserSupported()) {
        if (process.env.NODE_ENV === 'development') {
            console.warn(
                '[interaction-trace] Browser does not support required Performance APIs (long-animation-frame, event).',
            )
        }
        return () => {}
    }

    // Check enrollment
    enrolled = checkEnrollment(config.enrollment)

    if (!enrolled) {
        return () => {}
    }

    initialized = true
    reporter = config.reporter as TraceReporter<string, unknown>

    return () => {
        initialized = false
        enrolled = false
        reporter = undefined
        contextGetter = undefined

        // Dispose all active traces
        for (const trace of activeTraces) {
            trace.dispose()
        }
        activeTraces.clear()
    }
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
    // Override takes precedence
    if (config?.isEnabled) {
        return config.isEnabled()
    }

    const sampleRate = config?.sampleRate ?? DEFAULT_SAMPLE_RATE
    const persistKey = config?.persistKey ?? DEFAULT_PERSIST_KEY

    // Check for existing enrollment state in sessionStorage
    if (typeof sessionStorage !== 'undefined') {
        const stored = sessionStorage.getItem(persistKey)

        if (stored !== null) {
            return stored === 'true'
        }

        // Roll for enrollment
        const isEnrolled = Math.random() * 100 < sampleRate

        try {
            sessionStorage.setItem(persistKey, String(isEnrolled))
        } catch {
            // sessionStorage may be unavailable (private browsing, quota exceeded)
        }

        return isEnrolled
    }

    // No sessionStorage, roll without persistence
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
