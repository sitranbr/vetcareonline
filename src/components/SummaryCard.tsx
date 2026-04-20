import React from 'react';
import { HelpCircle, LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

interface SummaryCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: LucideIcon;
  colorClass: string;
  iconColorClass: string;
  /** Conteúdo exibido ao passar o mouse no ícone de ajuda (canto superior direito). */
  tip?: React.ReactNode;
}

export const SummaryCard: React.FC<SummaryCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  colorClass,
  iconColorClass,
  tip,
}) => {
  return (
    <div className="relative bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-all duration-300">
      {tip ? (
        <div className="group absolute top-3 right-3 z-10">
          <button
            type="button"
            className="rounded-full p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-petcare-light/50"
            aria-label="Detalhar composição do valor"
          >
            <HelpCircle className="w-4 h-4" aria-hidden />
          </button>
          <div
            role="tooltip"
            className="pointer-events-none invisible absolute right-0 top-full z-20 mt-1 w-[min(calc(100vw-2rem),18rem)] rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal normal-case tracking-normal text-gray-700 shadow-lg opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
          >
            {tip}
          </div>
        </div>
      ) : null}
      <div className={clsx('flex items-center justify-between mb-3', tip && 'pr-10')}>
        <div className={clsx("p-3 rounded-lg bg-opacity-10", iconColorClass.replace('text-', 'bg-'))}>
          <Icon className={clsx("w-6 h-6", iconColorClass)} />
        </div>
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{title}</span>
      </div>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      <p className={clsx("text-xs mt-2 font-medium", colorClass)}>{subtitle}</p>
    </div>
  );
};
