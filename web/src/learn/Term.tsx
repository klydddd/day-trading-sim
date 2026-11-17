import { useId, type ReactNode } from 'react';
import { GLOSSARY, type TermId } from './glossary';
import { useHelp } from './HelpContext';

/** In Learn: dotted underline + hover/focus tooltip. In Challenge: the plain text, no tooltip markup at all. */
export function Term({ id, children }: { id: TermId; children: ReactNode }) {
  const { learn } = useHelp();
  const tipId = useId();
  if (!learn) return <>{children}</>;
  const g = GLOSSARY[id];
  return (
    <span className="group relative inline-block cursor-help underline decoration-tutor decoration-dotted underline-offset-4" tabIndex={0} aria-describedby={tipId}>
      {children}
      <span role="tooltip" id={tipId}
        className="pointer-events-none invisible absolute left-0 top-full z-50 mt-1 w-72 rounded-md border border-tutor/60 bg-panel p-3 text-left text-[13px] font-normal normal-case text-text no-underline shadow-lg opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100">
        <span className="block font-semibold text-tutor">{g.term}</span>
        <span className="mt-1 block">{g.definition}</span>
        <span className="mt-1 block text-muted">Example: {g.example}</span>
      </span>
    </span>
  );
}
