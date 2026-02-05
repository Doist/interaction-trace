/**
 * Map of trace names to their additional detail shapes.
 * Consumers define this to constrain valid trace names.
 */
export type TraceDefinitions = Record<string, Record<string, unknown>>

/**
 * Extract valid trace names from a definitions type.
 */
export type TraceNames<TDefs extends TraceDefinitions> = keyof TDefs & string
