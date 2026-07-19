import React from 'react';

interface TerrainProps {
  // The two terrain layers (below-bots, above-bots) from `generateTerrain`.
  // Passed in — rather than generated here — so the random layout is owned by
  // the always-mounted ArenaSvg and survives the debug-view toggle, which
  // unmounts and remounts this component. See ArenaSvg for why.
  terrain: React.ReactNode[][];
  children: React.ReactNode;
}

interface TerrainLayerProps {
  tiles: React.ReactNode[];
}
const TerrainLayer = React.memo((props: TerrainLayerProps) => (
  <g>
    {props.tiles.map((column, index) => (
      <g key={index}>{column}</g>
    ))}
  </g>
));

const TerrainSvg = (props: TerrainProps) => {
  return (
    <>
      <TerrainLayer tiles={props.terrain[0]} />
      <g>{props.children}</g>
      <TerrainLayer tiles={props.terrain[1]} />
    </>
  );
};

export default TerrainSvg;
