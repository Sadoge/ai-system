'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export function SectionDisclosure({
  label,
  panelId,
  defaultOpen,
  children,
}: {
  label: string;
  panelId: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const previousDefault = useRef(defaultOpen);

  useEffect(() => {
    if (!previousDefault.current && defaultOpen) setOpen(true);
    previousDefault.current = defaultOpen;
  }, [defaultOpen]);

  return (
    <div className="run-detail-disclosure">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{open ? '−' : '+'}</span>
        {open ? 'Hide' : 'Show'} {label}
      </button>
      {/* RSC children are serialized even while closed; this controls visual noise, not payload. */}
      <div id={panelId}>{open && children}</div>
    </div>
  );
}
