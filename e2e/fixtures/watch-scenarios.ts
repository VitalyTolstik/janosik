export type Action = Record<string, unknown>;
type Scenario = {
  name: string;
  setup?: Action[];
  action: Action;
  message: string;
  diff?: [string, string];
};

export const scenarios: Scenario[] = [
  {
    name: "rename card",
    action: { type: "UPDATE_CARD", cardId: "card-a", title: "Updated title" },
    message: "Title changed",
    diff: ["Initial title", "Updated title"],
  },
  {
    name: "edit description",
    setup: [
      {
        type: "UPDATE_CARD",
        cardId: "card-a",
        description: "First description",
      },
    ],
    action: {
      type: "UPDATE_CARD",
      cardId: "card-a",
      description: "Revised description",
    },
    message: "Description changed",
    diff: ["First description", "Revised description"],
  },
  {
    name: "set priority",
    action: { type: "SET_CARD_PRIORITY", cardId: "card-a", priority: "high" },
    message: "Priority changed to High",
    diff: ["Medium", "High"],
  },
  {
    name: "change priority",
    setup: [{ type: "SET_CARD_PRIORITY", cardId: "card-a", priority: "high" }],
    action: { type: "SET_CARD_PRIORITY", cardId: "card-a", priority: "low" },
    message: "Priority changed to Low",
    diff: ["High", "Low"],
  },
  {
    name: "set due date",
    action: {
      type: "SET_CARD_DUE_DATE",
      cardId: "card-a",
      dueDate: 1893500000000,
    },
    message: "Due date changed",
  },
  {
    name: "remove due date",
    setup: [
      { type: "SET_CARD_DUE_DATE", cardId: "card-a", dueDate: 1893500000000 },
    ],
    action: { type: "SET_CARD_DUE_DATE", cardId: "card-a" },
    message: "Due date removed",
  },
  {
    name: "set cover",
    action: {
      type: "SET_CARD_COVER",
      cardId: "card-a",
      cover: { type: "color", value: "blue" },
    },
    message: "Cover set",
  },
  {
    name: "remove cover",
    setup: [
      {
        type: "SET_CARD_COVER",
        cardId: "card-a",
        cover: { type: "color", value: "blue" },
      },
    ],
    action: { type: "SET_CARD_COVER", cardId: "card-a" },
    message: "Cover removed",
    diff: ["color:blue", "—"],
  },
  {
    name: "archive card",
    action: { type: "ARCHIVE_CARD", cardId: "card-a" },
    message: "Archived",
  },
  {
    name: "restore card from archive",
    setup: [{ type: "ARCHIVE_CARD", cardId: "card-a" }],
    action: { type: "UNARCHIVE_CARD", cardId: "card-a", columnId: "todo" },
    message: "Restored from archive",
  },
  {
    name: "delete card",
    action: { type: "DELETE_CARD", cardId: "card-a" },
    message: "Deleted the card",
  },
  {
    name: "create label",
    action: {
      type: "ADD_LABEL",
      label: { id: "label-a", name: "Bug", color: "red" },
    },
    message: "Created a label",
  },
  {
    name: "rename label",
    setup: [
      {
        type: "ADD_LABEL",
        label: { id: "label-a", name: "Bug", color: "red" },
      },
    ],
    action: { type: "RENAME_LABEL", labelId: "label-a", name: "Defect" },
    message: "Renamed a label",
    diff: ["Bug", "Defect"],
  },
  {
    name: "change label colour",
    setup: [
      {
        type: "ADD_LABEL",
        label: { id: "label-a", name: "Bug", color: "red" },
      },
    ],
    action: { type: "SET_LABEL_COLOR", labelId: "label-a", color: "blue" },
    message: "Changed a label's colour",
    diff: ["red", "blue"],
  },
  {
    name: "delete label",
    setup: [
      {
        type: "ADD_LABEL",
        label: { id: "label-a", name: "Bug", color: "red" },
      },
    ],
    action: { type: "DELETE_LABEL", labelId: "label-a" },
    message: "Deleted a label",
    diff: ["Bug", "—"],
  },
  {
    name: "add card label",
    setup: [
      {
        type: "ADD_LABEL",
        label: { id: "label-a", name: "Bug", color: "red" },
      },
    ],
    action: {
      type: "SET_CARD_LABEL",
      cardId: "card-a",
      labelId: "label-a",
      on: true,
    },
    message: "Label Bug added",
  },
  {
    name: "remove card label",
    setup: [
      {
        type: "ADD_LABEL",
        label: { id: "label-a", name: "Bug", color: "red" },
      },
      {
        type: "SET_CARD_LABEL",
        cardId: "card-a",
        labelId: "label-a",
        on: true,
      },
    ],
    action: {
      type: "SET_CARD_LABEL",
      cardId: "card-a",
      labelId: "label-a",
      on: false,
    },
    message: "Label Bug removed",
    diff: ["Bug", "—"],
  },
  {
    name: "add checklist",
    action: {
      type: "ADD_CHECKLIST",
      cardId: "card-a",
      newChecklistId: "check-a",
      title: "Steps",
    },
    message: "Checklist Steps added",
  },
  {
    name: "rename checklist",
    setup: [
      {
        type: "ADD_CHECKLIST",
        cardId: "card-a",
        newChecklistId: "check-a",
        title: "Steps",
      },
    ],
    action: {
      type: "RENAME_CHECKLIST",
      cardId: "card-a",
      checklistId: "check-a",
      title: "Release",
    },
    message: "Checklist renamed to Release",
    diff: ["Steps", "Release"],
  },
  {
    name: "delete checklist",
    setup: [
      {
        type: "ADD_CHECKLIST",
        cardId: "card-a",
        newChecklistId: "check-a",
        title: "Steps",
      },
    ],
    action: {
      type: "DELETE_CHECKLIST",
      cardId: "card-a",
      checklistId: "check-a",
    },
    message: "Checklist Steps removed",
    diff: ["Steps", "—"],
  },
];

const checklistSetup: Action[] = [
  {
    type: "ADD_CHECKLIST",
    cardId: "card-a",
    newChecklistId: "check-a",
    title: "Steps",
  },
  {
    type: "ADD_CHECKLIST_ITEM",
    cardId: "card-a",
    checklistId: "check-a",
    newItemId: "item-a",
    text: "Review",
  },
];
scenarios.push(
  {
    name: "add checklist item",
    setup: [checklistSetup[0]!],
    action: checklistSetup[1]!,
    message: "Checklist item Review added",
  },
  {
    name: "check checklist item",
    setup: checklistSetup,
    action: {
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId: "card-a",
      checklistId: "check-a",
      itemId: "item-a",
      done: true,
    },
    message: "Review checked off",
  },
  {
    name: "uncheck checklist item",
    setup: [
      ...checklistSetup,
      {
        type: "SET_CHECKLIST_ITEM_DONE",
        cardId: "card-a",
        checklistId: "check-a",
        itemId: "item-a",
        done: true,
      },
    ],
    action: {
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId: "card-a",
      checklistId: "check-a",
      itemId: "item-a",
      done: false,
    },
    message: "Review unchecked",
  },
  {
    name: "rename checklist item",
    setup: checklistSetup,
    action: {
      type: "RENAME_CHECKLIST_ITEM",
      cardId: "card-a",
      checklistId: "check-a",
      itemId: "item-a",
      text: "Ship",
    },
    message: "Checklist item renamed to Ship",
    diff: ["Review", "Ship"],
  },
  {
    name: "delete checklist item",
    setup: checklistSetup,
    action: {
      type: "DELETE_CHECKLIST_ITEM",
      cardId: "card-a",
      checklistId: "check-a",
      itemId: "item-a",
    },
    message: "Checklist item Review removed",
    diff: ["Review", "—"],
  },
);

scenarios.push(
  {
    name: "create column",
    action: { type: "ADD_COLUMN", newColumnId: "doing", title: "Doing" },
    message: "Added a column",
  },
  {
    name: "rename column",
    action: { type: "RENAME_COLUMN", columnId: "todo", title: "Backlog" },
    message: "Renamed a column",
    diff: ["Todo", "Backlog"],
  },
  {
    name: "change column WIP limit",
    setup: [{ type: "SET_COLUMN_WIP_LIMIT", columnId: "todo", wipLimit: 3 }],
    action: { type: "SET_COLUMN_WIP_LIMIT", columnId: "todo", wipLimit: 5 },
    message: "Changed a column's WIP limit",
    diff: ["3", "5"],
  },
  {
    name: "sort column",
    setup: [
      {
        type: "ADD_CARD",
        newCardId: "card-b",
        columnId: "todo",
        title: "Another card",
      },
    ],
    action: { type: "SORT_COLUMN", columnId: "todo", sortBy: "title" },
    message: "Sorted a column",
    diff: ["Initial title, Another card", "Another card, Initial title"],
  },
  {
    name: "delete column",
    setup: [{ type: "ADD_COLUMN", newColumnId: "doing", title: "Doing" }],
    action: { type: "DELETE_COLUMN", columnId: "doing" },
    message: "Deleted a column",
    diff: ["Doing", "—"],
  },
  {
    name: "rename board",
    action: { type: "RENAME_BOARD", title: "Renamed board" },
    message: "Renamed the board",
  },
  {
    name: "create card",
    action: {
      type: "ADD_CARD",
      newCardId: "card-b",
      columnId: "todo",
      title: "New task",
    },
    message: "New task · Created",
  },
  {
    name: "duplicate card",
    action: {
      type: "DUPLICATE_CARD",
      cardId: "card-a",
      newCardId: "card-b",
      title: "Copy of Initial title",
    },
    message: "Duplicated a card",
  },
  {
    name: "move card",
    setup: [{ type: "ADD_COLUMN", newColumnId: "doing", title: "Doing" }],
    action: {
      type: "MOVE_CARD",
      cardId: "card-a",
      fromColumnId: "todo",
      fromIndex: 0,
      toColumnId: "doing",
      toIndex: 0,
    },
    message: "Moved to Doing",
    diff: ["Todo", "Doing"],
  },
  {
    name: "move card within column",
    setup: [
      {
        type: "ADD_CARD",
        newCardId: "card-b",
        columnId: "todo",
        title: "Other task",
      },
    ],
    action: {
      type: "MOVE_CARD",
      cardId: "card-a",
      fromColumnId: "todo",
      fromIndex: 0,
      toColumnId: "todo",
      toIndex: 1,
    },
    message: "Moved to Todo",
    diff: ["1", "2"],
  },
  {
    name: "link cards",
    setup: [
      {
        type: "ADD_CARD",
        newCardId: "card-b",
        columnId: "todo",
        title: "Other task",
      },
    ],
    action: {
      type: "ADD_CARD_LINK",
      cardId: "card-a",
      linkId: "link-a",
      targetCardId: "card-b",
      linkType: "blocks",
    },
    message: "Linked to",
  },
  {
    name: "remove card link",
    setup: [
      {
        type: "ADD_CARD",
        newCardId: "card-b",
        columnId: "todo",
        title: "Other task",
      },
      {
        type: "ADD_CARD_LINK",
        cardId: "card-a",
        linkId: "link-a",
        targetCardId: "card-b",
        linkType: "blocks",
      },
    ],
    action: {
      type: "REMOVE_CARD_LINK",
      cardId: "card-a",
      linkId: "link-a",
      targetCardId: "card-b",
      linkType: "blocks",
    },
    message: "Link to",
    diff: ["Other task", "—"],
  },
);

scenarios.push(
  {
    name: "move column",
    setup: [{ type: "ADD_COLUMN", newColumnId: "doing", title: "Doing" }],
    action: { type: "MOVE_COLUMN", columnId: "todo", fromIndex: 0, toIndex: 1 },
    message: "Moved a column",
  },
  {
    name: "duplicate column",
    action: {
      type: "DUPLICATE_COLUMN",
      columnId: "todo",
      newColumnId: "doing",
      newCardIds: ["card-b"],
      title: "Copy of Todo",
    },
    message: "Duplicated a column",
  },
  {
    name: "archive column cards",
    action: { type: "ARCHIVE_COLUMN_CARDS", columnId: "todo" },
    message: "Archived a column's cards",
  },
  {
    name: "reorder column cards",
    setup: [
      {
        type: "ADD_CARD",
        newCardId: "card-b",
        columnId: "todo",
        title: "Other task",
      },
    ],
    action: {
      type: "SET_COLUMN_CARD_ORDER",
      columnId: "todo",
      cardIds: ["card-b", "card-a"],
    },
    message: "Reordered a column",
    diff: ["Initial title, Other task", "Other task, Initial title"],
  },
  {
    name: "change task specification",
    setup: [
      {
        type: "SET_CARD_TASK_SPEC",
        cardId: "card-a",
        acceptanceCriteria: ["First requirement"],
      },
    ],
    action: {
      type: "SET_CARD_TASK_SPEC",
      cardId: "card-a",
      acceptanceCriteria: ["Updated requirement"],
    },
    message: "Changed the task spec",
    diff: ["First requirement", "Updated requirement"],
  },
  {
    name: "assign member",
    action: { type: "SET_CARD_ASSIGN", cardId: "card-a", assigneeId: "$self" },
    message: "Assignee changed to",
  },
  {
    name: "remove assignee",
    setup: [{ type: "SET_CARD_ASSIGN", cardId: "card-a", assigneeId: "$self" }],
    action: { type: "SET_CARD_ASSIGN", cardId: "card-a", assigneeId: null },
    message: "Removed the assignee",
  },
);
