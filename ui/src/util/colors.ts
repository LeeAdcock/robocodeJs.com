// Team colors map to pre-rendered tank sprites (ui/public/sprites/tank*_{blue,
// dark,sand,red,green}*.png), so the palette is limited to those five hues.
// They are ordered most-distinguishable first: an arena's Nth app takes
// colors[N], so the common small arenas only ever draw the hues that stay
// separable under red-green color blindness (blue by hue, dark by lightness,
// sand as a warm light) before falling back to the red/green pair a color-blind
// viewer can confuse. The per-bot numeric id tag (getBotId in arenaBot.tsx) is
// the non-color differentiator that disambiguates the rest, including the
// wrap-around repeat past five apps.
const colors = [
  'blue',
  'dark',
  'sand',
  'red',
  'green',
  'blue',
  'dark',
  'sand',
  'red',
  'green',
];

export { colors };
