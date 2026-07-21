import type { ReactNode } from "react";

type StatusPillProps = {
  tone?: "green" | "amber" | "red" | "blue" | "gray";
  children: ReactNode;
};

export function StatusPill({ tone = "gray", children }: StatusPillProps) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
