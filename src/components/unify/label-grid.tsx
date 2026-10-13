"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FileText, GripVertical } from "lucide-react";
import { DUPLICATE_HELP, DUPLICATE_LABELS } from "@/lib/duplicates";
import { MarketplaceBadge } from "../badges";
import { Badge, cx } from "../ui";
import type { LabelDto } from "./types";

interface CardProps {
  label: LabelDto;
  sequence: number | null;
  sortable: boolean;
  locked: boolean;
  originalName?: string;
  onToggle: (id: string, excluded: boolean) => void;
  onDecision: (id: string, decision: "KEEP" | "REMOVE") => void;
}

function LabelCard({ label, sequence, sortable, locked, originalName, onToggle, onDecision }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: label.id,
    disabled: !sortable || locked,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const ratio = label.widthMm && label.heightMm ? label.widthMm / label.heightMm : 2 / 3;
  const dup = label.duplicateType;
  const pending = dup && label.duplicateDecision === "PENDING";

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cx(
        "relative flex flex-col overflow-hidden rounded-md border bg-surface",
        pending ? "border-tape" : "border-line",
        label.excluded && "opacity-55",
        isDragging && "z-10 shadow-xl ring-2 ring-action",
      )}
    >
      {dup && <div className={cx("h-1.5", pending ? "tape-stripes" : "bg-line-strong")} aria-hidden />}
      <div className="flex items-center justify-between gap-2 px-2.5 pt-2">
        <span className={cx("text-sm font-semibold tabular-nums", label.excluded ? "text-ink-faint" : "text-ink")}>
          {label.excluded ? "Fora do PDF" : `#${sequence}`}
        </span>
        {sortable && !locked && (
          <button
            type="button"
            className="cursor-grab touch-none rounded p-1 text-ink-faint hover:bg-paper hover:text-ink active:cursor-grabbing"
            aria-label={`Mover etiqueta ${sequence ?? ""}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        )}
      </div>

      <div className="mx-2.5 mt-1.5 flex aspect-[3/4] items-center justify-center rounded-sm bg-paper p-1.5">
        {label.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={label.thumbnailUrl}
            alt={`Etiqueta ${label.fileName}, página ${label.pageIndex + 1}`}
            loading="lazy"
            draggable={false}
            className="max-h-full max-w-full border border-line bg-white object-contain shadow-sm"
            style={{ aspectRatio: String(ratio) }}
          />
        ) : (
          <FileText className="size-8 text-ink-faint" aria-label="Sem miniatura" />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 px-2.5 py-2">
        <MarketplaceBadge id={label.marketplace} />
        <p className="truncate font-mono text-xs text-ink" title={label.orderId ?? label.trackingCode ?? undefined}>
          {label.orderId ?? label.trackingCode ?? <span className="font-sans text-ink-faint">Sem nº de pedido</span>}
        </p>
        {label.description && (
          <p className="line-clamp-2 text-xs text-ink" title={label.description}>
            {label.description}
          </p>
        )}
        {label.sku && (
          <p className="line-clamp-2 text-xs text-ink-soft" title={label.sku}>
            <span className="text-ink-faint">SKU </span>
            {label.sku}
          </p>
        )}
        <p className="truncate text-xs text-ink-faint" title={label.fileName}>
          {label.fileName} · pág. {label.pageIndex + 1}
        </p>
        <p className="text-xs text-ink-faint">
          {label.widthMm} × {label.heightMm} mm
        </p>
        {label.blank && <Badge tone="warn">Página em branco</Badge>}
        {dup && (
          <div className="mt-1 space-y-1.5">
            <Badge tone={pending ? "warn" : "neutral"} title={DUPLICATE_HELP[dup]}>
              {DUPLICATE_LABELS[dup]}
            </Badge>
            {originalName && <p className="truncate text-xs text-ink-faint">Igual a: {originalName}</p>}
            {pending && !locked && (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => onDecision(label.id, "KEEP")}
                  className="flex-1 rounded border border-line-strong px-2 py-1 text-xs font-medium hover:bg-paper"
                >
                  Manter
                </button>
                <button
                  type="button"
                  onClick={() => onDecision(label.id, "REMOVE")}
                  className="flex-1 rounded border border-danger/40 px-2 py-1 text-xs font-medium text-danger hover:bg-danger-soft"
                >
                  Remover
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <label className={cx("flex items-center gap-2 border-t border-line px-2.5 py-2 text-xs", locked ? "text-ink-faint" : "cursor-pointer")}>
        <input
          type="checkbox"
          className="size-4 accent-action"
          checked={!label.excluded}
          disabled={locked}
          onChange={(e) => onToggle(label.id, !e.target.checked)}
        />
        Incluir no PDF
      </label>
    </li>
  );
}

export function LabelGrid({
  labels,
  allLabels,
  sortable,
  locked,
  onReorder,
  onToggle,
  onDecision,
}: {
  labels: LabelDto[];
  allLabels: LabelDto[];
  sortable: boolean;
  locked: boolean;
  onReorder: (ids: string[]) => void;
  onToggle: (id: string, excluded: boolean) => void;
  onDecision: (id: string, decision: "KEEP" | "REMOVE") => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Número de cada etiqueta no PDF final (apenas as incluídas).
  const sequence = new Map<string, number>();
  let n = 0;
  for (const l of allLabels) if (!l.excluded) sequence.set(l.id, ++n);
  const byId = new Map(allLabels.map((l) => [l.id, l]));

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = allLabels.map((l) => l.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={labels.map((l) => l.id)} strategy={rectSortingStrategy}>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {labels.map((l) => {
            const original = l.duplicateOfId ? byId.get(l.duplicateOfId) : undefined;
            return (
              <LabelCard
                key={l.id}
                label={l}
                sequence={sequence.get(l.id) ?? null}
                sortable={sortable}
                locked={locked}
                originalName={original ? `${original.fileName} · pág. ${original.pageIndex + 1}` : undefined}
                onToggle={onToggle}
                onDecision={onDecision}
              />
            );
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
