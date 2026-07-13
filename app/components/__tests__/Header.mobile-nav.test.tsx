import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, mock } from "bun:test";
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

describe("Header mobile navigation", () => {
  it("opens an accessible sheet with the simplified navigation", () => {
    render(<Header />);

    fireEvent.click(screen.getByLabelText("Open navigation"));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("bg-[#fbfaf7]");
    expect(within(dialog).getByRole("link", { name: "Product" })).toHaveAttribute(
      "href",
      "/#product",
    );
    expect(within(dialog).getByRole("link", { name: "Proof" })).toHaveAttribute(
      "href",
      "/#proof",
    );
    expect(within(dialog).getByRole("link", { name: "Practice Portal" })).toHaveAttribute(
      "href",
      "/portal",
    );
  });
});
