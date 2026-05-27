import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmployeeScene } from "../EmployeeScene";

describe("EmployeeScene", () => {
  it("renders children behind the future animation boundary", () => {
    render(
      <EmployeeScene>
        <div>Activity state comes from backend</div>
      </EmployeeScene>,
    );

    expect(screen.getByText("Activity state comes from backend")).toBeInTheDocument();
    expect(screen.getByText("Activity state comes from backend").parentElement).toHaveClass(
      "employee-scene",
    );
  });
});
