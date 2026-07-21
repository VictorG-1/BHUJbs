import type { Pothi } from "../lib/types";

type PothiGridProps = {
  pothis: Pothi[];
  selected?: number;
  onSelect?: (id: number) => void;
};

export function PothiGrid({ pothis, selected, onSelect }: PothiGridProps) {
  return (
    <div className="pothi-grid">
      {pothis.map((pothi) => {
        const occupied = Boolean(pothi.family_id);
        return (
          <button
            type="button"
            key={pothi.id}
            className={`pothi-cell ${occupied ? "occupied" : ""} ${selected === pothi.id ? "selected" : ""}`}
            disabled={occupied || !onSelect}
            onClick={() => onSelect?.(pothi.id)}
            aria-label={`Pothi ${pothi.id}${occupied ? " occupied" : " available"}`}
          >
            {pothi.id}
          </button>
        );
      })}
    </div>
  );
}
