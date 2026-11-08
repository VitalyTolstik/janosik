import type { Page } from "@playwright/test";

import { test as boardTest, expect } from "./board.js";
import {
  boardLink,
  cardLink,
  signInAt as signInAtUrl,
} from "../helpers/navigation.js";

export interface NavigationFixture {
  /** Absolute direct link to the fixture board. */
  boardUrl: string;
  /** Absolute card deep link (`?card=`) on the fixture board. */
  cardUrl: (cardId: string) => string;
  /** Sign in at `url`, preserving it for the post-login route. */
  signInAt: (page: Page, url: string) => Promise<void>;
}

/**
 * TASK-162.13 navigation workspace: the shared per-test account and board,
 * plus base-aware direct links and a sign-in that keeps the requested URL.
 */
export const test = boardTest.extend<{ navigation: NavigationFixture }>({
  navigation: async ({ board }, use) => {
    await use({
      boardUrl: boardLink(board.id),
      cardUrl: (cardId) => cardLink(board.id, cardId),
      signInAt: (page, url) => signInAtUrl(page, board.user, url),
    });
  },
});

export { expect };
