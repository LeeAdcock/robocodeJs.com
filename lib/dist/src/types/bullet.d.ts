import Point from './point';
export default class Bullet extends Point {
    id: number;
    origin: Point;
    speed: number;
    orientation: number;
    exploded: boolean;
    callback: any;
}
