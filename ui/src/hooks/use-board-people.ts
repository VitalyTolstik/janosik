import { createContext, useContext, type RefObject } from "react";

export type PeopleDialog = "members" | "share";
type BoardPeople = {
  archived: boolean;
  showMembers: boolean;
  showShare: boolean;
  menuRef: RefObject<HTMLButtonElement>;
  openDialog: (dialog: PeopleDialog, opener?: HTMLElement) => void;
};

export const BoardPeopleContext = createContext<BoardPeople | null>(null);

export function useBoardPeople() {
  return useContext(BoardPeopleContext);
}
