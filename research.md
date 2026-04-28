# Mobile Hamburger Menu Research

## Implementation Location

- `app/components/Header.tsx`: mobile navigation toggle and overlay menu logic live here alongside the desktop navigation.

## Current Behavior

- Uses React state `isMobileNavOpen` to toggle between hidden/visible mobile navigation.
- Hamburger trigger is a `Button` with `md:hidden`; swaps between `Menu` and `X` icons from `lucide-react` based on state.
- When open, a fixed full-screen overlay (`fixed inset-0 z-40`) renders with blurred background and a vertically stacked navigation panel.
- Clicking any nav link, the "Book a Strategy Call" CTA, or the overlay backdrop closes the menu by flipping `isMobileNavOpen` to `false`.

## UI & Styling Notes

- Tailwind utility classes provide layout and transitions; `buttonVariants` from `app/components/ui/button` standardizes button styling.
- The overlay container centers content within `max-w-screen-sm` and rounds individual link buttons for a card-like appearance.
- No animation hooks beyond Tailwind's default transition classes; opening/closing is an instantaneous mount/unmount.

## Accessibility & UX Considerations

- Trigger button includes `aria-label="Toggle navigation"` and sets `aria-expanded` based on state.
- Close button within the tray has its own `aria-label`.
- Focus management is not customized; focus stays on the trigger when the menu appears, and tab order proceeds into the overlay.
- Body scroll remains enabled while the sheet is open (no locking), so background can scroll beneath the overlay.

## Dependencies

- `lucide-react` icons: `Menu`, `X`.
- Shared UI helpers: `buttonVariants`, `Button`, and `cn` from `@/lib/utils`.
- Next.js primitives: `Link` for navigation, `Image` for logo.

## Opportunities / Questions

- Consider adding body scroll locking to prevent background interaction while menu is open.
- Evaluate trapping focus within the mobile menu for stronger accessibility compliance.
- Could add open/close transition animations (e.g., fade/slide) for smoother visual feedback.
- Verify analytics/tracking captures mobile nav interactions if needed.
