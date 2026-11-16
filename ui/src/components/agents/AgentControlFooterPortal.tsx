import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { AgentControlFooterContext } from "./agent-control-footer-context";

/**
 * Portal a panel's dynamic footer into the board modal's footer slot. The
 * host is provided by `AgentControlDialog`, so the footer is a flex sibling
 * after `.ac-body` instead of an absolutely-positioned overlay.
 */
export function AgentControlFooterPortal({
  children,
  active = true,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  const host = useContext(AgentControlFooterContext);
  if (!active || host === null) return null;
  return createPortal(children, host);
}
