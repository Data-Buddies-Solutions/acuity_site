# Mobile Menu Background Adjustment Plan

## Objective

Ensure the mobile navigation overlay background is fully opaque white instead of semi-transparent, so content beneath the menu is no longer visible when the hamburger menu is open.

## Target Files

- `app/components/Header.tsx`

## Implementation Steps

1. **Make overlay background opaque**
   - Update the fixed overlay wrapper (`div` with `fixed inset-0 ...`) to use a solid white background (e.g., replace `bg-background/95` with `bg-white`), and remove any transparency utilities that make the menu see-through.
   - Retain `backdrop-blur` only if the blurred effect is still desired alongside the white background; otherwise remove it.
2. **Validate nested panel styling**
   - Double-check the inner menu container and buttons for redundant transparency classes (e.g., `bg-white/80`). Replace with `bg-white` if the new solid overlay requires it to achieve consistent appearance.
3. **Confirm interaction behavior still functions**
   - Ensure `isMobileNavOpen` toggling, closing on backdrop click, and link interactions remain unchanged after the styling update.

## Testing & Verification

- Open the site in a mobile viewport, trigger the hamburger menu, and confirm the overlay fully covers background content with a solid white fill.
- Navigate through each menu item and CTA to ensure the close behavior still works.
