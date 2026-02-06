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
        isEnabled: () => {
            if (user.isInternal) return true    // force enable for internal users
            return undefined                     // everyone else: use sampleRate
        },
    },
    abortSignal: controller.signal, // Optional: auto-cleanup when aborted
})

// Or call cleanup() manually when done
```

### Sign Traces

A trace measures the time from a user click to the browser completing all visual updates. Traces are created automatically on `pointerup` events—use `signInteractionTrace()` to name and provide details for the pending trace.

```typescript
import { signInteractionTrace } from '@doist/interaction-trace'

button.addEventListener('click', () => {
    signInteractionTrace('open modal', { modalId: 'settings' })
    openModal()
})
```

#### TypeScript

Create a pre-typed function for compile-time validation of trace names and details:

```typescript
import { signInteractionTrace } from '@doist/interaction-trace'

type MyTraces = {
    'open modal': { modalId: string }
    'submit form': { formId: string }
}

const signAppTrace = signInteractionTrace.withTypes<MyTraces>()

signAppTrace('open modal', { modalId: 'settings' })   // ✅ Works
signAppTrace('opne modal', { modalId: 'settings' })   // ❌ Error: typo caught
signAppTrace('open modal', { formId: 'x' })           // ❌ Error: wrong details
```

### React Integration

```tsx
import { useInteractionTrace } from '@doist/interaction-trace/react'

function SettingsModal() {
    useInteractionTrace('open modal', { modalId: 'settings' })
    return <div>...</div>
}
```

#### TypeScript

```tsx
import { useInteractionTrace } from '@doist/interaction-trace/react'

type MyTraces = {
    'open modal': { modalId: string }
    'submit form': { formId: string }
}

const useAppTrace = useInteractionTrace.withTypes<MyTraces>()

function SettingsModal() {
    useAppTrace('open modal', { modalId: 'settings' })
    return <div>...</div>
}
```

## Configuration

### Enrollment Options

| Option | Type | Description |
|--------|------|-------------|
| `sampleRate` | `number` | Percentage of sessions to enroll (0-100) |
| `persistKey` | `string` | sessionStorage key for enrollment state. Default: `'interaction-trace-enrolled'` |
| `isEnabled` | `() => boolean \| undefined` | Override function. `true`/`false` override sampling, `undefined` defers to `sampleRate` |

### Reporter Interface

The reporter receives a `TraceReport` object:

```typescript
type TraceReport = {
    id: string                        // Unique trace ID (crypto.randomUUID())
    duration: number                  // Total LoAF duration (ms)
    inp: number | undefined           // INP value if captured (ms)
    details: {
        name: string                  // Trace name from signInteractionTrace()
        [key: string]: unknown        // Additional details
    }
    device: {
        memoryGB: string              // Bucketed: "0.25-2", "3-7", "8-plus", or "unknown"
        cpuCores: string              // Bucketed: "1-8", "9-16", "17-plus"
    }
}
```

## Browser Support

Requires Chrome 123+ for Long Animation Frames and Event Timing APIs. In unsupported browsers, the monitor silently no-ops—your app continues to work normally, just without trace collection.

## Known Limitations

### Keyboard Interactions

This library only tracks pointer-based interactions (`pointerup` events). Keyboard-initiated interactions (e.g., pressing Enter to submit a form, Space to toggle a checkbox) are not captured. INP metrics will only reflect mouse/touch interactions.

If your application has significant keyboard usage, consider this when interpreting the collected metrics.

## Development

Development requires Node.js >= 22.18.0 (see `.node-version`).

```bash
npm install
npm run build
npm test
```

## Releasing

This project uses [release-please](https://github.com/googleapis/release-please) to automate releases. Commits merged to `main` with `fix:` trigger patch releases, `feat:` triggers minor releases, and `feat!:` or `fix!:` triggers major releases.

When commits land on `main`, release-please creates a release PR. Merging it publishes to npm and GitHub Packages.

## License

Released under the [MIT License](https://opensource.org/licenses/MIT).
