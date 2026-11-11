/*
 * Bot animation adapted from lucide-animated: https://github.com/pqoqubbw/icons
 * MIT License — Copyright (c) 2024-2026 pqoqubbw
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import { motion, useAnimation, useReducedMotion } from "motion/react";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

interface BotIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const eyeVariants = {
  normal: { y1: 13, y2: 15 },
  animate: {
    y1: [13, 14, 13],
    y2: [15, 14, 15],
    transition: { duration: 0.5, ease: "easeInOut" as const, delay: 0.2 },
  },
};

export function BotIcon({
  size = 28,
  className,
  onMouseEnter,
  onMouseLeave,
  ...props
}: BotIconProps) {
  const controls = useAnimation();
  const reduceMotion = useReducedMotion();

  return (
    <div
      className={cn(className)}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        if (!reduceMotion) void controls.start("animate");
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        void controls.start("normal");
      }}
      {...props}
    >
      <svg
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M12 8V4H8" />
        <rect height="12" rx="2" width="16" x="4" y="8" />
        <path d="M2 14h2" />
        <path d="M20 14h2" />
        <motion.line
          animate={controls}
          initial="normal"
          variants={eyeVariants}
          x1={15}
          x2={15}
        />
        <motion.line
          animate={controls}
          initial="normal"
          variants={eyeVariants}
          x1={9}
          x2={9}
        />
      </svg>
    </div>
  );
}
