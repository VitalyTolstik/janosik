import type { Prisma } from "@prisma/client";

/** Files shown on the card face and in its default attachment list. */
export const CARD_ATTACHMENT_WHERE = {
  deletedAt: null,
  isInline: false,
  descriptionDetached: false,
} satisfies Prisma.AttachmentWhereInput;
