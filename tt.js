import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

const container = document.getElementById('viewer');

// 렌더러/씬/카메라
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3f6fa);

const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 5000);
camera.position.set(180, 240, 300);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 60, 0);
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 0.7));

// ===== 데이터 =====
const baseHeight = 600;
let rawData = [
  [471, 110], [833, 110], [833, 154], [515, 154], [515, 213], [739, 213], [739, 185], [913, 185],
  [955, 90], [997, 185], [1012, 185], [1012, 348], [818, 348], [818, 353], [815, 365], [811, 378],
  [805, 389], [797, 400], [787, 410], [777, 419], [765, 426], [753, 432], [739, 436], [725, 439],
  [711, 439], [697, 439], [683, 436], [670, 432], [658, 426], [646, 419], [635, 410], [626, 400],
  [618, 389], [612, 378], [607, 365], [605, 353], [604, 340], [605, 327], [607, 314], [612, 301],
  [618, 290], [626, 279], [635, 269], [646, 260], [650, 258], [471, 258]
];

const buildingGroup = new THREE.Group();
scene.add(buildingGroup);

const WALLS_GROUP_NAME = 'wallsGroup';

// ===== 모드 & UI =====
let mode = 'img';
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const PREV_PAGE_URL = 'building_draw.html';
const NEXT_PAGE_URL = 'floor_add.html';

function setMode(next) {
  mode = next;
  document.querySelector('.img-mode').style.display = (mode === 'img') ? 'inline-block' : 'none';
  document.querySelector('.floor-mode').style.display = (mode === 'floor') ? 'inline-block' : 'none';
  document.getElementById('btnNext').style.display = (mode === 'img') ? 'inline-block' : 'none';
  document.getElementById('btnSaveLevels').style.display = (mode === 'floor') ? 'inline-block' : 'none';
}
btnPrev.addEventListener('click', () => { if (mode === 'img') window.location.href = PREV_PAGE_URL; else setMode('img'); });
btnNext.addEventListener('click', () => { if (mode === 'img') setMode('floor'); else window.location.href = NEXT_PAGE_URL; });

// ===== 상태값 =====
let buildingBox = new THREE.Box3();
let baseY = 0, roofY = 0;
let userBoundaries = [];
let boundaryLinesGroup = null;
let footprintTemplate = null;
let floorWorldY = 0;

function updateBuildingBox() {
  buildingBox.setFromObject(buildingGroup);
  baseY = buildingBox.min.y;
  roofY = buildingBox.max.y;
}

// ====== 코너/구간/리본 유틸 ======

// 직선에서만 코너로 잡고, 곡선은 코너로 보지 않음
function findCornersStraightOnly(pts, angleMarginDeg = 25) {
  const N = pts.length;
  const corners = [0];
  for (let i = 0; i < N; i++) {
    const im1 = (i - 1 + N) % N, ip1 = (i + 1) % N;
    const b = pts[i], a = pts[im1], c = pts[ip1];
    const v1 = new THREE.Vector2(a.x - b.x, a.y - b.y).normalize();
    const v2 = new THREE.Vector2(c.x - b.x, c.y - b.y).normalize();
    const dot = THREE.MathUtils.clamp(v1.dot(v2), -1, 1);
    const deg = THREE.MathUtils.radToDeg(Math.acos(dot)); // 0~180

    // 180°에 가까우면 직선 → 코너 아님
    // 꺾임이 큰 곳만(= 180 - margin 보다 작으면) 코너로 간주
    if (deg < (180 - angleMarginDeg)) corners.push(i);
  }
  return [...new Set(corners)].sort((a, b) => a - b);
}

function sharpestCornerIndex(pts) {
  const N = pts.length;
  let best = 0, bestDeg = 180;
  for (let i = 0; i < N; i++) {
    const im1 = (i - 1 + N) % N, ip1 = (i + 1) % N;
    const b = pts[i], a = pts[im1], c = pts[ip1];
    const v1 = new THREE.Vector2(a.x - b.x, a.y - b.y).normalize();
    const v2 = new THREE.Vector2(c.x - b.x, c.y - b.y).normalize();
    const deg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(v1.dot(v2), -1, 1)));
    if (deg < bestDeg) { bestDeg = deg; best = i; }
  }
  return best;
}


// 코너가 0~1개면 전체 외곽 1구간, 그 외엔 인접 코너쌍으로 구간
function toFacadeRanges(N, cornerIdxs) {
  if (cornerIdxs.length <= 1) return [[0, 0]]; // e==s → 전체 루프 처리
  const ranges = [];
  for (let i = 0; i < cornerIdxs.length; i++) {
    const s = cornerIdxs[i];
    const e = cornerIdxs[(i + 1) % cornerIdxs.length];
    ranges.push([s, e]); // 끝점 포함은 buildRibbonFromRange에서 처리
  }
  return ranges;
}

// 구간 → 리본 BufferGeometry 생성(끝점 포함, e==s면 전체 외곽)
function buildRibbonFromRange(pts, cx, cz, H, iStart, iEnd, color = 0x9bb0c1) {
  const N = pts.length;
  if (N < 2) return null;

  // 구간 시퀀스 만들기
  const seq = [];
  if (iEnd === iStart) {
    for (let k = 0; k < N; k++) seq.push((iStart + k) % N);
    seq.push(iStart); // 시작점 다시 포함(닫힘)
  } else {
    let i = iStart;
    seq.push(i);
    while (i !== iEnd) { i = (i + 1) % N; seq.push(i); }
  }
  if (seq.length < 2) return null;

  // 링(바닥/천장)
  const ringBottom = [], ringTop = [];
  for (const idx of seq) {
    const v = pts[idx];
    const x = v.x - cx, z = v.y - cz;
    ringBottom.push(new THREE.Vector3(x, 0, z));
    ringTop.push(new THREE.Vector3(x, H, z));
  }

  // 누적 길이(호길이)
  const cum = [0];
  for (let i = 0; i < ringBottom.length - 1; i++) {
    cum.push(cum[i] + ringBottom[i].distanceTo(ringBottom[i + 1]));
  }
  const totalLen = cum[cum.length - 1] || 1;

  // 버퍼
  const L = ringBottom.length;
  const positions = new Float32Array(L * 2 * 3);
  const uvs = new Float32Array(L * 2 * 2);
  const indices = [];

  for (let i = 0; i < L; i++) {
    const iBot = i * 2, iTop = i * 2 + 1;
    const pB = ringBottom[i], pT = ringTop[i];
    positions.set([pB.x, pB.y, pB.z], iBot * 3);
    positions.set([pT.x, pT.y, pT.z], iTop * 3);

    // ★ 핵심: 균등 분포 (시작 0, 끝 1)
    const u = (L === 1) ? 0 : (i / (L - 1));
    uvs.set([u, 0], iBot * 2);
    uvs.set([u, 1], iTop * 2);
  }


  for (let i = 0; i < L - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    indices.push(a, b, d, a, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);

  const mat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.totalLen = totalLen;
  return mesh;
}

// --------------------------------------------


// === 구간 길이 계산(시계방향 링 길이) ===
function lengthOfRange(pts, s, e) {
  const N = pts.length;
  let i = s, len = 0;
  while (i !== e) {
    const j = (i + 1) % N;
    const a = pts[i], b = pts[j];
    len += Math.hypot(a.x - b.x, a.y - b.y);
    i = j;
  }
  return len;
}

// === 짧은 파사드 병합 ===
// ranges: [[startIdx, endIdx], ...] (시계방향 연결 순서)
function mergeShortRanges(pts, ranges, minLen) {
  if (!ranges || ranges.length <= 1) return ranges.slice();

  const merged = [];
  let curS = ranges[0][0];
  let curE = ranges[0][1];

  for (let k = 1; k < ranges.length; k++) {
    const [, e] = ranges[k];
    const testLen = lengthOfRange(pts, curS, e);
    if (testLen < minLen) {
      // 더 붙여서 한 덩어리로 유지
      curE = e;
    } else {
      merged.push([curS, curE]);
      curS = ranges[k][0];
      curE = e;
    }
  }
  merged.push([curS, curE]);

  // 마지막 덩어리와 첫 덩어리가 둘 다 짧다면 서로 합침(원형 경계 보정)
  if (merged.length > 1) {
    const first = merged[0];
    const last = merged[merged.length - 1];
    const firstLen = lengthOfRange(pts, first[0], first[1]);
    const lastLen = lengthOfRange(pts, last[0], last[1]);
    if (firstLen < minLen || lastLen < minLen) {
      merged[0] = [last[0], first[1]];
      merged.pop();
    }
  }
  return merged;
}

function angleAtIndex(pts, i) {
  const N = pts.length;
  const im1 = (i - 1 + N) % N;
  const ip1 = (i + 1) % N;
  const b = pts[i], a = pts[im1], c = pts[ip1];
  const v1 = new THREE.Vector2(a.x - b.x, a.y - b.y).normalize();
  const v2 = new THREE.Vector2(c.x - b.x, c.y - b.y).normalize();
  const dot = THREE.MathUtils.clamp(v1.dot(v2), -1, 1);
  return THREE.MathUtils.radToDeg(Math.acos(dot)); // 0°(직선) ~ 180°
}



function mergeFirstLastIfSmooth(pts, ranges, smoothAngleDeg = 15) {
  if (!ranges || ranges.length < 2) return ranges;

  const last = ranges[ranges.length - 1];
  const first = ranges[0];

  // last의 끝점 == first의 시작점에서의 각도(직선이면 ~180°)
  const junctionIdx = last[1];
  const deg = angleAtIndex(pts, junctionIdx);

  // ✅ 직선에 가깝다면(= 180°에 근접) 병합
  // 예: smoothAngleDeg=15 → 165° 이상이면 병합
  if (deg > (180 - smoothAngleDeg)) {
    const merged = ranges.slice(1); // 첫 요소를 덮어쓸 예정
    merged[0] = [last[0], first[1]];
    return merged;
  }

  return ranges;
}

function rotateArray(arr, startIdx) {
  const N = arr.length, out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = arr[(startIdx + i) % N];
  return out;
}




// ====== 메인 빌드 ======
// --- 수정본: buildFromPolygon ---
function buildFromPolygon(rawData, baseHeight, floors) {
  if (!rawData || rawData.length < 3) return;

  const polygonPx = rawData.map(([x, y]) => ({ x, y }));
  const PX_TO_UNIT = 0.3;
  const UNIT_PER_FLOOR = 15;
  const H = floors * UNIT_PER_FLOOR;

  // px→3D(XZ), y반전
  const to3D = (p) => new THREE.Vector2(p.x * PX_TO_UNIT, (baseHeight - p.y) * PX_TO_UNIT);

  // 중심 보정 기준
  let pts = polygonPx.map(to3D);
  const startAt = sharpestCornerIndex(pts);
  pts = rotateArray(pts, startAt);

  const minX = Math.min(...pts.map(v => v.x));
  const maxX = Math.max(...pts.map(v => v.x));
  const minZ = Math.min(...pts.map(v => v.y));
  const maxZ = Math.max(...pts.map(v => v.y));
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  // 초기화
  buildingGroup.clear();
  const wallsGroup = new THREE.Group();
  wallsGroup.name = WALLS_GROUP_NAME;
  buildingGroup.add(wallsGroup);
  buildingGroup.position.y = -20;

  // --- 파사드별 리본 생성 ---
  const cornerIdxs = findCornersStraightOnly(pts, 25);  // 20~30 사이로 튜닝
  let ranges = toFacadeRanges(pts.length, cornerIdxs);
  ranges = mergeShortRanges(pts, ranges, 50.0); // 짧은 구간 강제 병합 (스케일에 맞춰 크게)
  ranges = mergeFirstLastIfSmooth(pts, ranges, 15);

  console.log('facade ranges count =', ranges.length, ranges);
  console.log('ranges after rotate =', ranges.length, ranges);

  // 🔴 중요: 너무 짧은 파사드는 이웃과 병합(예: 3m 미만)
  const MIN_FACADE_LEN = 3.0; // 필요시 2~5 사이로 조정

  let facadeNo = 0;
  for (const [s, e] of ranges) {
    const ribbon = buildRibbonFromRange(pts, cx, cz, H, s, e);
    if (!ribbon) continue;

    ribbon.material.color.setHSL((facadeNo % 12) / 12, 0.5, 0.5);

    ribbon.name = `facade-${facadeNo++}`;
    ribbon.castShadow = true;
    wallsGroup.add(ribbon);
  }

  // --- 바닥/지붕 ---
  const capShape = new THREE.Shape();
  pts.forEach((v, i) => {
    const x = v.x - cx, z = v.y - cz;
    if (i === 0) capShape.moveTo(x, z); else capShape.lineTo(x, z);
  });
  capShape.closePath();

  const capGeo = new THREE.ShapeGeometry(capShape);
  capGeo.rotateX(-Math.PI / 2);
  const capMat = new THREE.MeshStandardMaterial({ color: 0x9bb0c1, side: THREE.DoubleSide });

  const floor = new THREE.Mesh(capGeo.clone(), capMat.clone());
  floor.name = 'floorCap'; floor.position.y = 0; floor.rotateX(Math.PI);

  const roof = new THREE.Mesh(capGeo.clone(), capMat.clone());
  roof.name = 'roofCap'; roof.position.y = H; roof.rotateX(Math.PI);

  wallsGroup.add(floor, roof);

  // 바닥 윤곽선 템플릿(층 경계용) 갱신
  if (footprintTemplate) { footprintTemplate.geometry?.dispose?.(); footprintTemplate = null; }
  const edgesGeo = new THREE.EdgesGeometry(floor.geometry, 1);
  edgesGeo.rotateX(-Math.PI / 2);
  floor.updateWorldMatrix(true, true);
  const tmpLine = new THREE.LineSegments(edgesGeo);
  tmpLine.applyMatrix4(floor.matrixWorld);
  const wp = new THREE.Vector3();
  floor.getWorldPosition(wp);
  floorWorldY = wp.y;
  footprintTemplate = tmpLine;

  updateBuildingBox();
  userBoundaries = userBoundaries.filter(y => y > baseY && y < roofY);
  drawBoundaryLines();
}


// ===== UI/생성 =====
const floorsInput = document.getElementById('floors');
const buildBtn = document.getElementById('createBuilding');
function createBuilding() {
  const floors = Math.max(1, Number(floorsInput.value || 1));
  buildFromPolygon(rawData, baseHeight, floors);
}
createBuilding();
buildBtn.addEventListener('click', createBuilding);

// ===== 클릭(텍스처) =====
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const fileInput = document.getElementById('fileInput');
let pendingWall = null;

function raycast(evt, targets) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(targets, true);
  return hits[0] || null;
}
function getWallsChildren() {
  const g = buildingGroup.getObjectByName(WALLS_GROUP_NAME);
  if (!g) return [];
  // 파사드 리본만 반환
  return g.children.filter(o => o.name?.startsWith('facade-'));
}
function getWallsOnly() { return getWallsChildren(); }

renderer.domElement.addEventListener('dblclick', (e) => {
  if (mode !== 'img') return;
  const hit = raycast(e, getWallsChildren());
  if (!hit) return;
  pendingWall = hit.object;
  fileInput.value = '';
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  if (mode !== 'img') return;
  const f = e.target.files?.[0];
  if (!f || !pendingWall) return;

  const url = URL.createObjectURL(f);
  new THREE.TextureLoader().load(url, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 1;

    tex.repeat.set(1, 1);
    tex.offset.set(0, 0);
    tex.needsUpdate = true;

    pendingWall.material = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.DoubleSide, color: 0xffffff, transparent: false, opacity: 1.0
    });
    pendingWall = null;
  });
});

// ===== 층/경계 =====
const MIN_GAP = 0.5;
const SNAP = 0.1;
const STORAGE_KEY = 'levels:B001';

function snap(v) { return Math.round(v / SNAP) * SNAP; }
function currentBoundaries() { return [baseY, ...userBoundaries, roofY]; }

function addBoundary(y) {
  updateBuildingBox();
  if (!(y > baseY && y < roofY)) return false;
  y = snap(y);
  const all = [baseY, ...userBoundaries, roofY].sort((a, b) => a - b);
  for (const b of all) { if (Math.abs(b - y) < MIN_GAP) return false; }
  userBoundaries.push(y);
  userBoundaries.sort((a, b) => a - b);
  drawBoundaryLines();
  return true;
}
function removeBoundaryNear(y) {
  updateBuildingBox();
  if (!userBoundaries.length) return false;
  const ySnap = snap(y);
  let bestIdx = -1, bestDist = Infinity;
  for (let i = 0; i < userBoundaries.length; i++) {
    const d = Math.abs(userBoundaries[i] - ySnap);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  const THRESH = Math.max(MIN_GAP * 1.5, SNAP * 2);
  if (bestIdx !== -1 && bestDist <= THRESH) {
    userBoundaries.splice(bestIdx, 1);
    drawBoundaryLines();
    return true;
  }
  return false;
}

// 경계선(라인) 그리기 — 기존 로직 유지
function drawBoundaryLines() {
  if (boundaryLinesGroup) {
    boundaryLinesGroup.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    scene.remove(boundaryLinesGroup);
    boundaryLinesGroup = null;
  }
  boundaryLinesGroup = new THREE.Group();
  scene.add(boundaryLinesGroup);

  if (!footprintTemplate) return;

  const boundaries = currentBoundaries();
  for (const y of boundaries) {
    const line = new THREE.LineSegments(
      footprintTemplate.geometry,
      new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.9 })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.y = y;
    boundaryLinesGroup.add(line);
  }
}

// 클릭으로 층 경계 추가/삭제
renderer.domElement.addEventListener('click', (e) => {
  if (mode !== 'floor') return;
  const hit = raycast(e, getWallsOnly());
  if (!hit) return;
  const y = hit.point.y;
  if (e.altKey || e.metaKey) {
    if (removeBoundaryNear(y)) console.log('경계 삭제'); else console.log('가까운 경계 없음');
    return;
  }
  if (addBoundary(y)) console.log('경계 추가');
});

// 저장/초기화 버튼
document.getElementById('btnSaveLevels').addEventListener('click', () => {
  const payload = { version: 1, buildingId: 'B001', baseY, roofY, userBoundaries: userBoundaries.slice(), boundaries: currentBoundaries() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  window.location.href = 'floor_add.html';
});
document.getElementById('btnClearGuides').addEventListener('click', () => {
  if (boundaryLinesGroup) { scene.remove(boundaryLinesGroup); boundaryLinesGroup = null; }
});

// 리사이즈/렌더
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
renderer.setAnimationLoop(() => renderer.render(scene, camera));

updateBuildingBox();
drawBoundaryLines();
