"use client";

import { useState } from "react";

type Props = {
  title: string;
  lead: string;
  text: string;
};

/**
 * A block of text with a copy button, for the prompt that rebuilds a sketch.
 * Selecting a long <pre> by hand on a phone is misery; one tap is not.
 */
export default function CopyBlock({ title, lead, text }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard denied: the text is still right there to select.
    }
  };

  return (
    <section className="mt-16 border-t border-line pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
        <h2 className="font-display text-2xl text-ink">{title}</h2>
        <button
          type="button"
          onClick={copy}
          className="-m-2 p-2 font-mono text-xs tracking-[0.18em] text-muted uppercase transition-colors duration-150 hover:text-ink"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-4 max-w-[58ch] leading-relaxed text-muted [text-wrap:pretty]">
        {lead}
      </p>
      <pre className="mt-6 overflow-x-auto rounded-lg border border-line p-5 font-mono text-[13px] leading-relaxed text-muted whitespace-pre-wrap">
        {text}
      </pre>
    </section>
  );
}
