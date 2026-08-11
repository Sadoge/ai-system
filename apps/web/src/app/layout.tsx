import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Movements } from './nav';

export const metadata: Metadata = {
  title: 'ai-system',
  description: 'AI Software Engineering Platform',
};

/**
 * The direction contract. Emitted into the built markup so the render can be
 * audited against the decision that produced it.
 */
const DIRECTION_CONTRACT = `<!--
THESIS: A run is a score - parallel voices in strict time, read by whoever decides when it proceeds. It refuses the dark dashboard of status pills.
OWN-WORLD: Diazo blueprint ground, engraved bone rules, vermilion conductor's pencil, cobalt cue. Three-line staves, barlines, rehearsal marks, margin editorial marks. System stacks; italic serif is the annotation voice.
STORY: The engineer sees where every voice stands, what stopped, and what waits on them, then makes the mark and it proceeds.
FIRST VIEWPORT: Run detail. Programme head, then a system of staves, one voice per task, crossing stage barlines left to right; a pending gate is a full-width vermilion caesura carrying the mark control.
FORM: Conductor's Score; candidate 3 of 7; seed 3e3865ce.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div hidden dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8">
          <header className="programme-head mb-10 px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <Link
                href="/"
                className="font-mono text-xl font-bold tracking-tight"
                aria-label="ai-system home"
              >
                <span className="wordmark-ai" aria-hidden>ai</span>
                <span className="wordmark-punctuation" aria-hidden>-</span>
                <span className="wordmark-system" aria-hidden>system</span>
              </Link>
              <p className="annot text-sm text-violet-bright">
                deterministic orchestration, read as a score
              </p>
            </div>
            <div className="mt-4 border-t border-rule-strong pt-3">
              <Movements />
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
