import { createContext, useContext, type ReactNode } from 'react';
import type { HelpLevel } from '../../../shared/types';

const Ctx = createContext<{ helpLevel: HelpLevel }>({ helpLevel: 'learn' });

export function HelpProvider({ helpLevel, children }: { helpLevel: HelpLevel; children: ReactNode }) {
  return <Ctx.Provider value={{ helpLevel }}>{children}</Ctx.Provider>;
}

export function useHelp(): { learn: boolean; helpLevel: HelpLevel } {
  const { helpLevel } = useContext(Ctx);
  return { learn: helpLevel === 'learn', helpLevel };
}
