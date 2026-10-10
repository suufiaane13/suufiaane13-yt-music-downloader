import React from "react";

export default function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="shrink-0 relative flex items-end justify-center px-12 pt-4 pb-2">
      {right && <div className="absolute right-4 top-4 flex items-center gap-2">{right}</div>}
      <div className="text-center">
        <h1 className="text-base font-bold text-white tracking-tight">{title}</h1>
        {subtitle && <p className="text-[11px] text-dark-300 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}