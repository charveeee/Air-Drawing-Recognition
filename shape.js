/**
 * shape3d.js
 *
 * JS port of shape3d.py: minimal 3D wireframe math (rotation +
 * perspective projection) plus three primitive builders (cube,
 * sphere, pyramid). Pure math, no 3D library.
 */

const FOCAL_LENGTH = 340.0;
const CAMERA_DISTANCE = 520.0;


function rotatePoint([x, y, z], rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);


  let y1 = y * cx - z * sx;
  let z1 = y * sx + z * cx;
  let x1 = x;


  let x2 = x1 * cy + z1 * sy;
  let z2 = -x1 * sy + z1 * cy;
  let y2 = y1;


  let x3 = x2 * cz - y2 * sz;
  let y3 = x2 * sz + y2 * cz;
  let z3 = z2;

  return [x3, y3, z3];
}



function makeCube() {
  const h = 1.0;
  const vertices = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  return { vertices, edges };
}

function makePyramid() {
  const h = 1.0;
  const vertices = [
    [-h, h, -h], [h, h, -h], [h, h, h], [-h, h, h],
    [0, -h, 0],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [0, 4], [1, 4], [2, 4], [3, 4],
  ];
  return { vertices, edges };
}

function makeSphere(stacks = 8, slices = 12) {
  const vertices = [];
  const indexGrid = {};
  for (let i = 0; i <= stacks; i++) {
    const phi = (Math.PI * i) / stacks;
    for (let j = 0; j < slices; j++) {
      const theta = (2 * Math.PI * j) / slices;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      indexGrid[`${i},${j}`] = vertices.length;
      vertices.push([x, y, z]);
    }
  }

  const edges = [];
  for (let i = 0; i <= stacks; i++) {
    for (let j = 0; j < slices; j++) {
      edges.push([indexGrid[`${i},${j}`], indexGrid[`${i},${(j + 1) % slices}`]]);
      if (i < stacks) {
        edges.push([indexGrid[`${i},${j}`], indexGrid[`${i + 1},${j}`]]);
      }
    }
  }

  return { vertices, edges };
}

const PRIMITIVE_BUILDERS = {
  square: makeCube,
  circle: makeSphere,
  triangle: makePyramid,
};



/**
 * Rotates + scales object-space vertices and perspective-projects them
 * onto screen coordinates centered at `anchor`.
 * Returns { points2d: [{x,y}, ...], camZ: [number, ...] } -- camZ is
 * kept for depth-based shading (smaller = closer to camera).
 */
function project(vertices, [rx, ry, rz], anchor, scale,
                  focal = FOCAL_LENGTH, camDist = CAMERA_DISTANCE) {
  const points2d = [];
  const camZ = [];

  for (const v of vertices) {
    const [x, y, z] = rotatePoint(v, rx, ry, rz);
    const sx = x * scale, sy = y * scale, sz = z * scale;
    const cz = Math.max(sz + camDist, 1.0);
    points2d.push({
      x: anchor.x + (sx * focal) / cz,
      y: anchor.y + (sy * focal) / cz,
    });
    camZ.push(cz);
  }

  return { points2d, camZ };
}

/**
 * depthT in [0, 1], 0 = closest/brightest, 1 = farthest/dimmest.
 * baseColor is [r, g, b]. Returns a dimmed [r, g, b].
 */
function shadeColor(baseColor, depthT) {
  const factor = 1.0 - 0.65 * depthT;
  return baseColor.map((c) => Math.round(c * factor));
}
