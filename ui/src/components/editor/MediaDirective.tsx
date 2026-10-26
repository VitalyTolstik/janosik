import { useEffect, useState } from "react";
import type {
  DirectiveDescriptor,
  DirectiveEditorProps,
} from "@mdxeditor/editor";

import {
  attachmentImagePreviewHandler,
  attachmentPosterPreviewHandler,
} from "@/utils/embedAttachments";

/**
 * Embedded media directives (TASK-48): `::video{src="…"}` and `::audio{src="…"}`
 * — pasted media files embed as real players instead of download links.
 * Directives are the MDXEditor extension point for non-image blocks (the
 * image plugin hard-renders `<img>`); `mdast-util-directive` round-trips the
 * syntax through every edit, and the blob is resolved through the same
 * authenticated preview cache as embedded images.
 *
 * Note: registering the directives plugin makes stray `:::name` container
 * syntax parse as directives — without a descriptor those nodes are skipped
 * on import. This app's markdown never contains container directives, and
 * the video/audio descriptors cover everything the paste flow produces.
 */

function MediaDirectivePlayer({
  mdastNode,
  kind,
}: {
  mdastNode: { attributes?: Record<string, unknown> | null };
  kind: "video" | "audio";
}) {
  const src =
    typeof mdastNode.attributes?.src === "string"
      ? mdastNode.attributes.src
      : "";
  const [url, setUrl] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | null>(null);

  useEffect(() => {
    if (!src) return;
    let alive = true;
    void attachmentImagePreviewHandler(src)
      .then((resolved) => {
        if (alive) setUrl(resolved);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [src]);

  useEffect(() => {
    if (!src || kind !== "video") return;
    let alive = true;
    let created: string | null = null;
    // TASK-70: the poster frame, if the server generated one.
    void attachmentPosterPreviewHandler(src)
      .then((resolved) => {
        if (!alive || resolved === null) return;
        created = resolved;
        setPoster(resolved);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [src, kind]);

  if (url === null) {
    return (
      <div
        className="janosik-md-media-placeholder"
        data-testid={`${kind}-directive-loading`}
      />
    );
  }
  if (kind === "video") {
    return (
      <video
        className="janosik-md-video"
        controls
        preload="metadata"
        src={url}
        poster={poster ?? undefined}
      />
    );
  }
  return (
    <audio className="janosik-md-audio" controls preload="metadata" src={url} />
  );
}

function VideoDirectiveEditor(props: DirectiveEditorProps) {
  return <MediaDirectivePlayer mdastNode={props.mdastNode} kind="video" />;
}

function AudioDirectiveEditor(props: DirectiveEditorProps) {
  return <MediaDirectivePlayer mdastNode={props.mdastNode} kind="audio" />;
}

/** `::video{src="/api/v1/attachments/<id>/content"}` */
export const videoDirectiveDescriptor: DirectiveDescriptor = {
  name: "video",
  testNode: (node) => node.name === "video",
  attributes: ["src"],
  hasChildren: false,
  type: "leafDirective",
  Editor: VideoDirectiveEditor,
};

/** `::audio{src="/api/v1/attachments/<id>/content"}` */
export const audioDirectiveDescriptor: DirectiveDescriptor = {
  name: "audio",
  testNode: (node) => node.name === "audio",
  attributes: ["src"],
  hasChildren: false,
  type: "leafDirective",
  Editor: AudioDirectiveEditor,
};
