// Three.js와 OrbitControls를 CDN에서 모듈로 불러오기 (버전은 예시로 0.160.0 고정)
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

const el = document.getElementById('app');

// ----- 기본 씬 구성 -----
const scene = new THREE.Scene();

// 카메라: 살짝 위에서 내려다보는 각도
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.position.set(6, 6, 10);

// 렌더러
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(el.clientWidth, el.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; // 색공간
el.appendChild(renderer.domElement);

// 부드러운 조명 2개 (환경 + 방향)
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

// 바닥 그리드(전시용 가이드)
const grid = new THREE.GridHelper(50, 50, 0xcccccc, 0xeeeeee);
grid.position.y = -0.01;
scene.add(grid);

// ----- “건물” : 직육면체 하나면 충분 -----
const buildingWidth = 4;    // X
const buildingDepth = 3;    // Z
const buildingHeight = 8;   // Y

// 간단한 창 느낌의 줄무늬 텍스처를 캔버스로 즉석 생성
function makeStripeTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');

  // 베이스
  g.fillStyle = '#8aa1c8';
  g.fillRect(0, 0, c.width, c.height);

  // 창 띠
  g.fillStyle = '#dfe7f7';
  for (let y = 20; y < c.height; y += 30) {
    g.fillRect(8, y, c.width - 16, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return tex;
}

const wallMat = new THREE.MeshStandardMaterial({
  map: makeStripeTexture(),
  roughness: 0.7,
  metalness: 0.0
});

const geo = new THREE.BoxGeometry(buildingWidth, buildingHeight, buildingDepth);
const building = new THREE.Mesh(geo, wallMat);
building.position.y = buildingHeight / 2; // 바닥 위로 세우기
scene.add(building);


// ----- 마우스 드래그 회전: OrbitControls -----
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;      // 부드러운 감속
controls.enablePan = true;         // 패닝 비활성(원한다면 true)
controls.minDistance = 5;
controls.maxDistance = 30;
controls.target.set(0, buildingHeight / 2, 0); // 건물 중심을 바라보게
controls.update();

// 리사이즈 대응
function onResize() {
  const w = el.clientWidth;
  const h = el.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
onResize();

// 렌더 루프
function tick() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
