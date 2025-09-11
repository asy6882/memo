const fileInput = document.getElementById('fileInput');
const img = document.getElementById('img');
const svg = document.getElementById('svg');
const stageInner = document.getElementById('stageInner');
const floatConfirm = document.getElementById('floatConfirm');
const confirmBtn = document.getElementById('confirmBtn');
const cancelBtn = document.getElementById('cancelBtn');
const snapHint = document.getElementById('snapHint');

const naturalSizeEl = document.getElementById('naturalSize');
const ptCountEl = document.getElementById('ptCount');
const lastPxEl = document.getElementById('lastPx');
const lastPctEl = document.getElementById('lastPct');

const undoBtn = document.getElementById('undoBtn');
const clearPtsBtn = document.getElementById('clearPtsBtn');
const clearAllBtn = document.getElementById('clearAllBtn');

const regionNameInput = document.getElementById('regionName');
const saveRegionBtn = document.getElementById('saveRegionBtn');

const jsonText = document.getElementById('jsonText');
const copyJsonBtn = document.getElementById('copyJsonBtn');
const downloadJsonBtn = document.getElementById('downloadJsonBtn');
const importJsonInput = document.getElementById('importJsonInput');
const regionList = document.getElementById('regionList');

let naturalW = 0, naturalH = 0;
let currentPts = [];              // {x,y,xpct,ypct}
let pending = null;               // {x,y, clientX, clientY, snap:boolean}
let isClosed = false;             // 폴리곤 닫힘 여부
let regions = [];                 // [{name, points:[...]}]

// --- 이미지 업로드 ---
fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    img.onload = () => {
        naturalW = img.naturalWidth;
        naturalH = img.naturalHeight;
        naturalSizeEl.textContent = `${naturalW} × ${naturalH}px`;
        setupSvgBox();
        resetCurrent();
        renderAll();
        enableUi();
    };
    img.src = url;
});

window.addEventListener('resize', () => { setupSvgBox(); renderAll(); });

function setupSvgBox() {
    if (!img.src) return;
    const rImg = img.getBoundingClientRect();
    const rStage = stageInner.getBoundingClientRect();
    svg.style.left = (rImg.left - rStage.left) + 'px';
    svg.style.top = (rImg.top - rStage.top) + 'px';
    svg.setAttribute('width', rImg.width);
    svg.setAttribute('height', rImg.height);
    svg.setAttribute('viewBox', `0 0 ${naturalW} ${naturalH}`);
}

// --- 클릭 → 임시점 생성 & 스냅 판단 ---
img.addEventListener('click', (e) => {
    if (!img.src || isClosed) return;
    const { x, y } = visClickToOriginal(e);
    pending = { x, y, clientX: e.clientX, clientY: e.clientY, snap: willSnapToFirst(e) };
    showFloatConfirm(e.clientX, e.clientY, pending.snap);
    renderAll();
});

function visClickToOriginal(e) {
    const rect = img.getBoundingClientRect();
    const xVis = e.clientX - rect.left, yVis = e.clientY - rect.top;
    const x = +(xVis * (naturalW / rect.width)).toFixed(2);
    const y = +(yVis * (naturalH / rect.height)).toFixed(2);
    return { x, y };
}

// 첫 점 근처인지(시각 px 기준)
function willSnapToFirst(e) {
    if (currentPts.length === 0) return false;
    const first = currentPts[0];
    const rect = img.getBoundingClientRect();
    const firstVisX = first.x / naturalW * rect.width + rect.left;
    const firstVisY = first.y / naturalH * rect.height + rect.top;
    const dx = e.clientX - firstVisX;
    const dy = e.clientY - firstVisY;
    const dist = Math.hypot(dx, dy);
    const SNAP_TOL_VIS_PX = 14; // 화면상 14px 이내면 스냅
    return dist <= SNAP_TOL_VIS_PX;
}

// 단축키: Enter=확정, Esc=취소
window.addEventListener('keydown', (e) => {
    if (!pending) return;
    if (e.key === 'Enter') { confirmPending(); }
    if (e.key === 'Escape') { cancelPending(); }
});

confirmBtn.addEventListener('click', confirmPending);
cancelBtn.addEventListener('click', cancelPending);

function confirmPending() {
    if (!pending) return;
    if (pending.snap && currentPts.length >= 2) {
        // 스냅 닫기: 새 점 추가 없이 폴리곤 닫힘 상태로
        isClosed = true;
        pending = null;
        hideFloatConfirm();
        updateInfo();
        renderAll();
        enableUi();
        return;
    }
    // 일반 확정: 점 추가
    const { x, y } = pending;
    const xpct = +((x / naturalW) * 100).toFixed(2);
    const ypct = +((y / naturalH) * 100).toFixed(2);
    currentPts.push({ x, y, xpct, ypct });
    pending = null;
    hideFloatConfirm();
    updateInfo();
    renderAll();
    enableUi();
}

function cancelPending() {
    pending = null; hideFloatConfirm(); renderAll();
}

function showFloatConfirm(clientX, clientY, snapped) {
    const rStage = stageInner.getBoundingClientRect();
    floatConfirm.style.left = (clientX - rStage.left) + 'px';
    floatConfirm.style.top = (clientY - rStage.top) + 'px';
    snapHint.style.display = snapped ? 'inline' : 'none';
    floatConfirm.style.display = 'flex';
}
function hideFloatConfirm() { floatConfirm.style.display = 'none'; }

// --- 편집 버튼들 ---
undoBtn.addEventListener('click', () => {
    if (!currentPts.length || isClosed) return;
    currentPts.pop();
    updateInfo(); renderAll(); enableUi();
});
clearPtsBtn.addEventListener('click', () => { resetCurrent(); renderAll(); enableUi(); });
clearAllBtn.addEventListener('click', () => { regions = []; dumpJson(); renderAll(); enableUi(); });

function resetCurrent() {
    currentPts = []; pending = null; isClosed = false;
    hideFloatConfirm(); updateInfo();
}

// --- 구역 저장 (닫힘+이름) ---
saveRegionBtn.addEventListener('click', () => {
    const name = regionNameInput.value.trim();
    if (!name) { alert('エリア名を入力してください。'); return; }
    if (!isClosed || currentPts.length < 3) { alert('구역을 스냅으로 닫아 주세요(최소 3점).'); return; }
    regions.push({ name, points: currentPts.map(p => ({ ...p })) });
    regionNameInput.value = '';
    resetCurrent();
    dumpJson(); renderAll(); enableUi();
});

function regionsToJson() {
  try { return JSON.stringify(regions ?? [], null, 2); }
  catch { return '[]'; }
}

// --- JSON IO ---
// copyJsonBtn.addEventListener('click', async () => {
//     try {
//         await navigator.clipboard.writeText(jsonText.value);
//         copyJsonBtn.textContent = '복사됨!'; setTimeout(() => copyJsonBtn.textContent = 'JSON 복사', 900);
//     } catch { alert('복사 권한을 허용해 주세요.'); }
// });
downloadJsonBtn.addEventListener('click', () => {
    const data = regionsToJson();
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'regions.json'; a.click();
    URL.revokeObjectURL(a.href);
});
// document.querySelector('label[for="importJsonInput"]')?.addEventListener('click', () => importJsonInput.click());
// importJsonInput.addEventListener('change', () => {
//     const f = importJsonInput.files?.[0]; if (!f) return;
//     const reader = new FileReader();
//     reader.onload = (ev) => {
//         try {
//             const data = JSON.parse(ev.target.result);
//             if (!Array.isArray(data)) throw new Error('배열 아님');
//             regions = data.filter(r => r && r.name && Array.isArray(r.points));
//             dumpJson(); renderAll(); enableUi();
//         } catch { alert('JSON形式が正しくありません。'); }
//     };
//     reader.readAsText(f, 'utf-8'); importJsonInput.value = '';
// });

// --- 렌더링 ---
function renderAll() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // 저장된 폴리곤
    regions.forEach(r => {
        if (r.points.length >= 3) {
            const ptsStr = r.points.map(p => `${p.x},${p.y}`).join(' ');
            const poly = mk('polygon', { points: ptsStr, class: 'poly' });
            svg.appendChild(poly);
            const label = mk('text', { x: r.points[0].x + 6, y: r.points[0].y - 6, fill: 'rgba(0,0,0,0.85)', 'font-size': 14 });
            label.textContent = r.name; svg.appendChild(label);
        }
    });

    // 현재 그리는 도형
    if (currentPts.length) {
        // 닫힘이면 polygon으로
        if (isClosed && currentPts.length >= 3) {
            const ptsStr = currentPts.map(p => `${p.x},${p.y}`).join(' ');
            svg.appendChild(mk('polygon', { points: ptsStr, class: 'poly' }));
        } else {
            // 열림이면 polyline
            const d = currentPts.map(p => `${p.x},${p.y}`).join(' ');
            svg.appendChild(mk('polyline', { points: d, class: 'wire' }));
            // 임시점이 있고, 스냅이면 초록 와이어
            if (pending && currentPts.length) {
                const last = currentPts[currentPts.length - 1];
                const c = mk('polyline', { points: `${last.x},${last.y} ${pending.x},${pending.y}`, class: `wire ${pending.snap ? 'wire-snap' : ''}` });
                svg.appendChild(c);
            }
        }
        // 점들
        currentPts.forEach((p, i) => {
            svg.appendChild(mk('circle', { cx: p.x, cy: p.y, r: 6, class: `pt ${i === 0 ? 'pt-first' : ''}` }));
            const t = mk('text', { x: p.x + 8, y: p.y - 8, fill: 'rgba(0,0,0,0.85)', 'font-size': 12 }); t.textContent = i + 1; svg.appendChild(t);
        });
        // 스냅 표시용 헤일로
        if (pending && pending.snap && currentPts.length) {
            const f = currentPts[0];
            svg.appendChild(mk('circle', { cx: f.x, cy: f.y, r: 14 * (naturalW / img.getBoundingClientRect().width), class: 'snap-halo' }));
            svg.appendChild(mk('circle', { cx: pending.x, cy: pending.y, r: 6, class: 'pt-pending' }));
        } else if (pending) {
            svg.appendChild(mk('circle', { cx: pending.x, cy: pending.y, r: 6, class: 'pt-pending' }));
        }
    }
    renderRegionList();
}

function mk(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)); return el;
}

function updateInfo() {
    const n = currentPts.length; ptCountEl.textContent = n;
    if (n) {
        const p = currentPts[n - 1];
        lastPxEl.textContent = `x:${p.x}, y:${p.y}`;
        lastPctEl.textContent = `x:${p.xpct ?? ((p.x / naturalW * 100).toFixed(2))}%, y:${p.ypct ?? ((p.y / naturalH * 100).toFixed(2))}%`;
    } else { lastPxEl.textContent = '-'; lastPctEl.textContent = '-'; }
}

function dumpJson() { 
    if (!jsonText) return;
    jsonText.value = jsonText.value = regionsToJson(); }

function enableUi() {
    const hasImg = !!img.src;
    const hasPts = currentPts.length > 0;
    const hasRegions = regions.length > 0;
    const canSave = hasImg && isClosed && currentPts.length >= 3 && regionNameInput.value.trim().length > 0;

    undoBtn.disabled = !hasPts || isClosed;
    clearPtsBtn.disabled = !hasPts && !isClosed;
    clearAllBtn.disabled = !hasRegions;
    saveRegionBtn.disabled = !canSave;
    // copyJsonBtn.disabled = !hasRegions;
    downloadJsonBtn.disabled = !hasRegions;

    dumpJson();
}

regionNameInput.addEventListener('input', enableUi);

function renderRegionList() {
    regionList.innerHTML = '';
    regions.forEach((r, idx) => {
        const div = document.createElement('div'); div.className = 'item mono';
        const ptsPreview = r.points.slice(0, 3).map(p => `(${p.x},${p.y})`).join(', ') + (r.points.length > 3 ? ' ...' : '');
        div.innerHTML = `
          <div><b>${idx + 1}. ${escapeHtml(r.name)}</b> <span class="muted">/ ${r.points.length} pts</span></div>
          <div class="muted">${escapeHtml(ptsPreview)}</div>
          <div class="row" style="margin-top:6px;">
            <button data-act="delete" data-idx="${idx}">삭제</button>
          </div>`;
        regionList.appendChild(div);
    });
    regionList.querySelectorAll('button').forEach(b => {
        const idx = +b.dataset.idx, act = b.dataset.act;
        b.addEventListener('click', () => {
            if (act === 'delete') { regions.splice(idx, 1); dumpJson(); renderAll(); enableUi(); }
        });
    });
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
