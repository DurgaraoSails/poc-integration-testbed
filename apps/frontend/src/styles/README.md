# Shared design layer (`.sui-*`)

Two files, meant to be reused by every POC app so the portal and the POCs look
identical:

| File | What it holds | Import it when |
| --- | --- | --- |
| `theme.css` | `@import "tailwindcss"`, the `dark` variant, the brand `@theme` tokens, base cursor/scrollbar rules | always (it pulls in Tailwind) |
| `components.css` | `.sui-*` component classes | you want the shared buttons/inputs/cards/dialogs |

In a POC's global stylesheet:

```css
@import "./styles/theme.css";
@import "./styles/components.css";
```

## Principle

`.sui-*` classes own **what a thing looks like** (colour, border, radius, focus
ring, dark-mode treatment). The template still adds **layout** utilities
(`w-full`, `mt-6`, grid placement). Tailwind's `utilities` layer always beats
this `components` layer, so `class="sui-btn sui-btn--primary w-full"` and
one-off overrides both work.

## Classes

### Buttons — `sui-btn` + one variant

| | |
| --- | --- |
| `sui-btn--primary` | filled brand, the default action |
| `sui-btn--danger` | filled red, destructive action |
| `sui-btn--outline` | brand border + text, secondary action |
| `sui-btn--neutral` | grey border + text (e.g. "Back") |
| `sui-btn--ghost` | text only, no border/bg (e.g. modal "Cancel") |

Size / width modifiers: `sui-btn--sm`, `sui-btn--lg`, `sui-btn--block` (full width).
Base size is `px-3.5 py-2 text-sm`. Includes `disabled:` styling and uses
`hover:enabled:` so disabled buttons don't light up on hover.

```html
<button class="sui-btn sui-btn--primary">Save</button>
<button class="sui-btn sui-btn--ghost">Cancel</button>
<button class="sui-btn sui-btn--outline sui-btn--sm">Deploy v3</button>
<button class="sui-btn sui-btn--primary sui-btn--lg sui-btn--block">Register</button>
```

### Icon buttons

`sui-icon-btn` — small square icon-only button. Add `sui-icon-btn--danger` for a
red hover (delete).

### Form controls

`sui-input`, `sui-select`, `sui-textarea` — identical border/focus treatment.
`sui-input--search` makes it pill-shaped (keep your own `pl-9 pr-9` for the icon).

`sui-label`, `sui-error` (red validation text), `sui-hint` (grey helper text).

```html
<label for="name" class="sui-label">Name</label>
<input id="name" class="sui-input" />
<p class="sui-error">Name is required.</p>
```

### Surfaces

`sui-card` — panel background + border + radius. Padding stays a utility
(`p-5`, `px-4 py-3.5`, …) because it varies.

### Badges / pills — `sui-badge` + one tone

`sui-badge--neutral` · `--brand` · `--success` · `--danger` · `--warning` · `--info`

```html
<span class="sui-badge sui-badge--success">Succeeded</span>
```

### Dialog (native `<dialog>`)

`sui-dialog` (shell + backdrop; **you** set the width utility), `sui-dialog-header`,
`sui-dialog-title`, `sui-dialog-body`, `sui-dialog-footer`, `sui-dialog-close`
(the round × button).

```html
<dialog class="sui-dialog w-[calc(100vw-2rem)] max-w-md">
  <div class="sui-dialog-header">
    <h2 class="sui-dialog-title">Extend trial</h2>
    <button class="sui-dialog-close" aria-label="Close">…</button>
  </div>
  <div class="sui-dialog-body">…</div>
  <div class="sui-dialog-footer">
    <button class="sui-btn sui-btn--ghost">Cancel</button>
    <button class="sui-btn sui-btn--primary">Extend</button>
  </div>
</dialog>
```
