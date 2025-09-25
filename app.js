// app.js (type="module")
/*
  Single robust app.js for:
    - index.html  (login/signup email+password)  => ids: authForm, authEmail, authPassword, btnSignup, btnLogin, authMessage
    - dashboard.html => ids: userList (tbody) OR customerList (list-group), btnLogout, btnDeleteMode, userEmail
    - enroll.html => supports both sets of ids:
         customerId/fullName/address/phone
         enrollVideo OR enrollVideo (both same)
         btnStartEnrollCam OR btnStartCameraEnroll (optional)
         btnCaptureEnroll OR btnEnrollCapture (capture)
         enrollCanvas/enrollPreview/enrollStatus/enrollForm
    - verify.html => supports btnFind/verifySearch, verifyVideo, btnStartVerifyCam, btnCaptureVerify or btnVerifyCapture, verifySnapshot, verifyPreview, verifyStatus, verifyResult
*/

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

/* ====== CONFIG ====== */
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

/* ====== Face API config ====== */
const MODEL_URL = '/models'; // local models folder recommended
const MATCH_THRESHOLD = 0.52; // lower -> stricter

/* ====== Utilities ====== */
const $ = id => document.getElementById(id);
const exists = id => !!$(id);

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function descriptorToArray(desc){ return Array.from(desc); }
function arrayToFloat32(arr){ return Float32Array.from(arr); }
function euclideanDistance(a,b){
  let sum = 0;
  for(let i=0;i<a.length;i++){ const d = a[i]-b[i]; sum += d*d; }
  return Math.sqrt(sum);
}

/* ====== Face-api loader (non-blocking) ====== */
let faceModelsLoaded = false;
async function loadFaceModels(){
  if(typeof faceapi === 'undefined'){
    console.warn('face-api.js is not loaded. Face recognition features will be disabled.');
    return;
  }
  try{
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    faceModelsLoaded = true;
    console.log('face-api models loaded from', MODEL_URL);
  }catch(err){
    console.warn('Failed to load face-api models from', MODEL_URL, err);
  }
}
loadFaceModels();

/* ====== Camera helpers (robust for mobile) ====== */
async function startCamera(videoEl, constraints = { video: { facingMode: 'user' }, audio: false }) {
  if(!videoEl) throw new Error('video element required');
  if(videoEl.srcObject) return videoEl.srcObject;
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('getUserMedia not supported');
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline',''); // iOS
  await waitForVideoReady(videoEl);
  return stream;
}

function waitForVideoReady(videoEl, timeoutMs = 5000){
  return new Promise((resolve, reject) => {
    let done = false;
    const to = setTimeout(() => {
      if(!done){ done = true; resolve(); } // best-effort resolve
    }, timeoutMs);

    if(videoEl.readyState >= 2 && videoEl.videoWidth > 0){
      done = true; clearTimeout(to); return resolve();
    }

    function onLoadedMeta(){ if(done) return; done = true; clearTimeout(to); cleanup(); resolve(); }
    function onPlay(){ if(done) return; if(videoEl.videoWidth>0){ done = true; clearTimeout(to); cleanup(); resolve(); } }
    function cleanup(){ videoEl.removeEventListener('loadedmetadata', onLoadedMeta); videoEl.removeEventListener('play', onPlay); }

    videoEl.addEventListener('loadedmetadata', onLoadedMeta);
    videoEl.addEventListener('play', onPlay);
  });
}

function captureCanvasFromVideo(videoEl, targetWidth = null){
  // get natural video dims
  const vw = videoEl.videoWidth || 640;
  const vh = videoEl.videoHeight || 480;
  let w = vw, h = vh;
  if(targetWidth && vw > 0){
    const scale = targetWidth / vw;
    w = Math.round(vw * scale);
    h = Math.round(vh * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, w, h);
  return canvas;
}

function canvasRegionToThumbDataUrl(canvas, box, size=128, quality=0.65){
  const tmp = document.createElement('canvas');
  tmp.width = size; tmp.height = size;
  const ctx = tmp.getContext('2d');
  if(!box || box.width <= 0){
    ctx.drawImage(canvas, 0, 0, size, size);
  } else {
    ctx.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, size, size);
  }
  return tmp.toDataURL('image/jpeg', quality);
}

/* ====== AUTH UI: signup/login/logout ====== */
(function wireAuthUI(){
  // support multiple id names
  const emailInput = $('authEmail') || $('emailInput') || $('loginEmail') || null;
  const passwordInput = $('authPassword') || $('passwordInput') || $('loginPassword') || null;
  const btnSignup = $('btnSignup') || $('signupBtn') || null;
  const authForm = $('authForm') || $('loginForm') || null;
  const btnLogin = $('btnLogin') || null;
  const btnLogout = $('btnLogout') || null;
  const authMsg = $('authMessage') || null;

  function showAuthMessage(msg, level='error'){
    if(!authMsg){ if(msg) console.log('AUTH:', msg); return; }
    authMsg.textContent = msg || '';
    authMsg.className = level === 'error' ? 'mt-3 text-center small text-danger' : 'mt-3 text-center small text-success';
  }

  // SIGNUP
  if(btnSignup){
    btnSignup.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = emailInput && emailInput.value ? emailInput.value.trim() : prompt('Enter email');
      const password = passwordInput && passwordInput.value ? passwordInput.value : prompt('Enter password (min 6 chars)');
      if(!email || !password) return showAuthMessage('Email and password required', 'error');
      try{
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        // create admins/{uid} doc so this user is admin
        await setDoc(doc(db, 'admins', userCred.user.uid), {
          uid: userCred.user.uid,
          email,
          role: 'admin',
          createdAt: new Date().toISOString()
        });
        showAuthMessage('Signup successful — redirecting...', 'success');
        window.location.href = 'dashboard.html';
      }catch(err){
        console.error('signup error', err);
        showAuthMessage(err.message || 'Signup failed', 'error');
      }
    });
  }

  // LOGIN (form submit or button fallback)
  if(authForm){
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput && emailInput.value ? emailInput.value.trim() : '';
      const password = passwordInput && passwordInput.value ? passwordInput.value : '';
      if(!email || !password) return showAuthMessage('Enter email and password', 'error');
      try{
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = 'dashboard.html';
      }catch(err){
        console.error('login error', err);
        showAuthMessage(err.message || 'Login failed', 'error');
      }
    });
  } else if(btnLogin){
    btnLogin.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = emailInput && emailInput.value ? emailInput.value.trim() : prompt('Email');
      const password = passwordInput && passwordInput.value ? passwordInput.value : prompt('Password');
      if(!email || !password) return showAuthMessage('Enter email and password', 'error');
      try{
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = 'dashboard.html';
      }catch(err){
        console.error('login error', err);
        showAuthMessage(err.message || 'Login failed', 'error');
      }
    });
  }

  // LOGOUT wiring
  if(btnLogout){
    btnLogout.addEventListener('click', async () => {
      try{
        await signOut(auth);
        window.location.href = 'index.html';
      }catch(err){
        console.error('signout error', err);
        alert('Sign out failed');
      }
    });
  }
})();

/* ====== Helper: check admin doc (returns boolean) ====== */
async function checkIsAdmin(uid){
  if(!uid) return false;
  try{
    const a = await getDoc(doc(db, 'admins', uid));
    return a.exists();
  }catch(err){
    console.error('checkIsAdmin', err);
    return false;
  }
}

/* ====== Auth state listener & page guards ====== */
onAuthStateChanged(auth, async (user) => {
  const page = window.location.pathname.split('/').pop();
  const protectedPages = ['dashboard.html', 'enroll.html', 'verify.html'];
  if(!user){
    if(protectedPages.includes(page)){
      window.location.href = 'index.html';
    }
    return;
  }

  // ensure admin doc exists for signups (we create on signup but ensure here)
  try{
    const isAdmin = await checkIsAdmin(user.uid);
    if(!isAdmin){
      // create admins doc automatically for convenience (per your request: every signup is admin)
      await setDoc(doc(db, 'admins', user.uid), {
        uid: user.uid,
        email: user.email || '',
        role: 'admin',
        createdAt: new Date().toISOString()
      });
      console.log('Created admin doc for', user.uid);
    }
  }catch(err){
    console.warn('could not ensure admin doc', err);
  }

  // init pages
  if(page === 'dashboard.html') initDashboardPage();
  if(page === 'enroll.html') initEnrollPage();
  if(page === 'verify.html') initVerifyPage();
});

/* ====== DASHBOARD ====== */
async function initDashboardPage(){
  // support both table tbody (userList) and list-group (customerList)
  const tbody = $('userList'); // optional
  const listGroup = $('customerList'); // optional
  const btnLogout = $('btnLogout');
  const userEmailEl = $('userEmail');

  if(userEmailEl && auth.currentUser) userEmailEl.textContent = auth.currentUser.email || '';

  if(btnLogout) btnLogout.onclick = async () => { await signOut(auth); window.location.href = 'index.html'; };

  async function loadCustomers(){
    try{
      const snaps = await getDocs(collection(db, 'customers'));
      const rows = [];
      snaps.forEach(s => rows.push({ id: s.id, ...s.data() }));

      // populate table if exists
      if(tbody){
        tbody.innerHTML = '';
        if(rows.length === 0){
          tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No enrollments yet</td></tr>';
        } else {
          rows.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td>${r.customerId || r.id}</td>
              <td>${r.fullName || ''}</td>
              <td>${r.phone || ''}</td>
              <td><img src="${r.imageDataUrl || ''}" style="width:64px;height:64px;object-fit:cover;border-radius:8px" /></td>
              <td>
                <button class="btn btn-sm btn-outline-primary view-btn" data-id="${r.id}">View</button>
                <button class="btn btn-sm btn-warning reenroll-btn" data-id="${r.id}">Re-enroll</button>
                <button class="btn btn-sm btn-danger delete-btn" data-id="${r.id}">Delete</button>
              </td>`;
            tbody.appendChild(tr);
          });
        }
      }

      // populate list-group if exists
      if(listGroup){
        listGroup.innerHTML = '';
        if(rows.length === 0){
          listGroup.innerHTML = '<div class="text-muted p-3">No enrollments yet</div>';
        } else {
          rows.forEach(r => {
            const item = document.createElement('div');
            item.className = 'list-group-item d-flex align-items-center justify-content-between';
            item.innerHTML = `
              <div style="display:flex;gap:12px;align-items:center">
                <img src="${r.imageDataUrl || ''}" style="width:64px;height:64px;object-fit:cover;border-radius:8px"/>
                <div>
                  <div class="fw-bold">${r.fullName || r.customerId || r.id}</div>
                  <div class="small text-muted">${r.customerId || r.id} • ${r.phone || ''}</div>
                </div>
              </div>
              <div class="d-flex gap-2">
                <button class="btn btn-sm btn-outline-primary view-btn" data-id="${r.id}">View</button>
                <button class="btn btn-sm btn-warning reenroll-btn" data-id="${r.id}">Re-enroll</button>
                <button class="btn btn-sm btn-danger delete-btn" data-id="${r.id}">Delete</button>
              </div>`;
            listGroup.appendChild(item);
          });
        }
      }

      // wire generic actions (works for either container)
      document.querySelectorAll('.view-btn').forEach(btn => btn.onclick = async () => {
        const id = btn.dataset.id;
        const d = await getDoc(doc(db, 'customers', id));
        if(!d.exists()) return alert('Not found');
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

      document.querySelectorAll('.reenroll-btn').forEach(b => b.onclick = () => {
        window.location.href = `enroll.html?id=${encodeURIComponent(b.dataset.id)}`;
      });

      document.querySelectorAll('.delete-btn').forEach(b => b.onclick = async () => {
        const id = b.dataset.id;
        if(!confirm(`Delete enrollment ${id}? This cannot be undone.`)) return;
        await deleteDoc(doc(db, 'customers', id));
        alert('Deleted.');
        await loadCustomers();
      });

    }catch(err){
      console.error('loadCustomers error', err);
      if(tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-danger">Failed to load. Check console.</td></tr>';
      if(listGroup) listGroup.innerHTML = '<div class="text-danger p-3">Failed to load. Check console.</div>';
    }
  }

  await loadCustomers();
}

/* ====== ENROLL PAGE ====== */
async function initEnrollPage(){
  // support various IDs
  const form = $('enrollForm') || $('enroll_form') || null;
  const customerIdEl = $('customerId') || $('enrollCustomerId') || null;
  const fullNameEl = $('fullName') || $('enrollFullName') || null;
  const addressEl = $('address') || $('enrollAddress') || null;
  const phoneEl = $('phone') || $('enrollPhone') || null;
  const videoEl = $('enrollVideo') || $('camera') || null;
  const btnStartCam = $('btnStartEnrollCam') || $('btnStartCameraEnroll') || null;
  const btnCapture = $('btnCaptureEnroll') || $('btnEnrollCapture') || $('btnCapture') || null;
  const statusEl = $('enrollStatus') || null;
  const canvasEl = $('enrollCanvas') || $('snapshot') || null;
  const previewImg = $('enrollPreview') || $('preview') || null;

  function setStatus(msg, type='muted'){
    if(!statusEl){ console.log('ENROLL STATUS:', msg); return; }
    statusEl.textContent = msg;
    statusEl.className = type === 'error' ? 'small text-danger mt-2' : type === 'success' ? 'small text-success mt-2' : 'small text-muted mt-2';
  }

  // prefill when re-enroll ?id=
  const params = new URLSearchParams(window.location.search);
  const preId = params.get('id');
  if(preId && customerIdEl){
    try{
      const snap = await getDoc(doc(db,'customers', preId));
      if(snap.exists()){
        const data = snap.data();
        customerIdEl.value = data.customerId || preId;
        if(fullNameEl) fullNameEl.value = data.fullName || '';
        if(addressEl) addressEl.value = data.address || '';
        if(phoneEl) phoneEl.value = data.phone || '';
        setStatus('Loaded existing record for re-enroll. Capture and Save to overwrite.');
      }
    }catch(e){
      console.warn('prefill failed', e);
    }
  }

  // camera starter
  async function ensureCameraStarted(){
    if(!videoEl) throw new Error('No video element on page');
    try{
        const stream = await startCamera(videoEl);
        console.log("Camera started:", stream);
        setStatus('Camera started', 'success');
    }catch(err){
        console.error('startCamera error', err);
        setStatus('Camera error: ' + (err.message||''), 'error');
        throw err;
    }
}


  // if there is a start button, wire it
  if(btnStartCam){
    btnStartCam.addEventListener('click', async () => {
      try{ await ensureCameraStarted(); }catch(e){}
    });
  } else {
    // no explicit start button: attempt to start camera automatically (best effort)
    (async () => {
      try{ await ensureCameraStarted(); }catch(e){ /* ignore */ }
    })();
  }

  // capture handler (works if user presses capture)
  let lastCapturedDataUrl = null;
  if(btnCapture){
    btnCapture.addEventListener('click', async (e) => {
      e.preventDefault();
      if(!videoEl) return setStatus('No camera element', 'error');

      // ensure the video has stream
      if(!videoEl.srcObject){
        try{ await ensureCameraStarted(); }catch(err){ return; }
      }

      // wait for video ready
      await waitForVideoReady(videoEl);

      // capture full frame canvas
      const canvas = captureCanvasFromVideo(videoEl, 640);
      // produce thumbnail of detected face region if face-api loaded else center crop
      let thumbDataUrl = null;
      let descriptorArr = null;

      if(faceModelsLoaded && typeof faceapi !== 'undefined'){
        try{
          const detection = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 })).withFaceLandmarks().withFaceDescriptor();
          if(detection){
            thumbDataUrl = canvasRegionToThumbDataUrl(canvas, detection.detection.box, 128, 0.75);
            descriptorArr = descriptorToArray(detection.descriptor);
          } else {
            // no face found - fallback to center crop
            thumbDataUrl = canvasRegionToThumbDataUrl(canvas, null, 128, 0.75);
            setStatus('No clear face detected; captured image saved (recommend better lighting).', 'error');
          }
        }catch(err){
          console.warn('face-api detection failed', err);
          thumbDataUrl = canvasRegionToThumbDataUrl(canvas, null, 128, 0.75);
          setStatus('Face detection failed; image captured (models may not be loaded).', 'error');
        }
      } else {
        thumbDataUrl = canvasRegionToThumbDataUrl(canvas, null, 128, 0.75);
        setStatus('Face models not loaded — saved image only.', 'muted');
      }

      // show preview if element exists
      if(previewImg){
        previewImg.src = thumbDataUrl;
        previewImg.classList.remove('d-none');
      }
      // place thumbDataUrl into temporary storage accessible to submit handler
      lastCapturedDataUrl = thumbDataUrl;

      // if no canvasEl in DOM, use a hidden canvas to attach the latest capture (optional)
      if(canvasEl){
        canvasEl.width = 128; canvasEl.height = 128;
        const ctx = canvasEl.getContext('2d'), img = new Image();
        img.onload = () => ctx.drawImage(img,0,0,128,128);
        img.src = thumbDataUrl;
        canvasEl.classList.remove('d-none');
      }

      // attach to form element for later submit (store on dataset)
      if(form) form._lastCapture = { dataUrl: thumbDataUrl, descriptor: descriptorArr };
      setStatus('Captured — fill details and submit', 'success');
    });
  }

  // submit handler: save to Firestore
  if(form){
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      // require fields
      const cid = customerIdEl && customerIdEl.value ? customerIdEl.value.trim() : null;
      const name = fullNameEl && fullNameEl.value ? fullNameEl.value.trim() : null;
      if(!cid || !name) return alert('Customer ID and Full Name are required.');
      const phone = phoneEl && phoneEl.value ? phoneEl.value.trim() : '';
      const address = addressEl && addressEl.value ? addressEl.value.trim() : '';
      // get last capture
      const captured = form._lastCapture;
      if(!captured || !captured.dataUrl) return alert('Please capture a photo first.');

      const docData = {
        customerId: cid,
        fullName: name,
        phone,
        address,
        imageDataUrl: captured.dataUrl,
        descriptor: captured.descriptor || null,
        enrolledAt: new Date().toISOString(),
        enrolledBy: (auth.currentUser && auth.currentUser.email) || 'unknown'
      };

      try{
        await setDoc(doc(db, 'customers', cid), docData);
        setStatus('Enrollment saved', 'success');
        alert('Enrolled: ' + name);
        window.location.href = 'dashboard.html';
      }catch(err){
        console.error('save error', err);
        setStatus('Save failed: ' + (err.message || ''), 'error');
        alert('Save failed: ' + (err.message || ''));
      }
    });
  }
}

/* ====== VERIFY PAGE ====== */
async function initVerifyPage(){
  // support multiple ids
  const searchEl = $('verifySearch') || $('verifyQuery') || null;
  const btnFind = $('btnFind') || $('btnVerifyFind') || null;
  const videoEl = $('verifyVideo') || $('verifyCamera') || null;
  const btnStartCam = $('btnStartVerifyCam') || $('btnStartVerifyCamera') || null;
  const btnCapture = $('btnCaptureVerify') || $('btnVerifyCapture') || null;
  const statusEl = $('verifyStatus') || null;
  const resultEl = $('verifyResult') || null;
  const previewEl = $('verifyPreview') || null;
  const snapshotCanvas = $('verifySnapshot') || null;

  function setStatus(msg, type='muted'){
    if(!statusEl){ console.log('VERIFY STATUS:', msg); return; }
    statusEl.textContent = msg;
    statusEl.className = type === 'error' ? 'small text-danger mt-2' : type === 'success' ? 'small text-success mt-2' : 'small text-muted mt-2';
  }

  let selectedCandidate = null;

  async function findCandidate(q){
    if(!q) return null;
    q = q.trim();
    // try doc id
    const docSnap = await getDoc(doc(db, 'customers', q));
    if(docSnap.exists()) return { id: docSnap.id, ...docSnap.data() };
    // fallback search
    const snaps = await getDocs(collection(db, 'customers'));
    const all = []; snaps.forEach(s => all.push({ id: s.id, ...s.data() }));
    const lc = q.toLowerCase();
    return all.find(c => (c.customerId && c.customerId.toLowerCase() === lc) || (c.fullName && c.fullName.toLowerCase().includes(lc))) || null;
  }

  if(btnFind && searchEl){
    btnFind.addEventListener('click', async (e) => {
      e.preventDefault();
      setStatus('Searching...');
      resultEl && (resultEl.innerHTML = '');
      selectedCandidate = await findCandidate(searchEl.value || '');
      if(!selectedCandidate){
        setStatus('No record found', 'error');
        return;
      }
      setStatus('Candidate selected', 'success');
      if(resultEl){
        resultEl.className = 'alert alert-info mt-3';
        resultEl.innerHTML = `<div style="display:flex;gap:12px;align-items:center">
          <img src="${selectedCandidate.imageDataUrl || ''}" style="width:140px;height:140px;object-fit:cover;border-radius:8px"/>
          <div><strong>${selectedCandidate.fullName}</strong><div>${selectedCandidate.phone||''}</div><div>${selectedCandidate.address||''}</div></div>
        </div>`;
        resultEl.classList.remove('d-none');
      }
    });
  }

  // allow enter submit if there is a form with submit (some verify.html uses a form)
  const verifyForm = $('verifyForm') || null;
  if(verifyForm){
    verifyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = searchEl ? (searchEl.value || '') : '';
      selectedCandidate = await findCandidate(q);
      if(!selectedCandidate){ setStatus('No record found', 'error'); return; }
      setStatus('Candidate selected', 'success');
      if(resultEl){
        resultEl.className = 'alert alert-info mt-3';
        resultEl.innerHTML = `<div style="display:flex;gap:12px;align-items:center">
          <img src="${selectedCandidate.imageDataUrl || ''}" style="width:140px;height:140px;object-fit:cover;border-radius:8px"/>
          <div><strong>${selectedCandidate.fullName}</strong><div>${selectedCandidate.phone||''}</div><div>${selectedCandidate.address||''}</div></div>
        </div>`;
        resultEl.classList.remove('d-none');
      }
    });
  }

  // camera controls
  async function ensureCamera(){
    if(!videoEl) throw new Error('no video element');
    if(!videoEl.srcObject){
      try{ await startCamera(videoEl); setStatus('Camera started', 'success'); }catch(err){ setStatus('Camera error: '+ (err.message||''),'error'); throw err; }
    }
  }

  if(btnStartCam){
    btnStartCam.addEventListener('click', async () => {
      try{ await ensureCamera(); }catch(e){}
    });
  } else {
    // try auto-start silently (optional)
    (async()=>{ try{ await ensureCamera(); }catch(e){} })();
  }

  if(btnCapture){
    btnCapture.addEventListener('click', async (e) => {
      e.preventDefault();
      if(!selectedCandidate){ alert('Search and select a candidate first'); return; }
      try{
        await ensureCamera();
      }catch(err){ return; }

      await waitForVideoReady(videoEl);
      const canvas = captureCanvasFromVideo(videoEl, 480);

      // preview
      const previewDataUrl = canvasRegionToThumbDataUrl(canvas, null, 240, 0.8);
      if(previewEl){ previewEl.src = previewDataUrl; previewEl.classList.remove('d-none'); }
      if(snapshotCanvas){
        snapshotCanvas.width = 240; snapshotCanvas.height = Math.round((canvas.height / canvas.width) * 240);
        snapshotCanvas.getContext('2d').drawImage(canvas, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
        snapshotCanvas.classList.remove('d-none');
      }

      if(!faceModelsLoaded || typeof faceapi === 'undefined'){
        setStatus('Face models not available — cannot compare descriptors', 'error');
        return;
      }

      setStatus('Detecting face and comparing...');
      try{
        const det = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 })).withFaceLandmarks().withFaceDescriptor();
        if(!det){ setStatus('No face detected', 'error'); return; }
        const liveDesc = det.descriptor;
        const dbDescArr = selectedCandidate.descriptor || [];
        if(!dbDescArr || !dbDescArr.length){ setStatus('Selected candidate has no stored descriptor', 'error'); return; }
        const dbDesc = arrayToFloat32(dbDescArr);
        const dist = euclideanDistance(liveDesc, dbDesc);
        if(dist < MATCH_THRESHOLD){
          setStatus(`MATCH ✅ — ${selectedCandidate.fullName} (dist=${dist.toFixed(3)})`, 'success');
        } else {
          setStatus(`NO MATCH ❌ (dist=${dist.toFixed(3)})`, 'error');
        }
      }catch(err){
        console.error('verify error', err);
        setStatus('Verification failed: '+ (err.message||''), 'error');
      }
    });
  }
}

/* ====== Info for debugging common browser extension noise ====== */
console.log('app.js loaded. Notes:');
console.log('- If you see chrome-extension://invalid/ net::ERR_FAILED in console, that is an unrelated browser extension making invalid requests (e.g., QuillBot). Disable the extension or ignore it; it does not break camera.');
console.log('- Camera requires HTTPS or http://localhost. If testing via file:// it will fail.');
