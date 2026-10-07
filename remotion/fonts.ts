// Real display fonts per design pack, loaded via @remotion/google-fonts.
// Loading at module level makes them available in both the in-app Player
// preview and the render worker.

import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadPlayfair } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as loadNunito } from "@remotion/google-fonts/Nunito";
import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";

const anton = loadAnton(); // 400 only — a true condensed display face
const spaceGrotesk = loadSpaceGrotesk("normal", { weights: ["500", "700"] });
const playfair = loadPlayfair("normal", { weights: ["700", "800"] });
const nunito = loadNunito("normal", { weights: ["600", "800"] });
const jetbrains = loadJetBrainsMono("normal", { weights: ["700", "800"] });

export const FONTS = {
  anton: anton.fontFamily,
  spaceGrotesk: spaceGrotesk.fontFamily,
  playfair: playfair.fontFamily,
  nunito: nunito.fontFamily,
  jetbrainsMono: jetbrains.fontFamily,
};
