import { createContext } from "react";

/**
 * The dialog owns the footer slot after `.ac-body`; panels portal their
 * dynamic footer into this host so it stays a real flex sibling.
 */
export const AgentControlFooterContext = createContext<HTMLElement | null>(
  null,
);
