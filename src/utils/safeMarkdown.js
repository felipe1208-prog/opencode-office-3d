function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInline(escapedLine) {
  const codeTokens = [];
  let text = escapedLine.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = codeTokens.length;
    codeTokens.push(
      `<span class="px-1.5 py-0.5 rounded bg-white/10 text-[#F3F4F6] font-medium">${code}</span>`,
    );
    return `\u0000CODE_${idx}\u0000`;
  });

  // Negritas (**texto** o __texto__)
  text = text.replace(
    /\*\*([^\n*]+(?:\*(?!\*)[^\n*]*)*)\*\*/g,
    '<strong class="font-semibold text-[#F9FAFB]">$1</strong>',
  );
  text = text.replace(
    /__([^\n_]+)__/g,
    '<strong class="font-semibold text-[#F9FAFB]">$1</strong>',
  );

  // Cursivas (*texto*)
  text = text.replace(
    /(^|[\s(])\*([^*\s][^*\n]*?[^*\s]|[^*\s])\*(?=[\s).,;:!?]|$)/g,
    '$1<em class="italic text-[#E5E7EB]">$2</em>',
  );

  return text.replace(/\u0000CODE_(\d+)\u0000/g, (_, idx) => codeTokens[Number(idx)] || "");
}

export function renderSafeMarkdown(rawText) {
  const normalized = String(rawText || "").replace(/\r\n/g, "\n");
  if (!normalized.trim()) return "";

  const lines = normalized.split("\n");
  const blocks = [];

  let inFence = false;
  let fenceLines = [];
  let listType = null; // "ul" | "ol" | null
  let listItems = [];
  let paragraphLines = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const htmlLines = paragraphLines.map((l) => formatInline(escapeHtml(l)));
    blocks.push(`<p class="leading-relaxed">${htmlLines.join("<br />")}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) return;
    const tag = listType === "ol" ? "ol" : "ul";
    const listClass =
      listType === "ol"
        ? "pl-4 list-decimal space-y-1 text-[#E5E7EB] marker:text-[#9CA3AF]"
        : "pl-4 list-disc space-y-1 text-[#E5E7EB] marker:text-[#6B7280]";
    const itemsHtml = listItems
      .map((item) => `<li class="leading-relaxed">${formatInline(escapeHtml(item))}</li>`)
      .join("");
    blocks.push(`<${tag} class="${listClass}">${itemsHtml}</${tag}>`);
    listType = null;
    listItems = [];
  };

  const flushFence = () => {
    const code = escapeHtml(fenceLines.join("\n"));
    blocks.push(
      `<div class="rounded-md bg-[#111318] border border-white/[0.08] px-3 py-2 text-[11px] text-[#E5E7EB] whitespace-pre-wrap overflow-x-auto leading-relaxed">${code}</div>`,
    );
    fenceLines = [];
    inFence = false;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      if (inFence) {
        flushFence();
      } else {
        flushParagraph();
        flushList();
        inFence = true;
        fenceLines = [];
      }
      continue;
    }

    if (inFence) {
      fenceLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push('<hr class="my-1.5 border-white/[0.08]" />');
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      const sizeClass = level <= 2 ? "text-[13px]" : "text-xs";
      blocks.push(
        `<div class="${sizeClass} font-semibold text-[#F9FAFB] pt-1">${formatInline(escapeHtml(headingMatch[2]))}</div>`,
      );
      continue;
    }

    const ulMatch = line.match(/^\s*[-*•]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(ulMatch[1]);
      continue;
    }

    const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(olMatch[1]);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  if (inFence) {
    flushFence();
  }
  flushParagraph();
  flushList();

  return blocks.join("");
}
