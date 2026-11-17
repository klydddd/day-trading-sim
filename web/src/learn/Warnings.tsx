import type { Warning } from '../../../shared/types';
import { useHelp } from './HelpContext';

/** Guardrail warnings: they inform, they never block. Learn only. */
export function Warnings({ warnings }: { warnings: Warning[] }) {
  const { learn } = useHelp();
  if (!learn || warnings.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label="Warnings">
      {warnings.map((w) => (
        <li key={w.code} className="tutor p-2 text-[13px]"><strong className="text-tutor">Heads up: </strong>{w.message}</li>
      ))}
    </ul>
  );
}
