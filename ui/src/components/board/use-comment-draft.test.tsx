import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COMMENT_KIND } from "@janosik/shared";

import { api } from "@/api/client";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { FakeServer } from "@/test/fake-server";

import { clearCommentDrafts, useCommentDraft } from "./use-comment-draft";

afterEach(() => {
  clearCommentDrafts();
  api.clearAccessToken();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("useCommentDraft", () => {
  it("drops whitespace-only drafts of the default kind", () => {
    const { result, unmount } = renderHook(() =>
      useCommentDraft("card-1", "user-1"),
    );

    act(() => result.current.update({ text: "   " }));
    expect(result.current.draft).toBeNull();
    act(() => result.current.update({ kind: "question" }));
    expect(result.current.draft).toEqual({ text: "", kind: "question" });
    act(() => result.current.update({ kind: DEFAULT_COMMENT_KIND }));
    unmount();

    const reopened = renderHook(() => useCommentDraft("card-1", "user-1"));
    expect(reopened.result.current.draft).toBeNull();
  });

  it("evicts the oldest draft when the cache reaches 51 entries", () => {
    const { result, rerender } = renderHook(
      (cardId) => useCommentDraft(cardId, "user-1"),
      { initialProps: "card-0" },
    );
    for (let index = 0; index <= 50; index += 1) {
      rerender(`card-${index}`);
      act(() => result.current.update({ text: `Draft ${index}` }));
    }

    rerender("card-0");
    expect(result.current.draft).toBeNull();
    rerender("card-1");
    expect(result.current.draft?.text).toBe("Draft 1");
    rerender("card-50");
    expect(result.current.draft?.text).toBe("Draft 50");
  });

  it("does not expose a stored draft to a different user on the same card", () => {
    const { result, rerender } = renderHook(
      (userId) => useCommentDraft("card-1", userId),
      { initialProps: "user-1" },
    );

    act(() => result.current.update({ text: "Private draft" }));
    rerender("user-2");
    expect(result.current.draft).toBeNull();
    rerender("user-1");
    expect(result.current.draft?.text).toBe("Private draft");
  });

  it.each(["sign-out", "session loss"] as const)(
    "clears drafts after %s even when the same user signs in again",
    async (endSession) => {
      vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
      const server = new FakeServer();
      vi.stubGlobal("fetch", server.handle);
      const { result, rerender } = renderHook(
        (cardId) => {
          const auth = useAuth();
          return { auth, composer: useCommentDraft(cardId, auth.user?.id) };
        },
        { initialProps: "card-1", wrapper: AuthProvider },
      );
      await waitFor(() => expect(result.current.auth.user?.id).toBe("user-1"));

      act(() => result.current.composer.update({ text: "Private draft" }));
      rerender("card-2");
      if (endSession === "sign-out") {
        await act(() => result.current.auth.logout());
      } else {
        act(() => api.onAuthLost?.());
      }
      expect(result.current.auth.status).toBe("anonymous");

      await act(() =>
        result.current.auth.login(
          server.account.email,
          server.account.password,
        ),
      );
      expect(result.current.auth.user?.id).toBe("user-1");
      rerender("card-1");
      expect(result.current.composer.draft).toBeNull();
    },
  );
});
