import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AttachmentDto } from "@janosik/shared";

import { ApiError } from "@/api/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ToastProvider } from "@/components/Toast";
import { CardAttachments } from "./CardAttachments";

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  isApiEnabled: () => true,
}));

import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";

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
  beforeEach(() => {
    vi.clearAllMocks();
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
});
