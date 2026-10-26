// Side-effect import: registers the brand font before any frame renders.
import "./lib/fonts";

import { Composition, Folder } from "remotion";

import { Board } from "./compositions/Board";
import { Cards } from "./compositions/Cards";
import { Hero } from "./compositions/Hero";
import { Realtime } from "./compositions/Realtime";
import { Selfhost } from "./compositions/Selfhost";
import { Sharing } from "./compositions/Sharing";
import { FPS, HEIGHT, WIDTH } from "./lib/layout";

// One authored node per clip so each is independently editable in the Studio.
// `defaultProps.theme` flips the brand palette; the site renders the light one.
export const RemotionRoot = () => (
  <Folder name="janosik">
    <Composition
      id="Hero"
      component={Hero}
      durationInFrames={210}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ theme: "light" }}
    />
    <Composition
      id="Board"
      component={Board}
      durationInFrames={240}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ theme: "light" }}
    />
    <Composition
      id="Realtime"
      component={Realtime}
      durationInFrames={210}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ theme: "light" }}
    />
    <Composition
      id="Cards"
      component={Cards}
      durationInFrames={240}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ theme: "light" }}
    />
    <Composition
      id="Sharing"
      component={Sharing}
      durationInFrames={210}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ theme: "light" }}
    />
    <Composition
      id="Selfhost"
      component={Selfhost}
      durationInFrames={240}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ theme: "light" }}
    />
  </Folder>
);
