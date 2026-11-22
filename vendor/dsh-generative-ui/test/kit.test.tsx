import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// registry.ts captures URL.createObjectURL at module load; jsdom has none.
vi.hoisted(() => {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${n++}`;
  URL.revokeObjectURL = () => {};
});

const { registerRuntimeModules } = await import("../src/client/runtime/register.ts");
const { buildModuleSource, registryImports } = await import("../src/client/runtime/registry.ts");
const { kitThemeCss } = await import("../src/client/kit/jan-theme.ts");
const { useThemeMode } = await import("../src/client/kit/shared/useThemeMode.ts");
const Kit = await import("../src/client/kit/index.ts");

afterEach(() => {
  cleanup();
  document.body.removeAttribute("data-ds-dark-theme");
});

describe("$dsh/ui", () => {
  beforeAll(() => registerRuntimeModules());

  it("is an import generated cards can resolve, re-exporting the kit's components by name", () => {
    expect(registryImports()["$dsh/ui"]).toMatch(/^blob:/);
    const source = buildModuleSource("$dsh/ui");
    for (const name of ["Card", "Title", "Text", "RadioGroup", "Slider", "Carousel", "Flashcard", "Icon"]) {
      expect(source).toContain(`export const ${name} = ns["${name}"];`);
    }
  });

  it("installs Jan's theme for the kit once, owned by the plugin", () => {
    registerRuntimeModules();
    const sheets = document.head.querySelectorAll('style[data-plugin-css="dsh-generative-ui/kit-theme"]');
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.getAttribute("data-plugin")).toBe("dsh-generative-ui");
  });
});

describe("Jan's theme for the kit", () => {
  it("keeps Jan's colours ahead of react-components' dark palette in dark mode", () => {
    const style = document.createElement("style");
    style.textContent = kitThemeCss();
    document.head.appendChild(style);
    document.body.setAttribute("data-ds-dark-theme", "");
    const root = document.createElement("div");
    root.className = "ui4a-root";
    document.body.appendChild(root);
    const value = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
    try {
      // From react-components' dark palette: a token Jan does not replace.
      expect(value("--openui-border-default")).not.toBe("");
      // Jan's own, even though the dark palette also sets it.
      expect(value("--openui-text-neutral-primary")).toBe("var(--dsw-alias-label-primary)");
      expect(value("--openui-foreground")).toBe("var(--dsw-alias-bg-base)");
    } finally {
      root.remove();
      style.remove();
    }
  });

  it("follows Jan's light and dark switch outside a ThemeProvider", async () => {
    function Mode() {
      return <span>{useThemeMode()}</span>;
    }
    render(<Mode />);
    expect(screen.getByText("light")).toBeTruthy();
    await act(async () => document.body.setAttribute("data-ds-dark-theme", ""));
    await vi.waitFor(() => expect(screen.getByText("dark")).toBeTruthy());
  });

  it("lets a ThemeProvider's mode win over Jan's", () => {
    document.body.setAttribute("data-ds-dark-theme", "");
    function Mode() {
      return <span>{useThemeMode()}</span>;
    }
    render(
      <Kit.ThemeProvider mode="light">
        <Mode />
      </Kit.ThemeProvider>,
    );
    expect(screen.getByText("light")).toBeTruthy();
  });
});

describe("RadioGroup cards", () => {
  const options = [
    { value: "relaxed", label: "Relaxed", description: "Two sights a day" },
    { value: "packed", label: "Packed", description: "Everything" },
  ];

  it("reports the chosen value and marks only that card selected", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Kit.RadioGroup variant="cards" options={options} value="" onChange={onChange} />);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    fireEvent.click(screen.getByLabelText(/Packed/));
    expect(onChange).toHaveBeenCalledWith("packed");

    rerender(<Kit.RadioGroup variant="cards" options={options} value="packed" onChange={onChange} />);
    const selected = document.querySelectorAll(".openui-intelligent-radio-group-card[data-selected]");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toContain("Packed");
    expect(selected[0]?.textContent).toContain("Everything");
    expect((screen.getByLabelText(/Packed/) as HTMLInputElement).checked).toBe(true);
  });
});

describe("MathBlock", () => {
  it("shows the formula at once: the page already carries KaTeX's stylesheet", () => {
    const { container } = render(<Kit.MathBlock tex="E = mc^2" />);
    expect(container.querySelector(".katex")).not.toBeNull();
    expect((container.firstElementChild as HTMLElement).style.visibility).toBe("");
  });
});
