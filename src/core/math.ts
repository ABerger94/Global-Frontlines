import * as THREE from 'three';

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const deg2rad = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;

/** Convert latitude/longitude (degrees) to a unit vector on a Y-up sphere. */
export function latLonToVec3(lat: number, lon: number, radius = 1, out = new THREE.Vector3()): THREE.Vector3 {
  const phi = deg2rad(90 - lat);
  const theta = deg2rad(lon + 180);
  out.set(-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta));
  return out;
}

export function vec3ToLatLon(v: THREE.Vector3): { lat: number; lon: number } {
  const n = v.clone().normalize();
  const lat = 90 - rad2deg(Math.acos(clamp(n.y, -1, 1)));
  const lon = rad2deg(Math.atan2(n.z, -n.x)) - 180;
  return { lat, lon: ((lon + 540) % 360) - 180 };
}

/** Great-circle distance between two unit vectors (radians). */
export function angularDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.acos(clamp(a.dot(b), -1, 1));
}

export function fmtNum(n: number): string {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return Math.round(n).toString();
}

export function pad2(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}
