import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SkillBodyEditor } from "./SkillBodyEditor";

afterEach(cleanup);

describe("SkillBodyEditor", () => {
  it("numbers one gutter line per logical line of the body", () => {
    render(<SkillBodyEditor value={"alpha\nbeta\ngamma"} onChange={() => {}} ariaLabel="Skill body" />);
    for (const n of ["1", "2", "3"]) {
      expect(screen.getByText(n)).toBeInTheDocument();
    }
    expect(screen.queryByText("4")).not.toBeInTheDocument();
  });

  it("counts the empty line a trailing newline creates", () => {
    // The caret sits on line 3 after `beta\n`, so the gutter has to show a 3.
    render(<SkillBodyEditor value={"alpha\nbeta\n"} onChange={() => {}} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renumbers as the body grows", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SkillBodyEditor value="alpha" onChange={onChange} ariaLabel="Skill body" />);
    expect(screen.queryByText("2")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Skill body"), { target: { value: "alpha\nbeta" } });
    expect(onChange).toHaveBeenCalledWith("alpha\nbeta");

    // Controlled: the count only moves once the new value comes back in.
    rerender(<SkillBodyEditor value={"alpha\nbeta"} onChange={onChange} ariaLabel="Skill body" />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("does not soft-wrap, which is what keeps a number beside its own line", () => {
    render(<SkillBodyEditor value="alpha" onChange={() => {}} ariaLabel="Skill body" />);
    expect(screen.getByLabelText("Skill body")).toHaveAttribute("wrap", "off");
  });

  it("hides the gutter from assistive tech — it is decoration, not content", () => {
    const { container } = render(<SkillBodyEditor value={"a\nb"} onChange={() => {}} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it("keeps its rows height instead of growing with the body", () => {
    // The frame is a flex row, so an auto height would let the gutter — one div
    // per line — set it. A long skill then rendered a page-tall editor that never
    // scrolled, which also silently disabled the gutter's scroll sync.
    const short = render(<SkillBodyEditor value="one line" onChange={() => {}} rows={6} />);
    const shortH = (short.container.firstChild as HTMLElement).style.height;

    cleanup();
    const long = render(
      <SkillBodyEditor value={Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n")} onChange={() => {}} rows={6} />,
    );
    expect((long.container.firstChild as HTMLElement).style.height).toBe(shortH);
  });
});
