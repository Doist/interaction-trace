---
paths:
  - "**/*.ts"
  - "**/*.ts"
  - "**/*.mts"
  - "**/*.tsx"
---

# TypeScript Guidelines

Follow these TypeScript best practices when writing code to ensure type safety and maintainability.

## Requirements

- Use strict type checking - avoid `any` type
- Use interfaces for object shapes that will be implemented or extended
- Use type aliases for unions, intersections, and complex types
- Use enums for fixed sets of related values
- Use generics for reusable components and functions
- Use type guards to narrow types
- Use discriminated unions for state management
- Use readonly for immutable properties
- Use optional properties with care
- Use the nullish coalescing operator (`??`) instead of logical OR (`||`) for defaults
- Use `unknown` instead of `any` when the type is not known

## Type Definitions

- Define types close to where they are used
- Export types that are used across multiple files
- Use descriptive names for types
- Use PascalCase for type names
- Use interfaces for objects that will be extended
- Use type aliases for unions and complex types
- Use generics for reusable types

## Type Annotations

- Add type annotations for function parameters
- Add return types for functions with non-obvious return types
- Use type inference when the type is obvious
- Use const assertions for literal types
- Use `as const` for readonly arrays and objects

## Type Guards

- Use type guards to narrow types
- Use `instanceof` for class instances
- Use `typeof` for primitive types
- Use `in` for property checks
- Use custom type guards with type predicates
- Use discriminated unions for complex type narrowing

## Examples

### Good: Type definitions and discriminated unions

```typescript
interface Task {
  id: string;
  content: string;
  isCompleted: boolean;
  dueDate?: Date;
  labels: string[];
}

type TaskAction =
  | { type: 'ADD_TASK'; payload: Omit<Task, 'id'> }
  | { type: 'COMPLETE_TASK'; payload: string }
  | { type: 'DELETE_TASK'; payload: string }
  | { type: 'UPDATE_TASK'; payload: { id: string; content: string } };
```

### Good: Generic function

```typescript
function filterItems<T, K extends keyof T>(
  items: T[],
  property: K,
  value: T[K]
): T[] {
  return items.filter(item => item[property] === value);
}
```

### Good: Type guard

```typescript
function isTask(value: unknown): value is Task {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'content' in value &&
    'isCompleted' in value
  );
}
```

### Good: Readonly properties

```typescript
interface UserSettings {
  readonly id: string;
  theme: 'light' | 'dark';
  notifications: boolean;
}
```

### Bad: Using any type

```typescript
// Don't do this
function processData(data: any) {
  return data.map(item => item.value);
}
```

### Bad: Missing type annotations

```typescript
// Don't do this
function calculateTotal(items) {
  return items.reduce((total, item) => total + item.price, 0);
}
```

### Bad: Using type when interface should be extended

```typescript
// Don't do this - use interface for extensible objects
type User = {
  id: string;
  name: string;
}

type AdminUser = User & {
  permissions: string[];
}
```

### Bad: Non-discriminated union

```typescript
// Don't do this - use discriminated unions
type Action = {
  type: string;
  payload: any;
}
```
