import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, mock } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";

import ValuesPage from "./page";

expect.extend(matchers);

mock.module("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("Values page", () => {
  it("states Acuity's mission and operating values", () => {
    render(<ValuesPage />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Free medical practices from administrative overload so every patient can be treated like a VIP.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "A future where AI runs the administration, humans elevate the care, and no patient falls through the cracks.",
      }),
    ).toBeInTheDocument();

    const difference = screen.getByRole("region", {
      name: "A different way of working together.",
    });
    for (const proof of [
      "Move fast.",
      "Built into your workflow.",
      "Direct access to the founders.",
    ]) {
      expect(
        within(difference).getByRole("heading", { name: proof }),
      ).toBeInTheDocument();
    }

    const values = screen.getByRole("region", { name: "Our values" });
    for (const value of [
      "Make the future more human.",
      "Stay curious.",
      "Be resilient.",
      "Take ownership.",
    ]) {
      expect(within(values).getByRole("heading", { name: value })).toBeInTheDocument();
    }

    expect(screen.getByRole("link", { name: "Meet the team" })).toHaveAttribute(
      "href",
      "/about",
    );
  });
});
