import type { ReactNode } from "react";

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
        }

        return <span key={`${part}-${index}`}>{part}</span>;
      })}
    </>
  );
}

function flushParagraph(lines: string[], blocks: ReactNode[]) {
  if (!lines.length) {
    return;
  }

  blocks.push(
    <p key={`p-${blocks.length}`} className="text-sm leading-7 text-[#2d464a]">
      <InlineMarkdown text={lines.join(" ")} />
    </p>,
  );
  lines.length = 0;
}

function flushList(
  items: Array<{ text: string; type: "ol" | "ul" }>,
  blocks: ReactNode[],
) {
  if (!items.length) {
    return;
  }

  const type = items[0]?.type ?? "ul";
  const className =
    "ml-5 space-y-1 text-sm leading-7 text-[#2d464a] marker:text-[#0d7377]";
  const children = items.map((item, index) => (
    <li key={`${item.text}-${index}`}>
      <InlineMarkdown text={item.text} />
    </li>
  ));

  blocks.push(
    type === "ol" ? (
      <ol key={`ol-${blocks.length}`} className={`${className} list-decimal`}>
        {children}
      </ol>
    ) : (
      <ul key={`ul-${blocks.length}`} className={`${className} list-disc`}>
        {children}
      </ul>
    ),
  );
  items.length = 0;
}

export function MarkdownDocument({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  const paragraphLines: string[] = [];
  const listItems: Array<{ text: string; type: "ol" | "ul" }> = [];
  const lines = markdown.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph(paragraphLines, blocks);
      flushList(listItems, blocks);
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph(paragraphLines, blocks);
      flushList(listItems, blocks);
      const level = heading[1].length;
      const text = heading[2];
      const className =
        level === 1
          ? "text-2xl font-semibold tracking-[-0.04em] text-[#10272c]"
          : level === 2
            ? "text-base font-semibold tracking-[-0.02em] text-[#10272c]"
            : "text-sm font-semibold text-[#10272c]";

      blocks.push(
        <h3 key={`h-${blocks.length}`} className={className}>
          <InlineMarkdown text={text} />
        </h3>,
      );
      continue;
    }

    const orderedItem = /^\d+\.\s+(.+)$/.exec(line);
    if (orderedItem) {
      flushParagraph(paragraphLines, blocks);
      if (listItems[0]?.type === "ul") {
        flushList(listItems, blocks);
      }
      listItems.push({ text: orderedItem[1], type: "ol" });
      continue;
    }

    const unorderedItem = /^[-*]\s+(.+)$/.exec(line);
    if (unorderedItem) {
      flushParagraph(paragraphLines, blocks);
      if (listItems[0]?.type === "ol") {
        flushList(listItems, blocks);
      }
      listItems.push({ text: unorderedItem[1], type: "ul" });
      continue;
    }

    flushList(listItems, blocks);
    paragraphLines.push(line);
  }

  flushParagraph(paragraphLines, blocks);
  flushList(listItems, blocks);

  return <div className="space-y-4">{blocks}</div>;
}
