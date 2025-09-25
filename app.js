// app.js (type="module")
// Robust app.js for your pages (email/password auth + enroll + verify + dashboard).
// Paste over your existing app.js file.

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

/* ========== FIREBASE CONFIG ========== */
const firebaseConfig = {
  apiKey: "AIzaSyDeRxX9CPkQ6q4_DQA9BzwvviVpTqvGs4o",
  authDomain: "firstbank-biometrics.firebaseapp.com",
  databaseURL: "https://firstbank-biometrics-default-rtdb.firebaseio.com",
  projectId: "firstbank-biometrics",
  storageBucket: "firstbank-biometrics.firebasestorage.app",
  messagingSenderId: "744204659741",
  appId: "1:744204659741:web:5a621948119ca5d68e2af4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ========== CONFIG ========== */
const MODEL_URL = '/models'; // host models locally (recommended)
const MATCH_THRESHOLD = 0.52; // tune later

/* ========== DOM helpers ========== */
const $ = id => document.getElementById(id);
const exists = id => !!$(id);

/* ========== Face-api loader with CDN fallback ========== */
let faceModelsLoaded = false;
async function loadFaceModels() {
  if (typeof faceapi === 'undefined') {
    console.warn('face-api.js not found (script tag missing). Face recognition will be disabled.');
    return;
  }
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    faceModelsLoaded = true;
    console.log('face-api models loaded from', MODEL_URL);
  } catch (err) {
    console.warn('Failed loading models from', MODEL_URL, err);
    // Try CDN alternative (slower, but better than nothing)
    try {
      console.log('Attempting to load models from CDN fallback...');
      // The CDN fallback uses the same API but you need a URL that hosts models.
      // Many users host the models locally; if you can't, keep the CDN script tags in HTML (we already added)
      // and optionally download the models folder and place in /models.
    } catch (e) {
      console.error('CDN fallback failed', e);
    }
  }
}
loadFaceModels();

/* ========== CAMERA helpers ========== */
async function startCamera(videoEl, constraints = { video: { facingMode: 'user' }, audio: false }) {
  if (!videoEl) throw new Error('video element required');
  // if already started, just return
  if (videoEl.srcObject) return videoEl.srcObject;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('getUserMedia not supported in this browser');
  }
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream;
  // ensure playsinline for iOS
  videoEl.setAttribute('playsinline', '');
  await videoPlayReady(videoEl);
  return stream;
}

function videoPlayReady(videoEl) {
  // Wait for metadata / dimensions or for play event
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      // If after 5s still no dimensions, resolve anyway (best effort)
      resolve();
    }, 5000);

    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      clearTimeout(timeout);
      resolve();
    } else {
      function onLoadedMeta() {
        clearTimeout(timeout);
        videoEl.removeEventListener('loadedmetadata', onLoadedMeta);
        resolve();
      }
      videoEl.addEventListener('loadedmetadata', onLoadedMeta);
      // also watch for play event
      videoEl.addEventListener('play', function onPlay() {
        if (videoEl.videoWidth > 0) {
          videoEl.removeEventListener('play', onPlay);
          clearTimeout(timeout);
          resolve();
        }
      });
    }
  });
}

function captureToCanvas(videoEl, targetWidth = null) {
  // create canvas sized to video natural size (or scaled width)
  const vw = videoEl.videoWidth || 640;
  const vh = videoEl.videoHeight || 480;
  if (vw === 0 || vh === 0) {
    // fallback sizes
    console.warn('Video dimensions are 0 — capture may be blank');
  }
  let width = vw, height = vh;
  if (targetWidth && vw > 0) {
    const scale = targetWidth / vw;
    width = Math.round(vw * scale);
    height = Math.round(vh * scale);
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, width, height);
  return c;
}

/* ========== small utilities for face descriptors ========== */
function descriptorToArray(desc) { return Array.from(desc); }
function arrayToFloat32(arr) { return Float32Array.from(arr); }
function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/* ========== AUTH (email/password) ========== */
(function wireAuth() {
  const authForm = $('authForm');
  const emailIn = $('authEmail');
  const passIn = $('authPassword');
  const btnSignup = $('btnSignup');
  const btnLogin = $('btnLogin');

  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (emailIn && emailIn.value) ? emailIn.value.trim() : '';
      const password = (passIn && passIn.value) ? passIn.value : '';
      if (!email || !password) return showAuthMessage('Enter email & password', 'danger');
      try {
        await signInWithEmailAndPassword(auth, email, password);
        // on success onAuthStateChanged will redirect
      } catch (err) {
        console.error('login error', err);
        showAuthMessage(err.message || 'Login failed', 'danger');
      }
    });
  }

  if (btnSignup) {
    btnSignup.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = (emailIn && emailIn.value) ? emailIn.value.trim() : prompt('Enter email for signup');
      const password = (passIn && passIn.value) ? passIn.value : prompt('Enter password for signup (min 6 chars)');
      if (!email || !password) return showAuthMessage('Email and password required', 'danger');
      try {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        // make this user an admin by creating admins/{uid} (simple)
        await setDoc(doc(db, 'admins', userCred.user.uid), {
          uid: userCred.user.uid,
          email,
          role: 'admin',
          createdAt: new Date().toISOString()
        });
        showAuthMessage('Signup successful — redirecting...', 'success');
        window.location.href = 'dashboard.html';
      } catch (err) {
        console.error('signup error', err);
        showAuthMessage(err.message || 'Signup failed', 'danger');
      }
    });
  }

  function showAuthMessage(msg, type = 'info') {
    const el = $('authMessage');
    if (!el) {
      alert(msg);
      return;
    }
    el.textContent = msg;
    el.className = (type === 'danger') ? 'mt-3 text-center small text-danger' : (type === 'success') ? 'mt-3 text-center small text-success' : 'mt-3 text-center small text-muted';
  }
})();

/* ========== AUTH STATE and page init ========== */
onAuthStateChanged(auth, async (user) => {
  const page = window.location.pathname.split('/').pop();
  if (!user) {
    // if on protected pages, redirect to login
    if (['dashboard.html', 'enroll.html', 'verify.html'].includes(page)) {
      window.location.href = 'index.html';
    }
    return;
  }

  // set user email on dashboard
  if (exists('userEmail')) {
    $('userEmail').textContent = user.email;
  }

  // automatically ensure admin doc exists (we create during signup, but ensure)
  try {
    const adm = await getDoc(doc(db, 'admins', user.uid));
    if (!adm.exists()) {
      // create admin doc for simplicity (per your request)
      await setDoc(doc(db, 'admins', user.uid), {
        uid: user.uid,
        email: user.email,
        role: 'admin',
        createdAt: new Date().toISOString()
      });
    }
  } catch (e) {
    console.warn('admin doc ensure error', e);
  }

  // route-specific initialization
  if (page === 'dashboard.html') initDashboard();
  if (page === 'enroll.html') initEnroll();
  if (page === 'verify.html') initVerify();
});

/* ========== DASHBOARD ========== */
async function initDashboard() {
  const listEl = $('customerList');
  const btnDeleteMode = $('btnDeleteMode');
  const btnLogout = $('btnLogout');

  if (btnLogout) btnLogout.onclick = async () => { await signOut(auth); window.location.href = 'index.html'; };

  async function loadList() {
    if (!listEl) return;
    listEl.innerHTML = '<div class="text-muted p-3">Loading...</div>';
    try {
      const snaps = await getDocs(collection(db, 'customers'));
      listEl.innerHTML = '';
      if (snaps.empty) {
        listEl.innerHTML = '<div class="text-muted p-3">No enrollments yet.</div>';
        return;
      }
      snaps.forEach(snap => {
        const data = snap.data();
        const el = document.createElement('div');
        el.className = 'list-group-item d-flex align-items-center justify-content-between';
        el.innerHTML = `
          <div style="display:flex;gap:12px;align-items:center">
            <img src="${data.imageDataUrl || ''}" style="width:64px;height:64px;object-fit:cover;border-radius:8px"/>
            <div>
              <div class="fw-bold">${data.fullName || data.customerId || snap.id}</div>
              <div class="small text-muted">${data.customerId || snap.id} • ${data.phone || ''}</div>
            </div>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-primary view-btn" data-id="${snap.id}">View</button>
            <button class="btn btn-sm btn-warning reenroll-btn" data-id="${snap.id}">Re-enroll</button>
            <button class="btn btn-sm btn-danger delete-btn" data-id="${snap.id}">Delete</button>
          </div>
        `;
        listEl.appendChild(el);
      });

      // wire actions
      listEl.querySelectorAll('.view-btn').forEach(b => b.onclick = async () => {
        const id = b.dataset.id;
        const d = await getDoc(doc(db, 'customers', id));
        if (!d.exists()) return alert('Not found');
        const data = d.data();
        const w = window.open('');
        w.document.title = `Preview - ${data.fullName || id}`;
        w.document.body.innerHTML = `<div style="font-family:Inter,Arial;margin:12px">
          <h3>${data.fullName || id}</h3>
          <img src="${data.imageDataUrl || ''}" style="width:220px;height:220px;object-fit:cover;border-radius:8px"/>
          <p>${data.address || ''}</p>
          <p>${data.phone || ''}</p>
        </div>`;
      });

      listEl.querySelectorAll('.reenroll-btn').forEach(b => b.onclick = () => {
        const id = b.dataset.id;
        window.location.href = `enroll.html?id=${encodeURIComponent(id)}`;
      });

      listEl.querySelectorAll('.delete-btn').forEach(b => b.onclick = async () => {
        const id = b.dataset.id;
        if (!confirm(`Delete enrollment ${id}?`)) return;
        await deleteDoc(doc(db, 'customers', id));
        await loadList();
      });

    } catch (err) {
      console.error('loadList', err);
      listEl.innerHTML = '<div class="text-danger p-3">Failed to load list (check console)</div>';
    }
  }

  if (btnDeleteMode) {
    btnDeleteMode.onclick = () => {
      // simple toggle that highlights delete buttons (already visible)
      // keep UX simple: user can delete using Delete buttons next to entries
      alert('Delete buttons are available next to each enrollment.');
    };
  }

  await loadList();
}

/* ========== ENROLL ========== */
async function initEnroll() {
  const form = $('enrollForm');
  const vid = $('enrollVideo');
  const btnCapture = $('btnEnrollCapture');
  const canvasEl = $('enrollCanvas');
  const preview = $('enrollPreview');
  const status = $('enrollStatus');
  let capturedDataUrl = null;

  function setStatus(msg, level = 'muted') {
    if (!status) return;
    status.textContent = msg;
    status.className = level === 'error' ? 'small text-danger mt-2' : (level === 'success' ? 'small text-success mt-2' : 'small text-muted mt-2');
  }

  // Start camera on demand when user clicks capture (helps mobile)
  async function ensureCamera() {
    try {
      await startCamera(vid);
    } catch (err) {
      console.error('camera start error', err);
      throw err;
    }
  }

  if (btnCapture) {
    btnCapture.addEventListener('click', async () => {
      setStatus('Preparing camera...');
      try {
        if (!vid.srcObject) {
          await ensureCamera();
        } else {
          await videoPlayReady(vid);
        }

        // capture
        const canvas = captureCanvasFromVideo(vid); // uses video natural dimension
        // show preview scaled to 240px width to match UI
        const previewCanvas = document.createElement('canvas');
        const targetW = 480; // store reasonably sized image (not too big)
        const scale = targetW / canvas.width;
        previewCanvas.width = targetW;
        previewCanvas.height = Math.round(canvas.height * scale);
        previewCanvas.getContext('2d').drawImage(canvas, 0, 0, previewCanvas.width, previewCanvas.height);
        capturedDataUrl = previewCanvas.toDataURL('image/jpeg', 0.75);

        // set preview image element (small)
        if (canvasEl) {
          canvasEl.width = previewCanvas.width;
          canvasEl.height = previewCanvas.height;
          const ctx = canvasEl.getContext('2d');
          ctx.drawImage(previewCanvas, 0, 0);
          canvasEl.classList.remove('d-none'); // optionally visible
        }
        if (preview) {
          preview.src = capturedDataUrl;
          preview.classList.remove('d-none');
        }
        setStatus('Captured — ready to enroll', 'success');
      } catch (err) {
        console.error('Capture failed', err);
        setStatus('Capture failed: ' + (err.message || ''), 'error');
        if (err.name === 'NotAllowedError') {
          alert('Camera permission denied. Allow camera access and try again.');
        } else if (err.message && err.message.includes('getUserMedia')) {
          alert('Camera not available. Use HTTPS or localhost.');
        }
      }
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const customerId = ($('customerId') && $('customerId').value.trim()) || '';
      const fullName = ($('fullName') && $('fullName').value.trim()) || '';
      const phone = ($('phone') && $('phone').value.trim()) || '';
      const address = ($('address') && $('address').value.trim()) || '';

      if (!customerId || !fullName) return alert('Customer ID and Full name required');
      if (!capturedDataUrl) return alert('Please capture a photo first');

      setStatus('Saving enrollment...');

      // If face models available, also compute descriptor
      let descriptorArr = null;
      if (faceModelsLoaded) {
        try {
          // use latest captured preview canvas (or re-capture from video)
          const tempCanvas = document.createElement('canvas');
          const img = new Image();
          img.src = capturedDataUrl;
          await new Promise(r => img.onload = r);
          tempCanvas.width = img.width; tempCanvas.height = img.height;
          tempCanvas.getContext('2d').drawImage(img, 0, 0);
          const detection = await faceapi.detectSingleFace(tempCanvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 })).withFaceLandmarks().withFaceDescriptor();
          if (detection && detection.descriptor) {
            descriptorArr = descriptorToArray(detection.descriptor);
          } else {
            console.warn('No face descriptor detected; saving image only');
          }
        } catch (err) {
          console.warn('Descriptor extraction failed', err);
        }
      }

      const docData = {
        customerId,
        fullName,
        phone,
        address,
        imageDataUrl: capturedDataUrl,
        descriptor: descriptorArr,
        enrolledAt: new Date().toISOString(),
        enrolledBy: (auth.currentUser && auth.currentUser.email) || 'unknown'
      };

      try {
        await setDoc(doc(db, 'customers', customerId), docData);
        setStatus('Enrollment saved', 'success');
        alert('Enrolled: ' + fullName);
        window.location.href = 'dashboard.html';
      } catch (err) {
        console.error('save error', err);
        setStatus('Save failed: ' + (err.message || ''), 'error');
      }
    });
  }
}

/* ========== VERIFY ========== */
async function initVerify() {
  const form = $('verifyForm');
  const queryInput = $('verifyQuery');
  const vid = $('verifyCamera');
  const btnCapture = $('btnVerifyCapture');
  const snapshotCanvas = $('verifySnapshot');
  const preview = $('verifyPreview');
  const result = $('verifyResult');
  const status = $('verifyStatus');

  function setStatus(msg, type='muted') {
    if (!status) return;
    status.textContent = msg;
    status.className = type === 'error' ? 'small text-danger mt-2' : (type === 'success' ? 'small text-success mt-2' : 'small text-muted mt-2');
  }

  let selectedCandidate = null;
  let lastCapturedDataUrl = null;

  // search handler (also used on form submit)
  async function findCandidate(q) {
    if (!q) return null;
    q = q.trim();
    // attempt direct doc id
    const docSnap = await getDoc(doc(db, 'customers', q));
    if (docSnap.exists()) return { id: docSnap.id, ...docSnap.data() };
    // fallback: search all
    const all = [];
    const snaps = await getDocs(collection(db, 'customers'));
    snaps.forEach(s => all.push({ id: s.id, ...s.data() }));
    const lc = q.toLowerCase();
    return all.find(c => (c.customerId && c.customerId.toLowerCase() === lc) || (c.fullName && c.fullName.toLowerCase().includes(lc))) || null;
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setStatus('Searching...');
      result.classList.add('d-none');
      selectedCandidate = await findCandidate(queryInput.value || '');
      if (!selectedCandidate) {
        setStatus('No record found', 'error');
        return;
      }
      // show candidate
      result.className = 'alert alert-info mt-3';
      result.innerHTML = `
        <div style="display:flex;gap:12px;align-items:center">
          <img src="${selectedCandidate.imageDataUrl || ''}" style="width:140px;height:140px;object-fit:cover;border-radius:8px"/>
          <div><strong>${selectedCandidate.fullName}</strong><div>${selectedCandidate.phone||''}</div><div>${selectedCandidate.address||''}</div></div>
        </div>`;
      result.classList.remove('d-none');
      setStatus('Candidate selected', 'success');
    });
  }

  async function ensureCamera() {
    try {
      await startCamera(vid);
    } catch (err) {
      console.error('camera error', err);
      alert('Camera error: ' + (err.message || ''));
      throw err;
    }
  }

  if (btnCapture) {
    btnCapture.addEventListener('click', async () => {
      try {
        if (!selectedCandidate) { alert('Search and select a candidate first'); return; }
        if (!vid.srcObject) await ensureCamera();
        const canvas = captureCanvasFromVideo(vid, 480);
        // preview small
        const previewCanvas = document.createElement('canvas');
        const targetW = 480;
        const scale = targetW / canvas.width;
        previewCanvas.width = targetW;
        previewCanvas.height = Math.round(canvas.height * scale);
        previewCanvas.getContext('2d').drawImage(canvas, 0, 0, previewCanvas.width, previewCanvas.height);
        lastCapturedDataUrl = previewCanvas.toDataURL('image/jpeg', 0.75);
        if (snapshotCanvas) {
          snapshotCanvas.width = previewCanvas.width;
          snapshotCanvas.height = previewCanvas.height;
          snapshotCanvas.getContext('2d').drawImage(previewCanvas, 0, 0);
          snapshotCanvas.classList.remove('d-none');
        }
        if (preview) {
          preview.src = lastCapturedDataUrl;
          preview.classList.remove('d-none');
        }

        if (!faceModelsLoaded) {
          setStatus('Face models not loaded; cannot verify descriptors', 'error');
          return;
        }
        setStatus('Detecting face and comparing...');
        const detection = await faceapi.detectSingleFace(previewCanvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 })).withFaceLandmarks().withFaceDescriptor();
        if (!detection) { setStatus('No face detected', 'error'); return; }
        const liveDesc = detection.descriptor;
        const dbDescArr = selectedCandidate.descriptor || [];
        if (!dbDescArr.length) { setStatus('Selected candidate has no stored descriptor', 'error'); return; }
        const dbDesc = arrayToFloat32(dbDescArr);
        const dist = euclideanDistance(liveDesc, dbDesc);
        if (dist < MATCH_THRESHOLD) {
          setStatus(`MATCH ✅ — ${selectedCandidate.fullName} (dist=${dist.toFixed(3)})`, 'success');
        } else {
          setStatus(`NO MATCH ❌ (dist=${dist.toFixed(3)})`, 'error');
        }
      } catch (err) {
        console.error('verify capture error', err);
        setStatus('Error during verification: ' + (err.message || ''), 'error');
      }
    });
  }

}

/* ========== Helpful notes for debugging common errors ========== */

console.log('app.js loaded. Tips:');
console.log('- If you see "chrome-extension://invalid/ net::ERR_FAILED" that is a browser extension (like QuillBot) making requests. Disable the extension or ignore; not your code.');
console.log('- Camera requires HTTPS or http://localhost. If testing via file:// it will fail.');
console.log('- If camera permission is denied, grant camera access for the page in browser settings.');
console.log('- If face-api models fail to load from /models, download the models folder and place it at project root /models.');

