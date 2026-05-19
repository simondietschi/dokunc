"use client";

import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";
import { Info, CircleCheck, TriangleAlert, OctagonAlert } from "lucide-react";
import type { CalloutType } from "@dokunc/editor";
import { cn } from "@/lib/cn";

const META: Record<
  CalloutType,
  { icon: React.ComponentType<{ className?: string }>; cls: string }
> = {
  info: { icon: Info, cls: "dk-cl-info" },
  success: { icon: CircleCheck, cls: "dk-cl-success" },
  warn: { icon: TriangleAlert, cls: "dk-cl-warn" },
  danger: { icon: OctagonAlert, cls: "dk-cl-danger" },
};

export function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const type = (node.attrs.type as CalloutType) ?? "info";
  const Icon = META[type].icon;

  return (
    <NodeViewWrapper className={cn("dk-callout", META[type].cls)}>
      <div className="dk-callout-bar" contentEditable={false}>
        <Icon className="h-4 w-4 shrink-0" />
        {editor.isEditable && (
          <select
            value={type}
            onChange={(e) =>
              updateAttributes({ type: e.target.value as CalloutType })
            }
            className="ml-auto bg-transparent text-[11px] uppercase tracking-wide opacity-60 outline-none"
          >
            <option value="info">Info</option>
            <option value="success">Erfolg</option>
            <option value="warn">Warnung</option>
            <option value="danger">Achtung</option>
          </select>
        )}
      </div>
      <NodeViewContent className="dk-callout-body" />
    </NodeViewWrapper>
  );
}
