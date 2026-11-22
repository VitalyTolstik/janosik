import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    await user.click(screen.getByRole("button", { name: "Delete file" }));
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

  it("refuses to restore a file that was deleted meanwhile", async () => {
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
      await screen.findByText(
        "This file was deleted and can no longer be restored",
      ),
    ).toBeInTheDocument();
    expect(onRestore).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("card-detached-attachments"),
    ).not.toBeInTheDocument();
  });

  it("keeps detached files downloadable and linkable for a VIEWER", async () => {
    const user = userEvent.setup();
    const file = attachment();
    vi.spyOn(api, "listAttachments").mockResolvedValue([]);
    vi.mocked(api.listDetachedAttachments).mockResolvedValue([file]);
    renderSection({ readOnly: true });

    const group = await screen.findByTestId("card-detached-attachments");
    await user.click(group.querySelector("summary")!);
    expect(
      screen.getByRole("button", { name: "Download" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy file link" }),
    ).toBeInTheDocument();
    // Read-only means no restore and no delete.
    expect(screen.queryByTestId("card-attachment-restore")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete file" })).toBeNull();
  });

  it("copies the canonical file URL from the detached bin", async () => {
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
    await user.click(screen.getByRole("button", { name: "Copy file link" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/api/v1/attachments/att-1/content`,
      ),
    );
    expect(await screen.findByText("File link copied")).toBeInTheDocument();
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
    await user.click(screen.getByTestId("card-attachment-restore"));
    await waitFor(() => expect(onRestore).toHaveBeenCalled());
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
