//tool-tip
document.querySelectorAll('[hover-tooltip]').forEach(el => {
    let tooltip;

    el.addEventListener('mouseenter', e => {
        tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        tooltip.textContent = el.getAttribute('hover-tooltip');
        document.body.appendChild(tooltip);
        tooltip.classList.add('show');
    });

    el.addEventListener('mousemove', e => {
        if (tooltip) {
            tooltip.style.top = e.clientY + 'px';
            tooltip.style.left = e.clientX + 'px';
        }
    });

    el.addEventListener('mouseleave', e => {
        if (tooltip) {
            tooltip.remove();
            tooltip = null;
        }
    });
});


//3D
const container = document.getElementById('three');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);

//scene & camera
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, rect.width / rect.height, 0.1, 2000);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;        
controls.minDistance = 1;
controls.maxDistance = 50;

//light
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dir = new THREE.DirectionalLight(0xffffff, 0.9);
dir.position.set(3, 5, 2);
scene.add(dir);

//box
const box = new THREE.Mesh(
    new THREE.BoxGeometry(2, 1, 3),
    new THREE.MeshStandardMaterial({ color: 0x6aa3ff, metalness: 0.2, roughness: 0.35 })
);
scene.add(box);

function fitCameraToObject(camera, object, controls, padding = 1.2) {
    // 객체의 중심/크기 계산
    const box3 = new THREE.Box3().setFromObject(object);
    const size = box3.getSize(new THREE.Vector3());
    const center = box3.getCenter(new THREE.Vector3());

    // 카메라가 볼 각도에서 필요한 거리 계산
    const maxSize = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let distance = (maxSize / 2) / Math.tan(fov / 2);
    distance *= padding; // 여유

    // 카메라 위치/클리핑/타깃
    camera.near = Math.max(0.1, distance / 100);
    camera.far = distance * 10;
    camera.position.copy(center).add(new THREE.Vector3(distance, distance * 0.5, distance));
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    if (controls) {
        controls.target.copy(center);
        controls.update();
    }
}
fitCameraToObject(camera, boxMesh, controls);

// 애니메이션 (자동 회전 제거: 사용자 드래그만)
function animate() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}
animate();

//re-size
window.addEventListener('resize', () => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
});