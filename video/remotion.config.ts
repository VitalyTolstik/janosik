import { Config } from "@remotion/cli/config";

// Stills are captured as JPEG posters (the `<video poster>` fallback on the
// site) and clips overwrite their output on every render.
Config.setVideoImageFormat("jpeg");
Config.setStillImageFormat("jpeg");
Config.setOverwriteOutput(true);
