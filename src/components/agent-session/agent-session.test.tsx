// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AgentSession } from "./agent-session";
import type { TimelineEntry, AgentSessionProps } from "./types";

const baseProps = (overrides: Partial<AgentSessionProps> = {}): AgentSessionProps => ({
  sessionId: "sess-1",
  title: "Test Session",
  status: "idle",
  entries: [],
  provider: "OpenAI",
  tools: ["browser_navigate", "browser_click", "tool_search"],
  privacy: "private",
  ...overrides,
});

const entry = (overrides: Partial<TimelineEntry> = {}): TimelineEntry => ({
  id: "e1",
  kind: "tool_call",
  timestamp: Date.now(),
  title: "tool_search",
  detail: "searched for 'react hooks'",
  provider: "OpenAI",
  toolName: "tool_search",
  status: "success",
  durationMs: 120,
  privacy: "private",
  ...overrides,
});

describe("AgentSession", () => {
  it("renders the title and provider badge", () => {
    render(<AgentSession {...baseProps()} />);
    expect(screen.getByText("Test Session")).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
  });

  it("renders privacy status badge", () => {
    render(<AgentSession {...baseProps({ privacy: "redacted" })} />);
    expect(screen.getByText("Redacted")).toBeInTheDocument();
  });

  it("shows elapsed time when provided", () => {
    render(<AgentSession {...baseProps({ elapsedMs: 5000 })} />);
    expect(screen.getByText("5.0s")).toBeInTheDocument();
  });

  it("renders timeline entries", () => {
    const entries = [
      entry({ id: "e1", kind: "tool_call", title: "tool_search", status: "success" }),
      entry({ id: "e2", kind: "navigation", title: "navigate", url: "https://example.com" }),
      entry({ id: "e3", kind: "error", title: "boom", status: "failure" }),
    ];
    render(<AgentSession {...baseProps({ entries })} />);
    expect(screen.getByText("tool_search")).toBeInTheDocument();
    expect(screen.getByText("navigate")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("filters entries by kind when a filter chip is clicked", () => {
    const entries = [
      entry({ id: "e1", kind: "tool_call", title: "tool_search" }),
      entry({ id: "e2", kind: "navigation", title: "navigate" }),
      entry({ id: "e3", kind: "error", title: "boom" }),
    ];
    render(<AgentSession {...baseProps({ entries })} />);
    expect(screen.getByText("tool_search")).toBeInTheDocument();
    expect(screen.getByText("navigate")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();

    const filterBtn = screen.getByRole("button", { name: /tool call/i });
    fireEvent.click(filterBtn);
    expect(screen.getByText("tool_search")).toBeInTheDocument();
    expect(screen.queryByText("navigate")).not.toBeInTheDocument();
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
  });

  it("calls onToggleRecording when the record button is clicked", () => {
    const onToggle = vi.fn();
    render(<AgentSession {...baseProps({ onToggleRecording: onToggle })} />);
    const btn = screen.getByRole("button", { name: /record/i });
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledWith("recording");
  });

  it("calls onClear when clear button is clicked", () => {
    const onClear = vi.fn();
    render(<AgentSession {...baseProps({ onClear })} />);
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it("shows tool badges for provided tools", () => {
    render(<AgentSession {...baseProps({ tools: ["browser_navigate", "browser_click"] })} />);
    expect(screen.getByText("browser_navigate")).toBeInTheDocument();
    expect(screen.getByText("browser_click")).toBeInTheDocument();
  });

  it("renders elapsed time from entries when not provided", () => {
    const now = Date.now();
    const entries = [
      entry({ id: "e1", timestamp: now - 3000, kind: "tool_call", title: "x" }),
    ];
    render(<AgentSession {...baseProps({ entries, elapsedMs: undefined })} />);
    expect(screen.getByText(/3\.0s/)).toBeInTheDocument();
  });

  it("shows error state when status is error", () => {
    render(<AgentSession {...baseProps({ status: "error" })} />);
    expect(screen.getByText(/error/i)).toBeInTheDocument();
  });

  it("renders empty state when no entries", () => {
    render(<AgentSession {...baseProps({ entries: [] })} />);
    expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
  });

  it("applies className prop", () => {
    const { container } = render(<AgentSession {...baseProps({ className: "custom-class" })} />);
    expect(container.firstChild).toHaveClass("custom-class");
  });

  it("shows entry detail in a tooltip on hover", () => {
    const entries = [entry({ id: "e1", kind: "tool_call", title: "x", detail: "searched for react hooks" })];
    render(<AgentSession {...baseProps({ entries })} />);
    expect(screen.getByText("searched for react hooks")).toBeInTheDocument();
  });
});
