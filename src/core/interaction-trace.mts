import type { TraceDetails, TraceReport, TraceReporter } from '../types.mjs'
import { getDeviceInfo } from './device-info.mjs'

const MEASURE_NAME = 'interaction-trace-measure'
const MARK_START_NAME = `${MEASURE_NAME}-start`
const MARK_END_NAME = `${MEASURE_NAME}-end`

/** Timeout after last LoAF frame before completing the trace */
const LONG_FRAME_TIMEOUT = 500
/** Maximum time to wait for LoAF frames */
const MAX_WAIT_TIMEOUT = 15000
/**
 * Borrowed from the Web Vitals library. 40ms is the threshold for tracking events spanning 2.5 or more frames
 * @see https://github.com/GoogleChrome/web-vitals/blob/1b872cf5f2159e8ace0e98d55d8eb54fb09adfbe/src/onINP.ts#L120
 */
const INP_THRESHOLD = 40

/**
 * InteractionTrace tracks the performance of user interactions by observing
 * both long animation frames (LoAF) and interaction to next paint (INP).
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Long_animation_frame_timing
 * @see https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming
 */
export class InteractionTrace<TDetails extends TraceDetails = TraceDetails> {
    readonly id: string

    private onComplete: TraceReporter<TDetails>
    private processed = false
    private disposed = false

    private details: TDetails | undefined

    private readonly markStartName: string
    private readonly markEndName: string
    private readonly measureName: string

    private loafObserver: PerformanceObserver | undefined
    private inpObserver: PerformanceObserver | undefined
    private frameTimeout: ReturnType<typeof setTimeout> | undefined
    private maxTimeout: ReturnType<typeof setTimeout> | undefined

    private inpStart: number | undefined
    private inpDuration: number | undefined

    constructor(onComplete: TraceReporter<TDetails>) {
        this.id = crypto.randomUUID()
        this.onComplete = onComplete

        this.markStartName = `${MARK_START_NAME}-${this.id}`
        this.markEndName = `${MARK_END_NAME}-${this.id}`
        this.measureName = `${MEASURE_NAME}-${this.id}`

        this.observeLongAnimationFrames()
        this.observeNextPaint()
    }

    /**
     * Signs the trace with details (including name).
     * Marks the start time for duration measurement.
     */
    sign(details: TDetails): void {
        if (this.processed || this.disposed) {
            return
        }

        this.details = details
    }

    /**
     * Disposes of the trace, cleaning up observers and timers.
     * Does not call onComplete.
     */
    dispose(): void {
        if (this.disposed) {
            return
        }

        this.disposed = true
        this.cleanup()
    }

    private observeLongAnimationFrames(): void {
        performance.mark(this.markStartName)

        this.loafObserver = new PerformanceObserver(() => {
            if (this.frameTimeout) {
                clearTimeout(this.frameTimeout)
            }
            performance.mark(this.markEndName)

            this.frameTimeout = setTimeout(() => {
                this.process()
            }, LONG_FRAME_TIMEOUT)
        })

        this.loafObserver.observe({ type: 'long-animation-frame' })

        this.maxTimeout = setTimeout(() => {
            this.process()
        }, MAX_WAIT_TIMEOUT)
    }

    private observeNextPaint(): void {
        this.inpObserver = new PerformanceObserver((list) => {
            // keyup events are also available, but just tracking pointerup to be
            // consistent with long frames tracking for now.
            const pointerUpEntry = list.getEntries().find((entry) => entry.name === 'pointerup')

            if (pointerUpEntry) {
                this.inpStart = pointerUpEntry.startTime
                this.inpDuration = pointerUpEntry.duration
            }
        })

        this.inpObserver.observe({
            type: 'event',
            // @ts-expect-error PerformanceObserver is resolved to lib.dom types and may be missing the durationThreshold option
            durationThreshold: INP_THRESHOLD,
        })
    }

    private process(): void {
        if (this.processed || this.disposed) {
            return
        }

        this.processed = true
        this.cleanup()

        let duration: number | undefined
        const traceName = this.details?.name
        const measureName = traceName ? `${MEASURE_NAME}-${traceName}` : this.measureName

        if (performance.getEntriesByName(this.markEndName).length > 0) {
            const measurement = performance.measure(
                measureName,
                this.markStartName,
                this.markEndName,
            )
            duration = measurement.duration ? Math.round(measurement.duration) : undefined
        }

        performance.clearMarks(this.markStartName)
        performance.clearMarks(this.markEndName)
        performance.clearMeasures(measureName)

        let inp: number | undefined
        if (this.inpStart !== undefined && this.inpDuration !== undefined) {
            const inpMeasureName = traceName
                ? `${MEASURE_NAME}-inp-${traceName}`
                : `${this.measureName}-inp`

            const measurement = performance.measure(inpMeasureName, {
                start: this.inpStart,
                duration: this.inpDuration,
            })

            inp = measurement?.duration ? Math.round(measurement.duration) : undefined
            performance.clearMeasures(inpMeasureName)
        }

        if (this.details !== undefined && duration !== undefined) {
            const report: TraceReport<TDetails> = {
                id: this.id,
                duration,
                inp,
                details: this.details,
                device: getDeviceInfo(),
            }

            this.onComplete(report)
        }
    }

    private cleanup(): void {
        this.loafObserver?.disconnect()
        this.inpObserver?.disconnect()

        if (this.frameTimeout) {
            clearTimeout(this.frameTimeout)
            this.frameTimeout = undefined
        }

        if (this.maxTimeout) {
            clearTimeout(this.maxTimeout)
            this.maxTimeout = undefined
        }
    }
}
