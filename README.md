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

Traces are created automatically on `pointerup` events. Use `signInteractionTrace()` to name and provide details for the pending trace from the last click.

```typescript
import { signInteractionTrace } from '@doist/interaction-trace'

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
    duration: number                  // Total LoAF duration (ms)
    inp: number | undefined           // INP value if captured (ms)
    details: {
        name: string                  // Trace name from signInteractionTrace()
        [key: string]: unknown        // Additional details (merged with context)
    }
    device: {
        memoryGB: string              // Bucketed: "0.25-2", "3-7", "8-plus", or "unknown"
        cpuCores: string              // Bucketed: "1-8", "9-16", "17-plus"
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

## Known Limitations

### Keyboard Interactions

This library only tracks pointer-based interactions (`pointerup` events). Keyboard-initiated interactions (e.g., pressing Enter to submit a form, Space to toggle a checkbox) are not captured. INP metrics will only reflect mouse/touch interactions.

If your application has significant keyboard usage, consider this when interpreting the collected metrics.

## Development

Development requires Node.js >= 20.0.0 (see `.node-version` for the pinned version).

> [!NOTE]
> No `engines` field in package.json—only devDependencies need this version, so consumers won't face version conflicts.

```bash
npm install
npm run build
npm test
```

## License

Released under the [MIT License](https://opensource.org/licenses/MIT).
