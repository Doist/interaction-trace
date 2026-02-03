import { useEffect } from 'react'
import { signInteractionTrace } from '../core/trace-controller.mjs'
import type { TraceDefinitions, TraceNames } from '../trace-definitions.mjs'

type TypedUseInteractionTrace<TDefs extends TraceDefinitions> = <TName extends TraceNames<TDefs>>(
    name: TName,
    details?: TDefs[TName],
) => void

export function useInteractionTrace<
    TDefs extends TraceDefinitions,
    TName extends TraceNames<TDefs> = TraceNames<TDefs>,
>(name: TName, details?: TDefs[TName]): void

export function useInteractionTrace(name: string, details?: Record<string, unknown>): void

export function useInteractionTrace(name: string, details?: Record<string, unknown>): void {
    // biome-ignore lint/correctness/useExhaustiveDependencies: Intentionally signs only on mount
    useEffect(function signTraceOnMount() {
        if (typeof window === 'undefined') {
            return
        }
        signInteractionTrace(name, details)
    }, [])
}

useInteractionTrace.withTypes = function withTypes<
    TDefs extends TraceDefinitions,
>(): TypedUseInteractionTrace<TDefs> {
    return useInteractionTrace as TypedUseInteractionTrace<TDefs>
}
