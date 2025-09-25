import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

const container = document.getElementById('viewer');

// ───────── Renderer / Scene / Camera ─────────
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

const camera = new THREE.PerspectiveCamera(
  55,
  container.clientWidth / container.clientHeight,
  0.1,
  5000
);
camera.position.set(180, 240, 300);        // 요청한 무빙 느낌의 기본 포지션

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 60, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 0.7));

// ───────── 데이터(좌표만) 로드 ─────────
// draw 페이지에서 저장 형식:
// sessionStorage.setItem('floorCoordsPayload', JSON.stringify({ coords: [[x,y],...], canvas:{ w:1600, h:1000 }, ts: ... }))
let baseHeight = 600;
let rawData = null; // [[x,y], ...]

try {
  const raw = sessionStorage.getItem('floorCoordsPayload');
  if (raw) {
    const payload = JSON.parse(raw);
    if (payload?.canvas?.h) baseHeight = payload.canvas.h;
    if (Array.isArray(payload?.coords) && payload.coords.length >= 3) {
      rawData = payload.coords;
    }
  }
} catch (e) {
  console.warn('coords load failed:', e);
}

// ───────── 빌딩 그룹 ─────────
const buildingGroup = new THREE.Group();
buildingGroup.name = 'buildingGroup';
scene.add(buildingGroup);

const WALLS_GROUP_NAME = 'wallsGroup';

// ───────── 모드 & UI ─────────
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

// ───────── 상태값 ─────────
let buildingBox = new THREE.Box3();
let baseY = 0, roofY = 0;
let userBoundaries = [];
let boundaryLinesGroup = null;
let footprintTemplate = null;
let floorWorldY = 0;
const BUILDING_ID = 'B001';
const FACADE_MAP_STORAGE_KEY = `facadeMap:${BUILDING_ID}`;
const facadeRegistry = new Map();
const usedImages = new Map();


function updateBuildingBox() {
  buildingBox.setFromObject(buildingGroup);
  baseY = buildingBox.min.y;
  roofY = buildingBox.max.y;
}

// ───────── 코너/구간/리본 유틸 ─────────
function findCornersStraightOnly(pts, angleMarginDeg = 25) {
  const N = pts.length;
  const corners = [0];
  for (let i = 0; i < N; i++) {
    const im1 = (i - 1 + N) % N, ip1 = (i + 1) % N;
    const b = pts[i], a = pts[im1], c = pts[ip1];
    const v1 = new THREE.Vector2(a.x - b.x, a.y - b.y).normalize();
    const v2 = new THREE.Vector2(c.x - b.x, c.y - b.y).normalize();
    const dot = THREE.MathUtils.clamp(v1.dot(v2), -1, 1);
    const deg = THREE.MathUtils.radToDeg(Math.acos(dot));
    if (deg < (180 - angleMarginDeg)) corners.push(i);
  }
  return [...new Set(corners)].sort((a, b) => a - b);
}
function sharpestCornerIndex(pts) {
  let best = 0, bestDeg = 180, N = pts.length;
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
function toFacadeRanges(N, cornerIdxs) {
  if (cornerIdxs.length <= 1) return [[0, 0]];
  const ranges = [];
  for (let i = 0; i < cornerIdxs.length; i++) {
    const s = cornerIdxs[i];
    const e = cornerIdxs[(i + 1) % cornerIdxs.length];
    ranges.push([s, e]);
  }
  return ranges;
}
function buildRibbonFromRange(pts, cx, cz, H, iStart, iEnd, color = 0x9bb0c1) {
  const N = pts.length;
  if (N < 2) return null;

  const seq = [];
  if (iEnd === iStart) {
    for (let k = 0; k < N; k++) seq.push((iStart + k) % N);
    seq.push(iStart);
  } else {
    let i = iStart;
    seq.push(i);
    while (i !== iEnd) { i = (i + 1) % N; seq.push(i); }
  }
  if (seq.length < 2) return null;

  const ringBottom = [], ringTop = [];
  for (const idx of seq) {
    const v = pts[idx];
    const x = v.x - cx, z = v.y - cz;
    ringBottom.push(new THREE.Vector3(x, 0, z));
    ringTop.push(new THREE.Vector3(x, H, z));
  }

  const L = ringBottom.length;
  const positions = new Float32Array(L * 2 * 3);
  const uvs = new Float32Array(L * 2 * 2);
  const indices = [];

  for (let i = 0; i < L; i++) {
    const iBot = i * 2, iTop = i * 2 + 1;
    const pB = ringBottom[i], pT = ringTop[i];
    positions.set([pB.x, pB.y, pB.z], iBot * 3);
    positions.set([pT.x, pT.y, pT.z], iTop * 3);

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
  mesh.castShadow = true;
  return mesh;
}
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
function mergeShortRanges(pts, ranges, minLen) {
  if (!ranges || ranges.length <= 1) return ranges.slice();
  const merged = [];
  let curS = ranges[0][0];
  let curE = ranges[0][1];
  for (let k = 1; k < ranges.length; k++) {
    const [, e] = ranges[k];
    const testLen = lengthOfRange(pts, curS, e);
    if (testLen < minLen) curE = e;
    else { merged.push([curS, curE]); curS = ranges[k][0]; curE = e; }
  }
  merged.push([curS, curE]);
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
  return THREE.MathUtils.radToDeg(Math.acos(dot));
}
function mergeFirstLastIfSmooth(pts, ranges, smoothAngleDeg = 15) {
  if (!ranges || ranges.length < 2) return ranges;
  const last = ranges[ranges.length - 1];
  const first = ranges[0];
  const junctionIdx = last[1];
  const deg = angleAtIndex(pts, junctionIdx);
  if (deg > (180 - smoothAngleDeg)) {
    const merged = ranges.slice(1);
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

// ───────── 자동 프레이밍 ─────────
function autoFrame(object, { fitOffset = 1.25 } = {}) {
  if (!object) return;
  const box = new THREE.Box3().setFromObject(object);
  if (!isFinite(box.min.x) || !isFinite(box.max.x)) return;

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);

  const fovV = THREE.MathUtils.degToRad(camera.fov);
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
  const distV = (sphere.radius * fitOffset) / Math.sin(fovV / 2);
  const distH = (sphere.radius * fitOffset) / Math.sin(fovH / 2);
  const distance = Math.max(distV, distH);

  const dir = new THREE.Vector3(1, 1, 1).normalize();
  controls.target.copy(center);
  camera.position.copy(center).add(dir.multiplyScalar(distance));

  const maxDim = Math.max(size.x, size.y, size.z);
  camera.near = Math.max(distance / 1000, 0.01);
  camera.far = distance + maxDim * 20;
  camera.updateProjectionMatrix();
  controls.update();
}

function applyTextureToWall(wall, url, uv = { repeat: [1, 1], offset: [0, 0] }) {
  new THREE.TextureLoader().load(url, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 1;
    tex.repeat.set(...(uv?.repeat ?? [1, 1]));
    tex.offset.set(...(uv?.offset ?? [0, 0]));
    tex.needsUpdate = true;

    wall.material = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.DoubleSide, color: 0xffffff
    });
    wall.userData.tex = { url, uv };
  });
}

// ───────── 메인 빌드 ─────────
function buildFromPolygon(rawData, baseHeight, floors) {
  if (!rawData || rawData.length < 3) return;

  const polygonPx = rawData.map(([x, y]) => ({ x, y }));
  const PX_TO_UNIT = 0.3;
  const UNIT_PER_FLOOR = 15;
  const H = floors * UNIT_PER_FLOOR;

  // px→3D(XZ), y 반전
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

  // 파사드 리본
  const cornerIdxs = findCornersStraightOnly(pts, 25);
  let ranges = toFacadeRanges(pts.length, cornerIdxs);
  ranges = mergeShortRanges(pts, ranges, 50.0);
  ranges = mergeFirstLastIfSmooth(pts, ranges, 15);

  let facadeNo = 0;
  for (const [s, e] of ranges) {
    const ribbon = buildRibbonFromRange(pts, cx, cz, H, s, e);
    if (!ribbon) continue;
    ribbon.material.color.setHSL((facadeNo % 12) / 12, 0.5, 0.5);

    const facadeId = `F${facadeNo}`;      // ← 안정적인 내부 ID
    ribbon.name = `facade-${facadeNo++}`;
    ribbon.userData.facadeId = facadeId;
    ribbon.userData.tex = null;

    // (재생성 시) registry에 기록된 텍스처가 있으면 즉시 재적용
    const rec = facadeRegistry.get(facadeId);
    if (rec?.objectUrl || rec?.remoteUrl) {
      applyTextureToWall(ribbon, rec.objectUrl ?? rec.remoteUrl, rec.uv);
    }

    wallsGroup.add(ribbon);
  }

  // 바닥/지붕
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

  // 경계 라인 템플릿
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

  // 자동 프레이밍
  autoFrame(buildingGroup, { fitOffset: 1.25 });
}

function exportFacadeMapping() {
  const items = [];
  for (const [facadeId, rec] of facadeRegistry.entries()) {
    items.push({
      facadeId,
      name: rec.name,
      mime: rec.mime,
      size: rec.size,
      lastModified: rec.lastModified,
      s3Key: rec.s3Key ?? null,
      uv: rec.uv
    });
  }
  const payload = {
    version: 1,
    buildingId: BUILDING_ID,
    items
  };
  return payload;
}

function downloadFacadeMapping() {
  const data = JSON.stringify(exportFacadeMapping(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `facade-mapping-${BUILDING_ID}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function saveFacadeMappingToLocal() {
  localStorage.setItem(FACADE_MAP_STORAGE_KEY, JSON.stringify(exportFacadeMapping()));
}

function loadFacadeMappingFromLocal() {
  const raw = localStorage.getItem(FACADE_MAP_STORAGE_KEY);
  if (!raw) return;
  try {
    const payload = JSON.parse(raw);
    if (!payload?.items) return;
    facadeRegistry.clear();
    usedImages.clear();
    for (const it of payload.items) {
      facadeRegistry.set(it.facadeId, {
        name: it.name,
        mime: it.mime,
        size: it.size,
        lastModified: it.lastModified,
        objectUrl: null,      // 로컬 파일 URL은 복원 불가
        s3Key: it.s3Key ?? null,
        uv: it.uv ?? { repeat: [1, 1], offset: [0, 0] },
        remoteUrl: null       // s3Key → presigned URL 받아서 넣을 자리
      });
      if (it.name && it.size != null) {
        usedImages.set(`${it.name}|${it.size}|${it.lastModified ?? 0}`, it.facadeId);
      }
    }
  } catch (e) {
    console.warn('facade map load failed:', e);
  }
}

// 백엔드 업로드 완료 후, 응답의 s3Key를 반영하는 헬퍼
function setS3KeyForFacade(facadeId, s3Key) {
  const rec = facadeRegistry.get(facadeId);
  if (!rec) return;
  rec.s3Key = s3Key;
  saveFacadeMappingToLocal();
}

// presigned URL을 받아 바로 적용하고 싶을 때
function applyRemoteUrlToFacade(facadeId, remoteUrl) {
  const wall = getWallsChildren().find(w => w.userData?.facadeId === facadeId);
  if (!wall) return;
  const rec = facadeRegistry.get(facadeId) ?? { uv: { repeat: [1, 1], offset: [0, 0] } };
  rec.remoteUrl = remoteUrl;
  facadeRegistry.set(facadeId, rec);
  applyTextureToWall(wall, remoteUrl, rec.uv);
}


// ───────── UI: 층수/생성 ─────────
const floorsInput = document.getElementById('floors');
const buildBtn = document.getElementById('createBuilding');

function createBuilding() {
  if (!rawData) return; // 좌표 없으면 아무것도 생성하지 않음(요청사항)
  const floors = Math.max(1, Number(floorsInput.value || 1));
  buildFromPolygon(rawData, baseHeight, floors);
}
createBuilding();
loadFacadeMappingFromLocal();
buildBtn.addEventListener('click', createBuilding);

// ───────── 텍스처 더블클릭 적용 ─────────
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

  // ★ 추가: 어떤 벽인지 식별
  const facadeId = pendingWall.userData?.facadeId;
  if (!facadeId) {
    console.warn('facadeId 없음: 매핑을 기록할 수 없습니다.');
    return;
  }

  // ★ 추가: 매핑 레코드 생성 & 등록
  const objectUrl = URL.createObjectURL(f);
  const rec = {
    name: f.name,
    mime: f.type,
    size: f.size,
    lastModified: f.lastModified,
    objectUrl,        // 세션 프리뷰용 (새로고침 후 무효)
    remoteUrl: null,  // 서버에서 presigned GET 받으면 채움
    s3Key: null,      // 업로드 완료 후 채움
    uv: { repeat: [1, 1], offset: [0, 0] }
  };
  facadeRegistry.set(facadeId, rec);

  // ★ 기존: 텍스처 적용 (이제 유틸 함수로)
  applyTextureToWall(pendingWall, objectUrl, rec.uv);

  // ★ 추가: 로컬스토리지 저장(원하면 JSON 내보내기도 가능)
  saveFacadeMappingToLocal();
  console.log('SET', facadeId, rec);
  console.log('REGISTRY size', facadeRegistry.size);

  pendingWall = null;
  fileInput.value = '';
});

// ───────── 층/경계선 ─────────
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


document.getElementById('btnSaveLevels').addEventListener('click', () => {
  const payload = {
    version: 1,
    buildingId: 'B001',
    baseY,
    roofY,
    userBoundaries: userBoundaries.slice(),
    boundaries: currentBoundaries()
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

  window.location.href = 'floor_add.html';
});


document.getElementById('btnClearGuides').addEventListener('click', () => {
  if (boundaryLinesGroup) { scene.remove(boundaryLinesGroup); boundaryLinesGroup = null; }
});

// ───────── 리사이즈/렌더 ─────────
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// 초기 경계 업데이트
updateBuildingBox();
drawBoundaryLines();


document.getElementById('btnExport').addEventListener('click', () => downloadFacadeMapping());
