# @doist/interaction-trace

[![npm version](https://img.shields.io/npm/v/@doist/interaction-trace)](https://www.npmjs.com/package/@doist/interaction-trace)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/node/v/@doist/interaction-trace)](https://nodejs.org/)

A performance monitoring library for tracking user interactions using [Interaction to Next Paint (INP)](https://web.dev/articles/inp) and [Long Animation Frames (LoAF)](https://web.dev/articles/long-animation-frames). Features declarative trace signing and pluggable reporting.

## Installation

```bash
npm install @doist/interaction-trace
```

## Usage

### Initialize the Monitor

```typescript
import { initInteractionTraceMonitor } from '@doist/interaction-trace'

const cleanup = initInteractionTraceMonitor({
    reporter: (report) => {
        // Send to your analytics service
        console.log('Trace report:', report)
    },
    enrollment: {
        sampleRate: 10, // 10% of sessions
        isEnabled: () => user.isInternal, // Optional override
    },
})

// Call cleanup() when done (e.g., on app unmount)
```

### Sign Traces

```typescript
import { signInteractionTrace } from '@doist/interaction-trace'

// Sign when an interaction begins
button.addEventListener('click', () => {
    signInteractionTrace('open modal', { modalId: 'settings' })
    openModal()
})
```

### React Integration

```tsx
import { useInteractionTrace, InteractionTraceProvider } from '@doist/interaction-trace/react'

// Hook: Signs trace on component mount
function SettingsModal() {
    useInteractionTrace('open modal', { modalId: 'settings' })
    return <div>...</div>
}

// Provider: Adds shared context to all traces
function App() {
    return (
        <InteractionTraceProvider value={{ routeType: 'dashboard' }}>
            <Dashboard />
        </InteractionTraceProvider>
    )
}
```

## Configuration

### Enrollment Options

| Option | Type | Description |
|--------|------|-------------|
| `sampleRate` | `number` | Percentage of sessions to enroll (0-100) |
| `persistKey` | `string` | sessionStorage key for enrollment state. Default: `'interaction-trace-enrolled'` |
| `isEnabled` | `() => boolean` | Override function (takes precedence over sampleRate) |

### Reporter Interface

The reporter receives a `TraceReport` object:

```typescript
type TraceReporter = (report: TraceReport) => void | Promise<void>

interface TraceReport {
    id: string                        // Unique trace ID (crypto.randomUUID())
    name: string                      // Trace name from signInteractionTrace()
    startTime: number                 // performance.now() at sign time
    duration: number                  // Total LoAF duration
    inp: number | undefined           // INP value if captured
    details: Record<string, unknown>  // From signInteractionTrace() call
    context: Record<string, unknown>  // From InteractionTraceProvider
    device: {
        memoryGB: string              // Bucketed: "<4", "4-8", ">8"
        cpuCores: string              // Bucketed: "<4", "4-8", ">8"
    }
}
```

## Browser Compatibility

| Feature | Support | Fallback |
|---------|---------|----------|
| Long Animation Frames (LoAF) | Chrome 123+ | Graceful no-op |
| Interaction to Next Paint (INP) | Chrome 96+, Edge 96+ | `inp` field undefined |
| `crypto.randomUUID()` | All modern browsers (Secure Context) | Required |
| `PerformanceObserver` | All modern browsers | Required |

**SSR/Node.js:** All browser APIs are safely guarded. Functions return no-ops when APIs are unavailable.

## License

Released under the [MIT License](https://opensource.org/licenses/MIT).
