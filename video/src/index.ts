// Entry point. Brand CSS is imported first so every composition renders on the
// exact tokens the app and the marketing site use — no hardcoded colours.
import "../../brand/src/tokens.css";
import "../../brand/src/site-tokens.css";
import "./styles/theme.css";

import { registerRoot } from "remotion";

import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
