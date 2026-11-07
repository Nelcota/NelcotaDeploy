import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { TaskExecutionOutput } from "./task-execution-output";

describe("TaskExecutionOutput", () => {
  test.each(["", "  \n\t"])("hides controls for empty output %p", (output) => {
    const html = renderToStaticMarkup(<TaskExecutionOutput output={output} errorMessage={null} />);

    expect(html).toBe("");
  });

  test("offers copying without trimming the original output", () => {
    const output = "  completed successfully\n";
    const html = renderToStaticMarkup(<TaskExecutionOutput output={output} errorMessage={null} />);

    expect(html).toContain("Copiar saída");
    expect(html).toContain(output);
    expect(html).toContain('aria-label="Saída da execução"');
    expect(html).toContain('tabindex="0"');
  });

  test.each([null, "", " \n\t"])("does not announce an empty error %p", (errorMessage) => {
    const html = renderToStaticMarkup(
      <TaskExecutionOutput output="" errorMessage={errorMessage} />,
    );

    expect(html).toBe("");
  });

  test("keeps a friendly failure notice and the original technical reason in a disclosure", () => {
    const html = renderToStaticMarkup(
      <TaskExecutionOutput output="" errorMessage="Process exited with code 1" />,
    );

    expect(html).toContain("A execução encontrou um erro");
    expect(html).toContain("Detalhes do erro");
    expect(html).toContain("Process exited with code 1");
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
  });

  test("escapes markup from both output and technical errors", () => {
    const html = renderToStaticMarkup(
      <TaskExecutionOutput
        output="<script>alert(1)</script>"
        errorMessage="<img src=x onerror=alert(1)>"
      />,
    );

    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
  });
});
