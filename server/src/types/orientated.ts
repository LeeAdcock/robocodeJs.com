export interface Orientated {
  orientation: number;
  orientationTarget: number;
  orientationVelocity: number;

  getOrientation: () => number;
  setOrientation: (angle: number) => Promise<void>;
  turn: (angle: number) => Promise<void>;
  isTurning: () => boolean;
}
