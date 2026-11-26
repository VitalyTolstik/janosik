import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Extra classes for the built-in close button (e.g. a larger hit area). */
    closeClassName?: string;
    /** Render the close button in the caller's own header instead. */
    hideClose?: boolean;
    /** Surface-specific scrim (the Agent Control tablet sheet). */
    overlayClassName?: string;
  }
>(
  (
    {
      className,
      children,
      closeClassName,
      hideClose = false,
      overlayClassName,
      onOpenAutoFocus,
      onCloseAutoFocus,
      ...props
    },
    ref,
  ) => {
    const { t } = useI18n();
    /**
     * A state-driven dialog has no Radix trigger to remember. Capture the
     * element focused before the portal mounts and return focus there on
     * close unless the caller's `onCloseAutoFocus` handles it.
     */
    const opener = React.useRef<HTMLElement | null>(null);
    return (
      <DialogPortal>
        <DialogOverlay className={overlayClassName} />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            // Centered via inset-0 + margin auto, NOT transform: a transform
            // turns the dialog into the containing block for position:fixed
            // descendants, which silently misplaces library UI that anchors
            // to viewport coordinates (e.g. mdxeditor's link preview anchor).
            // max-h keeps tall content on screen — dialogs that grow (e.g. card
            // details with many checklists) scroll their body instead of pushing
            // the footer out of the viewport.
            // TASK-177.18: keep the body clear of the iOS status bar, home
            // indicator and landscape notch. `max()` falls back to the normal
            // p-6 token when `env()` resolves to 0 (all desktop browsers), so
            // no desktop padding doubles.
            "fixed inset-0 z-50 m-auto flex h-fit max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg flex-col gap-4 border bg-popover p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pr-[max(1.5rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-xl",
            className,
          )}
          {...props}
          onOpenAutoFocus={(event) => {
            // Runs before Radix focuses its own content/trigger, so the
            // activeElement here is still the control that opened us.
            if (
              opener.current === null &&
              document.activeElement instanceof HTMLElement &&
              document.activeElement !== document.body
            ) {
              opener.current = document.activeElement;
            }
            onOpenAutoFocus?.(event);
          }}
          onCloseAutoFocus={(event) => {
            const target = opener.current;
            opener.current = null;
            onCloseAutoFocus?.(event);
            if (event.defaultPrevented) return;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
          // Radix marks the Popover's DismissableLayer as highest only in a
          // passive effect. An immediate Escape right after opening a
          // portalled combobox listbox can race that update and close the
          // whole Dialog together with the listbox. Keep the shield narrow:
          // only a portalled listbox owns Escape; inline comboboxes such as
          // the admin command palette still close their Dialog.
          onEscapeKeyDown={(event) => {
            props.onEscapeKeyDown?.(event);
            if (
              !event.defaultPrevented &&
              document.querySelector(
                '[data-radix-popper-content-wrapper] [role="listbox"][data-state="open"]',
              ) !== null
            ) {
              event.preventDefault();
            }
          }}
        >
          {children}
          {hideClose ? null : (
            <DialogPrimitive.Close
              data-testid="dialog-close"
              className={cn(
                "absolute right-[max(0.5rem,env(safe-area-inset-right))] top-[max(0.5rem,env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring disabled:pointer-events-none data-[state=open]:bg-hover md:right-[max(1rem,env(safe-area-inset-right))] md:top-[max(1rem,env(safe-area-inset-top))] lg:h-8 lg:w-8",
                closeClassName,
              )}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">{t("common.close")}</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  },
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 pr-12 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-[7px] sm:flex-row sm:justify-end max-lg:[&>*]:min-h-11",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-ui-title font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-ui-body text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
