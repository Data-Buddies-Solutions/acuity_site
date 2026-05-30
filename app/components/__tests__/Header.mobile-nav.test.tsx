import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { mock, describe, it, expect } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";

import Header from "../Header";

expect.extend(matchers);

mock.module("next/image", () => ({
  default: ({ priority: _priority, alt = "", ...props }: any) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt} {...props} />;
  },
}));

mock.module("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("Header mobile navigation overlay", () => {
  it("renders opaque backgrounds when the hamburger menu is opened", () => {
    render(<Header />);

    const toggleButton = screen.getByLabelText("Toggle navigation");
    fireEvent.click(toggleButton);

    const closeButton = screen.getByLabelText("Close navigation");
    const overlay = closeButton.closest(".fixed");
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass("bg-white");
    expect(overlay).not.toHaveClass("bg-background/95");

    const mobileNav = screen
      .getAllByRole("navigation")
      .find((nav) => nav.classList.contains("space-y-6"));
    expect(mobileNav).toBeDefined();

    const sheet = mobileNav?.closest("div");
    expect(sheet).not.toBeNull();
    expect(sheet).toHaveClass("bg-white");
    expect(sheet).toHaveClass("min-h-full");

    const mobileLink = screen.getAllByRole("link", { name: "About" }).at(-1);
    expect(mobileLink).toBeDefined();
    expect(mobileLink).toHaveClass("text-2xl");
  });
});
