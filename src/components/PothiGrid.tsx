import type { Pothi } from "../lib/types";

type PothiGridProps = {
  pothis: Pothi[];
  selected?: number;
  onSelect?: (id: number) => void;
};

export function PothiGrid({ pothis, selected, onSelect }: PothiGridProps) {
  return (
    <div className="pothi-grid" role="group" aria-label="Pothi occupancy">
      {pothis.map((pothi) => {
        const occupied = Boolean(pothi.family_id);
        const isSelected = selected === pothi.id;
        const label = `Pothi ${pothi.id}${occupied ? " occupied" : " available"}`;
        const className = `pothi-cell ${occupied ? "occupied" : "open"} ${isSelected ? "selected" : ""}`;
        const content = (
          <>
            <input type="checkbox" checked={occupied} readOnly tabIndex={-1} aria-hidden="true" />
            <span>{pothi.id}</span>
          </>
        );

        if (onSelect) {
          return (
            <button
              type="button"
              key={pothi.id}
              className={className}
              onClick={() => onSelect(pothi.id)}
              aria-label={label}
              aria-pressed={isSelected}
            >
              {content}
            </button>
          );
        }

        return (
          <div key={pothi.id} className={className} aria-label={label}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
