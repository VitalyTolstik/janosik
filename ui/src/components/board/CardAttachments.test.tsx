import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AttachmentDto } from "@janosik/shared";

import { ApiError } from "@/api/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ToastProvider } from "@/components/Toast";
import { CardAttachments } from "./CardAttachments";

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  isApiEnabled: () => true,
}));

vi.mock("@/utils/download", () => ({ downloadBlob: vi.fn() }));

import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { downloadBlob } from "@/utils/download";

// The signed-in user (uploader in the fixtures) — the delete affordance
// depends on ownership.
vi.mock("@/auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/AuthContext")>();
  return {
    ...actual,
    useAuth: () => ({
      ...actual.useAuth(),
      user: {
        id: "user-1",
        email: "me@example.com",
        displayName: "Me",
        avatarColor: null,
        avatarPath: null,
        createdAt: 0,
      },
    }),
  };
});

function attachment(overrides: Partial<AttachmentDto> = {}): AttachmentDto {
  return {
    id: "att-1",
    cardId: "card-1",
    fileName: "spec.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    uploadedById: "user-1",
    transcodeStatus: "none",
    hasThumbnail: false,
    hasPoster: false,
    createdAt: Date.UTC(2026, 8, 20, 10, 0),
    ...overrides,
  };
}

function renderSection(
  props: Partial<Parameters<typeof CardAttachments>[0]> = {},
) {
  return render(
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <CardAttachments cardId="card-1" boardId="b-1" {...props} />
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

describe("CardAttachments", () => {
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(api, "listDetachedAttachments").mockResolvedValue([]);
  });

  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    if (clipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("reveals and focuses a deep-linked attachment", async () => {
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scroll,
    });
    vi.spyOn(api, "listAttachments").mockResolvedValue([attachment()]);
    renderSection({ focusId: "att-1" });

    const row = await screen.findByTestId("card-attachment-row");
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(row).toHaveAttribute("data-search-highlight", "true");
    expect(document.activeElement).toBe(row);
  });

  it("leaves the card intact for an unknown attachment deep link", async () => {
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scroll,
    });
    vi.spyOn(api, "listAttachments").mockResolvedValue([attachment()]);
    renderSection({ focusId: "missing" });

    const row = await screen.findByTestId("card-attachment-row");
    expect(row).not.toHaveAttribute("data-search-highlight");
    expect(scroll).not.toHaveBeenCalled();
  });

  it("ignores a stale response after switching cards", async () => {
    let resolveFirst!: (items: AttachmentDto[]) => void;
    let resolveSecond!: (items: AttachmentDto[]) => void;
    vi.spyOn(api, "listAttachments")
      .mockReturnValueOnce(
        new Promise<AttachmentDto[]>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<AttachmentDto[]>((resolve) => {
          resolveSecond = resolve;
        }),
      );

    const tree = (cardId: string) => (
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <CardAttachments cardId={cardId} boardId="b-1" />
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    );
    const { rerender } = render(tree("card-1"));
    await waitFor(() =>
      expect(api.listAttachments).toHaveBeenCalledWith("card-1"),
    );

    rerender(tree("card-2"));
    await waitFor(() =>
      expect(api.listAttachments).toHaveBeenCalledWith("card-2"),
    );

    act(() => resolveFirst([attachment({ id: "old", fileName: "old.pdf" })]));
    await waitFor(() =>
      expect(screen.queryByText("old.pdf")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("card-attachments-skeleton")).toBeInTheDocument();

    act(() => resolveSecond([attachment({ id: "new", fileName: "new.pdf" })]));
    expect(await screen.findByText("new.pdf")).toBeInTheDocument();
    expect(screen.queryByText("old.pdf")).not.toBeInTheDocument();
  });

  it("keeps the main list when the detached-bin request fails", async () => {
    vi.spyOn(api, "listAttachments").mockResolvedValue([attachment()]);
    vi.spyOn(api, "listDetachedAttachments").mockRejectedValue(
      new Error("offline"),
    );
    renderSection();

    expect(await screen.findByTestId("card-attachment-row")).toHaveTextContent(
      "spec.pdf",
    );
    expect(screen.queryByTestId("card-attachments-empty")).toBeNull();
  });

  it("shows a busy skeleton until the first list arrives", async () => {
    let release!: (items: AttachmentDto[]) => void;
    const gate = new Promise<AttachmentDto[]>((resolve) => {
      release = resolve;
    });
    vi.spyOn(api, "listAttachments").mockReturnValue(gate);
    renderSection();

    const skeleton = await screen.findByTestId("card-attachments-skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("card-attachments-empty")).toBeNull();

    act(() => release([attachment()]));

    expect(
      await screen.findByTestId("card-attachment-row"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("card-attachments-skeleton"),
    ).not.toBeInTheDocument();
  });

  it("renders the list with size and offers upload", async () => {
    vi.spyOn(api, "listAttachments").mockResolvedValue([attachment()]);
    renderSection();
    expect(
      await screen.findByTestId("card-attachment-row"),
    ).toBeInTheDocument();
    expect(screen.getByText("spec.pdf")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(screen.getByTestId("card-attachments-upload")).toBeEnabled();
  });

  it("marks a video that is still encoding (TASK-50)", async () => {
    vi.spyOn(api, "listAttachments").mockResolvedValue([
      attachment({
        id: "att-mov",
        fileName: "take.mov",
        mimeType: "video/quicktime",
        transcodeStatus: "pending",
      }),
    ]);
    renderSection();
    await screen.findByText("take.mov");
    expect(
      await screen.findByTestId("card-attachment-encoding"),
    ).toBeInTheDocument();
  });

  it("shows a real thumbnail for image attachments", async () => {
    vi.spyOn(api, "listAttachments").mockResolvedValue([
      attachment({
        id: "att-img",
        fileName: "shot.png",
        mimeType: "image/png",
      }),
    ]);
    vi.spyOn(api, "fetchAttachment").mockResolvedValue(
      new Blob(["img"], { type: "image/png" }),
    );
    renderSection();
    await screen.findByText("shot.png");
    const thumb = await screen.findByAltText("shot.png");
    expect(thumb.tagName).toBe("IMG");
    expect(api.fetchAttachment).toHaveBeenCalledWith("att-img");
  });

  it("uploads a picked file and prepends it to the list", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    const created = attachment({
      id: "att-2",
      fileName: "notes.txt",
      mimeType: "text/plain",
    });
    vi.spyOn(api, "uploadAttachment").mockResolvedValue(created);
    renderSection();

    await screen.findByTestId("card-attachments-empty");
    const input = screen.getByTestId("card-attachments-input");
    await user.upload(
      input,
      new File(["hello"], "notes.txt", { type: "text/plain" }),
    );

    await waitFor(() =>
      expect(screen.getByText("notes.txt")).toBeInTheDocument(),
    );
    expect(api.uploadAttachment).toHaveBeenCalledWith(
      "card-1",
      expect.any(File),
    );
  });

  it("maps a 413 to the size toast and does not add the row", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.spyOn(api, "uploadAttachment").mockRejectedValue(
      new ApiError(413, null),
    );
    renderSection();

    await screen.findByTestId("card-attachments-empty");
    await user.upload(
      screen.getByTestId("card-attachments-input"),
      new File([new ArrayBuffer(10)], "big.bin", {
        type: "application/octet-stream",
      }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByTestId("card-attachments-empty")).toBeInTheDocument();
  });

  it("downloads a file through the authenticated blob fetch", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAttachments").mockResolvedValue([attachment()]);
    const blob = new Blob(["spec"], { type: "application/pdf" });
    vi.spyOn(api, "fetchAttachment").mockResolvedValue(blob);
    renderSection();

    await screen.findByTestId("card-attachment-row");
    await user.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith("spec.pdf", blob),
    );
    expect(api.fetchAttachment).toHaveBeenCalledWith("att-1");
    expect(
      screen.queryByText("Could not download the file"),
    ).not.toBeInTheDocument();
  });

  it("reports a failed authenticated download", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAttachments").mockResolvedValue([attachment()]);
    vi.spyOn(api, "fetchAttachment").mockRejectedValue(new ApiError(500, null));
    renderSection();

    await screen.findByTestId("card-attachment-row");
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(
      await screen.findByText("Could not download the file"),
    ).toBeInTheDocument();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("maps a disallowed file type to its toast and does not add the row", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.spyOn(api, "uploadAttachment").mockRejectedValue(
      new ApiError(400, { message: "File type is not allowed", field: "file" }),
    );
    renderSection();

    await screen.findByTestId("card-attachments-empty");
    await user.upload(
      screen.getByTestId("card-attachments-input"),
      new File([new ArrayBuffer(10)], "malware.exe", {
        type: "application/x-msdownload",
      }),
    );
    expect(
      await screen.findByText("This file type is not allowed"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-attachments-empty")).toBeInTheDocument();
  });

  it("deletes behind the confirmation dialog", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAttachments").mockResolvedValue([attachment()]);
    vi.spyOn(api, "deleteAttachment").mockResolvedValue({ status: "ok" });
    renderSection();

    await screen.findByTestId("card-attachment-row");
    await user.click(screen.getByRole("button", { name: "Delete file" }));
    await user.click(
      await screen.findByRole("button", { name: "Delete file" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("card-attachment-row"),
      ).not.toBeInTheDocument(),
    );
    expect(api.deleteAttachment).toHaveBeenCalledWith("att-1");
  });

  it("lets the uploader remove a detached file with its own not-recoverable warning", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([attachment()]);
    vi.spyOn(api, "deleteAttachment").mockResolvedValue({ status: "ok" });
    renderSection();

    const group = await screen.findByTestId("card-detached-attachments");
    await user.click(group.querySelector("summary")!);
    expect(group).toHaveTextContent("spec.pdf");
    await user.click(
      screen.getByRole("button", { name: "Delete file spec.pdf" }),
    );
    expect(
      screen.getByText(/not offered in Recently deleted/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete file" }));
    await waitFor(() => expect(group).not.toBeInTheDocument());
    expect(api.deleteAttachment).toHaveBeenCalledWith("att-1");
  });

  it("restores a detached file to the description and lists it again", async () => {
    const user = userEvent.setup();
    const image = attachment({
      id: "att-img",
      fileName: "shot.png",
      mimeType: "image/png",
    });
    const onRestore = vi.fn(() => ({ ok: true as const }));
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([image]);
    vi.spyOn(api, "fetchAttachmentDerivative").mockResolvedValue(
      new Blob(["thumb"], { type: "image/jpeg" }),
    );
    renderSection({ onRestoreToDescription: onRestore });

    const group = await screen.findByTestId("card-detached-attachments");
    await user.click(group.querySelector("summary")!);
    await user.click(screen.getByTestId("card-attachment-restore"));

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(image));
    // The file moves out of the bin and its image renders in the live list.
    await waitFor(() =>
      expect(
        screen.queryByTestId("card-detached-attachments"),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByAltText("shot.png")).toBeInTheDocument();
    expect(
      screen.getByText("shot.png restored to the description"),
    ).toBeInTheDocument();
  });

  it("refreshes both lists when the bin row was restored or removed", async () => {
    const user = userEvent.setup();
    const file = attachment();
    const onRestore = vi.fn(() => ({ ok: true as const }));
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments)
      .mockResolvedValueOnce([file])
      .mockResolvedValueOnce([]);
    renderSection({ onRestoreToDescription: onRestore });

    const group = await screen.findByTestId("card-detached-attachments");
    await user.click(group.querySelector("summary")!);
    await user.click(screen.getByTestId("card-attachment-restore"));

    expect(
      await screen.findByText(/no longer in the removed list/),
    ).toBeInTheDocument();
    expect(onRestore).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("card-detached-attachments"),
    ).not.toBeInTheDocument();
    // Both lists were re-read through refreshNewest, not just the bin.
    expect(api.listAttachments).toHaveBeenCalledTimes(2);
    expect(api.listDetachedAttachments).toHaveBeenCalledTimes(3);
  });

  it("keeps detached files downloadable and reference-copyable for a VIEWER", async () => {
    const user = userEvent.setup();
    const file = attachment();
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([file]);
    renderSection({ readOnly: true });

    const group = await screen.findByTestId("card-detached-attachments");
    await user.click(group.querySelector("summary")!);
    expect(
      screen.getByText(/Download one or copy its attachment reference/),
    ).toBeInTheDocument();
    // Size and date distinguish same-named files; the type icon is present.
    expect(group).toHaveTextContent("2 KB");
    expect(
      group.querySelector('[data-testid="card-detached-attachment-row"] svg'),
    ).not.toBeNull();
    const download = screen.getByRole("button", {
      name: "Download spec.pdf",
    });
    const copy = screen.getByRole("button", {
      name: "Copy attachment reference for spec.pdf",
    });
    expect(download).toHaveClass("max-lg:h-11", "max-lg:w-11");
    expect(copy).toHaveClass("max-lg:h-11", "max-lg:w-11");
    expect(screen.getByTestId("card-detached-actions")).toHaveClass(
      "max-lg:w-full",
    );
    expect(screen.getByText("spec.pdf")).toHaveClass("line-clamp-2");
    expect(screen.getByText("spec.pdf")).not.toHaveClass("block");
    expect(group.querySelector(".sr-only")).toHaveTextContent("File");
    expect(group.querySelector("summary")).toHaveClass("min-h-11");
    // Read-only means no restore and no delete.
    expect(screen.queryByTestId("card-attachment-restore")).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete file/ })).toBeNull();
  });

  it("copies the authenticated attachment reference from the detached bin", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const file = attachment();
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([file]);
    renderSection();

    const group = await screen.findByTestId("card-detached-attachments");
    await user.click(group.querySelector("summary")!);
    await user.click(
      screen.getByRole("button", {
        name: "Copy attachment reference for spec.pdf",
      }),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/api/v1/attachments/att-1/content`,
      ),
    );
    expect(
      await screen.findByText(/Attachment reference copied/),
    ).toBeInTheDocument();
  });

  it("allows a restore at the 20-file cap without a new upload slot", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn(() => ({ ok: true as const }));
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([attachment()]);
    vi.spyOn(api, "attachmentTotal").mockReturnValue(20);
    renderSection({ onRestoreToDescription: onRestore });

    const group = await screen.findByTestId("card-detached-attachments");
    await user.click(group.querySelector("summary")!);
    // The file already counts toward the live total, so restoring its
    // reference does not exceed the cap; only new uploads are blocked.
    await waitFor(() =>
      expect(screen.getByTestId("card-attachments-upload")).toBeDisabled(),
    );
    expect(group).toHaveTextContent("does not use a new slot");
    await user.click(screen.getByTestId("card-attachment-restore"));
    await waitFor(() => expect(onRestore).toHaveBeenCalled());
  });

  it("keeps the bin row and reconciles both lists when the save fails", async () => {
    const user = userEvent.setup();
    const file = attachment();
    const onRestore = vi.fn(async () => ({
      ok: false as const,
      reason: "error" as const,
    }));
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([file]);
    renderSection({ onRestoreToDescription: onRestore });

    const group = await screen.findByTestId("card-detached-attachments");
    await user.click(group.querySelector("summary")!);
    await user.click(screen.getByTestId("card-attachment-restore"));

    expect(
      await screen.findByText("Could not restore the file to the description"),
    ).toBeInTheDocument();
    expect(group).toBeInTheDocument();
    expect(screen.getByText("spec.pdf")).toBeInTheDocument();
    // The failure refreshed the bin and the normal list from the server.
    expect(api.listAttachments).toHaveBeenCalledTimes(2);
    expect(api.listDetachedAttachments).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["conflict", "Resolve the description conflict before restoring a file"],
    [
      "limit",
      "The description would exceed its size limit — the file was not restored",
    ],
  ] as const)(
    "keeps the row when the restore is refused: %s",
    async (reason, copy) => {
      const user = userEvent.setup();
      const file = attachment();
      vi.spyOn(api, "listAttachments").mockResolvedValue([]);
      vi.mocked(api.listDetachedAttachments).mockResolvedValue([file]);
      renderSection({
        onRestoreToDescription: vi.fn(async () => ({
          ok: false as const,
          reason,
        })),
      });

      const group = await screen.findByTestId("card-detached-attachments");
      await user.click(group.querySelector("summary")!);
      await user.click(screen.getByTestId("card-attachment-restore"));
      expect(await screen.findByText(copy)).toBeInTheDocument();
      expect(group).toBeInTheDocument();
    },
  );

  it("does not duplicate a reference that is already in the description", async () => {
    const user = userEvent.setup();
    const file = attachment();
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([file]);
    renderSection({
      onRestoreToDescription: vi.fn(async () => ({
        ok: true as const,
        alreadyReferenced: true as const,
      })),
    });

    const group = await screen.findByTestId("card-detached-attachments");
    await user.click(group.querySelector("summary")!);
    await user.click(screen.getByTestId("card-attachment-restore"));

    expect(
      await screen.findByText("This file is already in the description"),
    ).toBeInTheDocument();
    expect(api.listAttachments).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("card-attachment-row")).toBeNull();
  });

  it("keeps the spinner busy and moves focus to the next restore action", async () => {
    const user = userEvent.setup();
    const first = attachment({ id: "att-1", fileName: "first.pdf" });
    const second = attachment({ id: "att-2", fileName: "second.pdf" });
    let resolveSave!: (outcome: { ok: true }) => void;
    const onRestore = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveSave = resolve;
        }),
    );
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([first, second]);
    renderSection({ onRestoreToDescription: onRestore });

    const group = await screen.findByTestId("card-detached-attachments");
    await user.click(group.querySelector("summary")!);
    const [firstRestore] = screen.getAllByTestId("card-attachment-restore");
    await user.click(firstRestore!);
    await waitFor(() =>
      expect(firstRestore).toHaveAttribute("aria-busy", "true"),
    );
    expect(firstRestore).toBeDisabled();

    resolveSave({ ok: true });
    await waitFor(() =>
      expect(screen.getAllByTestId("card-attachment-restore")).toHaveLength(1),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", {
          name: "Restore second.pdf to description",
        }),
      ),
    );
  });

  it("moves focus to the previous row when the second row is restored", async () => {
    const user = userEvent.setup();
    const first = attachment({ id: "att-1", fileName: "first.pdf" });
    const second = attachment({ id: "att-2", fileName: "second.pdf" });
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([first, second]);
    renderSection({
      onRestoreToDescription: vi.fn(() => ({ ok: true as const })),
    });

    const group = await screen.findByTestId("card-detached-attachments");
    await user.click(group.querySelector("summary")!);
    const restores = screen.getAllByTestId("card-attachment-restore");
    await user.click(restores[1]!);

    await waitFor(() =>
      expect(screen.getAllByTestId("card-attachment-restore")).toHaveLength(1),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", {
          name: "Restore first.pdf to description",
        }),
      ),
    );
  });

  it("keeps focus on the row when a restore is refused and the row stays", async () => {
    const user = userEvent.setup();
    const file = attachment();
    let resolveSave!: (outcome: { ok: false; reason: "conflict" }) => void;
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([file]);
    renderSection({
      onRestoreToDescription: vi.fn(
        () =>
          new Promise<{ ok: false; reason: "conflict" }>((resolve) => {
            resolveSave = resolve;
          }),
      ),
    });

    const group = await screen.findByTestId("card-detached-attachments");
    await user.click(group.querySelector("summary")!);
    const restore = screen.getByTestId("card-attachment-restore");
    await user.click(restore);
    await act(async () => {
      resolveSave({ ok: false, reason: "conflict" });
    });

    expect(
      await screen.findByText(
        "Resolve the description conflict before restoring a file",
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", {
          name: "Restore spec.pdf to description",
        }),
      ),
    );
  });

  it("does not steal focus moved away from the row during the restore", async () => {
    const user = userEvent.setup();
    let resolveSave!: (outcome: { ok: true }) => void;
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([attachment()]);
    renderSection({
      onRestoreToDescription: vi.fn(
        () =>
          new Promise<{ ok: true }>((resolve) => {
            resolveSave = resolve;
          }),
      ),
    });

    const group = await screen.findByTestId("card-detached-attachments");
    await user.click(group.querySelector("summary")!);
    await user.click(screen.getByTestId("card-attachment-restore"));
    const upload = screen.getByTestId("card-attachments-upload");
    upload.focus();
    await act(async () => {
      resolveSave({ ok: true });
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId("card-detached-attachments"),
      ).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(upload);
  });

  it("moves focus to the section after deleting the last detached row", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([attachment()]);
    vi.spyOn(api, "deleteAttachment").mockResolvedValue({ status: "ok" });
    renderSection();

    const group = await screen.findByTestId("card-detached-attachments");
    await user.click(group.querySelector("summary")!);
    await user.click(
      screen.getByRole("button", { name: "Delete file spec.pdf" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Delete file" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByTestId("card-detached-attachments"),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId("card-attachments-toggle"),
      ),
    );
  });

  it("has no axe violations with the detached bin open", async () => {
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([attachment()]);
    const { container } = renderSection();
    const group = await screen.findByTestId("card-detached-attachments");
    fireEvent.click(group.querySelector("summary")!);
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it("drops a stale answer when the card switches during the bin re-read", async () => {
    const user = userEvent.setup();
    const file = attachment();
    let resolveFresh!: (items: AttachmentDto[]) => void;
    const fresh = new Promise<AttachmentDto[]>((resolve) => {
      resolveFresh = resolve;
    });
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments)
      .mockResolvedValueOnce([file])
      .mockReturnValueOnce(fresh)
      .mockResolvedValue([]);
    const onRestore = vi.fn(() => ({ ok: true as const }));
    const { rerender } = renderSection({
      onRestoreToDescription: onRestore,
    });

    const group = await screen.findByTestId("card-detached-attachments");
    await user.click(group.querySelector("summary")!);
    await user.click(screen.getByTestId("card-attachment-restore"));

    const tree = (cardId: string) => (
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <CardAttachments
              cardId={cardId}
              boardId="b-1"
              onRestoreToDescription={onRestore}
            />
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    );
    rerender(tree("card-2"));
    await waitFor(() =>
      expect(api.listDetachedAttachments).toHaveBeenCalledWith("card-2"),
    );
    await act(async () => {
      resolveFresh([file]);
    });
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("counts inline attachments from the server total (L20)", async () => {
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([]);
    vi.spyOn(api, "attachmentTotal").mockReturnValue(20);
    renderSection();

    const upload = await screen.findByTestId("card-attachments-upload");
    await waitFor(() => expect(upload).toBeDisabled());
    expect(upload).toHaveTextContent("Up to 20 files per card");
  });

  it("maps the server's attachment cap to the cap message, not bad type (L20)", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([]);
    vi.spyOn(api, "attachmentTotal").mockReturnValue(0);
    vi.spyOn(api, "uploadAttachment").mockRejectedValue(
      new ApiError(400, {
        code: "attachment_limit",
        field: "file",
        message: "Card must hold at most 20 attachments",
      }),
    );
    renderSection();

    const input = await screen.findByTestId("card-attachments-input");
    await user.upload(
      input,
      new File(["pixels"], "valid.png", { type: "image/png" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Up to 20 files per card")).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("This file type is not allowed"),
    ).not.toBeInTheDocument();
  });
});
