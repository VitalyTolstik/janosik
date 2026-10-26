import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// Space Grotesk is the single brand face. `loadFont` internally blocks the
// render (delayRender) until each face is ready, so calling it at module scope
// is safe — the first frame already has the real font, no FOUT.
for (const weight of [400, 500, 700] as const) {
  void loadFont({
    family: "Space Grotesk",
    url: staticFile(`fonts/space-grotesk-latin-${weight}-normal.woff2`),
    weight: String(weight),
    display: "block",
  });
}
