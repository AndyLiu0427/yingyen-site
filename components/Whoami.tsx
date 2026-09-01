"use client";

import { useEffect, useState } from "react";

const COMMAND = "whoami";
const TYPE_INTERVAL_MS = 70;
const START_DELAY_MS = 350;

/**
 * Types out `$ whoami` on load. The hero below rises on fixed CSS delays
 * tuned to land just after the typing finishes, so the page still renders
 * fully without JavaScript. Skips to the end state under reduced motion.
 */
export default function Whoami() {
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let i = 0;
    let interval: ReturnType<typeof setInterval>;
    const start = setTimeout(
      () => {
        if (reduceMotion) {
          setTyped(COMMAND);
          setDone(true);
          return;
        }
        interval = setInterval(() => {
          i += 1;
          setTyped(COMMAND.slice(0, i));
          if (i === COMMAND.length) {
            clearInterval(interval);
            setDone(true);
          }
        }, TYPE_INTERVAL_MS);
      },
      reduceMotion ? 0 : START_DELAY_MS,
    );
    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, []);

  return (
    <p className="font-mono text-sm text-faint" aria-hidden>
      <span className="text-accent">$</span> {typed}
      <span
        className={done ? "animate-blink text-muted" : "text-muted"}
      >
        &#9646;
      </span>
    </p>
  );
}
